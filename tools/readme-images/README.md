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

`capture-round-five.js` retakes `fleet`, `farm-desk`, `telemetry`, `twin-health-chamber`,
`twin-detail`, `overview`, `phone`, `tour` and `confirm-print-refused` (the demo printers' new
names and the nine-stop tour) and adds `phone-connect` and `help-note`.

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
| `twin-health-chamber.jpg` | Overview: the twin row (`.now-row`: 3D model, Printer control, Print health), printer Demo printer 1; hide `.topbar` and `.live-pill` first so they don't overlap |
| `skip-object.jpg` | Control: the "Objects on the plate" card, with one object picked |
| `twin-detail.jpg` | Overview: the digital twin (`#twin-card`) in 3D model mode, the T0 chip clicked so its details show |
| `layer-planner.jpg` | Files: the Layer stack card (`.lp-card`) → Try a detail + speed example (`capture-round-four.js`) |
| `add-printer.jpg` | Fleet → Add a printer, with the address of a running `tests/fake_moonraker.py` stand-in, then Test |
| `converter.jpg` | Files: the converter card (`#convert-card`) → Try the 3-plate MakerWorld sample, with its report (`capture-round-four.js`) |
| `farm-desk.jpg`, `telemetry.jpg`, `process-settings.jpg` | Printers → Farm desk (`#tab-desk`, three files queued); Overview → Telemetry (`#telemetry`); Files → Process profile → Find installed U1 profiles → Speed tab (`#np-settings`). All made by `capture-round-four.js` |
| `sandbox.jpg`, `sandbox-farm.jpg` | Fleet → farm sandbox: add 6 printers, load "Jam mid-print", step 660 s |
| `games.jpg` | Games → Pac-Man, before Start (the `#tab-games` card) |
| `appearance.jpg` | Settings → Appearance (`#appearance-card`) |
| `twin-drawing.jpg` | Overview twin → T0 chip → Drawing, Angled (`#twin-card`); launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader` in the sandbox |
| `setup.jpg` | Set up & help → Continue: the full-screen "Make it yours" step, after moving the mouse across it |
| `version-history.jpg` | Settings → Version & updates (`#version-card`), with the server started through `start.py` so it reads as a launcher copy; 800 px wide at 2x in a 2600 px tall window (no scrolling, so the sticky bar stays clear), Update with a command opened; the floating orb, live pill and handoff bar hidden; cropped to the top 1640 px |
| `desktop-app.jpg` | Settings → Desktop app (`#desktop-card`), floating pieces hidden |
| `whats-new.jpg` | `Versions.tour('0.8.0')`: the opening card, 800 × 900 at 2x |
| `tour.jpg` | `Guide.everything({ startAt: 2 })`: the quick tour's 3D twin stop (its glass callout and beacon), 1280 × 860 at 2x (`capture-round-five.js`) |
| `help-note.jpg` | Overview → the ⓘ on the Digital twin card, with its word “heads” opened (`capture-round-five.js`) |
| `phone-connect.jpg` | Overview → Connect your phone: the sheet with its QR code, opened under the example address `http://192.168.1.23:8000` rerouted to the local app (`capture-round-five.js`) |
| `orb.jpg` | Three example messages sent with `toast()` on the Overview; the bottom-right 420 × 400 of an 800 × 760 window at 2x. Use truthful example wording (no versions that don't exist) |
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
`card.html` the share-card entry point. It opens the fleet campaign composition,
using `img/fleet-cards.jpg` and `img/brand-loop.png`. The latter is conceptual
brand art; it is not hardware evidence. Every fact on them comes from the code: the
dock states from `backend/led_status.py`, the seven checks from
`backend/print_gate.py`, the counts from the README tables and the test
runner. Change them when the code changes.

```bash
node tools/readme-images/render.js     # needs Playwright and a Chromium
```

It writes PNGs and 1600 px-wide, quality-90 JPG boards into
`tools/readme-images/out/` (ignored by git). `sync.py` copies the boards into `docs/img/` with
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

The current boards use the **904-case** suite count (By the numbers re-rendered 26 October 2026, version 0.11.0). The October marketing
refresh recaptures the main editorial images and supplies a separate campaign
pack. Versioned films and historical engine screenshots keep their original
provenance; the library index identifies what is current.

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

## October 2026 marketing refresh

Use the actual app on an isolated simulated farm for product imagery:

```bash
node tools/readme-images/capture.js
python3 tools/readme-images/sync.py --sources
node tools/readme-images/render.js
python3 tools/readme-images/sync.py
node tools/readme-images/check-marketing.js /tmp/dejavu-marketing-review
node tools/check-static-demo.js /tmp/dejavu-static-review
```

`capture.js` creates a temporary data folder, starts its own app server, and
closes the browser/server on completion. It adds no real printer, never uses the
owner’s app-data folder, and writes `out/captures/`. The sample conversion,
refusal, test-pattern preview and sandbox scenario are actual UI interactions.
Element captures hide the unrelated sticky header; viewport captures retain the
normal layout. Phone images are browser viewports, not physical-phone evidence.

Copy editorial JPGs to matching names in `docs/img/` and `marketing-library/`.
The current 3D/front/top/phone twin views go in `04-digital-twin/`; the other
editorial captures go in `03-screenshots/`. Copy `overview.jpg`, `fleet.jpg`,
`phone.jpg`, `twin-3d-printing.jpg` (as `twin.jpg`) and `twin-drawing.jpg` into
`frontend/img/`. The workspace image is the preserved
`docs/img/slicer-after-workspace-1366.png`, copied to `frontend/img/workspace.png`;
keep its historical Linux-validation caption. Copy `twin-model.jpg` as
`tools/readme-images/img/twin.jpg` for the twin campaign. Fleet and attention
compositions use `fleet-cards.jpg` and `needs-you.jpg` beside it.

The renderer also makes six subjects in landscape, square, portrait and native horizontal-feed formats.
Its source is `campaign.json`; `campaign.html`, `campaign.css` and `campaign.js` typeset that content, and
`render.js` checks bounds and missing images at each output size. Copy the 24
PNGs and `campaign-manifest.json` (as `captions.json`) into
`marketing-library/09-current-campaign/`. Each manifest entry supplies the
format, caption, text alternative and evidence limits. Inspect the final files;
bounds checks do not establish good composition or accessibility.

`sync.py` performs these copies, merges the capture records and writes
`marketing-library/current-assets.json` with byte sizes and SHA-256 hashes.
Run it after rendering; keep capture and render output together until it completes.

The core app still requires no media packages. These authoring tools require
Node, Playwright and Chromium; the copy script uses Python’s standard library.
Boards render directly at 1600 px and quality 90. Share images
remain PNG at their native sizes. Preserve versioned films and their music
notices. Use the campaign pack for current standalone images, rather than
silently relabelling old video stills.


### Art-directed campaign follow-up

`campaign.css` and `campaign.js` now provide six distinct compositions. Run
`node tools/readme-images/render.js --campaign` to render only share/campaign
assets, then `python3 tools/readme-images/sync.py` to update the shipped copies.
The renderer also checks authored text palette pairs, evidence/action overlap
and the reviewed 5 MB feed limit. Inspect actual images and reduced-size previews;
these checks do not certify every screenshot pixel or marketing effectiveness.

`img/brand-loop.png` is AI-generated conceptual brand artwork. Its original is
retained in the workspace’s generated-images folder. It is deliberately separate
from actual app screenshots and is never evidence of a physical print or add-on.
Captions and README explain that distinction. The artwork is bundled into the
PNG share/campaign exports; the product page does not download the large source.
See `marketing-library/AD-GUIDE.md` for message and placement choices and
`docs/copy-review.md` for the exact scope of wording changes.
