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
  POST /api/printers/discover         find Moonraker on the home network (mDNS, then port 7125)
  POST /api/printers/test             try a Moonraker address before adding it {"moonraker_url", "api_key"}
  POST /api/printers/login            read a printer's API key with its web-page login {"moonraker_url", "username", "password"}
  POST /api/camera/find               find and save the selected printer's camera feed
  GET  /api/remote                    Tailscale on this computer: connected? shared address?
  POST /api/remote/share|stop         share the dashboard privately with Tailscale Serve, or stop (this computer only)
  POST /api/remote/link               a pairing QR code for the shared address
  POST /api/tools/layer-plan         mixed-nozzle layer plan {"heads": [{toolhead, nozzle, height}], "exact", "part_height"}
  POST /api/maintenance/swap         record a nozzle/hotend swap {"kind", "toolhead"}

  GET  /api/leds                     simulated LED ring states
  GET  /api/colorcheck               simulated filament color check
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
  GET  /api/print/preview            the running print's visible walls per toolhead (3D twin)
  GET  /api/insights                 findings from the printer's own print history
  GET  /api/app/memory               safety copies of the dashboard's records; repairs made
  POST /api/app/memory/snapshot      make a safety copy now
  POST /api/app/selfcheck            "Check it yourself": real checks run in this copy
  POST /api/app/memory/restore       {"id", "file"?} write a safety copy back, then restart
  GET  /api/import/orca              presets and recent projects found in Orca on this computer
  POST /api/import/orca/projects     {"ids"} copy recent projects into Files
  POST /api/import/orca/profile      {"name", "machine", "process", "filaments"} a profile from your presets
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
  POST /api/slicer/slice             {"name", "profile", "queue": bool} - starts a job
  GET  /api/slicer/jobs              every recent job: running, done, queued or failed (in words)

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
  POST /api/filament/spoolman        {"url"} import spools from Spoolman (updates ones imported before)
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
import comparison
import colour_map
import converter_3mf
import cost_calculator
import discovery
import file_library
import filament_inventory
import spoolman_bridge
import fleet
import handoff
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
import remote
import websocket
import wled_bridge

# The dashboard's HTML/CSS/JS lives here.
_FRONTEND_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "frontend")

PORT = int(os.environ.get("PORT", 8000))
MAX_UPLOAD = file_library.MAX_BYTES

# Names this dashboard answers to, beyond the ones that are obviously on
# your own network (see _host_allowed). Set this if you reach it through
# your own domain, e.g. DEJAVU_ALLOWED_HOSTS=printer.example.com
EXTRA_HOSTS = {h.strip().lower() for h in os.environ.get("DEJAVU_ALLOWED_HOSTS", "").split(",")
               if h.strip()}
_LOCAL_SUFFIXES = (".local", ".lan", ".home", ".internal", ".home.arpa",
                   ".localdomain", ".ts.net")


def _host_name(host):
    """'printer.local:8000' -> 'printer.local'; '[::1]:8000' -> '::1'."""
    host = (host or "").strip().lower().rstrip(".")
    if host.startswith("["):
        return host[1:host.find("]")] if "]" in host else ""
    if host.count(":") == 1:
        return host.split(":")[0]
    return host


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


def _chamber():
    state = mock_moonraker.get_printer_state()
    reading = state.get("chamber_temperature")
    return {"reported": reading is not None, "current": reading,
            "bed": state.get("bed_temperature"),
            "history": live_feed.climate(mock_moonraker.selected_printer_id())}


def _demo(query):
    return query.get("demo", ["0"])[0] in ("1", "true", "yes")


def _fleet_rows(include_demo):
    """The fleet overview: real printers always, simulated ones only with demo data on."""
    snap = live_feed.fleet_snapshot()
    return {**snap, "printers": [p for p in snap["printers"] if include_demo or not p.get("demo", True)]}


# Routes about the whole farm rather than one printer: they have figures to
# show whenever any real printer is connected (or demo data is on), even if
# the printer a request defaults to is the one that's down.
_FARM_ROUTES = {"/api/fleet", "/api/fleet/history", "/api/fleet/queues"}


def _live_snapshot():
    entry = live_feed.snapshot(mock_moonraker.selected_printer_id())
    return {"seq": entry["seq"], "t": entry["t"], "state": entry["state"],
            "event_id": live_feed.last_event_id(),
            "time_scale": mock_moonraker.get_time_scale()}


# Routes that return printer figures, gated by connection/demo, each mapped
# to the module that owns them (checked before connection) and the function
# that produces the data. Each gets the parsed query string.
_DATA_ROUTES = {
    "/api/tools/compatibility": ("printer_control", lambda q: tool_setup.compatibility()),
    "/api/maintenance": ("maintenance", lambda q: maintenance.get_status()),
    "/api/maintenance/history": ("maintenance", lambda q: {"history": maintenance.get_history()}),
    "/api/leds": ("led_status", lambda q: led_status.get_all_ring_states()),
    "/api/colorcheck": ("color_check", lambda q: color_check.check_current_job()),
    "/api/printer": (None, lambda q: mock_moonraker.get_printer_state()),
    "/api/printer/job": (None, lambda q: dict(mock_moonraker.get_current_job() or {})),
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
    "/api/cost/history": ("cost_calculator", lambda q: {"jobs": cost_calculator.cost_history()}),
    "/api/cost/current": ("cost_calculator", lambda q: cost_calculator.current_job()),
    "/api/live/snapshot": (None, lambda q: _live_snapshot()),
    "/api/live/events": (None, lambda q: {"events": live_feed.events_since(int(_q(q, "since", "0")))}),
    "/api/fleet": ("fleet", lambda q: _fleet_rows(_demo(q))),
    "/api/fleet/history": ("fleet_command", lambda q: fleet.history(_q(q, "days", "30"), _q(q, "bucket", "day"),
                                                                    include_demo=_demo(q))),
    "/api/fleet/queues": ("fleet_command", lambda q: fleet.queues(_demo(q)) if modules.is_enabled("print_queue")
                          else {"queues": {}, "queue_disabled": True}),
    "/api/chamber": ("chamber_climate", lambda q: _chamber()),
    "/api/health": (None, lambda q: print_gate.printer_health()),
    "/api/print/confirm": (None, lambda q: print_gate.summary(_q(q, "file"))),
    "/api/print/preview": (None, lambda q: print_preview.for_current()),
    "/api/insights": (None, lambda q: insights.current()),
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
    "/api/maker/settings": ("photo_studio", lambda q: model_maker.settings(_q(q,"height",".2"),_q(q,"profile"))),
    "/api/slicer/catalog": ("auto_print", lambda q: slicer_bridge.installed_catalog()),
    "/api/slicer/schema": ("auto_print", lambda q: process_settings.schema()),
    "/api/logbook": ("maintenance", lambda q: logbook.entries(None, demo=not mock_moonraker.is_connected(), query=q.get("q", [None])[0])),
    "/api/tools/assignments": ("filament_inventory", lambda q: tool_setup.get()),
    "/api/remote": (None, lambda q: remote.status(PORT)),
    "/api/app/info": (None, lambda q: {**app_updates.status(), "server_pid": os.getpid(), "phone_address": discovery.home_address(), "port": PORT, "desktop": desktop.settings(), "autostart": autostart.status(),
                                       "launch_id": os.environ.get("DEJAVU_LAUNCH_ID", ""), "update_job": app_updates.job(),
                                       "last_update": readiness.last_update(), "launcher_version": readiness.launcher_version()}),
    "/api/app/memory": (None, lambda q: memory.status()),
    "/api/import/orca": ("file_library", lambda q: orca_import.public()),
    # The camera's frozen-stream watchdog is about the camera relay, not
    # printer figures: it stays readable while a printer's link is down,
    # like the stream itself, which is when a frozen picture matters most.
    "/api/camera": ("camera", lambda q: camera.get_status()),
    "/api/filament": ("filament_inventory", lambda q: {
        "spools": filament_inventory.get_inventory(),
        "idle_spools": filament_inventory.idle_spools(),
        "spoolman": spoolman_bridge.get_settings(),
    }),
    "/api/notifications/settings": ("notifications", lambda q: notifications.public_settings()),
    "/api/notifications/queue": ("notifications", lambda q: {"queue": notifications.get_queue()}),
    "/api/cost/settings": ("cost_calculator", lambda q: cost_calculator.get_settings()),
    "/api/wled/settings": ("wled_bridge", lambda q: wled_bridge.get_settings()),
    "/api/homeassistant/settings": ("home_assistant_bridge", lambda q: home_assistant_bridge.public_settings()),
    "/api/files": ("file_library", lambda q: file_library.list_files()),
    "/api/files/lines": ("file_library", lambda q: file_library.gcode_tools.view_lines(
        file_library.read_text(_q(q, "name")), _q(q, "offset", "0"), _q(q, "limit", "200"),
        _q(q, "q", "") or None)),
    "/api/files/analysis": ("file_library", lambda q: file_library.analysis(_q(q, "name"))),
    "/api/files/plates": ("file_library", lambda q: project_plates.describe(_q(q, 'name'))),
    "/api/colours/plan": ("converter", lambda q: _colour_plan(_q(q, "name"), _q(q, "demo", "") == "1")),
    "/api/profiles/diff": ("file_library", lambda q: comparison.diff_profiles(_q(q, "a"), _q(q, "b"))),
    "/api/fleet/registry": ("fleet", lambda q: fleet.registry()),
    "/api/printers/diagnostics": ("fleet", lambda q: fleet.diagnostics(_q(q, "printer"))),
    "/api/automations": ("automations", lambda q: {"rules": automations.list_rules()}),
    "/api/automations/log": ("automations", lambda q: {"log": automations.get_log()}),
    "/api/camera/settings": ("camera", lambda q: camera.get_settings()),
    "/api/camera/webrtc/settings": ("webrtc_camera", lambda q: webrtc_camera.public_settings()),
    "/api/handoff": ("handoff", lambda q: handoff.offer_for(_q(q, "device", ""))),
    "/api/studio/palette": ("photo_studio", lambda q: photo_studio.palette()),
    "/api/slicer/settings": ("auto_print", lambda q: slicer_bridge.public_settings()),
    "/api/slicer/jobs": ("auto_print", lambda q: slicer_bridge.jobs()),
}

def _loaded_heads(demo=False):
    """What each head of the selected printer holds now, for matching a project's colours; None if unknown."""
    if not (mock_moonraker.is_connected() or demo):
        return None
    heads = (mock_moonraker.get_printer_state() or {}).get("toolheads") or {}
    out = []
    for i in range(colour_map.HEADS):
        h = heads.get(f"T{i}") or {}
        known = h.get("filament_known", True) and h.get("filament_loaded") is not False
        out.append({"toolhead": f"T{i}", "colour": colour_map.clean_hex(h.get("filament_color_hex")) if known else None,
                    "type": (h.get("filament_material") or "") if known else ""})
    return out if any(h["colour"] for h in out) else None


def _colour_plan(name, demo=False):
    """A project's filaments, which the model uses, and the suggested heads (GET /api/colours/plan)."""
    info = colour_map.read(file_library.read_bytes(name))
    loaded = _loaded_heads(demo)
    info["suggested"] = colour_map.suggest(info["filaments"])
    info["matched"] = colour_map.suggest(info["filaments"], loaded) if loaded else None
    info["loaded"] = loaded
    info["heads"] = colour_map.HEADS
    return info


def module_routes():
    """
    Which module owns each GET route, for the dashboard.

    Knowing this, the browser doesn't ask a switched-off module for data it
    would only refuse (a 403 that every browser logs as a console error);
    it shows the module's "off" state straight away instead. Built from the
    same tables the gate itself reads, so the two can't disagree.
    """
    routes = {path: owner for path, (owner, _) in {**_DATA_ROUTES, **_APP_ROUTES}.items() if owner}
    routes["/api/sandbox"] = "sandbox"
    routes["/api/timelapse/frame"] = "timelapse"
    routes["/api/camera/snapshot"] = "camera"
    routes["/api/camera/stream"] = "camera"
    return routes


# POST actions on printer-figure-gated routes. Each changes the printer, so
# each is followed straight away by a fresh read of the printer's state.
_CONTROL_ACTIONS = {
    "/api/printer/control/filament": lambda b: mock_moonraker.set_filament(b),
    "/api/printer/control/start": lambda body: printer_control.start_print(
        body.get("filename"), confirmed=bool(body.get("confirmed"))),
    "/api/printer/control/pause": lambda body: printer_control.pause_print(),
    "/api/printer/control/resume": lambda body: printer_control.resume_print(),
    "/api/printer/control/cancel": lambda body: printer_control.cancel_print(),
    "/api/printer/control/exclude": lambda body: printer_control.exclude_object(body.get("name")),
    "/api/printer/control/temperature": lambda body: printer_control.set_temperature(
        body.get("toolhead"), body.get("target")),
    "/api/printer/control/home": lambda body: printer_control.home(body.get("axes")),
    "/api/printer/control/gcode": lambda body: printer_control.send_gcode(body.get("command")),
    "/api/printer/control/restart": lambda body: printer_control.clear_error(),
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

    def end_headers(self):
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
        if keyword.lower() == "cache-control":
            self._cache_rule_sent = True
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
        if content_type.startswith("image/svg"):
            # Frames are drawn by this server; still, never let an SVG run script.
            self.send_header("Content-Security-Policy", "script-src 'none'")
        self.end_headers()
        self.wfile.write(data)

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
            sys.stderr.write(f"  {command} {path}: {fmt % args}\n")
            return
        status = str(args[1])
        quiet = ("/api/live/snapshot", "/api/live/events", "/api/app/ready")
        if status[:1] not in ("4", "5") and (command in ("GET", "HEAD") or path in quiet):
            return
        sys.stderr.write(f"  {command} {path}" + (f" (answered {status})" if status[:1] in ("4", "5") else "") + "\n")

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
            loopback = ipaddress.ip_address(ip.split("%")[0]).is_loopback
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

    def do_GET(self):
        if not self._host_allowed():
            return None
        if self.path.startswith("/api/") and self._locked_out():
            return None
        if self.path.startswith("/api/live") and websocket.is_upgrade_request(self.headers):
            return self._handle_websocket()
        if self.path.startswith("/api/"):
            return self._dispatch(self._handle_api_get)
        # Not an API call, so serve a file from the frontend folder.
        if self.path.startswith("/media/") and self.headers.get("Range"):
            return self._send_media_range()
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
            return self._send_json({"error": str(exc), "blocked": True, "gate": exc.gate}, status=409)
        except mock_moonraker.PrinterCommandError as exc:
            # The printer side failed. Say so plainly - never a success.
            return self._send_json({"error": f"The printer reported a failure: {exc}",
                                    "printer_failed": True}, status=502)
        except ValueError as exc:
            return self._send_json({"error": str(exc)}, status=400)
        except (ConnectionError, BrokenPipeError):
            return None                               # the browser left
        except Exception:                             # noqa: BLE001
            # Never let a crash take the whole server down mid-demo. The
            # details go to the terminal, not to whoever sent the request.
            traceback.print_exc()
            return self._send_json({"error": "Something went wrong on the dashboard server. "
                                             "The details are in its terminal window."}, status=500)

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

        if route == "/api/camera/snapshot":
            if self._module_blocked("camera"):
                return None
            if force_disconnected or (not connected and not _demo(query)):
                return self._send_json({"connected": False, "demo": False})
            data, mime = mock_moonraker.camera_snapshot()
            return self._send_bytes(data, mime)

        if route == "/api/camera/stream":
            if self._module_blocked("camera"):
                return None
            return self._relay_camera()

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
            if force_disconnected and route not in _FARM_ROUTES:
                return self._send_json({"connected": False, "demo": False})
            if route in _FARM_ROUTES:
                connected = mock_moonraker.any_connected()
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

        if route in ('/api/backup/preview','/api/backup/restore','/api/backup/discard'):
            if self._module_blocked('backup'):
                return None
            if route.endswith('/preview'):
                return self._send_json(backup.preview_restore(self._read_raw_body(backup.MAX_ARCHIVE_BYTES)))
            if route.endswith('/discard'):
                return self._send_json(backup.discard_preview(self._read_json_body()))
            return self._send_json(backup.restore(self._read_json_body()))

        if route == "/api/app/desktop":
            return self._send_json(desktop.save_settings(self._read_json_body()))
        if route == "/api/app/autostart":
            # It writes into this computer's sign-in items, so only a browser on this computer may.
            body = self._read_json_body()
            if not self._this_computer():
                return self._send_json({"error": "Change this on the computer that runs Deja Vu1"}, status=403)
            return self._send_json(autostart.set_on(bool(body.get("on"))))
        if route == "/api/app/updates/settings":
            return self._send_json(app_updates.save_settings(self._read_json_body()))
        if route == "/api/app/updates/check":
            self._read_json_body()
            return self._send_json(app_updates.check())
        if route == "/api/app/updates/install":
            self._read_json_body()
            return self._send_json(_install_update(self.server, background=True))
        if route == "/api/app/repair":
            # The newest published files over this copy, even at the same version.
            self._read_json_body()
            return self._send_json(_install_update(self.server, repair=True, background=True))
        if route == "/api/app/ready":
            # "Is it really working?" in words: the launcher window, Settings and start.py --check show it.
            self._read_json_body()
            return self._send_json(readiness.report(PORT))
        if route == "/api/app/restart":
            self._read_json_body()
            if os.environ.get("DEJAVU_LAUNCHER") != "1":
                raise ValueError("This copy was started without the double-click launcher, so it can't restart itself. "
                                 "Close its window and start it again")
            _restart_soon(self.server)
            return self._send_json({"restarting": True, "version": app_updates.version()})
        if route == "/api/app/stop":
            # Only from the computer it runs on: a phone could stop it but never start it again.
            self._read_json_body()
            if not self._this_computer():
                return self._send_json({"error": "Stop Deja Vu1 from the computer it runs on. "
                                                 "A phone can't start it again"}, status=403)
            threading.Timer(0.5, self.server.shutdown).start()
            return self._send_json({"stopping": True})
        if route == "/api/app/selfcheck":
            self._read_json_body()
            return self._send_json(selfcheck.run())
        if route == "/api/app/memory/snapshot":
            self._read_json_body()
            return self._send_json(memory.snapshot("manual"))
        if route == "/api/app/memory/restore":
            body = self._read_json_body()
            result = memory.restore(body.get("id"), body.get("file"))
            # Every module re-reads the restored records after a restart.
            if os.environ.get("DEJAVU_LAUNCHER") == "1":
                result["restarting"] = True
                _restart_soon(self.server)
            else:
                result["restart_needed"] = True
            return self._send_json(result)
        if route == "/api/import/orca/projects":
            if self._module_blocked("file_library"):
                return None
            return self._send_json(orca_import.import_projects(self._read_json_body().get("ids")))
        if route == "/api/import/orca/profile":
            if self._module_blocked("auto_print"):
                return None
            return self._send_json(orca_import.import_profile(self._read_json_body()))
        if route == "/api/app/updates/git":
            # A development copy: git pull --ff-only, then a restart through
            # the launcher if there is one (otherwise the person restarts it).
            self._read_json_body()
            _require_idle_for_update()
            result = app_updates.git_update()
            if result["updated"] and os.environ.get("DEJAVU_LAUNCHER") == "1":
                result["restarting"] = True
                _restart_soon(self.server)
            return self._send_json(result)

        if route == "/api/tools/layer-plan":
            # A calculator: no printer needed, nothing stored.
            body = self._read_json_body()
            return self._send_json(layer_planner.plan(body.get("heads") or [], bool(body.get("exact")),
                                                      body.get("part_height")))

        if route == "/api/tools/assignments":
            if self._module_blocked("filament_inventory"):
                return None
            return self._send_json(tool_setup.save(self._read_json_body()))

        if route == '/api/files/plates/extract':
            if self._module_blocked('file_library'):
                return None
            return self._send_json(project_plates.save(self._read_json_body()))

        if route == "/api/files/plate":
            if self._module_blocked("file_library"):
                return None
            return self._send_json(plate_project.save(self._read_json_body()))

        if route in ("/api/maker/build", "/api/maker/calibration"):
            if self._module_blocked("photo_studio") or self._module_blocked("file_library"):
                return None
            body=self._read_json_body()
            return self._send_json(model_maker.build(body) if route.endswith("/build") else model_maker.save_calibration(body))

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
            if module_id == "printer_link":
                fleet.sync_real_printers()
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

        if route in ("/api/fleet/broadcast", "/api/fleet/route"):
            is_broadcast = route == "/api/fleet/broadcast"
            if self._module_blocked("fleet_command") or \
                    self._module_blocked("printer_control" if is_broadcast else "print_queue"):
                return None
            connected = connected or mock_moonraker.any_connected()
            demo = self._wants_demo()
            if not connected and not demo:
                return self._send_json({"connected": False, "demo": False}, status=409)
            body = self._read_json_body()
            if is_broadcast:
                result = fleet.broadcast(body.get("action"), body.get("printers"), body.get("params"),
                                         include_demo=demo)
                # Push each printer's read-back to every open dashboard now.
                for row in result["results"]:
                    if mock_moonraker.has_printer(row["printer"]):
                        live_feed.refresh(row["printer"])
            else:
                result = fleet.route_file(body.get("filename"), body.get("to"),
                                          body.get("from_printer"), body.get("item_id"), include_demo=demo)
            return self._send_json(self._tag(result, connected))

        if route.startswith("/api/sandbox/"):
            if self._module_blocked("sandbox") or not self._demo_allowed(connected):
                return None
            body = self._read_json_body()
            verb = route[len("/api/sandbox/"):]
            actions = {
                "farm": lambda: sandbox.build_farm(body.get("count", 6), body.get("busy_fraction", 0.5),
                                                   body.get("seed")),
                "teardown": sandbox.teardown,
                "scenario": lambda: sandbox.load_scenario(body.get("steps"), body.get("preset"), body.get("seed")),
                "run": lambda: sandbox.set_running(body.get("running", True)),
                "speed": lambda: sandbox.set_speed(body.get("speed", 1)),
                "step": lambda: sandbox.step(body.get("seconds", 60)),
                "fire": lambda: {"outcomes": sandbox.fire(body.get("event"), body.get("printer") or "random",
                                                          body.get("params")), **sandbox.status()},
                "reset": sandbox.reset,
            }
            if verb not in actions:
                return self._send_json({"error": "Unknown endpoint"}, status=404)
            return self._send_json(actions[verb]())

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
                sandbox.reset()                 # its printers' queues and logs go with them
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

        if route == "/api/studio/save":
            if self._module_blocked("photo_studio") or self._module_blocked("file_library"):
                return None
            name = _q(query, "name")
            file_library.clean_name(name)          # refuse bad names before reading the body
            return self._send_json(photo_studio.save(name, self._read_raw_body(), query.get("note", [""])[0]))

        if route.startswith("/api/slicer/"):
            if self._module_blocked("auto_print"):
                return None
            body = self._read_json_body()
            verb = route[len("/api/slicer/"):]
            if verb == "settings":
                return self._send_json(slicer_bridge.save_settings(body))
            if verb == "check":
                return self._send_json(slicer_bridge.check())
            if verb == "find":
                return self._send_json(slicer_bridge.find_slicers())
            if verb == "profiles":
                return self._send_json(slicer_bridge.add_profile(body.get("name"), body.get("machine"),
                                                                 body.get("process"), body.get("filaments")))
            if verb == "profiles/from-installed":
                return self._send_json(slicer_bridge.add_installed_profile(body))
            if verb.startswith('jobs/') and verb.endswith('/cancel'):
                return self._send_json(slicer_bridge.cancel_job(verb.split('/')[1]))
            if verb.startswith("profiles/") and verb.endswith("/remove"):
                return self._send_json(slicer_bridge.remove_profile(verb.split("/")[1]))
            if verb == "slice":
                queue_to = None
                if body.get("queue"):
                    # Queueing is a printer action: the same rules as /api/queue/add.
                    if self._module_blocked("print_queue"):
                        return None
                    if force_disconnected or (not connected and not self._wants_demo()):
                        return self._send_json({"error": "No printer connected to queue it on - slice without "
                                                         "queueing, or turn on demo data", "connected": False,
                                                "demo": False}, status=409)
                    queue_to = printer_id
                job = slicer_bridge.start_job(body.get("name"), body.get("profile"), queue_to,
                                              on_done=lambda j: live_feed.publish_event({
                                                  "type": "slicer", "job": {k: j.get(k) for k in (
                                                      "id", "model", "status", "step", "error", "queued")}}))
                return self._send_json(job)
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/convert":
            if self._module_blocked("converter"):
                return None
            body = self._read_json_body()
            name = body.get("name")
            try:
                data, report = converter_3mf.convert(file_library.read_bytes(name), body.get("plan"))
            except converter_3mf.ConversionError as exc:
                return self._send_json(exc.as_dict(), status=400)
            new_name = converter_3mf.converted_name(file_library.clean_name(name))
            entry = file_library.save(new_name, data, origin="converted",
                                      note=f"Converted from {name} ({report['source_label']})")
            return self._send_json({"file": entry, "report": report})

        if route == "/api/colours/apply":
            if self._module_blocked("converter") or self._module_blocked("file_library"):
                return None
            body = self._read_json_body()
            name = body.get("name")
            data, report = colour_map.apply(file_library.read_bytes(name), body.get("plan"))
            entry = file_library.save(colour_map.mapped_name(file_library.clean_name(name)), data, origin="colours",
                                      note=f"{name} with its colours on the U1's heads ({report['summary']})")
            return self._send_json({"file": entry, "report": report})

        if route.startswith("/api/logbook"):
            if self._module_blocked("maintenance"):
                return None
            body = self._read_json_body()
            demo = not mock_moonraker.is_connected()
            if route == "/api/logbook/add":
                return self._send_json(logbook.add(body.get("problem"), body.get("fix") or "", body.get("tags"), demo=demo))
            parts = route.split("/")
            if len(parts) == 5 and parts[4] == "fix":
                return self._send_json(logbook.update(parts[3], fix=body.get("fix") or ""))
            if len(parts) == 5 and parts[4] == "delete":
                return self._send_json(logbook.delete(parts[3]))
            return self._send_json({"error": "Unknown logbook action"}, status=404)

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
                    target = printer_id if mock_moonraker.has_printer(printer_id) else mock_moonraker.default_printer_id()
                    return self._send_json(automations.test_fire(rule_id, target))
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/printers/discover":
            # Looks for Moonraker on this computer's own home network only.
            if self._module_blocked("fleet"):
                return None
            self._read_json_body()
            urls = [p["moonraker_url"] for p in fleet.registered()]
            return self._send_json(discovery.discover(urls))

        if route == "/api/printers/test":
            # Tries an address before it is added; nothing is saved.
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            url = fleet.normalise_url(body.get("moonraker_url"))
            fleet.check_url(url)
            key = str(body.get("api_key") or "").strip() or None
            result = discovery.probe(url, key)
            # "http://192.168.1.50" is the printer's web page; when nothing
            # there speaks Moonraker, try Moonraker's own port before saying no.
            other = fleet.moonraker_port_variant(url)
            if other and not result["ok"] and not result["needs_key"]:
                second = discovery.probe(other, key)
                if second["ok"] or second["needs_key"]:
                    result, url = second, other
            return self._send_json({**result, "url": url})

        if route == "/api/printers/login":
            # Signs in once with the printer's own username and password and
            # hands back its API key. Neither the password nor the key is saved here.
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            url = fleet.normalise_url(body.get("moonraker_url"))
            fleet.check_url(url)
            key = discovery.key_from_login(url, body.get("username"), body.get("password"))
            return self._send_json({"url": url, "api_key": key})

        if route == "/api/fleet/registry":
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            return self._send_json(fleet.add(body.get("name"), body.get("moonraker_url"), body.get("api_key")))

        if route.startswith("/api/fleet/registry/") and route.endswith("/remove"):
            if self._module_blocked("fleet"):
                return None
            return self._send_json({"printers": fleet.remove(route.split("/")[4])})

        if route == "/api/camera/settings":
            if self._module_blocked("camera"):
                return None
            return self._send_json(camera.save_settings(self._read_json_body()))

        if route == "/api/camera/find":
            # Reads the selected printer's camera list and saves the first
            # feed that really answers with a picture.
            if self._module_blocked("camera"):
                return None
            self._read_json_body()
            printer = mock_moonraker.real_printer(mock_moonraker.selected_printer_id())
            if printer is None:
                raise ValueError("Choose a connected printer first. Demo printers have no camera")
            found = camera.find_printer_stream(printer)
            camera.save_settings({"stream_url": found["stream_url"]})
            return self._send_json(found)

        if route == "/api/camera/webrtc/settings":
            if self._module_blocked("webrtc_camera"):
                return None
            return self._send_json(webrtc_camera.save_settings(self._read_json_body()))

        if route == "/api/camera/webrtc/offer":
            if self._module_blocked("webrtc_camera"):
                return None
            return self._send_json(webrtc_camera.exchange(self._read_json_body()))

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

        if route == "/api/filament/spoolman":
            if self._module_blocked("filament_inventory"):
                return None
            body = self._read_json_body()
            return self._send_json(spoolman_bridge.import_spools(body.get("url")))

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
            return self._send_json(notifications.public_settings(notifications.save_settings(body)))

        if route == "/api/notifications/test":
            if self._module_blocked("notifications"):
                return None
            body = self._read_json_body()
            message = str(body.get("message") or "Test notification from Deja Vu1")[:500]
            return self._send_json(notifications.notify(message, priority="high"))

        if route == "/api/pairing/code":
            return self._send_json(pairing.generate_code())

        if route == "/api/pairing/link":
            return self._send_json(phone_link(self._read_json_body().get("base")))

        if route in ("/api/remote/share", "/api/remote/stop", "/api/remote/link"):
            body = self._read_json_body()
            if route == "/api/remote/link":
                # A code to scan at home: the phone then opens the private address anywhere.
                shared = remote.status(PORT)["shared_url"]
                if not shared:
                    raise ValueError("Turn on Away from home first, on the computer running Deja Vu1")
                return self._send_json(phone_link(shared))
            # Sharing changes this computer's Tailscale settings, so only this
            # computer may switch it (not a phone, not through the share itself).
            if not self._this_computer():
                return self._send_json({"error": "Switch Away from home on or off on the computer running "
                                                 "Deja Vu1, at http://localhost:%d" % PORT}, status=403)
            return self._send_json(remote.share(PORT) if route == "/api/remote/share" else remote.stop(PORT))

        if route == "/api/pairing/redeem":
            body = self._read_json_body()
            known = self._device()
            device = pairing.redeem_code(body.get("code"), body.get("device_name"),
                                         replaces=known.get("id") if known else None)
            # The device's key goes into a cookie the page's scripts can't read.
            cookie = (f"{pairing.COOKIE}={device.pop('token')}; Path=/; Max-Age={pairing.COOKIE_DAYS * 86400}; "
                      "HttpOnly; SameSite=Strict")
            return self._send_json(device, cookie=cookie)

        if route == "/api/pairing/lock":
            body = self._read_json_body()
            if not (self._this_computer() or self._device()):
                raise ValueError("Pair this device first, or change the lock on the computer running Deja Vu1, "
                                 "so nobody can lock you out")
            return self._send_json({"lock": pairing.set_lock(body.get("on"))})

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
            return self._send_json(home_assistant_bridge.public_settings(
                home_assistant_bridge.save_settings(body)))

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


def _require_idle_for_update():
    """Updates wait while a real printer is busy, out of reach, or a slice is running. Said with the printer's name."""
    names = {p.get("id"): p.get("name") for p in fleet.registered()}
    for pid in mock_moonraker.printer_ids():
        if mock_moonraker.is_real(pid):
            with mock_moonraker.use_printer(pid):
                state = mock_moonraker.get_printer_state()
            name = names.get(pid) or "A printer you added"
            if not mock_moonraker.is_connected(pid):
                raise ValueError(f"{name} isn't answering right now, so the update waits: Deja Vu1 can't see whether it "
                                 "is printing. Check the printer is switched on and on the same network, or remove it "
                                 "under Printers, then press Install again")
            if state.get("state") in ("printing", "paused"):
                raise ValueError(f"{name} is {state.get('state')}. The update waits until it has finished, so a print "
                                 "is never interrupted. Press Install again afterwards, or turn on automatic updates")
    try:
        slicing = slicer_bridge.any_active()
    except Exception:
        # 0.8.0 crashed right here, so its Install button never worked. A broken
        # slicing check must never lock a copy out of the update that fixes it.
        traceback.print_exc()
        slicing = False
    if slicing:
        raise ValueError("Wait for slicing to finish before updating")


def _restart_soon(server, wait=0.5):
    """Stop serving; the launcher sees exit code 75 and starts the server again."""
    server.update_restart = True
    threading.Timer(wait, server.shutdown).start()


def _install_update(server, repair=False, background=False):
    """
    Stage an update (checked again just before it is committed), then restart into it.
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
    try:
        _require_idle_for_update()
    except Exception as exc:
        app_updates.set_job("idle")
        raise
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
        result = app_updates.prepare(before_commit=_require_idle_for_update, repair=repair, step=step)
    except Exception as exc:
        words = app_updates._words(exc)
        print(f"  The update could not be installed: {words}", flush=True)
        if not isinstance(exc, ValueError):
            traceback.print_exc()
        app_updates.set_job("failed", "failed", words, repair=repair)
        if raise_errors:
            raise
        return None
    app_updates.set_job("restarting", "restarting", repair=repair, version=result.get("version"))
    print(f"  Update {result.get('version', '')} is ready. Restarting into it now.", flush=True)
    # A moment longer than before, so the page that pressed Install hears "restarting" first.
    _restart_soon(server, wait=1.5)
    return result


def _print_phone_qr(url):
    """The phone address as a QR code in the launcher window, if the console can draw it."""
    try:
        lines = qr.terminal(url)
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        "".join(lines).encode(encoding)
    except (UnicodeError, LookupError, ValueError):
        return                       # a console that can't draw block characters just shows the address
    print("  Or point the phone's camera at this code (or press 'Connect your phone' in the dashboard):")
    for line in lines:
        print("  " + line)


PORT_IN_USE = 3                # exit code: another program holds the port (start.py reads it)


def _bind(attempts=10, wait=0.5):
    """
    The server on PORT. A port still held by a copy that is closing frees
    itself within a few seconds, so it is asked again; a port another program
    keeps is said in words with what to do, never as a traceback.
    """
    for attempt in range(attempts):
        try:
            return DejaVuServer(("0.0.0.0", PORT), DejaVuHandler)
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
    server = _bind()
    live_feed.start()
    threading.Thread(target=app_updates.watch, args=(lambda: _install_update(server),), daemon=True).start()
    threading.Thread(target=memory.watch, daemon=True).start()
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


def _close_down():
    live_feed.stop()
    import stock_camera
    stock_camera.stop_all()


if __name__ == "__main__":
    main()
