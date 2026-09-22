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
  spool weight       enough filament left on the matching spool? (from the
                     filament inventory, when that module is on) -> warns
  maintenance        overdue tasks                           -> warns
  cost               material + electricity estimate          -> info

Verdicts: "blocked" (the start button is refused, by the server, not just
greyed out), "confirm" (warnings the person must read and accept) and
"clear".

The "print health" number is the same inputs folded into one 0-100 score
for the gauge, with every deduction listed so it is never a mystery.
"""

import color_check
import cost_calculator
import file_library
import filament_inventory
import gcode_tools
import maintenance
import mock_moonraker
import modules


def _filament_match(required, state):
    """Compare what the file needs with what the printer reports loaded."""
    rows, blocking, warnings = [], [], []
    for req in required:
        th = req["toolhead"]
        dock = state["toolheads"].get(th)
        row = {"toolhead": th, "expected_hex": req.get("expected_color_hex"),
               "expected_material": req.get("expected_material"), "grams": req.get("grams")}
        if dock is None:
            row["status"] = "missing_toolhead"
            blocking.append(f"The file uses {th}, which this printer doesn't have")
        elif dock["status"] == "error" or not dock["filament_loaded"]:
            row["status"] = "not_loaded"
            blocking.append(f"{th} has no filament loaded or is reporting an error")
        else:
            row["loaded_hex"] = dock["filament_color_hex"]
            row["loaded_name"] = dock["filament_color_name"]
            if req.get("expected_color_hex"):
                verdict = color_check.compare(req["expected_color_hex"], dock["filament_color_hex"])
                row["status"] = verdict["verdict"]
                if verdict["verdict"] == "mismatch":
                    blocking.append(f"{th} has {dock['filament_color_name']} loaded, but the file "
                                    f"was sliced for {req['expected_color_hex']}")
                elif verdict["verdict"] == "close":
                    warnings.append(f"{th}'s colour is a close call against the file - worth a glance")
            else:
                row["status"] = "no_colour_in_file"
        rows.append(row)
    return rows, blocking, warnings


def summary(filename, printer_state=None):
    """The whole Confirm Print screen for one file on the selected printer."""
    if file_library.kind_of(filename) != "gcode":
        raise ValueError("Only G-code files can be printed - slice models first")
    analysis = gcode_tools.analyze(file_library.read_text(filename), want_toolpath=False)
    state = printer_state or mock_moonraker.get_printer_state()
    blocking, warnings, info = [], [], []

    # -- the printer itself ---------------------------------------------------
    if state["state"] in ("printing", "paused"):
        blocking.append(f"The printer is busy ({state['state']} {state.get('current_file') or ''})".strip())
    elif state["state"] == "error":
        blocking.append(f"The printer is reporting an error: {state.get('state_message')}")
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
    spools = None
    if modules.is_enabled("filament_inventory"):
        spools = filament_inventory.estimate_for_job(required)
        for s in spools:
            if s["status"] == "short":
                warnings.append(f"{s['toolhead']}: the matching spool has about {s['grams_remaining']:.0f} g "
                                f"left; this print needs {s['grams_needed']:.0f} g")
            elif s["status"] == "no_spool":
                info.append(f"{s['toolhead']}: no matching spool in your filament inventory to check weight against")

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
    return {
        "filename": filename,
        "verdict": verdict,
        "blocking": blocking,
        "warnings": warnings,
        "info": info,
        "printer_state": state["state"],
        "estimated_hours": analysis["estimated_hours"],
        "estimated_hours_source": analysis["estimated_hours_source"],
        "filament_grams": analysis["filament_grams"],
        "filament_grams_source": analysis["filament_grams_source"],
        "layers": analysis["layers"],
        "preflight": pre,
        "filament": rows,
        "spools": spools,
        "maintenance": {"overdue": overdue, "due_soon": [t["name"] for t in maint["tasks"]
                                                         if t["status"] == "due_soon"]},
        "cost": cost,
        "health": health(pre, rows, maint),
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
        },
    }


def health(preflight, filament_rows, maint):
    """
    One 0-100 number for the gauge. Starts at 100; every deduction is listed.
    """
    score, parts = 100, []

    def take(points, why):
        nonlocal score
        score -= points
        parts.append({"points": -points, "reason": why})

    overdue = sum(1 for t in maint["tasks"] if t["status"] == "overdue")
    soon = sum(1 for t in maint["tasks"] if t["status"] == "due_soon")
    if overdue:
        take(min(45, overdue * 15), f"{overdue} maintenance task(s) overdue")
    if soon:
        take(min(15, soon * 5), f"{soon} maintenance task(s) due soon")
    if filament_rows is not None:
        bad = [r for r in filament_rows if r["status"] in ("mismatch", "not_loaded", "missing_toolhead")]
        close = [r for r in filament_rows if r["status"] == "close"]
        if bad:
            take(35, "Filament doesn't match the file on " + ", ".join(r["toolhead"] for r in bad))
        if close:
            take(10, "Filament colour is a close call on " + ", ".join(r["toolhead"] for r in close))
    if preflight is not None:
        if preflight["errors"]:
            take(40, f"{len(preflight['errors'])} pre-flight error(s)")
        if preflight["warnings"]:
            take(min(20, 8 * len(preflight["warnings"])), f"{len(preflight['warnings'])} pre-flight warning(s)")
    score = max(0, score)
    band = "good" if score >= 80 else ("fair" if score >= 55 else "poor")
    return {"score": score, "band": band, "deductions": parts}


def printer_health():
    """The gauge when no file is selected: maintenance and the loaded job."""
    state = mock_moonraker.get_printer_state()
    req = mock_moonraker.get_current_job_requirements()["required_filament"]
    rows = None
    if req:
        rows, _, _ = _filament_match(
            [{"toolhead": r["toolhead"], "expected_color_hex": r["expected_color_hex"],
              "expected_material": r["expected_material"]} for r in req], state)
    result = health(None, rows, maintenance.get_status())
    result["scope"] = "printer"
    return result
