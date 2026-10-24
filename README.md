# Deja Vu1

**One screen for every U1 you run.** Deja Vu1 is a free, open-source dashboard
and model-preparation workspace for Snapmaker U1 printers. Monitor a fleet,
prepare plates, slice with an independently installed engine, inspect G-code,
and review server-enforced checks before starting a print. It runs on your own
network without an app account. The core app needs only Python; slicing and
optional integrations have separate requirements.

![Deja Vu1: "One screen for every U1 you run." beside the live engineering drawing of a printing U1 and three printer cards from the simulated farm](frontend/img/social-card.png)

<sub>Every figure in the picture comes from the built-in simulated farm.</sub>

### Watch the 60-second launch film

[![Deja Vu1 launch film (V1, 60 seconds, 16:9): "Run your 3D printers from one screen." Click to watch.](docs/img/launch-video-v1.jpg)](https://deja-vu1.jmath1110.workers.dev/#film)

<sub>Click the picture to watch it on the product page, or
[download the full-quality MP4](marketing-library/07-videos/deja-vu1-launch-v1-60s-16x9.mp4)
(49 MB). Filmed on the simulated farm; the vertical 9:16 cut and the other
versions are in [`marketing-library/07-videos/`](marketing-library/07-videos/).</sub>

> **Looking for U1 owners.** Deja Vu1 has never talked to a real U1. If you own
> one and can spare 30 to 45 minutes, help run its first real connection. It's
> watch-only: you watch a print you're already running, and nothing is started
> or paused from Deja Vu1. **[How it works, and how to sign up](docs/first-connection.md)**

**See it first, with nothing to install:** the
[online demo](https://deja-vu1.jmath1110.workers.dev/?demo) opens the real
dashboard in your browser, playing a 2.5-minute recording of the simulated
farm (three U1s; one jams halfway). Click around: the digital twin, Files,
the mixed-nozzle planner and Photo Studio all work there; anything that would
change a printer says it's a recording.

## How it works

```text
Your phone browser ── home Wi-Fi ── your computer running Deja Vu1
                                                │
                                           home network
                                                │
                                           your U1 printer
```

**On my computer:** install Python 3.8+, download and extract the ZIP, then
open the launcher for Windows, Mac or Linux. Keep its window open and the
computer awake. **Set up & help** can find and test your printer.

**On my phone at home:** use the same Wi-Fi and open the computer's **From a
phone** address, such as `http://192.168.1.20:8000`. Turn demo data off and
select your real printer. Pairing is optional, not a login. Add to Home Screen
may be a shortcut over HTTP; full PWA installation and offline support need a
secure address. Offline mode never shows saved readings or sends commands.

**On my phone away from home:** use a private Tailscale connection with Serve,
or a Cloudflare tunnel protected by Access before exposing it. There is no
app login. Do not forward port 8000 on your router.

[Exact computer, phone and firewall steps](docs/getting-started.md) ·
[Private remote access](docs/remote-access.md)

**Try it in three lines** (Python 3.8 or newer; the first line needs git, or
use GitHub's **Code → Download ZIP** instead):

```bash
git clone https://github.com/Jbyjre/Deja_VU1.git
cd Deja_VU1
python3 start.py
```

Then open **http://localhost:8000** and flip **Demo data** in the header for a
simulated farm of three U1s that heat, print and finish.

![The simulated farm, live: a filament jam is fired from the farm sandbox, the status ribbon turns to an error and the jam goes to the top of the Needs you list](docs/img/live-jam.gif)

<sub>Live, on the simulated farm: a filament jam fired from the farm sandbox. The status ribbon turns to an error, a "print failed" alert appears, and the jam goes to the top of **Needs you**.</sub>

**Quick links:** [getting started](docs/getting-started.md) · [run it](#how-to-run-it) · [what's in it](#whats-in-it) ·
[how it connects](#why-one-dashboard-not-several-tools) · [current status](#current-status) ·
[current slicer evidence and pictures](docs/slicer-workspace-validation.md) ·
[security](#security-and-your-network) · [first connection](docs/first-connection.md) ·
[for developers](#for-developers-and-ai-coding-sessions)

The dashboard supports up to 12 printers through Moonraker, the printer's web
API. Shared live state feeds controls, alerts, maintenance, filament tracking,
queues and the engineering drawing. Optional integrations connect to ntfy,
Discord, Telegram, Home Assistant, WLED and Spoolman. A labelled simulated farm
lets you explore without a printer. See [current status](#current-status) for
what was tested and what still needs physical hardware.

Much of the code is written with [Claude Code](https://claude.com/claude-code),
and every change is in the public history.

## What's new

- **The print itself, in its real colours, inside the 3D twin:** the twin now reads the
  file being printed (downloaded from the printer, or from your file library) and grows the
  outside walls of every layer up to the one being printed, each in the colour loaded in the
  head that prints it; the rest of the print shows faintly above. A new **Print** view closes
  in on the plate. The demo's Workshop printer now prints two 3DBenchy boats in two colours,
  orange hull and black cabin and the reverse, swapping heads on every layer.
- **Take the case off:** the 3D model has a Case on / See-through / Case off switch. With the
  case off you see the frame, the CoreXY motors, belts and idlers and the Z lead screw (drawn
  where they must be, sizes estimated and labelled so), plus options for the print, what's
  left of it, head labels and a slow turntable.
- **A real engineering drawing sheet:** a zoned border, numbered balloons with leader lines
  and a parts list, notes, the plate's centre lines, the print's height so far against its
  full height, the print washed in its filament colours, and a full title block (drawing
  number, sheet, units, date, third-angle projection symbol).
- **A 3D viewer that looks like a slicer, not a grid:** a real 276 × 293 mm textured plate
  with a fine grid on it only, a soft studio backdrop, a contact shadow and proper lighting.
- **Mixed layer heights, rebuilt around what you want:** one question first (finest detail,
  balanced, fastest or one height), each answer previewing what it sets on every head; then
  each head in a plain sentence with Thinner and Thicker buttons. The expert controls wait
  under Fine-tune.
- **Updates from inside the app:** choose Newest builds and Deja Vu1 compares every file with
  GitHub, downloads only what changed, checks each file against GitHub's own record of it,
  and restarts into the new version (rolling back if it fails to start). Automatic checks
  every 15 minutes, and optional automatic install while every printer is idle.
- **It never forgets:** every record keeps its last good copy, a damaged file repairs itself,
  and safety copies of everything the dashboard remembers are made every 6 hours, at start-up
  and before every update, restorable from Settings (a restore can itself be undone).
- **Pick up where you left off:** Files finds Snapmaker Orca or OrcaSlicer on this computer,
  copies your recent projects in and turns your own presets into a slicing profile.
- **What your history says:** Overview reads the printer's own print history (a real U1 brings
  everything it has printed) into findings that only appear with enough prints behind them.
- **An optional device lock:** only paired devices can use the dashboard; this computer
  always can.
- **Check it yourself:** Settings → About runs nine real checks inside your own copy in a few
  seconds, and lists what Deja Vu1 builds on (see also [CREDITS.md](CREDITS.md)).
- **Smaller and fixed:** the games load only when you open them (they were two thirds of the
  dashboard script); Snapmaker Orca is found by itself for slicing; a printer that needs an API
  key says how to fix it; a heater fault shows on its own dock ring; and a printer stopped with
  an error can be recovered with Restart firmware.
- **The real 3DBenchy in the sample files:** "Add sample files" now gives the actual
  3DBenchy (public domain since February 2025), a 24-tooth involute gear and a twisted
  vase instead of cubes and an L-bracket, with G-code cut from those models layer by
  layer: a 240-layer Benchy, a Benchy + gear + vase plate whose objects can be skipped
  one by one, and a three-colour coaster that changes heads on every top layer. The
  Bambu, Elegoo and MakerWorld project samples carry the same models.
- **Mixed layer heights you can read at a glance:** one shared fine layer, and each head
  prints a whole number of fine layers per pass. It shows the range your nozzles allow,
  greys out what a nozzle can't print with the reason, and draws a side cut of the passes.
- **106 OrcaSlicer process settings:** the profile editor is laid out like Orca's own tabs
  (Quality, Strength, Speed, Support, Others) with line widths, seams and scarf seams,
  ironing, wall generator, 18 infill patterns, overhang speeds, accelerations, jerk, support
  styles and interfaces, raft, skirt, brim, prime tower, spiral vase, fuzzy skin and object
  labels. Every name and choice was checked against OrcaSlicer's option table. Blank means
  "use the preset"; changed settings are marked, each can be reset, and a finder and a
  Simple/Advanced switch keep it manageable.
- **A Farm desk for planning the day** (Printers): a 24-hour dispatch timeline across every
  printer (your hours shaded, finishes that wait for you marked), the best printer for a
  file (material first, colour second, then when it's free), what each idle printer can
  print right now, a filament outlook for everything queued, and "worth printing?" (cost per
  piece and earnings per printer hour, reading `x24` in a file name as 24 pieces).
<img src="docs/img/farm-desk.jpg" alt="The Farm desk: a 24-hour dispatch timeline for three simulated printers with queued jobs, your hours shaded and overnight finishes marked as waiting, and below it Best printer for a file, Print right now, Filament outlook and Worth printing">

<img src="docs/img/telemetry.jpg" width="49%" alt="The Telemetry panel: state, file, layer, Z, progress, elapsed, remaining and finish time, bed and chamber against target, and a row per toolhead with temperature against target, a trace, filament, nozzle and swap counters"> <img src="docs/img/process-settings.jpg" width="49%" alt="The process settings editor in OrcaSlicer's layout: Quality, Strength, Speed, Support and Others tabs, a setting finder, Simple and Advanced, and the Speed tab's first-layer, per-feature, overhang and acceleration settings">

- **Telemetry and a logbook:** a dense live readout on the Overview (every head's temperature
  against target with a trace, filament, nozzle and swap counters; bed, chamber, position,
  layer and timing), and a per-printer logbook in Care (problems, fixes and print hours,
  searchable; reported failures are logged by themselves). Real printers' cards link to the
  printer's own web page.
- **Bambu Studio / MakerWorld to U1, front and centre:** a converter card at the top of Files
  (choose a .3mf or try the three-plate MakerWorld sample; the report appears right there).
- **A search that finds things:** Ctrl/Cmd+K or `/` opens a finder over every screen, setting,
  action, printer and file, typo-tolerant, keyboard-driven, with recent picks.
- **A more truthful twin and a working online demo:** parked heads now sit inside the chamber
  as on the real machine, the screen sits above the door, and the window shows the lit
  chamber. In the [online demo](https://deja-vu1.jmath1110.workers.dev/?demo) the print
  controls, skip-object, temperatures, console, queueing, the logbook and the converter now
  work in a simulation inside your browser, and the simulated heaters hold temperature with a
  real heater's small ripple.
- **The launch film on the front page:** the 60-second V1 film (16:9) opens the
  [product page](https://deja-vu1.jmath1110.workers.dev/#film) and the top of this README.
- **A realistic 3D model of your U1:** the Overview's digital twin is now a detailed
  model of the actual machine, built from Snapmaker's official product picture and
  published figures: the white rounded body and black rim, the smoked-glass door,
  the live touchscreen, the side oval with its spool drums and feeder, the black
  toolheads with yellow accents in the rear docks with their tall tube loops, and a
  276 × 293 mm textured PEI plate. Studio lighting, reflections and soft shadows;
  the head, bed, docked heads, spool colours, screen and print all follow the
  printer live. Drag to turn (it glides to a stop), scroll to zoom, click any head,
  spool or the bed. The body's own size and the inside layout are estimates, and
  the card says so.
- **A drawing made from the same model:** the Drawing mode is now an engineering
  drawing of that geometry (ink edges, front/top/angled views, live dimensions,
  balloons, a title block), with "Show the case" and a PNG download.
- **A livelier background, with surprises:** Dots is the default, and it parts,
  swirls and lights up around your cursor. New: Constellation, a Time of day colour
  set and a Reaction setting (Gentle, Lively, Wild). "Little surprises" hides a few
  things to find: try clicking an empty part of the page, and watch it on the hour.
  While a print runs, the dots fill from the bottom as far as the print has got.
  With the mouse moving, Dots measured 16.7 ms per frame in headless Chromium
  (software rendering; not a real-device measurement).
- **Games that play properly:** Pac-Man, Tetris, Snake and Sky Dash were rebuilt.
  Every game now runs on a steady clock that matches the screen, waits for you to
  press Start, pauses when you switch away, and fits the window so the whole
  field is visible.
- **Clearer for a first visit:** full-screen setup with a step-by-step progress
  bar and a "Make it yours" step, one plain sentence under the tab bar saying what
  each tab is for, a reorganised Overview, and jump links at the top of Settings.

- **One workspace:** prepare objects, edit profiles and physical T0–T3 assignments,
  slice, then inspect the output beside direct layer navigation, visibility
  controls and tool/speed/feature legends. Desktop and phone layouts were checked.
- **Different preferred heights per head:** a capable external Linux engine
  produced verified 0.14/0.28, 0.2/0.4 and 0.1/0.2 mm deposition steps. Unsupported
  engines and incompatible combinations are refused. Physical printing remains
  unverified; first layers and some features can use finer steps.
- **Select one project plate:** source-preserving separation resolves the former
  three-plate fixture failure; all three selected plates passed actual slicing.
- **Full app-data recovery:** preview a versioned backup, validate its checksums
  and restore into a separate copy with automatic actions disabled. External
  engines and presets need separate protection. [Recovery guide](docs/backup-and-recovery.md).
- **Process-bound colour recipes:** measured-swatch recipes track materials,
  temperature, flow, cooling, backing and layer order. Changed conditions invalidate
  tracked recipes. Four-tool colour tiles, layered fixtures and closed image
  reliefs passed the real engine; physical colour accuracy remains unverified.
- **More dependable preparation:** validated process/material overrides, actual
  per-object wall settings, cancellable slice jobs, stale-printer protection and
  explicit spool assignments. Blocked output stays inspectable and is never
  automatically queued.

<img src="docs/img/twin-detail.jpg" width="49%" alt="The 3D twin of the U1: a white rounded body with a black rim, the smoked-glass door and touchscreen, an orange and a black spool on the side drums, four black toolheads with yellow accents and tall tube loops, T0 picked and glowing blue, and its details panel below"> <img src="docs/img/twin-drawing.jpg" width="49%" alt="The twin's Drawing mode: an engineering drawing of the gantry, docked heads, bed and Z column, with the build volume as a dash-dot line, a Z dimension, balloons T0 to T3 and a title block">

<img src="docs/img/setup.jpg" width="49%" alt="Full-screen setup on step 2, Make it yours: a progress bar of six named steps, the five background styles and six colour sets"> <img src="docs/img/appearance.jpg" width="49%" alt="Settings, Appearance: background styles, colour sets, Reaction (Gentle, Lively, Wild), Little surprises, and the accent colour">

[Engine setup and format limits](docs/slicing-and-models.md) ·
[Validation, performance and screenshots](docs/slicer-workspace-validation.md) ·
[Change history](CHANGELOG.md)

![The preparation workspace with two physical-tool assignments](docs/img/slicer-after-workspace-1366.png)

## Why it exists

You walk over to the printer to answer the same four questions. The printer
already publishes every answer; Deja Vu1 reads them for every U1 you run.

**Is it still printing?** Every printer updates four times a second, and
**Needs you** ranks what wants a person across the whole farm: a jam, a paused
print, a finished plate, an idle printer with work waiting. Automations send
it to your phone.

**Will this file print on a U1?** The pre-flight check flags extrusion outside
the 270 × 270 × 270 mm build volume, unknown toolheads and unsafe
temperatures, with line numbers. MakerWorld, NexPrint and OrcaSlicer projects
convert for the U1 in one click.

**Is the right filament loaded?** Four toolheads mean four chances to load the
wrong spool. Deja Vu1 compares the colour each toolhead was sliced for with
what the printer reports, and stops the start on a mismatch.

**Is it safe to press print?** Confirm Print pulls it together: pre-flight,
filament match, nozzles, spool weight, maintenance, time, grams and cost. The server
checks again at the moment of starting and refuses in words if something
changed, even when you start from your phone.

## What's in it

![Every feature grouped by what it needs: 19 for running the farm and printing safely, 8 for care, control and the basics, 3 for farms and making, 7 optional, 2 waiting on hardware, and 10 games](docs/img/explainer-whats-in-it.jpg)

Farm screenshots use **Demo data**. The current slice-preview capture contains
actual engine estimates, not physical measurements. Older feature crops predate
the current workspace; see [paired captures](docs/slicer-workspace-validation.md).

### Run the farm and check prints: no add-on hardware needed

| Feature | What it does |
|---|---|
| **Printer fleet** | **Find printers on my network** adds a U1 without typing an address (it asks the network, then tries Moonraker's port on your home network, and checks each one); **Test** checks a typed address first. Every printer at a glance — state, progress, the filament in each dock, temperatures, alerts, a health score — and one tap points the whole dashboard (maintenance, control, cost, queue, everything) at any of them. |
| **Live updates** | The live loop targets 250 ms updates, subject to printer and network response, pushed to the browser over a WebSocket written from scratch in standard-library Python. If the WebSocket fails three times (a network that blocks it, or a server restart), the dashboard asks once a second instead, says so, and tries the WebSocket again every 30 seconds. |
| **Needs you** | The top of the Overview ranks every printer by what wants a person — a fault the printer reported, a paused or finished print, an idle printer with files waiting, overdue maintenance, a print finishing within 15 minutes — each with a button straight to the right tab. When nothing does, it says so, with how many are printing and when the next one finishes. |
| **Start a print from your phone** | Pick a file, read one Confirm Print summary — pre-flight check, filament match, spool weight, maintenance, time, grams and cost — and start it. The server re-checks at the moment of starting and **refuses** if something is wrong. |
| **Pre-flight risk check** | Flags extrusion outside the U1's 270 × 270 × 270 mm volume, the nozzle below the bed, unknown toolheads, unsafe temperatures, travel moves below plastic already printed, and more — with line numbers. A file still numbering a filament add-on's extra slots (multiACE's T4–T15) is told to run that add-on's post-processor first; its rewritten file passes. |
| **Mixed-nozzle planner** | Calculates a common grid and checks preferred heights against U1 nozzle limits. It does not slice. The workspace separately sends validated preferences to a capable engine; Confirm Print checks fitted nozzles. |
| **MakerWorld / NexPrint / OrcaSlicer → U1** | Converts supported projects for the U1 while retaining source settings and colours. Multi-plate layouts use the U1 grid; select and separate one plate for local slicing. Failures include a reason and copyable report. Complete vendor extension/texture fidelity is not guaranteed. |
| **Skip one object** | When one part on a full plate fails, skip just that one and let the rest finish (Klipper's `exclude_object`, which Snapmaker's U1 profiles switch on). The Control tab draws the plate from above like a drawing sheet: each part outlined with a numbered balloon that matches the list, the one printing now in blue, skipped ones section-hatched, the bed dimensioned. Pick one, confirm, and only that one stops. |
| **Print queue** | Files to print one after another. Each one passes the same Confirm Print check before it starts; anything that doesn't pass waits, with the reason. |
| **Automations** | Local rules: a temperature crosses a line, a print starts / pauses / finishes / fails, the wrong filament is loaded, maintenance is overdue → send a notification, set a WLED light, set a Home Assistant sensor, or pause the print. Every firing is logged with what really happened. |
| **Digital twin** | Two ways to see each printer, live, both from one detailed model of the U1 (from Snapmaker's official product picture and published figures; the body's own size and inside layout estimated). **3D model:** studio-lit and realistic, with the head on the gantry, the bed dropping as Z rises, idle heads in the rear docks, the spools in their loaded colours, the touchscreen showing the printer's state and the print growing on the bed; drag to turn, right-drag to move, scroll or +/− to zoom. **Engineering drawing:** made from the same geometry and drawn the drafting way: one ink, hidden edges dashed, the build volume as a phantom line, real dimensions and a title block with its scale. The bed drops as each layer is added, the toolhead and gantry move, the parts on the plate come from the file's own object outlines (a skipped one is crossed out), and the four rear docks carry balloons with each head's filament. **Click a toolhead** for its temperature, filament, nozzle size, lifetime swaps, retries and failures (from the U1's firmware) and what the running print needs from it; click a part for its size and a shortcut to skip it; click the bed for its temperature and height. Angled, front and top views in both modes; the drawing can show the case with its estimated size and downloads as a PNG picture (an SVG line drawing is used where WebGL 2 isn't available). |
| **File library** | G-code, 3MF, STL and triangular OBJ files, with available thumbnails, estimates, pre-flight results and recent files. Missing time or filament metadata stays unknown. |
| **Prepare and preview** | Edit multi-object STL/OBJ/3MF plates, save a new source-preserving 3MF, slice through an installed engine and inspect its G-code by layer. Plain WebGL; no 3D library. Complex paint/textures remain limited. |
| **G-code viewer + small edits** | Read the file line by line, search it, change one number, comment a line out or insert one command, each edit validated first (no emergency-stop lines, no toolheads the U1 doesn't have), the original kept, the pre-flight re-run. |
| **Honest controls** | Every button says what it's sending straight away ("Pausing…"), then shows only what the printer actually reports back. A command the printer refuses is shown as refused, in words, never as done. |
| **Finish time on the clock** | Alongside "2 h 17 min left", every running print says when it will finish ("done 2:42 PM", "tomorrow 1:05 AM") on the status ribbon, the fleet cards and the live pill, from the same estimate. |
| **The browser tab follows the print** | The page title mirrors the selected printer, "53% · U1 · Workshop · Deja Vu1" (or Paused, Finished, Needs attention), and the tab's icon draws the progress ring, so a background tab still tells you how it's going. |
| **View on your desk (AR)** | Places an STL or 3MF model on your real desk at its real printed size, through the phone's camera. Works on Android/WebXR browsers; iOS Safari has no equivalent. The button only appears where AR is supported, and it needs an `https://` address, such as the Cloudflare Tunnel. See [docs/ar-preview.md](docs/ar-preview.md). |
| **Print health gauge, chamber climate, time-lapse flipbook, celebration card, "continue on another device", calibration reminder after a nozzle swap, weight-based filament forecast, side-by-side settings diff, 28 Home Assistant sensors, MJPEG camera relay** | The supporting cast, see [docs/architecture.md](docs/architecture.md). |

![The Overview: header with the printer picker and SIMULATED badge, the tab bar with Overview first, the status ribbon with progress and finish time, a one-line explanation of the Overview tab, and the Needs you list ranking a dock error, a paused print and overdue maintenance](docs/img/overview.jpg)

<sub>**Overview:** the status ribbon with progress and finish time, then **Needs you**, ranking everything that wants a person across all three printers.</sub>

![The Fleet tab: three printer cards, Workshop printing at 47 percent, Studio paused at 72 percent, Garage idle with a T3 dock error, each with its four toolhead filament colours, temperatures and health score, above controls to command several printers together](docs/img/fleet.jpg)

<sub>**Printers** (the Fleet view): every printer's state, progress, filament per dock, temperatures and health, with controls to command several at once.</sub>

![Confirm Print explained: seven checks (printer ready, pre-flight, filament match, nozzles, spool weight, maintenance, cost), what each one does when it fails, the path from your file to a start or a refusal, and a real refusal from the built-in unsafe example file](docs/img/explainer-confirm-print.jpg)

<table>
<tr>
<td width="50%" valign="top"><img src="docs/img/confirm-print-refused.jpg" alt="The Confirm print dialog refusing the unsafe example file: printer busy, extrusion outside the 270 mm build volume on line 19, T0 has Snapmaker Orange loaded but the file was sliced for a red, and two maintenance tasks overdue"><br><sub><b>Confirm Print, refusing:</b> the built-in unsafe example file, with every reason in words and the start button disabled.</sub></td>
<td width="50%" valign="top"><img src="docs/img/file-detail.jpg" alt="The unified sliced-plate preview, file-order layers, requested-speed colours, tool filters, event markers and real-engine estimates"><br><sub><b>A sliced plate:</b> inspect layers and toolpaths beside real-engine estimates, then open pre-flight and Confirm Print.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top"><img src="docs/img/files.jpg" alt="The file library with thumbnails of six sample files, the G-code ones marked PRE-FLIGHT CLEAR or BLOCKED, next to the print queue"><br><sub><b>Files:</b> thumbnails and estimates, a pre-flight badge on every G-code file, and the print queue beside them.</sub></td>
<td width="50%" valign="top"><img src="docs/img/automations.jpg" alt="The Automations tab building a rule from the "Tell me when a print finishes" example: when a print finishes, send a notification, on any printer, with a log of what fired"><br><sub><b>Automations:</b> "when this happens, do that", built from a ready-made example, with every firing logged.</sub></td>
</tr>
</table>

![The Overview's live row: the digital twin as a shaded 3D model of the U1 with its frame, glass panels, orange and black spools on the left side, blue parts on the bed and tagged heads T0 to T3 (T2 printing), beside Printer control with Pause and Cancel and a print health gauge reading 65](docs/img/twin-health-chamber.jpg)

<sub>**Digital twin, quick controls and print health:** a live 3D model of the printer (the bed dropping as layers build, the head moving, the parts on the plate, the four docks, the spools in their colours), Pause and Cancel, and one health score with every deduction listed. The engineering drawing is one click away.</sub>

<table>
<tr>
<td width="42%" valign="top"><img src="docs/img/twin-detail.jpg" alt="The 3D twin with T0 picked: its tag outlined, and a details panel with its filament, temperature, 0.4 mm nozzle, 215 swaps with 3 retried and 0 failed, and what the running print needs from it"><br><sub><b>Click a toolhead:</b> its nozzle, swaps and what this print needs from it.</sub></td>
<td width="58%" valign="top"><img src="docs/img/layer-planner.jpg" alt="The Layer stack: a 0.12 mm base layer, T0 and T1 with 0.4 mm nozzles printing every layer, T2 and T3 with 0.6 mm nozzles printing three base layers per pass at 0.36 mm, multiples a nozzle cannot print crossed out, a section of the passes and the Consistent, Adaptive and Fixed thick-layer modes"><br><sub><b>Layer stack:</b> one base layer, each head a whole multiple of it, with smart set-ups.</sub></td>
</tr>
</table>

![Add a printer: Find printers on my network, and a Test result saying Moonraker answered, Klipper is ready, it reports Snapmaker's U1 objects and has 4 toolheads](docs/img/add-printer.jpg)

<sub>**Add a printer:** find it on the network, or test a typed address before adding it.</sub>

![Objects on the plate: a map of the bed from above with three objects, the one printing now in blue and one selected in red, and the question "Skip Toolhead cover #3 for the rest of this print? It can't be brought back."](docs/img/skip-object.jpg)

<sub>**Skip one object:** pick the failed part on the plate map, confirm, and the rest keep printing.</sub>

<img align="right" width="300" src="docs/img/converter.jpg" alt="The converter card at the top of Files: Bambu Studio or MakerWorld project to Snapmaker U1, with the report for the three-plate MakerWorld sample: saved as a U1 copy, all three plates re-placed on the 270 mm bed and the creator's own changes kept">

**Converting a MakerWorld project:** every plate lands where Snapmaker Orca
expects it, the creator's own setting changes are kept and listed, and the
report says what wasn't checked yet (the result hasn't been opened in
Snapmaker Orca itself).

<br clear="right">

### Care, control and the basics: no add-on hardware needed

| Module | What it does |
|---|---|
| **Maintenance reminders** | Seven tasks. Six track cumulative hours, print counts or calendar time since they were last done (nozzle, bed, belts, rails, dock alignment, fans); the seventh, recalibration, comes due when you record a nozzle or hotend swap. Each resets when you mark it complete. For a real printer, counting starts from its totals on first connection. |
| **Printer control** | Pause, resume, cancel, set a toolhead's target temperature, home an axis, or send a raw G-code line, with a live console log. |
| **Push notifications** | Alerts via ntfy.sh, Discord, or Telegram, plain webhooks, no SDK, no account. They're sent by the rules you set in **Automations** (it offers ready-made ones such as "Tell me when a print finishes"). A rule marked urgent always sends; a normal one waits out your quiet hours instead of buzzing your phone at 3am. |
| **Update checker** | Reads Moonraker's own update-status API and flags when Klipper or Moonraker have an update waiting. |
| **App-data backup & recovery** | Versioned full app-data ZIP with checksums, omitted connection secrets and restore preview. Recovery creates a separate folder and launchers; it keeps existing data and disables automatic actions. Includes library, per-printer logs, fleet, queues, presets and time-lapse. Limits: 512 MB unpacked / 256 MB ZIP; files over 64 MB and external installations require an offline copy. |
| **Camera bridge** | Brings the printer's camera feed in, with a watchdog that flags a frozen stream instead of silently showing a stale image. |
| **Phone pairing** | A short one-time code, entered on a second browser, adds it to a paired-devices list, no account, no password, nothing that leaves your network. It's a convenience list, not a lock: see [security](#security-and-your-network). Always on. |
| **Print cost calculator** | Prices filament by material and adds electricity, for a print in progress and for recent history. $/kg per material, $/kWh and printer wattage are editable. |

<table>
<tr>
<td width="50%" valign="top"><img src="docs/img/care.jpg" alt="The Care tab: maintenance tasks with progress bars, two marked overdue in red and one due soon"><br><sub><b>Care:</b> each maintenance task with how far it has run, overdue ones in red.</sub></td>
<td width="50%" valign="top"><img src="docs/img/control.jpg" alt="The Control tab: the running print with Pause and Cancel, four toolhead temperatures, Home buttons and a G-code console"><br><sub><b>Control:</b> the running print, all four toolheads' temperatures, homing and a G-code console.</sub></td>
</tr>
</table>

### Running a farm, and making new things: no hardware needed

| Feature | What it does |
|---|---|
| **Fleet command center** | Tick several printers in the Printers tab and preheat, pause, resume, home or cancel them together. The commands go out in parallel through the same per-printer controls as everywhere else, and every printer's result is read back and listed separately ("Pause: 2 of 3 confirmed; failed on U1 · Garage", with each printer's reason, such as "Nothing is printing right now", in its own row), never a blanket "done". Drag a G-code file (or a waiting queue item) onto any printer to put it on that printer's queue. A farm history panel shows prints, completed vs. failed, and material per day or week, per printer and for the whole farm, summed from each printer's own history. |
| **Photo-to-Print Studio** | Make four-tool dithered tiles, measured-swatch layered models, calibration sheets and closed image-heightmap reliefs. The older absorption-based relief editor remains available. New generation sends a reduced pixel grid to the local app server; legacy relief calculation stays in the browser. Generated files enter the normal preparation/slicing workflow. Physical colour accuracy is unverified. |
| **Farm sandbox** | A simulated farm of up to 27 printers, with scripted scenarios (a jam mid-print, a runout, a heater fault, a network drop, the wrong filament loaded, maintenance going overdue) and a clock you can play, speed up, or step forward. Everything else in the dashboard (fleet, automations, queue, notifications, history) reacts, because the sandbox drives the same simulated printers they all read. Demo data only. |

<table>
<tr>
<td width="50%" valign="top"><img src="docs/img/sandbox-farm.jpg" alt="The Fleet tab with nine printers: the three built-in U1s and six added simulated printers, some printing, some idle"><br><sub><b>A bigger farm:</b> the three built-in printers plus six added in the sandbox.</sub></td>
<td width="50%" valign="top"><img src="docs/img/sandbox.jpg" alt="The farm sandbox: a scenario clock at plus 11 minutes running the "Jam mid-print" scenario, the farm list, an event picker and a log of what happened, with preset scenarios below"><br><sub><b>Farm sandbox:</b> the "Jam mid-print" scenario on its clock, one-off events, and a log of what happened.</sub></td>
</tr>
</table>

![The Photo-to-Print Studio with its built-in test pattern: the original image, the relief as it would print, modelled in white and black filament, its size and colour settings, and the 3D preview](docs/img/photo-studio.jpg)

<sub>**Photo-to-Print Studio:** the built-in test pattern turned into a layered relief. The right-hand preview is modelled, not photographed.</sub>

<img align="right" width="230" src="docs/img/phone.jpg" alt="Deja Vu1 on a phone: the printer picker, the demo banner, the progress line, the Needs you list, and Pause and Hold to cancel above the bottom tab bar">

On a phone the layout is rebuilt thumb-first: the main sections and the
Pause / Hold-to-cancel / Start-next controls sit at the bottom of the
screen, with the print's progress on a line just above them on every tab.
Open the computer’s address on your phone over your home Wi-Fi.
**Settings → Pair another device** is optional bookkeeping; it is not a login.

**Add to Home Screen** gives it a proper icon and name, opening without the
browser's bars where the phone allows.

<br clear="right">

### Optional: on by request

| Module | What it does |
|---|---|
| **Filament inventory** | Tracks spools on hand, flags print files needing a colour you don't have, and nudges you if a spool has sat loaded for weeks. **Import from Spoolman** brings in the spools you already track in [Spoolman](https://github.com/Donkie/Spoolman), with their colour and grams left; importing again updates them instead of duplicating. |
| **What changed?** | Compares the job about to print against your last few runs of that file, and flags a likely cause when the file has failed before and shares a pattern (a filament type in common, say). |
| **Pre-print sanity check** | Combines maintenance, dock status, and colour-check into one "safe to print?" verdict. |
| **WLED bridge** | Pushes dock ring colours to a WLED-flashed LED strip you already own, over WLED's own JSON HTTP API, no extra hardware to build. |
| **Home Assistant bridge** | Publishes printer state as a handful of REST sensors, so it shows up on an existing HA dashboard, no MQTT broker, no custom component. |
| **Auto-print pipeline** | Slices STL and 3MF models with [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer), **a separate program you install yourself**, using Orca presets you choose; the G-code lands in the file library, or straight on a printer's queue, where it still passes Confirm Print before it starts. Off by default. Driving another program from outside is fragile, an Orca update can change its command line, so every slice has a time limit, is checked for real printable layers before it's kept, fails in words with Orca's own message, and records the Orca version that made it. |
| **Low-latency camera (WebRTC)** | Plays the camera with almost no delay through [go2rtc](https://github.com/AlexxIT/go2rtc), **a separate program you install yourself**. It's one step beyond "nothing to install", so it's off by default. MJPEG stays the default, and the dashboard falls back to it automatically, saying which feed is on. See [docs/low-latency-camera.md](docs/low-latency-camera.md). |

### Interface + simulation, hardware pending

| Module | What it does |
|---|---|
| **Dock status rings** | A ring of light beside each toolhead dock: soft white for ready, pulsing green with a progress arc for printing, pulsing amber for heating, blue for paused, blinking red for a fault. It is readable across the room. Two ways to build it: WS2812 rings, or push the same state to a WLED-controlled strip you already own. |
| **"Right colour loaded?"** | An optical sensor in the filament path, compared against what the print file expects, catching the wrong spool before the print starts. |

![The Dock status rings panel: four rings for T0 to T3, three soft white for docked and ready and one red for needs attention, marked HARDWARE PENDING, with the note that it shows what the LEDs would display](docs/img/dock-rings.jpg)

<sub>**Dock status rings, on screen today:** what each LED ring would show. The physical rings are waiting on hardware.</sub>

![Four identical grey docked toolheads beside Deja Vu1's view of the same docks: T0 docked and ready, T1 printing, T2 heating up, T3 needs attention with a filament runout, plus the five dock states and their colours](docs/img/explainer-silent-docks.jpg)

<sub>**Why dock status matters:** a parked toolhead looks the same whether it's ready, out of filament or faulted. Deja Vu1 shows each dock's state on screen today, and on the rings once they exist.</sub>

<img align="right" width="270" src="docs/img/modules.jpg" alt="Settings, Modules: switches for Maintenance reminders, Printer control, Dock status rings, Right colour loaded, Push notifications, Filament inventory and Pre-print sanity check, each tagged READY TODAY, HARDWARE PENDING or OPTIONAL">

Every module can be switched on or off from **Settings → Modules**: the
toggle you see there is enforced by the server, not just hidden in the
interface. Disabled module routes refuse requests; background automation actions,
queue advancement, time-lapse capture and filament deduction also check their
module switches. "View on your desk" is browser-only; phone pairing is always on.

<br clear="right">

### While you wait (the Games tab)

Ten games, playable from the dashboard while a long print runs: **Sky
Dash**, **Pong**, **Minesweeper**, **Tetris**, **Pac-Man**, **Brick Break**,
**Blackjack**, **Asteroids**, **Snake** and **2048**. None of them read the
printer; the status strip and the live print pill stay visible on every
tab, including mid-game, so a finished or failed print is never missed.
Best scores are remembered per browser. Every game runs at the same speed on
any screen (60 Hz or 144 Hz), waits for you to start, pauses when you switch
tab or window, and sizes its playing field to fit the window. On a phone,
Pac-Man, Snake and Tetris show touch buttons and also take swipes.

<img src="docs/img/games.jpg" width="720" alt="The Games tab with Pac-Man ready to start: a blue maze with the ghosts in their house, a Start card explaining the power pellets, the list of ten games above, and the note that none of them read the printer">

## Why one dashboard, not several tools

![How it connects: each Snapmaker U1 runs Moonraker in front of Klipper; the Deja Vu1 server on your computer holds one WebSocket per printer for live state every 0.25 seconds and uses plain HTTP for commands, history and uploads; it pushes a live view to your laptop and paired phone, and only sends state outward to Home Assistant, a WLED strip and ntfy, Discord or Telegram](docs/img/explainer-how-it-connects.jpg)

Everything reads from the same Moonraker connection and the same print
history. Splitting that into separate tools would mean separate connections,
separate setups, and separate tabs to check. They are modules of one
application because the data says they should be, and it means the modules
that need hardware never block the ones that don't. Maintenance and printer
control work now, on any Moonraker-connected printer. The LED and colour
modules switch on when their parts arrive.

## No printer, no numbers

The dashboard does not invent figures. With no printer connected it shows
empty states: not zeroes, not placeholder data dressed up as real readings.

To preview it, there is a **Demo data** switch in the header. Turning it on
loads simulated print history and labels every panel accordingly, with a
banner saying plainly that nothing is connected.

This is enforced in the server, not just hidden in the interface. Without a
printer and without an explicit demo request, the data endpoints return
`{"connected": false, "demo": false}` and nothing else. `curl` gets the same
answer the browser does. Settings that belong to the dashboard itself
(modules, pairing, notification preferences, the filament list) aren't
printer figures, so they work the same with or without a printer connected.

## Current status

**No physical U1 or real phone has been verified.** Printer controls, filament
readback, camera/time-lapse and queue handling have simulator and authenticated
stand-in coverage. Start with the [watch-only first connection](docs/first-connection.md).
LED rings and the optical colour sensor have tested decision logic, without
completed hardware drivers.

The latest clean full suite passed **783 tests in 428.9 seconds** on Python
3.13.17/Linux, with app/demo servers stopped (the October 2026 "technical tools" round added
twelve; the sample files now include real models, which makes some tests slower). The
run before it passed 771 tests in 147.9 seconds.
The run before it, for the slicing workspace, passed 759 tests in 128.765 seconds. PR #45 also passed GitHub Actions
and was [merged](https://github.com/Jbyjre/Deja_VU1/pull/45). A follow-up targeted
check passed 36 tests. Chromium checks at 1366/390 px covered editing, stable
focus, actual slicing, preview, plate selection and Confirm Print entry. The
recorded static demo passed at both widths.

| Capability | Verified evidence | Remaining limit |
|---|---|---|
| Printer connection and controls | Source-based, authenticated fake-Moonraker tests | Physical U1, firmware differences and real-network behaviour |
| Different per-head heights | External Linux engine; actual model extrusion and clear pre-flight | No physical mixed-nozzle print; Windows/macOS setup unverified |
| Plate editing and conversion | Transforms, source-preserving saves, per-object wall paths; all three selected fixture plates slice | Complete vendor textures, subdivided paint and per-part semantics |
| Image generation | Four-tool colour tiles, synthetic layered-colour fixtures and closed reliefs real-sliced | Measured colour accuracy; geographic terrain/full CAD absent |
| Camera/time-lapse | Per-printer lifecycle, reconnect and stale-reply tests | Physical cameras and simultaneous real printers |
| Backup/recovery | Checksum/path validation, isolated restore and generated Linux launcher | Windows/macOS launchers unexecuted; external resources excluded |
| Optional integrations | Protocol/stand-in tests | Physical WLED, sensors and live third-party installations unverified |
| App updates | Staging, restart and rollback tests | Stable release package unpublished; Windows/macOS validation remains |
| Layer stack, Orca-style process settings | Unit tests for the thick-layer options and all 106 settings (names and choices checked against OrcaSlicer's option table); Chromium at 1366/390 px | No real slice with the new options in this round; whether an engine lists the thick-layer options is read from its own schema |
| Farm desk, telemetry, logbook, finder, converter card | Unit tests (logbook, printer page link) and Chromium at 1366/390 px on the simulated farm | Real farms, real spools and real printers' web pages unverified |
| Sample models | The 3DBenchy (CC0) reduced to 60,000 triangles with its edge structure unchanged; sample G-code checked by drawing its layers | The sample slicer is deliberately simple (no seams, supports or bridges) and says so in every file; not for printing |
| The print inside the twin, case off, drawing sheet | Preview built from the file's own G-code, tested on the two-colour sample and hand-written files; the real-printer download tested against the Moonraker stand-in; Chromium screenshots at 1366/390 px; frame time measured in software rendering (the print adds about a fifth; case off costs about 2.7× there) | Not seen with a physical U1's own files; frame, motors and lead screw sizes are typical, not measured |
| Updates (newest builds), safety copies, device lock | Each file checked against GitHub's record (stand-in GitHub in tests, and a live check against this repository); repair, restore and undo tests; the lock tested end to end against the real server | Automatic install exercised only in tests; Windows/macOS launchers still unexecuted |
| Insights, Orca import, Check it yourself | Unit tests with minimum-evidence rules; Orca folder names and formats checked against both slicers' source; all nine self-checks pass in a running copy | Orca import not yet run on a real Windows/macOS install; insights from a physical U1's history unseen |
| Interface refresh (3D twin, live background, games, setup) | Headless Chromium at 1366/390 px with software WebGL 2; frame times measured there (the 3D twin about 250 ms a frame on the CPU, background 16.7 ms); static demo checked; WebGL-less fallback checked | Real GPUs, real phones and 120/144 Hz screens unmeasured; the body's own size, dock spacing and inside layout are estimated from Snapmaker's picture |

Actual slicing used separately installed **Snapmaker_Orca 02.08.01.55**. Verified
nozzle/height pairs were 0.4/0.6 mm at 0.14/0.28 mm, 0.4/0.8 mm at 0.2/0.4 mm,
and two 0.4 mm nozzles at 0.1/0.2 mm. Stock OrcaSlicer 2.4.2 was previously
verified for shared-height slicing. The app checks capability and nozzle limits;
it does not bundle an engine or rewrite G-code to fake different heights.

The historical X290/X300 startup failure came from a generic inherited sequence.
Tested native U1 macros passed unchanged. The 270 mm bounds remain enforced;
physical purge behaviour is unverified. All three formerly failing project
plates now slice separately. Preserving original parts/paint does not establish
complete vendor-format fidelity.

Selection work improved from about 57–62 ms to below 0.5 ms for 400,000 triangles.
Full-frame model rendering regressed under SwiftShader software graphics and
remains slow. These measurements do not establish real-phone or GPU performance.
Contact/measurement checks are bounded at 250,000 triangles per object; the viewer
accepts two million triangles per plate. They do not guarantee support adequacy,
watertightness or toolhead clearance. AR still uses original source geometry.

Open work includes physical testing, feeder control, full format fidelity,
heavy-model rendering and older launch media. The heater-fault ring and the
unreachable firmware restart were fixed in this round. Current boards, social cards, screenshots, demo recording and preview GIF
and the launch videos (60-second version 13, 75-second version 12, and version 14: version 12
cut to 60 s with the new twin and background, and version 15: version 13 updated the same way)
are refreshed; older
editorial crops are not.
See [full validation](docs/slicer-workspace-validation.md),
[remaining-work goals](build-prompts/07-physical-validation-and-format-fidelity.md)
and [release requirements](docs/releasing.md).

## Tech stack

![By the numbers: 759 automated tests, 250 ms between live updates, 12 printers on one dashboard, 0 packages to install beyond Python, 7 maintenance tasks, 28 Home Assistant sensors, 27 printers in the farm sandbox, and the 270 mm per axis build volume the pre-flight checks against](docs/img/explainer-by-the-numbers.jpg)

- **Backend:** Python, standard library only, written for 3.8 or newer;
  the test suite passes on 3.8, 3.10, 3.12 and 3.13 in GitHub Actions
- **Web server:** `http.server` from the standard library (the threading
  version), plus a hand-written RFC 6455 WebSocket for live updates
- **Frontend:** HTML, CSS, and JavaScript, no framework, no build step;
  raw WebGL for the 3D viewer, the browser's own `DecompressionStream` to
  unzip 3MF files
- **Storage:** JSON settings and local model, G-code and media files
- **Tests:** `unittest` from the standard library, 759 cases
- **Printer API:** Moonraker, over HTTP and its WebSocket (and a simulated
  farm for demo data)

The core app requires no Python packages. Optional slicing needs an external
engine; integrations and opt-in update checks contact their configured services.
No frontend library is fetched at runtime; the three typefaces ship inside
`frontend/fonts` (SIL Open Font License, licences alongside), no CDN, no
analytics.
(Reaching it from outside your home uses Cloudflare's own `cloudflared`
program, which you install separately if you want that; see
[docs/remote-access.md](docs/remote-access.md). The optional low-latency
camera works the same way: it uses go2rtc, which you'd install yourself;
see [docs/low-latency-camera.md](docs/low-latency-camera.md). The optional
auto-print pipeline is the same again: it runs an OrcaSlicer you install.)
The core works without internet access; printers and phones still need the local
server. Pairing stays on your network. External notifications and update checks
need their configured services.

The interface uses an Apple Liquid Glass treatment: translucent panels with
real edge refraction (an SVG displacement filter, not just a blur), a
specular highlight that tracks the pointer, a bright rim, and elevation
shadow: the five layers that separate genuine glass from a blurred box.
The real refracting glass sits on the navigation and floating layer, top
bar, tab bar, live print pill, menus, sheets and dialogs, the things content
scrolls under. Content cards keep the same tint, highlight, rim and shadow
but don't blur what's behind them: behind them is the live background
(Settings → Appearance), which moves with your cursor, and blurring a moving
background costs real work every frame. The background itself only animates
while the pointer moves, then stops drawing. Repeated
small panels share one surface with plain dividers for the same reason. It
respects the system settings for reduced transparency, reduced motion, and
increased contrast, and the layout collapses cleanly to a phone-width screen.

Liquid Glass 2.0 adds four things on top: panels **morph**: a sheet of
glass deforms on a spring from one element into another (a printer card
into the overview, a file into its detail view, a button into its dialog,
the active tab sliding along the tab bar); on the live print pill and the
digital twin the highlight **drifts gently even at rest**; glass laid over glass (dialogs) uses a
**deeper refraction**, so what's underneath visibly bends more than the
background; and panels **take a tint** from what they're about: the active
filament's colour, a printer's state, a verdict.

The current look, "Layer lines" (`frontend/theme.css`, loaded last so it
changes appearance, never layout): behind everything runs a field of fine
horizontal lines, like the side wall of a print, lit by soft light in the
colours of the filament actually loaded on the printer you're looking at.
Glass is kept for the controls: header, tab bar, status ribbon, phone
dock, live pill, menus and dialogs. The tab bar and ribbon are clear
enough that the lines visibly shift where the glass bends them. Cards are
content, so they sit on a quieter frosted "paper" with no lensing (Apple's
own rule, and far fewer live filters on a big sandbox farm). Type is
Bricolage Grotesque for headings and big numbers, Instrument Sans for
reading and buttons, IBM Plex Mono for readings and labels.

## Security and your network

**Deja Vu1 has no login.** Anyone who can reach its port can pause or
cancel a print and send G-code, so keep it on a network you trust. Phone
pairing is a list of remembered devices, not a lock. What it does defend
against:

- **Other names pointed at it.** It only answers requests addressed to a
  name that belongs to your own network: an IP address, `localhost`, a
  plain machine name, or one ending in `.local`, `.lan`, `.home`,
  `.internal`, `.home.arpa`, `.localdomain` or `.ts.net`, plus any name you
  list in `DEJAVU_ALLOWED_HOSTS`. Anything else gets "Refused" (HTTP 421).
  This blocks *DNS rebinding*, where a web page you visit points its own
  domain at your dashboard to control it from your browser.
- **Other sites sending commands.** Every command and the live connection
  are refused (HTTP 403) when the browser says they come from another site.
- **Being framed.** No other site can load the dashboard invisibly inside
  its own page.

To reach it away from home, prefer private Tailscale Serve. Alternatively,
protect a Cloudflare Tunnel with Access first and list the hostname in
`DEJAVU_ALLOWED_HOSTS` — see
[docs/remote-access.md](docs/remote-access.md).

## Settings and your data

The server listens on every network interface of the computer, on port
8000. It has no command-line options; four environment variables change it:

| Variable | What it does |
|---|---|
| `PORT` | Listen on another port, e.g. `PORT=8080 python3 start.py` |
| `DEJAVU_ALLOWED_HOSTS` | Extra names it answers to, comma-separated — your tunnel's domain, say |
| `DEJAVU_MOONRAKER_LOG` | `1` prints every exchange with a real printer, for debugging a first connection |
| `DEJAVU_SLICER_PATH` | Where OrcaSlicer is, for the optional auto-print pipeline |

Everything the dashboard saves lives in `backend/data/` as plain JSON and
files: module switches, the printer list (up to 12 printers added by
address, in `fleet.json`), maintenance logs, the file library, settings and
paired devices. It's created on first use and never committed. To change a
printer's address or API key, remove it and add it again. **The test suite
writes to that folder**, so copy it somewhere safe before running the tests
on a computer that manages real printers.

## The public page

`wrangler.jsonc` publishes the `frontend` folder to Cloudflare as a plain
website, with no Python server behind it. Its front page is `welcome.html`,
the product page: real screenshots from the simulated farm, what's in the
dashboard, what is and isn't verified yet, and how to run it. (The page
asks for its own API, gets the "404 Not Found" a static host gives, and
hands over.)

**The online demo** is the dashboard itself on that same site, at
[`/?demo`](https://deja-vu1.jmath1110.workers.dev/?demo) (the product
page's **Try the demo** buttons go there). With no server to ask, the
dashboard plays a recording instead:

- `tools/online-demo/record.py` runs the real server with the simulated
  farm in a throwaway folder, turns every module on, adds the sample files,
  asks every GET route for each of the three printers, then records the
  live feed once a second for 150 seconds, firing a filament jam halfway.
  It saves `frontend/demo/recording.json` (about 1.3 MB, about 60 KB
  compressed) plus the sample files.
- In the browser, `app.js` notices there's no server, loads the recording
  and answers the page's own `/api` requests from it, looping the live
  feed. The digital twin moves, the jam reaches **Needs you**, files open
  in 2D and 3D, and the mixed-nozzle planner and Photo Studio really
  calculate (the planner's maths has a browser copy that a test keeps
  identical to the server's). Anything that would change a printer or a
  setting answers, in words, that this is a recording.
- It never runs where a Deja Vu1 server answers, so a real install never
  shows recorded figures. `tests/test_online_demo.py` fails when a new
  route isn't in the recording: re-run the recorder (about 3 minutes) and
  commit `frontend/demo/`.

Running locally nothing changes, and a local server that is down still
shows "Could not reach the backend". `/?dashboard` also skips the hand-over.

## Roadmap

**With access to a U1:**

1. Connect to a real U1 and work through [the list of things only a real
   machine can confirm](docs/real-printer.md#what-cannot-be-checked-without-the-printer)
   (the Details panel shows every exchange).
2. Confirm maintenance thresholds against how the machine actually wears.
3. Build the LED rings, print the dock brackets, wire the WS2812 chain,
   implement the driver (or wire up WLED instead).
4. Build the color checker, print the sensor housings, mount on the filament
   path, implement the sensor read and calibration.
5. Connect the pre-print blocking (built: it already refuses a print whose
   file doesn't match the filament the printer reports) to the optical
   colour sensor once it exists.
6. Open the converter's output in Snapmaker Orca to confirm it, and test
   the Cloudflare Tunnel setup end to end.
7. Run the auto-print pipeline against a real OrcaSlicer install, open a
   Photo-to-Print Studio 3MF in Orca to confirm its tool changes, and
   measure real filaments' transmission distances for the studio.

**Beyond that:**

- Chamber climate control (monitoring is built, read-only).
- A full macro builder, deliberately waiting for real hardware to test
  macros against.
- Try the AR preview on a real Android phone, and the low-latency camera
  with a real go2rtc install.
- Package as a proper Moonraker component so it installs alongside Fluidd or
  Mainsail.

## How to run it

You need Python 3.8 or newer. Nothing else. **New to this? Follow
[docs/getting-started.md](docs/getting-started.md)**: install Python,
download the ZIP, double-click `start-windows.bat`, `start-mac.command` or
`start-linux.sh`, and the dashboard opens in your browser.

From a terminal:

```bash
git clone https://github.com/Jbyjre/Deja_VU1.git
cd Deja_VU1
python3 start.py          # opens http://localhost:8000
```

The window prints the address to open from a phone on the same Wi-Fi.

**Staying up to date:** you only download once. In **Settings → App updates**
choose **Newest builds**, then **Check for updates** and **Install update &
restart** (or switch on automatic checks and installs). Only changed files are
fetched, each is checked against GitHub's record of it, your data is never
touched, and a safety copy is made first. Start the app with its double-click
launcher (or `python3 start.py`) for in-app installs; a `git clone` copy gets an
**Update with git** button instead.

**Slicing:** the slicing settings (106 of Orca's process settings, the profile
editor, the plate editor) are part of Deja Vu1. Turning a model into G-code
uses a slicing engine you install yourself, Snapmaker Orca or OrcaSlicer; Deja
Vu1 finds either in its usual place, or you enter its path once in
**Files → Auto-print**. Without one, everything else (G-code files from your
slicer, checks, printing, the twin) still works.

The dashboard will report that no printer is connected and show empty panels.
To connect one: **Printers → Add a printer → Find printers on my network**
(it asks the network, then tries Moonraker's port 7125 on your home
network, and checks each one), or type its Moonraker address (usually
`http://<printer-ip>:7125`) and press **Test** first. See
[docs/real-printer.md](docs/real-printer.md).
Or flip the **Demo data** switch in the header to fill it with the simulated
print history. On a phone, open the computer’s **From a phone** address
printed in the launcher. Pairing is optional.

With demo data on, a quick tour of the newer parts: **Printers** to switch
between the three simulated printers; **Files → Add sample files**, open
one, then **Print…** to see the Confirm Print check (the "unsafe example"
file is refused on purpose); **Automations** to build a rule and watch it
fire; and **Settings → Demo controls** to fast-forward a print to
its finish, or to make the next Pause fail and see how that is reported.

(GitHub Actions runs every test on Python 3.8, 3.10, 3.12 and 3.13.)

**Opened the pages without the server?** The public site serves `frontend/`
without Python. Its home page explains the download; **Try demo** plays a
recording of simulated printers. Browser-only tools such as local model preview
and Photo Studio can still run, but this public site cannot control a printer,
install an app update or save files into your computer's dashboard library.
The first-run tour explains that distinction. If the recording cannot load,
server-dependent panels show a connection message.

To see the maintenance module on its own, printed to the terminal:

```bash
python3 backend/maintenance.py
```

The two hardware modules have console simulations too:

```bash
python3 backend/led_status.py
python3 backend/color_check.py
```

Stop app/demo servers before the full suite (about two minutes):

```bash
python3 -m unittest discover tests          # all 759
python3 -m unittest tests.test_api          # one file
```

Tests use simulated printers, temporary fixtures and local fake-Moonraker servers;
they do not contact a physical printer. The dashboard keeps its data in `backend/data/` unless `DEJAVU_DATA_DIR` names another folder. With no printer added, the dashboard contacts none either, and
shows simulated figures only while **Demo data** is on. Add one by address
and the dashboard connects to it; `DEJAVU_MOONRAKER_LOG=1 python3
backend/app.py` prints every exchange with it.

## For developers and AI coding sessions

> **Rule for every AI (and person) editing this project: every change must
> also be reflected in the online demo.** The demo at
> [`/?demo`](https://deja-vu1.jmath1110.workers.dev/?demo) is the same
> `frontend/` folder playing back a recording of the server's answers
> (`frontend/demo/recording.json`). A change to screens, wording or behaviour
> in `frontend/` reaches the demo by itself, but check it there: serve
> `frontend/` with any static server and open `/?demo`. A new or changed
> server route, or a change to what a route returns, is not in the recording
> until you re-run `python3 tools/online-demo/record.py` and commit
> `frontend/demo/`; `tests/test_online_demo.py` catches a missing route. If a
> feature cannot work in a recording (for example it changes a printer), the
> demo must say so in words rather than fail silently.

[CLAUDE.md](CLAUDE.md) is the working context: the commands, a map of
every file and what it owns, the rules the code depends on (no invented
figures, demo data never reaching a real printer, server-enforced module
switches, escaping, the host check), the pitfalls that have cost time
before, and the known open issues. Claude Code reads it automatically at the
start of a session in this repository; it's written to be useful to a
person too. [docs/architecture.md](docs/architecture.md) is the long
version.

## Documentation

- [Model preparation and engine setup](docs/slicing-and-models.md)
- [Current engine, browser and performance evidence](docs/slicer-workspace-validation.md)
- [App-data backup and isolated recovery](docs/backup-and-recovery.md)
- [Current forty-point audit](docs/launch-round-three-checklist.md)
- [CLAUDE.md](CLAUDE.md): working context for developers and AI coding
  sessions (commands, file map, rules, pitfalls, known open issues)
- [docs/beta-testing.md](docs/beta-testing.md): trying it on your own U1, with what to
  check first and what to send back
- [CHANGELOG.md](CHANGELOG.md): what changed, newest first
- [docs/getting-started.md](docs/getting-started.md): from download to your U1 on screen,
  without typing commands
- [docs/real-printer.md](docs/real-printer.md): connecting a real printer, with what was
  checked against Moonraker's and Snapmaker's source, what can't be without
  the machine, and what the first run will tell you
- [docs/first-connection.md](docs/first-connection.md): for U1 owners, how to
  help run Deja Vu1's first real connection (watch-only) and how to sign up
- [docs/architecture.md](docs/architecture.md): how the pieces fit together
- [docs/hardware-modules.md](docs/hardware-modules.md): parts lists, wiring,
  and the non-invasive design constraint
- [docs/remote-access.md](docs/remote-access.md): reaching the dashboard
  away from home with a Cloudflare Tunnel, safely
- [docs/ar-preview.md](docs/ar-preview.md): "View on your desk", where AR
  works and what was and wasn't tested
- [docs/low-latency-camera.md](docs/low-latency-camera.md): the optional
  WebRTC camera through go2rtc (an extra program you install)
- [tools/readme-images/README.md](tools/readme-images/README.md): where every
  picture in this README comes from, and how to make it again

## License

MIT. See [LICENSE](LICENSE).
