# Slicing engines: what has been run

Deja Vu1 slices with a program you install yourself: Snapmaker Orca or OrcaSlicer
(see [slicing and models](slicing-and-models.md)). This page lists the builds that
were run for real. A row exists only where slices were made with that exact build
on that system and the result is written down in this repository. Any other build
still slices, and the engine card in the Slicer shows which builds have recorded runs.

## Tested

| Engine | Version | System | Shared layer heights | Per-head layer heights | Evidence |
|---|---|---|---|---|---|
| Snapmaker_Orca | 02.08.01.55 | Linux | Tested | Tested, three nozzle pairs | [slicer workspace validation](slicer-workspace-validation.md), recorded 21 October 2026 |
| Snapmaker_Orca | 01.10.01.50 (the v2.4.1 release the Slicer installs) | Linux | Tested | Not available: this build has no per-head height options | [The engine Deja Vu1 installs](#the-engine-deja-vu1-installs), recorded 22 November 2026 |
| OrcaSlicer | 2.4.2 | Linux | Tested | Not available: this build has no per-head height options, so Deja Vu1 refuses those profiles | [native studio validation](native-studio-validation.md), [changelog](../CHANGELOG.md) |

The processor type of the Linux runs was not written down.

## Next to record

- Windows and macOS builds. On Windows, the engine check reads the version from the engine's settings
  file because the engine prints `--help` to a console window; the suite tests that route with a
  stand-in engine.
- Other versions of Snapmaker Orca and OrcaSlicer, including newer releases.
- Other slicers.

## Reported, not yet explained

- **Snapmaker Orca 2.4.1 on Windows 11** (a tester's computer, November 2026): a slice ended with exit
  code 4294967196, which is Orca's own error number -100 (Windows reports a negative exit code as an
  unsigned 32-bit number; macOS and Linux report its low byte, 156). In Orca's command-line source -100
  is the slicing error, raised for example when a plate has empty layers or overlapping toolpaths, and
  Orca writes `result.json` only on Linux, so on Windows the exit code and the printed text are all there
  is. That report kept only Orca's closing line (`Slic3r::CLI::run found error`), which announces the
  exit and does not say why, so the cause of that failure was not known then. A Linux run of the same release on 22 November 2026 produced the same code (-100) and the same
  engine message ("Object can't be printed for empty layer") for the cause described under "What was run" above, and the fix is in; the Windows
  report is probably the same fault, but no Windows run has confirmed it. Deja Vu1 now maps the exit code
  back to -100, shows the lines Orca printed before its closing line, and keeps the engine's whole
  output in the tester report. No Windows run has been recorded as working, so there is no Windows row
  above.

These builds slice like the tested ones. A row gets added once someone records a run. If a slice
fails, the message names the cause and what to try
([when the engine check or a slice fails](slicing-and-models.md#when-the-engine-check-or-a-slice-fails)).

## The engine Deja Vu1 installs

The Slicer's **Install engine** button downloads Snapmaker's own release and nothing else. What that means, and what has and has not been run:

- **Which file.** The newest stable release of `Snapmaker/OrcaSlicer` for this computer, chosen by name from the release's own file list:
  `Snapmaker_Orca_Linux_AppImage_Ubuntu2404_V<version>.AppImage` (64-bit Intel and AMD Linux only; Snapmaker publishes no ARM build),
  `Snapmaker_Orca_Windows_V<version>_portable.zip` or `Snapmaker_Orca_Mac_universal_V<version>.dmg`. Only https, and only github.com and
  the `githubusercontent.com` hosts its downloads redirect to.
- **Is it the file Snapmaker published.** For v2.4.1 the files were downloaded and hashed on 21 November 2026 and their SHA-256 values are
  recorded in `backend/engine_installer.py` (`PINNED`): Linux 137,423,352 bytes `2b5117e2…cc06`, Windows 175,353,541 bytes `1f002e21…8c9d`,
  macOS 274,143,110 bytes `7a590830…815f`. A pinned release is always checked against the pin, even if a release list says otherwise. A newer
  release is checked against the `digest` GitHub lists for the file. With neither, the file is refused unless you press **Install anyway**, and
  it is recorded as unverified. Size is checked too.
- **How it is installed.** Downloaded to a working folder, unpacked into a staging folder (the Windows zip with path, size and entry limits;
  the Linux AppImage with its own `--appimage-extract`, which needs no FUSE; the macOS disk image mounted read-only and the app copied out),
  started once to read its version, and only then renamed into place and made current. A failed or cancelled install leaves the engine that
  worked. Under `<data>/engine/`; slicing with it uses `--datadir <data>/engine/engine-data`, so a Snapmaker Orca or OrcaSlicer you installed is
  never read or changed.
- **What was run.** `tests/test_engine_installer.py` runs the whole install (download, checksum, unpack, check, update, cancel, a bad
  archive, a bad engine, a wrong or missing checksum) against a local stand-in release server and a stand-in engine. The real files were
  downloaded and hashed, and the Windows zip's contents were listed (`snapmaker-orca.exe` at the top of `Snapmaker_Orca_Windows_V2.4.1_portable`,
  its `resources/profiles/Snapmaker` presets, 11,333 files, about 396 MB unpacked). **The real engine was first run on 22 November 2026**, on Ubuntu 24.04 (Linux, 64-bit Intel): the Linux AppImage
  (137,423,352 bytes, SHA-256 equal to the pin) unpacked with `--appimage-extract` to a `bin/snapmaker-orca` program, which needed
  `libwebkit2gtk-4.1-0` and `libegl1` installed before it would start (the missing-library advice names these), then printed `Snapmaker_Orca-01.10.01.50`
  as its version. `python3 tools/engine-selftest.py` ran 9 of 9 steps: help line, the engine's U1 presets (8 print presets, machine
  `Snapmaker U1 (0.4 nozzle)`), the working profile, a slice of the 3DBenchy through the app's plate project (240 layers, 0.53 h, 12.08 g, in 6.4 s),
  the line types the Preview reads, and the engine's own arrange and orient exports. The gear, the vase and the bracket sliced the same way. That
  run found a fault in Deja Vu1 itself: the plate project stored every triangle with three private corners, which the engine read as a surface in loose
  pieces ("empty layer between 0 and 2.05", exit code -100), so everything except a part with whole-number corners failed to slice. Triangles
  that meet now share their corners (`tests/test_plate_project.py`). In the engine's exported arrange and orient the Benchy's origin sits at the middle
  of its height (z 24.0 for 48 mm). **Not run:** the Windows and macOS installs, and the installer's own download and unpack on any system (the run
  fetched the same file by hand because the release list's address was not reachable from that sandbox).
- **The plate's drawing.** Snapmaker Orca ships the U1's plate model and texture under the AGPL-3.0, so Deja Vu1 does not copy them. It draws its
  own plate from measurements of the engine's bed model (a 0.5 mm sheet, 276 × 293 mm, a straight back edge, straight sides and a narrower front
  edge that widens through chamfers; the printable area is 270 × 270 mm from x 0.5, y 1; 270.05 mm tall) with its own lettering, ruler and
  brackets. The printer's name is shown because the real plate carries it; it says nothing about who made Deja Vu1.
- **The prime tower's place.** The Slicer draws the tower with its left-front corner at the engine's default (x 15, y 220 mm), the convention
  Orca inherited from PrusaSlicer. The Preview draws the tower the engine really printed; a difference between the two would be a bug to report.

## What the app does about it

- The engine check (run by the Slicer the first time it finds an engine, and by the engine card) reads the
  engine's version and shows "Tested" for a recorded build, or "Ready to slice" with the builds that have
  recorded runs.
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
