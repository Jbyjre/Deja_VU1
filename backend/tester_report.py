"""
tester_report.py
================

The reading half of Tester mode: it takes the events tester.py recorded, and the answers tester_study.py
kept, and turns them into

  - totals for the Settings card,
  - report.json (the data, with a schema_version),
  - report.html (one page that opens offline, with no scripts and nothing loaded from outside),
  - findings.md (what to fix first, in plain text a developer can paste into a work session),
  - events.jsonl (the raw events after masking and thinning),
  - README.txt,

all packed into one zip the tester attaches to a forum message. Nothing here touches the network.

Thinning: when the raw events would pass EXPORT_LIMIT, the oldest routine ones (clicks that were not
slow, background requests that worked, screen visits, smoothness samples) are replaced by one summary
line per day and control. Errors, slow actions, notes and the printer's story are never thinned, and
the report's totals are counted before anything is dropped.
"""

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
import tester_questions
import tester_study
from tester_report_render import README, render_findings, render_html  # the report's pages (split out)

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
         "anything typed into a field, except the notes you write with \"Something felt off\" and your answers to the questions",
         "the contents of the printer's G-code"]

# What kind of error it is, in words: (short label, what it usually means).
CATEGORIES = {
    "app_bug": ("A script error in the page", "Deja Vu1's own page code threw this. Treat it as a bug unless the file and line point at a browser extension."),
    "server_bug": ("The server hit an error", "The Deja Vu1 server failed while answering. The lines under Where show the place in the code."),
    "network": ("The page could not reach the server", "The page lost its link to the Deja Vu1 server: it was restarting, the computer slept or the connection dropped."),
    "toast": ("An error the app showed", "A message the app put on screen. The words are the app's own, so they are what the tester read."),
    "resource": ("Something failed to load", "A script, style, picture or video did not load. Camera pictures that fail show up here."),
    "csp": ("The browser blocked something", "The page tried to load something its own security rules forbid."),
    "console": ("Logged as an error by the page", "The page wrote this to the browser's error log without crashing."),
    "other": ("An error", ""),
}
_NETWORK_WORDS = re.compile(r"(?i)failed to fetch|networkerror|network error|load failed|network connection was lost|err_connection|"
                            r"err_network|err_internet|the user aborted")
_CLICK_BUCKETS = ((100, "up to 100 ms"), (300, "100 to 300 ms"), (1000, "0.3 to 1 s"), (3000, "1 to 3 s"), (float("inf"), "over 3 s"))
# The screens a person opens, as the report's areas (a screen is the first part of the address, see tester.js).
AREA_NAMES = {"overview": "Overview", "printers": "Printers", "printer": "Printer page", "files": "Files", "slice": "Slicing",
              "queue": "Queue", "filament": "Filament", "maintenance": "Maintenance", "settings": "Settings", "ai": "AI assistant",
              "studio": "Photo Studio", "automations": "Automations", "insights": "Insights", "logbook": "Care log"}
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
# When no feature rule matches a request, its address still says which part of the app it belongs to.
ROUTE_AREAS = (("/api/printer/control/", "Printer page controls"), ("/api/print/", "Confirm Print"), ("/api/files", "Files"),
               ("/api/slicer", "Slicing"), ("/api/convert", "Converter"), ("/api/colours", "Converter"), ("/api/queue", "Print queue"),
               ("/api/filament", "Filament"), ("/api/maintenance", "Maintenance"), ("/api/camera", "Camera"), ("/api/timelapse", "Time-lapses"),
               ("/api/assistant", "AI assistant"), ("/api/app/", "Updates"), ("/api/updates", "Updates"), ("/api/fleet", "Printers"),
               ("/api/printers", "Printers"), ("/api/notifications", "Notifications"), ("/api/automations", "Automations"),
               ("/api/remote", "Away from home"), ("/api/pairing", "Phone"), ("/api/modules", "Settings"), ("/api/studio", "Photo Studio"))


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


def _percentile(values, p):
    """The p-th percentile (0 to 100) of a list of numbers, or None."""
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100.0
    low = int(k)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (k - low)


def _bucket(ms):
    for limit, label in _CLICK_BUCKETS:
        if ms <= limit:
            return label
    return _CLICK_BUCKETS[-1][1]


def categorize(kind, message):
    """Which kind of error this is, as a key of CATEGORIES."""
    kind, text = str(kind or ""), str(message or "")
    if kind in ("server", "thread"):
        return "server_bug"
    if kind in ("js", "promise"):
        return "network" if _NETWORK_WORDS.search(text) else "app_bug"
    if kind == "toast":
        return "network" if _NETWORK_WORDS.search(text) else "toast"
    return kind if kind in CATEGORIES else "other"


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


_report_cache = {"key": None, "at": 0.0, "report": None}


def forget():
    _totals_cache.clear()
    _report_cache.update(key=None, at=0.0, report=None)


def cached_report(ttl=30.0):
    """The report as data, rebuilt only when the record changed or half a minute passed (the questions use it for hints)."""
    paths = tester.event_files()
    try:
        key = tuple((path, os.stat(path).st_size, os.stat(path).st_mtime_ns) for path in paths)
    except OSError:
        key = None
    now = time.monotonic()
    if key is not None and key == _report_cache["key"] and now - _report_cache["at"] < ttl and _report_cache["report"] is not None:
        return _report_cache["report"]
    report = build_report(paths, server_setup=setup_facts())
    _report_cache.update(key=key, at=now, report=report)
    return report


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
        self.sent = {}
        self.print_counts = {"real": Counter(), "demo": Counter()}
        self.link = Counter()
        self.firmware = {}
        self.gates = []
        self.gate_reasons = Counter()
        self.gate_reason_text = {}
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
        # how they used it
        self.how = Counter()                 # mouse, touch, pen, key
        self.buttons = Counter()             # left, right, middle
        self.mods = Counter()
        self.dbl = Counter()                 # double presses by control
        self.roles = Counter()
        self.heat = [[0] * 4 for _ in range(4)]
        self.gaps = []
        self.hours = [0] * 24
        self.paint_all = []
        self.paint_seen = 0
        self.paint_hist = Counter()
        self.changes = []
        self.change_counts = Counter()
        self.keys = Counter()
        self.visits = {}                     # session -> screens in the order they were opened
        self.vias = Counter()                # how they reached a screen: the control, or the address
        self.rank = {}                       # session -> order of first sight
        self.journey = {}                    # the first sessions' actions, in order
        self.milestones = {}
        self.breakpoints = Counter()
        # onboarding and the study
        self.onb = []
        self.study_events = []
        # health
        self.slowroutes = {}
        self.server_samples = []
        self.perf_boot = []
        self.perf_samples = []
        self.net = []
        self.net_down_ms = 0

    # -- helpers -----------------------------------------------------------------
    def _day(self, t):
        return self.days.setdefault(_day(t), {"sessions": set(), "clicks": 0, "errors": 0, "slow": 0, "prints": 0,
                                              "minutes": 0.0})

    def _screen(self, name):
        name = SCREEN_NAMES.get(name, name)
        self.screens_seen.add(name)
        return name

    def _mark(self, name, t):
        """The first time something happened (a printer connected, a print started...)."""
        if name not in self.milestones or t < self.milestones[name]:
            self.milestones[name] = t

    def _step(self, session, t, what, name, **extra):
        """One action, in order, for the first few visits (the report's Journey)."""
        if not session:
            return
        rank = self.rank.setdefault(session, len(self.rank))
        if rank >= 5:
            return
        rows = self.journey.setdefault(session, [])
        if len(rows) < 90:
            rows.append((t, len(rows), dict({"t": _iso(t), "did": what, "what": name}, **{k: v for k, v in extra.items() if v not in (None, "")})))

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
        if ev.get("first"):
            info["first"] = True
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
            self.screen_order.append({"t": _iso(t), "screen": name, "seconds": round((ev.get("ms") or 0) / 1000.0, 1),
                                      "via": ev.get("via")})
        if ev.get("via"):
            self.vias[str(ev["via"])[:60]] += 1
        if session:
            seq = self.visits.setdefault(session, [])
            if len(seq) < 400:
                seq.append(name)
        self._step(session, t, "opened", name, via=ev.get("via"), seconds=round((ev.get("ms") or 0) / 1000.0, 1))

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
        self._mark("first_click", t)
        self.hours[time.localtime(t / 1000.0).tm_hour] += 1
        if ev.get("how"):
            self.how[str(ev["how"])] += 1
        if ev.get("btn") in (1, 2):
            self.buttons["middle" if ev["btn"] == 1 else "right"] += 1
        elif ev.get("btn") == 0 or "how" in ev:
            self.buttons["left"] += 1
        for mod in str(ev.get("mods") or "").split("-"):
            if mod:
                self.mods[mod] += 1
        if ev.get("dbl"):
            self.dbl[str(ev.get("ctl") or "?")] += 1
        if ev.get("role"):
            self.roles[str(ev["role"])] += 1
        if isinstance(ev.get("x"), (int, float)) and isinstance(ev.get("y"), (int, float)):
            self.heat[max(0, min(3, int(ev["y"] // 25)))][max(0, min(3, int(ev["x"] // 25)))] += 1
        if isinstance(ev.get("gap"), (int, float)) and len(self.gaps) < 3000:
            self.gaps.append(ev["gap"])
        if isinstance(paint, (int, float)):
            self.paint_seen += 1
            self.paint_hist[_bucket(paint)] += 1
            if len(self.paint_all) < 3000:
                self.paint_all.append(paint)
            else:
                spot = _rng.randrange(self.paint_seen)
                if spot < 3000:
                    self.paint_all[spot] = paint
        self._step(session, t, "pressed", ev.get("ctl"), how=ev.get("how"), screen=SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")),
                   ms=paint, double=True if ev.get("dbl") else None, button="right" if ev.get("btn") == 2 else None)
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
        if not failed and key[0] == "POST":
            if key[1] == "/api/printers/discover":
                self._mark("looked_for_printers", t)
            elif key[1] == "/api/printers/test":
                self._mark("tested_a_printer", t)
            elif key[1] == "/api/fleet/registry":
                self._mark("added_a_printer", t)
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
        self._mark("first_error", t)
        key = (ev.get("kind") or "error", _norm_message(ev.get("msg")))
        group = self.errors.get(key)
        if group is None:
            if len(self.errors) >= 500:
                key = ("other", "(more kinds of error, see events.jsonl)")
                group = self.errors.get(key)
            if group is None:
                group = self.errors[key] = {"kind": key[0], "message": ev.get("msg"), "count": 0, "first": t, "last": t,
                                            "screens": Counter(), "where": None, "last_actions": None, "source": ev.get("src") or "browser",
                                            "sessions": set(), "controls": Counter(), "routes": Counter(), "statuses": Counter(),
                                            "stack": None, "samples": [], "pstates": Counter(), "offline": 0}
        group["count"] += count
        group["first"], group["last"] = min(group["first"], t), max(group["last"], t)
        if session:
            group["sessions"].add(session)
        if ev.get("screen"):
            group["screens"][SCREEN_NAMES.get(ev["screen"], ev["screen"])] += count
        if ev.get("file") or ev.get("where"):
            group["where"] = ev.get("where") or "%s:%s" % (ev.get("file"), ev.get("line"))
        if ev.get("stack"):
            group["stack"] = ev["stack"]
        if ev.get("route"):
            group["routes"][ev["route"]] += count
        if ev.get("status"):
            group["statuses"][ev["status"]] += count
        if ev.get("pstate"):
            group["pstates"][ev["pstate"]] += count
        if ev.get("online") is False:
            group["offline"] += count
        last = ev.get("last")
        control = ev.get("ctl")
        if last:
            group["last_actions"] = last
            if len(group["samples"]) < 3 and last not in group["samples"]:
                group["samples"].append(last)
            if not control:
                control = next((a[6:] for a in reversed(last) if a.startswith("click ")), None)
        if control:
            group["controls"][control] += count

    def _on_printer(self, ev, t, session):
        what = ev.get("ev")
        row = {"t": _iso(t), "event": what, "printer": ev.get("printer"), "file": ev.get("file"), "route": ev.get("route"),
               "words": ev.get("words") or ev.get("what"), "ms": ev.get("ms"), "demo": bool(ev.get("demo"))}
        if what in ("connect", "drop", "reconnect"):
            self.link[what] += 1
            if what == "connect":
                self._mark("printer_connected", t)
        elif what == "firmware":
            self.firmware[ev.get("printer") or "printer"] = ev.get("facts") or {}
            return
        elif what in ("print_started", "print_finished", "print_failed", "print_cancelled"):
            self.print_counts["demo" if ev.get("demo") else "real"][what] += 1
            if what == "print_started":
                self._day(t)["prints"] += 1
            if not ev.get("demo"):
                self._mark("first_print_" + what[6:], t)
        elif what in ("refused", "unconfirmed"):
            if len(self.refused) < 300:
                self.refused.append(row)
        elif what == "confirmed":
            stat = self.confirmed.setdefault(str(ev.get("what") or "?"), _Stat())
            stat.add(ev.get("ms"))
            return
        elif what == "sent":
            stat = self.sent.setdefault(str(ev.get("what") or "?"), _Stat())
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
            key = _norm_message(reason)
            self.gate_reasons[key] += 1
            self.gate_reason_text.setdefault(key, reason)
        self.gate_by_file[_file_key(ev.get("file"))] = row
        self._mark("first_confirm_print", t)
        if len(self.gates) < 500:
            self.gates.append(row)

    def _on_slice(self, ev, t, session):
        self._mark("first_slice", t)
        if len(self.slices) < 200:
            self.slices.append({"t": _iso(t), "engine": ev.get("engine"), "version": ev.get("version"), "ok": bool(ev.get("ok")),
                                "status": ev.get("status"), "seconds": ev.get("secs"), "stage": ev.get("stage"),
                                "cause": ev.get("cause"), "model": ev.get("model"), "report": ev.get("report")})

    def _on_convert(self, ev, t, session):
        self._mark("first_conversion", t)
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
        self._mark("first_note", t)
        if len(self.notes) < 300:
            self.notes.append({"t": _iso(t), "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")),
                               "text": ev.get("text") or "", "tag": ev.get("tag"), "after_error": bool(ev.get("after_err")),
                               "error": ev.get("err"), "printer_state": ev.get("pstate"), "last_actions": ev.get("last") or []})

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
            self.hours[time.localtime(t / 1000.0).tm_hour] += n
            if isinstance(ev.get("med"), (int, float)):
                self.paint_hist[_bucket(ev["med"])] += n
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

    def _on_change(self, ev, t, session):
        control = str(ev.get("ctl") or "?")
        self.change_counts[control] += 1
        value = ev.get("val")
        if value is None and ev.get("on") is not None:
            value = "on" if ev["on"] else "off"
        if value is None and isinstance(ev.get("num"), (int, float)):
            value = ev["num"]
        if value is None and ev.get("idx") is not None:
            value = "option %s of %s" % (ev["idx"], ev.get("of") or "?")
        if value is None and ev.get("files"):
            value = "%s file%s%s" % (ev["files"], "" if ev["files"] == 1 else "s", " (.%s)" % ev["ext"] if ev.get("ext") else "")
        row = {"t": _iso(t), "control": control, "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")), "role": ev.get("role"),
               "value": value}
        if len(self.changes) < 400:
            self.changes.append(row)
        self._step(session, t, "changed", control, to=value, screen=row["screen"])

    def _on_key(self, ev, t, session):
        if ev.get("combo"):
            self.keys[str(ev["combo"])] += 1
            self._step(session, t, "pressed key", ev["combo"], screen=SCREEN_NAMES.get(ev.get("screen"), ev.get("screen")))

    def _on_resize(self, ev, t, session):
        if ev.get("bp"):
            self.breakpoints[ev["bp"]] += 1

    def _on_onboarding(self, ev, t, session):
        what = str(ev.get("ev") or "")
        if what == "wizard_end":
            self._mark("setup_closed", t)
        elif what == "tour_end":
            self._mark("tour_ended", t)
        elif what == "wizard_open":
            self._mark("setup_opened", t)
        if len(self.onb) < 500:
            self.onb.append({"t": _iso(t), "_t": t, "event": what, "step": ev.get("step"), "of": ev.get("of"), "name": ev.get("name"),
                             "ms": ev.get("ms"), "how": ev.get("how"), "first": bool(ev.get("first"))})
        self._step(session, t, "setup", what.replace("_", " "), step=ev.get("name"))

    def _on_study(self, ev, t, session):
        what = str(ev.get("ev") or "")
        if what == "questions_open":
            self._mark("questions_opened", t)
        elif what == "report_saved":
            self._mark("report_saved", t)
        if len(self.study_events) < 300:
            self.study_events.append({"t": _iso(t), "event": what, "n": ev.get("n"), "days": ev.get("days"), "ms": ev.get("ms"),
                                      "section": ev.get("sec")})

    def _on_slowroute(self, ev, t, session):
        key = (ev.get("method") or "GET", ev.get("route") or "?")
        entry = self.slowroutes.setdefault(key, {"ms": _Stat(), "first": t, "last": t})
        entry["ms"].add(ev.get("ms"), True)
        entry["first"], entry["last"] = min(entry["first"], t), max(entry["last"], t)

    def _on_server(self, ev, t, session):
        if len(self.server_samples) < 800:
            self.server_samples.append({"t": t, "up": ev.get("up"), "cpu": ev.get("cpu"), "rss": ev.get("rss"),
                                        "threads": ev.get("threads"), "disk_free": ev.get("disk_free")})

    def _on_perf(self, ev, t, session):
        row = {k: ev.get(k) for k in ("fcp", "lcp", "cls", "dcl", "load", "ttfb", "heap", "nodes", "long", "up") if ev.get(k) is not None}
        row["t"] = t
        if ev.get("boot"):
            if len(self.perf_boot) < 100:
                self.perf_boot.append(row)
        elif len(self.perf_samples) < 800:
            self.perf_samples.append(row)

    def _on_net(self, ev, t, session):
        what = str(ev.get("ev") or "")
        if what == "online" and isinstance(ev.get("ms"), (int, float)):
            self.net_down_ms += ev["ms"]
        if len(self.net) < 300:
            self.net.append({"t": _iso(t), "event": what, "code": ev.get("code"), "clean": ev.get("clean"), "ms": ev.get("ms"),
                             "screen": SCREEN_NAMES.get(ev.get("screen"), ev.get("screen"))})

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
    def result(self, server_setup=None, now=None, export=None, study=None):
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
        errors = []
        for g in groups:
            category = categorize(g["kind"], g["message"])
            errors.append({"kind": g["kind"], "category": category, "category_label": CATEGORIES[category][0],
                           "meaning": CATEGORIES[category][1], "message": g["message"], "count": g["count"],
                           "sessions": len(g["sessions"]), "first": _iso(g["first"]), "last": _iso(g["last"]),
                           "screens": dict(g["screens"].most_common(4)),
                           "area": _feature_of(g["screens"], g["routes"], g["controls"]), "controls": dict(g["controls"].most_common(3)),
                           "routes": dict(g["routes"].most_common(3)), "statuses": dict(g["statuses"].most_common(3)),
                           "where": g["where"], "stack": g["stack"], "last_actions": g["last_actions"], "samples": g["samples"],
                           "printer_states": dict(g["pstates"].most_common(3)), "while_offline": g["offline"], "source": g["source"]})
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
        sent = [{"what": what, "count": s.n, "median_ms": _round(s.median()), "slowest_ms": _round(s.max)}
                for what, s in sorted(self.sent.items())]
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
        report = {
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
                        "confirmed_by_printer": confirmed, "sent_not_read_back": sent, "refused": self.refused, "timeline": self.timeline},
            "confirm_print": {"checks": len(self.gates), "by_verdict": dict(gate_totals), "went_on_to_print": went_on,
                              "reasons": [{"reason": self.gate_reason_text.get(r, r), "count": c} for r, c in self.gate_reasons.most_common(30)],
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
        error_sessions = set()
        for g in groups:
            error_sessions |= g["sessions"]
        report["study"] = study if study is not None else {"plan": None, "answered": 0, "total": tester_questions.COUNT, "sections": [],
                                                           "didnt_try": 0, "with_words": 0, "answers": []}
        report["onboarding"] = self._onboarding()
        report["milestones"] = self._milestones()
        report["usage"] = self._usage()
        report["stats"] = self._stats(clicks_total, len(self.sessions), len(error_sessions), report["summary"]["errors_total"])
        report["performance"] = self._performance()
        report["server_health"] = self._server_health()
        report["network"] = self._network()
        report["findings"] = _findings(report)
        counts = Counter(f["severity"] for f in report["findings"])
        report["summary"]["findings"] = {k: counts.get(k, 0) for k in ("high", "medium", "low")}
        return report

    def _onboarding(self):
        wizard = [r for r in self.onb if r["event"].startswith("wizard")]
        tour = [r for r in self.onb if r["event"].startswith("tour")]
        ends = Counter(r["how"] for r in wizard if r["event"] == "wizard_end")
        steps = {}
        for r in wizard:
            if r["event"] != "wizard_step" or not r.get("name"):
                continue
            entry = steps.setdefault(r["name"], {"step": r.get("step"), "visits": 0, "secs": [], "left": Counter()})
            entry["visits"] += 1
            if isinstance(r.get("ms"), (int, float)):
                entry["secs"].append(r["ms"] / 1000.0)
            entry["left"][r.get("how") or "next"] += 1
        step_rows = sorted(({"name": n, "step": e["step"], "visits": e["visits"], "median_seconds": _round(_median(e["secs"])),
                             "left_by": dict(e["left"])} for n, e in steps.items()), key=lambda x: (x["step"] or 0, x["name"]))
        tour_ends = Counter(r["how"] for r in tour if r["event"] == "tour_end")
        tour_steps = [r for r in tour if r["event"] == "tour_step"]
        first_run = any(info.get("first") for info in self.sessions.values())
        opened = sum(1 for r in wizard if r["event"] == "wizard_open")
        total_ms = sum(r["ms"] for r in wizard if r["event"] == "wizard_end" and isinstance(r.get("ms"), (int, float)))
        return {"first_run": first_run,
                "wizard": {"opened": opened, "finished": ends.get("done", 0), "skipped": ends.get("skipped", 0),
                           "closed_early": ends.get("closed", 0),
                           "furthest_step": max([r.get("step") or 0 for r in wizard if r["event"] in ("wizard_step", "wizard_end")] or [0]) or None,
                           "steps_total": next((r["of"] for r in wizard if r.get("of")), None),
                           "minutes": round(total_ms / 60000.0, 1), "steps": step_rows},
                "tour": {"started": sum(1 for r in tour if r["event"] == "tour_start"), "finished": tour_ends.get("finished", 0),
                         "ended_early": tour_ends.get("ended", 0), "steps_seen": len(tour_steps),
                         "median_step_seconds": _round(_median([r["ms"] / 1000.0 for r in tour_steps if isinstance(r.get("ms"), (int, float))]))},
                "timeline": [{k: v for k, v in r.items() if k != "_t"} for r in self.onb[:80]]}

    def _milestones(self):
        labels = (("first_click", "First button pressed"), ("setup_opened", "Setup opened"), ("setup_closed", "Setup finished or skipped"),
                  ("tour_ended", "Tour ended"), ("looked_for_printers", "Looked for printers on the network"),
                  ("tested_a_printer", "Tested a printer address"), ("added_a_printer", "Added a printer"),
                  ("printer_connected", "A printer connected"), ("first_confirm_print", "First Confirm Print check"),
                  ("first_print_started", "First print started"), ("first_print_finished", "First print finished"),
                  ("first_slice", "First slice"), ("first_conversion", "First conversion"), ("first_error", "First error"),
                  ("first_note", "First note written"), ("questions_opened", "Opened the questions"), ("report_saved", "Saved the report"))
        start = self.first
        rows = [{"id": key, "what": label, "at": _iso(self.milestones[key]),
                 "minutes_after_start": round((self.milestones[key] - start) / 60000.0, 1) if start else None}
                for key, label in labels if key in self.milestones]
        rows.sort(key=lambda r: r["at"])
        return rows

    def _usage(self):
        total_how = sum(self.how.values())
        heat_total = sum(sum(row) for row in self.heat)
        paths = Counter()
        entries, exits = Counter(), Counter()
        for seq in self.visits.values():
            if seq:
                entries[seq[0]] += 1
                exits[seq[-1]] += 1
            for a, b in zip(seq, seq[1:]):
                if a != b:
                    paths[(a, b)] += 1
        journey = []
        for number, (session, rows) in enumerate(sorted(self.journey.items(), key=lambda kv: self.rank.get(kv[0], 0)), 1):
            ordered = [r[2] for r in sorted(rows, key=lambda r: (r[0], r[1]))]
            journey.append({"visit": number, "start": ordered[0]["t"] if ordered else None, "actions": ordered})
        settings_rows = [c for c in self.changes if c["screen"] in ("settings",)]
        return {"hours": self.hours,
                "how_they_click": {"methods": dict(self.how.most_common()), "buttons": dict(self.buttons), "modifiers": dict(self.mods),
                                   "keyboard_percent": round(100.0 * self.how.get("key", 0) / total_how, 1) if total_how else None,
                                   "touch_percent": round(100.0 * self.how.get("touch", 0) / total_how, 1) if total_how else None,
                                   "double_presses": [{"control": c, "count": n} for c, n in self.dbl.most_common(10)],
                                   "kinds_of_control": dict(self.roles.most_common(8)),
                                   "think_time_seconds": {"median": _round(round((_median(self.gaps) or 0) / 1000.0, 1)) if self.gaps else None,
                                                          "p90": _round(round((_percentile(self.gaps, 90) or 0) / 1000.0, 1)) if self.gaps else None},
                                   "screen_map_percent": [[round(100.0 * v / heat_total, 1) if heat_total else 0 for v in row] for row in self.heat]},
                "keys": [{"combo": c, "count": n} for c, n in self.keys.most_common(15)],
                "changes": {"total": sum(self.change_counts.values()), "most_changed": [{"control": c, "count": n} for c, n in self.change_counts.most_common(15)],
                            "settings": settings_rows[:60], "recent": self.changes[:80]},
                "paths": {"transitions": [{"from": a, "to": b, "count": n} for (a, b), n in paths.most_common(15)],
                          "entry_screens": dict(entries.most_common(6)), "exit_screens": dict(exits.most_common(6)),
                          "reached_by": [{"via": v, "count": n} for v, n in self.vias.most_common(15)]},
                "window_sizes": dict(self.breakpoints.most_common()),
                "journey": journey}

    def _stats(self, clicks_total, sessions, error_sessions, errors_total):
        minutes = []
        for info in self.sessions.values():
            minutes.append((info["visible_ms"] or max(0, info["end"] - info["start"])) / 60000.0)
        requests_total = sum(e["ms"].n for e in self.routes.values())
        median_paint = _percentile(self.paint_all, 50)
        return {"click_to_paint": {"samples": self.paint_seen or sum(self.paint_hist.values()), "median_ms": _round(median_paint),
                                   "p90_ms": _round(_percentile(self.paint_all, 90)), "p95_ms": _round(_percentile(self.paint_all, 95)),
                                   "slowest_ms": _round(max(self.paint_all)) if self.paint_all else None,
                                   "histogram": [{"label": label, "count": self.paint_hist.get(label, 0)} for _, label in _CLICK_BUCKETS]},
                "sessions": {"count": sessions, "median_minutes": _round(round(_median(minutes), 1)) if minutes else None,
                             "longest_minutes": _round(round(max(minutes), 1)) if minutes else None,
                             "with_an_error": error_sessions},
                "requests": {"total": requests_total, "failed": self.failed_total,
                             "failed_percent": round(100.0 * self.failed_total / requests_total, 2) if requests_total else 0,
                             "slow": len(self.slow_reqs)},
                "errors": {"per_100_presses": round(100.0 * errors_total / clicks_total, 1) if clicks_total else None,
                           "sessions_with_an_error_percent": round(100.0 * error_sessions / sessions) if sessions else None}}

    def _performance(self):
        def column(rows, key):
            return [r[key] for r in rows if isinstance(r.get(key), (int, float))]
        heap = [(r["t"], r["heap"]) for r in self.perf_boot + self.perf_samples if isinstance(r.get("heap"), (int, float))]
        heap.sort()
        nodes = column(self.perf_boot + self.perf_samples, "nodes")
        first_mb, last_mb = (heap[0][1], heap[-1][1]) if heap else (None, None)
        return {"start_up": {"samples": len(self.perf_boot), "first_paint_ms": _round(_median(column(self.perf_boot, "fcp"))),
                             "largest_paint_ms": _round(_median(column(self.perf_boot, "lcp"))),
                             "page_loaded_ms": _round(_median(column(self.perf_boot, "load"))),
                             "slowest_load_ms": _round(max(column(self.perf_boot, "load"))) if column(self.perf_boot, "load") else None,
                             "layout_shift": _round(max(column(self.perf_boot, "cls"))) if column(self.perf_boot, "cls") else None},
                "memory": {"samples": len(heap), "first_mb": _round(first_mb), "last_mb": _round(last_mb),
                           "highest_mb": _round(max(h for _, h in heap)) if heap else None,
                           "hours_between": round((heap[-1][0] - heap[0][0]) / 3600000.0, 1) if len(heap) > 1 else 0,
                           "page_elements_highest": max(nodes) if nodes else None}}

    def _server_health(self):
        samples = sorted(self.server_samples, key=lambda x: x["t"])
        rss = [x["rss"] for x in samples if isinstance(x.get("rss"), (int, float))]
        disk = [x["disk_free"] for x in samples if isinstance(x.get("disk_free"), (int, float))]
        last = samples[-1] if samples else {}
        slow = [{"method": m, "route": route, "count": e["ms"].n, "median_ms": _round(e["ms"].median()), "slowest_ms": _round(e["ms"].max),
                 "first": _iso(e["first"]), "last": _iso(e["last"])} for (m, route), e in self.slowroutes.items()]
        slow.sort(key=lambda r: (-r["slowest_ms"], r["route"]))
        return {"samples": len(samples),
                "memory_mb": {"first": _round(rss[0]) if rss else None, "last": _round(rss[-1]) if rss else None,
                              "highest": _round(max(rss)) if rss else None},
                "hours_running": round((last.get("up") or 0) / 3600.0, 1),
                "cpu_percent_since_start": round(100.0 * last["cpu"] / last["up"], 1) if last.get("cpu") is not None and last.get("up") else None,
                "threads_highest": max([x["threads"] for x in samples if isinstance(x.get("threads"), int)] or [0]) or None,
                "disk_free_mb_lowest": min(disk) if disk else None, "slow_routes": slow[:30]}

    def _network(self):
        offline = sum(1 for n in self.net if n["event"] == "offline")
        closed = sum(1 for n in self.net if n["event"] == "ws_close" and n.get("clean") is False)
        return {"went_offline": offline, "live_link_closed_unexpectedly": closed,
                "seconds_offline": round(self.net_down_ms / 1000.0), "events": self.net[:60]}

    def _setup(self, server):
        browsers = []
        for t, setup in sorted(self.setups.values(), key=lambda item: item[0]):
            if setup not in browsers:
                browsers.append(setup)
        return {"server": server or {}, "browsers": browsers[-12:]}


def _feature_of(screens, routes, controls):
    """The part of the app an error belongs to: from the request it came with, the control just pressed, or the screen."""
    for route in routes:
        for _fid, name, _n, _section, rules in FEATURES:
            if any(r[0] == "route" and re.search(r[2], route) for r in rules):
                return name
    for route in routes:
        for prefix, name in ROUTE_AREAS:
            if str(route).startswith(prefix):
                return name
    for control in controls:
        for _fid, name, _n, _section, rules in FEATURES:
            if any(r[0] == "ctl" and re.search(r[1], control) for r in rules):
                return name
    for screen, _count in (screens.most_common(1) if hasattr(screens, "most_common") else list(screens.items())[:1]):
        return AREA_NAMES.get(screen, str(screen).capitalize())
    return None


def _short(text, limit):
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 1] + "\u2026"


def _times(n):
    return "%d time%s" % (n, "" if n == 1 else "s")


def _findings(r):
    """
    The report's work list: every error, slow control, failed request, failed slice, low frame rate, note and trouble
    answer, ranked, each with the place to look. A developer reads this first.
    """
    items = []
    base = {"high": 100.0, "medium": 50.0, "low": 10.0}

    def add(kind, severity, area, title, detail, score, where=None, **extra):
        items.append({"kind": kind, "severity": severity, "area": area, "title": _short(title, 200), "detail": _short(detail, 700),
                      "score": round(base[severity] + score, 1), "where": [w for w in (where or []) if w], **extra})

    for g in r["errors"]["groups"]:
        category = g["category"]
        severity = "high" if category in ("app_bug", "server_bug") else ("medium" if g["count"] >= 3 or category in ("toast", "csp") else "low")
        if category == "network" and g["count"] < 5:
            severity = "low"
        bits = ["%s in %s." % (_times(g["count"]), "%d session%s" % (g["sessions"], "" if g["sessions"] == 1 else "s"))]
        if g["screens"]:
            bits.append("On %s." % ", ".join(g["screens"]))
        if g["controls"]:
            bits.append("Usually right after: %s." % ", ".join(g["controls"]))
        if g["printer_states"]:
            bits.append("Printer was %s." % ", ".join(g["printer_states"]))
        bits.append("First %s, last %s." % (g["first"].replace("T", " ")[:16], g["last"].replace("T", " ")[:16]))
        if g["meaning"]:
            bits.append(g["meaning"])
        where = [("Code: %s" % (g["where"] if isinstance(g["where"], str) else " / ".join(g["where"]))) if g["where"] else None,
                 "Request: %s" % ", ".join(g["routes"]) if g["routes"] else None]
        add("error", severity, g["area"], "%s: %s" % (g["category_label"], g["message"]), " ".join(bits),
            min(g["count"], 30) * 1.5 + g["sessions"] * 4, where, count=g["count"], first=g["first"], last=g["last"],
            trail=g["last_actions"] or [])

    for c in r["clicks"]["controls"]:
        if not c["slow_count"]:
            continue
        severity = "high" if (c["slowest_ms"] or 0) >= 5000 or c["slow_count"] >= 5 else (
            "medium" if c["slow_count"] >= 2 or (c["slowest_ms"] or 0) >= 3000 else "low")
        add("slow", severity, ", ".join(c["screens"]) or None, "Slow to respond: %s" % c["control"],
            "Pressed %d times; the screen took over %d ms to change %s. Median %s ms, slowest %s ms." % (
                c["count"], r["slow"]["thresholds_ms"]["click"], _times(c["slow_count"]), c["median_ms"], c["slowest_ms"]),
            min(c["slow_count"], 30) * 1.2 + min((c["slowest_ms"] or 0) / 500.0, 20), ["Control: %s" % c["control"]],
            count=c["slow_count"])

    failing = {}
    for row in r["requests"]["failed"]:
        failing.setdefault((row["method"], row["route"]), []).append(row)
    for (method, route), rows in failing.items():
        statuses = Counter(x["status"] for x in rows)
        if set(statuses) <= {403, 409, 423}:
            continue                      # a refusal on purpose (watch-only, a safety check, a switched-off part): listed under the printer
        worst = max(statuses)
        severity = "high" if worst >= 500 else "medium" if (worst == 404 or (0 in statuses and len(rows) >= 3)) else "low"
        words = next((x["error"] for x in reversed(rows) if x.get("error")), "")
        add("request", severity, _feature_of(Counter(), {route: 1}, Counter()), "Request failed: %s %s" % (method, route),
            "%s (%s). %s" % (_times(len(rows)), ", ".join("%s x%d" % (k, v) for k, v in statuses.most_common(3)), ("The app said: %s" % words) if words else ""),
            min(len(rows), 30) * 1.2, ["Request: %s %s" % (method, route)], count=len(rows))

    for row in r["requests"]["routes"]:
        if row["slow_count"] >= 2 and (row["slowest_ms"] or 0) >= 3000:
            add("slow", "medium", _feature_of(Counter(), {row["route"]: 1}, Counter()), "Request often slow: %s %s" % (row["method"], row["route"]),
                "Took over %d ms %s of %d. Median %s ms, slowest %s ms." % (r["slow"]["thresholds_ms"]["request"], _times(row["slow_count"]), row["count"],
                                                                         row["median_ms"], row["slowest_ms"]),
                min(row["slow_count"], 20), ["Request: %s %s" % (row["method"], row["route"])], count=row["slow_count"])

    for row in r["server_health"]["slow_routes"]:
        add("server", "medium" if row["count"] >= 2 or row["slowest_ms"] >= 5000 else "low", _feature_of(Counter(), {row["route"]: 1}, Counter()),
            "The server was slow to answer: %s %s" % (row["method"], row["route"]),
            "%s over %d ms on the server itself (median %s ms, slowest %s ms), so the delay is in the server's work, not the network." % (
                _times(row["count"]), tester.SLOW_HANDLER_MS, row["median_ms"], row["slowest_ms"]),
            min(row["count"], 20), ["Request: %s %s" % (row["method"], row["route"])], count=row["count"])

    refused = Counter()
    refused_rows = {}
    for row in r["printer"]["refused"]:
        key = _norm_message(row.get("words"))
        refused[key] += 1
        refused_rows[key] = row
    for key, n in refused.most_common(15):
        row = refused_rows[key]
        add("refused", "medium" if n >= 3 else "low", "Printer controls", "A command was refused: %s" % (row.get("words") or row.get("route")),
            "%s. The words are the app's own, as the tester read them. Refusals by watch-only or a safety check are meant; check that this one was." % _times(n),
            n, ["Route: %s" % row.get("route")] if row.get("route") else None, count=n)

    link = r["printer"]["connections"]
    if link.get("drop", 0):
        add("printer", "medium" if link["drop"] >= 3 else "low", "Printer link", "The printer connection dropped %s" % _times(link["drop"]),
            "Reconnected %s. Check the Wi-Fi, the printer's Moonraker and how long each drop lasted in the printer timeline." % _times(link.get("reconnect", 0)),
            link["drop"], count=link["drop"])
    failed_prints = r["printer"]["prints"]["real"].get("print_failed", 0)
    if failed_prints:
        add("printer", "medium", "Printing", "A print failed (%d)" % failed_prints,
            "The printer reported a print as failed. It may be a physical failure, so read the printer timeline.", failed_prints * 3, count=failed_prints)

    for sl in r["slicing"]:
        if not sl["ok"]:
            add("slice", "high", "Slicing", "A slice failed (%s %s, stage %s)" % (sl.get("engine") or "engine", sl.get("version") or "", sl.get("stage") or "unknown"),
                "Cause: %s. The report for help is in report.html under Slicing." % (sl.get("cause") or "not given"), 10, ["Time: %s" % sl["t"]])
    for cv in r["converter"]:
        if not cv["ok"]:
            add("convert", "high", "Converter", "A conversion failed (%s)" % (cv.get("source") or "project"), cv.get("error") or "No reason was recorded.", 10, ["Time: %s" % cv["t"]])
    warned = Counter(w for cv in r["converter"] for w in (cv.get("warnings") or []))
    for text, n in warned.most_common(5):
        if n >= 2:
            add("convert", "low", "Converter", "The converter warned: %s" % text, "Shown %s." % _times(n), n, count=n)

    for surface, v in r["smoothness"].items():
        if v["median_fps"] is not None and v["median_fps"] < 24:
            name = {"twin": "The 3D twin", "gcode": "The G-code preview"}.get(surface, surface)
            low = v.get("lowest_at_size") or {}
            add("smooth", "high" if v["median_fps"] < 12 else "medium", name, "%s drew at a median of %s frames per second" % (name, v["median_fps"]),
                "Lowest %s fps over %d samples%s." % (v["lowest_fps"], v["samples"], (", on a model of %s layers" % low["layers"]) if low.get("layers") else ""),
                (24 - v["median_fps"]) * 2)
    lt = r["slow"]["long_tasks"]
    if lt["count"] >= 5:
        screens = Counter(x["screen"] for x in lt["examples"] if x.get("screen"))
        add("slow", "high" if lt["count"] >= 20 else "medium", ", ".join(s for s, _ in screens.most_common(2)) or None,
            "The page froze %d times for over %d ms" % (lt["count"], r["slow"]["thresholds_ms"]["long_task"]),
            "%d ms frozen in all. Most on: %s." % (lt["total_ms"], ", ".join(s for s, _ in screens.most_common(3)) or "unknown"), min(lt["count"], 40) / 2.0, count=lt["count"])

    tag_severity = {"broken": "high", "slow": "medium", "confusing": "medium", "wrong": "medium", "idea": "low", "good": "low"}
    for n in r["notes"]:
        severity = tag_severity.get(n.get("tag"), "medium")
        words = n["text"] or "(a tagged note with no words)"
        bits = ["Written on %s at %s." % (n["screen"] or "an unknown screen", n["t"].replace("T", " ")[:16])]
        if n.get("error"):
            bits.append("Written right after the error: %s." % n["error"])
        if n.get("printer_state"):
            bits.append("The printer was %s." % n["printer_state"])
        if n.get("last_actions"):
            bits.append("Last actions: %s." % "; ".join(n["last_actions"][-5:]))
        add("note", severity, n["screen"], "Tester note%s: %s" % (" (%s)" % n["tag"] if n.get("tag") else "", words), " ".join(bits), 25, tester_said=True,
            trail=n.get("last_actions") or [])

    for a in r["study"].get("answers", []):
        q = tester_questions.BY_ID.get(a["id"]) or {}
        if not a["answered"]:
            continue
        if q.get("bad") and a["choice"] == q["bad"]:
            add("answer", q["sev"] or "medium", a["section_name"], "Answered %s to question %d: %s" % (a["choice_label"], a["n"], a["question"]),
                ("Their words: %s" % a["answer"]) if a["answer"].strip() else "No words with it.", 20, tester_said=True)
        elif q.get("finding") and a["answer"].strip():
            add("answer", q["sev"] or "medium", a["section_name"], "Question %d: %s" % (a["n"], a["answer"]), "Asked: %s" % a["question"], 20, tester_said=True)

    health = r["server_health"]
    mem = health["memory_mb"]
    if mem["first"] and mem["last"] and mem["last"] > 1.5 * mem["first"] and mem["last"] - mem["first"] > 150 and health["hours_running"] >= 6:
        add("server", "medium", "Server", "The server's memory grew from %s MB to %s MB over %s hours" % (mem["first"], mem["last"], health["hours_running"]),
            "Highest %s MB. A slow climb like this points at a leak." % mem["highest"], 15)
    if health["disk_free_mb_lowest"] is not None and health["disk_free_mb_lowest"] < 500:
        add("server", "medium", "Server", "The disk had only %s MB free" % health["disk_free_mb_lowest"], "Recording and time-lapses stop when the disk is full.", 5)
    mem_page = r["performance"]["memory"]
    if mem_page["first_mb"] and mem_page["last_mb"] and mem_page["last_mb"] > 2 * mem_page["first_mb"] and mem_page["last_mb"] - mem_page["first_mb"] > 100 and mem_page["hours_between"] >= 3:
        add("slow", "medium", "The page", "The page's memory grew from %s MB to %s MB over %s hours" % (mem_page["first_mb"], mem_page["last_mb"], mem_page["hours_between"]),
            "The dashboard left open for hours keeps growing. Look for something that is drawn again and never freed.", 15)
    net = r["network"]
    if net["live_link_closed_unexpectedly"] >= 3:
        add("network", "medium", "Live link", "The live link to the server closed unexpectedly %s" % _times(net["live_link_closed_unexpectedly"]),
            "Readings stop updating until it reconnects. %s offline in all." % _short("%d s" % net["seconds_offline"], 20), net["live_link_closed_unexpectedly"])
    onboarding, ms = r["onboarding"], {m["id"]: m for m in r["milestones"]}
    if onboarding["wizard"]["closed_early"]:
        add("onboarding", "low", "Setup", "Setup was closed before the end", "Furthest step reached: %s of %s." % (onboarding["wizard"]["furthest_step"], onboarding["wizard"]["steps_total"] or "?"),
            5, count=onboarding["wizard"]["closed_early"])
    first_connect = ms.get("printer_connected")
    if not first_connect and r["summary"]["clicks"] >= 20 and not r["summary"]["demo_prints_started"]:
        add("onboarding", "medium", "Setup", "No printer connected during the test",
            "Twenty or more presses and no connect. Read their answers to questions 4, 7 and 8, and the requests for /api/printers/test.", 8)
    elif first_connect and (first_connect["minutes_after_start"] or 0) > 15:
        add("onboarding", "low", "Setup", "Connecting the first printer took %s minutes" % first_connect["minutes_after_start"],
            "Measured from the first press. See the Journey for what they tried first.", 4)

    items.sort(key=lambda f: (SEVERITY_RANK[f["severity"]], -f["score"], f["title"]))
    for number, item in enumerate(items[:80], 1):
        item["id"] = "F%d" % number
    return items[:80]


def build_report(paths=None, server_setup=None, now=None, export=None, study=None):
    agg = Aggregator()
    for event in iter_events(paths if paths is not None else tester.event_files()):
        agg.add(event)
    if study is None and paths is None:
        study = tester_study.for_report(now * 1000 if now else None)
    return agg.result(server_setup=server_setup, now=now, export=export, study=study)


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




def build_zip(now=None, theme=None):
    """(filename, bytes): the saved tester report. Raises ValueError when nothing has been recorded."""
    now = now or time.time()
    paths = tester.event_files()
    if not paths:
        raise ValueError("Nothing has been recorded yet. Use Deja Vu1 for a while, then save the report")
    tmp = os.path.join(tester.folder(), ".export-events.tmp")
    try:
        export = thin_files(paths, tmp, tester.EXPORT_LIMIT)
        report = build_report(paths, server_setup=setup_facts(), now=now, export=export, study=tester_study.for_report(now * 1000))
        page = render_html(report, theme)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr("report.html", page)
            archive.writestr("findings.md", render_findings(report))
            archive.writestr("report.json", json.dumps(report, indent=2, ensure_ascii=False))
            archive.write(tmp, "events.jsonl")
            archive.writestr("README.txt", README % ("\n".join("  - " + n for n in NEVER), tester.EXPORT_LIMIT // 1048576))
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    name = "deja-vu1-tester-report-%s.zip" % time.strftime("%Y-%m-%d", time.localtime(now))
    data = buffer.getvalue()
    tester_study.note_export(len(data))
    return name, data


def build_html(theme=None, now=None):
    """The same report as one page, for the in-app viewer."""
    return render_html(build_report(server_setup=setup_facts(), now=now, study=tester_study.for_report(now * 1000 if now else None)), theme)
