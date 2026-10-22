# Native studio: historical round-two evidence

Current results are in [slicer workspace validation](slicer-workspace-validation.md).
The failures and unsupported capabilities below describe the previous delivery.

The application still runs with Python alone. The separately installed engine
used for these integration checks was official OrcaSlicer 2.4.2 on Linux.
No physical printer or phone was available. The Python engine tests use a
stand-in executable; the results below came from the actual engine.

| Real-engine case | Reported output | Pre-flight |
| --- | --- | --- |
| Closed 200,000-triangle sphere | 200 layers, 11.66 g, 0.336 h; engine processing 5.7 s | Clear |
| Original bracket | 125 layers, 6.62 g, 0.231 h | Clear |
| Two-object, T0/T1 plate | 125 layers, 18.0 g, 0.744 h | Clear |
| Edited plate saved/reopened through browser | 125 layers, 13.04 g, 0.361 h | Clear |
| Four-colour model through plate save-as | 6 layers, 3.13 g, 0.113 h; T0–T3 retained | Clear |
| Layered image with synthetic swatch measurements | 8 layers, 4.08 g, 0.149 h | Clear; physical colours unverified |
| Heightmap relief | 29 layers, 3.47 g, 0.114 h | Clear |
| Single-plate Bambu-style and Elegoo-style conversions | Each 125 layers, 6.4 g, 0.229 h with installed U1 settings | Clear |
| Mixed 0.4/0.6 mm, common 0.2 mm layers | 8 layers, 5.15 g, 0.161 h | **Blocked:** preset startup extrudes at X290 |
| Converted three-plate fixture | Engine crashed with signal 11 | No output accepted |

Times and grams above are engine-reported estimates. They are not measured
printer duration or weight. Different profiles/geometry produce different
numbers. The mixed-nozzle output must not be printed or bypass the bounds check.

The browser checks cover arbitrary rotation, mirror, lay-flat/drop, arrange,
undo/redo, bounded contact checks, editable source recovery, OBJ vertex colours,
four-tool setup, named installed profiles, real slicing, image generation,
uncalibrated refusal, layer controls and no horizontal overflow at both sizes.
The older onboarding/privacy/search/offline checks also passed. Timelapse uses
an authenticated selected-camera socket against the fake printer. Browser
fixtures also verify unknown engine figures, rejection of late printer-load
replies and no outgoing filament command from a stale form. The real mixed-nozzle
job was checked end to end: it failed pre-flight and left the queue unchanged. Firmware and
physical camera behavior still require an owner check.

Before/after pictures are viewport captures inspected in Chromium. The earlier
Photo Studio is included as context; the new measured/tile workspace had no
previous native equivalent. Screens may require scrolling, especially on a phone.

| Screen | Before, laptop | After, laptop | Before, phone size | After, phone size |
| --- | --- | --- | --- | --- |
| Viewer / plate | [Before](img/native-before-viewer-1366.png) | [After](img/native-viewer-1366.png) | [Before](img/native-before-viewer-390.png) | [After](img/native-viewer-390.png) |
| Slicer setup | [Before](img/native-before-slicer-1366.png) | [After](img/native-slicer-1366.png) | [Before](img/native-before-slicer-390.png) | [After](img/native-slicer-390.png) |
| Image workspace | [Earlier studio](img/native-before-maker-1366.png) | [New workspace](img/native-maker-1366.png) | [Earlier studio](img/native-before-maker-390.png) | [New workspace](img/native-maker-390.png) |
| Four tools | No equivalent editor | [New](img/native-tools-1366.png) | No equivalent editor | [New](img/native-tools-390.png) |
| G-code layers | Earlier viewer shown above | [New](img/native-gcode-1366.png) | Earlier viewer shown above | [New](img/native-gcode-390.png) |

For a reproducible timing comparison against our own previous viewer, run
`node tools/benchmark-viewer.js OUTPUT_JSON 15e6a41` with development Playwright
and Chromium. It uses 200,000 triangles and 60,000 alternating extrusion/travel
segments, measures render calls and animation intervals after warming up, and
reports the renderer. Cloud graphics and phone-sized viewports do not establish
real-phone performance. Do not run other browser workloads during measurement.

Full texture/subdivided-paint rendering, complete vendor per-part settings,
multiple editable plates, different preferred layer heights per head, edited AR,
physical colour calibration, feeder drivers/installers, geographic terrain and
full backup/restore remain incomplete. See the current model guide and remaining
launch brief. Existing launch videos and older marketing crops still need an
editorial update; they are not evidence for these new features.

The slice job fails visibly and never queues output blocked by pre-flight. Its
time/weight fields come only from slicer metadata; missing fields are unknown.
The file inspector separately labels nominal motion time and length-based
weight calculations, including their 1.75 mm/reference-density assumptions.

## Large-model timing

An isolated comparison with Chromium’s ANGLE/SwiftShader software renderer
(no physical GPU or phone), against our own main commit 15e6a41:

| Workload / viewport | Mean animation interval before → after | 95th percentile before → after |
| --- | --- | --- |
| 200,000 triangles / 1366 px | 149.4 → 189.6 ms | 216.7 → 266.7 ms |
| 200,000 triangles / 390 px | 137.3 → 141.4 ms | 200.0 → 166.8 ms |
| 60,000 alternating segments / 1366 px | 295.8 → 58.5 ms | 383.3 → 100.0 ms |
| 60,000 alternating segments / 390 px | 317.2 → 64.4 ms | 483.3 → 100.1 ms |

These heavy scenes are not smooth on this cloud software renderer. The model
frame intervals did not improve; physical-device performance remains a launch
check. Toolpath batching substantially reduced this measured workload’s interval.
The [raw measurements](viewer-performance.json) also distinguish browser render-call
cost from animation intervals. A phone-sized viewport is not a phone test.
