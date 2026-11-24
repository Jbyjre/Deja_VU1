"""
static_files.py
===============

The page's own files (its scripts, styles and HTML, about 2.6 MB in all) sent compressed, so the dashboard opens
faster, above all on a phone over Wi-Fi: compressed they come to about a quarter of that.

A browser on this same computer gets the files as they are: nothing travels over a network there, so compressing
would only cost time (measured 24 November 2026: the first visit took about 650 ms plain and 970 ms compressed).

Each file is compressed once and kept in memory until it changes on disk, so a second visit costs no work. A
browser that already has the file gets a short "304 Not Modified" (the ETag says which version it has). Files that
are already compressed (pictures, videos, fonts), small files and requests for part of a file are left to the
built-in file server, which sends them as they are.
"""

import email.utils
import gzip
import os
import threading

TEXT = {".js", ".css", ".html", ".json", ".svg", ".webmanifest", ".txt", ".md", ".xml"}
SMALLEST = 1024                 # below this, compressing saves less than it costs

_lock = threading.Lock()
_cache = {}                     # path -> (mtime_ns, size, compressed bytes)


def _compressed(path, stat):
    key = (stat.st_mtime_ns, stat.st_size)
    with _lock:
        hit = _cache.get(path)
    if hit and hit[:2] == key:
        return hit[2]
    with open(path, "rb") as f:
        body = gzip.compress(f.read(), 6)
    with _lock:
        _cache[path] = (key[0], key[1], body)
    return body


def same_computer(handler):
    """True for a browser on this computer (a loopback address in any form). Used only to skip compression."""
    ip = str((handler.client_address or ("",))[0])
    if ip.startswith("::ffff:"):
        ip = ip[7:]
    return ip == "::1" or ip.startswith("127.")


def send(handler):
    """Answer a GET for a text file compressed. False when the built-in file server should answer instead."""
    if "gzip" not in (handler.headers.get("Accept-Encoding") or "") or handler.headers.get("Range"):
        return False
    if same_computer(handler):
        return False
    path = handler.translate_path(handler.path)
    if os.path.isdir(path):
        if not handler.path.split("?", 1)[0].endswith("/"):
            return False                                    # the built-in server redirects to the address with a /
        path = os.path.join(path, "index.html")
    if os.path.splitext(path)[1].lower() not in TEXT:
        return False
    try:
        stat = os.stat(path)
    except OSError:
        return False
    if stat.st_size < SMALLEST or not os.path.isfile(path):
        return False
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-gz"'
    if etag in (handler.headers.get("If-None-Match") or ""):
        handler.send_response(304)
        handler.send_header("ETag", etag)
        handler.send_header("Vary", "Accept-Encoding")
        handler.end_headers()
        return True
    try:
        body = _compressed(path, stat)
    except OSError:
        return False
    handler.send_response(200)
    handler.send_header("Content-Type", handler.guess_type(path))
    handler.send_header("Content-Encoding", "gzip")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("ETag", etag)
    handler.send_header("Last-Modified", email.utils.formatdate(stat.st_mtime, usegmt=True))
    handler.send_header("Vary", "Accept-Encoding")
    handler.end_headers()
    handler.wfile.write(body)
    return True
