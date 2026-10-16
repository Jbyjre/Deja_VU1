"""
Races that only show up once commands take real time - a real printer's
upload and start take seconds, not the simulation's microseconds. Each test
makes the printer slow on purpose and runs the competing requests on real
threads, the way two phones and a laptop would.
"""

import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import file_library     # noqa: E402
import fleet            # noqa: E402
import live_feed        # noqa: E402
import maintenance      # noqa: E402
import mock_moonraker   # noqa: E402
import modules          # noqa: E402
import print_queue      # noqa: E402
import printer_control  # noqa: E402

CUBE = "calibration_cube_20mm.gcode"


class SlowPrinter(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        file_library.reset()
        file_library.add_samples()
        print_queue.reset()
        maintenance.reset_all_logs()
        for pid in ("u1-workshop", "u1-studio"):
            with mock_moonraker.use_printer(pid):
                for task in maintenance.TASKS:
                    maintenance.mark_done(task["id"])
                mock_moonraker.cancel_print()
        real_upload = mock_moonraker.upload_file

        def slow_upload(*args, **kwargs):
            time.sleep(1.0)                       # a real upload over Wi-Fi
            return real_upload(*args, **kwargs)
        mock_moonraker.upload_file = slow_upload
        self.addCleanup(lambda: setattr(mock_moonraker, "upload_file", real_upload))

    def tearDown(self):
        mock_moonraker.reset_all()
        file_library.reset()
        print_queue.reset()
        maintenance.reset_all_logs()

    def run_together(self, *fns):
        results = [None] * len(fns)

        def run(i, fn):
            try:
                results[i] = fn()
            except Exception as exc:             # noqa: BLE001 - the test inspects it
                results[i] = exc
        threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(fns)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(10)
        return results


class TestQueue(SlowPrinter):
    def test_a_slow_start_doesnt_freeze_every_other_queue(self):
        print_queue.add(CUBE, printer_id="u1-workshop")
        worker = threading.Thread(target=lambda: print_queue.start_next("u1-workshop"))
        worker.start()
        time.sleep(0.2)                            # the start is now uploading
        began = time.monotonic()
        print_queue.add(CUBE, printer_id="u1-studio")
        print_queue.get("u1-studio")
        print_queue.get("u1-workshop")
        self.assertLess(time.monotonic() - began, 0.5)     # before: waited out the whole upload
        self.assertEqual(print_queue.get("u1-workshop")["items"][0]["status"], "starting")
        worker.join(5)
        self.assertEqual(print_queue.get("u1-workshop")["items"][0]["status"], "started")

    def test_two_devices_pressing_start_next_start_one_print(self):
        print_queue.add(CUBE, printer_id="u1-workshop")
        print_queue.add(CUBE, printer_id="u1-workshop")
        a, b = self.run_together(lambda: print_queue.start_next("u1-workshop"),
                                 lambda: (time.sleep(0.1), print_queue.start_next("u1-workshop"))[1])
        outcomes = sorted(k for r in (a, b) for k in ("started", "busy") if k in r)
        self.assertEqual(outcomes, ["busy", "started"])
        items = print_queue.get("u1-workshop")["items"]
        self.assertEqual([i["status"] for i in items], ["started", "queued"])   # the second one still waits

    def test_an_item_being_started_cant_be_removed_or_moved(self):
        print_queue.add(CUBE, printer_id="u1-workshop")
        worker = threading.Thread(target=lambda: print_queue.start_next("u1-workshop"))
        worker.start()
        time.sleep(0.2)
        item = print_queue.get("u1-workshop")["items"][0]
        with self.assertRaises(ValueError):
            print_queue.remove(item["id"], printer_id="u1-workshop")
        with self.assertRaises(ValueError):
            fleet.route_file(None, "u1-studio", "u1-workshop", item["id"])
        worker.join(5)
        self.assertEqual(print_queue.get("u1-studio")["items"], [])        # never on both queues

    def test_a_move_is_all_or_nothing(self):
        item = print_queue.add(CUBE, printer_id="u1-workshop")["items"][0]
        for _ in range(print_queue.MAX_ITEMS):
            print_queue.add(CUBE, printer_id="u1-studio")
        with self.assertRaises(ValueError):                 # the target is full
            fleet.route_file(None, "u1-studio", "u1-workshop", item["id"])
        self.assertEqual(len(print_queue.get("u1-workshop")["items"]), 1)   # still where it was


class TestManualStart(SlowPrinter):
    def test_two_devices_pressing_start_get_one_print_and_one_clear_no(self):
        def start():
            with mock_moonraker.use_printer("u1-workshop"):
                return printer_control.start_print(CUBE, confirmed=True)
        a, b = self.run_together(start, lambda: (time.sleep(0.1), start())[1])
        self.assertIsInstance(a, dict)
        self.assertIsInstance(b, ValueError)
        self.assertIn("being started", str(b))


class TestSettingsAndFeed(unittest.TestCase):
    def tearDown(self):
        modules.reset_state()
        mock_moonraker.reset_all()

    def test_switching_many_modules_at_once_keeps_every_change(self):
        ids = [m["id"] for m in modules.REGISTRY][:12]
        threads = [threading.Thread(target=modules.set_enabled, args=(m, False)) for m in ids]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
        self.assertTrue(all(not modules.is_enabled(m) for m in ids))       # before: some were lost

    def test_the_live_feed_survives_commands_from_every_side(self):
        mock_moonraker.reset_all()
        live_feed.reset()
        errors, stop = [], threading.Event()

        def feed():
            n = 0
            while not stop.is_set():
                try:
                    live_feed.tick(0.25, n)
                except Exception as exc:          # noqa: BLE001
                    errors.append(exc)
                n += 1

        def commander():
            for _ in range(15):
                for action in ("pause", "resume"):
                    fleet.broadcast(action, ["u1-workshop", "u1-studio"])

        t = threading.Thread(target=feed)
        t.start()
        workers = [threading.Thread(target=commander) for _ in range(3)]
        for w in workers:
            w.start()
        for w in workers:
            w.join(20)
        stop.set()
        t.join(5)
        self.assertEqual(errors, [])
        for pid in ("u1-workshop", "u1-studio"):
            self.assertIn(live_feed.snapshot(pid)["state"]["state"], ("printing", "paused"))


if __name__ == "__main__":
    unittest.main()
