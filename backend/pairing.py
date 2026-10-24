"""
pairing.py
==========

Lets a phone (or any second browser) find and remember this dashboard,
without an account or a password. The desktop shows a short numeric code;
entering that code on the phone adds it to the paired-devices list.

Pairing also gives each device a secret key, kept in that browser as a
cookie (only a hash of it is stored here). With the device lock switched on
(off by default), every device except this computer itself must be paired
before it can read or change anything: the dashboard asks for a pairing code
instead. This computer, reached as localhost, always works, so the owner can
never be locked out; a request that arrives through a tunnel's domain or a
network address counts as another device, even when it comes from this
machine. Unpairing a device withdraws its key at once.
"""

import hashlib
import os
import secrets
import threading
from datetime import datetime, timedelta
import storage

_DATA_DIR = storage.DATA_DIR
_DEVICES_PATH = os.path.join(_DATA_DIR, "paired_devices.json")
_ACCESS_PATH = os.path.join(_DATA_DIR, "access.json")
COOKIE = "dv_device"
COOKIE_DAYS = 365

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
            raise ValueError("There's no pairing code waiting - it was already used, or none was made. "
                             "Show a new one on the device that's already set up")
        if datetime.now() > _code_expires_at:
            raise ValueError("Pairing code has expired")
        if not secrets.compare_digest(str(code or "").strip(), _current_code):
            _failed_attempts += 1
            if _failed_attempts >= MAX_ATTEMPTS:
                _current_code = _code_expires_at = None
                raise ValueError("Too many wrong codes - show a new pairing code and try again")
            raise ValueError("Incorrect pairing code")
        devices = _load_devices()
        if len(devices) >= MAX_DEVICES:
            # Checked before the code is used up, so after unpairing one
            # device the same code still works.
            raise ValueError(f"At most {MAX_DEVICES} paired devices - unpair one first")
        # Each code pairs one device, then it is used up.
        _current_code = _code_expires_at = None

        device_name = str(device_name or "").strip()[:40] or "New device"
        token = secrets.token_urlsafe(32)
        device = {
            "id": f"device-{secrets.token_hex(4)}",
            "name": device_name,
            "paired_at": datetime.now().isoformat(timespec="seconds"),
            "key_hash": _hash(token),
        }
        devices.append(device)
        _save_devices(devices)
        return {**_public(device), "token": token}


def _hash(token):
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def _public(device):
    return {k: v for k, v in device.items() if k != "key_hash"}


def device_for(token):
    """The paired device holding this key, or None."""
    if not token or len(str(token)) > 200:
        return None
    wanted = _hash(token)
    for d in _load_devices():
        if secrets.compare_digest(str(d.get("key_hash", "")), wanted):
            return _public(d)
    return None


def lock_enabled():
    return bool(storage.load_json(_ACCESS_PATH, {}).get("require_pairing"))


def set_lock(on):
    if not isinstance(on, bool):
        raise ValueError("Choose whether the device lock is on or off")
    storage.save_json(_ACCESS_PATH, {"require_pairing": on})
    return lock_enabled()


def list_devices():
    return [_public(d) for d in _load_devices()]


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
    storage.save_json(_ACCESS_PATH, {"require_pairing": False})
