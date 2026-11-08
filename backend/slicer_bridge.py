"""
slicer_bridge.py
================

The Auto-Print Pipeline: slice a raw model (STL or 3MF) with an OrcaSlicer
the user installed themselves, put the G-code in the file library, and
optionally on a printer's queue - where it still has to pass the Confirm
Print gate before anything prints.

Like go2rtc and cloudflared, OrcaSlicer is a separate program: this file
never bundles, downloads or installs it, and it's off by default. Nothing
here imports it either - it runs it, with Python's own subprocess module,
exactly the way a person would from a terminal:

    orca-slicer --slice 0 \\
        --load-settings "machine.json;process.json" \\
        --load-filaments "filament.json" \\
        --outputdir <temp folder> model.stl

How that command line works was read from OrcaSlicer's source
(github.com/OrcaSlicer/OrcaSlicer, tag v2.4.2), not assumed:
  - options are defined in src/libslic3r/PrintConfig.cpp (CLIActionsConfigDef,
    CLIMiscConfigDef): --slice <plate, 0 = all>, --load-settings,
    --load-filaments (lists separated by ";"), --outputdir
  - src/OrcaSlicer.cpp writes each plate as <outputdir>/plate_<n>.gcode and,
    on Linux only, <outputdir>/result.json with "return_code" and
    "error_string"; a bare STL is arranged on the plate by default
  - a preset file must say where it came from ("from": "system" or "User")
    and what it is ("type": machine / process / filament)
  - error codes are listed in src/libslic3r/Utils.hpp (CLI_* defines)

What's genuinely fragile, said plainly: this drives another program's
automation surface from outside. Orca can rename an option, change a
preset rule or move its output between versions, and nothing on this side
would know until a slice fails. So every run
  - has a hard time limit and is killed (with anything it started) past it,
  - is judged by what actually came out - a G-code file that exists, reads
    as G-code and has layers - not by the exit code alone,
  - reports failure in words, with the end of Orca's own output attached,
  - records the Orca version it ran with, so "it worked last month" can be
    traced to an update.
OrcaSlicer 2.4.2 has produced a real U1 bracket slice through this bridge on
Linux. The portable unit tests still use a stand-in executable; physical
printing and other operating systems remain unverified.
"""

import json
import os
import platform
import re
import shutil
import signal
import sys
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime

import engine_support
import file_library
import gcode_tools
import slice_diagnosis
import storage
import slicer_profiles
import slicing_contract
import project_plates
import tool_setup
import mock_moonraker
import model_maker

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "slicer.json")
_RECEIPTS = os.path.join(_DATA_DIR, "slice-receipts.json")   # the last slices, kept across a restart
ENV_PATH = "DEJAVU_SLICER_PATH"

DEFAULT_TIMEOUT = 600
MIN_TIMEOUT, MAX_TIMEOUT = 30, 3600
CHECK_TIMEOUT = 30
MAX_PROFILES = 20
MAX_PRESET_BYTES = 4 * 1024 * 1024
MAX_JOBS_KEPT = 20
_TAIL = 2000

# src/libslic3r/Utils.hpp, in words a person can act on. Anything else falls
# back to Orca's own error_string from result.json.
ORCA_ERRORS = {
    -1: "Orca couldn't start its environment (a missing library or display?)",
    -2: "Orca refused the command line - an option may have changed in this Orca version",
    -3: "Orca couldn't find one of the files it was given",
    -5: "Orca couldn't load one of the preset files - check they are machine / process / filament presets",
    -6: "Orca couldn't read the model file",
    -14: "Orca ran out of memory",
    -17: "The process preset isn't compatible with the machine preset",
    -50: "Nothing to slice - no printable objects on the plate",
    -51: "Orca's validity check failed (for example, an object is outside the printable area)",
    -52: "Part of the model is outside the printable area",
    -58: "Slicing took longer than Orca's own time limit",
    -100: "Orca hit an error while slicing",
    -101: "Orca found toolpath conflicts in the result",
    -102: "Some toolpaths would land in an unprintable area",
}

_lock = threading.RLock()
_run_lock = threading.Lock()     # one slice at a time: it's heavy, and Orca isn't built to share
_jobs = {}
_order = []
_traces = {}        # job id -> what the slice learned on its way (the report's source); kept apart so the
                    # job list the browser polls every second stays small
_cancellations = {}
_operation = threading.local()


class SliceCancelled(ValueError):
    pass


class EngineStartFailed(ValueError):
    """The system refused to start the engine at all; `cause` says why."""

    def __init__(self, message, cause):
        super().__init__(message)
        self.cause = cause


def _program_identity(path):
    try:
        stat = os.stat(path)
        return [os.path.realpath(path), stat.st_size, stat.st_mtime_ns]
    except OSError:
        return None


def engine_capabilities(settings=None):
    s = settings or get_settings()
    path, _ = slicer_path(s)
    checked = s.get('last_check') or {}
    if checked.get('ok') and checked.get('program_identity') == _program_identity(path):
        return checked.get('capabilities') or {}
    return {}


def engine_changed(settings, path):
    """
    Words when the program is no longer the one that was last checked (updated,
    replaced, or another engine chosen), otherwise None. A slice then waits for
    a new check, so an engine is never swapped for another without being read.
    """
    checked = settings.get('last_check') or {}
    if not (checked.get('ok') and checked.get('program_identity')):
        return None
    if checked['program_identity'] == _program_identity(path):
        return None
    return ("The slicer program changed since it was last checked (it was updated, replaced or another one was "
            "chosen), so Deja Vu1 doesn't know which version it is now. Press Check slicer, then slice again")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def _defaults():
    return {"slicer_path": "", "timeout_s": DEFAULT_TIMEOUT, "profiles": [], "default_profile": None,
            "last_check": None, "preset_folder": ""}


def get_settings():
    with _lock:
        data = storage.load_json(_PATH, None)
    if not isinstance(data, dict):
        data = _defaults()
    for key, value in _defaults().items():
        data.setdefault(key, value)
    return data


def _save(data):
    with _lock:
        storage.save_json(_PATH, data)


def slicer_path(settings=None):
    """The environment variable wins: whoever starts the server chose it."""
    env = os.environ.get(ENV_PATH, "").strip()
    if env:
        return env, "environment"
    configured = (settings or get_settings()).get("slicer_path", "")
    if configured:
        return configured, "settings"
    # Snapmaker's build names its program "snapmaker-orca" (its CMakeLists.txt,
    # OUTPUT_NAME); the stock build "orca-slicer". The install folders below are
    # the usual ones; each is only used if the program is really there.
    candidates = [shutil.which("snapmaker-orca"), shutil.which("orca-slicer"), shutil.which("OrcaSlicer"),
                  "/Applications/Snapmaker Orca.app/Contents/MacOS/Snapmaker Orca",
                  "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer"]
    if os.name == "nt":
        programs = os.environ.get("ProgramFiles", "C:\\Program Files")
        candidates += [os.path.join(programs, "Snapmaker_Orca", "snapmaker-orca.exe"),
                       os.path.join(programs, "Snapmaker Orca", "snapmaker-orca.exe"),
                       os.path.join(programs, "OrcaSlicer", "orca-slicer.exe")]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate, "detected"
    return "", "settings"


MAX_FOUND = 12          # programs listed by find_slicers
_MAX_LISTED = 400       # entries read per folder, so a huge Downloads folder stays quick


def _search_places():
    """Where people usually keep the slicer: (folder, label) pairs, one level deep."""
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        return [("/Applications", "Applications"), (os.path.join(home, "Applications"), "your Applications"),
                (os.path.join(home, "Downloads"), "Downloads")]
    if os.name == "nt":
        places = []
        for var, label in (("ProgramFiles", "Program Files"), ("ProgramFiles(x86)", "Program Files (x86)"),
                           ("LOCALAPPDATA", "your programs")):
            base = os.environ.get(var)
            if base:
                places.append((os.path.join(base, "Programs") if var == "LOCALAPPDATA" else base, label))
        return places + [(os.path.join(home, "Downloads"), "Downloads"), (os.path.join(home, "Desktop"), "Desktop")]
    # Linux: AppImages are usually left in Downloads or Applications; Flatpak
    # installs leave a launcher in its exports folder.
    return [(os.path.join(home, "Applications"), "Applications"), (os.path.join(home, "Downloads"), "Downloads"),
            (os.path.join(home, "Desktop"), "Desktop"), (home, "your home folder"),
            (os.path.join(home, ".local", "bin"), "your programs"), ("/opt", "/opt"),
            ("/usr/local/bin", "installed programs"), ("/usr/bin", "installed programs"),
            ("/var/lib/flatpak/exports/bin", "Flatpak"),
            (os.path.join(home, ".local", "share", "flatpak", "exports", "bin"), "Flatpak")]


def _listing(folder):
    try:
        with os.scandir(folder) as it:
            return [entry for _, entry in zip(range(_MAX_LISTED), it)]
    except OSError:
        return []


def _could_be_program(path):
    """A file named like the slicer that is a program, not an installer or a project."""
    name = os.path.basename(path).lower()
    if "orca" not in name or name.startswith(".") or any(w in name for w in ("install", "setup", "uninst")):
        return False
    if not os.path.isfile(path):
        return False
    if os.name == "nt":
        return name.endswith(".exe")
    return name.endswith(".appimage") or ("." not in name and os.access(path, os.X_OK))


def _program_files(entry):
    """The slicer programs a folder entry stands for: itself, or those inside an app folder."""
    name = entry.name.lower()
    if "orca" not in name or name.startswith("."):
        return []
    try:
        is_dir = entry.is_dir()
    except OSError:
        return []
    if not is_dir:
        return [entry.path] if _could_be_program(entry.path) else []
    inner = os.path.join(entry.path, "Contents", "MacOS") if name.endswith(".app") else entry.path
    found = [e.path for e in _listing(inner) if _could_be_program(e.path)]
    if not found and not name.endswith(".app"):       # /opt/OrcaSlicer/bin/orca-slicer
        found = [e.path for e in _listing(os.path.join(entry.path, "bin")) if _could_be_program(e.path)]
    return found


def find_slicers(places=None):
    """
    Look for installed Snapmaker Orca and OrcaSlicer programs in the usual
    places. Nothing is run or changed; the person picks one and it is saved
    as the slicer path the normal way (save_settings, then check).
    """
    current, _ = slicer_path()
    seen, found = set(), []
    for folder, label in (places if places is not None else _search_places()):
        for entry in _listing(folder):
            for path in _program_files(entry):
                real = os.path.realpath(path)
                if real in seen or len(found) >= MAX_FOUND:
                    continue
                seen.add(real)
                runnable = os.access(path, os.X_OK)
                found.append({
                    "path": path,
                    "name": "Snapmaker Orca" if "snapmaker" in path.lower() else "OrcaSlicer",
                    "where": label,
                    "runnable": runnable,
                    "hint": None if runnable else "Found, but it isn't allowed to run yet. On Linux, right-click it, "
                                                  "open Properties and allow it to run as a program (or chmod +x it).",
                    "in_use": bool(current) and os.path.realpath(current) == real,
                })
    found.sort(key=lambda f: (not f["in_use"], not f["runnable"], f["name"] != "Snapmaker Orca"))
    return {"found": found, "searched": sorted({label for _, label in (places if places is not None else _search_places())}),
            "current": current or None}


def _looks_like_orca(path):
    # This dashboard has no login, so the path is limited to something that
    # is at least named like Orca - the setting can't point at any program.
    # DEJAVU_SLICER_PATH (set by whoever runs the server) skips this.
    return "orca" in os.path.basename(path).lower()


def _check_program(path, source):
    """Why this path can't be run, in words - or None when it can."""
    if not path:
        return ("No slicer set up. Install Snapmaker Orca or OrcaSlicer yourself (Deja Vu1 finds them in "
                "their usual places), or enter the full path to its program (for example "
                "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer, "
                "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe, or the .AppImage you downloaded)")
    if not os.path.isabs(path):
        return "Use the full path to the slicer program, starting from the top of the disk"
    if source == "settings" and not _looks_like_orca(path):
        return ("For safety, the program's file name must contain \"orca\" (this dashboard has no "
                f"login). To use another name, start the server with {ENV_PATH} set to it instead")
    if os.path.isdir(path):
        if path.lower().endswith(".app"):
            return "That's the app bundle - point at the program inside it: <App>.app/Contents/MacOS/OrcaSlicer"
        return "That's a folder, not the slicer program"
    if not os.path.exists(path):
        return f"Nothing exists at {path} - is OrcaSlicer installed there?"
    if not os.access(path, os.X_OK):
        return f"{path} exists but isn't allowed to run (on Linux: chmod +x it)"
    return None


def public_settings():
    s = get_settings()
    path, source = slicer_path(s)
    return {"slicer_path": path, "path_source": source, "timeout_s": s["timeout_s"],
            "profiles": s["profiles"], "default_profile": s["default_profile"],
            "last_check": s["last_check"], "preset_folder": s.get("preset_folder", ""), "problem": _check_program(path, source),
            "fragile_note": ("This drives OrcaSlicer's command line from outside. An Orca update can "
                             "change it; when that happens slicing fails here with Orca's own message, "
                             "rather than producing a file.")}


def save_settings(body):
    s = get_settings()
    if "slicer_path" in body:
        path = str(body.get("slicer_path") or "").strip().strip('"')
        if len(path) > 400:
            raise ValueError("That path is too long")
        if path and not os.path.isabs(path):
            raise ValueError("Use the full path to the slicer program, starting from the top of the disk")
        if path and not _looks_like_orca(path):
            raise ValueError("For safety, the program's file name must contain \"orca\" (this dashboard "
                             f"has no login). To use another name, start the server with {ENV_PATH} set to it")
        if path != s["slicer_path"]:
            s["last_check"] = None
        s["slicer_path"] = path
    if "preset_folder" in body:
        folder = str(body.get("preset_folder") or "").strip()
        if folder:
            if not os.path.isabs(folder) or len(folder) > 500:
                raise ValueError("Use the full path to an unpacked presets folder")
            slicer_profiles.roots("", folder)
        s["preset_folder"] = folder
    if "timeout_s" in body:
        try:
            t = int(body["timeout_s"])
        except (TypeError, ValueError):
            raise ValueError("The time limit must be a whole number of seconds")
        if not MIN_TIMEOUT <= t <= MAX_TIMEOUT:
            raise ValueError(f"The time limit must be between {MIN_TIMEOUT} and {MAX_TIMEOUT} seconds")
        s["timeout_s"] = t
    if "default_profile" in body:
        pid = body["default_profile"]
        if pid is not None and not any(p["id"] == pid for p in s["profiles"]):
            raise ValueError("Unknown profile")
        s["default_profile"] = pid
    _save(s)
    return public_settings()


# ---------------------------------------------------------------------------
# Profiles: which machine / process / filament presets to slice with
# ---------------------------------------------------------------------------

def read_preset(path, expected_type):
    """
    Read one Orca preset file and check it's what Orca's command line will
    accept in that slot, before Orca is ever started. Returns its name.
    """
    path = str(path or "").strip().strip('"')
    what = {"machine": "machine (printer)", "process": "process (print settings)",
            "filament": "filament"}[expected_type]
    if not path:
        raise ValueError(f"Choose a {what} preset file")
    if not os.path.isabs(path):
        raise ValueError(f"Use the full path to the {what} preset")
    if not path.lower().endswith(".json"):
        raise ValueError(f"The {what} preset must be a .json file exported from or saved by Orca")
    if not os.path.isfile(path):
        raise ValueError(f"No file at {path}")
    if os.path.getsize(path) > MAX_PRESET_BYTES:
        raise ValueError(f"{os.path.basename(path)} is too large to be a preset")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, UnicodeDecodeError):
        raise ValueError(f"{os.path.basename(path)} isn't valid JSON, so it can't be an Orca preset")
    except OSError as exc:
        raise ValueError(f"Couldn't read {os.path.basename(path)}: {exc.strerror or exc}")
    if not isinstance(data, dict):
        raise ValueError(f"{os.path.basename(path)} isn't an Orca preset (not a settings object)")
    kind = data.get("type")
    if kind and kind != expected_type:
        raise ValueError(f"{os.path.basename(path)} is a {kind} preset, but this slot needs a {what} preset")
    if not kind:
        raise ValueError(f"{os.path.basename(path)} doesn't say what kind of preset it is (\"type\"). "
                         "Orca 2.3's command line refuses presets without it")
    if data.get("from") not in ("system", "User", "user"):
        raise ValueError(f"{os.path.basename(path)} has \"from\": {json.dumps(data.get('from'))}; Orca's "
                         "command line only loads system or User presets")
    return str(data.get("name") or os.path.basename(path))


def add_profile(name, machine, process, filaments):
    name = str(name or "").strip()[:60]
    if not name:
        raise ValueError("Give the profile a name")
    if isinstance(filaments, str):
        filaments = [filaments]
    filaments = [f for f in (filaments or []) if str(f or "").strip()]
    if not filaments:
        raise ValueError("Choose at least one filament preset")
    if len(filaments) > 4:
        raise ValueError("The U1 has four toolheads - at most four filament presets")
    entry = {"id": f"prof-{uuid.uuid4().hex[:6]}", "name": name,
             "machine": str(machine).strip().strip('"'), "process": str(process).strip().strip('"'),
             "filaments": [str(f).strip().strip('"') for f in filaments],
             "added_at": datetime.now().isoformat(timespec="seconds")}
    names = {"machine": read_preset(entry["machine"], "machine"),
             "process": read_preset(entry["process"], "process"),
             "filaments": [read_preset(f, "filament") for f in entry["filaments"]]}
    entry["preset_names"] = names
    entry["warnings"] = []
    if "u1" not in names["machine"].lower():
        entry["warnings"].append(f"The machine preset is \"{names['machine']}\", which doesn't mention the U1 "
                                 "- the G-code will be for whatever printer it describes")
    s = get_settings()
    if len(s["profiles"]) >= MAX_PROFILES:
        raise ValueError(f"At most {MAX_PROFILES} profiles")
    s["profiles"].append(entry)
    if not s["default_profile"]:
        s["default_profile"] = entry["id"]
    _save(s)
    return entry


def remove_profile(profile_id):
    s = get_settings()
    kept = [p for p in s["profiles"] if p["id"] != profile_id]
    if len(kept) == len(s["profiles"]):
        raise ValueError("Unknown profile")
    s["profiles"] = kept
    if s["default_profile"] == profile_id:
        s["default_profile"] = kept[0]["id"] if kept else None
    _save(s)
    return public_settings()


def installed_catalog():
    path, _ = slicer_path()
    return slicer_profiles.catalog(path, get_settings().get("preset_folder"))


def add_installed_profile(body):
    path, _ = slicer_path()
    prepared = slicer_profiles.prepare(path, body, tool_setup.get()['heads'], engine_capabilities(), get_settings().get('preset_folder'))
    entry = add_profile(body.get('name'), prepared['machine'], prepared['process'], prepared['filaments'])
    s = get_settings()
    saved = next(p for p in s['profiles'] if p['id'] == entry['id'])
    saved.update({k: prepared[k] for k in ('options','tool_setup','layer_plan','source','warnings','layer_mode','material_options')})
    saved['printer_id'] = mock_moonraker.selected_printer_id()
    saved['preset_selection'] = {k: body.get(k) for k in ('machine','process','filaments')}
    saved['allow_material_variant'] = body.get('allow_material_variant') is True
    saved['allow_nozzle_variant'] = body.get('allow_nozzle_variant') is True
    s['default_profile']=saved['id']
    _save(s)
    return public_settings()


# ---------------------------------------------------------------------------
# Running the program
# ---------------------------------------------------------------------------

def _tail(data):
    text = (data or b"").decode("utf-8", errors="replace") if isinstance(data, bytes) else (data or "")
    return text[-_TAIL:].strip()


def _run(cmd, timeout, cwd=None):
    """
    Run a program with a hard time limit. Returns (code, stdout, stderr),
    or code None when it had to be stopped. Started in its own process
    group so an AppImage (which starts the real program as a child) is
    stopped along with everything it started.
    """
    kwargs = {"stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "cwd": cwd}
    if os.name == "posix":
        kwargs["start_new_session"] = True
    else:
        # No console window: the Windows build opens one of its own for `--help` when it finds none to attach to.
        kwargs["creationflags"] = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                                   | getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        proc = subprocess.Popen(cmd, **kwargs)
    except PermissionError as exc:
        cause = slice_diagnosis.from_start(13, exc.strerror, name=os.path.basename(cmd[0]))
        raise EngineStartFailed(f"{cmd[0]} isn't allowed to run (on Linux: chmod +x it)", cause)
    except OSError as exc:
        cause = slice_diagnosis.from_start(exc.errno, exc.strerror or str(exc), getattr(exc, "winerror", None),
                                           name=os.path.basename(cmd[0]))
        known = cause["code"] != "cannot_start"
        raise EngineStartFailed(cause["title"] if known else
                                f"Couldn't start {os.path.basename(cmd[0])}: {exc.strerror or exc}", cause)
    end = time.monotonic() + timeout
    cancelled = False
    while True:
        event = getattr(_operation, 'cancel', None)
        cancelled = bool(event and event.is_set())
        if cancelled or time.monotonic() >= end:
            break
        try:
            out, err = proc.communicate(timeout=min(.25, max(.01, end-time.monotonic())))
            return proc.returncode, out, err
        except subprocess.TimeoutExpired:
            continue
    if cancelled or time.monotonic() >= end:
        try:
            if os.name == "posix":
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except OSError:
            pass
        try:
            # Bounded too: a helper Orca started in a session of its own could
            # keep the output pipes open after the group is gone.
            out, err = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            for pipe in (proc.stdout, proc.stderr):
                try:
                    pipe.close()
                except OSError:
                    pass
            out, err = b"", b"(Orca's output couldn't be collected after it was stopped)"
        if cancelled:
            raise SliceCancelled('Slicing cancelled. No output was queued')
        return None, out, err


def _export_schema(path, work):
    """
    Ask the engine to write its settings to a file (`--export-settings`) and read them back. This works on
    every system: the file is written to disk, whatever happens to the program's printed output.
    """
    target = os.path.join(work, 'defaults.json')
    _run([path, '--export-settings', target], CHECK_TIMEOUT, cwd=work)
    if os.path.isfile(target) and os.path.getsize(target) <= MAX_PRESET_BYTES:
        schema = storage.load_json(target, {})
        if isinstance(schema, dict):
            return schema
    return {}


def _settings_file_is_orca(schema):
    """The file OrcaSlicer's `--export-settings` writes: a version, then every print option by name."""
    return (isinstance(schema.get("version"), str) and bool(schema["version"].strip())
            and "layer_height" in schema and "nozzle_diameter" in schema)


def _app_from_name(path):
    return "Snapmaker_Orca" if "snapmaker" in os.path.basename(path).lower() else "OrcaSlicer"


def _capabilities(schema, options):
    # Read actual CLI options; names/versions alone do not prove support.
    return {
        'per_tool_heights': 'extruder_layer_height' in schema or bool(re.search(rb'--extruder-layer-height(?:\s|=)', options)),
        'exact_tool_heights': 'extruder_layer_height_exact' in schema or b'--extruder-layer-height-exact' in options,
        'thick_layer_modes': 'extruder_layer_height_mode' in schema or b'--extruder-layer-height-mode' in options,
    }


def _check_by_settings_file(path, started):
    """
    The way on when `--help` prints nothing we can read. Snapmaker Orca and OrcaSlicer on Windows send the help
    text to a console window of their own, so a program that reads their output (this one) gets only log lines
    (Snapmaker_Orca.cpp, `attach_console_on_demand`, called from `print_help`). The settings file still arrives,
    and it carries the version (`save_to_json(... Snapmaker_VERSION)`). Returns an ok result, or None.
    """
    try:
        with tempfile.TemporaryDirectory(prefix='dejavu-engine-check-') as work:
            schema = _export_schema(path, work)
    except ValueError:
        return None
    if not _settings_file_is_orca(schema):
        return None
    app, version = _app_from_name(path), schema["version"].strip()
    return {"ok": True, "app": app, "version": version,
            "detail": f"{app} {version} wrote its settings file in {(time.monotonic() - started):.1f} s. "
                      "This build prints its help to a console window instead of to Deja Vu1, "
                      "so the version came from that file",
            "support": engine_support.assess(app, version, platform.system()),
            "capabilities": _capabilities(schema, b""),
            "capability_evidence": "Exported option schema; actual output still requires inspection",
            "checked_by": "settings file",
            "program_identity": _program_identity(path)}


def check():
    """
    Is the slicer there and does it answer like OrcaSlicer's command line?
    Runs `<slicer> --help`, whose first line is "<AppKey>-<version>:"
    (CLI::print_help in src/OrcaSlicer.cpp). A build that exits cleanly but prints no such line
    (the Windows ones: see _check_by_settings_file) is asked for its settings file instead.
    """
    s = get_settings()
    path, source = slicer_path(s)
    problem = _check_program(path, source)
    if problem:
        result = {"ok": False, "error": problem}
    else:
        started = time.monotonic()
        started_cause = None
        try:
            with tempfile.TemporaryDirectory(prefix='dejavu-engine-check-') as work:
                code, out, err = _run([path, "--help"], CHECK_TIMEOUT, cwd=work)
        except ValueError as exc:
            code, out, err = "failed", b"", str(exc).encode()
            started_cause = getattr(exc, "cause", None)
        text = _tail(out) or _tail(err)
        first = next((ln.strip() for ln in (out or b"").decode("utf-8", "replace").splitlines() if ln.strip()), "")
        match = next((m for line in (out or b"").decode("utf-8", "replace").splitlines() if (m := re.match(r"^([A-Za-z_][\w ]*?)-(\d[\w.\-+]*):?$", line.strip()))), None)
        cause = None
        by_file = _check_by_settings_file(path, started) if code == 0 and not match else None
        if by_file:
            result = by_file
        elif code == "failed":
            result = {"ok": False, "error": _tail(err)}
            cause = started_cause
        elif code is None:
            result = {"ok": False, "error": f"{os.path.basename(path)} didn't answer within {CHECK_TIMEOUT} s "
                                            "(it may be waiting for a screen, or it isn't a command-line build)"}
            cause = slice_diagnosis.make(
                "no_answer", result["error"], "The engine was stopped because it never finished printing its help.",
                ["Use the engine's command-line program, not a launcher that opens a window."])
        elif match:
            result = {"ok": True, "app": match.group(1), "version": match.group(2),
                      "detail": f"{match.group(1)} {match.group(2)} answered in "
                                f"{(time.monotonic() - started):.1f} s",
                      "support": engine_support.assess(match.group(1), match.group(2), platform.system())}
            with tempfile.TemporaryDirectory(prefix='dejavu-capabilities-') as work:
                _, options, _ = _run([path, '--help-fff'], CHECK_TIMEOUT, cwd=work)
                schema = _export_schema(path, work) if b'--export-settings' in out else {}
            result['capabilities'] = _capabilities(schema, options)
            result['capability_evidence'] = 'Exported option schema and command-line help; actual output still requires inspection'
            result['program_identity'] = _program_identity(path)
        else:
            # A program that can't load what it needs prints nothing on stdout, so the old "no output" headline
            # hid the one line that says what to fix. Read both streams and the way it ended first.
            both = (out or b"").decode("utf-8", "replace") + "\n" + (err or b"").decode("utf-8", "replace")
            cause = slice_diagnosis.from_text(both) or slice_diagnosis.from_exit(code)
            if cause:
                result = {"ok": False, "error": cause["title"], "output": text}
            else:
                result = {"ok": False, "error": "It ran, but didn't answer like OrcaSlicer's command line"
                                                + (f" (it said: {first[:120]!r})" if first else " (no output)")
                                                + (f"; it exited with code {code}" if code else ""),
                          "output": text}
                cause = slice_diagnosis.make("not_orca", result["error"], "", [
                    "Point Deja Vu1 at the slicer's own program (Snapmaker Orca or OrcaSlicer).",
                    "Press Find it for me to list the ones installed on this computer."], evidence=text[-240:] or None)
        if code not in ("failed", None):
            result["exit_code"] = code
    if not result["ok"]:
        found = None if problem else cause
        result["cause"] = found or slice_diagnosis.for_stage("engine", result["error"])
    result["checked_at"] = datetime.now().isoformat(timespec="seconds")
    s = get_settings()
    s["last_check"] = result
    _save(s)
    return result


def _profile(profile_id, settings):
    pid = profile_id or settings.get("default_profile")
    prof = next((p for p in settings["profiles"] if p["id"] == pid), None)
    if prof is None:
        raise ValueError("Choose a slicing profile first (Files → Slicing → Profiles)")
    return prof


def command_for(slicer, profile, model_path, outdir):
    """The exact command line - kept in one place so it's shown and tested as run."""
    return [slicer, "--slice", "0",
            "--load-settings", f"{profile['machine']};{profile['process']}",
            "--load-filaments", ";".join(profile["filaments"]),
            "--outputdir", outdir, model_path]


def _free_name(stem, plate, plates):
    base = f"{stem}{'' if plates == 1 else f'_plate{plate}'}"
    name = f"{base}.gcode"
    n = 2
    while file_library.exists(name):
        name = f"{base}-{n}.gcode"
        n += 1
    return file_library.clean_name(name)


def _explain(code, result_json, err_tail, out_tail):
    rc = result_json.get("return_code") if isinstance(result_json, dict) else None
    words = ORCA_ERRORS.get(rc) if rc is not None else None
    orca_says = (result_json or {}).get("error_string") if isinstance(result_json, dict) else None
    if words and orca_says:
        return f"{words}. Orca said: {orca_says}"
    if words or orca_says:
        return words or f"Orca said: {orca_says}"
    if code is not None and code < 0 and os.name == "posix":
        return f"Orca stopped unexpectedly (signal {-code}) - it may have crashed"
    last = (err_tail or out_tail).splitlines()[-1:] or [""]
    return f"Orca exited with code {code}" + (f": {last[0][:200]}" if last[0] else "")


def diagnose(code, result_json, out, err):
    """
    (headline, cause) for an engine run that failed. A message the system
    printed (a missing library, no screen) is more exact than Orca's own
    "couldn't start" code, so it wins there; otherwise Orca's own code and
    words do, then the way the process ended, then its last line.
    """
    def as_text(data):
        return data.decode("utf-8", "replace") if isinstance(data, bytes) else (data or "")

    rc = result_json.get("return_code") if isinstance(result_json, dict) else None
    from_system = slice_diagnosis.from_text(as_text(out) + "\n" + as_text(err))
    if from_system and rc in (None, -1):
        return from_system["title"], from_system
    words = ORCA_ERRORS.get(rc) if rc is not None else None
    says = result_json.get("error_string") if isinstance(result_json, dict) else None
    if words or says:
        return _explain(code, result_json, "", ""), slice_diagnosis.from_orca(rc, words, says)
    ended = slice_diagnosis.from_exit(code)
    if ended:
        return ended["title"], ended
    headline = _explain(code, result_json, _tail(err), _tail(out))
    last = (_tail(err) or _tail(out)).splitlines()[-1:] or [""]
    return headline, slice_diagnosis.make(
        "engine_exit", headline, "", ["Open the report: the last lines of the engine's output say what failed."],
        evidence=last[0][:240] or None)


class SliceFailed(ValueError):
    def __init__(self, message, report, cause=None):
        super().__init__(message)
        self.report = report
        self.cause = cause


def slice_model(name, profile_id=None, on_step=None, trace=None):
    """
    Slice one library model and add the G-code to the library. Returns a
    report; raises ValueError (in words) for anything that went wrong.
    `trace`, when given, is filled in as the slice goes (stage reached,
    input, engine, profile, run, output) so a failure at any stage can be
    reported in full by `_receipt`.
    """
    step = on_step or (lambda text: None)
    trace = trace if trace is not None else {}
    trace["stage"] = "input"
    kind = file_library.kind_of(name or "")
    if kind not in ("stl", "3mf"):
        raise ValueError("Only STL and 3MF models can be sliced - G-code is already sliced")
    data = file_library.read_bytes(name)
    plate_count = project_plates.describe_data(data)['count'] if kind == '3mf' else None
    trace["input"] = slice_diagnosis.file_facts(name, kind, data, plate_count)
    if kind == '3mf' and plate_count > 1:
        raise ValueError('Choose and save one plate in the workspace before slicing this multi-plate project')
    trace["stage"] = "engine"
    s = get_settings()
    path, source = slicer_path(s)
    trace["engine"] = _engine_facts(s, path, source)
    problem = _check_program(path, source)
    if problem:
        raise ValueError(problem)
    changed = engine_changed(s, path)
    if changed:
        raise ValueError(changed)
    trace["stage"] = "profile"
    profile = _profile(profile_id, s)
    trace["profile"] = _profile_facts(profile)
    if profile.get('layer_mode') == 'per_tool' and not engine_capabilities(s).get('per_tool_heights'):
        raise ValueError('The selected engine changed or lacks per-tool heights. Check the engine again before slicing this profile')
    if profile.get('tool_setup'):
        if profile.get('printer_id') != mock_moonraker.selected_printer_id():
            raise ValueError("This profile belongs to another printer. Choose or make a profile for this printer")
        if profile['tool_setup'] != tool_setup.get()['heads']:
            raise ValueError("Tool preparation changed after this profile was made. Save a new profile with the current tools")
    step("Checking the preset files")
    for f, t in [(profile["machine"], "machine"), (profile["process"], "process")] + \
            [(f, "filament") for f in profile["filaments"]]:
        read_preset(f, t)           # they may have moved or changed since the profile was saved
    trace["stage"] = "heights"
    with open(profile['process'],encoding='utf-8') as fh:
        materials=[]
        for material in profile['filaments']:
            with open(material, encoding='utf-8') as mf:
                materials.append(json.load(mf))
        process_data=json.load(fh)
    with open(profile['machine'],encoding='utf-8') as fh:
        machine_data=json.load(fh)
    preferred_heights=None
    requested=machine_data.get('extruder_layer_height') or []
    if not isinstance(requested, list):
        raise ValueError('The machine preset has unreadable per-tool heights. Export a complete preset again')
    try:
        requested = [float(h) for h in requested]
    except (ValueError, TypeError):
        raise ValueError('The machine preset has unreadable per-tool heights')
    if any(h!=0 for h in requested):
        if not engine_capabilities(s).get('per_tool_heights'):
            raise ValueError('The selected engine does not advertise per-tool heights. Check a capable engine before using this exported preset; shared-height fallback is refused')
        nozzles=machine_data.get('nozzle_diameter') or []
        if len(requested)!=4 or len(nozzles)!=4 or len(materials)!=4:
            raise ValueError('Per-tool height profiles need four physical nozzle entries and four material presets. Use the native profile editor to assign T0 to T3')
        try:
            base=float(process_data.get('layer_height') or .2)
            heads=[{'toolhead':'T'+str(i),'nozzle':float(n),'height':h if h!=0 else base} for i,(n,h) in enumerate(zip(nozzles,requested))]
            plan=slicing_contract.tool_layers(heads,process_data.get('initial_layer_print_height') or base)
        except (TypeError, KeyError):
            raise ValueError('The exported nozzle/height combination is unsupported. Use the native profile editor')
        if abs(base-plan['grid'])>1e-6:
            raise ValueError(f"Set the exported process layer height to the exact {plan['grid']:g} mm coordination grid, or make a native profile")
        preferred_heights=[h['height'] for h in heads]
    model_maker.check_slice_contract(data,process_data,materials,preferred_heights=preferred_heights)
    trace["stage"] = "prepare"
    input_notes=[]
    if kind == '3mf':
        data, input_notes = project_plates.engine_input(data, materials)

    work = tempfile.mkdtemp(prefix="dejavu-slice-")
    try:
        model_path = os.path.join(work, file_library.clean_name(name))
        outdir = os.path.join(work, "out")
        os.makedirs(outdir)
        with open(model_path, "wb") as fh:
            fh.write(data)
        cmd = command_for(path, profile, model_path, outdir)
        timeout = int(s.get("timeout_s") or DEFAULT_TIMEOUT)
        step(f"Slicing with {os.path.basename(path)} (time limit {timeout} s)")
        trace["stage"] = "slice"
        started = time.monotonic()
        code, out, err = _run(cmd, timeout, cwd=work)
        seconds = round(time.monotonic() - started, 1)
        out_tail, err_tail = _tail(out), _tail(err)
        result_json = None
        rpath = os.path.join(outdir, "result.json")
        if os.path.isfile(rpath):
            result_json = storage.load_json(rpath, None)
        report = {"command": [os.path.basename(cmd[0])] + cmd[1:-2] + ["<temp folder>", os.path.basename(name)],
                  "seconds": seconds, "exit_code": code, "orca_result": result_json,
                  "output_tail": out_tail[-800:], "error_tail": err_tail[-800:],
                  "orca_version": (s.get("last_check") or {}).get("version")}
        report['input_notes']=input_notes
        trace["run"] = {"command": _shown_command(report["command"]), "seconds": seconds, "exit_code": code,
                        "timeout_s": timeout, "orca_result": result_json,
                        "stdout": slice_diagnosis.log_window(out), "stderr": slice_diagnosis.log_window(err)}
        if code is None:
            message = (f"Slicing didn't finish within {timeout} s, so it was stopped. A big model can "
                       "need longer (raise the time limit), or Orca may be stuck waiting for a screen")
            raise SliceFailed(message, report, slice_diagnosis.make(
                "timeout", message, "", ["Raise the time limit in Files, Slicing, or try a smaller model."]))
        rc = result_json.get("return_code") if isinstance(result_json, dict) else None
        plates = sorted((f for f in os.listdir(outdir) if re.match(r"^plate_\d+\.gcode$", f)),
                        key=lambda f: int(re.findall(r"\d+", f)[0]))
        trace["output"] = {"result_json": result_json is not None, "status": "none",
                           "plates": [{"file": f, "bytes": os.path.getsize(os.path.join(outdir, f))} for f in plates]}
        if code != 0 or (rc not in (None, 0)):
            headline, cause = diagnose(code, result_json, out, err)
            raise SliceFailed(headline, report, cause)
        trace["stage"] = "output"
        if not plates:
            trace["output"]["status"] = "no_plate_files"
            message = ("Orca finished without an error but wrote no G-code (no plate_*.gcode in its "
                       "output folder). Its output layout may have changed in this version")
            raise SliceFailed(message, report, slice_diagnosis.make(
                "no_gcode", message, "", ["Press Check slicer to see which engine version this is.",
                                          "If you updated the engine recently, go back to the version that worked."]))

        step("Checking the G-code that came out")
        stem = os.path.splitext(file_library.clean_name(name))[0]
        saved = []
        for plate_file in plates:
            with open(os.path.join(outdir, plate_file), "rb") as fh:
                gcode = fh.read()
            if not gcode.strip():
                trace["output"]["status"] = "empty"
                message = f"Orca wrote {plate_file}, but it's empty"
                raise SliceFailed(message, report, slice_diagnosis.make(
                    "empty_gcode", message, "", ["Slice again. If it stays empty, copy the report to ask for help."]))
            analysis = gcode_tools.analyze(gcode.decode("utf-8", errors="replace"), want_toolpath=False)
            if not analysis["layers"] or not analysis["filament_mm"]:
                trace["output"]["status"] = "no_layers"
                message = (f"Orca wrote {plate_file}, but it has no printable layers in it - "
                           "refusing to add a file that would print nothing")
                raise SliceFailed(message, report, slice_diagnosis.make(
                    "no_layers", message, "", ["Check that the model is large enough to print and has a filament "
                                               "assigned to every part."]))
            trace["stage"] = "save"
            plate_no = int(re.findall(r"\d+", plate_file)[0])
            out_name = _free_name(stem, plate_no, len(plates))
            entry = file_library.save(out_name, gcode, origin="sliced",
                                      note=f"Sliced from {name} with \"{profile['name']}\""
                                           + (f" by OrcaSlicer {report['orca_version']}" if report["orca_version"] else ""))
            saved.append({"name": entry["name"], "layers": analysis["layers"],
                          "deposition": slicing_contract.deposition_evidence(gcode.decode('utf-8', 'replace')) if preferred_heights else None,
                          "estimated_hours": analysis["meta"].get("estimated_hours"),
                          "filament_grams": analysis["meta"].get("filament_grams"),
                          "preflight": analysis["preflight"]["verdict"]})
        report["files"] = saved
        report["profile"] = {"id": profile["id"], "name": profile["name"]}
        trace["output"]["status"] = "ok"
        trace["output"]["saved"] = [f["name"] for f in saved]
        trace["stage"] = "done"
        return report
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------------------
# Reports: one export that says what ran, where it stopped and why
# ---------------------------------------------------------------------------

def _now():
    return datetime.now().isoformat(timespec="seconds")


def _app_facts():
    try:
        import app_updates
        return {"name": "Deja Vu1", "version": app_updates.version()}
    except Exception:                   # noqa: BLE001 - a report must still be made without a version
        return {"name": "Deja Vu1", "version": None}


def _mode_facts(printer_id=None):
    """How Deja Vu1 was running: always the local server (the hosted demo has no engine), and which printer."""
    import watch_only
    pid = printer_id or mock_moonraker.selected_printer_id()
    return {"where": "local Deja Vu1 server", "launcher": os.environ.get("DEJAVU_LAUNCHER") == "1",
            "printer": pid, "printer_is_real": bool(mock_moonraker.is_real(pid)),
            "watch_only": bool(watch_only.is_on())}


def _engine_facts(settings, path, source):
    check = settings.get("last_check") or {}
    identity = _program_identity(path) if path else None
    modified = None
    if identity:
        modified = datetime.fromtimestamp(identity[2] / 1e9).isoformat(timespec="seconds")
    support = None
    if check.get("ok") and check.get("app") and check.get("version"):
        support = engine_support.assess(check["app"], check["version"], platform.system())
    return {"path": slice_diagnosis.redact(path), "source": source, "app": check.get("app"),
            "version": check.get("version"), "size_bytes": identity[1] if identity else None, "modified": modified,
            "capabilities": engine_capabilities(settings), "support": support,
            "last_check": {"ok": check.get("ok"), "at": check.get("checked_at"),
                           "error": slice_diagnosis.redact(check.get("error")) or None,
                           "exit_code": check.get("exit_code")} if check else None}


def _shown_command(command):
    """The command as a report shows it: preset files by name, not by the folders they sit in."""
    shown = []
    for arg in command:
        shown.append(";".join(os.path.basename(p) if os.path.isabs(p) else p for p in arg.split(";")))
    return shown


def _profile_facts(profile):
    return {"id": profile.get("id"), "name": profile.get("name"),
            "machine_preset": os.path.basename(profile.get("machine") or ""),
            "process_preset": os.path.basename(profile.get("process") or ""),
            "filament_presets": [os.path.basename(f) for f in profile.get("filaments") or []],
            "layer_mode": profile.get("layer_mode"), "tool_setup": bool(profile.get("tool_setup")),
            "printer_id": profile.get("printer_id")}


def _receipt(job, trace):
    """Everything about one slice: a report a helper can read without asking the user a single question."""
    stage = trace.get("stage")
    settings = get_settings()
    path, source = slicer_path(settings)
    status = job.get("status")
    message = job.get("error") or job.get("step")
    return {
        "schema": slice_diagnosis.SCHEMA, "kind": "slice", "created_at": _now(),
        "app": _app_facts(), "mode": _mode_facts(job.get("printer_id")), "host": slice_diagnosis.host_facts(),
        "engine": trace.get("engine") or _engine_facts(settings, path, source),
        "profile": trace.get("profile"),
        "input": trace.get("input") or {"name": job.get("model")},
        "stage": {"reached": stage, "label": slice_diagnosis.stage_label(stage),
                  "failed_here": status == "failed"},
        "run": trace.get("run"),
        "output": trace.get("output") or {"status": "none", "plates": []},
        "outcome": {"status": status, "message": slice_diagnosis.redact(message), "cause": job.get("cause")},
        "job": {"id": job.get("id"), "created_at": job.get("created_at"), "started_at": job.get("started_at"),
                "finished_at": job.get("finished_at"), "queued": job.get("queued")},
    }


def export(job_id=None):
    """
    The slicing report. With a job id, that slice in full (also while it is
    still running: the stage it has reached so far). Without one, the engine's
    state and the last few slices in one line each. Home folders are hidden;
    the file names and engine output are the user's to read before sharing.
    """
    if job_id:
        with _lock:
            job = _jobs.get(job_id)
            if not job or job.get("printer_id") != mock_moonraker.selected_printer_id():
                raise ValueError("This slice job is not available for this printer")
            job, trace = dict(job), dict(_traces.get(job_id) or {})
        return _receipt(job, trace)
    settings = get_settings()
    path, source = slicer_path(settings)
    check = settings.get("last_check") or {}
    return {
        "schema": slice_diagnosis.SCHEMA, "kind": "engine", "created_at": _now(),
        "app": _app_facts(), "mode": _mode_facts(), "host": slice_diagnosis.host_facts(),
        "engine": _engine_facts(settings, path, source),
        "problem": slice_diagnosis.redact(_check_program(path, source)) or None,
        "cause": check.get("cause"),
        "recent": [{"id": j["id"], "model": j["model"], "status": j["status"], "stage": j.get("stage"),
                    "cause": (j.get("cause") or {}).get("code"), "finished_at": j.get("finished_at")}
                   for j in jobs()["jobs"][:5]],
    }


def help_lines():
    """The slicing part of Settings' "Copy a report for help", as plain lines."""
    settings = get_settings()
    path, source = slicer_path(settings)
    check = settings.get("last_check")
    lines = [f"Slicer: {slice_diagnosis.redact(path) or 'none set'} ({source})"]
    if check:
        if check.get("ok"):
            lines.append(f"  Last check {check.get('checked_at')}: ok, {check.get('app')} {check.get('version')}")
        else:
            failed = slice_diagnosis.redact(check.get("error"))
            lines.append(f"  Last check {check.get('checked_at')}: failed, {failed}")
            cause = check.get("cause") or {}
            if cause.get("evidence"):
                lines.append(f"  Engine said: {cause['evidence']}")
    with _lock:
        last = [dict(_jobs[j]) for j in _order[-3:]]
    for job in last:
        cause = (job.get("cause") or {}).get("code")
        stage = job.get("stage") or "not started"
        lines.append(f"  Slice {job['id']} of {job['model']}: {job['status']}, stage {stage}"
                     + (f", cause {cause}" if cause else "")
                     + (f", {slice_diagnosis.redact(job['error'])[:200]}" if job.get("error") else ""))
    return lines


# ---------------------------------------------------------------------------
# Jobs: slicing runs in the background, the browser watches its progress
# ---------------------------------------------------------------------------

def _persist_locked():
    """
    Keep the last slices' receipts on disk so a restart (an update, Restart, a crash) does not lose the report
    that explains a failure. The caller holds _lock. A receipt that cannot be written never stops a slice.
    """
    try:
        rows = [{"job": _jobs[j], "trace": _traces.get(j) or {}} for j in _order if j in _jobs]
        # Round-trip through JSON text so anything odd in a trace becomes text instead of an error.
        rows = json.loads(json.dumps(rows, default=str))
        storage.save_json(_RECEIPTS, {"version": 1, "saved_at": _now(), "jobs": rows})
    except (OSError, TypeError, ValueError):
        pass


def _mark_interrupted(job, trace):
    """A slice that was waiting or running when the program stopped did not finish; say so instead of leaving it running."""
    was = "running" if job.get("status") == "running" else "waiting"
    stage = (trace or {}).get("stage")
    message = f"Deja Vu1 stopped while this slice was {was}. It did not finish and nothing was queued"
    job.update(status="failed", step="Failed", error=message, interrupted=True, stage=stage,
               stage_label=slice_diagnosis.stage_label(stage), finished_at=job.get("finished_at") or _now(),
               cause=slice_diagnosis.make(
                   "interrupted", message,
                   "The engine was stopped together with Deja Vu1, so its output is incomplete and was not added to the library.",
                   ["Slice it again."]))


def _load_receipts():
    """Bring back the receipts saved by an earlier run; jobs that never finished are marked interrupted."""
    data = storage.load_json(_RECEIPTS, {})
    rows = data.get("jobs") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return
    with _lock:
        interrupted = False
        for row in rows[-MAX_JOBS_KEPT:]:
            job = row.get("job") if isinstance(row, dict) else None
            if not isinstance(job, dict) or not isinstance(job.get("id"), str) or job["id"] in _jobs:
                continue
            trace = row.get("trace") if isinstance(row.get("trace"), dict) else {"stage": None}
            if job.get("status") in ("waiting", "running"):
                _mark_interrupted(job, trace)
                interrupted = True
            _jobs[job["id"]] = job
            _traces[job["id"]] = trace
            _order.append(job["id"])
        while len(_order) > MAX_JOBS_KEPT:
            old = _order.pop(0)
            _jobs.pop(old, None)
            _traces.pop(old, None)
        if interrupted:
            _persist_locked()


def _job_update(job_id, **fields):
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)
            # Saved when a job changes state, not at every step line, so a long slice writes a handful of times.
            if "status" in fields or "finished_at" in fields:
                _persist_locked()


def start_job(name, profile_id=None, queue_to=None, on_done=None):
    """
    Start slicing in the background. `queue_to` (a printer id) adds the
    result to that printer's queue - not a print start, so no gate yet;
    the queue runs the gate when it starts the file.
    """
    kind = file_library.kind_of(name or "")
    if kind not in ("stl", "3mf"):
        raise ValueError("Only STL and 3MF models can be sliced - G-code is already sliced")
    if not file_library.exists(name):
        raise ValueError(f"No file called {name} in the library")
    s = get_settings()
    path, source = slicer_path(s)
    problem = _check_program(path, source)
    if problem:
        raise ValueError(problem)
    changed = engine_changed(s, path)
    if changed:
        raise ValueError(changed)
    profile = _profile(profile_id, s)
    job = {"id": uuid.uuid4().hex[:8], "model": name, "profile": profile["name"], "profile_id": profile["id"],
           "printer_id": mock_moonraker.selected_printer_id(),
           "queue_to": queue_to, "status": "waiting", "step": "Waiting for the slicer",
           "created_at": datetime.now().isoformat(timespec="seconds"), "error": None, "report": None,
           "queued": None, "previous": _previous_output(name, profile["id"]),
           "stage": None, "stage_label": None, "cause": None}
    with _lock:
        if sum(j['status'] in ('waiting','running') for j in _jobs.values()) >= 8:
            raise ValueError('Eight slices are already waiting or running. Cancel one or let the engine finish before adding another')
        _jobs[job["id"]] = job
        _traces[job["id"]] = {"stage": None}
        _cancellations[job['id']] = threading.Event()
        _order.append(job["id"])
        while len(_order) > MAX_JOBS_KEPT:
            old = _order.pop(0)
            _jobs.pop(old, None)
            _traces.pop(old, None)
        _persist_locked()
    threading.Thread(target=_work_selected, args=(mock_moonraker.selected_printer_id(), job["id"], name, profile["id"], queue_to, on_done),
                     name="slicer", daemon=True).start()
    return dict(job)


def _work_selected(printer_id, *args):
    with mock_moonraker.selection_only(printer_id):
        _work(*args)


def _previous_output(model, profile_id):
    """The last file this model was sliced into, for "what changed?" afterwards."""
    with _lock:
        for jid in reversed(_order):
            j = _jobs[jid]
            if j["model"] == model and j["status"] in ("done", "queued") and j.get("report"):
                files = [f["name"] for f in j["report"].get("files", []) if file_library.exists(f["name"])]
                if files:
                    return files[0]
    return None


def _work(job_id, name, profile_id, queue_to, on_done):
    with _run_lock:
        with _lock:
            _operation.cancel = _cancellations.get(job_id)
            trace = _traces.setdefault(job_id, {"stage": None})
        _job_update(job_id, status="running", started_at=datetime.now().isoformat(timespec="seconds"))
        try:
            if _operation.cancel and _operation.cancel.is_set():
                raise SliceCancelled('Slicing cancelled before it started')
            report = slice_model(name, profile_id, on_step=lambda text: _job_update(job_id, step=text), trace=trace)
            if _operation.cancel and _operation.cancel.is_set():
                raise SliceCancelled('Slicing cancelled. No output was queued')
            if any(f.get('preflight')=='blocked' for f in report.get('files',[])):
                message = ('Pre-flight blocked the sliced output. It is saved for inspection and was not queued. '
                           'Open its file report and correct the printer preset before slicing again')
                trace["output"]["status"] = "preflight_blocked"
                raise SliceFailed(message, report, slice_diagnosis.make(
                    "preflight_blocked", message, "", ["Open the sliced file's report in Library and read what "
                                                       "pre-flight blocked."]))
            if not queue_to:
                _job_update(job_id, status="done", step="Sliced", report=report)
            else:
                # Still "running" until the queue step is over: a job reads as
                # finished only once, with its final outcome - never "done"
                # for a moment before it is "queued".
                _job_update(job_id, step="Sliced - adding it to the queue", report=report)
                import print_queue          # imported here: the queue imports the printer side
                try:
                    with _lock:
                        if _operation.cancel and _operation.cancel.is_set():
                            raise SliceCancelled('Slicing cancelled. No output was queued')
                        print_queue.add(report["files"][0]["name"], printer_id=queue_to)
                        _job_update(job_id, status="queued", queued={"printer": queue_to, "file": report["files"][0]["name"]},
                                    step="Sliced and queued - it will be checked by Confirm Print before it starts")
                except SliceCancelled:
                    raise
                except ValueError as exc:
                    _job_update(job_id, status="done", step=f"Sliced, but couldn't queue it: {exc}",
                                queue_error=str(exc))
        except SliceCancelled as exc:
            _job_update(job_id, status='cancelled', step=str(exc), error=None)
        except SliceFailed as exc:
            _job_update(job_id, status="failed", step="Failed", error=str(exc), report=exc.report, cause=exc.cause)
        except ValueError as exc:
            cause = getattr(exc, "cause", None) or slice_diagnosis.for_stage(trace.get("stage"), str(exc))
            _job_update(job_id, status="failed", step="Failed", error=str(exc), cause=cause)
        except Exception as exc:          # noqa: BLE001 - a job must always end in a worded state
            message = f"Unexpected error: {exc}"
            _job_update(job_id, status="failed", step="Failed", error=message, cause=slice_diagnosis.make(
                "unexpected", message, "", ["Copy the report and ask for help."], repairable=False))
        finally:
            stage = trace.get("stage")
            _job_update(job_id, finished_at=datetime.now().isoformat(timespec="seconds"), stage=stage,
                        stage_label=slice_diagnosis.stage_label(stage))
            _operation.cancel = None
            with _lock:
                _cancellations.pop(job_id, None)
    if on_done:
        try:
            on_done(get_job(job_id))
        except Exception:                 # noqa: BLE001
            pass


def get_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def jobs():
    with _lock:
        pid = mock_moonraker.selected_printer_id()
        return {"jobs": [dict(_jobs[j]) for j in reversed(_order) if _jobs[j].get('printer_id') == pid]}


def any_active():
    """Is a slice waiting or running for any printer? (An update gives it a little time to finish.)"""
    with _lock:
        return any(job.get('status') in ('waiting', 'running') for job in _jobs.values())


def cancel_all(why='Stopped'):
    """
    Ask every waiting or running slice to stop, for every printer: the engine is ended and nothing
    half-written is queued. Used when the program is about to restart. Returns how many were asked.
    """
    asked = 0
    with _lock:
        for job_id, job in _jobs.items():
            event = _cancellations.get(job_id)
            if job.get('status') in ('waiting', 'running') and event is not None and not event.is_set():
                event.set()
                job['step'] = why
                asked += 1
    return asked


def cancel_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.get('printer_id') != mock_moonraker.selected_printer_id():
            raise ValueError('This slice job is not available for this printer')
        event = _cancellations.get(job_id)
        if job['status'] not in ('waiting', 'running') or event is None:
            raise ValueError('This slice job has already finished')
        event.set()
        job['step'] = 'Stopping the engine…'
        return dict(job)


def wait(job_id, timeout=30):
    """Block until a job ends (tests)."""
    end = time.time() + timeout
    while time.time() < end:
        job = get_job(job_id)
        if job and job["status"] in ("done", "queued", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    return get_job(job_id)


def reset():
    with _lock:
        _jobs.clear()
        _order.clear()
        _traces.clear()
        _persist_locked()
        _save(_defaults())


_load_receipts()
