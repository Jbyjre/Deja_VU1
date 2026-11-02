"""
Start Deja Vu1 and open it in your browser.

Double-click start-windows.bat (Windows), start-mac.command (macOS) or
start-linux.sh (Linux), or run:  python3 start.py
Close the window (or press Ctrl+C) to stop it.

  python3 start.py --background   starts it apart from this window, so it keeps
                                  running after the window closes (the Start
                                  blocks use this); --autostart also starts it
                                  at every sign-in (Settings -> Desktop app)

Once the dashboard answers, this window shows whether Deja Vu1 is ready and
fully working, or what is wrong and which block to paste next. If Deja Vu1 is
already running, it shows that check for the running copy and opens it.
  python3 start.py --check   only checks a running copy (starts nothing)

Settings -> Desktop app chooses whether it opens in a browser tab or in its
own app window (Microsoft Edge or Google Chrome, no tabs or address bar).
DEJAVU_WINDOW=browser|window|none overrides that for one start.
"""
import os
import subprocess
import json
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
import socket
import sys
import threading
import time
import uuid

if sys.version_info < (3, 8):
    sys.exit("Deja Vu1 needs Python 3.8 or newer - get it from https://www.python.org/downloads/")

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8000))
PORT_IN_USE = 3                # backend/app.py exits with this when the port is taken
CRASH_LIMIT = 5                # restarts after a crash allowed within CRASH_WINDOW seconds
CRASH_WINDOW = 600
START_WAIT = 90                # seconds a new version gets to answer before the old one is put back
LOG_LIMIT = 256 * 1024
# Checks of this computer's own address never go through a proxy set for the internet.
_LOCAL = build_opener(ProxyHandler({}))
DATA_DIR = os.environ.get("DEJAVU_DATA_DIR") or os.path.join(HERE, "backend", "data")


def say(message):
    print(message, flush=True)
    log(message)


def log(message):
    """A dated line in <data>/logs/launcher.log, so what happened during an update can be read later."""
    try:
        folder = os.path.join(DATA_DIR, "logs")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "launcher.log")
        if os.path.exists(path) and os.path.getsize(path) > LOG_LIMIT:
            with open(path, "rb") as f:
                f.seek(-LOG_LIMIT // 2, os.SEEK_END)
                tail = f.read()
            with open(path, "wb") as f:
                f.write(tail)
        with open(path, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + message.strip() + "\n")
    except OSError:
        pass                     # the log is a courtesy; it never stops the dashboard starting


def local(path, body=None, timeout=2.0):
    """One request to this computer's Deja Vu1: (status, bytes, milliseconds)."""
    started = time.monotonic()
    data = None if body is None else json.dumps(body).encode()
    request = Request(f"http://127.0.0.1:{PORT}{path}", data=data,
                      headers={"Content-Type": "application/json"} if data is not None else {})
    with _LOCAL.open(request, timeout=timeout) as response:
        return response.status, response.read(), round((time.monotonic() - started) * 1000)


def info(timeout=1.0):
    try:
        return json.loads(local("/api/app/info", timeout=timeout)[1])
    except (OSError, ValueError, AttributeError):
        return None


def open_when_ready():
    """Open the dashboard once it answers, not before: a tab or its own app window."""
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.2):
                pass
        except OSError:
            time.sleep(0.1)
            continue
        # Something answers on the port: open it only if it is Deja Vu1, never another program.
        if already_running():
            break
        time.sleep(0.1)
    else:
        return
    import desktop
    opened = desktop.open_dashboard(f"http://localhost:{PORT}")
    if opened == "window":
        print("Deja Vu1 opened in its own app window." + ("" if os.environ.get("DEJAVU_BACKGROUND_PARENT") else
              " Keep this window open; closing it stops the dashboard."), flush=True)


def already_running():
    """The version of a Deja Vu1 that already answers on this port, or None."""
    found = info()
    return (found.get("version") or "unknown") if isinstance(found, dict) else None


# ---- "ready and fully working" ----------------------------------------------

def port_holder():
    """Whether something other than Deja Vu1 holds the port (it accepts connections but isn't Deja Vu1)."""
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
            return True
    except OSError:
        return False


def ready_report():
    """
    The server's own report (POST /api/app/ready) plus what only an outside view
    can see: the address answers, the page and its main script load, and demo
    data comes back over HTTP. Works without the server too: then it says why.
    """
    import readiness
    url = f"http://localhost:{PORT}"
    try:
        status, _, ms = local("/api/app/info", timeout=5)
        outside = [readiness._check("address", "Address", "ok", f"Answering at {url} ({ms} ms)")]
    except (OSError, ValueError) as exc:
        if port_holder():
            detail = (f"Something holds port {PORT} but doesn't answer like Deja Vu1. It may be an older "
                      "Deja Vu1 that is stuck, or another program")
            fix = "Paste the update block below: it stops a stuck Deja Vu1 and starts a fresh one"
            rep = readiness.summarise([readiness._check("address", "Address", "bad", detail, fix)], PORT)
            rep["next"] = "repair"
            return rep
        detail = f"Nothing answers at {url}: Deja Vu1 isn't running ({getattr(exc, 'reason', exc)})"
        return readiness.summarise([readiness._check("address", "Address", "bad", detail,
                                                     "Start it with the block below or its double-click launcher")],
                                   PORT)
    try:
        status, page, _ = local("/", timeout=10)
        status2, script, _ = local("/app.js", timeout=10)
        if status != 200 or b"Deja Vu1" not in page or status2 != 200 or len(script) < 1000:
            raise ValueError("the page or its main script came back incomplete")
        outside.append(readiness._check("page", "Page", "ok", f"The dashboard page loads ({(len(page) + len(script)) // 1024} KB)"))
    except (OSError, ValueError) as exc:
        outside.append(readiness._check("page", "Page", "bad", f"The dashboard page doesn't load: {exc}",
                                        "Paste the Repair block. It puts the app files back"))
    try:
        rep = json.loads(local("/api/app/ready", body={}, timeout=20)[1])
        checks = rep.get("checks") or []
    except HTTPError as exc:
        # 404: a version from before this check (an older copy, or one put back after a failed update).
        found = info() or {}
        checks = [readiness._check("program", "Program", "note", f"Version {found.get('version', '?')} answers. It is "
                                   "older than the full check, so only the address, page and demo data were checked",
                                   "Update it from Settings > Version & updates")] if exc.code == 404 else [
            readiness._check("program", "Program", "bad", f"The ready check answered {exc.code}",
                             "Paste the Repair block, which also restarts it")]
    except (OSError, ValueError) as exc:
        checks = [readiness._check("program", "Program", "bad", f"The ready check didn't answer: {exc}",
                                   "Paste the Repair block, which also restarts it")]
    try:
        demo = json.loads(local("/api/printer?demo=1&printer=u1-workshop", timeout=10)[1])
        if not demo.get("state"):
            raise ValueError("no reading came back")
        checks = [readiness._check("demo", "Demo data", "ok", f"Demo printer 1 answers ({demo['state']})")
                  if c["id"] == "demo" and c["state"] == "ok" else c for c in checks]
    except (OSError, ValueError, AttributeError) as exc:
        checks = [c for c in checks if c["id"] != "demo"]
        checks.append(readiness._check("demo", "Demo data", "bad", f"Demo data doesn't come back: {exc}",
                                       "Paste the Repair block"))
    return readiness.summarise(outside + checks, PORT)


def show_ready(report=None):
    import readiness
    try:
        report = report or ready_report()
    except Exception as exc:            # the check itself must never take the launcher down
        report = readiness.summarise([readiness._check("program", "Check", "bad", f"The check stopped: {exc!r}",
                                                       "Paste the Repair block")], PORT)
    print(readiness.render(report), flush=True)
    log(report["headline"] + "".join(f" | {c['label']}: {c['detail']}" for c in report["checks"]
                                     if c["state"] != "ok"))
    return report


def check_only():
    sys.path.insert(0, os.path.join(HERE, "backend"))
    return 0 if show_ready()["ready"] else 1


# ---- the supervisor ------------------------------------------------------

def supervise():
    """Keep one server process; install only after that process has stopped."""
    sys.path.insert(0, os.path.join(HERE, "backend"))
    running = already_running()
    if running:
        # A second launcher can't take the port; check and open the one that is running instead.
        print(f"Deja Vu1 {running} is already running at http://localhost:{PORT}.", flush=True)
        print("To start this copy instead, close the other Deja Vu1 window first.", flush=True)
        show_ready()
        open_when_ready()
        return 0
    import importlib
    import app_updates
    import readiness
    version_now = app_updates.version()
    env = dict(os.environ, DEJAVU_LAUNCHER="1", DEJAVU_LAUNCHER_VERSION=version_now)
    env.setdefault("DEJAVU_DATA_DIR", DATA_DIR)
    child = None
    opened = False
    crashes = []
    log(f"Launcher {version_now} started (Python {sys.version.split()[0]}, port {PORT})")

    def launch():
        env["DEJAVU_LAUNCH_ID"] = uuid.uuid4().hex
        proc = subprocess.Popen([sys.executable, os.path.join(HERE, "backend", "app.py")], cwd=HERE, env=env)
        proc.launch_id = env["DEJAVU_LAUNCH_ID"]
        return proc

    def answering(proc, expected=None):
        found = info(timeout=2)
        if not isinstance(found, dict):
            return False
        # The launch id proves it is the process just started, also where Python
        # starts through a redirector and the process number differs.
        ours = found.get("launch_id") == proc.launch_id or found.get("server_pid") == proc.pid
        return ours and (expected is None or found.get("version") == expected)

    def healthy(expected):
        nonlocal child
        say(f"Starting version {expected}...")
        child = launch()
        started = time.monotonic()
        told = 0
        while time.monotonic() - started < START_WAIT:
            if child.poll() is not None:
                say(f"Version {expected} stopped as it started (exit code {child.returncode}). "
                    "The reason is printed above.")
                return False
            if answering(child, expected):
                return True
            waited = int(time.monotonic() - started)
            if waited >= told + 15:
                told = waited
                print(f"  Still starting ({waited} s). The first start after an update can take a moment.", flush=True)
            time.sleep(0.3)
        say(f"Version {expected} didn't answer within {START_WAIT} s.")
        stop(child)
        return False

    def stop(proc):
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    def report_when_answering(proc):
        for _ in range(int(START_WAIT / 0.3)):
            if proc.poll() is not None:
                return
            if answering(proc):
                show_ready()
                return
            time.sleep(0.3)

    def apply_update():
        """Install a staged update. Whatever goes wrong, the dashboard still starts afterwards."""
        nonlocal child
        try:
            importlib.reload(app_updates)     # the newest installed rules for applying it
        except Exception as exc:
            log(f"Couldn't reload the updater, using the one already loaded: {exc!r}")
        before = app_updates.version()
        pending = os.path.isdir(os.path.join(HERE, ".dejavu-update"))
        if pending:
            say("Installing the update. The dashboard is back in a moment" + ("." if os.environ.get("DEJAVU_BACKGROUND") else "; keep this window open."))
        try:
            result = app_updates.apply_pending(HERE, healthy)
        except Exception as exc:
            words = str(exc) if isinstance(exc, ValueError) else f"{type(exc).__name__}: {exc}"
            say(f"The update could not be finished: {words}")
            say("Deja Vu1 starts with the files it has. If something looks wrong, paste the update block "
                "(Settings > Version & updates, or the README) to put fresh app files in place.")
            readiness.record_update(DATA_DIR, False, "the new version", before, words)
            if child is not None and child.poll() is None:
                stop(child)
            child = None
            return
        if result is True:
            now = app_updates.version()
            say(f"Updated from {before} to {now}.")
            readiness.record_update(DATA_DIR, True, now, before)
        elif result is False:
            reason = getattr(app_updates, "last_error", "") or "it did not start"
            say(f"The update could not start ({reason}). Your previous version {before} has been put back.")
            readiness.record_update(DATA_DIR, False, "the new version", before, reason)

    try:
        while True:
            apply_update()
            if child is None or child.poll() is not None:
                child = launch()
            threading.Thread(target=report_when_answering, args=(child,), daemon=True).start()
            if not opened:
                # Once per launch: after an update restart the open page reloads itself.
                opened = True
                threading.Thread(target=open_when_ready, daemon=True).start()
            code = child.wait()
            child = None
            if code == PORT_IN_USE:
                # The server has said why in words. Exit quietly, so the Windows
                # launcher doesn't add its "needs Python" note to a port problem.
                log(f"Port {PORT} is in use by another program")
                show_port_in_use()
                return 0
            if code in (0, 75, -2, -15):
                # 0: stopped on purpose (Settings > Stop, Ctrl+C); 75: an update restart;
                # -2 / -15: interrupted or told to end by the system.
                if code != 75:
                    log(f"Stopped (exit code {code})")
                    return code
                log("Restarting for an update")
                continue
            # Anything else is a crash. Start it again, so the dashboard stays reachable,
            # unless it keeps failing (then the reason above is what to read).
            now = time.monotonic()
            crashes = [t for t in crashes if now - t < CRASH_WINDOW] + [now]
            if len(crashes) > CRASH_LIMIT:
                say(f"Deja Vu1 stopped unexpectedly {len(crashes)} times in a few minutes, so it was "
                    "left stopped. The reason is printed above.")
                show_ready(dict(readiness.summarise([readiness._check(
                    "program", "Program", "bad", f"It keeps stopping (last exit code {code})",
                    "Paste the update block below. It puts fresh app files in place and starts again")], PORT),
                    next="repair"))
                return code
            say(f"Deja Vu1 stopped unexpectedly (exit code {code}). Starting it again...")
            time.sleep(2)
    finally:
        if child and child.poll() is None:
            stop(child)


# ---- running apart from this window -----------------------------------------

def start_in_background():
    """
    Start Deja Vu1 so it keeps running after this window closes, wait until it
    answers, show the ready check and open it. On Windows it runs without a console
    window (pythonw.exe when there is one, and a detached process either way); on
    macOS and Linux in a session of its own, so closing Terminal doesn't end it.
    The launcher it starts is the same one as always: it restarts the server after
    a crash and installs updates. Its output goes to <data>/logs/background.log.
    """
    sys.path.insert(0, os.path.join(HERE, "backend"))
    os.environ["DEJAVU_BACKGROUND_PARENT"] = "1"
    running = already_running()
    if not running:
        folder = os.path.join(DATA_DIR, "logs")
        os.makedirs(folder, exist_ok=True)
        out_path = os.path.join(folder, "background.log")
        if os.path.exists(out_path) and os.path.getsize(out_path) > LOG_LIMIT:
            os.remove(out_path)
        env = dict(os.environ, DEJAVU_NO_BROWSER="1", DEJAVU_BACKGROUND="1")
        env.pop("DEJAVU_BACKGROUND_PARENT", None)
        python = sys.executable
        with open(out_path, "ab") as out:
            kwargs = {"cwd": HERE, "env": env, "stdin": subprocess.DEVNULL, "stdout": out,
                      "stderr": subprocess.STDOUT, "close_fds": True}
            if os.name == "nt":
                quiet = os.path.join(os.path.dirname(python), "pythonw.exe")
                python = quiet if os.path.exists(quiet) else python
                kwargs["creationflags"] = 0x00000008 | 0x00000200      # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            else:
                kwargs["start_new_session"] = True
            subprocess.Popen([python, os.path.join(HERE, "start.py")], **kwargs)
        say("Starting Deja Vu1 in the background…")
        deadline = time.monotonic() + START_WAIT
        while time.monotonic() < deadline and not already_running():
            time.sleep(0.5)
        running = already_running()
        if not running:
            say(f"Deja Vu1 didn't answer within {START_WAIT} s. What it printed is in {out_path}")
            return 1
    else:
        print(f"Deja Vu1 {running} is already running at http://localhost:{PORT}.", flush=True)
    if "--autostart" in sys.argv[1:]:
        try:
            import autostart
            if not autostart.status()["on"]:
                autostart.set_on(True)
                say("It will also start by itself when you sign in to this computer "
                    "(turn that off in Settings -> Desktop app).")
        except (OSError, ValueError) as exc:
            say(f"Starting at sign-in couldn't be switched on: {exc}")
    show_ready()
    if os.environ.get("DEJAVU_NO_BROWSER") != "1":
        open_when_ready()
    say(f"Deja Vu1 keeps running after you close this window. Open http://localhost:{PORT} any time. "
        "To stop it: Settings -> Version & updates -> Stop.")
    return 0


def show_port_in_use():
    import readiness
    windows = os.name == "nt"
    other = "$env:PORT=8001; py -3 start.py" if windows else "PORT=8001 python3 start.py"
    show_ready(dict(readiness.summarise([readiness._check(
        "address", "Address", "bad", f"Port {PORT} is already used by another program",
        f"Close that program and start Deja Vu1 again, or use another port: {other}, "
        "then open http://localhost:8001")], PORT), next=None))


if __name__ == "__main__":
    try:
        args = sys.argv[1:]
        sys.exit(check_only() if "--check" in args else start_in_background() if "--background" in args else supervise())
    except KeyboardInterrupt:
        print("Stopped.")
