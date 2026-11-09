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
- Motion from readings (`Twin3D.fx`, pure and tested in `tests/test_twin_fx.py`): filament dashes (`kind: 'flow'`
  over each tube and each spool-to-feeder strand, `tube(..., along)` gives UV.x in mm) run at the working head's
  `state.extruder_velocity` (motion_report `live_extruder_velocity`, signed; 2 mm/s while a simulated print lays
  plastic); the spool turns by length over a 65 mm radius (`rot` uniform, six windows on the flanges); the four
  belt strands (`kind: 'belt'`) run A = x + y and B = x - y of the drawn head; the chamber light is
  `tuning.leds` (cavity LED RGBW) added to what sits inside the case (`uLamp`); a faulted head's LED pulses.
  The printer reports no feeder speed: a load or an unload (a `tuning.runout` sensor change, else
  `filament_loaded`, or the Feed button through `Workshop.twinFeed`) is a 6 to 7 s push or pull at about
  25 mm/s, labelled as typical on the card. A purge strand hangs from the nozzle only while the printer's own
  extruder speed is above zero and nothing prints.
- A head slides between its dock and the carriage (0.35 s) only when the carriage is within 70 mm of that
  dock, else it changes place at once; the optional click (Show menu, off by default) is synthesised in
  Web Audio. `prefers-reduced-motion` freezes dashes, spools and slides. Animation redraws go through
  `queueTwin` (`twin.model.moving()`), never a bare `requestAnimationFrame`: that starved the page (0.5 fps
  in software graphics) before it was routed there.
- To test the twin without a printer, run `tests/fake_moonraker.py` through a real G-code file and watch the
  card in Chromium (see printer-link.md). Frame time with the bead is the same as without it.
