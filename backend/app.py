"""
app.py
======

The web server. It does two jobs:

  1. Serves the dashboard web page (the files in ../frontend).
  2. Answers questions from that page over a small JSON API.

This uses only Python's built-in http.server, so there is nothing to install.
Flask or FastAPI would work too, but they would each add a dependency for a
server this small. Run it with:

    python3 backend/app.py

then open http://localhost:8000 in a browser.

API endpoints
-------------
  GET  /api/connection               is a printer connected?
  GET  /api/modules                  every module and its on/off state
  POST /api/modules/<id>/toggle      switch a module on or off {"enabled": bool}

  GET  /api/maintenance              what's due
  GET  /api/maintenance/history      completed maintenance log
  POST /api/maintenance/done         mark a task done  {"task_id": "..."}

  GET  /api/leds                     simulated LED ring states
  GET  /api/colorcheck               simulated filament color check
  GET  /api/printer                  raw mock printer state

  GET  /api/printer/control/capabilities
  GET  /api/printer/control/console
  POST /api/printer/control/pause
  POST /api/printer/control/resume
  POST /api/printer/control/cancel
  POST /api/printer/control/temperature  {"toolhead": "T0", "target": 220}
  POST /api/printer/control/home         {"axes": ["X","Y","Z"]}
  POST /api/printer/control/gcode        {"command": "G28"}

  GET  /api/filament                 spool inventory + idle-spool flags
  GET  /api/filament/check           does inventory cover the current job?
  POST /api/filament/spools          add a spool
  POST /api/filament/spools/<id>/remove
  POST /api/filament/spools/<id>/grams   {"grams_remaining": 500}

  GET  /api/compare                  "what changed?" + likely cause
  GET  /api/compare/repeat           settings from the last clean print
  GET  /api/sanity                   is it safe to print right now?

  GET  /api/updates                  Moonraker/Klipper update status
  GET  /api/backup                   download a zip of this app's data
  GET  /api/camera                   camera feed + freeze watchdog

  GET  /api/notifications/settings
  POST /api/notifications/settings
  GET  /api/notifications/queue
  POST /api/notifications/test       {"message": "..."}

  GET  /api/pairing/devices
  POST /api/pairing/code
  POST /api/pairing/redeem           {"code": "...", "device_name": "..."}
  POST /api/pairing/devices/<id>/unpair

No figures without a printer
----------------------------
With no printer connected, routes that read printer state return no numbers
at all — just {"connected": false, "demo": false}. The dashboard shows empty
states rather than inventing values.

Adding ?demo=1 to a request opts in to the simulated data explicitly. That is
what the dashboard's "Demo data" switch sends. Everything returned that way is
flagged "demo": true, so simulated figures can never be mistaken for real ones.

This rule applies only to routes that read *printer* data. Routes that read
or change this dashboard's own settings — modules, pairing, notification
preferences, the filament list — work the same whether or not a printer is
connected, because they aren't printer figures.
"""

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# Make sure Python can find the other backend modules no matter which folder
# the server was started from.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND_DIR)

import backup
import camera
import color_check
import comparison
import filament_inventory
import led_status
import maintenance
import mock_moonraker
import modules
import notifications
import pairing
import printer_control
import sanity_check
import updates

# The dashboard's HTML/CSS/JS lives here.
_FRONTEND_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "frontend")

PORT = int(os.environ.get("PORT", 8000))

# Routes that return printer figures, gated by connection/demo, each mapped
# to the module that owns them (checked before connection) and the function
# that produces the data.
_DATA_ROUTES = {
    "/api/maintenance": ("maintenance", lambda: maintenance.get_status()),
    "/api/maintenance/history": ("maintenance", lambda: {"history": maintenance.get_history()}),
    "/api/leds": ("led_status", lambda: led_status.get_all_ring_states()),
    "/api/colorcheck": ("color_check", lambda: color_check.check_current_job()),
    "/api/printer": (None, lambda: mock_moonraker.get_printer_state()),
    "/api/printer/control/capabilities": ("printer_control", lambda: printer_control.get_capabilities()),
    "/api/printer/control/console": ("printer_control", lambda: {"log": printer_control.get_console_log()}),
    "/api/filament/check": ("filament_inventory", lambda: filament_inventory.check_job_requirements()),
    "/api/compare": ("compare", lambda: comparison.compare_current_job()),
    "/api/compare/repeat": ("compare", lambda: comparison.repeat_last_settings()),
    "/api/sanity": ("sanity_check", lambda: sanity_check.check()),
    "/api/updates": ("updates", lambda: updates.get_status()),
    "/api/camera": ("camera", lambda: camera.get_status()),
}

# Routes that answer from this dashboard's own settings, not printer figures.
# Not gated by connected/demo; some are still gated by their module toggle.
_APP_ROUTES = {
    "/api/filament": ("filament_inventory", lambda: {
        "spools": filament_inventory.get_inventory(),
        "idle_spools": filament_inventory.idle_spools(),
    }),
    "/api/notifications/settings": ("notifications", lambda: notifications.get_settings()),
    "/api/notifications/queue": ("notifications", lambda: {"queue": notifications.get_queue()}),
}

# POST actions on printer-figure-gated routes.
_CONTROL_ACTIONS = {
    "/api/printer/control/pause": lambda body: printer_control.pause_print(),
    "/api/printer/control/resume": lambda body: printer_control.resume_print(),
    "/api/printer/control/cancel": lambda body: printer_control.cancel_print(),
    "/api/printer/control/temperature": lambda body: printer_control.set_temperature(
        body.get("toolhead"), body.get("target")),
    "/api/printer/control/home": lambda body: printer_control.home(body.get("axes")),
    "/api/printer/control/gcode": lambda body: printer_control.send_gcode(body.get("command")),
}


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

    def _send_bytes(self, data, content_type, filename=None):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self):
        """Read and parse the JSON a browser sent us in a POST request."""
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def log_message(self, fmt, *args):
        """Keep the terminal quiet — one tidy line per request."""
        sys.stderr.write(f"  {self.command} {self.path}\n")

    def _module_blocked(self, module_id):
        if module_id and not modules.is_enabled(module_id):
            self._send_json({"error": "Module disabled", "module_disabled": True}, status=403)
            return True
        return False

    # -- request handling -------------------------------------------------

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._handle_api_get()
        # Not an API call, so serve a file from the frontend folder.
        return super().do_GET()

    def _wants_demo(self):
        """
        Did the caller explicitly ask for simulated data?

        True when the URL carries ?demo=1. Anything else means no — we do not
        hand out invented figures unless they were asked for by name.
        """
        query = parse_qs(urlparse(self.path).query)
        return query.get("demo", ["0"])[0] in ("1", "true", "yes")

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

    def _handle_api_get(self):
        # Ignore any "?something=..." on the end of the URL.
        route = self.path.split("?")[0].rstrip("/")
        connected = mock_moonraker.is_connected()
        demo = self._wants_demo()

        try:
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

            if route in _APP_ROUTES:
                module_id, producer = _APP_ROUTES[route]
                if self._module_blocked(module_id):
                    return None
                return self._send_json(producer())

            if route in _DATA_ROUTES:
                module_id, producer = _DATA_ROUTES[route]
                if self._module_blocked(module_id):
                    return None
                # Every route here returns figures derived from the printer.
                # Without a printer, and without an explicit demo request,
                # it returns none.
                if not connected and not demo:
                    return self._send_json({"connected": False, "demo": False})
                return self._send_json(self._tag(producer(), connected))

            return self._send_json({"error": "Unknown endpoint"}, status=404)

        except ValueError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:                      # noqa: BLE001
            # Never let a crash take the whole server down mid-demo.
            return self._send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        route = self.path.split("?")[0].rstrip("/")
        connected = mock_moonraker.is_connected()

        try:
            if route == "/api/maintenance/done":
                return self._handle_maintenance_done(connected)

            if route.startswith("/api/modules/") and route.endswith("/toggle"):
                module_id = route[len("/api/modules/"):-len("/toggle")]
                body = self._read_json_body()
                result = modules.set_enabled(module_id, body.get("enabled", True))
                return self._send_json({"modules": result})

            if route in _CONTROL_ACTIONS:
                if self._module_blocked("printer_control"):
                    return None
                if not connected and not self._wants_demo():
                    return self._send_json({"connected": False, "demo": False}, status=409)
                body = self._read_json_body()
                result = _CONTROL_ACTIONS[route](body)
                return self._send_json(self._tag(result, connected))

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

            return self._send_json({"error": "Unknown endpoint"}, status=404)

        except ValueError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:                      # noqa: BLE001
            return self._send_json({"error": str(exc)}, status=500)

    def _handle_maintenance_done(self, connected):
        if self._module_blocked("maintenance"):
            return None
        # Marking a task done is only meaningful against real data, or in an
        # explicit demo. Same rule as the read endpoints.
        if not connected and not self._wants_demo():
            return self._send_json({"connected": False, "demo": False}, status=409)

        body = self._read_json_body()
        task_id = body.get("task_id")
        if not task_id:
            return self._send_json({"error": "Missing task_id"}, status=400)

        updated = maintenance.mark_done(task_id, note=body.get("note", ""))
        return self._send_json(self._tag(updated, connected))


def main():
    server = HTTPServer(("0.0.0.0", PORT), DejaVuHandler)
    print("=" * 58)
    print("  Deja Vu1 dashboard")
    print(f"  Open your browser at:  http://localhost:{PORT}")
    print("  Running on simulated printer data. No printer needed.")
    print("  Press Ctrl+C to stop.")
    print("=" * 58)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
