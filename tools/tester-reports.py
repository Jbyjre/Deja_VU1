#!/usr/bin/env python3
"""
Combine several Deja Vu1 tester reports into one set of real totals.

    python3 tools/tester-reports.py report1.zip report2.zip ...
    python3 tools/tester-reports.py reports-folder/          every .zip in the folder
    python3 tools/tester-reports.py reports/ --json          the same numbers as data
    python3 tools/tester-reports.py reports/ --answers       every written answer, question by question
    python3 tools/tester-reports.py reports/ --findings      the combined work list as Markdown

Each zip is the file a tester saved with Settings > Tester mode > Save tester report (or at the end of the questions).
This reads report.json from each (schema_version 1, 2 or 3) and prints: how many testers and days, prints on printers,
which computers and browsers, how the first run went, how people pressed, the errors people hit (grouped by what they
said), the slowest controls, the problems that came up for the most testers, what they answered, and the features nobody
used. The counts are the ones a write-up can quote. Testers are numbered in the order given ("Tester 3"); a report holds
no names, and neither does this output.

The problems are combined the way one report ranks them: the app's own faults come first (at most ten under "Fix first", each
with how many testers hit it, the screen, the last presses before it and where to look in the code), then the conditions around
the app (the printer off, the network down), then the rest by part of the app. Findings that differ only in their numbers
("stopped answering for 27 s at 13:31" and "for 31 s at 09:02") are one finding.

Standard-library Python only.
"""

import argparse
import io
import json
import os
import re
import statistics
import sys
import zipfile
from collections import Counter, defaultdict

SUPPORTED = (1, 2, 3)
FIX_FIRST_MAX = 10
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def load(path):
    """report.json from one zip as a dict, or raises ValueError in words."""
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if "report.json" not in names:
                raise ValueError("%s has no report.json" % os.path.basename(path))
            report = json.loads(archive.read("report.json").decode("utf-8"))
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError("%s is not a readable zip (%s)" % (os.path.basename(path), exc))
    except ValueError as exc:
        raise ValueError("%s: report.json is not valid JSON (%s)" % (os.path.basename(path), exc))
    if not isinstance(report, dict) or report.get("schema_version") not in SUPPORTED:
        raise ValueError("%s has schema_version %r; this tool reads %s" % (
            os.path.basename(path), report.get("schema_version") if isinstance(report, dict) else None,
            ", ".join(str(v) for v in SUPPORTED)))
    return report


def collect(paths):
    """Every zip named, or found in a named folder, in a stable order."""
    found = []
    for path in paths:
        if os.path.isdir(path):
            found += sorted(os.path.join(path, n) for n in os.listdir(path) if n.lower().endswith(".zip"))
        else:
            found.append(path)
    return found


def os_family(text):
    text = str(text or "").lower()
    for word, name in (("windows", "Windows"), ("mac", "macOS"), ("darwin", "macOS"), ("ubuntu", "Linux"), ("debian", "Linux"),
                       ("fedora", "Linux"), ("linux", "Linux"), ("arch", "Linux")):
        if word in text:
            return name
    return "other" if text else "unknown"


def normal(message):
    return re.sub(r"\d+", "#", str(message or ""))[:160]


def combine(reports):
    """The totals across a list of report dicts."""
    out = {"testers": len(reports), "days": 0, "most_days": 0, "sessions": 0, "minutes_open": 0.0, "clicks": 0,
           "prints": Counter(), "demo_prints_started": 0, "computers": Counter(), "browsers": Counter(),
           "python": Counter(), "app_versions": Counter(), "printer_versions": Counter(), "engines": Counter(),
           "devices": Counter(), "watch_only_testers": 0}
    errors = {}
    controls = {}
    requests = {}
    feature_users = defaultdict(set)
    feature_sections = {}
    gate = Counter()
    gate_reasons = Counter()
    slices, converts = Counter(), Counter()
    fps = defaultdict(list)
    notes = 0
    slow_spots = 0
    thinned_testers = 0
    answers = {}
    findings = {}
    how = Counter()
    hours = [0] * 24
    wizard = Counter()
    connect_minutes = []
    paint_medians = []
    load_ms = []
    answered_counts = []
    for index, report in enumerate(reports):
        s = report.get("summary") or {}
        out["days"] += s.get("days_used") or 0
        out["most_days"] = max(out["most_days"], s.get("days_used") or 0)
        out["sessions"] += s.get("sessions") or 0
        out["minutes_open"] += s.get("minutes_open") or 0
        out["clicks"] += s.get("clicks") or 0
        slow_spots += s.get("slow_spots") or 0
        for key, name in (("prints_started", "started"), ("prints_finished", "finished"), ("prints_failed", "failed"),
                          ("prints_cancelled", "cancelled")):
            out["prints"][name] += s.get(key) or 0
        out["demo_prints_started"] += s.get("demo_prints_started") or 0
        setup = report.get("setup") or {}
        server = setup.get("server") or {}
        out["computers"][os_family(server.get("os"))] += 1
        out["python"][str(server.get("python") or "unknown").rsplit(".", 1)[0]] += 1
        out["app_versions"][str(server.get("app_version") or "unknown")] += 1
        if server.get("watch_only"):
            out["watch_only_testers"] += 1
        engine = server.get("engine") or {}
        if engine.get("app"):
            out["engines"]["%s %s" % (engine.get("app"), engine.get("version") or "")] += 1
        for browser in (setup.get("browsers") or [])[-1:]:
            out["browsers"]["%s %s" % (browser.get("browser"), browser.get("bver") or "")] += 1
        sessions = report.get("sessions") or []
        for device in {x.get("device") for x in sessions if x.get("device")}:
            out["devices"][device] += 1
        for printer in ((report.get("printer") or {}).get("firmware") or {}).values():
            out["printer_versions"][", ".join("%s %s" % (k, v) for k, v in sorted(printer.items()))] += 1
        for group in (report.get("errors") or {}).get("groups", []):
            entry = errors.setdefault((group.get("kind"), normal(group.get("message"))),
                                      {"kind": group.get("kind"), "message": group.get("message"), "count": 0, "testers": set()})
            entry["count"] += group.get("count") or 0
            entry["testers"].add(index)
        for c in (report.get("clicks") or {}).get("controls", []):
            entry = controls.setdefault(c.get("control"), {"count": 0, "weighted": 0.0, "slowest": 0, "slow": 0, "testers": set()})
            n = c.get("count") or 0
            entry["count"] += n
            if c.get("median_ms") is not None:
                entry["weighted"] += c["median_ms"] * n
            entry["slowest"] = max(entry["slowest"], c.get("slowest_ms") or 0)
            entry["slow"] += c.get("slow_count") or 0
            entry["testers"].add(index)
        for r in (report.get("requests") or {}).get("routes", []):
            entry = requests.setdefault((r.get("method"), r.get("route")), {"count": 0, "failed": 0, "slowest": 0, "slow": 0})
            entry["count"] += r.get("count") or 0
            entry["failed"] += r.get("failed") or 0
            entry["slowest"] = max(entry["slowest"], r.get("slowest_ms") or 0)
            entry["slow"] += r.get("slow_count") or 0
        for f in (report.get("features") or {}).get("detail", []):
            feature_sections[f["name"]] = (f.get("questions_section"), f.get("questions_section_name"))
            if f.get("used"):
                feature_users[f["name"]].add(index)
            else:
                feature_users.setdefault(f["name"], set())
        cp = report.get("confirm_print") or {}
        for verdict, n in (cp.get("by_verdict") or {}).items():
            gate[verdict] += n
        gate["went_on"] += cp.get("went_on_to_print") or 0
        for item in cp.get("reasons") or []:
            gate_reasons[normal(item.get("reason"))] += item.get("count") or 0
        for sl in report.get("slicing") or []:
            slices["worked" if sl.get("ok") else "failed"] += 1
        for cv in report.get("converter") or []:
            converts["worked" if cv.get("ok") else "failed"] += 1
        for surface, v in (report.get("smoothness") or {}).items():
            if v.get("median_fps") is not None:
                fps[surface].append(v["median_fps"])
        notes += len(report.get("notes") or [])
        if (report.get("thinning") or {}).get("happened"):
            thinned_testers += 1
        # Schema 2: the test round and answers, the work list, the first run and how people pressed.
        study = report.get("study") or {}
        if study.get("answered") is not None:
            answered_counts.append(study.get("answered") or 0)
        for a in study.get("answers") or []:
            if not a.get("answered"):
                continue
            entry = answers.setdefault(a.get("question") or a["id"], {"n": a.get("n"), "section": a.get("section_name"), "question": a.get("question"),
                                                  "answered": 0, "choices": Counter(), "texts": []})
            entry["answered"] += 1
            if a.get("choice"):
                entry["choices"][a["choice"]] += 1
            if (a.get("answer") or "").strip():
                entry["texts"].append({"tester": index + 1, "choice": a.get("choice_label"), "text": a["answer"].strip()})
        for f in report.get("findings") or []:
            key = (f.get("kind"), normal(f.get("title")))
            origin = f.get("origin") or ("condition" if f.get("kind") in ("network", "printer") else "app")   # reports before schema 3 have no origin
            entry = findings.setdefault(key, {"kind": f.get("kind"), "title": f.get("title"), "severity": f.get("severity") or "low", "origin": origin,
                                              "area": f.get("area"), "detail": f.get("detail"), "where": f.get("where") or [], "code": f.get("code") or [],
                                              "screens": f.get("screens") or [], "trail": f.get("trail") or [], "testers": set(), "count": 0,
                                              "tester_said": False})
            entry["testers"].add(index + 1)
            entry["count"] += f.get("count") or 1
            entry["tester_said"] = entry["tester_said"] or bool(f.get("tester_said"))
            if SEVERITY_RANK.get(f.get("severity"), 3) < SEVERITY_RANK.get(entry["severity"], 3):
                entry["severity"] = f["severity"]
            if not entry["trail"] and f.get("trail"):
                entry["trail"] = f["trail"]
            for place in f.get("code") or []:
                if place not in entry["code"]:
                    entry["code"].append(place)
        usage = report.get("usage") or {}
        for method, n in ((usage.get("how_they_click") or {}).get("methods") or {}).items():
            how[method] += n
        for hour, n in enumerate(usage.get("hours") or []):
            if hour < 24:
                hours[hour] += n or 0
        wz = (report.get("onboarding") or {}).get("wizard") or {}
        for key in ("opened", "finished", "skipped", "closed_early"):
            wizard[key] += wz.get(key) or 0
        for m in report.get("milestones") or []:
            if m.get("id") == "printer_connected" and m.get("minutes_after_start") is not None:
                connect_minutes.append(m["minutes_after_start"])
        paint = ((report.get("stats") or {}).get("click_to_paint") or {}).get("median_ms")
        if paint is not None:
            paint_medians.append(paint)
        load = ((report.get("performance") or {}).get("start_up") or {}).get("page_loaded_ms")
        if load is not None:
            load_ms.append(load)
    out["minutes_open"] = round(out["minutes_open"], 1)
    out["prints"] = dict(out["prints"])
    for key in ("computers", "browsers", "python", "app_versions", "printer_versions", "engines", "devices"):
        out[key] = dict(out[key].most_common())
    out["errors"] = sorted(({"kind": e["kind"], "message": e["message"], "count": e["count"], "testers": len(e["testers"])}
                            for e in errors.values()), key=lambda e: (-e["count"], e["message"] or ""))
    out["slowest_controls"] = sorted(
        ({"control": name, "presses": e["count"], "median_ms": round(e["weighted"] / e["count"]) if e["count"] else None,
          "slowest_ms": e["slowest"], "slow_presses": e["slow"], "testers": len(e["testers"])} for name, e in controls.items() if e["slow"]),
        key=lambda c: (-c["slowest_ms"], c["control"] or ""))
    out["slowest_requests"] = sorted(
        ({"request": "%s %s" % key, "times": e["count"], "failed": e["failed"], "slowest_ms": e["slowest"], "slow": e["slow"]}
         for key, e in requests.items() if e["slow"]), key=lambda r: (-r["slowest_ms"], r["request"]))
    out["failed_requests"] = sorted(
        ({"request": "%s %s" % key, "times": e["count"], "failed": e["failed"]} for key, e in requests.items() if e["failed"]),
        key=lambda r: (-r["failed"], r["request"]))
    total = len(reports)
    out["features"] = [{"name": name, "testers_used": len(users), "of": total, "questions_section": feature_sections[name][0],
                        "questions_section_name": feature_sections[name][1]} for name, users in feature_users.items()]
    out["features"].sort(key=lambda f: (f["testers_used"], f["questions_section"] or 0, f["name"]))
    out["features_nobody_used"] = [f["name"] for f in out["features"] if f["testers_used"] == 0]
    out["confirm_print"] = dict(gate)
    out["confirm_print_reasons"] = [{"reason": r, "count": c} for r, c in gate_reasons.most_common(15)]
    out["slices"] = dict(slices)
    out["conversions"] = dict(converts)
    out["smoothness_median_fps"] = {k: {"testers": len(v), "lowest": min(v), "median": statistics.median(v), "highest": max(v)}
                                    for k, v in fps.items()}
    out["notes"] = notes
    out["slow_spots"] = slow_spots
    out["reports_thinned"] = thinned_testers
    out["questions_answered_median"] = statistics.median(answered_counts) if answered_counts else None
    out["questions"] = [{"id": "q%s" % e["n"], "n": e["n"], "section": e["section"], "question": e["question"], "answered": e["answered"], "of": len(reports),
                         "choices": dict(e["choices"]), "texts": e["texts"]} for qid, e in sorted(answers.items(), key=lambda kv: kv[1]["n"] or 0)]
    ranked = sorted(({"kind": e["kind"], "title": e["title"], "severity": e["severity"], "origin": e["origin"], "area": e["area"], "detail": e["detail"],
                      "where": e["where"], "code": e["code"][:4], "screens": e["screens"], "trail": e["trail"][-5:], "testers": len(e["testers"]),
                      "tester_numbers": sorted(e["testers"]), "count": e["count"], "tester_said": e["tester_said"]} for e in findings.values()),
                    key=lambda f: (SEVERITY_RANK.get(f["severity"], 3), -f["testers"], -f["count"], f["title"] or ""))
    picked = 0
    for f in ranked:
        f["fix_first"] = None
        if picked < FIX_FIRST_MAX and f["origin"] == "app" and f["severity"] in ("high", "medium"):
            picked += 1
            f["fix_first"] = picked
    out["findings"] = ranked
    out["first_run"] = {"setup_opened": wizard["opened"], "setup_finished": wizard["finished"], "setup_skipped": wizard["skipped"],
                        "setup_closed_early": wizard["closed_early"],
                        "median_minutes_to_first_connection": statistics.median(connect_minutes) if connect_minutes else None,
                        "testers_who_connected": len(connect_minutes)}
    out["how_they_press"] = dict(how.most_common())
    out["presses_by_hour"] = hours
    out["median_press_to_change_ms"] = statistics.median(paint_medians) if paint_medians else None
    out["median_page_load_ms"] = statistics.median(load_ms) if load_ms else None
    return out


def _hm(minutes):
    minutes = float(minutes or 0)
    return "%d h %02d min" % (minutes // 60, round(minutes % 60)) if minutes >= 60 else "%d min" % round(minutes)


def _counts(counter):
    return ", ".join("%s %d" % (k, v) for k, v in counter.items()) or "none recorded"


def render(c):
    lines = []
    add = lines.append
    add("Deja Vu1 tester reports: %d report%s combined" % (c["testers"], "" if c["testers"] == 1 else "s"))
    add("")
    add("Use")
    add("  Testers                %d" % c["testers"])
    add("  Days used              %d in all (most by one tester: %d)" % (c["days"], c["most_days"]))
    add("  Sessions               %d, open for %s" % (c["sessions"], _hm(c["minutes_open"])))
    add("  Buttons pressed        %d" % c["clicks"])
    add("  Devices                %s" % _counts(c["devices"]))
    p = c["prints"]
    add("")
    add("Prints on a printer (demo data not counted%s)" % (", %d more on demo data" % c["demo_prints_started"] if c["demo_prints_started"] else ""))
    add("  Started %d, finished %d, failed %d, cancelled %d" % (p.get("started", 0), p.get("finished", 0), p.get("failed", 0), p.get("cancelled", 0)))
    add("")
    add("Setups")
    add("  Computers              %s" % _counts(c["computers"]))
    add("  Browsers               %s" % _counts(c["browsers"]))
    add("  Python                 %s" % _counts(c["python"]))
    add("  Deja Vu1 versions      %s" % _counts(c["app_versions"]))
    add("  Printer versions       %s" % _counts(c["printer_versions"]))
    add("  Slicing engines        %s" % _counts(c["engines"]))
    add("  Watch-only on          %d tester%s" % (c["watch_only_testers"], "" if c["watch_only_testers"] == 1 else "s"))
    add("")
    add("Errors, grouped by what they said (%d kinds)" % len(c["errors"]))
    for e in c["errors"][:15]:
        add("  %4d x  %d tester%s  [%s] %s" % (e["count"], e["testers"], "" if e["testers"] == 1 else "s", e["kind"], (e["message"] or "")[:110]))
    if not c["errors"]:
        add("  none")
    add("")
    add("Slowest controls (pressed slowly at least once)")
    for s in c["slowest_controls"][:15]:
        add("  %-46s %4d presses, %2d slow, median %s ms, slowest %s ms, %d tester%s" % (
            (s["control"] or "")[:46], s["presses"], s["slow_presses"], s["median_ms"], s["slowest_ms"], s["testers"], "" if s["testers"] == 1 else "s"))
    if not c["slowest_controls"]:
        add("  none")
    add("")
    add("Slowest requests (over 2 s at least once)")
    for r in c["slowest_requests"][:10]:
        add("  %-46s %5d times, slowest %s ms" % (r["request"][:46], r["times"], r["slowest_ms"]))
    if not c["slowest_requests"]:
        add("  none")
    add("")
    add("Requests that failed")
    for r in c["failed_requests"][:10]:
        add("  %-46s %5d of %d" % (r["request"][:46], r["failed"], r["times"]))
    if not c["failed_requests"]:
        add("  none")
    add("")
    add("Features: how many testers used each (fewest first)")
    for f in c["features"]:
        add("  %-24s %d of %d   (questions section %s)" % (f["name"], f["testers_used"], f["of"], f["questions_section"]))
    add("  Nobody used: %s" % (", ".join(c["features_nobody_used"]) or "none, every feature was used by someone"))
    add("")
    g = c["confirm_print"]
    add("Confirm Print: %d checks (clear %d, needed a confirm %d, refused %d), %d went on to a print" % (
        sum(v for k, v in g.items() if k != "went_on"), g.get("clear", 0), g.get("confirm", 0), g.get("blocked", 0), g.get("went_on", 0)))
    for r in c["confirm_print_reasons"][:6]:
        add("  %4d x  %s" % (r["count"], r["reason"][:110]))
    add("Slices: %s.  Conversions: %s." % (_counts(Counter(c["slices"])), _counts(Counter(c["conversions"]))))
    for surface, v in sorted(c["smoothness_median_fps"].items()):
        add("Smoothness, %s: median %s fps across %d tester%s (lowest %s, highest %s)" % (
            {"twin": "3D twin", "gcode": "G-code preview"}.get(surface, surface), v["median"], v["testers"], "" if v["testers"] == 1 else "s",
            v["lowest"], v["highest"]))
    add("Notes written: %d.  Slow spots in all: %d.  Reports where the record was thinned: %d." % (c["notes"], c["slow_spots"], c["reports_thinned"]))
    fr = c["first_run"]
    add("")
    add("First run")
    add("  Setup opened %d time%s: finished %d, skipped %d, closed early %d" % (
        fr["setup_opened"], "" if fr["setup_opened"] == 1 else "s", fr["setup_finished"], fr["setup_skipped"], fr["setup_closed_early"]))
    add("  First printer connection: %d of %d tester%s, median %s minutes after the first press" % (
        fr["testers_who_connected"], c["testers"], "" if c["testers"] == 1 else "s", fr["median_minutes_to_first_connection"] if fr["median_minutes_to_first_connection"] is not None else "n/a"))
    add("How people pressed: %s.  Median press to change: %s ms.  Median page load: %s ms." % (
        _counts(Counter(c["how_they_press"])), c["median_press_to_change_ms"] if c["median_press_to_change_ms"] is not None else "n/a",
        c["median_page_load_ms"] if c["median_page_load_ms"] is not None else "n/a"))
    add("")
    add("Fix first: the app's own faults, worst first, with how many testers hit each (--findings has the detail)")
    first = [f for f in c["findings"] if f["fix_first"]]
    for f in first:
        add("  %2d. [%-6s] %d of %d tester%s  %s" % (f["fix_first"], f["severity"], f["testers"], c["testers"], "" if c["testers"] == 1 else "s", (f["title"] or "")[:100]))
    if not first:
        add("  none")
    around = [f for f in c["findings"] if f["origin"] == "condition"]
    if around:
        add("Around the app (conditions, not faults in it)")
        for f in around[:10]:
            add("  [%-6s] %d of %d tester%s  %s" % (f["severity"], f["testers"], c["testers"], "" if c["testers"] == 1 else "s", (f["title"] or "")[:100]))
    if c["questions"]:
        add("")
        add("The questions: how many testers answered each (median %s of %d per tester)" % (
            c["questions_answered_median"] if c["questions_answered_median"] is not None else "n/a", max([q["n"] or 0 for q in c["questions"]] or [0])))
        for q in c["questions"]:
            ch = q["choices"]
            add("  %2d. %-58s %d of %d%s" % (q["n"], (q["question"] or "")[:58], q["answered"], q["of"],
                                              "   Didn't try it %d" % ch.get("didnt_try", 0) if ch.get("didnt_try") else ""))
        add("  (--answers prints every written answer)")
    return "\n".join(lines) + "\n"


def render_answers(c):
    """Every written answer, question by question, each marked with the tester's number."""
    lines = ["Deja Vu1 tester answers: %d report%s" % (c["testers"], "" if c["testers"] == 1 else "s"), ""]
    section = None
    for q in c["questions"]:
        if q["section"] != section:
            section = q["section"]
            lines += ["", section.upper(), ""]
        lines.append("%d. %s" % (q["n"], q["question"]))
        if q["choices"]:
            lines.append("   Didn't try it: %d" % q["choices"].get("didnt_try", 0))
        for t in q["texts"]:
            lines.append("   Tester %d%s: %s" % (t["tester"], " (%s)" % t["choice"] if t["choice"] else "", t["text"]))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _fix_lines(c, f, number=None):
    lines = ["### %s[%s] %s" % (("%d. " % number) if number else "", f["severity"], f["title"]),
             "- Testers: %d of %d (%s), %d time%s%s" % (f["testers"], c["testers"], ", ".join(str(n) for n in f["tester_numbers"]), f["count"],
                                                     "" if f["count"] == 1 else "s", ", the tester said" if f["tester_said"] else ""),
             "- Screen: %s" % (", ".join(f["screens"]) if f.get("screens") else f.get("area") or "not recorded")]
    if f.get("detail"):
        lines.append("- What happened (from one tester): %s" % f["detail"])
    lines.append("- Last presses before it (from one tester): %s" % ("; ".join(f["trail"]) if f.get("trail") else "none recorded"))
    lines.append("- Where to look: %s" % ("; ".join(list(f.get("code") or []) + [w for w in f.get("where") or [] if not str(w).startswith("Code: ")])
                                          or "not enough was recorded to point at code"))
    lines.append("")
    return lines


def render_findings(c):
    """The combined work list as Markdown: the top fixes first, then the conditions around the app, then the rest by part of the app."""
    lines = ["# Deja Vu1 tester findings, %d report%s combined" % (c["testers"], "" if c["testers"] == 1 else "s"), "",
             "Fix first holds the app's own faults rated high or medium, worst first (at most ten). A finding that several testers hit",
             "is one finding with the testers listed. Around the app lists conditions that are not the app's fault.", "", "## Fix first", ""]
    first = [f for f in c["findings"] if f["fix_first"]]
    for f in first:
        lines += _fix_lines(c, f, f["fix_first"])
    if not first:
        lines += ["Nothing needed fixing in what was recorded.", ""]
    around = [f for f in c["findings"] if f["origin"] == "condition"]
    if around:
        lines += ["## Around the app", ""]
        for f in around:
            lines += _fix_lines(c, f)
    more = [f for f in c["findings"] if f["origin"] == "app" and not f["fix_first"]]
    if more:
        lines += ["## More findings", ""]
        groups = {}
        for f in more:
            groups.setdefault(f.get("area") or "Other", []).append(f)
        for area, rows in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            lines += ["### %s (%d)" % (area, len(rows)), ""]
            for f in rows:
                lines.append("- [%s] %s: %d of %d tester%s. Look at: %s" % (f["severity"], f["title"], f["testers"], c["testers"], "" if c["testers"] == 1 else "s",
                                                                           ", ".join(f.get("code") or []) or "n/a"))
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Combine Deja Vu1 tester reports (the zips testers save) into real totals.")
    parser.add_argument("paths", nargs="+", help="zip files, or folders that hold them")
    parser.add_argument("--json", action="store_true", help="print the totals as JSON")
    parser.add_argument("--answers", action="store_true", help="print every written answer, question by question")
    parser.add_argument("--findings", action="store_true", help="print the combined work list as Markdown")
    args = parser.parse_args(argv)
    reports, skipped = [], []
    for path in collect(args.paths):
        try:
            reports.append(load(path))
        except ValueError as exc:
            skipped.append(str(exc))
    for message in skipped:
        sys.stderr.write("skipped: %s\n" % message)
    if not reports:
        sys.stderr.write("No readable tester reports were found.\n")
        return 1
    combined = combine(reports)
    combined["skipped"] = len(skipped)
    if args.json:
        sys.stdout.write(json.dumps(combined, indent=2) + "\n")
    elif args.answers:
        sys.stdout.write(render_answers(combined))
    elif args.findings:
        sys.stdout.write(render_findings(combined))
    else:
        sys.stdout.write(render(combined))
    return 0


if __name__ == "__main__":
    sys.exit(main())
