"""
updates.py
==========

Reads Moonraker's own update-status endpoint and reports which tracked
packages (Klipper, Moonraker) have a newer version waiting. No git calls of
this project's own - Moonraker already does that work and exposes the
result; this just reads and summarizes it.
"""

import mock_moonraker


def get_status():
    status = mock_moonraker.get_update_status()
    packages = status["packages"]
    result = {
        "packages": packages,
        "updates_available": sum(1 for p in packages if p["update_available"]),
    }
    # A printer whose Moonraker has no update manager answers with no
    # packages and a note saying so; "up to date" would claim a check that
    # never happened.
    if status.get("note"):
        result["note"] = status["note"]
    return result
