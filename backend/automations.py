"""
automations.py
==============

"When this happens, do that" rules that run on this machine, with no cloud
service in the loop. Each rule is one trigger, an optional condition and
one action, stored as plain JSON in backend/data/automations.json.

Triggers
  temperature          chamber, bed, a toolhead, or "whichever nozzle is
                       active" goes above / below a value
  state                a print started, finished, failed, paused, resumed
                       or was cancelled
  filament_mismatch    a toolhead the current job uses has the wrong colour
                       loaded (as the printer reports it)
  maintenance_overdue  any (or one named) maintenance task becomes overdue

Conditions
  always, while_printing, outside_quiet_hours

Actions
  notify          notifications.py - same channels and quiet-hours rules
  light           wled_bridge.py - set the strip to a colour
  home_assistant  home_assistant_bridge.py - set a sensor's state
  pause           pause the print on the printer that triggered the rule

Rules fire on the *edge*: when a trigger goes from false to true, not on
every 250 ms tick while it stays true, and never more often than the
rule's cooldown. Every firing is logged with what each action really did -
a notification with no channel set up is logged as "not sent", never as
sent.

Demo rules (made with demo data switched on) only ever watch the
simulated printers, and any message they send is prefixed "[Demo data]",
so a simulated printer can never produce a real-looking alert.
"""

import json
import os
import queue
import threading
import uuid
from datetime import datetime

import home_assistant_bridge
import maintenance
import mock_moonraker
import notifications
import wled_bridge

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_RULES_PATH = os.path.join(_DATA_DIR, "automations.json")
_LOG_PATH = os.path.join(_DATA_DIR, "automation_log.json")

TRIGGERS = {"temperature", "state", "filament_mismatch", "maintenance_overdue"}
SENSORS = {"chamber", "bed", "active_nozzle", "T0", "T1", "T2", "T3"}
STATE_EVENTS = {"started", "finished", "failed", "paused", "resumed", "cancelled"}
CONDITIONS = {"always", "while_printing", "outside_quiet_hours"}
ACTIONS = {"notify", "light", "home_assistant", "pause"}
MAX_RULES = 50

_lock = threading.RLock()
_edge = {}              # (rule_id, printer_id) -> was the trigger true last tick?
_listeners = []         # callables told about every firing (the live feed)
_work = queue.Queue()
_worker = None


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save(path, data):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def list_rules():
    with _lock:
        return _load(_RULES_PATH, [])


def get_log(limit=40):
    with _lock:
        return list(reversed(_load(_LOG_PATH, [])))[:limit]


# ---------------------------------------------------------------------------
# Validation - a rule is checked completely before it is saved
# ---------------------------------------------------------------------------

def _number(value, name):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number")


def validate(rule):
    """Return a cleaned copy of `rule`, or raise ValueError saying what's wrong."""
    if not isinstance(rule, dict):
        raise ValueError("A rule must be an object")
    name = str(rule.get("name") or "").strip()[:80]
    trigger = rule.get("trigger") or {}
    action = rule.get("action") or {}
    ttype = trigger.get("type")
    if ttype not in TRIGGERS:
        raise ValueError("Pick a trigger: temperature, state, filament_mismatch or maintenance_overdue")
    clean_trigger = {"type": ttype}
    if ttype == "temperature":
        if trigger.get("sensor") not in SENSORS:
            raise ValueError("Pick what to measure: chamber, bed, active_nozzle or T0-T3")
        if trigger.get("op") not in ("above", "below"):
            raise ValueError("Pick above or below")
        value = _number(trigger.get("value"), "The temperature")
        if not -20 <= value <= 350:
            raise ValueError("Temperature must be between -20 and 350 °C")
        clean_trigger.update(sensor=trigger["sensor"], op=trigger["op"], value=value)
    elif ttype == "state":
        if trigger.get("event") not in STATE_EVENTS:
            raise ValueError("Pick a print event: " + ", ".join(sorted(STATE_EVENTS)))
        clean_trigger["event"] = trigger["event"]
    elif ttype == "maintenance_overdue":
        task = trigger.get("task") or "any"
        if task != "any" and task not in {t["id"] for t in maintenance.TASKS}:
            raise ValueError("Unknown maintenance task")
        clean_trigger["task"] = task

    condition = rule.get("condition") or "always"
    if condition not in CONDITIONS:
        raise ValueError("Condition must be always, while_printing or outside_quiet_hours")

    atype = action.get("type")
    if atype not in ACTIONS:
        raise ValueError("Pick an action: notify, light, home_assistant or pause")
    clean_action = {"type": atype}
    if atype == "notify":
        message = str(action.get("message") or "").strip()
        if not message:
            raise ValueError("Write the notification message")
        priority = action.get("priority") or "normal"
        if priority not in ("high", "normal"):
            raise ValueError("Priority must be high or normal")
        clean_action.update(message=message[:200], priority=priority)
    elif atype == "light":
        color = str(action.get("color") or "")
        if not (len(color) == 7 and color.startswith("#") and
                all(c in "0123456789abcdefABCDEF" for c in color[1:])):
            raise ValueError("Pick a light colour like #ffaa00")
        clean_action["color"] = color.lower()
    elif atype == "home_assistant":
        entity = str(action.get("entity_id") or "").strip()
        if not entity.startswith("sensor.") or not entity[7:].replace("_", "").isalnum() \
                or entity[7:].lower() != entity[7:]:
            raise ValueError("Entity must look like sensor.printer_alert")
        clean_action.update(entity_id=entity, state=str(action.get("state") or "on")[:60])

    printer = rule.get("printer") or "any"
    if printer != "any" and not mock_moonraker.has_printer(printer):
        raise ValueError("Unknown printer")
    cooldown = _number(rule.get("cooldown_s", 60), "Cooldown")
    if not 0 <= cooldown <= 86400:
        raise ValueError("Cooldown must be between 0 and 86400 seconds")
    return {
        "name": name or _describe(clean_trigger, clean_action),
        "enabled": bool(rule.get("enabled", True)),
        "printer": printer,
        "trigger": clean_trigger,
        "condition": condition,
        "action": clean_action,
        "cooldown_s": cooldown,
    }


def _describe(trigger, action):
    t = trigger["type"]
    if t == "temperature":
        what = f"{trigger['sensor'].replace('_', ' ')} {trigger['op']} {trigger['value']:g}°C"
    elif t == "state":
        what = f"print {trigger['event']}"
    elif t == "filament_mismatch":
        what = "filament mismatch"
    else:
        what = "maintenance overdue"
    return f"When {what} → {action['type'].replace('_', ' ')}"


def add_rule(rule, demo):
    clean = validate(rule)
    with _lock:
        rules = list_rules()
        if len(rules) >= MAX_RULES:
            raise ValueError(f"At most {MAX_RULES} rules")
        clean.update(id=f"rule-{uuid.uuid4().hex[:8]}", demo=bool(demo),
                     created_at=datetime.now().isoformat(timespec="seconds"),
                     fire_count=0, last_fired_at=None)
        rules.append(clean)
        _save(_RULES_PATH, rules)
    return clean


def update_rule(rule_id, changes):
    with _lock:
        rules = list_rules()
        for i, rule in enumerate(rules):
            if rule["id"] == rule_id:
                if set(changes) == {"enabled"}:
                    rule["enabled"] = bool(changes["enabled"])
                else:
                    merged = validate({**rule, **changes})
                    rule.update(merged)
                rules[i] = rule
                _save(_RULES_PATH, rules)
                return rule
    raise ValueError(f"Unknown rule: {rule_id}")


def delete_rule(rule_id):
    with _lock:
        rules = list_rules()
        kept = [r for r in rules if r["id"] != rule_id]
        if len(kept) == len(rules):
            raise ValueError(f"Unknown rule: {rule_id}")
        _save(_RULES_PATH, kept)
        for key in [k for k in _edge if k[0] == rule_id]:
            _edge.pop(key)
    return kept


# ---------------------------------------------------------------------------
# Evaluation - called by the live feed on every tick, per printer
# ---------------------------------------------------------------------------

def _temperature(state, sensor):
    if sensor == "chamber":
        return state.get("chamber_temperature")
    if sensor == "bed":
        return state.get("bed_temperature")
    if sensor == "active_nozzle":
        active = state.get("active_toolhead")
        return state["toolheads"][active]["temperature"] if active else None
    return state["toolheads"].get(sensor, {}).get("temperature")


def _mismatch(printer_id, state):
    import color_check
    with mock_moonraker.use_printer(printer_id):
        required = mock_moonraker.get_current_job_requirements()["required_filament"]
    if not state.get("current_file"):
        return False, None
    for req in required:
        dock = state["toolheads"].get(req["toolhead"])
        if dock and req.get("expected_color_hex") and \
                color_check.compare(req["expected_color_hex"], dock["filament_color_hex"])["verdict"] == "mismatch":
            return True, f"{req['toolhead']} has {dock['filament_color_name']} loaded"
    return False, None


def _overdue(printer_id, task):
    with mock_moonraker.use_printer(printer_id):
        tasks = maintenance.get_status()["tasks"]
    hits = [t["name"] for t in tasks if t["status"] == "overdue" and task in ("any", t["id"])]
    return bool(hits), ", ".join(hits)


def _trigger_now(rule, printer_id, state, events, cache):
    """Is this rule's trigger true right now? Returns (bool, detail)."""
    trigger = rule["trigger"]
    t = trigger["type"]
    if t == "temperature":
        value = _temperature(state, trigger["sensor"])
        if value is None:
            return False, None
        hit = value > trigger["value"] if trigger["op"] == "above" else value < trigger["value"]
        return hit, f"{trigger['sensor'].replace('_', ' ')} at {value:.1f}°C"
    if t == "state":
        hit = trigger["event"] in events
        return hit, f"print {trigger['event']}: {state.get('current_file') or ''}".strip()
    if t == "filament_mismatch":
        if "mismatch" not in cache:
            cache["mismatch"] = _mismatch(printer_id, state)
        return cache["mismatch"]
    if t == "maintenance_overdue":
        key = ("overdue", trigger["task"])
        if key not in cache:
            cache[key] = _overdue(printer_id, trigger["task"])
        return cache[key]
    return False, None


def _condition_ok(rule, state):
    condition = rule.get("condition", "always")
    if condition == "while_printing":
        return state.get("state") == "printing"
    if condition == "outside_quiet_hours":
        return not notifications.is_quiet_hours()
    return True


def evaluate(printer_id, state, events, demo_printer, slow_checks=True):
    """
    Check every enabled rule against one printer's latest state and the
    print events this tick produced. Queues the actions of any rule whose
    trigger just became true. Returns the rule ids that fired.
    """
    fired = []
    cache = {}
    now = datetime.now()
    with _lock:
        rules = list_rules()
        changed = False
        for rule in rules:
            if not rule.get("enabled", True):
                continue
            if rule.get("demo") != demo_printer:
                continue
            if rule["printer"] not in ("any", printer_id):
                continue
            if rule["trigger"]["type"] in ("filament_mismatch", "maintenance_overdue") and not slow_checks:
                continue
            hit, detail = _trigger_now(rule, printer_id, state, events, cache)
            key = (rule["id"], printer_id)
            was = _edge.get(key, False)
            _edge[key] = hit
            if not hit or (was and rule["trigger"]["type"] != "state"):
                continue
            if not _condition_ok(rule, state):
                continue
            last = rule.get("last_fired_at")
            if last and (now - datetime.fromisoformat(last)).total_seconds() < rule["cooldown_s"]:
                continue
            rule["last_fired_at"] = now.isoformat(timespec="seconds")
            rule["fire_count"] = rule.get("fire_count", 0) + 1
            changed = True
            fired.append(rule["id"])
            _enqueue(rule, printer_id, detail)
        if changed:
            _save(_RULES_PATH, rules)
    return fired


# ---------------------------------------------------------------------------
# Running actions - off the live-feed thread, since they may wait on a network
# ---------------------------------------------------------------------------

def _enqueue(rule, printer_id, detail):
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_work_loop, name="automations", daemon=True)
        _worker.start()
    _work.put((dict(rule), printer_id, detail))


def _work_loop():
    while True:
        rule, printer_id, detail = _work.get()
        try:
            run_action(rule, printer_id, detail)
        except Exception as exc:          # noqa: BLE001 - a bad action must not kill the worker
            _record(rule, printer_id, detail, {"ok": False, "error": str(exc)})
        finally:
            _work.task_done()


def wait_idle(timeout=5.0):
    """Block until queued actions are done (tests use this)."""
    import time
    end = time.time() + timeout
    while time.time() < end:
        if _work.unfinished_tasks == 0:
            return True
        time.sleep(0.02)
    return False


def run_action(rule, printer_id, detail, manual=False):
    """Carry out one rule's action and log exactly what happened."""
    action = rule["action"]
    demo = rule.get("demo", False)
    printer_name = mock_moonraker.printer_name(printer_id) if mock_moonraker.has_printer(printer_id) else printer_id
    prefix = "[Demo data] " if demo else ""
    kind = action["type"]
    if kind == "notify":
        message = f"{prefix}{action['message']} — {printer_name}" + (f" ({detail})" if detail else "")
        settings = notifications.get_settings()
        has_channel = settings.get("ntfy_topic") or settings.get("discord_webhook_url") or (
            settings.get("telegram_bot_token") and settings.get("telegram_chat_id"))
        if not has_channel:
            # Checked first: a message "queued for later" with nowhere to go
            # would never arrive, so it must not be reported as queued.
            return _record(rule, printer_id, detail, {
                "ok": False, "error": "Not sent: no notification channel is set up (ntfy, Discord or Telegram)"},
                manual=manual)
        sent = notifications.notify(message, priority=action.get("priority", "normal"), settings=settings)
        if sent["queued"]:
            result = {"ok": True, "detail": "Queued until quiet hours end"}
        elif not sent["results"]:
            result = {"ok": False, "error": "Not sent: no notification channel is set up (ntfy, Discord or Telegram)"}
        else:
            failures = {k: v.get("error") for k, v in sent["results"].items() if not v.get("ok")}
            result = ({"ok": True, "detail": "Sent via " + ", ".join(sent["results"])} if not failures
                      else {"ok": False, "error": "; ".join(f"{k}: {v}" for k, v in failures.items())})
    elif kind == "light":
        r = wled_bridge.push_color(action["color"])
        result = {"ok": True, "detail": f"Light set to {action['color']}"} if r.get("ok") \
            else {"ok": False, "error": r.get("error", "WLED didn't accept the colour")}
    elif kind == "home_assistant":
        state = f"{prefix}{action['state']}".strip()
        r = home_assistant_bridge.publish_entity(action["entity_id"], state,
                                                 {"friendly_name": rule["name"], "printer": printer_name})
        result = {"ok": True, "detail": f"{action['entity_id']} set to {state}"} if r.get("ok") \
            else {"ok": False, "error": r.get("error", "Home Assistant didn't accept it")}
    elif kind == "pause":
        try:
            with mock_moonraker.use_printer(printer_id):
                mock_moonraker.pause_print()
            result = {"ok": True, "detail": f"Paused the print on {printer_name}"}
        except (ValueError, mock_moonraker.PrinterCommandError) as exc:
            result = {"ok": False, "error": f"Pause failed: {exc}"}
    else:
        result = {"ok": False, "error": f"Unknown action {kind}"}
    return _record(rule, printer_id, detail, result, manual=manual)


def _record(rule, printer_id, detail, result, manual=False):
    entry = {
        "time": datetime.now().isoformat(timespec="seconds"),
        "rule_id": rule["id"], "rule_name": rule["name"], "printer": printer_id,
        "trigger": detail, "action": rule["action"]["type"], "manual": manual,
        "demo": rule.get("demo", False), **result,
    }
    with _lock:
        log = _load(_LOG_PATH, [])
        log.append(entry)
        _save(_LOG_PATH, log[-100:])
    for listener in list(_listeners):
        try:
            listener(entry)
        except Exception:                 # noqa: BLE001
            pass
    return entry


def test_fire(rule_id, printer_id):
    """Run a rule's action right now, as if it had triggered (logged as manual)."""
    rule = next((r for r in list_rules() if r["id"] == rule_id), None)
    if rule is None:
        raise ValueError(f"Unknown rule: {rule_id}")
    return run_action(rule, printer_id, "Test run from the dashboard", manual=True)


def add_listener(fn):
    _listeners.append(fn)


def reset():
    with _lock:
        _save(_RULES_PATH, [])
        _save(_LOG_PATH, [])
        _edge.clear()
