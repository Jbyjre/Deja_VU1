"""
start.py --background (the Start and Update blocks use it): Deja Vu1 starts
apart from the PowerShell or Terminal window, so closing that window doesn't
stop it (the owner, 1 November 2026: "make it so that isn't necessary").

    python3 -m unittest tests.test_background_start
"""

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent


def load_start():
    spec = importlib.util.spec_from_file_location("dv_start", ROOT / "start.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackgroundStart(unittest.TestCase):
    def setUp(self):
        self.start = load_start()
        self.start.DATA_DIR = tempfile.mkdtemp()
        self.start.START_WAIT = 2
        self.answers = iter([None, None, "0.14.0", "0.14.0", "0.14.0"])
        self.patches = [mock.patch.object(self.start, "already_running", side_effect=lambda: next(self.answers, "0.14.0")),
                        mock.patch.object(self.start, "show_ready"), mock.patch.object(self.start, "open_when_ready"),
                        mock.patch.object(self.start.time, "sleep"),
                        # The real one makes this test process's own output go through a thread.
                        mock.patch.object(self.start, "quiet_console"),
                        mock.patch.dict(os.environ, {"DEJAVU_NO_REGISTER": "1"})]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def run_it(self, os_name):
        with mock.patch.object(self.start.subprocess, "Popen") as popen, mock.patch.object(self.start.os, "name", os_name), \
                mock.patch.object(self.start.sys, "argv", ["start.py", "--background"]), \
                mock.patch.dict(os.environ, {"DEJAVU_NO_BROWSER": "1", "DEJAVU_NO_REGISTER": "1"}):
            code = self.start.start_in_background()
        return code, popen

    def test_mac_and_linux_start_it_in_a_session_of_its_own(self):
        code, popen = self.run_it("posix")
        self.assertEqual(code, 0)
        args, kwargs = popen.call_args
        self.assertTrue(args[0][-2].endswith("start.py"))
        self.assertEqual(args[0][-1], "--foreground")          # the launcher itself, in its own session
        self.assertTrue(kwargs["start_new_session"])         # closing Terminal sends no hang-up to it
        self.assertEqual(kwargs["env"]["DEJAVU_NO_BROWSER"], "1")
        self.assertEqual(kwargs["stdin"], self.start.subprocess.DEVNULL)

    def test_windows_starts_it_detached_with_no_console(self):
        code, popen = self.run_it("nt")
        self.assertEqual(code, 0)
        kwargs = popen.call_args[1]
        self.assertEqual(kwargs["creationflags"] & 0x00000008, 0x00000008)     # DETACHED_PROCESS
        self.assertNotIn("start_new_session", kwargs)

    def test_windows_leaves_the_windows_job_and_still_starts_where_a_job_forbids_that(self):
        calls = []

        def popen(command, **kwargs):
            calls.append(kwargs["creationflags"])
            if kwargs["creationflags"] & 0x01000000:
                raise PermissionError("Access is denied")
            return mock.Mock()
        with mock.patch.object(self.start.subprocess, "Popen", side_effect=popen), \
                mock.patch.object(self.start.os, "name", "nt"), \
                mock.patch.dict(os.environ, {"DEJAVU_NO_BROWSER": "1", "DEJAVU_NO_REGISTER": "1"}):
            self.assertEqual(self.start.start_in_background(), 0)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0] & 0x01000000)                  # CREATE_BREAKAWAY_FROM_JOB first
        self.assertFalse(calls[1] & 0x01000000)
        self.assertTrue(calls[1] & 0x08000000)                  # CREATE_NO_WINDOW either way

    def test_every_way_in_starts_it_apart_from_the_window(self):
        with mock.patch.object(self.start, "start_in_background", return_value=0) as bg, \
                mock.patch.object(self.start, "supervise", return_value=0) as sup:
            for args in ([], ["--background"], ["--background", "--autostart"], ["--from-link"]):
                self.start.main(args)
            self.assertEqual(bg.call_count, 4)
            sup.assert_not_called()
            self.start.main(["--foreground"])
            sup.assert_called_with()
            self.start.main(["--ensure"])
            sup.assert_called_with(ensure=True)

    def test_the_five_minute_check_leaves_a_stopped_copy_stopped(self):
        sys_path = str(ROOT / "backend")
        import sys
        sys.path.insert(0, sys_path)
        import autostart
        autostart.mark_stopped(self.start.DATA_DIR)
        self.assertEqual(self.start.supervise(ensure=True), 0)
        self.assertTrue(autostart.stopped_on_purpose(self.start.DATA_DIR))
        self.start.already_running.assert_not_called()

    def test_a_running_copy_is_only_checked(self):
        self.answers = iter(["0.14.0"] * 5)
        code, popen = self.run_it("posix")
        self.assertEqual(code, 0)
        popen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
