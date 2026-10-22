# README images

Where every picture in the README and on the link previews comes from, and
how to make it again when the app changes. None of this is needed to run
Deja Vu1.

## Screenshots (`docs/img/*.jpg`, except `explainer-*`)

Older farm screenshots use demo data. Current slicing captures use local-engine
output estimates; none are physical-printer measurements. The validation record
below identifies their source. For farm captures:

1. Start the app on a spare port: `PORT=8791 python3 backend/app.py`.
2. Open `http://localhost:8791/?dashboard` in Chromium at 2x scale (Playwright
   `deviceScaleFactor: 2`), turn on **Demo data**, and dismiss the
   "Continue from your…" banner with its ✕ if it appears.
3. Capture each panel as its own element, then save as JPG, at most 1600 px
   wide (phone shots 760 px).

| File | What to open |
|---|---|
| `overview.jpg` | Overview: the top 640 px of a 1100 px-wide window at 1.45x (header, tabs, ribbon, tab sentence, Needs you) |
| `fleet.jpg` | Fleet: the "Your printers" card |
| `control.jpg` | Control: the whole tab |
| `files.jpg` | Files → Add sample files: library and queue |
| `file-detail.jpg` | Current workspace → Preview, using a verified local-engine result |
| `confirm-print-refused.jpg` | Files → `unsafe_example_purge_past_bed.gcode` → Print… |
| `automations.jpg` | Automations → "Tell me when a print finishes" |
| `care.jpg` | Care: the Maintenance card |
| `dock-rings.jpg` | The "Dock status rings" card (`#rings`) |
| `modules.jpg` | Settings: the Modules card |
| `photo-studio.jpg` | Photo studio → Try a test pattern |
| `twin-health-chamber.jpg` | Overview: the twin row (`.now-row`: 3D model, Printer control, Print health), printer U1 · Workshop; hide `.topbar` and `.live-pill` first so they don't overlap |
| `skip-object.jpg` | Control: the "Objects on the plate" card, with one object picked |
| `twin-detail.jpg` | Overview: the digital twin (`#twin-card`) in 3D model mode, the T0 chip clicked so its details show |
| `layer-planner.jpg` | Files: the Mixed-nozzle planner (`#tab-layerplan`) → Try a mixed-nozzle example |
| `add-printer.jpg` | Fleet → Add a printer, with the address of a running `tests/fake_moonraker.py` stand-in, then Test |
| `converter.jpg` | Files → `sample_makerworld_three_plates.3mf` → Convert for Snapmaker U1: the report |
| `sandbox.jpg`, `sandbox-farm.jpg` | Fleet → farm sandbox: add 6 printers, load "Jam mid-print", step 660 s |
| `games.jpg` | Games → Pac-Man, before Start (the `#tab-games` card) |
| `appearance.jpg` | Settings → Appearance (`#appearance-card`) |
| `setup.jpg` | Set up & help → Continue: the full-screen "Make it yours" step, after moving the mouse across it |
| `phone.jpg` | Overview at 390 × 844 |

## The live GIF (`docs/img/live-jam.gif`)

Record the Overview (1100 × 640) with Playwright's `recordVideo`, and while it
records fire a jam on a printer that is printing, from inside the page so the
request is same-origin:

```js
fetch('/api/sandbox/fire?demo=1', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event: 'jam', printer: 'random-printing' }) })
```

Then convert, trimming the page load:

```bash
ffmpeg -ss 3 -t 8.5 -i video.webm -vf "crop=1100:560:0:0,fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" live-jam.gif
```

Reset the sandbox afterwards (`POST /api/sandbox/reset?demo=1`).

## Explainers and the social card

`boards.html` holds the five explainer boards (one `<section>` each) and
`card.html` the social card. The card's pictures are `img/twin.jpg` (the
digital twin card, captured like the screenshots above) and
`img/fleet-cards.jpg`. Every fact on them comes from the code: the
dock states from `backend/led_status.py`, the six checks from
`backend/print_gate.py`, the counts from the README tables and the test
runner. Change them when the code changes.

```bash
node tools/readme-images/render.js     # needs Playwright and a Chromium
```

It writes PNGs into `tools/readme-images/out/` (ignored by git). Resize the
boards to 1600 px wide and save as JPG quality 90 into `docs/img/` with
these names: `b-problem` → `explainer-silent-docks.jpg`, `b-confirm` →
`explainer-confirm-print.jpg`, `b-arch` → `explainer-how-it-connects.jpg`,
`b-features` → `explainer-whats-in-it.jpg`, `b-numbers` →
`explainer-by-the-numbers.jpg`. Copy `card-1200x630.png` to
`frontend/img/social-card.png` (the link-preview test checks its size); the
1280 × 640 card is for GitHub's Settings → Social preview.

Before using a new card or board, check its palette with any colour-blind
simulator: the six feature-group colours were chosen so neighbouring groups
stay apart for the common kinds of colour blindness, and every group is also
named in text.

## Current captures and evidence

- `docs/img/slicer-before-*` and `slicer-after-*`: inspected 1366/390 viewport
  comparisons for preparation, tool setup and layer preview. Process captures
  cover both widths; recovery has a desktop capture.
- `file-detail.jpg`: current sliced-plate inspection. Slice time/grams are engine
  estimates, not physical measurements.
- `docs/img/slicer-static-demo-*` and `slicer-preview.gif`: actual browser
  interactions using recorded, simulated files.
- `setup-phone.png`, `launch-overview.png`, `launch-phone.png` and `native-*`:
  earlier setup/studio captures, retained as historical comparisons.

The boards and social card were refreshed, including the **759-test** count.
Both **75-second** launch-video cuts were rebuilt (version 12). Older editorial
feature crops still need updating. Do not label the whole media library current.

[Workspace validation](../../docs/slicer-workspace-validation.md) records engine,
browser, recovery and performance evidence, including rendering regressions.
Use viewport screenshots for fixed/sticky controls and inspect the images.

```bash
node tools/check-static-demo.js /tmp/dejavu-evidence
```

This checks the recorded demo from disk without an app server and captures
layer-scrub frames. `tools/check-slicer-workspace.js` instead needs a dedicated
local fixture app and configured engine. Keep recording/browser servers stopped
while running `python3 -m unittest discover tests`. Media tools require Node,
Playwright and Chromium; these are not app runtime dependencies.
