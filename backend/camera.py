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

import os
import re
import threading
import time
import urllib.error
import urllib.request
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "camera_settings.json")
_URL = re.compile(r"^https?://[^\s]{1,300}$")
_frame_lock = threading.Lock()
_latest_frame = None
_latest_frame_mono = 0.0
MAX_BUFFER = 4 * 1024 * 1024


def get_settings():
    if not os.path.exists(_SETTINGS_PATH):
        return {"stream_url": ""}
    return {"stream_url": "", **storage.load_json(_SETTINGS_PATH, {})}


def save_settings(updates):
    url = str(updates.get("stream_url") or "").strip()
    if url and not _URL.match(url):
        raise ValueError("Enter the camera's stream address, like http://192.168.1.50/webcam/?action=stream")
    storage.save_json(_SETTINGS_PATH, {"stream_url": url})
    return get_settings()


def latest_frame(max_age=None):
    """
    The newest camera frame, or None. With max_age (seconds), a frame older
    than that counts as none - so a time-lapse never stores the same stale
    picture again as if it were the latest layer.
    """
    with _frame_lock:
        if max_age is not None and time.monotonic() - _latest_frame_mono > max_age:
            return None
        return _latest_frame


# Frames normally arrive only while someone watches the stream. A time-lapse
# of a real printer needs them while nobody does, so the live feed asks for
# them here: one background reader, only while it keeps being asked, that
# stops on its own shortly after (and retries a camera that drops).
_grab = {"until": 0.0, "thread": None, "error": None}
_grab_lock = threading.Lock()


def keep_frames_coming(seconds=90):
    """Keep reading the camera for at least `seconds` more. False when no camera is set up."""
    if not get_settings().get("stream_url"):
        return False
    with _grab_lock:
        _grab["until"] = time.monotonic() + seconds
        if _grab["thread"] and _grab["thread"].is_alive():
            return True
        _grab["thread"] = threading.Thread(target=_grab_loop, name="camera-grabber", daemon=True)
        _grab["thread"].start()
    return True


def _grab_loop():
    wanted = lambda: time.monotonic() < _grab["until"]      # noqa: E731
    while wanted():
        try:
            upstream = open_stream(timeout=10)
            try:
                ctype = upstream.headers.get("Content-Type", "")
                if looks_like_camera(ctype):
                    _grab["error"] = None
                    relay(upstream, lambda chunk: None, lambda: not wanted())
                else:
                    _grab["error"] = f"The camera address answered with {ctype or 'no content type'}, not a picture"
            finally:
                upstream.close()
        except (ValueError, OSError) as exc:
            _grab["error"] = str(exc)
        if wanted():
            time.sleep(5)            # a snapshot URL is polled; a dropped stream is retried


class FrameSplitter:
    """Pulls whole JPEGs (FFD8 ... FFD9) out of an MJPEG byte stream."""

    def __init__(self):
        self.buffer = b""

    def feed(self, chunk):
        global _latest_frame, _latest_frame_mono
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
                _latest_frame_mono = time.monotonic()
            receive_frame()
            found += 1
        return found


def looks_like_camera(content_type):
    """An MJPEG stream or a single image - nothing else is relayed."""
    kind = (content_type or "").split(";")[0].strip().lower()
    return kind == "multipart/x-mixed-replace" or kind.startswith("image/")


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
