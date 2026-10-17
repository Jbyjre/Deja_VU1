# Changelog

Newest first. Each entry says what changed for someone using the dashboard,
and what is and isn't verified.

## Unreleased - Phase 2 work

Ideas from Phase 1 winners of the Snapmaker Innovation Fund, rebuilt from
each printer's, slicer's or service's own source (no code copied), plus
fixes for things that didn't behave the same way every time.

### Added
- **Online demo on the public Cloudflare link** (`/?demo`, and **Try the
  demo** on the product page). The real dashboard plays a recording of the
  simulated farm (`tools/online-demo/record.py` → `frontend/demo/`): every
  reading for the three simulated U1s and 150 seconds of live feed on a
  loop, with a jam halfway. Files, the planner and Photo Studio work;
  changes say "this is a recording". Checked in Chromium against a plain
  static server; the published link can't be reached from the build
  sandbox, so it hasn't been opened there yet.
- **Digital twin v2.** Drawn the drafting way: one ink, ISO-style line
  weights, hidden edges dashed (worked out per solid from the view), a
  phantom-line build volume, dimensions with arrowheads, a sheet border and
  a title block with the scale. Click a toolhead, a balloon, a part or the
  bed for its details. Not yet checked against a real U1; dock spacing is
  approximate (the printer doesn't report it).
- **Nozzle size and swap counters from the U1's firmware** (u1-klipper
  `extruder.get_status`: `nozzle_diameter`, `switch_count`, `retry_count`,
  `error_count`), shown in the twin's details. Printers that don't report
  them show "not reported", never 0.
- **Mixed-nozzle planner** (Files tab) and **a nozzle check in Confirm
  Print.** Limits from Snapmaker/OrcaSlicer `8931178`; the grid rule from
  the LixNix fork's option description (`8fa80da`), no code copied.
- **Find printers on my network** and **Test** (Fleet → Add a printer):
  mDNS `_snapmaker._tcp` (from u1-moonraker `a308cfa`) and `_moonraker._tcp`,
  then port 7125 on the home network. Tested against the stand-in
  Moonraker; not yet against a real U1.
- **Double-click starters** (`start-windows.bat`, `start-mac.command`,
  `start-linux.sh`, `start.py`) and `docs/getting-started.md`. Tested on
  Linux only.
- **Photo Studio fits the photo's tones** to the filaments (on by
  default), and leaves out tool changes the model never reaches.
- **The plate map is a top-view drawing** with numbered balloons.
- `GET /api/printer/job`, `POST /api/tools/layer-plan`,
  `POST /api/printers/discover`, `POST /api/printers/test`.

### Fixed
- A port outside 1-65535 was accepted, and the printer showed
  "Connecting…" forever. It's refused in words now.
- Spoolman's settings were saved in the real `backend/data/` even under
  the test runner.

### Added (earlier in Phase 2)
- **Skip one object** (Control tab). When a print labels its objects, they
  show on a map of the bed; pick one, confirm, and only that one stops.
  Refuses names the print doesn't have and the last object left. Read back
  from the printer. Idea from U1 Print Hub; written from Snapmaker's
  u1-klipper `exclude_object.py`.
- **Multi-plate conversions land on the right plates.** Every plate's
  objects are moved onto the U1's 270 mm plate grid, from Snapmaker Orca's
  `PartPlate.cpp`. Before, plate 2 onward landed between plates. Idea from
  the "MakerWorld to Snapmaker U1" extension.
- **Conversion errors with codes** (`CV-101`...), the stage that failed and
  what to try, and a **Copy report** button for bug reports.
- **OrcaSlicer projects** convert too.
- **Import from Spoolman** (Care tab → Filament inventory). Imports again
  update instead of duplicating; hand-added spools are left alone.
- **Add to Home Screen**: an app icon, name and manifest.
- A sample with three labelled cubes, and a three-plate MakerWorld-style
  sample, to try skip-object and the plate fix in demo mode.
- README screenshots, a status table, credits to the Phase 1 winners whose
  ideas are used, and [docs/beta-testing.md](docs/beta-testing.md).

### Changed
- **Photo Studio stays in step with what's set.** Changing a colour, TD,
  size or layer setting rebuilds the model by itself; until it has, the old
  model is greyed out and can't be saved. A change made mid-build is built
  straight after instead of being lost. A rough colour match now says which
  colour would help. HEIC photos get a clear message.
- **Filament colours are asked for every 30 s** as well as pushed, after
  U1 Print Hub found the U1 doesn't always push a touchscreen change.
- A raw `T4`-`T15` in a file now says to run the filament add-on's
  post-processor (multiACE rewrites them into `ACE_SWAP_HEAD`).
- The demo's idle printer (Garage) now has the sample files' colours
  loaded, so the demo tour can really start a print.

### Fixed
- Panels that refresh every 5 s (print cost, dock rings, colour check,
  maintenance on Overview) no longer blink: their entrance animation played
  on every refresh, and the cost row could sit invisible mid-animation.
- **Add spool** cleared the form even when the server refused the spool;
  it now keeps what was typed and says why.
- Converted and studio files no longer offer "Convert" again.

### Not verified yet
Nothing here has run on a physical U1; the converter's output and studio
3MFs haven't been opened in Snapmaker Orca; Spoolman import hasn't met a
running Spoolman. See the status table in the README.

## Before this

The history before this changelog, in short (see `git log` for detail):

- **Real printer connection** - a Moonraker client written from Moonraker's,
  Klipper's and Snapmaker's U1 source, contract-tested over real sockets
  against a stand-in built from that source.
- **Flagship features** - fleet command center, Photo-to-Print Studio,
  auto-print pipeline, farm sandbox.
- **Dashboard screens** - fleet, live updates over WebSocket, files, G-code
  and 3D viewers, automations, phone layout, AR preview, low-latency camera.
- **Hardening** - safe saves, hidden secrets, stricter inputs, streamed
  model reading.
- **Liquid Glass** interface, the games tab, printer control, pairing,
  notifications, filament tracking, and the maintenance module it began with.
