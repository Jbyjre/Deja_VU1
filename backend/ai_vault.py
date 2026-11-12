"""
ai_vault.py
===========

Where an API key rests between uses. A key is a password that spends money, so Deja Vu1 hands it to
the computer's own protected store whenever there is one, and says plainly which store is in use:

  * Windows: Data Protection (DPAPI). Windows encrypts the key with a secret tied to the signed-in
    Windows account; the encrypted text sits in <data>/ai_keys.json and only that account on that
    computer can turn it back.
  * macOS: the login Keychain, through the system's own `security` program. The key is not in any
    Deja Vu1 file.
  * Linux: the desktop's keyring (Secret Service: GNOME Keyring, KWallet), through `secret-tool`,
    when it is installed and unlocked. The key is not in any Deja Vu1 file.
  * Anywhere none of those answers: <data>/ai_keys.json, readable only by the owner's account
    (file mode 600) and not encrypted. Deja Vu1 says so on screen instead of implying more.

Every save is read back before it counts. If the protected store can't return the same key, the key
goes to the owner-only file and the reason is kept for the screen, so a keyring that is locked or
missing never loses a key or blocks a connection.

Python's standard library has no cipher, and a home-made one with its password beside the file would
only look safe. That is why the work is given to the operating system.

This module never logs a key, never puts one in a command line (other processes can read those), and
knows nothing about providers: it stores one secret under one name.
"""

import base64
import ctypes
import os
import re
import shutil
import subprocess
import sys

SERVICE = "DejaVu1-AI-key"           # no spaces: it is typed into `security -i` unquoted
LABEL = "Deja Vu1 AI key"
SECURITY = "/usr/bin/security"         # macOS's own keychain program
TIMEOUT = 15
_ENTROPY = b"dejavu1.ai.key.v1"         # ties a DPAPI blob to this use; not a secret
# The macOS `security` program is fed its command on standard input. Keys made only of these
# characters need no quoting there; anything else goes to the owner-only file instead.
_PLAIN = re.compile(r"^[A-Za-z0-9_.:=+/~@-]+$")

_problem = ""                            # why the protected store was passed over, for the screen
_cache = {}                              # name -> key, so the keyring isn't asked for every message

STORES = {
    "dpapi": ("Windows Data Protection", True,
              "Encrypted by Windows with a secret tied to your Windows account (DPAPI). Only your account on "
              "this computer can read it."),
    "keychain": ("macOS Keychain", True,
                 "Kept in your login Keychain, which macOS encrypts and unlocks when you sign in. It is not in "
                 "any Deja Vu1 file."),
    "secret-service": ("the system keyring", True,
                       "Kept in your desktop's keyring (Secret Service), which encrypts it and unlocks when you "
                       "sign in. It is not in any Deja Vu1 file."),
    "file": ("a private file", False,
             "Kept in a file only your account on this computer can open. It is not encrypted, because this "
             "computer offers no keyring Deja Vu1 can use."),
}


def _choice():
    """The store this computer offers. DEJAVU_KEY_STORE=file keeps keys in the owner-only file."""
    forced = os.environ.get("DEJAVU_KEY_STORE", "").strip().lower()
    if forced in STORES:
        return forced
    if sys.platform == "win32":
        return "dpapi"
    if sys.platform == "darwin":
        return "keychain" if os.path.exists(SECURITY) else "file"
    return "secret-service" if shutil.which("secret-tool") else "file"


def describe():
    """What the screen may say about how keys are kept here."""
    store = _choice()
    name, encrypted, how = STORES[store]
    return {"store": store, "name": name, "encrypted": encrypted, "how": how, "problem": _problem}


# ---- Windows ----------------------------------------------------------------

class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data, protect):
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    blob = ctypes.POINTER(_Blob)
    call = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    call.argtypes = [blob, ctypes.c_void_p, blob, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, blob]
    call.restype = ctypes.c_int
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

    def wrap(raw):
        buffer = ctypes.create_string_buffer(raw, len(raw))
        return _Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer

    source, _keep_a = wrap(data)
    entropy, _keep_b = wrap(_ENTROPY)
    out = _Blob()
    # 0x1 = CRYPTPROTECT_UI_FORBIDDEN: never open a window; fail instead.
    if not call(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0x1, ctypes.byref(out)):
        raise OSError("Windows Data Protection refused")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


# ---- macOS and Linux: the system's own programs ------------------------------

def _run(args, text=None):
    done = subprocess.run(args, input=None if text is None else text.encode(), capture_output=True, timeout=TIMEOUT)
    return done.returncode, done.stdout.decode("utf-8", "replace")


def _keychain_put(name, secret):
    if not _PLAIN.match(secret) or not _PLAIN.match(name):
        raise OSError("the key has characters the Keychain command can't carry safely")
    # `security -i` reads its command from standard input, so the key never appears in a command line.
    code, _ = _run([SECURITY, "-i"],
                   f"add-generic-password -U -a {name} -s {SERVICE} -w {secret}\n")
    if code != 0:
        raise OSError("the Keychain refused")


def _keychain_get(name):
    code, out = _run([SECURITY, "find-generic-password", "-a", name, "-s", SERVICE, "-w"])
    return out.rstrip("\n") if code == 0 else ""


def _keychain_drop(name):
    _run([SECURITY, "delete-generic-password", "-a", name, "-s", SERVICE])


def _keyring_put(name, secret):
    code, _ = _run(["secret-tool", "store", "--label=" + LABEL, "service", "dejavu1", "account", name], secret)
    if code != 0:
        raise OSError("the keyring refused (it may be locked)")


def _keyring_get(name):
    code, out = _run(["secret-tool", "lookup", "service", "dejavu1", "account", name])
    return out.rstrip("\n") if code == 0 else ""


def _keyring_drop(name):
    _run(["secret-tool", "clear", "service", "dejavu1", "account", name])


# ---- one interface ----------------------------------------------------------

def seal(name, secret):
    """
    Put `secret` away under `name`. Returns the record for ai_keys.json: where the key is, never more
    of the key than its last four characters (for "Saved …abcd" on screen).
    """
    global _problem
    record = {"hint": ("…" + secret[-4:]) if len(secret) >= 12 else ""}
    store = _choice()
    try:
        if store == "dpapi":
            sealed = base64.b64encode(_dpapi(secret.encode(), True)).decode()
            if _dpapi(base64.b64decode(sealed), False).decode() != secret:
                raise OSError("Windows Data Protection returned a different key")
            record.update(store=store, api_key_sealed=sealed)
        elif store in ("keychain", "secret-service"):
            put, get = (_keychain_put, _keychain_get) if store == "keychain" else (_keyring_put, _keyring_get)
            put(name, secret)
            if get(name) != secret:
                raise OSError(f"{STORES[store][0]} did not return the key that was saved")
            record.update(store=store)
        else:
            record.update(store="file", api_key=secret)
        if store != "file":
            _problem = ""
    except Exception as error:               # a locked keyring, a missing program, an odd Windows build
        _problem = f"{STORES[store][0]} couldn't be used ({error}), so the key is in the private file instead."
        record.update(store="file", api_key=secret)
    _cache[name] = secret
    return record


def open_(name, record):
    """The key for `name`, or "" when it can't be read (the screen then asks for it again)."""
    if not isinstance(record, dict):
        return ""
    if name in _cache:
        return _cache[name]
    store = record.get("store") or "file"
    secret = ""
    try:
        if store == "dpapi":
            secret = _dpapi(base64.b64decode(record.get("api_key_sealed") or ""), False).decode()
        elif store == "keychain":
            secret = _keychain_get(name)
        elif store == "secret-service":
            secret = _keyring_get(name)
        else:
            secret = str(record.get("api_key") or "")
    except Exception:
        secret = ""
    if secret:
        _cache[name] = secret
    return secret


def drop(name, record):
    """Forget the key everywhere it was kept."""
    _cache.pop(name, None)
    store = (record or {}).get("store")
    try:
        if store == "keychain":
            _keychain_drop(name)
        elif store == "secret-service":
            _keyring_drop(name)
    except Exception:
        pass


def forget_cache():
    _cache.clear()
