# What to say, in what order

Temporary, like the rest of this folder. Delete it before the launch post.

## The one line

**One screen for every U1 you run.**

Deja Vu1 is a free, open-source dashboard for the Snapmaker U1. You watch
every printer live, start prints from your phone behind a check the server
enforces, get MakerWorld, NexPrint and OrcaSlicer projects ready for the U1,
and get a message when a print jams. It runs on your own network, with no
account and nothing to install but Python.

## Paste-ready text

**GitHub repository description** (the "About" box; it still describes the
very first version: LED dock tracking, "three modules"). Edit it on the
repository page with the ⚙ next to **About**:

> Free, open-source dashboard for the Snapmaker U1: watch every printer
> live, start prints from your phone behind a server-checked safety check,
> convert MakerWorld/NexPrint/Orca projects for the U1, and get alerts.
> Runs on your own network, Python only.

**Suggested topics** (same ⚙ box): `snapmaker`, `snapmaker-u1`, `moonraker`,
`klipper`, `3d-printing`, `print-farm`, `dashboard`, `toolchanger`.

**Short post** (forum, Reddit, Discord):

> I built Deja Vu1, a free dashboard for the Snapmaker U1. It shows every
> printer live (four updates a second), ranks what needs you across the
> farm, checks a file before it starts (build volume, toolheads, filament
> colours, maintenance) and refuses unsafe starts even from your phone. It
> also converts MakerWorld and NexPrint projects for the U1 and can skip one
> failed object while the rest finish. It has never talked to a real U1 yet:
> if you own one, I'd love a 30-minute watch-only test (link to
> docs/first-connection.md).

## Lead with these, in this order

1. **Every printer, live.** Up to 12 printers on one screen, four updates a
   second, with "done at 9:48 PM" on every running print.
2. **Needs you.** One list, most urgent first, across the whole farm.
3. **Start from your phone, safely.** Confirm Print: pre-flight, filament
   colour match, nozzles, spool weight, maintenance, time, grams, cost. The
   server checks again at the moment of starting.
4. **Files ready for the U1.** Pre-flight with line numbers; MakerWorld,
   NexPrint and OrcaSlicer projects converted in one click, multi-plate
   included; G-code in 3D, layer by layer.
5. **Skip one object.** One failed part no longer costs the whole plate.
6. **Automations and alerts.** When this happens, do that: ntfy, Discord,
   Telegram, Home Assistant, WLED, or pause the print.
7. **The digital twin.** A live engineering drawing of each printer. The
   best picture to post.
8. **Photo-to-Print Studio.** A photo becomes a four-colour relief.

Then the supporting cast: maintenance tracking, filament inventory and
Spoolman import, print cost, the farm sandbox, time-lapse, the camera, AR
preview, ten games.

**Don't lead with:** dock status rings or the colour sensor. Both are
designed and simulated but need hardware nobody has built yet. Mention them
as "coming, hardware pending", after the features that work today.

## Numbers you can quote

Each was checked against the code on 19 October 2026.

| Claim | Where it comes from |
|---|---|
| 638 automated tests, on Python 3.8, 3.10, 3.12 and 3.13 | `python3 -m unittest discover tests`; `.github/workflows/tests.yml` |
| Four updates a second (every 250 ms) | `backend/live_feed.py`, `TICK_SECONDS = 0.25` |
| Up to 12 printers | `backend/fleet.py`, "At most 12 printers" |
| 29 modules you can switch on and off | `backend/modules.py`, `REGISTRY` |
| 7 maintenance tasks | `backend/maintenance.py` |
| 28 Home Assistant sensors | `backend/home_assistant_bridge.py`, for a four-toolhead printer |
| 27 simulated printers in the sandbox (3 built in + 24) | `backend/mock_moonraker.py` |
| 10 games | `frontend/index.html`, the game picker |
| 270 × 270 × 270 mm build volume checked | Snapmaker's spec page; `backend/gcode_tools.py` |
| Nothing to install but Python | No packages; standard library only |

## Say plainly, every time

- It has **not yet run on a physical U1**. It was written against Moonraker's,
  Klipper's and Snapmaker's own U1 source and tested against a stand-in
  built from that source.
- Every picture comes from the **simulated farm**.
- Converted projects and Photo Studio files **haven't been opened in
  Snapmaker Orca itself yet**.
- The dock rings and colour sensor are **hardware pending**.

## Thanks

The README ends its credits with one line thanking the U1 community and the
Phase 1 winners as a group. Keep it when you post. Don't name individual
projects as the source of a feature.
