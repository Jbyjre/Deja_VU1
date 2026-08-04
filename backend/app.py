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
  GET  /api/connection           is a printer connected?
  GET  /api/maintenance          what's due
  GET  /api/maintenance/history  completed maintenance log
  POST /api/maintenance/done     mark a task done  {"task_id": "..."}
  GET  /api/leds                 simulated LED ring states
  GET  /api/colorcheck           simulated filament color check
  GET  /api/printer              raw mock printer state

No figures without a printer
----------------------------
With no printer connected, the data endpoints return no numbers at all —
just {"connected": false, "demo": false}. The dashboard shows empty states
rather than inventing values.

Adding ?demo=1 to a request opts in to the simulated data explicitly. That is
what the dashboard's "Demo data" switch sends. Everything returned that way is
flagged "demo": true, so simulated figures can never be mistaken for real ones.
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

import color_check
import led_status
import maintenance
import mock_moonraker

# The dashboard's HTML/CSS/JS lives here.
_FRONTEND_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "frontend")

PORT = int(os.environ.get("PORT", 8000))

# The routes that return printer figures, each mapped to the function that
# produces them. Kept in one place so the connection check below cannot miss
# one: everything in here is gated, by construction.
_DATA_ROUTES = {
    "/api/maintenance": lambda: maintenance.get_status(),
    "/api/maintenance/history": lambda: {"history": maintenance.get_history()},
    "/api/leds": lambda: led_status.get_all_ring_states(),
    "/api/colorcheck": lambda: color_check.check_current_job(),
    "/api/printer": lambda: mock_moonraker.get_printer_state(),
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

            # Check the route exists before checking the connection, so a typo
            # in a URL still reports 404 rather than looking like a
            # disconnected printer.
            if route not in _DATA_ROUTES:
                return self._send_json({"error": "Unknown endpoint"}, status=404)

            # Every route below returns figures. Without a printer, and without
            # an explicit demo request, it returns none.
            if not connected and not demo:
                return self._send_json({"connected": False, "demo": False})

            return self._send_json(self._tag(_DATA_ROUTES[route](), connected))

        except Exception as exc:                      # noqa: BLE001
            # Never let a crash take the whole server down mid-demo.
            return self._send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        route = self.path.split("?")[0].rstrip("/")

        if route != "/api/maintenance/done":
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        # Marking a task done is only meaningful against real data, or in an
        # explicit demo. Same rule as the read endpoints.
        connected = mock_moonraker.is_connected()
        if not connected and not self._wants_demo():
            return self._send_json({"connected": False, "demo": False}, status=409)

        body = self._read_json_body()
        task_id = body.get("task_id")

        if not task_id:
            return self._send_json({"error": "Missing task_id"}, status=400)

        try:
            updated = maintenance.mark_done(task_id, note=body.get("note", ""))
            return self._send_json(self._tag(updated, connected))
        except ValueError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:                      # noqa: BLE001
            return self._send_json({"error": str(exc)}, status=500)


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
