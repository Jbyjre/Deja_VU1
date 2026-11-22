---
paths:
  - "backend/slicer_bridge.py"
  - "backend/slicer_profiles.py"
  - "backend/slicing_contract.py"
  - "backend/slice_diagnosis.py"
  - "backend/engine_support.py"
  - "backend/process_settings.py"
  - "backend/project_plates.py"
  - "backend/plate_project.py"
  - "backend/colour_map.py"
  - "backend/converter_3mf.py"
  - "backend/model_maker.py"
  - "backend/gcode_tools.py"
  - "backend/layer_planner.py"
  - "backend/sample_files.py"
  - "backend/sample_slicer.py"
  - "backend/safe_zip.py"
  - "backend/engine_installer.py"
  - "backend/slicer_working.py"
  - "frontend/slicer*.js"
  - "frontend/slicer.css"
  - "frontend/u1-plate.js"
  - "frontend/farm.js"
  - "frontend/gcode-view.js"
  - "frontend/layer-stack.js"
  - "frontend/maker.js"
  - "frontend/viewer3d.js"
  - "tools/engine-fixtures.py"
  - "docs/engine-support.md"
  - "docs/slicing-and-models.md"
---

# Slicing, plates and models

Deja Vu1 runs Snapmaker Orca (or OrcaSlicer), AGPL-3.0, as a separate program. It never bundles one,
copies its code or rewrites G-code to fake heights; the Slicer's Engine button downloads Snapmaker's own release into
`<data>/engine/` (below). People read "Slicer"; the module id stays `auto_print`. **The screen is the Slicer** (a sidebar place, Prepare and
Preview parts, `frontend/slicer*.js`; "The Slicer" below). The first Files › Slicing screens remain in the hidden `#legacy-slicing` holder of
`index.html` so scripts that look for their ids still find them; nothing there is shown, and new work goes in the Slicer.

## The engine

- `slicer_bridge.check()` reads stdout, stderr and the exit code (a program that can't load a
  library prints nothing on stdout). Windows builds print `--help` to their own console window, so a
  clean exit with no help line falls back to `_check_by_settings_file` (`--export-settings` must
  write Orca's shape: version, layer_height, nozzle_diameter). `_run` adds CREATE_NO_WINDOW on
  Windows. That fallback has run only against a stand-in engine.
- `engine_support.VERIFIED` lists engine builds run for real (Snapmaker_Orca 02.08.01.55 and
  OrcaSlicer 2.4.2, both Linux). `docs/engine-support.md` holds the same table (a test fails when
  they differ). Add a row only with a recorded run. Untested never blocks a slice.
- `engine_changed`: a slice waits for a new check when the program's path, size or mtime changed.
- `slice_diagnosis.py` (pure functions): the cause of a failed check or slice from text, exit code,
  start failure or Orca's result codes. `result.json` exists on Linux only, so `orca_code()` maps the unsigned exit code Windows
  reports (4294967196) and the low byte macOS reports (156) back to Orca's number (-100); a negative code is a signal and is never
  converted. `reason_lines()` never returns Orca's own "found error" line, which only announces the exit. A failed slice's whole
  engine output goes to Tester mode (`trace["engine_output"]`, dropped after) and is not kept in memory. `ORCA_FIXES` must cover every code in
  `slicer_bridge.ORCA_ERRORS`. Package names only when checked against Debian and Ubuntu.
- Jobs are printer-scoped, cancellable process groups, at most eight active or waiting. Each carries
  `trace`, `cause`, `stage`; they persist to `<data>/slice-receipts.json`, and an interrupted job
  becomes failed + `interrupted` at start-up. `POST /api/slicer/report` exports one help report with
  home folders as `~`.
- `find_slicers`: usual install folders, one level deep, names containing "orca", no installers,
  nothing run.
- Engine set-up used to be Files › Slicing "Get ready to slice" (`farm.js` `renderReady`, now in the hidden holder). The Slicer's engine card
  does it: Install, Update, Use my own Snapmaker Orca (`POST /api/slicer/find`, `settings`, `check`), and the time limit per slice. Error texts
  tell people to open the Slicer and press Engine. "Use the stock U1 settings" is `POST /api/slicer/profiles/stock`
  (`slicer_bridge.use_stock_profile`, `slicer_profiles.stock_choice`): Snapmaker's own presets for the
  fitted nozzles, saved as the default, then `testSlice()` slices the sample 3DBenchy. With no heads set
  up it saves four 0.4 mm heads from what the printer reports (else PLA). The catalog counts a preset as
  U1 when its name says U1 or its `compatible_printers` names a Snapmaker U1: the 0.4 mm stock
  materials are "Generic PLA" and so on. The Slicer's slice bar draws a failure's cause (`slicer-preview.js`, **Why?**).
- Evidence: `docs/slicer-workspace-validation.md` (engine output; its plate-editor sections are history), `docs/native-studio-validation.md`,
  `docs/viewer-performance.json`. Real Orca 2.4.2, Snapmaker Orca 02.08.01.55 and Snapmaker Orca v2.4.1 (build 01.10.01.50, the managed download) Linux
  slices are recorded; Windows and macOS engine runs are not (`tools/engine-selftest.py` is a run on a computer that has the engine).
- v2.4.1 names itself two ways: `--help` says `01.10.01.50`, its exported settings say `"version": "2.4.1"`, and a Windows engine can only be read
  through the settings file. `engine_support.RELEASE_BUILDS` makes them one build. Its command line refuses a 3MF its own window saved (file
  version 2.4.0.1, exit -24) unless given `--allow-newer-file`: `slice_model` retries once with it after -24 only, and keeps the first outcome if
  the engine answers -2 (an engine without the option). Real-engine rules, measured 22 November 2026: it counts every stored vertex, used or not, when it
  asks whether an instance is inside the plate (outside the plate's width or depth at any height, even under the bed, or above the height: -50; under the
  bed but inside the plate: accepted, then -100), and it loads an object whose components are themselves containers as empty (-50).
  `Unable to create exclude triangles` is printed twice on every run (the U1's `bed_exclude_area = 0x0`); `slice_diagnosis._HARMLESS` keeps it out of "why".
  After -50, -51 or -52 on a 3MF `slicer_bridge.slice_model` adds `project_plates.volume_check` (which object, which edge, how far) to the message.

## The managed engine (`engine_installer.py`)

- `PINNED` holds the SHA-256 and size of the three v2.4.1 downloads (hashed on 21 November 2026); a pinned release is always checked against
  its pin, a newer one against the `digest` GitHub lists, and a file with neither is refused unless `allow_unverified` (recorded as unverified).
  Only https, and only github.com and the `githubusercontent.com` hosts its downloads redirect to. Asset names follow `ASSET_PATTERNS`.
- Install = download to a working folder, unpack to staging (zip with path, size and entry limits; AppImage with `--appimage-extract`, no FUSE; dmg
  mounted read-only), start once to read the version, then rename into place and make current (`_use_it` never overrides a path the user chose).
  A failed or cancelled install leaves the working engine. The managed engine runs with its own `--datadir` (`data_dir_for_engine()`), so the
  user's own Orca is never read or changed. `DEJAVU_ENGINE_FEED` and `DEJAVU_ENGINE_PLATFORM` point tests at a local release server.
- Licence: AGPL-3.0, a separate program, source and licence links in the card. Never copy its plate model, textures or code: `u1-plate.js` draws
  the plate from measurements.

## The Slicer (frontend)

- Load order (`index.html`): `u1-plate.js` (before `viewer3d.js`), then `slicer-model.js`, `slicer-scene.js`, `slicer-ui.js`, `slicer-prepare.js`,
  `slicer-keys.js`, `slicer-settings.js`, `slicer-filament.js`, `slicer-sets.js`, `slicer-help.js`, `slicer-sheet.js`, `slicer-path.js`, `slicer-preview.js`, `slicer.js` (boots, `window.Slicer.open/openLocal`);
  `slicer-gcode-worker.js` is the Preview's Web Worker. Styles are all in `slicer.css` (11 px floor; the page's generic `.tab-sub > *` rule gives
  every direct child a 16 px side margin and its own `max-width`, so set widths outright).
- `PlateModel` (slicer-model.js) owns the objects and the 12-number transform (3 rows of turn and scale, then the move; row-vector convention, shared with
  `plate_project.py`); every edit is one undo step. `SliceScene` (slicer-scene.js) draws them and picks with GPU colour IDs. The working profile
  (`slicer_working.py`, `GET/POST /api/slicer/working`, `working/sync-heads`) is the one settings store: the dock's printer, heads and process blocks
  and the full sheet (`slicer-sheet.js`, every setting of `process_settings.py` with `slicer-help.js` words) write to it, and per-head heights go
  through the shared `tool_setup` records. Plate projects are sliced with `--arrange 0 --orient 0` (Deja Vu1 arranges and orients itself).
- Unbuilt on purpose: cut, colour and support painting, calibration prints and print by object (SLICER.6), multi-plate project save, the engine's own
  arrange and orient export (`tools/engine-selftest.py` prints what settles its 3MF convention), a movable prime tower, a time estimate corrected by
  history. The tower is drawn with its left-front corner at the engine's default (15, 220); the Preview draws what the engine printed.
- Camera and keys (`slicer-scene.js`, `slicer-prepare.js` `onKey`, `slicer-keys.js`) follow Snapmaker Orca's, read from its v2.4.1 source on 22 November 2026: a left drag turns 0.8 degrees a pixel round the
  selection (else every object, else the plate) and keeps that point still on the screen; Ctrl and a left drag turn round the screen's middle; the right and middle buttons pan so what was under the pointer
  follows it; the wheel zooms a tenth a notch towards the pointer (trackpad steps add up); Ctrl 0 to 6 are the views and the six flat ones use an orthographic lens until the next turn; 1 to 4 give the
  selection a head; A, Q, M, R, S, F, U, I, O, Z; arrows move 10 mm (Shift 1, Alt 0.1, Ctrl by the camera); Ctrl C, X, V, K, D, A, Z, Y, I, R, G and Ctrl Shift G; `?` lists them all. Ctrl K clones only
  with a selection, otherwise it stays the app's Find (`onKeyFirst`, bound in the capture phase because `finder.js` runs first). Tab flips Prepare and Preview only while a mouse press gave the 3D view the focus
  (`pointerFocused`), because the canvas is also a keyboard stop. The camera options (zoom to the pointer, swap the buttons, reverse the wheel, turning speed) are Orca's four. Orca's Cut, Boolean, seam and
  fuzzy-skin painting, Text, Brim ears and Assemble keys say "not in the Slicer yet". The view is only re-framed for a first model, a new plate and an emptied one.
- Filament per head (`slicer-filament.js`, `slicer-settings.js`, `slicer_working.py`): `state()["filaments"]` lists the engine's filament presets that fit the machine and whose material a head can hold
  (`tool_setup.MATERIALS`; `slicer_profiles.prepare` refuses a preset whose `filament_type` differs from the head's saved material), one row per short name, Snapmaker's first, with `stock: true` on the one
  `stock_rank` would choose for each material. `POST /api/slicer/working` takes `filament_presets` (four names, short or full, or null) and the browser keeps them in `state.preset.filaments`
  (names, not ids: ids follow the engine's folder). A head change bumps `w.headsVersion`, and a `refresh()` that started before it leaves the heads alone (an older read must not undo it).
  `printerDiff()` words where a head differs from the printer's own toolhead reading. Nothing here writes to the printer.
  Per-head numbers: `slicer_profiles.FILAMENT_NUMBERS` (11 keys, ranges served as `filament_limits`; the U1's bed temperature is `textured_plate_temp`, because its machine preset's `default_bed_type` is the
  textured plate) go in `material_options`, one dict per head, and each filament row carries the engine's own values as `own`. The browser keeps them in `state.preset.tune` and clears a head's numbers when its material or
  filament changes. The Preview reader (`slicer-gcode-worker.js`) takes its layers from `;LAYER_CHANGE` when the file has any (the start code's purge line is no layer); `tests/test_slicer_gcode.py` runs it in Node.
- Saved sets (`slicer-sets.js`): a set is the print preset's name, `state.overrides`, the speed, `state.preset.filaments` and `state.preset.tune`, kept in `dejavu1.slicer.sets` (30 at most) and exported as
  `{format: 'deja-vu1-slicer-settings', version: 1, ...}`. An imported file goes through `clean()`: keys must match `[a-z0-9_]` and be in `/api/slicer/schema`, values must be numbers, booleans or short strings, tune
  numbers inside `filament_limits`, the speed held to 50 to 120, the name stripped of control characters and angle brackets; what is dropped is counted and reported. Heads' colours and spools are never in a set.
- Checks: `node tools/slicer-check.js` (86 checks, stand-in engine, Chromium at 1366 and 390, light and dark; `tests/test_slicer_browser.py`),
  `tests/slicer_model_check.js` (`tests/test_slicer_model.py`), `tests/test_engine_installer.py`, `tests/test_slicer_working.py`.

## Profiles and per-head heights

- `slicer_profiles.py` finds installed Snapmaker presets (also in the slicer's data folder
  `system/Snapmaker`), resolves parents with cycle and size bounds and writes flattened working
  copies under `slicer-presets/`. Keep system identity for CLI compatibility; inherited
  `printer_settings_id` can be stale.
- `slicing_contract.py`: capable engines get distinct per-head heights. Check the exported schema
  and the executable identity, not version names. Only exact grids are accepted. Startup extrusion
  beyond 270 mm is refused.
- `process_settings.py`: the 118 Orca process settings (names and choices from Orca's
  `PrintConfig.cpp`), served by `GET /api/slicer/schema`.
- `layer_planner.py` and `farm.js` `planLayers()` must stay identical (`tests/test_layer_planner.py`).

## Plates and projects

- `project_plates.py`: select one plate and keep the original. Never feed all plates to the engine
  and assume a zero exit proves correctness.
- `plate_project.py`: keep XML prefixes when moving paths (`requiredextensions` refers to them).
  List every model part in `3D/_rels/3dmodel.model.rels` or Orca imports empty geometry. Sources live
  inside `DejaVu/Sources/`. A build item whose object only lists components (Bambu Studio and Orca projects) is flattened to the mesh objects with the
  transforms combined (`_flatten`; anything it does not understand keeps the old one-level reference), because the engine reads two levels as empty.
  `compact_vertices` (regex on the XML, never a re-serialise) drops vertices no triangle uses; `project_plates.engine_input` applies it to the
  temporary engine copy of every 3MF, plate or direct, and leaves the library file and untouched meshes byte for byte as they were.
- `colour_map.py`: which filaments a 3MF uses (objects, parts, paint, height ranges) and a head for each; writes a copy using at most
  four. Paint codec per OrcaSlicer's TriangleSelector.
- Slicer keyboard (`slicer-prepare.js` `onKey`): single keys act only while the stage has focus and no field or sheet is open; Escape closes the sheet, the
  engine card and the why card first; arrows alone orbit. Never rebuild mesh buffers to select another object. Edits mark the Preview stale; a stale
  reply can't accept a new slice.
- `gcode-view.js` (Files and the printer pages) and `slicer-path.js` + `slicer-gcode-worker.js` (the Slicer's Preview): layer index, filters and events. Toolpath segments append mm/s, feature index and
  line number after the original eight values. Nominal time excludes acceleration, heating, macros.
- `sample_slicer.py` is deliberately simple and says so in every file; the 3DBenchy is CC0.
- `layer-stack.js` (mixed heights: base × N per head) mirrors `slicing_contract.tool_layers`.
- Still incomplete: complex paint and texture rendering, editing several plates at once, and AR
  using edited geometry (it uses the source). Contact checks are bounded at 250,000 triangles per
  object; the viewer takes two million per plate.
