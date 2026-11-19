"""
tester_report_part4.py: part 4 of the tester report builder (added 19 November 2026 for the "fix first" report).

What the ranked findings are made of when many things go wrong at the same moment, and where to look in the code:

  find_stalls()    requests that waited together, grouped by what the server was running at the time
  lost_link()      requests that failed because the page lost the server, grouped into the times it was lost
  code_for()       the files to open for a finding (a script error's own file and line, a request's module, a screen's scripts)

Plain functions over plain lists: nothing here reads a file or the clock. tester_report_part1.py (the findings) and
tester_report_part2.py (the Aggregator, which collects the lists) import it.
"""

import re
import statistics
import time
from collections import Counter

# A failed request the page itself could not finish: the server was not there to answer.
NETWORK_WORDS = re.compile(r"(?i)failed to fetch|networkerror|network error|load failed|network connection was lost|err_connection|"
                           r"err_network|err_internet|the user aborted")

MIN_WAITING = 3             # requests that waited together before it counts as one stall
MIN_ROUTES = 2              # ... on at least this many different routes (one slow route alone is a slow route)
LOSS_GAP_S = 60             # failures closer together than this are one loss of the server
FAST_MS = 1500              # a route whose usual answer is quicker than this is not what a stall was waiting for
QUIET_GAP_S = 15 * 60       # no sample from the server for this long: the computer slept or Deja Vu1 was not running

# What a long request is doing, in words a tester would recognise. The first match wins.
JOB_WORDS = (("/api/timelapse/keep", "keeping a time-lapse video"),
             ("/api/timelapse/printer-video", "loading a video from the printer"),
             ("/api/timelapse/video", "playing a time-lapse video"),
             ("/api/assistant", "an AI assistant reply"),
             ("/api/app/selfcheck", "the self-check"),
             ("/api/app/report", "building a report for help"),
             ("/api/app/update", "installing an update"),
             ("/api/slicer", "slicing"),
             ("/api/convert", "converting a project"),
             ("/api/backup", "making a backup"),
             ("/api/files/upload", "uploading a file"),
             ("/api/camera", "the camera"))

# Where a request's work is done: the module that answers it (checked by tests/test_tester_insights.py: every path exists).
ROUTE_CODE = (("/api/printer/control/", ["backend/printer_control.py"]), ("/api/print/", ["backend/print_gate.py"]),
              ("/api/files", ["backend/file_library.py"]), ("/api/slicer", ["backend/slicer_bridge.py"]),
              ("/api/convert", ["backend/converter_3mf.py"]), ("/api/colours", ["backend/colour_map.py"]),
              ("/api/queue", ["backend/print_queue.py"]), ("/api/filament", ["backend/filament_inventory.py"]),
              ("/api/maintenance", ["backend/maintenance.py"]), ("/api/camera", ["backend/camera.py", "backend/stock_camera.py"]),
              ("/api/timelapse", ["backend/timelapse.py"]), ("/api/assistant", ["backend/ai_assistant.py"]),
              ("/api/app/", ["backend/app_updates.py", "backend/app_post.py"]), ("/api/updates", ["backend/app_updates.py"]),
              ("/api/fleet", ["backend/fleet.py"]), ("/api/printers", ["backend/fleet.py"]),
              ("/api/notifications", ["backend/notifications.py"]), ("/api/automations", ["backend/automations.py"]),
              ("/api/remote", ["backend/remote.py"]), ("/api/pairing", ["backend/pairing.py"]),
              ("/api/modules", ["backend/modules.py"]), ("/api/studio", ["backend/photo_studio.py"]),
              ("/api/leds", ["backend/led_status.py"]), ("/api/cost", ["backend/cost_calculator.py"]),
              ("/api/health", ["backend/print_gate.py"]), ("/api/backup", ["backend/backup.py"]),
              ("/api/connection", ["backend/app_get.py", "backend/mock_moonraker.py"]))

# Where a screen's code lives, for a slow press or a freeze that has no script error to point at.
AREA_CODE = {"Overview": ["frontend/telemetry.js", "frontend/app-shell.js"], "Printers": ["frontend/desk.js", "frontend/workshop-part5.js"],
             "Printer page": ["frontend/workshop-part2.js", "frontend/workshop-part3.js", "frontend/workshop-part5.js"],
             "Files": ["frontend/workshop-part5.js", "frontend/gcode-view.js"],
             "Slicing": ["frontend/farm-part1.js", "frontend/slicer-workspace.js", "frontend/plate.js"],
             "Queue": ["frontend/workshop-part4.js", "frontend/farm-part1.js"], "Filament": ["frontend/app-print.js"],
             "Maintenance": ["frontend/app-modules.js", "frontend/logbook.js"], "Settings": ["frontend/app-modules.js"],
             "Insights": ["frontend/insights.js"], "Care log": ["frontend/logbook.js"], "Camera": ["frontend/workshop-part3.js"],
             "Time-lapses": ["frontend/workshop-part3.js", "frontend/workshop-part5.js"],
             "AI assistant": ["frontend/assistant.js", "frontend/assistant-part1.js"], "Photo Studio": ["frontend/studio.js"],
             "The 3D twin": ["frontend/twin3d.js", "frontend/twin3d-part1.js"], "The G-code preview": ["frontend/gcode-view.js"]}


def route_words(route):
    """What a request is doing, in words, or the route itself when it is not a known long job."""
    route = str(route or "")
    for prefix, words in JOB_WORDS:
        if route.startswith(prefix):
            return words
    return route


def code_for(route=None, area=None, where=None):
    """The files to open, most exact first: a script error's own file and line, then the module that answers the request, then the screen's scripts."""
    out = []
    if where:
        for part in (where if isinstance(where, (list, tuple)) else [where]):
            match = re.match(r"^(?:Code: )?([\w.\-]+\.js):(\d+)", str(part))
            if match:
                out.append("frontend/%s:%s" % (match.group(1), match.group(2)))
    for prefix, files in ROUTE_CODE:
        if route and str(route).startswith(prefix):
            out.extend(files)
            break
    if not out and area in AREA_CODE:
        out.extend(AREA_CODE[area])
    seen = []
    for path in out:
        if path not in seen:
            seen.append(path)
    return seen[:4]


def inside(stalls, iso):
    """True when a time (an ISO string, as the report holds them) falls inside one of the stalls."""
    return any(s["start"] <= iso <= s["end_plus"] for s in stalls)


def _hm(ms):
    return time.strftime("%H:%M", time.localtime(ms / 1000.0))


def _iso(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ms / 1000.0))


def _stall_rows(rows):
    """
    The moments when MIN_WAITING or more requests, on MIN_ROUTES or more routes, were all waiting at once. Each is a list of
    rows. A row is (start_ms, end_ms, method, route, status, failed). Rows used by one stall are not used by the next.
    """
    stalls, rows = [], list(rows)
    while len(rows) >= MIN_WAITING:
        events = sorted([(r[0], 1, i) for i, r in enumerate(rows)] + [(r[1], -1, i) for i, r in enumerate(rows)])
        alive, best = set(), set()
        for _t, kind, i in events:
            if kind == 1:
                alive.add(i)
                if len(alive) > len(best):
                    best = set(alive)
            else:
                alive.discard(i)
        mine = [rows[i] for i in sorted(best)]
        if len(mine) < MIN_WAITING or len({(r[2], r[3]) for r in mine}) < MIN_ROUTES:
            break
        stalls.append(mine)
        rows = [r for i, r in enumerate(rows) if i not in best]
    return stalls


def find_stalls(waits, busy, quiet, typical=None):
    """
    Group the slow requests the browser timed by the moment they waited together.

    waits    (start_ms, end_ms, method, route, status, failed) for each request the browser found slow
    busy     (start_ms, end_ms, method, route) for each request the server itself took long to answer
    quiet    (start_ms, end_ms, why) periods when the computer slept, was offline, or Deja Vu1 was not running
    typical  {(method, route): median ms} over the whole run: a route that normally answers in well under a second and took
             far longer is one that waited; a route that normally takes seconds (keeping a video, an AI reply) is what it waited for

    Returns one dict per stall, worst first: when, how long they waited, how many waited, what was running at the time, whether the
    server itself was slow or the wait came before the request reached it, and a condition when the computer was away.
    """
    out = []
    for rows in _stall_rows(waits):
        start, end = min(r[0] for r in rows), max(r[1] for r in rows)
        span = max(1, end - start)
        running = {}
        for b in busy:
            if b[0] < end and b[1] > start and (b[1] - b[0]) >= max(3000, 0.5 * span):
                usual = (typical or {}).get((b[2], b[3]))
                if usual is not None and usual < FAST_MS:
                    continue                 # it normally answers at once: it waited inside the server, it is not what held things up
                running[(b[2], b[3])] = max(running.get((b[2], b[3]), 0), b[1] - b[0])
        waiting_keys = Counter((r[2], r[3]) for r in rows)
        for key in list(running):
            if waiting_keys.get(key, 0) >= 2:            # many of the same: a route that was slow, not a job the rest waited for
                del running[key]
        if not running:                      # no server-side record: the longest request of the stall, if it clearly outlasted the rest
            longest = max(rows, key=lambda r: r[1] - r[0])
            others = [r[1] - r[0] for r in rows if r is not longest]
            if others and (longest[1] - longest[0]) >= 1.5 * statistics.median(others) and waiting_keys[(longest[2], longest[3])] == 1:
                running[(longest[2], longest[3])] = longest[1] - longest[0]
        waiting = [r for r in rows if (r[2], r[3]) not in running]
        if len({(r[2], r[3]) for r in waiting}) < MIN_ROUTES or len(waiting) < MIN_WAITING - 1:
            continue
        waits_ms = sorted(r[1] - r[0] for r in waiting)
        by_route = Counter((r[2], r[3]) for r in waiting)
        slowest = {}
        for r in waiting:
            slowest[(r[2], r[3])] = max(slowest.get((r[2], r[3]), 0), r[1] - r[0])
        server_saw = 0
        for r in waiting:
            if any(b[2] == r[2] and b[3] == r[3] and abs(b[1] - r[1]) <= 2500 for b in busy):
                server_saw += 1
        away = next((q for q in quiet if q[0] < end and q[1] > start), None)
        out.append({
            "start": _iso(start), "end": _iso(end), "end_plus": _iso(end + 1500), "start_ms": int(start), "at": _hm(start), "seconds": int(round(statistics.median(waits_ms) / 1000.0)),
            "longest_seconds": int(round(waits_ms[-1] / 1000.0)), "waited": len(waiting),
            "routes": [{"method": m, "route": route, "count": n, "slowest_ms": int(slowest[(m, route)])}
                       for (m, route), n in sorted(by_route.items(), key=lambda kv: (-kv[1], kv[0]))[:8]],
            "running": [{"method": m, "route": route, "seconds": int(round(ms / 1000.0)), "what": route_words(route)}
                        for (m, route), ms in sorted(running.items(), key=lambda kv: -kv[1])[:3]],
            "server_saw": server_saw,
            "where_waited": ("inside the server: it recorded most of these requests as slow itself, so something held them up in the "
                             "server (a lock, or a slow call to the printer)") if server_saw * 2 >= len(waiting) else
                            ("before the requests reached the server's code: the server answered quickly once it had them, so they "
                             "queued (the browser allows few connections at once, or the server was busy taking them in)"),
            "condition": away[2] if away else None})
    out.sort(key=lambda s: (-s["seconds"] * s["waited"], s["start"]))
    return out[:60]


def lost_link(failed, error_groups, restarts, quiet, offline):
    """
    The requests that failed because the page lost the server, as one thing. `failed` holds the browser's failed requests
    as (ms, method, route, words); the error groups that are only "Failed to fetch" are counted with them, not on their own.
    restarts: when Deja Vu1 started again (ms). quiet and offline: (start_ms, end_ms, why) periods.
    Returns None when the page never lost the server.
    """
    rows = sorted((f for f in failed if NETWORK_WORDS.search(str(f[3] or ""))), key=lambda f: f[0])
    shown = [g for g in error_groups if g.get("category") == "network"]
    if not rows and not shown:
        return None
    losses = []
    for f in rows:
        if losses and f[0] - losses[-1]["end"] <= LOSS_GAP_S * 1000:
            losses[-1]["end"] = f[0]
            losses[-1]["requests"] += 1
        else:
            losses.append({"start": f[0], "end": f[0], "requests": 1})
    for loss in losses:
        lo, hi = loss["start"] - 2000, loss["end"] + 5 * 60 * 1000
        why = None
        if any(lo <= r <= hi for r in restarts):
            why = "while Deja Vu1 restarted (an update or a restart)"
        else:
            asleep = next((q for q in quiet if q[0] - 5000 <= loss["end"] and q[1] + 5000 >= loss["start"]), None)
            gone = next((q for q in offline if q[0] - 5000 <= loss["end"] and q[1] + 5000 >= loss["start"]), None)
            why = (asleep or gone or (None, None, None))[2]
        loss["why"] = why
        loss["at"] = _hm(loss["start"])
        loss["start"], loss["end"] = _iso(loss["start"]), _iso(loss["end"])
    routes = Counter(f[2] for f in rows)
    return {"losses": losses[:40], "times": len(losses) or sum(g["count"] for g in shown), "requests": len(rows),
            "shown_as_errors": sum(g["count"] for g in shown), "unexplained": sum(1 for x in losses if not x["why"]),
            "routes": dict(routes.most_common(5))}


def quiet_gaps(samples, gap_s=QUIET_GAP_S):
    """Periods with no sample from the server for gap_s or more: the computer slept or Deja Vu1 was not running. samples: ms times."""
    times = sorted(samples)
    return [(a, b, "the computer was asleep or Deja Vu1 was not running") for a, b in zip(times, times[1:]) if b - a >= gap_s * 1000]


def restarts_from(samples):
    """When the server started again: the samples (ms, uptime seconds) where uptime went down."""
    rows = sorted(samples)
    return [b[0] for a, b in zip(rows, rows[1:]) if isinstance(a[1], (int, float)) and isinstance(b[1], (int, float)) and b[1] < a[1]]
