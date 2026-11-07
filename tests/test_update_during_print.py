"""
Updating while a print runs, and everything around a restart that must not be lost or repeated.

The printer holds the file it prints and runs it by itself, so Deja Vu1 restarting never touches a print.
What these tests pin down is Deja Vu1's own side of it:

  - nothing new is sent to a printer from the moment it restarts (update_hold), and a command already on
    its way is let finish first;
  - a print that finishes while Deja Vu1 is restarting is still noticed afterwards;
  - the time-lapse of a print that carried on is picked up again;
  - an automation rule that was already true does not fire a second time;
  - a printer link that was open when the computer slept is opened again at once;
  - the update check never holds up the "is it alive?" answer that the launcher and pages depend on.

    python3 -m unittest tests.test_update_during_print
"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from urllib.error import HTTPError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, ROOT)

import app_updates                 # noqa: E402
import autostart                   # noqa: E402
import automations                 # noqa: E402
import discovery                   # noqa: E402
import live_feed                   # noqa: E402
import moonraker_client as mc      # noqa: E402
import readiness                   # noqa: E402
import stock_camera                # noqa: E402
import timelapse                   # noqa: E402
import update_hold                 # noqa: E402


class TheHold(unittest.TestCase):
    def setUp(self):
        update_hold.end()
        self.addCleanup(update_hold.end)

    def test_it_is_off_until_a_restart_begins_and_ends_by_itself(self):
        self.assertFalse(update_hold.active())
        update_hold.begin("update", seconds=60)
        self.assertTrue(update_hold.active())
        self.assertEqual(update_hold.status()["reason"], "update")
        real = time.monotonic()
        with mock.patch.object(update_hold.time, "monotonic", return_value=real + 3600):
            self.assertFalse(update_hold.active())          # a restart that never came can't refuse commands forever

    def test_writes_are_refused_but_reading_and_the_emergency_stop_still_pass(self):
        update_hold.begin("update")
        for method in ("printer.gcode.script", "printer.print.start", "server.files.delete"):
            with self.assertRaises(update_hold.UpdateHold):
                with update_hold.writing_call(method):
                    self.fail(f"{method} must not start")
        for method in ("printer.objects.query", "printer.objects.subscribe", "server.info", "printer.emergency_stop"):
            with update_hold.writing_call(method):
                pass
        with update_hold.writing_request("GET", "/printer/info"):
            pass
        with update_hold.writing_request("POST", "/printer/emergency_stop"):
            pass
        with self.assertRaises(update_hold.UpdateHold):
            with update_hold.writing_request("POST", "/printer/print/start"):
                self.fail("a print must not be started while Deja Vu1 restarts")
        with self.assertRaises(update_hold.UpdateHold):
            with update_hold.writing_request("POST", "/server/files/upload"):
                self.fail("an upload must not be started while Deja Vu1 restarts")

    def test_a_command_already_on_its_way_is_waited_for_not_cut_in_half(self):
        started, release = threading.Event(), threading.Event()

        def send():
            with update_hold.writing_request("POST", "/printer/gcode/script"):
                started.set()
                release.wait(5)
        thread = threading.Thread(target=send, daemon=True)
        thread.start()
        self.assertTrue(started.wait(2))
        update_hold.begin("update")
        self.assertEqual(update_hold.in_flight(), 1)
        self.assertFalse(update_hold.wait_quiet(0.2))        # still sending
        release.set()
        thread.join(2)
        self.assertTrue(update_hold.wait_quiet(1))
        self.assertEqual(update_hold.in_flight(), 0)

    def test_a_refused_command_is_not_counted_as_sent(self):
        update_hold.begin("update")
        with self.assertRaises(update_hold.UpdateHold):
            with update_hold.writing_call("printer.gcode.script"):
                pass
        self.assertEqual(update_hold.in_flight(), 0)


class TheClientObeysTheHold(unittest.TestCase):
    def setUp(self):
        update_hold.end()
        self.addCleanup(update_hold.end)
        self.printer = mc.MoonrakerPrinter("hold-test", "Bench", "http://127.0.0.1:1")

    def test_an_http_write_is_refused_before_anything_is_sent(self):
        update_hold.begin("update")
        with self.assertRaises(update_hold.UpdateHold):
            self.printer.http.request("POST", "/printer/gcode/script", body={"script": "G28"})
        # A read is not held back: it tries the network and finds nothing listening, which is a different error.
        with self.assertRaises(mc.PrinterUnreachable):
            self.printer.http.request("GET", "/printer/info", timeout=1)

    def test_a_websocket_command_is_refused_before_the_link_is_even_looked_at(self):
        update_hold.begin("update")
        with self.assertRaises(update_hold.UpdateHold):
            self.printer._call("printer.gcode.script", {"script": "G28"})
        update_hold.end()
        with self.assertRaisesRegex(mc.PrinterUnreachable, "No live connection"):
            self.printer._call("printer.gcode.script", {"script": "G28"})

    def test_the_hold_is_a_refusal_never_a_printer_failure(self):
        self.assertTrue(issubclass(update_hold.UpdateHold, mc.PrinterRefused))


class TheCameraSaysNothingOnTheWayDown(unittest.TestCase):
    class Socket:
        def __init__(self):
            self.sent = []
            self.closed = False

        def send_text(self, text):
            self.sent.append(json.loads(text))

        def close(self):
            self.closed = True

    def monitor(self):
        monitor = stock_camera.Monitor(printer=None)
        monitor.ws = self.Socket()
        return monitor, monitor.ws

    def setUp(self):
        update_hold.end()
        self.addCleanup(update_hold.end)

    def test_closing_for_a_restart_sends_the_printer_no_stop(self):
        update_hold.begin("update")
        monitor, sock = self.monitor()
        monitor.close()
        self.assertEqual(sock.sent, [])
        self.assertTrue(sock.closed)

    def test_stopping_on_purpose_still_tells_the_camera_to_stop(self):
        monitor, sock = self.monitor()
        monitor.close()
        self.assertEqual([m["method"] for m in sock.sent], ["camera.stop_monitor"])

    def test_no_camera_is_started_during_the_hold(self):
        update_hold.begin("update")
        monitor, _ = self.monitor()
        with self.assertRaisesRegex(ValueError, "restarting"):
            monitor._send("camera.start_monitor", {"domain": "lan", "interval": 0})


class ARuleThatWasTrueDoesNotFireAgainAfterARestart(unittest.TestCase):
    def setUp(self):
        automations.reset()
        self.addCleanup(automations.reset)
        automations._edge_loaded = False
        self.rule = {"name": "Half way", "trigger": {"type": "progress", "value": 50},
                     "action": {"type": "notify", "message": "Half way there"}, "cooldown_s": 0, "printer": "any"}

    def state(self, progress):
        return {"state": "printing", "progress": progress, "current_file": "x.gcode",
                "toolheads": {}, "layer": {"current": 10}}

    def restart(self):
        """What a new process starts with: nothing in memory."""
        automations._edge.clear()
        automations._edge_loaded = False

    def test_a_real_printers_rule_fires_once_and_not_again_after_the_restart(self):
        automations.add_rule(self.rule, demo=False)
        self.assertEqual(len(automations.evaluate("real-1", self.state(0.4), set(), False)), 0)
        self.assertEqual(len(automations.evaluate("real-1", self.state(0.6), set(), False)), 1)
        automations.wait_idle()
        self.restart()
        # The same print, still past 50%: before this was kept on disk the rule fired again.
        self.assertEqual(automations.evaluate("real-1", self.state(0.7), set(), False), [])
        # A condition that became true while Deja Vu1 was down still fires once, afterwards.
        self.restart()
        automations.evaluate("real-1", self.state(0.1), set(), False)
        self.restart()
        self.assertEqual(len(automations.evaluate("real-1", self.state(0.9), set(), False)), 1)
        automations.wait_idle()

    def test_the_memory_is_a_file_that_holds_only_what_is_true_for_real_printers(self):
        automations.add_rule(self.rule, demo=False)
        automations.add_rule(dict(self.rule, name="Demo rule"), demo=True)
        automations.evaluate("real-1", self.state(0.6), set(), False)
        automations.evaluate("u1-workshop", self.state(0.6), set(), True)
        automations.wait_idle()
        with open(automations._EDGE_PATH, encoding="utf-8") as f:
            saved = json.load(f)["true"]
        self.assertEqual([pair[1] for pair in saved], ["real-1"])


class APrintThatFinishesDuringARestartIsStillNoticed(unittest.TestCase):
    PID = "restart-test"

    def setUp(self):
        live_feed.reset()
        self.addCleanup(live_feed.reset)
        patches = [mock.patch.object(live_feed.mock_moonraker, "is_connected", return_value=True),
                   mock.patch.object(live_feed.mock_moonraker, "printer_name", return_value="Bench"),
                   # Only the detection itself is under test, none of its side effects.
                   mock.patch.object(live_feed.modules, "is_enabled", return_value=False)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def restart(self):
        live_feed._prev_state.clear()
        live_feed._remembered.clear()
        live_feed._checked_restart.clear()

    def events(self):
        return [e["event"] for e in live_feed.events_since(0) if e.get("type") == "print_event"]

    def see(self, state, file="a.gcode"):
        live_feed._detect(self.PID, {"state": state, "current_file": file})

    def test_finished_while_down(self):
        self.see("printing")
        self.restart()
        self.see("complete")
        self.assertEqual(self.events(), ["finished"])

    def test_cancelled_while_down(self):
        self.see("printing")
        self.restart()
        self.see("ready")
        self.assertEqual(self.events(), ["cancelled"])

    def test_a_print_that_carried_on_is_not_announced_as_started(self):
        self.see("printing")
        self.restart()
        self.see("printing")
        self.assertEqual(self.events(), [])

    def test_a_print_already_running_when_there_is_no_note_is_not_announced_either(self):
        self.see("printing")
        self.assertEqual(self.events(), [])

    def test_an_old_note_is_not_trusted(self):
        self.see("printing")
        self.restart()
        old = time.time() - (live_feed.REMEMBER_HOURS + 1) * 3600
        with mock.patch.object(live_feed.storage, "load_json", return_value={self.PID: {
                "state": "printing", "file": "a.gcode", "at": old}}):
            self.see("complete")
        self.assertEqual(self.events(), [])

    def test_a_simulated_printer_is_never_remembered(self):
        with mock.patch.object(live_feed.mock_moonraker, "is_connected", return_value=False):
            self.see("printing")
        self.assertNotIn(self.PID, live_feed._remembered)

    def test_the_note_is_on_disk_so_it_survives_a_real_restart(self):
        self.see("printing")
        with open(live_feed._STATE_PATH, encoding="utf-8") as f:
            self.assertEqual(json.load(f)[self.PID]["state"], "printing")


class TheTimelapseCarriesOn(unittest.TestCase):
    def setUp(self):
        timelapse.reset()
        self.addCleanup(timelapse.reset)

    def test_the_unfinished_session_of_the_same_print_is_taken_up_again(self):
        session = timelapse.begin("p1", "a.gcode", "camera")
        timelapse.maybe_capture("p1", 10, b"frame", "jpg")
        timelapse._active.clear()                      # the new process knows nothing yet
        self.assertTrue(timelapse.resume("p1", "a.gcode"))
        self.assertEqual(timelapse._active["p1"]["session"], session)
        self.assertEqual(timelapse._active["p1"]["last_layer"], 10)    # not a frame again for the same layer

    def test_a_different_file_a_finished_print_or_no_session_is_not_resumed(self):
        timelapse.begin("p1", "a.gcode", "camera")
        timelapse._active.clear()
        self.assertFalse(timelapse.resume("p1", "b.gcode"))
        # Start the next part clean: two sessions begun in the same second are ordered by a random suffix, so the
        # unfinished one above could otherwise count as the newest and be resumed (the test failed about 3 runs in 8).
        timelapse.reset()
        timelapse.begin("p1", "a.gcode", "camera")
        timelapse.finish("p1")
        self.assertFalse(timelapse.resume("p1", "a.gcode"))
        self.assertFalse(timelapse.resume("never-used", "a.gcode"))

    def test_it_does_not_replace_a_session_that_is_already_recording(self):
        timelapse.begin("p1", "a.gcode", "camera")
        self.assertFalse(timelapse.resume("p1", "a.gcode"))


class ALinkOpenWhenTheComputerSleptIsOpenedAgain(unittest.TestCase):
    def test_sleeping_is_the_gap_between_the_wall_clock_and_the_running_clock(self):
        now, slept = mc._slept_between((100.0, 50.0), wall=lambda: 700.0, mono=lambda: 51.0)
        self.assertEqual(now, (700.0, 51.0))
        self.assertEqual(slept, 599.0)

    def test_an_ordinary_pause_is_not_sleep(self):
        _, slept = mc._slept_between((100.0, 50.0), wall=lambda: 102.0, mono=lambda: 52.0)
        self.assertEqual(slept, 0)
        _, slept = mc._slept_between((100.0, 50.0), wall=lambda: 95.0, mono=lambda: 52.0)    # the clock set back
        self.assertEqual(slept, 0)

    def test_it_is_a_dropped_link_not_a_printer_failure(self):
        self.assertTrue(issubclass(mc.ComputerWoke, mc.PrinterUnreachable))


class ThePrinterOnAnotherNetworkIsSaidInWords(unittest.TestCase):
    def test_other_network(self):
        hint = discovery.network_hint("http://10.0.0.5:7125", own=["192.168.1.20"])
        self.assertFalse(hint["same"])
        self.assertIn("10.0.0.5", hint["words"])
        self.assertIn("192.168.1.x", hint["words"])

    def test_same_network_a_name_and_a_public_address_say_nothing(self):
        self.assertIsNone(discovery.network_hint("192.168.1.50", own=["192.168.1.20"]))
        self.assertIsNone(discovery.network_hint("http://snapmaker.local:7125", own=["192.168.1.20"]))
        self.assertIsNone(discovery.network_hint("http://203.0.113.9:7125", own=["192.168.1.20"]))

    def test_a_computer_with_no_home_address_says_that_instead(self):
        hint = discovery.network_hint("192.168.1.50", own=[])
        self.assertIsNone(hint["same"])
        self.assertIn("no home-network address", hint["words"])

    def test_one_of_several_addresses_on_the_printers_network_is_enough(self):
        self.assertIsNone(discovery.network_hint("192.168.1.50", own=["10.8.0.2", "192.168.1.20"]))

    def test_the_ready_check_carries_the_hint_for_a_printer_that_does_not_answer(self):
        row = {"name": "Bench U1", "connected": False, "link": "Not connected: no answer",
               "network_hint": {"words": "The printer is at 10.0.0.5 and this computer is on 192.168.1.x."}}
        with mock.patch("fleet.registry", return_value={"printers": [row]}), \
                mock.patch("modules.is_enabled", return_value=True):
            checks = readiness._printers()
        self.assertIn("10.0.0.5", checks[0]["fix"])

    def test_the_ready_check_names_the_address_a_phone_opens(self):
        with mock.patch.object(discovery, "home_addresses", return_value=["192.168.1.20", "10.8.0.2"]):
            check = readiness._phone(8000)
        self.assertEqual(check["state"], "ok")
        self.assertIn("http://192.168.1.20:8000", check["detail"])
        self.assertIn("10.8.0.2", check["detail"])
        with mock.patch.object(discovery, "home_addresses", return_value=[]):
            self.assertEqual(readiness._phone(8000)["state"], "note")


class AStopOnPurposeEnds(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def test_it_holds_until_the_computer_restarts_or_the_hours_are_up(self):
        autostart.mark_stopped(self.dir.name)
        self.assertTrue(autostart.stopped_on_purpose(self.dir.name))
        later = time.time() + (autostart.STOP_HOURS + 1) * 3600
        with mock.patch.object(autostart.time, "time", return_value=later):
            # The running-time clock reads as if the computer had not restarted (Windows Fast Startup).
            with mock.patch.object(autostart, "_boot_time", return_value=0.0):
                self.assertFalse(autostart.stopped_on_purpose(self.dir.name))
        with mock.patch.object(autostart, "_boot_time", return_value=time.time() + 5):
            self.assertFalse(autostart.stopped_on_purpose(self.dir.name))     # the computer restarted since

    def test_the_status_read_for_a_page_never_waits_for_the_task_scheduler(self):
        autostart._cache.clear()
        release = threading.Event()

        def slow(args, timeout=20):
            release.wait(5)
            return 0, "Deja Vu1  Ready"
        env = {"APPDATA": self.dir.name}
        started = time.monotonic()
        first = autostart.status("win32", env, slow, wait=False)
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertFalse(first["on"])                  # not known yet; the file is the only thing seen so far
        release.set()
        deadline = time.monotonic() + 3
        while "task" not in autostart._cache and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(autostart.status("win32", env, slow, wait=False)["on"])
        autostart._cache.clear()


class TheLauncherChecksTheLightRouteFirst(unittest.TestCase):
    def setUp(self):
        import start
        self.start = start
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        patch = mock.patch.object(start, "DATA_DIR", self.dir.name)
        patch.start()
        self.addCleanup(patch.stop)

    def test_the_alive_route_is_asked_before_the_heavy_one(self):
        asked = []

        def local(path, body=None, timeout=2.0):
            asked.append(path)
            return 200, json.dumps({"version": "9.9.9", "server_pid": 1, "launch_id": "x"}).encode(), 3
        with mock.patch.object(self.start, "local", side_effect=local):
            found = self.start.info()
        self.assertEqual((asked, found["version"]), (["/api/app/alive"], "9.9.9"))

    def test_an_older_server_without_it_is_asked_the_long_way(self):
        asked = []

        def local(path, body=None, timeout=2.0):
            asked.append(path)
            if path == "/api/app/alive":
                raise HTTPError("http://x" + path, 404, "Not found", {}, None)
            return 200, json.dumps({"version": "0.19.0"}).encode(), 3
        with mock.patch.object(self.start, "local", side_effect=local):
            found = self.start.info()
        self.assertEqual((asked, found["version"]), (["/api/app/alive", "/api/app/info"], "0.19.0"))

    def test_nothing_listening_is_none(self):
        with mock.patch.object(self.start, "local", side_effect=ConnectionRefusedError()):
            self.assertIsNone(self.start.info())

    def test_a_second_launcher_waits_for_the_first_one_instead_of_starting_over_it(self):
        self.assertFalse(self.start.other_launcher_alive())
        with open(self.start.heartbeat_path(), "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid() + 1, "port": self.start.PORT, "at": time.time()}, f)
        self.assertTrue(self.start.other_launcher_alive())
        answers = iter([None, None, "0.21.0"])
        with mock.patch.object(self.start, "already_running", side_effect=lambda *a, **k: next(answers)), \
                mock.patch.object(self.start.time, "sleep"):
            self.assertEqual(self.start.wait_for_other_launcher(), "0.21.0")

    def test_an_old_note_a_note_for_another_port_and_our_own_note_do_not_count(self):
        def note(**changes):
            data = {"pid": os.getpid() + 1, "port": self.start.PORT, "at": time.time(), **changes}
            with open(self.start.heartbeat_path(), "w", encoding="utf-8") as f:
                json.dump(data, f)
            return self.start.other_launcher_alive()
        self.assertTrue(note())
        self.assertFalse(note(at=time.time() - self.start.HEARTBEAT_STALE - 5))
        self.assertFalse(note(port=self.start.PORT + 1))
        self.assertFalse(note(pid=os.getpid()))


class TheStatusAnswersWhileGitHubIsSlow(unittest.TestCase):
    """A hung update check held the lock that /api/app/info needs, so the dashboard looked stopped."""

    def setUp(self):
        app_updates._last = None
        self.addCleanup(setattr, app_updates, "_last", None)

    def test_status_and_job_answer_at_once_while_a_check_waits_for_github(self):
        gate, started = threading.Event(), threading.Event()

        def slow(url, limit, progress=None, **_):
            started.set()
            gate.wait(10)
            raise OSError("GitHub is slow")
        with mock.patch.object(app_updates, "_read_url", side_effect=slow), \
                mock.patch.object(app_updates, "install_kind", return_value="download"):
            checker = threading.Thread(target=app_updates.check, daemon=True)
            checker.start()
            self.assertTrue(started.wait(2))
            began = time.monotonic()
            app_updates.status()
            app_updates.job()
            app_updates.set_job("idle")
            self.assertLess(time.monotonic() - began, 0.5)
            gate.set()
            checker.join(5)
        self.assertFalse(checker.is_alive())

    def test_a_second_check_waits_for_the_first_and_reuses_its_answer(self):
        calls = []

        def answer(url, limit, progress=None, **_):
            calls.append(url)
            time.sleep(0.2)
            return json.dumps({"tag_name": "v0.0.1", "assets": []}).encode()
        with mock.patch.object(app_updates, "_read_url", side_effect=answer), \
                mock.patch.object(app_updates, "install_kind", return_value="download"):
            threads = [threading.Thread(target=app_updates.check, daemon=True) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(5)
        self.assertEqual(len(calls), 1)


class AStopFromAnUpdateBlockLeavesNoNote(unittest.TestCase):
    """The update blocks stop Deja Vu1 only to start it again. If one fails halfway (no internet, a locked file),
    a "stopped on purpose" note would keep the 5-minute check from starting it again."""

    def stop(self, body):
        import threading as threads
        import urllib.request
        import app as dv_app
        server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        thread = threads.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/api/app/stop",
                                         data=json.dumps(body).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
        with mock.patch.object(dv_app.autostart, "mark_stopped") as marked, \
                mock.patch.object(dv_app.threading, "Timer"):
            with urllib.request.urlopen(request, timeout=10) as response:
                self.assertEqual(json.loads(response.read()), {"stopping": True})
        return marked

    def test_settings_stop_leaves_the_note(self):
        self.stop({}).assert_called_once()

    def test_a_stop_for_an_update_does_not(self):
        self.stop({"for_update": True}).assert_not_called()

    def test_only_a_true_for_update_counts(self):
        self.stop({"for_update": "yes"}).assert_called_once()


if __name__ == "__main__":
    unittest.main()
