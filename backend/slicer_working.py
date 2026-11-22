"""
slicer_working.py
=================

What the Slicer's sidebar shows and sets: one *working profile*, rebuilt from the sidebar whenever something changes or a slice starts.

The sidebar is not a list of saved profiles. It shows the stock Snapmaker U1 presets that fit the four fitted heads (the engine's own
files, read from the engine that is installed), a choice of process preset, and what the person changed on top of it. This module reads
that state for the screen and, on request, writes the working profile the slice then uses, through the same checks as every other
profile (slicer_profiles.prepare): nozzle sizes, layer-height limits per nozzle, material match. Nothing is invented here: a setting
nobody changed is never written, and the engine applies its own limits when it slices.

The four heads are the same records Tools & filaments keeps (tool_setup.py), so a change in the Slicer changes them everywhere.
"""

import process_settings
import slicer_bridge
import slicer_profiles
import tool_setup

WORKING_NAME = "Slicer working settings"
SPEED_UNIT = "mm/s"


def _engine_problem():
    path, _ = slicer_bridge.slicer_path()
    if not path:
        return ("There is no slicing engine yet. Install it from the Printer block, or choose a Snapmaker Orca you installed yourself "
                "in Slicer settings")
    return None


def _heads_for_choice():
    heads = tool_setup.get()["heads"]
    if len(heads) == 4:
        return heads, False
    return slicer_bridge._stock_heads(), True


def _speed_keys():
    return [k for k, o in process_settings.OPTIONS.items() if o.get("unit") == SPEED_UNIT and o["tab"] == "Speed"]


def _process_rows(presets, machine):
    """The process presets that fit this printer preset, with the values the screen needs to show what the profile says."""
    out = []
    name = machine["name"]
    for r in presets:
        if r["type"] != "process":
            continue
        compatible = r.get("compatible_printers") or []
        if compatible and name not in compatible:
            continue
        opts = r.get("options") or {}
        out.append({"id": r["id"], "name": r["name"], "layer_height": r.get("layer_height"),
                    "options": {k: v for k, v in opts.items()}})
    out.sort(key=lambda r: (float(r["layer_height"] or 9), r["name"]))
    return out


def _filament_rows(presets, machine):
    """
    The engine's own filament presets that fit this printer, as the screen offers them per head: only the materials a head record can hold
    (tool_setup.MATERIALS; carbon-fibre and other special blends are set on the printer), one row for each name, Snapmaker's own first.
    """
    out, seen = [], set()
    for r in presets:
        if r["type"] != "filament":
            continue
        compatible = r.get("compatible_printers") or []
        material = str(r.get("material") or "").upper()
        if (compatible and machine["name"] not in compatible) or material not in tool_setup.MATERIALS:
            continue
        label = r["name"].split(" @")[0]
        if label in seen:
            continue
        seen.add(label)
        own = {k: (v[0] if isinstance(v, list) and v else v) for k, v in (r.get("material_options") or {}).items()}
        out.append({"id": r["id"], "name": r["name"], "label": label, "material": material, "brand": label.split(" ")[0], "own": own})
    rank = {"Snapmaker": 0, "Generic": 1}
    for row in out:
        row["stock"] = False
    for kind in tool_setup.MATERIALS:
        same = [r for r in out if r["material"] == kind]
        if same:
            best = min(same, key=lambda r: slicer_profiles.stock_rank({"name": r["name"]}, kind))
            best["stock"] = True
    out.sort(key=lambda r: (rank.get(r["brand"], 2), r["brand"], tool_setup.MATERIALS.index(r["material"]), r["label"]))
    return out


def state():
    """Everything the sidebar needs, with a plain `problem` when it cannot be built (no engine, no presets, mixed nozzles)."""
    settings = slicer_bridge.get_settings()
    path, source = slicer_bridge.slicer_path(settings)
    caps = slicer_bridge.engine_capabilities(settings)
    out = {"ready": False, "problem": None, "engine": {"path": bool(path), "source": source, "checked": bool((settings.get("last_check") or {}).get("ok")),
                                                           "version": (settings.get("last_check") or {}).get("version")},
           "per_tool_heights": bool(caps.get("per_tool_heights")), "thick_layer_modes": bool(caps.get("thick_layer_modes")),
           "heads": tool_setup.get()["heads"], "profile": None, "speed_keys": _speed_keys()}
    work = next((p for p in settings["profiles"] if p.get("working")), None)
    if work:
        out["profile"] = {"id": work["id"], "options": work.get("options") or {}, "layer_mode": work.get("layer_mode"),
                          "warnings": work.get("warnings") or [], "layer_plan": work.get("layer_plan")}
    problem = _engine_problem()
    if problem:
        out["problem"] = problem
        return out
    found = slicer_bridge.installed_catalog()
    if not found["available"]:
        out["problem"] = found["problem"]
        return out
    heads, made = _heads_for_choice()
    try:
        pick = slicer_profiles.stock_choice(found["presets"], heads)
    except ValueError as exc:
        out["problem"] = str(exc)
        return out
    machine = next(r for r in found["presets"] if r["id"] == pick["machine"])
    out.update({"ready": True, "heads": heads, "heads_saved": not made, "machine": {"id": machine["id"], "name": machine["name"], "nozzles": machine.get("nozzles")},
                "stock": {"process": pick["process"], "filaments": pick["filaments"], "names": pick["names"], "notes": pick["notes"]},
                "processes": _process_rows(found["presets"], machine), "filaments": _filament_rows(found["presets"], machine),
                "filament_limits": {k: list(v) for k, v in slicer_profiles.FILAMENT_NUMBERS.items()}})
    return out


def sync_heads():
    """Read the four heads again from what the printer reports and save them (the same record Tools & filaments keeps)."""
    tool_setup.save({"heads": slicer_bridge._stock_heads()})
    return {"heads": tool_setup.get()["heads"]}


def set_working(body):
    """
    Replace the working profile with one built from the sidebar: `process` (a preset id, or none for the stock choice), `options` (the
    process settings changed), `layer_mode` ('shared' or 'per_tool'), `heads` (the four head records, when changed) and
    `material_options`. Returns the profile and the engine's plain-words notes.
    """
    problem = _engine_problem()
    if problem:
        raise ValueError(problem)
    found = slicer_bridge.installed_catalog()
    if not found["available"]:
        raise ValueError(found["problem"])
    if body.get("heads") is not None:
        tool_setup.save({"heads": body["heads"]})
    heads = tool_setup.get()["heads"]
    if len(heads) != 4:
        tool_setup.save({"heads": slicer_bridge._stock_heads()})
        heads = tool_setup.get()["heads"]
    pick = slicer_profiles.stock_choice(found["presets"], heads)
    process_id = body.get("process") or pick["process"]
    rows = {r["id"]: r for r in found["presets"]}
    if process_id not in rows or rows[process_id]["type"] != "process":
        raise ValueError("That print preset is not one of the engine's presets for this printer")
    options = body.get("options") or {}
    if not isinstance(options, dict):
        raise ValueError("Print settings must be a settings object")
    filaments, filament_names = list(pick["filaments"]), list(pick["names"]["filaments"])
    chosen = body.get("filament_presets")
    if chosen is not None:
        if not isinstance(chosen, list) or len(chosen) != 4:
            raise ValueError("Choose a filament for each of the four heads, or leave one blank for the stock choice")
        fitting = {r["name"]: r for r in _filament_rows(found["presets"], rows[pick["machine"]])}
        fitting.update({r["label"]: r for r in fitting.values()})
        for i, name in enumerate(chosen):
            if not name:
                continue
            row = fitting.get(str(name))
            if row is None:
                raise ValueError(f"T{i}: {str(name)[:60]} is not one of the engine's filaments for this printer, or its material is one a head cannot hold")
            filaments[i], filament_names[i] = row["id"], row["name"]
    pick["names"] = {**pick["names"], "filaments": filament_names}
    request = {"name": WORKING_NAME, "machine": pick["machine"], "process": process_id, "filaments": filaments,
               "options": options, "layer_mode": body.get("layer_mode") or "shared",
               "material_options": body.get("material_options") or [{}, {}, {}, {}]}
    settings = slicer_bridge.get_settings()
    old = [p["id"] for p in settings["profiles"] if p.get("working")]
    # Checked first, so a refused change leaves the working profile that was there; the old one goes only once the new one exists
    # (unless the list is full, when the old one has to make room).
    if len(settings["profiles"]) >= slicer_bridge.MAX_PROFILES:
        for pid in old:
            slicer_bridge.remove_profile(pid)
        old = []
    saved = slicer_bridge.add_installed_profile(request)
    new_id = saved["default_profile"]
    for pid in old:
        slicer_bridge.remove_profile(pid)
    settings = slicer_bridge.get_settings()
    entry = next(p for p in settings["profiles"] if p["id"] == new_id)
    entry["working"] = True
    settings["default_profile"] = new_id
    slicer_bridge._save(settings)
    return {"profile_id": new_id, "warnings": entry.get("warnings") or [], "layer_plan": entry.get("layer_plan"), "names": pick["names"],
            "layer_mode": entry.get("layer_mode"), "options": entry.get("options") or {}}
