"""
Away from home: open this dashboard on a phone that is not on the home Wi-Fi.

The way that keeps the dashboard private is Tailscale (a VPN you install on
this computer and your phone, signed in to your own account). Its "Serve"
feature gives this computer an https://<name>.<tailnet>.ts.net address that
only your own Tailscale devices can open, and forwards it to the dashboard.
Nothing is opened to the internet; Funnel, Tailscale's public sharing, is
never used here.

Everything below runs Tailscale's own command-line program, with the formats
read from its source (github.com/tailscale/tailscale, eba00ab):
- `tailscale status --json`: BackendState ("Running" when connected), Self.DNSName
  (ends with a dot), Self.TailscaleIPs (ipn/ipnstate/ipnstate.go).
- `tailscale serve status --json`: Web maps "<host>:<port>" to Handlers, each
  mount point to a Proxy target (ipn/serve.go).
- `tailscale serve --bg --yes http://127.0.0.1:<port>` shares the dashboard. If
  the tailnet has not switched HTTPS on yet, it prints a link to do that and
  waits until it is done (serve_legacy.go enableFeatureInteractive).
- Serve keeps the phone's Host header and adds X-Forwarded-For
  (ipn/ipnlocal/serve.go), so a phone through it is never "this computer".

Switching sharing on or off is only allowed from this computer itself (app.py).
"""

import json
import os
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import urlsplit

_LINK = re.compile(r"https://\S+")
_LOOPBACK = ("127.0.0.1", "localhost", "::1", "[::1]")
APPROVAL_SECONDS = 600
_pending = {"proc": None, "url": None, "lines": [], "started": 0.0}
_lock = threading.Lock()


def cli():
    """Tailscale's command-line program, or None. PATH first, then where its apps install it."""
    found = shutil.which("tailscale")
    if found:
        return found
    places = [
        # The Mac app keeps the command inside its bundle (version/prop.go: ".../Contents/MacOS/Tailscale").
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Tailscale", "tailscale.exe"),
    ]
    return next((p for p in places if os.path.isfile(p)), None)


def _run(args, timeout=6):
    program = cli()
    if not program:
        raise LookupError("Tailscale isn't installed on this computer")
    return subprocess.run([program] + list(args), capture_output=True, text=True, timeout=timeout)


def _json(args):
    try:
        done = _run(args)
    except (LookupError, OSError, subprocess.TimeoutExpired):
        return None
    try:
        return json.loads(done.stdout or "null")
    except ValueError:
        return None


def points_here(target, port):
    """Is a Serve proxy target this dashboard? ("http://127.0.0.1:8000", "localhost:8000", "8000")"""
    target = str(target or "").strip()
    if target.isdigit():
        return int(target) == port
    parts = urlsplit(target if "://" in target else "http://" + target)
    try:
        return parts.hostname in _LOOPBACK and (parts.port or 80) == port
    except ValueError:
        return False


def shared_url(serve, port):
    """The https address Serve gives this dashboard, from `serve status --json`, or None."""
    for hostport, web in ((serve or {}).get("Web") or {}).items():
        host, _, srv_port = str(hostport).rpartition(":")
        handlers = (web or {}).get("Handlers") or {}
        root = handlers.get("/") or {}
        if host and points_here(root.get("Proxy"), port):
            return f"https://{host}" + ("" if srv_port == "443" else f":{srv_port}")
    return None


def status(port):
    """What this computer's Tailscale can offer the phone, in plain facts."""
    out = {"installed": False, "running": False, "state": None, "name": None, "ips": [],
           "shared_url": None, "http_url": None, "approval_url": None, "waiting": False, "error": None}
    if not cli():
        return out
    out["installed"] = True
    st = _json(["status", "--json"])
    if not isinstance(st, dict):
        out["error"] = "Tailscale is installed but didn't answer. Open the Tailscale app and check it is running"
        return out
    me = st.get("Self") or {}
    out["state"] = st.get("BackendState")
    out["running"] = out["state"] == "Running"
    out["name"] = str(me.get("DNSName") or "").rstrip(".") or None
    out["ips"] = [str(ip) for ip in (me.get("TailscaleIPs") or st.get("TailscaleIPs") or [])]
    ipv4 = next((ip for ip in out["ips"] if ":" not in ip), None)
    if out["running"] and ipv4:
        out["http_url"] = f"http://{ipv4}:{port}"
    if out["running"]:
        out["shared_url"] = shared_url(_json(["serve", "status", "--json"]), port)
    with _lock:
        proc = _pending["proc"]
        if proc is not None and proc.poll() is None:
            out["waiting"], out["approval_url"] = True, _pending["url"]
    return out


def _reap(proc):
    """Collect the command's words; stop it if HTTPS is never switched on."""
    for line in proc.stdout:
        with _lock:
            _pending["lines"].append(line.rstrip())
            found = _LINK.search(line)
            if found and not _pending["url"]:
                _pending["url"] = found.group(0)
    proc.stdout.close()
    try:
        proc.wait(timeout=APPROVAL_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()


def share(port, wait=15):
    """
    Turn on private sharing. Returns {"shared_url"} when done, {"waiting",
    "approval_url"} when Tailscale asks you to switch HTTPS on first, and
    raises ValueError with Tailscale's own words otherwise.
    """
    program = cli()
    if not program:
        raise ValueError("Tailscale isn't installed on this computer. Install it from tailscale.com, "
                         "sign in, then try again")
    now = status(port)
    if not now["running"]:
        raise ValueError("Tailscale is installed but not connected. Open the Tailscale app, sign in and "
                         "connect, then try again")
    if now["shared_url"]:
        return {"shared_url": now["shared_url"]}
    with _lock:
        proc = _pending["proc"]
        if proc is None or proc.poll() is not None:
            proc = subprocess.Popen([program, "serve", "--bg", "--yes", f"http://127.0.0.1:{port}"],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            _pending.update(proc=proc, url=None, lines=[], started=time.monotonic())
            threading.Thread(target=_reap, args=(proc,), daemon=True).start()
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline and proc.poll() is None:
        with _lock:
            if _pending["url"]:
                return {"waiting": True, "approval_url": _pending["url"]}
        time.sleep(0.2)
    if proc.poll() is None:
        with _lock:
            return {"waiting": True, "approval_url": _pending["url"]}
    time.sleep(0.1)                    # let the reader take the last lines
    with _lock:
        words = " ".join(line for line in _pending["lines"] if line).strip()
    if proc.returncode != 0:
        raise ValueError("Tailscale couldn't share the dashboard: " + (words[:600] or f"it stopped with code {proc.returncode}"))
    url = status(port)["shared_url"]
    if not url:
        raise ValueError("Tailscale finished but no shared address appeared. " + words[:400])
    return {"shared_url": url}


def stop(port):
    """Stop sharing this dashboard (only a share that points at it)."""
    now = status(port)
    if not now["shared_url"]:
        return {"shared_url": None}
    srv_port = urlsplit(now["shared_url"]).port or 443
    done = _run(["serve", f"--https={srv_port}", "off"], timeout=15)
    if done.returncode != 0:
        raise ValueError("Tailscale couldn't stop sharing: " + ((done.stdout or "") + (done.stderr or "")).strip()[:600])
    return {"shared_url": status(port)["shared_url"]}
