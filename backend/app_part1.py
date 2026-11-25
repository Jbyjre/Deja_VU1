"""
app_part1.py: part 1 of 1 split out of app.py (the web server: route helpers, security checks and shared
answers) on 19 November 2026, so a session reads only the part it needs. app.py imports every name here back, so
`app.<name>` works as before. Holds: DejaVuServer, LIVE_FPS, LIVE_SECONDS, MAX_UPLOAD, PORT, PORT_IN_USE,
WRITE_GRACE, _APP_ROUTES, _CONTROL_ACTIONS, _DATA_ROUTES, _FARM_ROUTES, _Gone, _LOCAL_SUFFIXES, _QUEUE_ACTIONS,
_chamber, _close_down, _colour_plan, _confirm_print, _demo, _fleet_rows, _host_name, _live_snapshot,
_loaded_heads, _print_phone_qr, _q, _restart_soon, _tester_study, module_routes.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import ai_assistant
import app_updates
import automations
import autostart
import camera
import color_check
import colour_bench
import colour_map
import companion_sensor
import comparison
import cost_calculator
import plugins
import model_inbox
import desktop
import discovery
import engine_installer
import error_codes
import error_guides
import filament_inventory
import file_library
import fleet
import handoff
import idle_stop
import home_assistant_bridge
import insights
import led_status
import live_feed
import logbook
import maintenance
import memory
import mock_moonraker
import model_maker
import modules
import notifications
import orca_import
import os
import photo_studio
import print_gate
import print_preview
import print_queue
import print_record
import printer_control
import recall
import process_settings
import project_plates
import qr
import readiness
import remote
import sanity_check
import slicer_bridge
import slicer_working
import socket
import socketserver
import spoolman_bridge
import sys
import tester
import tester_questions
import tester_report
import tester_study
import threading
import timelapse
import tool_setup
import update_hold
import updates
import watch_only
import webrtc_camera
import wled_bridge


PORT = int(os.environ.get("PORT", 8000))


MAX_UPLOAD = file_library.MAX_BYTES


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
def _cost_read(read):
    """The cost calculator runs as a built-in plugin: reading the printer for it needs that permission."""
    if not plugins.granted("cost-calculator", "printer.read"):
        raise PermissionError("Not allowed: the Print cost plugin hasn't been granted \"" +
                              plugins.PERMISSIONS["printer.read"] + "\". You can grant it in Settings, Plugins")
    return read()


_DATA_ROUTES = {
    "/api/tools/compatibility": ("printer_control", lambda q: tool_setup.compatibility()),
    "/api/printer/problems": ("error_help", lambda q: logbook.problems_view()),
    "/api/maintenance": ("maintenance", lambda q: maintenance.get_status()),
    "/api/maintenance/history": ("maintenance", lambda q: {"history": maintenance.get_history()}),
    "/api/leds": ("led_status", lambda q: led_status.get_all_ring_states()),
    "/api/colorcheck": ("color_check", lambda q: color_check.check_current_job()),
    "/api/printer": (None, lambda q: mock_moonraker.get_printer_state()),
    "/api/printer/job": (None, lambda q: dict(mock_moonraker.get_current_job() or {})),
    "/api/printer/control/capabilities": ("printer_control", lambda q: printer_control.get_capabilities()),
    "/api/printer/control/console": ("printer_control", lambda q: {"log": printer_control.get_console_log()}),
    # Read on request from the printer itself (printer_extras.py); a simulated printer's answers say "demo".
    "/api/printer/macros": ("printer_control", lambda q: mock_moonraker.printer_reading("macros")),
    "/api/printer/mesh": ("printer_control", lambda q: mock_moonraker.printer_reading("mesh")),
    "/api/printer/endstops": ("printer_control", lambda q: mock_moonraker.printer_reading("endstops")),
    "/api/printer/gcode-help": ("printer_control", lambda q: mock_moonraker.printer_reading("help")),
    "/api/printer/temperatures": ("printer_control", lambda q: mock_moonraker.printer_reading("temperatures")),
    "/api/printer/feeding": ("printer_control", lambda q: mock_moonraker.printer_reading("feeding")),
    "/api/printer/files": ("printer_control", lambda q: mock_moonraker.printer_reading("files")),
    "/api/printer/job-queue": ("printer_control", lambda q: mock_moonraker.printer_reading("job_queue")),
    "/api/filament/check": ("filament_inventory", lambda q: filament_inventory.check_job_requirements()),
    "/api/filament/forecast": ("filament_inventory", lambda q: {
        "spools": filament_inventory.forecast(mock_moonraker.get_print_history())}),
    "/api/compare": ("compare", lambda q: comparison.compare_current_job()),
    "/api/compare/repeat": ("compare", lambda q: comparison.repeat_last_settings()),
    "/api/compare/side-by-side": ("compare", lambda q: comparison.side_by_side()),
    "/api/sanity": ("sanity_check", lambda q: sanity_check.check()),
    "/api/updates": ("updates", lambda q: updates.get_status()),
    "/api/cost/history": ("cost_calculator", lambda q: {"jobs": _cost_read(cost_calculator.cost_history)}),
    "/api/cost/current": ("cost_calculator", lambda q: _cost_read(cost_calculator.current_job)),
    "/api/live/snapshot": (None, lambda q: _live_snapshot()),
    "/api/live/events": (None, lambda q: {"events": live_feed.events_since(int(_q(q, "since", "0")))}),
    "/api/fleet": ("fleet", lambda q: _fleet_rows(_demo(q))),
    "/api/fleet/history": ("fleet_command", lambda q: fleet.history(_q(q, "days", "30"), _q(q, "bucket", "day"),
                                                                    include_demo=_demo(q))),
    "/api/fleet/queues": ("fleet_command", lambda q: fleet.queues(_demo(q)) if modules.is_enabled("print_queue")
                          else {"queues": {}, "queue_disabled": True}),
    "/api/chamber": ("chamber_climate", lambda q: _chamber()),
    "/api/health": (None, lambda q: print_gate.printer_health()),
    "/api/print/confirm": (None, lambda q: _confirm_print(_q(q, "file"))),
    "/api/print/preview": (None, lambda q: print_preview.for_current(_q(q, "file", ""))),
    "/api/insights": (None, lambda q: insights.current()),
    "/api/queue": ("print_queue", lambda q: print_queue.get()),
    "/api/timelapse": ("timelapse", lambda q: {
        "sessions": timelapse.sessions(mock_moonraker.selected_printer_id()),
        "recording": timelapse.is_recording(mock_moonraker.selected_printer_id())}),
    "/api/timelapse/printer": ("timelapse", lambda q: {
        **mock_moonraker.printer_videos(),
        "saved": timelapse.saved_videos(mock_moonraker.selected_printer_id())}),
    "/api/timelapse/jobs": ("timelapse", lambda q: timelapse.keep_jobs(mock_moonraker.selected_printer_id())),
    "/api/timelapse/frames": ("timelapse", lambda q: {
        "frames": timelapse.frames(mock_moonraker.selected_printer_id(), _q(q, "session"))}),
}


# Routes that answer from this dashboard's own settings, not printer figures.
# Not gated by connected/demo; some are still gated by their module toggle.
_APP_ROUTES = {
    "/api/errors/reference": ("error_help", lambda q: error_codes.reference()),
    "/api/errors/search": ("error_help", lambda q: error_codes.search(_q(q, "q", ""))),
    "/api/errors/code": ("error_help", lambda q: error_guides.explain(_q(q, "code", ""))),
    "/api/errors/guide": ("error_help", lambda q: error_guides.get(_q(q, "slug", ""), _q(q, "refresh", "0") in ("1", "true"))),
    "/api/colorcheck/sensors": ("color_check", lambda q: companion_sensor.status()),
    "/api/colorcheck/overrides": ("color_check", lambda q: color_check.overrides()),
    "/api/colorcheck/connection": ("color_check", lambda q: color_check.connection_info(PORT)),
    "/api/colorcheck/bench": ("color_check", lambda q: colour_bench.listing(_q(q, "full", "0") in ("1", "true"))),
    "/api/maker/settings": ("photo_studio", lambda q: model_maker.settings(_q(q,"height",".2"),_q(q,"profile"))),
    "/api/slicer/catalog": ("auto_print", lambda q: slicer_bridge.installed_catalog()),
    "/api/slicer/schema": ("auto_print", lambda q: process_settings.schema()),
    "/api/logbook": ("maintenance", lambda q: logbook.entries(None, demo=not mock_moonraker.is_connected(), query=q.get("q", [None])[0])),
    "/api/tools/assignments": ("filament_inventory", lambda q: tool_setup.get()),
    "/api/filament/charges": ("filament_inventory", lambda q: {"charges": filament_inventory.recent_charges(
        q.get("printer", [None])[0])}),
    "/api/remote": (None, lambda q: remote.status(PORT)),
    "/api/assistant": ("ai_assistant", lambda q: ai_assistant.status()),
    "/api/assistant/chats": ("ai_assistant", lambda q: ai_assistant.chats()),
    "/api/assistant/thread": ("ai_assistant", lambda q: ai_assistant.view(_q(q, "id", "online-demo"), _q(q, "since", "0"))),
    "/api/app/watch-only": (None, lambda q: watch_only.status()),
    "/api/app/info": (None, lambda q: {**app_updates.status(), "watch_only": watch_only.status(), "server_pid": os.getpid(), "phone_address": discovery.home_address(), "port": PORT, "desktop": desktop.settings(), "idle_stop": idle_stop.status(),
                                       "launch_id": os.environ.get("DEJAVU_LAUNCH_ID", ""), "update_job": app_updates.job(),
                                       "last_update": readiness.last_update(), "launcher_version": readiness.launcher_version()}),
    "/api/app/memory": (None, lambda q: memory.status()),
    "/api/plugins": (None, lambda q: plugins.listing()),
    "/api/plugins/pane": (None, lambda q: plugins.pane(_q(q, "id"))),
    "/api/models/inbox": ("file_library", lambda q: model_inbox.status()),
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
    "/api/slicer/engine": ("auto_print", lambda q: dict(engine_installer.status(), own=slicer_bridge.own_engine())),
    "/api/slicer/working": ("auto_print", lambda q: slicer_working.state()),
    "/api/prints": (None, lambda q: _prints(q)),
    "/api/prints/item": (None, lambda q: _print_item(q)),
    "/api/prints/recall": (None, lambda q: _recall(q, recall.about)),
    "/api/prints/repeat": (None, lambda q: _recall(q, recall.like_last_time)),
    "/api/prints/facts": (None, lambda q: _recall_facts(q)),
    "/api/prints/replay": (None, lambda q: _replay(q, recall.replay)),
    "/api/prints/replay/layers": (None, lambda q: _replay(q, recall.replay_layers)),
    "/api/tester/status": ("tester", lambda q: tester.status()),
    "/api/tester/study": ("tester", lambda q: _tester_study(q)),
}


def _record_history(q):
    """The printer's own job history for the print record: a real printer's outside demo mode, a simulated one's in it."""
    demo, connected = _demo(q), mock_moonraker.is_connected()
    if demo == connected:
        return None
    try:
        return mock_moonraker.get_print_history()
    except Exception:
        return None


def _prints(q):
    """The print record (FLOW.4): running, queued and ended prints for the selected printer's view, newest first."""
    pid = mock_moonraker.selected_printer_id()
    out = print_record.listing(_demo(q), _q(q, "q", ""), _record_history(q), pid, mock_moonraker.printer_name(pid), _q(q, "status", ""))
    if _demo(q) != mock_moonraker.is_connected() and not _q(q, "q", "") and not any(
            p["status"] == "running" and p["printer"] == pid for p in out["prints"]):
        try:
            now = print_record.seen_printing(pid, mock_moonraker.printer_name(pid), mock_moonraker.get_printer_state(),
                                             mock_moonraker.get_current_job(), _demo(q))
        except Exception:
            now = None
        if now:
            out["prints"].insert(0, now)
    out["queued"] = []
    if modules.is_enabled("print_queue"):
        out["queued"] = [{"file": i.get("filename"), "status": i.get("status"), "note": i.get("note"), "id": i.get("id")}
                         for i in print_queue.get(pid).get("items", []) if i.get("status") in ("queued", "held")]
    return out


def _print_item(q):
    pid = mock_moonraker.selected_printer_id()
    return print_record.get(_q(q, "id"), _demo(q), _record_history(q), pid, mock_moonraker.printer_name(pid))


def _recall(q, ask):
    """RECALL.1: what the record knows about a file in Files, or the print to repeat ("print it like the time it worked")."""
    pid = mock_moonraker.selected_printer_id()
    return ask(_q(q, "file"), _demo(q), _record_history(q), pid, mock_moonraker.printer_name(pid))


def _recall_facts(q):
    """RECALL.3: plain facts from the ended prints in the record, each with the prints behind it."""
    pid = mock_moonraker.selected_printer_id()
    return recall.facts(_demo(q), _record_history(q), pid, mock_moonraker.printer_name(pid))


def _replay(q, ask):
    """RECALL.2: one ended print to play back on the twin, or its G-code's layers."""
    pid = mock_moonraker.selected_printer_id()
    return ask(_q(q, "id"), _demo(q), _record_history(q), pid, mock_moonraker.printer_name(pid))


def _tester_study(q):
    """The tester's progress, and with ?questions=1 the 22 questions, the saved answers and what the app saw next to each."""
    info = tester_study.describe()
    if _q(q, "questions", "") in ("1", "true", "yes"):
        info = {**info, "sections": tester_questions.public(), "choices": tester_questions.CHOICES,
                "answers": tester_study.answers_view(), "hints": tester_study.hints(tester_report.cached_report())}
    return info


def _confirm_print(name):
    """The Confirm Print summary, noted for Tester mode (the file as 'file 3, .3mf, 2.4 MB', never its name)."""
    gate = print_gate.summary(name)
    if tester.enabled():
        try:
            size = os.path.getsize(os.path.join(file_library.FILES_DIR, file_library.clean_name(name)))
        except (OSError, ValueError, TypeError):
            size = None
        tester.note_gate(name, gate, size)
    return gate


def _loaded_heads(demo=False):
    """What each head of the selected printer holds now, for matching a project's colours; None if unknown."""
    if not (mock_moonraker.is_connected() or demo):
        return None
    heads = (mock_moonraker.get_printer_state() or {}).get("toolheads") or {}
    out = []
    for i in range(colour_map.HEADS):
        h = heads.get(f"T{i}") or {}
        known = h.get("filament_known", True) and h.get("filament_loaded") is not False
        colour = colour_map.clean_hex(h.get("filament_color_hex")) if known else None
        source = "printer" if colour else None
        measured = None if demo else _measured_colour(f"T{i}")
        if measured:
            colour, source = measured, "sensor"
        out.append({"toolhead": f"T{i}", "colour": colour, "type": (h.get("filament_material") or "") if known else "",
                    "source": source})
    return out if any(h["colour"] for h in out) else None


def _measured_colour(toolhead):
    """The colour checker's fresh, calibrated reading for a head, or None (never a stale or uncertain one)."""
    view = companion_sensor.read(toolhead) or {}
    return colour_map.clean_hex(view.get("detected_hex")) if view.get("status") == "reading" else None


def _colour_plan(name, demo=False):
    """A project's filaments, which the model uses, and the suggested heads (GET /api/colours/plan)."""
    info = colour_map.read(file_library.read_bytes(name))
    loaded = _loaded_heads(demo)
    info["suggested"] = colour_map.suggest(info["filaments"])
    info["matched"] = colour_map.suggest(info["filaments"], loaded) if loaded else None
    info["fit"] = colour_map.head_fit(info["filaments"], loaded) if loaded else None
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
    routes["/api/timelapse/video"] = "timelapse"
    routes["/api/timelapse/printer-video"] = "timelapse"
    routes["/api/camera/snapshot"] = "camera"
    routes["/api/assistant/watch/picture"] = "ai_assistant"
    routes["/api/camera/stream"] = "camera"
    routes["/api/camera/live"] = "camera"
    routes["/api/camera/webrtc"] = "camera"
    routes["/api/tester/report.html"] = "tester"
    routes["/api/tester/report.zip"] = "tester"
    return routes


# POST actions on printer-figure-gated routes. Each changes the printer, so
# each is followed straight away by a fresh read of the printer's state.
_CONTROL_ACTIONS = {
    "/api/printer/control/filament": lambda b: mock_moonraker.set_filament(b),
    "/api/printer/control/start": lambda body: printer_control.start_print(
        body.get("filename"), confirmed=bool(body.get("confirmed")), bed_clear=bool(body.get("bed_clear"))),
    "/api/printer/control/pause": lambda body: printer_control.pause_print(),
    "/api/printer/control/resume": lambda body: printer_control.resume_print(),
    "/api/printer/control/cancel": lambda body: printer_control.cancel_print(),
    "/api/printer/control/exclude": lambda body: printer_control.exclude_object(body.get("name")),
    "/api/printer/control/temperature": lambda body: printer_control.set_temperature(
        body.get("toolhead"), body.get("target")),
    "/api/printer/control/home": lambda body: printer_control.home(body.get("axes")),
    "/api/printer/control/bed-temperature": lambda b: printer_control.set_bed_temperature(b.get("target")),
    "/api/printer/control/gcode": lambda body: printer_control.send_gcode(body.get("command")),
    "/api/printer/control/restart": lambda body: printer_control.clear_error(),
    "/api/printer/control/discard-saved-print": lambda body: printer_control.discard_saved_print(),
    # Hands-on controls (printer_control.jog and the rest): every value checked before any G-code.
    "/api/printer/control/jog": lambda b: printer_control.jog(b.get("axis"), b.get("distance"), b.get("speed")),
    "/api/printer/control/move": lambda b: printer_control.move_to(b.get("x"), b.get("y"), b.get("z"), b.get("speed")),
    "/api/printer/control/z-nudge": lambda b: printer_control.z_nudge(b.get("delta")),
    "/api/printer/control/extrude": lambda b: printer_control.extrude(b.get("length"), b.get("speed", 5)),
    "/api/printer/control/speed": lambda b: printer_control.set_factor("speed", b.get("percent")),
    "/api/printer/control/flow": lambda b: printer_control.set_factor("flow", b.get("percent")),
    "/api/printer/control/fan": lambda b: printer_control.set_fan(b.get("percent")),
    "/api/printer/control/pressure-advance": lambda b: printer_control.set_pressure_advance(
        b.get("toolhead"), b.get("value"), b.get("smooth_time")),
    "/api/printer/control/limits": lambda b: printer_control.set_limits(b.get("velocity"), b.get("accel")),
    "/api/printer/control/motors-off": lambda b: printer_control.motors_off(),
    "/api/printer/control/bed-mesh": lambda b: printer_control.bed_mesh(),
    "/api/printer/control/macro": lambda b: printer_control.run_macro(b.get("name"), b.get("params")),
    "/api/printer/control/fan-generic": lambda b: printer_control.set_fan_generic(b.get("name"), b.get("percent")),
    "/api/printer/control/led": lambda b: printer_control.set_led(b.get("name"), b.get("red"), b.get("green"),
                                                                  b.get("blue"), b.get("white")),
    "/api/printer/control/runout": lambda b: printer_control.set_runout(b.get("name"), b.get("enabled")),
    "/api/printer/control/mesh-profile": lambda b: printer_control.mesh_profile(b.get("action"), b.get("profile")),
    "/api/printer/control/feed": lambda b: printer_control.feed(b.get("toolhead")),
    "/api/printer/control/tool": lambda b: printer_control.pick_up(b.get("toolhead")),
    "/api/printer/control/estop": lambda b: printer_control.emergency_stop(),
}


# POST routes that act on a printer's queue - gated like the data routes.
_QUEUE_ACTIONS = {
    "/api/queue/add": lambda b: print_queue.add(b.get("filename")),
    "/api/queue/remove": lambda b: print_queue.remove(b.get("id")),
    "/api/queue/move": lambda b: print_queue.move(b.get("id"), b.get("direction")),
    "/api/queue/auto": lambda b: print_queue.set_auto_advance(b.get("enabled")),
    "/api/queue/start-next": lambda b: print_queue.start_next(confirmed=bool(b.get("confirmed"))),
    "/api/queue/clear-done": lambda b: print_queue.clear_done(),
    "/api/queue/bed-clear": lambda b: print_queue.confirm_bed_clear(job_key=b.get("job_key")),
}


def _q(query, key, default=None):
    value = query.get(key, [default])[0]
    if value is None:
        raise ValueError(f"Missing '{key}'")
    return value


class _Gone(Exception):
    """The browser went away mid-stream."""


class DejaVuServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows the usual "reuse address" option lets a second program take the same
    # port while Deja Vu1 still holds it, and Windows then hands each browser connection
    # to either one. There the port is held exclusively instead, so a second copy is
    # refused and says so (exit code PORT_IN_USE).
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
        if os.name == "nt" and exclusive is not None:
            self.socket.setsockopt(socket.SOL_SOCKET, exclusive, 1)
        socketserver.TCPServer.server_bind(self)
        # HTTPServer would look up the computer's full network name here, which can take
        # seconds on Windows networks where that lookup times out. Nothing uses it.
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port

    def handle_error(self, request, client_address):
        # A browser that closes a tab or drops a connection before its answer is sent is normal, not a fault:
        # leave it out of the console, where a traceback would only bury real errors.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class DualStackServer(DejaVuServer):
    """
    The same server listening on IPv6 and IPv4 at once. A browser asked for "localhost" may try IPv6 (::1) first;
    with the server on IPv4 alone that try has to fail before the IPv4 one is made, and Windows is slow to report
    that failure. Listening on both answers either at once. Where the system has
    no IPv6, or refuses one socket for both, app.py falls back to IPv4 alone, as before.
    """
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        DejaVuServer.server_bind(self)


WRITE_GRACE = 20               # seconds a command already on its way to a printer may finish


def _restart_soon(server, wait=0.5, reason="restart"):
    """
    Stop serving; the launcher sees exit code 75 and starts the server again.
    From here Deja Vu1 sends no printer anything new (update_hold), and the stop waits for a
    command already on its way to finish, so an upload or a G-code line is never cut in half.
    A print that is running carries on: the printer holds the file and runs it by itself.
    """
    server.update_restart = True
    update_hold.begin(reason)

    def stop():
        update_hold.wait_quiet(WRITE_GRACE)
        server.shutdown()
    threading.Timer(wait, stop).start()


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


LIVE_FPS = 15                  # most pictures a second the live camera stream sends


LIVE_SECONDS = 30 * 60         # a live stream ends after this; the page starts a new one


PORT_IN_USE = 3                # exit code: another program holds the port (start.py reads it)


def _close_down():
    live_feed.stop()
    import stock_camera
    stock_camera.stop_all()
