"""
error_codes.py
==============

What the printer's error codes mean, taken from Snapmaker's own wiki.

The Snapmaker U1 shows a problem as four groups of four digits, for example 0002-0523-0000-0000:

    level (0001 notice, 0002 warning that pauses the print, 0003 error that stops it)
    - main module (0523 toolhead, 0525 filament feeder, ...)
    - sub-module (often which toolhead, counted from 0000)
    - issue

`backend/reference/u1_error_codes.json` holds the wiki's reference table word for word (made by
`tools/update-error-codes.py`, with the page it came from and the day it was read). This module reads it, finds
codes in the printer's messages, and builds the answer the dashboard shows. It never writes an explanation of its
own: a code the table does not list is reported as not listed, with what its four groups still say, and the page
that lists the codes is named so an owner can check.

Pure reading, standard library only. Nothing here talks to a printer or the network.
"""

import json
import os
import re
import threading

import wiki_page

CODE_RE = wiki_page.CODE_RE
_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference", "u1_error_codes.json")
_lock = threading.Lock()
_cache = {}


def _table():
    """The reference table, read once. A missing or damaged file gives an empty table, never an error."""
    with _lock:
        if "t" not in _cache:
            try:
                with open(_FILE, encoding="utf-8") as handle:
                    data = json.load(handle)
                if not isinstance(data, dict) or not isinstance(data.get("codes"), dict):
                    raise ValueError("not a table")
            except (OSError, ValueError):
                data = {"codes": {}, "levels": {}, "modules": {}, "articles": {}, "videos": {}, "notes": [],
                        "structure": [], "source": {}}
            _cache["t"] = data
        return _cache["t"]


def reload():
    """Forget what was read (tests, and after the table file is replaced)."""
    with _lock:
        _cache.clear()


def parse(code):
    """The four groups of a code as numbers and text, or None when it is not a code."""
    text = str(code or "").strip()
    if not re.fullmatch(r"\d{4}-\d{4}-\d{4}-\d{4}", text):
        return None
    level, module, sub, issue = text.split("-")
    return {"code": text, "level": int(level), "module": module, "sub": sub, "issue": issue}


def find_codes(text):
    """Every code in a piece of text, in order, each once."""
    seen = []
    for found in CODE_RE.findall(str(text or "")):
        if found not in seen:
            seen.append(found)
    return seen


def code_from_numbers(level, ident, index, number):
    """The code string the printer's own numbers make (level, id, index, code), or None when any is out of range."""
    try:
        parts = [int(level), int(ident), int(index), int(number)]
    except (TypeError, ValueError):
        return None
    if any(p < 0 or p > 9999 for p in parts):
        return None
    return "%04d-%04d-%04d-%04d" % tuple(parts)


def _effect(level):
    """What the wiki's severity table says happens to the print: paused, stopped or continues."""
    row = _table()["levels"].get(str(level)) or {}
    said = str(row.get("print_effect", "")).lower()
    if "paused" in said:
        return "paused"
    if "stopped" in said:
        return "stopped"
    if said:
        return "continues"
    return {2: "paused", 3: "stopped", 1: "continues", 0: "continues"}.get(level)


def _guide(slug, match=None):
    table = _table()
    info = table["articles"].get(slug)
    if not slug or not info:
        return None
    guide = {"slug": slug, "title": info.get("title", ""), "url": guide_url(slug), "videos": []}
    for clip in info.get("videos", []):
        found = _video(clip.get("id"))
        if found:
            found["start"] = int(clip.get("start") or 0)
            guide["videos"].append(found)
    if match:
        guide["match"] = match
    return guide


def guide_url(slug):
    """The wiki address of a guide, from the slug the table holds."""
    return wiki_page.WIKI_ORIGIN + "/en/snapmaker_u1/" + str(slug)


def valid_slug(slug):
    """A guide the table knows about. Nothing else is ever fetched, whatever a request says."""
    return isinstance(slug, str) and slug in _table()["articles"]


def _video(video_id):
    info = _table()["videos"].get(video_id)
    if not video_id or not info:
        return None
    return {"id": video_id, "title": info.get("title", ""), "channel": info.get("channel", ""),
            "url": "https://www.youtube.com/watch?v=" + video_id}


def _covered_by_guides(code):
    """A guide whose title names this code, for a code the table itself does not list."""
    for slug, info in _table()["articles"].items():
        if code in info.get("codes", []):
            return slug
    return None


def describe(code, message=None):
    """
    Everything the table says about one code. Always has "code", "known", "level", "level_name", "effect",
    "module", "module_name" and "source". "known" is True when Snapmaker's table lists the code; then "title" and
    "details" are the wiki's own words. A guide, and a video where the table points to one, come with it.
    """
    parsed = parse(code)
    if not parsed:
        return None
    table = _table()
    entry = table["codes"].get(parsed["code"])
    level = table["levels"].get(str(parsed["level"])) or {}
    out = dict(parsed)
    out.update({
        "known": entry is not None,
        "level_name": level.get("name") or {0: "Invalid", 1: "Notice", 2: "Warning", 3: "Error"}.get(parsed["level"]),
        "effect": _effect(parsed["level"]),
        "module_name": table["modules"].get(parsed["module"]),
        "title": entry["title"] if entry else None,
        "details": entry["details"] if entry else None,
        "guide": None,
        "video": None,
        "source": dict(table.get("source") or {}),
    })
    if entry:
        out["guide"] = _guide(entry.get("article"), entry.get("match"))
        out["video"] = _video(entry.get("video"))
    else:
        out["guide"] = _guide(_covered_by_guides(parsed["code"]))
    if message:
        out["message"] = str(message)[:500]
    return out


def level_row(level):
    """The wiki's own cells for one severity level (what it risks, what it does to the print, what you must do)."""
    return dict(_table()["levels"].get(str(level)) or {})


def _row(code, entry, table):
    parsed = parse(code)
    level = table["levels"].get(str(parsed["level"])) or {}
    return {"code": code, "level": parsed["level"], "level_name": level.get("name"), "title": entry["title"],
            "details": entry["details"], "module": parsed["module"],
            "module_name": table["modules"].get(parsed["module"]),
            "guide": bool(entry.get("article")), "video": bool(entry.get("video"))}


def search(query, limit=40):
    """
    Codes that match what was typed: a whole code, part of one (0523-0001), or words from the title, the details or
    the module name. Returns {"results": [...], "total": n}; at most `limit` rows come back, best matches first.
    """
    table = _table()
    text = str(query or "").strip().lower()[:80]
    if not text:
        return {"results": [], "total": 0}
    rows = []
    if re.fullmatch(r"[\d-]{3,19}", text):
        for code, entry in table["codes"].items():
            if code == text:
                rows.append((0, code, entry))
            elif code.startswith(text) or code[5:].startswith(text):
                rows.append((1, code, entry))
            elif text in code:
                rows.append((2, code, entry))
    else:
        words = [w for w in re.split(r"[\s,;:/]+", text) if w]
        for code, entry in table["codes"].items():
            title = entry["title"].lower()
            hay = " ".join((title, entry["details"].lower(), str(table["modules"].get(code[5:9], "")).lower()))
            if all(w in hay for w in words):
                rows.append((0 if all(w in title for w in words) else 1, code, entry))
    rows.sort(key=lambda r: (r[0], r[1]))
    return {"results": [_row(code, entry, table) for _, code, entry in rows[:max(1, int(limit))]], "total": len(rows)}


def reference():
    """How to read a code, and the table's size and source, for the dashboard's "how codes work" panel."""
    table = _table()
    codes = table["codes"]
    return {"source": dict(table.get("source") or {}), "levels": table["levels"], "modules": table["modules"],
            "structure": table["structure"], "notes": table["notes"],
            "counts": {"codes": len(codes),
                       "guides": sum(1 for e in codes.values() if e.get("article")),
                       "videos": sum(1 for e in codes.values() if e.get("video"))}}
