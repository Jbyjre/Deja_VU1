"""Persistent per-printer preparation choices; physical readings stay authoritative."""
import copy
import os
import re
import threading

import layer_planner
import mock_moonraker
import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "tool_setup.json")
_lock = threading.RLock()
MATERIALS = ("PLA", "PETG", "ABS", "ASA", "TPU", "PVA", "PA", "PC")


def filament_fields(body):
    tool = str(body.get("toolhead", ""))
    colour = str(body.get("color_hex", ""))
    material = str(body.get("material", "")).upper()
    if tool not in ("T0", "T1", "T2", "T3"):
        raise ValueError("Choose a physical toolhead, T0 to T3. Feeder slots are not extra toolheads")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", colour):
        raise ValueError("Choose a colour in #RRGGBB format")
    if material not in MATERIALS:
        raise ValueError("Choose PLA, PETG, ABS, ASA, TPU, PVA, PA or PC; set special materials on the printer")
    return tool, colour.lower(), material


def get(printer_id=None):
    pid = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        saved = storage.load_json(_PATH, {}).get(pid, {})
    return {"printer": pid, "heads": copy.deepcopy(saved.get("heads", [])),
            "note": "Saved choices are not sensor readings. Apply filament changes while idle and check the printer's reply."}


def save(body):
    heads = body.get("heads")
    if not isinstance(heads, list) or len(heads) != 4:
        raise ValueError("Save all four physical toolheads together")
    checked = []
    for row in heads:
        if not isinstance(row, dict):
            raise ValueError("Each toolhead needs its own settings")
        tool, colour, material = filament_fields(row)
        nozzle = layer_planner._nozzle(row.get("nozzle"))
        height = layer_planner._height(row.get("height"))
        lo, hi = layer_planner.U1_LIMITS[nozzle]
        if not lo <= height <= hi:
            raise ValueError(f"{tool}: use a layer height between {lo} and {hi} mm for this nozzle")
        checked.append({"toolhead": tool, "color_hex": colour, "material": material,
                        "nozzle": nozzle, "height": height, "spool_id": str(row.get("spool_id") or "")[:80]})
    if len({h["toolhead"] for h in checked}) != 4:
        raise ValueError("Each physical toolhead must appear exactly once")
    assigned=[h['spool_id'] for h in checked if h['spool_id']]
    if len(assigned)!=len(set(assigned)):
        raise ValueError('A physical spool can be assigned to one head. Add separate spool records for separate spools of the same colour')
    if assigned:
        import filament_inventory
        inventory={s['id']:s for s in filament_inventory.get_inventory()}
        for h in checked:
            if not h['spool_id']:
                continue
            spool=inventory.get(h['spool_id'])
            if not spool:
                raise ValueError(f"{h['toolhead']}: that spool no longer exists. Choose another or select by hand")
            if spool['material'].upper()!=h['material'] or spool['color_hex'].lower()!=h['color_hex']:
                raise ValueError(f"{h['toolhead']}: the selected spool has a different material or colour. Update the spool or choose by hand")
    pid = mock_moonraker.selected_printer_id()
    with _lock:
        data = storage.load_json(_PATH, {})
        data[pid] = {"heads": sorted(checked, key=lambda h: h["toolhead"])}
        storage.save_json(_PATH, data)
    return get(pid)


def check_saved(state):
    notes = []
    for row in get(state.get("printer_id"))["heads"]:
        actual = state.get("toolheads", {}).get(row["toolhead"], {}).get("nozzle_diameter")
        if actual is not None and abs(actual - row["nozzle"]) > .001:
            notes.append(f"{row['toolhead']}: saved nozzle {row['nozzle']} mm differs from the printer's {actual} mm. Update preparation before slicing")
    return notes


def compatibility():
    """Read-only detection does not prove installation safety or supported commands."""
    pid = mock_moonraker.selected_printer_id()
    if mock_moonraker.is_real(pid):
        printer = mock_moonraker.real_printer(pid)
        with printer.lock:
            names = sorted(set(printer._objects) | set(printer._status))
    else:
        mock_moonraker._sim()
        names = ["print_task_config", "extruder", "extruder1", "extruder2", "extruder3"]
    groups = [("Automatic feeder", ("afc",)), ("Serial feeder", ("bmcu",)),
              ("External feeder lanes", ("sc_lane", "multiace"))]
    return {"physical_heads": 4, "objects": names,
            "addons": [{"name": label, "detected": any(any(t in n.lower() for t in tokens) for n in names)}
                       for label, tokens in groups],
            "installation_allowed": False,
            "note": "Read-only detection. Extra feeder slots need verified tool mapping and post-processing. No printer software is installed or changed here."}
