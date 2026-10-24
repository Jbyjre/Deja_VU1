"""
selfcheck.py
============

"Check it yourself": a handful of real checks run inside the copy of Deja
Vu1 you are using, in a couple of seconds, so anyone can see the safety
features work instead of taking a description's word for it. Each check
uses the same code the dashboard uses, on files and values that show the
behaviour; none of them contacts a printer or changes your settings.

The full proof is the automated test suite (python3 -m unittest discover
tests, several hundred tests against stand-ins built from Moonraker's and
Klipper's source); this is the part that fits in a button.
"""

import json
import os
import shutil
import tempfile
import time

import app_updates
import gcode_tools
import layer_planner
import memory
import sample_files
import storage


def _check(name, what, fn):
    started = time.perf_counter()
    try:
        ok, detail = fn()
    except Exception as exc:               # a check that crashes has failed, in words
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    return {"name": name, "what": what, "passed": bool(ok), "detail": detail,
            "ms": round((time.perf_counter() - started) * 1000, 1)}


def _preflight_blocks():
    a = gcode_tools.analyze(sample_files.unsafe_gear_gcode(), want_toolpath=False)
    codes = sorted({e.get("code") for e in a["preflight"]["errors"]})
    return a["preflight"]["verdict"] == "blocked" and "out_of_bounds" in codes, \
        f"Verdict \"{a['preflight']['verdict']}\" ({', '.join(codes) or 'no errors'}) for a file whose purge line runs 20 mm past the bed"


def _preflight_clears():
    a = gcode_tools.analyze(sample_files.two_colour_benchy_pair_gcode(), want_toolpath=False)
    return a["preflight"]["verdict"] == "clear" and a["tools_used"] == ["T0", "T1"], \
        f"Verdict \"{a['preflight']['verdict']}\", {a['layers']} layers, heads {' and '.join(a['tools_used'])}"


def _klipper_reading():
    # Klipper reads "g1x300e5" as G1 X300 E5; a check that only looked for "G1 X" would miss it.
    a = gcode_tools.analyze("G90\nM83\nM104 S210\nG1 Z0.3\ng1x300e5\n", want_toolpath=False)
    codes = sorted({e.get("code") for e in a["preflight"]["errors"]})
    return "out_of_bounds" in codes, f"An unspaced move to X300 gives: {', '.join(codes) or 'nothing'}"


def _no_emergency_stop_in_edits():
    try:
        gcode_tools.validate_command("M112")
    except ValueError as exc:
        return True, f"Refused: {exc}"
    return False, "M112 was accepted"


def _host_check():
    import app
    outside = app.host_is_local("my-dashboard.example.com")
    inside = app.host_is_local("192.168.1.20") and app.host_is_local("localhost")
    return (not outside) and inside, "A public domain is refused; home-network addresses and localhost answer"


def _repair():
    os.makedirs(storage.DATA_DIR, exist_ok=True)
    folder = tempfile.mkdtemp(prefix=".selfcheck-", dir=storage.DATA_DIR)
    try:
        path = os.path.join(folder, "record.json")
        storage.save_json(path, {"spools": 4})
        storage.save_json(path, {"spools": 5})
        with open(path, "w") as fh:
            fh.write('{"spools": 5')          # cut short, as by a power cut
        before = len(storage.repairs())
        value = storage.load_json(path, None)
        return value == {"spools": 4} and len(storage.repairs()) == before + 1, \
            f"A damaged record came back as {json.dumps(value)} from its last good copy"
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        # The test repair is not a repair of your data: leave it out of the list.
        with storage._repairs_lock:
            storage._repairs[:] = [r for r in storage._repairs if r["file"] != "record.json"]


def _safety_copies():
    st = memory.status()
    if not st["copies"]:
        return False, "No safety copy yet (the first is made within minutes of starting)"
    return True, f"{len(st['copies'])} kept, newest {st['newest']}, {st['records']} records looked after"


def _layer_rules():
    out = layer_planner.plan([{"toolhead": "T0", "nozzle": 0.4, "height": 0.12},
                              {"toolhead": "T1", "nozzle": 0.6, "height": 0.36}])
    heads = {h["toolhead"]: h for h in out.get("heads", [])}
    ok = abs(float(out.get("grid", 0)) - 0.12) < 1e-9 and heads.get("T1", {}).get("every") == 3 and all(h.get("ok") for h in heads.values())
    return ok, f"0.12 mm and 0.36 mm share a {out.get('grid')} mm fine layer; T1 prints one pass every {heads.get('T1', {}).get('every')} layers"


def _update_hash():
    # Git's own hash of "hello\n" (git hash-object): updates check every file this way.
    return app_updates.git_blob_sha(b"hello\n") == "ce013625030ba8dba906f756967f9e9ca394464a", \
        "The updater's file check matches git's own hash"


CHECKS = (
    ("Pre-flight stops a bad file", "A move off the 270 mm bed blocks the print", _preflight_blocks),
    ("Pre-flight passes a good file", "The two-colour Benchy sample is clear", _preflight_clears),
    ("Moves are read the way Klipper reads them", "No sneaking a move past the check", _klipper_reading),
    ("No emergency stop in a file edit", "M112 can't be written into a print", _no_emergency_stop_in_edits),
    ("Only home-network names answer", "A web page can't reach the dashboard by pointing its own domain at it", _host_check),
    ("Damaged records repair themselves", "A cut-short file comes back from its last good copy", _repair),
    ("Safety copies are being made", "Everything the dashboard remembers is copied", _safety_copies),
    ("Mixed layer heights follow the rules", "Each head's layer is a whole number of a shared fine layer", _layer_rules),
    ("Updates are checked file by file", "Every downloaded file must match GitHub's record of it", _update_hash),
)


def run():
    started = time.perf_counter()
    results = [_check(n, w, f) for n, w, f in CHECKS]
    return {"results": results, "passed": sum(r["passed"] for r in results), "total": len(results),
            "ms": round((time.perf_counter() - started) * 1000), "ran_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "version": app_updates.version(),
            "full_suite": "The full proof is the automated test suite: python3 -m unittest discover tests"}
