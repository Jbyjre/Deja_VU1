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
  (`l.say`) says printing, paused, on carriage, homing, last known position or position unknown. Never print
  Klipper's made-up numbers while unhomed.
- Homing (`Twin3D.homing`, pure, `tests/test_twin_homing.py`): a homing move starts from a position Klipper makes
  up past the far end of the axis (endstop plus or minus 1.5 times the travel) with the axis already marked homed,
  so drawing the reading threw the bed to the bottom on Home. A reading outside the axis starts an offset that
  keeps the axis where it was drawn and moves it by the reported motion; a sudden jump back inside the axis
  (Klipper setting the endstop position), 2 s still inside it, or 3 minutes ends it. The readout says Homing.
  Checked against a stand-in replaying that sequence, and watched on a real U1 on 22 November 2026 (Home all and Home X, Y, Z one by one: the labels read
  "homing" then "on carriage" while the camera showed the head move; Home X also homes Y on that printer, which reports "xy").
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
- Sharpness (`twin3d.js` `render`, `adaptQuality`, `resize`): a picture that is still (nothing following, moving, dragged, gliding or turning: `nothingMoves`)
  is always drawn at full size (the device pixel ratio up to 2). A run of frames steps down only on a slow median (over 100 ms across five), never below 0.5, and
  climbs back after 1.5 s when the next step would still be cheap; one full-size frame is drawn 450 ms after a run ends. The first three frames are start-up (shaders,
  geometry) and are not counted. A full-size frame that costs over 350 ms in a run, or over 1000 ms for a still picture, is not tried again for a minute (software
  drawing). It used to drop to 0.34 on the first slow measure and recover only while redrawing, so a quiet view stayed grainy.
- Size changes: the twin draws again on a change of its canvas size except while a divider is dragged (`html.is-resizing`); it draws once on the page's resize
  notice after the drag. The turntable draws no faster than 2.5 times its draw cost (`drawMs`) allows, and the Printer screen does not start it where drawing is in
  software (`Cockpit.software()`; `tools/testfix-check.js --only freeze`).
- Framing and tags (21 November): `resize()` reads `--twin-fit`, `--twin-dx` and `--twin-dy` from the element the twin sits in (`fit`), and `matrices()` applies them (a scale of the
  distance and a shift in clip space, so views, picks and tags all agree); the Printer screen's room and the opening scene's layer set them, a sheet sets none. Tags (`renderTags`) show
  the temperature next to the name (`tagTemp`, in the person's unit through `formatTemp`) for each head and, from `labels`, for `bed` and `chamber`; a tag has a leader line to its part
  (`.t3-tag::before/::after`). The studio colours behind the printer (`bgTop`, `bgBot` in `render()`) are the room's cool neutral, light and dark.
- Borrowing: sheets (deck.js) and the opening scene (intro.js) dock the shared `#twin-card` elsewhere and hand it back; `Panes.dock()` leaves it alone while it sits in
  `.cp-sheet`.
