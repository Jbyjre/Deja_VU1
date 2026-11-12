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
  - "frontend/slicer-workspace.js"
  - "frontend/plate.js"
  - "frontend/plate-worker.js"
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

Deja Vu1 runs a slicing engine the user installs (Snapmaker Orca or OrcaSlicer, AGPL-3.0). It never
bundles one, copies its code or rewrites G-code to fake heights. People read "Slicing"; the module
id stays `auto_print`.

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
  start failure or Orca's result codes. `ORCA_FIXES` must cover every code in
  `slicer_bridge.ORCA_ERRORS`. Package names only when checked against Debian and Ubuntu.
- Jobs are printer-scoped, cancellable process groups, at most eight active or waiting. Each carries
  `trace`, `cause`, `stage`; they persist to `<data>/slice-receipts.json`, and an interrupted job
  becomes failed + `interrupted` at start-up. `POST /api/slicer/report` exports one help report with
  home folders as `~`.
- `find_slicers`: usual install folders, one level deep, names containing "orca", no installers,
  nothing run.
- Files › Slicing opens with "Get ready to slice" (`farm.js` `renderReady`): five steps (on, find,
  check, print settings, check it all works), the first undone one has the main button; "Find it for me"
  is `POST /api/slicer/find`. "Use the stock U1 settings" is `POST /api/slicer/profiles/stock`
  (`slicer_bridge.use_stock_profile`, `slicer_profiles.stock_choice`): Snapmaker's own presets for the
  fitted nozzles, saved as the default, then `testSlice()` slices the sample 3DBenchy. With no heads set
  up it saves four 0.4 mm heads from what the printer reports (else PLA). The catalog counts a preset as
  U1 when its name says U1 or its `compatible_printers` names a Snapmaker U1: the 0.4 mm stock
  materials are "Generic PLA" and so on. `farm.js`
  `causeHtml`/`bindCause` draw a failure's cause in Files, Slicing and Prepare (`#sw-cause`).
- Evidence: `docs/slicer-workspace-validation.md`, `docs/native-studio-validation.md`,
  `docs/viewer-performance.json`. Real Orca 2.4.2 and Snapmaker Orca 02.08.01.55 Linux slices are
  recorded; Windows and macOS engine runs are not.

## Profiles and per-head heights

- `slicer_profiles.py` finds installed Snapmaker presets (also in the slicer's data folder
  `system/Snapmaker`), resolves parents with cycle and size bounds and writes flattened working
  copies under `slicer-presets/`. Keep system identity for CLI compatibility; inherited
  `printer_settings_id` can be stale.
- `slicing_contract.py`: capable engines get distinct per-head heights. Check the exported schema
  and the executable identity, not version names. Only exact grids are accepted. Startup extrusion
  beyond 270 mm is refused.
- `process_settings.py`: the 106 Orca process settings (names and choices from Orca's
  `PrintConfig.cpp`), served by `GET /api/slicer/schema`.
- `layer_planner.py` and `farm.js` `planLayers()` must stay identical (`tests/test_layer_planner.py`).

## Plates and projects

- `project_plates.py`: select one plate and keep the original. Never feed all plates to the engine
  and assume a zero exit proves correctness.
- `plate_project.py`: keep XML prefixes when moving paths (`requiredextensions` refers to them).
  List every model part in `3D/_rels/3dmodel.model.rels` or Orca imports empty geometry. Sources live
  inside `DejaVu/Sources/`.
- `colour_map.py`: which filaments a 3MF uses (objects, parts, paint, height ranges) and a head for each; writes a copy using at most
  four. Paint codec per OrcaSlicer's TriangleSelector.
- `plate.js` keyboard (`onKey`): single keys and Shift + arrows act only while the model view has
  focus; Ctrl/Cmd + Z, Y, D, S act while the plate is on screen and no field has focus; arrows alone
  orbit the camera. `tests/test_plate_keyboard.py` reads the source, so keep those guards.
- `slicer-workspace.js` moves the plate editor's controls between panels; never rebuild mesh buffers
  to select another object. Edits invalidate the preview; stale replies can't accept a new slice.
- `gcode-view.js`: layer index, filters and events. Toolpath segments append mm/s, feature index and
  line number after the original eight values. Nominal time excludes acceleration, heating, macros.
- `sample_slicer.py` is deliberately simple and says so in every file; the 3DBenchy is CC0.
- `layer-stack.js` (mixed heights: base × N per head) mirrors `slicing_contract.tool_layers`.
- Still incomplete: complex paint and texture rendering, editing several plates at once, and AR
  using edited geometry (it uses the source). Contact checks are bounded at 250,000 triangles per
  object; the viewer takes two million per plate.
