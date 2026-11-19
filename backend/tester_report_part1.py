"""
tester_report_part1.py: part 1 of 3 split out of tester_report.py (the tester report's numbers, findings and
zip) on 19 November 2026, so a session reads only the part it needs. tester_report.py imports every name here
back, so `tester_report.<name>` works as before. Holds: AREA_NAMES, CATEGORIES, FEATURES, NEVER, ROUTE_AREAS,
ROUTINE_ORDER, SCREEN_NAMES, SEVERITY_RANK, SLOWEST, SLOW_CLICK_MS, SLOW_REQUEST_MS, _CLICK_BUCKETS, _DATA_DIR,
_NETWORK_WORDS, _Stat, _Sums, _bucket, _count_into, _day, _feature_of, _file_key, _findings, _fresh_counts,
_iso, _median, _norm_message, _percentile, _remask, _report_cache, _rng, _round, _routine, _short, _times,
_totals_cache, _wmedian, categorize, forget, iter_events, totals.
"""

from collections import Counter
import json
import os
import random
import re
import statistics
import storage
import tester
import tester_questions
import time


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


_totals_cache = {}


_report_cache = {"key": None, "at": 0.0, "report": None}


def forget():
    _totals_cache.clear()
    _report_cache.update(key=None, at=0.0, report=None)


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
