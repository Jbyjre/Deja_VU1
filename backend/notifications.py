"""
notifications.py
=================

Sends an alert when a print finishes or fails, over plain webhooks — ntfy.sh,
Discord, or Telegram — no account, no SDK, no dependency: all three accept a
plain HTTPS POST, which Python's standard `urllib` already knows how to do.

The one piece of real logic here is priority: a failed print always notifies
right away, because that is the one that costs you time and material the
longer it sits unnoticed. A successful print is not urgent, so if it finishes
during your configured quiet hours, the alert is queued and sent the next
time someone checks in outside those hours (a real deployment would flush
the queue from a background loop; the dashboard's own load can trigger a
flush too, which is what `get_settings` conventionally pairs with).
"""

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "notification_settings.json")
_QUEUE_PATH = os.path.join(_DATA_DIR, "notification_queue.json")

_DEFAULT_SETTINGS = {
    "ntfy_topic": "",
    "discord_webhook_url": "",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "quiet_hours_start": 22,   # 10pm
    "quiet_hours_end": 7,      # 7am — wraps past midnight
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


def _post(url, payload_bytes, headers):
    request = urllib.request.Request(url, data=payload_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return {"ok": True, "status": response.status}
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        return {"ok": False, "error": str(exc)}


def _send_now(message, settings=None):
    """Actually deliver `message` to every configured channel."""
    settings = settings or get_settings()
    results = {}

    if settings.get("ntfy_topic"):
        url = f"https://ntfy.sh/{settings['ntfy_topic']}"
        results["ntfy"] = _post(url, message.encode("utf-8"), {"Content-Type": "text/plain"})

    if settings.get("discord_webhook_url"):
        body = json.dumps({"content": message}).encode("utf-8")
        results["discord"] = _post(settings["discord_webhook_url"], body, {"Content-Type": "application/json"})

    if settings.get("telegram_bot_token") and settings.get("telegram_chat_id"):
        url = f"https://api.telegram.org/bot{settings['telegram_bot_token']}/sendMessage"
        body = json.dumps({"chat_id": settings["telegram_chat_id"], "text": message}).encode("utf-8")
        results["telegram"] = _post(url, body, {"Content-Type": "application/json"})

    return results


def notify(message, priority="normal", settings=None):
    """
    Send an alert, or queue it, depending on priority and the time of day.

    priority="high" always sends immediately (a failed print, for example).
    priority="normal" is deferred if it falls inside quiet hours.
    """
    if priority not in ("high", "normal"):
        raise ValueError("priority must be 'high' or 'normal'")

    settings = settings or get_settings()
    now = datetime.now()

    if priority == "high" or not is_quiet_hours(now, settings):
        results = _send_now(message, settings)
        return {"sent": True, "queued": False, "results": results}

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
    """Send every queued notification now. Call this when quiet hours end."""
    settings = settings or get_settings()
    queue = _get_queue()
    sent = []
    for item in queue:
        _send_now(item["message"], settings)
        sent.append(item)
    _save_queue([])
    return {"flushed": len(sent)}


def get_queue():
    return list(_get_queue())


def reset():
    """Clear settings and queue. Useful for tests."""
    _save_json(_SETTINGS_PATH, dict(_DEFAULT_SETTINGS))
    _save_json(_QUEUE_PATH, [])
