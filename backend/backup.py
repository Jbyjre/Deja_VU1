"""
backup.py
=========

A one-click archive of this dashboard's own data: the maintenance log,
module settings, filament inventory, and notification settings. Built with
`zipfile` and `json`, both standard library — no dependency, nothing to
install.

This backs up Deja Vu1's own settings, not the printer's Klipper
configuration (printer.cfg / moonraker.conf) — those live on the printer
and aren't something this dashboard has ever read or written.
"""

import io
import json
import os
import zipfile
from datetime import datetime

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

_INCLUDED_FILES = [
    "maintenance_log.json",
    "modules.json",
    "filament_inventory.json",
    "notification_settings.json",
]


def create_backup():
    """
    Build a zip archive of this dashboard's data files in memory.

    Returns (filename, bytes) so the caller can decide how to serve it —
    app.py streams the bytes straight back as a download.
    """
    buffer = io.BytesIO()
    manifest = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "files": [],
    }

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in _INCLUDED_FILES:
            path = os.path.join(_DATA_DIR, name)
            if os.path.exists(path):
                archive.write(path, arcname=name)
                manifest["files"].append(name)
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))

    filename = f"dejavu1-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    return filename, buffer.getvalue()
