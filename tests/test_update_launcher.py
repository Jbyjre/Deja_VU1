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
                for name in ('app_updates.py', 'storage.py'):
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
                env = dict(os.environ, PORT=str(port), DEJAVU_NO_BROWSER='1',
                           DEJAVU_DATA_DIR=str(root / 'backend/data'))
                with tempfile.TemporaryFile() as output:
                    proc = subprocess.Popen([sys.executable, 'start.py'], cwd=root, env=env,
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
                    finally:
                        if proc.poll() is None:
                            os.killpg(proc.pid, signal.SIGINT)
                            try:
                                proc.wait(8)
                            except subprocess.TimeoutExpired:
                                os.killpg(proc.pid, signal.SIGKILL)
                                proc.wait(5)
