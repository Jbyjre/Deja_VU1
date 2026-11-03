"""
webrtc_relay.py
===============

The live camera over WebRTC where the printer offers it. The community Extended Firmware for
the U1 lists its camera in Moonraker as service "webrtc-camerastreamer" with stream_url
"/webcam/webrtc" (SnapmakerU1-Extended-Firmware 36fbd40, docs/camera_support.md and
moonraker/02_internal_camera.cfg). Its signalling, read from the camera program it ships
(paxx12/v4l2-mpp 87bda8e, apps/stream-http: the protocol only; no code was copied, it is GPL-3):

  POST stream_url {"type": "request", "iceServers": [...], "keepAlive": true}
       -> {"type": "offer", "sdp": ..., "id": ..., "iceServers": [...]}
  POST stream_url {"type": "answer", "id": ..., "sdp": ...}
  POST stream_url {"type": "remote_candidate", "id": ..., "candidates": [...]}

A web page can't post to the printer itself (another address), so these three messages pass
through Deja Vu1 unchanged; the video then flows straight from the printer to the browser.
Only ever to the printer's own address, only these three message types, small bodies.
Stock U1 firmware lists no such camera: the page then uses the picture stream as before.
"""

import http.client
import json
import ssl
import threading
import time
from urllib.parse import urlparse

import moonraker_client as mc

SERVICE = "webrtc-camerastreamer"
TYPES = ("request", "answer", "remote_candidate")
MAX_BODY = 64 * 1024
LIST_SECONDS = 60
_found = {}
_lock = threading.Lock()


def _listed(printer):
    """(tls, port, path) of the printer's WebRTC camera, or None. Cached for a minute."""
    with _lock:
        hit = _found.get(printer.id)
        if hit and time.monotonic() - hit[0] < LIST_SECONDS and hit[1] == printer.url:
            return hit[2]
    target = None
    try:
        listed = printer.http.request("GET", "/server/webcams/list")
    except mc.PrinterCommandError:
        listed = None
    host = printer.endpoint.host
    for cam in (listed or {}).get("webcams") or []:
        if not isinstance(cam, dict) or cam.get("enabled") is False or cam.get("service") != SERVICE:
            continue
        url = str(cam.get("stream_url") or "").strip()
        if not url:
            continue
        parsed = urlparse(url if "://" in url else "http://" + host + "/" + url.lstrip("/"))
        # Only ever the printer itself: never a way to make this computer post somewhere else.
        if parsed.scheme not in ("http", "https") or parsed.hostname != host:
            continue
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except ValueError:
            continue
        target = (parsed.scheme == "https", port, parsed.path or "/")
        break
    with _lock:
        _found[printer.id] = (time.monotonic(), printer.url, target)
    return target


def info(printer):
    """Whether this printer offers a WebRTC camera: {"available", "service"}."""
    return {"available": _listed(printer) is not None, "service": SERVICE}


def signal(printer, body):
    """Pass one signalling message to the printer's camera and return its JSON answer."""
    if not isinstance(body, dict) or body.get("type") not in TYPES:
        raise ValueError("Only the camera's request, answer and candidate messages pass through")
    data = json.dumps(body).encode("utf-8")
    if len(data) > MAX_BODY:
        raise ValueError("That camera message is too large")
    target = _listed(printer)
    if target is None:
        raise ValueError("This printer's camera doesn't offer WebRTC")
    tls, port, path = target
    cls = http.client.HTTPSConnection if tls else http.client.HTTPConnection
    kwargs = {"context": ssl.create_default_context()} if tls else {}
    conn = cls(printer.endpoint.host, port, timeout=8, **kwargs)
    headers = {"Content-Type": "application/json"}
    if printer.api_key:
        headers["X-Api-Key"] = printer.api_key
    try:
        conn.request("POST", path, body=data, headers=headers)
        response = conn.getresponse()
        raw = response.read(MAX_BODY + 1)
    except (OSError, http.client.HTTPException) as exc:
        raise ValueError(f"The printer's camera didn't answer: {getattr(exc, 'strerror', None) or exc}") from None
    finally:
        conn.close()
    if response.status != 200:
        raise ValueError(f"The printer's camera answered {response.status}")
    if not raw.strip():
        return {}
    try:
        answer = json.loads(raw[:MAX_BODY].decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ValueError("The printer's camera sent something that isn't its WebRTC answer") from None
    return answer if isinstance(answer, dict) else {}


def forget(printer_id=None):
    with _lock:
        if printer_id is None:
            _found.clear()
        else:
            _found.pop(printer_id, None)
