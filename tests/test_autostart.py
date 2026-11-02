"""Start with this computer: the one start-up file per system, written and removed."""

import configparser
import os
import plistlib
import sys
import tempfile
import time
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import autostart  # noqa: E402

HERE = "/opt/Deja Vu1"
PY = "/usr/bin/python3"


class FakeSchtasks:
    """schtasks.exe as far as autostart uses it: /Create /XML, /Query, /Delete."""

    def __init__(self, refuse=False):
        self.refuse, self.calls, self.xml, self.made = refuse, [], None, False

    def __call__(self, args, timeout=20):
        self.calls.append(list(args))
        if args[0] == "/Create":
            if self.refuse:
                return 1, "ERROR: Access is denied."
            with open(args[args.index("/XML") + 1], encoding="utf-16") as f:
                self.xml = f.read()
            self.made = True
            return 0, "SUCCESS"
        if args[0] == "/Query":
            return (0, "Deja Vu1  Ready") if self.made else (1, "ERROR: The system cannot find the file specified.")
        if args[0] == "/Delete":
            self.made = False
            return 0, "SUCCESS"
        return 1, "unknown"


class StartWithThisComputer(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.env = {"HOME": self.home.name, "APPDATA": os.path.join(self.home.name, "AppData", "Roaming")}

    def toggle(self, platform, run=None):
        autostart._cache.clear()
        off = autostart.status(platform, self.env, run=run)
        self.assertEqual((off["supported"], off["on"]), (True, False))
        on = autostart.set_on(True, platform, self.env, here=HERE, python=PY, run=run)
        self.assertTrue(on["on"])
        with open(on["where"], encoding="utf-8", newline="") as f:
            text = f.read()
        self.assertFalse(autostart.set_on(False, platform, self.env, run=run)["on"])
        self.assertFalse(os.path.exists(on["where"]))
        return on, text

    def test_windows_falls_back_to_the_startup_folder_when_task_scheduler_refuses(self):
        refused = FakeSchtasks(refuse=True)
        on, text = self.toggle("win32", refused)
        self.assertTrue(on["where"].endswith(os.path.join("Start Menu", "Programs", "Startup", "Deja Vu1.cmd")))
        self.assertIn("Task Scheduler refused (ERROR: Access is denied.)", on["note"])
        self.assertIn("set DEJAVU_NO_BROWSER=1\r\n", text)
        # In the background: no console window is left that closing would stop Deja Vu1.
        self.assertIn(f'"{HERE}{os.sep}start.py" --ensure', text)
        self.assertNotIn('start-windows.bat', text)

    def test_windows_uses_a_task_scheduler_task_for_this_user_only(self):
        tasks = FakeSchtasks()
        env = dict(self.env, USERNAME="maker", USERDOMAIN="WORKSHOP-PC")
        # A Startup-folder file from 0.14 is replaced by the task, so it never starts twice.
        old = autostart.path("win32", env)
        os.makedirs(os.path.dirname(old))
        open(old, "w").close()
        autostart._cache.clear()
        on = autostart.refresh("win32", env, here=HERE, python=PY, run=tasks)
        self.assertEqual((on["on"], on["how"], on["keeps_running"]), (True, "task", True))
        self.assertFalse(os.path.exists(old))
        create = [c for c in tasks.calls if c[0] == "/Create"][0]
        self.assertEqual(create[:3], ["/Create", "/TN", "Deja Vu1"])
        self.assertIn("/F", create)
        root = ET.fromstring(tasks.xml.encode("utf-16"))
        ns = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}
        self.assertEqual(root.find("t:Principals/t:Principal/t:UserId", ns).text, "WORKSHOP-PC\\maker")
        self.assertEqual(root.find("t:Principals/t:Principal/t:RunLevel", ns).text, "LeastPrivilege")
        self.assertEqual(root.find("t:Triggers/t:LogonTrigger/t:UserId", ns).text, "WORKSHOP-PC\\maker")
        self.assertEqual(root.find("t:Triggers/t:TimeTrigger/t:Repetition/t:Interval", ns).text, "PT5M")
        self.assertIn("Power-Troubleshooter", root.find("t:Triggers/t:EventTrigger/t:Subscription", ns).text)
        settings = root.find("t:Settings", ns)
        for name, value in (("MultipleInstancesPolicy", "IgnoreNew"), ("DisallowStartIfOnBatteries", "false"),
                            ("StopIfGoingOnBatteries", "false"), ("ExecutionTimeLimit", "PT0S")):
            self.assertEqual(settings.find("t:" + name, ns).text, value)
        action = root.find("t:Actions/t:Exec", ns)
        self.assertEqual(action.find("t:Arguments", ns).text, f'"{os.path.join(HERE, "start.py")}" --ensure')
        self.assertEqual(action.find("t:WorkingDirectory", ns).text, HERE)
        self.assertFalse(autostart.set_on(False, "win32", env, run=tasks)["on"])
        self.assertEqual(tasks.calls[-2][:3], ["/Delete", "/TN", "Deja Vu1"])

    def test_the_task_answer_is_kept_a_minute_because_the_page_asks_every_few_seconds(self):
        tasks = FakeSchtasks()
        autostart._cache.clear()
        for _ in range(5):
            autostart.status("win32", self.env, run=tasks)
        self.assertEqual(len(tasks.calls), 1)

    def test_stopped_on_purpose_lasts_until_started_again_or_the_computer_restarts(self):
        data = self.home.name
        self.assertFalse(autostart.stopped_on_purpose(data))
        autostart.mark_stopped(data)
        self.assertTrue(autostart.stopped_on_purpose(data))
        autostart.clear_stopped(data)
        self.assertFalse(autostart.stopped_on_purpose(data))
        autostart.mark_stopped(data)
        real = autostart._boot_time
        autostart._boot_time = lambda: time.time() + 1      # the computer started after the note
        self.addCleanup(setattr, autostart, "_boot_time", real)
        self.assertFalse(autostart.stopped_on_purpose(data))

    def test_switching_it_off_in_settings_is_remembered(self):
        data = self.home.name
        self.assertFalse(autostart.chosen_off(data))
        autostart.remember_choice(data, False)
        self.assertTrue(autostart.chosen_off(data))
        autostart.remember_choice(data, True)
        self.assertFalse(autostart.chosen_off(data))

    def test_mac_launch_agent_is_a_valid_plist(self):
        on, text = self.toggle("darwin")
        self.assertTrue(on["where"].endswith("Library/LaunchAgents/io.github.jbyjre.dejavu1.plist"))
        plist = plistlib.loads(text.encode())
        self.assertEqual(plist["ProgramArguments"], [PY, os.path.join(HERE, "start.py"), "--ensure"])
        self.assertTrue(plist["RunAtLoad"])
        self.assertEqual(plist["KeepAlive"], {"SuccessfulExit": False})   # macOS restarts it after an error
        self.assertEqual(plist["EnvironmentVariables"], {"DEJAVU_NO_BROWSER": "1"})

    def test_linux_autostart_entry_quotes_paths_with_spaces(self):
        on, text = self.toggle("linux")
        self.assertTrue(on["where"].endswith(".config/autostart/deja-vu1.desktop"))
        entry = configparser.ConfigParser(interpolation=None)
        entry.read_string(text)
        self.assertEqual(entry["Desktop Entry"]["Exec"],
                         f'env DEJAVU_NO_BROWSER=1 "{PY}" "{os.path.join(HERE, "start.py")}" --ensure')

    def test_an_unknown_system_says_so_and_writes_nothing(self):
        self.assertFalse(autostart.status("sunos5", self.env)["supported"])
        with self.assertRaisesRegex(ValueError, "isn't available"):
            autostart.set_on(True, "sunos5", self.env)


if __name__ == "__main__":
    unittest.main()
