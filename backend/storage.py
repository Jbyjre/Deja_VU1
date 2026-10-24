"""
storage.py
==========

Reading and writing the dashboard's small JSON files safely.

Every module keeps its settings or history in a JSON file under
backend/data/. Writing one with a plain open("w") has two ways to go wrong:

  - Power is cut (or the Raspberry Pi is unplugged) halfway through a save.
    The file is left half-written, json.load fails on it, and that module
    answers every request with an error until someone deletes the file.
  - Two requests save the same file at the same moment. Their bytes can
    interleave and leave a file that is neither version.

save_json() avoids both: it writes a complete new copy to a temporary file
next to the real one, then swaps it into place in one step (os.replace).
Anyone reading sees either the old file or the new one, never a mix.

load_json() is the other half: if a file is damaged anyway (edited by hand,
a disk fault), it is renamed to <name>.corrupt-<time> so nothing is lost,
and the dashboard repairs it rather than forgetting: first from the last
good copy save_json() keeps beside every file (.<name>.prev), then from the
newest automatic safety copy (memory.py). Only when neither has it does
the module start over from its defaults. Every repair is noted, so the
dashboard can say what it recovered.
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import time


def _data_dir():
    """
    Where every module keeps its files: backend/data/, or the folder named
    by the DEJAVU_DATA_DIR environment variable.

    The automated tests change printers, prices, spools and settings on
    purpose. Pointed at backend/data/ they replaced the real ones with test
    values - running the tests wiped your own setup. So whenever the test
    runner is loaded and no folder was named, a fresh temporary folder is
    used instead. The dashboard itself never loads the test runner.
    """
    named = os.environ.get("DEJAVU_DATA_DIR")
    if named:
        return os.path.abspath(named)
    if "unittest" in sys.modules or "pytest" in sys.modules:
        import atexit
        import shutil
        folder = tempfile.mkdtemp(prefix="dejavu-test-data-")
        os.environ["DEJAVU_DATA_DIR"] = folder      # one folder for the whole run
        atexit.register(shutil.rmtree, folder, ignore_errors=True)
        return folder
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


DATA_DIR = _data_dir()


PREV_MAX_BYTES = 4 * 1024 * 1024       # larger files keep no previous copy (history caches and the like)
_repairs = []                          # what load_json recovered, newest last (shown in Settings)
_repairs_lock = threading.Lock()


def prev_path(path):
    """Where save_json keeps the last good copy of `path`: a hidden file beside it."""
    folder, name = os.path.split(path)
    return os.path.join(folder, f".{name}.prev")


def repairs():
    """What was repaired since the server started: [{file, from, at}]."""
    with _repairs_lock:
        return list(_repairs)


def _note_repair(path, source):
    entry = {"file": os.path.basename(path), "from": source, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with _repairs_lock:
        _repairs.append(entry)
        del _repairs[:-20]
    sys.stderr.write(f"  Note: {entry['file']} was damaged and has been repaired from {source}\n")


def _write_atomic(path, text):
    folder = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _recover(path):
    """A good earlier version of `path`: (data, where it came from), or (None, None)."""
    try:
        with open(prev_path(path), "r", encoding="utf-8") as fh:
            return json.load(fh), "its last good copy"
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    try:
        import memory                      # safety copies; imported late, it imports this module
        return memory.recover(path)
    except Exception:
        return None, None


def load_json(path, default):
    """The file's contents, or `default` if it is missing and nothing can recover it."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except (ValueError, UnicodeDecodeError):
        # json.JSONDecodeError is a ValueError. Keep the damaged file for
        # inspection, then repair it from an earlier good version if there
        # is one, else start over from the defaults.
        aside = f"{path}.corrupt-{time.strftime('%Y%m%d-%H%M%S')}"
        try:
            os.replace(path, aside)
        except OSError:
            pass
        data, source = _recover(path)
        if data is not None:
            try:
                _write_atomic(path, json.dumps(data, indent=2))
            except OSError:
                pass
            _note_repair(path, source)
            return data
        sys.stderr.write(f"  Warning: {os.path.basename(path)} was damaged and no earlier copy was found; "
                         f"moved it to {os.path.basename(aside)} and started fresh\n")
        return default


def _keep_previous(path):
    """Copy the current file to its .prev before it is replaced, if it is good JSON."""
    try:
        if os.path.getsize(path) > PREV_MAX_BYTES:
            return
        with open(path, "r", encoding="utf-8") as fh:
            json.load(fh)
        shutil.copyfile(path, prev_path(path))
    except (OSError, ValueError, UnicodeDecodeError):
        pass                                 # a damaged or missing current file never replaces a good .prev


def save_json(path, data, indent=2):
    """Write `data` to `path` so the file is always either old or new, never half."""
    folder = os.path.dirname(path) or "."
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=indent)
            fh.flush()
            os.fsync(fh.fileno())
        if os.path.exists(path):
            _keep_previous(path)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# -- secrets -----------------------------------------------------------------
# Tokens and webhook addresses are saved so the dashboard can use them, but
# never sent back out: anyone who can open the dashboard could otherwise
# read your Home Assistant token (full control of your home) or Telegram
# bot token. The settings pages get a masked stand-in instead, and saving
# that stand-in back unchanged keeps the real value.

SECRET_MASK = "••••••••"


def mask_secret(value):
    """'' stays ''; anything else becomes dots, plus its last 4 characters when long."""
    value = str(value or "")
    if not value:
        return ""
    return SECRET_MASK + (value[-4:] if len(value) >= 16 else "")


def is_masked(value):
    """True for a stand-in produced by mask_secret (so: keep the saved value)."""
    return str(value or "").startswith(SECRET_MASK)
