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
  GET  /api/maintenance          what's due
  GET  /api/maintenance/history  completed maintenance log
  POST /api/maintenance/done     mark a task done  {"task_id": "..."}
  GET  /api/leds                 simulated LED ring states
  GET  /api/colorcheck           simulated filament color check
  GET  /api/printer              raw mock printer state
"""

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

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

    def _handle_api_get(self):
        # Ignore any "?something=..." on the end of the URL.
        route = self.path.split("?")[0].rstrip("/")

        try:
            if route == "/api/maintenance":
                return self._send_json(maintenance.get_status())

            if route == "/api/maintenance/history":
                return self._send_json({"history": maintenance.get_history()})

            if route == "/api/leds":
                return self._send_json(led_status.get_all_ring_states())

            if route == "/api/colorcheck":
                return self._send_json(color_check.check_current_job())

            if route == "/api/printer":
                return self._send_json(mock_moonraker.get_printer_state())

            return self._send_json({"error": "Unknown endpoint"}, status=404)

        except Exception as exc:                      # noqa: BLE001
            # Never let a crash take the whole server down mid-demo.
            return self._send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        route = self.path.split("?")[0].rstrip("/")

        if route != "/api/maintenance/done":
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        body = self._read_json_body()
        task_id = body.get("task_id")

        if not task_id:
            return self._send_json({"error": "Missing task_id"}, status=400)

        try:
            updated = maintenance.mark_done(task_id, note=body.get("note", ""))
            return self._send_json(updated)
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
