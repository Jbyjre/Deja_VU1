"""
tester_report_part3.py: part 3 of 3 split out of tester_report.py (the tester report's numbers, findings and
zip) on 19 November 2026, so a session reads only the part it needs. tester_report.py imports every name here
back, so `tester_report.<name>` works as before. Holds: build_html, cached_report.
"""

from tester_report_render import README, render_findings, render_html
import os
import tester
import tester_study
import time
from tester_report_part1 import _report_cache  # noqa: F401
from tester_report_part2 import build_report, setup_facts  # noqa: F401


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


def build_html(theme=None, now=None):
    """The same report as one page, for the in-app viewer."""
    return render_html(build_report(server_setup=setup_facts(), now=now, study=tester_study.for_report(now * 1000 if now else None)), theme)
