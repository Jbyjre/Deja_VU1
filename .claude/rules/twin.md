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
