"""
app.py
======

The web server. It does two jobs:

  1. Serves the dashboard web page (the files in ../frontend).
  2. Answers questions from that page over a small JSON API.

This uses only Python's built-in http.server, so there is nothing to install.
Run it with:

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
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
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
MAX_JSON_BODY = 16 * 1024

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
    """Serve the frontend and the small JSON API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=_FRONTEND_DIR, **kwargs)

    # -- helpers ----------------------------------------------------------

    def end_headers(self):
        # Conservative browser hardening that does not interfere with the
        # dependency-free inline SVG/CSS used by the dashboard.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def _send_json(self, payload, status=200):
        """Send a Python dictionary back to the browser as JSON."""
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        """Read and parse the JSON a browser sent us in a POST request."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            return None, "Invalid Content-Length"

        if length < 0 or length > MAX_JSON_BODY:
            return None, "Request body is too large"
        if not length:
            return {}, None

        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None, "Invalid JSON body"

        if not isinstance(body, dict):
            return None, "JSON body must be an object"
        return body, None

    def log_message(self, fmt, *args):
        """Keep the terminal quiet — one tidy line per request."""
        sys.stderr.write(f"  {self.command} {self.path}\n")

    # -- request handling -------------------------------------------------

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._handle_api_get()
        return super().do_GET()

    def _wants_demo(self):
        query = parse_qs(urlparse(self.path).query)
        return query.get("demo", ["0"])[0] in ("1", "true", "yes")

    @staticmethod
    def _tag(payload, connected):
        # Copy before tagging so a route cannot accidentally retain request
        # metadata if it returns a shared dictionary in the future.
        tagged = dict(payload)
        tagged["connected"] = connected
        tagged["demo"] = not connected
        return tagged

    def _handle_api_get(self):
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

            if route not in _DATA_ROUTES:
                return self._send_json({"error": "Unknown endpoint"}, status=404)

            if not connected and not demo:
                return self._send_json({"connected": False, "demo": False})

            return self._send_json(self._tag(_DATA_ROUTES[route](), connected))

        except Exception as exc:  # noqa: BLE001
            # Keep the server alive, but do not expose internal exception text
            # to remote clients. The exception still lands in the terminal.
            sys.stderr.write(f"  API error {route}: {exc!r}\n")
            return self._send_json({"error": "Internal server error"}, status=500)

    def do_POST(self):
        route = self.path.split("?")[0].rstrip("/")

        if route != "/api/maintenance/done":
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        connected = mock_moonraker.is_connected()
        if not connected and not self._wants_demo():
            return self._send_json({"connected": False, "demo": False}, status=409)

        body, error = self._read_json_body()
        if error:
            return self._send_json({"error": error}, status=400)

        task_id = body.get("task_id")
        if not isinstance(task_id, str) or not task_id.strip():
            return self._send_json({"error": "Missing task_id"}, status=400)

        note = body.get("note", "")
        if not isinstance(note, str):
            return self._send_json({"error": "note must be a string"}, status=400)

        try:
            updated = maintenance.mark_done(task_id.strip(), note=note[:1000])
            return self._send_json(self._tag(updated, connected))
        except ValueError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"  API error {route}: {exc!r}\n")
            return self._send_json({"error": "Internal server error"}, status=500)


def main():
    # Threading keeps a slow browser request from blocking every other panel.
    server = ThreadingHTTPServer(("0.0.0.0", PORT), DejaVuHandler)
    server.daemon_threads = True
    print("=" * 58)
    print("  Deja Vu1 dashboard")
    print(f"  Open your browser at:  http://localhost:{PORT}")
    print("  No printer is contacted unless a real connector is added.")
    print("  Use the Demo data switch to preview simulated values.")
    print("  Press Ctrl+C to stop.")
    print("=" * 58)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
