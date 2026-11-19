#!/usr/bin/env python3
"""
Writes frontend/tester-report-sample.html (not in frontend/demo/, which the demo recorder empties): the page "View sample report" opens in the online demo.

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
import tester_study  # noqa: E402

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
    extra = random.Random(61)          # the new fields come from here, so rng above keeps producing the same counts
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
            roll = extra.random()
            how = ("touch" if roll < 0.85 else "mouse") if n == 3 else ("mouse" if roll < 0.9 else "key" if roll < 0.97 else "pen")
            out.append({"k": "click", "s": sid, "ctl": ctl, "screen": screen, "paint": rng.randrange(1100, 2600) if slow else rng.randrange(18, 140),
                        "t": t, "slow": True if slow else None, "how": how, "role": "button", "gap": extra.randrange(400, 30000),
                        "x": None if how == "key" else extra.randrange(2, 98), "y": None if how == "key" else extra.randrange(3, 97),
                        "dbl": True if extra.random() < 0.02 else None})
            if i % 9 == 0:
                out.append({"k": "screen", "s": sid, "screen": rng.choice(SCREENS), "ms": rng.randrange(8000, 240000), "t": t,
                            "via": extra.choice(["[data-dest=files] in #rail", "[data-dest=printer] in #rail", "address", "[data-tab=queue]"])})
        out.append({"k": "req", "s": sid, "route": "/api/live/snapshot", "method": "GET", "agg": True, "n": 600, "ok": 600, "fail": 0, "p50": 14,
                    "max": 190, "t": t})
        out.append({"k": "fps", "s": sid, "surface": "twin", "fps": 38 + n * 3, "layers": 180 + n * 20, "t": t + 100})
        out.append({"k": "session", "s": sid, "ev": "end", "ms": (t - start), "t": t + 200})
        out.append({"k": "perf", "s": sid, "boot": True, "fcp": 380 + n * 11, "lcp": 620 + n * 17, "cls": 4, "dcl": 210 + n * 5, "load": 540 + n * 9,
                    "ttfb": 18, "heap": 24.5 + n, "nodes": 1900 + n * 40, "t": start + 6000})
        out.append({"k": "perf", "s": sid, "heap": 31.2 + n * 2.5, "nodes": 2300 + n * 60, "long": 1, "up": 3600, "t": start + 3600000})
        out.append({"k": "server", "up": 14400 + n * 86400, "cpu": 62.0 + n * 400, "rss": 118.0 + n * 6, "threads": 21 + n, "disk_free": 52000 - n * 300, "t": start + 7200000})
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
        {"k": "slice", "engine": "Snapmaker_Orca", "version": "2.4.1", "ok": False, "status": "failed", "secs": 3.1, "model": "file 5, .stl, 9.8 MB", "stage": "slice",
         "cause": "orca_-100", "exit": 4294967196,
         "why": "Orca hit an error while slicing (Orca's code -100). It printed: [warning] plate 1: found slicing warnings: Empty layers detected between 4.2 and 4.4 (a made-up failure for this page)",
         "stderr": "[sample] This output is made up to show the layout.\n[warning] plate 1: found slicing warnings: Empty layers detected between 4.2 and 4.4",
         "stdout": "[sample] slicing plate 1\nSlic3r::CLI::run found error, exit",
         "report": '{"outcome": {"status": "failed", "message": "Orca hit an error while slicing (Orca\'s code -100)", "cause": "orca_-100"}, "stage": "slice"}',
         "t": stamp(DAYS[2], 19, 20)},
        {"k": "convert", "source": "Bambu Studio", "ok": True, "plates": 2, "colours": 3, "warnings": ["Check the nozzle size"], "t": stamp(DAYS[3], 19, 40)},
        {"k": "note", "s": "sample02", "text": "Pause took a few seconds to react.", "screen": "printer", "last": ["click #ctrl-pause-resume", "open printer"],
         "t": stamp(DAYS[2], 20, 13)},
        {"k": "update", "from": "0.20.15", "to": "0.20.16", "ok": True, "words": "", "t": stamp(DAYS[3], 18, 5)},
        {"k": "feature", "s": "sample00", "name": "needs_you", "t": stamp(DAYS[0], 18, 20)},
        {"k": "feature", "s": "sample00", "name": "camera", "t": stamp(DAYS[0], 18, 21)},
    ]
    # The first run: setup, then the quick tour.
    first = stamp(DAYS[0], 17, 58)
    out.append({"k": "session", "s": "sample00", "ev": "start", "first": True, "t": first - 1000})
    out.append({"k": "onboarding", "s": "sample00", "ev": "wizard_open", "first": True, "step": 1, "of": 7, "t": first})
    for number, (name, ms, how) in enumerate([("Welcome", 6200, "next"), ("Make it yours", 14800, "next"), ("Your printer", 52000, "next"), ("The tour", 4100, "next"),
                                              ("Your phone", 7300, "next"), ("Desktop app", 3300, "next"), ("Keep up to date", 5400, "done")], 1):
        out.append({"k": "onboarding", "s": "sample00", "ev": "wizard_step", "step": number, "of": 7, "name": name, "ms": ms, "how": how, "t": first + number * 20000})
    out.append({"k": "onboarding", "s": "sample00", "ev": "wizard_end", "how": "done", "step": 7, "of": 7, "ms": 93100, "t": first + 160000})
    out.append({"k": "onboarding", "s": "sample00", "ev": "tour_start", "of": 9, "name": "A quick look around.", "t": first + 170000})
    for number in range(1, 5):
        out.append({"k": "onboarding", "s": "sample00", "ev": "tour_step", "step": number, "of": 9, "name": "Stop %d" % number, "ms": 5000 + number * 900,
                    "how": "next", "t": first + 170000 + number * 7000})
    out.append({"k": "onboarding", "s": "sample00", "ev": "tour_end", "how": "ended", "step": 5, "of": 9, "ms": 41000, "t": first + 215000})
    out.append({"k": "printer", "ev": "connect", "printer": "printer 1", "t": stamp(DAYS[0], 18, 4)})
    out.append({"k": "req", "s": "sample00", "route": "/api/printers/discover", "method": "POST", "status": 200, "ms": 1900, "t": stamp(DAYS[0], 17, 59)})
    out.append({"k": "req", "s": "sample00", "route": "/api/printers/test", "method": "POST", "status": 200, "ms": 640, "t": stamp(DAYS[0], 18, 0, 20)})
    out.append({"k": "req", "s": "sample00", "route": "/api/fleet/registry", "method": "POST", "status": 200, "ms": 310, "t": stamp(DAYS[0], 18, 1)})
    # What they changed, the keys they used, and the things around the app.
    for number, (ctl, role, extra_fields) in enumerate([("#demo-toggle", "switch", {"on": True}), ("#tester-setting-sample", "switch", {"on": False}),
                                                        ("[data-look-choice=glass]", "radio", {"on": True}), ("#speed-slider", "range", {"num": 120}),
                                                        ("#queue-auto", "switch", {"on": True})]):
        out.append(dict({"k": "change", "s": "sample01", "ctl": ctl, "screen": "settings", "role": role, "t": stamp(DAYS[1], 19, 10 + number)}, **extra_fields))
    for number, combo in enumerate(["ctrl-k", "ctrl-k", "/", "g", "Escape", "Escape", "alt-1", "ctrl-j"]):
        out.append({"k": "key", "s": "sample01", "combo": combo, "screen": "overview", "t": stamp(DAYS[1], 19, 20 + number)})
    out.append({"k": "net", "s": "sample03", "ev": "offline", "screen": "printer", "t": stamp(DAYS[3], 21, 1)})
    out.append({"k": "net", "s": "sample03", "ev": "online", "ms": 58000, "t": stamp(DAYS[3], 21, 2)})
    out.append({"k": "net", "s": "sample03", "ev": "ws_close", "code": 1006, "clean": False, "screen": "printer", "t": stamp(DAYS[3], 21, 2, 30)})
    for number in range(3):
        out.append({"k": "slowroute", "method": "GET", "route": "/api/files/analysis", "ms": 2100 + number * 400, "t": stamp(DAYS[2], 19, 30 + number)})
    out.append({"k": "resize", "s": "sample03", "w": 390, "h": 844, "bp": "phone", "t": stamp(DAYS[3], 21, 0)})
    # Made up: nine requests waited about 27 s together while a time-lapse copy ran, then the page lost the server twice.
    stall_end = stamp(DAYS[2], 20, 31)
    for number, route in enumerate(["/api/connection", "/api/leds", "/api/cost/:id", "/api/health", "/api/queue", "/api/maintenance", "/api/chamber", "/api/printers", "/api/fleet"]):
        out.append({"k": "req", "s": "sample02", "route": route, "method": "GET", "status": 200, "ms": 26800 + number * 90, "slow": True, "screen": "printer", "t": stall_end})
        out.append({"k": "req", "s": "sample02", "route": route, "method": "GET", "agg": True, "n": 400, "ok": 400, "fail": 0, "p50": 7, "max": 60, "t": stamp(DAYS[2], 20, 0)})
    out.append({"k": "req", "s": "sample02", "route": "/api/timelapse/keep", "method": "POST", "status": 200, "ms": 28000, "slow": True, "screen": "printer", "t": stall_end + 500})
    out.append({"k": "slowroute", "method": "POST", "route": "/api/timelapse/keep", "ms": 28000, "t": stall_end + 500})
    for number in range(5):               # the server notes itself every five minutes, so the computer was awake and Deja Vu1 was running
        out.append({"k": "server", "up": 90000 + number * 300, "cpu": 540.0 + number, "rss": 131.0, "threads": 23, "disk_free": 51400, "t": stall_end - 600000 + number * 300000})
    out.append({"k": "click", "s": "sample02", "ctl": "button \"Keep a copy here\" in #timelapse-card", "screen": "printer", "paint": 35, "how": "mouse", "role": "button",
                "t": stall_end - 28500})
    for number, (day, hour, minute, second) in enumerate([(DAYS[3], 21, 2, 5), (DAYS[3], 21, 2, 9), (DAYS[4], 18, 40, 0)]):
        out.append({"k": "req", "s": "sample03", "route": "/api/app/alive", "method": "GET", "status": 0, "ms": 30, "err": "Failed to fetch", "t": stamp(day, hour, minute, second)})
    for number, (ev, extra_fields) in enumerate([("questions_open", {"n": 0}), ("section", {"sec": 1, "ms": 61000}), ("section", {"sec": 4, "ms": 118000}),
                                                  ("finish", {"n": 17}), ("report_viewed", {}), ("report_saved", {"n": 182000})]):
        out.append(dict({"k": "study", "s": "sample05", "ev": ev, "t": stamp(DAYS[5], 17, 20 + number)}, **extra_fields))
    # The two errors carry more: the control pressed, the printer's state and a call stack.
    for e in out:
        if e["k"] == "err" and e.get("kind") == "js":
            e.update(ctl="[data-dest=files] in #rail", pstate="printing", stack=["renderFiles app.js:1204:17", "onTab app.js:3102:9"])
        elif e["k"] == "err":
            e.update(ctl="#ctrl-pause-resume", pstate="printing")
    out.append({"k": "note", "s": "sample02", "text": "The pause button looked pressed but nothing changed for a while.", "tag": "slow", "screen": "printer",
                "after_err": True, "err": "Pause failed: the printer reported a failure: Unknown command", "pstate": "printing",
                "last": ["click #ctrl-pause-resume", "open printer"], "t": stamp(DAYS[2], 20, 15)})
    return [{k: v for k, v in e.items() if v is not None} for e in out]


SAMPLE_ANSWERS = {
    "q1": (None, "Four months, 0.4 mm on every head, Snapmaker Orca. Stock firmware."),
    "q2": (None, "About ten minutes. I had to install Python first."),
    "q3": (None, "It found the printer on the first try."),
    "q4": (None, "The sidebar made sense. Printers and Printer look alike at first."),
    "q5": (None, "Pause felt slow once, and I pressed it twice."),
    "q6": (None, "Temperatures and progress matched the touchscreen. All four heads showed up."),
    "q7": (None, "Yes. A change on the touchscreen showed up in about 20 seconds."),
    "q8": (None, "The camera picture took about 20 seconds to appear. The twin kept up."),
    "q9": (None, "The summary was clear. It stopped a file that went off the bed, and that was right."),
    "q11": (None, "Pause said confirmed by the printer. I did not skip an object."),
    "q13": (None, "Slicing with Snapmaker Orca failed once; the preview of the other slice looked right."),
    "q16": ("didnt_try", ""), "q17": ("didnt_try", ""),
    "q18": (None, "Confirm Print. It caught a mistake I would have made."),
    "q19": (None, "Pause felt slow, and one error appeared on the Files screen."),
    "q20": (None, "Make the camera start faster."),
    "q21": (None, "Yes, for a short print."),
    "q22": (None, "Yes. It tells me things the printer's own screen does not."),
}


def sample_study():
    """The made-up answers, in the shape tester_study.view() gives."""
    progress = {"started": "2026-11-23T18:01:00", "started_ms": stamp(DAYS[0], 18, 1), "now_ms": stamp(DAYS[5], 17, 30), "answered": 0, "total": 22,
                "optional_unanswered": 0, "last_export": "2026-11-28T17:29:00", "exports": 1}
    answers = {qid: {"c": choice, "t": text, "at": None} for qid, (choice, text) in SAMPLE_ANSWERS.items()}
    study = tester_study.view(progress, answers)
    study["progress"]["answered"] = study["answered"]
    return study


def build():
    """(report dict, page html) for the sample, from the fixed made-up events."""
    agg = tester_report.Aggregator()
    for event in events():
        agg.add(event)
    server = {"os": "Windows 11 (sample)", "python": "3.12.4", "machine": "AMD64", "app_version": "0.20.16", "printers_added": 1, "watch_only": False,
              "engine": {"app": "OrcaSlicer", "version": "2.4.2", "ok": True}, "modules_on": [], "modules_off": ["wled_bridge", "webrtc_camera"]}
    report = agg.result(server_setup=server, now=stamp("2026-11-28", 22) / 1000.0, study=sample_study())
    return report, tester_report.render_html(report, sample=True)


def main():
    report, page = build()
    target = os.path.join(ROOT, "frontend", "tester-report-sample.html")
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    s = report["summary"]
    print("wrote %s (%d bytes); the card's sample figures are days %d, actions %d, errors %d, slow spots %d" % (
        os.path.relpath(target, ROOT), len(page.encode("utf-8")), s["days_used"], s["clicks"], s["errors_total"], s["slow_spots"]))


if __name__ == "__main__":
    main()
