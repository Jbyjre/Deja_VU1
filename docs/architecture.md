# Architecture

## Overview

Deja Vu1 is one web application with three modules. It reads printer state
from Moonraker, decides what to show, and serves a dashboard.

```
   Snapmaker U1
        │
        ▼
   Moonraker  ── the printer's web API
        │
        ▼
 ┌──────────────────────────────────────────┐
 │  mock_moonraker.py                       │  ← the only file that
 │  (today: fake data. later: real HTTP)    │    talks to the printer
 └──────────────────────────────────────────┘
        │
   ┌────┴──────┬─────────────┐
   ▼           ▼             ▼
 maintenance  led_status   color_check
   │           │             │
   └────┬──────┴─────────────┘
        ▼
     app.py  ── HTTP server + JSON API
        │
        ▼
   frontend/  ── the dashboard in a browser
```

## The one rule

**Only `mock_moonraker.py` knows where data comes from.**

Every other module asks it for print history or printer state and gets back a
plain Python dictionary. None of them contain a URL, an HTTP call, or any
knowledge of Moonraker's wire format.

The result: connecting a real printer means rewriting one file. The
maintenance logic, the LED decisions, the color comparison, the API, and the
entire frontend stay exactly as they are. That is also why the whole project
is testable on a laptop with no printer attached.

## Files

### `backend/mock_moonraker.py`
Pretends to be Moonraker. Generates 38 fake print jobs spread over about two
months, plus live printer state and print-file metadata. Uses a fixed random
seed so the data is identical on every run — demos and screenshots stay
consistent.

Mirrors these real Moonraker endpoints:

| Function | Real endpoint |
|---|---|
| `get_print_history()` | `GET /server/history/list` |
| `get_printer_state()` | `GET /printer/objects/query` |
| `get_current_job_requirements()` | G-code file metadata |

### `backend/maintenance.py`
The working module. Sums print hours and print counts from history, compares
them against per-task thresholds, and reports what is due. Records completed
tasks to `backend/data/maintenance_log.json`.

A task can be limited by print hours, number of prints, calendar days, or any
combination. Whichever limit is closest to being hit decides the task's
status: under 80% is OK, 80–100% is due soon, over 100% is overdue.

Failed prints still count toward wear hours — the machine was running either
way — but only completed prints count toward print-count thresholds.

### `backend/led_status.py`
Placeholder. The state-to-color decision logic is real and tested. The
hardware write is not written. See `hardware-modules.md`.

### `backend/color_check.py`
Placeholder. The color-distance comparison is real and tested. The sensor read
is faked. See `hardware-modules.md`.

### `backend/app.py`
The web server, built on Python's standard-library `http.server`. Serves the
frontend folder as static files and answers `/api/*` with JSON. No framework,
so there is nothing to install.

### `frontend/`
Three files — HTML, CSS, and JavaScript. No framework and no build step. The
page fetches from the API and redraws. LED and color panels re-poll every five
seconds so the dashboard looks live.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/maintenance` | All tasks with status, plus usage totals |
| GET | `/api/maintenance/history` | Completed maintenance log, newest first |
| POST | `/api/maintenance/done` | Marks `{"task_id": "..."}` done, returns fresh status |
| GET | `/api/leds` | Simulated LED ring states |
| GET | `/api/colorcheck` | Simulated filament color check |
| GET | `/api/printer` | Raw mock printer state |

Every simulated response carries `"simulated": true` and
`"hardware_connected": false`. The dashboard uses those flags to draw its
"Simulation" badges, so a panel can never quietly present fake data as real.

## Storage

Maintenance records live in `backend/data/maintenance_log.json` — a plain JSON
file, so there is no database to install. It is created on first run and
regenerated if deleted.

The file is gitignored. A fresh clone starts from the same seeded demo state:
a user who did a full maintenance pass about halfway through their print
history and has printed roughly 97 hours since.

## Swapping in a real printer

1. Rewrite the three functions in `mock_moonraker.py` to call a real Moonraker
   instance over HTTP.
2. Nothing else changes.

For the hardware modules, implement `_write_to_hardware()` in `led_status.py`
and `connect_sensor()` / `calibrate()` / `read_sensor()` in `color_check.py`.
Everything that calls them already works.

## Testing

39 tests, using Python's built-in `unittest`:

```
python3 -m unittest discover tests
```

`tests/test_maintenance.py` covers the working module — totals, thresholds,
sorting, and that marking a task done resets it without disturbing others.

`tests/test_modules.py` covers what is real in the placeholders: the LED
state machine, the color-distance maths, and a check that the simulation
always reports itself as simulated.
