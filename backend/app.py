"""
app.py
======

The web server. It does three jobs:

  1. Serves the dashboard web page (the files in ../frontend).
  2. Answers questions from that page over a small JSON API.
  3. Pushes live printer updates to the page over a WebSocket (/api/live).

This uses only Python's built-in http.server (the threading version, so a
long-lived live connection never blocks anyone else's request), so there is
nothing to install. Run it with:

    python3 backend/app.py

then open http://localhost:8000 in a browser.

Which printer?
--------------
Every request may carry ?printer=<id>. The server then answers every
module - maintenance, control, cost, queue, everything - for that printer.
Without it, the default printer is used, exactly as before the fleet
feature existed.

API endpoints
-------------
  GET  /api/connection               is a printer connected?
  GET  /api/modules                  every module and its on/off state
  POST /api/modules/<id>/toggle      switch a module on or off {"enabled": bool}

  WS   /api/live                     live state + events (WebSocket)
  GET  /api/live/snapshot            the same live state, for polling fallback
  GET  /api/fleet                    one overview row per printer
  GET  /api/fleet/registry           printers you added by address
  POST /api/fleet/registry           add one {"name", "moonraker_url"}
  POST /api/fleet/registry/<id>/remove

  GET  /api/maintenance              what's due
  GET  /api/maintenance/history      completed maintenance log
  POST /api/maintenance/done         mark a task done  {"task_id": "..."}
  POST /api/maintenance/swap         record a nozzle/hotend swap {"kind", "toolhead"}

  GET  /api/leds                     simulated LED ring states
  GET  /api/colorcheck               simulated filament color check
  GET  /api/printer                  raw mock printer state
  GET  /api/chamber                  chamber temperature now + last 30 minutes
  GET  /api/health                   the print health gauge

  GET  /api/printer/control/capabilities
  GET  /api/printer/control/console
  POST /api/printer/control/start        {"filename": "...", "confirmed": true}
  POST /api/printer/control/pause
  POST /api/printer/control/resume
  POST /api/printer/control/cancel
  POST /api/printer/control/temperature  {"toolhead": "T0", "target": 220}
  POST /api/printer/control/home         {"axes": ["X","Y","Z"]}
  POST /api/printer/control/gcode        {"command": "G28"}

  GET  /api/print/confirm?file=...   the Confirm Print summary (gate)

  GET  /api/files                    the file library
  GET  /api/files/thumb?name=        a file's thumbnail (PNG)
  GET  /api/files/raw?name=          the file itself (3D viewer, download)
  GET  /api/files/lines?name=&offset=&limit=&q=
  GET  /api/files/analysis?name=     G-code analysis + toolpath
  POST /api/files/upload?name=       raw file bytes as the request body
  POST /api/files/samples            add the sample files
  POST /api/files/delete             {"name"}
  POST /api/files/edit               {"name", "edits": [...]}
  POST /api/files/restore            {"name"}
  POST /api/files/opened             {"name"}
  POST /api/convert                  {"name"} MakerWorld/NexPrint -> U1
  GET  /api/profiles/diff?a=&b=      side-by-side slicer settings

  GET  /api/queue                    this printer's print queue
  POST /api/queue/add | remove | move | auto | start-next | clear-done

  GET  /api/automations              rules
  GET  /api/automations/log          what fired, and what really happened
  POST /api/automations              add a rule {"rule": {...}}
  POST /api/automations/<id>/update | delete | test

  GET  /api/timelapse                recorded prints for this printer
  GET  /api/timelapse/frames?session=
  GET  /api/timelapse/frame?session=&name=

  GET  /api/filament                 spool inventory + idle-spool flags
  GET  /api/filament/check           does inventory cover the current job?
  GET  /api/filament/forecast        grams left and prints left per spool
  POST /api/filament/spools          add a spool
  POST /api/filament/spools/<id>/remove
  POST /api/filament/spools/<id>/grams   {"grams_remaining": 500}

  GET  /api/compare                  "what changed?" + likely cause
  GET  /api/compare/repeat           settings from the last clean print
  GET  /api/compare/side-by-side     current job vs last clean run
  GET  /api/sanity                   is it safe to print right now?

  GET  /api/updates                  Moonraker/Klipper update status
  GET  /api/backup                   download a zip of this app's data
  GET  /api/camera                   camera feed + freeze watchdog
  GET  /api/camera/settings | POST   the MJPEG stream address
  GET  /api/camera/stream            the camera, relayed (MJPEG)

  GET  /api/notifications/settings
  POST /api/notifications/settings
  GET  /api/notifications/queue
  POST /api/notifications/test       {"message": "..."}

  GET  /api/pairing/devices
  POST /api/pairing/code
  POST /api/pairing/redeem           {"code": "...", "device_name": "..."}
  POST /api/pairing/devices/<id>/unpair
  GET  /api/handoff?device=          "continue where another device was"
  POST /api/handoff                  {"device_id", "device_name", "view"}

  GET  /api/cost/history              cost of recent print jobs
  GET  /api/cost/current              estimated cost of the job in progress
  GET  /api/cost/settings
  POST /api/cost/settings            {"electricity_rate_per_kwh": 0.15, ...}

  GET  /api/wled/settings
  POST /api/wled/settings            {"host": "192.168.1.42", ...}
  POST /api/wled/test                 checks the configured WLED device
  POST /api/wled/push                 pushes current ring states to it

  GET  /api/homeassistant/settings
  POST /api/homeassistant/settings   {"base_url": "...", "token": "..."}
  POST /api/homeassistant/push        pushes printer state as HA sensors

  Demo only (refused without ?demo=1, and whenever a real printer is connected):
  GET  /api/demo/status
  POST /api/demo/fail-next           {"action": "pause"} make the next one fail
  POST /api/demo/time-scale          {"scale": 60} fast-forward the simulation
  POST /api/demo/reset               restart every simulated printer

No figures without a printer
----------------------------
With no printer connected, routes that read printer state return no numbers
at all — just {"connected": false, "demo": false}. The dashboard shows empty
states rather than inventing values. The live WebSocket follows the same
rule: without demo it sends exactly that object and closes.

Adding ?demo=1 to a request opts in to the simulated data explicitly. That is
what the dashboard's "Demo data" switch sends. Everything returned that way is
flagged "demo": true, so simulated figures can never be mistaken for real ones.

This rule applies only to routes that read *printer* data. Routes that read
or change this dashboard's own settings — modules, pairing, notification
preferences, the filament list, the file library, automation rules — work
the same whether or not a printer is connected, because they aren't printer
figures.
"""

import json
import os
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Make sure Python can find the other backend modules no matter which folder
# the server was started from.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND_DIR)

import automations
import backup
import camera
import color_check
import comparison
import converter_3mf
import cost_calculator
import file_library
import filament_inventory
import fleet
import handoff
import home_assistant_bridge
import led_status
import live_feed
import maintenance
import mock_moonraker
import modules
import notifications
import pairing
import print_gate
import print_queue
import printer_control
import sanity_check
import timelapse
import updates
import websocket
import wled_bridge

# The dashboard's HTML/CSS/JS lives here.
_FRONTEND_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "frontend")

PORT = int(os.environ.get("PORT", 8000))
MAX_UPLOAD = file_library.MAX_BYTES


def _chamber():
    state = mock_moonraker.get_printer_state()
    reading = state.get("chamber_temperature")
    return {"reported": reading is not None, "current": reading,
            "bed": state.get("bed_temperature"),
            "history": live_feed.climate(mock_moonraker.selected_printer_id())}


def _live_snapshot():
    entry = live_feed.snapshot(mock_moonraker.selected_printer_id())
    return {"seq": entry["seq"], "t": entry["t"], "state": entry["state"],
            "event_id": live_feed.last_event_id(),
            "time_scale": mock_moonraker.get_time_scale()}


# Routes that return printer figures, gated by connection/demo, each mapped
# to the module that owns them (checked before connection) and the function
# that produces the data. Each gets the parsed query string.
_DATA_ROUTES = {
    "/api/maintenance": ("maintenance", lambda q: maintenance.get_status()),
    "/api/maintenance/history": ("maintenance", lambda q: {"history": maintenance.get_history()}),
    "/api/leds": ("led_status", lambda q: led_status.get_all_ring_states()),
    "/api/colorcheck": ("color_check", lambda q: color_check.check_current_job()),
    "/api/printer": (None, lambda q: mock_moonraker.get_printer_state()),
    "/api/printer/control/capabilities": ("printer_control", lambda q: printer_control.get_capabilities()),
    "/api/printer/control/console": ("printer_control", lambda q: {"log": printer_control.get_console_log()}),
    "/api/filament/check": ("filament_inventory", lambda q: filament_inventory.check_job_requirements()),
    "/api/filament/forecast": ("filament_inventory", lambda q: {
        "spools": filament_inventory.forecast(mock_moonraker.get_print_history())}),
    "/api/compare": ("compare", lambda q: comparison.compare_current_job()),
    "/api/compare/repeat": ("compare", lambda q: comparison.repeat_last_settings()),
    "/api/compare/side-by-side": ("compare", lambda q: comparison.side_by_side()),
    "/api/sanity": ("sanity_check", lambda q: sanity_check.check()),
    "/api/updates": ("updates", lambda q: updates.get_status()),
    "/api/camera": ("camera", lambda q: camera.get_status()),
    "/api/cost/history": ("cost_calculator", lambda q: {"jobs": cost_calculator.cost_history()}),
    "/api/cost/current": ("cost_calculator", lambda q: cost_calculator.estimate_current_job()),
    "/api/live/snapshot": (None, lambda q: _live_snapshot()),
    "/api/fleet": ("fleet", lambda q: live_feed.fleet_snapshot()),
    "/api/chamber": ("chamber_climate", lambda q: _chamber()),
    "/api/health": (None, lambda q: print_gate.printer_health()),
    "/api/print/confirm": (None, lambda q: print_gate.summary(_q(q, "file"))),
    "/api/queue": ("print_queue", lambda q: print_queue.get()),
    "/api/timelapse": ("timelapse", lambda q: {
        "sessions": timelapse.sessions(mock_moonraker.selected_printer_id()),
        "recording": timelapse.is_recording(mock_moonraker.selected_printer_id())}),
    "/api/timelapse/frames": ("timelapse", lambda q: {
        "frames": timelapse.frames(mock_moonraker.selected_printer_id(), _q(q, "session"))}),
}

# Routes that answer from this dashboard's own settings, not printer figures.
# Not gated by connected/demo; some are still gated by their module toggle.
_APP_ROUTES = {
    "/api/filament": ("filament_inventory", lambda q: {
        "spools": filament_inventory.get_inventory(),
        "idle_spools": filament_inventory.idle_spools(),
    }),
    "/api/notifications/settings": ("notifications", lambda q: notifications.get_settings()),
    "/api/notifications/queue": ("notifications", lambda q: {"queue": notifications.get_queue()}),
    "/api/cost/settings": ("cost_calculator", lambda q: cost_calculator.get_settings()),
    "/api/wled/settings": ("wled_bridge", lambda q: wled_bridge.get_settings()),
    "/api/homeassistant/settings": ("home_assistant_bridge", lambda q: home_assistant_bridge.get_settings()),
    "/api/files": ("file_library", lambda q: file_library.list_files()),
    "/api/files/lines": ("file_library", lambda q: file_library.gcode_tools.view_lines(
        file_library.read_text(_q(q, "name")), _q(q, "offset", "0"), _q(q, "limit", "200"),
        _q(q, "q", "") or None)),
    "/api/files/analysis": ("file_library", lambda q: file_library.analysis(_q(q, "name"))),
    "/api/profiles/diff": ("file_library", lambda q: comparison.diff_profiles(_q(q, "a"), _q(q, "b"))),
    "/api/fleet/registry": ("fleet", lambda q: fleet.registry()),
    "/api/automations": ("automations", lambda q: {"rules": automations.list_rules()}),
    "/api/automations/log": ("automations", lambda q: {"log": automations.get_log()}),
    "/api/camera/settings": ("camera", lambda q: camera.get_settings()),
    "/api/handoff": ("handoff", lambda q: handoff.offer_for(_q(q, "device", ""))),
}

# POST actions on printer-figure-gated routes. Each changes the printer, so
# each is followed straight away by a fresh read of the printer's state.
_CONTROL_ACTIONS = {
    "/api/printer/control/start": lambda body: printer_control.start_print(
        body.get("filename"), confirmed=bool(body.get("confirmed"))),
    "/api/printer/control/pause": lambda body: printer_control.pause_print(),
    "/api/printer/control/resume": lambda body: printer_control.resume_print(),
    "/api/printer/control/cancel": lambda body: printer_control.cancel_print(),
    "/api/printer/control/temperature": lambda body: printer_control.set_temperature(
        body.get("toolhead"), body.get("target")),
    "/api/printer/control/home": lambda body: printer_control.home(body.get("axes")),
    "/api/printer/control/gcode": lambda body: printer_control.send_gcode(body.get("command")),
}

# POST routes that act on a printer's queue - gated like the data routes.
_QUEUE_ACTIONS = {
    "/api/queue/add": lambda b: print_queue.add(b.get("filename")),
    "/api/queue/remove": lambda b: print_queue.remove(b.get("id")),
    "/api/queue/move": lambda b: print_queue.move(b.get("id"), b.get("direction")),
    "/api/queue/auto": lambda b: print_queue.set_auto_advance(b.get("enabled")),
    "/api/queue/start-next": lambda b: print_queue.start_next(confirmed=bool(b.get("confirmed"))),
    "/api/queue/clear-done": lambda b: print_queue.clear_done(),
}


def _q(query, key, default=None):
    value = query.get(key, [default])[0]
    if value is None:
        raise ValueError(f"Missing '{key}'")
    return value


class _Gone(Exception):
    """The browser went away mid-stream."""


class DejaVuHandler(SimpleHTTPRequestHandler):
    """
    Handles every incoming browser request.

    Anything starting with /api/ is answered with JSON by our own code.
    Everything else is treated as a request for a file in the frontend folder,
    which the built-in SimpleHTTPRequestHandler already knows how to serve.
    """

    def __init__(self, *args, **kwargs):
        # Tell the built-in file server to serve out of the frontend folder.
        super().__init__(*args, directory=_FRONTEND_DIR, **kwargs)

    # -- helpers ----------------------------------------------------------

    def _send_json(self, payload, status=200):
        """Send a Python dictionary back to the browser as JSON."""
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # Stop the browser caching API responses, so the dashboard always
        # shows current data when it refreshes.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, data, content_type, filename=None, cache=False):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "private, max-age=60" if cache else "no-store")
        if content_type.startswith("image/svg"):
            # Frames are drawn by this server; still, never let an SVG run script.
            self.send_header("Content-Security-Policy", "script-src 'none'")
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self):
        """Read and parse the JSON a browser sent us in a POST request."""
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        if length > 1024 * 1024:
            raise ValueError("Request is too large")
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return body if isinstance(body, dict) else {}

    def _read_raw_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            raise ValueError("The file is empty")
        if length > MAX_UPLOAD:
            raise ValueError("Files over 64 MB can't be added")
        data, remaining = [], length
        while remaining:
            chunk = self.rfile.read(min(remaining, 1 << 20))
            if not chunk:
                break
            data.append(chunk)
            remaining -= len(chunk)
        return b"".join(data)

    def log_message(self, fmt, *args):
        """Keep the terminal quiet — one tidy line per request."""
        path = self.path.split("?")[0]
        if path in ("/api/live/snapshot", "/api/fleet", "/api/handoff"):
            return
        sys.stderr.write(f"  {self.command} {path}\n")

    def _module_blocked(self, module_id):
        if module_id and not modules.is_enabled(module_id):
            self._send_json({"error": "Module disabled", "module_disabled": True}, status=403)
            return True
        return False

    def _query(self):
        return parse_qs(urlparse(self.path).query)

    def _wants_demo(self):
        """
        Did the caller explicitly ask for simulated data?

        True when the URL carries ?demo=1. Anything else means no — we do not
        hand out invented figures unless they were asked for by name.
        """
        wanted = self._query().get("demo", ["0"])[0] in ("1", "true", "yes")
        if wanted:
            live_feed.mark_demo_seen()
        return wanted

    def _printer_id(self):
        """
        The printer this request is about. Unknown names are an error, not a
        silent fallback, so a request never quietly answers for the wrong
        printer.
        """
        requested = self._query().get("printer", [""])[0]
        if not requested:
            return mock_moonraker.DEFAULT_PRINTER_ID
        if mock_moonraker.has_printer(requested):
            return requested
        if any(p["id"] == requested for p in fleet.registered()):
            return requested          # a real, registered printer - not connected yet
        raise LookupError(f"Unknown printer: {requested}")

    @staticmethod
    def _tag(payload, connected):
        """
        Label a response with where its numbers came from.

        Anything served without a real printer is marked demo data, so the
        dashboard can badge it and nobody mistakes it for a live reading.
        """
        payload["connected"] = connected
        payload["demo"] = not connected
        return payload

    # -- request handling -------------------------------------------------

    def do_GET(self):
        if self.path.startswith("/api/live") and websocket.is_upgrade_request(self.headers):
            return self._handle_websocket()
        if self.path.startswith("/api/"):
            return self._dispatch(self._handle_api_get)
        # Not an API call, so serve a file from the frontend folder.
        return super().do_GET()

    def do_POST(self):
        return self._dispatch(self._handle_api_post)

    def _dispatch(self, handler):
        try:
            printer_id = self._printer_id()
        except LookupError as exc:
            return self._send_json({"error": str(exc)}, status=404)
        registered_only = not mock_moonraker.has_printer(printer_id)
        try:
            if registered_only:
                # A printer the user added by address. There is no live
                # client for it yet, so it answers like any unconnected
                # printer: no figures, and never the simulation's figures.
                return handler(printer_id, force_disconnected=True)
            with mock_moonraker.use_printer(printer_id):
                return handler(printer_id)
        except _Gone:
            return None
        except printer_control.PrintBlocked as exc:
            return self._send_json({"error": str(exc), "blocked": True, "gate": exc.gate}, status=409)
        except mock_moonraker.PrinterCommandError as exc:
            # The printer side failed. Say so plainly - never a success.
            return self._send_json({"error": f"The printer reported a failure: {exc}",
                                    "printer_failed": True}, status=502)
        except ValueError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:                      # noqa: BLE001
            # Never let a crash take the whole server down mid-demo.
            return self._send_json({"error": str(exc)}, status=500)

    def _gate(self, connected):
        """True when printer figures may be served (and sent the refusal if not)."""
        if not connected and not self._wants_demo():
            self._send_json({"connected": False, "demo": False})
            return False
        return True

    def _handle_api_get(self, printer_id, force_disconnected=False):
        # Ignore any "?something=..." on the end of the URL.
        route = self.path.split("?")[0].rstrip("/")
        query = self._query()
        connected = mock_moonraker.is_connected(printer_id)

        if route == "/api/connection":
            return self._send_json({
                "connected": connected,
                "demo_available": True,
                "source": "Moonraker" if connected else None,
                "message": ("Printer connected." if connected else
                            "No printer connected. Turn on demo data to "
                            "preview the dashboard with simulated values."),
            })

        if route == "/api/modules":
            return self._send_json({"modules": modules.get_all()})

        if route == "/api/pairing/devices":
            return self._send_json({"devices": pairing.list_devices()})

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

        if route == "/api/camera/stream":
            if self._module_blocked("camera"):
                return None
            return self._relay_camera()

        if route in _APP_ROUTES:
            module_id, producer = _APP_ROUTES[route]
            if self._module_blocked(module_id):
                return None
            return self._send_json(producer(query))

        if route == "/api/demo/status":
            if not self._demo_allowed(connected):
                return None
            return self._send_json({"time_scale": mock_moonraker.get_time_scale(),
                                    "printers": mock_moonraker.printer_ids()})

        if route == "/api/timelapse/frame":
            if self._module_blocked("timelapse"):
                return None
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
            if force_disconnected:
                return self._send_json({"connected": False, "demo": False})
            if not self._gate(connected):
                return None
            return self._send_json(self._tag(producer(query), connected))

        return self._send_json({"error": "Unknown endpoint"}, status=404)

    def _demo_allowed(self, connected):
        if connected or not self._wants_demo():
            self._send_json({"error": "Only available with demo data switched on, and "
                                      "never while a real printer is connected"}, status=403)
            return False
        return True

    def _handle_api_post(self, printer_id, force_disconnected=False):
        route = self.path.split("?")[0].rstrip("/")
        query = self._query()
        connected = mock_moonraker.is_connected(printer_id)

        if route == "/api/maintenance/done":
            return self._handle_maintenance(connected, force_disconnected, lambda body: maintenance.mark_done(
                body.get("task_id") or "", note=body.get("note", "")), require="task_id")

        if route == "/api/maintenance/swap":
            return self._handle_maintenance(connected, force_disconnected, lambda body: maintenance.record_swap(
                body.get("kind"), body.get("toolhead"), note=body.get("note", "")))

        if route.startswith("/api/modules/") and route.endswith("/toggle"):
            module_id = route[len("/api/modules/"):-len("/toggle")]
            body = self._read_json_body()
            result = modules.set_enabled(module_id, body.get("enabled", True))
            return self._send_json({"modules": result})

        if route in _CONTROL_ACTIONS or route in _QUEUE_ACTIONS:
            is_control = route in _CONTROL_ACTIONS
            if self._module_blocked("printer_control" if is_control else "print_queue"):
                return None
            if force_disconnected or (not connected and not self._wants_demo()):
                return self._send_json({"connected": False, "demo": False}, status=409)
            body = self._read_json_body()
            started = time.perf_counter()
            action = _CONTROL_ACTIONS[route] if is_control else _QUEUE_ACTIONS[route]
            result = action(body)
            # Re-read the printer straight away rather than waiting for the
            # next 250 ms tick, and wake every live connection with it.
            fresh = live_feed.refresh(printer_id)
            payload = result if isinstance(result, dict) else {"result": result}
            payload.update({"confirmed_state": fresh,
                            "server_ms": round((time.perf_counter() - started) * 1000, 1)})
            return self._send_json(self._tag(payload, connected))

        if route.startswith("/api/demo/"):
            if not self._demo_allowed(connected):
                return None
            body = self._read_json_body()
            if route == "/api/demo/fail-next":
                return self._send_json(mock_moonraker.fail_next(
                    body.get("action"), body.get("message") or "Moonraker did not accept the command"))
            if route == "/api/demo/time-scale":
                return self._send_json(mock_moonraker.set_time_scale(body.get("scale", 1)))
            if route == "/api/demo/reset":
                mock_moonraker.reset_all()
                for pid in mock_moonraker.printer_ids():
                    live_feed.refresh(pid)
                return self._send_json({"reset": True})
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/files/upload":
            if self._module_blocked("file_library"):
                return None
            name = _q(query, "name")
            file_library.clean_name(name)          # refuse bad names before reading the body
            return self._send_json(file_library.save(name, self._read_raw_body(), origin="upload"))

        if route.startswith("/api/files/"):
            if self._module_blocked("file_library"):
                return None
            body = self._read_json_body()
            if route == "/api/files/samples":
                return self._send_json(file_library.add_samples())
            if route == "/api/files/delete":
                return self._send_json(file_library.delete(body.get("name")))
            if route == "/api/files/edit":
                return self._send_json(file_library.save_edit(body.get("name"), body.get("edits")))
            if route == "/api/files/restore":
                return self._send_json(file_library.restore_original(body.get("name")))
            if route == "/api/files/opened":
                file_library.touch(body.get("name"), "last_opened")
                return self._send_json({"ok": True})
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/convert":
            if self._module_blocked("converter"):
                return None
            body = self._read_json_body()
            name = body.get("name")
            data, report = converter_3mf.convert(file_library.read_bytes(name))
            new_name = converter_3mf.converted_name(file_library.clean_name(name))
            entry = file_library.save(new_name, data, origin="converted",
                                      note=f"Converted from {name} ({report['source_label']})")
            return self._send_json({"file": entry, "report": report})

        if route.startswith("/api/automations"):
            if self._module_blocked("automations"):
                return None
            body = self._read_json_body()
            if route == "/api/automations":
                return self._send_json(automations.add_rule(body.get("rule"), demo=self._wants_demo()))
            parts = route.split("/")
            if len(parts) == 5:
                rule_id, verb = parts[3], parts[4]
                if verb == "update":
                    return self._send_json(automations.update_rule(rule_id, body.get("changes") or {}))
                if verb == "delete":
                    return self._send_json({"rules": automations.delete_rule(rule_id)})
                if verb == "test":
                    rule = next((r for r in automations.list_rules() if r["id"] == rule_id), None)
                    if rule and rule.get("demo") and not self._wants_demo():
                        return self._send_json({"error": "This rule was made with demo data - "
                                                         "switch demo data on to test it"}, status=409)
                    target = printer_id if mock_moonraker.has_printer(printer_id) else mock_moonraker.DEFAULT_PRINTER_ID
                    return self._send_json(automations.test_fire(rule_id, target))
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/fleet/registry":
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            return self._send_json(fleet.add(body.get("name"), body.get("moonraker_url")))

        if route.startswith("/api/fleet/registry/") and route.endswith("/remove"):
            if self._module_blocked("fleet"):
                return None
            return self._send_json({"printers": fleet.remove(route.split("/")[4])})

        if route == "/api/camera/settings":
            if self._module_blocked("camera"):
                return None
            return self._send_json(camera.save_settings(self._read_json_body()))

        if route == "/api/handoff":
            if self._module_blocked("handoff"):
                return None
            body = self._read_json_body()
            return self._send_json(handoff.report(body.get("device_id"), body.get("device_name"),
                                                  body.get("view") or {}))

        if route == "/api/filament/spools":
            if self._module_blocked("filament_inventory"):
                return None
            body = self._read_json_body()
            spool = filament_inventory.add_spool(
                body.get("material"), body.get("color_name"),
                body.get("color_hex"), body.get("grams_remaining", 0))
            return self._send_json(spool)

        if route.startswith("/api/filament/spools/") and route.endswith("/remove"):
            if self._module_blocked("filament_inventory"):
                return None
            spool_id = route[len("/api/filament/spools/"):-len("/remove")]
            inventory = filament_inventory.remove_spool(spool_id)
            return self._send_json({"spools": inventory})

        if route.startswith("/api/filament/spools/") and route.endswith("/grams"):
            if self._module_blocked("filament_inventory"):
                return None
            spool_id = route[len("/api/filament/spools/"):-len("/grams")]
            body = self._read_json_body()
            spool = filament_inventory.update_grams(spool_id, body.get("grams_remaining"))
            return self._send_json(spool)

        if route == "/api/notifications/settings":
            if self._module_blocked("notifications"):
                return None
            body = self._read_json_body()
            return self._send_json(notifications.save_settings(body))

        if route == "/api/notifications/test":
            if self._module_blocked("notifications"):
                return None
            body = self._read_json_body()
            message = body.get("message") or "Test notification from Deja Vu1"
            return self._send_json(notifications.notify(message, priority="high"))

        if route == "/api/pairing/code":
            return self._send_json(pairing.generate_code())

        if route == "/api/pairing/redeem":
            body = self._read_json_body()
            device = pairing.redeem_code(body.get("code"), body.get("device_name"))
            return self._send_json(device)

        if route.startswith("/api/pairing/devices/") and route.endswith("/unpair"):
            device_id = route[len("/api/pairing/devices/"):-len("/unpair")]
            devices = pairing.unpair(device_id)
            return self._send_json({"devices": devices})

        if route == "/api/cost/settings":
            if self._module_blocked("cost_calculator"):
                return None
            body = self._read_json_body()
            return self._send_json(cost_calculator.save_settings(body))

        if route == "/api/wled/settings":
            if self._module_blocked("wled_bridge"):
                return None
            body = self._read_json_body()
            return self._send_json(wled_bridge.save_settings(body))

        if route == "/api/wled/test":
            if self._module_blocked("wled_bridge"):
                return None
            return self._send_json(wled_bridge.test_connection())

        if route == "/api/wled/push":
            if self._module_blocked("wled_bridge"):
                return None
            return self._send_json(wled_bridge.push_ring_states())

        if route == "/api/homeassistant/settings":
            if self._module_blocked("home_assistant_bridge"):
                return None
            body = self._read_json_body()
            return self._send_json(home_assistant_bridge.save_settings(body))

        if route == "/api/homeassistant/push":
            if self._module_blocked("home_assistant_bridge"):
                return None
            return self._send_json(home_assistant_bridge.push_sensors())

        return self._send_json({"error": "Unknown endpoint"}, status=404)

    def _handle_maintenance(self, connected, force_disconnected, action, require=None):
        if self._module_blocked("maintenance"):
            return None
        # Changing the maintenance log is only meaningful against real data,
        # or in an explicit demo. Same rule as the read endpoints.
        if force_disconnected or (not connected and not self._wants_demo()):
            return self._send_json({"connected": False, "demo": False}, status=409)

        body = self._read_json_body()
        if require and not body.get(require):
            return self._send_json({"error": f"Missing {require}"}, status=400)
        return self._send_json(self._tag(action(body), connected))

    # -- the camera relay -------------------------------------------------

    def _relay_camera(self):
        upstream = camera.open_stream()
        ctype = upstream.headers.get("Content-Type", "multipart/x-mixed-replace")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True

        def write(chunk):
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except OSError:
                raise _Gone()

        try:
            camera.relay(upstream, write, lambda: False)
        finally:
            upstream.close()

    # -- the live WebSocket -----------------------------------------------

    def _handle_websocket(self):
        """
        Upgrade to a WebSocket and push live state until the browser leaves.

        Messages sent: {"type": "state"} for the subscribed printer whenever
        it changes (up to every 250 ms), {"type": "fleet"} about once a
        second if asked for, and {"type": "event"} for print events and
        automation firings. The browser may send {"type": "subscribe",
        "printer": id, "fleet": bool} to switch printers without
        reconnecting.
        """
        self.close_connection = True
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
        conn = websocket.WebSocketConnection(self.rfile, self.wfile, threading.Lock())

        connected = mock_moonraker.is_connected(printer_id) and mock_moonraker.has_printer(printer_id)
        if not connected and (not demo or not mock_moonraker.has_printer(printer_id)):
            # The same rule as every other printer route: nothing else.
            try:
                conn.send_text(json.dumps({"connected": False, "demo": False}))
            finally:
                conn.close(1000, "No printer connected")
            return None

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
                    if msg.get("type") == "subscribe":
                        pid = msg.get("printer")
                        if pid and mock_moonraker.has_printer(pid):
                            sub["printer"] = pid
                            sub["sent_seq"] = -1
                        if "fleet" in msg:
                            sub["fleet"] = bool(msg["fleet"])
                        live_feed.mark_demo_seen()
            except (websocket.ConnectionClosed, websocket.ProtocolError, OSError):
                pass
            finally:
                stop.set()

        threading.Thread(target=reader, name="ws-reader", daemon=True).start()
        tag = {"connected": connected, "demo": not connected}
        conn.send_text(json.dumps({"type": "hello", "tick_ms": int(live_feed.TICK_SECONDS * 1000),
                                   "printer": printer_id, **tag}))
        last_event = live_feed.last_event_id()
        sub["sent_seq"] = -1
        fleet_seq = -1
        seq = -1
        last_ping = time.time()
        try:
            while not stop.is_set():
                seq, event_id = live_feed.wait_for_change(seq, last_event, timeout=1.0)
                if not connected:
                    live_feed.mark_demo_seen()
                entry = live_feed.snapshot(sub["printer"])
                if entry["seq"] != sub["sent_seq"]:
                    sub["sent_seq"] = entry["seq"]
                    conn.send_text(json.dumps({"type": "state", "printer": sub["printer"],
                                               "seq": entry["seq"], "t": entry["t"],
                                               "state": entry["state"], **tag}))
                if event_id != last_event:
                    for event in live_feed.events_since(last_event):
                        conn.send_text(json.dumps({"type": "event", "event": event, **tag}))
                    last_event = event_id
                if sub["fleet"]:
                    snap = live_feed.fleet_snapshot()
                    if snap["seq"] != fleet_seq:
                        fleet_seq = snap["seq"]
                        conn.send_text(json.dumps({"type": "fleet", "printers": snap["printers"],
                                                   "t": snap["t"], **tag}))
                if time.time() - last_ping > 20:
                    conn.ping()
                    last_ping = time.time()
        except (websocket.ConnectionClosed, OSError):
            pass
        finally:
            stop.set()
            conn.close()
        return None


class DejaVuServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    server = DejaVuServer(("0.0.0.0", PORT), DejaVuHandler)
    live_feed.start()
    print("=" * 58)
    print("  Deja Vu1 dashboard")
    print(f"  Open your browser at:  http://localhost:{PORT}")
    print("  Running on simulated printer data. No printer needed.")
    print("  Live updates every 250 ms over /api/live (WebSocket).")
    print("  Press Ctrl+C to stop.")
    print("=" * 58)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        live_feed.stop()
        server.server_close()


if __name__ == "__main__":
    main()
