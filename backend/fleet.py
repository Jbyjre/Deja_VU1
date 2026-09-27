"""
fleet.py
========

More than one printer. Two separate things live here:

  1. The registry - the printers the user has added by address (a
     Moonraker URL on the home network). That is the dashboard's own
     setting, like the filament list, so it is always available. Until a
     real Moonraker client exists, a registered printer honestly shows as
     "not connected" - it is never filled in with made-up numbers.

  2. The overview - one at-a-glance row per printer (state, progress,
     alerts, health). Those are printer figures, so the API only serves
     them for connected printers or, with demo data switched on, for the
     simulated fleet in mock_moonraker.py.

Selecting a printer anywhere in the dashboard adds ?printer=<id> to every
request; the server then answers every existing module for that printer.

The command center (operating the farm as a group) lives here too:

  3. broadcast() - one action (preheat, pause, resume, cancel, home) sent to
     several printers at once, in parallel, through printer_control's own
     per-printer functions. Each printer's outcome is reported separately
     and read back from the printer afterwards: a broadcast that half
     works says exactly which half, never "done".
  4. route_file() - put a library file on another printer's queue (or move
     a waiting queue item across). The library is shared, so this is just
     print_queue.add() for the target; starting it still goes through the
     Confirm Print gate like every other start.
  5. history() - print counts, completed vs failed, material and hours over
     time, per printer and for the farm, aggregated from each printer's own
     get_print_history(). No new data source.
"""

import os
import re
import threading
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import maintenance
import mock_moonraker
import print_gate
import print_queue
import printer_control
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_PATH = os.path.join(_DATA_DIR, "fleet.json")
_URL = re.compile(r"^https?://[A-Za-z0-9.-]{1,253}(:\d{1,5})?/?$")
_lock = threading.RLock()


def registered():
    with _lock:
        items = storage.load_json(_PATH, [])
        return items if isinstance(items, list) else []


def _save(items):
    storage.save_json(_PATH, items)


def add(name, moonraker_url):
    name = str(name or "").strip()[:40]
    url = str(moonraker_url or "").strip()
    if not name:
        raise ValueError("Give the printer a name")
    if not _URL.match(url):
        raise ValueError("Enter the printer's Moonraker address, like http://192.168.1.50:7125")
    with _lock:
        items = registered()
        if len(items) >= 12:
            raise ValueError("At most 12 printers")
        entry = {"id": f"printer-{uuid.uuid4().hex[:6]}", "name": name,
                 "moonraker_url": url.rstrip("/"),
                 "added_at": datetime.now().isoformat(timespec="seconds"),
                 "connected": mock_moonraker.is_connected()}
        items.append(entry)
        _save(items)
    return entry


def remove(printer_id):
    with _lock:
        items = registered()
        kept = [p for p in items if p["id"] != printer_id]
        if len(kept) == len(items):
            raise ValueError("Unknown printer")
        _save(kept)
    return kept


def registry():
    return {"printers": [{**p, "connected": mock_moonraker.is_connected()} for p in registered()],
            "note": ("Printers you add are saved here. Live data needs a real Moonraker "
                     "connection, which arrives with the hardware - until then they show "
                     "as not connected.")}


def _alerts(state, maint):
    alerts = []
    for th, dock in state["toolheads"].items():
        if dock["status"] == "error":
            alerts.append({"level": "error", "text": f"Dock {th} error"})
    if state["state"] == "error":
        alerts.append({"level": "error", "text": state.get("state_message") or "Printer error"})
    if state["state"] == "paused":
        alerts.append({"level": "warning", "text": "Paused"})
    if state.get("link_lost"):
        alerts.append({"level": "error",
                       "text": f"No answer since {state['link_lost_at'][11:19]} - showing its last report"})
    overdue = maint["summary"]["overdue"]
    if overdue:
        alerts.append({"level": "warning", "text": f"{overdue} maintenance overdue"})
    return alerts


def summary_for(printer_id, state=None):
    """One printer's overview row (call inside nothing - it selects itself)."""
    with mock_moonraker.use_printer(printer_id):
        state = state or mock_moonraker.get_printer_state()
        maint = maintenance.get_status()
        health = print_gate.printer_health()
    progress = state.get("progress") or 0.0
    elapsed = state.get("print_duration_hours") or 0.0
    remaining = (elapsed / progress - elapsed) if 0 < progress < 1 and state["state"] == "printing" else None
    active = state.get("active_toolhead")
    return {
        "id": printer_id,
        "name": mock_moonraker.printer_name(printer_id),
        "state": state["state"],
        "state_message": state.get("state_message"),
        "current_file": state.get("current_file"),
        "progress": round(progress, 4),
        "remaining_hours": round(remaining, 3) if remaining is not None else None,
        "active_toolhead": active,
        "active_color": state["toolheads"][active]["filament_color_hex"] if active else None,
        "nozzle_temperature": state["toolheads"][active]["temperature"] if active else None,
        "bed_temperature": state.get("bed_temperature"),
        "chamber_temperature": state.get("chamber_temperature"),
        "docks": {th: {"status": d["status"], "color": d["filament_color_hex"]}
                  for th, d in state["toolheads"].items()},
        "alerts": _alerts(state, maint),
        "health": health["score"],
        "link_lost": bool(state.get("link_lost")),
        "sandbox": mock_moonraker.is_sandbox_printer(printer_id),
    }


def overview():
    return {"printers": [summary_for(pid) for pid in mock_moonraker.printer_ids()]}


# ---------------------------------------------------------------------------
# The command center: one action, many printers
# ---------------------------------------------------------------------------

BROADCAST_ACTIONS = ("preheat", "pause", "resume", "cancel", "home")
# What each action should leave the printer reporting. Used to check the
# read-back, the same way the single-printer buttons do (runCommand's
# "expect"): a command the printer accepted but didn't act on is a failure.
_EXPECT = {
    "pause": lambda s: s["state"] == "paused",
    "resume": lambda s: s["state"] == "printing",
    "cancel": lambda s: s["state"] not in ("printing", "paused"),
}


def _targets(printer_ids):
    """Validate the chosen printers; None or [] means every simulated printer."""
    known = mock_moonraker.printer_ids()
    registered_ids = {p["id"] for p in registered()}
    if not printer_ids:
        return known
    if not isinstance(printer_ids, list) or len(printer_ids) > 64:
        raise ValueError("printers must be a list of printer ids")
    out = []
    for pid in printer_ids:
        pid = str(pid)
        if pid not in known and pid not in registered_ids:
            raise ValueError(f"Unknown printer: {pid}")
        if pid not in out:
            out.append(pid)
    return out


def _preheat_params(params):
    params = params or {}
    nozzle = params.get("nozzle")
    bed = params.get("bed")
    if nozzle in (None, "") and bed in (None, ""):
        raise ValueError("Give a nozzle or bed temperature to preheat to")
    toolheads = params.get("toolheads") or ["T0"]
    if toolheads == "all":
        toolheads = list(mock_moonraker.TOOLHEADS)
    if not isinstance(toolheads, list) or any(t not in mock_moonraker.TOOLHEADS for t in toolheads):
        raise ValueError("toolheads must be a list like [\"T0\"] or \"all\"")
    # Validate once, up front, so a bad number fails the whole request with
    # one clear message instead of the same error once per printer.
    for value, top, what in ((nozzle, printer_control.MAX_TEMP, "Nozzle"),
                             (bed, printer_control.MAX_BED_TEMP, "Bed")):
        if value in (None, ""):
            continue
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{what} temperature must be a number")
        if not printer_control.MIN_TEMP <= v <= top:
            raise ValueError(f"{what} temperature must be between {printer_control.MIN_TEMP} and {top}")
    return {"nozzle": None if nozzle in (None, "") else float(nozzle),
            "bed": None if bed in (None, "") else float(bed), "toolheads": toolheads}


def _run_one(printer_id, action, params):
    """One printer's part of a broadcast. Never raises: every outcome is a row."""
    row = {"printer": printer_id, "action": action}
    if not mock_moonraker.has_printer(printer_id):
        name = next((p["name"] for p in registered() if p["id"] == printer_id), printer_id)
        return {**row, "name": name, "ok": False, "kind": "not_connected",
                "error": "Not connected - there is no live link to this printer yet"}
    row["name"] = mock_moonraker.printer_name(printer_id)
    try:
        with mock_moonraker.use_printer(printer_id):
            if action == "preheat":
                for th in params["toolheads"]:
                    if params["nozzle"] is not None:
                        printer_control.set_temperature(th, params["nozzle"])
                if params["bed"] is not None:
                    printer_control.set_bed_temperature(params["bed"])
            elif action == "pause":
                printer_control.pause_print()
            elif action == "resume":
                printer_control.resume_print()
            elif action == "cancel":
                printer_control.cancel_print()
            elif action == "home":
                printer_control.home(params.get("axes") or ["X", "Y", "Z"])
            state = mock_moonraker.get_printer_state()
    except mock_moonraker.PrinterCommandError as exc:
        return {**row, "ok": False, "kind": "printer_failed", "error": f"The printer reported a failure: {exc}"}
    except ValueError as exc:
        return {**row, "ok": False, "kind": "refused", "error": str(exc)}
    except Exception as exc:                       # noqa: BLE001 - one printer can't sink the rest
        return {**row, "ok": False, "kind": "error", "error": f"Unexpected error: {exc}"}
    row["confirmed_state"] = state
    expect = _EXPECT.get(action)
    if expect and not expect(state):
        return {**row, "ok": False, "kind": "not_confirmed",
                "error": f"Sent, but the printer now reports \"{state['state']}\""}
    if action == "preheat":
        # The same read-back the single-printer temperature control makes:
        # the target the printer now reports must be the one asked for.
        wrong = [th for th in params["toolheads"] if params["nozzle"] is not None
                 and abs(state["toolheads"][th]["target_temperature"] - params["nozzle"]) > 0.01]
        if params["bed"] is not None and abs((state.get("bed_target") or 0) - params["bed"]) > 0.01:
            wrong.append("bed")
        if wrong:
            return {**row, "ok": False, "kind": "not_confirmed",
                    "error": f"Sent, but the printer doesn't report the new target for {', '.join(wrong)}"}
        targets = [f"{th} {state['toolheads'][th]['target_temperature']:.0f}°C" for th in params["toolheads"]
                   if params["nozzle"] is not None]
        if params["bed"] is not None:
            targets.append(f"bed {state.get('bed_target', 0):.0f}°C")
        row["detail"] = "Targets now " + ", ".join(targets)
    return {**row, "ok": True, "kind": "done"}


def broadcast(action, printer_ids=None, params=None):
    """
    Send one action to several printers at once and report each outcome.

    Runs in parallel - a farm is only as responsive as its slowest printer,
    so one that is slow to answer mustn't hold the others back.
    """
    if action not in BROADCAST_ACTIONS:
        raise ValueError(f"Unknown action: {action}. Choose one of {', '.join(BROADCAST_ACTIONS)}")
    targets = _targets(printer_ids)
    if not targets:
        raise ValueError("No printers to send it to")
    params = _preheat_params(params) if action == "preheat" else (params or {})
    started = datetime.now()
    with ThreadPoolExecutor(max_workers=min(8, len(targets))) as pool:
        results = list(pool.map(lambda pid: _run_one(pid, action, params), targets))
    ok = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    if not failed:
        headline = f"{action.capitalize()}: all {len(ok)} printer(s) confirmed"
    elif not ok:
        headline = f"{action.capitalize()}: none of the {len(failed)} printer(s) did it"
    else:
        headline = (f"{action.capitalize()}: {len(ok)} of {len(results)} confirmed; "
                    f"failed on {', '.join(r['name'] for r in failed)}")
    return {"action": action, "results": results, "ok_count": len(ok), "failed_count": len(failed),
            "all_ok": not failed, "headline": headline,
            "ms": round((datetime.now() - started).total_seconds() * 1000, 1)}


def route_file(filename, target, from_printer=None, item_id=None):
    """
    Put a file on another printer's queue. With from_printer + item_id it's
    a move: the item leaves the first queue only once it's safely on the
    second, so a refusal never loses it.
    """
    target = str(target or "")
    if not mock_moonraker.has_printer(target):
        if any(p["id"] == target for p in registered()):
            raise ValueError("That printer isn't connected yet, so it has no queue to add to")
        raise ValueError(f"Unknown printer: {target}")
    if item_id:
        if not mock_moonraker.has_printer(str(from_printer or "")):
            raise ValueError("Say which printer's queue the item comes from")
        if from_printer == target:
            raise ValueError("It's already on that printer's queue")
        source = print_queue.get(from_printer)
        item = next((i for i in source["items"] if i["id"] == item_id), None)
        if item is None:
            raise ValueError("That item isn't in the queue any more")
        if item["status"] not in ("queued", "held"):
            raise ValueError("Only waiting items can be moved - that one has started or finished")
        filename = item["filename"]
    result = print_queue.add(filename, printer_id=target)
    if item_id:
        print_queue.remove(item_id, printer_id=from_printer)
    return {"routed": filename, "to": target, "to_name": mock_moonraker.printer_name(target),
            "moved_from": from_printer if item_id else None, "queue": result}


def queues():
    """Every simulated printer's queue, for the command center's drop targets."""
    return {"queues": {pid: print_queue.get(pid) for pid in mock_moonraker.printer_ids()}}


def _rates(counts):
    finished = counts["completed"] + counts["error"] + counts["cancelled"]
    if not finished:
        return {"completion_rate": None, "failure_rate": None, "cancel_rate": None}
    return {"completion_rate": round(counts["completed"] / finished, 4),
            "failure_rate": round(counts["error"] / finished, 4),
            "cancel_rate": round(counts["cancelled"] / finished, 4)}


def history(days=30, bucket="day"):
    """
    The farm's output over time: per printer and totalled, with a time
    series of prints and grams per day (or week). Every figure is summed
    from the printers' own print history - nothing is estimated. Each
    print is counted in the day (or week) it ended.
    """
    try:
        days = int(days)
    except (TypeError, ValueError):
        raise ValueError("days must be a whole number")
    if not 1 <= days <= 365:
        raise ValueError("days must be between 1 and 365")
    if bucket not in ("day", "week"):
        raise ValueError("bucket must be day or week")
    now = datetime.now()
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    def key_for(when):
        d = when.date()
        if bucket == "week":
            d = d - timedelta(days=d.weekday())
        return d.isoformat()

    keys, cursor = [], since
    while cursor <= now:
        k = key_for(cursor)
        if k not in keys:
            keys.append(k)
        cursor += timedelta(days=1)

    # grams_<outcome> splits material by how the print ended - what failures cost.
    empty = lambda: {"completed": 0, "error": 0, "cancelled": 0, "grams": 0.0, "hours": 0.0,  # noqa: E731
                     "grams_completed": 0.0, "grams_error": 0.0, "grams_cancelled": 0.0}
    farm_series = {k: empty() for k in keys}
    printers, total = [], {**empty(), "materials": defaultdict(float)}
    for pid in mock_moonraker.printer_ids():
        with mock_moonraker.use_printer(pid):
            jobs = mock_moonraker.get_print_history()
        series = {k: empty() for k in keys}
        counts, materials = empty(), defaultdict(float)
        for job in jobs:
            # A print counts on the day it ended - when its outcome happened -
            # so a failure just after midnight is in today's figures even if
            # the print started yesterday. Older records without an end time
            # fall back to their start.
            try:
                ended = datetime.fromisoformat(job.get("end_time") or job["start_time"])
            except (KeyError, TypeError, ValueError):
                continue
            ended = min(ended, now)
            if ended < since:
                continue
            status = job["status"] if job["status"] in ("completed", "error", "cancelled") else "error"
            grams, hours = float(job.get("filament_used_grams") or 0), float(job.get("print_duration_hours") or 0)
            k = key_for(ended)
            for bag in (series.get(k), farm_series.get(k), counts, total):
                if bag is None:
                    continue
                bag[status] += 1
                bag["grams"] += grams
                bag[f"grams_{status}"] += grams
                bag["hours"] += hours
            materials[job.get("filament_type") or "Unknown"] += grams
            total["materials"][job.get("filament_type") or "Unknown"] += grams
        printers.append({
            "id": pid, "name": mock_moonraker.printer_name(pid),
            "prints": counts["completed"] + counts["error"] + counts["cancelled"],
            **{k: counts[k] for k in ("completed", "error", "cancelled")},
            "grams": round(counts["grams"], 1), "hours": round(counts["hours"], 2), **_rates(counts),
            "grams_failed": round(counts["grams_error"] + counts["grams_cancelled"], 1),
            "materials": {m: round(g, 1) for m, g in sorted(materials.items())},
            "series": [{"bucket": k, **{f: round(v, 2) for f, v in series[k].items()}} for k in keys],
        })
    return {
        "days": days, "bucket": bucket, "since": since.isoformat(timespec="seconds"),
        "printers": printers,
        "farm": {"prints": total["completed"] + total["error"] + total["cancelled"],
                 **{k: total[k] for k in ("completed", "error", "cancelled")},
                 "grams": round(total["grams"], 1), "hours": round(total["hours"], 2), **_rates(total),
                 "grams_failed": round(total["grams_error"] + total["grams_cancelled"], 1),
                 "materials": {m: round(g, 1) for m, g in sorted(total["materials"].items())},
                 "series": [{"bucket": k, **{f: round(v, 2) for f, v in farm_series[k].items()}} for k in keys]},
    }


def reset():
    with _lock:
        _save([])
