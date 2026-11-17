#!/usr/bin/env python3
"""
Combine several Deja Vu1 tester reports into one set of real totals.

    python3 tools/tester-reports.py report1.zip report2.zip ...
    python3 tools/tester-reports.py reports-folder/          every .zip in the folder
    python3 tools/tester-reports.py reports/ --json          the same numbers as data

Each zip is the file a tester saved with Settings > Tester mode > Save tester report. This reads
report.json from each (schema_version 1) and prints: how many testers and days, prints on printers,
which computers and browsers, the errors people hit (grouped by what they said), the slowest controls,
and the features nobody used. The counts are the ones a write-up can quote. Names are not read or
printed: a report holds none, and neither does this output.

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

SUPPORTED = (1,)


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
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Combine Deja Vu1 tester reports (the zips testers save) into real totals.")
    parser.add_argument("paths", nargs="+", help="zip files, or folders that hold them")
    parser.add_argument("--json", action="store_true", help="print the totals as JSON")
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
    sys.stdout.write(json.dumps(combined, indent=2) + "\n" if args.json else render(combined))
    return 0


if __name__ == "__main__":
    sys.exit(main())
