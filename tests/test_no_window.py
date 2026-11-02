"""
Deja Vu1 with no window (the owner, 2 November 2026: a move or home command
"didn't go through", then a reload showed the page with the PowerShell code).

Started in the background on Windows (pythonw.exe, detached), Python has no
output streams. The server wrote a line per command to sys.stderr, so every
command's reply failed and the browser heard nothing. These tests start the
real server with its output streams closed, the nearest Linux has to that, and
check commands still get their answer. They also cover the offline page's
Start button (the deja-vu1:// link) and the page's calm reconnect.

    python3 -m unittest tests.test_no_window
"""

import configparser
import io
import json
import os
import plistlib
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import console  # noqa: E402
import launch_link  # noqa: E402


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@unittest.skipIf(os.name == "nt", "closing a child's output streams this way is POSIX-only")
class ServerWithoutStreams(unittest.TestCase):
    def test_commands_get_their_answer_and_the_messages_go_to_a_log_file(self):
        port = free_port()
        with tempfile.TemporaryDirectory() as data:
            env = dict(os.environ, PORT=str(port), DEJAVU_DATA_DIR=data, DEJAVU_NO_BROWSER="1")
            # stdin, stdout and stderr all closed: Python starts with sys.stdout and sys.stderr None.
            proc = subprocess.Popen([sys.executable, str(ROOT / "backend" / "app.py")], cwd=ROOT, env=env,
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    preexec_fn=lambda: [os.close(fd) for fd in (0, 1, 2)])
            try:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    try:
                        urlopen(f"http://127.0.0.1:{port}/api/app/info", timeout=1).read()
                        break
                    except OSError:
                        time.sleep(0.2)
                for _ in range(3):
                    req = Request(f"http://127.0.0.1:{port}/api/printer/control/jog?demo=1&printer=u1-workshop",
                                  data=json.dumps({"axis": "x", "distance": 1}).encode(),
                                  headers={"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{port}"})
                    try:
                        status, body = 200, urlopen(req, timeout=10).read()
                    except HTTPError as exc:
                        status, body = exc.code, exc.read()
                    # An answer in words, never a dropped connection (urlopen raises URLError for that).
                    self.assertIn(status, (200, 400, 409))
                    self.assertTrue(json.loads(body))
                time.sleep(0.5)
                log = Path(data, "logs", "server.log").read_text(encoding="utf-8")
                self.assertIn("Started without a window", log)
                self.assertIn("POST /api/printer/control/jog", log)
            finally:
                proc.terminate()
                proc.wait(timeout=10)


class ConsoleStreams(unittest.TestCase):
    def test_a_program_without_streams_gets_a_log_file(self):
        with tempfile.TemporaryDirectory() as data, mock.patch.object(sys, "stdout", None), \
                mock.patch.object(sys, "stderr", None):
            where = console.ensure_streams(data, "server")
            self.assertTrue(where.endswith(os.path.join("logs", "server.log")))
            print("hello from a windowless start")
            sys.stderr.write("and its errors\n")
            sys.stdout.close()
            text = Path(where).read_text(encoding="utf-8")
        self.assertIn("hello from a windowless start", text)
        self.assertIn("and its errors", text)

    def test_working_streams_are_left_alone(self):
        with tempfile.TemporaryDirectory() as data:
            self.assertIsNone(console.ensure_streams(data, "server"))
            self.assertFalse(os.path.exists(os.path.join(data, "logs")))

    def test_a_paused_window_never_holds_up_the_caller(self):
        # Windows Quick Edit: a click in the console window stops every write until a key is pressed.
        released = threading.Event()

        class Paused(io.StringIO):
            def write(self, text):
                released.wait(5)
                return super().write(text)
        target = Paused()
        stream = console._Buffered(target)
        started = time.monotonic()
        for i in range(200):
            stream.write(f"POST /api/printer/control/home {i}\n")
        self.assertLess(time.monotonic() - started, 0.5)
        released.set()
        stream.drain(5)
        self.assertEqual(target.getvalue().count("\n"), 200)

    def test_a_line_that_cannot_be_written_is_dropped_never_raised(self):
        class Broken:
            def write(self, text):
                raise OSError("the pipe is closed")
        console.write("anything\n", Broken())
        with mock.patch.object(sys, "stderr", None):
            console.write("anything\n")

    def test_quick_edit_is_only_touched_on_windows(self):
        if os.name != "nt":
            self.assertFalse(console.disable_quick_edit())


class StartLink(unittest.TestCase):
    HERE = "/opt/Deja Vu1"
    PY = "/usr/bin/python3"

    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.env = {"HOME": self.home.name}

    def test_linux_registers_the_link_and_keeps_other_defaults(self):
        mimeapps = Path(self.home.name, ".config", "mimeapps.list")
        mimeapps.parent.mkdir(parents=True)
        mimeapps.write_text("[Default Applications]\ntext/html=firefox.desktop\n"
                            "x-scheme-handler/deja-vu1=old.desktop\n[Added Associations]\nimage/png=eog.desktop\n")
        where = launch_link.register("linux", self.env, here=self.HERE, python=self.PY)
        entry = configparser.ConfigParser(interpolation=None)
        entry.read(where)
        e = entry["Desktop Entry"]
        self.assertEqual(e["MimeType"], "x-scheme-handler/deja-vu1;")
        self.assertEqual(e["Exec"], f'env DEJAVU_NO_BROWSER=1 "{self.PY}" "{self.HERE}/start.py" --from-link')
        self.assertNotIn("%u", e["Exec"].lower())          # the opened address never reaches the program
        text = mimeapps.read_text()
        self.assertIn("x-scheme-handler/deja-vu1=deja-vu1-link.desktop", text)
        self.assertNotIn("old.desktop", text)
        self.assertIn("text/html=firefox.desktop", text)
        self.assertIn("[Added Associations]\nimage/png=eog.desktop", text)
        launch_link.register("linux", self.env, here=self.HERE, python=self.PY)
        self.assertEqual(mimeapps.read_text().count("x-scheme-handler/deja-vu1="), 1)
        self.assertTrue(launch_link.status("linux", self.env)["on"])

    def test_windows_registers_for_this_user_without_passing_the_address(self):
        reg = FakeWinreg()
        launch_link.register("win32", self.env, here="C:\\Deja Vu1", python="C:\\Python\\python.exe", winreg=reg)
        self.assertEqual(reg.values[("Software\\Classes\\deja-vu1", "URL Protocol")], "")
        self.assertEqual(reg.values[("Software\\Classes\\deja-vu1", "")], "URL:Deja Vu1")
        command = reg.values[("Software\\Classes\\deja-vu1\\shell\\open\\command", "")]
        self.assertTrue(command.endswith('start.py" --from-link'))
        self.assertNotIn("%1", command)
        self.assertEqual(reg.roots, {"HKCU"})

    def test_mac_link_app_claims_the_link(self):
        where = launch_link.register("darwin", self.env, here=self.HERE, python=self.PY, run=lambda *a, **k: None)
        plist = plistlib.loads(Path(where, "Contents", "Info.plist").read_bytes())
        self.assertEqual(plist["CFBundleURLTypes"][0]["CFBundleURLSchemes"], ["deja-vu1"])
        script = Path(where, "Contents", "MacOS", "deja-vu1-link")
        self.assertTrue(os.access(script, os.X_OK))
        self.assertIn("--from-link", script.read_text())


class FakeWinreg:
    HKEY_CURRENT_USER = "HKCU"
    REG_SZ = 1

    def __init__(self):
        self.values, self.roots = {}, set()

    def CreateKey(self, parent, name):
        if parent == "HKCU":
            self.roots.add(parent)
            return name
        return parent + "\\" + name

    def SetValueEx(self, key, name, reserved, kind, value):
        self.values[(key, name)] = value


class OfflinePage(unittest.TestCase):
    page = (ROOT / "frontend" / "offline.html").read_text(encoding="utf-8")
    worker = (ROOT / "frontend" / "sw.js").read_text(encoding="utf-8")

    def test_it_reconnects_first_and_offers_the_start_link_only_after(self):
        self.assertIn("Reconnecting to Deja Vu1", self.page)
        self.assertIn("deja-vu1://start", self.page)
        self.assertRegex(self.page, r"<div id=\"start\" hidden>")
        self.assertNotIn("Closing it stops the dashboard", self.page)

    def test_the_service_worker_asks_again_before_showing_it_and_stores_a_fresh_copy(self):
        self.assertIn("cache: 'reload'", self.worker)
        self.assertRegex(self.worker, r"attempt < \d+")
        version = re.search(r"OFFLINE_CACHE = 'dejavu-offline-v(\d+)'", self.worker)
        self.assertGreaterEqual(int(version.group(1)), 6)


if __name__ == "__main__":
    unittest.main()
