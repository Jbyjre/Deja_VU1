"""
updates.py
==========

Reads Moonraker's own update-status endpoint and reports which tracked
packages (Klipper, Moonraker) have a newer version waiting. No git calls of
this project's own — Moonraker already does that work and exposes the
result; this just reads and summarizes it.
"""

import mock_moonraker


def get_status():
    status = mock_moonraker.get_update_status()
    packages = status["packages"]
    return {
        "packages": packages,
        "updates_available": sum(1 for p in packages if p["update_available"]),
    }
