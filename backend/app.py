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
  GET  /api/live/events?since=       events after a given id, for polling fallback
  GET  /api/fleet                    one overview row per printer
  GET  /api/fleet/registry           printers you added by address, each with its link in words
  POST /api/fleet/registry           add one {"name", "moonraker_url", "api_key" (optional)}
  POST /api/fleet/registry/<id>/remove
  GET  /api/printers/diagnostics?printer=<id>
                                     a real printer's connection: state, last error, and the
                                     last exchanges with its Moonraker (what was sent and received)

  Fleet command center (operate several printers at once):
  POST /api/fleet/broadcast          {"action": "preheat|pause|resume|cancel|home",
                                      "printers": [ids] (empty = all), "params": {...}}
                                     one row per printer: ok, or exactly why not
  POST /api/fleet/route              {"filename", "to"} or {"from_printer", "item_id", "to"}
  GET  /api/fleet/queues             every printer's queue
  GET  /api/fleet/history?days=30&bucket=day|week
                                     prints, completed vs failed, grams, hours over time

  GET  /api/maintenance              what's due
  GET  /api/maintenance/history      completed maintenance log
  POST /api/maintenance/done         mark a task done  {"task_id": "..."}
  POST /api/printers/discover         find Moonraker on the home network (mDNS, then port 7125); {"wider": true} also
                                      nearby home ranges and the Tailscale network
  POST /api/printers/test             try a Moonraker address before adding it {"moonraker_url", "api_key"}
  POST /api/printers/login            read a printer's API key with its web-page login {"moonraker_url", "username", "password"}
  POST /api/camera/find               find and save the selected printer's camera feed
  GET  /api/app/watch-only            is watch-only mode on (no command reaches a real printer)?
  POST /api/app/watch-only            {"on": true|false}
  GET  /api/remote                    Tailscale on this computer: connected? shared address?
  POST /api/remote/share|stop         share the dashboard privately with Tailscale Serve, or stop (this computer only)
  POST /api/remote/link               a pairing QR code for the shared address
  GET  /api/assistant                 the AI assistant: providers, which is connected, mode, limits (never a key)
  GET  /api/assistant/thread          one conversation: messages, busy, the step waiting for a yes
  GET  /api/assistant/chats           saved conversations, newest first (kept on this computer)
  POST /api/assistant/key|forget      save or forget a provider's key (kept by the system keyring where there is one)
  POST /api/assistant/models|test|select   list a provider's models, check the connection, choose the AI in use,
                                     a model, the mode and the steps that never ask
  POST /api/assistant/check          is a plan's program installed and signed in (runs its own status command)
  POST /api/assistant/signin         sign in to a plan from the app: ChatGPT (Sign in with ChatGPT) or Claude Code
  POST /api/assistant/estimate|budget   tokens and cost before sending; the owner's prices and spending limit
  POST /api/assistant/watch          print watch: a camera check by the AI every few minutes while a real printer prints
  POST /api/assistant/watch/now      print watch: look through a real printer's camera now
  GET  /api/assistant/watch/picture  the last picture print watch studied for ?printer=
  POST /api/assistant/chat|decide|stop|clear   say something, approve or decline a step, stop, start over
  POST /api/tools/layer-plan         mixed-nozzle layer plan {"heads": [{toolhead, nozzle, height}], "exact", "part_height"}
  POST /api/maintenance/swap         record a nozzle/hotend swap {"kind", "toolhead", "nozzle"?}
  POST /api/maintenance/snooze       hide a due task from alerts for a while {"task_id", "days": 1|3|7}

  GET  /api/leds                     simulated LED ring states
  GET  /api/colorcheck               demo comparison or physical sensor observations
  GET  /api/colorcheck/sensors       assigned companion sensors and reading status
  POST /api/colorcheck/sensors       version 1 physical sensor assignments, per printer
  POST /api/colorcheck/readings      one version 1 companion observation
  POST /api/colorcheck/calibration   {"toolhead", "step": "white"|"dark"|"clear"} record or forget a reference
  GET  /api/colorcheck/overrides     prints started against the colour sensor's reading, newest first
  GET  /api/printer                  raw mock printer state
  GET  /api/printer/job              the running job: file, time, grams, what each toolhead prints
  GET  /api/chamber                  chamber temperature now + last 30 minutes
  GET  /api/health                   the print health gauge

  GET  /api/printer/control/capabilities
  GET  /api/printer/control/console
  POST /api/printer/control/start        {"filename": "...", "confirmed": true}
  POST /api/printer/control/pause
  POST /api/printer/control/resume
  POST /api/printer/control/cancel
  POST /api/printer/control/exclude   {"name"} skip one labelled object, the rest keep printing
  POST /api/printer/control/temperature  {"toolhead": "T0", "target": 220}
  POST /api/printer/control/home         {"axes": ["X","Y","Z"]}
  POST /api/printer/control/gcode        {"command": "G28"}

  GET  /api/print/confirm?file=...   the Confirm Print summary (gate)
  GET  /api/print/preview            the running print's visible walls per toolhead (3D twin); ?file= names a sample on a simulated printer
  GET  /api/insights                 findings from the printer's own print history
  GET  /api/app/memory               safety copies of the dashboard's records; repairs made
  POST /api/app/memory/snapshot      make a safety copy now
  POST /api/app/selfcheck            "Check it yourself": real checks run in this copy
  POST /api/app/memory/restore       {"id", "file"?} write a safety copy back, then restart
  GET  /api/import/orca              presets and recent projects found in Orca on this computer
  POST /api/import/orca/projects     {"ids"} copy recent projects into Files
  POST /api/import/orca/profile      {"name", "machine", "process", "filaments"} a profile from your presets
  GET  /api/tester/status            Tester mode: days used, actions, errors and slow spots recorded so far (module "tester")
  GET  /api/tester/report.html       the tester report as one readable page (?theme=light|dark)
  GET  /api/tester/report.zip        the report as deja-vu1-tester-report-YYYY-MM-DD.zip to attach to a forum message
  POST /api/tester/events            the browser's batch of events {"events": [...]}; private details are hidden
  POST /api/tester/delete            delete everything Tester mode recorded (the answers too)
  GET  /api/tester/study             how many of the 22 questions are answered (?questions=1 adds the questions, the saved answers and hints)
  POST /api/tester/answers           {"answers": {"q19": {"c": null, "t": "..."}, "q16": {"c": "didnt_try"}}}; each answer is masked and kept on this computer
  POST /api/app/updates/git          update a git checkout (fast-forward only)
  POST /api/app/repair               put the newest published files back over this copy, then restart
  POST /api/app/restart              restart the dashboard (launcher only)
  POST /api/app/stop                 stop the dashboard (from this computer only)

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
  POST /api/convert                  {"name", "plan"?} MakerWorld/NexPrint/Orca forks/PrusaSlicer -> U1
  GET  /api/colours/plan?name=       a project's filaments and the suggested head for each
  POST /api/colours/apply            {"name", "plan"} a copy using at most the U1's four heads
  GET  /api/logbook?q=               this printer's logbook: problems, fixes, print hours (search with q)
  POST /api/logbook/add              {"problem", "fix", "tags"}
  POST /api/logbook/<id>/fix | delete
  GET  /api/profiles/diff?a=&b=      side-by-side slicer settings

  Photo-to-Print Studio (the studio itself runs in the browser):
  GET  /api/studio/palette           colours to build with (your filament inventory)
  POST /api/studio/save?name=&note=  the STL/3MF the studio built, as the request body

  Auto-print pipeline (OrcaSlicer, a program you install; off by default):
  GET  /api/slicer/settings | POST   {"slicer_path", "timeout_s", "default_profile"}
  GET  /api/slicer/schema            the process settings the profile editor shows (Orca names, limits)
  POST /api/slicer/check             runs "<slicer> --help": is it there, which version?
  POST /api/slicer/profiles          {"name", "machine", "process", "filaments": [...]}
  POST /api/slicer/profiles/<id>/remove
  POST /api/slicer/profiles/stock    one press: a profile from Snapmaker's stock U1 presets that fit the fitted heads
  POST /api/slicer/slice             {"name", "profile", "queue": bool} - starts a job
  GET  /api/slicer/jobs              every recent job: running, done, queued or failed (in words)

  GET  /api/queue                    this printer's print queue
  POST /api/queue/add | remove | move | auto | start-next | clear-done
  POST /api/queue/bed-clear          {"job_key"} "Part removed, bed clear" for the print that ended last

  GET  /api/automations              rules
  GET  /api/automations/log          what fired, and what really happened
  POST /api/automations              add a rule {"rule": {...}}
  POST /api/automations/<id>/update | delete | test

  GET  /api/prints?q=&status=        the print record: running, queued and ended prints, newest first
  GET  /api/prints/item?id=          one print in the record
  GET  /api/prints/picture?id=       the camera picture from the end of a print
  POST /api/prints/note|forget       {"id", "note"} a note on a print; {"id"} remove it from the record
  POST /api/prints/settings          {"keep_days": 30|90|365|0} how long the record is kept
  GET  /api/timelapse                recorded prints for this printer
  GET  /api/timelapse/frames?session=
  GET  /api/timelapse/printer         the printer's own recorded videos, and the copies kept here
  GET  /api/timelapse/printer-video?root=&path=   one of the printer's videos, straight from it
  GET  /api/timelapse/video?name=     a copy kept here
  POST /api/timelapse/keep|forget     keep a copy of a printer video here {root, path}; forget one {name}
  GET  /api/timelapse/frame?session=&name=

  GET  /api/filament                 spool inventory + idle-spool flags
  GET  /api/filament/check           does inventory cover the current job?
  POST /api/filament/spoolman        {"url"} import spools from Spoolman (updates ones imported before)
  GET  /api/filament/forecast        grams left and prints left per spool
  POST /api/filament/spools          add a spool (grams_remaining null = unknown; weight_source weighed|estimated)
  POST /api/filament/spools/<id>/remove
  GET  /api/filament/charges         the last finished prints charged to a roll (the roll fixed at print start)
  POST /api/filament/charges/<id>/move  {"spool_id"} the explicit correction: charge another roll instead
  POST /api/filament/spools/<id>/grams   {"grams_remaining": 500, "weight_source": "weighed"} (null = unknown)

  GET  /api/compare                  "what changed?" + likely cause
  GET  /api/compare/repeat           settings from the last clean print
  GET  /api/compare/side-by-side     current job vs last clean run
  GET  /api/sanity                   is it safe to print right now?

  GET  /api/updates                  Moonraker/Klipper update status
  GET  /api/backup                   download a zip of this app's data
  GET  /api/camera                   camera feed + freeze watchdog
  GET  /api/camera/settings | POST   the MJPEG stream address
  GET  /api/camera/stream            the camera, relayed (MJPEG)
  GET  /api/camera/live              the printer's built-in camera as a live MJPEG stream
  GET  /api/camera/webrtc/settings | POST   optional go2rtc address (low latency)
  POST /api/camera/webrtc/offer      pass a WebRTC offer to go2rtc, return its answer

  GET  /api/notifications/settings
  POST /api/notifications/settings
  GET  /api/notifications/queue
  POST /api/notifications/test       {"message": "..."}

  GET  /api/pairing/devices
  POST /api/pairing/code
  POST /api/pairing/link             {"base": page origin} address for a phone + a one-time code + its QR code
  POST /api/pairing/redeem           {"code": "...", "device_name": "..."}
  POST /api/pairing/devices/<id>/unpair
  GET  /api/pairing/status           device lock on?, this computer?, this device paired?
  POST /api/pairing/lock             {"on": bool} only paired devices may use the dashboard
  GET  /api/handoff?device=          "continue where another device was"
  POST /api/handoff                  {"device_id", "device_name", "view"}

  GET  /api/cost/history              cost of recent print jobs
  GET  /api/cost/current              estimated cost of the job in progress ({"printing": false} when idle)
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

  Farm sandbox (demo only, like the hooks above):
  GET  /api/sandbox                  farm, scenario, clock and what each step did
  POST /api/sandbox/farm             {"count": 8, "busy_fraction": 0.5}
  POST /api/sandbox/teardown         remove the printers the sandbox added
  POST /api/sandbox/scenario         {"preset": "jam"} or {"steps": [{"at_s", "printer", "event", "params"}]}
  POST /api/sandbox/run              {"running": bool}
  POST /api/sandbox/speed            {"speed": 60}
  POST /api/sandbox/step             {"seconds": 600} move the farm forward now
  POST /api/sandbox/fire             {"event", "printer", "params"} one event, now
  POST /api/sandbox/reset

No figures without a printer
----------------------------
With no printer connected, routes that read printer state return no numbers
at all - just {"connected": false, "demo": false}. The dashboard shows empty
states rather than inventing values. The live WebSocket follows the same
rule: without demo it sends exactly that object and closes.

Adding ?demo=1 to a request opts in to the simulated data explicitly. That is
what the dashboard's "Demo data" switch sends. Everything returned that way is
flagged "demo": true, so simulated figures can never be mistaken for real ones.

This rule applies only to routes that read *printer* data. Routes that read
or change this dashboard's own settings - modules, pairing, notification
preferences, the filament list, the file library, automation rules - work
the same whether or not a printer is connected, because they aren't printer
figures.
"""

import errno
import gzip
import ipaddress
import http.cookies
import json
import os
import re
import socket
import socketserver
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Make sure Python can find the other backend modules no matter which folder
# the server was started from.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND_DIR)

import app_updates
import autostart
import desktop
import automations
import backup
import project_plates
import logbook
import process_settings
import camera
import color_check
import companion_sensor
import comparison
import colour_map
import console
import storage
import converter_3mf
import cost_calculator
import discovery
import refind
import webrtc_relay
import file_library
import filament_inventory
import spoolman_bridge
import fleet
import handoff
import idle_stop
import static_files
import webrtc_camera
import home_assistant_bridge
import led_status
import live_feed
import layer_planner
import maintenance
import mock_moonraker
import modules
import notifications
import pairing
import photo_studio
import print_gate
import print_preview
import insights
import memory
import orca_import
import readiness
import selfcheck
import print_queue
import qr
import printer_control
import sandbox
import sanity_check
import slicer_bridge
import timelapse
import tool_setup
import plate_project
import model_maker
import updates
import update_hold
import remote
import ai_assistant
import ai_providers
import tester
import tester_questions
import tester_report
import tester_study
import watch_only
import websocket
import wled_bridge
from app_part1 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    DejaVuServer, DualStackServer, LIVE_FPS, LIVE_SECONDS, MAX_UPLOAD, PORT, PORT_IN_USE, WRITE_GRACE, _APP_ROUTES,
    _CONTROL_ACTIONS, _DATA_ROUTES, _FARM_ROUTES, _Gone, _LOCAL_SUFFIXES, _QUEUE_ACTIONS, _chamber, _close_down,
    _colour_plan, _confirm_print, _demo, _fleet_rows, _host_name, _live_snapshot, _loaded_heads, _print_phone_qr,
    _q, _restart_soon, _tester_study, module_routes,
)
import app_post
from app_get import GetRoutes  # GET routes, the WebSocket and the timed dispatch (split out)
from app_post import PostRoutes  # POST routes (split out)

# The dashboard's HTML/CSS/JS lives here.
_FRONTEND_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "frontend")


# Names this dashboard answers to, beyond the ones that are obviously on
# your own network (see _host_allowed). Set this if you reach it through
# your own domain, e.g. DEJAVU_ALLOWED_HOSTS=printer.example.com
EXTRA_HOSTS = {h.strip().lower() for h in os.environ.get("DEJAVU_ALLOWED_HOSTS", "").split(",")
               if h.strip()}


def host_is_local(host):
    """
    Is this Host header a name only your own network could have given?

    An IP address, a name with no dots (like "raspberrypi"), localhost, or a
    home-network suffix such as .local. A public web site can't hand out any
    of those, which is what stops "DNS rebinding": a trick where a page you
    visit points its own domain name at your dashboard's address to get
    around the browser's same-site rules.
    """
    name = _host_name(host)
    if not name:
        return False
    if name in EXTRA_HOSTS:
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        pass
    return name == "localhost" or "." not in name or name.endswith(_LOCAL_SUFFIXES)


def phone_link(base=None):
    """
    What a phone needs to open this dashboard: the address, a fresh one-time
    pairing code, and a QR code of the two together, so the phone's camera
    opens and pairs it without typing (typed addresses are where phones go
    wrong: "10.0.0.10.8000" or a missing "http://" becomes a web search).

    `base` is the address the asking page was opened at. A page opened by a
    network address or an allowed name (a tunnel domain) already works from
    another device, so that one is used; localhost only works on this
    computer, so then the computer's home-network address is used instead.
    """
    origin = None
    try:
        parts = urlparse(str(base or "").strip())
        if (parts.scheme in ("http", "https") and parts.hostname and "@" not in parts.netloc
                and parts.hostname not in ("localhost", "127.0.0.1", "::1")
                and host_is_local(parts.netloc)):
            origin = f"{parts.scheme}://{parts.netloc}"
    except ValueError:
        origin = None
    addresses = discovery.home_addresses()
    if origin is None and addresses:
        origin = f"http://{addresses[0]}:{PORT}"
    shown = _host_name(urlparse(origin).netloc) if origin else None
    code = pairing.generate_code()
    out = {"origin": origin, "port": PORT, "code": code["code"], "expires_at": code["expires_at"],
           "others": [f"http://{a}:{PORT}" for a in addresses if a != shown]}
    if origin:
        out["url"] = f"{origin}/?pair={code['code']}"
        out["qr"] = qr.rows(out["url"])
    return out


class DejaVuHandler(PostRoutes, GetRoutes, SimpleHTTPRequestHandler):
    """
    Handles every incoming browser request.

    Anything starting with /api/ is answered with JSON by our own code.
    Everything else is treated as a request for a file in the frontend folder,
    which the built-in SimpleHTTPRequestHandler already knows how to serve.
    """

    # A browser that opens a connection and then sends nothing (or trickles
    # a byte at a time) would otherwise hold a thread forever. Live
    # connections raise this once they are set up (see _handle_websocket).
    timeout = 60
    # Named here rather than left to the system's mime table, which not
    # every Python install has these in.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
                      ".js": "text/javascript", ".css": "text/css", ".mp4": "video/mp4"}

    def __init__(self, *args, **kwargs):
        # Tell the built-in file server to serve out of the frontend folder.
        super().__init__(*args, directory=_FRONTEND_DIR, **kwargs)

    # HTTP/1.1 lets a browser send many requests over one connection instead of opening a new one for each of the
    # page's hundred files and every reading after them. Only a reply whose end the browser can tell (a length, or no
    # body at all) to a GET keeps the connection open; everything else says "Connection: close" (end_headers).
    protocol_version = "HTTP/1.1"
    # On a connection that stays open, a reply's headers and body leave as separate small writes; without this the
    # computer holds the second one back waiting for an acknowledgement (Nagle's rule), about 40 ms a file. Measured
    # 24 November 2026: the dashboard took about 880 ms to open on this computer with the wait and about 500 ms without.
    disable_nagle_algorithm = True

    def send_response(self, code, message=None):
        self._reply = {"status": code, "length": False, "connection": False, "keep": True}
        super().send_response(code, message)

    def _no_keep_alive(self):
        """This reply ends when the connection closes (a stream that may stop short)."""
        getattr(self, "_reply", {})["keep"] = False

    def end_headers(self):
        reply = getattr(self, "_reply", None)
        if reply is not None and self.request_version != "HTTP/0.9":
            keep = (self.command in ("GET", "HEAD") and reply["keep"]
                    and (reply["length"] or reply["status"] in (204, 304)))
            if not keep:
                if not reply["connection"]:
                    self.send_header("Connection", "close")
                self.close_connection = True
        # Sent with every response, pages and API alike:
        #  - nosniff: a stored file is only ever treated as the type we say.
        #  - frame-ancestors / X-Frame-Options: no other site can load the
        #    dashboard invisibly inside its own page and trick clicks
        #    ("clickjacking") onto Pause or Cancel.
        #  - Referrer-Policy: addresses are not leaked to other sites.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
        self.send_header("Referrer-Policy", "same-origin")
        # The page's own files (HTML, scripts, styles) carry no caching rule
        # from the built-in file server, so a browser guessed one and could
        # keep running last week's scripts against today's page after an
        # update. no-cache means "check first": an unchanged file costs only
        # a short "304 Not Modified" reply. API answers set their own rule.
        if not self.path.startswith("/api/") and not getattr(self, "_cache_rule_sent", False):
            self.send_header("Cache-Control", "no-cache")
        self._cache_rule_sent = False
        super().end_headers()

    def send_header(self, keyword, value):
        name = keyword.lower()
        if name == "cache-control":
            self._cache_rule_sent = True
        reply = getattr(self, "_reply", None)
        if reply is not None and name == "content-length":
            reply["length"] = True
        if reply is not None and name == "connection":
            reply["connection"] = True
        super().send_header(keyword, value)

    # -- helpers ----------------------------------------------------------

    def _send_json(self, payload, status=200, cookie=None):
        """Send a Python dictionary back to the browser as JSON."""
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        gzipped = len(body) > 32 * 1024 and "gzip" in (self.headers.get("Accept-Encoding") or "")
        if gzipped:
            # Large replies (a print's preview, the file list) load several times faster compressed.
            body = gzip.compress(body, 5)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        if cookie:
            self.send_header("Set-Cookie", cookie)
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
        if content_type.startswith("text/html"):
            # The tester report is one page with no scripts: nothing may run or load in it.
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'")
        if content_type.startswith("image/svg"):
            # Frames are drawn by this server; still, never let an SVG run script.
            self.send_header("Content-Security-Policy", "script-src 'none'")
        self.end_headers()
        self.wfile.write(data)

    def _send_stream(self, status, content_type, chunks, length=None, extra=None, filename=None):
        """
        Send a body as it arrives (a video from the printer): the headers first, then each piece, so a large file starts playing at once
        and none of it is held in memory. A browser that stops watching closes the connection, which ends this quietly; a printer that
        stops sending part-way ends it with a short body, which the browser reads as a failed video, never as a whole one.
        """
        self.send_response(status)
        self._no_keep_alive()           # a printer that stops part-way leaves the body short: only a close ends it
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            for chunk in chunks:
                self.wfile.write(chunk)
        except Exception:               # noqa: BLE001 - the headers are out: all that is left is to end the connection
            self.close_connection = True

    def _send_file_ranged(self, path, content_type, filename=None):
        """A file from disk, in pieces, answering a single 'Range: bytes=a-b' so a video can be scrubbed."""
        size = os.path.getsize(path)
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        start, end, status = 0, size - 1, 200
        if match and (match.group(1) or match.group(2)):
            first, last = match.groups()
            start, end = (max(0, size - int(last)), size - 1) if first == "" else (int(first), min(size - 1, int(last) if last else size - 1))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
            status = 206

        def pieces():
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        return
                    yield chunk
                    left -= len(chunk)

        extra = {"Content-Range": f"bytes {start}-{end}/{size}"} if status == 206 else None
        return self._send_stream(status, content_type, pieces(), length=end - start + 1, extra=extra, filename=filename)

    def _content_length(self):
        """
        The body size the browser declared. A negative or garbled value is
        refused: a negative one would make the read wait for the connection
        to close, tying up a thread.
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("The request's Content-Length isn't a number")
        if length < 0:
            raise ValueError("The request's Content-Length can't be negative")
        return length

    def _read_json_body(self):
        """Read and parse the JSON a browser sent us in a POST request."""
        length = self._content_length()
        if not length:
            return {}
        if length > 1024 * 1024:
            raise ValueError("Request is too large")
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except ValueError:
            raise ValueError("The request wasn't valid JSON")
        return body if isinstance(body, dict) else {}

    def _read_raw_body(self, max_bytes=MAX_UPLOAD):
        length = self._content_length()
        if not length:
            raise ValueError("The file is empty")
        if length > max_bytes:
            raise ValueError(f"Files over {max_bytes//(1024*1024)} MB can't be added")
        data, remaining = [], length
        while remaining:
            chunk = self.rfile.read(min(remaining, 1 << 20))
            if not chunk:
                # The browser went away part-way through (cancelled, Wi-Fi
                # dropped): what arrived is half a file, so nothing is saved
                # and an existing copy with the same name is left alone.
                raise _Gone()
            data.append(chunk)
            remaining -= len(chunk)
        return b"".join(data)

    def log_message(self, fmt, *args):
        """
        Keep the launcher window readable: one tidy line per action (POST) or
        refused request. Pages and readings that loaded fine (every GET, several
        a second) are not listed, so "ready and fully working" stays on screen.
        """
        # A garbled request line (https:// sent to this plain-HTTP port, a
        # port scanner) is logged before self.path exists.
        path = getattr(self, "path", "").split("?")[0]
        command = getattr(self, "command", None) or "?"
        if fmt != '"%s" %s %s' or len(args) < 2:
            console.write(f"  {command} {path}: {fmt % args}\n")
            return
        status = str(args[1])
        quiet = ("/api/live/snapshot", "/api/live/events", "/api/app/ready", "/api/colorcheck/readings")
        if status[:1] not in ("4", "5") and (command in ("GET", "HEAD") or path in quiet):
            return
        # console.write never raises: with no window (sys.stderr missing) a log line
        # once broke every command's reply.
        console.write(f"  {command} {path}" + (f" (answered {status})" if status[:1] in ("4", "5") else "") + "\n")

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

        True when the URL carries ?demo=1. Anything else means no - we do not
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
            return mock_moonraker.default_printer_id()
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

    def _host_allowed(self):
        """
        Refuse requests addressed to a name that isn't this dashboard's.

        Allowed: any local-looking name (host_is_local), anything in
        DEJAVU_ALLOWED_HOSTS, and no Host header at all (not a browser).

        A Cloudflare Tunnel keeps your own domain in the Host header, so its
        name goes in DEJAVU_ALLOWED_HOSTS (docs/remote-access.md). There is
        deliberately no exception for requests that *look* forwarded by
        cloudflared (a Cf-Connecting-Ip header from this machine): a web
        page on this computer can add that header itself, so it would let
        the DNS-rebinding attack this check exists for straight through.
        """
        host = self.headers.get("Host", "")
        if not host or host_is_local(host):
            return True
        self._send_json({"error": f"Refused: this dashboard doesn't answer to \"{_host_name(host)}\". "
                                  "If that is your own address for it, start the server with "
                                  f"DEJAVU_ALLOWED_HOSTS={_host_name(host)}"}, status=421)
        return False

    # -- the device lock (pairing.py) ----------------------------------------

    _OPEN_WHEN_LOCKED = {"/api/pairing/status", "/api/pairing/redeem"}

    def _this_computer(self):
        """A browser on this computer, reached as localhost (not via a tunnel or network address)."""
        ip = (self.client_address or ("",))[0]
        try:
            address = ipaddress.ip_address(ip.split("%")[0])
            # On the dual-stack socket an IPv4 caller shows as ::ffff:a.b.c.d; judge the IPv4 address itself.
            address = getattr(address, "ipv4_mapped", None) or address
            loopback = address.is_loopback
        except ValueError:
            loopback = False
        return loopback and _host_name(self.headers.get("Host", "")).lower() in ("localhost", "127.0.0.1", "::1")

    def _device(self):
        jar = http.cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except http.cookies.CookieError:
            return None
        morsel = jar.get(pairing.COOKIE)
        return pairing.device_for(morsel.value) if morsel else None

    def _locked_out(self):
        """With the device lock on, refuse an unpaired device (with a 401 that says how to pair)."""
        route = urlparse(self.path).path
        if route in self._OPEN_WHEN_LOCKED or not pairing.lock_enabled():
            return False
        if self._this_computer() or self._device():
            return False
        self._send_json({"error": "This dashboard only answers devices that have been paired with it. Enter the "
                                  "pairing code shown on a paired device (Settings, Pair a phone), or open it on the "
                                  "computer it runs on.", "pairing_required": True}, status=401)
        return True

    def _note_page(self):
        """Any request but the launcher's own checks means a page is open (idle_stop.py). Not a security check."""
        if not self.headers.get("User-Agent", "").startswith("Python-urllib"):
            idle_stop.page_seen()

    def do_GET(self):
        if not self._host_allowed():
            return None
        self._note_page()
        if self.path.startswith("/api/") and self._locked_out():
            return None
        if self.path.split("?")[0] == "/api/app/alive":
            # The cheapest possible "is it here?": the launcher, every open page and the offline page ask
            # this all the time, so it does no work that could be slow (no disk scan, no Task Scheduler,
            # nothing that waits for GitHub or a printer).
            return self._send_json({"alive": True, "version": app_updates.version(), "server_pid": os.getpid(),
                                    "launch_id": os.environ.get("DEJAVU_LAUNCH_ID", ""),
                                    "restarting": update_hold.active()})
        if self.path.startswith("/api/live") and websocket.is_upgrade_request(self.headers):
            idle_stop.socket_opened()
            try:
                return self._handle_websocket()
            finally:
                self.close_connection = True        # the socket carried the live feed; it is never used again
                idle_stop.socket_closed()
        if self.path.startswith("/api/"):
            return self._dispatch(self._handle_api_get)
        # Not an API call, so serve a file from the frontend folder.
        if self.path.startswith("/media/") and self.headers.get("Range"):
            return self._send_media_range()
        if static_files.send(self):
            return None
        return super().do_GET()

    def _send_media_range(self):
        """
        Videos under /media/ answer a single "Range: bytes=a-b" request, so the
        launch video on the product page can be scrubbed. Anything else falls
        back to the ordinary whole-file reply.
        """
        path = self.translate_path(self.path)
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        if not match or not os.path.isfile(path) or not path.startswith(os.path.join(_FRONTEND_DIR, "media")):
            return super().do_GET()
        size = os.path.getsize(path)
        first, last = match.groups()
        if first == "":
            start, end = max(0, size - int(last or 0)), size - 1
        else:
            start, end = int(first), min(size - 1, int(last) if last else size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)
        return None

    def do_HEAD(self):
        if not self._host_allowed():
            return None
        return super().do_HEAD()

    def do_POST(self):
        if not self._host_allowed():
            return None
        if not self._same_origin():
            return self._send_json({"error": "Refused: this request came from another website"}, status=403)
        if self._locked_out():
            return None
        self._note_page()
        return self._dispatch(self._handle_api_post)

    def _same_origin(self):
        """
        Browsers label every cross-site POST and WebSocket with an Origin
        header. This dashboard has no login, so without this check any web
        page you happened to visit could send "cancel print" to it. Requests
        without an Origin (curl, scripts, the tests) are not from a browser
        page and are allowed, exactly as before.
        """
        origin = self.headers.get("Origin")
        if not origin:
            return True
        # cloudflared keeps the original Host header by default; if its
        # httpHostHeader option is set it moves it to X-Forwarded-Host.
        allowed = {h.strip().lower() for h in (self.headers.get("Host", ""),
                   self.headers.get("X-Forwarded-Host", "")) if h}
        return urlparse(origin).netloc.lower() in allowed

    def _dispatch(self, handler):
        started = time.perf_counter()
        try:
            return self._dispatch_timed(handler)
        finally:
            tester.note_handler(self.command, self.path, (time.perf_counter() - started) * 1000.0)


    def _note_refusal(self, status, words):
        """Tester mode: a command (a POST) the printer or a safety check turned down. A failed read is only a failed request."""
        if self.command == "POST":
            tester.note_refused(self.path, status, words)

    def _gate(self, connected):
        """True when printer figures may be served (and sent the refusal if not)."""
        if not connected and not self._wants_demo():
            self._send_json({"connected": False, "demo": False})
            return False
        return True


    def _demo_allowed(self, connected):
        if connected or not self._wants_demo():
            self._send_json({"error": "Only available with demo data switched on, and "
                                      "never while a real printer is connected"}, status=403)
            return False
        return True


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

    def _camera_live(self):
        """
        The printer's built-in camera as one continuous picture stream (MJPEG, which
        an <img> shows by itself): Deja Vu1 asks the printer for each new picture as
        soon as the last one arrived, at most LIVE_FPS a second, and sends only
        pictures that changed. Saves the browser a request per picture.
        """
        if not mock_moonraker.is_real(mock_moonraker.selected_printer_id()):
            return self._send_json({"error": "Live pictures come from a real printer. The demo shows single pictures"},
                                   status=409)
        frame, mime = mock_moonraker.camera_snapshot()      # a camera that can't start says why, before any picture
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=dvframe")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True
        last, ends = None, time.monotonic() + LIVE_SECONDS
        while time.monotonic() < ends:
            asked = time.monotonic()
            if frame != last:
                try:
                    self.wfile.write(b"--dvframe\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
                    self.wfile.flush()
                except OSError:
                    return None              # the page closed or turned the camera off
                last = frame
            time.sleep(max(0.0, 1 / LIVE_FPS - (time.monotonic() - asked)))
            try:
                frame, _ = mock_moonraker.camera_snapshot()
            except (ValueError, OSError):
                return None                  # the page falls back to single pictures and shows the reason
        return None

    def _relay_camera(self):
        upstream = camera.open_stream()
        ctype = upstream.headers.get("Content-Type", "")
        if not camera.looks_like_camera(ctype):
            # Only ever relay a camera stream - never turn this into a way
            # to read some other device's web page through the dashboard.
            upstream.close()
            return self._send_json({"error": "That address didn't answer like a camera stream "
                                             f"(it sent {ctype or 'no content type'})"}, status=502)
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


SLICE_GRACE = 90               # seconds a running slice may finish before an update restarts anyway


def _let_slices_finish(step):
    """
    A slice running when an update installs is Deja Vu1's own work, not the printer's, and a restart
    would end it. It gets SLICE_GRACE seconds to finish; after that it is stopped cleanly (the engine
    is ended, nothing half-written is queued) and the update goes ahead. Returns how many were stopped.
    """
    try:
        if not slicer_bridge.any_active():
            return 0
        step("slices")
        deadline = time.monotonic() + SLICE_GRACE
        while slicer_bridge.any_active() and time.monotonic() < deadline:
            time.sleep(0.5)
        stopped = slicer_bridge.cancel_all("Stopped for an update. Slice it again")
        deadline = time.monotonic() + 10
        while stopped and slicer_bridge.any_active() and time.monotonic() < deadline:
            time.sleep(0.25)
        return stopped
    except Exception:
        # 0.8.0 crashed here, so its Install button never worked. A broken slicing check must
        # never lock a copy out of the update that fixes it.
        traceback.print_exc()
        return 0


def _install_update(server, repair=False, background=False):
    """
    Stage an update, then restart into it. Nothing about the printers decides whether it may
    install: a print runs on the printer by itself, so an update never waits for one, and a
    printer that isn't answering has nothing to do with the files on this computer.
    Every refusal that can be known at once comes back at once, in words. With
    background=True (the Install and Repair buttons) the download runs on its own
    thread and app_updates.job() reports each step, so a reload finds it.
    """
    if os.environ.get("DEJAVU_LAUNCHER") != "1":
        raise ValueError("This copy was started without the double-click launcher, so it can't restart into an "
                         "update. Close its window and start Deja Vu1 with the launcher, or paste the update block")
    if app_updates.job_running():
        raise ValueError("An update is already being installed. This page shows its progress")
    app_updates.set_job("working", "checking", repair=repair)
    if not background:
        return _run_install(server, repair, raise_errors=True)
    threading.Thread(target=_run_install, args=(server, repair), name="update-install", daemon=True).start()
    return {"started": True, "job": app_updates.job()}


def _run_install(server, repair, raise_errors=False):
    def step(name, **extra):
        app_updates.set_job("working", name, repair=repair, **extra)
    try:
        step("safety")
        try:
            memory.snapshot("before-update")
        except Exception:
            pass                   # a safety copy that can't be written never blocks the update itself
        result = app_updates.prepare(repair=repair, step=step)
    except Exception as exc:
        words = app_updates._words(exc)
        print(f"  The update could not be installed: {words}", flush=True)
        if not isinstance(exc, ValueError):
            traceback.print_exc()
        app_updates.set_job("failed", "failed", words, repair=repair)
        tester.record("update", **{"from": app_updates.version(), "to": None, "ok": False, "words": words})
        if raise_errors:
            raise
        return None
    stopped = _let_slices_finish(step)
    app_updates.set_job("restarting", "restarting", repair=repair, version=result.get("version"),
                        slices_stopped=stopped)
    print(f"  Update {result.get('version', '')} is ready. Restarting into it now.", flush=True)
    # A moment longer than before, so the page that pressed Install hears "restarting" first.
    _restart_soon(server, wait=1.5, reason="update")
    return result


def _listen():
    """IPv6 and IPv4 on one socket where the system allows it (DualStackServer), IPv4 alone where it doesn't."""
    if socket.has_ipv6 and os.environ.get("DEJAVU_IPV4_ONLY") != "1":
        try:
            return DualStackServer(("::", PORT), DejaVuHandler)
        except OSError as exc:
            if exc.errno in (errno.EADDRINUSE, 10048) or getattr(exc, "winerror", None) == 10048:
                raise
    return DejaVuServer(("0.0.0.0", PORT), DejaVuHandler)


def _bind(attempts=10, wait=0.5):
    """
    The server on PORT. A port still held by a copy that is closing frees
    itself within a few seconds, so it is asked again; a port another program
    keeps is said in words with what to do, never as a traceback.
    """
    for attempt in range(attempts):
        try:
            return _listen()
        except OSError as exc:
            in_use = exc.errno in (errno.EADDRINUSE, 10048) or getattr(exc, "winerror", None) == 10048
            if not in_use:
                raise
            if attempt + 1 < attempts:
                time.sleep(wait)
    print("=" * 58)
    print(f"  Deja Vu1 couldn't start: port {PORT} is already in use by another program.")
    print("  Close that program (or another Deja Vu1 window) and start Deja Vu1 again,")
    print("  or start it on a different port, for example 8001:")
    print("    Windows (PowerShell):  $env:PORT=8001; py -3 start.py")
    print("    Mac or Linux:          PORT=8001 python3 start.py")
    print("  Then open http://localhost:8001")
    print("=" * 58, flush=True)
    sys.exit(PORT_IN_USE)


def main():
    # Before anything prints: a start without a window gets a log file for its
    # messages, and no message ever waits on a paused window.
    console.ensure_streams(storage.DATA_DIR, "server")
    console.buffered()
    console.disable_quick_edit()
    server = _bind()
    live_feed.start()
    modules.apply_environment()
    tester.install_hooks()
    tester.note_update_result(readiness.last_update())
    # A saved printer that stops answering is looked for at a new address by its serial number.
    threading.Thread(target=refind.watch, kwargs={"publish": live_feed.publish_event}, daemon=True,
                     name="refind").start()
    threading.Thread(target=app_updates.watch, args=(lambda: _install_update(server),), daemon=True).start()
    threading.Thread(target=memory.watch, daemon=True).start()
    # AI keys saved before this computer's keyring was used move into it; a keyring can take a moment.
    threading.Thread(target=ai_providers.protect_saved_keys, name="ai-keys", daemon=True).start()
    threading.Thread(target=ai_assistant.watch_loop, name="ai-watch", daemon=True).start()
    # Windows' Task Scheduler answers in a second or more; ask it now, so no page ever waits for it.
    # A copy the launcher started stops by itself once no page has been open for a while and nothing is under way.
    threading.Thread(target=idle_stop.watch, args=(server.shutdown,), name="idle-stop", daemon=True).start()
    print("=" * 58)
    print("  Deja Vu1 dashboard")
    print(f"  Open your browser at:  http://localhost:{PORT}")
    lan = discovery.home_address()
    if lan:
        print(f"  From a phone on the same Wi-Fi:  http://{lan}:{PORT}")
        _print_phone_qr(f"http://{lan}:{PORT}/")
    real = fleet.registered()
    if real and modules.is_enabled("printer_link"):
        print(f"  Connecting to {len(real)} printer(s) added by address;")
        print("  connection problems are printed here in words.")
    else:
        print("  No printer added yet: demo data is available, and a real")
        print("  printer can be added by address under Fleet > Add printer.")
    print("  Live updates every 250 ms over /api/live (WebSocket).")
    print("  Press Ctrl+C to stop.")
    print("=" * 58)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        # Let go of the port first. Left open while the rest closes, it accepted
        # browsers' connections without answering them, so a reload hung.
        server.server_close()
        cleanup = threading.Thread(target=_close_down, name="close-down", daemon=True)
        cleanup.start()
        cleanup.join(timeout=4)    # a camera or printer that won't let go never holds up a restart
    if getattr(server, "update_restart", False):
        sys.exit(75)


# The POST routes (app_post.py) call these two; they live here because they read settings that tests and the
# launcher change on app itself.
app_post._install_update = _install_update
app_post.phone_link = phone_link

if __name__ == "__main__":
    main()
