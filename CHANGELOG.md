# Changelog

Newest first. Each entry says what changed for someone using the dashboard,
and what is and isn't verified.

## Unreleased — a realistic 3D twin and a livelier background

- Launch video version 14 ("V1 at 60 s"): version 12's 75-second film, its music and
  its click and keystroke sounds, re-cut to exactly 60 s in both shapes and re-filmed from
  the current app. The new twin gets 9 s (the 3D model turned by hand and gliding to a stop,
  a toolhead clicked open, then the same model as a drawing and its Front view, estimated
  sizes marked "≈"); the live Dots background is shown through the cursor and as the film's
  own scenery. Version 13's cuts are unchanged. Not checked by ear; measured only.
- Launch video version 15 ("V2 updated"): version 13's 60-second film, music and headline
  move, re-cut so the twin gets 7.5 s (model, glide, a head's live details, then the
  drawing), with the same live background, scenery and fixes as version 14. Version 13's
  files are kept. A version 14 callout that pointed at blank space during a scroll is fixed
  in both.
- Digital twin rebuilt (`frontend/twin3d.js`, `frontend/twin3d-scene.js`, WebGL 2): a
  detailed model of the U1 from Snapmaker's official product picture (in Snapmaker's
  Orca profile) and published figures, with studio lighting, reflections, soft
  shadows, real materials, live head/bed/docks/spools/screen/print, exact click
  picking and a gliding drag. The Drawing mode is now made from the same geometry
  (edge ink, dimensions, balloons, title block, "Show the case", PNG download); the
  previous SVG drawing remains for browsers without WebGL 2. Estimated: the body's
  own size (about 390 × 460 × 480 mm), dock spacing, inside layout. Measured in
  software WebGL only (about 250 ms a frame on the CPU); real GPUs unmeasured.
- Background: Dots by default; stronger, faster reactions (push, stir, curl, glow);
  Constellation style, Time of day colours, Reaction setting; "Little surprises" (click
  ripple, triple-click bloom, long-press charge, minute sweep, the time in dots on the
  hour, a burst when a print finishes, two keyboard secrets); a running print fills
  the dots from the bottom in its filament's colour. Reduced motion turns it all off.
- Owner's note for future launch videos: show the Dots background reacting and the
  new 3D twin (`promo-video/README.md`). Next ideas: `build-prompts/08-background-and-twin-next.md`.

## Unreleased — interface refresh: live background, 3D twin, games, setup

- New background that reacts to the cursor (`frontend/backdrop.js`): Flow, Layer
  lines, Dots and Still, in Glacier, Mint, Dusk, Graphite or Filament colours, chosen
  in Settings → Appearance and in setup. Glacier (blue) replaces the red/filament
  glow as the default; the old behaviour is the "Filament" set. It animates only while
  the pointer moves and for the glide afterwards, and stops for a hidden tab, reduced
  motion or reduced transparency. Content cards no longer blur what is behind them.
  Measured in headless Chromium (software rendering) with the mouse moving over the
  Overview: median frame 16.7 ms with Flow, Layer lines or Dots, against 33.4 ms for the
  previous version; 95th percentile 33 ms. Not measured on real devices.
- Digital twin: a shaded 3D model of the U1 (`frontend/twin3d.js`, raw WebGL) beside
  the engineering drawing. Built to Snapmaker's published outer size (584 × 499 ×
  730 mm) and 270 mm build cube; head, bed, docked heads, spools and parts are live.
  Colours, panel tints, screen and spool placement, dock spacing and which side feeds
  which head are drawn by eye and labelled as illustrative. The drawing gained zoom,
  an "Outer size" option with overall dimensions, and SVG download.
- Games: Pac-Man rewritten (a new maze with a ghost house, ghosts released one at a
  time, smooth movement at sensible speeds, a two-second READY, pause on tab switch);
  it previously lost all three lives in about four seconds without input. Tetris
  rewritten (tapping the board used to restart the game; now it turns the piece; ghost
  piece, hold, wall kicks, lock delay, touch buttons). Snake rewritten (no longer starts
  by itself; buffered turns, smooth movement, game-over card). Sky Dash rebuilt on a
  canvas (it rebuilt every pipe element 50 times a second). Every game's timer now runs
  from the screen's refresh at a fixed rate, so speed is the same at 60 Hz and 144 Hz,
  and every playing field is sized to fit the window.
- Setup is now full screen with a named step bar and a new "Make it yours" step.
  Fixed during the work: a closed full-screen dialog must not stay laid out over the page.
- Clearer layout: Overview first in the tab bar, "Fleet" shown as "Printers", one
  sentence under the tab bar explaining each tab, the Overview reorganised (twin with
  controls and health beside it), plainer card subtitles, jump links at the top of
  Settings, and plainer wording for the continue-on-another-device banner.
- README rule: every change, by any AI or person, must also be reflected in the online
  demo. Frontend changes reach it automatically; changed routes need the recorder.
- Tests: `tests/test_frontend_refresh.py` (maze reachability, published outer size,
  script order, tab introductions, game timers). README pictures re-captured.

## Unreleased — slicing workspace and app-data recovery

- Launch video version 13: two new 60-second cuts (16:9 and 9:16), told problem
  first, then six features, each headline landing before the app shows it. New
  lounge-jazz music with a recorded vibraphone; same click and keystroke sounds.
  Re-filmed from the simulated farm; checked by measurement, not by ear. The
  75-second version 12 cuts are kept.
- Refresh all five README files, product-page/PWA descriptions and maintainer
  context. Distinguish core/optional dependencies, current/historical media and
  actual engine output/physical testing; remove repeated launch history.
- Unified object editing, profiles, fitted tools, slicing status and output preview.
  Phone settings omit the viewport; phone preview keeps layer navigation visible.
  Arrange now frames the moved objects, and selection reuses unchanged geometry.
- Supported external engines consume distinct physical-head layer heights. Exact
  coordination, first layers, nozzle limits, capability changes and stale tools
  are validated. Three real Linux nozzle/height combinations passed pre-flight.
- Fixed CLI working-preset context and legacy standard-flow migration; no engine
  source or startup commands are modified. Generic out-of-volume startup
  extrusion is refused. Added cancellation, per-printer jobs and atomic queue handoff.
- Separate 3MF plates with original recovery data. Reconcile source preset identity
  slots with selected CLI materials; three separated fixture plates now real-slice.
- Expand profile groups, material temperature/flow/cooling overrides and edit-as-new.
  Unexposed or inherited settings remain in the resolved working copies.
- Tracked colour recipes bind to print/material settings, backing and layer order.
  Changed conditions refuse stale recipes; physical colour accuracy remains unverified.
- Full app-data ZIP, checksums and isolated recovery with launchers. Connection
  secrets are omitted, existing data stays intact and restored automatic actions
  are disabled. Linux recovery startup tested; Windows/macOS remain unverified.

## Historical round-two launch readiness

- Blocked engine output is kept for inspection and never automatically queued.
  Slice reports show unknown when the engine supplies no time or weight. The
  file inspector labels its older length/density assumptions explicitly.
- Tool forms reject a changed printer immediately, including late load replies;
  a browser check confirms no filament command is sent from a stale form.

- Generated four-tool colour paint survives a plate save-as and real-engine
  round trip. Layer settings remain attached; transforms that would invalidate
  the layer recipe are refused.
- Colour recipes now export as a single multipart object, keeping raised colour
  layers together. The bridge checks printer/tool identity and both first and
  later layer heights. Measured recipes are printer-specific. Selected-settings
  export included tool assignments and measured recipes; this historical pass did not include full restore.
- Mixed-nozzle presets limit bridge width to the smallest nozzle and require
  explicit review before using materials listed for another U1 nozzle variant.
  A real mixed-nozzle slice was blocked by startup extrusion outside 270 mm.
  A converted three-plate fixture crashed Orca; single-plate conversions passed.
- G-code layers follow file order, including sequential objects; startup purge
  can be excluded when framing a layer. Added selected-object outlines, broadest
  surface lay-flat, cached transforms, bounded ZIP streaming and 3MF unit handling.


- Connected explicit spool assignments to Confirm Print’s weight check. New
  inventories start empty; existing records are preserved. Duplicate physical
  spool assignments are refused. Without measured per-tool usage, a multi-tool
  print no longer consumes the whole weight from one guessed spool.
- Converter now refuses unknown materials, unsupported nozzles, malformed
  settings objects and nonfinite layer heights. Mixed-nozzle arrays stay intact
  with explicit limitations. Simulated cancel records partial history, docks
  the active head and turns off all heater targets. Offline local settings and
  slice workers retain the selected printer without opening a connection.

- Added original four-tool image-to-3MF generation with optional serpentine
  error diffusion, physically measurable sixteen-swatch recipes and calibrated
  layer stacks. Measurements are tied to spool identity, colour, nozzle and
  layer thickness. Layered mode refuses uncalibrated settings.
- Added closed heightmap relief geometry. Real Orca 2.4.2 sliced tile, swatch
  and relief projects; all passed pre-flight. Physical colour and printer tests
  remain outstanding. Image brightness is not geographic elevation.

- Replaced the single-model transform controls with an undoable multi-model
  plate workspace, arbitrary rotation, mirroring, scaling, arrange, drop/lay-flat,
  object settings and exact surface-point measurements. Geometry checks run in
  a bounded browser worker and distinguish box overlap from mesh contact.
- 3MF save-as retains original model/property/texture parts and source recovery
  copies. Added required model relationships after a real-engine test exposed
  empty imported geometry. A two-object T0/T1 slice now passes pre-flight.
- Added G-code speed/feature information, layer heights, event markers and
  nominal movement time with its limits. Retraction recovery no longer counts
  as newly consumed filament. Travel filtering now uses one GPU draw call.

- Added installed-preset discovery, bounded inheritance resolution, matching
  machine/material checks and a native print-settings form. Generated working
  presets leave the installation intact. Saved tools feed nozzle arrays and
  colours; a shared layer height passes through the nozzle planner. Separate
  preferred heights are explicitly unsupported by this stock-engine path.
- Verified a real OrcaSlicer 2.4.2 Linux slice through the bridge: 125 layers,
  6.62 g, 0.231 h from the engine, clear pre-flight. Fixed lost system identity
  during preset resolution and selected-printer scope on slicing workers.

- Time-lapse now captures each real printer’s own stock camera, independently of
  open browser tabs. Duplicate pictures are skipped, failures are visible and
  retried, and late replies cannot enter a different print’s session. Real
  cameras remain unverified. Real status notifications now wake the live feed.

- Added per-printer four-tool preparation records and a native editor in
  Auto-print. Idle-only colour/material changes use physical head numbers and
  read-back verification; firmware refusals remain errors. Confirm Print also
  checks known material mismatches. Physical U1 verification remains outstanding.

Validation: all 732 Python tests pass on Python 3.12 Linux (133.8 s); Chromium desktop/phone checks
cover setup, privacy, search, viewer transforms and offline handling. A browser
connection test rejects a wrong API key, accepts the authenticated stand-in
and keeps the selected printer after reload. Real devices remain untested.

- Added skippable/replayable setup, a name stored only in the browser, feature
  search and explicit public-demo guidance. Added a network-only service worker
  with an offline explanation; printer readings and commands are never cached.
- Added opt-in app release checks, SHA-256 verification, safe staging and a
  supervising launcher with file rollback after failed startup. Linux process
  tests cover good/broken releases and preserved data. No real release published;
  Windows/macOS and real network delivery remain unverified.
- Added selected-printer stock camera snapshots with a dedicated authenticated
  monitor connection, renewals and idle shutdown. Tested with fake Moonraker;
  a real U1 camera still needs testing. Existing manual MJPEG is separate.
- Added triangulated OBJ geometry loading, viewer pan/scale/quarter-turn rotation,
  measured bounds and save/export of prepared STL copies. STL loses colour/tool
  metadata; overlap checking and multi-model editing are future work.
- Added local OrcaSlicer path detection; actual slicing still needs a separately
  installed engine and compatible presets, and has not run with a real engine here.
- Fixed refused print starts overwriting job summaries and disabled modules
  continuing background actions. A request already in flight cannot be recalled.
- Rewrote computer, phone, firewall, remote-access and release guides. Clarified
  incomplete configuration backup and the real-hardware test requirements.

## Unreleased - Phase 2 work

Local setup, printer reliability and file preparation improvements.

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
  Print.** Limits from Snapmaker/OrcaSlicer `8931178`; a common grid keeps
  each toolhead's preferred layer height on whole steps.
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
  from the printer. Protocol checked in Snapmaker's
  u1-klipper `exclude_object.py`.
- **Multi-plate conversions land on the right plates.** Every plate's
  objects are moved onto the U1's 270 mm plate grid, from Snapmaker Orca's
  `PartPlate.cpp`. Before, plate 2 onward landed between plates.
- **Conversion errors with codes** (`CV-101`...), the stage that failed and
  what to try, and a **Copy report** button for bug reports.
- **OrcaSlicer projects** convert too.
- **Import from Spoolman** (Care tab → Filament inventory). Imports again
  update instead of duplicating; hand-added spools are left alone.
- **Add to Home Screen**: an app icon, name and manifest.
- A sample with three labelled cubes, and a three-plate MakerWorld-style
  sample, to try skip-object and the plate fix in demo mode.
- README screenshots, a status table, and [docs/beta-testing.md](docs/beta-testing.md).

### Changed
- **Photo Studio stays in step with what's set.** Changing a colour, TD,
  size or layer setting rebuilds the model by itself; until it has, the old
  model is greyed out and can't be saved. A change made mid-build is built
  straight after instead of being lost. A rough colour match now says which
  colour would help. HEIC photos get a clear message.
- **Filament colours are asked for every 30 s** as well as pushed, so
  missed touchscreen-change notifications do not leave stale readings.
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
