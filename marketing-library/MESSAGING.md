# Project messaging

Temporary launch notes. Keep public claims aligned with the
[current validation](../docs/slicer-workspace-validation.md).

## One line

**One screen for every U1 you run.**

Deja Vu1 is a free, open-source dashboard and model-preparation workspace for
Snapmaker U1 printers. Monitor a fleet, prepare plates, slice with an installed
engine, inspect G-code and review server-enforced checks before printing. The
core runs locally with Python; optional engines and integrations are separate.

## Paste-ready repository description

> Local dashboard and model-preparation workspace for Snapmaker U1 printers,
> with external-engine slicing, G-code inspection, print checks and app-data recovery.

Suggested topics: `snapmaker`, `snapmaker-u1`, `moonraker`, `klipper`,
`3d-printing`, `print-farm`, `dashboard`, `toolchanger`.

## What to emphasize

1. **Monitor the fleet:** live state, finish estimates and a ranked Needs you list.
2. **Prepare, slice, inspect:** object edits, physical T0–T3 assignments, useful
   profiles and actual layer inspection in one workspace.
3. **Different preferred heights:** verified Linux engine output for three
   nozzle/height pairs. A capable external engine is required; this is not a
   physical-print claim.
4. **Review before starting:** pre-flight and Confirm Print check the current
   printer, file and loaded tools. Checks do not guarantee a successful print.
5. **Keep source data:** supported project conversion, separate plate selection,
   save-as and isolated app-data recovery.
6. **Make images printable:** colour tiles, measured-swatch layered models and
   closed image reliefs. Calibration and physical appearance remain unverified.
7. **Supporting tools:** maintenance, spools, camera/time-lapse, automations,
   notifications, smart-home integrations and games.

## Evidence and wording limits

| Claim | Evidence or qualification |
|---|---|
| 852 tests passed | Clean full suite, Python 3.13.17/Linux, 473.0 seconds (24 October 2026, version 0.8.0); earlier 759 on Python 3.12.14 with PR #45 CI passing |
| Follow-up check | 36 targeted tests passed before the PR #45 merge |
| Live updates | 250 ms target loop; actual freshness depends on printer/network response |
| Per-head heights | Actual model extrusion, with clear pre-flight; first layers/features can differ |
| Recovery | Validated separate restore and generated Linux launcher; Windows/macOS unexecuted |
| App dependencies | Standard-library Python/plain JavaScript; external slicing/media tools are separate |
| Performance | Selection improved; full-frame model rendering regressed under SwiftShader |

Say plainly:

- No physical U1, real phone, measured colour accuracy or mixed-nozzle print is verified.
- Farm screenshots are simulated. Slice figures can be actual engine estimates;
  neither is a physical measurement.
- Representative converted/generated files passed the Linux engine. Full vendor
  paint, textures and per-part semantics remain incomplete.
- LED rings and the colour sensor have tested logic but no completed hardware drivers.
- Current boards/screens/demo, the two 60-second videos (version 13) and the two 75-second
  videos (version 12) are refreshed.
  Older editorial crops still need updating; do not label the whole library current.
- The newer image generator sends a reduced pixel grid to the local app server;
  the older relief editor calculates in the browser.

## Research and required notices

Keep private study records outside the repository. Do not name study projects as
feature sources in public copy. Preserve required notices for actual reuse;
review licensing before copying or closely adapting external material.
