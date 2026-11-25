"""
print_gate.py
=============

The last stop before a print starts: one summary that answers "is it OK to
print this file on this printer, right now?" and a hard interlock that
refuses to start a print when the answer is no.

It combines checks that already exist elsewhere, plus the file itself:

  printer ready?     the printer must be idle (ready or finished) with no
                     dock reporting an error                    -> blocks
  pre-flight         gcode_tools' check of every move in the file:
                     errors (out of bounds, below the bed, unknown
                     toolhead, too hot) block; warnings need a confirm
  filament match     each toolhead the file uses must have filament
                     loaded, in the colour the file was sliced for,
                     as the printer itself reports it     -> mismatch blocks
  nozzles            the nozzle each toolhead was sliced for must match
                     the one the printer reports fitted    -> mismatch blocks
  spool weight       enough filament left on the matching spool? (from the
                     filament inventory, when that module is on) -> warns
  maintenance        overdue tasks                           -> warns
  cost               material + electricity estimate          -> info

Verdicts: "blocked" (the start button is refused, by the server, not just
greyed out), "confirm" (warnings the person must read and accept) and
"clear".

The "print health" number is the same inputs folded into one 0-100 score
for the gauge, with every deduction listed so it is never a mystery. The
score never overrules the gate: while anything blocks the start, health says
"blocked" and stays below the "fair" line, so no screen can show a good
score beside a refused print.
"""

import re

import color_check
import cost_calculator
import file_library
import filament_inventory
import gcode_tools
import layer_planner
import maintenance
import mock_moonraker
import modules
import tool_setup


def _filament_match(required, state):
    """
    Compare what the file needs with what the printer reports loaded.

    A real printer may not know (no filament sensor, or a spool with no
    RFID tag and nothing set on its screen): that is "unknown" - a warning
    to check by eye - never treated as empty and never as a match. On a
    U1 whose filament mapping sends the file's T0 to another head, the
    head that will really print is the one checked.
    """
    rows, blocking, warnings = [], [], []
    mapping = state.get("extruder_map") or {}
    for req in required:
        th = req["toolhead"]
        head = mapping.get(th, th)
        dock = state["toolheads"].get(head)
        row = {"toolhead": th, "expected_hex": req.get("expected_color_hex"),
               "expected_material": req.get("expected_material"), "grams": req.get("grams")}
        if head != th:
            row["prints_on"] = head
        where = th if head == th else f"{th} (printing on {head}, the printer's filament mapping)"
        if dock is None:
            row["status"] = "missing_toolhead"
            blocking.append(f"The file uses {where}, which this printer doesn't have")
        elif dock["status"] == "error" or dock.get("filament_loaded") is False:
            row["status"] = "not_loaded"
            blocking.append(f"{where} has no filament loaded or is reporting an error")
        elif dock.get("filament_loaded") is None:
            row["status"] = "unknown"
            warnings.append(f"The printer doesn't report what's loaded on {where} - check it by eye")
        else:
            row["loaded_hex"] = dock.get("filament_color_hex")
            row["loaded_name"] = dock.get("filament_color_name")
            if req.get("expected_color_hex") and dock.get("filament_color_hex"):
                verdict = color_check.compare(req["expected_color_hex"], dock["filament_color_hex"])
                row["status"] = verdict["verdict"]
                if verdict["verdict"] == "mismatch":
                    blocking.append(f"{where} has {dock.get('filament_color_name') or dock['filament_color_hex']} "
                                    f"loaded, but the file was sliced for {req['expected_color_hex']}")
                elif verdict["verdict"] == "close":
                    warnings.append(f"{where}'s colour is a close call against the file - worth a glance")
            elif req.get("expected_color_hex"):
                row["status"] = "unknown_colour"
                warnings.append(f"{where} has filament loaded, but the printer doesn't know its colour "
                                "(no RFID tag, and none set on its screen) - check it by eye")
            else:
                row["status"] = "no_colour_in_file"
            actual_material = dock.get("filament_material")
            if req.get("expected_material") and actual_material and req["expected_material"].upper() != actual_material.upper():
                row["material_mismatch"] = True
                row["loaded_material"] = actual_material
                blocking.append(f"{where} has {actual_material} loaded, but the file needs {req['expected_material']}")
        if dock is not None:
            # What the colour sensor reads, kept apart from the file's colour and the printer's report.
            # Advice only: a warning asks for a look, nothing here blocks a start.
            seen = color_check.evidence(head, state, req.get("expected_color_hex"))
            if seen:
                row["measured"] = seen
                note = color_check.advice(where, req.get("expected_color_hex"), row.get("loaded_hex"), seen)
                if note:
                    seen["advice"] = {"level": note[0], "text": note[1]}
                    if note[0] == "warn":
                        warnings.append(note[1])
        rows.append(row)
    return rows, blocking, warnings


def _box(analysis):
    """Where a file prints on the bed: [min x, min y, max x, max y] in mm, from the extruded moves."""
    bounds = (analysis or {}).get("bounds")
    if not bounds:
        return None
    return [bounds["min"][0], bounds["min"][1], bounds["max"][0], bounds["max"][1]]


def _leftover(bed, analysis, machine):
    """
    The print that ended on this bed and may still be there, against where this file will print. The last file's place is known only
    while it is still in the library; a part the printer was halted in is somewhere in that same box.
    """
    name = bed.get("file")
    last = None
    if name and file_library.exists(name) and file_library.kind_of(name) == "gcode":
        try:
            last = _box(file_library.checked(name, machine))
        except (ValueError, OSError, KeyError):
            last = None
    this = _box(analysis)
    overlaps = bool(this and last and this[0] < last[2] and last[0] < this[2] and this[1] < last[3] and last[1] < this[3])
    return {"file": name, "outcome": bed.get("outcome"), "this_box": this, "leftover_box": last, "overlaps": overlaps}


from print_record import _SLICED_FROM    # one pattern for the note Files keeps on a sliced file


def _model_of(filename):
    """The model a G-code file was sliced from in Deja Vu1, while that model is still in the library (else None)."""
    note = (file_library.origins().get(filename) or {}).get("note") or ""
    m = _SLICED_FROM.match(note)
    return m.group(1) if m and file_library.exists(m.group(1)) else None


def _fixes(filename, state, pre, fil_block, noz_block, bed_check):
    """Each refusal's way out, in the order the screen offers them: one per kind, each a place, never a start."""
    out = []

    def add(kind, label, **extra):
        if not any(f["kind"] == kind for f in out):
            out.append({"kind": kind, "label": label, **extra})
    if state["state"] in ("printing", "paused") and modules.is_enabled("print_queue"):
        add("queue", "Add it to the queue")
    if state["state"] == "error" or state.get("resume_saved"):
        add("printer", "Open the Printer page")
    model = _model_of(filename) if (pre["errors"] or fil_block) else None
    if model:
        add("slicer", f"Open {model} in the Slicer", model=model)
    if fil_block:
        add("loaded", "See what is loaded")
    if noz_block:
        add("nozzle", "Record a nozzle swap")
    if bed_check:
        add("bed", "Go to the bed check")
    return out


def summary(filename, printer_state=None):
    """The whole Confirm Print screen for one file on the selected printer."""
    if file_library.kind_of(filename) != "gcode":
        raise ValueError("Only G-code files can be printed - slice models first")
    if not file_library.exists(filename):
        # Said in words: a deleted or never-added file was a server error before.
        raise ValueError(f"No file called {filename} in your files. Add it again, or pick another one")
    state = printer_state or mock_moonraker.get_printer_state()
    # Checked against the printer it is for: its own size and heads.
    analysis = file_library.checked(filename, state.get("machine"))
    blocking, warnings, info = [], [], []
    bed_check = None
    if modules.is_enabled('filament_inventory'):
        warnings += tool_setup.check_saved(state)

    # -- the printer itself ---------------------------------------------------
    if state["state"] in ("printing", "paused"):
        blocking.append(f"The printer is busy ({state['state']} {state.get('current_file') or ''})".strip())
    elif state["state"] == "error":
        blocking.append(f"The printer is reporting an error: {state.get('state_message')}")
    if state.get("resume_saved"):
        # The U1 kept the print it was halted in and can restart it by itself, onto whatever is on the bed now.
        blocking.append("The printer still holds a halted print and can restart it by itself. Discard it on the Printer screen, "
                        "or restore it on the printer's own screen, before starting another")
    errored = [th for th, d in state["toolheads"].items() if d["status"] == "error"]
    required = gcode_tools.required_filament(analysis)
    used = {r["toolhead"] for r in required}
    for th in errored:
        if th not in used:
            warnings.append(f"Dock {th} is reporting an error (this file doesn't use it)")

    # -- the file -------------------------------------------------------------
    pre = analysis["preflight"]
    blocking += [f"Pre-flight: {e['message']}" + (f" (line {e['line']})" if e["line"] else "")
                 for e in pre["errors"]]
    warnings += [f"Pre-flight: {w['message']}" + (f" (line {w['line']})" if w["line"] else "")
                 for w in pre["warnings"]]

    # -- filament -------------------------------------------------------------
    rows, fil_block, fil_warn = _filament_match(required, state)
    blocking += fil_block
    warnings += fil_warn
    info += [row["measured"]["advice"]["text"] for row in rows
             if row.get("measured", {}).get("advice", {}).get("level") == "info"]
    spools = None
    if modules.is_enabled("filament_inventory"):
        spools = filament_inventory.estimate_for_job(required,state)
        for s in spools:
            if s["status"] == "short":
                warnings.append(f"{s['toolhead']}: the matching spool has about {s['grams_remaining']:.0f} g "
                                f"left; this print needs {s['grams_needed']:.0f} g")
            elif s["status"] == "unknown_weight":
                info.append(f"{s['toolhead']}: the weight of {s['spool']} isn't known, so there's no check that "
                            "enough is left. Weigh it in Care, Filament inventory")
            elif s["status"] == "no_spool":
                info.append(f"{s['toolhead']}: no matching spool in your filament inventory to check weight against")

    # -- nozzles: what each used toolhead was sliced for, against what the
    # printer reports fitted (matters most for mixed-nozzle prints) --------
    noz_block, noz_info, nozzles = layer_planner.check_nozzles(analysis["meta"], used, state["toolheads"])
    blocking += noz_block
    info += noz_info

    # -- the bed: a print that ended here may still be on it ----------------------
    if modules.is_enabled("print_queue"):
        import print_queue                       # here: print_queue imports this module
        bed = print_queue.bed_state(state.get("printer_id"))
        if bed["state"] == "awaiting_clear":
            warnings.append(f"{bed.get('file') or 'The last print'} ended on this printer and may still be on "
                            "the bed. Take it off and check the bed is clear before starting")
            bed_check = _leftover(bed, analysis, state.get("machine"))
            if bed_check["overlaps"]:
                lx0, ly0, lx1, ly1 = bed_check["leftover_box"]
                warnings.append(f"This print would sit where {bed.get('file') or 'the last print'} did: X {lx0:.0f} to {lx1:.0f} mm, "
                                f"Y {ly0:.0f} to {ly1:.0f} mm")

    # -- maintenance ----------------------------------------------------------
    maint = maintenance.get_status()
    overdue = [t["name"] for t in maint["tasks"] if t["status"] == "overdue"]
    if overdue:
        warnings.append("Maintenance overdue: " + ", ".join(overdue))

    # -- cost -----------------------------------------------------------------
    material = (analysis["meta"].get("filament_types") or ["PLA"])[0]
    cost = cost_calculator.compute_job_cost(material, analysis["filament_grams"],
                                            analysis["estimated_hours"])

    verdict = "blocked" if blocking else ("confirm" if warnings else "clear")
    fixes = _fixes(filename, state, pre, fil_block, noz_block, bed_check)
    return {
        "filename": filename,
        "verdict": verdict,
        "blocking": blocking,
        # What each refusal's fix is, as a place to go: the screen turns each one into a button.
        "fixes": fixes,
        "warnings": warnings,
        "info": info,
        "printer_state": state["state"],
        # Set while a print that ended here may still be on the bed: the start then needs the bed_clear tick, not only the warnings read.
        "bed_check": bed_check,
        "estimated_hours": analysis["estimated_hours"],
        "estimated_hours_source": analysis["estimated_hours_source"],
        "filament_grams": analysis["filament_grams"],
        "filament_grams_source": analysis["filament_grams_source"],
        "layers": analysis["layers"],
        "preflight": pre,
        "filament": rows,
        "nozzles": nozzles,
        "spools": spools,
        "maintenance": {"overdue": overdue, "due_soon": [t["name"] for t in maint["tasks"]
                                                         if t["status"] == "due_soon"]},
        "cost": cost,
        "health": health(pre, rows, maint, blocking),
        "job": {
            "estimated_hours": analysis["estimated_hours"],
            "layers": analysis["layers"],
            "filament_grams": analysis["filament_grams"],
            "material": material,
            "required_filament": [{"toolhead": r["toolhead"],
                                   "expected_color_hex": r.get("expected_hex"),
                                   "expected_color_name": r.get("loaded_name"),
                                   "expected_material": r.get("expected_material")} for r in rows],
            "footprint_mm": analysis["footprint_mm"],
            "objects": analysis.get("objects") or [],
        },
    }


# While a start is refused, the score stays under the "fair" line (55).
BLOCKED_CEILING = 54
_BAD_FILAMENT = ("mismatch", "not_loaded", "missing_toolhead")


def health(preflight, filament_rows, maint, blocking=None):
    """
    One 0-100 number for the gauge. Starts at 100; every deduction is listed.

    `blocking` is the gate's list of reasons it refuses the start. When there
    are any, the band is "blocked" whatever the score, and the score is held
    at BLOCKED_CEILING or below with that cap listed as its own deduction.
    """
    score, parts = 100, []

    def take(points, why):
        nonlocal score
        score -= points
        parts.append({"points": -points, "reason": why})

    overdue = sum(1 for t in maint["tasks"] if t["status"] == "overdue")
    soon = sum(1 for t in maint["tasks"] if t["status"] == "due_soon")
    if overdue:
        take(min(45, overdue * 15), f"{overdue} maintenance task overdue" if overdue == 1 else f"{overdue} maintenance tasks overdue")
    if soon:
        take(min(15, soon * 5), f"{soon} maintenance task due soon" if soon == 1 else f"{soon} maintenance tasks due soon")
    if filament_rows is not None:
        bad = [r for r in filament_rows if r["status"] in _BAD_FILAMENT]
        close = [r for r in filament_rows if r["status"] == "close"]
        material = [r for r in filament_rows if r.get("material_mismatch")]
        if bad:
            take(35, "Filament doesn't match the file on " + ", ".join(r["toolhead"] for r in bad))
        if material:
            take(35, "Wrong material loaded on " + ", ".join(r["toolhead"] for r in material))
        if close:
            take(10, "Filament colour is a close call on " + ", ".join(r["toolhead"] for r in close))
        unknown = [r for r in filament_rows if r["status"] in ("unknown", "unknown_colour")]
        if unknown:
            take(10, "Can't check the filament on " + ", ".join(r["toolhead"] for r in unknown)
                 + " - the printer doesn't report it")
    if preflight is not None:
        if preflight["errors"]:
            take(40, f"{len(preflight['errors'])} pre-flight error(s)")
        if preflight["warnings"]:
            take(min(20, 8 * len(preflight["warnings"])), f"{len(preflight['warnings'])} pre-flight warning(s)")
    score = max(0, score)
    blocking = list(blocking or [])
    if blocking and score > BLOCKED_CEILING:
        more = f" (and {len(blocking) - 1} more)" if len(blocking) > 1 else ""
        take(score - BLOCKED_CEILING, f"Held below fair while Confirm Print would refuse: {blocking[0]}{more}")
    if blocking:
        band = "blocked"
    else:
        band = "good" if score >= 80 else ("fair" if score >= 55 else "poor")
    return {"score": score, "band": band, "deductions": parts, "blocked": bool(blocking), "blocking": blocking}


def printer_health():
    """The gauge when no file is selected: maintenance and the loaded job."""
    state = mock_moonraker.get_printer_state()
    req = mock_moonraker.get_current_job_requirements()["required_filament"]
    rows, blocking = None, []
    if req:
        rows, blocking, _ = _filament_match(
            [{"toolhead": r["toolhead"], "expected_color_hex": r["expected_color_hex"],
              "expected_material": r["expected_material"]} for r in req], state)
    if state.get("link_lost"):
        blocking.insert(0, "The printer isn't answering")
    elif state.get("state") == "error":
        blocking.insert(0, f"The printer is reporting an error: {state.get('state_message') or 'no details'}")
    result = health(None, rows, maintenance.get_status(), blocking)
    result["scope"] = "printer"
    return result
