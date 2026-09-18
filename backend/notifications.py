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
import urllib.error
import urllib.request
from datetime import datetime

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
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save_json(path, data):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def get_settings():
    settings = dict(_DEFAULT_SETTINGS)
    settings.update(_load_json(_SETTINGS_PATH, {}))
    return settings


def save_settings(updates):
    settings = get_settings()
    for key in _DEFAULT_SETTINGS:
        if key in updates:
            settings[key] = updates[key]
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
    start = settings["quiet_hours_start"]
    end = settings["quiet_hours_end"]
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
    _save_queue(queue)
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
