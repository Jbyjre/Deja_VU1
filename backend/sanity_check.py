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

    reasons = []

    overdue = [t for t in maintenance_status["tasks"] if t["status"] == "overdue"]
    if overdue:
        reasons.append(
            f"{len(overdue)} maintenance task(s) overdue: " +
            ", ".join(t["name"] for t in overdue))

    error_rings = [r for r in rings["rings"] if r["state"] == "error"]
    if error_rings:
        reasons.append(
            "Dock error on " + ", ".join(r["toolhead"] for r in error_rings))

    if colors["overall"] == "mismatch":
        reasons.append("Filament colour mismatch detected before this print starts")
    elif colors["overall"] == "close":
        reasons.append("Filament colour is a close call — worth a glance")

    return {
        "safe_to_print": len(reasons) == 0,
        "reasons": reasons,
    }
