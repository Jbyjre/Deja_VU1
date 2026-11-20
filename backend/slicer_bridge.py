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
import tester
import slicer_profiles
import slicing_contract
import project_plates
import tool_setup
import mock_moonraker
import model_maker
from slicer_bridge_part1 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    CHECK_TIMEOUT, DEFAULT_TIMEOUT, ENV_PATH, EngineStartFailed, MAX_FOUND, MAX_JOBS_KEPT, MAX_PRESET_BYTES,
    MAX_PROFILES, ORCA_ERRORS, STOCK_COLOURS, SliceCancelled, SliceFailed, _DATA_DIR, _MAX_LISTED, _PATH,
    _RECEIPTS, _TAIL, _app_facts, _app_from_name, _cancellations, _capabilities, _check_program,
    _could_be_program, _defaults, _explain, _free_name, _job_update, _jobs, _listing, _load_receipts, _lock,
    _looks_like_orca, _mark_interrupted, _mode_facts, _now, _operation, _order, _persist_locked, _previous_output,
    _profile, _profile_facts, _program_files, _program_identity, _run_lock, _save, _search_places,
    _plain, _settings_file_is_orca, _shown_command, _stock_heads, _tail, _traces, any_active, cancel_all, cancel_job,
    command_for, diagnose, engine_capabilities, engine_changed, find_slicers, get_job, get_settings,
    installed_catalog, jobs, public_settings, read_preset, remove_profile, reset, slicer_path, wait,
)


MIN_TIMEOUT, MAX_TIMEOUT = 30, 3600


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


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


def use_stock_profile():
    """
    One press: a profile made of Snapmaker's own stock U1 presets that fit the fitted heads (the printer preset,
    its Standard process and each head's stock material), saved as the default. When the four heads were never
    set up, they are filled from what the printer reports (or plain PLA on 0.4 mm nozzles) and saved first,
    and the answer says so.
    """
    path, _ = slicer_path()
    if not path:
        raise ValueError("Find your slicer program first: Find it for me, in step 2")
    found = installed_catalog()
    if not found["available"]:
        raise ValueError(found["problem"])
    heads = tool_setup.get()["heads"]
    made_heads = len(heads) != 4
    if made_heads:
        tool_setup.save({"heads": _stock_heads()})
        heads = tool_setup.get()["heads"]
    pick = slicer_profiles.stock_choice(found["presets"], heads)
    names = pick["names"]
    label = "Snapmaker stock · " + names["process"].split(" @")[0]
    s = get_settings()
    taken = {p.get("name") for p in s.get("profiles", [])}
    name, n = label, 2
    while name in taken:
        name, n = f"{label} ({n})", n + 1
    body = {"name": name[:60], "machine": pick["machine"], "process": pick["process"], "filaments": pick["filaments"],
            "layer_mode": "shared", "options": {}}
    out = add_installed_profile(body)
    out["stock"] = {"name": body["name"], "presets": names, "notes": pick["notes"],
                    "heads_made": made_heads, "heads": heads}
    return out


# ---------------------------------------------------------------------------
# Running the program
# ---------------------------------------------------------------------------


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
        if code != 0 or (isinstance(result_json, dict) and result_json.get("return_code") not in (None, 0)):
            # Everything the engine printed, for Tester mode's report (_work hands it over and drops it). The help report keeps a window.
            trace["engine_output"] = {"stdout": _plain(out), "stderr": _plain(err)}
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


def _ended(trace):
    """The fields a job gets the moment it ends, written with its final status in one update: a job that reads
    finished always says where it stopped, never a moment later."""
    stage = trace.get("stage")
    return {"finished_at": datetime.now().isoformat(timespec="seconds"), "stage": stage,
            "stage_label": slice_diagnosis.stage_label(stage)}


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
                _job_update(job_id, status="done", step="Sliced", report=report, **_ended(trace))
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
                                    step="Sliced and queued - it will be checked by Confirm Print before it starts",
                                    **_ended(trace))
                except SliceCancelled:
                    raise
                except ValueError as exc:
                    _job_update(job_id, status="done", step=f"Sliced, but couldn't queue it: {exc}",
                                queue_error=str(exc), **_ended(trace))
        except SliceCancelled as exc:
            _job_update(job_id, status='cancelled', step=str(exc), error=None, **_ended(trace))
        except SliceFailed as exc:
            _job_update(job_id, status="failed", step="Failed", error=str(exc), report=exc.report, cause=exc.cause,
                        **_ended(trace))
        except ValueError as exc:
            cause = getattr(exc, "cause", None) or slice_diagnosis.for_stage(trace.get("stage"), str(exc))
            _job_update(job_id, status="failed", step="Failed", error=str(exc), cause=cause, **_ended(trace))
        except Exception as exc:          # noqa: BLE001 - a job must always end in a worded state
            message = f"Unexpected error: {exc}"
            _job_update(job_id, status="failed", step="Failed", error=message, cause=slice_diagnosis.make(
                "unexpected", message, "", ["Copy the report and ask for help."], repairable=False), **_ended(trace))
        finally:
            ended = _ended(trace)
            with _lock:
                job = _jobs.get(job_id) or {}
                if job.get("stage") != ended["stage"] or not job.get("finished_at"):
                    job.update(ended)       # a job that ended some other way still gets its stage
                    _persist_locked()
            output = trace.pop("engine_output", None)
            if tester.enabled():
                try:
                    done = get_job(job_id) or {}
                    tester.note_slice(done, _receipt(done, trace), output)
                except Exception:         # noqa: BLE001 - Tester mode never changes how a slice ends
                    pass
            _operation.cancel = None
            with _lock:
                _cancellations.pop(job_id, None)
    if on_done:
        try:
            on_done(get_job(job_id))
        except Exception:                 # noqa: BLE001
            pass


_load_receipts()
