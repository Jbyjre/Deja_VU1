"""
camera.py
=========

Bridges the printer's camera feed into the dashboard, and watches it: if no
new frame has arrived in a while, the feed is flagged as frozen instead of
silently showing a stale image forever.

The video stream itself is nothing this module can simulate — that needs a
real camera on a real printer. What it can simulate, and what is genuinely
useful the moment a real camera is connected, is the watchdog logic:
comparing "when did a frame last arrive" against "now."
"""

from datetime import datetime, timedelta

STALE_AFTER_SECONDS = 30

_last_frame_at = datetime.now()


def receive_frame():
    """Call this each time a new frame arrives from the camera."""
    global _last_frame_at
    _last_frame_at = datetime.now()


def get_status():
    seconds_since = (datetime.now() - _last_frame_at).total_seconds()
    return {
        "last_frame_at": _last_frame_at.isoformat(timespec="seconds"),
        "seconds_since_last_frame": round(seconds_since, 1),
        "frozen": seconds_since > STALE_AFTER_SECONDS,
    }


def reset():
    """Pretend the last frame just arrived. Useful for tests."""
    global _last_frame_at
    _last_frame_at = datetime.now()


def _simulate_age(seconds):
    """Test hook: pretend the last frame arrived `seconds` ago."""
    global _last_frame_at
    _last_frame_at = datetime.now() - timedelta(seconds=seconds)
