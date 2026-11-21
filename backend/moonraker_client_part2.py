"""
moonraker_client_part2.py: part 2 of 2 split out of moonraker_client.py (talking to a real printer through Moonraker)
on 19 November 2026: the printer state and job translation (job_from_metadata, _toolheads, _count, translate_state).
moonraker_client.py imports these back, so `moonraker_client.<name>` works as before.
"""

import machines
import printer_problems
from moonraker_client_part1 import _PRINT_STATES, _at, _hex, _num, _obj, _split, _str, clean_error, filament_from_metadata, live_or_commanded, plate_objects, print_sync, toolhead_for, tuning_from  # noqa: F401


def job_from_metadata(filename, meta):
    """The running job as the dashboard knows it (see mock_moonraker's printer.job)."""
    meta = meta if isinstance(meta, dict) else {}
    est = _num(meta.get("estimated_time"))
    required = filament_from_metadata(meta)
    types = _split(meta.get("filament_type"))
    return {
        "filename": filename,
        "total_hours": round(est / 3600.0, 4) if est else None,
        "layers": _count(meta.get("layer_count")),
        "filament_grams": _num(meta.get("filament_weight_total")),
        "filament_mm": _num(meta.get("filament_total")),
        "material": types[0] if types else None,
        "required_filament": required,
        "footprint_mm": None,
        "layer_height": _num(meta.get("layer_height")),
        "first_layer_height": _num(meta.get("first_layer_height")),
        "filament_diameter": _num(_at(meta.get("filament_diameter"), 0)) if isinstance(meta.get("filament_diameter"), list)
        else _num(meta.get("filament_diameter")),
        "source": "metadata",
    }


def _toolheads(status, extruders, ptc):
    """Every toolhead, keyed T0..Tn, and which one is on the carriage."""
    active = None
    carriage = _obj(status, "toolhead").get("extruder")
    parked_states = {th: _obj(status, name).get("state") for th, name in extruders.items()}
    if any(isinstance(s, str) for s in parked_states.values()):
        # The U1 reports each head's dock sensor: ACTIVATE = on the carriage.
        on = [th for th, s in parked_states.items() if s == "ACTIVATE"]
        active = on[0] if len(on) == 1 else (toolhead_for(carriage) if toolhead_for(carriage) in on else None)
    else:
        active = toolhead_for(carriage) if toolhead_for(carriage) in extruders else None
    out = {}
    for th, name in sorted(extruders.items(), key=lambda kv: int(kv[0][1:])):
        e = _obj(status, name)
        i = int(th[1:])
        exist = _at(ptc.get("filament_exist"), i)
        ftype = _at(ptc.get("filament_type"), i)
        known = isinstance(ftype, str) and ftype.strip().upper() not in ("", "NONE")
        colour = _hex(_at(ptc.get("filament_color_rgba"), i)) if known else None
        vendor = _at(ptc.get("filament_vendor"), i)
        label = None
        if known:
            parts = [vendor if isinstance(vendor, str) and vendor.upper() not in ("", "NONE") else None,
                     ftype.strip(), colour]
            label = " ".join(p for p in parts if p)
        out[th] = {
            "status": "active" if th == active else "docked",
            "temperature": _num(e.get("temperature")),
            "target_temperature": _num(e.get("target"), 0.0),
            # None = the printer doesn't say (no sensor / not a U1): unknown,
            # never "empty" and never "fine".
            "filament_loaded": bool(exist) if isinstance(exist, bool) else None,
            "filament_known": bool(known and colour),
            "filament_color_hex": colour,
            "filament_color_name": label,
            "filament_material": ftype.strip() if known else None,
            "dock_sensor": parked_states.get(th) if isinstance(parked_states.get(th), str) else None,
            # None = this printer doesn't report it (anything but a U1).
            "nozzle_diameter": _num(e.get("nozzle_diameter")),
            "swaps": _count(e.get("switch_count")),
            "swap_retries": _count(e.get("retry_count")),
            "swap_errors": _count(e.get("error_count")),
            "pressure_advance": _num(e.get("pressure_advance")),
            "smooth_time": _num(e.get("smooth_time")),
            "can_extrude": e.get("can_extrude") if isinstance(e.get("can_extrude"), bool) else None,
        }
    return out, active


def _count(value):
    """A whole, non-negative count from the printer, or None."""
    n = _num(value)
    return int(n) if n is not None and n >= 0 and n == int(n) else None


def translate_state(status, ctx):
    """
    Moonraker's printer objects -> the dict get_printer_state() returns.

    `status` is the merged subscription (print_stats, virtual_sdcard,
    webhooks, toolhead, gcode_move, heater_bed, extruder*, and on a U1
    print_task_config); `ctx` holds what this client knows besides it:
    printer_id, name, extruders ({"T0": "extruder", ...}), chamber (the
    sensor object, if any), job (the running file's details) and
    klippy_state / klippy_message when Klipper isn't ready.
    """
    # Every value is taken as whatever type actually arrived: a firmware
    # quirk or a future Moonraker change must never break a printer's state.
    status = status if isinstance(status, dict) else {}
    wh = _obj(status, "webhooks")
    ps = _obj(status, "print_stats")
    vsd = _obj(status, "virtual_sdcard")
    ds = _obj(status, "display_status")
    gm = _obj(status, "gcode_move")
    bed = _obj(status, "heater_bed")
    ptc = _obj(status, "print_task_config")
    job = ctx.get("job") or {}
    klippy = ctx.get("klippy_state") or _str(wh.get("state")) or "ready"
    raw = ps.get("state") if "state" in ps else "standby"
    raw = raw if isinstance(raw, str) and raw else ("standby" if raw in (None, "") else repr(raw)[:40])
    filename = _str(ps.get("filename")) or None

    state = _PRINT_STATES.get(raw)
    message = None
    if klippy != "ready":
        state = "error"
        message = clean_error(ctx.get("klippy_message") or _str(wh.get("state_message")) or f"Klipper is {klippy}")
    elif state is None:
        state = "error"
        message = f"The printer reports a state this dashboard doesn't know: {raw!r}"

    progress = min(1.0, max(0.0, _num(vsd.get("progress"), 0.0)))
    if state == "complete":
        progress = 1.0
    elif state == "ready":
        progress = 0.0

    info = ps.get("info") if isinstance(ps.get("info"), dict) else {}
    current, total = info.get("current_layer"), info.get("total_layer")
    estimated_layer = False
    if not isinstance(total, int) or total <= 0:
        total = job.get("layers") if isinstance(job.get("layers"), int) and job.get("layers") > 0 else None
    if not isinstance(current, int) and state in ("printing", "paused") and total:
        # Klipper only knows the layer when the slicer sends
        # SET_PRINT_STATS_INFO; otherwise estimate it from the nozzle height,
        # the way Mainsail and Fluidd do.
        z = _num(_at(gm.get("gcode_position"), 2))
        z = z if z is not None and abs(z) < 1e6 else None
        lh, flh = job.get("layer_height"), job.get("first_layer_height") or job.get("layer_height")
        if z is not None and lh and flh:
            current = int(min(total, max(1, round((z - flh) / lh) + 1)))
            estimated_layer = True
    if not isinstance(current, int):
        current = None
    if state == "complete" and total:
        current = total

    extruders = ctx.get("extruders") or {}
    toolheads, active = _toolheads(status, extruders, ptc)
    pos, source = live_or_commanded(_obj(status, "toolhead"), _obj(status, "motion_report"))
    chamber_obj = ctx.get("chamber")
    chamber = _num(_obj(status, chamber_obj).get("temperature")) if chamber_obj else None

    if message is None:
        if state == "printing":
            message = (f"Printing layer {current} of {total}" if current and total
                       else f"Printing {filename or ''}".strip())
        elif state == "paused":
            message = "Paused"
        elif state == "complete":
            message = f"Finished {filename or ''}".strip()
        elif state == "error":
            message = clean_error(_str(ps.get("message")) or "The print stopped with an error")
        else:
            message = "Idle" if raw != "cancelled" else "Idle - the last print was cancelled"

    # The U1 says why a print paused or stopped as a code (print_stats.exception); the code is read here, whatever the
    # state, so a pause the printer raised itself is never mistaken for one pressed by hand.
    texts = [t for t in (_str(ps.get("message")), _str(ctx.get("klippy_message")), _str(wh.get("state_message"))) if t]
    standing = list(_obj(status, "exception_manager").get("exceptions") or []) + list(ctx.get("standing") or [])
    problems = [printer_problems.public(p) for p in printer_problems.collect(
        state, ps.get("exception"), standing, ctx.get("notified"), texts)]
    if problems and state in ("paused", "error"):
        said = printer_problems.words(problems[0])
        if state == "paused":
            message = f"Paused: {said}"
        elif problems[0]["code"] not in message:
            message = said if message.startswith("The print stopped with an error") else f"{message} ({problems[0]['code']})"
    elif state == "paused" and _str(ps.get("message")):
        message = "Paused: " + clean_error(_str(ps.get("message")))

    out = {
        "state": state,
        "state_message": message,
        "current_file": filename if state != "ready" else None,
        "progress": round(progress, 4),
        "print_duration_hours": round(_num(ps.get("print_duration"), 0.0) / 3600.0, 4),
        "display_progress": (round(min(1.0, max(0.0, _num(ds.get("progress")))), 4) if _num(ds.get("progress")) is not None else None),
        "active_toolhead": active,
        "toolheads": toolheads,
        "bed_temperature": _num(bed.get("temperature")),
        "bed_target": _num(bed.get("target"), 0.0),
        "chamber_temperature": chamber,
        "toolhead_position": [round(_num(v, 0.0), 2) for v in pos],
        "position_source": source,
        "layer": {"current": current, "total": total, **({"estimated": True} if estimated_layer else {})},
        "printer_id": ctx.get("printer_id"),
        "printer_name": ctx.get("name"),
        "klipper_state": raw,
        "real": True,
        "machine": machines.public(ctx.get("machine")),
    }
    if problems:
        out["problem"] = problems[0]
        out["problems"] = problems
    out["tuning"] = tuning_from(status, ctx.get("extras") or {})
    homed = _obj(status, "toolhead").get("homed_axes")
    if isinstance(homed, str):
        out["homed_axes"] = "".join(a for a in "xyz" if a in homed.lower())
    plate = plate_objects(_obj(status, "exclude_object"))
    if plate and state in ("printing", "paused"):
        out["objects"] = plate
    if state in ("printing", "paused"):
        out["sync"] = print_sync(vsd, gm, _obj(status, "motion_report"))
    # Filament speed at the nozzle now (mm/s, negative while retracting): the twin turns the spool and moves
    # the filament in its tube with it, in a print and outside one (a purge or a feed).
    speed = _num(_obj(status, "motion_report").get("live_extruder_velocity"))
    out["extruder_velocity"] = round(speed, 3) if speed is not None and abs(speed) < 1e4 else None
    table = ptc.get("extruder_map_table")
    if isinstance(table, list) and extruders:
        # Only the physical heads' slots: the U1 pads the table to 32 logical
        # extruders with zeros (print_task_config.py DEFAULT_PRINT_TASK_CONFIG).
        mapping = {f"T{i}": f"T{table[i]}" for i in range(min(len(table), len(extruders)))
                   if isinstance(table[i], int) and table[i] != i and f"T{table[i]}" in extruders}
        if mapping:
            out["extruder_map"] = mapping
    return out
