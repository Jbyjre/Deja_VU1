"""
error_guides.py
===============

Snapmaker's troubleshooting guides, read from their public wiki when an owner asks for one, and kept on this computer.

The error table (error_codes.py) says which guide belongs to a code. This module fetches that guide's page, turns it
into plain blocks (wiki_page.py) and saves the result under <data>/error_guides/, so the guide opens again without the
internet. What it shows is the wiki's own text, steps, pictures and videos; the dashboard always names the page and the
day it was read, and links to the original.

What it will and will not do:
  - It only asks for a guide the table lists (`error_codes.valid_slug`). A request can name a guide, never an address.
  - Only https to the wiki's own host. A redirect anywhere else is refused.
  - A reply over 3 MB, or one that is not a guide, is refused. Nothing in a page runs or reaches the browser as markup.
  - A guide is read again after 14 days, or when the owner presses Refresh; after a failed try it waits 30 seconds
    before trying again, so an offline computer is not asked over and over.
"""

import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

import error_codes
import outbound
import storage
import wiki_page

_DATA_DIR = storage.DATA_DIR
_DIR = os.path.join(_DATA_DIR, "error_guides")
FRESH_DAYS = 14
TIMEOUT = 15
RETRY_AFTER = 30.0
MAX_BYTES = 3 * 1024 * 1024
_lock = threading.Lock()
_slug_locks = {}
_failed_at = {}                 # slug -> (monotonic time, the failure's answer)


class _SameHost(urllib.request.HTTPRedirectHandler):
    """Follows a redirect only when it stays on the wiki over https (the wiki moves pages and keeps short links)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(newurl)
        if parts.scheme != "https" or (parts.hostname or "").lower() != wiki_page.WIKI_HOST:
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SameHost)


def _file(slug):
    return os.path.join(_DIR, re.sub(r"[^A-Za-z0-9_.-]", "_", slug.replace("/", "__")) + ".json")


def _read(slug):
    saved = storage.load_json(_file(slug), None)
    if isinstance(saved, dict) and isinstance(saved.get("blocks"), list) and saved.get("slug") == slug:
        return saved
    return None


def _age_days(saved):
    try:
        return (datetime.now() - datetime.fromisoformat(saved["fetched"])).total_seconds() / 86400
    except (KeyError, TypeError, ValueError):
        return float("inf")


def _words_for(status, url):
    if status == 404:
        return ("Snapmaker's wiki has no page at this address any more (404). They move guides around: search the wiki "
                "for the error code to find where it went.")
    if status in (401, 403):
        return "Snapmaker's wiki is not showing this guide to visitors right now (%s)." % status
    if status == 429:
        return "Snapmaker's wiki asked for fewer requests (429). Try again in a minute."
    return "Snapmaker's wiki answered %s." % status


def _download(slug):
    """One request to the wiki. Returns {"ok": True, "guide": {...}} or {"ok": False, "status": ..., "error": words}."""
    url = error_codes.guide_url(slug)
    request = urllib.request.Request(url, headers={"User-Agent": "DejaVu1", "Accept": "text/html"})
    try:
        with _opener.open(request, timeout=TIMEOUT) as reply:
            body = reply.read(MAX_BYTES + 1)
            final = reply.geturl()
    except urllib.error.HTTPError as error:
        return {"ok": False, "status": error.code, "error": _words_for(error.code, url)}
    except (urllib.error.URLError, OSError, ValueError) as error:
        return {"ok": False, "status": None, "error": outbound.explain(error, "Snapmaker's wiki", url, TIMEOUT)}
    if len(body) > MAX_BYTES:
        return {"ok": False, "status": 200, "error": "The wiki's page was far larger than a guide, so it was not read."}
    if (urllib.parse.urlsplit(final).hostname or "").lower() != wiki_page.WIKI_HOST:
        return {"ok": False, "status": 200, "error": "The wiki sent the request somewhere else, so it was not read."}
    page = wiki_page.parse(body.decode("utf-8", "replace"))
    if not page["blocks"]:
        return {"ok": False, "status": 200, "error": "That wiki page had no guide text in it."}
    table = error_codes._table()
    for video in page["videos"]:
        known = table["videos"].get(video["id"]) or {}
        video["title"] = video["title"] or known.get("title", "")
        video["channel"] = known.get("channel", "")
    guide = {"slug": slug, "title": page["title"] or table["articles"].get(slug, {}).get("title", ""), "url": url,
             "fetched": datetime.now().isoformat(timespec="seconds"), "codes": page["codes"],
             "blocks": page["blocks"], "videos": page["videos"],
             "source": "Snapmaker Wiki"}
    return {"ok": True, "guide": guide}


def get(slug, refresh=False):
    """
    The guide for a slug from the table: {"ok": True, "guide": {...}, "from": "saved" | "wiki", "stale": bool} or
    {"ok": False, "status": n, "error": words, "url": the wiki's address}. A saved copy is used while it is under 14
    days old; an old one is still shown, marked stale, when the wiki cannot be reached.
    """
    if not error_codes.valid_slug(slug):
        return {"ok": False, "status": 404, "error": "Deja Vu1 does not have that guide in its list.", "url": None}
    with _lock:
        guard = _slug_locks.setdefault(slug, threading.Lock())
    with guard:
        saved = _read(slug)
        if saved and not refresh and _age_days(saved) < FRESH_DAYS:
            return {"ok": True, "guide": saved, "from": "saved", "stale": False}
        failed = _failed_at.get(slug)
        if failed and time.monotonic() - failed[0] < RETRY_AFTER:
            got = failed[1]
        else:
            got = _download(slug)
            if got["ok"]:
                _failed_at.pop(slug, None)
                try:
                    os.makedirs(_DIR, exist_ok=True)
                    storage.save_json(_file(slug), got["guide"], indent=None)
                except OSError:
                    pass                    # not kept on disk this time; it is still shown
                return {"ok": True, "guide": got["guide"], "from": "wiki", "stale": False}
            _failed_at[slug] = (time.monotonic(), got)
        if saved:
            return {"ok": True, "guide": saved, "from": "saved", "stale": True, "note": got["error"]}
        return dict(got, url=error_codes.guide_url(slug))


def explain(code):
    """One code with the wiki's words, and whether its guide is already kept on this computer."""
    shown = error_codes.describe(code)
    if not shown:
        raise ValueError("That is not an error code. A U1 code is four groups of four digits, like 0002-0523-0000-0000")
    shown["guide_saved"] = bool(shown["guide"] and saved(shown["guide"]["slug"]))
    return shown


def saved(slug):
    """The kept copy of a guide, or None. Never asks the wiki."""
    return _read(slug) if error_codes.valid_slug(slug) else None


def reset():
    """Forget what was kept and every failed try (tests)."""
    _failed_at.clear()
    if os.path.isdir(_DIR):
        for name in os.listdir(_DIR):
            if not name.startswith("."):
                try:
                    os.remove(os.path.join(_DIR, name))
                except OSError:
                    pass
