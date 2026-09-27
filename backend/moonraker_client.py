"""
moonraker_client.py
===================

The real connection to a printer. It talks to Moonraker - the web API in
front of Klipper - over HTTP and over Moonraker's WebSocket, and turns
what Moonraker says into exactly the dictionaries mock_moonraker.py has
always handed every other module. Nothing else in the dashboard changes
when a printer is real: mock_moonraker.py passes each call for a real
printer to one of these objects instead of its simulation.

Everything here was written against Moonraker's and Klipper's own source
and documentation, not against this project's simulation:

  - Moonraker (github.com/Arksine/moonraker, commit 1cfb0c4) and
    Snapmaker's U1 fork of it (github.com/Snapmaker/u1-moonraker, a308cfa):
    every HTTP reply is {"result": ...} except a file upload's; errors are
    {"error": {"code", "message"}}; Klipper's own refusals arrive as 400,
    "Klipper isn't connected" as 503; history pages are 50 jobs unless
    asked for more and include the running job as "in_progress"; history
    times are Unix seconds and filament is in millimetres.
  - The WebSocket speaks JSON-RPC 2.0. notify_status_update carries only
    the fields that changed (Klipper's webhooks.py sends a field whenever
    its value differs from the last one sent), so each one is merged into
    the copy kept here. A Klipper restart drops the subscription; it is
    made again on notify_klippy_ready.
  - Klipper (github.com/Klipper3d/klipper, ce7002b) and the U1's fork
    (github.com/Snapmaker/u1-klipper, 10f2f69): print_stats.state is
    standby / printing / paused / complete / cancelled / error. PAUSE and
    CANCEL change it before their request returns; RESUME and
    SDCARD_PRINT_FILE only schedule the print, so the state is read back
    until it moves (or a clear timeout says it didn't).
  - The U1 specifically: toolheads T0-T3 are Klipper's extruder,
    extruder1, extruder2, extruder3; print_task_config reports what each
    one has loaded (filament_exist, filament_type, filament_color_rgba)
    and the file-to-toolhead mapping (extruder_map_table); `M104 T1` is
    remapped through that table, so temperatures are set with
    SET_HEATER_TEMPERATURE HEATER=extruder1, which names the physical
    heater. A refused /printer/print/start comes back as a 200 whose
    result is {"state": "error", "message": ...} - treated as a failure.
    The U1's file metadata uses different field names from upstream
    Moonraker (filament_colour as one "#RRGGBB;#RRGGBB" string,
    filament_weight per filament) - both spellings are read.

What has NOT been done: running this against a physical printer. The
contract tests (tests/test_moonraker_client.py) serve the replies above,
copied from that source, to this client over real sockets. The first run
on real hardware is made debuggable instead: every exchange is kept in a
log (diagnostics(), GET /api/printers/diagnostics), every failure is put
in words, and nothing is ever reported done that wasn't read back.

Only the Python standard library is used.
"""

import base64
import copy
import hashlib
import http.client
import json
import os
import re
import socket
import ssl
import struct
import sys
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from urllib.parse import urlencode, urlparse

import gcode_tools
import websocket as ws

CONNECT_TIMEOUT = 5.0          # opening a connection to the printer
READ_TIMEOUT = 10.0            # a normal request
COMMAND_TIMEOUT = 90.0         # pause / resume / cancel run the printer's macros
GCODE_TIMEOUT = 120.0          # a G-code line returns when it has finished
HOME_TIMEOUT = 180.0           # homing a toolchanger can take a while
STATE_WAIT = 5.0               # how long to wait for a command to show in the state
START_WAIT = 12.0              # ... and for a started print to begin
MAX_RESPONSE = 32 * 1024 * 1024
WS_MAX_MESSAGE = 8 * 1024 * 1024
HISTORY_PAGE = 500
HISTORY_MAX_JOBS = 20000
PING_INTERVAL = 15.0
DEAD_AFTER = 60.0              # nothing heard (not even a pong) for this long: reconnect
KLIPPY_RETRY = 2.0             # Moonraker's docs: ask again in 2 s while Klipper starts
LOG_LINES = 300

CLIENT_VERSION = "1.0"
VERBOSE = os.environ.get("DEJAVU_MOONRAKER_LOG", "") not in ("", "0")

# Klipper's print_stats.state -> the dashboard's state words. A cancelled
# print leaves the printer idle ("ready"), which is how the live feed has
# always recognised a cancel (printing -> ready).
_PRINT_STATES = {"standby": "ready", "printing": "printing", "paused": "paused",
                 "complete": "complete", "cancelled": "ready", "error": "error"}
_TOOL_RE = re.compile(r"^extruder(\d*)$")
_CHAMBER_RE = re.compile(r"^(temperature_sensor|temperature_fan|heater_generic) .*(chamber|cavity|enclosure)",
                         re.IGNORECASE)
_HEX6 = re.compile(r"^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$")


class PrinterCommandError(Exception):
    """
    The printer (or Moonraker) refused or failed a command.

    Separate from ValueError, which means "the dashboard asked for something
    invalid". This one means the request was fine but the printer side
    failed - the case the dashboard must never paper over with a fake
    success. mock_moonraker.PrinterCommandError is this same class.
    """


class PrinterUnreachable(PrinterCommandError):
    """The printer couldn't be reached, or its answer never arrived whole."""


class PrinterRefused(PrinterCommandError):
    """The printer answered, and the answer was no."""


# ---------------------------------------------------------------------------
# Translating Moonraker's words into the dashboard's (pure functions - the
# contract tests check each one against replies copied from the source)
# ---------------------------------------------------------------------------

def toolhead_for(extruder):
    """'extruder' -> 'T0', 'extruder2' -> 'T2'; None for anything else."""
    m = _TOOL_RE.match(extruder or "")
    if not m:
        return None
    return f"T{int(m.group(1) or 0)}"


def extruder_for(toolhead):
    """'T0' -> 'extruder', 'T3' -> 'extruder3' (Klipper's own naming)."""
    n = int(str(toolhead)[1:])
    return "extruder" if n == 0 else f"extruder{n}"


def _num(value, default=None):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if f == f and abs(f) != float("inf") else default


def _at(seq, i):
    return seq[i] if isinstance(seq, (list, tuple)) and 0 <= i < len(seq) else None


def _hex(value):
    """'FF8800FF' / '#ff8800' -> '#FF8800'; None if it isn't a colour."""
    if not isinstance(value, str):
        return None
    m = _HEX6.match(value.strip())
    return f"#{m.group(1).upper()}" if m else None


def _split(value):
    """'PLA;PETG' / ['PLA', 'PETG'] / '#FFF;#000' -> a clean list of strings."""
    if isinstance(value, (list, tuple)):
        items = value
    elif isinstance(value, str):
        items = re.split(r"[;,]", value)
    else:
        return []
    return [str(i).strip().strip('"') for i in items if str(i).strip().strip('"')]


def _iso(unix):
    t = _num(unix)
    if t is None or t <= 0:
        return None
    try:
        return datetime.fromtimestamp(t).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def mm_to_grams(mm, material, diameter=None):
    """Filament length to weight, with gcode_tools' densities (an estimate)."""
    d = _num(diameter) or gcode_tools.FILAMENT_DIAMETER_MM
    density = gcode_tools.DENSITY.get(str(material or "PLA").upper().split("-")[0].split(" ")[0], 1.24)
    return max(0.0, _num(mm, 0.0)) * 3.141592653589793 * (d / 2) ** 2 * density / 1000.0


def clean_error(message):
    """
    Moonraker/Klipper error text, readable. The U1's Klipper sometimes sends
    a JSON object ('{"coded": "0001-0523-0000-0006", "msg": "extruder1 not
    configured"}'); that becomes 'extruder1 not configured (code ...)'.
    """
    text = str(message or "").strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, dict) and (data.get("msg") or data.get("message")):
            code = data.get("coded") or data.get("code")
            text = str(data.get("msg") or data.get("message")) + (f" (code {code})" if code else "")
    if text.startswith("!! "):
        text = text[3:]
    return text[:500] or "no reason given"


def filament_from_metadata(meta):
    """
    What a file needs loaded, from Moonraker's metadata for it. Reads both
    upstream Moonraker's fields (filament_colors, filament_weights,
    referenced_tools) and the U1 fork's (filament_colour, filament_weight).
    """
    meta = meta if isinstance(meta, dict) else {}
    colours = [_hex(c) for c in (_split(meta.get("filament_colors")) or _split(meta.get("filament_colour"))
                                 or _split(meta.get("extruder_colors")))]
    types = _split(meta.get("filament_type"))
    weights = meta.get("filament_weights") or meta.get("filament_weight") or []
    weights = [_num(w, 0.0) for w in weights] if isinstance(weights, list) else []
    tools = meta.get("referenced_tools")
    if isinstance(tools, list):
        tools = [int(t) for t in tools if isinstance(t, (int, float)) and 0 <= t < 32]
    elif weights:
        tools = [i for i, w in enumerate(weights) if w > 0]
    elif len(colours) == 1 or len(types) == 1:
        tools = [0]
    else:
        tools = []
    out = []
    for i in tools:
        out.append({"toolhead": f"T{i}",
                    "expected_color_hex": _at(colours, i),
                    "expected_color_name": None,
                    "expected_material": _at(types, i) or (types[0] if types else None),
                    "grams": _at(weights, i)})
    return out


def job_from_metadata(filename, meta):
    """The running job as the dashboard knows it (see mock_moonraker's printer.job)."""
    meta = meta if isinstance(meta, dict) else {}
    est = _num(meta.get("estimated_time"))
    required = filament_from_metadata(meta)
    types = _split(meta.get("filament_type"))
    return {
        "filename": filename,
        "total_hours": round(est / 3600.0, 4) if est else None,
        "layers": int(meta["layer_count"]) if isinstance(meta.get("layer_count"), (int, float)) else None,
        "filament_grams": _num(meta.get("filament_weight_total")),
        "filament_mm": _num(meta.get("filament_total")),
        "material": types[0] if types else None,
        "required_filament": required,
        "footprint_mm": None,
        "layer_height": _num(meta.get("layer_height")),
        "first_layer_height": _num(meta.get("first_layer_height")),
        "filament_diameter": _num(_at(meta.get("filament_diameter"), 0)) if isinstance(meta.get("filament_diameter"), list)
        else _num(meta.get("filament_diameter")),
        "source": "metadata",
    }


def _grams_used(mm, meta_or_job, material, completed):
    """
    Grams a job used, and whether that is an estimate. The slicer's own
    weight scaled by how much of its length was used is the best figure;
    otherwise the length is weighed with a typical density.
    """
    total_g = _num(meta_or_job.get("filament_weight_total", meta_or_job.get("filament_grams")))
    total_mm = _num(meta_or_job.get("filament_total", meta_or_job.get("filament_mm")))
    mm = _num(mm, 0.0)
    if total_g and total_mm and total_mm > 0 and mm > 0:
        return total_g * min(1.5, mm / total_mm), False
    if total_g and completed and mm <= 0:
        return total_g, False
    if mm > 0:
        diameter = meta_or_job.get("filament_diameter")
        if isinstance(diameter, list):
            diameter = _at(diameter, 0)
        return mm_to_grams(mm, material, diameter), True
    return 0.0, False


def translate_history_job(job):
    """
    One entry of Moonraker's /server/history/list, in the shape every module
    reads from get_print_history(). Returns None for the job still running
    (Moonraker lists it as "in_progress") and for an entry with no start.
    """
    if not isinstance(job, dict):
        return None
    status = job.get("status")
    if status == "in_progress":
        return None
    start = _num(job.get("start_time"))
    if not start:
        return None
    total = _num(job.get("total_duration"), 0.0)
    end = _num(job.get("end_time")) or (start + total)     # interrupted jobs have no end time
    meta = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    types = _split(meta.get("filament_type"))
    material = types[0] if types else "Unknown"
    grams, estimated = _grams_used(job.get("filament_used"), meta, material, status == "completed")
    required = filament_from_metadata(meta)
    colour = next((r["expected_color_hex"] for r in required if r["expected_color_hex"]), None)
    out = {
        "job_id": str(job.get("job_id") or ""),
        "filename": str(job.get("filename") or "(unknown file)"),
        # Anything that didn't finish or get cancelled (error, klippy_shutdown,
        # klippy_disconnect, interrupted, ...) counts as a failed print.
        "status": status if status in ("completed", "cancelled") else "error",
        "start_time": _iso(start),
        "end_time": _iso(end),
        "print_duration_hours": round(_num(job.get("print_duration"), 0.0) / 3600.0, 4),
        "filament_used_grams": round(grams, 1),
        "filament_grams_estimated": estimated,
        "filament_type": material,
        "filament_color_name": str(meta.get("filament_name") or colour or "Unknown").split(";")[0][:60],
        "filament_color_hex": colour or "#888888",
        "toolheads_used": sorted({r["toolhead"] for r in required}) or ["T0"],
        "source": "moonraker",
    }
    if out["status"] != status:
        out["status_detail"] = status
    return out


def packages_from_update_status(result):
    """/machine/update/status -> the {"packages": [...]} updates.py reads."""
    info = result.get("version_info") if isinstance(result, dict) else None
    packages = []
    for name, entry in sorted((info or {}).items()):
        if not isinstance(entry, dict) or "version" not in entry:
            continue                      # "system" lists OS packages, not a version
        current, remote = entry.get("version"), entry.get("remote_version")
        packages.append({"name": name, "current_version": current, "remote_version": remote,
                         "update_available": bool(remote and current and remote != current
                                                  and entry.get("is_valid", True))})
    return {"packages": packages}


def _toolheads(status, extruders, ptc):
    """Every toolhead, keyed T0..Tn, and which one is on the carriage."""
    active = None
    carriage = (status.get("toolhead") or {}).get("extruder")
    parked_states = {th: (status.get(name) or {}).get("state") for th, name in extruders.items()}
    if any(isinstance(s, str) for s in parked_states.values()):
        # The U1 reports each head's dock sensor: ACTIVATE = on the carriage.
        on = [th for th, s in parked_states.items() if s == "ACTIVATE"]
        active = on[0] if len(on) == 1 else (toolhead_for(carriage) if toolhead_for(carriage) in on else None)
    else:
        active = toolhead_for(carriage) if toolhead_for(carriage) in extruders else None
    out = {}
    for th, name in sorted(extruders.items(), key=lambda kv: int(kv[0][1:])):
        e = status.get(name) or {}
        i = int(th[1:])
        exist = _at(ptc.get("filament_exist"), i)
        ftype = _at(ptc.get("filament_type"), i)
        known = isinstance(ftype, str) and ftype.strip().upper() not in ("", "NONE")
        colour = _hex(_at(ptc.get("filament_color_rgba"), i)) if known else None
        vendor = _at(ptc.get("filament_vendor"), i)
        label = None
        if known:
            parts = [vendor if isinstance(vendor, str) and vendor.upper() not in ("", "NONE") else None,
                     ftype.strip(), colour]
            label = " ".join(p for p in parts if p)
        out[th] = {
            "status": "active" if th == active else "docked",
            "temperature": _num(e.get("temperature")),
            "target_temperature": _num(e.get("target"), 0.0),
            # None = the printer doesn't say (no sensor / not a U1): unknown,
            # never "empty" and never "fine".
            "filament_loaded": bool(exist) if isinstance(exist, bool) else None,
            "filament_known": bool(known and colour),
            "filament_color_hex": colour,
            "filament_color_name": label,
            "filament_material": ftype.strip() if known else None,
            "dock_sensor": parked_states.get(th) if isinstance(parked_states.get(th), str) else None,
        }
    return out, active


def translate_state(status, ctx):
    """
    Moonraker's printer objects -> the dict get_printer_state() returns.

    `status` is the merged subscription (print_stats, virtual_sdcard,
    webhooks, toolhead, gcode_move, heater_bed, extruder*, and on a U1
    print_task_config); `ctx` holds what this client knows besides it:
    printer_id, name, extruders ({"T0": "extruder", ...}), chamber (the
    sensor object, if any), job (the running file's details) and
    klippy_state / klippy_message when Klipper isn't ready.
    """
    status = status or {}
    wh = status.get("webhooks") or {}
    ps = status.get("print_stats") or {}
    vsd = status.get("virtual_sdcard") or {}
    gm = status.get("gcode_move") or {}
    bed = status.get("heater_bed") or {}
    ptc = status.get("print_task_config") or {}
    job = ctx.get("job") or {}
    klippy = ctx.get("klippy_state") or wh.get("state") or "ready"
    raw = ps.get("state") or "standby"
    filename = ps.get("filename") or None

    state = _PRINT_STATES.get(raw)
    message = None
    if klippy != "ready":
        state = "error"
        message = clean_error(ctx.get("klippy_message") or wh.get("state_message") or f"Klipper is {klippy}")
    elif state is None:
        state = "error"
        message = f"The printer reports a state this dashboard doesn't know: {raw!r}"

    progress = min(1.0, max(0.0, _num(vsd.get("progress"), 0.0)))
    if state == "complete":
        progress = 1.0
    elif state == "ready":
        progress = 0.0

    info = ps.get("info") if isinstance(ps.get("info"), dict) else {}
    current, total = info.get("current_layer"), info.get("total_layer")
    estimated_layer = False
    if not isinstance(total, int) or total <= 0:
        total = job.get("layers") if isinstance(job.get("layers"), int) and job.get("layers") > 0 else None
    if not isinstance(current, int) and state in ("printing", "paused") and total:
        # Klipper only knows the layer when the slicer sends
        # SET_PRINT_STATS_INFO; otherwise estimate it from the nozzle height,
        # the way Mainsail and Fluidd do.
        z = _num(_at(gm.get("gcode_position"), 2))
        lh, flh = job.get("layer_height"), job.get("first_layer_height") or job.get("layer_height")
        if z is not None and lh and flh:
            current = int(min(total, max(1, round((z - flh) / lh) + 1)))
            estimated_layer = True
    if not isinstance(current, int):
        current = None
    if state == "complete" and total:
        current = total

    extruders = ctx.get("extruders") or {}
    toolheads, active = _toolheads(status, extruders, ptc)
    pos = (status.get("toolhead") or {}).get("position") or [0, 0, 0, 0]
    chamber_obj = ctx.get("chamber")
    chamber = _num((status.get(chamber_obj) or {}).get("temperature")) if chamber_obj else None

    if message is None:
        if state == "printing":
            message = (f"Printing layer {current} of {total}" if current and total
                       else f"Printing {filename or ''}".strip())
        elif state == "paused":
            message = "Paused"
        elif state == "complete":
            message = f"Finished {filename or ''}".strip()
        elif state == "error":
            message = clean_error(ps.get("message") or "The print stopped with an error")
        else:
            message = "Idle" if raw != "cancelled" else "Idle - the last print was cancelled"

    out = {
        "state": state,
        "state_message": message,
        "current_file": filename if state != "ready" else None,
        "progress": round(progress, 4),
        "print_duration_hours": round(_num(ps.get("print_duration"), 0.0) / 3600.0, 4),
        "active_toolhead": active,
        "toolheads": toolheads,
        "bed_temperature": _num(bed.get("temperature")),
        "bed_target": _num(bed.get("target"), 0.0),
        "chamber_temperature": chamber,
        "toolhead_position": [round(_num(v, 0.0), 2) for v in list(pos)[:3]],
        "layer": {"current": current, "total": total, **({"estimated": True} if estimated_layer else {})},
        "printer_id": ctx.get("printer_id"),
        "printer_name": ctx.get("name"),
        "klipper_state": raw,
        "real": True,
    }
    table = ptc.get("extruder_map_table")
    if isinstance(table, list) and extruders:
        # Only the physical heads' slots: the U1 pads the table to 32 logical
        # extruders with zeros (print_task_config.py DEFAULT_PRINT_TASK_CONFIG).
        mapping = {f"T{i}": f"T{table[i]}" for i in range(min(len(table), len(extruders)))
                   if isinstance(table[i], int) and table[i] != i and f"T{table[i]}" in extruders}
        if mapping:
            out["extruder_map"] = mapping
    return out


def placeholder_state(printer_id, name, reason):
    """What a printer that has never answered reports: nothing but the reason."""
    return {"state": "error", "state_message": reason, "current_file": None, "progress": 0.0,
            "print_duration_hours": 0.0, "active_toolhead": None, "toolheads": {},
            "bed_temperature": None, "bed_target": 0.0, "chamber_temperature": None,
            "toolhead_position": [0.0, 0.0, 0.0], "layer": {"current": None, "total": None},
            "printer_id": printer_id, "printer_name": name, "klipper_state": None, "real": True,
            "link_lost": True, "link_lost_at": None, "never_connected": True}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _summary(data, limit=400):
    if data is None:
        return None
    if isinstance(data, (bytes, bytearray)):
        return f"<{len(data)} bytes>"
    text = data if isinstance(data, str) else json.dumps(data, default=str)
    return text if len(text) <= limit else text[:limit] + f"... ({len(text)} chars)"


class Endpoint:
    """Where a Moonraker is, parsed once: http(s)://host:port."""

    def __init__(self, url):
        parsed = urlparse(str(url or "").strip())
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("A Moonraker address looks like http://192.168.1.50:7125")
        self.tls = parsed.scheme == "https"
        self.host = parsed.hostname
        try:
            self.port = parsed.port or (443 if self.tls else 80)
        except ValueError:
            raise ValueError("That port isn't a number between 1 and 65535")
        self.label = f"{self.host}:{self.port}"

    def host_header(self):
        host = f"[{self.host}]" if ":" in self.host else self.host
        default = 443 if self.tls else 80
        return host if self.port == default else f"{host}:{self.port}"


class HttpTransport:
    """Moonraker's HTTP API. One short connection per request; every one logged."""

    def __init__(self, endpoint, api_key=None, log=None):
        self.endpoint = endpoint
        self.api_key = api_key or None
        self._log = log or (lambda entry: None)

    def _explain(self, exc, timeout):
        ep = self.endpoint.label
        if isinstance(exc, socket.gaierror):
            return f"Can't find '{self.endpoint.host}' on the network - check the printer's address"
        if isinstance(exc, ConnectionRefusedError):
            return (f"{ep} refused the connection - is Moonraker running there, and is "
                    f"{self.endpoint.port} its port? (Moonraker usually uses 7125)")
        if isinstance(exc, (socket.timeout, TimeoutError)):
            return f"No answer from {ep} within {timeout:g} s - is the printer on and on this network?"
        if isinstance(exc, http.client.IncompleteRead):
            return f"The reply from {ep} was cut off part-way (the connection dropped)"
        if isinstance(exc, http.client.RemoteDisconnected):
            return f"{ep} closed the connection without answering"
        if isinstance(exc, http.client.HTTPException):
            return f"{ep} answered with something that isn't HTTP - is that the right port?"
        if isinstance(exc, ssl.SSLError):
            return f"The secure connection to {ep} failed: {exc.reason or exc}"
        if isinstance(exc, OSError) and exc.strerror:
            return f"Can't reach {ep}: {exc.strerror}"
        return f"Can't reach {ep}: {exc}"

    def request(self, method, path, query=None, body=None, raw_body=None, content_type=None,
                timeout=READ_TIMEOUT, wrapped=True, max_bytes=MAX_RESPONSE):
        """
        One request. Returns the reply's "result" (the whole reply when
        wrapped=False). Raises PrinterUnreachable when there was no whole
        answer, PrinterRefused when Moonraker or Klipper said no.
        """
        url = path + ("?" + urlencode(query) if query else "")
        headers = {"Accept": "application/json", "User-Agent": f"DejaVu1/{CLIENT_VERSION}"}
        payload = None
        if raw_body is not None:
            payload = raw_body
            headers["Content-Type"] = content_type or "application/octet-stream"
        elif body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["X-Api-Key"] = self.api_key
        started = time.monotonic()
        deadline = started + timeout
        entry = {"t": datetime.now().isoformat(timespec="seconds"), "via": "http", "method": method,
                 "path": url, "sent": _summary(body) if raw_body is None else f"<{len(raw_body)} bytes>"}
        status, data = None, b""
        try:
            cls = http.client.HTTPSConnection if self.endpoint.tls else http.client.HTTPConnection
            kwargs = {"context": ssl.create_default_context()} if self.endpoint.tls else {}
            conn = cls(self.endpoint.host, self.endpoint.port, timeout=min(CONNECT_TIMEOUT, timeout), **kwargs)
            try:
                conn.connect()
                conn.sock.settimeout(max(0.5, min(timeout, deadline - time.monotonic())))
                conn.request(method, url, body=payload, headers=headers)
                resp = conn.getresponse()
                status = resp.status
                chunks, size = [], 0
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise socket.timeout()
                    conn.sock.settimeout(max(0.1, remaining))
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise PrinterUnreachable(f"The reply from {self.endpoint.label} was too large "
                                                 f"(over {max_bytes // (1024 * 1024)} MB)")
                    chunks.append(chunk)
                # http.client hands back a short body without complaint when
                # the connection drops early; the declared length says so.
                if resp.length:
                    raise http.client.IncompleteRead(b"".join(chunks), resp.length)
                data = b"".join(chunks)
            finally:
                conn.close()
        except PrinterCommandError as exc:
            entry.update(error=str(exc), ms=round((time.monotonic() - started) * 1000))
            self._log(entry)
            raise
        except (OSError, http.client.HTTPException, ValueError) as exc:
            words = self._explain(exc, timeout)
            entry.update(error=words, ms=round((time.monotonic() - started) * 1000))
            self._log(entry)
            raise PrinterUnreachable(words) from None

        entry.update(status=status, ms=round((time.monotonic() - started) * 1000))
        try:
            decoded = json.loads(data.decode("utf-8")) if data else None
        except (UnicodeDecodeError, ValueError):
            start = data[:60].decode("utf-8", "replace").strip()
            words = (f"{self.endpoint.label} answered {status}, but not with JSON (it began "
                     f"\"{start}\") - is that address Moonraker itself?")
            entry.update(error=words)
            self._log(entry)
            if status and status >= 400:
                raise PrinterRefused(words)
            raise PrinterUnreachable(words)
        entry["received"] = _summary(decoded, 600)

        if status >= 400:
            err = decoded.get("error") if isinstance(decoded, dict) else None
            message = clean_error(err.get("message") if isinstance(err, dict) else err)
            if status in (401, 403):
                words = (f"Moonraker refused the dashboard ({status}: {message}). Add this printer's API key "
                         "in Settings, or add this computer's address to [authorization] trusted_clients "
                         "in moonraker.conf")
            elif status == 404:
                words = f"Moonraker has no {path} ({message}) - is this Moonraker, and a recent enough one?"
            elif status == 503:
                words = f"{message} - Klipper isn't running or isn't connected to Moonraker"
            else:
                words = message
            entry["error"] = words
            self._log(entry)
            err_obj = PrinterRefused(words)
            err_obj.status = status
            raise err_obj
        self._log(entry)
        if not wrapped:
            return decoded
        if not isinstance(decoded, dict) or "result" not in decoded:
            raise PrinterUnreachable(f"{self.endpoint.label}'s reply to {path} had no \"result\" in it - "
                                     "is that address Moonraker itself?")
        return decoded["result"]


def multipart(fields, file_field, filename, data):
    """A multipart/form-data body, the way a browser's file upload sends one."""
    boundary = "----DejaVu1" + uuid.uuid4().hex
    safe = filename.replace("\\", "_").replace('"', "_").replace("\r", "_").replace("\n", "_")
    parts = []
    for name, value in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
                     .encode("utf-8"))
    parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; "
                  f"filename=\"{safe}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode("utf-8"))
    parts.append(bytes(data))
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------------------
# The WebSocket (client side of RFC 6455; websocket.py has the framing)
# ---------------------------------------------------------------------------

class WebSocketClient:
    """One open WebSocket to Moonraker. Frames we send are masked, as a client's must be."""

    def __init__(self, sock, rfile):
        self._sock = sock
        self._rfile = rfile
        self._wlock = threading.Lock()
        self.closed = False
        self.last_rx = time.monotonic()

    @classmethod
    def open(cls, endpoint, path="/websocket", headers=None, timeout=CONNECT_TIMEOUT):
        try:
            sock = socket.create_connection((endpoint.host, endpoint.port), timeout=timeout)
            if endpoint.tls:
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=endpoint.host)
        except OSError as exc:
            raise PrinterUnreachable(HttpTransport(endpoint)._explain(exc, timeout)) from None
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        lines = [f"GET {path} HTTP/1.1", f"Host: {endpoint.host_header()}", "Upgrade: websocket",
                 "Connection: Upgrade", f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13",
                 f"User-Agent: DejaVu1/{CLIENT_VERSION}"]
        lines += [f"{k}: {v}" for k, v in (headers or {}).items()]
        try:
            sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8"))
            rfile = sock.makefile("rb")
            status_line = rfile.readline(4096).decode("iso-8859-1").strip()
            got = {}
            for _ in range(100):
                line = rfile.readline(8192).decode("iso-8859-1")
                if line in ("\r\n", "\n", ""):
                    break
                if ":" in line:
                    k, v = line.split(":", 1)
                    got[k.strip().lower()] = v.strip()
        except OSError as exc:
            sock.close()
            raise PrinterUnreachable(HttpTransport(endpoint)._explain(exc, timeout)) from None
        parts = status_line.split(" ", 2)
        code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        if code != 101:
            sock.close()
            if code in (401, 403):
                raise PrinterRefused(f"Moonraker refused the live connection ({code}) - it needs an API key, "
                                     "or this computer added to trusted_clients")
            if code == 404:
                raise PrinterRefused(f"{endpoint.label} has no /websocket - is that address Moonraker?")
            raise PrinterUnreachable(f"{endpoint.label} answered \"{status_line[:80] or 'nothing'}\" instead of "
                                     "opening a live connection - is that address Moonraker?")
        if got.get("sec-websocket-accept") != ws.accept_key(key):
            sock.close()
            raise PrinterUnreachable(f"{endpoint.label} opened a WebSocket without the right handshake answer")
        return cls(sock, rfile)

    def settimeout(self, seconds):
        self._sock.settimeout(seconds)

    def _send(self, payload, opcode):
        with self._wlock:
            if self.closed:
                raise ws.ConnectionClosed("The connection to the printer has closed")
            try:
                self._sock.sendall(ws.encode_frame(payload, opcode, mask_key=os.urandom(4)))
            except OSError as exc:
                self.closed = True
                raise ws.ConnectionClosed(str(exc))

    def send_text(self, text):
        self._send(text, ws.OP_TEXT)

    def ping(self):
        self._send(b"dv", ws.OP_PING)

    def receive(self):
        """One whole message: (opcode, data). Answers pings; notes every frame's arrival."""
        opcode_seen, parts = None, []
        while True:
            fin, opcode, payload = ws.read_frame(self._rfile.read, require_mask=False, max_bytes=WS_MAX_MESSAGE)
            self.last_rx = time.monotonic()
            if opcode == ws.OP_PING:
                self._send(payload, ws.OP_PONG)
                continue
            if opcode == ws.OP_PONG:
                continue
            if opcode == ws.OP_CLOSE:
                code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 1005
                reason = payload[2:].decode("utf-8", "replace")
                self.close()
                raise ws.ConnectionClosed(f"Moonraker closed the connection ({code}{': ' + reason if reason else ''})")
            if opcode == ws.OP_CONTINUATION:
                if opcode_seen is None:
                    raise ws.ProtocolError("Continuation without a message to continue")
            else:
                opcode_seen = opcode
            parts.append(payload)
            if sum(len(p) for p in parts) > WS_MAX_MESSAGE:
                raise ws.ProtocolError("Message too large")
            if fin:
                data = b"".join(parts)
                if opcode_seen == ws.OP_TEXT:
                    data = data.decode("utf-8", "replace")
                return opcode_seen, data

    def close(self):
        if self.closed:
            return
        try:
            self._send(struct.pack("!H", 1000), ws.OP_CLOSE)
        except ws.ConnectionClosed:
            pass
        self.closed = True
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        for thing in (self._rfile, self._sock):
            try:
                thing.close()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# One real printer
# ---------------------------------------------------------------------------

# What to subscribe to, when the printer has it. Field lists keep the
# stream small; None means every field.
_BASE_OBJECTS = {
    "webhooks": ["state", "state_message"],
    "print_stats": ["state", "filename", "print_duration", "total_duration", "filament_used", "message", "info"],
    "virtual_sdcard": ["progress", "is_active", "file_position", "file_size"],
    "toolhead": ["extruder", "position", "homed_axes"],
    "gcode_move": ["gcode_position"],
    "heater_bed": ["temperature", "target"],
    "print_task_config": ["filament_exist", "filament_type", "filament_color_rgba", "filament_vendor",
                          "extruder_map_table"],
}
_EXTRUDER_FIELDS = ["temperature", "target", "state"]


class MoonrakerPrinter:
    """
    Everything the dashboard knows about one real printer, kept current by
    a background connection, with the same methods mock_moonraker.py calls
    on a simulated printer.
    """

    real = True

    def __init__(self, printer_id, name, url, api_key=None, on_change=None):
        self.id = printer_id
        self.name = str(name or printer_id)
        self.url = str(url).rstrip("/")
        self.endpoint = Endpoint(self.url)
        self.lock = threading.RLock()
        self._log = deque(maxlen=LOG_LINES)
        self.http = HttpTransport(self.endpoint, api_key, log=self._record)
        self.api_key = api_key or None
        self.on_change = on_change or (lambda printer_id: None)
        self.console = deque(maxlen=100)

        self._status = {}              # the merged subscription
        self._objects = []             # what printer.objects.list said
        self._extruders = {}           # {"T0": "extruder", ...}
        self._chamber = None
        self._subscription = {}
        self._klippy_state = None
        self._klippy_message = None
        self._job = None
        self._finished_job = None
        self._finished_n = 0

        self._history = []
        self._history_at = None
        self._history_error = None
        self._history_dirty = threading.Event()
        self._metadata_for = None

        self._ws = None
        self._pending = {}
        self._rpc_id = 0
        self._link_up = False          # WebSocket open and subscribed
        self._link_lost_at = None
        self._connected_at = None
        self._last_error = "Not connected yet"
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._need_setup = threading.Event()
        self._threads = []

    # -- lifecycle ------------------------------------------------------------

    def start(self):
        if self._threads:
            return
        self._stop.clear()
        for target, label in ((self._run, "conn"), (self._work, "work")):
            t = threading.Thread(target=target, name=f"moonraker-{label}-{self.id}", daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self):
        self._stop.set()
        self._wake.set()
        self._history_dirty.set()
        conn = self._ws
        if conn:
            conn.close()
        for t in self._threads:
            t.join(timeout=3)
        self._threads = []
        with self.lock:
            self._link_up = False

    # -- logging --------------------------------------------------------------

    def _record(self, entry):
        with self.lock:
            self._log.append(entry)
        # The terminal gets every failure and every command sent (POST);
        # DEJAVU_MOONRAKER_LOG=1 adds every read and every WebSocket message.
        is_command = entry.get("via") == "http" and entry.get("method") != "GET"
        if VERBOSE or entry.get("error") or is_command:
            line = f"  [{self.name}] {entry.get('method', '')} {entry.get('path', '')}"
            if entry.get("status") is not None:
                line += f" -> {entry['status']}"
            if entry.get("ms") is not None:
                line += f" ({entry['ms']} ms)"
            if entry.get("error"):
                line += f": {entry['error']}"
            sys.stderr.write(line + "\n")

    def _note(self, what, detail=None, error=None):
        self._record({"t": datetime.now().isoformat(timespec="seconds"), "via": "ws", "method": what,
                      "path": "", **({"received": _summary(detail)} if detail is not None else {}),
                      **({"error": error} if error else {})})

    # -- the connection -------------------------------------------------------

    def _run(self):
        backoff = 1.0
        while not self._stop.is_set():
            began = time.monotonic()
            try:
                self._connect_once()
            except (PrinterCommandError, ws.ProtocolError, ws.ConnectionClosed, OSError, ValueError) as exc:
                self._down(str(exc) or exc.__class__.__name__)
            except Exception as exc:          # noqa: BLE001 - the connection must keep trying
                self._down(f"Unexpected error: {exc!r}")
            if time.monotonic() - began > 60:
                backoff = 1.0
            if self._stop.wait(backoff):
                break
            backoff = min(30.0, backoff * 2)

    def _down(self, reason):
        with self.lock:
            was_up = self._link_up
            self._link_up = False
            self._last_error = reason
            if was_up or self._link_lost_at is None:
                self._link_lost_at = datetime.now().isoformat(timespec="seconds")
            for slot in self._pending.values():
                slot["error"] = PrinterUnreachable(f"The connection to {self.name} dropped: {reason}")
                slot["event"].set()
            self._pending.clear()
        self._note("disconnected", error=reason)
        if was_up:
            self.on_change(self.id)

    def _connect_once(self):
        headers = {"X-Api-Key": self.api_key} if self.api_key else {}
        conn = WebSocketClient.open(self.endpoint, headers=headers)
        conn.settimeout(DEAD_AFTER)
        self._ws = conn
        reader = threading.Thread(target=self._read_loop, args=(conn,), name=f"moonraker-read-{self.id}",
                                  daemon=True)
        reader.start()
        try:
            identify = {"client_name": "Deja Vu1", "version": CLIENT_VERSION, "type": "web",
                        "url": "https://github.com/Jbyjre/Deja_VU1"}
            if self.api_key:
                identify["api_key"] = self.api_key
            try:
                self._call("server.connection.identify", identify)
            except PrinterRefused as exc:
                # Not fatal on its own: if it was about authorisation, the
                # very next call is refused too, in words.
                self._note("identify refused (carrying on)", error=str(exc))
            self._need_setup.set()
            while not self._stop.is_set() and reader.is_alive():
                if self._need_setup.is_set():
                    if self._setup():
                        self._need_setup.clear()
                    else:
                        self._wake.wait(KLIPPY_RETRY)
                        self._wake.clear()
                        continue
                self._wake.wait(PING_INTERVAL)
                self._wake.clear()
                if conn.closed:
                    break
                if time.monotonic() - conn.last_rx > DEAD_AFTER:
                    raise PrinterUnreachable(f"Nothing heard from {self.endpoint.label} for "
                                             f"{DEAD_AFTER:g} s - the connection is dead")
                conn.ping()
            if not self._stop.is_set():
                raise PrinterUnreachable(self._last_error if not reader.is_alive() else "Connection ended")
        finally:
            conn.close()
            reader.join(timeout=2)

    def _setup(self):
        """server.info, then (Klipper willing) list objects and subscribe. True when live."""
        info = self._call("server.info")
        state = info.get("klippy_state") if isinstance(info, dict) else None
        with self.lock:
            self._klippy_state = state
        if state not in ("ready", "shutdown", "error"):
            # startup / disconnected: nothing to subscribe to yet.
            with self.lock:
                self._klippy_message = {"startup": "Klipper is starting up",
                                        "disconnected": "Moonraker is running, but Klipper isn't connected to it",
                                        }.get(state, f"Klipper reports {state!r}")
                self._last_error = self._klippy_message
            self.on_change(self.id)
            return False
        listed = self._call("printer.objects.list")
        objects = listed.get("objects", []) if isinstance(listed, dict) else []
        extruders = {toolhead_for(o): o for o in objects if toolhead_for(o)}
        chamber = next((o for o in objects if _CHAMBER_RE.match(o)), None)
        subscription = {k: v for k, v in _BASE_OBJECTS.items() if k in objects}
        subscription.update({name: _EXTRUDER_FIELDS for name in extruders.values()})
        if chamber:
            subscription[chamber] = ["temperature"]
        result = self._call("printer.objects.subscribe", {"objects": subscription})
        full = result.get("status", {}) if isinstance(result, dict) else {}
        with self.lock:
            self._objects = objects
            self._extruders = extruders
            self._chamber = chamber
            self._subscription = subscription
            self._klippy_state = None if state == "ready" else state
            self._klippy_message = None
            # Merged into what was known before the link dropped, not
            # replacing it: a print that finished while the Wi-Fi was down
            # is still seen going printing -> complete, with its summary.
            self._merge(full)
            self._link_up = True
            self._link_lost_at = None
            self._connected_at = datetime.now().isoformat(timespec="seconds")
            self._last_error = None
        self._note("subscribed", {"objects": sorted(subscription), "klippy_state": state})
        self._history_dirty.set()
        self.on_change(self.id)
        return True

    def _read_loop(self, conn):
        try:
            while True:
                opcode, data = conn.receive()
                if opcode != ws.OP_TEXT:
                    continue
                try:
                    msg = json.loads(data)
                except ValueError:
                    self._note("unreadable message", data[:200], error="not JSON")
                    continue
                if not isinstance(msg, dict):
                    continue
                if "id" in msg and ("result" in msg or "error" in msg):
                    with self.lock:
                        slot = self._pending.pop(msg["id"], None)
                    if slot:
                        slot["reply"] = msg
                        slot["event"].set()
                    continue
                method = msg.get("method")
                if method:
                    try:
                        self._notification(method, msg.get("params"))
                    except Exception as exc:      # noqa: BLE001 - one odd message must not end the link
                        self._note(f"{method} not understood", msg.get("params"), error=repr(exc))
        except (ws.ConnectionClosed, ws.ProtocolError, OSError, ValueError) as exc:
            with self.lock:
                self._last_error = str(exc) or "The connection closed"
        finally:
            self._wake.set()

    def _call(self, method, params=None, timeout=READ_TIMEOUT):
        """One JSON-RPC request over the WebSocket, answered or refused in words."""
        conn = self._ws
        if conn is None or conn.closed:
            raise PrinterUnreachable(f"No live connection to {self.name}")
        with self.lock:
            self._rpc_id += 1
            rpc_id = self._rpc_id
            slot = {"event": threading.Event()}
            self._pending[rpc_id] = slot
        message = {"jsonrpc": "2.0", "method": method, "id": rpc_id}
        if params is not None:
            message["params"] = params
        started = time.monotonic()
        safe = {k: ("***" if k == "api_key" else v) for k, v in (params or {}).items()}
        try:
            conn.send_text(json.dumps(message))
        except ws.ConnectionClosed as exc:
            with self.lock:
                self._pending.pop(rpc_id, None)
            raise PrinterUnreachable(f"The connection to {self.name} dropped: {exc}")
        if not slot["event"].wait(timeout):
            with self.lock:
                self._pending.pop(rpc_id, None)
            self._record({"t": datetime.now().isoformat(timespec="seconds"), "via": "ws", "method": method,
                          "path": "", "sent": _summary(safe), "error": "no answer", "ms": round(timeout * 1000)})
            raise PrinterUnreachable(f"{self.name} didn't answer {method} within {timeout:g} s")
        if slot.get("error"):
            raise slot["error"]
        reply = slot["reply"]
        entry = {"t": datetime.now().isoformat(timespec="seconds"), "via": "ws", "method": method, "path": "",
                 "sent": _summary(safe), "ms": round((time.monotonic() - started) * 1000)}
        if "error" in reply:
            err = reply["error"] if isinstance(reply["error"], dict) else {"message": reply["error"]}
            words = clean_error(err.get("message"))
            entry["error"] = words
            self._record(entry)
            raise PrinterRefused(words)
        entry["received"] = _summary(reply.get("result"))
        self._record(entry)
        return reply.get("result")

    def _notification(self, method, params):
        if VERBOSE:
            self._note(method, params)
        if method == "notify_status_update":
            delta = params[0] if isinstance(params, list) and params else None
            if isinstance(delta, dict):
                with self.lock:
                    self._merge(delta)
                self.on_change(self.id)
        elif method == "notify_klippy_ready":
            with self.lock:
                self._klippy_state = None
            self._need_setup.set()
            self._wake.set()
        elif method == "notify_klippy_shutdown":
            with self.lock:
                self._klippy_state = "shutdown"
            self.on_change(self.id)
        elif method == "notify_klippy_disconnected":
            with self.lock:
                self._klippy_state = "disconnected"
                self._klippy_message = "Klipper stopped talking to Moonraker (restarting?)"
            self._need_setup.set()
            self._wake.set()
            self.on_change(self.id)
        elif method == "notify_history_changed":
            self._history_dirty.set()
        elif method == "notify_gcode_response":
            line = params[0] if isinstance(params, list) and params else params
            with self.lock:
                self.console.append({"time": datetime.now().isoformat(timespec="seconds"),
                                     "kind": "response", "detail": str(line)[:300]})

    # -- the status, and noticing a print finish --------------------------------

    def _merge(self, delta):
        """Apply a status delta (or a full query answer). Call with the lock held."""
        before = (self._status.get("print_stats") or {}).get("state")
        before_file = (self._status.get("print_stats") or {}).get("filename")
        for obj, fields in delta.items():
            if isinstance(fields, dict):
                self._status.setdefault(obj, {}).update(fields)
        ps = self._status.get("print_stats") or {}
        after, filename = ps.get("state"), ps.get("filename")
        if after == "complete" and before in ("printing", "paused"):
            self._finished_job = self._finished_record()
            self._history_dirty.set()
        elif after in ("printing", "paused") and (before not in ("printing", "paused") or filename != before_file):
            self._finished_job = None
            if self._job and self._job.get("filename") != filename:
                self._job = None             # started elsewhere: the last job's needs don't apply
            if filename and (not self._job or
                             self._job.get("layer_height") is None):
                self._metadata_for = filename
                self._history_dirty.set()        # wakes the worker, which reads the metadata too
        elif after in ("error", "cancelled") and before in ("printing", "paused"):
            self._history_dirty.set()

    def _finished_record(self):
        """The print that just completed, as a history entry (Moonraker's own arrives later)."""
        ps = self._status.get("print_stats") or {}
        job = dict(self._job or {})
        required = job.get("required_filament") or []
        material = job.get("material") or next((r.get("expected_material") for r in required
                                                if r.get("expected_material")), None) or "Unknown"
        grams, estimated = _grams_used(ps.get("filament_used"), job, material, True)
        colour = next((r.get("expected_color_hex") for r in required if r.get("expected_color_hex")), None)
        now = time.time()
        self._finished_n += 1
        return {
            "job_id": f"live-{self._finished_n:03d}",
            "filename": ps.get("filename") or job.get("filename") or "(unknown file)",
            "status": "completed",
            "start_time": _iso(now - _num(ps.get("total_duration"), 0.0)),
            "end_time": _iso(now),
            "print_duration_hours": round(_num(ps.get("print_duration"), 0.0) / 3600.0, 4),
            "filament_used_grams": round(grams, 1),
            "filament_grams_estimated": estimated,
            "filament_type": material,
            "filament_color_name": colour or "Unknown",
            "filament_color_hex": colour or "#888888",
            "toolheads_used": sorted({r["toolhead"] for r in required if r.get("toolhead")}) or ["T0"],
            "source": "moonraker",
        }

    def _ctx(self):
        return {"printer_id": self.id, "name": self.name, "extruders": self._extruders,
                "chamber": self._chamber, "job": self._job, "klippy_state": self._klippy_state,
                "klippy_message": self._klippy_message}

    def snapshot(self):
        with self.lock:
            if not self._status:
                return placeholder_state(self.id, self.name, f"Not connected: {self._last_error}")
            state = translate_state(self._status, self._ctx())
            if state["state"] == "complete" and self._finished_job:
                state["finished_job"] = copy.deepcopy(self._finished_job)
            if not self._link_up:
                state["link_lost"] = True
                state["link_lost_at"] = self._link_lost_at or datetime.now().isoformat(timespec="seconds")
            return state

    def is_connected(self):
        with self.lock:
            return self._link_up

    def advance(self, seconds, scaled=True):
        """A real printer moves on its own; the live feed just reads it."""
        return None

    # -- the background worker: history and file metadata ----------------------

    def _work(self):
        while not self._stop.is_set():
            # Woken when the history changes, a print starts, or the link
            # opens; otherwise re-read every 10 minutes as a safety net.
            self._history_dirty.wait(600.0)
            if self._stop.is_set():
                break
            self._history_dirty.clear()
            if not self.is_connected():
                continue
            wanted = self._metadata_for
            if wanted:
                self._metadata_for = None
                self._load_metadata(wanted)
            time.sleep(0.5)                  # a finish sends a few notifications at once
            self._load_history()

    def _load_metadata(self, filename):
        try:
            meta = self.http.request("GET", "/server/files/metadata", {"filename": filename})
        except PrinterCommandError as exc:
            self._note("no metadata for the running file", filename, error=str(exc))
            return
        found = job_from_metadata(filename, meta)
        with self.lock:
            mine = self._job if self._job and self._job.get("filename") == filename else None
            if mine:
                # Keep what the dashboard read from the file itself; add
                # what only the metadata has (layer heights for the layer).
                for key, value in found.items():
                    if mine.get(key) in (None, [], "") and value not in (None, []):
                        mine[key] = value
            else:
                self._job = found
        self.on_change(self.id)

    def _load_history(self):
        jobs, start = [], 0
        try:
            while start < HISTORY_MAX_JOBS:
                page = self.http.request("GET", "/server/history/list",
                                         {"limit": HISTORY_PAGE, "start": start, "order": "asc"},
                                         timeout=20.0)
                batch = page.get("jobs", []) if isinstance(page, dict) else []
                jobs.extend(batch)
                if len(batch) < HISTORY_PAGE:
                    break
                start += HISTORY_PAGE
        except PrinterCommandError as exc:
            with self.lock:
                self._history_error = str(exc)
            return
        translated = [t for t in (translate_history_job(j) for j in jobs) if t]
        translated.sort(key=lambda j: j["start_time"] or "")
        with self.lock:
            self._history = translated
            self._history_at = datetime.now().isoformat(timespec="seconds")
            self._history_error = None

    # -- reading ------------------------------------------------------------

    def get_print_history(self):
        """
        The printer's finished jobs, oldest first, from memory - fetched in
        the background when the connection opens and whenever Moonraker
        says the history changed, so reading it never waits on the network.
        """
        with self.lock:
            return list(self._history)

    def get_current_job(self):
        with self.lock:
            job = copy.deepcopy(self._job) if self._job else None
            filename = (self._status.get("print_stats") or {}).get("filename") or None
        if job is None:
            job = {"filename": filename, "total_hours": None, "layers": None, "filament_grams": None,
                   "material": None, "required_filament": [], "footprint_mm": None}
        return job

    def get_current_job_requirements(self):
        job = self.get_current_job()
        return {"filename": job.get("filename"), "required_filament": job.get("required_filament") or []}

    def get_console_log(self, limit=30):
        with self.lock:
            return list(reversed(self.console))[:limit]

    def get_update_status(self):
        try:
            result = self.http.request("GET", "/machine/update/status")
        except PrinterRefused as exc:
            if getattr(exc, "status", None) == 404:
                return {"packages": [], "note": "This printer's Moonraker has no update manager switched on "
                                                "(the U1's firmware updates come from Snapmaker itself)."}
            raise
        return packages_from_update_status(result)

    def diagnostics(self):
        """What a first real connection needs someone to see: state, and every exchange."""
        with self.lock:
            return {"id": self.id, "name": self.name, "url": self.url, "connected": self._link_up,
                    "connected_at": self._connected_at, "link_lost_at": self._link_lost_at,
                    "last_error": self._last_error, "klippy_state": self._klippy_state or
                    ((self._status.get("webhooks") or {}).get("state")),
                    "toolheads": sorted(self._extruders), "chamber_sensor": self._chamber,
                    "objects_subscribed": sorted(self._subscription),
                    "history_jobs": len(self._history), "history_fetched_at": self._history_at,
                    "history_error": self._history_error, "api_key_set": bool(self.api_key),
                    "log": list(reversed(self._log))}

    # -- commands (each checked first, then read back from the printer) --------

    def _require_link(self):
        if not self.is_connected():
            with self.lock:
                reason = self._last_error or "not connected"
            raise PrinterUnreachable(f"No live connection to {self.name} ({reason})")

    def _fresh_state(self):
        """Ask the printer now (not the pushed copy) and fold the answer in."""
        self._require_link()
        objects = self._subscription or {k: None for k in ("webhooks", "print_stats", "virtual_sdcard")}
        result = self.http.request("POST", "/printer/objects/query", body={"objects": objects})
        status = result.get("status") if isinstance(result, dict) else None
        if not isinstance(status, dict):
            raise PrinterUnreachable(f"{self.name} answered the status query without a status")
        with self.lock:
            self._merge(status)
        self.on_change(self.id)
        return self.snapshot()

    def _await(self, done, seconds):
        """Read the printer back until `done(state)` or `seconds` pass; the last reading either way."""
        deadline = time.monotonic() + seconds
        state = self._fresh_state()
        while not done(state) and time.monotonic() < deadline:
            time.sleep(0.3)
            state = self._fresh_state()
        return state

    def _gcode(self, script, timeout=GCODE_TIMEOUT):
        self._require_link()
        with self.lock:
            self.console.append({"time": datetime.now().isoformat(timespec="seconds"), "kind": "gcode",
                                 "detail": script[:300]})
        return self.http.request("POST", "/printer/gcode/script", body={"script": script}, timeout=timeout)

    def _log_command(self, kind, detail):
        with self.lock:
            self.console.append({"time": datetime.now().isoformat(timespec="seconds"), "kind": kind,
                                 "detail": str(detail or "")[:300]})

    def pause_print(self):
        state = self._fresh_state()
        if state["state"] != "printing":
            raise ValueError("Nothing is printing right now")
        self._log_command("pause", state.get("current_file"))
        self.http.request("POST", "/printer/print/pause", timeout=COMMAND_TIMEOUT)
        return self._await(lambda s: s["state"] == "paused", STATE_WAIT)

    def resume_print(self):
        state = self._fresh_state()
        if state["state"] != "paused":
            raise ValueError("Printer is not paused")
        self._log_command("resume", state.get("current_file"))
        self.http.request("POST", "/printer/print/resume", timeout=COMMAND_TIMEOUT)
        return self._await(lambda s: s["state"] == "printing", STATE_WAIT)

    def cancel_print(self):
        state = self._fresh_state()
        if state["state"] not in ("printing", "paused"):
            raise ValueError("Nothing to cancel")
        self._log_command("cancel", state.get("current_file"))
        self.http.request("POST", "/printer/print/cancel", timeout=COMMAND_TIMEOUT)
        return self._await(lambda s: s["state"] not in ("printing", "paused"), STATE_WAIT)

    def upload_file(self, filename, size_bytes=0, data=None):
        """
        POST /server/files/upload with a SHA-256 checksum: Moonraker checks
        it and refuses (422) a file that arrived damaged, so a truncated
        upload can never be printed.
        """
        self._require_link()
        if data is None:
            raise ValueError("A real printer needs the file's contents to upload it")
        data = bytes(data)
        body, ctype = multipart({"root": "gcodes", "checksum": hashlib.sha256(data).hexdigest()},
                                "file", filename, data)
        self._log_command("upload", f"{filename} ({len(data)} bytes)")
        timeout = 30.0 + len(data) / (256 * 1024)
        reply = self.http.request("POST", "/server/files/upload", raw_body=body, content_type=ctype,
                                  timeout=timeout, wrapped=False)
        item = reply.get("item") if isinstance(reply, dict) else None
        if not isinstance(item, dict):
            raise PrinterRefused(f"{self.name} didn't confirm the upload of {filename}")
        if isinstance(item.get("size"), int) and item["size"] != len(data):
            raise PrinterRefused(f"{self.name} stored {item['size']} bytes of {filename}, not {len(data)} - "
                                 "not printing a partial file")
        return {"item": {"path": item.get("path", filename), "root": item.get("root", "gcodes"),
                         "size": item.get("size", len(data))}, "action": reply.get("action", "create_file")}

    def start_print(self, filename, job=None):
        state = self._fresh_state()
        if state["state"] in ("printing", "paused"):
            raise ValueError("The printer is busy with another print")
        if state["state"] == "error":
            raise ValueError(f"The printer is reporting an error; clear it first ({state['state_message']})")
        job = job or {}
        with self.lock:
            self._job = {
                "filename": filename,
                "total_hours": _num(job.get("estimated_hours")),
                "layers": int(job["layers"]) if isinstance(job.get("layers"), (int, float)) and job["layers"] else None,
                "filament_grams": _num(job.get("filament_grams")),
                "filament_mm": None,
                "material": job.get("material"),
                "required_filament": copy.deepcopy(job.get("required_filament") or []),
                "footprint_mm": job.get("footprint_mm"),
                "layer_height": None, "first_layer_height": None,
                "source": "dashboard",
            }
            self._finished_job = None
            self._metadata_for = filename
        self._history_dirty.set()
        self._log_command("start", filename)
        result = self.http.request("POST", "/printer/print/start", body={"filename": filename},
                                   timeout=COMMAND_TIMEOUT)
        # The U1's Moonraker says no to a start with a *successful* reply
        # holding {"state": "error", "message": ...}.
        if isinstance(result, dict) and str(result.get("state", "")).lower() == "error":
            raise PrinterRefused(clean_error(result.get("message") or "The printer refused to start the print"))
        state = self._await(lambda s: s["state"] == "printing", START_WAIT)
        if state["state"] != "printing":
            raise PrinterCommandError(f"The printer accepted the start, but {START_WAIT:g} s later it still "
                                      f"reports \"{state['state']}\" ({state['state_message']}) - check its screen")
        return state

    def _toolhead_name(self, toolhead):
        with self.lock:
            name = self._extruders.get(toolhead)
            known = sorted(self._extruders)
        if not name:
            raise ValueError(f"{self.name} has no {toolhead}" + (f" (it has {', '.join(known)})" if known else ""))
        return name

    def set_target_temperature(self, toolhead, target):
        heater = self._toolhead_name(toolhead)
        # SET_HEATER_TEMPERATURE names the physical heater; on a U1, "M104 T1"
        # would be remapped through the print's filament mapping.
        self._gcode(f"SET_HEATER_TEMPERATURE HEATER={heater} TARGET={float(target):.1f}", timeout=READ_TIMEOUT * 2)
        return self._fresh_state()

    def set_bed_temperature(self, target):
        self._require_link()
        with self.lock:
            has_bed = "heater_bed" in self._objects
        if not has_bed:
            raise ValueError(f"{self.name} has no heated bed")
        self._gcode(f"SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET={float(target):.1f}", timeout=READ_TIMEOUT * 2)
        return self._fresh_state()

    def home_axes(self, axes):
        state = self._fresh_state()
        if state["state"] in ("printing", "paused"):
            raise ValueError("Homing is refused while a print is running or paused - it would drive the "
                             "toolhead through the print")
        self._gcode("G28 " + " ".join(axes), timeout=HOME_TIMEOUT)
        return {"homed": list(axes)}

    def run_gcode(self, command):
        if command.strip().upper().split(" ")[0] == "M112":
            # Moonraker's docs: M112 through gcode/script waits behind every
            # queued move. The emergency stop endpoint acts at once (the U1
            # only offers it over the WebSocket).
            self._require_link()
            self._log_command("gcode", "M112 -> emergency stop")
            self._call("printer.emergency_stop", timeout=READ_TIMEOUT)
            return {"command": command, "response": "Emergency stop sent - Klipper is now shut down"}
        result = self._gcode(command)
        return {"command": command, "response": result if isinstance(result, str) else "ok"}

    def clear_error(self):
        self._require_link()
        self._log_command("restart", "FIRMWARE_RESTART")
        self.http.request("POST", "/printer/firmware_restart", timeout=COMMAND_TIMEOUT)
        return self.snapshot()
