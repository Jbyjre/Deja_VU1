"""Start with this computer: the one start-up file per system, written and removed."""

import configparser
import os
import plistlib
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import autostart  # noqa: E402

HERE = "/opt/Deja Vu1"
PY = "/usr/bin/python3"


class StartWithThisComputer(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.env = {"HOME": self.home.name, "APPDATA": os.path.join(self.home.name, "AppData", "Roaming")}

    def toggle(self, platform):
        off = autostart.status(platform, self.env)
        self.assertEqual((off["supported"], off["on"]), (True, False))
        on = autostart.set_on(True, platform, self.env, here=HERE, python=PY)
        self.assertTrue(on["on"])
        with open(on["where"], encoding="utf-8", newline="") as f:
            text = f.read()
        self.assertFalse(autostart.set_on(False, platform, self.env)["on"])
        self.assertFalse(os.path.exists(on["where"]))
        return on["where"], text

    def test_windows_startup_folder(self):
        where, text = self.toggle("win32")
        self.assertTrue(where.endswith(os.path.join("Start Menu", "Programs", "Startup", "Deja Vu1.cmd")))
        self.assertIn("set DEJAVU_NO_BROWSER=1\r\n", text)
        # In the background: no console window is left that closing would stop Deja Vu1.
        self.assertIn(f'"{HERE}{os.sep}start.py" --background', text)
        self.assertNotIn('start-windows.bat', text)

    def test_mac_launch_agent_is_a_valid_plist(self):
        where, text = self.toggle("darwin")
        self.assertTrue(where.endswith("Library/LaunchAgents/io.github.jbyjre.dejavu1.plist"))
        plist = plistlib.loads(text.encode())
        self.assertEqual(plist["ProgramArguments"], [PY, os.path.join(HERE, "start.py")])
        self.assertTrue(plist["RunAtLoad"])
        self.assertEqual(plist["EnvironmentVariables"], {"DEJAVU_NO_BROWSER": "1"})

    def test_linux_autostart_entry_quotes_paths_with_spaces(self):
        where, text = self.toggle("linux")
        self.assertTrue(where.endswith(".config/autostart/deja-vu1.desktop"))
        entry = configparser.ConfigParser(interpolation=None)
        entry.read_string(text)
        self.assertEqual(entry["Desktop Entry"]["Exec"],
                         f'env DEJAVU_NO_BROWSER=1 "{PY}" "{os.path.join(HERE, "start.py")}"')

    def test_an_unknown_system_says_so_and_writes_nothing(self):
        self.assertFalse(autostart.status("sunos5", self.env)["supported"])
        with self.assertRaisesRegex(ValueError, "isn't available"):
            autostart.set_on(True, "sunos5", self.env)


if __name__ == "__main__":
    unittest.main()
