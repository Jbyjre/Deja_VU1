"""On-demand U1 camera pictures, with a separate authenticated socket per printer.

Two sources, tried in this order:

1. A camera Moonraker lists (GET /server/webcams/list). The community
   Extended Firmware publishes its camera this way, with snapshot_url
   "/webcam/snapshot.jpg" served by the printer's web server on port 80;
   Moonraker resolves a partial address against the printer's own address
   (moonraker/components/webcam.py, WebCam._get_url).
2. Snapmaker's own monitor: camera.start_monitor over the WebSocket only
   (u1-moonraker components/repeater.py registers it for every transport
   but HTTP, forwards it to the printer's camera service and expects an
   integer req_id), then /server/files/camera/monitor.jpg. A failure can
   come back as a normal reply, {"state": "failed", "message": ...}.

Whichever works is remembered for the session; if both fail, both reasons
are given in words.
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
WARMUP_SECONDS = 1.5
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
                self.ws.send_text(json.dumps({'jsonrpc':'2.0', 'id':0, 'method':'camera.stop_monitor', 'params':{}}))
            except Exception:
                pass
            self.ws.close()
            self.ws = None
        self.frame = None
        self.frame_at = 0
        self.last_modified = None
        self.source = None
        self.webcam_url = None
        self.listed_at = 0

    def close(self):
        with self.lock:
            self._close()

    def _get(self, host, port, tls, path, what):
        cls = http.client.HTTPSConnection if tls else http.client.HTTPConnection
        kwargs = {'context':ssl.create_default_context()} if tls else {}
        conn = cls(host, port, timeout=8, **kwargs)
        try:
            headers = {'Cache-Control':'no-cache', 'Accept':'image/jpeg, application/json'}
            if self.printer.api_key:
                headers['X-Api-Key'] = self.printer.api_key
            conn.request('GET', path, headers=headers)
            response = conn.getresponse()
            data = response.read(MAX_FRAME + 1)
            if response.status != 200:
                raise ValueError(f'{what} answered {response.status}. Check its camera is enabled')
            return response, data
        except OSError as exc:
            raise ValueError(f"Can't reach {what}: {exc.strerror or exc}") from None
        finally:
            conn.close()

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
                            'The printer camera')
        if len(data) > MAX_FRAME or not data.startswith(b'\xff\xd8'):
            raise ValueError('The printer camera returned no JPEG picture')
        return data

    def _monitor_picture(self):
        now = time.monotonic()
        if not self.ws or self.ws.closed:
            self.ws = mc.WebSocketClient.open(self.printer.endpoint,
                headers={'X-Api-Key':self.printer.api_key} if self.printer.api_key else {})
            self.ws.settimeout(None)
            threading.Thread(target=self._receive, args=(self.ws,), daemon=True).start()
            if self.printer.api_key:
                self._call('server.connection.identify', {'client_name':'DejaVu1 camera',
                    'version':mc.CLIENT_VERSION, 'type':'other', 'url':'https://github.com/Jbyjre/Deja_VU1',
                    'api_key':self.printer.api_key})
            self.started = 0
        if now - self.started > RENEW_SECONDS or not self.started:
            self._call('camera.start_monitor', {'domain':'lan', 'interval':0})
            self.started = time.monotonic()
            time.sleep(WARMUP_SECONDS)
        ep = self.printer.endpoint
        response, data = self._get(ep.host, ep.port, ep.tls,
                                   '/server/files/camera/monitor.jpg?t=' + str(time.time_ns()), 'The printer camera')
        if len(data) > MAX_FRAME or not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
            raise ValueError('The printer returned no complete JPEG camera picture')
        modified = response.getheader('Last-Modified')
        if modified and modified == self.last_modified and time.monotonic() - self.frame_at > 20:
            raise ValueError('The camera picture stopped changing. Reconnect and check the printer')
        if not modified or modified != self.last_modified:
            self.frame_at = time.monotonic()
        self.last_modified = modified
        return data

    def snapshot(self):
        with self.lock:
            try:
                if self.timer:
                    self.timer.cancel()
                self.timer = threading.Timer(IDLE_SECONDS, self.close)
                self.timer.daemon = True
                self.timer.start()
                # Concurrent viewers share one recent frame; never share between printers.
                if self.frame and time.monotonic() - self.frame_at < 0.8:
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
