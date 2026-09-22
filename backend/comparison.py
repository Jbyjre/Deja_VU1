"""
comparison.py
=============

Two related features, both built on the print history mock_moonraker
already generates — no new data source, no extra hardware:

  * "What changed?" — compares the job about to print against the last time
    this same file printed successfully, and flags real differences
    (toolhead, filament colour).
  * "Likely cause" — when this file has failed before, looks for a pattern
    across those failures (a shared filament type, say) and flags it if the
    current run matches. This is plain pattern-matching over your own
    history, not a prediction model — it can only ever say "this looks like
    what happened before," never "this will fail."
  * "Repeat last settings" — a quick reference for what filament and
    toolheads were used the last time this file printed cleanly.

All three only ever look at *your own* past jobs. Nothing here calls out to
any external service.
"""

from collections import Counter

import mock_moonraker


def _history_for_file(filename, statuses):
    jobs = [
        j for j in mock_moonraker.get_print_history()
        if j["filename"] == filename and j["status"] in statuses
    ]
    return sorted(jobs, key=lambda j: j["start_time"], reverse=True)


def _most_common(values):
    values = [v for v in values if v]
    if not values:
        return None
    return Counter(values).most_common(1)[0][0]


def compare_current_job(filename=None, limit=3):
    """
    "What changed?" plus "likely cause", combined into one check.

    Compares the printer's current setup against the last few times this
    file printed, and against any past failures of the same file.
    """
    if filename is None:
        filename = mock_moonraker.get_printer_state()["current_file"]

    if not filename:
        return {"has_history": False, "filename": None}

    past_successful = _history_for_file(filename, {"completed"})[:limit]
    past_failed = _history_for_file(filename, {"error"})

    if not past_successful and not past_failed:
        return {"has_history": False, "filename": filename}

    state = mock_moonraker.get_printer_state()
    active = state["active_toolhead"]
    differences = []
    likely_causes = []

    if past_successful:
        last_good = past_successful[0]
        if active not in last_good["toolheads_used"]:
            differences.append(
                f"Last successful run used toolhead(s) "
                f"{', '.join(last_good['toolheads_used'])}; this run's active "
                f"toolhead is {active}."
            )
        active_color = state["toolheads"][active]["filament_color_name"]
        if active_color != last_good["filament_color_name"]:
            differences.append(
                f"Last successful run used {last_good['filament_color_name']}; "
                f"the active toolhead now has {active_color} loaded."
            )

    if past_failed:
        common_material = _most_common([j["filament_type"] for j in past_failed])
        if common_material and all(j["filament_type"] == common_material for j in past_failed):
            likely_causes.append(
                f"This file has failed {len(past_failed)} time(s) before, "
                f"always printing in {common_material}. Worth double-checking "
                f"your {common_material} settings before this run."
            )

    return {
        "has_history": True,
        "filename": filename,
        "differences": differences,
        "likely_causes": likely_causes,
        "past_successful_count": len(past_successful),
        "past_failed_count": len(past_failed),
    }


def repeat_last_settings(filename=None):
    """
    What worked last time — the filament and toolheads from the most recent
    successful print of this file. A reference, not an auto-apply: this
    project doesn't have the original slicer settings to replay, only what
    print history actually recorded.
    """
    if filename is None:
        filename = mock_moonraker.get_printer_state()["current_file"]

    past_successful = _history_for_file(filename, {"completed"})
    if not past_successful:
        raise ValueError(f"No completed print history for {filename}")

    last = past_successful[0]
    return {
        "filename": filename,
        "filament_type": last["filament_type"],
        "filament_color_name": last["filament_color_name"],
        "filament_color_hex": last["filament_color_hex"],
        "toolheads_used": last["toolheads_used"],
        "from_job_id": last["job_id"],
        "printed_at": last["start_time"],
    }


# ---------------------------------------------------------------------------
# Side-by-side views
# ---------------------------------------------------------------------------

def side_by_side(filename=None):
    """
    The job about to print next to the last clean run of the same file, one
    row per recorded field, each marked same or changed. Only fields print
    history actually records are compared - nothing is inferred.
    """
    state = mock_moonraker.get_printer_state()
    if filename is None:
        filename = state["current_file"]
    if not filename:
        return {"has_history": False, "filename": None, "rows": []}
    past = _history_for_file(filename, {"completed"})
    if not past:
        return {"has_history": False, "filename": filename, "rows": []}
    last = past[0]
    active = state["active_toolhead"]
    dock = state["toolheads"].get(active) if active else None
    required = mock_moonraker.get_current_job_requirements()["required_filament"]
    now_material = required[0]["expected_material"] if required else None
    rows = [
        ("Toolheads", ", ".join(last["toolheads_used"]),
         ", ".join(sorted({r["toolhead"] for r in required})) or (active or "—")),
        ("Filament type", last["filament_type"], now_material or "—"),
        ("Filament colour (active toolhead)", last["filament_color_name"],
         dock["filament_color_name"] if dock else "—"),
    ]
    return {
        "has_history": True, "filename": filename, "from_job_id": last["job_id"],
        "printed_at": last["start_time"],
        "rows": [{"field": f, "last_clean": a, "now": b, "changed": a != b} for f, a, b in rows],
    }


def _settings_of(name):
    import json
    import zipfile
    import io
    import file_library
    import gcode_tools
    kind = file_library.kind_of(name)
    if kind == "gcode":
        settings = gcode_tools.parse_metadata(file_library.read_text(name))["settings"]
        return {k: v for k, v in settings.items() if not k.startswith(("estimated", "total", "model printing"))}
    if kind == "3mf":
        z = zipfile.ZipFile(io.BytesIO(file_library.read_bytes(name)))
        if "Metadata/project_settings.config" not in z.namelist():
            raise ValueError(f"{name} has no print settings inside (it's a model-only 3MF)")
        raw = json.loads(z.read("Metadata/project_settings.config"))
        return {k: (";".join(map(str, v)) if isinstance(v, list) else str(v)) for k, v in raw.items()}
    raise ValueError("Profiles can be compared between G-code files or 3MF projects")


def diff_profiles(name_a, name_b, include_same=False):
    """
    A real diff of two files' slicer settings: every setting present in
    either, with both values, sorted so changes come first.
    """
    a, b = _settings_of(name_a), _settings_of(name_b)
    rows = []
    for key in sorted(set(a) | set(b)):
        if key in a and key in b:
            status = "same" if a[key] == b[key] else "changed"
        else:
            status = "only_a" if key in a else "only_b"
        if status == "same" and not include_same:
            continue
        rows.append({"setting": key, "a": a.get(key), "b": b.get(key), "status": status})
    order = {"changed": 0, "only_a": 1, "only_b": 2, "same": 3}
    rows.sort(key=lambda r: (order[r["status"]], r["setting"]))
    same = sum(1 for k in set(a) & set(b) if a[k] == b[k])
    return {"a": name_a, "b": name_b, "rows": rows,
            "counts": {"changed": sum(r["status"] == "changed" for r in rows),
                       "only_a": sum(r["status"] == "only_a" for r in rows),
                       "only_b": sum(r["status"] == "only_b" for r in rows), "same": same}}
