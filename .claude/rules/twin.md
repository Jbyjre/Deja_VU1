---
paths:
  - "frontend/twin3d.js"
  - "frontend/twin3d-scene.js"
  - "frontend/workshop.js"
  - "backend/print_preview.py"
  - "tests/test_twin_sync.py"
---

# The digital twin

- `twin3d.js` + `twin3d-scene.js`: WebGL 2, no library. A realistic model and an engineering drawing
  made from the same geometry. The print is drawn in (`setPrint`, clipped per layer); case modes
  closed / glass / open (`setCaseMode`); options (`setOptions`: print, rest, tags, spin). Driven by
  workshop.js (`setTwinMode`, `queueTwin`); the SVG `drawTwin` is the fallback without WebGL 2.
- Shape from Snapmaker's product photos of the production U1 and the plate size from Snapmaker's
  Orca profile (276 × 293 mm); facts only, no files (that repository is AGPL). Body about
  456 × 499 × 458 mm (`BODY`), side pockets (`HUB`) hold the spools so 584 mm overall fits. Dock
  spacing, gantry heights and inside layout are estimates, and the card says so.
- The gantry runs `GANTRY_DY` in front of the head it carries, so the nozzle sits at the G-code
  position. The plate follows Snapmaker's shop photo of the textured PEI plate (`plateArt`).
- Two surfaces at one height flicker while the model turns: the frame's base plate stops 1.5 mm
  under the case's inside floor (40 mm). Measure flicker by turning 2 px at a time and comparing
  frames.
- `print_preview.py` (`GET /api/print/preview`): outer walls and top surfaces per head and object
  from the print's own G-code, delta-encoded, cached per file version, with nominal times and a
  byte-to-time `timeline`. Byte offsets count bytes: decode with `surrogateescape`, never `replace`.
- `Twin3D.sync` follows the G-code between Klipper readings and re-syncs on each
  (`tests/test_twin_sync.py`, run in Node). workshop.js moves the nozzle with a critically damped
  spring (`SPRING_W`) so 4 Hz readings don't make it step.
- Measure frame time before and after any change to drawing (headless Chromium uses software WebGL).
- Layers and file reads: `print_preview.for_current` downloads a real printer's file even when Moonraker
  has no metadata for it yet (the metadata only decides the cache key); a failed read answers `reason` and
  `retry_s`, and `syncTwinPrint` retries with a back-off and shows the reason in `#twin-sync`. The outline
  fallback is see-through. Without the layers the head only eases toward 4 Hz readings, so check the
  card's sync line before judging how the twin moves.
- Where the head is drawn (`drawnPosition`): exact once X and Y are homed; before that the place it was last
  seen (`dejavu1.twin-last-head`, per printer), else the middle marked "position unknown". The head's tag
  (`l.say`) says printing, paused, on carriage, last known position or position unknown. Never print
  Klipper's made-up numbers while unhomed.
- Extrusion: the bead and halo at the nozzle (`dyn.bead`, `dyn.halo`, marked `rest: true` so the drawing
  skips them) show while `extruding`: the file's own stretches (`timeline.extrusion`) when it is followed,
  else the printer's `sync.extruding`.
- To test the twin without a printer, run `tests/fake_moonraker.py` through a real G-code file and watch the
  card in Chromium (see printer-link.md). Frame time with the bead is the same as without it.
