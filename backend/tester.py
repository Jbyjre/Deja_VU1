"""
tester.py
=========

Tester mode: a record of how Deja Vu1 behaves, kept on this computer only.

This tester build records from the first start (modules.TESTER_ALWAYS_ON) and never stops. The tester uses the app as
usual, answers the 22 questions when they like (tester_study.py) and saves one zip file to attach to a forum message. This module is the recording half: it takes events from the browser and from the
server, hides anything private, and appends them to JSON Lines files under <data>/tester/. tester_report.py
reads them back and builds the report.

Rules this file keeps:
  - With the "tester" module off (a developer's DEJAVU_TESTER=0, or a build that makes it optional), nothing
    is written and every tester route answers 403.
  - Nothing is sent anywhere. There is no network call in this file.
  - Recording never raises into the app: every hook swallows its own failures.
  - Private things never reach the disk: addresses, keys, home-folder names, file names, printer names,
    Wi-Fi names, serial numbers. mask() is applied to every string, in the browser's events and in the
    server's own, and again when the report is built.
"""

import json
import math
import os
import re
import secrets
import hashlib
import threading
import time
import traceback

import modules
import storage

_DATA_DIR = storage.DATA_DIR

SCHEMA_VERSION = 3
MAX_TEXT = 300                    # longest string kept in one field
MAX_NOTE = 1200                   # the tester's own notes may be longer
MAX_OUTPUT = 400000               # a failed slice keeps the engine's whole output, up to this many characters (the start and the end beyond it)
MAX_LIST = 12
EXPORT_LIMIT = 20 * 1024 * 1024   # events.jsonl inside the saved zip stays under this
COMPACT_AT = 40 * 1024 * 1024     # raw events on disk before the oldest routine ones are summed up
STOP_AT = 120 * 1024 * 1024       # past this nothing more is written (a stuck recorder never fills a disk)
SLOW_CLICK_MS = 1000              # a click that took longer than this to show a change
SLOW_REQUEST_MS = 2000
LONG_TASK_MS = 200

_lock = threading.RLock()
_switch = {"at": 0.0, "on": False}
_size = {"bytes": None, "since": 0}
_compacting = threading.Event()
_stats = {"written": 0, "refused": 0, "failed": 0}


# ---------------------------------------------------------------------------
# The switch
# ---------------------------------------------------------------------------

def enabled():
    """Is Tester mode on? Cached for a second so the hooks cost almost nothing while it is off."""
    now = time.monotonic()
    if now - _switch["at"] > 1.0:
        try:
            _switch["on"] = bool(modules.is_enabled("tester"))
        except Exception:                 # noqa: BLE001 - a broken switch reads as off
            _switch["on"] = False
        _switch["at"] = now
    return _switch["on"]


def refresh():
    """Forget the cached switch (called when it is toggled, so turning it off stops recording at once)."""
    _switch["at"] = 0.0


def folder():
    return os.path.join(_DATA_DIR, "tester")


# ---------------------------------------------------------------------------
# Hiding what is private
# ---------------------------------------------------------------------------

_OCTET = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
_IPV4 = re.compile(r"(?<![\w.])" + _OCTET + r"(?:\." + _OCTET + r"){3}(?![\w])(?::\d{2,5})?")
_IPV6 = re.compile(r"(?i)(?<![\w:])(?:(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?"
                   r"|(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|::1)(?![\w:])")
_MAC = re.compile(r"(?i)(?<![\w:-])(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}(?![\w:-])")
_USERPATH = re.compile(r"(?i)((?:[a-z]:)?[\\/]{1,2}(?:users|home)[\\/]{1,2})"
                       r"(?:[^\\/\r\n'\"<>:|?*,;)\]]+(?=[\\/])|[^\\/\s'\"<>:|?*,;)\]]+)")
_UNC = re.compile(r"(?<![\w\\])\\\\[\w.$-]+(?=\\)")
_URL = re.compile(r"(?i)\b([a-z][a-z0-9+.-]{1,12}://)([^/\s'\"<>?#]+)")
_QUERY_SECRET = re.compile(r"(?i)([?&;](?:api[_-]?key|apikey|token|access[_-]?token|key|secret|password|pwd|auth|"
                           r"signature|sig)=)[^&\s'\"<>]+")
_LOCAL_HOST = re.compile(r"(?i)\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:local|lan|home|internal|localdomain|"
                         r"home\.arpa|ts\.net|duckdns\.org|nip\.io|ngrok(?:-free)?\.(?:app|io|dev)|"
                         r"trycloudflare\.com|workers\.dev|pages\.dev|dyndns\.\w+|no-ip\.\w+)\b")
_HOST_PORT = re.compile(r"(?i)\b(?!localhost\b)[a-z][a-z0-9-]{2,}(?=:\d{4,5}\b)")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_BEARER = re.compile(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}")
_SECRET_PAIR = re.compile(r"(?i)\b(api[_-]?key|apikey|x-api-key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|"
                          r"secret|password|passwd|pwd|token|webhook|api_key_sealed)(\\?[\"']?\s*[:=]\s*\\?[\"']?)"
                          r"([^\s\"',;&}\\]{3,})")
_KNOWN_KEYS = re.compile(r"\bsk-[A-Za-z0-9_-]{10,}|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|"
                         r"\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|"
                         r"\bAKIA[0-9A-Z]{16}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*")
_LONG_HEX = re.compile(r"\b[0-9a-fA-F]{20,}\b")
_LONG_TOKEN = re.compile(r"(?<![\w-])(?=[A-Za-z0-9_+-]*\d)(?=[A-Za-z0-9_+-]*[A-Za-z])[A-Za-z0-9_+-]{24,}(?![\w-])")
_UUID = re.compile(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
_SERIAL = re.compile(r"(?i)\b(serial(?:[_ -]?(?:number|no))?|s/n|device[_-]?id|machine[_-]?id|uuid)\b"
                     r"(\\?[\"']?\s*[:=#]?\s*\\?[\"']?)([A-Za-z0-9-]{4,})")
# A quoted Wi-Fi name may hold spaces; an unquoted one is a single word.
_WIFI = re.compile(r"(?i)\b(wi-?fi(?: network)?(?: name)?|ssid|network name)(\s+[\"'“‘])([^\"'”’\n]{1,40})")
_WIFI_WORD = re.compile(r"(?i)\b(ssid|network name)(\\?[\"']?\s*[:=]\s*\\?[\"']?)([^\s\"',;]{1,40})")

_EXT = "gcode|gco|bgcode|3mf|stl|obj|step|stp|amf|ufp|ply|mp4|webm|mov|png|jpe?g|gif|webp|zip"
_EXT_I = "(?i:" + _EXT + ")"            # only the extension ignores case: the capital-letter words below must not
# A name in quotes, whichever quotes. An apostrophe inside a word (Joe's) does not close a single-quoted name.
_QUOTED_FILES = [re.compile(pattern) for pattern in (
    r"(?<!\w)()'((?:[^'\r\n]|'(?=\w)){1,200}?\.(" + _EXT_I + r"))'(?!\w)",
    r"()\"([^\"\r\n]{1,200}?\.(" + _EXT_I + r"))\"",
    r"()“([^”\r\n]{1,200}?\.(" + _EXT_I + r"))”",
    r"(?<!\w)()‘((?:[^’\r\n]|’(?=\w)){1,200}?\.(" + _EXT_I + r"))’(?!\w)",
    r"()`([^`\r\n]{1,200}?\.(" + _EXT_I + r"))`")]
# Words that look like part of a name (a capital, a digit, an underscore) right before a file name go with it.
_NAME_WORD = r"[A-Z0-9_(\[#][\w'()\[\]&+#,-]*"
_HAS_EXT = re.compile(r"\.(?:" + _EXT + r")\b", re.I)
_PATH_FILE = re.compile(r"(?:(?:" + _NAME_WORD + r")\s+){0,4}"
                        r"(?:[A-Za-z]:)?(?:[\\/][^\\/\s\"'<>|*?:]+)*[\\/]?[^\\/\s\"'<>|*?:]+\.(" + _EXT_I + r")\b")

_known_cache = {"at": 0.0, "files": [], "printers": [], "spools": []}
_seen_names = set()               # file names the hooks have handled this run (never written to disk)
_PLAIN_PRINTER = ("snapmaker u1", "u1", "printer", "demo printer")


def _ids():
    """The small numbers that stand in for files and printers: only salted hashes ever reach the disk."""
    path = os.path.join(folder(), "ids.json")
    data = storage.load_json(path, None) if os.path.exists(path) else None
    if not isinstance(data, dict) or not data.get("salt"):
        data = {"salt": secrets.token_hex(8), "file": {}, "printer": {}}
    return path, data


def _label(kind, name):
    """A stable number for a file or a printer, from its salted hash. The name itself is not kept."""
    name = str(name or "").strip().lower()
    if not name:
        return 0
    with _lock:
        path, data = _ids()
        digest = hashlib.sha256((data["salt"] + name).encode("utf-8", "replace")).hexdigest()[:16]
        table = data.setdefault(kind, {})
        if digest not in table:
            if len(table) >= 5000:
                return 0
            table[digest] = len(table) + 1
            try:
                os.makedirs(folder(), exist_ok=True)
                storage.save_json(path, data)
            except OSError:
                pass
        return table[digest]


def _inline(name, ext=None):
    """How a file appears inside a sentence: 'file 3 (3mf)'. It has no dot, so it is never taken for a name again."""
    ext = (ext if ext is not None else os.path.splitext(str(name))[1]).lower().lstrip(".")[:8]
    return "file %s (%s)" % (_label("file", name) or "?", ext or "?")


def file_label(name, size=None):
    """'file 3, .3mf, 2.4 MB' for a file name and byte size. The name itself is never kept."""
    name = str(name or "")
    if not name:
        return "file ?"
    _seen_names.add(name)
    if len(_seen_names) > 3000:
        _seen_names.clear()
        _seen_names.add(name)
    ext = os.path.splitext(name)[1].lower()[:8]
    parts = ["file %s" % (_label("file", name) or "?")]
    if ext:
        parts.append(ext)
    if isinstance(size, (int, float)) and size >= 0:
        parts.append("%.1f MB" % (size / 1048576.0) if size >= 104858 else "%d KB" % max(1, round(size / 1024.0)))
    return ", ".join(parts)


def printer_label(printer_id):
    n = _label("printer", printer_id)
    return "printer %s" % n if n else "printer"


def _known_private():
    """Names the person typed that must never appear: file names in the library, printer names, addresses."""
    now = time.monotonic()
    if now - _known_cache["at"] < 5.0:
        return _known_cache
    files, printers, spools = set(_seen_names), set(), set()
    try:
        import file_library
        files.update(str(n) for n in file_library._load_index())
    except Exception:                      # noqa: BLE001 - a missing library only means fewer known names
        pass
    try:
        import fleet
        for item in fleet.registered():
            if isinstance(item, dict):
                for key in ("name", "id", "moonraker_url", "url", "host", "serial"):
                    value = str(item.get(key) or "").strip()
                    if len(value) >= 3 and value.lower() not in _PLAIN_PRINTER and not value.lower().startswith("demo printer"):
                        printers.add(value)
    except Exception:                      # noqa: BLE001
        pass
    try:
        import filament_inventory
        for spool in filament_inventory.get_inventory():
            name = " ".join(str((spool or {}).get("color_name") or "").split())
            if name != "Unnamed" and (len(name) >= 8 or " " in name):      # a plain "Black" is not a private name
                spools.add(name)
    except Exception:                      # noqa: BLE001
        pass
    _known_cache.update(at=now, files=sorted((f for f in files if len(f) >= 3), key=len, reverse=True),
                        printers=sorted(printers, key=len, reverse=True), spools=sorted(spools, key=len, reverse=True))
    return _known_cache


def forget_known():
    _known_cache["at"] = 0.0


def mask(text, limit=MAX_TEXT):
    """
    The text with everything private replaced by a plain marker, and cut to `limit` characters.
    Applied to every string before it is written and again when a report is built.
    """
    if text is None:
        return ""
    text = str(text)[:20000]
    known = _known_private()
    for name in known["files"]:
        if name.lower() in text.lower():
            text = re.sub(re.escape(name), lambda m, n=name: _inline(n), text, flags=re.I)
    for name in known["printers"]:
        if name.lower() in text.lower():
            text = re.sub(re.escape(name), "<printer>", text, flags=re.I)
    for name in known["spools"]:
        if name.lower() in text.lower():
            text = re.sub(re.escape(name), "<spool>", text, flags=re.I)
    if _HAS_EXT.search(text):
        for quoted in _QUOTED_FILES:
            text = quoted.sub(lambda m: _inline(m.group(2), "." + m.group(3)), text)
    text = _USERPATH.sub(lambda m: m.group(1) + "<user>", text)
    text = _UNC.sub(r"\\\\<host>", text)
    if _HAS_EXT.search(text):
        text = _PATH_FILE.sub(lambda m: _inline(os.path.basename(m.group(0).replace("\\", "/")), "." + m.group(1)), text)
    text = _QUERY_SECRET.sub(r"\1<hidden>", text)
    text = _URL.sub(lambda m: m.group(1) + "<host>", text)
    text = _BEARER.sub(r"\1 <key>", text)
    text = _SECRET_PAIR.sub(lambda m: m.group(1) + m.group(2) + "<hidden>", text)
    text = _KNOWN_KEYS.sub("<key>", text)
    text = _UUID.sub("<id>", text)
    text = _SERIAL.sub(lambda m: m.group(1) + m.group(2) + "<id>", text)
    text = _WIFI.sub(lambda m: m.group(1) + m.group(2) + "<network>", text)
    text = _WIFI_WORD.sub(lambda m: m.group(1) + m.group(2) + "<network>", text)
    text = _EMAIL.sub("<email>", text)
    text = _MAC.sub("<mac>", text)
    text = _IPV4.sub("<ip>", text)
    text = _IPV6.sub("<ip>", text)
    text = _LOCAL_HOST.sub("<host>", text)
    text = _HOST_PORT.sub("<host>", text)
    text = _LONG_HEX.sub("<key>", text)
    text = _LONG_TOKEN.sub("<key>", text)
    text = " ".join(text.split()) if "\n" not in text or limit <= MAX_TEXT else text.strip()
    return text if len(text) <= limit else text[:limit - 1] + "…"


def mask_output(text, limit=MAX_OUTPUT):
    """
    Long program output (what a slicing engine printed), masked like every other string but kept whole: mask() looks at 20,000
    characters at a time, so this masks it in pieces cut at line ends. Past `limit` the start and the end are kept.
    """
    text = "" if text is None else str(text)
    if len(text) > limit:
        head = limit // 4
        text = "%s\n... (%d characters left out) ...\n%s" % (text[:head], len(text) - limit, text[-(limit - head):])
    pieces, chunk, size = [], [], 0
    for line in text.split("\n"):
        if size + len(line) + 1 > 15000 and chunk:
            pieces.append(mask("\n".join(chunk), 20001))
            chunk, size = [], 0
        chunk.append(line[:15000])
        size += min(len(line), 15000) + 1
    if chunk:
        pieces.append(mask("\n".join(chunk), 20001))
    return "\n".join(pieces).strip()


_VERSION_FIELDS = ("version", "from", "to", "facts", "engine_version", "app_version")
_VERSION_OK = re.compile(r"[A-Za-z0-9._+~() /-]{1,80}")


def version_text(value):
    """A version string as it is (1.0.0.123 is a firmware, not an address), unless it holds anything odd."""
    text = str(value if value is not None else "").strip()
    return text if _VERSION_OK.fullmatch(text) and not _LONG_HEX.search(text) else mask(text, 80)


def clean(value, limit=MAX_TEXT, depth=0):
    """Any JSON-like value with every string masked and every size capped."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value, 3) if math.isfinite(value) else None
    if isinstance(value, str):
        return mask(value, limit)
    if isinstance(value, (list, tuple)) and depth < 3:
        return [clean(v, limit, depth + 1) for v in list(value)[:MAX_LIST]]
    if isinstance(value, dict) and depth < 3:
        return {str(k)[:40]: clean(v, limit, depth + 1) for k, v in list(value.items())[:30]}
    return None


def route_of(path):
    """A request path as the report shows it: no query, and anything that looks like a name or an id is ':id'."""
    path = str(path or "").split("?")[0].split("#")[0]
    path = re.sub(r"^[a-z]+://[^/]+", "", path, flags=re.I)
    parts = []
    for i, seg in enumerate(path.split("/")):
        if i > 2 and seg and not re.fullmatch(r"[a-z][a-z_-]{0,23}", seg):
            seg = ":id"
        parts.append(seg)
    return mask("/".join(parts), 120)


# ---------------------------------------------------------------------------
# Writing events
# ---------------------------------------------------------------------------

def _day(t_ms):
    return time.strftime("%Y-%m-%d", time.localtime(t_ms / 1000.0))


def _event_files():
    """Every events file, oldest first (the archive of summed-up days, then one file per day)."""
    try:
        names = [n for n in os.listdir(folder()) if n.startswith("events-") and n.endswith(".jsonl")]
    except OSError:
        return []
    return [os.path.join(folder(), n) for n in sorted(names, key=lambda n: (n != "events-archive.jsonl", n))]


def event_files():
    return _event_files()


def disk_bytes():
    total = 0
    for path in _event_files():
        try:
            total += os.path.getsize(path)
        except OSError:
            pass
    return total


def _append_lines(by_day):
    """Write lines to their day files. Returns how many were written."""
    count = 0
    with _lock:
        if _size["bytes"] is None:
            _size["bytes"] = disk_bytes()
        try:
            os.makedirs(folder(), exist_ok=True)
        except OSError:
            _stats["failed"] += 1
            return 0
        today = _day(time.time() * 1000)
        for day, lines in by_day.items():
            if _size["bytes"] > STOP_AT:
                _stats["refused"] += len(lines)
                continue
            if _compacting.is_set():
                day = today                  # finished days are being summed up: they must not change under it
            data = "".join(lines)
            try:
                with open(os.path.join(folder(), "events-%s.jsonl" % day), "a", encoding="utf-8", newline="\n") as f:
                    f.write(data)
            except OSError:
                _stats["failed"] += len(lines)
                continue
            _size["bytes"] += len(data.encode("utf-8"))
            _size["since"] += len(lines)
            count += len(lines)
        _stats["written"] += count
        if _size["since"] >= 500:
            _size["since"] = 0
            _size["bytes"] = disk_bytes()
        if _size["bytes"] > COMPACT_AT and not _compacting.is_set():
            _compacting.set()
            threading.Thread(target=_compact_in_background, name="tester-compact", daemon=True).start()
    return count


def _compact_in_background():
    try:
        compact()
    except Exception:                   # noqa: BLE001
        traceback.print_exc()


def compact(target=None):
    """
    Sum up the routine events of every finished day into one archive file, oldest first, so the raw
    record stays under COMPACT_AT. Errors, slow actions, notes and the printer's story are kept whole.

    The slow part runs without the recorder's lock: while the flag is set, new events go to today's file only,
    so the finished days it reads cannot change, and recording carries on.
    """
    import tester_report
    target = target or int(COMPACT_AT * 0.6)
    _compacting.set()
    try:
        with _lock:
            files = _event_files()
            today = "events-%s.jsonl" % _day(time.time() * 1000)
            old = [p for p in files if os.path.basename(p) != today]
            keep_today = sum(os.path.getsize(p) for p in files if p not in old and os.path.exists(p))
        if not old:
            return 0
        out = os.path.join(folder(), ".archive.tmp")
        kept = tester_report.thin_files(old, out, max(1, target - keep_today))
        with _lock:
            os.replace(out, os.path.join(folder(), "events-archive.jsonl"))
            for path in old:
                if os.path.basename(path) != "events-archive.jsonl":
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            _size["bytes"] = disk_bytes()
        tester_report.forget()
        return kept
    finally:
        _compacting.clear()


def _line(event):
    return json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n"


def record(_kind, **fields):
    """
    One event from the server's own code (a refused command, a slice that failed). Does nothing while
    Tester mode is off and never raises.
    """
    if not enabled():
        return False
    try:
        event = {"t": int(time.time() * 1000), "k": _kind}
        for key, value in fields.items():
            if key in ("t", "k"):
                continue
            if key in _VERSION_FIELDS:
                event[key] = ({str(k)[:40]: version_text(v) for k, v in list(value.items())[:30]} if isinstance(value, dict)
                              else version_text(value) if isinstance(value, (str, int, float)) else None)
            elif key in ("stdout", "stderr"):
                event[key] = mask_output(value) if isinstance(value, (str, bytes)) else None
            else:
                event[key] = clean(value, MAX_NOTE if key in ("report", "text") else MAX_TEXT)
        return bool(_append_lines({_day(event["t"]): [_line(event)]}))
    except Exception:                   # noqa: BLE001 - the recorder never breaks the app
        _stats["failed"] += 1
        return False


# What the browser may send. A value of the wrong shape is dropped, so no field can carry typed text.
#   w: one short word-like token   n: a number   b: yes/no   t: text (masked)   l: a short list of text
_BROWSER = {
    "session": {"ev": "w", "device": "w", "ms": "n", "w": "n", "h": "n", "dpr": "n", "first": "b", "up": "n"},
    "setup": {"browser": "w", "bver": "w", "ua_os": "w", "w": "n", "h": "n", "dpr": "n", "look": "w", "theme": "w",
              "lang": "w", "touch": "b", "density": "w", "motion": "w", "cores": "n", "mem": "n", "ptr": "w",
              "standalone": "b", "tz": "n", "contrast": "w", "transp": "w", "cpref": "w", "conn": "w", "secure": "b"},
    "screen": {"screen": "w", "ms": "n", "via": "t"},
    "click": {"ctl": "t", "screen": "w", "paint": "n", "req": "n", "route": "t", "slow": "b", "how": "w", "btn": "n",
              "mods": "w", "dbl": "b", "x": "n", "y": "n", "gap": "n", "role": "w"},
    "change": {"ctl": "t", "screen": "w", "role": "w", "val": "w", "num": "n", "on": "b", "idx": "n", "of": "n",
               "files": "n", "ext": "w"},
    "key": {"combo": "t", "screen": "w"},
    "long": {"ms": "n", "screen": "w", "ctl": "t"},
    "req": {"route": "t", "method": "w", "status": "n", "ms": "n", "err": "t", "screen": "w", "slow": "b",
            "n": "n", "ok": "n", "fail": "n", "p50": "n", "max": "n", "agg": "b", "bucket": "n"},
    "err": {"kind": "w", "msg": "t", "file": "w", "line": "n", "col": "n", "screen": "w", "last": "l", "route": "t",
            "stack": "l", "ctl": "t", "pstate": "w", "online": "b", "age": "n"},
    "printer": {"ev": "w", "what": "t", "ms": "n"},
    "fps": {"surface": "w", "fps": "n", "secs": "n", "triangles": "n", "layers": "n", "screen": "w"},
    "feature": {"name": "w"},
    "note": {"text": "t", "screen": "w", "last": "l", "tag": "w", "after_err": "b", "err": "t", "pstate": "w"},
    "onboarding": {"ev": "w", "step": "n", "of": "n", "name": "t", "ms": "n", "how": "w", "first": "b"},
    "perf": {"fcp": "n", "lcp": "n", "cls": "n", "dcl": "n", "load": "n", "ttfb": "n", "heap": "n", "nodes": "n",
             "long": "n", "up": "n", "boot": "b"},
    "net": {"ev": "w", "code": "n", "clean": "b", "ms": "n", "screen": "w"},
    "study": {"ev": "w", "n": "n", "days": "n", "ms": "n", "sec": "n", "of": "n"},
    "resize": {"w": "n", "h": "n", "bp": "w"},
}
_WORD = re.compile(r"[A-Za-z0-9_.:/#=\[\]-]{1,48}")
_SESSION = re.compile(r"[0-9a-z]{6,24}")
MAX_BATCH = 400


def _browser_event(raw, now_ms):
    if not isinstance(raw, dict):
        return None
    kind = raw.get("k")
    schema = _BROWSER.get(kind)
    if not schema:
        return None
    t = raw.get("t")
    if not isinstance(t, (int, float)) or isinstance(t, bool) or abs(t - now_ms) > 36 * 3600 * 1000:
        t = now_ms
    event = {"t": int(t), "k": kind}
    session = raw.get("s")
    if isinstance(session, str) and _SESSION.fullmatch(session):
        event["s"] = session
    order = raw.get("q")
    if isinstance(order, int) and not isinstance(order, bool) and 0 <= order < 10 ** 9:
        event["q"] = order                  # the order things happened in within one visit
    for field, shape in schema.items():
        value = raw.get(field)
        if value is None:
            continue
        if shape == "n":
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                event[field] = int(value) if float(value).is_integer() else round(float(value), 3)
        elif shape == "b":
            event[field] = bool(value)
        elif shape == "w":
            if isinstance(value, str) and _WORD.fullmatch(value):
                event[field] = value
        elif shape == "t":
            if isinstance(value, str):
                event[field] = (mask(value, MAX_NOTE) if kind == "note" else
                                route_of(value) if field == "route" else mask(value))
        elif shape == "l":
            if isinstance(value, list):
                event[field] = [mask(v, 80) for v in value[:10] if isinstance(v, str)]
    if kind == "note" and not event.get("text") and not event.get("tag"):
        return None                         # a note needs words or a tag ("Slow", "Broken"...)
    return event


def ingest(body):
    """The browser's batch of events. Unknown kinds and fields are dropped, strings are masked."""
    if not enabled():
        return {"accepted": 0, "dropped": 0, "enabled": False}
    raw = body.get("events") if isinstance(body, dict) else None
    if not isinstance(raw, list):
        raise ValueError("Send {\"events\": [...]}")
    now_ms = int(time.time() * 1000)
    by_day, dropped = {}, 0
    for item in raw[:MAX_BATCH]:
        event = _browser_event(item, now_ms)
        if event is None:
            dropped += 1
            continue
        by_day.setdefault(_day(event["t"]), []).append(_line(event))
    dropped += max(0, len(raw) - MAX_BATCH)
    accepted = _append_lines(by_day) if by_day else 0
    return {"accepted": accepted, "dropped": dropped, "enabled": True}


# ---------------------------------------------------------------------------
# What the server notes by itself
# ---------------------------------------------------------------------------

def _where(exc, depth=5):
    try:
        out = []
        for frame in traceback.extract_tb(exc.__traceback__)[-depth:]:
            out.append("%s:%s in %s" % (os.path.basename(frame.filename), frame.lineno, frame.name))
        return out
    except Exception:                   # noqa: BLE001
        return []


def note_error(kind, exc, route=None, status=None):
    """An exception the server hit: its type, its words and where (file names and lines only)."""
    if not enabled():
        return
    try:
        words = "%s: %s" % (type(exc).__name__, exc) if str(exc) else type(exc).__name__
        record("err", kind=kind, msg=words, where=_where(exc), route=route_of(route) if route else None,
               status=status, src="server")
    except Exception:                   # noqa: BLE001
        pass


def note_refused(route, status, words, kind="refused"):
    """The printer, a safety check or watch-only turned a command down. The words are the app's own."""
    if not enabled():
        return
    record("printer", ev=kind, route=route_of(route), status=status, words=words)


_feature_seen = {}


def note_feature(name):
    """A feature the browser can't report itself (the camera and time-lapse pictures load as plain images)."""
    if not enabled():
        return
    now = time.monotonic()
    if now - _feature_seen.get(name, -999.0) > 60.0:
        _feature_seen[name] = now
        record("feature", name=name, src="server")


def _record_versions(printer_id):
    """What the printer says its versions are (server.info, machine.system_info). Never a name or a serial."""
    try:
        import mock_moonraker
        printer = mock_moonraker.real_printer(printer_id)
        facts = printer.version_facts() if printer is not None else None
        if facts:
            record("printer", ev="firmware", printer=printer_label(printer_id), facts=facts)
    except Exception:                   # noqa: BLE001 - a printer that won't say is not recorded
        pass


_links = {}


def note_link(printer_id, state, simulated):
    """Connects, drops and reconnects of a real printer, from each reading the live feed publishes."""
    if not enabled() or simulated:
        return
    try:
        never = bool(state.get("never_connected"))
        lost = bool(state.get("link_lost")) or never
        before = _links.get(printer_id)
        _links[printer_id] = "down" if lost else "up"
        if before is None and not lost:
            record("printer", ev="connect", printer=printer_label(printer_id))
            threading.Thread(target=_record_versions, args=(printer_id,), name="tester-versions", daemon=True).start()
        elif before == "up" and lost:
            record("printer", ev="drop", printer=printer_label(printer_id))
        elif before == "down" and not lost:
            record("printer", ev="reconnect", printer=printer_label(printer_id))
    except Exception:                   # noqa: BLE001
        pass


_PRINT_EVENTS = {"started": "print_started", "finished": "print_finished", "failed": "print_failed",
                 "cancelled": "print_cancelled", "paused": "paused", "resumed": "resumed"}


def note_print_event(event):
    """A print started, paused, resumed, finished, failed or was cancelled (from live_feed.publish_event)."""
    if not enabled() or not isinstance(event, dict) or event.get("type") != "print_event":
        return
    kind = _PRINT_EVENTS.get(event.get("event"))
    if not kind:
        return
    summary = event.get("summary") or {}
    record("printer", ev=kind, printer=printer_label(event.get("printer")), demo=bool(event.get("demo")),
           file=file_label(event.get("file")) if event.get("file") else None,
           hours=summary.get("hours"), grams=summary.get("grams"), material=summary.get("material"))


def note_start(filename, printer_id, demo=False):
    """The tester pressed Start after Confirm Print and the printer accepted it."""
    if enabled():
        record("printer", ev="start_requested", printer=printer_label(printer_id), demo=bool(demo),
               file=file_label(filename))


def note_gate(filename, gate, size=None):
    """One Confirm Print check: passed or refused, with each reason shown."""
    if not enabled():
        return
    try:
        record("gate", file=file_label(filename, size), verdict=gate.get("verdict"),
               blocking=gate.get("blocking") or [], warnings=gate.get("warnings") or [],
               info=len(gate.get("info") or []), printer_state=gate.get("printer_state"),
               health=(gate.get("health") or {}).get("score") if isinstance(gate.get("health"), dict) else None)
    except Exception:                   # noqa: BLE001
        pass


def _slice_summary(receipt):
    """A failed slice's report for help in few characters: what happened first (the stored line is cut at MAX_NOTE), the rest after."""
    run, outcome, engine = receipt.get("run") or {}, receipt.get("outcome") or {}, receipt.get("engine") or {}
    cause = outcome.get("cause") or {}
    summary = {"outcome": {"status": outcome.get("status"), "message": outcome.get("message"), "cause": cause.get("code")},
               "stage": (receipt.get("stage") or {}).get("reached"),
               "run": {k: run.get(k) for k in ("exit_code", "seconds", "timeout_s")},
               "result_json": run.get("orca_result"),
               "engine": {k: engine.get(k) for k in ("app", "version")}, "command": run.get("command")}
    return json.dumps(summary, default=str)


def note_slice(job, receipt=None, output=None):
    """
    One slice: engine, version, worked or not, how long, and for a failure the cause, the exit code and everything the engine
    printed (`output`: {"stdout": ..., "stderr": ...}), so the reason is never lost to a cut.
    """
    if not enabled():
        return
    try:
        job = job or {}
        engine = (receipt or {}).get("engine") or {}
        started, finished = job.get("started_at"), job.get("finished_at")
        secs = None
        try:
            from datetime import datetime
            if started and finished:
                secs = round((datetime.fromisoformat(finished) - datetime.fromisoformat(started)).total_seconds(), 1)
        except (ValueError, TypeError):
            secs = None
        failed = job.get("status") == "failed"
        output = output if isinstance(output, dict) else {}
        run = (receipt or {}).get("run") or {}
        record("slice", engine=engine.get("app"), version=engine.get("version"), ok=job.get("status") in ("done", "queued"),
               status=job.get("status"), secs=secs, stage=job.get("stage"),
               cause=(job.get("cause") or {}).get("code") if isinstance(job.get("cause"), dict) else None,
               model=file_label(job.get("model")) if job.get("model") else None,
               exit=run.get("exit_code") if failed and isinstance(run.get("exit_code"), int) else None,
               why=(job.get("error") or None) if failed else None,
               stderr=output.get("stderr") if failed and output.get("stderr") else None,
               stdout=output.get("stdout") if failed and output.get("stdout") else None,
               report=_slice_summary(receipt) if (failed and receipt) else None)
    except Exception:                   # noqa: BLE001
        pass


def note_convert(name, report=None, error=None):
    """One conversion of a project from another slicer: source, plates, colours, warnings."""
    if not enabled():
        return
    try:
        report = report or {}
        record("convert", source=report.get("source_label") or report.get("source"), ok=error is None,
               plates=report.get("plates") if isinstance(report.get("plates"), (int, float)) else
               len(report.get("plates") or []) if isinstance(report.get("plates"), list) else None,
               colours=report.get("filaments") if isinstance(report.get("filaments"), (int, float)) else
               len(report.get("filaments") or []) if isinstance(report.get("filaments"), list) else None,
               warnings=report.get("warnings") or report.get("notes") or [], error=error,
               file=file_label(name))
    except Exception:                   # noqa: BLE001
        pass


def note_update_result(result):
    """The last self-update the launcher recorded, once, the first time this run sees it."""
    if not enabled() or not isinstance(result, dict) or not result.get("at"):
        return
    marker = os.path.join(folder(), "last-update.json")
    try:
        seen = storage.load_json(marker, {}) if os.path.exists(marker) else {}
        if seen.get("at") == result.get("at"):
            return
        os.makedirs(folder(), exist_ok=True)
        storage.save_json(marker, {"at": result.get("at")})
        record("update", **{"from": result.get("previous"), "to": result.get("version"), "ok": bool(result.get("ok")),
                            "words": result.get("message") or ""})
    except Exception:                   # noqa: BLE001
        pass


SLOW_HANDLER_MS = 1500
_NOT_TIMED = ("/api/camera/", "/api/live", "/api/timelapse/video", "/api/backup", "/api/tester/", "/api/assistant/chat",
              "/api/files/raw")


def note_handler(method, path, ms):
    """A request the server itself took long to answer, so the report can tell a slow server from a slow network."""
    if ms < SLOW_HANDLER_MS or not enabled():
        return
    try:
        route = route_of(path)
        if not route.startswith(_NOT_TIMED):
            record("slowroute", method=str(method or "GET"), route=route, ms=int(ms))
    except Exception:                   # noqa: BLE001
        pass


SAMPLE_EVERY = 300
_started = time.time()
_installed = {"hooks": False, "sampler": False}


def _rss_mb():
    """Memory this server uses, in MB, where the system says so (Linux and macOS; None on Windows)."""
    try:
        with open("/proc/self/statm", encoding="ascii") as handle:
            return round(int(handle.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 1048576.0, 1)
    except (OSError, ValueError, IndexError, AttributeError):
        pass
    try:
        import resource
        import sys
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(peak / 1048576.0 if sys.platform == "darwin" else peak / 1024.0, 1)
    except Exception:                   # noqa: BLE001
        return None


def server_sample():
    """What the server process is using: uptime, processor time, memory, threads and free disk space."""
    out = {"up": int(time.time() - _started), "cpu": round(time.process_time(), 1), "threads": threading.active_count(),
           "rss": _rss_mb()}
    try:
        import shutil
        out["disk_free"] = int(shutil.disk_usage(_DATA_DIR).free / 1048576)
    except (OSError, ValueError):
        out["disk_free"] = None
    return out


def _sampler_loop():
    gone = threading.Event()
    gone.wait(20)
    while True:
        try:
            if enabled():
                record("server", **server_sample())
        except Exception:               # noqa: BLE001
            pass
        gone.wait(SAMPLE_EVERY)


def install_hooks():
    """Uncaught exceptions on server threads are recorded too (the usual handler still runs), and the server notes
    its own memory and processor use every five minutes."""
    if not _installed["hooks"]:
        _installed["hooks"] = True
        previous = threading.excepthook

        def hook(args):
            try:
                note_error("thread", args.exc_value)
            except Exception:           # noqa: BLE001
                pass
            previous(args)

        threading.excepthook = hook
    if not _installed["sampler"]:
        _installed["sampler"] = True
        threading.Thread(target=_sampler_loop, name="tester-sampler", daemon=True).start()


# ---------------------------------------------------------------------------
# Status and deleting
# ---------------------------------------------------------------------------

def status():
    import tester_report
    import tester_study
    totals = tester_report.totals()
    return {"on": True, "always_on": bool(modules.TESTER_ALWAYS_ON), "schema_version": SCHEMA_VERSION, **totals,
            "bytes": disk_bytes(), "limit_bytes": EXPORT_LIMIT, "write_failures": _stats["failed"],
            "refused": _stats["refused"], "study": tester_study.describe()}


def delete_all():
    """Delete everything recorded. The folder is this module's own; nothing else is touched."""
    removed = 0
    with _lock:
        try:
            names = os.listdir(folder())
        except OSError:
            names = []
        for name in names:
            if name.startswith(".") or name.endswith((".jsonl", ".json", ".tmp", ".prev")) or ".corrupt-" in name:
                try:
                    os.remove(os.path.join(folder(), name))
                    removed += 1
                except OSError:
                    pass
        _size.update(bytes=0, since=0)
        _known_cache["at"] = 0.0
        _links.clear()
        _feature_seen.clear()
    try:
        import tester_report
        tester_report.forget()
    except Exception:                   # noqa: BLE001
        pass
    return {"deleted": removed}
