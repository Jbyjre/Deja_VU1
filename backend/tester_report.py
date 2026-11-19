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
from tester_report_part1 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    AREA_NAMES, CATEGORIES, FEATURES, NEVER, ROUTE_AREAS, ROUTINE_ORDER, SCREEN_NAMES, SEVERITY_RANK, SLOWEST,
    SLOW_CLICK_MS, SLOW_REQUEST_MS, _CLICK_BUCKETS, _DATA_DIR, _NETWORK_WORDS, _Stat, _Sums, _bucket, _count_into,
    _day, _feature_of, _file_key, _findings, _fresh_counts, _iso, _median, _norm_message, _percentile, _remask,
    _report_cache, _rng, _round, _routine, _short, _times, _totals_cache, _wmedian, categorize, forget,
    iter_events, totals,
)
from tester_report_part2 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    Aggregator, _os_name, build_report, setup_facts,
)
from tester_report_part3 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    build_html, cached_report,
)


# ---------------------------------------------------------------------------
# Reading events
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# The totals the Settings card shows
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# What is on this computer (the report's Setup)
# ---------------------------------------------------------------------------


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


