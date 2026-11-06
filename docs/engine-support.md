# Slicing engines: what has been run

Deja Vu1 slices with a program you install yourself: Snapmaker Orca or OrcaSlicer
(see [slicing and models](slicing-and-models.md)). This page lists the builds that
were run for real. A row exists only where slices were made with that exact build
on that system and the result is written down in this repository. Everything else
is "not tested", and Deja Vu1 says so when you press **Check slicer**.

## Tested

| Engine | Version | System | Shared layer heights | Per-head layer heights | Evidence |
|---|---|---|---|---|---|
| Snapmaker_Orca | 02.08.01.55 | Linux | Tested | Tested, three nozzle pairs | [slicer workspace validation](slicer-workspace-validation.md), recorded 21 October 2026 |
| OrcaSlicer | 2.4.2 | Linux | Tested | Not available: this build has no per-head height options, so Deja Vu1 refuses those profiles | [native studio validation](native-studio-validation.md), [changelog](../CHANGELOG.md) |

The processor type of the Linux runs was not written down.

## Not tested

- Windows and macOS, with any engine. No slice has been run there.
- Other versions of Snapmaker Orca and OrcaSlicer, including newer releases.
- Other slicers.

Not tested does not block a slice. It means nobody has recorded one. If a slice
fails, the message names the cause and what to try
([when the engine check or a slice fails](slicing-and-models.md#when-the-engine-check-or-a-slice-fails)).

## What the app does about it

- **Check slicer** reads the engine's version and shows "Tested" or "Not tested"
  with what is tested, in Files, Slicing.
- A slice waits for a new check when the engine program was updated, replaced or
  swapped for another since the last check. Deja Vu1 never slices with a program
  whose version it has not read since the file changed.
- A profile with different heights per head is refused unless the engine's own
  exported options show it supports them. There is no fallback to one shared height.

## The standard fixtures

Each fixture passes when the engine exits cleanly, writes G-code with printable
layers and filament use, and pre-flight does not block it.

| Fixture | What it checks |
|---|---|
| `spur_gear_24t.stl` | A small gear: the quick check |
| `twisted_vase.stl` | Curved walls and a spiral |
| `3dbenchy.stl` | The 3DBenchy, 60,000 triangles: a heavier model |

One command runs all three on any system with Python and the engine installed,
using the engine's own U1 presets exported as JSON files. It works in a throw-away
folder and never touches your settings or library:

```bash
python3 tools/engine-fixtures.py --engine /path/to/engine \
    --machine "Snapmaker U1 (0.4 nozzle).json" --process "0.20mm Standard.json" \
    --filament "Generic PLA.json" --json result.json
```

It prints PASS or FAIL for each fixture, why a fixture failed, and a line for the
table above. The test suite runs the tool against a stand-in engine, which proves
the tool and not any build.

## Adding a row

1. Run the fixtures with the build on that system, or slice a sample model in
   the app and press **Copy report**.
2. Add the row to the table above and to `VERIFIED` in `backend/engine_support.py`,
   with the file that records the result as its evidence. A test fails if the two
   lists differ.
3. Say what was not covered. A passing fixture is a slice that came out, not a
   print on a U1.
