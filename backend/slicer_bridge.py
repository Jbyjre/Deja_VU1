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
(github.com/SoftFever/OrcaSlicer, tag v2.3.2 and main as of September
2026), not assumed:
  - options are defined in src/libslic3r/PrintConfig.cpp (CLIActionsConfigDef,
    CLIMiscConfigDef): --slice <plate, 0 = all>, --load-settings,
    --load-filaments (lists separated by ";"), --outputdir
  - src/OrcaSlicer.cpp writes each plate as <outputdir>/plate_<n>.gcode and,
    on Linux only, <outputdir>/result.json with "return_code" and
    "error_string"; a bare STL is arranged on the plate by default
  - a preset file must say where it came from ("from": "system" or "User")
    and, in v2.3.2, what it is ("type": machine / process / filament)
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
It has not yet been run against a real Orca install in this project's own
testing - the tests drive a stand-in program that behaves like the source
says Orca does (see tests/test_slicer_bridge.py).
"""

import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime

import file_library
import gcode_tools
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_PATH = os.path.join(_DATA_DIR, "slicer.json")
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


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def _defaults():
    return {"slicer_path": "", "timeout_s": DEFAULT_TIMEOUT, "profiles": [], "default_profile": None,
            "last_check": None}


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
    return (settings or get_settings()).get("slicer_path", ""), "settings"


def _looks_like_orca(path):
    # This dashboard has no login, so the path is limited to something that
    # is at least named like Orca - the setting can't point at any program.
    # DEJAVU_SLICER_PATH (set by whoever runs the server) skips this.
    return "orca" in os.path.basename(path).lower()


def _check_program(path, source):
    """Why this path can't be run, in words - or None when it can."""
    if not path:
        return ("No slicer set up. Install OrcaSlicer yourself, then enter the full path to its "
                "program (for example /Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer, "
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
            "last_check": s["last_check"], "problem": _check_program(path, source),
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
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    try:
        proc = subprocess.Popen(cmd, **kwargs)
    except PermissionError:
        raise ValueError(f"{cmd[0]} isn't allowed to run (on Linux: chmod +x it)")
    except OSError as exc:
        raise ValueError(f"Couldn't start {os.path.basename(cmd[0])}: {exc.strerror or exc}")
    try:
        out, err = proc.communicate(timeout=timeout)
        return proc.returncode, out, err
    except subprocess.TimeoutExpired:
        try:
            if os.name == "posix":
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except OSError:
            pass
        out, err = proc.communicate()
        return None, out, err


def check():
    """
    Is the slicer there and does it answer like OrcaSlicer's command line?
    Runs `<slicer> --help`, whose first line is "<AppKey>-<version>:"
    (CLI::print_help in src/OrcaSlicer.cpp).
    """
    s = get_settings()
    path, source = slicer_path(s)
    problem = _check_program(path, source)
    if problem:
        result = {"ok": False, "error": problem}
    else:
        started = time.monotonic()
        try:
            code, out, err = _run([path, "--help"], CHECK_TIMEOUT)
        except ValueError as exc:
            code, out, err = "failed", b"", str(exc).encode()
        text = _tail(out) or _tail(err)
        first = next((ln.strip() for ln in (out or b"").decode("utf-8", "replace").splitlines() if ln.strip()), "")
        match = re.match(r"^([A-Za-z_][\w ]*?)-(\d[\w.\-+]*):?$", first)
        if code == "failed":
            result = {"ok": False, "error": _tail(err)}
        elif code is None:
            result = {"ok": False, "error": f"{os.path.basename(path)} didn't answer within {CHECK_TIMEOUT} s "
                                            "(it may be waiting for a screen, or it isn't a command-line build)"}
        elif match:
            result = {"ok": True, "app": match.group(1), "version": match.group(2),
                      "detail": f"{match.group(1)} {match.group(2)} answered in "
                                f"{(time.monotonic() - started):.1f} s"}
        else:
            result = {"ok": False, "error": "It ran, but didn't answer like OrcaSlicer's command line"
                                            + (f" (it said: {first[:120]!r})" if first else " (no output)"),
                      "output": text}
    result["checked_at"] = datetime.now().isoformat(timespec="seconds")
    s = get_settings()
    s["last_check"] = result
    _save(s)
    return result


def _profile(profile_id, settings):
    pid = profile_id or settings.get("default_profile")
    prof = next((p for p in settings["profiles"] if p["id"] == pid), None)
    if prof is None:
        raise ValueError("Choose a slicing profile first (Files → Auto-print pipeline → Profiles)")
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


class SliceFailed(ValueError):
    def __init__(self, message, report):
        super().__init__(message)
        self.report = report


def slice_model(name, profile_id=None, on_step=None):
    """
    Slice one library model and add the G-code to the library. Returns a
    report; raises ValueError (in words) for anything that went wrong.
    """
    step = on_step or (lambda text: None)
    kind = file_library.kind_of(name or "")
    if kind not in ("stl", "3mf"):
        raise ValueError("Only STL and 3MF models can be sliced - G-code is already sliced")
    data = file_library.read_bytes(name)
    s = get_settings()
    path, source = slicer_path(s)
    problem = _check_program(path, source)
    if problem:
        raise ValueError(problem)
    profile = _profile(profile_id, s)
    step("Checking the preset files")
    for f, t in [(profile["machine"], "machine"), (profile["process"], "process")] + \
            [(f, "filament") for f in profile["filaments"]]:
        read_preset(f, t)           # they may have moved or changed since the profile was saved

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
        if code is None:
            raise SliceFailed(f"Slicing didn't finish within {timeout} s, so it was stopped. A big model can "
                              "need longer (raise the time limit), or Orca may be stuck waiting for a screen",
                              report)
        rc = result_json.get("return_code") if isinstance(result_json, dict) else None
        plates = sorted((f for f in os.listdir(outdir) if re.match(r"^plate_\d+\.gcode$", f)),
                        key=lambda f: int(re.findall(r"\d+", f)[0]))
        if code != 0 or (rc not in (None, 0)):
            raise SliceFailed(_explain(code, result_json, err_tail, out_tail), report)
        if not plates:
            raise SliceFailed("Orca finished without an error but wrote no G-code (no plate_*.gcode in its "
                              "output folder). Its output layout may have changed in this version", report)

        step("Checking the G-code that came out")
        stem = os.path.splitext(file_library.clean_name(name))[0]
        saved = []
        for plate_file in plates:
            with open(os.path.join(outdir, plate_file), "rb") as fh:
                gcode = fh.read()
            if not gcode.strip():
                raise SliceFailed(f"Orca wrote {plate_file}, but it's empty", report)
            analysis = gcode_tools.analyze(gcode.decode("utf-8", errors="replace"), want_toolpath=False)
            if not analysis["layers"] or not analysis["filament_grams"]:
                raise SliceFailed(f"Orca wrote {plate_file}, but it has no printable layers in it - "
                                  "refusing to add a file that would print nothing", report)
            plate_no = int(re.findall(r"\d+", plate_file)[0])
            out_name = _free_name(stem, plate_no, len(plates))
            entry = file_library.save(out_name, gcode, origin="sliced",
                                      note=f"Sliced from {name} with \"{profile['name']}\""
                                           + (f" by OrcaSlicer {report['orca_version']}" if report["orca_version"] else ""))
            saved.append({"name": entry["name"], "layers": analysis["layers"],
                          "estimated_hours": analysis["estimated_hours"],
                          "filament_grams": analysis["filament_grams"],
                          "preflight": analysis["preflight"]["verdict"]})
        report["files"] = saved
        report["profile"] = {"id": profile["id"], "name": profile["name"]}
        return report
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------------------
# Jobs: slicing runs in the background, the browser watches its progress
# ---------------------------------------------------------------------------

def _job_update(job_id, **fields):
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)


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
    profile = _profile(profile_id, s)
    job = {"id": uuid.uuid4().hex[:8], "model": name, "profile": profile["name"], "profile_id": profile["id"],
           "queue_to": queue_to, "status": "waiting", "step": "Waiting for the slicer",
           "created_at": datetime.now().isoformat(timespec="seconds"), "error": None, "report": None,
           "queued": None, "previous": _previous_output(name, profile["id"])}
    with _lock:
        _jobs[job["id"]] = job
        _order.append(job["id"])
        while len(_order) > MAX_JOBS_KEPT:
            _jobs.pop(_order.pop(0), None)
    threading.Thread(target=_work, args=(job["id"], name, profile["id"], queue_to, on_done),
                     name="slicer", daemon=True).start()
    return dict(job)


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
        _job_update(job_id, status="running", started_at=datetime.now().isoformat(timespec="seconds"))
        try:
            report = slice_model(name, profile_id, on_step=lambda text: _job_update(job_id, step=text))
            _job_update(job_id, status="done", step="Sliced", report=report)
            if queue_to:
                import print_queue          # imported here: the queue imports the printer side
                try:
                    print_queue.add(report["files"][0]["name"], printer_id=queue_to)
                    _job_update(job_id, status="queued", queued={"printer": queue_to, "file": report["files"][0]["name"]},
                                step="Sliced and queued - it will be checked by Confirm Print before it starts")
                except ValueError as exc:
                    _job_update(job_id, step=f"Sliced, but couldn't queue it: {exc}", queue_error=str(exc))
        except SliceFailed as exc:
            _job_update(job_id, status="failed", step="Failed", error=str(exc), report=exc.report)
        except ValueError as exc:
            _job_update(job_id, status="failed", step="Failed", error=str(exc))
        except Exception as exc:          # noqa: BLE001 - a job must always end in a worded state
            _job_update(job_id, status="failed", step="Failed", error=f"Unexpected error: {exc}")
        finally:
            _job_update(job_id, finished_at=datetime.now().isoformat(timespec="seconds"))
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
        return {"jobs": [dict(_jobs[j]) for j in reversed(_order)]}


def wait(job_id, timeout=30):
    """Block until a job ends (tests)."""
    end = time.time() + timeout
    while time.time() < end:
        job = get_job(job_id)
        if job and job["status"] in ("done", "queued", "failed"):
            return job
        time.sleep(0.05)
    return get_job(job_id)


def reset():
    with _lock:
        _jobs.clear()
        _order.clear()
        _save(_defaults())
