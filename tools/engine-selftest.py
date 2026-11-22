#!/usr/bin/env python3
"""
Runs the real slicing engine through Deja Vu1's own code, on this computer, and prints what happened. It uses a temporary data folder, so it never
touches your files or settings, and it sends nothing anywhere.

    python3 tools/engine-selftest.py                       the engine Deja Vu1 installed (or the one DEJAVU_SLICER_PATH names)
    python3 tools/engine-selftest.py --engine <program>    a program of your own (its file name must contain "orca")
    python3 tools/engine-selftest.py --json                one JSON object, to paste into a bug report

What it does, in order, each step with its own line:
  1. asks the engine for its help line and settings file (the same check the app runs);
  2. reads the engine's own Snapmaker U1 presets and says which ones fit four 0.4 mm heads;
  3. slices the 3DBenchy through the working profile (Deja Vu1's plate project, the engine's command line) and reads the G-code back;
  4. runs the engine's own arrange and orient on that plate and exports the result as a 3MF, then prints each object's transform before and
     after. Deja Vu1's Arrange and Auto-orient do not use these yet: the engine's 3MF convention (where an object's origin is after it has
     been centred) was not verifiable without a real run, and this prints exactly the numbers that settle it.
Exit status 0 means every step worked.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.setdefault("DEJAVU_DATA_DIR", tempfile.mkdtemp(prefix="dejavu-selftest-"))
os.environ["DEJAVU_TESTER"] = "0"

import engine_installer  # noqa: E402
import file_library  # noqa: E402
import plate_project  # noqa: E402
import sample_files  # noqa: E402
import slicer_bridge  # noqa: E402
import slicer_working  # noqa: E402
import tool_setup  # noqa: E402

steps = []


def step(name, ok, detail=""):
    steps.append({"step": name, "ok": bool(ok), "detail": detail})
    if "--json" not in sys.argv:
        print(("ok   " if ok else "FAIL ") + name + (": " + str(detail) if detail else ""))
    return ok


def main():
    argv = sys.argv[1:]
    if "--engine" in argv:
        slicer_bridge.save_settings({"slicer_path": argv[argv.index("--engine") + 1]})
    path, source = slicer_bridge.slicer_path()
    if not path:
        step("find the engine", False, "none found: install it from the Slicer's printer block, or pass --engine <program>")
        return finish()
    step("find the engine", True, f"{path} ({source})")
    result = slicer_bridge.check()
    if not step("the engine answers its help line", result.get("ok"), result.get("detail") or result.get("error")):
        return finish()
    step("what it can do", True, json.dumps(result.get("capabilities") or {}))
    tool_setup.save({"heads": [{"toolhead": f"T{i}", "nozzle": 0.4, "height": 0.2, "material": "PLA", "color_hex": "#808080", "spool_id": ""} for i in range(4)]})
    state = slicer_working.state()
    if not step("the engine's Snapmaker U1 presets", state.get("ready"), state.get("problem") or f"{len(state['processes'])} print presets, machine {state['machine']['name']}"):
        return finish()
    file_library.save("3dbenchy.stl", sample_files.build("3dbenchy.stl"), origin="sample")
    plate = plate_project.save({"objects": [{"name": "3dbenchy.stl", "label": "3DBenchy", "transform": [1, 0, 0, 0, 1, 0, 0, 0, 1, 135.5, 136, 0], "tool": 0, "settings": {}}]})
    profile = slicer_working.set_working({})
    step("the working profile is accepted", True, "; ".join(profile.get("warnings") or []) or "no notes")
    started = time.monotonic()
    job = slicer_bridge.start_job(plate["name"], profile["profile_id"])
    done = slicer_bridge.wait(job["id"], 900)
    seconds = round(time.monotonic() - started, 1)
    ok = done and done.get("status") == "done"
    files = ((done or {}).get("report") or {}).get("files") or []
    step("slicing the plate", ok, f"{seconds} s, " + (f"{files[0]['layers']} layers, {files[0].get('estimated_hours')} h, {files[0].get('filament_grams')} g" if files else (done or {}).get("error")))
    if ok:
        gcode = file_library.read_bytes(files[0]["name"]).decode("utf-8", "replace")
        types = sorted(set(re.findall(r";TYPE:([^\r\n]+)", gcode)))
        step("the G-code carries what the Preview reads", bool(types) and ";LAYER_CHANGE" in gcode and ";WIDTH:" in gcode, f"line types: {', '.join(types[:8])}")
    arrange_orient(path, profile, plate)
    return finish()


def arrange_orient(program, profile, plate):
    """The engine's own arrange and orient, exported as a 3MF, with the object's transform before and after."""
    settings = slicer_bridge.get_settings()
    entry = next(p for p in settings["profiles"] if p["id"] == profile["profile_id"])
    data = file_library.read_bytes(plate["name"])
    for flag, what in (("--arrange", "arrange"), ("--orient", "orient")):
        with tempfile.TemporaryDirectory(prefix="dejavu-selftest-run-") as work:
            src = os.path.join(work, "plate.3mf")
            with open(src, "wb") as fh:
                fh.write(data)
            out = os.path.join(work, "out")
            os.makedirs(out)
            cmd = [program, flag, "1", "--allow-newer-file", "--load-settings", f"{entry['machine']};{entry['process']}", "--load-filaments", ";".join(entry["filaments"]),
                   "--export-3mf", "arranged.3mf", "--outputdir", out, src]
            if engine_installer.is_managed(program):
                cmd[1:1] = ["--datadir", engine_installer.data_dir_for_engine()]
            try:
                proc = subprocess.run(cmd, capture_output=True, timeout=300)
            except (OSError, subprocess.TimeoutExpired) as exc:
                step(f"the engine's {what}", False, str(exc))
                continue
            target = os.path.join(out, "arranged.3mf")
            if not os.path.isfile(target):
                step(f"the engine's {what}", False, f"no 3MF came back (exit {proc.returncode}); it said: {(proc.stderr or proc.stdout).decode('utf-8', 'replace')[-300:]}")
                continue
            with zipfile.ZipFile(target) as z:
                model = z.read("3D/3dmodel.model").decode("utf-8", "replace")
            items = re.findall(r'<item[^>]*transform="([^"]+)"', model)
            step(f"the engine's {what}", True, f"input transform 1 0 0 0 1 0 0 0 1 135.5 136 0; the engine's: {items[:3]}")


def finish():
    ok = all(s["ok"] for s in steps)
    if "--json" in sys.argv:
        print(json.dumps({"ok": ok, "steps": steps}, indent=2))
    else:
        print(f"\n{sum(s['ok'] for s in steps)} of {len(steps)} steps worked")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
