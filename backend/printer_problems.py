"""
printer_problems.py
===================

What a printer says is wrong, put into one shape for every screen, rule and record.

The U1's firmware reports a problem as five numbers (level, module, sub-module, issue, plus a message) and tells
Moonraker's clients about it in four places:

    print_stats.exception           why the print is paused or stopped (cleared when it resumes or is cancelled)
    exception_manager.exceptions    problems that stay until they are cleared
    notify_exception_notification   one problem, the moment it is raised, with the time
    the printer's own words         the message text, which can carry the code written out

A printer that is not a U1 reports none of the first three; its message text is still searched for a code.
This module takes whatever arrived and returns the problems in a fixed order with the wiki's explanation
attached (error_codes.py). It does not read the network or a file of its own, and it never raises.
"""

import time

import error_codes

LEVEL_ORDER = {3: 0, 2: 1, 1: 2, 0: 3}
MAX_PROBLEMS = 8


def _iso(stamp):
    try:
        value = float(stamp)
    except (TypeError, ValueError):
        return None
    if value < 1e9 or value > 4e9:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(value))


def entry(raw, source):
    """One report as {"code", "level", "message", "raised_at", "source"}, or None when it holds no usable code."""
    if not isinstance(raw, dict) or not raw:
        return None
    code = error_codes.code_from_numbers(raw.get("level"), raw.get("id"), raw.get("index"), raw.get("code"))
    if not code:
        return None
    message = raw.get("message")
    return {"code": code, "level": int(raw["level"]), "message": str(message)[:500] if message else None,
            "raised_at": _iso(raw.get("timestamp")), "source": source}


def from_text(text, source="message"):
    """Every code written out in a piece of text."""
    found = []
    for code in error_codes.find_codes(text):
        parsed = error_codes.parse(code)
        found.append({"code": code, "level": parsed["level"], "message": None, "raised_at": None, "source": source})
    return found


def collect(state_name, print_exception=None, standing=None, notified=None, texts=None):
    """
    The problems that matter now, the one behind a paused or stopped print first.

    `state_name` is the dashboard's word (printing, paused, error, ready, complete). The print's own exception
    counts only while the print is paused or stopped. Problems the firmware keeps standing are listed whatever the
    state. Codes written into message `texts` count only while the print is paused or stopped. `notified` is the
    recent notifications: they supply the time a problem was raised and nothing else.
    """
    stopped = state_name in ("paused", "error")
    found = []
    if stopped:
        item = entry(print_exception, "print")
        if item:
            found.append(item)
    for raw in standing or []:
        item = entry(raw, "standing")
        if item:
            found.append(item)
    if stopped:
        for text in texts or []:
            found.extend(from_text(text, "message"))
    times = {}
    for raw in notified or []:
        item = entry(raw, "notification")
        if item and item["raised_at"]:
            times[item["code"]] = item["raised_at"]
    seen, ordered = set(), []
    for item in found:
        if item["code"] in seen:
            continue
        seen.add(item["code"])
        item["raised_at"] = item["raised_at"] or times.get(item["code"])
        ordered.append(item)
    first = [i for i in ordered if i["source"] == "print"]
    rest = sorted((i for i in ordered if i["source"] != "print"),
                  key=lambda i: (LEVEL_ORDER.get(i["level"], 9), i["source"] != "standing"))
    return (first + rest)[:MAX_PROBLEMS]


def public(item):
    """An entry with the wiki's explanation, trimmed to what the screens use. Never raises."""
    try:
        shown = error_codes.describe(item["code"], item.get("message"))
    except Exception:                      # noqa: BLE001 - a missing or damaged table must not hide the code itself
        shown = None
    if not shown:
        shown = {"code": item["code"], "level": item["level"], "known": False, "title": None, "details": None,
                 "guide": None, "video": None, "level_name": None, "effect": None, "module_name": None}
    shown = dict(shown)
    shown.pop("source", None)
    shown.pop("sub", None)
    shown.pop("issue", None)
    shown["origin"] = item["source"]
    shown["raised_at"] = item.get("raised_at")
    if item.get("message") and not shown.get("message"):
        shown["message"] = item["message"]
    return shown


def words(problem):
    """One line for a status message or a notification: the wiki's title and the code."""
    if not problem:
        return ""
    if problem.get("title"):
        return "%s (%s)" % (problem["title"], problem["code"])
    return "Printer error %s" % problem["code"]
