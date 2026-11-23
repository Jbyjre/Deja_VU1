"""
moonraker_client_part1.py: part 1 of 1 split out of moonraker_client.py (talking to a real printer through
Moonraker) on 19 November 2026, so a session reads only the part it needs. moonraker_client.py imports every
name here back, so `moonraker_client.<name>` works as before. Holds: CLIENT_VERSION, COMMAND_TIMEOUT,
CONNECT_TIMEOUT, ComputerWoke, DEAD_AFTER, EXTRA_LIMIT, Endpoint, FACTORY_NAMES, FILAMENT_REQUERY,
GCODE_TIMEOUT, HISTORY_MAX_JOBS, HISTORY_PAGE, HOME_TIMEOUT, HttpTransport, KLIPPY_RETRY, LOG_LINES,
MACRO_LIMIT, MAX_RESPONSE, PING_INTERVAL, PrinterCommandError, PrinterRefused, PrinterUnreachable,
QUIET_PRINTING, READ_TIMEOUT, RECONNECT_MAX, SLEEP_JUMP, START_WAIT, STATE_WAIT, STATUS_CHECK, VERBOSE,
WS_MAX_MESSAGE, WebSocketClient, _BASE_OBJECTS, _CHAMBER_RE, _EXTRA_FAN_TYPES, _EXTRUDER_FIELDS, _HEX6,
_LED_TYPES, _PRINT_STATES, _RUNOUT_TYPES, _TOOL_RE, _at, _grams_used, _hex, _iso, _num, _obj, _pretty, _short,
_slept_between, _split, _str, _summary, clean_error, device_name_from, exclude_refusal, extras_from,
extruder_for, filament_from_metadata, live_or_commanded, mm_to_grams, multipart, packages_from_update_status,
placeholder_state, plate_objects, print_sync, refused_words, toolhead_for, translate_history_job, tuning_from.
"""

from datetime import datetime
from urllib.parse import quote, urlencode, urlparse
import base64
import contextlib
import gcode_tools
import http.client
import json
import os
import re
import socket
import ssl
import struct
import threading
import time
import uuid
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


# Requery loaded filament periodically so a missed status notification
# cannot leave a touchscreen change invisible indefinitely.
FILAMENT_REQUERY = 30.0


DEAD_AFTER = 60.0              # nothing heard (not even a pong) for this long: reconnect


STATUS_CHECK = 2.0             # how often the link looks at whether readings still arrive


SLEEP_JUMP = 8.0               # more wall-clock time than running time passed between two looks: the computer slept


# While a print runs, Klipper's position and file position change all the time, so a status stream
# silent this long has stalled (the socket can stay open): the client then reads the printer directly.
QUIET_PRINTING = 5.0


KLIPPY_RETRY = 2.0             # Moonraker's docs: ask again in 2 s while Klipper starts


# The longest wait between connection attempts. A try on a home network costs
# one refused or unanswered connection, so a printer that has just been
# switched on is found within about 10 s rather than half a minute.
RECONNECT_MAX = 10.0


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


class ComputerWoke(PrinterUnreachable):
    """
    This computer slept (or its clock jumped) while the connection was open. Whatever the connection
    was before, it can no longer be trusted: after sleep it is often half-open (the printer closed it, this
    computer never heard), and waiting for the dead-connection timeout would leave the readings stale for a minute.
    """


def toolhead_for(extruder):
    """'extruder' -> 'T0', 'extruder2' -> 'T2'; None for anything else."""
    m = _TOOL_RE.match(extruder) if isinstance(extruder, str) else None
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


def _obj(status, name):
    """A printer object from the status, or {} - whatever shape actually arrived."""
    value = status.get(name) if isinstance(status, dict) and name else None
    return value if isinstance(value, dict) else {}


def _str(value):
    return value if isinstance(value, str) else None


# moonraker_client.py defines _count again further down (part 2 since the split); that later one is the one every
# caller uses, exactly as when both lived in one file.
def _count(value):
    """A positive whole number from metadata, or None."""
    v = _num(value)
    return int(v) if v is not None and 0 < v < 1e9 else None


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
    d = _num(diameter)
    d = d if d and 0.5 < d < 5 else gcode_tools.FILAMENT_DIAMETER_MM
    density = gcode_tools.DENSITY.get(str(material or "PLA").upper().split("-")[0].split(" ")[0], 1.24)
    return max(0.0, _num(mm, 0.0)) * 3.141592653589793 * (d / 2) ** 2 * density / 1000.0


_EMBEDDED_ERROR = re.compile(r'\{[^{}]*"(?:msg|message)"[^{}]*\}')


def _spoken(match):
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return match.group(0)
    if not isinstance(data, dict) or not (data.get("msg") or data.get("message")):
        return match.group(0)
    code = data.get("coded") or data.get("code")
    return str(data.get("msg") or data.get("message")).strip() + (f" (code {code})" if code else "")


def clean_error(message):
    """
    Moonraker/Klipper error text, readable. The U1's Klipper sometimes sends
    a JSON object ('{"coded": "0001-0523-0000-0006", "msg": "extruder1 not
    configured"}'); that becomes 'extruder1 not configured (code ...)'.
    """
    text = str(message or "").strip()
    if text.startswith("!! "):
        text = text[3:].strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, dict) and (data.get("msg") or data.get("message")):
            code = data.get("coded") or data.get("code")
            text = str(data.get("msg") or data.get("message")).strip() + (f" (code {code})" if code else "")
    # The same JSON inside longer text: after a Halt the U1's shutdown message carried it behind other words and the screen showed it raw.
    text = _EMBEDDED_ERROR.sub(_spoken, text)
    if re.search(r"\bM112\b", text) and "emergency stop" not in text.lower():
        code = re.search(r"\(code ([0-9-]+)\)", text)
        text = "Emergency stop: every motor and heater was stopped, and the printer needs a firmware restart" + (f" (code {code.group(1)})" if code else "")
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


def _grams_used(mm, meta_or_job, material, completed):
    """
    Grams a job used, and whether that is an estimate. The slicer's own
    weight scaled by how much of its length was used is the best figure;
    otherwise the length is weighed with a typical density.
    """
    total_g = _num(meta_or_job.get("filament_weight_total", meta_or_job.get("filament_grams")))
    total_mm = _num(meta_or_job.get("filament_total", meta_or_job.get("filament_mm")))
    mm = _num(mm, 0.0)
    if total_g is not None and not 0 < total_g < 1e6:
        total_g = None                       # not a real spool's worth: ignore it
    if total_g and total_mm and total_mm > 0 and mm > 0:
        grams, estimated = total_g * min(1.5, mm / total_mm), False
    elif total_g and completed and mm <= 0:
        grams, estimated = total_g, False
    elif mm > 0:
        diameter = meta_or_job.get("filament_diameter")
        if isinstance(diameter, list):
            diameter = _at(diameter, 0)
        grams, estimated = mm_to_grams(mm, material, diameter), True
    else:
        grams, estimated = 0.0, False
    if not 0 <= grams < 1e6:
        return 0.0, False                    # a figure that can't be real is left out, not reported
    return grams, estimated


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
        out["status_detail"] = status[:40] if isinstance(status, str) else "unknown"
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


def _pretty(obj_name):
    return obj_name.split(" ", 1)[-1].replace("_", " ")


def tuning_from(status, extras):
    """Speed and flow overrides, fans, limits, other sensors, macros and the bed mesh, as one block."""
    gm, th, fan = _obj(status, "gcode_move"), _obj(status, "toolhead"), _obj(status, "fan")
    speed = _num(fan.get("speed"))
    fans = []
    for name in extras.get("fans") or []:
        f = _obj(status, name)
        fans.append({"id": _short(name), "name": _pretty(name), "speed": _num(f.get("speed")),
                     "temperature": _num(f.get("temperature")),
                     # Only fan_generic takes SET_FAN_SPEED; the others follow their heater or board.
                     "settable": name.startswith("fan_generic ")})
    leds = []
    for name in extras.get("leds") or []:
        data = _obj(status, name).get("color_data")
        first = data[0] if isinstance(data, list) and data and isinstance(data[0], list) else None
        leds.append({"id": _short(name), "name": _pretty(name),
                     "color": [_num(v, 0.0) for v in first[:4]] if first else None})
    pins = [{"id": _short(name), "name": _pretty(name), "value": _num(_obj(status, name).get("value"))}
            for name in extras.get("pins") or []]
    runout = []
    for name in extras.get("runout") or []:
        r = _obj(status, name)
        runout.append({"id": _short(name), "name": _pretty(name),
                       "detected": r.get("filament_detected") if isinstance(r.get("filament_detected"), bool) else None,
                       "enabled": r.get("enabled") if isinstance(r.get("enabled"), bool) else None})
    sensors = [{"name": _pretty(name), "temperature": _num(_obj(status, name).get("temperature"))}
               for name in extras.get("sensors") or []]
    mesh = _obj(status, "bed_mesh")
    return {
        "speed_factor": _num(gm.get("speed_factor")),
        "extrude_factor": _num(gm.get("extrude_factor")),
        "part_fan": speed if speed is not None and 0 <= speed <= 1 else None,
        "part_fan_rpm": _num(fan.get("rpm")),
        "max_velocity": _num(th.get("max_velocity")),
        "max_accel": _num(th.get("max_accel")),
        "config_velocity": extras.get("config_velocity"),
        "config_accel": extras.get("config_accel"),
        "idle_state": _str(_obj(status, "idle_timeout").get("state")),
        "bed_mesh": bool(extras.get("bed_mesh")),
        "mesh_profile": _str(mesh.get("profile_name")) or None,
        "macros": list(extras.get("macros") or []),
        "fans": fans,
        "sensors": sensors,
        "leds": leds,
        "pins": pins,
        "runout": runout,
        "feeder": bool(extras.get("feeder")),
    }


FACTORY_NAMES = {"snapmaker u1", ""}


def device_name_from(info):
    """machine.system_info -> the name set on the printer, or None for none / the factory name."""
    info = info if isinstance(info, dict) else {}
    product = _obj(_obj(info, "system_info"), "product_info")
    name = " ".join((_str(product.get("device_name")) or "").split())[:40]
    return name if name.lower() not in FACTORY_NAMES else None


def live_or_commanded(th, mr):
    """
    Where the nozzle is, in the toolhead's coordinates: motion_report's
    live_position when the printer reports one, else toolhead "position".
    toolhead "position" is the end of the last move queued, so during a slow
    move (homing, a hand-typed G1, a park) it is already at the destination;
    live_position is where the motion is now. The U1's Klipper always loads
    motion_report (u1-klipper klippy/stepper.py) and keeps the latest move
    in its history (chelper/trapq.c), so an idle printer reads its rest
    position. Returns ([x, y, z], "live" | "commanded").
    """
    live = mr.get("live_position")
    if isinstance(live, (list, tuple)) and len(live) >= 3:
        vals = [_num(live[i]) for i in range(3)]
        if all(v is not None and abs(v) < 1e5 for v in vals):
            return vals, "live"
    pos = th.get("position")
    pos = [_num(v, 0.0) for v in list(pos)[:3]] if isinstance(pos, (list, tuple)) else []
    return pos + [0.0] * (3 - len(pos)), "commanded"


def print_sync(vsd, gm, mr):
    """
    Where the running print is, for the 3D twin to follow its own G-code:
    the byte Klipper has read up to in the file (virtual_sdcard
    file_position) and the nozzle's position now (motion_report
    live_position), in the file's coordinates (less the G-code offset, so
    the per-head offsets of a tool changer don't move it off the path).
    """
    out = {"file_position": None, "file_size": None, "live": None, "speed_factor": None, "extruding": None}
    pos, size = _num(vsd.get("file_position")), _num(vsd.get("file_size"))
    if pos is not None and size and 0 <= pos <= size:
        out["file_position"], out["file_size"] = int(pos), int(size)
    live = mr.get("live_position")
    if isinstance(live, (list, tuple)) and len(live) >= 3:
        origin = gm.get("homing_origin")
        origin = list(origin)[:3] if isinstance(origin, (list, tuple)) and len(origin) >= 3 else [0.0, 0.0, 0.0]
        vals = [_num(live[i]) for i in range(3)]
        offs = [_num(origin[i], 0.0) for i in range(3)]
        if all(v is not None and abs(v) < 1e5 for v in vals):
            out["live"] = [round(vals[i] - (offs[i] or 0.0), 3) for i in range(3)]
    sf = _num(gm.get("speed_factor"))
    out["speed_factor"] = sf if sf and 0 < sf < 20 else None
    # Filament moving forward right now (motion_report live_extruder_velocity, mm/s); a retraction is negative.
    ev = _num(mr.get("live_extruder_velocity"))
    if ev is not None and abs(ev) < 1e4:
        out["extruding"] = ev > 0.01
    return out


def plate_objects(eo):
    """
    Klipper's exclude_object status -> {"list", "excluded", "current"}, or
    None when the running file defined no objects. Fields as
    extras/exclude_object.py reports them (Snapmaker's U1 fork included):
    objects [{name, center?, polygon?}], excluded_objects, current_object.
    """
    eo = eo if isinstance(eo, dict) else {}
    raw = eo.get("objects")
    if not isinstance(raw, list) or not raw:
        return None
    listed = []
    for o in raw[:64]:
        if not isinstance(o, dict) or not _str(o.get("name")):
            continue
        item = {"name": _str(o.get("name"))[:128]}
        center = o.get("center")
        if isinstance(center, list) and len(center) == 2 and all(_num(v) is not None for v in center):
            item["center"] = [round(_num(v), 2) for v in center]
        poly = o.get("polygon")
        if isinstance(poly, list):
            pts = [[round(_num(p[0]), 2), round(_num(p[1]), 2)] for p in poly
                   if isinstance(p, list) and len(p) == 2 and None not in (_num(p[0]), _num(p[1]))]
            if len(pts) >= 3:
                item["polygon"] = pts[::max(1, -(-len(pts) // 64))]
        listed.append(item)
    if not listed:
        return None
    excluded = eo.get("excluded_objects")
    excluded = [_str(n) for n in excluded if _str(n)] if isinstance(excluded, list) else []
    current = _str(eo.get("current_object")) or None
    return {"list": listed, "excluded": excluded, "current": current}


def exclude_refusal(state, name):
    """
    Why skipping `name` must not be sent right now, in words - or None.
    Klipper's EXCLUDE_OBJECT accepts any name without complaint (it just
    adds it to the excluded list), so the check that it's real is here.
    """
    if state.get("state") not in ("printing", "paused"):
        return "Nothing is printing right now"
    plate = state.get("objects")
    if not plate:
        return "This print doesn't label its objects, so one can't be skipped - turn on " \
               "\"Label objects\" in the slicer for the next one"
    names = [o["name"] for o in plate["list"]]
    if name not in names:
        return f"There's no object called {name} in this print"
    if name in plate["excluded"]:
        return f"{name} is already being skipped"
    if len([n for n in names if n not in plate["excluded"]]) <= 1:
        return "That's the last object still printing - use Cancel to stop the whole print"
    return None


def refused_words(status, message):
    """What to do when Moonraker refuses the dashboard itself (no or wrong API key)."""
    return (f"Moonraker refused the dashboard ({status}: {message or 'Unauthorized'}). Remove this printer and add "
            "it again with its API key (Fleet -> Add a printer), or add this computer's address "
            "to [authorization] trusted_clients in moonraker.conf")


def placeholder_state(printer_id, name, reason):
    """What a printer that has never answered reports: nothing but the reason."""
    return {"state": "error", "state_message": reason, "current_file": None, "progress": 0.0,
            "print_duration_hours": 0.0, "active_toolhead": None, "toolheads": {},
            "bed_temperature": None, "bed_target": 0.0, "chamber_temperature": None,
            "toolhead_position": [0.0, 0.0, 0.0], "layer": {"current": None, "total": None},
            "printer_id": printer_id, "printer_name": name, "klipper_state": None, "real": True,
            "link_lost": True, "link_lost_at": None, "never_connected": True}


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

    def other_door(self):
        """
        The U1's Moonraker answers on two doors: its own port, 7125, and the
        printer's web server on port 80, which forwards to it (the printer's own
        web page reaches it that way). The other one, or None.
        """
        if self.tls or self.port not in (80, 7125):
            return None
        host = f"[{self.host}]" if ":" in self.host else self.host
        return Endpoint(f"http://{host}" + ("" if self.port == 7125 else ":7125"))

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
                timeout=READ_TIMEOUT, wrapped=True, max_bytes=MAX_RESPONSE, expected=(), raw=False):
        """
        One request. Returns the reply's "result" (the whole reply when
        wrapped=False). Raises PrinterUnreachable when there was no whole
        answer, PrinterRefused when Moonraker or Klipper said no.
        """
        # Here, not at the top: both modules import this one.
        import watch_only
        import update_hold
        watch_only.check_request(method, path)
        # A write is counted while it is on the wire, and refused while Deja Vu1 restarts.
        with update_hold.writing_request(method, path):
            return self._request(method, path, query, body, raw_body, content_type, timeout, wrapped, max_bytes,
                                 expected, raw)

    def _request(self, method, path, query, body, raw_body, content_type, timeout, wrapped, max_bytes, expected, raw):
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
        if raw and status and status < 400:
            # A file download: the body is the file itself, not JSON.
            entry["received"] = f"<{len(data)} bytes>"
            self._log(entry)
            return data
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
                words = refused_words(status, message)
            elif status == 404:
                words = f"Moonraker has no {path} ({message})"
            elif status == 503:
                words = f"{message} - Klipper isn't running or isn't connected to Moonraker"
            else:
                words = message
            # An answer the caller expects (the U1 has no update manager) is
            # noted, not logged as a failure.
            entry["note" if status in expected else "error"] = words
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


def _stream_method(self, path, byte_range=None, idle_timeout=30.0):
    """
    A file download that is passed on as it arrives, so nothing waits for the whole file and none of it is held in memory.
    Yields (status, headers, chunks): `chunks` gives the body 64 KB at a time, `headers` are the printer's, names in lower case.
    A byte_range such as "bytes=0-1023" is sent as a Range request (Moonraker's file server answers 206 to it). The wait is for
    each piece, not for the whole file. An answer of 400 or more raises in words, like request() does.
    """
    import watch_only
    watch_only.check_request("GET", path)
    headers = {"Accept": "*/*", "User-Agent": f"DejaVu1/{CLIENT_VERSION}"}
    if self.api_key:
        headers["X-Api-Key"] = self.api_key
    if byte_range:
        headers["Range"] = byte_range
    started = time.monotonic()
    entry = {"t": datetime.now().isoformat(timespec="seconds"), "via": "http", "method": "GET", "path": path, "sent": "", "streamed": True}
    conn = None
    try:
        cls = http.client.HTTPSConnection if self.endpoint.tls else http.client.HTTPConnection
        kwargs = {"context": ssl.create_default_context()} if self.endpoint.tls else {}
        conn = cls(self.endpoint.host, self.endpoint.port, timeout=CONNECT_TIMEOUT, **kwargs)
        conn.connect()
        conn.sock.settimeout(idle_timeout)
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
    except (OSError, http.client.HTTPException, ValueError) as exc:
        words = self._explain(exc, idle_timeout)
        entry.update(error=words, ms=round((time.monotonic() - started) * 1000))
        self._log(entry)
        if conn:
            conn.close()
        raise PrinterUnreachable(words) from None
    try:
        entry["status"] = resp.status
        if resp.status >= 400:
            message = clean_error(resp.read(2048).decode("utf-8", "replace")[:200])
            if resp.status in (401, 403):
                words = refused_words(resp.status, message)
            elif resp.status == 404:
                words = f"Moonraker has no {path.split('?')[0]}"
            else:
                words = message or f"{self.endpoint.label} answered {resp.status}"
            entry["error"] = words
            err_obj = PrinterRefused(words)
            err_obj.status = resp.status
            raise err_obj

        def chunks():
            try:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        return
                    yield chunk
            except (OSError, http.client.HTTPException) as exc:
                raise PrinterUnreachable(self._explain(exc, idle_timeout)) from None

        yield resp.status, {k.lower(): v for k, v in resp.getheaders()}, chunks()
    finally:
        entry["ms"] = round((time.monotonic() - started) * 1000)
        self._log(entry)
        conn.close()


HttpTransport.stream = contextlib.contextmanager(_stream_method)


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


# What to subscribe to, when the printer has it. Field lists keep the
# stream small; None means every field.
_BASE_OBJECTS = {
    "webhooks": ["state", "state_message"],
    # "exception" is the U1's own report of why a print paused or stopped (id, index, code, level, message); a printer
    # without it leaves the field out. exception_manager lists the problems that stay until they are cleared.
    "print_stats": ["state", "filename", "print_duration", "total_duration", "filament_used", "message", "info",
                    "exception"],
    "exception_manager": ["exceptions"],
    # pl_env_valid is the U1 fork's own flag that a halted or interrupted print is saved and the printer can restart it (a printer without it
    # leaves the field out).
    "virtual_sdcard": ["progress", "is_active", "file_position", "file_size", "pl_env_valid"],
    # The progress the slicer wrote into the file itself (M73), which counts time rather than bytes (Klipper's
    # docs/Status_Reference.md: display_status.progress, the bytes' progress when no M73 has come). Only where the printer has it.
    "display_status": ["progress"],
    # axis_minimum / axis_maximum: the build volume (Klipper kinematics get_status)
    "toolhead": ["extruder", "position", "homed_axes", "axis_minimum", "axis_maximum", "max_velocity", "max_accel"],
    "gcode_move": ["gcode_position", "homing_origin", "speed_factor", "extrude_factor"],
    # The part-cooling fan, the idle timer's word for the printer and the loaded bed mesh
    # (Klipper docs/Status_Reference.md: fan, idle_timeout, bed_mesh).
    "fan": ["speed", "rpm"],
    "idle_timeout": ["state"],
    "bed_mesh": ["profile_name"],
    # Where the nozzle is now (toolhead "position" is the last command,
    # which runs up to a second or two ahead of the motion; Klipper
    # docs/Status_Reference.md). Feeds the 3D twin's G-code sync.
    "motion_report": ["live_position", "live_velocity", "live_extruder_velocity"],
    "heater_bed": ["temperature", "target"],
    "print_task_config": ["filament_exist", "filament_type", "filament_color_rgba", "filament_vendor",
                          "extruder_map_table"],
    # in_excluded_region exists on the U1's fork only (a missing field is left out)
    "exclude_object": ["objects", "excluded_objects", "current_object", "in_excluded_region"],
}


# state, nozzle_diameter and the swap counters exist only on Snapmaker's
# U1 Klipper (klippy/kinematics/extruder.py get_status, u1-klipper 10f2f69);
# Klipper leaves out fields an object doesn't have, so asking costs nothing.
_EXTRUDER_FIELDS = ["temperature", "target", "state", "nozzle_diameter",
                    "switch_count", "retry_count", "error_count", "pressure_advance", "smooth_time", "can_extrude"]


# Other fans and temperature sensors a printer lists, shown beside the heaters the way the
# printer's own web page does. Capped so a printer with dozens can't flood the live stream.
_EXTRA_FAN_TYPES = ("heater_fan", "controller_fan", "fan_generic", "temperature_fan")


# Lights (Klipper's led, neopixel, dotstar and the PCA chips all report color_data and take SET_LED),
# output pins (shown, never switched from here: on the U1 they include each head's heater switch,
# eN_heat_sw in Snapmaker's published config) and filament runout sensors.
_LED_TYPES = ("led", "neopixel", "dotstar", "pca9533", "pca9632")


_RUNOUT_TYPES = ("filament_switch_sensor", "filament_motion_sensor")


EXTRA_LIMIT = 12


MACRO_LIMIT = 40


def extras_from(objects, chamber=None):
    """objects.list -> the printer's own buttons and readings, by kind."""
    objects = [o for o in objects if isinstance(o, str)]
    macros = sorted({o.split(" ", 1)[1].upper() for o in objects
                     if o.startswith("gcode_macro ") and not o.split(" ", 1)[1].startswith("_")})[:MACRO_LIMIT]

    def of(kinds):
        return [o for o in objects if o.split(" ", 1)[0] in kinds and " " in o][:EXTRA_LIMIT]
    sensors = [o for o in objects if o.startswith("temperature_sensor ") and o != chamber][:EXTRA_LIMIT]
    return {"macros": macros, "fans": of(_EXTRA_FAN_TYPES), "sensors": sensors, "leds": of(_LED_TYPES),
            "pins": of(("output_pin",)), "runout": of(_RUNOUT_TYPES),
            "feeder": "gcode_macro _FILAMENT_FEED_VARIABLE" in objects and "gcode_macro AUTO_FEEDING" in objects}


def _short(obj_name):
    """"fan_generic cavity_fan" -> "cavity_fan": the name Klipper's commands take."""
    return obj_name.split(" ", 1)[-1]


def _slept_between(before, wall=time.time, mono=time.monotonic):
    """
    ((wall, mono) now, seconds slept or 0). The wall clock runs while the computer sleeps; on Linux and macOS
    the monotonic clock stops, so the gap between the two is the sleep. (Where the monotonic clock counts sleep,
    as on Windows, the dead-connection timeout notices the wake instead.)
    """
    now = (wall(), mono())
    gap = (now[0] - before[0]) - (now[1] - before[1])
    return now, (gap if gap > SLEEP_JUMP else 0)
