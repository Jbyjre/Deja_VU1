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
a note is printed, and the module carries on from its defaults instead of
failing forever.
"""

import json
import os
import sys
import tempfile
import time


def load_json(path, default):
    """The file's contents, or `default` if it is missing or unreadable."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except (ValueError, UnicodeDecodeError):
        # json.JSONDecodeError is a ValueError. Keep the damaged file for
        # inspection, then start over from the defaults.
        aside = f"{path}.corrupt-{time.strftime('%Y%m%d-%H%M%S')}"
        try:
            os.replace(path, aside)
            sys.stderr.write(f"  Warning: {os.path.basename(path)} was damaged; "
                             f"moved it to {os.path.basename(aside)} and started fresh\n")
        except OSError:
            pass
        return default


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
