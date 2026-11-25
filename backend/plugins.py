"""
Plugins: small add-ons that add a pane, Confirm Print checks and actions to Deja Vu1.

A plugin is a folder with a plugin.json that says what it adds and which permissions it needs. Built-in plugins ship
with the app (backend/plugins_builtin/); your own live in the data folder (plugins/<id>/).

Isolation, in three layers:
- A plugin's own code (its pane script) runs only in the browser, in a sandboxed frame with no origin of its own and
  a content policy that forbids network access unless "network" is granted. It cannot read the app's page, storage,
  keys or sign-ins, and cannot call the app's routes: it can only ask the page, which forwards the ask here.
- Here every ask is checked against the permissions the owner granted (call()). Nothing is granted by default.
- Checks and actions are declarations (data), never code, so nothing a plugin brings runs on this computer's server.

A new or changed plugin (by the hash of its files) works on the practice printer until the owner allows the real
printer, and what it did there is kept so the owner can look before allowing it.

Safe start switches every plugin off, built-in ones included, until it is ended. The browser offers it by itself when
a start with plugins on did not finish.
"""

import hashlib
import json
import os
import re
import threading
import time

import storage

PERMISSIONS = {
    "printer.read": "Read the printer's state: temperatures, progress, what is loaded in each head",
    "printer.command": "Send commands to the printer",
    "files.read": "See the list of your files and what each one needs",
    "files.write": "Save new files into your files",
    "network": "Reach websites on the internet from its pane",
}
# What each call needs. storage.* is the plugin's own small notebook and needs nothing.
CALLS = {
    "printer.state": "printer.read",
    "printer.command": "printer.command",
    "files.list": "files.read",
    "files.save": "files.write",
    "storage.get": None,
    "storage.set": None,
}
CONDITIONS = {"material", "bed_type_contains", "hours_over", "grams_over", "cost_over", "heads_over"}
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,59}\.(json|js|css|md|txt)$")
MAX_FILE = 200_000
MAX_TOTAL = 500_000
MAX_STORE = 64_000
MAX_TRIAL = 20

_BUILTIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plugins_builtin")
_lock = threading.RLock()


def _user_dir():
    return os.path.join(storage.DATA_DIR, "plugins")


def _state_path():
    return os.path.join(storage.DATA_DIR, "plugins.json")


def _load():
    state = storage.load_json(_state_path(), None)
    if not isinstance(state, dict):
        state = {}
    state.setdefault("safe_start", False)
    state.setdefault("plugins", {})
    return state


def _save(state):
    storage.save_json(_state_path(), state)


def _text(value, limit, what, required=True):
    value = str(value or "").strip()
    if required and not value:
        raise ValueError(f"The plugin's {what} is missing")
    return value[:limit]


def validate(manifest, builtin=False):
    """A cleaned copy of a plugin.json, or ValueError saying what is wrong in plain words."""
    if not isinstance(manifest, dict):
        raise ValueError("plugin.json must hold one object")
    pid = str(manifest.get("id") or "")
    if not _ID.match(pid):
        raise ValueError("The plugin's id must be 2 to 40 lower-case letters, digits or hyphens, like house-rules")
    clean = {"id": pid, "name": _text(manifest.get("name"), 60, "name"),
             "version": _text(manifest.get("version"), 20, "version"),
             "description": _text(manifest.get("description"), 300, "description"),
             "author": _text(manifest.get("author"), 60, "author", required=False)}
    perms = manifest.get("permissions") or []
    if not isinstance(perms, list) or any(p not in PERMISSIONS for p in perms):
        raise ValueError("Permissions can only be: " + ", ".join(PERMISSIONS))
    clean["permissions"] = sorted(set(perms))
    pane = manifest.get("pane")
    if pane:
        if not isinstance(pane, dict) or not _FILE.match(str(pane.get("script") or "")) \
                or not str(pane["script"]).endswith(".js"):
            raise ValueError("A pane needs a title and a script file ending in .js")
        clean["pane"] = {"title": _text(pane.get("title"), 60, "pane title"), "script": pane["script"]}
    checks = manifest.get("checks") or []
    if not isinstance(checks, list) or len(checks) > 20:
        raise ValueError("Checks must be a list of at most 20")
    clean["checks"] = [_check(c, n) for n, c in enumerate(checks, 1)]
    actions = manifest.get("actions") or []
    if not isinstance(actions, list) or len(actions) > 10:
        raise ValueError("Actions must be a list of at most 10")
    if actions and "printer.command" not in clean["permissions"]:
        raise ValueError("Actions send G-code, so the plugin must ask for printer.command")
    clean["actions"] = [_action(a, n) for n, a in enumerate(actions, 1)]
    if builtin:
        clean["module"] = str(manifest.get("module") or "")
        clean["lives"] = str(manifest.get("lives") or "")
    return clean


def _check(check, n):
    if not isinstance(check, dict):
        raise ValueError(f"Check {n} must be an object")
    when = check.get("when")
    if not isinstance(when, dict) or not when or any(k not in CONDITIONS for k in when):
        raise ValueError(f"Check {n} needs a 'when' using only: " + ", ".join(sorted(CONDITIONS)))
    clean_when = {}
    for key, value in when.items():
        if key == "material":
            values = value if isinstance(value, list) else [value]
            if not values or not all(isinstance(v, str) and 0 < len(v) <= 20 for v in values):
                raise ValueError(f"Check {n}: material must be a name like PETG, or a list of names")
            clean_when[key] = [v.strip().upper() for v in values]
        elif key == "bed_type_contains":
            if not isinstance(value, str) or not 0 < len(value.strip()) <= 40:
                raise ValueError(f"Check {n}: bed_type_contains must be a word like smooth")
            clean_when[key] = value.strip().lower()
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                raise ValueError(f"Check {n}: {key} must be a number of 0 or more")
            clean_when[key] = value
    level = check.get("level") or "warn"
    if level not in ("refuse", "warn"):
        raise ValueError(f"Check {n}: level must be refuse or warn")
    return {"id": _text(check.get("id") or f"check-{n}", 40, "check id"), "level": level,
            "say": _text(check.get("say"), 200, f"words for check {n}"), "when": clean_when}


def _action(action, n):
    if not isinstance(action, dict):
        raise ValueError(f"Action {n} must be an object")
    gcode = action.get("gcode")
    if not isinstance(gcode, list) or not 0 < len(gcode) <= 20 or \
            not all(isinstance(g, str) and 0 < len(g.strip()) <= 200 for g in gcode):
        raise ValueError(f"Action {n} needs 1 to 20 lines of G-code")
    return {"id": _text(action.get("id") or f"action-{n}", 40, "action id"),
            "name": _text(action.get("name"), 60, f"name of action {n}"), "gcode": [g.strip() for g in gcode]}


def _folder_hash(folder):
    digest = hashlib.sha256()
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            digest.update(name.encode() + b"\0")
            with open(path, "rb") as f:
                digest.update(f.read() + b"\0")
    return digest.hexdigest()[:16]


def _discover():
    """{id: (manifest, folder, builtin, error)} for every plugin folder, built-in first."""
    found = {}
    for base, builtin in ((_BUILTIN_DIR, True), (_user_dir(), False)):
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            folder = os.path.join(base, name)
            path = os.path.join(folder, "plugin.json")
            if not os.path.isfile(path) or (not builtin and name in found):
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    manifest = validate(json.load(f), builtin=builtin)
                if manifest["id"] != name:
                    raise ValueError(f"The folder is called {name} but plugin.json says {manifest['id']}")
                found[name] = (manifest, folder, builtin, None)
            except (OSError, ValueError) as exc:
                found[name] = ({"id": name, "name": name, "permissions": []}, folder, builtin, str(exc))
    return found


def _entry(state, pid):
    return state["plugins"].setdefault(pid, {"on": False, "errors": [], "approved": None, "trial": [], "store": {}})


def _builtin_on(manifest):
    import modules
    return modules.stored_enabled(manifest["module"]) if manifest.get("module") else True


def _is_on(pid, state=None, found=None):
    state = state or _load()
    found = found or _discover()
    if pid not in found or found[pid][3] or state["safe_start"]:
        return False
    manifest, _, builtin, _ = found[pid]
    return _builtin_on(manifest) if builtin and manifest.get("module") else bool(_entry(state, pid)["on"])


def safe_start():
    return bool(_load()["safe_start"])


def module_blocked(module_id):
    """True when a built-in plugin owns this module and safe start is on (modules.is_enabled asks)."""
    return _load()["safe_start"] and any(m.get("module") == module_id for m, _, b, _ in _discover().values() if b)


def owner_of(module_id):
    return next((pid for pid, (m, _, b, _) in _discover().items() if b and m.get("module") == module_id), None)


def granted(pid, permission, state=None, found=None):
    """Does this plugin hold this permission? Built-in plugins start with theirs; anyone else's start with none."""
    with _lock:
        state = state or _load()
        found = found or _discover()
        if pid not in found:
            return False
        manifest, _, builtin, _ = found[pid]
        entry = state["plugins"].get(pid) or {}
        if "granted" not in entry:
            return builtin and permission in manifest["permissions"]
        return permission in entry["granted"] and permission in manifest["permissions"]


def listing():
    """Everything Settings › Plugins shows."""
    with _lock:
        state = _load()
        found = _discover()
        rows = []
        for pid, (manifest, folder, builtin, error) in found.items():
            entry = state["plugins"].get(pid) or {}
            digest = _folder_hash(folder)
            approved = builtin or entry.get("approved") == digest
            rows.append({
                "id": pid, "name": manifest.get("name", pid), "version": manifest.get("version", ""),
                "description": manifest.get("description", ""), "author": manifest.get("author", ""),
                "source": "Built in" if builtin else "Your own", "builtin": builtin,
                "on": _is_on(pid, state, found), "broken": error,
                "permissions": [{"id": p, "words": PERMISSIONS[p], "granted": granted(pid, p, state, found)}
                                for p in manifest.get("permissions", [])],
                "pane": manifest.get("pane"), "checks": manifest.get("checks", []),
                "actions": [{"id": a["id"], "name": a["name"], "gcode": a["gcode"]} for a in manifest.get("actions", [])],
                "lives": manifest.get("lives", ""),
                "errors": entry.get("errors", [])[-5:],
                "real_printer": approved, "trial": entry.get("trial", [])[-MAX_TRIAL:],
            })
        return {"safe_start": state["safe_start"], "plugins": rows, "permission_words": PERMISSIONS}


def _known(pid, found):
    if pid not in found:
        raise ValueError("No plugin with that id")
    return found[pid]


def set_on(pid, on):
    with _lock:
        found = _discover()
        manifest, _, builtin, error = _known(pid, found)
        if on and error:
            raise ValueError(f"This plugin can't be switched on: {error}")
        if builtin and manifest.get("module"):
            import modules
            modules.set_enabled(manifest["module"], bool(on))
        else:
            state = _load()
            entry = _entry(state, pid)
            entry["on"] = bool(on)
            _save(state)
    return listing()


def set_grant(pid, permission, allow):
    with _lock:
        found = _discover()
        manifest, _, builtin, _ = _known(pid, found)
        if permission not in manifest["permissions"]:
            raise ValueError("The plugin didn't ask for that permission")
        state = _load()
        entry = _entry(state, pid)
        if "granted" not in entry:
            entry["granted"] = list(manifest["permissions"]) if builtin else []
        grants = set(entry["granted"])
        grants.add(permission) if allow else grants.discard(permission)
        entry["granted"] = sorted(grants)
        _save(state)
    return listing()


def set_safe_start(on):
    with _lock:
        state = _load()
        state["safe_start"] = bool(on)
        _save(state)
    return listing()


def report_error(pid, message):
    """A plugin broke: switch it off and keep what happened, so it never takes the app down twice."""
    with _lock:
        found = _discover()
        _known(pid, found)
        state = _load()
        entry = _entry(state, pid)
        entry["errors"] = (entry.get("errors", []) + [{"at": time.time(), "text": str(message or "")[:300]}])[-10:]
        manifest, _, builtin, _ = found[pid]
        if not (builtin and manifest.get("module")):
            entry["on"] = False
        _save(state)
    if found[pid][2] and found[pid][0].get("module"):
        set_on(pid, False)
    return listing()


def approve_real(pid):
    """The owner has looked at the practice run: this exact version may now use the real printer."""
    with _lock:
        found = _discover()
        _, folder, _, _ = _known(pid, found)
        state = _load()
        entry = _entry(state, pid)
        entry["approved"] = _folder_hash(folder)
        _save(state)
    return listing()


def install(files):
    """Add or replace one of your own plugins from its files: {"plugin.json": text, "pane.js": text, ...}."""
    if not isinstance(files, dict) or "plugin.json" not in files:
        raise ValueError("Pick the plugin's folder: it needs a plugin.json")
    total = 0
    for name, text in files.items():
        if not _FILE.match(str(name)) or not isinstance(text, str):
            raise ValueError(f"{name} can't be part of a plugin: only .json, .js, .css, .md and .txt files")
        size = len(text.encode("utf-8"))
        total += size
        if size > MAX_FILE or total > MAX_TOTAL:
            raise ValueError("The plugin is too big: 200 KB a file and 500 KB in all at most")
    try:
        manifest = validate(json.loads(files["plugin.json"]))
    except json.JSONDecodeError as exc:
        raise ValueError(f"plugin.json isn't valid JSON: {exc.msg} at line {exc.lineno}")
    pane = manifest.get("pane")
    if pane and pane["script"] not in files:
        raise ValueError(f"plugin.json names {pane['script']} for its pane, but that file isn't in the folder")
    pid = manifest["id"]
    with _lock:
        found = _discover()
        if pid in found and found[pid][2]:
            raise ValueError("That id belongs to a built-in plugin. Give yours another id")
        folder = os.path.join(_user_dir(), pid)
        os.makedirs(folder, exist_ok=True)
        for old in os.listdir(folder):
            if os.path.isfile(os.path.join(folder, old)):
                os.remove(os.path.join(folder, old))
        for name, text in files.items():
            with open(os.path.join(folder, name), "w", encoding="utf-8") as f:
                f.write(text)
        state = _load()
        entry = _entry(state, pid)
        # A new or changed plugin starts off, keeps only grants it still asks for, and goes back to the practice printer.
        entry.update(on=False, granted=[p for p in entry.get("granted", []) if p in manifest["permissions"]],
                     trial=[])
        _save(state)
    return listing()


def remove(pid):
    with _lock:
        found = _discover()
        _, folder, builtin, _ = _known(pid, found)
        if builtin:
            raise ValueError("A built-in plugin can be switched off but not removed")
        for name in os.listdir(folder):
            os.remove(os.path.join(folder, name))
        os.rmdir(folder)
        state = _load()
        state["plugins"].pop(pid, None)
        _save(state)
    return listing()


def pane(pid):
    """The pane's script and what the frame may do, for a plugin that is on."""
    found = _discover()
    manifest, folder, builtin, _ = _known(pid, found)
    if not _is_on(pid, found=found):
        raise PermissionError("This plugin is off" + (" (safe start)" if safe_start() else ""))
    if not manifest.get("pane"):
        raise ValueError("This plugin has no pane")
    with open(os.path.join(folder, manifest["pane"]["script"]), encoding="utf-8") as f:
        script = f.read()
    return {"id": pid, "title": manifest["pane"]["title"], "script": script, "network": granted(pid, "network"),
            "practice": not builtin and (_load()["plugins"].get(pid) or {}).get("approved") != _folder_hash(folder)}


# -- calls from a running plugin --------------------------------------------------------------------------------


def _target(pid, printer_id, found, state):
    """The printer a call acts on: the practice printer until the owner has allowed the real one."""
    import mock_moonraker
    manifest, folder, builtin, _ = found[pid]
    approved = builtin or _entry(state, pid).get("approved") == _folder_hash(folder)
    if not approved:
        return mock_moonraker.DEFAULT_PRINTER_ID, True
    if printer_id and mock_moonraker.has_printer(printer_id):
        return printer_id, False
    return mock_moonraker.selected_printer_id(), False


def _note_trial(pid, practice, what):
    if not practice:
        return
    with _lock:
        state = _load()
        entry = _entry(state, pid)
        entry["trial"] = (entry.get("trial", []) + [{"at": time.time(), "did": what[:200]}])[-MAX_TRIAL:]
        _save(state)


def _printer_view(state):
    """Temperatures, progress and what each head holds: never the printer's address or serial number."""
    heads = {}
    for name, head in (state.get("toolheads") or {}).items():
        heads[name] = {"temperature": head.get("temperature"), "target": head.get("target_temperature"),
                       "status": head.get("status"), "loaded": head.get("filament_loaded"),
                       "material": head.get("filament_material"), "colour": head.get("filament_color_hex"),
                       "colour_name": head.get("filament_color_name")}
    return {"state": state.get("state"), "file": state.get("current_file"), "progress": state.get("progress"),
            "layer": state.get("layer"), "heads": heads,
            "bed": {"temperature": state.get("bed_temperature"), "target": state.get("bed_target")},
            "chamber": state.get("chamber_temperature")}


def call(pid, method, args=None, printer_id=None):
    """One ask from a running plugin, checked here whatever the page already checked."""
    args = args if isinstance(args, dict) else {}
    if method not in CALLS:
        raise ValueError(f"No call named {method}")
    with _lock:
        state = _load()
        found = _discover()
        _known(pid, found)
        if not _is_on(pid, state, found):
            raise PermissionError("This plugin is off" + (" (safe start)" if state["safe_start"] else ""))
        need = CALLS[method]
        if need and not granted(pid, need, state, found):
            raise PermissionError(f"Not allowed: this plugin hasn't been granted \"{PERMISSIONS[need]}\". "
                                  "You can grant it in Settings, Plugins")
        if method == "storage.get":
            return {"value": _entry(state, pid).get("store", {}).get(str(args.get("key", ""))[:60])}
        if method == "storage.set":
            entry = _entry(state, pid)
            store = dict(entry.get("store", {}))
            store[str(args.get("key", ""))[:60]] = args.get("value")
            if len(json.dumps(store)) > MAX_STORE:
                raise ValueError("The plugin's notebook is full (64 KB)")
            entry["store"] = store
            _save(state)
            return {"ok": True}
        target, practice = _target(pid, printer_id, found, state)
    import mock_moonraker
    if method == "printer.state":
        with mock_moonraker.use_printer(target):
            view = _printer_view(mock_moonraker.get_printer_state() or {})
        return {**view, "printer": mock_moonraker.printer_name(target), "practice": practice}
    if method == "printer.command":
        result = run_gcode(pid, [str(args.get("gcode") or "")], target, practice)
        return {**result, "practice": practice}
    import file_library
    if method == "files.list":
        rows = []
        for f in file_library.list_files()["files"][:300]:
            summary = f.get("summary") or {}
            row = {"name": f.get("name"), "kind": f.get("kind"), "size": f.get("size"), "added": f.get("added_at")}
            row.update({k: summary[k] for k in ("estimated_hours", "filament_grams", "filament_types") if k in summary})
            rows.append(row)
        return {"files": rows}
    if method == "files.save":
        name = str(args.get("name") or "").strip()
        text = str(args.get("text") or "")
        if not name.lower().endswith((".gcode", ".txt")):
            raise ValueError("A plugin can save .gcode and .txt files only")
        if len(text.encode("utf-8")) > 5_000_000:
            raise ValueError("That file is too big for a plugin to save (5 MB at most)")
        saved = file_library.save(name, text.encode("utf-8"), origin="plugin", note=f"Saved by the plugin {pid}")
        return {"saved": saved.get("name", name) if isinstance(saved, dict) else name}
    raise ValueError(f"No call named {method}")


def run_gcode(pid, lines, target, practice):
    """Send a plugin's G-code through the same guards as the console: watch-only and the update hold included."""
    import mock_moonraker
    import printer_control
    import update_hold
    import watch_only
    if practice and mock_moonraker.is_real(target):
        raise PermissionError("The practice printer has to be a simulated one")
    if mock_moonraker.is_real(target):
        if watch_only.is_on():
            raise watch_only.WatchOnly(watch_only.MESSAGE)
        if update_hold.active():
            raise update_hold.UpdateHold(update_hold.MESSAGE)
    sent = []
    with mock_moonraker.use_printer(target):
        for line in lines:
            printer_control.send_gcode(line)
            sent.append(line)
    _note_trial(pid, practice, "Sent " + "; ".join(sent))
    return {"ok": True, "sent": sent, "printer": mock_moonraker.printer_name(target)}


def run_action(pid, action_id, printer_id=None):
    """A plugin's declared action, for its card's button and for automations."""
    with _lock:
        state = _load()
        found = _discover()
        manifest, _, _, _ = _known(pid, found)
        if not _is_on(pid, state, found):
            raise PermissionError("This plugin is off" + (" (safe start)" if state["safe_start"] else ""))
        action = next((a for a in manifest.get("actions", []) if a["id"] == action_id), None)
        if action is None:
            raise ValueError("That plugin has no such action")
        if not granted(pid, "printer.command"):
            raise PermissionError(f"Not allowed: this plugin hasn't been granted \"{PERMISSIONS['printer.command']}\"")
        target, practice = _target(pid, printer_id, found, state)
    result = run_gcode(pid, action["gcode"], target, practice)
    return {**result, "action": action["name"], "practice": practice}


# -- Confirm Print -----------------------------------------------------------------------------------------------


def _matches(when, job):
    for key, value in when.items():
        if key == "material" and not set(value) & job["materials"]:
            return False
        if key == "bed_type_contains" and value not in job["bed_type"]:
            return False
        if key == "hours_over" and not job["hours"] > value:
            return False
        if key == "grams_over" and not job["grams"] > value:
            return False
        if key == "cost_over" and not job["cost"] > value:
            return False
        if key == "heads_over" and not job["heads"] > value:
            return False
    return True


def gate_checks(job):
    """(refusals, warnings) from every plugin that is on, each said with the plugin's name in front."""
    refuse, warn = [], []
    found = _discover()
    state = _load()
    job = {"materials": {str(m).upper() for m in job.get("materials") or []},
           "bed_type": str(job.get("bed_type") or "").lower(), "hours": float(job.get("hours") or 0),
           "grams": float(job.get("grams") or 0), "cost": float(job.get("cost") or 0),
           "heads": int(job.get("heads") or 0)}
    for pid, (manifest, _, _, error) in found.items():
        if error or not _is_on(pid, state, found):
            continue
        for check in manifest.get("checks", []):
            if _matches(check["when"], job):
                (refuse if check["level"] == "refuse" else warn).append(f"{manifest['name']}: {check['say']}")
    return refuse, warn


def reset():
    """For the tests: forget every plugin's state and remove your own plugins."""
    with _lock:
        _save({"safe_start": False, "plugins": {}})
        base = _user_dir()
        if os.path.isdir(base):
            for name in os.listdir(base):
                folder = os.path.join(base, name)
                for f in os.listdir(folder):
                    os.remove(os.path.join(folder, f))
                os.rmdir(folder)
