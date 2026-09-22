"""Tests for backend/automations.py - validation, edge triggering, honest results."""

import time
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import automations     # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import notifications   # noqa: E402

NOTIFY = {"type": "notify", "message": "Hot!", "priority": "high"}


def rule(trigger, action=NOTIFY, **extra):
    return {"trigger": trigger, "action": action, **extra}


class AutomationCase(unittest.TestCase):
    def setUp(self):
        automations.reset()
        notifications.reset()
        mock_moonraker.reset_all()
        maintenance.reset_log()

    def tearDown(self):
        automations.wait_idle()
        automations.reset()
        notifications.reset()
        mock_moonraker.reset_all()
        maintenance.reset_log()


class TestValidation(AutomationCase):
    def test_rejects_incomplete_rules(self):
        bad = [
            {},
            rule({"type": "temperature", "sensor": "moon", "op": "above", "value": 1}),
            rule({"type": "temperature", "sensor": "bed", "op": "sideways", "value": 1}),
            rule({"type": "temperature", "sensor": "bed", "op": "above", "value": 999}),
            rule({"type": "state", "event": "exploded"}),
            rule({"type": "state", "event": "paused"}, {"type": "notify", "message": ""}),
            rule({"type": "state", "event": "paused"}, {"type": "light", "color": "orange"}),
            rule({"type": "state", "event": "paused"}, {"type": "home_assistant", "entity_id": "light.x"}),
            rule({"type": "state", "event": "paused"}, condition="on_tuesdays"),
        ]
        for r in bad:
            with self.assertRaises(ValueError, msg=r):
                automations.add_rule(r, demo=True)

    def test_a_good_rule_gets_a_readable_name(self):
        saved = automations.add_rule(rule({"type": "temperature", "sensor": "active_nozzle",
                                           "op": "above", "value": 230}), demo=True)
        self.assertEqual(saved["name"], "When active nozzle above 230°C → notify")
        self.assertTrue(saved["demo"])


class TestFiring(AutomationCase):
    def state(self, **changes):
        s = mock_moonraker.get_printer_state()
        s.update(changes)
        return s

    def test_temperature_fires_on_the_edge_only(self):
        automations.add_rule(rule({"type": "temperature", "sensor": "bed", "op": "above", "value": 50},
                                  cooldown_s=0), demo=True)
        pid = "u1-workshop"
        self.assertEqual(len(automations.evaluate(pid, self.state(bed_temperature=40), set(), True)), 0)
        self.assertEqual(len(automations.evaluate(pid, self.state(bed_temperature=60), set(), True)), 1)
        self.assertEqual(len(automations.evaluate(pid, self.state(bed_temperature=61), set(), True)), 0)
        automations.evaluate(pid, self.state(bed_temperature=40), set(), True)
        self.assertEqual(len(automations.evaluate(pid, self.state(bed_temperature=60), set(), True)), 1)

    def test_cooldown(self):
        automations.add_rule(rule({"type": "state", "event": "paused"}, cooldown_s=3600), demo=True)
        self.assertEqual(len(automations.evaluate("u1-workshop", self.state(), {"paused"}, True)), 1)
        self.assertEqual(len(automations.evaluate("u1-workshop", self.state(), {"paused"}, True)), 0)

    def test_demo_rules_never_watch_real_printers_and_vice_versa(self):
        automations.add_rule(rule({"type": "state", "event": "paused"}), demo=True)
        self.assertEqual(automations.evaluate("u1-workshop", self.state(), {"paused"}, demo_printer=False), [])
        automations.reset()
        automations.add_rule(rule({"type": "state", "event": "paused"}), demo=False)
        self.assertEqual(automations.evaluate("u1-workshop", self.state(), {"paused"}, demo_printer=True), [])

    def test_condition_while_printing(self):
        automations.add_rule(rule({"type": "temperature", "sensor": "bed", "op": "above", "value": 50},
                                  condition="while_printing"), demo=True)
        self.assertEqual(automations.evaluate("u1-workshop", self.state(state="ready", bed_temperature=60),
                                              set(), True), [])

    def test_maintenance_and_mismatch_triggers(self):
        automations.add_rule(rule({"type": "maintenance_overdue", "task": "any"}), demo=True)
        automations.add_rule(rule({"type": "filament_mismatch"}), demo=True)
        overdue = maintenance.get_status()["summary"]["overdue"]
        fired = automations.evaluate("u1-workshop", self.state(), set(), True)
        self.assertEqual(len(fired), 1 if overdue else 0)
        with mock_moonraker.use_printer("u1-workshop"):
            s = self.state()
        s["toolheads"]["T0"]["filament_color_hex"] = "#00ff00"
        s["toolheads"]["T0"]["filament_color_name"] = "Green"
        fired = automations.evaluate("u1-workshop", s, set(), True)
        self.assertEqual(len(fired), 1)

    def test_notify_without_a_channel_is_logged_as_not_sent(self):
        saved = automations.add_rule(rule({"type": "state", "event": "paused"}), demo=True)
        entry = automations.test_fire(saved["id"], "u1-workshop")
        self.assertFalse(entry["ok"])
        self.assertIn("no notification channel", entry["error"])

    def test_no_channel_is_never_reported_as_queued_even_in_quiet_hours(self):
        notifications.save_settings({"quiet_hours_start": 0, "quiet_hours_end": 23})
        saved = automations.add_rule(rule({"type": "state", "event": "paused"},
                                          {"type": "notify", "message": "x", "priority": "normal"}), demo=True)
        entry = automations.test_fire(saved["id"], "u1-workshop")
        self.assertFalse(entry["ok"])
        self.assertIn("no notification channel", entry["error"])

    def test_bridge_actions_report_real_failures(self):
        light = automations.add_rule(rule({"type": "state", "event": "paused"},
                                          {"type": "light", "color": "#ffaa00"}), demo=True)
        self.assertEqual(automations.test_fire(light["id"], "u1-workshop")["error"], "No WLED host configured")
        ha = automations.add_rule(rule({"type": "state", "event": "paused"},
                                       {"type": "home_assistant", "entity_id": "sensor.alert", "state": "on"}), demo=True)
        self.assertIn("must both be set", automations.test_fire(ha["id"], "u1-workshop")["error"])

    def test_pause_action_really_pauses(self):
        saved = automations.add_rule(rule({"type": "temperature", "sensor": "chamber", "op": "above", "value": 1},
                                          {"type": "pause"}), demo=True)
        entry = automations.test_fire(saved["id"], "u1-workshop")
        self.assertTrue(entry["ok"])
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "paused")
        again = automations.test_fire(saved["id"], "u1-workshop")
        self.assertFalse(again["ok"])                # nothing printing any more - said so

    def test_fired_actions_run_in_the_background_and_are_logged(self):
        automations.add_rule(rule({"type": "state", "event": "paused"}, {"type": "pause"}), demo=True)
        seen = []
        automations.add_listener(seen.append)
        automations.evaluate("u1-workshop", self.state(), {"paused"}, True)
        self.assertTrue(automations.wait_idle())
        self.assertEqual(automations.get_log()[0]["action"], "pause")
        self.assertTrue(seen)
        automations._listeners.remove(seen.append)

    def test_update_and_delete(self):
        saved = automations.add_rule(rule({"type": "state", "event": "paused"}), demo=True)
        self.assertFalse(automations.update_rule(saved["id"], {"enabled": False})["enabled"])
        self.assertEqual(automations.delete_rule(saved["id"]), [])
        with self.assertRaises(ValueError):
            automations.delete_rule(saved["id"])


if __name__ == "__main__":
    unittest.main()
