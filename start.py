"""
Start Deja Vu1 and open it in your browser.

Double-click start-windows.bat (Windows), start-mac.command (macOS) or
start-linux.sh (Linux), or run:  python3 start.py
Close the window (or press Ctrl+C) to stop it.
"""
import os
import runpy
import socket
import sys
import threading
import time
import webbrowser

if sys.version_info < (3, 8):
    sys.exit("Deja Vu1 needs Python 3.8 or newer - get it from https://www.python.org/downloads/")

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8000))


def open_when_ready():
    """Open the browser once the dashboard answers, not before."""
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    else:
        return
    if os.environ.get("DEJAVU_NO_BROWSER") != "1":
        webbrowser.open(f"http://localhost:{PORT}")


if __name__ == "__main__":
    os.chdir(HERE)
    threading.Thread(target=open_when_ready, daemon=True).start()
    runpy.run_path(os.path.join(HERE, "backend", "app.py"), run_name="__main__")
