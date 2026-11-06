#!/usr/bin/env python3
"""Slice the standard fixtures with one slicing engine and print what happened.

Anyone with a Snapmaker Orca or OrcaSlicer build can run this on their system and
send the result, which is how a row gets added to docs/engine-support.md. It uses
the same code the app uses to slice (backend/slicer_bridge.py), in a throw-away
data folder, so it never touches your real settings or library.

    python3 tools/engine-fixtures.py --engine /path/to/snapmaker-orca \\
        --machine "Snapmaker U1 (0.4 nozzle).json" --process "0.20mm Standard.json" \\
        --filament "Generic PLA.json" [--json result.json] [--timeout 600]

The three preset files are JSON presets exported from the engine (machine,
process and filament). A fixture passes when the engine exits cleanly, writes
G-code with printable layers and filament use, and pre-flight does not block it.
Exit code: 0 every fixture passed, 1 at least one failed, 2 the engine did not
answer its check.
"""

import argparse
import json
import os
import pathlib
import platform
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = (
    ("spur_gear_24t.stl", "a small gear: the quick check"),
    ("twisted_vase.stl", "a twisted vase: curved walls and a spiral"),
    ("3dbenchy.stl", "the 3DBenchy, 60,000 triangles: a heavier model"),
)


def parse(argv):
    parser = argparse.ArgumentParser(description="Slice the standard fixtures with one engine.")
    parser.add_argument("--engine", required=True, help="full path to the engine program")
    parser.add_argument("--machine", required=True, help="machine preset (JSON)")
    parser.add_argument("--process", required=True, help="process preset (JSON)")
    parser.add_argument("--filament", required=True, action="append", help="filament preset (JSON); up to four")
    parser.add_argument("--timeout", type=int, default=600, help="seconds allowed for each slice")
    parser.add_argument("--json", help="also write the result to this file")
    return parser.parse_args(argv)


def run(args):
    work = tempfile.mkdtemp(prefix="dejavu-fixtures-")
    # The data folder and engine path are read when the backend modules load, so set them first.
    os.environ["DEJAVU_DATA_DIR"] = work
    os.environ["DEJAVU_SLICER_PATH"] = os.path.abspath(args.engine)
    os.environ.setdefault("DEJAVU_NO_REGISTER", "1")
    sys.path.insert(0, str(ROOT / "backend"))
    import file_library
    import sample_files
    import slice_diagnosis
    import slicer_bridge

    try:
        slicer_bridge.save_settings({"timeout_s": args.timeout})
        check = slicer_bridge.check()
        result = {"schema": "dejavu1.engine-fixtures/1", "host": slice_diagnosis.host_facts(),
                  "system": platform.system(), "check": {k: check.get(k) for k in (
                      "ok", "app", "version", "detail", "error", "exit_code", "support", "cause", "capabilities")},
                  "fixtures": []}
        if not check.get("ok"):
            return result, 2
        profile = slicer_bridge.add_profile("fixtures", args.machine, args.process, args.filament)
        for name, why in FIXTURES:
            file_library.save(name, sample_files.build(name), origin="sample")
            trace = {}
            started = time.monotonic()
            row = {"fixture": name, "about": why, "ok": False}
            try:
                report = slicer_bridge.slice_model(name, profile["id"], trace=trace)
                saved = report["files"][0]
                row.update(ok=saved["preflight"] != "blocked", layers=saved["layers"], grams=saved["filament_grams"],
                           hours=saved["estimated_hours"], preflight=saved["preflight"])
                if not row["ok"]:
                    row["failure"] = {"code": "preflight_blocked", "title": "Pre-flight blocked the G-code"}
            except slicer_bridge.SliceFailed as exc:
                row["failure"] = {"code": (exc.cause or {}).get("code"), "title": str(exc)}
            except ValueError as exc:
                cause = getattr(exc, "cause", None) or slice_diagnosis.for_stage(trace.get("stage"), str(exc))
                row["failure"] = {"code": cause["code"], "title": str(exc)}
            row["stage"] = trace.get("stage")
            row["seconds"] = round(time.monotonic() - started, 1)
            result["fixtures"].append(row)
        passed = sum(1 for r in result["fixtures"] if r["ok"])
        return result, 0 if passed == len(result["fixtures"]) else 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


def show(result):
    check = result["check"]
    print(f"Engine: {check.get('app') or '?'} {check.get('version') or ''} on {result['system']} "
          f"({result['host']['machine']}), Python {result['host']['python']}")
    if not check.get("ok"):
        print(f"The engine check failed: {check.get('error')}")
        for fix in (check.get("cause") or {}).get("fixes") or []:
            print(f"  What to try: {fix}")
        return
    print((check.get("support") or {}).get("title", ""))
    for row in result["fixtures"]:
        if row["ok"]:
            print(f"  PASS  {row['fixture']}: {row['layers']} layers, {row['seconds']} s, "
                  f"pre-flight {row['preflight']}")
        else:
            print(f"  FAIL  {row['fixture']}: stopped at {row.get('stage')}: {row['failure']['title']}")
    passed = sum(1 for r in result["fixtures"] if r["ok"])
    print(f"\n{passed} of {len(result['fixtures'])} fixtures passed. "
          f"For docs/engine-support.md: | {check.get('app')} | {check.get('version')} | {result['system']} | "
          f"{passed} of {len(result['fixtures'])} fixtures sliced |")


def main(argv=None):
    args = parse(argv if argv is not None else sys.argv[1:])
    result, code = run(args)
    show(result)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
    return code


if __name__ == "__main__":
    sys.exit(main())
