"""Deja Vu1 stops by itself when nobody uses it (backend/idle_stop.py), and a start by hand no longer switches on
starting with the computer (start.py).

In earlier versions one start by hand put Deja Vu1 in Windows' Task Scheduler for good: it started at sign-in, after every
wake and every 5 minutes, and closing its window never stopped it, so Python ran all day on a computer that had
not opened the dashboard since morning.
"""

import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, ROOT)
import idle_stop  # noqa: E402


class TestIdleStop(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"DEJAVU_BACKGROUND": "1"}, clear=False)
        self.env.start()
        os.environ.pop("DEJAVU_IDLE_MINUTES", None)
        self.idle = mock.patch.object(idle_stop, "busy", return_value=[])
        self.busy = self.idle.start()
        idle_stop._state.update({"last_page": 0.0, "sockets": 0, "since": 0.0, "stopping": False})

    def tearDown(self):
        mock.patch.stopall()
        self.env.stop()

    def test_stops_after_the_wait_with_no_page_and_nothing_under_way(self):
        idle_stop._state["since"] = 100.0                                    # the server started, or a page closed
        self.assertFalse(idle_stop.should_stop(now=100.0))
        self.assertFalse(idle_stop.should_stop(now=100.0 + 4 * 60))
        self.assertTrue(idle_stop.should_stop(now=100.0 + 5 * 60))

    def test_an_open_page_keeps_it_running(self):
        idle_stop.socket_opened()
        self.assertFalse(idle_stop.should_stop(now=10 ** 6))
        self.assertFalse(idle_stop.should_stop(now=10 ** 6 + 3600))
        idle_stop.socket_closed()
        # A closed page counts from when it closed, and the wait starts over.
        self.assertFalse(idle_stop.should_stop())

    def test_a_polling_page_counts_as_open(self):
        with mock.patch("idle_stop.time.monotonic", return_value=5000.0):
            idle_stop.page_seen()
        self.assertTrue(idle_stop.pages_open(now=5000.0 + idle_stop.PAGE_GRACE - 1))
        self.assertFalse(idle_stop.pages_open(now=5000.0 + idle_stop.PAGE_GRACE + 1))

    def test_a_job_under_way_keeps_it_running(self):
        self.busy.return_value = ["a print on 1 printer"]
        self.assertFalse(idle_stop.should_stop(now=100.0))
        self.assertFalse(idle_stop.should_stop(now=100.0 + 3600))
        self.busy.return_value = []
        self.assertFalse(idle_stop.should_stop(now=100.0 + 3600 + 60))      # the wait starts when the job ends
        self.assertTrue(idle_stop.should_stop(now=100.0 + 3600 + 60 + 5 * 60))

    def test_not_armed_only_when_started_by_hand(self):
        with mock.patch.dict(os.environ, {"DEJAVU_BACKGROUND": ""}):
            self.assertFalse(idle_stop.armed())
            self.assertFalse(idle_stop.should_stop(now=10 ** 7))
        with mock.patch.dict(os.environ, {"DEJAVU_IDLE_MINUTES": "0"}):
            self.assertFalse(idle_stop.armed())
        with mock.patch.dict(os.environ, {"DEJAVU_IDLE_MINUTES": "2"}):
            self.assertTrue(idle_stop.armed())
            self.assertEqual(idle_stop.minutes(), 2)

    def test_the_watcher_says_why_and_stops_the_server_once(self):
        stopped, said = [], []
        with mock.patch.object(idle_stop, "should_stop", return_value=True):
            idle_stop.watch(lambda: stopped.append(1), log=said.append, sleep=lambda s: None)
            idle_stop.watch(lambda: stopped.append(1), log=said.append, sleep=lambda s: None)
        self.assertEqual(stopped, [1])
        self.assertIn("Stopping by itself", said[0])

    def test_status_reads_in_words(self):
        s = idle_stop.status(now=100.0)
        self.assertTrue(s["armed"])
        self.assertEqual(s["minutes"], 5)
        self.assertIsInstance(s["busy"], list)


class TestBusyReadsTheRealJobs(unittest.TestCase):
    def test_nothing_under_way_on_a_fresh_server(self):
        self.assertEqual(idle_stop.busy(), [])

    def test_a_running_slice_counts(self):
        import slicer_bridge_part1
        with mock.patch.object(slicer_bridge_part1, "any_active", return_value=True):
            self.assertIn("a slice", idle_stop.busy())

    def test_a_check_that_fails_counts_as_busy(self):
        import slicer_bridge_part1
        with mock.patch.object(slicer_bridge_part1, "any_active", side_effect=RuntimeError("boom")):
            self.assertIn("a job whose state could not be read", idle_stop.busy())


class TestTheServerCountsPages(unittest.TestCase):
    def test_hooks_are_in_place(self):
        with open(os.path.join(ROOT, "backend", "app.py"), encoding="utf-8") as f:
            app = f.read()
        self.assertIn("idle_stop.socket_opened()", app)
        self.assertIn("idle_stop.socket_closed()", app)
        self.assertEqual(app.count("self._note_page()"), 2)                 # GET and POST
        self.assertIn("target=idle_stop.watch, args=(server.shutdown,)", app)


class TestAStartByHandLeavesTheComputerAlone(unittest.TestCase):
    """start.py never switches on starting with the computer, and takes away any entry an older version made."""

    def setUp(self):
        import importlib
        self.start = importlib.import_module("start")
        self.data = tempfile.mkdtemp()
        self.start.DATA_DIR = self.data

    def run_start(self, on):
        import autostart
        calls = []
        with mock.patch.dict(os.environ, {"DEJAVU_NO_BROWSER": "1"}), \
                mock.patch.dict(os.environ, {"DEJAVU_NO_REGISTER": ""}), \
                mock.patch.object(self.start, "already_running", return_value="0.21.0"), \
                mock.patch.object(self.start, "register_starters"), \
                mock.patch.object(self.start, "show_ready"), \
                mock.patch.object(self.start, "say", side_effect=calls.append), \
                mock.patch.object(autostart, "status", return_value={"on": on, "supported": True}), \
                mock.patch.object(autostart, "set_on", return_value={"on": False}) as set_on:
            self.start.start_in_background()
        return set_on, " ".join(calls)

    def test_never_switched_on_by_a_start(self):
        set_on, words = self.run_start(on=False)
        set_on.assert_not_called()
        self.assertIn("stops by itself", words)

    def test_an_entry_from_an_older_version_is_taken_away_even_one_the_owner_chose(self):
        # The owner asked on 24 November 2026 for the option to go: nothing of Deja Vu1 runs while unused. A choice
        # file an older version wrote ({"on": true}) makes no difference.
        with open(os.path.join(self.data, "autostart-choice.json"), "w") as f:
            f.write('{"on": true}')
        set_on, words = self.run_start(on=True)
        set_on.assert_called_once_with(False)
        self.assertIn("no longer starts with this computer", words)
        self.assertIn("stops by itself", words)

    def test_the_old_five_minute_check_starts_nothing(self):
        import autostart
        with mock.patch.object(autostart, "retire", return_value=True) as retire, \
                mock.patch.object(self.start, "already_running") as running, \
                mock.patch.object(self.start, "quiet_console"):
            self.assertEqual(self.start.supervise(ensure=True), 0)
        retire.assert_called_once()
        running.assert_not_called()


if __name__ == "__main__":
    unittest.main()
