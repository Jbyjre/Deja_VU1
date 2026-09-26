"""
Tests for backend/sandbox.py - the farm simulator. It must drive the same
simulation every other module reads (so the rest of the dashboard reacts),
log what each step really did, and start prints only through Confirm Print.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import automations     # noqa: E402
import file_library    # noqa: E402
import fleet           # noqa: E402
import live_feed       # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import print_queue     # noqa: E402
import sandbox         # noqa: E402


class SandboxTest(unittest.TestCase):
    def setUp(self):
        sandbox.reset()
        mock_moonraker.reset_all()
        live_feed.reset()
        live_feed.mark_demo_seen()
        automations.reset()
        file_library.reset()
        print_queue.reset()
        maintenance.reset_all_logs()

    def tearDown(self):
        automations.wait_idle()
        sandbox.reset()
        mock_moonraker.reset_all()
        automations.reset()
        file_library.reset()
        print_queue.reset()
        maintenance.reset_all_logs()

    def state(self, pid):
        with mock_moonraker.use_printer(pid):
            return mock_moonraker.get_printer_state()


class TestFarm(SandboxTest):
    def test_build_farm_joins_the_real_fleet(self):
        status = sandbox.build_farm(5, busy_fraction=0.6, seed=1)
        self.assertEqual(status["sandbox_count"], 5)
        ids = mock_moonraker.printer_ids()
        self.assertEqual(len(ids), 8)
        overview = {p["id"]: p for p in fleet.overview()["printers"]}
        self.assertEqual(sum(1 for p in overview.values() if p["sandbox"]), 5)
        self.assertEqual(sum(1 for p in overview.values() if p["sandbox"] and p["state"] == "printing"), 3)
        self.assertTrue(all(pid in live_feed.fleet_snapshot()["printers"][i]["id"]
                            for i, pid in enumerate(ids)))

    def test_limits(self):
        with self.assertRaises(ValueError):
            sandbox.build_farm(0)
        sandbox.build_farm(mock_moonraker.MAX_SANDBOX_PRINTERS, seed=2)
        with self.assertRaisesRegex(ValueError, "at most"):
            sandbox.build_farm(1)

    def test_teardown_removes_printers_and_their_leftovers(self):
        sandbox.build_farm(2, seed=3)
        pid = sandbox.sandbox_printers()[0]
        with mock_moonraker.use_printer(pid):
            maintenance.get_status()                       # creates its log file
        log_path = os.path.join(maintenance._DATA_DIR, f"maintenance_log.{pid}.json")
        self.assertTrue(os.path.exists(log_path))
        sandbox.teardown()
        self.assertEqual(mock_moonraker.printer_ids(), list(mock_moonraker.BUILT_IN_IDS))
        self.assertFalse(os.path.exists(log_path))
        with self.assertRaises(ValueError):
            mock_moonraker.remove_printer("u1-workshop")    # the built-in three stay


class TestEvents(SandboxTest):
    def test_jam_fails_the_print_and_the_live_feed_notices(self):
        seen = live_feed.last_event_id()
        [outcome] = sandbox.fire("jam", "u1-workshop")
        self.assertTrue(outcome["ok"], outcome)
        self.assertEqual(self.state("u1-workshop")["state"], "error")
        kinds = [(e["type"], e.get("event")) for e in live_feed.events_since(seen)]
        self.assertIn(("print_event", "failed"), kinds)
        self.assertIn(("sandbox", "jam"), kinds)

    def test_refusals_are_logged_as_refusals(self):
        [outcome] = sandbox.fire("jam", "u1-garage")          # idle: nothing to jam
        self.assertFalse(outcome["ok"])
        self.assertIn("needs a print running", outcome["detail"])
        [outcome] = sandbox.fire("resume", "u1-garage")
        self.assertFalse(outcome["ok"])

    def test_bad_swap_is_a_real_mismatch(self):
        sandbox.fire("bad_swap", "u1-workshop", {"toolhead": "T0"})
        rule = automations.add_rule({"name": "wrong colour", "trigger": {"type": "filament_mismatch"},
                                     "action": {"type": "notify", "message": "Wrong filament"}}, demo=True)
        state = self.state("u1-workshop")
        fired = automations.evaluate("u1-workshop", state, set(), demo_printer=True)
        self.assertIn(rule["id"], fired)

    def test_network_drop_freezes_what_readers_see_and_refuses_commands(self):
        sandbox.fire("network_drop", "u1-workshop")
        frozen = self.state("u1-workshop")
        self.assertTrue(frozen["link_lost"])
        sandbox.step(600)
        self.assertEqual(self.state("u1-workshop")["progress"], frozen["progress"])
        [outcome] = sandbox.fire("pause", "u1-workshop")
        self.assertFalse(outcome["ok"])
        self.assertIn("network link", outcome["detail"])
        sandbox.fire("network_restore", "previous")
        after = self.state("u1-workshop")
        self.assertNotIn("link_lost", after)
        self.assertGreater(after["progress"], frozen["progress"])     # it kept printing behind the drop

    def test_wear_makes_maintenance_overdue_by_its_own_counting(self):
        with mock_moonraker.use_printer("u1-garage"):
            maintenance.mark_done("nozzle_check")
        [outcome] = sandbox.fire("wear", "u1-garage", {"hours": 60})
        self.assertTrue(outcome["ok"])
        with mock_moonraker.use_printer("u1-garage"):
            nozzle = next(t for t in maintenance.get_status()["tasks"] if t["id"] == "nozzle_check")
        self.assertEqual(nozzle["status"], "overdue")

    def test_start_print_goes_through_confirm_print(self):
        [busy] = sandbox.fire("start_print", "u1-studio")         # paused mid-print
        self.assertFalse(busy["ok"])
        self.assertIn("Confirm Print blocked it", busy["detail"])
        [wrong] = sandbox.fire("start_print", "u1-garage")        # White on T0; the cube wants orange
        self.assertIn("sliced for #F26A1B", wrong["detail"])
        self.assertEqual(self.state("u1-garage")["state"], "ready")

        sandbox.build_farm(1, busy_fraction=0, seed=4)             # farm printers load orange on T0
        pid = sandbox.sandbox_printers()[0]
        with mock_moonraker.use_printer(pid):
            maintenance.get_status()
            overdue = maintenance.get_status()["summary"]["overdue"]
        [first] = sandbox.fire("start_print", pid)
        if overdue:
            self.assertIn("Held", first["detail"])                 # warnings need a person...
            [first] = sandbox.fire("start_print", pid, {"accept_warnings": True})
        self.assertTrue(first["ok"], first)                         # ...who the step can stand in for
        self.assertEqual(self.state(pid)["state"], "printing")


class TestScenarios(SandboxTest):
    def test_steps_fire_in_order_at_their_time(self):
        sandbox.load_scenario(steps=[
            {"at_s": 300, "printer": "u1-workshop", "event": "network_drop"},
            {"at_s": 60, "printer": "u1-workshop", "event": "runout", "params": {"toolhead": "T1"}},
            {"at_s": 900, "printer": "previous", "event": "network_restore"},
        ])
        status = sandbox.step(120)
        self.assertEqual([s["fired"] for s in status["steps"]], [True, False, False])
        self.assertEqual(status["clock_s"], 120.0)
        status = sandbox.step(1000)
        self.assertTrue(all(s["fired"] and s["outcome"]["ok"] for s in status["steps"]), status["steps"])
        fired = [(e["clock_s"], e["event"]) for e in reversed(status["log"]) if e["step"]]
        self.assertEqual(fired, [(60.0, "runout"), (300.0, "network_drop"), (900.0, "network_restore")])

    def test_presets_run_and_record_outcomes(self):
        sandbox.build_farm(4, busy_fraction=1.0, seed=9)
        for preset in sandbox.PRESETS:
            sandbox.load_scenario(preset=preset["id"], seed=5)
            status = sandbox.step(max(s["at_s"] for s in preset["steps"]) + 1)
            self.assertEqual(status["pending"], 0, preset["id"])
            for step in status["steps"]:
                self.assertIsNotNone(step["outcome"], preset["id"])

    def test_playing_moves_the_clock_with_the_live_feed(self):
        sandbox.load_scenario(steps=[{"at_s": 30, "printer": "u1-workshop", "event": "pause"}])
        sandbox.set_speed(60)
        sandbox.set_running(True)
        live_feed.tick(1.0)              # one real second at 60x = a simulated minute
        status = sandbox.status()
        self.assertEqual(status["clock_s"], 60.0)
        self.assertTrue(status["steps"][0]["fired"])
        self.assertEqual(self.state("u1-workshop")["state"], "paused")
        sandbox.set_running(False)
        live_feed.tick(1.0)
        self.assertEqual(sandbox.status()["clock_s"], 60.0)

    def test_validation(self):
        for bad in ([], [{"event": "explode"}], [{"event": "jam", "at_s": -1}],
                    [{"event": "jam", "printer": "nobody"}]):
            with self.assertRaises(ValueError):
                sandbox.load_scenario(steps=bad)
        with self.assertRaises(ValueError):
            sandbox.step(0)
        with self.assertRaises(ValueError):
            sandbox.set_speed(1000)


if __name__ == "__main__":
    unittest.main()
