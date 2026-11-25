"""
app_get.py: the web server's answers to GET requests (/api/...), the live WebSocket and the timed dispatch.
Split out of app.py's DejaVuHandler on 19 November 2026 so a session reads only the part it needs: DejaVuHandler
takes these methods on as a mixin (class GetRoutes), so self.<anything> works exactly as before.
"""

import json
import os
import sys
import threading
import time
import traceback
import backup
import webrtc_relay
import file_library
import live_feed
import mock_moonraker
import model_inbox
import modules
import pairing
import print_record
import printer_control
import sandbox
import timelapse
import update_hold
import ai_assistant
import tester
import tester_report
import watch_only
import websocket
from app_part1 import (  # noqa: F401
    _APP_ROUTES, _DATA_ROUTES, _FARM_ROUTES, _Gone, _demo, _fleet_rows, _q, module_routes,
)


class GetRoutes:
    """Methods of DejaVuHandler (app.py), kept here by area."""

    def _dispatch_timed(self, handler):
        try:
            printer_id = self._printer_id()
        except LookupError as exc:
            return self._send_json({"error": str(exc)}, status=404)
        # A printer added by address with no live link right now (never
        # connected, the Wi-Fi dropped, or the connection module is off)
        # answers like any unconnected printer: no figures - and demo data
        # never unlocks it, because demo data only ever means the simulation.
        offline_real = not mock_moonraker.has_printer(printer_id) or (
            mock_moonraker.is_real(printer_id) and not mock_moonraker.is_connected(printer_id))
        try:
            if offline_real:
                with mock_moonraker.selection_only(printer_id):
                    return handler(printer_id, force_disconnected=True)
            with mock_moonraker.use_printer(printer_id):
                return handler(printer_id)
        except _Gone:
            return None
        except printer_control.PrintBlocked as exc:
            self._note_refusal(409, str(exc))
            return self._send_json({"error": str(exc), "blocked": True, "gate": exc.gate}, status=409)
        except watch_only.WatchOnly as exc:
            # Refused here on purpose, not by the printer: said as such.
            self._note_refusal(409, str(exc))
            return self._send_json({"error": str(exc), "watch_only": True}, status=409)
        except update_hold.UpdateHold as exc:
            # Deja Vu1 is restarting: it sends the printer nothing for a few seconds. Not a printer failure.
            self._note_refusal(409, str(exc))
            return self._send_json({"error": str(exc), "updating": True}, status=409)
        except mock_moonraker.PrinterCommandError as exc:
            # The printer side failed. Say so plainly - never a success.
            # A command the printer answered and refused ("Must home X and Y axes first") was understood and cannot be done in the state the
            # printer is in: a 409, not the 502 of a printer that could not be reached (the live run on a real U1, 22 November 2026). A read
            # the printer does not support (a stand-in, an older firmware) stays a 502: nothing was asked of the printer's state.
            refused = isinstance(exc, mock_moonraker.PrinterRefused) and self.command != "GET"
            self._note_refusal(409 if refused else 502, f"The printer reported a failure: {exc}")
            body = {"error": f"The printer reported a failure: {exc}", "printer_failed": True}
            if refused:
                body["printer_refused"] = True
            return self._send_json(body, status=409 if refused else 502)
        except PermissionError as exc:
            # A plugin, or a feature that runs as one, asked for something it hasn't been granted.
            self._note_refusal(403, str(exc))
            return self._send_json({"error": str(exc), "not_allowed": True}, status=403)
        except ValueError as exc:
            if self.path.startswith(("/api/printer/control/", "/api/fleet/broadcast")):
                self._note_refusal(400, str(exc))
            return self._send_json({"error": str(exc)}, status=400)
        except (ConnectionError, BrokenPipeError):
            return None                               # the browser left
        except Exception:                             # noqa: BLE001
            # Never let a crash take the whole server down mid-demo. The
            # details go to the terminal, not to whoever sent the request.
            traceback.print_exc()
            tester.note_error("server", sys.exc_info()[1], route=self.path, status=500)
            return self._send_json({"error": "Something went wrong on the dashboard server. "
                                             "The details are in its terminal window."}, status=500)

    def _handle_api_get(self, printer_id, force_disconnected=False):
        # Ignore any "?something=..." on the end of the URL.
        route = self.path.split("?")[0].rstrip("/")
        query = self._query()
        connected = mock_moonraker.is_connected(printer_id)

        if route == "/api/connection":
            real = [{"id": pid, "name": mock_moonraker.printer_name(pid),
                     "connected": mock_moonraker.is_connected(pid)} for pid in mock_moonraker.real_printer_ids()]
            waiting = [p for p in real if not p["connected"]]
            if connected:
                message = "Printer connected."
            elif real:
                diag = mock_moonraker.diagnostics(waiting[0]["id"]) if waiting else None
                message = (f"{waiting[0]['name']} isn't connected yet: "
                           f"{(diag or {}).get('last_error') or 'connecting...'}") if waiting else "Printer connected."
            else:
                message = ("No printer connected. Turn on demo data to "
                           "preview the dashboard with simulated values.")
            return self._send_json({
                "connected": connected,
                "demo_available": True,
                "source": "Moonraker" if connected else None,
                "printer": printer_id,
                "printers": real,
                "message": message,
            })

        if route == "/api/modules":
            return self._send_json({"modules": modules.get_all(), "routes": module_routes()})

        if route == "/api/pairing/devices":
            return self._send_json({"devices": pairing.list_devices()})
        if route == "/api/pairing/status":
            device = self._device()
            return self._send_json({"lock": pairing.lock_enabled(), "this_computer": self._this_computer(),
                                    "paired": bool(device), "device": device["name"] if device else None})

        if route == "/api/backup":
            if self._module_blocked("backup"):
                return None
            filename, data = backup.create_backup()
            return self._send_bytes(data, "application/zip", filename=filename)

        if route == "/api/files/thumb":
            if self._module_blocked("file_library"):
                return None
            data = file_library.thumbnail(_q(query, "name"))
            if not data:
                return self._send_json({"error": "No thumbnail for this file"}, status=404)
            return self._send_bytes(data, "image/png", cache=True)

        if route == "/api/files/raw":
            if self._module_blocked("file_library"):
                return None
            name = _q(query, "name")
            data = file_library.read_bytes(name)
            kind = file_library.kind_of(name)
            ctype = "text/plain; charset=utf-8" if kind == "gcode" else "application/octet-stream"
            download = query.get("download", ["0"])[0] == "1"
            return self._send_bytes(data, ctype, filename=file_library.clean_name(name) if download else None)

        if route == "/api/assistant/watch/picture":
            if self._module_blocked("ai_assistant"):
                return None
            look = query.get("look", [""])[0]
            try:
                seen = ai_assistant.watch_look_picture(look) if look else ai_assistant.watch_picture(query.get("printer", [""])[0])
            except ValueError as error:
                return self._send_json({"error": str(error)}, status=400)
            if not seen:
                return self._send_json({"error": "No picture yet"}, status=404)
            return self._send_bytes(seen[0], seen[1])

        if route == "/api/camera/snapshot":
            if self._module_blocked("camera"):
                return None
            tester.note_feature("camera")
            if force_disconnected or (not connected and not _demo(query)):
                return self._send_json({"connected": False, "demo": False})
            data, mime = mock_moonraker.camera_snapshot()
            return self._send_bytes(data, mime)

        if route == "/api/camera/stream":
            if self._module_blocked("camera"):
                return None
            tester.note_feature("camera")
            return self._relay_camera()

        if route == "/api/camera/webrtc":
            # Whether the selected printer's camera offers WebRTC (the Extended Firmware's does).
            if self._module_blocked("camera"):
                return None
            printer = mock_moonraker.real_printer(mock_moonraker.selected_printer_id())
            if printer is None or not printer.is_connected():
                return self._send_json({"available": False, "service": webrtc_relay.SERVICE})
            return self._send_json(webrtc_relay.info(printer))

        if route == "/api/camera/live":
            if self._module_blocked("camera"):
                return None
            tester.note_feature("camera")
            if force_disconnected or not connected:
                return self._send_json({"connected": False, "demo": False})
            return self._camera_live()

        if route == "/api/tester/report.html":
            if self._module_blocked("tester"):
                return None
            return self._send_bytes(tester_report.build_html(_q(query, "theme", "")).encode("utf-8"),
                                    "text/html; charset=utf-8")

        if route == "/api/tester/report.zip":
            if self._module_blocked("tester"):
                return None
            filename, data = tester_report.build_zip()
            return self._send_bytes(data, "application/zip", filename=filename)

        if route == "/api/models/inbox":
            if self._module_blocked("file_library"):
                return None
            return self._send_json(model_inbox.status(here=self._this_computer()))

        if route in _APP_ROUTES:
            module_id, producer = _APP_ROUTES[route]
            if self._module_blocked(module_id):
                return None
            return self._send_json(producer(query))

        if route == "/api/sandbox":
            if self._module_blocked("sandbox") or not self._demo_allowed(connected):
                return None
            return self._send_json(sandbox.status())

        if route == "/api/demo/status":
            if not self._demo_allowed(connected):
                return None
            return self._send_json({"time_scale": mock_moonraker.get_time_scale(),
                                    "printers": mock_moonraker.simulated_printer_ids()})

        if route in ("/api/timelapse/video", "/api/timelapse/printer-video"):
            if self._module_blocked("timelapse"):
                return None
            tester.note_feature("timelapse")
            download = query.get("download", ["0"])[0] == "1"
            if route.endswith("/video"):
                name = _q(query, "name")
                path, ctype = timelapse.saved_video_path(printer_id, name)
                return self._send_file_ranged(path, ctype, filename=name if download else None)
            if force_disconnected or not connected:
                return self._send_json({"connected": False, "demo": False})
            path = _q(query, "path")
            name = os.path.basename(path)
            ctype = timelapse.VIDEO_TYPES.get(name.rsplit(".", 1)[-1].lower(), "application/octet-stream")
            # Passed on as the printer sends it (and a scrub is a Range request the printer answers), so a large video starts
            # playing at once instead of after the whole file has crossed the printer's Wi-Fi, and none of it is held in memory.
            with mock_moonraker.printer_video_stream(_q(query, "root"), path, self.headers.get("Range")) as (status, headers, chunks):
                extra = {"Content-Range": headers["content-range"]} if headers.get("content-range") else None
                return self._send_stream(status, ctype, chunks, length=headers.get("content-length"), extra=extra,
                                         filename=name if download else None)

        if route == "/api/prints/picture":
            data, ctype = print_record.picture(_q(query, "id"))
            return self._send_bytes(data, ctype, cache=True)

        if route == "/api/timelapse/frame":
            if self._module_blocked("timelapse"):
                return None
            tester.note_feature("timelapse")
            if force_disconnected or not self._gate(connected):
                if force_disconnected:
                    self._send_json({"connected": False, "demo": False})
                return None
            data, ctype = timelapse.frame(printer_id, _q(query, "session"), _q(query, "name"))
            return self._send_bytes(data, ctype, cache=True)

        if route in _DATA_ROUTES:
            module_id, producer = _DATA_ROUTES[route]
            if self._module_blocked(module_id):
                return None
            # Every route here returns figures derived from the printer.
            # Without a printer, and without an explicit demo request,
            # it returns none.
            if force_disconnected and route not in _FARM_ROUTES:
                return self._send_json({"connected": False, "demo": False})
            if route in _FARM_ROUTES:
                connected = mock_moonraker.any_connected()
            if not self._gate(connected):
                return None
            return self._send_json(self._tag(producer(query), connected))

        return self._send_json({"error": "Unknown endpoint"}, status=404)

    def _handle_websocket(self):
        """
        Upgrade to a WebSocket and push live state until the browser leaves.

        Messages sent: {"type": "state"} for the subscribed printer whenever
        it changes (up to every 250 ms), {"type": "fleet"} about once a
        second if asked for (and the fleet module is on), and {"type":
        "event"} for print events and
        automation firings. The browser may send {"type": "subscribe",
        "printer": id, "fleet": bool} to switch printers without
        reconnecting.
        """
        self.close_connection = True
        if not self._same_origin():
            return self._send_json({"error": "Refused: this connection came from another website"}, status=403)
        try:
            response = websocket.handshake_response(self.headers)
        except websocket.ProtocolError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        try:
            printer_id = self._printer_id()
        except LookupError as exc:
            return self._send_json({"error": str(exc)}, status=404)
        demo = self._wants_demo()
        self.wfile.write(response)
        self.wfile.flush()
        # Browsers answer the ping sent every 20 s, so a live connection is
        # never quiet for this long; one that is has gone away.
        self.connection.settimeout(75)
        conn = websocket.WebSocketConnection(self.rfile, self.wfile, threading.Lock())

        real = mock_moonraker.is_real(printer_id)
        connected = mock_moonraker.is_connected(printer_id)
        if not (real and connected) and (not demo or not mock_moonraker.has_printer(printer_id)):
            # The same rule as every other printer route: nothing else.
            try:
                conn.send_text(json.dumps({"connected": False, "demo": False}))
            finally:
                conn.close(1000, "No printer connected")
            return None

        def allowed(pid):
            """A real printer, or a simulated one on a demo connection - nothing else."""
            return mock_moonraker.has_printer(pid) and (mock_moonraker.is_real(pid) or demo)

        def tag_for(pid):
            # Worked out per message, for the printer the message is about: a
            # connection that switched printers never carries the first one's label.
            is_live = mock_moonraker.is_connected(pid)
            return {"connected": is_live, "demo": not mock_moonraker.is_real(pid)}

        sub = {"printer": printer_id, "fleet": self._query().get("fleet", ["0"])[0] == "1"}
        stop = threading.Event()

        def reader():
            try:
                while not stop.is_set():
                    opcode, data = conn.receive()
                    if opcode != websocket.OP_TEXT:
                        continue
                    try:
                        msg = json.loads(data)
                    except ValueError:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("type") == "subscribe":
                        pid = msg.get("printer")
                        if isinstance(pid, str) and allowed(pid):
                            sub["printer"] = pid
                            sub["sent_seq"] = -1
                        if "fleet" in msg:
                            sub["fleet"] = bool(msg["fleet"])
                        if demo:
                            live_feed.mark_demo_seen()
            except (websocket.ConnectionClosed, websocket.ProtocolError, OSError):
                pass
            finally:
                stop.set()

        threading.Thread(target=reader, name="ws-reader", daemon=True).start()
        conn.send_text(json.dumps({"type": "hello", "tick_ms": int(live_feed.TICK_SECONDS * 1000),
                                   "printer": printer_id, **tag_for(printer_id)}))
        last_event = live_feed.last_event_id()
        sub["sent_seq"] = -1
        fleet_seq = -1
        seq = -1
        last_ping = time.time()
        try:
            while not stop.is_set():
                seq, event_id = live_feed.wait_for_change(seq, last_event, timeout=1.0)
                if demo:
                    live_feed.mark_demo_seen()
                current = sub["printer"]
                if not mock_moonraker.has_printer(current):
                    break                         # removed (a sandbox printer, or unregistered)
                entry = live_feed.snapshot(current)
                if entry["seq"] != sub["sent_seq"]:
                    sub["sent_seq"] = entry["seq"]
                    conn.send_text(json.dumps({"type": "state", "printer": current,
                                               "seq": entry["seq"], "t": entry["t"],
                                               "state": entry["state"], **tag_for(current)}))
                if event_id != last_event:
                    for event in live_feed.events_since(last_event):
                        # Events about simulated printers go only to demo connections.
                        if not demo and event.get("printer") and not mock_moonraker.is_real(event["printer"]):
                            continue
                        about = event.get("printer")
                        if not about or not mock_moonraker.has_printer(about):
                            about = current
                        conn.send_text(json.dumps({"type": "event", "event": event, **tag_for(about)}))
                    last_event = event_id
                if sub["fleet"]:
                    snap = _fleet_rows(demo)
                    # Checked only when there is something new to send: the
                    # fleet module switched off means no fleet rows, here
                    # as on GET /api/fleet.
                    if snap["seq"] != fleet_seq and modules.is_enabled("fleet"):
                        fleet_seq = snap["seq"]
                        conn.send_text(json.dumps({"type": "fleet", "printers": snap["printers"],
                                                   "t": snap["t"], **tag_for(current)}))
                if time.time() - last_ping > 20:
                    conn.ping()
                    # A ping is answered by the browser itself and never reaches the page's code. This line does,
                    # so a page that has heard nothing for a minute knows its link is dead and opens a new one.
                    conn.send_text('{"type":"alive"}')
                    last_ping = time.time()
        except (websocket.ConnectionClosed, OSError):
            pass
        finally:
            stop.set()
            conn.close()
        return None
