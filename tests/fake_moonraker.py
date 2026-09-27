"""
fake_moonraker.py
=================

A stand-in Moonraker for tests, over real sockets: HTTP on one port and
the JSON-RPC WebSocket at /websocket on the same port.

This is not backend/mock_moonraker.py again. That file hands the dashboard
ready-made dictionaries; this one speaks Moonraker's wire format, and each
behaviour is modelled on a specific piece of the real source so the tests
check backend/moonraker_client.py against *that*, not against assumptions:

  Moonraker (Arksine/moonraker 1cfb0c4, Snapmaker/u1-moonraker a308cfa)
    - replies wrapped in {"result": ...}; errors {"error": {"code",
      "message"}} (components/application.py _process_http_request,
      write_error)
    - a Klipper refusal is a 400 with Klipper's message; no Klipper is 503
      "Klippy Host not connected" (components/klippy_connection.py)
    - /server/history/list: limit 50 by default, order desc by default,
      "in_progress" for the running job (components/history.py)
    - /server/files/upload: multipart, optional sha256 "checksum" checked
      after the upload (422 on mismatch), reply NOT wrapped, status 201
      (components/application.py FileUploadHandler)
    - the U1's /printer/print/start: a busy or not-ready printer gets a 200
      whose result is {"state": "error", "message": ...}
      (u1-moonraker components/klippy_apis.py _gcode_start_print)
    - notify_status_update sends only the fields that changed
      (klippy/webhooks.py _do_query: `if rd != lres.get(ri)`)
  Klipper (Klipper3d/klipper ce7002b, Snapmaker/u1-klipper 10f2f69)
    - PAUSE changes print_stats to "paused" before it returns; PAUSE on an
      idle printer answers ok and does nothing useful
      (extras/pause_resume.py, extras/virtual_sdcard.py do_pause)
    - RESUME and SDCARD_PRINT_FILE only schedule the print: "printing"
      arrives a moment after "ok" (virtual_sdcard do_resume / work_handler)
    - CANCEL_PRINT sets "cancelled" (print_stats.note_cancel)
    - heaters are named extruder, extruder1..3, heater_bed; U1 extruders
      carry a park-sensor "state" (PARKED / ACTIVATE); print_task_config
      carries what each head has loaded (extras/print_task_config.py)
"""

import copy
import email.parser
import email.policy
import hashlib
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import websocket as ws


def history_job(n, status="completed", start=1_700_000_000.0, duration=3600.0, filament_mm=1000.0, meta=None):
    """One raw /server/history/list entry, shaped like history.md's example."""
    return {
        "job_id": f"{n:06X}", "exists": True, "user": None,
        "end_time": None if status in ("in_progress", "interrupted") else start + duration,
        "filament_used": filament_mm, "filename": f"part_{n}.gcode",
        "metadata": meta if meta is not None else {"filament_type": "PLA", "filament_total": 2000.0,
                                                   "filament_weight_total": 6.0},
        "print_duration": duration * 0.9, "status": status, "start_time": start,
        "total_duration": duration, "auxiliary_data": [],
    }


class FakeMoonraker:
    def __init__(self, u1=True, extruders=4, chamber="temperature_sensor chamber", api_key=None,
                 layer_info=True, update_manager=False):
        self.lock = threading.RLock()
        self.api_key = api_key
        self.klippy_state = "ready"
        self.update_manager = update_manager
        self.resume_delay = 0.3            # RESUME / SDCARD_PRINT_FILE: "printing" arrives later
        self.start_delay = 0.3
        self.refuse_start_busy = u1        # the U1's 200-with-error start refusal
        self.corrupt_uploads = False
        self.http_faults = {}              # path -> {"status", "body", "delay", "truncate", "html"}
        self.answer_pings = True
        self.gcode_errors = {}             # script prefix -> Klipper error message
        self.scripts = []                  # every gcode script received
        self.requests = []                 # (method, path)
        self.sent_notifications = []       # every notify_status_update params[0] sent
        self.files = {}
        self.metadata = {}
        self.history = []
        self.is_paused = False
        self._clients = []
        self._timers = []
        self._conn_seq = 0

        names = ["extruder"] + [f"extruder{i}" for i in range(1, extruders)]
        self.status = {
            "webhooks": {"state": "ready", "state_message": "Printer is ready"},
            "print_stats": {"filename": "", "total_duration": 0.0, "print_duration": 0.0, "filament_used": 0.0,
                            "state": "standby", "message": "",
                            "info": {"total_layer": None, "current_layer": None}},
            "virtual_sdcard": {"file_path": None, "progress": 0.0, "is_active": False, "file_position": 0,
                               "file_size": 0},
            "toolhead": {"extruder": "extruder", "position": [135.0, 135.0, 10.0, 0.0], "homed_axes": "xyz"},
            "gcode_move": {"gcode_position": [135.0, 135.0, 10.0, 0.0]},
            "heater_bed": {"temperature": 24.0, "target": 0.0, "power": 0.0},
        }
        for i, name in enumerate(names):
            e = {"temperature": 25.0, "target": 0.0, "power": 0.0, "can_extrude": False}
            if u1:
                e["state"] = "ACTIVATE" if i == 0 else "PARKED"
            self.status[name] = e
        if u1:
            self.status["print_task_config"] = {
                "filament_exist": [True, True, False, True],
                "filament_type": ["PLA", "PETG", "NONE", "PLA"],
                "filament_vendor": ["Snapmaker", "Generic", "NONE", "NONE"],
                "filament_color_rgba": ["F26A1BFF", "1C1C1EFF", "FFFFFFFF", "3B82F6FF"],
                "extruder_map_table": list(range(4)) + [0] * 28,
            }
        if chamber:
            self.status[chamber] = {"temperature": 31.5}
        self.layer_info = layer_info
        self.objects = sorted(self.status) + ["gcode", "configfile", "heaters", "mcu"]

        handler = self._handler_class()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    # -- test controls ------------------------------------------------------

    def close(self):
        for t in self._timers:
            t.cancel()
        self.drop_websockets()
        self.server.shutdown()
        self.server.server_close()

    def drop_websockets(self):
        with self.lock:
            clients, self._clients = list(self._clients), []
        for c in clients:
            try:
                c["sock"].shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def set(self, obj, **fields):
        """Change Klipper's state and push the difference, as Klipper would."""
        with self.lock:
            self.status.setdefault(obj, {}).update(copy.deepcopy(fields))
        self._push()

    def notify(self, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        for c in list(self._clients):
            self._send(c, msg)

    def later(self, seconds, fn):
        t = threading.Timer(seconds, fn)
        t.daemon = True
        self._timers.append(t)
        t.start()

    def begin_print(self, filename, **stats):
        self.set("print_stats", state="printing", filename=filename, **stats)
        self.set("virtual_sdcard", is_active=True, progress=0.1)

    def klippy_disconnect(self):
        with self.lock:
            self.klippy_state = "disconnected"
            for c in self._clients:
                c["sub"] = None
        self.notify("notify_klippy_disconnected")

    def klippy_ready(self):
        with self.lock:
            self.klippy_state = "ready"
        self.notify("notify_klippy_ready")

    # -- Klipper behaviour ----------------------------------------------------

    def _query(self, objects):
        out = {}
        with self.lock:
            for name, fields in (objects or {}).items():
                if name not in self.status:
                    continue                     # missing objects are simply left out
                src = self.status[name]
                keys = list(src) if fields is None else fields
                out[name] = {k: copy.deepcopy(src[k]) for k in keys if k in src}
        return out

    def _push(self):
        for c in list(self._clients):
            sub = c.get("sub")
            if not sub:
                continue
            diff = {}
            with self.lock:
                now = self._query(sub)
                for name, fields in now.items():
                    last = c["last"].get(name, {})
                    changed = {k: v for k, v in fields.items() if last.get(k) != v}
                    if changed:
                        diff[name] = changed
                        c["last"].setdefault(name, {}).update(copy.deepcopy(changed))
            if diff:
                self.sent_notifications.append(copy.deepcopy(diff))
                self._send(c, {"jsonrpc": "2.0", "method": "notify_status_update",
                               "params": [diff, time.monotonic()]})

    def _run_gcode(self, script):
        self.scripts.append(script)
        for prefix, message in self.gcode_errors.items():
            if script.startswith(prefix):
                return 400, message
        word = script.split(" ")[0].upper()
        if word == "SET_HEATER_TEMPERATURE":
            args = dict(p.split("=", 1) for p in script.split(" ")[1:] if "=" in p)
            heater = args.get("HEATER")
            if heater not in self.status or not (heater == "heater_bed" or heater.startswith("extruder")):
                return 400, f"The value '{heater}' is not valid for HEATER"
            self.set(heater, target=float(args.get("TARGET", 0)))
        elif word == "SDCARD_PRINT_FILE":
            name = script.split('FILENAME="', 1)[1].rsplit('"', 1)[0]
            if name not in self.files:
                return 400, "Unable to open file"
            self.set("print_stats", filename=name)
            self.later(self.start_delay, lambda: self.begin_print(name))
        return 200, "ok"

    # -- HTTP + WebSocket -----------------------------------------------------

    def _handler_class(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _reply(self, status, payload, raw=None, ctype="application/json; charset=UTF-8"):
                body = raw if raw is not None else json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _error(self, status, message):
                self._reply(status, {"error": {"code": status, "message": message}})

            def _authorised(self):
                return not fake.api_key or self.headers.get("X-Api-Key") == fake.api_key

            def _fault(self, path):
                f = fake.http_faults.get(path)
                if not f:
                    return False
                if f.get("delay"):
                    time.sleep(f["delay"])
                if f.get("truncate"):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", "5000")
                    self.end_headers()
                    self.wfile.write(b'{"result": {"eventt')
                    self.wfile.flush()
                    self.close_connection = True
                    return True
                if f.get("html"):
                    self._reply(200, None, raw=b"<!DOCTYPE html><html><body>Router login</body></html>",
                                ctype="text/html")
                    return True
                if f.get("status"):
                    self._error(f["status"], f.get("message", "Internal Server Error"))
                    return True
                return False

            def do_GET(self):
                parsed = urlparse(self.path)
                fake.requests.append(("GET", parsed.path))
                if parsed.path == "/websocket":
                    return self._websocket()
                if self._fault(parsed.path):
                    return None
                if not self._authorised():
                    return self._error(401, "Unauthorized")
                q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                if parsed.path == "/server/history/list":
                    limit, start = int(q.get("limit", 50)), int(q.get("start", 0))
                    jobs = list(fake.history)
                    if q.get("order", "desc").upper() == "DESC":
                        jobs.reverse()
                    if limit > 0:
                        jobs = jobs[start:start + limit]
                    return self._reply(200, {"result": {"count": len(jobs), "jobs": jobs}})
                if parsed.path == "/server/files/metadata":
                    meta = fake.metadata.get(q.get("filename"))
                    if meta is None:
                        return self._error(404, f"Metadata not available for <{q.get('filename')}>")
                    return self._reply(200, {"result": meta})
                if parsed.path == "/machine/update/status":
                    if not fake.update_manager:
                        return self._error(404, "Not Found")
                    return self._reply(200, {"result": fake.update_manager})
                return self._error(404, "Not Found")

            def do_POST(self):
                parsed = urlparse(self.path)
                fake.requests.append(("POST", parsed.path))
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                if self._fault(parsed.path):
                    return None
                if not self._authorised():
                    return self._error(401, "Unauthorized")
                if parsed.path == "/server/files/upload":
                    return self._upload(raw)
                body = json.loads(raw) if raw and "json" in (self.headers.get("Content-Type") or "") else {}
                q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                args = {**q, **body}
                path = parsed.path
                if path.startswith("/printer/") and fake.klippy_state != "ready":
                    return self._error(503, "Klippy Host not connected")
                with fake.lock:
                    ps = fake.status["print_stats"]
                    state = ps["state"]
                if path == "/printer/objects/query":
                    return self._reply(200, {"result": {"eventtime": time.monotonic(),
                                                        "status": fake._query(args.get("objects"))}})
                if path == "/printer/print/pause":
                    if not fake.is_paused:
                        fake.is_paused = True
                        if state == "printing":
                            fake.set("print_stats", state="paused")
                    return self._reply(200, {"result": "ok"})
                if path == "/printer/print/resume":
                    if fake.is_paused:
                        fake.is_paused = False
                        if state == "paused":
                            fake.later(fake.resume_delay, lambda: fake.set("print_stats", state="printing"))
                    return self._reply(200, {"result": "ok"})
                if path == "/printer/print/cancel":
                    fake.is_paused = False
                    if state in ("printing", "paused"):
                        fake.set("print_stats", state="cancelled")
                        fake.set("virtual_sdcard", is_active=False)
                    return self._reply(200, {"result": "ok"})
                if path == "/printer/print/start":
                    if fake.refuse_start_busy and state in ("printing", "paused"):
                        return self._reply(200, {"result": {"state": "error", "message":
                                                            "Printer is not ready to start a new print job."}})
                    status, message = fake._run_gcode(f'SDCARD_PRINT_FILE FILENAME="{args.get("filename")}"')
                    if status != 200:
                        return self._error(status, message)
                    return self._reply(200, {"result": "ok"})
                if path == "/printer/gcode/script":
                    status, message = fake._run_gcode(args.get("script", ""))
                    if status != 200:
                        return self._error(status, message)
                    return self._reply(200, {"result": "ok"})
                if path == "/printer/firmware_restart":
                    return self._reply(200, {"result": "ok"})
                return self._error(404, "Not Found")

            def _upload(self, raw):
                ctype = self.headers.get("Content-Type", "")
                msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
                    b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + raw)
                fields, file_name, data = {}, None, None
                for part in msg.iter_parts():
                    name = part.get_param("name", header="content-disposition")
                    if name == "file":
                        file_name = part.get_filename()
                        data = part.get_payload(decode=True)
                    else:
                        fields[name] = part.get_content().strip()
                if data is None:
                    return self._error(400, "No file received")
                if fake.corrupt_uploads:
                    data = data[:-1]
                calc = hashlib.sha256(data).hexdigest()
                if fields.get("checksum") and fields["checksum"].lower() != calc:
                    return self._error(422, f"File checksum mismatch: expected {fields['checksum']}, "
                                            f"calculated {calc}")
                fake.files[file_name] = data
                return self._reply(201, {"item": {"path": file_name, "root": fields.get("root", "gcodes"),
                                                  "modified": time.time(), "size": len(data),
                                                  "permissions": "rw"},
                                         "print_started": False, "print_queued": False,
                                         "action": "create_file"})

            def _websocket(self):
                try:
                    response = ws.handshake_response(self.headers)
                except ws.ProtocolError as exc:
                    return self._error(400, str(exc))
                self.wfile.write(response)
                self.wfile.flush()
                self.close_connection = True
                conn = ws.WebSocketConnection(self.rfile, self.wfile, threading.Lock())
                with fake.lock:
                    fake._conn_seq += 1
                    client = {"conn": conn, "sock": self.connection, "sub": None, "last": {},
                              "id": fake._conn_seq, "identified": False}
                    fake._clients.append(client)
                try:
                    while True:
                        # Server side: websocket.py insists client frames
                        # are masked - so this also proves the client masks.
                        fin, opcode, payload = ws.read_frame(self.rfile.read, require_mask=True)
                        if opcode == ws.OP_PING:
                            if fake.answer_pings:
                                conn._write(ws.encode_frame(payload, ws.OP_PONG))
                            continue
                        if opcode == ws.OP_CLOSE:
                            conn.close()
                            break
                        if opcode != ws.OP_TEXT:
                            continue
                        fake._rpc(client, json.loads(payload.decode("utf-8")))
                except (ws.ConnectionClosed, ws.ProtocolError, OSError, ValueError):
                    pass
                finally:
                    with fake.lock:
                        if client in fake._clients:
                            fake._clients.remove(client)
                return None

        return Handler

    def _send(self, client, message):
        try:
            client["conn"].send_text(json.dumps(message))
        except (ws.ConnectionClosed, OSError):
            pass

    def _rpc(self, client, msg):
        method, params, rid = msg.get("method"), msg.get("params") or {}, msg.get("id")

        def ok(result):
            self._send(client, {"jsonrpc": "2.0", "result": result, "id": rid})

        def err(code, message):
            self._send(client, {"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": rid})

        if method == "server.connection.identify":
            if client["identified"]:
                return err(400, "Connection already identified")
            if self.api_key and params.get("api_key") != self.api_key:
                return err(401, "Unauthorized")
            client["identified"] = True
            return ok({"connection_id": client["id"]})
        if self.api_key and not client["identified"]:
            return err(401, "Unauthorized")
        if method == "server.info":
            return ok({"klippy_connected": self.klippy_state != "disconnected", "klippy_state": self.klippy_state,
                       "components": [], "failed_components": [], "registered_directories": ["gcodes"],
                       "warnings": [], "websocket_count": len(self._clients), "moonraker_version": "fake",
                       "api_version": [1, 5, 0], "api_version_string": "1.5.0"})
        if method == "printer.objects.list":
            if self.klippy_state != "ready":
                return err(503, "Klippy Host not connected")
            return ok({"objects": list(self.objects)})
        if method == "printer.objects.subscribe":
            objects = params.get("objects") or {}
            with self.lock:
                client["sub"] = objects
                full = self._query(objects)
                client["last"] = copy.deepcopy(full)
            return ok({"eventtime": time.monotonic(), "status": full})
        if method == "printer.emergency_stop":
            self.set("webhooks", state="shutdown", state_message="Shutdown due to M112 command")
            return ok("ok")
        return err(404, f"Method not found: {method}")
