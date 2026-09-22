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


# ---------------------------------------------------------------------------
# The stream itself: an MJPEG bridge
# ---------------------------------------------------------------------------
# MJPEG is a stream of ordinary JPEG stills sent one after another in a
# multipart HTTP response - what mjpg-streamer / crowsnest / camera-streamer
# serve, and what every browser's <img> tag can show with no player. This
# dashboard relays it (so it also works through the remote-access tunnel,
# where the printer's own address isn't reachable), and while relaying it
# counts frames for the watchdog and keeps the latest one for time-lapses.
#
# Known property of the method, not a bug: over a weak Wi-Fi link delay can
# slowly build up, because frames queue instead of being dropped. Reloading
# the stream resets it; the dashboard has a "Reconnect" button for that.

import json
import os
import re
import threading
import urllib.error
import urllib.request

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "camera_settings.json")
_URL = re.compile(r"^https?://[^\s]{1,300}$")
_frame_lock = threading.Lock()
_latest_frame = None
MAX_BUFFER = 4 * 1024 * 1024


def get_settings():
    if not os.path.exists(_SETTINGS_PATH):
        return {"stream_url": ""}
    with open(_SETTINGS_PATH, "r", encoding="utf-8") as fh:
        return {"stream_url": "", **json.load(fh)}


def save_settings(updates):
    url = str(updates.get("stream_url") or "").strip()
    if url and not _URL.match(url):
        raise ValueError("Enter the camera's stream address, like http://192.168.1.50/webcam/?action=stream")
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump({"stream_url": url}, fh)
    return get_settings()


def latest_frame():
    with _frame_lock:
        return _latest_frame


class FrameSplitter:
    """Pulls whole JPEGs (FFD8 ... FFD9) out of an MJPEG byte stream."""

    def __init__(self):
        self.buffer = b""

    def feed(self, chunk):
        global _latest_frame
        self.buffer += chunk
        found = 0
        while True:
            start = self.buffer.find(b"\xff\xd8")
            if start < 0:
                self.buffer = b""
                break
            end = self.buffer.find(b"\xff\xd9", start + 2)
            if end < 0:
                self.buffer = self.buffer[start:]
                if len(self.buffer) > MAX_BUFFER:
                    self.buffer = b""
                break
            jpeg = self.buffer[start:end + 2]
            self.buffer = self.buffer[end + 2:]
            with _frame_lock:
                _latest_frame = jpeg
            receive_frame()
            found += 1
        return found


def open_stream(url=None, timeout=10):
    """Open the configured camera stream. Raises ValueError if it can't."""
    url = url or get_settings()["stream_url"]
    if not url:
        raise ValueError("No camera stream is set up. Add its address in Modules & devices")
    try:
        return urllib.request.urlopen(url, timeout=timeout)
    except (urllib.error.URLError, OSError) as exc:
        raise ValueError(f"Couldn't reach the camera: {exc}")


def relay(upstream, write, should_stop):
    """Copy the stream to `write` until the viewer leaves or the camera stops."""
    splitter = FrameSplitter()
    read = getattr(upstream, "read1", upstream.read)
    while not should_stop():
        chunk = read(16384)
        if not chunk:
            break
        splitter.feed(chunk)
        write(chunk)
