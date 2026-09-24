"""
Low-latency camera (optional): WebRTC through a go2rtc you run yourself.

The dashboard's default camera is still the MJPEG relay in camera.py. This
module only helps the browser *start* a WebRTC connection with go2rtc
(https://github.com/AlexxIT/go2rtc) - a separate program the user installs.
Nothing here imports or needs go2rtc: if it isn't set up, isn't running, or
answers wrongly, the browser falls back to MJPEG.

The one go2rtc call used, read from its source (internal/webrtc/server.go,
`outputWebRTC`), is:

    POST {go2rtc}/api/webrtc?src={stream name}
    Content-Type: application/json
    {"type": "offer", "sdp": "v=0..."}   ->   {"type": "answer", "sdp": "v=0..."}

go2rtc's API listens on port 1984 by default (internal/api/api.go). The
offer goes through this server rather than straight from the browser, so
go2rtc needs no cross-origin (CORS) setting. The video itself still flows
directly between go2rtc and the browser (go2rtc's WebRTC port, 8555).
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "webrtc_settings.json")
_URL = re.compile(r"^https?://[^\s/?#]{1,200}(/[^\s?#]{0,200})?$")
_STREAM = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
MAX_SDP = 64 * 1024
DEFAULTS = {"go2rtc_url": "", "stream": ""}


def get_settings():
    if not os.path.exists(_SETTINGS_PATH):
        return dict(DEFAULTS)
    with open(_SETTINGS_PATH, "r", encoding="utf-8") as fh:
        saved = json.load(fh)
    return {k: str(saved.get(k) or "") for k in DEFAULTS}


def save_settings(updates):
    url = str(updates.get("go2rtc_url") or "").strip().rstrip("/")
    stream = str(updates.get("stream") or "").strip()
    if url and not _URL.match(url):
        raise ValueError("Enter go2rtc's address, like http://192.168.1.50:1984")
    if stream and not _STREAM.match(stream):
        raise ValueError("The stream name is the name from go2rtc's streams list, "
                         "like u1 (letters, numbers, - _ . : only)")
    if bool(url) != bool(stream):
        raise ValueError("Fill in both go2rtc's address and the stream name, or clear both")
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump({"go2rtc_url": url, "stream": stream}, fh)
    return get_settings()


def reset():
    if os.path.exists(_SETTINGS_PATH):
        os.remove(_SETTINGS_PATH)


def is_configured(settings=None):
    s = settings or get_settings()
    return bool(s["go2rtc_url"] and s["stream"])


def signalling_url(settings=None):
    s = settings or get_settings()
    return f"{s['go2rtc_url']}/api/webrtc?src={urllib.parse.quote(s['stream'], safe='')}"


def _check_sdp(desc, kind):
    if not isinstance(desc, dict) or desc.get("type") != kind:
        raise ValueError(f"Expected a WebRTC {kind}")
    sdp = desc.get("sdp")
    if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp) > MAX_SDP:
        raise ValueError(f"That WebRTC {kind} isn't a valid session description")
    return sdp


def exchange(offer, timeout=8):
    """Send the browser's offer to go2rtc and return its answer.

    Raises ValueError with a plain-language reason on any problem, so the
    browser can say why it fell back to MJPEG.
    """
    settings = get_settings()
    if not is_configured(settings):
        raise ValueError("The low-latency camera isn't set up. Add go2rtc's address in Modules & devices")
    sdp = _check_sdp(offer, "offer")
    req = urllib.request.Request(
        signalling_url(settings),
        data=json.dumps({"type": "offer", "sdp": sdp}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(MAX_SDP + 1024)
    except urllib.error.HTTPError as exc:
        detail = exc.read(300).decode("utf-8", "replace").strip()
        if exc.code == 404:
            raise ValueError(f"go2rtc has no stream called \"{settings['stream']}\"")
        raise ValueError(f"go2rtc refused the connection ({exc.code}{': ' + detail if detail else ''})")
    except (urllib.error.URLError, OSError) as exc:
        raise ValueError(f"Couldn't reach go2rtc at {settings['go2rtc_url']}: {getattr(exc, 'reason', exc)}")
    try:
        return {"type": "answer", "sdp": _check_sdp(json.loads(body), "answer")}
    except ValueError:
        raise ValueError("go2rtc's reply wasn't the expected WebRTC answer")
