"""
maintenance.py
==============

The maintenance reminder engine. This is the fully working module of Deja Vu1
— it needs no extra hardware, only print history, so it runs today.

The idea in plain terms:
  * Every printer task (clean the nozzle, level the bed, check belt tension,
    lubricate the rails) should be repeated after a certain amount of use.
  * "Use" is measured three ways: hours printed, number of prints, or days
    passed on the calendar.
  * We read the print history, add up usage since the last time each task was
    marked done, and compare it against that task's threshold.
  * When usage passes the threshold, the task is due.
  * When the user clicks "mark as done", we write down the date and the
    printer's total hours at that moment. The counter effectively resets.

Nothing here talks to a printer directly. It asks mock_moonraker for history,
so swapping in a real printer later changes nothing in this file.
"""

import json
import os
from datetime import datetime, timedelta

from mock_moonraker import get_print_history

# Where the "when did I last do this task" records are saved. A plain JSON
# file keeps this dependency-free — no database to install.
_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_LOG_PATH = os.path.join(_DATA_DIR, "maintenance_log.json")


# ---------------------------------------------------------------------------
# Task definitions
# ---------------------------------------------------------------------------
# Each task can be limited by any combination of:
#   hours_threshold  - print hours since it was last done
#   prints_threshold - number of prints since it was last done
#   days_threshold   - calendar days since it was last done
# Whichever limit is hit first wins. Intervals are in the range Snapmaker and
# the wider Klipper community treat as reasonable for a well-used machine.

TASKS = [
    {
        "id": "nozzle_check",
        "name": "Nozzle check & clean",
        "description": "Inspect the nozzle tip for buildup and check for partial clogs.",
        "hours_threshold": 50,
        "prints_threshold": None,
        "days_threshold": None,
        "severity": "routine",
        "est_minutes": 10,
    },
    {
        "id": "bed_level",
        "name": "Bed leveling check",
        "description": "Re-run bed mesh calibration and confirm first-layer squish.",
        "hours_threshold": 80,
        "prints_threshold": 25,
        "days_threshold": None,
        "severity": "routine",
        "est_minutes": 15,
    },
    {
        "id": "belt_tension",
        "name": "Belt tension check",
        "description": "Check X and Y belt tension; a loose belt shows up as ringing on prints.",
        "hours_threshold": 200,
        "prints_threshold": None,
        "days_threshold": None,
        "severity": "important",
        "est_minutes": 20,
    },
    {
        "id": "lubrication",
        "name": "Rail & leadscrew lubrication",
        "description": "Wipe the linear rails and Z leadscrew, then re-apply grease.",
        "hours_threshold": None,
        "prints_threshold": None,
        "days_threshold": 60,
        "severity": "routine",
        "est_minutes": 15,
    },
    {
        "id": "dock_alignment",
        "name": "Toolhead dock alignment",
        "description": "Verify each toolhead picks up and drops off cleanly at its dock.",
        "hours_threshold": 120,
        "prints_threshold": 60,
        "days_threshold": None,
        "severity": "important",
        "est_minutes": 20,
    },
    {
        "id": "fan_clean",
        "name": "Fan & filter cleaning",
        "description": "Clear dust from part-cooling fans, hotend fan, and the air filter.",
        "hours_threshold": 150,
        "prints_threshold": None,
        "days_threshold": 90,
        "severity": "routine",
        "est_minutes": 10,
    },
]

_TASKS_BY_ID = {t["id"]: t for t in TASKS}


# ---------------------------------------------------------------------------
# Reading and writing the maintenance log
# ---------------------------------------------------------------------------

def _default_log():
    """
    Build a starting log for a first run.

    The story we tell: the user did a full maintenance pass roughly halfway
    through their print history, and has printed plenty since. That produces a
    realistic mix — a few tasks overdue, one or two approaching, the rest fine
    — instead of everything reading either "brand new" or "all overdue".
    """
    history = get_print_history()

    if not history:
        # No prints at all yet: treat everything as done right now.
        now = datetime.now().isoformat(timespec="seconds")
        return {
            "tasks": {
                t["id"]: {
                    "last_done_at": now,
                    "hours_at_last_done": 0.0,
                    "prints_at_last_done": 0,
                }
                for t in TASKS
            },
            "history": [],
        }

    # Find the job at the midpoint of the history and use it as the moment
    # the maintenance pass happened.
    midpoint = len(history) // 2
    hours_at_midpoint = sum(
        job["print_duration_hours"] for job in history[:midpoint]
    )
    done_at = history[midpoint]["start_time"]

    entries = {
        task["id"]: {
            "last_done_at": done_at,
            "hours_at_last_done": round(hours_at_midpoint, 2),
            "prints_at_last_done": midpoint,
        }
        for task in TASKS
    }

    return {"tasks": entries, "history": []}


def _load_log():
    """Read the saved log from disk, creating it on the first run."""
    if not os.path.exists(_LOG_PATH):
        log = _default_log()
        _save_log(log)
        return log

    with open(_LOG_PATH, "r", encoding="utf-8") as fh:
        log = json.load(fh)

    # If a new task was added to TASKS after the log was created, give it a
    # sensible starting point rather than crashing.
    for task in TASKS:
        if task["id"] not in log["tasks"]:
            log["tasks"][task["id"]] = _default_log()["tasks"][task["id"]]

    return log


def _save_log(log):
    """Write the log back to disk."""
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_LOG_PATH, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=2)


# ---------------------------------------------------------------------------
# Usage totals
# ---------------------------------------------------------------------------

def get_printer_totals():
    """
    Add up everything the printer has done, according to the print history.

    Failed and cancelled prints still count toward wear — the machine was
    moving and extruding either way — so they are included in the hours.
    Only completed prints count toward the "number of prints" totals, since
    that is what bed-leveling intervals are really tracking.
    """
    history = get_print_history()

    total_hours = sum(job["print_duration_hours"] for job in history)
    total_grams = sum(job["filament_used_grams"] for job in history)
    completed = [j for j in history if j["status"] == "completed"]
    failed = [j for j in history if j["status"] != "completed"]

    return {
        "total_print_hours": round(total_hours, 2),
        "total_prints": len(history),
        "completed_prints": len(completed),
        "failed_prints": len(failed),
        "total_filament_grams": round(total_grams, 1),
        "first_print": history[0]["start_time"] if history else None,
        "last_print": history[-1]["start_time"] if history else None,
    }


def _usage_since(entry):
    """
    Work out how much use has accumulated since a task was last done.

    `entry` is one record from the log. We compare the printer's running
    totals now against the totals recorded when the task was marked done.
    """
    totals = get_printer_totals()

    hours_since = max(0.0, totals["total_print_hours"] - entry["hours_at_last_done"])
    prints_since = max(0, totals["total_prints"] - entry["prints_at_last_done"])

    last_done = datetime.fromisoformat(entry["last_done_at"])
    days_since = max(0.0, (datetime.now() - last_done).total_seconds() / 86400.0)

    return {
        "hours_since": round(hours_since, 2),
        "prints_since": prints_since,
        "days_since": round(days_since, 1),
    }


def _evaluate_task(task, entry):
    """
    Decide the state of one task: ok, due soon, or overdue.

    For each limit the task defines, we compute how far through the interval
    we are as a percentage. The limit that is furthest along decides the
    task's status, because that is the one that will trip first.
      under 80%  -> ok
      80% - 100% -> due_soon
      over 100%  -> overdue
    """
    usage = _usage_since(entry)

    # Each entry is (percent_through_interval, human readable reason).
    ratios = []

    if task["hours_threshold"]:
        pct = usage["hours_since"] / task["hours_threshold"]
        ratios.append((pct, f"{usage['hours_since']:.1f} of {task['hours_threshold']} print hours"))

    if task["prints_threshold"]:
        pct = usage["prints_since"] / task["prints_threshold"]
        ratios.append((pct, f"{usage['prints_since']} of {task['prints_threshold']} prints"))

    if task["days_threshold"]:
        pct = usage["days_since"] / task["days_threshold"]
        ratios.append((pct, f"{usage['days_since']:.0f} of {task['days_threshold']} days"))

    # The limit closest to being exceeded is the one that matters.
    top_pct, top_reason = max(ratios, key=lambda r: r[0])

    if top_pct >= 1.0:
        status = "overdue"
    elif top_pct >= 0.8:
        status = "due_soon"
    else:
        status = "ok"

    return {
        "id": task["id"],
        "name": task["name"],
        "description": task["description"],
        "severity": task["severity"],
        "est_minutes": task["est_minutes"],
        "status": status,
        "percent": round(min(top_pct, 1.5) * 100, 1),
        "reason": top_reason,
        "all_reasons": [r[1] for r in ratios],
        "last_done_at": entry["last_done_at"],
        "usage_since": usage,
    }


# ---------------------------------------------------------------------------
# Public API — these three functions are what the dashboard calls
# ---------------------------------------------------------------------------

def get_status():
    """
    "What's due?"

    Returns every maintenance task with its current state, sorted so the most
    urgent appears first, plus the printer's overall usage totals.
    """
    log = _load_log()

    results = [
        _evaluate_task(task, log["tasks"][task["id"]])
        for task in TASKS
    ]

    # Sort by how far through the interval each task is, most urgent first.
    results.sort(key=lambda r: r["percent"], reverse=True)

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "totals": get_printer_totals(),
        "tasks": results,
        "summary": {
            "overdue": sum(1 for r in results if r["status"] == "overdue"),
            "due_soon": sum(1 for r in results if r["status"] == "due_soon"),
            "ok": sum(1 for r in results if r["status"] == "ok"),
        },
    }


def mark_done(task_id, note=""):
    """
    "Mark as done."

    Records that the user just performed a task. We save today's date and the
    printer's current totals, so the countdown for that task starts over from
    here. Returns the freshly recalculated status.
    """
    if task_id not in _TASKS_BY_ID:
        raise ValueError(f"Unknown maintenance task: {task_id}")

    log = _load_log()
    totals = get_printer_totals()
    now = datetime.now().isoformat(timespec="seconds")

    log["tasks"][task_id] = {
        "last_done_at": now,
        "hours_at_last_done": totals["total_print_hours"],
        "prints_at_last_done": totals["total_prints"],
    }

    log["history"].append({
        "task_id": task_id,
        "task_name": _TASKS_BY_ID[task_id]["name"],
        "completed_at": now,
        "printer_hours_at_completion": totals["total_print_hours"],
        "note": note,
    })

    _save_log(log)
    return get_status()


def get_history(limit=50):
    """
    "Get history."

    Returns the log of completed maintenance tasks, newest first.
    """
    log = _load_log()
    return list(reversed(log["history"]))[:limit]


def reset_log():
    """Wipe the saved log and start over. Useful for demos and tests."""
    log = _default_log()
    _save_log(log)
    return log


# ---------------------------------------------------------------------------
# Running this file directly prints a readable report in the terminal.
#   python3 backend/maintenance.py
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _ICONS = {"overdue": "[!]", "due_soon": "[~]", "ok": "[ok]"}

    status = get_status()
    t = status["totals"]

    print("=" * 62)
    print("Deja Vu1 — Maintenance Report (simulated printer data)")
    print("=" * 62)
    print(f"Total print hours : {t['total_print_hours']}")
    print(f"Total prints      : {t['total_prints']} "
          f"({t['completed_prints']} completed, {t['failed_prints']} failed/cancelled)")
    print(f"Filament used     : {t['total_filament_grams']} g")
    print(f"History spans     : {t['first_print'][:10]} to {t['last_print'][:10]}")
    print()

    s = status["summary"]
    print(f"{s['overdue']} overdue | {s['due_soon']} due soon | {s['ok']} ok")
    print("-" * 62)

    for task in status["tasks"]:
        print(f"{_ICONS[task['status']]:5} {task['name']:32} {task['percent']:5.1f}%")
        print(f"      {task['reason']}  (~{task['est_minutes']} min)")

    print("-" * 62)
    done = get_history()
    if done:
        print("Recently completed:")
        for item in done[:5]:
            print(f"  {item['completed_at'][:10]}  {item['task_name']}")
    else:
        print("No maintenance tasks logged as done yet.")
    print("=" * 62)
