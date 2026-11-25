"""
notifications.py
=================

Sends an alert when a print finishes or fails, over plain webhooks - ntfy.sh,
Discord, or Telegram - no account, no SDK, no dependency: all three accept a
plain HTTPS POST, which Python's standard `urllib` already knows how to do.

The one piece of real logic here is priority: a failed print always notifies
right away, because that is the one that costs you time and material the
longer it sits unnoticed. A successful print is not urgent, so if it finishes
during your configured quiet hours, the alert is queued and sent the next
time someone checks in outside those hours (a real deployment would flush
the queue from a background loop; the dashboard's own load can trigger a
flush too, which is what `get_settings` conventionally pairs with).
"""

import base64
import json
import os
import re
import threading
import uuid
from datetime import datetime

import outbound
import storage

_queue_lock = threading.Lock()

_DATA_DIR = storage.DATA_DIR
_SETTINGS_PATH = os.path.join(_DATA_DIR, "notification_settings.json")
_QUEUE_PATH = os.path.join(_DATA_DIR, "notification_queue.json")

_DEFAULT_SETTINGS = {
    "ntfy_topic": "",
    "discord_webhook_url": "",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "quiet_hours_start": 22,   # 10pm
    "quiet_hours_end": 7,      # 7am - wraps past midnight
}


def _load_json(path, default):
    if not os.path.exists(path):
        return default
    return storage.load_json(path, default)


def _save_json(path, data):
    storage.save_json(path, data)


def get_settings():
    settings = dict(_DEFAULT_SETTINGS)
    settings.update(_load_json(_SETTINGS_PATH, {}))
    return settings


# What each setting must look like. Checking these keeps the dashboard from
# being turned into a way to send requests to arbitrary addresses, and turns
# a typo into a clear message instead of a notification that silently fails.
_PATTERNS = {
    "ntfy_topic": (re.compile(r"^[A-Za-z0-9_-]{1,64}$"),
                   "An ntfy topic is letters, numbers, - and _ only (up to 64)"),
    "discord_webhook_url": (re.compile(r"^https://(?:canary\.|ptb\.)?(?:discord|discordapp)\.com"
                                       r"/api/webhooks/\d{1,25}/[A-Za-z0-9_-]{1,100}$"),
                            "Paste the Discord webhook address, which starts "
                            "https://discord.com/api/webhooks/"),
    "telegram_bot_token": (re.compile(r"^\d{3,15}:[A-Za-z0-9_-]{20,100}$"),
                           "A Telegram bot token looks like 123456789:ABC-def... (from @BotFather)"),
    "telegram_chat_id": (re.compile(r"^(?:-?\d{1,20}|@[A-Za-z0-9_]{4,32})$"),
                         "A Telegram chat ID is a number (or @channelname)"),
}
# Settings that work like passwords: saved, used, never sent back out.
SECRET_KEYS = ("discord_webhook_url", "telegram_bot_token")
MAX_QUEUED = 50


def public_settings(settings=None):
    """The settings as the dashboard page sees them: secrets masked."""
    settings = dict(settings or get_settings())
    for key in SECRET_KEYS:
        settings[key] = storage.mask_secret(settings.get(key))
    return settings


def _hour(value, name):
    try:
        hour = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an hour from 0 to 23")
    if not 0 <= hour <= 23:
        raise ValueError(f"{name} must be an hour from 0 to 23")
    return hour


def save_settings(updates):
    settings = get_settings()
    for key, (pattern, message) in _PATTERNS.items():
        if key not in updates:
            continue
        if key in SECRET_KEYS and storage.is_masked(updates[key]):
            continue                      # the masked stand-in: keep what's saved
        value = str(updates[key] or "").strip()
        if value and not pattern.match(value):
            raise ValueError(message)
        settings[key] = value
    if "quiet_hours_start" in updates:
        settings["quiet_hours_start"] = _hour(updates["quiet_hours_start"], "Quiet hours start")
    if "quiet_hours_end" in updates:
        settings["quiet_hours_end"] = _hour(updates["quiet_hours_end"], "Quiet hours end")
    _save_json(_SETTINGS_PATH, settings)
    return settings


def is_quiet_hours(now=None, settings=None):
    """
    Is right now inside the configured quiet-hours window?

    The window can wrap past midnight (e.g. 22 -> 7), so this compares hours
    with that in mind rather than assuming start is always less than end.
    """
    settings = settings or get_settings()
    now = now or datetime.now()
    try:
        start = int(settings["quiet_hours_start"]) % 24
        end = int(settings["quiet_hours_end"]) % 24
    except (KeyError, TypeError, ValueError):
        return False                      # settings saved by an older version: no quiet hours
    hour = now.hour

    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def _get_queue():
    return _load_json(_QUEUE_PATH, [])


def _save_queue(queue):
    _save_json(_QUEUE_PATH, queue)


# Each service's own limit (checked against its source / published docs):
# ntfy.sh DefaultMessageSizeLimit 4096 bytes (server/config.go); a Discord
# webhook's content is up to 2000 characters (discord-api-docs, Execute
# Webhook); Telegram's text up to 4096 characters. Longer is shortened.
NTFY_MAX_BYTES = 4096
DISCORD_MAX = 2000
TELEGRAM_MAX = 4096
# With a picture: Telegram's photo caption is up to 1024 characters and an uploaded photo up to 10 MB (Bot API,
# sendPhoto); a Discord webhook file up to 20 MiB (discord-api-docs, Uploading Files); an ntfy.sh attachment up to
# 15 MB, kept 3 hours (ntfy docs, Attachments). A camera frame is far smaller; a bigger one goes without the picture.
TELEGRAM_CAPTION_MAX = 1024
PICTURE_MAX_BYTES = 8 * 1024 * 1024
_PICTURE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _discord_url(url):
    # Without wait=true Discord answers 204 before saving the message, and
    # "a message that is not saved does not return an error" - so ask it to
    # wait, and a refusal comes back as one.
    return url + ("&" if "?" in url else "?") + "wait=true"


def _clean_picture(picture):
    """(bytes, mime) when it is a JPEG, PNG or WebP small enough to send, else None."""
    if not picture or not isinstance(picture, (tuple, list)) or len(picture) != 2:
        return None
    data, mime = picture
    if not isinstance(data, (bytes, bytearray)) or not data or len(data) > PICTURE_MAX_BYTES \
            or mime not in _PICTURE_TYPES:
        return None
    return bytes(data), mime


def _multipart(fields, file_field, filename, data, mime):
    """A multipart/form-data body (RFC 7578): plain text fields, then one file. Returns (body, content type)."""
    boundary = "dejavu1-" + uuid.uuid4().hex
    out = []
    for name, value in fields:
        out.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        out.append(str(value).encode("utf-8") + b"\r\n")
    out.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
                f"Content-Type: {mime}\r\n\r\n").encode("utf-8"))
    out.append(data + b"\r\n" + f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(out), "; ".join(("multipart/form-data", "boundary=" + boundary))


def _header_text(text):
    """A header value ntfy reads as UTF-8: plain ASCII as it is, anything else as RFC 2047 base64 (ntfy docs)."""
    text = re.sub(r"[\r\n]+", " ", text)
    try:
        text.encode("ascii")
        return text
    except UnicodeEncodeError:
        return "=?UTF-8?B?" + base64.b64encode(text.encode("utf-8")).decode("ascii") + "?="


def _send_now(message, settings=None, picture=None):
    """Actually deliver `message` to every configured channel, with the picture where one is given. Each result says
    what happened, in words."""
    settings = settings or get_settings()
    picture = _clean_picture(picture)
    filename = f"print-watch.{_PICTURE_TYPES[picture[1]]}" if picture else ""
    results = {}

    if settings.get("ntfy_topic"):
        url = f"https://ntfy.sh/{settings['ntfy_topic']}"
        if picture:
            # A file is sent as the PUT body; the words go in the Message header (ntfy docs, Attach local file).
            results["ntfy"] = outbound.send(url, "ntfy.sh", raw=picture[0], method="PUT",
                                            headers={"filename": filename, "content-type": picture[1],
                                                     "message": _header_text(outbound.clip(message, 1000))})
        else:
            results["ntfy"] = outbound.send(url, "ntfy.sh", raw=outbound.clip(message, NTFY_MAX_BYTES, "utf-8")
                                            .encode("utf-8"), method="POST",
                                            headers={"Content-Type": "text/plain; charset=utf-8"})

    if settings.get("discord_webhook_url"):
        url = _discord_url(settings["discord_webhook_url"])
        if picture:
            body, ctype = _multipart([("payload_json", json.dumps({"content": outbound.clip(message, DISCORD_MAX)}))],
                                     "files[0]", filename, *picture)
            results["discord"] = outbound.send(url, "Discord", raw=body, method="POST", headers={"Content-Type": ctype})
        else:
            results["discord"] = outbound.send(url, "Discord", payload={"content": outbound.clip(message, DISCORD_MAX)})

    if settings.get("telegram_bot_token") and settings.get("telegram_chat_id"):
        base = f"https://api.telegram.org/bot{settings['telegram_bot_token']}/"
        if picture:
            body, ctype = _multipart([("chat_id", settings["telegram_chat_id"]),
                                      ("caption", outbound.clip(message, TELEGRAM_CAPTION_MAX))],
                                     "photo", filename, *picture)
            r = outbound.send(base + "sendPhoto", "Telegram", raw=body, method="POST", headers={"Content-Type": ctype})
        else:
            r = outbound.send(base + "sendMessage", "Telegram", payload={"chat_id": settings["telegram_chat_id"],
                                                                         "text": outbound.clip(message, TELEGRAM_MAX)})
        # Telegram answers {"ok": false, "description": ...} when it says no.
        body = r.get("body")
        if r["ok"] and isinstance(body, dict) and body.get("ok") is False:
            r = {"ok": False, "status": r["status"], "error": f"Telegram: {body.get('description', 'refused')}"}
        if not r["ok"]:
            # The bot token is part of the address; never echo it back.
            r["error"] = r["error"].replace(settings["telegram_bot_token"], "<token>")
        results["telegram"] = r

    for r in results.values():
        r.pop("body", None)                # replies can carry the message and chat details back
    return results


def notify(message, priority="normal", settings=None, picture=None):
    """
    Send an alert, or queue it, depending on priority and the time of day.

    priority="high" always sends immediately (a failed print, for example).
    priority="normal" is deferred if it falls inside quiet hours.
    picture: optional (bytes, mime), sent with the words where it goes now; a queued alert keeps only its words.
    """
    if priority not in ("high", "normal"):
        raise ValueError("priority must be 'high' or 'normal'")

    settings = settings or get_settings()
    now = datetime.now()

    if priority == "high" or not is_quiet_hours(now, settings):
        results = _send_now(message, settings, picture)
        return {"sent": True, "queued": False, "results": results}

    with _queue_lock:
        queue = _get_queue()
        queue.append({"message": message, "priority": priority, "queued_at": now.isoformat(timespec="seconds")})
        _save_queue(queue[-MAX_QUEUED:])      # a long quiet spell can't grow it without end
    return {"sent": False, "queued": True, "results": {}}


def notify_print_event(status, filename, settings=None):
    """
    The two events the rest of the app actually cares about: a print
    finished, or a print failed. Failures are always high priority.
    """
    if status == "completed":
        return notify(f"Print finished: {filename}", priority="normal", settings=settings)
    if status == "error":
        return notify(f"Print failed: {filename}", priority="high", settings=settings)
    raise ValueError(f"Unknown print status: {status}")


def flush_queue(settings=None):
    """
    Send every queued notification now (quiet hours are over). One that
    still can't be delivered stays queued for the next try rather than
    being dropped.
    """
    settings = settings or get_settings()
    with _queue_lock:
        queue = _get_queue()
        kept, sent = [], 0
        for item in queue:
            results = _send_now(item["message"], settings)
            if results and not any(r.get("ok") for r in results.values()):
                item["attempts"] = item.get("attempts", 0) + 1
                if item["attempts"] < 24:
                    kept.append(item)
            else:
                sent += 1
        _save_queue(kept)
    return {"flushed": sent, "still_queued": len(kept)}


def flush_if_due(now=None, settings=None):
    """Called by the live feed about once a minute: send what quiet hours held back, once they're over."""
    settings = settings or get_settings()
    if not _get_queue() or is_quiet_hours(now or datetime.now(), settings):
        return None
    return flush_queue(settings)


def get_queue():
    return list(_get_queue())


def reset():
    """Clear settings and queue. Useful for tests."""
    _save_json(_SETTINGS_PATH, dict(_DEFAULT_SETTINGS))
    _save_json(_QUEUE_PATH, [])
