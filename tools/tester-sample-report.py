#!/usr/bin/env python3
"""
Writes frontend/demo/tester-report-sample.html: the page "View sample report" opens in the online demo.

    python3 tools/tester-sample-report.py

Every figure is invented here, in this file, to show the layout of a real report, and the page says so at the
top. It is built with the same code that builds a real report (backend/tester_report.py) from a fixed set of
made-up events, so the sample cannot drift from the real page. Run it again after changing the report's look.
"""

import os
import random
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ["DEJAVU_DATA_DIR"] = tempfile.mkdtemp()      # nothing here touches a real data folder

import tester_report  # noqa: E402

DAYS = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]
SCREENS = ["overview", "printer", "files", "slice", "queue", "maintenance", "settings", "printers"]
CONTROLS = [("#ctrl-pause-resume", "printer"), ("[data-view=front] in #twin-card", "printer"), ("[data-dest=files] in #rail", "overview"),
            ("[data-dest=printer] in #rail", "overview"), ("#print-start in #confirm-dialog", "files"), ("[data-tab=queue]", "queue"),
            ("button \"Add to queue\" in #queue-card", "files"), ("[data-dest=settings] in #rail", "overview")]


def stamp(day, hour, minute=0, second=0):
    import calendar
    import time
    y, m, d = (int(x) for x in day.split("-"))
    return int(calendar.timegm((y, m, d, hour, minute, second)) * 1000)


def events():
    rng = random.Random(23)
    out = []
    for n, day in enumerate(DAYS):
        sid = "sample%02d" % n
        start = stamp(day, 18, rng.randrange(0, 40))
        out.append({"k": "session", "s": sid, "ev": "start", "device": "desk" if n != 3 else "phone", "w": 1366, "h": 768, "t": start})
        if n == 0:
            out.append({"k": "setup", "s": sid, "browser": "Chrome", "bver": "131", "ua_os": "Windows", "w": 1920, "h": 1080, "dpr": 1.25,
                        "look": "glass", "theme": "dark", "lang": "en", "t": start + 500})
        t = start
        for i in range(rng.randrange(40, 120)):
            t += rng.randrange(2000, 40000)
            ctl, screen = rng.choice(CONTROLS)
            slow = rng.random() < 0.03
            out.append({"k": "click", "s": sid, "ctl": ctl, "screen": screen, "paint": rng.randrange(1100, 2600) if slow else rng.randrange(18, 140),
                        "t": t, "slow": True if slow else None})
            if i % 9 == 0:
                out.append({"k": "screen", "s": sid, "screen": rng.choice(SCREENS), "ms": rng.randrange(8000, 240000), "t": t})
        out.append({"k": "req", "s": sid, "route": "/api/live/snapshot", "method": "GET", "agg": True, "n": 600, "ok": 600, "fail": 0, "p50": 14,
                    "max": 190, "t": t})
        out.append({"k": "fps", "s": sid, "surface": "twin", "fps": 38 + n * 3, "layers": 180 + n * 20, "t": t + 100})
        out.append({"k": "session", "s": sid, "ev": "end", "ms": (t - start), "t": t + 200})
    out += [
        {"k": "req", "s": "sample01", "route": "/api/files/samples", "method": "POST", "status": 200, "ms": 6400, "slow": True, "t": stamp(DAYS[1], 19, 5)},
        {"k": "err", "s": "sample02", "kind": "toast", "msg": "Pause failed: the printer reported a failure: Unknown command", "screen": "printer",
         "last": ["click #ctrl-pause-resume", "open printer"], "t": stamp(DAYS[2], 20, 12)},
        {"k": "err", "s": "sample02", "kind": "js", "msg": "TypeError: Cannot read properties of null (reading 'classList')", "file": "app.js", "line": 1204,
         "screen": "files", "last": ["click [data-dest=files] in #rail", "open files"], "t": stamp(DAYS[2], 20, 40)},
        {"k": "printer", "ev": "connect", "printer": "printer 1", "t": stamp(DAYS[0], 18, 1)},
        {"k": "printer", "ev": "firmware", "printer": "printer 1", "facts": {"moonraker_version": "v0.9.3-sample", "machine_type": "Snapmaker U1"},
         "t": stamp(DAYS[0], 18, 1, 5)},
        {"k": "printer", "ev": "drop", "printer": "printer 1", "t": stamp(DAYS[3], 21, 2)},
        {"k": "printer", "ev": "reconnect", "printer": "printer 1", "t": stamp(DAYS[3], 21, 3)},
        {"k": "printer", "ev": "print_started", "printer": "printer 1", "file": "file 1, .gcode, 2.4 MB", "t": stamp(DAYS[1], 19, 30)},
        {"k": "printer", "ev": "print_finished", "printer": "printer 1", "file": "file 1, .gcode, 2.4 MB", "t": stamp(DAYS[1], 21, 5)},
        {"k": "printer", "ev": "print_started", "printer": "printer 1", "file": "file 2, .gcode, 5.1 MB", "t": stamp(DAYS[4], 19, 10)},
        {"k": "printer", "ev": "print_failed", "printer": "printer 1", "file": "file 2, .gcode, 5.1 MB", "t": stamp(DAYS[4], 20, 1)},
        {"k": "printer", "ev": "refused", "route": "/api/printer/control/home", "status": 409, "words": "Moving the head is refused while a print is running",
         "t": stamp(DAYS[4], 19, 40)},
        {"k": "printer", "ev": "confirmed", "what": "Paused", "ms": 410, "t": stamp(DAYS[4], 19, 41)},
        {"k": "printer", "ev": "confirmed", "what": "Resumed", "ms": 530, "t": stamp(DAYS[4], 19, 43)},
        {"k": "gate", "file": "file 1, .gcode, 2.4 MB", "verdict": "clear", "blocking": [], "warnings": [], "t": stamp(DAYS[1], 19, 28)},
        {"k": "printer", "ev": "start_requested", "printer": "printer 1", "file": "file 1, .gcode", "t": stamp(DAYS[1], 19, 29)},
        {"k": "gate", "file": "file 3, .gcode, 800 KB", "verdict": "blocked", "blocking": ["Pre-flight: Extrudes outside the build volume"], "warnings": [],
         "t": stamp(DAYS[3], 20, 15)},
        {"k": "slice", "engine": "OrcaSlicer", "version": "2.4.2", "ok": True, "status": "done", "secs": 48.5, "model": "file 4, .3mf, 1.2 MB", "t": stamp(DAYS[2], 19, 2)},
        {"k": "slice", "engine": "OrcaSlicer", "version": "2.4.2", "ok": False, "status": "failed", "secs": 3.1, "model": "file 5, .stl, 9.8 MB", "stage": "run",
         "report": "Sample: the engine stopped at the run stage (a made-up failure for this page).", "t": stamp(DAYS[2], 19, 20)},
        {"k": "convert", "source": "Bambu Studio", "ok": True, "plates": 2, "colours": 3, "warnings": ["Check the nozzle size"], "t": stamp(DAYS[3], 19, 40)},
        {"k": "note", "s": "sample02", "text": "Pause took a few seconds to react.", "screen": "printer", "last": ["click #ctrl-pause-resume", "open printer"],
         "t": stamp(DAYS[2], 20, 13)},
        {"k": "update", "from": "0.20.15", "to": "0.20.16", "ok": True, "words": "", "t": stamp(DAYS[3], 18, 5)},
        {"k": "feature", "s": "sample00", "name": "needs_you", "t": stamp(DAYS[0], 18, 20)},
        {"k": "feature", "s": "sample00", "name": "camera", "t": stamp(DAYS[0], 18, 21)},
    ]
    return [{k: v for k, v in e.items() if v is not None} for e in out]


def build():
    """(report dict, page html) for the sample, from the fixed made-up events."""
    agg = tester_report.Aggregator()
    for event in events():
        agg.add(event)
    server = {"os": "Windows 11 (sample)", "python": "3.12.4", "machine": "AMD64", "app_version": "0.20.16", "printers_added": 1, "watch_only": False,
              "engine": {"app": "OrcaSlicer", "version": "2.4.2", "ok": True}, "modules_on": [], "modules_off": ["wled_bridge", "webrtc_camera"]}
    report = agg.result(server_setup=server, now=stamp("2026-11-28", 22) / 1000.0)
    return report, tester_report.render_html(report, sample=True)


def main():
    report, page = build()
    target = os.path.join(ROOT, "frontend", "demo", "tester-report-sample.html")
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    s = report["summary"]
    print("wrote %s (%d bytes); the card's sample figures are days %d, actions %d, errors %d, slow spots %d" % (
        os.path.relpath(target, ROOT), len(page.encode("utf-8")), s["days_used"], s["clicks"], s["errors_total"], s["slow_spots"]))


if __name__ == "__main__":
    main()
