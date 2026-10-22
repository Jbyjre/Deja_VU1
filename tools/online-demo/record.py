"""
Record the simulated farm for the online demo.

The public Cloudflare link publishes frontend/ with no Python server behind
it. There the dashboard plays this recording instead (frontend/app.js,
"the online demo"): every reading the dashboard asks for, for each of the
three built-in simulated printers, and a stretch of the live feed that
loops. Nothing in it comes from a real printer.

    python3 tools/online-demo/record.py            # about 3 minutes

It starts the real server in a temporary data folder (your own settings and
files are never read), turns on the sample files, asks every GET route the
way the dashboard does, then reads the live feed once a second. Halfway
through, the Workshop printer jams, so the recording shows what happens
when a print needs you. Output: frontend/demo/ (recording.json, plus the
sample files and their thumbnails, which the dashboard loads directly).

Re-run it when the screens or the routes change; the tests check that every
GET route the server has is in the recording.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "frontend", "demo")
SECONDS = 150          # length of the loop
JAM_AT = 75            # the Workshop printer jams here

# Routes the recording doesn't hold as fixed answers: the live feed is
# recorded as a timeline, files and thumbnails as files, and the rest are
# streams, downloads or images the demo can't use.
TIMELINE = {"/api/live/snapshot", "/api/live/events", "/api/fleet"}
NOT_RECORDED = {"/api/files/raw", "/api/files/thumb", "/api/files/lines", "/api/camera/stream",
                "/api/backup", "/api/timelapse/frame", "/api/live",
                "/api/camera/snapshot", "/api/app/info"}
# Routes that need a file name, and the parameter it goes in.
PER_FILE = {"/api/files/analysis": "name", "/api/files/plates": "name", "/api/print/confirm": "file"}
# Parameters that don't change the answer, so they aren't part of the key.
IGNORED = {"demo", "since", "v", "t", "_", "device"}
# Routes the dashboard asks with set parameters, and each set it uses.
VARIANTS = {"/api/fleet/history": [{"days": 7, "bucket": "day"}, {"days": 30, "bucket": "day"},
                                   {"days": 90, "bucket": "week"}]}


def key_for(path, params):
    """The lookup key, the same as frontend/app.js tourKey()."""
    kept = sorted((k, v) for k, v in params.items() if k not in IGNORED)
    return path + ("?" + "&".join(f"{k}={v}" for k, v in kept) if kept else "")


def get_routes():
    """Every GET route the server answers, read from backend/app.py."""
    sys.path.insert(0, os.path.join(ROOT, "backend"))
    import app                                     # noqa: E402  (data dir is already temporary)
    with open(os.path.join(ROOT, "backend", "app.py"), encoding="utf-8") as f:
        source = f.read()
    start = source.index("def _handle_api_get")
    body = source[start:source.index("\n    def ", start + 10)]
    named = {line.split('"')[1] for line in body.splitlines() if 'if route == "/api/' in line}
    return sorted(set(app._DATA_ROUTES) | set(app._APP_ROUTES) | named)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, data_dir):
        self.port = free_port()
        env = dict(os.environ, PORT=str(self.port), DEJAVU_DATA_DIR=data_dir)
        self.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "backend", "app.py")], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.get("/api/modules")
                return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("The server didn't start")

    def _open(self, path, data=None):
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.headers.get("Content-Type", ""), r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type", ""), e.read()

    def get(self, path, **params):
        query = urllib.parse.urlencode(params)
        status, kind, raw = self._open(path + ("?" + query if query else ""))
        return status, (json.loads(raw) if "json" in kind else raw)

    def post(self, path, body):
        status, _, raw = self._open(path, json.dumps(body).encode())
        return status, json.loads(raw)

    def stop(self):
        self.proc.terminate()
        self.proc.wait(10)


def record():
    data_dir = tempfile.mkdtemp(prefix="dejavu-demo-")
    os.environ["DEJAVU_DATA_DIR"] = data_dir
    routes = get_routes()
    srv = Server(data_dir)
    try:
        srv.post("/api/files/samples", {})
        # Every module on, so the demo shows everything (a fresh install
        # starts with the optional ones off).
        for m in srv.get("/api/modules")[1]["modules"]:
            if not m["enabled"]:
                srv.post(f"/api/modules/{m['id']}/toggle", {"enabled": True})
        _, fleet = srv.get("/api/fleet", demo=1)
        printers = [p["id"] for p in fleet["printers"]]
        _, files = srv.get("/api/files")
        names = [f["name"] for f in files["files"]]
        gcode = [n for n in names if n.endswith(".gcode")]

        bodies, index, get = [], {}, {}

        def keep(key, status, body):
            text = json.dumps({"status": status, "body": body}, sort_keys=True, separators=(",", ":"))
            if text not in index:
                index[text] = len(bodies)
                bodies.append(json.loads(text))
            get[key] = index[text]

        for pid in printers:
            for path in routes:
                if path in TIMELINE or path in NOT_RECORDED:
                    continue
                if path == "/api/profiles/diff":
                    for a in gcode:
                        for b in gcode:
                            if a != b:
                                params = {"demo": 1, "printer": pid, "a": a, "b": b}
                                keep(key_for(path, params), *srv.get(path, **params))
                    continue
                if path in PER_FILE:
                    for name in (names if path == "/api/files/plates" else gcode):
                        params = {"demo": 1, "printer": pid, PER_FILE[path]: name}
                        keep(key_for(path, params), *srv.get(path, **params))
                    continue
                for extra in VARIANTS.get(path, [{}]):
                    params = {"demo": 1, "printer": pid, **extra}
                    status, body = srv.get(path, **params)
                    if isinstance(body, bytes):
                        continue
                    keep(key_for(path, params), status, body)

        shutil.rmtree(OUT, ignore_errors=True)
        os.makedirs(os.path.join(OUT, "files"))
        os.makedirs(os.path.join(OUT, "thumbs"))
        thumbs = []
        for name in names:
            status, raw = srv.get("/api/files/raw", name=name)
            if status == 200:
                with open(os.path.join(OUT, "files", name), "wb") as f:
                    f.write(raw if isinstance(raw, bytes) else json.dumps(raw).encode())
            status, raw = srv.get("/api/files/thumb", name=name)
            if status == 200 and isinstance(raw, bytes):
                with open(os.path.join(OUT, "thumbs", name + ".png"), "wb") as f:
                    f.write(raw)
                thumbs.append(name)

        # The live feed, once a second.
        frames, events, seen = [], [], 0
        start = time.monotonic()
        for i in range(SECONDS):
            if i == JAM_AT:
                status, fired = srv.post("/api/sandbox/fire?demo=1", {"event": "jam", "printer": printers[0]})
                if status != 200 or not all(o.get("ok") for o in fired.get("outcomes", [])):
                    raise RuntimeError(f"The jam didn't fire: {fired}")
            frame = {"fleet": srv.get("/api/fleet", demo=1)[1]["printers"], "state": {}}
            for pid in printers:
                snap = srv.get("/api/live/snapshot", demo=1, printer=pid)[1]
                frame["state"][pid] = snap["state"]
            for e in srv.get("/api/live/events", demo=1, since=seen)[1].get("events", []):
                seen = max(seen, e["id"])
                events.append({"frame": i, "event": e})
            frames.append(frame)
            time.sleep(max(0.0, start + i + 1 - time.monotonic()))
    finally:
        srv.stop()
        shutil.rmtree(data_dir, ignore_errors=True)

    if not events:
        raise RuntimeError("The recording has no events; the jam should have made one")
    recording = {
        "about": "A recording of Deja Vu1's simulated farm for the online demo. Not a real printer. "
                 "Made by tools/online-demo/record.py.",
        "recorded": time.strftime("%Y-%m-%d"),
        "default_printer": printers[0],
        "printers": printers,
        "step": 1,
        "routes": routes,
        "get": get,
        "bodies": bodies,
        "files": names,
        "thumbs": thumbs,
        "frames": frames,
        "events": events,
    }
    with open(os.path.join(OUT, "recording.json"), "w", encoding="utf-8") as f:
        json.dump(recording, f, separators=(",", ":"))
    size = os.path.getsize(os.path.join(OUT, "recording.json"))
    print(f"{len(get)} answers ({len(bodies)} different), {len(frames)} s of live feed, "
          f"{len(events)} events, {len(names)} files: {size // 1024} KB")


if __name__ == "__main__":
    record()
