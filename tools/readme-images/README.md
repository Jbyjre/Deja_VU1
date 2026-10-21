# README images

Where every picture in the README and on the link previews comes from, and
how to make it again when the app changes. None of this is needed to run
Deja Vu1.

## Screenshots (`docs/img/*.jpg`, except `explainer-*`)

Captured from the real app in demo mode, so every figure in them is
simulated:

1. Start the app on a spare port: `PORT=8791 python3 backend/app.py`.
2. Open `http://localhost:8791/?dashboard` in Chromium at 2x scale (Playwright
   `deviceScaleFactor: 2`), turn on **Demo data**, and dismiss the
   "Continue from your…" banner with its ✕ if it appears.
3. Capture each panel as its own element, then save as JPG, at most 1600 px
   wide (phone shots 760 px).

| File | What to open |
|---|---|
| `overview.jpg` | Overview: header, status ribbon, Needs you, totals |
| `fleet.jpg` | Fleet: the "Your printers" card |
| `control.jpg` | Control: the whole tab |
| `files.jpg` | Files → Add sample files: library and queue |
| `file-detail.jpg` | Files → `two_colour_coaster.gcode` |
| `confirm-print-refused.jpg` | Files → `unsafe_example_purge_past_bed.gcode` → Print… |
| `automations.jpg` | Automations → "Tell me when a print finishes" |
| `care.jpg` | Care: the Maintenance card |
| `dock-rings.jpg` | The "Dock status rings" card (`#rings`) |
| `modules.jpg` | Settings: the Modules card |
| `photo-studio.jpg` | Photo studio → Try a test pattern |
| `twin-health-chamber.jpg` | Overview: the digital twin row (`.live-row`), printer U1 · Workshop |
| `skip-object.jpg` | Control: the "Objects on the plate" card, with one object picked |
| `twin-detail.jpg` | Overview: the digital twin (`#twin-card`), T0's balloon clicked so its details show |
| `layer-planner.jpg` | Files: the Mixed-nozzle planner (`#tab-layerplan`) → Try a mixed-nozzle example |
| `add-printer.jpg` | Fleet → Add a printer, with the address of a running `tests/fake_moonraker.py` stand-in, then Test |
| `converter.jpg` | Files → `sample_makerworld_three_plates.3mf` → Convert for Snapmaker U1: the report |
| `sandbox.jpg`, `sandbox-farm.jpg` | Fleet → farm sandbox: add 6 printers, load "Jam mid-print", step 660 s |
| `games.jpg` | Games |
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

## Launch-readiness captures

`docs/img/setup-phone.png`, `launch-overview.png` and `launch-phone.png` show the
current setup/navigation. Browser checks in `tools/check-launch-ui.js` also
capture before/after evidence into a caller-chosen folder; private reports belong
outside this repository. The numbers board was rerendered for 732 tests.
Existing feature crops, social card, animated GIF and launch videos still need
an editorial pass before claiming all media shows the latest interface.

## Native studio captures

`docs/img/native-*.png` holds inspected 1366 px and 390 px viewport captures,
including before/after viewer, profile setup and image workspaces, four tools
and the G-code layer inspector. See `docs/native-studio-validation.md` for their
context and the real-engine limits. Rerender feature/number boards with the
current test count. Older promotional crops/GIF/video timelines still require
an editorial pass; the owner’s launch cuts remain 75 seconds.
