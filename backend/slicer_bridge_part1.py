"""
slicer_bridge_part1.py: part 1 of 1 split out of slicer_bridge.py (the slicing engine: finding it, profiles,
jobs and slice reports) on 19 November 2026, so a session reads only the part it needs. slicer_bridge.py imports
every name here back, so `slicer_bridge.<name>` works as before. Holds: CHECK_TIMEOUT, DEFAULT_TIMEOUT,
ENV_PATH, EngineStartFailed, MAX_FOUND, MAX_JOBS_KEPT, MAX_PRESET_BYTES, MAX_PROFILES, ORCA_ERRORS,
STOCK_COLOURS, SliceCancelled, SliceFailed, _DATA_DIR, _MAX_LISTED, _PATH, _RECEIPTS, _TAIL, _app_facts,
_app_from_name, _cancellations, _capabilities, _check_program, _could_be_program, _defaults, _explain,
_free_name, _job_update, _jobs, _listing, _load_receipts, _lock, _looks_like_orca, _mark_interrupted,
_mode_facts, _now, _operation, _order, _persist_locked, _plain, _previous_output, _profile, _profile_facts,
_program_files, _program_identity, _run_lock, _save, _search_places, _settings_file_is_orca, _shown_command,
_stock_heads, _tail, _traces, any_active, cancel_all, cancel_job, command_for, diagnose, engine_capabilities,
engine_changed, find_slicers, get_job, get_settings, installed_catalog, jobs, public_settings, read_preset,
remove_profile, reset, slicer_path, wait.
"""

from datetime import datetime
import engine_installer
import file_library
import json
import mock_moonraker
import os
import re
import shutil
import slice_diagnosis
import slicer_profiles
import storage
import sys
import threading
import time
import tool_setup


_DATA_DIR = storage.DATA_DIR


_PATH = os.path.join(_DATA_DIR, "slicer.json")


_RECEIPTS = os.path.join(_DATA_DIR, "slice-receipts.json")   # the last slices, kept across a restart


ENV_PATH = "DEJAVU_SLICER_PATH"


DEFAULT_TIMEOUT = 600


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
            "chosen), so Deja Vu1 doesn't know which version it is now. Open the Slicer, press Engine to check it, then slice again")


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
    # The engine Deja Vu1 installed for the person (engine_installer.py) comes before anything found on the computer.
    managed = engine_installer.managed_program()
    if managed:
        return managed, "managed"
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


STOCK_COLOURS = ("#f2f2f2", "#1b1b1b", "#d6402f", "#2f6fd6")      # used only when no printer reports its spools


def _stock_heads():
    """Four 0.4 mm heads for the stock presets, with the materials and colours the printer reports where it can."""
    state = {}
    try:
        state = mock_moonraker.get_printer_state() or {}
    except Exception:  # noqa: BLE001 - no printer just means the defaults
        state = {}
    heads = []
    for i, name in enumerate(("T0", "T1", "T2", "T3")):
        h = (state.get("toolheads") or {}).get(name) or {}
        material = str(h.get("filament_material") or "PLA").upper().split()[0] if h.get("filament_material") else "PLA"
        colour = str(h.get("filament_color_hex") or "")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", colour):
            colour = STOCK_COLOURS[i]
        heads.append({"toolhead": name, "nozzle": 0.4, "height": 0.2, "color_hex": colour.lower(),
                      "material": material if material in tool_setup.MATERIALS else "PLA", "spool_id": ""})
    return heads


def _plain(data):
    """What the engine printed, as text (nothing cut)."""
    return data.decode("utf-8", errors="replace") if isinstance(data, bytes) else (data or "")


def _tail(data):
    text = (data or b"").decode("utf-8", errors="replace") if isinstance(data, bytes) else (data or "")
    return text[-_TAIL:].strip()


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


def _profile(profile_id, settings):
    pid = profile_id or settings.get("default_profile")
    prof = next((p for p in settings["profiles"] if p["id"] == pid), None)
    if prof is None:
        raise ValueError("Choose a slicing profile first (Files → Slicing → Profiles)")
    return prof


def command_for(slicer, profile, model_path, outdir, keep_placement=False, datadir=None):
    """
    The exact command line - kept in one place so it's shown and tested as run. `keep_placement` is for a plate the person
    arranged in Deja Vu1: without --arrange 0 the engine moves the objects again (Snapmaker Orca's CLI arranges unless told
    not to). `datadir` gives the managed engine its own settings folder so the person's own Orca is never read or changed.
    The extra flags sit right after --slice so the command still ends with --outputdir <folder> <model>.
    """
    cmd = [slicer, "--slice", "0"]
    if keep_placement:
        cmd += ["--arrange", "0", "--orient", "0"]
    if datadir:
        cmd += ["--datadir", datadir]
    return cmd + ["--load-settings", f"{profile['machine']};{profile['process']}",
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


def _orca_number(code, result_json):
    """Orca's own error number: from result.json (written on Linux only), else from how the program ended."""
    rc = result_json.get("return_code") if isinstance(result_json, dict) else None
    return rc if rc is not None else slice_diagnosis.orca_code(code)


def _explain(code, result_json, err_tail, out_tail):
    rc = _orca_number(code, result_json)
    words = ORCA_ERRORS.get(rc) if rc is not None else None
    orca_says = (result_json or {}).get("error_string") if isinstance(result_json, dict) else None
    reasons = "; ".join(slice_diagnosis.reason_lines(err_tail, out_tail, limit=2))
    if words and orca_says:
        return f"{words}. Orca said: {orca_says}"
    if words:
        return f"{words} (Orca's code {rc})" + (f". It printed: {reasons}" if reasons else "")
    if orca_says:
        return f"Orca said: {orca_says}"
    if code is not None and code < 0 and os.name == "posix":
        return f"Orca stopped unexpectedly (signal {-code}) - it may have crashed"
    return f"Orca exited with code {code}" + (f": {reasons}" if reasons else "")


def diagnose(code, result_json, out, err):
    """
    (headline, cause) for an engine run that failed. A message the system
    printed (a missing library, no screen) is more exact than Orca's own
    "couldn't start" code, so it wins there; otherwise Orca's own code and
    words do (from result.json, or from the exit code: result.json is only
    written on Linux), then the way the process ended, then the lines that
    say why. Orca's own "found error" line is never taken for the reason.
    """
    def as_text(data):
        return data.decode("utf-8", "replace") if isinstance(data, bytes) else (data or "")

    rc = _orca_number(code, result_json)
    from_system = slice_diagnosis.from_text(as_text(out) + "\n" + as_text(err))
    if from_system and rc in (None, -1):
        return from_system["title"], from_system
    words = ORCA_ERRORS.get(rc) if rc is not None else None
    says = result_json.get("error_string") if isinstance(result_json, dict) else None
    reasons = slice_diagnosis.reason_lines(_tail(err), _tail(out))
    if words or says:
        cause = slice_diagnosis.from_orca(rc, words, says)
        if reasons and not says:
            cause["evidence"] = slice_diagnosis.redact("\n".join(reasons))
        return _explain(code, result_json, _tail(err), _tail(out)), cause
    ended = slice_diagnosis.from_exit(code)
    if ended:
        return ended["title"], ended
    headline = _explain(code, result_json, _tail(err), _tail(out))
    return headline, slice_diagnosis.make(
        "engine_exit", headline, "", ["Open the report: the last lines of the engine's output say what failed."],
        evidence=("\n".join(reasons) or None))


class SliceFailed(ValueError):
    def __init__(self, message, report, cause=None):
        super().__init__(message)
        self.report = report
        self.cause = cause


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
