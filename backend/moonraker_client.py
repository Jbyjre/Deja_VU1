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
from urllib.parse import quote, urlencode, urlparse

import gcode_tools
import machines
import printer_extras
import websocket as ws
from moonraker_client_part1 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    CLIENT_VERSION, COMMAND_TIMEOUT, CONNECT_TIMEOUT, ComputerWoke, DEAD_AFTER, EXTRA_LIMIT, Endpoint,
    FACTORY_NAMES, FILAMENT_REQUERY, GCODE_TIMEOUT, HISTORY_MAX_JOBS, HISTORY_PAGE, HOME_TIMEOUT, HttpTransport,
    KLIPPY_RETRY, LOG_LINES, MACRO_LIMIT, MAX_RESPONSE, PING_INTERVAL, PrinterCommandError, PrinterRefused,
    PrinterUnreachable, QUIET_PRINTING, READ_TIMEOUT, RECONNECT_MAX, SLEEP_JUMP, START_WAIT, STATE_WAIT,
    STATUS_CHECK, VERBOSE, WS_MAX_MESSAGE, WebSocketClient, _BASE_OBJECTS, _CHAMBER_RE, _EXTRA_FAN_TYPES,
    _EXTRUDER_FIELDS, _HEX6, _LED_TYPES, _PRINT_STATES, _RUNOUT_TYPES, _TOOL_RE, _at, _grams_used, _hex, _iso,
    _num, _obj, _pretty, _short, _slept_between, _split, _str, _summary, clean_error, device_name_from,
    exclude_refusal, extras_from, extruder_for, filament_from_metadata, live_or_commanded, mm_to_grams, multipart,
    packages_from_update_status, placeholder_state, plate_objects, print_sync, refused_words, toolhead_for,
    translate_history_job, tuning_from,
)
from moonraker_client_part2 import _count, _toolheads, job_from_metadata, translate_state  # noqa: F401  (split out)


# ---------------------------------------------------------------------------
# Translating Moonraker's words into the dashboard's (pure functions - the
# contract tests check each one against replies copied from the source)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# The WebSocket (client side of RFC 6455; websocket.py has the framing)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# One real printer
# ---------------------------------------------------------------------------


class MoonrakerPrinter:
    """
    Everything the dashboard knows about one real printer, kept current by
    a background connection, with the same methods mock_moonraker.py calls
    on a simulated printer.
    """

    real = True

    def __init__(self, printer_id, name, url, api_key=None, on_change=None):
        self.id = printer_id
        self.typed_name = str(name or printer_id)
        self.device_name = None        # the name set on the printer itself (machine.system_info)
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
        self._is_u1 = None             # print_task_config listed: Snapmaker's U1 Klipper
        self._machine_type = None      # product_info.machine_type from Snapmaker's Moonraker
        self.serial = None             # product_info.serial_number: the same printer at a new address
        self._config = {}              # kinematics and nozzle from a non-U1 printer's config
        self._extruders = {}           # {"T0": "extruder", ...}
        self._chamber = None
        self._extras = {}
        self._macro_info = None
        self._last_status_at = None     # the printer's own last status report (monotonic)
        self._last_data_at = None       # the last reading of any kind, pushed or asked for
        self._reading_directly = False
        self._subscription = {}
        self._filament_asked = float("-inf")
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
        self._last_error = None        # None until a first attempt says otherwise: "connecting"
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
        misses = 0
        while not self._stop.is_set():
            began = time.monotonic()
            try:
                self._connect_once()
            except (PrinterCommandError, ws.ProtocolError, ws.ConnectionClosed, OSError, ValueError) as exc:
                self._down(str(exc) or exc.__class__.__name__)
                # Nothing answered on this door (refused, timed out, unreachable): after two tries
                # in a row, try the printer's other door (port 80 is the one its own web page uses).
                if isinstance(exc, ComputerWoke):
                    misses, backoff = 0, 1.0           # waking up says nothing about the printer's doors
                elif isinstance(exc, (OSError, PrinterUnreachable)) and not self._link_up:
                    misses += 1
                    if misses >= 2:
                        misses = 0
                        self._switch_door()
            except Exception as exc:          # noqa: BLE001 - the connection must keep trying
                self._down(f"Unexpected error: {exc!r}")
            if time.monotonic() - began > 60:
                backoff = 1.0
            if self._stop.wait(backoff):
                break
            backoff = min(RECONNECT_MAX, backoff * 2)

    def _switch_door(self):
        other = self.endpoint.other_door()
        if other is None:
            return
        self._note("trying the printer's other port", error=f"{self.endpoint.label} -> {other.label}")
        with self.lock:
            self.endpoint = other
            self.http.endpoint = other

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
            last_ping = time.monotonic()
            clocks = (time.time(), time.monotonic())
            while not self._stop.is_set() and reader.is_alive():
                clocks, slept = _slept_between(clocks)
                if slept:
                    raise ComputerWoke(f"This computer was asleep for about {slept:.0f} s, so the connection to "
                                       f"{self.endpoint.label} is opened again")
                if self._need_setup.is_set():
                    if self._setup():
                        self._need_setup.clear()
                    else:
                        self._wake.wait(KLIPPY_RETRY)
                        self._wake.clear()
                        continue
                self._wake.wait(min(STATUS_CHECK, PING_INTERVAL))
                self._wake.clear()
                if conn.closed:
                    break
                if time.monotonic() - conn.last_rx > DEAD_AFTER:
                    raise PrinterUnreachable(f"Nothing heard from {self.endpoint.label} for "
                                             f"{DEAD_AFTER:g} s - the connection is dead")
                self._catch_up_if_quiet()
                if time.monotonic() - last_ping >= PING_INTERVAL:
                    last_ping = time.monotonic()
                    conn.ping()
                    self._requery_filament()
            if not self._stop.is_set():
                raise PrinterUnreachable(self._last_error if not reader.is_alive() else "Connection ended")
        finally:
            conn.close()
            reader.join(timeout=2)

    def _catch_up_if_quiet(self, now=None):
        """
        Mid-print, Klipper reports new positions several times a second. If none has come for
        QUIET_PRINTING seconds while the socket stays open, ask the printer directly, every
        STATUS_CHECK seconds, until its own reports start again. The page and the twin keep moving.
        """
        now = time.monotonic() if now is None else now
        with self.lock:
            printing = (self._status.get("print_stats") or {}).get("state") == "printing"
            quiet = now - (self._last_status_at or now)
            subscription = dict(self._subscription or {})
            if not printing or quiet < QUIET_PRINTING or not subscription:
                self._reading_directly = False
                return False
            first = not self._reading_directly
            self._reading_directly = True
        if first:
            self._note("status updates went quiet mid-print; reading the printer directly",
                       error=f"no update for {quiet:.0f} s")
        try:
            result = self._call("printer.objects.query", {"objects": subscription})
        except PrinterCommandError as exc:
            self._note("direct reading failed", error=str(exc))
            return False
        status = result.get("status") if isinstance(result, dict) else None
        if isinstance(status, dict):
            with self.lock:
                self._merge(status)
                self._last_data_at = time.monotonic()
            self.on_change(self.id)
        return True

    def _requery_filament(self, now=None):
        """Ask for print_task_config outright, at most every FILAMENT_REQUERY seconds."""
        now = time.monotonic() if now is None else now
        with self.lock:
            fields = (self._subscription or {}).get("print_task_config")
            due = fields is not None and now - self._filament_asked >= FILAMENT_REQUERY
            if due:
                self._filament_asked = now
        if not due:
            return False
        try:
            result = self._call("printer.objects.query", {"objects": {"print_task_config": fields}})
        except PrinterCommandError as exc:
            self._note("filament re-query failed (carrying on)", error=str(exc))
            return False
        status = result.get("status") if isinstance(result, dict) else None
        if isinstance(status, dict) and isinstance(status.get("print_task_config"), dict):
            with self.lock:
                self._merge({"print_task_config": status["print_task_config"]})
            self.on_change(self.id)
            return True
        return False

    @property
    def name(self):
        """The name given on the printer itself, unless it still has the factory name."""
        return self.device_name or self.typed_name

    def _read_device_name(self):
        # Snapmaker's Moonraker keeps the printer's own name in system_info.product_info.device_name and
        # fills it with "Snapmaker U1" until someone renames it (u1-moonraker components/machine.py).
        try:
            info = self._call("machine.system_info")
        except Exception:                 # noqa: BLE001 - a printer that won't say keeps the typed name
            return
        found = device_name_from(info)
        product = _obj(_obj(info if isinstance(info, dict) else {}, "system_info"), "product_info")
        with self.lock:
            self.device_name = found
            # Snapmaker's Moonraker names the model here (u1-moonraker machine.py MACHINE_TYPE): a second
            # sign of a U1 besides Klipper's print_task_config object.
            self._machine_type = _str(product.get("machine_type"))
            serial = (_str(product.get("serial_number")) or "").strip().upper()[:40]
            self.serial = serial or None

    def version_facts(self):
        """
        The versions this printer reports about itself, for Tester mode: Moonraker's version and every
        version-named field of Snapmaker's product_info. Names, serial numbers and addresses are never
        read into the result. Two read-only calls that watch-only mode allows.
        """
        facts = {}
        try:
            info = self._call("server.info")
            if isinstance(info, dict) and _str(info.get("moonraker_version")):
                facts["moonraker_version"] = _str(info.get("moonraker_version"))[:60]
        except Exception:                 # noqa: BLE001
            pass
        try:
            system = self._call("machine.system_info")
            product = _obj(_obj(system if isinstance(system, dict) else {}, "system_info"), "product_info")
            if _str(product.get("machine_type")):
                facts["machine_type"] = _str(product.get("machine_type"))[:40]
            for key, value in sorted(product.items()):
                if "version" in str(key).lower() and isinstance(value, (str, int, float)) and not isinstance(value, bool):
                    facts["product_info." + str(key)[:30]] = str(value)[:60]
        except Exception:                 # noqa: BLE001
            pass
        return facts

    def _setup(self):
        """server.info, then (Klipper willing) list objects and subscribe. True when live."""
        info = self._call("server.info")
        if self.device_name is None or self._machine_type is None:
            self._read_device_name()
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
        # print_task_config exists only on Snapmaker's U1 Klipper. Any other
        # printer is described from its own config: kinematics and nozzle.
        with self.lock:
            said = (self._machine_type or "").strip().lower()
        is_u1 = "print_task_config" in objects or said == "snapmaker u1"
        config = {} if is_u1 else self._config_facts(objects)
        subscription.update({name: _EXTRUDER_FIELDS for name in extruders.values()})
        if chamber:
            subscription[chamber] = ["temperature"]
        extras = extras_from(objects, chamber)
        subscription.update({name: ["speed", "temperature"] if name.startswith("temperature_fan") else ["speed"]
                             for name in extras["fans"]})
        subscription.update({name: ["temperature"] for name in extras["sensors"]})
        subscription.update({name: ["color_data"] for name in extras["leds"]})
        subscription.update({name: ["value"] for name in extras["pins"]})
        subscription.update({name: ["filament_detected", "enabled"] for name in extras["runout"]})
        result = self._call("printer.objects.subscribe", {"objects": subscription})
        full = result.get("status", {}) if isinstance(result, dict) else {}
        with self.lock:
            self._objects = objects
            self._is_u1, self._config = is_u1, config
            self._extruders = extruders
            self._chamber = chamber
            self._extras = {**extras, "bed_mesh": "bed_mesh" in objects,
                            # The limits Klipper started with: hand changes never go above them.
                            "config_velocity": _num(_obj(full, "toolhead").get("max_velocity")),
                            "config_accel": _num(_obj(full, "toolhead").get("max_accel"))}
            self._subscription = subscription
            self._macro_info = None    # read again from the printer's config after each reconnect
            self._last_status_at = self._last_data_at = time.monotonic()
            self._reading_directly = False
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
        import watch_only
        import update_hold
        watch_only.check_call(method)
        with update_hold.writing_call(method):
            return self._call_now(method, params, timeout)

    def _call_now(self, method, params, timeout):
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
            # Over the WebSocket too, a missing or wrong API key says how to fix it.
            if err.get("code") in (401, 403):
                words = refused_words(err.get("code"), words)
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
                    self._last_status_at = self._last_data_at = time.monotonic()
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

    def _config_facts(self, objects):
        """Kinematics and nozzle from Klipper's config file, read once per connection."""
        if "configfile" not in objects:
            return {}
        try:
            got = self._call("printer.objects.query", {"objects": {"configfile": ["settings"]}})
            settings = ((got or {}).get("status", {}).get("configfile", {}) or {}).get("settings") or {}
        except Exception:                      # noqa: BLE001 - a missing fact, never a failed connection
            return {}
        return {"kinematics": _str((settings.get("printer") or {}).get("kinematics")),
                "nozzle_mm": _num((settings.get("extruder") or {}).get("nozzle_diameter"))}

    def _machine(self):
        """The U1 profile, or this printer described from its own report (machines.py)."""
        if self._is_u1 is not False:           # a U1, or not known yet: the U1 as before
            return machines.U1
        th = _obj(self._status, "toolhead")
        return machines.from_klipper(th.get("axis_minimum"), th.get("axis_maximum"), len(self._extruders),
                                     self._config.get("kinematics"), self._config.get("nozzle_mm"))

    def _ctx(self):
        return {"printer_id": self.id, "name": self.name, "extruders": self._extruders,
                "chamber": self._chamber, "job": self._job, "extras": self._extras, "klippy_state": self._klippy_state,
                "klippy_message": self._klippy_message, "machine": self._machine()}

    def snapshot(self):
        with self.lock:
            if not self._status:
                return placeholder_state(self.id, self.name,
                                         f"Not connected: {self._last_error}" if self._last_error
                                         else "Connecting...")
            state = translate_state(self._status, self._ctx())
            if state["state"] == "complete" and self._finished_job:
                state["finished_job"] = copy.deepcopy(self._finished_job)
            if not self._link_up:
                state["link_lost"] = True
                state["link_lost_at"] = self._link_lost_at or datetime.now().isoformat(timespec="seconds")
            elif self._last_data_at is not None:
                # How fresh the reading is, so the page can say when the printer has gone quiet.
                state["reading_age_s"] = round(time.monotonic() - self._last_data_at, 1)
                if self._reading_directly:
                    state["reading_directly"] = True
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

    def gcode_version(self, filename):
        """(size, modified) of a file on the printer, from Moonraker's metadata."""
        meta = self.http.request("GET", "/server/files/metadata", {"filename": filename})
        return (meta.get("size"), meta.get("modified")) if isinstance(meta, dict) else (None, None)

    VIDEO_ROOTS = ("camera", "timelapse")
    VIDEO_KINDS = (".mp4", ".mkv", ".webm", ".mov", ".avi")

    def printer_videos(self):
        """
        Time-lapse videos the printer itself recorded. Moonraker lists its file roots (GET /server/files/roots);
        the U1's stock firmware keeps its recordings in a read-only root called "camera" (reported by owners on
        firmware 2.0.0), and the moonraker-timelapse plugin, as the Extended Firmware uses, in "timelapse".
        Each root is listed with GET /server/files/list?root=<root>.
        """
        roots = self.http.request("GET", "/server/files/roots") or []
        names = [str(r.get("name")) for r in roots if isinstance(r, dict) and r.get("name") in self.VIDEO_ROOTS]
        out = []
        for root in names:
            try:
                listed = self.http.request("GET", "/server/files/list", query={"root": root}) or []
            except PrinterRefused:
                continue
            for f in listed if isinstance(listed, list) else []:
                path = str(f.get("path") or f.get("filename") or "")
                if path.lower().endswith(self.VIDEO_KINDS) and ".." not in path.split("/"):
                    out.append({"root": root, "path": path, "size": f.get("size"), "modified": f.get("modified")})
        out.sort(key=lambda f: -(f.get("modified") or 0))
        return {"videos": out[:200], "roots": names}

    def fetch_video(self, root, path, max_bytes):
        """One recorded video, as the printer holds it (GET /server/files/<root>/<path>)."""
        root, path = str(root or ""), str(path or "").strip().lstrip("/")
        if root not in self.VIDEO_ROOTS or not path or ".." in path.split("/") \
                or not path.lower().endswith(self.VIDEO_KINDS):
            raise ValueError("Choose one of the printer's videos")
        return self.http.request("GET", f"/server/files/{root}/" + quote(path), raw=True, timeout=300.0,
                                 max_bytes=max_bytes)

    def fetch_gcode(self, filename, max_bytes):
        """
        The file itself, as the printer holds it (Moonraker's file download,
        GET /server/files/gcodes/<name>; docs/external_api/file_manager.md).
        """
        name = str(filename or "").strip().lstrip("/")
        if not name or ".." in name.split("/"):
            raise ValueError("Choose a file on the printer")
        return self.http.request("GET", "/server/files/gcodes/" + quote(name), raw=True,
                                 timeout=120.0, max_bytes=max_bytes)

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

    def history_loaded(self):
        """True once the first history fetch has succeeded."""
        with self.lock:
            return self._history_at is not None

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
            result = self.http.request("GET", "/machine/update/status", expected=(404,))
        except PrinterRefused as exc:
            if getattr(exc, "status", None) == 404:
                return {"packages": [], "note": "This printer's Moonraker has no update manager switched on "
                                                "(the U1's firmware updates come from Snapmaker itself)."}
            raise
        return packages_from_update_status(result)

    def extra(self, kind):
        """What the Printer page reads on request (printer_extras.py): straight from Moonraker each time."""
        self._require_link()
        if kind == "temperatures":
            try:
                store = self.http.request("GET", "/server/temperature_store", query={"include_monitors": "false"},
                                          expected=(404,))
            except PrinterRefused as exc:
                if getattr(exc, "status", None) != 404:
                    raise
                # A Moonraker without its data store keeps no history: the chart fills from live readings.
                return {"interval_s": 1, "series": [], "note": "This printer keeps no temperature history"}
            return printer_extras.temperatures_from_store(store)
        if kind == "endstops":
            return {"endstops": printer_extras.endstops_from(
                self.http.request("GET", "/printer/query_endstops/status"))}
        if kind == "help":
            return {"commands": printer_extras.help_from(self.http.request("GET", "/printer/gcode/help"))}
        if kind == "mesh":
            with self.lock:
                has_mesh = bool(self._extras.get("bed_mesh"))
            if not has_mesh:
                return {"none": "This printer has no bed mesh set up in its configuration"}
            reply = self.http.request("GET", "/printer/objects/query", query={
                "bed_mesh": "profile_name,probed_matrix,mesh_min,mesh_max,profiles"}, max_bytes=4 * 1024 * 1024)
            return printer_extras.mesh_from_status(_obj(_obj(reply, "status"), "bed_mesh"))
        if kind == "macros":
            with self.lock:
                listed, cached = list(self._extras.get("macros") or []), self._macro_info
            if cached is None:
                # The whole printer config, once per connection: the macros' own text says which settings they take.
                reply = self.http.request("GET", "/printer/objects/query", query={"configfile": "config"},
                                          max_bytes=8 * 1024 * 1024)
                cached = printer_extras.macros_from_config(_obj(_obj(_obj(reply, "status"), "configfile"), "config"),
                                                           listed)
                with self.lock:
                    self._macro_info = cached
            return {"macros": cached}
        if kind == "feeding":
            with self.lock:
                has_feeder, heads = bool(self._extras.get("feeder")), sorted(self._extruders)
            if not has_feeder:
                return {"heads": [], "none": "This printer doesn't list Snapmaker's automatic feeding macros"}
            name = "gcode_macro _FILAMENT_FEED_VARIABLE"
            reply = self.http.request("GET", "/printer/objects/query",
                                      query={name: "module_sequence,channel_sequence"})
            return {"heads": printer_extras.feeding_from(_obj(_obj(reply, "status"), name), heads),
                    "macro": "AUTO_FEEDING"}
        if kind == "files":
            # Moonraker's own list, newest first (file_manager.py get_file_list, list_format).
            listed = self.http.request("GET", "/server/files/list", query={"root": "gcodes"})
            return {"files": printer_extras.files_from(listed)}
        if kind == "job_queue":
            try:
                reply = self.http.request("GET", "/server/job_queue/status", expected=(404,))
            except PrinterRefused as exc:
                if getattr(exc, "status", None) != 404:
                    raise
                return {"queued_jobs": [], "queue_state": None, "none": "This printer's Moonraker has no job queue"}
            return printer_extras.job_queue_from(reply)
        raise ValueError(f"Unknown reading: {kind}")

    def diagnostics(self):
        """What a first real connection needs someone to see: state, and every exchange."""
        with self.lock:
            return {"id": self.id, "name": self.name, "url": self.url, "connected": self._link_up,
                    "door": self.endpoint.label, "serial": self.serial,
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
        if state["state"] == "paused":
            raise ValueError("Print already paused")      # Klipper's own words (pause_resume.py)
        if state["state"] != "printing":
            raise ValueError("Nothing is printing right now")
        self._log_command("pause", state.get("current_file"))
        skipping = self._in_excluded_region()
        self.http.request("POST", "/printer/print/pause", timeout=COMMAND_TIMEOUT)
        state = self._await(lambda s: s["state"] == "paused", STATE_WAIT)
        # The U1 answers ok and carries on while the nozzle is over a skipped
        # object (u1-klipper extras/pause_resume.py cmd_PAUSE), so say why.
        if state["state"] != "paused" and (skipping or self._in_excluded_region()):
            raise PrinterRefused("The printer doesn't pause while the nozzle is passing over a skipped object. "
                                 "Press Pause again in a moment")
        return state

    def _in_excluded_region(self):
        with self.lock:
            return (self._status.get("exclude_object") or {}).get("in_excluded_region") is True

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
        # Klipper ends a command's arguments at "#", "*" or ";" (gcode.py),
        # so SDCARD_PRINT_FILE gets no name; U1 firmware 2.0.0 then refuses
        # with "Confirm whether the filename is legal" (virtual_sdcard.py).
        if any(c in str(filename) for c in "#*;"):
            raise ValueError(f"The U1 can't start a file whose name contains #, * or ; ({filename}). "
                             "Rename it, then start it again")
        state = self._fresh_state()
        if state["state"] in ("printing", "paused"):
            raise ValueError("The printer is busy with another print")
        if state["state"] == "error":
            raise ValueError(f"The printer is reporting an error; clear it first ({state['state_message']})")
        job = job or {}
        self._log_command("start", filename)
        result = self.http.request("POST", "/printer/print/start", body={"filename": filename},
                                   timeout=COMMAND_TIMEOUT)
        # The U1's Moonraker says no to a start with a *successful* reply
        # holding {"state": "error", "message": ...}.
        if isinstance(result, dict) and str(result.get("state", "")).lower() == "error":
            raise PrinterRefused(clean_error(result.get("message") or "The printer refused to start the print"))
        with self.lock:
            self._job = {
                "filename": filename,
                "total_hours": _num(job.get("estimated_hours")),
                "layers": _count(job.get("layers")),
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

    def set_filament(self, toolhead, colour, material):
        import tool_setup
        toolhead, colour, material = tool_setup.filament_fields(
            {"toolhead": toolhead, "color_hex": colour, "material": material})
        state = self._fresh_state()
        if state["state"] not in ("ready", "complete"):
            raise ValueError("Filament settings can only change while the printer is idle")
        if state["toolheads"].get(toolhead, {}).get("filament_loaded") is not True:
            raise ValueError(f"Load filament into {toolhead} before changing its identity")
        # Physical CONFIG_EXTRUDER bypasses a job's logical tool mapping.
        # No FORCE: firmware protects tagged spools from manual replacement.
        self._gcode(f"SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER={toolhead[1]} "
                    f"FILAMENT_COLOR_RGBA={colour[1:].upper()}FF "
                    f"VENDOR=Snapmaker FILAMENT_TYPE={material} FILAMENT_SUBTYPE=Basic")
        updated = self._await(lambda s: s["toolheads"].get(toolhead, {}).get("filament_color_hex") == colour
                              and s["toolheads"].get(toolhead, {}).get("filament_material") == material, 3)
        dock = updated["toolheads"].get(toolhead, {})
        if dock.get("filament_color_hex") != colour or dock.get("filament_material") != material:
            raise ValueError("The printer did not confirm the requested colour and material. Check its screen; some firmware or tagged spools refuse changes")
        return {"toolhead": toolhead, "color_hex": colour, "material": material, "verified": True}

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

    def exclude_object(self, name):
        """Skip one labelled object for the rest of the print (Klipper's EXCLUDE_OBJECT)."""
        state = self._fresh_state()
        refusal = exclude_refusal(state, name)
        if refusal:
            raise ValueError(refusal)
        self._log_command("exclude", name)
        self._gcode(f"EXCLUDE_OBJECT NAME={name}")
        return self._await(lambda s: name in ((s.get("objects") or {}).get("excluded") or []), STATE_WAIT)

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

    def tune(self, action, script, timeout=None):
        """A hands-on command checked by printer_control: run it, then report the fresh state."""
        state = self._fresh_state()
        if action in ("jog", "move", "motors_off", "bed_mesh", "tool", "mesh_profile", "feed") \
                and state["state"] in ("printing", "paused"):
            raise ValueError("Not while a print is running or paused - it would move the head through the print")
        self._gcode(script, timeout=timeout or GCODE_TIMEOUT)
        return self._fresh_state()

    def clear_error(self):
        self._require_link()
        self._log_command("restart", "FIRMWARE_RESTART")
        self.http.request("POST", "/printer/firmware_restart", timeout=COMMAND_TIMEOUT)
        return self.snapshot()
