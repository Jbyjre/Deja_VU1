"""
sanity_check.py
================

One "is it safe to print?" verdict, combining three signals this dashboard
already reads on their own: is anything overdue for maintenance, is any dock
showing an error, and does the loaded filament match what the file expects.

Nothing new is measured here — this only reads the other three modules and
decides what "safe" means from what they already say.
"""

import color_check
import led_status
import maintenance


def check():
    maintenance_status = maintenance.get_status()
    rings = led_status.get_all_ring_states()
    colors = color_check.check_current_job()

    # Blocking reasons stop a print from starting (see print_gate.py, which
    # enforces this on the server). Warnings are shown and must be accepted.
    blocking, warnings = [], []

    overdue = [t for t in maintenance_status["tasks"] if t["status"] == "overdue"]
    if overdue:
        warnings.append(
            f"{len(overdue)} maintenance task(s) overdue: " +
            ", ".join(t["name"] for t in overdue))

    error_rings = [r for r in rings["rings"] if r["state"] == "error"]
    if error_rings:
        blocking.append(
            "Dock error on " + ", ".join(r["toolhead"] for r in error_rings))

    if colors["overall"] == "mismatch":
        blocking.append("Filament colour mismatch detected before this print starts")
    elif colors["overall"] == "close":
        warnings.append("Filament colour is a close call — worth a glance")

    reasons = blocking + warnings
    return {
        "safe_to_print": len(reasons) == 0,
        "can_start": len(blocking) == 0,
        "reasons": reasons,
        "blocking": blocking,
        "warnings": warnings,
    }
