# Slicer workspace: current validation

Baseline: clean current main `9efb807` (merged PR #44). This record separates real
engine output, file calculations, browser checks, simulated/fake printers and
physical measurements. No physical U1 or real phone was available.

## Engine output

A separately installed Linux build identifies itself as **Snapmaker_Orca
02.08.01.55**. Its downloaded release and exact studied commits/licences are in
the owner's private chat report. Preset JSON data matched the release's preset
tree; only its README differed. No engine code, assets or presets are distributed
in this MIT application. Linux test libraries were isolated under `/tmp`.

The bridge verified version/help and the exported option schema, then passed
actual physical-head preferences to private working presets. A successful exit
was not sufficient: output was parsed and pre-flight checked.

| Nozzles T0/T1 | Preferred heights | Model deposition levels T0/T1 | Observed Z steps | Pre-flight |
| --- | --- | --- | --- | --- |
| 0.4 / 0.6 mm | 0.14 / 0.28 mm | 179 / 90 | 0.14 / 0.28 mm | Clear |
| 0.4 / 0.8 mm | 0.2 / 0.4 mm | 125 / 63 | 0.2 / 0.4 mm | Clear |
| 0.4 / 0.4 mm | 0.1 / 0.2 mm | 250 / 126 | T1 has one 0.1 mm initial step, then 0.2 mm | Clear |

Native and exported profiles both require the actual engine capability, four physical slots and a valid exact grid. Unsupported preferences are refused.

Actual positive extrusion moves establish these levels; travel, retraction
recovery and labelled non-model operations are excluded. For the first fixture,
T0's 29.2 mm outer-wall move extrudes 0.78276 mm filament for a declared
0.5 × 0.14 mm strand. T1's 29.37 mm move extrudes 1.90954 mm for a
0.63 × 0.28 mm strand. Rounded-rectangle strand area and 1.75 mm filament area
produce the selected 0.98 material flow ratio in both cases. This checks the
extrusion amount, not just comments. First layers can be finer. Internal bridges
also declare a 0.4 mm round strand on T0; that is not a 0.4 mm object-layer step.

The integration intentionally refuses finer coordination grids below a fitted
nozzle minimum, even where the engine's experimental mode can attempt them.
These tests do not establish every geometry, nozzle/material combination, head
clearance or physical print quality.

Other current engine cases:

- All three selected plates from the historical crashing fixture: 125 layers
  each, clear pre-flight. Engine estimates: 11.89 g / 0.336 h on plate 1;
  5.97 g / 0.217 h on plates 2 and 3.
- Two otherwise identical objects with one versus four walls: the one-wall object
  has no inner-wall moves; the four-wall object has 1,489. Object settings reach
  the actual engine, with clear pre-flight.
- Closed 200,000-triangle, 10,000,084-byte sphere: 200 layers, 11.16 g,
  0.286 h predicted printing, 6.1 seconds external engine execution, clear
  pre-flight. Time/grams are engine predictions, not physical measurements.
- Current four-tool mosaic, synthetic layered colour and closed relief fixtures
  all passed the real engine and pre-flight (6, 8 and 16 layers). The mosaic uses
  T0–T3 model extrusion. Synthetic measurements test geometry/process binding only.

The early engine crashes were traced to process normalization without nozzle
context and an obsolete flow marker becoming an empty vector. Working copies
supply that context and migrate verified standard-flow fields. Another crash
came from a source's two-material identity arrays being indexed for four selected
materials; temporary input now reconciles those slots. Original geometry,
per-part settings, paint and source bytes remain unchanged.

The historical X290/X300 failure came from a generic inherited startup sequence.
Tested native U1 startup macros passed unchanged. Known literal out-of-volume
startup extrusion is refused, and full pre-flight still uses 270 mm limits.
Firmware macros and physical purge behaviour remain unverified.

## Browser and recovery

Chromium 154.0.8037.57 on Debian 13; Python 3.12.14. Checks at 1366 × 900 and
390 × 844 covered two-object edits, arbitrary transforms, tool assignment,
undo/redo, stable focused values through refresh, integrated tools/profiles,
actual slicing, direct layer navigation, tool/speed/event visibility, Confirm
Print entry, plate separation and stale-printer refusal. No horizontal overflow
or page errors were observed. Phone width is emulation, not a physical phone.

Backup preview, checksum validation and a separate recovered copy were exercised
through the browser. Its generated Linux launcher started the app with restored
data and disabled automatic modules. Unit tests cover redaction, corrupted
checksums, path traversal, unlisted files, write failure, original-data protection,
internal path remapping and staged-preview cleanup. Windows/macOS launchers were
not executed. Recovery never replaces the running data directory.

| Screen | Before 1366 | After 1366 | Before 390 | After 390 |
| --- | --- | --- | --- | --- |
| Preparation | [Before](img/slicer-before-workspace-1366.png) | [After](img/slicer-after-workspace-1366.png) | [Before](img/slicer-before-workspace-390.png) | [After](img/slicer-after-workspace-390.png) |
| Tools/settings | [Before](img/slicer-before-settings-1366.png) | [After](img/slicer-after-settings-1366.png) | [Before](img/slicer-before-settings-390.png) | [After](img/slicer-after-settings-390.png) |
| Layer preview | [Before](img/slicer-before-preview-1366.png) | [After](img/slicer-after-preview-1366.png) | [Before](img/slicer-before-preview-390.png) | [After](img/slicer-after-preview-390.png) |

Also inspected: [process desktop](img/slicer-after-process-1366.png),
[process phone](img/slicer-after-process-390.png),
[recovery](img/slicer-recovery-1366.png). Viewport captures show fixed navigation;
they are not full-page mock-ups. Historical round-two pictures remain intact.

## Performance, including regressions

The renderer was Chromium/ANGLE **SwiftShader software graphics**, not a GPU or
physical phone. Same generated workloads, warm-up and viewport sizes before/after.

| Workload | Width | Before mean | After mean |
| --- | --- | --- | --- |
| Select between two objects, 400,000 triangles total | 1366 | 56.98 ms | 0.41 ms |
| Same selection | 390 | 61.66 ms | 0.37 ms |
| Model animation interval, 200,000 triangles | 1366 | 122.4 ms | 178.7 ms |
| Same model animation | 390 | 107.5 ms | 162.1 ms |
| Toolpath animation interval, 60,000 segments | 1366 | 54.8 ms | 55.9 ms |
| Same toolpath animation | 390 | 56.5 ms | 62.4 ms |

Selection no longer reconstructs/uploads unchanged geometry. Its measurement is
synchronous editing work, not end-to-end display latency. Full frame pacing
regressed in this run and remains poor; no smooth large-model rendering claim is
made. A shader experiment showed no reliable benefit and was removed. Tiny render
submission times are not substituted for frame intervals. JSON contains p95,
upload times, renderer details and exact workloads.

## Automated checks and limits

**903 tests in 485.8 seconds** (Python 3.13.17, 26 October 2026, version 0.11.0: Away from home and the glass orb). Before that: **893 tests in 482.6 seconds** (Python 3.13.17, 26 October 2026, version 0.10.0: printer sign-in, camera sources, firmware 2.0.0 file names, phone layout and dot colour). Before that: **879 tests in 469.2 seconds** (Python 3.13, 25 October 2026, version 0.9.0: repair, restart and stop, the update commands and a release with every merge). Before that: **855 tests in 473.3 seconds** (Python 3.13.17, 24 October 2026, after the install-in-one-paste change). Before that: **852 tests in 473.0 seconds** (version 0.8.0: the twin print preview, insights, safety copies, Orca import, device lock and self-check, plus updates for git copies, the desktop window choice, version history, tours and the notification orb). Before that: **832 tests in 473.5 seconds** (the same day, before the two rounds were combined). Before that: **783 tests in 428.9 seconds** (Python 3.13.17, 23 October 2026, after the "technical tools" round added twelve; real sample models make some tests slower). Before that: **771 tests in 147.9 seconds** (Python 3.13.16, after the interface refreshes added twelve), with no app/demo server running. The slicing-workspace run itself passed **759 tests in 128.765 seconds**.
Earlier clean runs passed 758 tests before the final exported-preset regression was added. The prematurely started run was interrupted and is excluded. The clean
run includes five online-demo recording tests. Static-host Chromium checks also
passed at both widths: layers, three plate choices, local-write refusal and no
horizontal overflow or page errors. The refreshed recording contains 243 answers
(119 distinct bodies), 150 seconds of live feed, two events and eight sample files.

Focused suites covered engine orchestration/cancellation, nozzle constraints,
working-preset propagation, source slot repair, malformed archives/XML, calibration
conditions, recovery and existing security. Existing authenticated fake-Moonraker
coverage verifies protocol/refusal handling and camera lifecycle, not hardware.

The online demo was re-recorded for the changed routes; static-host results are
recorded separately below. Updated boards, social cards and workspace/recovery
captures are included. A new layer-preview GIF shows actual interaction with simulated demo files. Older editorial crops and 75-second marketing videos still
need a final pass; no public deployment or stable update package is claimed.

Remaining software limits: complete texture/subdivided-paint semantics, arbitrary
vendor per-part fidelity, edited AR geometry, simultaneous multi-plate editing,
feeder control and geographic terrain/full CAD. Physical U1, real phone,
Windows/macOS engine/recovery and measured colour accuracy remain unverified.

Evidence: [engine output](evidence/round-three-engine-output.json),
[renderer](evidence/round-three-performance-final.json),
[selection](evidence/round-three-selection-performance.json),
[browser](evidence/round-three-workspace-browser-results.json),
[recovery](evidence/round-three-recovery-browser-results.json).

Static-host evidence: [demo checks](evidence/round-three-static-demo.json) and
[layer-preview GIF](img/slicer-preview.gif).

A final source-save smoke check also removes `crypto.randomUUID` from the browser
API mock: cryptographic source names still work, covering ordinary HTTP LAN
contexts where that newer API is unavailable. Physical phone testing remains open.
