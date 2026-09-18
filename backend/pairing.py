"""
pairing.py
==========

Lets a phone (or any second browser) find and remember this dashboard,
without an account or a password. The desktop shows a short numeric code;
entering that code on the phone adds it to the paired-devices list.

This is about *connecting* devices, not about *restricting* access — the
dashboard has no login wall and this doesn't add one. Anyone already on your
home network could reach the same address directly. Pairing exists so your
phone remembers "this is my printer's dashboard" and shows up in the
Modules & Devices list, not to gate the API behind a secret.
"""

import json
import os
import random
from datetime import datetime, timedelta

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DEVICES_PATH = os.path.join(_DATA_DIR, "paired_devices.json")

CODE_TTL_MINUTES = 10

_current_code = None
_code_expires_at = None


def generate_code():
    global _current_code, _code_expires_at
    _current_code = f"{random.randint(0, 999999):06d}"
    _code_expires_at = datetime.now() + timedelta(minutes=CODE_TTL_MINUTES)
    return {"code": _current_code, "expires_at": _code_expires_at.isoformat(timespec="seconds")}


def _load_devices():
    if not os.path.exists(_DEVICES_PATH):
        return []
    with open(_DEVICES_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save_devices(devices):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_DEVICES_PATH, "w", encoding="utf-8") as fh:
        json.dump(devices, fh, indent=2)


def redeem_code(code, device_name):
    if _current_code is None or _code_expires_at is None:
        raise ValueError("No pairing code has been generated")
    if datetime.now() > _code_expires_at:
        raise ValueError("Pairing code has expired")
    if code != _current_code:
        raise ValueError("Incorrect pairing code")

    device_name = (device_name or "").strip() or "New device"
    devices = _load_devices()
    device = {
        "id": f"device-{len(devices) + 1}-{random.randint(1000, 9999)}",
        "name": device_name,
        "paired_at": datetime.now().isoformat(timespec="seconds"),
    }
    devices.append(device)
    _save_devices(devices)
    return device


def list_devices():
    return list(_load_devices())


def unpair(device_id):
    devices = _load_devices()
    filtered = [d for d in devices if d["id"] != device_id]
    if len(filtered) == len(devices):
        raise ValueError(f"Unknown device: {device_id}")
    _save_devices(filtered)
    return filtered


def reset():
    """Useful for tests."""
    global _current_code, _code_expires_at
    _current_code = None
    _code_expires_at = None
    _save_devices([])
