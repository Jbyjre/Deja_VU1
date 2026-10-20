"""On-demand U1 monitor snapshots, with a separate authenticated socket per printer.

The camera protocol is camera.start_monitor {domain: lan, interval: 0},
camera.stop_monitor, and /server/files/camera/monitor.jpg. Firmware support
must be verified on a physical printer; unsupported methods fail visibly.
"""
import http.client
import json
import ssl
import threading
import time

import moonraker_client as mc

IDLE_SECONDS = 40
RENEW_SECONDS = 180
WARMUP_SECONDS = 1.5
MAX_FRAME = 8 * 1024 * 1024
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
            self.ws.send_text(json.dumps({'jsonrpc': '2.0', 'id': self.seq, 'method': method, 'params': params}))
            if not slot['event'].wait(8):
                raise ValueError('The printer did not answer the camera request. Try reconnecting')
            reply = slot['reply']
            if reply.get('error'):
                raise ValueError('The built-in camera is unavailable: ' + mc.clean_error(reply['error'].get('message')))
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

    def close(self):
        with self.lock:
            self._close()

    def snapshot(self):
        with self.lock:
            try:
                now = time.monotonic()
                if self.timer:
                    self.timer.cancel()
                self.timer = threading.Timer(IDLE_SECONDS, self.close)
                self.timer.daemon = True
                self.timer.start()
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
                # Concurrent viewers share one recent frame; never share between printers.
                if self.frame and time.monotonic() - self.frame_at < 0.8:
                    return self.frame
                ep = self.printer.endpoint
                cls = http.client.HTTPSConnection if ep.tls else http.client.HTTPConnection
                kwargs = {'context':ssl.create_default_context()} if ep.tls else {}
                conn = cls(ep.host, ep.port, timeout=8, **kwargs)
                try:
                    headers = {'Cache-Control':'no-cache'}
                    if self.printer.api_key:
                        headers['X-Api-Key'] = self.printer.api_key
                    conn.request('GET', '/server/files/camera/monitor.jpg?t=' + str(time.time_ns()), headers=headers)
                    response = conn.getresponse()
                    data = response.read(MAX_FRAME + 1)
                    if response.status != 200:
                        raise ValueError(f'The printer camera answered {response.status}. Check its camera is enabled')
                    if len(data) > MAX_FRAME or not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
                        raise ValueError('The printer returned no complete JPEG camera picture')
                    modified = response.getheader('Last-Modified')
                    if modified and modified == self.last_modified and time.monotonic() - self.frame_at > 20:
                        raise ValueError('The camera picture stopped changing. Reconnect and check the printer')
                    if not modified or modified != self.last_modified:
                        self.frame_at = time.monotonic()
                    self.last_modified = modified
                    self.frame = data
                    return data
                finally:
                    conn.close()
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
