"""
outbound.py
===========

One way for the dashboard to call someone else's device or service - a
WLED strip, Home Assistant, ntfy, Discord, Telegram - and always come back
with an answer in words instead of an exception or a hang:

    {"ok": True,  "status": 200, "body": <parsed JSON, text, or None>}
    {"ok": False, "status": 401 or None, "error": "Home Assistant refused ..."}

Every failure a real network produces is covered: a name that doesn't
resolve, nothing listening, no answer in time, an answer cut short, an
error status (with the service's own reason when it sends one), and a
reply that isn't what the service should send.
"""

import http.client
import json
import socket
import ssl
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

MAX_REPLY = 1024 * 1024


def _host(url):
    parsed = urlparse(url)
    return parsed.netloc or url


def _reason_from(body):
    """The service's own words from an error body, where it gives them."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, AttributeError):
        text = body.decode("utf-8", "replace").strip() if isinstance(body, bytes) else ""
        return text[:200] if text and not text.startswith("<") else None
    if isinstance(data, dict):
        # Telegram {"description"}, Home Assistant {"message"}, Discord
        # {"message"}, ntfy {"error"}, WLED {"error"} (a code number).
        for key in ("description", "message", "error"):
            if data.get(key) not in (None, ""):
                return str(data[key])[:200]
    return None


def explain(exc, what, url, timeout):
    host = _host(url)
    reason = getattr(exc, "reason", exc)
    if isinstance(reason, socket.gaierror):
        return f"Can't find '{urlparse(url).hostname}' on the network - check {what}'s address"
    if isinstance(reason, ConnectionRefusedError):
        return f"{what} at {host} refused the connection - is it on, and is that the right address and port?"
    if isinstance(reason, (socket.timeout, TimeoutError)):
        return f"No answer from {what} at {host} within {timeout:g} s"
    if isinstance(reason, ssl.SSLError):
        return f"The secure connection to {what} at {host} failed: {getattr(reason, 'reason', None) or reason}"
    if isinstance(exc, http.client.IncompleteRead):
        return f"{what}'s reply was cut off part-way"
    if isinstance(exc, (http.client.RemoteDisconnected, ConnectionResetError)):
        return f"{what} at {host} dropped the connection without answering"
    if isinstance(exc, http.client.HTTPException):
        return f"{what} at {host} answered with something that isn't HTTP - is that the right port?"
    if isinstance(reason, OSError) and getattr(reason, "strerror", None):
        return f"Can't reach {what} at {host}: {reason.strerror}"
    return f"Can't reach {what} at {host}: {reason}"


def send(url, what, payload=None, raw=None, method=None, headers=None, timeout=5.0, expect_json=True):
    """
    One request. `payload` is sent as JSON, `raw` as bytes. Never raises for
    anything the network or the other side does; the result says what happened.
    """
    data = raw if raw is not None else (json.dumps(payload).encode("utf-8") if payload is not None else None)
    hdrs = dict(headers or {})
    if payload is not None and raw is None:
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"),
                                 headers=hdrs)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(MAX_REPLY + 1)
            status = resp.status
            declared = resp.headers.get("Content-Length")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(4096)
        except (OSError, http.client.HTTPException):
            body = b""
        reason = _reason_from(body)
        if exc.code in (401, 403):
            words = f"{what} refused the request ({exc.code}" + (f": {reason}" if reason else "") + \
                    ") - check the token or key saved for it"
        elif exc.code == 404:
            words = f"{what} has nothing at that address (404)" + (f": {reason}" if reason else "")
        elif exc.code == 429:
            words = f"{what} says too many messages, too fast (429) - it will take them again shortly"
        else:
            words = f"{what} answered {exc.code}" + (f": {reason}" if reason else f" {exc.reason}")
        return {"ok": False, "status": exc.code, "error": words}
    except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError) as exc:
        return {"ok": False, "status": None, "error": explain(exc, what, url, timeout)}
    if len(body) > MAX_REPLY:
        return {"ok": False, "status": status, "error": f"{what}'s reply was far larger than expected"}
    if declared and declared.isdigit() and int(declared) != len(body):
        return {"ok": False, "status": status, "error": f"{what}'s reply was cut off part-way"}
    result = {"ok": True, "status": status, "ms": round((time.monotonic() - started) * 1000)}
    if not body:
        result["body"] = None
    elif expect_json:
        try:
            result["body"] = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            start = body[:40].decode("utf-8", "replace").strip()
            return {"ok": False, "status": status,
                    "error": f"{what} answered, but not with JSON (it began \"{start}\") - is that address "
                             f"really {what}?"}
    else:
        result["body"] = body.decode("utf-8", "replace")
    return result


def clip(text, limit, encoding=None):
    """Shorten text to a service's limit (characters, or bytes when `encoding` is given), marking the cut."""
    text = str(text)
    if encoding:
        raw = text.encode(encoding)
        if len(raw) <= limit:
            return text
        return raw[:limit - 3].decode(encoding, "ignore") + "..."
    return text if len(text) <= limit else text[:limit - 1] + "…"
