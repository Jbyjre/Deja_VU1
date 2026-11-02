"""On-demand U1 camera pictures, with a separate authenticated socket per printer.

Two sources, tried in this order:

1. A camera Moonraker lists (GET /server/webcams/list). The community
   Extended Firmware publishes its camera this way, with snapshot_url
   "/webcam/snapshot.jpg" served by the printer's web server on port 80;
   Moonraker resolves a partial address against the printer's own address
   (moonraker/components/webcam.py, WebCam._get_url).
2. Snapmaker's own monitor: camera.start_monitor over the WebSocket only
   (u1-moonraker components/repeater.py registers it for every transport
   but HTTP and forwards it to the printer's camera service, which answers
   within 10 s), with {"domain": "lan", "interval": 0}. A successful reply
   is read as {"state": "success", "url": <where the pictures are>} (how
   Snapmaker's desktop app reads it; not yet seen from a real U1); the printer
   keeps rewriting one JPEG, /server/files/camera/monitor.jpg, readable on
   Moonraker's port and through the printer's web server on port 80. A
   failure can come back as a normal reply,
   {"state": "failed", "message": ...}.

How it stays fast and forgiving:
  - The camera is started and the picture is asked for without waiting on
    the start reply (it can take seconds); the reply's reason is only used
    when no picture comes.
  - Pictures come over one kept-open connection, asked for one after another.
  - Port 80 and Moonraker's own port are both tried; whichever answers is kept.
  - A picture that stops changing restarts the camera once (at most every
    5 seconds: Snapmaker's camera service misbehaves when started too often).

Whichever source works is remembered for the session; if both fail, both
reasons are given in words.
"""
import http.client
import json
import ssl
import threading
import time
from urllib.parse import urlparse

import moonraker_client as mc

IDLE_SECONDS = 40
RENEW_SECONDS = 180
START_COOLDOWN = 5          # seconds between camera.start_monitor calls
FIRST_PICTURE_SECONDS = 4   # how long a just-started camera gets to write its first picture
STALE_SECONDS = 8           # an unchanged picture this old restarts the camera once
SHARE_SECONDS = 0.05
MAX_FRAME = 8 * 1024 * 1024
# The printer's own forwarding gives up after 10 s (repeater.py timeout=10),
# so wait a little longer than that to hear its reason.
CALL_SECONDS = 12
LIST_SECONDS = 60
_sessions = {}
_lock = threading.Lock()


class Monitor:
    def __init__(self, printer):
        self.printer = printer
        self.lock = threading.Lock()
        self.ws = None
        self.timer = None
        self.started = 0
        self.pending = {}
        self.seq = 0
        self.frame = None
        self.frame_at = 0
        self.last_modified = None
        self.source = None            # 'webcam' or 'monitor', once one has worked
        self.webcam_url = None
        self.listed_at = 0
        self.conns = {}               # (host, port, tls) -> a kept-open HTTP connection
        self.target = None            # (host, port, tls, path) of the monitor picture that worked
        self.offered = None           # the picture address the printer's start reply named
        self.start_reply = None       # that reply, or why it failed
        self.restarted_at = 0

    def _receive(self, conn):
        try:
            while not conn.closed:
                _, payload = conn.receive()
                if not payload:
                    continue
                reply = json.loads(payload)
                slot = self.pending.get(reply.get('id'))
                if slot:
                    slot['reply'] = reply
                    slot['event'].set()
        except Exception:
            for slot in list(self.pending.values()):
                slot['reply'] = {'error': {'message': 'The camera connection closed'}}
                slot['event'].set()
        finally:
            conn.close()

    def _send(self, method, params):
        """Send a call and return its slot without waiting (the reply lands in slot['reply'])."""
        self.seq += 1
        slot = {'event': threading.Event()}
        self.pending[self.seq] = slot
        if method.startswith('camera.'):
            params = dict(params, req_id=self.seq)
        self.ws.send_text(json.dumps({'jsonrpc': '2.0', 'id': self.seq, 'method': method, 'params': params}))
        return slot

    def _call(self, method, params):
        self.seq += 1
        slot = {'event': threading.Event()}
        self.pending[self.seq] = slot
        try:
            if method.startswith('camera.'):
                params = dict(params, req_id=self.seq)
            self.ws.send_text(json.dumps({'jsonrpc': '2.0', 'id': self.seq, 'method': method, 'params': params}))
            if not slot['event'].wait(CALL_SECONDS):
                raise ValueError('The printer did not answer the camera request. Try reconnecting')
            reply = slot['reply']
            if reply.get('error'):
                raise ValueError('The built-in camera is unavailable: ' + mc.clean_error(reply['error'].get('message')))
            result = reply.get('result')
            if isinstance(result, dict) and result.get('state') == 'failed':
                raise ValueError('The built-in camera is unavailable: '
                                 + mc.clean_error(result.get('message') or 'the printer said it failed'))
            return result
        finally:
            self.pending.pop(self.seq, None)

    def _close(self):
        if self.timer:
            self.timer.cancel()
            self.timer = None
        if self.ws:
            try:
                # The repeater needs an integer req_id to match the camera service's answer.
                self.seq += 1
                self.ws.send_text(json.dumps({'jsonrpc': '2.0', 'id': self.seq, 'method': 'camera.stop_monitor',
                                              'params': {'domain': 'lan', 'req_id': self.seq}}))
            except Exception:
                pass
            self.ws.close()
            self.ws = None
        for conn in self.conns.values():
            conn.close()
        self.conns = {}
        self.target = None
        self.offered = None
        self.start_reply = None
        self.frame = None
        self.frame_at = 0
        self.last_modified = None
        self.source = None
        self.webcam_url = None
        self.listed_at = 0

    def close(self):
        with self.lock:
            self._close()

    def _get(self, host, port, tls, path, what, keep=False):
        """One GET. keep=True reuses one open connection per address (pictures one after another)."""
        key = (host, port, tls)
        headers = {'Cache-Control': 'no-cache', 'Accept': 'image/jpeg, application/json'}
        if self.printer.api_key:
            headers['X-Api-Key'] = self.printer.api_key
        for attempt in (0, 1):
            conn = self.conns.pop(key, None) if keep else None
            if conn is None:
                cls = http.client.HTTPSConnection if tls else http.client.HTTPConnection
                kwargs = {'context': ssl.create_default_context()} if tls else {}
                conn = cls(host, port, timeout=8, **kwargs)
            try:
                conn.request('GET', path, headers=headers)
                response = conn.getresponse()
                data = response.read(MAX_FRAME + 1)
            except (OSError, http.client.HTTPException) as exc:
                conn.close()
                if keep and attempt == 0:
                    continue          # a kept connection the printer had closed: once more on a fresh one
                raise ValueError(f"Can't reach {what}: {getattr(exc, 'strerror', None) or exc}") from None
            if keep and not response.will_close:
                self.conns[key] = conn
            else:
                conn.close()
            if response.status != 200:
                raise ValueError(f'{what} answered {response.status}. Check its camera is enabled')
            return response, data
        raise ValueError(f"Can't reach {what}")

    def _listed_webcam(self):
        """The first enabled camera Moonraker lists with a picture address on this printer, or None."""
        if self.listed_at and time.monotonic() - self.listed_at < LIST_SECONDS:
            return self.webcam_url
        self.listed_at = time.monotonic()
        self.webcam_url = None
        ep = self.printer.endpoint
        try:
            _, data = self._get(ep.host, ep.port, ep.tls, '/server/webcams/list', 'Moonraker')
            cams = (json.loads(data).get('result') or {}).get('webcams') or []
        except (ValueError, AttributeError):
            return None
        for cam in cams:
            url = str((cam or {}).get('snapshot_url') or '').strip()
            if not url or cam.get('enabled') is False:
                continue
            parsed = urlparse(url if '://' in url else 'http://' + ep.host + '/' + url.lstrip('/'))
            # Only ever the printer itself: a camera address is never a way to
            # make this computer fetch some other machine on the network.
            if parsed.scheme not in ('http', 'https') or parsed.hostname != ep.host:
                continue
            tls = parsed.scheme == 'https'
            try:
                port = parsed.port or (443 if tls else 80)
            except ValueError:
                continue
            self.webcam_url = (tls, port, (parsed.path or '/') + ('?' + parsed.query if parsed.query else ''))
            break
        return self.webcam_url

    def _webcam_picture(self):
        tls, port, path = self.webcam_url
        sep = '&' if '?' in path else '?'
        _, data = self._get(self.printer.endpoint.host, port, tls, path + sep + 't=' + str(time.time_ns()),
                            'The printer camera', keep=True)
        if len(data) > MAX_FRAME or not data.startswith(b'\xff\xd8'):
            raise ValueError('The printer camera returned no JPEG picture')
        return data

    def _open_socket(self):
        if self.ws and not self.ws.closed:
            return
        self.ws = mc.WebSocketClient.open(self.printer.endpoint,
                                          headers={'X-Api-Key': self.printer.api_key} if self.printer.api_key else {})
        self.ws.settimeout(None)
        threading.Thread(target=self._receive, args=(self.ws,), daemon=True).start()
        if self.printer.api_key:
            self._call('server.connection.identify', {'client_name': 'DejaVu1 camera',
                       'version': mc.CLIENT_VERSION, 'type': 'other', 'url': 'https://github.com/Jbyjre/Deja_VU1',
                       'api_key': self.printer.api_key})
        self.started = 0

    def _start(self):
        """Ask the printer's camera service to keep writing pictures; don't wait for its answer."""
        if time.monotonic() - self.restarted_at < START_COOLDOWN:
            return
        self._open_socket()
        self.restarted_at = time.monotonic()
        self.start_reply = self._send('camera.start_monitor', {'domain': 'lan', 'interval': 0})
        self.started = time.monotonic()

    def _reply_words(self):
        """What the start reply said, once it has come: (picture address or None, problem or None)."""
        slot = self.start_reply
        if not isinstance(slot, dict) or not slot['event'].is_set():
            return None, None
        reply = slot.get('reply') or {}
        if reply.get('error'):
            return None, mc.clean_error((reply['error'] or {}).get('message'))
        result = reply.get('result')
        if isinstance(result, dict) and result.get('state') == 'failed':
            return None, mc.clean_error(result.get('message') or 'the printer said it failed')
        url = result.get('url') if isinstance(result, dict) else None
        return (url if isinstance(url, str) and url else None), None

    def _targets(self):
        """Where the monitor picture may be: the address the printer named, then Moonraker's port, then port 80."""
        ep = self.printer.endpoint
        found = []
        offered, _ = self._reply_words()
        if offered:
            parsed = urlparse(offered if '://' in offered else f'http://{ep.host}/' + offered.lstrip('/'))
            try:
                port = parsed.port or (443 if parsed.scheme == 'https' else 80)
            except ValueError:
                port = None
            # Only ever the printer itself, never another machine named in a reply.
            if port and parsed.scheme in ('http', 'https') and parsed.hostname in (ep.host, 'localhost', '127.0.0.1'):
                found.append((ep.host, port, parsed.scheme == 'https',
                              (parsed.path or '/') + ('?' + parsed.query if parsed.query else '')))
        path = '/server/files/camera/monitor.jpg'
        # Moonraker's own port first (the printer link already reaches it), then the web server on 80.
        for port, tls in ((ep.port, ep.tls), (80, False)):
            if (ep.host, port, tls, path) not in found:
                found.append((ep.host, port, tls, path))
        # The address the printer named comes first; otherwise whichever worked last time.
        named = bool(found) and offered is not None and len(found) > 2
        if self.target in found and not named:
            found.remove(self.target)
            found.insert(0, self.target)
        return found

    def _fetch_monitor(self):
        reasons = []
        for target in self._targets():
            host, port, tls, path = target
            sep = '&' if '?' in path else '?'
            try:
                response, data = self._get(host, port, tls, path + sep + 't=' + str(time.time_ns()),
                                           f'The printer camera (port {port})', keep=True)
            except ValueError as exc:
                reasons.append(str(exc))
                continue
            if len(data) > MAX_FRAME or not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
                reasons.append(f'Port {port} answered without a complete JPEG picture')
                continue
            self.target = target
            return response, data
        raise ValueError(' '.join(dict.fromkeys(reasons)) or 'The printer camera gave no picture')

    def _monitor_picture(self):
        if not self.started or time.monotonic() - self.started > RENEW_SECONDS:
            self._start()
        deadline = time.monotonic() + FIRST_PICTURE_SECONDS
        while True:
            try:
                response, data = self._fetch_monitor()
                break
            except ValueError as exc:
                # A camera just started needs a moment to write its first picture (it answers 404 till then),
                # unless the printer has already said why it won't start.
                _, why = self._reply_words()
                if not why and time.monotonic() < deadline and time.monotonic() - self.started < FIRST_PICTURE_SECONDS + 1:
                    time.sleep(0.3)
                    continue
                _, why = self._reply_words()
                raise ValueError(f'The built-in camera is unavailable: {why}' if why else str(exc)) from None
        modified = response.getheader('Last-Modified') or str(len(data)) + str(hash(data[-64:]))
        changed = modified != self.last_modified
        if changed:
            self.frame_at = time.monotonic()
        self.last_modified = modified
        stale = time.monotonic() - self.frame_at
        if stale > STALE_SECONDS:
            self._start()                  # once, gently: the cooldown keeps it from hammering the camera
        if stale > 20:
            _, why = self._reply_words()
            raise ValueError('The camera picture stopped changing. ' + (why or 'Reconnect and check the printer'))
        return data

    def snapshot(self):
        with self.lock:
            try:
                if self.timer:
                    self.timer.cancel()
                self.timer = threading.Timer(IDLE_SECONDS, self.close)
                self.timer.daemon = True
                self.timer.start()
                # Concurrent viewers share one recent frame; never share between printers. Short, so one
                # viewer asking as fast as pictures arrive still gets a new one each time.
                if self.frame and time.monotonic() - self.frame_at < SHARE_SECONDS:
                    return self.frame
                reasons = []
                if self.source != 'monitor' and self._listed_webcam():
                    try:
                        data = self._webcam_picture()
                        self.source, self.frame, self.frame_at = 'webcam', data, time.monotonic()
                        return data
                    except ValueError as exc:
                        if self.source == 'webcam':
                            raise
                        reasons.append(str(exc))
                try:
                    data = self._monitor_picture()
                except (ValueError, mc.PrinterCommandError) as exc:
                    reasons.append(str(exc))
                    raise ValueError(' Also: '.join(reasons)) from None
                self.source, self.frame = 'monitor', data
                return data
            except Exception:
                self._close()
                raise


def snapshot(printer):
    with _lock:
        old = _sessions.get(printer.id)
        if old and old.printer is not printer:
            old.close()
            old = None
        if old is None:
            old = _sessions[printer.id] = Monitor(printer)
    return old.snapshot()


def stop_all():
    with _lock:
        sessions = list(_sessions.values())
        _sessions.clear()
    for session in sessions:
        session.close()
