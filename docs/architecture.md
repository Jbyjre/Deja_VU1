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
Three files — HTML, CSS, and JavaScript. No framework, no build step, and
nothing fetched from any external host: no webfonts, no CDN. The dashboard
runs fully offline.

The visual treatment is an approximation of Apple's Liquid Glass, built from
five layers: a backdrop blur, edge refraction via an SVG displacement filter,
a specular highlight that tracks the pointer, a thin bright rim, and an
elevation shadow. Only Chromium applies an SVG filter inside `backdrop-filter`;
Safari and Firefox drop that one declaration and keep the plain blur, which
still looks correct.

Repeated elements — task rows, colour rows — deliberately do not get their own
`backdrop-filter`. One blurred region per row would be slow, and glass cannot
cleanly sample other glass. They use a translucent fill inside the parent panel
instead.

`prefers-reduced-transparency`, `prefers-reduced-motion`, and
`prefers-contrast` are all handled: the first two drop the blur and the
animation, the third swaps in solid panels with real borders.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/connection` | Whether a printer is connected |
| GET | `/api/maintenance` | All tasks with status, plus usage totals |
| GET | `/api/maintenance/history` | Completed maintenance log, newest first |
| POST | `/api/maintenance/done` | Marks `{"task_id": "..."}` done, returns fresh status |
| GET | `/api/leds` | Simulated LED ring states |
| GET | `/api/colorcheck` | Simulated filament color check |
| GET | `/api/printer` | Raw mock printer state |

### No printer, no figures

With no printer connected, every route that would return numbers instead
returns exactly this and nothing else:

```json
{"connected": false, "demo": false}
```

`POST /api/maintenance/done` refuses with `409` and does not touch the log.

Adding `?demo=1` opts in to the simulated data explicitly. That is what the
dashboard's "Demo data" switch sends. Everything returned that way is flagged
`"demo": true`, and simulated module output additionally carries
`"simulated": true` and `"hardware_connected": false`.

The dashboard uses those flags to draw its badges and its demo banner, so a
panel can never quietly present invented data as a live reading. The gate is
enforced in the server, not just hidden in CSS — `curl` gets the same answer
the browser does.

Only values the server recognises turn demo mode on (`1`, `true`, `yes`). A
malformed or stray parameter leaves the gate closed.

Route matching happens before the connection check, so a mistyped URL still
returns `404` rather than looking like a disconnected printer.

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

51 tests, using Python's built-in `unittest`:

```
python3 -m unittest discover tests
```

`tests/test_maintenance.py` covers the working module — totals, thresholds,
sorting, and that marking a task done resets it without disturbing others.

`tests/test_modules.py` covers what is real in the placeholders: the LED
state machine, the color-distance maths, and a check that the simulation
always reports itself as simulated.

`tests/test_api.py` starts the real server on a spare port and talks to it
over HTTP. Its main job is guarding the no-printer-no-figures rule: it asserts
that a disconnected response contains the two flags and nothing else, so a
data key can never leak into it unnoticed.
