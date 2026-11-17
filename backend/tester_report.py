"""
tester_report.py
================

The reading half of Tester mode: it takes the events tester.py recorded and turns them into

  - totals for the Settings card,
  - report.json (the data, with a schema_version),
  - report.html (one page that opens offline, with no scripts and nothing loaded from outside),
  - events.jsonl (the raw events after masking and thinning),
  - README.txt,

all packed into one zip the tester attaches to a forum message. Nothing here touches the network.

Thinning: when the raw events would pass EXPORT_LIMIT, the oldest routine ones (clicks that were not
slow, background requests that worked, screen visits, smoothness samples) are replaced by one summary
line per day and control. Errors, slow actions, notes and the printer's story are never thinned, and
the report's totals are counted before anything is dropped.
"""

import html
import io
import json
import os
import platform
import random
import re
import statistics
import sys
import time
import zipfile
from collections import Counter

import modules
import storage
import tester

_DATA_DIR = storage.DATA_DIR

ROUTINE_ORDER = ("click", "req", "screen", "fps")      # the order routine events are summed up in
SLOW_CLICK_MS = tester.SLOW_CLICK_MS
SLOW_REQUEST_MS = tester.SLOW_REQUEST_MS
SLOWEST = 25
SCREEN_NAMES = {"fleet": "printers", "control": "printer", "library": "files", "care": "maintenance",
                "modules": "settings", "autoprint": "slice", "prepare": "slice", "jobs": "queue",
                "materials": "filament"}

# Every main feature: how the report decides it was used, and where the tester questions sheet asks about it.
# rule kinds: screen (a place that was opened), route (method + path pattern of a request), kind (an event
# the server noted), ctl (a control that was pressed), fps (a smoothness sample), flag (a feature event).
FEATURES = [
    ("needs_you", "Needs you", 4, "Watching the printer", [("ctl", r"#attention\b"), ("flag", "needs_you")]),
    ("twin", "The 3D twin", 4, "Watching the printer", [("fps", "twin"), ("ctl", r"#twin-")]),
    ("camera", "Camera", 4, "Watching the printer", [("flag", "camera")]),
    ("timelapse", "Time-lapses", 4, "Watching the printer", [("flag", "timelapse"),
                                                             ("route", "GET", r"^/api/timelapse/(frames|printer-video)")]),
    ("confirm_print", "Confirm Print", 5, "Printing", [("kind", "gate")]),
    ("skip_object", "Skip object", 5, "Printing", [("route", "POST", r"^/api/printer/control/exclude$")]),
    ("printer_controls", "Printer page controls", 5, "Printing",
     [("route", "POST", r"^/api/printer/control/(jog|move|z-nudge|extrude|home|temperature|bed-temperature|speed|flow|"
                        r"fan|pressure-advance|limits|motors-off|gcode|filament|macro|tool|bed-mesh|light)")]),
    ("slicing", "Slicing", 6, "Files, slicing and converting", [("kind", "slice"), ("route", "POST", r"^/api/slicer/slice$")]),
    ("converter", "Converter", 6, "Files, slicing and converting", [("kind", "convert")]),
    ("gcode_preview", "G-code preview", 6, "Files, slicing and converting", [("fps", "gcode"), ("ctl", r"#gv-")]),
    ("photo_studio", "Photo Studio", 6, "Files, slicing and converting", [("screen", "studio"),
                                                                         ("route", "POST", r"^/api/studio/")]),
    ("spoolman", "Spoolman", 7, "Filament and care", [("route", "POST", r"^/api/filament/spoolman$")]),
    ("maintenance", "Maintenance", 7, "Filament and care", [("screen", "maintenance"),
                                                           ("route", "POST", r"^/api/maintenance/(done|swap|snooze)$")]),
    ("queue", "Print queue", 7, "Filament and care", [("screen", "queue"),
                                                     ("route", "POST", r"^/api/queue/(add|remove|move|auto|start-next|clear-done|bed-clear)$")]),
    ("phone", "Phone", 8, "Phone and away from home", [("route", "POST", r"^/api/pairing/(link|code)$"),
                                                       ("ctl", r"#phone-connect-btn")]),
    ("away", "Away from home", 8, "Phone and away from home", [("route", "POST", r"^/api/remote/(share|stop|link)$")]),
    ("notifications", "Notifications", 8, "Phone and away from home",
     [("route", "POST", r"^/api/notifications/(settings|test)$")]),
    ("automations", "Automations", 8, "Phone and away from home", [("screen", "automations"),
                                                                  ("route", "POST", r"^/api/automations")]),
    ("ai_assistant", "AI assistant", 9, "The AI assistant", [("route", "POST", r"^/api/assistant/chat$")]),
    ("print_watch", "Print watch", 9, "The AI assistant", [("route", "POST", r"^/api/assistant/watch")]),
    ("print_doctor", "Print doctor", 9, "The AI assistant", [("ctl", r"(?i)print doctor|#ai-doctor")]),
    ("updates", "Updates", 10, "Updates and settings", [("kind", "update"),
                                                        ("route", "POST", r"^/api/app/(updates/(install|check|git)|repair)$")]),
]

NEVER = ["file names or model contents (a file is shown as \"file 3, .3mf, 2.4 MB\")",
         "camera pictures or time-lapse frames", "IP addresses, host names or printer serial numbers",
         "Wi-Fi names", "API keys or AI sign-ins", "AI chat text",
         "anything typed into a field, except the notes you write with \"Something felt off\"",
         "the contents of the printer's G-code"]


# ---------------------------------------------------------------------------
# Reading events
# ---------------------------------------------------------------------------

def iter_events(paths):
    """Every event in the given files, in file order. A damaged line is skipped, never fatal."""
    for path in paths:
        try:
            with open(path, "rb") as handle:
                for raw in handle:
                    try:
                        event = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(event, dict) and isinstance(event.get("k"), str) and isinstance(event.get("t"), (int, float)):
                        yield event
        except OSError:
            continue


def _day(t_ms):
    return time.strftime("%Y-%m-%d", time.localtime(t_ms / 1000.0))


def _iso(t_ms):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t_ms / 1000.0))


def _routine(event):
    kind = event.get("k")
    if kind == "click":
        return not event.get("slow") and (event.get("req") or 0) <= SLOW_REQUEST_MS
    if kind == "req":
        return not event.get("slow") and not event.get("err") and (event.get("status") or 0) < 400
    return kind in ("screen", "fps")


def _median(values):
    return statistics.median(values) if values else None


def _wmedian(pairs):
    """Median of (value, weight) pairs."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    if not total:
        return None
    half, run = total / 2.0, 0
    for value, weight in pairs:
        run += weight
        if run >= half:
            return value
    return pairs[-1][0]


# ---------------------------------------------------------------------------
# Thinning
# ---------------------------------------------------------------------------

def thin_files(paths, out_path, limit):
    """
    Copy the events in `paths` to `out_path`, keeping the result near or under `limit` bytes. Past the
    limit the oldest routine events go first, each kind in turn, replaced by one "thinned" line per day
    and control (count, median, slowest). Returns {"dropped": events replaced, "by_kind": {...},
    "bytes_before", "bytes_after"}. Every line that is kept is masked again on the way out.
    """
    total, sizes = 0, {k: [] for k in ROUTINE_ORDER}
    for path in paths:
        try:
            handle = open(path, "rb")
        except OSError:
            continue
        with handle:
            for raw in handle:
                total += len(raw)
                if b'"k":"' not in raw:
                    continue
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(event, dict) and event.get("k") in sizes and _routine(event):
                    sizes[event["k"]].append((event.get("t") or 0, len(raw)))
    cut, need = {}, total - limit + max(int(limit * 0.04), 64 * 1024) if total > limit else 0
    for kind in ROUTINE_ORDER:
        if need <= 0:
            break
        run, found = 0, None
        for t, size in sorted(sizes[kind]):
            run += size
            found = t
            if run >= need:
                need = 0
                break
        else:
            need -= run
        if found is not None:
            cut[kind] = found
    summary = _Sums()
    memo = {}
    written = 0
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        for event in iter_events(paths):
            kind = event["k"]
            if kind in cut and event["t"] <= cut[kind] and _routine(event):
                summary.add(event)
                continue
            line = json.dumps(_remask(event, memo), separators=(",", ":"), ensure_ascii=False) + "\n"
            out.write(line)
            written += len(line.encode("utf-8"))
        for event in summary.events():
            line = json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n"
            out.write(line)
            written += len(line.encode("utf-8"))
    return {"dropped": summary.dropped, "by_kind": dict(summary.by_kind), "bytes_before": total,
            "bytes_after": written, "limit": limit}


def _remask(event, memo):
    """The event with every string masked again (a safety net: the recorder already masked them)."""
    def fix(value, depth=0):
        if isinstance(value, str):
            if len(value) < 4 and value.isalpha():
                return value
            if value not in memo:
                memo[value] = tester.mask(value, tester.MAX_NOTE)
            return memo[value]
        if isinstance(value, list) and depth < 3:
            return [fix(v, depth + 1) for v in value]
        if isinstance(value, dict) and depth < 3:
            return {k: fix(v, depth + 1) for k, v in value.items()}
        return value
    out = {}
    for key, value in event.items():
        if key in ("t", "k", "s"):
            out[key] = value
        elif key in tester._VERSION_FIELDS:
            out[key] = ({k: tester.version_text(v) for k, v in value.items()} if isinstance(value, dict)
                        else tester.version_text(value) if isinstance(value, str) else value)
        else:
            out[key] = fix(value)
    return out


class _Sums:
    """Routine events replaced by one line per kind, day and name."""

    def __init__(self):
        self.groups = {}
        self.dropped = 0
        self.by_kind = Counter()

    def add(self, event):
        kind, day = event["k"], _day(event["t"])
        if kind == "click":
            key = (kind, day, event.get("ctl"), event.get("screen"))
            value = event.get("paint")
        elif kind == "req":
            key = (kind, day, event.get("route"), event.get("method"))
            value = event.get("ms") if not event.get("agg") else event.get("p50")
        elif kind == "screen":
            key = (kind, day, event.get("screen"), None)
            value = event.get("ms")
        else:
            key = (kind, day, event.get("surface"), None)
            value = event.get("fps")
        group = self.groups.setdefault(key, {"n": 0, "vals": [], "max": 0, "t": 0, "fail": 0, "ms": 0, "min": None})
        weight = event.get("n") if kind == "req" and event.get("agg") and isinstance(event.get("n"), int) else 1
        group["n"] += weight
        self.dropped += 1
        self.by_kind[kind] += 1
        group["t"] = max(group["t"], event["t"])
        if isinstance(value, (int, float)):
            if len(group["vals"]) < 200:
                group["vals"].append(value)
            group["max"] = max(group["max"], event.get("max") if event.get("agg") else value)
            group["min"] = value if group["min"] is None else min(group["min"], value)
        if kind == "screen":
            group["ms"] += value if isinstance(value, (int, float)) else 0
        if kind == "req" and event.get("agg"):
            group["fail"] += event.get("fail") or 0

    def events(self):
        for (kind, day, name, extra), g in sorted(self.groups.items(), key=lambda kv: kv[1]["t"]):
            line = {"t": g["t"], "k": "thinned", "of": kind, "day": day, "n": g["n"], "dropped": g["n"],
                    "med": _median(g["vals"]), "max": g["max"]}
            if kind == "click":
                line["ctl"], line["screen"] = name, extra
            elif kind == "req":
                line["route"], line["method"], line["fail"] = name, extra, g["fail"]
            elif kind == "screen":
                line["screen"], line["ms"] = name, g["ms"]
            else:
                line["surface"], line["min"] = name, g["min"]
            yield line


# ---------------------------------------------------------------------------
# The totals the Settings card shows
# ---------------------------------------------------------------------------

_totals_cache = {}


def forget():
    _totals_cache.clear()


def _count_into(counts, event):
    kind, t = event["k"], event["t"]
    counts["events"] += 1
    counts["days"].add(_day(t))
    counts["first"] = t if counts["first"] is None else min(counts["first"], t)
    counts["last"] = t if counts["last"] is None else max(counts["last"], t)
    if kind == "click":
        counts["actions"] += 1
        if event.get("slow") or (event.get("paint") or 0) > SLOW_CLICK_MS:
            counts["slow"] += 1
    elif kind == "thinned":
        counts["thinned"] += event.get("dropped") or 0
        if event.get("of") == "click":
            counts["actions"] += event.get("n") or 0
    elif kind == "err":
        counts["errors"] += event.get("n") or 1
    elif kind == "long":
        counts["slow"] += 1
    elif kind == "req":
        if not event.get("agg") and (event.get("slow") or (event.get("ms") or 0) > SLOW_REQUEST_MS):
            counts["slow"] += 1
    elif kind == "session" and event.get("ev") == "start":
        counts["sessions"] += 1
    elif kind == "note":
        counts["notes"] += 1


def _fresh_counts():
    return {"events": 0, "days": set(), "first": None, "last": None, "actions": 0, "slow": 0, "errors": 0,
            "thinned": 0, "sessions": 0, "notes": 0}


def totals():
    """Days, actions, errors and slow spots recorded so far. Files already counted are not read again."""
    merged = _fresh_counts()
    for path in tester.event_files():
        try:
            stat = os.stat(path)
        except OSError:
            continue
        cached = _totals_cache.get(path)
        if cached and cached["size"] == stat.st_size and cached["mtime"] == stat.st_mtime_ns:
            counts = cached["counts"]
        else:
            if cached and stat.st_size >= cached["size"] and cached["offset"] <= stat.st_size:
                counts, offset = cached["counts"], cached["offset"]      # a day file only ever grows
            else:
                counts, offset = _fresh_counts(), 0
            try:
                with open(path, "rb") as handle:
                    handle.seek(offset)
                    data = handle.read()
            except OSError:
                continue
            end = data.rfind(b"\n") + 1
            for raw in data[:end].splitlines():
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(event, dict) and isinstance(event.get("k"), str) and isinstance(event.get("t"), (int, float)):
                    _count_into(counts, event)
            _totals_cache[path] = {"size": stat.st_size, "mtime": stat.st_mtime_ns, "offset": offset + end, "counts": counts}
        for key in ("events", "actions", "slow", "errors", "thinned", "sessions", "notes"):
            merged[key] += counts[key]
        merged["days"] |= counts["days"]
        for key, pick in (("first", min), ("last", max)):
            if counts[key] is not None:
                merged[key] = counts[key] if merged[key] is None else pick(merged[key], counts[key])
    return {"days": len(merged["days"]), "events": merged["events"], "actions": merged["actions"],
            "errors": merged["errors"], "slow": merged["slow"], "sessions": merged["sessions"],
            "notes": merged["notes"], "thinned": merged["thinned"],
            "since": _iso(merged["first"]) if merged["first"] else None,
            "last": _iso(merged["last"]) if merged["last"] else None}


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------

_rng = random.Random(7)


class _Stat:
    """Count, slowest and median of a number, with a bounded sample so a long week stays small."""

    def __init__(self):
        self.n = self.slow = 0
        self.max = 0
        self.vals = []
        self.agg = []
        self.single = 0

    def add(self, value, slow=False):
        self.n += 1
        self.single += 1
        self.slow += 1 if slow else 0
        if isinstance(value, (int, float)):
            self.max = max(self.max, value)
            if len(self.vals) < 300:
                self.vals.append(value)
            else:
                spot = _rng.randrange(self.single)
                if spot < 300:
                    self.vals[spot] = value

    def add_agg(self, n, median, top, slow=0):
        self.n += n
        self.slow += slow
        if isinstance(top, (int, float)):
            self.max = max(self.max, top)
        if isinstance(median, (int, float)) and n:
            self.agg.append((median, n))

    def median(self):
        if not self.vals and not self.agg:
            return None
        weight = self.single / float(len(self.vals)) if self.vals else 0
        return _wmedian([(v, weight) for v in self.vals] + self.agg)


def _round(value):
    return None if value is None else (int(value) if float(value).is_integer() else round(value, 1))


def _file_key(label):
    """'file 3, .3mf, 2.4 MB' -> 'file 3': the same file, whatever size was noted."""
    return str(label or "").split(",")[0]


def _norm_message(text):
    return re.sub(r"\d+", "#", str(text or ""))[:160]


class Aggregator:
    """One pass over the events. Memory stays small however long the week was."""

    def __init__(self):
        self.events = 0
        self.first = self.last = None
        self.kinds = Counter()
        self.sessions = {}
        self.setups = {}
        self.screens = {}
        self.screen_order = []
        self.screens_seen = set()
        self.controls = {}
        self.slowest = []
        self.slow_clicks = []
        self.long_tasks = []
        self.long_total = self.long_ms = 0
        self.routes = {}
        self.failed = []
        self.failed_total = 0
        self.slow_reqs = []
        self.routes_seen = set()
        self.errors = {}
        self.error_total = 0
        self.timeline = []
        self.refused = []
        self.confirmed = {}
        self.print_counts = {"real": Counter(), "demo": Counter()}
        self.link = Counter()
        self.firmware = {}
        self.gates = []
        self.gate_reasons = Counter()
        self.gate_by_file = {}
        self.slices = []
        self.converts = []
        self.fps = {"twin": [], "gcode": []}
        self.flags = set()
        self.notes = []
        self.updates = []
        self.thinned = Counter()
        self.thinned_total = 0
        self.days = {}

    # -- helpers -----------------------------------------------------------------
    def _day(self, t):
        return self.days.setdefault(_day(t), {"sessions": set(), "clicks": 0, "errors": 0, "slow": 0, "prints": 0,
                                              "minutes": 0.0})

    def _screen(self, name):
        name = SCREEN_NAMES.get(name, name)
        self.screens_seen.add(name)
        return name

    # -- events ------------------------------------------------------------------
    def add(self, ev):
        kind, t = ev["k"], ev["t"]
        self.events += 1
        self.kinds[kind] += 1
        self.first = t if self.first is None else min(self.first, t)
        self.last = t if self.last is None else max(self.last, t)
        session = ev.get("s")
        if session:
            info = self.sessions.setdefault(session, {"start": t, "end": t, "visible_ms": 0, "device": None, "w": None, "h": None})
            info["start"], info["end"] = min(info["start"], t), max(info["end"], t)
        handler = getattr(self, "_on_" + kind, None)
        if handler:
            handler(ev, t, session)

    def _on_session(self, ev, t, session):
        if not session:
            return
        info = self.sessions[session]
        if ev.get("device"):
            info["device"] = ev["device"]
        if ev.get("w"):
            info["w"], info["h"] = ev.get("w"), ev.get("h")
        if ev.get("ev") == "end" and isinstance(ev.get("ms"), (int, float)):
            info["visible_ms"] = max(info["visible_ms"], ev["ms"])
        self._day(info["start"])["sessions"].add(session)

    def _on_setup(self, ev, t, session):
        keep = {k: v for k, v in ev.items() if k not in ("t", "k", "s")}
        self.setups[session or "?"] = (t, keep)

    def _on_screen(self, ev, t, session):
        name = self._screen(str(ev.get("screen") or "?"))
        entry = self.screens.setdefault(name, {"opens": 0, "ms": 0})
        entry["opens"] += 1
        entry["ms"] += ev.get("ms") or 0
        if len(self.screen_order) < 400:
            self.screen_order.append({"t": _iso(t), "screen": name, "seconds": round((ev.get("ms") or 0) / 1000.0, 1)})

    def _control(self, name):
        entry = self.controls.get(name)
        if entry is None:
            if len(self.controls) >= 4000:
                name = "(other controls)"
                entry = self.controls.get(name)
            if entry is None:
                entry = self.controls[name] = {"paint": _Stat(), "screens": Counter()}
        return entry

    def _on_click(self, ev, t, session):
        paint, req = ev.get("paint"), ev.get("req")
        entry = self._control(str(ev.get("ctl") or "?"))
        slow = bool(ev.get("slow")) or (isinstance(paint, (int, float)) and paint > SLOW_CLICK_MS)
        entry["paint"].add(paint, slow)
        if ev.get("screen"):
            entry["screens"][self._screen(ev["screen"])] += 1
        self._day(t)["clicks"] += 1
        value = max(paint or 0, req or 0)
        row = {"t": _iso(t), "control": ev.get("ctl"), "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")),
               "paint_ms": paint, "request_ms": req, "route": ev.get("route")}
        self.slowest.append((value, len(self.slowest), row))
        if len(self.slowest) > 400:
            self.slowest.sort(key=lambda r: (-r[0], r[1]))
            del self.slowest[SLOWEST * 4:]
        if slow:
            self._day(t)["slow"] += 1
            if len(self.slow_clicks) < 300:
                self.slow_clicks.append(row)

    def _on_long(self, ev, t, session):
        self.long_total += 1
        self.long_ms += ev.get("ms") or 0
        self._day(t)["slow"] += 1
        if len(self.long_tasks) < 200:
            self.long_tasks.append({"t": _iso(t), "ms": ev.get("ms"), "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")),
                                    "control": ev.get("ctl")})

    def _on_req(self, ev, t, session):
        key = (ev.get("method") or "GET", ev.get("route") or "?")
        stat = self.routes.setdefault(key, {"ms": _Stat(), "fail": 0})
        self.routes_seen.add(key)
        if ev.get("agg"):
            stat["ms"].add_agg(ev.get("n") or 0, ev.get("p50"), ev.get("max"))
            stat["fail"] += ev.get("fail") or 0
            return
        failed = (ev.get("status") or 0) >= 400 or bool(ev.get("err")) or ev.get("status") in (0, None)
        slow = bool(ev.get("slow")) or (ev.get("ms") or 0) > SLOW_REQUEST_MS
        stat["ms"].add(ev.get("ms"), slow)
        row = {"t": _iso(t), "method": key[0], "route": key[1], "status": ev.get("status"), "ms": ev.get("ms"),
               "error": ev.get("err"), "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen"))}
        if failed:
            stat["fail"] += 1
            self.failed_total += 1
            if len(self.failed) < 300:
                self.failed.append(row)
        if slow:
            self._day(t)["slow"] += 1
            if len(self.slow_reqs) < 200:
                self.slow_reqs.append(row)

    def _on_err(self, ev, t, session):
        count = ev.get("n") or 1
        self.error_total += count
        self._day(t)["errors"] += count
        key = (ev.get("kind") or "error", _norm_message(ev.get("msg")))
        group = self.errors.get(key)
        if group is None:
            if len(self.errors) >= 500:
                key = ("other", "(more kinds of error, see events.jsonl)")
                group = self.errors.get(key)
            if group is None:
                group = self.errors[key] = {"kind": key[0], "message": ev.get("msg"), "count": 0, "first": t, "last": t,
                                            "screens": Counter(), "where": None, "last_actions": None, "source": ev.get("src") or "browser"}
        group["count"] += count
        group["first"], group["last"] = min(group["first"], t), max(group["last"], t)
        if ev.get("screen"):
            group["screens"][SCREEN_NAMES.get(ev["screen"], ev["screen"])] += count
        if ev.get("file") or ev.get("where"):
            group["where"] = ev.get("where") or "%s:%s" % (ev.get("file"), ev.get("line"))
        if ev.get("last"):
            group["last_actions"] = ev.get("last")

    def _on_printer(self, ev, t, session):
        what = ev.get("ev")
        row = {"t": _iso(t), "event": what, "printer": ev.get("printer"), "file": ev.get("file"), "route": ev.get("route"),
               "words": ev.get("words") or ev.get("what"), "ms": ev.get("ms"), "demo": bool(ev.get("demo"))}
        if what in ("connect", "drop", "reconnect"):
            self.link[what] += 1
        elif what == "firmware":
            self.firmware[ev.get("printer") or "printer"] = ev.get("facts") or {}
            return
        elif what in ("print_started", "print_finished", "print_failed", "print_cancelled"):
            self.print_counts["demo" if ev.get("demo") else "real"][what] += 1
            if what == "print_started":
                self._day(t)["prints"] += 1
        elif what in ("refused", "unconfirmed"):
            if len(self.refused) < 300:
                self.refused.append(row)
        elif what == "confirmed":
            stat = self.confirmed.setdefault(str(ev.get("what") or "?"), _Stat())
            stat.add(ev.get("ms"))
            return
        elif what == "start_requested":
            gate = self.gate_by_file.get(_file_key(ev.get("file")))
            if gate is not None and t >= gate["_t"]:
                gate["went_on"] = True
        if len(self.timeline) < 1500:
            self.timeline.append(row)

    def _on_gate(self, ev, t, session):
        verdict = ev.get("verdict")
        row = {"t": _iso(t), "_t": t, "file": ev.get("file"), "verdict": verdict, "blocking": ev.get("blocking") or [],
               "warnings": ev.get("warnings") or [], "went_on": False}
        for reason in row["blocking"] + row["warnings"]:
            self.gate_reasons[_norm_message(reason)] += 1
        self.gate_by_file[_file_key(ev.get("file"))] = row
        if len(self.gates) < 500:
            self.gates.append(row)

    def _on_slice(self, ev, t, session):
        if len(self.slices) < 200:
            self.slices.append({"t": _iso(t), "engine": ev.get("engine"), "version": ev.get("version"), "ok": bool(ev.get("ok")),
                                "status": ev.get("status"), "seconds": ev.get("secs"), "stage": ev.get("stage"),
                                "cause": ev.get("cause"), "model": ev.get("model"), "report": ev.get("report")})

    def _on_convert(self, ev, t, session):
        if len(self.converts) < 200:
            self.converts.append({"t": _iso(t), "source": ev.get("source"), "ok": bool(ev.get("ok")), "plates": ev.get("plates"),
                                  "colours": ev.get("colours"), "warnings": ev.get("warnings") or [], "error": ev.get("error"),
                                  "file": ev.get("file")})

    def _on_fps(self, ev, t, session):
        surface = ev.get("surface")
        if surface in self.fps and len(self.fps[surface]) < 2000:
            self.fps[surface].append((ev.get("fps"), ev.get("triangles"), ev.get("layers"), ev.get("secs") or 3))

    def _on_feature(self, ev, t, session):
        if ev.get("name"):
            self.flags.add(ev["name"])

    def _on_note(self, ev, t, session):
        if len(self.notes) < 300:
            self.notes.append({"t": _iso(t), "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")),
                               "text": ev.get("text"), "last_actions": ev.get("last") or []})

    def _on_update(self, ev, t, session):
        self.updates.append({"t": _iso(t), "from": ev.get("from"), "to": ev.get("to"), "ok": bool(ev.get("ok")),
                             "words": ev.get("words")})

    def _on_thinned(self, ev, t, session):
        of, n = ev.get("of"), ev.get("n") or 0
        dropped = ev.get("dropped") or n
        self.thinned[of] += dropped
        self.thinned_total += dropped
        self._day(t)
        if of == "click":
            entry = self._control(str(ev.get("ctl") or "?"))
            entry["paint"].add_agg(n, ev.get("med"), ev.get("max"))
            if ev.get("screen"):
                entry["screens"][self._screen(ev["screen"])] += n
            self._day(t)["clicks"] += n
        elif of == "req":
            key = (ev.get("method") or "GET", ev.get("route") or "?")
            stat = self.routes.setdefault(key, {"ms": _Stat(), "fail": 0})
            self.routes_seen.add(key)
            stat["ms"].add_agg(n, ev.get("med"), ev.get("max"))
            stat["fail"] += ev.get("fail") or 0
        elif of == "screen":
            name = self._screen(str(ev.get("screen") or "?"))
            entry = self.screens.setdefault(name, {"opens": 0, "ms": 0})
            entry["opens"] += n
            entry["ms"] += ev.get("ms") or 0
        elif of == "fps":
            surface = ev.get("surface")
            if surface in self.fps:
                self.fps[surface].append((ev.get("med"), None, None, 3))

    # -- features ------------------------------------------------------------------
    def _feature_used(self, rules):
        for rule in rules:
            what = rule[0]
            if what == "screen" and rule[1] in self.screens_seen:
                return True
            if what == "kind" and self.kinds.get(rule[1]):
                return True
            if what == "flag" and rule[1] in self.flags:
                return True
            if what == "fps" and any(v[0] is not None for v in self.fps.get(rule[1], [])):
                return True
            if what == "route":
                pattern = re.compile(rule[2])
                if any(m == rule[1] and pattern.search(r) for m, r in self.routes_seen):
                    return True
            if what == "ctl":
                pattern = re.compile(rule[1])
                if any(pattern.search(c) for c in self.controls):
                    return True
        return False

    # -- the result -----------------------------------------------------------------
    def result(self, server_setup=None, now=None, export=None):
        now = now or time.time()
        for info in self.sessions.values():
            minutes = (info["visible_ms"] or max(0, info["end"] - info["start"])) / 60000.0
            self._day(info["start"])["minutes"] += minutes
        sessions = []
        for sid, info in sorted(self.sessions.items(), key=lambda kv: kv[1]["start"])[:500]:
            visible = info["visible_ms"] or max(0, info["end"] - info["start"])
            sessions.append({"start": _iso(info["start"]), "end": _iso(info["end"]), "minutes": round(visible / 60000.0, 1),
                             "device": info["device"] or "unknown", "screen": "%sx%s" % (info["w"], info["h"]) if info["w"] else None})
        controls = []
        for name, entry in self.controls.items():
            stat = entry["paint"]
            controls.append({"control": name, "count": stat.n, "median_ms": _round(stat.median()), "slowest_ms": _round(stat.max),
                             "slow_count": stat.slow, "screens": dict(entry["screens"].most_common(3))})
        controls.sort(key=lambda c: (-c["count"], c["control"]))
        slow_controls = sorted((c for c in controls if c["slow_count"]), key=lambda c: (-c["slow_count"], -(c["slowest_ms"] or 0)))
        self.slowest.sort(key=lambda r: (-r[0], r[1]))
        slowest = [dict(r[2], total_ms=r[0]) for r in self.slowest[:SLOWEST] if r[0]]
        routes = []
        for (method, route), entry in self.routes.items():
            stat = entry["ms"]
            routes.append({"method": method, "route": route, "count": stat.n, "failed": entry["fail"],
                           "median_ms": _round(stat.median()), "slowest_ms": _round(stat.max), "slow_count": stat.slow})
        routes.sort(key=lambda r: (-r["count"], r["route"]))
        groups = sorted(self.errors.values(), key=lambda g: (-g["count"], g["first"]))
        errors = [{"kind": g["kind"], "message": g["message"], "count": g["count"], "first": _iso(g["first"]),
                   "last": _iso(g["last"]), "screens": dict(g["screens"].most_common(4)), "where": g["where"],
                   "last_actions": g["last_actions"], "source": g["source"]} for g in groups]
        fps = {}
        for surface, rows in self.fps.items():
            values = [r[0] for r in rows if isinstance(r[0], (int, float))]
            if values:
                big = [r for r in rows if isinstance(r[0], (int, float)) and (r[1] or r[2])]
                worst = min(big, key=lambda r: r[0]) if big else None
                fps[surface] = {"samples": len(values), "median_fps": _round(_median(values)), "lowest_fps": _round(min(values)),
                                "highest_fps": _round(max(values)), "largest_triangles": max([r[1] or 0 for r in rows] or [0]) or None,
                                "largest_layers": max([r[2] or 0 for r in rows] or [0]) or None,
                                "lowest_at_size": {"fps": worst[0], "triangles": worst[1], "layers": worst[2]} if worst else None}
        features = []
        for fid, name, number, section, rules in FEATURES:
            features.append({"id": fid, "name": name, "used": self._feature_used(rules), "questions_section": number,
                             "questions_section_name": section})
        used = [f for f in features if f["used"]]
        confirmed = [{"what": what, "count": s.n, "median_ms": _round(s.median()), "slowest_ms": _round(s.max)}
                     for what, s in sorted(self.confirmed.items())]
        gate_totals = Counter(g["verdict"] for g in self.gates)
        went_on = sum(1 for g in self.gates if g["went_on"])
        for g in self.gates:
            g.pop("_t", None)
        for g in self.gate_by_file.values():
            g.pop("_t", None)
        days = [{"day": d, "sessions": len(v["sessions"]), "minutes": round(v["minutes"], 1), "clicks": v["clicks"],
                 "errors": v["errors"], "slow": v["slow"], "prints": v["prints"]} for d, v in sorted(self.days.items())]
        clicks_total = sum(c["count"] for c in controls)
        slow_total = sum(c["slow_count"] for c in controls) + len(self.slow_reqs) + self.long_total
        prints = {k: dict(v) for k, v in self.print_counts.items()}
        thinned_export = (export or {}).get("dropped", 0)
        approximate = bool(self.thinned_total or thinned_export)
        return {
            "schema_version": tester.SCHEMA_VERSION,
            "generated": _iso(now * 1000),
            "tool": "Deja Vu1 Tester mode",
            "summary": {
                "days_used": len([d for d in days if d["sessions"] or d["clicks"]]),
                "first": _iso(self.first) if self.first else None, "last": _iso(self.last) if self.last else None,
                "sessions": len(self.sessions), "minutes_open": round(sum(d["minutes"] for d in days), 1),
                "clicks": clicks_total, "screens_opened": sum(s["opens"] for s in self.screens.values()),
                "prints_started": prints["real"].get("print_started", 0), "prints_finished": prints["real"].get("print_finished", 0),
                "prints_failed": prints["real"].get("print_failed", 0), "prints_cancelled": prints["real"].get("print_cancelled", 0),
                "demo_prints_started": prints["demo"].get("print_started", 0),
                "errors_total": self.error_total, "error_groups": len(errors), "slow_spots": slow_total,
                "features_tried": len(used), "features_total": len(features), "events": self.events,
            },
            "setup": self._setup(server_setup),
            "sessions": sessions,
            "screens": {"order": self.screen_order, "totals": sorted(
                ({"screen": n, "opens": v["opens"], "seconds": round(v["ms"] / 1000.0)} for n, v in self.screens.items()),
                key=lambda s: -s["seconds"])},
            "clicks": {"total": clicks_total, "controls": controls[:300], "controls_not_shown": max(0, len(controls) - 300)},
            "slow": {"slowest_actions": slowest, "slow_clicks": self.slow_clicks[:100], "slow_requests": self.slow_reqs[:100],
                     "long_tasks": {"count": self.long_total, "total_ms": round(self.long_ms), "examples": self.long_tasks[:60]},
                     "per_control": slow_controls[:60], "thresholds_ms": {"click": SLOW_CLICK_MS, "request": SLOW_REQUEST_MS,
                                                                           "long_task": tester.LONG_TASK_MS}},
            "requests": {"routes": routes[:200], "routes_not_shown": max(0, len(routes) - 200), "failed_total": self.failed_total,
                         "failed": self.failed},
            "errors": {"total": self.error_total, "groups": errors},
            "printer": {"connections": dict(self.link), "firmware": self.firmware, "prints": prints,
                        "confirmed_by_printer": confirmed, "refused": self.refused, "timeline": self.timeline},
            "confirm_print": {"checks": len(self.gates), "by_verdict": dict(gate_totals), "went_on_to_print": went_on,
                              "reasons": [{"reason": r, "count": c} for r, c in self.gate_reasons.most_common(30)],
                              "list": self.gates},
            "slicing": self.slices, "converter": self.converts, "smoothness": fps,
            "features": {"used": [f["name"] for f in used], "not_used": [f["name"] for f in features if not f["used"]],
                         "detail": features},
            "notes": self.notes, "updates": self.updates, "timeline": days,
            "thinning": {"happened": approximate, "dropped_events": self.thinned_total + thinned_export,
                         "dropped_from_events_file": thinned_export, "summed_up_on_disk": self.thinned_total,
                         "by_kind": dict(Counter(self.thinned) + Counter((export or {}).get("by_kind") or {})), "limit_mb": round((export or {}).get("limit", tester.EXPORT_LIMIT) / 1048576.0),
                         "medians_are_estimates": approximate},
            "never_recorded": NEVER,
        }

    def _setup(self, server):
        browsers = []
        for t, setup in sorted(self.setups.values(), key=lambda item: item[0]):
            if setup not in browsers:
                browsers.append(setup)
        return {"server": server or {}, "browsers": browsers[-12:]}


def build_report(paths=None, server_setup=None, now=None, export=None):
    agg = Aggregator()
    for event in iter_events(paths if paths is not None else tester.event_files()):
        agg.add(event)
    return agg.result(server_setup=server_setup, now=now, export=export)


# ---------------------------------------------------------------------------
# What is on this computer (the report's Setup)
# ---------------------------------------------------------------------------

def _os_name():
    system = platform.system()
    try:
        if system == "Windows":
            return "Windows %s (%s)" % (platform.release(), platform.version())
        if system == "Darwin":
            return "macOS %s" % (platform.mac_ver()[0] or platform.release())
        if system == "Linux":
            try:
                with open("/etc/os-release", encoding="utf-8") as handle:
                    for line in handle:
                        if line.startswith("PRETTY_NAME="):
                            return line.split("=", 1)[1].strip().strip('"')
            except OSError:
                pass
            return "Linux %s" % platform.release()
    except Exception:                   # noqa: BLE001
        pass
    return system or "unknown"


def setup_facts():
    """What the server knows: versions, the computer, which modules are on. No names, no addresses."""
    facts = {"os": _os_name(), "python": platform.python_version(), "machine": platform.machine()}
    try:
        import app_updates
        facts["app_version"] = app_updates.version()
    except Exception:                   # noqa: BLE001
        facts["app_version"] = None
    try:
        import fleet
        facts["printers_added"] = len(fleet.registered())
    except Exception:                   # noqa: BLE001
        facts["printers_added"] = None
    try:
        rows = modules.get_all()
        facts["modules_on"] = sorted(m["id"] for m in rows if m["enabled"])
        facts["modules_off"] = sorted(m["id"] for m in rows if not m["enabled"])
    except Exception:                   # noqa: BLE001
        pass
    try:
        import watch_only
        facts["watch_only"] = bool(watch_only.is_on())
    except Exception:                   # noqa: BLE001
        facts["watch_only"] = None
    try:
        import slicer_bridge
        check = (slicer_bridge.get_settings() or {}).get("last_check") or {}
        facts["engine"] = {"app": check.get("app"), "version": check.get("version"), "ok": check.get("ok")} if check else None
    except Exception:                   # noqa: BLE001
        facts["engine"] = None
    return {k: (tester.version_text(v) if isinstance(v, str) else v) for k, v in facts.items()}


# ---------------------------------------------------------------------------
# report.html: one page, no scripts, nothing loaded from outside
# ---------------------------------------------------------------------------

def _h(value):
    return html.escape("" if value is None else str(value), quote=True)


def _ms(value):
    """A duration as plain text (escape it where it is put into a page)."""
    if value is None:
        return "\u2013"
    value = float(value)
    return "%d ms" % value if value < 1000 else "%.1f s" % (value / 1000.0)


def _plural(n, one, many=None):
    return "%s %s" % (n, one if n == 1 else (many or one + "s"))


def _hm(minutes):
    minutes = float(minutes or 0)
    if minutes < 60:
        return "%d min" % round(minutes)
    return "%d h %02d min" % (minutes // 60, round(minutes % 60))


def _table(headers, rows, caption=None, cls=""):
    if not rows:
        return ""
    head = "".join("<th scope=\"col\">%s</th>" % _h(h) for h in headers)
    body = "".join("<tr>%s</tr>" % "".join(c if isinstance(c, _Raw) else "<td>%s</td>" % _h(c) for c in row) for row in rows)
    cap = "<caption class=\"sr\">%s</caption>" % _h(caption) if caption else ""
    return "<div class=\"scroll\"><table class=\"%s\">%s<thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>" % (cls, cap, head, body)


class _Raw(str):
    """A table cell that is already safe HTML (built here from escaped parts)."""


def _cell(text, cls=""):
    return _Raw("<td%s>%s</td>" % (" class=\"%s\"" % cls if cls else "", _h(text)))


def _empty(text):
    return "<p class=\"empty\">%s</p>" % _h(text)


_CSS = """
:root{color-scheme:light dark;--bg:#f4f5f8;--card:#fff;--ink:#1c1c1e;--dim:#48484a;--faint:#636366;--line:#d8dbe3;
--accent:#0a64d6;--fill:#4a8df8;--warn:#8a4b00;--warn-bg:#fff4df;--bad:#b42318;--bad-bg:#fdecea;--ok:#17692f;--ok-bg:#e6f5ea;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121316;--card:#1b1d22;--ink:#f2f2f4;--dim:#d0d0d6;--faint:#a6a6ae;
--line:#2f323a;--accent:#7db2ff;--fill:#6aa6ff;--warn:#f5b86a;--warn-bg:#2b2113;--bad:#ff9d94;--bad-bg:#2c1614;--ok:#7bd99a;--ok-bg:#13251a}}
:root[data-theme="dark"]{--bg:#121316;--card:#1b1d22;--ink:#f2f2f4;--dim:#d0d0d6;--faint:#a6a6ae;--line:#2f323a;--accent:#7db2ff;
--fill:#6aa6ff;--warn:#f5b86a;--warn-bg:#2b2113;--bad:#ff9d94;--bad-bg:#2c1614;--ok:#7bd99a;--ok-bg:#13251a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);overflow-wrap:anywhere}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
header.top{padding:8px 0 20px}.kicker{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:clamp(1.6rem,4vw+1rem,2.6rem);line-height:1.1;margin:.4rem 0 .5rem;text-wrap:balance}
h2{font-size:1.25rem;margin:0 0 .75rem;text-wrap:balance}h3{font-size:1rem;margin:1.1rem 0 .4rem}
p{margin:.35rem 0}.sub{color:var(--dim);max-width:62ch;text-wrap:pretty}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px;margin:0 0 16px}
section.hero{padding:22px 18px}.lead{font-size:1.1rem;line-height:1.55;max-width:70ch;text-wrap:pretty}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0 0;padding:0;list-style:none}
.tile{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}
.tile b{display:block;font:700 1.9rem/1.1 var(--mono);font-variant-numeric:tabular-nums}.tile span{color:var(--dim);font-size:.9rem}
.tile.bad b{color:var(--bad)}.tile.warn b{color:var(--warn)}.tile.ok b{color:var(--ok)}
.scroll{overflow-x:auto;margin:.4rem 0 .2rem;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);white-space:nowrap}
td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
td.mono{font-family:var(--mono);font-size:.85rem}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:.8rem;font-weight:600;border:1px solid currentColor}
.pill.ok{color:var(--ok);background:var(--ok-bg)}.pill.bad{color:var(--bad);background:var(--bad-bg)}.pill.warn{color:var(--warn);background:var(--warn-bg)}
.pill.off{color:var(--faint)}dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 16px;margin:0}dt{color:var(--dim)}dd{margin:0}
.empty{color:var(--faint);font-style:italic}.note{border-left:3px solid var(--accent);padding:6px 12px;margin:8px 0;background:var(--bg);border-radius:0 8px 8px 0}
.note small,.small{color:var(--faint);font-size:.85rem}details{margin:.5rem 0}summary{cursor:pointer;color:var(--accent);font-weight:600}
summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font:.8rem/1.45 var(--mono);white-space:pre-wrap}
.beat{display:block;width:100%;height:auto;margin:10px 0 2px}.beat text{font:11px var(--mono);fill:var(--faint)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.featgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;padding:0;margin:8px 0;list-style:none}
.featgrid li{display:flex;gap:8px;align-items:baseline;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.featgrid small{color:var(--faint);display:block}.featgrid .pill{flex:none;white-space:nowrap}footer{color:var(--faint);font-size:.85rem;margin-top:24px}
@media(max-width:560px){section{padding:14px 12px}dl{grid-template-columns:1fr}dt{margin-top:6px}}
@media print{body{background:#fff}section{break-inside:avoid;border-color:#bbb}details{display:block}}
"""


def _beat(days):
    """The signature: one bar per day (how much they used it), a red mark for errors, an amber one for slow spots."""
    if not days:
        return ""
    count = len(days)
    width, height, pad = max(320, min(1040, 56 * count + 40)), 120, 22
    biggest = max([d["clicks"] for d in days] + [1])
    step = (width - 2 * pad) / float(max(count, 1))
    bar = min(40.0, step * 0.55)
    parts = ["<svg class=\"beat\" viewBox=\"0 0 %d %d\" style=\"max-width:%dpx\" role=\"img\" aria-label=\"%s\">" % (
        width, height, width, _h("Activity for each day: %s" % "; ".join(
            "%s %s, %s, %s" % (d["day"], _plural(d["clicks"], "action"), _plural(d["errors"], "error"), _plural(d["slow"], "slow spot")) for d in days)))]
    base = height - 26
    parts.append("<line x1=\"%d\" y1=\"%d\" x2=\"%d\" y2=\"%d\" stroke=\"currentColor\" opacity=\".25\"/>" % (pad, base, width - pad, base))
    for i, d in enumerate(days):
        x = pad + i * step + (step - bar) / 2.0
        h = 0 if not d["clicks"] else max(3.0, (base - 18) * d["clicks"] / float(biggest))
        parts.append("<rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"%.1f\" rx=\"4\" fill=\"var(--fill)\"/>" % (x, base - h, bar, h))
        mid = x + bar / 2.0
        if d["errors"]:
            parts.append("<circle cx=\"%.1f\" cy=\"10\" r=\"5\" fill=\"var(--bad)\"><title>%s</title></circle>" % (mid - 7, _h(_plural(d["errors"], "error"))))
        if d["slow"]:
            parts.append("<rect x=\"%.1f\" y=\"5\" width=\"10\" height=\"10\" rx=\"2\" fill=\"var(--warn)\"><title>%s</title></rect>" % (mid + 2, _h(_plural(d["slow"], "slow spot"))))
        parts.append("<text x=\"%.1f\" y=\"%d\" text-anchor=\"middle\">%s</text>" % (mid, height - 8, _h(d["day"][5:])))
    parts.append("</svg>")
    return "".join(parts)


def render_html(report, theme=None, sample=False):
    s, setup = report["summary"], report["setup"]
    server = setup.get("server") or {}
    thin = report["thinning"]
    out = []
    add = out.append
    theme_attr = " data-theme=\"%s\"" % theme if theme in ("light", "dark") else ""
    add("<!doctype html><html lang=\"en\"%s><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<meta name=\"color-scheme\" content=\"light dark\"><title>Deja Vu1 tester report</title><style>%s</style></head><body><main>" % (theme_attr, _CSS))
    span = "%s to %s" % (_h((s["first"] or "")[:10]), _h((s["last"] or "")[:10])) if s["first"] else "no use recorded yet"
    if sample:
        add("<header class=\"top\"><div class=\"kicker\">Deja Vu1 tester report &middot; sample</div><h1>How Deja Vu1 behaved on this computer</h1>"
            "<p class=\"note\"><b>Sample report.</b> Every number on this page is made up to show the layout, for the online demo. "
            "Nothing here was recorded on your computer. A real report holds your own use of the app.</p></header>")
    else:
        add("<header class=\"top\"><div class=\"kicker\">Deja Vu1 tester report</div><h1>How Deja Vu1 behaved on this computer</h1>"
            "<p class=\"sub\">Written %s from %s. Everything here was recorded on this computer. Nothing was sent anywhere; you send this file yourself.</p></header>"
            % (_h(report["generated"].replace("T", " ")), span))

    # Summary in plain words
    bad = s["errors_total"] > 0
    add("<section class=\"hero\" aria-labelledby=\"sum\"><h2 id=\"sum\">The short version</h2><p class=\"lead\">")
    add("Deja Vu1 was open on <b>%s</b> in <b>%s</b>, for <b>%s</b> in all. " % (_plural(s["days_used"], "day"), _plural(s["sessions"], "session"), _hm(s["minutes_open"])))
    add("Buttons and controls were pressed %s across %s. " % (_plural(s["clicks"], "time"), _plural(s["screens_opened"], "screen visit")))
    add("%s started on a printer, %s finished, %s failed and %s were cancelled%s. " % (
        _plural(s["prints_started"], "print"), s["prints_finished"], s["prints_failed"], s["prints_cancelled"],
        " (%s more on demo data)" % s["demo_prints_started"] if s["demo_prints_started"] else ""))
    add("There %s <b>%s</b> in <b>%s</b> and <b>%s</b>. " % (
        "was" if s["errors_total"] == 1 else "were", _plural(s["errors_total"], "error"), _plural(s["error_groups"], "kind"), _plural(s["slow_spots"], "slow spot")))
    add("<b>%d of %d</b> main features were tried.</p>" % (s["features_tried"], s["features_total"]))
    add("<ul class=\"tiles\">")
    for value, label, cls in ((s["days_used"], "days used", ""), (s["prints_started"], "prints started", ""),
                              (s["errors_total"], "errors", "bad" if bad else "ok"), (s["slow_spots"], "slow spots", "warn" if s["slow_spots"] else "ok"),
                              ("%d / %d" % (s["features_tried"], s["features_total"]), "features tried", "")):
        add("<li class=\"tile %s\"><b>%s</b><span>%s</span></li>" % (cls, _h(value), _h(label)))
    add("</ul>")
    if thin["happened"]:
        add("<p class=\"note\"><b>Thinned:</b> the record passed %s MB, so %s routine events (clicks that were not slow, background requests that worked, "
            "screen visits) were summed up into one line per day. Every error, every slow action, every note and the printer's story are kept whole, and "
            "the totals above were counted before anything was dropped. Medians for thinned controls are estimates.</p>" % (_h(thin["limit_mb"]), _h(thin["dropped_events"])))
    add("</section>")

    add("<section aria-labelledby=\"days\"><h2 id=\"days\">Day by day</h2><p class=\"small\">Bars are actions per day. A red dot marks errors, an amber square marks slow spots.</p>%s" % _beat(report["timeline"]))
    add(_table(["Day", "Sessions", "Open", "Actions", "Prints", "Errors", "Slow spots"],
               [[d["day"], _cell(d["sessions"], "n"), _cell(_hm(d["minutes"]), "n"), _cell(d["clicks"], "n"), _cell(d["prints"], "n"),
                 _cell(d["errors"], "n"), _cell(d["slow"], "n")] for d in report["timeline"]], "Each day"))
    if not report["timeline"]:
        add(_empty("Nothing has been recorded yet."))
    add("</section>")

    # Setup
    add("<section aria-labelledby=\"setup\"><h2 id=\"setup\">Setup</h2><dl>")
    for label, value in (("Deja Vu1", server.get("app_version")), ("Computer", server.get("os")), ("Python", server.get("python")),
                         ("Printers added", server.get("printers_added")), ("Watch-only", {True: "on", False: "off"}.get(server.get("watch_only"))),
                         ("Slicing engine", " ".join(str(x) for x in ((server.get("engine") or {}).get("app"), (server.get("engine") or {}).get("version")) if x) or "none set up")):
        add("<dt>%s</dt><dd>%s</dd>" % (_h(label), _h(value if value not in (None, "") else "not recorded")))
    for name, facts in sorted((report["printer"].get("firmware") or {}).items()):
        add("<dt>Firmware, %s</dt><dd>%s</dd>" % (_h(name), _h(", ".join("%s %s" % (k, v) for k, v in sorted(facts.items())) or "the printer reported no version")))
    for b in setup.get("browsers", []):
        add("<dt>Browser</dt><dd>%s %s on %s, %sx%s px at %sx, %s look, %s, %s</dd>" % (
            _h(b.get("browser")), _h(b.get("bver")), _h(b.get("ua_os")), _h(b.get("w")), _h(b.get("h")), _h(b.get("dpr")), _h(b.get("look")),
            _h(b.get("theme")), _h(b.get("lang"))))
    add("</dl>")
    if server.get("modules_off"):
        add("<p class=\"small\">Switched off: %s</p>" % _h(", ".join(server["modules_off"])))
    add("</section>")

    # Slowest actions
    slow = report["slow"]
    add("<section aria-labelledby=\"slow\"><h2 id=\"slow\">The slowest 25 actions</h2><p class=\"small\">A click counts as slow when the screen took over %s to change; a request over %s; "
        "the browser itself freezing for over %s is a long task.</p>" % (_h(_ms(slow["thresholds_ms"]["click"])), _h(_ms(slow["thresholds_ms"]["request"])), _h(_ms(slow["thresholds_ms"]["long_task"]))))
    add(_table(["When", "Control", "Screen", "Screen changed after", "Request finished after"],
               [[r["t"].replace("T", " "), r["control"], r["screen"], _cell(_ms(r["paint_ms"]), "n"), _cell(_ms(r["request_ms"]), "n")] for r in slow["slowest_actions"]], "Slowest actions") or _empty("No actions recorded."))
    if slow["per_control"]:
        add("<h3>Controls that were slow more than once</h3>")
        add(_table(["Control", "Pressed", "Slow", "Median", "Slowest"], [[c["control"], _cell(c["count"], "n"), _cell(c["slow_count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n")] for c in slow["per_control"][:25]]))
    if slow["slow_requests"]:
        add("<h3>Requests over %s</h3>" % _h(_ms(slow["thresholds_ms"]["request"])))
        add(_table(["When", "Request", "Status", "Time", "Screen"], [[r["t"].replace("T", " "), "%s %s" % (r["method"], r["route"]), r["status"], _cell(_ms(r["ms"]), "n"), r["screen"]] for r in slow["slow_requests"][:30]]))
    lt = slow["long_tasks"]
    add("<h3>Browser freezes</h3>")
    add("<p>%s over %s, %s in total.</p>" % (_h(_plural(lt["count"], "long task")), _h(_ms(slow["thresholds_ms"]["long_task"])), _h(_ms(lt["total_ms"]))) if lt["count"] else _empty("No freezes over %s." % _ms(slow["thresholds_ms"]["long_task"])))
    add(_table(["When", "Length", "Screen"], [[r["t"].replace("T", " "), _cell(_ms(r["ms"]), "n"), r["screen"]] for r in lt["examples"][:20]]))
    add("</section>")

    # Errors
    errs = report["errors"]
    add("<section aria-labelledby=\"err\"><h2 id=\"err\">Errors</h2>")
    if not errs["groups"]:
        add(_empty("No errors were recorded."))
    for g in errs["groups"][:60]:
        add("<div class=\"note\"><span class=\"pill bad\">%s</span> <b>%s</b><br><small>%s &middot; first %s, last %s%s</small>" % (
            _h(g["kind"]), _h(g["message"]), _plural(g["count"], "time"), _h(g["first"].replace("T", " ")), _h(g["last"].replace("T", " ")),
            " &middot; on %s" % _h(", ".join(g["screens"])) if g["screens"] else ""))
        if g["where"]:
            add("<br><small>Where: %s</small>" % _h(g["where"] if isinstance(g["where"], str) else " / ".join(g["where"])))
        if g["last_actions"]:
            add("<details><summary>The last %d actions before it</summary><pre>%s</pre></details>" % (len(g["last_actions"]), _h("\n".join(g["last_actions"]))))
        add("</div>")
    if len(errs["groups"]) > 60:
        add("<p class=\"small\">%d more kinds of error are in report.json.</p>" % (len(errs["groups"]) - 60))
    failed = report["requests"]["failed"]
    if failed:
        add("<details><summary>%s failed in full</summary>" % _plural(report["requests"]["failed_total"], "request"))
        add(_table(["When", "Request", "Status", "Time", "What the app said"], [[r["t"].replace("T", " "), "%s %s" % (r["method"], r["route"]), r["status"], _cell(_ms(r["ms"]), "n"), r["error"]] for r in failed[:150]]))
        add("</details>")
    add("</section>")

    # The printer
    pr = report["printer"]
    add("<section aria-labelledby=\"pr\"><h2 id=\"pr\">The printer</h2>")
    link = pr["connections"]
    add("<p>Connected %s, dropped %s, reconnected %s.</p>" % (_plural(link.get("connect", 0), "time"), _plural(link.get("drop", 0), "time"), _plural(link.get("reconnect", 0), "time")))
    if pr["confirmed_by_printer"]:
        add("<h3>Commands the printer confirmed</h3>")
        add(_table(["Command", "Times", "Median", "Slowest"], [[c["what"], _cell(c["count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n")] for c in pr["confirmed_by_printer"]]))
    if pr["refused"]:
        add("<h3>Commands that were refused</h3>")
        add(_table(["When", "Printer or route", "In the app's words"], [[r["t"].replace("T", " "), r["route"] or r["printer"] or "", r["words"]] for r in pr["refused"][:100]]))
    add("<h3>Timeline</h3>")
    add(_table(["When", "What happened", "Printer", "File"], [[r["t"].replace("T", " "), (r["event"] or "").replace("_", " ") + (" (demo)" if r["demo"] else ""), r["printer"], r["file"]] for r in pr["timeline"][:200]]) or _empty("No printer events recorded."))
    add("</section>")

    cp = report["confirm_print"]
    add("<section aria-labelledby=\"cp\"><h2 id=\"cp\">Confirm Print</h2>")
    add("<p>%s: %s clear, %s needed a confirm, %s refused. %s went on to a print.</p>" % (
        _plural(cp["checks"], "check"), cp["by_verdict"].get("clear", 0), cp["by_verdict"].get("confirm", 0), cp["by_verdict"].get("blocked", 0), cp["went_on_to_print"]) if cp["checks"] else _empty("Confirm Print was not used."))
    if cp["reasons"]:
        add(_table(["Reason shown", "Times"], [[r["reason"], _cell(r["count"], "n")] for r in cp["reasons"][:20]]))
    add(_table(["When", "File", "Result", "Went on", "Reasons"], [[r["t"].replace("T", " "), r["file"], _Raw("<td><span class=\"pill %s\">%s</span></td>" % ({"clear": "ok", "confirm": "warn", "blocked": "bad"}.get(r["verdict"], "off"), _h(r["verdict"]))), "yes" if r["went_on"] else "no", "; ".join(r["blocking"] + r["warnings"])] for r in cp["list"][:100]]))
    add("</section>")

    add("<section aria-labelledby=\"sl\"><h2 id=\"sl\">Slicing and converting</h2><h3>Slices</h3>")
    add(_table(["When", "Engine", "Result", "Time", "Model", "Stage"], [[r["t"].replace("T", " "), ("%s %s" % (r["engine"] or "", r["version"] or "")).strip(), _Raw("<td><span class=\"pill %s\">%s</span></td>" % ("ok" if r["ok"] else "bad", "worked" if r["ok"] else _h(r["status"] or "failed"))), _ms(r["seconds"] * 1000) if r["seconds"] is not None else "", r["model"], r["stage"]] for r in report["slicing"][:60]]) or _empty("No slices recorded."))
    for r in report["slicing"]:
        if r.get("report"):
            add("<details><summary>Report for help, %s</summary><pre>%s</pre></details>" % (_h(r["t"].replace("T", " ")), _h(r["report"])))
    add("<h3>Conversions</h3>")
    add(_table(["When", "Source", "Result", "Plates", "Colours", "Warnings shown"], [[r["t"].replace("T", " "), r["source"], _Raw("<td><span class=\"pill %s\">%s</span></td>" % ("ok" if r["ok"] else "bad", "worked" if r["ok"] else "failed")), r["plates"], r["colours"], "; ".join(r["warnings"] or []) or (r["error"] or "")] for r in report["converter"][:60]]) or _empty("No conversions recorded."))
    add("</section>")

    sm = report["smoothness"]
    add("<section aria-labelledby=\"fp\"><h2 id=\"fp\">Smoothness</h2><p class=\"small\">Frames per second the page drew while the 3D twin or the G-code preview was on screen, sampled a few seconds at a time.</p>")
    if sm:
        add(_table(["Surface", "Samples", "Median", "Lowest", "Largest model", "Slowest sample at"], [[{"twin": "3D twin", "gcode": "G-code preview"}.get(k, k), _cell(v["samples"], "n"), _cell("%s fps" % v["median_fps"], "n"), _cell("%s fps" % v["lowest_fps"], "n"), ("%s layers" % v["largest_layers"]) if v["largest_layers"] else (("%s triangles" % v["largest_triangles"]) if v["largest_triangles"] else "not recorded"), ("%s layers" % v["lowest_at_size"]["layers"] if v["lowest_at_size"] and v["lowest_at_size"]["layers"] else "")] for k, v in sorted(sm.items())]))
    else:
        add(_empty("The twin and the G-code preview were not on screen long enough to sample."))
    add("</section>")

    add("<section aria-labelledby=\"ft\"><h2 id=\"ft\">Features used and not used</h2><p class=\"small\">Used means the tester opened it or pressed one of its controls at least once. "
        "The section is where the tester questions sheet asks about it.</p><ul class=\"featgrid\">")
    for f in report["features"]["detail"]:
        add("<li><span class=\"pill %s\">%s</span><span>%s<small>Questions, section %s: %s</small></span></li>" % ("ok" if f["used"] else "off", "used" if f["used"] else "not used", _h(f["name"]), f["questions_section"], _h(f["questions_section_name"])))
    add("</ul></section>")

    add("<section aria-labelledby=\"nt\"><h2 id=\"nt\">Their notes</h2><p class=\"small\">The only place typed text is kept: the notes written with the \"Something felt off\" button.</p>")
    for n in report["notes"]:
        add("<div class=\"note\"><b>%s</b> <small>%s &middot; on %s</small>" % (_h(n["text"]), _h(n["t"].replace("T", " ")), _h(n["screen"] or "unknown")))
        if n["last_actions"]:
            add("<details><summary>The last %d actions</summary><pre>%s</pre></details>" % (len(n["last_actions"]), _h("\n".join(n["last_actions"]))))
        add("</div>")
    if not report["notes"]:
        add(_empty("No notes were written."))
    add("</section>")

    sc = report["screens"]
    add("<section aria-labelledby=\"wh\"><h2 id=\"wh\">Where they went</h2>")
    add(_table(["Screen", "Visits", "Time open"], [[r["screen"], _cell(r["opens"], "n"), _cell(_hm(r["seconds"] / 60.0), "n")] for r in sc["totals"]]) or _empty("No screens recorded."))
    add("<details><summary>The controls pressed most</summary>")
    add(_table(["Control", "Pressed", "Median", "Slowest", "On"], [[c["control"], _cell(c["count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n"), ", ".join(c["screens"])] for c in report["clicks"]["controls"][:60]]))
    add("</details><details><summary>Every kind of request</summary>")
    add("<p class=\"small\">Routine background reads are summed up in five-minute groups; every other request, and every failed or slow one, is recorded on its own.</p>")
    add(_table(["Request", "Times", "Failed", "Median", "Slowest"], [["%s %s" % (r["method"], r["route"]), _cell(r["count"], "n"), _cell(r["failed"], "n"), _cell(_ms(r["median_ms"]), "n"), _cell(_ms(r["slowest_ms"]), "n")] for r in report["requests"]["routes"][:80]]))
    add("</details></section>")

    add("<section aria-labelledby=\"up\"><h2 id=\"up\">Updates</h2>")
    add(_table(["When", "From", "To", "Result", "What it said"], [[u["t"].replace("T", " "), u["from"], u["to"], _Raw("<td><span class=\"pill %s\">%s</span></td>" % ("ok" if u["ok"] else "bad", "worked" if u["ok"] else "did not work")), u["words"]] for u in report["updates"]]) or _empty("No self-update happened during the test."))
    add("</section>")

    add("<section aria-labelledby=\"nv\"><h2 id=\"nv\">What this report never holds</h2><ul>%s</ul>"
        "<p class=\"small\">Anything that looks like an IP address, a key, a Wi-Fi name or a home-folder path is replaced before it is written. "
        "events.jsonl in the same zip is the raw record: open it in any text editor to check.</p></section>" % "".join("<li>%s</li>" % _h(n) for n in report["never_recorded"]))
    add("<footer>report.json holds the same data for machines (schema_version %s). Made by Deja Vu1's Tester mode.</footer></main></body></html>" % _h(report["schema_version"]))
    return "".join(out)


# ---------------------------------------------------------------------------
# The zip
# ---------------------------------------------------------------------------

README = """Deja Vu1 tester report
======================

This zip holds four files. Nothing in it was sent anywhere: Deja Vu1 saved it on this computer and you
attach it to a forum message yourself.

report.html   The report. Open it in any browser; it works with no internet and runs no scripts.
report.json   The same numbers as data, with a schema_version, so several reports can be combined later.
events.jsonl  The raw record, one event per line, after private details were hidden. Open it in any text
              editor if you want to check what was kept.
README.txt    This file.

What is recorded: how the app was used (screens, button presses and how long the screen took to change),
every error, every slow request, the printer's connects, drops, refused commands and print results,
Confirm Print results, slices and conversions (engine, worked or not, how long), how smoothly the 3D twin
and the G-code preview drew, which features were tried, any notes you wrote with "Something felt off",
and any self-update.

What is never recorded:
%s

Before anything is saved, text that looks like an IP address, an API key or password, a Wi-Fi name, a
serial number, a home-folder path (such as /Users/<name>/ or C:\\Users\\<name>\\) or a file name is
replaced with a marker such as <ip> or "file 3". A file is only described as "file 3, .3mf, 2.4 MB".
If a message mentions a file the app does not know, a few words of its name might remain, so read
events.jsonl before you send it. You can delete everything in Settings, Tester mode, Delete tester data.

Thinning: if the record grows past %d MB, the oldest routine events (clicks that were not slow, background
requests that worked, screen visits) are summed up into one line per day and control. Errors, slow
actions, notes and the printer's story are never thinned. The report says if this happened and how many
events it dropped.
"""


def build_zip(now=None, theme=None):
    """(filename, bytes): the saved tester report. Raises ValueError when nothing has been recorded."""
    now = now or time.time()
    paths = tester.event_files()
    if not paths:
        raise ValueError("Nothing has been recorded yet. Use Deja Vu1 for a while with Tester mode on, then save the report")
    tmp = os.path.join(tester.folder(), ".export-events.tmp")
    try:
        export = thin_files(paths, tmp, tester.EXPORT_LIMIT)
        report = build_report(paths, server_setup=setup_facts(), now=now, export=export)
        page = render_html(report, theme)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr("report.html", page)
            archive.writestr("report.json", json.dumps(report, indent=2, ensure_ascii=False))
            archive.write(tmp, "events.jsonl")
            archive.writestr("README.txt", README % ("\n".join("  - " + n for n in NEVER), tester.EXPORT_LIMIT // 1048576))
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    name = "deja-vu1-tester-report-%s.zip" % time.strftime("%Y-%m-%d", time.localtime(now))
    return name, buffer.getvalue()


def build_html(theme=None, now=None):
    """The same report as one page, for the in-app viewer."""
    return render_html(build_report(server_setup=setup_facts(), now=now), theme)
