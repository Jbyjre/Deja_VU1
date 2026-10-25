"""
Start Deja Vu1 and open it in your browser.

Double-click start-windows.bat (Windows), start-mac.command (macOS) or
start-linux.sh (Linux), or run:  python3 start.py
Close the window (or press Ctrl+C) to stop it.

Settings -> Desktop app chooses whether it opens in a browser tab or in its
own app window (Microsoft Edge or Google Chrome, no tabs or address bar).
DEJAVU_WINDOW=browser|window|none overrides that for one start.
"""
import os
import subprocess
import json
from urllib.request import urlopen
import socket
import sys
import threading
import time

if sys.version_info < (3, 8):
    sys.exit("Deja Vu1 needs Python 3.8 or newer - get it from https://www.python.org/downloads/")

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8000))


def open_when_ready():
    """Open the dashboard once it answers, not before: a tab or its own app window."""
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    else:
        return
    import desktop
    opened = desktop.open_dashboard(f"http://localhost:{PORT}")
    if opened == "window":
        print("Deja Vu1 opened in its own app window. Keep this window open; closing it stops the dashboard.", flush=True)


def already_running():
    """The version of a Deja Vu1 that already answers on this port, or None."""
    try:
        with urlopen(f"http://127.0.0.1:{PORT}/api/app/info", timeout=1) as response:
            return json.load(response).get("version") or "unknown"
    except (OSError, ValueError, AttributeError):
        return None


def supervise():
    """Keep one server process; install only after that process has stopped."""
    sys.path.insert(0, os.path.join(HERE, "backend"))
    running = already_running()
    if running:
        # A second launcher can't take the port; open the one that is running instead.
        print(f"Deja Vu1 {running} is already running at http://localhost:{PORT}. Opening it.", flush=True)
        print("To start this copy instead, close the other Deja Vu1 window first.", flush=True)
        open_when_ready()
        return 0
    import app_updates
    env = dict(os.environ, DEJAVU_LAUNCHER="1")
    env.setdefault("DEJAVU_DATA_DIR", os.path.join(HERE, "backend", "data"))
    child = None
    opened = False

    def launch():
        return subprocess.Popen([sys.executable, os.path.join(HERE, "backend", "app.py")],
                                cwd=HERE, env=env)

    def healthy(expected):
        nonlocal child
        child = launch()
        for _ in range(100):
            if child.poll() is not None:
                return False
            try:
                with urlopen(f"http://127.0.0.1:{PORT}/api/app/info", timeout=0.5) as response:
                    info = json.load(response)
                    if info.get("version") == expected and info.get("server_pid") == child.pid:
                        return True
            except (OSError, ValueError, AttributeError):
                pass
            time.sleep(0.2)
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        return False

    try:
        while True:
            result = app_updates.apply_pending(HERE, healthy)
            if result is False:
                print("The update could not start. Your previous version has been restored.", flush=True)
            if child is None or child.poll() is not None:
                child = launch()
            if not opened:
                # Once per launch: after an update restart the open page reloads itself.
                opened = True
                threading.Thread(target=open_when_ready, daemon=True).start()
            code = child.wait()
            child = None
            if code != 75:
                return code
    finally:
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    try:
        sys.exit(supervise())
    except KeyboardInterrupt:
        print("Stopped.")
