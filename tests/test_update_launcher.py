"""Exercise real child startup and rollback in disposable installations."""
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
LAUNCHER_FILES = ('app_updates.py', 'storage.py', 'readiness.py', 'paste_blocks.py', 'console.py', 'autostart.py',
                  'launch_link.py')
SERVER = '''
import json, os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"version": Path("VERSION").read_text().strip(),
                                    "server_pid": os.getpid()}).encode())
HTTPServer(("127.0.0.1", int(os.environ["PORT"])), Handler).serve_forever()
'''


@unittest.skipIf(os.name == 'nt', 'POSIX process cleanup; Windows launcher needs a Windows check')
class LauncherProcesses(unittest.TestCase):
    def test_real_restart_and_failed_release_rollback(self):
        for broken in (False, True):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / 'backend/data').mkdir(parents=True)
                (root / 'backend/data/private.json').write_text('keep me')
                shutil.copy2(ROOT / 'start.py', root / 'start.py')
                for name in LAUNCHER_FILES:
                    shutil.copy2(ROOT / 'backend' / name, root / 'backend' / name)
                (root / 'VERSION').write_text('0.1.0')
                (root / 'backend/app.py').write_text(SERVER)
                stage = root / '.dejavu-update/stage'
                (stage / 'backend').mkdir(parents=True)
                (stage / 'VERSION').write_text('0.2.0')
                (stage / 'backend/app.py').write_text('raise RuntimeError("broken release")' if broken else SERVER)
                (stage.parent / 'pending.json').write_text(json.dumps({
                    'version': '0.2.0', 'files': ['VERSION', 'backend/app.py']}))
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', 0))
                    port = probe.getsockname()[1]
                env = dict(os.environ, PORT=str(port), DEJAVU_NO_BROWSER='1', DEJAVU_NO_REGISTER='1',
                           DEJAVU_DATA_DIR=str(root / 'backend/data'))
                with tempfile.TemporaryFile() as output:
                    proc = subprocess.Popen([sys.executable, 'start.py', '--foreground'], cwd=root, env=env,
                                            stdout=output, stderr=output, start_new_session=True)
                    try:
                        expected = '0.1.0' if broken else '0.2.0'
                        deadline = time.monotonic() + 15
                        actual = None
                        while time.monotonic() < deadline:
                            if proc.poll() is not None:
                                break
                            try:
                                with urlopen(f'http://127.0.0.1:{port}/api/app/info', timeout=.3) as r:
                                    actual = json.load(r)['version']
                                if actual == expected and not stage.parent.exists():
                                    break
                            except (OSError, ValueError):
                                pass
                            time.sleep(.1)
                        self.assertEqual(actual, expected)
                        self.assertFalse(stage.parent.exists())
                        self.assertEqual((root / 'backend/data/private.json').read_text(), 'keep me')
                        # The outcome is noted for the dashboard, with the reason when it was undone.
                        result = json.loads((root / 'backend/data/update-result.json').read_text())
                        self.assertEqual(result['ok'], not broken)
                        if broken:
                            self.assertIn('did not start', result['message'])
                        self.assertIn('Updated from' if not broken else 'put back',
                                      (root / 'backend/data/logs/launcher.log').read_text())
                    finally:
                        if proc.poll() is None:
                            os.killpg(proc.pid, signal.SIGINT)
                            try:
                                proc.wait(8)
                            except subprocess.TimeoutExpired:
                                os.killpg(proc.pid, signal.SIGKILL)
                                proc.wait(5)


CRASH_ONCE = '''
from pathlib import Path
marker = Path("crashed-once")
if not marker.exists():
    marker.write_text("1")
    raise RuntimeError("a crash on the first start")
''' + SERVER


@unittest.skipIf(os.name == 'nt', 'POSIX process cleanup; Windows launcher needs a Windows check')
class LauncherRestartsAfterACrash(unittest.TestCase):
    def test_a_crashed_server_is_started_again(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'backend/data').mkdir(parents=True)
            shutil.copy2(ROOT / 'start.py', root / 'start.py')
            for name in LAUNCHER_FILES:
                shutil.copy2(ROOT / 'backend' / name, root / 'backend' / name)
            (root / 'VERSION').write_text('0.1.0')
            (root / 'backend/app.py').write_text(CRASH_ONCE)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            env = dict(os.environ, PORT=str(port), DEJAVU_NO_BROWSER='1', DEJAVU_NO_REGISTER='1', DEJAVU_DATA_DIR=str(root / 'backend/data'))
            with tempfile.TemporaryFile() as output:
                proc = subprocess.Popen([sys.executable, 'start.py', '--foreground'], cwd=root, env=env,
                                        stdout=output, stderr=output, start_new_session=True)
                try:
                    answered = None
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline and proc.poll() is None:
                        try:
                            with urlopen(f'http://127.0.0.1:{port}/api/app/info', timeout=.3) as r:
                                answered = json.load(r)['version']
                            break
                        except (OSError, ValueError):
                            time.sleep(.1)
                    self.assertEqual(answered, '0.1.0')
                    self.assertTrue((root / 'crashed-once').exists())
                    output.seek(0)
                    self.assertIn(b'Starting it again', output.read())
                finally:
                    if proc.poll() is None:
                        os.killpg(proc.pid, signal.SIGINT)
                        try:
                            proc.wait(8)
                        except subprocess.TimeoutExpired:
                            os.killpg(proc.pid, signal.SIGKILL)
                            proc.wait(5)


LAUNCH_ID_SERVER = SERVER.replace('"server_pid": os.getpid()', '"server_pid": -1, "launch_id": os.environ.get("DEJAVU_LAUNCH_ID")')


def _start(root, port):
    env = dict(os.environ, PORT=str(port), DEJAVU_NO_BROWSER='1', DEJAVU_NO_REGISTER='1', DEJAVU_DATA_DIR=str(root / 'backend/data'))
    output = tempfile.TemporaryFile()
    proc = subprocess.Popen([sys.executable, 'start.py', '--foreground'], cwd=root, env=env, stdout=output, stderr=output,
                            start_new_session=True)
    return proc, output


def _stop(proc):
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGINT)
        try:
            proc.wait(8)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(5)


def _answer(port, proc, want, seconds=20):
    deadline = time.monotonic() + seconds
    found = None
    while time.monotonic() < deadline and proc.poll() is None:
        try:
            with urlopen(f'http://127.0.0.1:{port}/api/app/info', timeout=.3) as r:
                found = json.load(r)['version']
            if found == want:
                return found
        except (OSError, ValueError):
            pass
        time.sleep(.1)
    return found


def _install(folder, server, version='0.1.0'):
    root = Path(folder)
    (root / 'backend/data').mkdir(parents=True)
    shutil.copy2(ROOT / 'start.py', root / 'start.py')
    for name in LAUNCHER_FILES:
        shutil.copy2(ROOT / 'backend' / name, root / 'backend' / name)
    (root / 'VERSION').write_text(version)
    (root / 'backend/app.py').write_text(server)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    return root, port


@unittest.skipIf(os.name == 'nt', 'POSIX process cleanup; Windows launcher needs a Windows check')
class LauncherNeverLeavesTheDashboardDown(unittest.TestCase):
    def test_an_update_that_cannot_be_applied_still_starts_the_dashboard(self):
        # Before 0.13.7 any error while applying an update ended the launcher, and with it the server.
        with tempfile.TemporaryDirectory() as folder:
            root, port = _install(folder, SERVER)
            (root / '.dejavu-update').mkdir()
            (root / '.dejavu-update/pending.json').write_text(json.dumps({'version': '0.2.0', 'files': ['../outside']}))
            proc, output = _start(root, port)
            try:
                self.assertEqual(_answer(port, proc, '0.1.0'), '0.1.0')
                output.seek(0)
                self.assertIn(b'The update could not be finished', output.read())
                result = json.loads((root / 'backend/data/update-result.json').read_text())
                self.assertFalse(result['ok'])
                self.assertIn('Invalid update recovery plan', result['message'])
            finally:
                _stop(proc)
                output.close()

    def test_the_launch_id_proves_the_new_server_when_process_numbers_differ(self):
        # Python started through a redirector (a Windows venv) runs the server under another process number.
        with tempfile.TemporaryDirectory() as folder:
            root, port = _install(folder, LAUNCH_ID_SERVER)
            stage = root / '.dejavu-update/stage'
            (stage / 'backend').mkdir(parents=True)
            (stage / 'VERSION').write_text('0.2.0')
            (stage / 'backend/app.py').write_text(LAUNCH_ID_SERVER)
            (stage.parent / 'pending.json').write_text(json.dumps({'version': '0.2.0',
                                                                   'files': ['VERSION', 'backend/app.py']}))
            proc, output = _start(root, port)
            try:
                self.assertEqual(_answer(port, proc, '0.2.0'), '0.2.0')
                deadline = time.monotonic() + 10
                while stage.parent.exists() and time.monotonic() < deadline:
                    time.sleep(.1)
                self.assertFalse(stage.parent.exists())
                self.assertTrue(json.loads((root / 'backend/data/update-result.json').read_text())['ok'])
            finally:
                _stop(proc)
                output.close()

    def test_check_only_says_when_nothing_is_running_and_gives_the_start_block(self):
        with tempfile.TemporaryDirectory() as folder:
            root, port = _install(folder, SERVER)
            env = dict(os.environ, PORT=str(port), PYTHONIOENCODING='utf-8', DEJAVU_DATA_DIR=str(root / 'backend/data'))
            done = subprocess.run([sys.executable, 'start.py', '--check'], cwd=root, env=env, capture_output=True,
                                  timeout=30)
            self.assertEqual(done.returncode, 1)
            text = done.stdout.decode('utf-8')
            self.assertIn("isn't running", text)
            self.assertIn('python3 start.py', text)          # the Start and check block for this computer

