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

import os
import secrets
import threading
from datetime import datetime, timedelta
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DEVICES_PATH = os.path.join(_DATA_DIR, "paired_devices.json")

CODE_TTL_MINUTES = 10
# Wrong guesses allowed per code. After that the code stops working and a
# new one has to be shown, so nobody can simply try all million codes.
MAX_ATTEMPTS = 5
MAX_DEVICES = 50

_current_code = None
_code_expires_at = None
_failed_attempts = 0
_lock = threading.Lock()


def generate_code():
    global _current_code, _code_expires_at, _failed_attempts
    with _lock:
        _current_code = f"{secrets.randbelow(1_000_000):06d}"
        _code_expires_at = datetime.now() + timedelta(minutes=CODE_TTL_MINUTES)
        _failed_attempts = 0
    return {"code": _current_code, "expires_at": _code_expires_at.isoformat(timespec="seconds")}


def _load_devices():
    if not os.path.exists(_DEVICES_PATH):
        return []
    return storage.load_json(_DEVICES_PATH, [])


def _save_devices(devices):
    storage.save_json(_DEVICES_PATH, devices)


def redeem_code(code, device_name):
    global _current_code, _code_expires_at, _failed_attempts
    with _lock:
        if _current_code is None or _code_expires_at is None:
            raise ValueError("No pairing code has been generated")
        if datetime.now() > _code_expires_at:
            raise ValueError("Pairing code has expired")
        if not secrets.compare_digest(str(code or "").strip(), _current_code):
            _failed_attempts += 1
            if _failed_attempts >= MAX_ATTEMPTS:
                _current_code = _code_expires_at = None
                raise ValueError("Too many wrong codes - show a new pairing code and try again")
            raise ValueError("Incorrect pairing code")
        # Each code pairs one device, then it is used up.
        _current_code = _code_expires_at = None

        device_name = str(device_name or "").strip()[:40] or "New device"
        devices = _load_devices()
        if len(devices) >= MAX_DEVICES:
            raise ValueError(f"At most {MAX_DEVICES} paired devices - unpair one first")
        device = {
            "id": f"device-{secrets.token_hex(4)}",
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
    global _current_code, _code_expires_at, _failed_attempts
    _current_code = None
    _code_expires_at = None
    _failed_attempts = 0
    _save_devices([])
