# 1 · Multi-nozzle printing

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify. They want features that work every time, built to the
standard of the best tools that have them, not more half-features.

## What the owner wants

The owner loved the headline feature of a $5,000 winner of Snapmaker's
Innovation Fund (Phase 1, Tier 1): **"Full Multi-Nozzle Printing" by LixNix**,
which lets each of the U1's four toolheads print with its own nozzle size
and its own layer height. They want Deja Vu1 to support that way of printing
properly, as a first-class feature, not a footnote.

## What's already known (verified 17 Oct 2026, re-check before relying on it)

- LixNix's slicer is a fork of Snapmaker Orca:
  `github.com/LixNix-Swap-Org/Snapmaker-Orca` (AGPL-3.0; Deja Vu1 is MIT, so
  borrow ideas, never code, and credit it in the README's "Ideas from the
  Phase 1 winners" table). In its `src/libslic3r/PrintConfig.cpp` (commit
  `8fa80da`) each extruder gets `extruder_layer_height` ("Preferred layer
  height"): the object prints on the coarsest shared grid every preferred
  height is a whole multiple of, and a part on a coarse nozzle prints only
  every Nth layer with thicker lines. `extruder_layer_height_exact` keeps the
  entered heights exactly. The same fork also has mixed-filament "cadence"
  dithering options.
- Related forks: MultiOrca (`tragson3-gif/MultiOrca`, experimental, per-tool
  nozzle and layer height) and FOrcaSlicer (`jiyang1018/FOrcaSlicer`: mixed
  nozzle sizes with per-nozzle line width and speed, one shared layer
  height). Upstream OrcaSlicer has open issues about the G-code being tagged
  with the wrong nozzle size when sizes are mixed (#16138).
- The U1's firmware reports each toolhead's real nozzle: Snapmaker's
  `u1-klipper` (commit `10f2f69`, `klippy/kinematics/extruder.py`,
  `get_status`) includes `nozzle_diameter` per extruder, plus `switch_count`.
- Deja Vu1 already reads a file's `nozzle_diameter` and `layer_height` from
  the G-code footer (`backend/gcode_tools.py`) and the 3MF config
  (`backend/converter_3mf.py`), but nothing compares the file's nozzles with
  the printer's.

## What good looks like

You decide the design. Some directions worth weighing, not a checklist:

- Confirm Print refusing (in words) a file sliced for nozzles the printer
  doesn't have fitted on those toolheads; the pre-flight showing each
  toolhead's nozzle and layer height.
- Each toolhead's fitted nozzle visible wherever toolheads are shown, from
  the printer's own report, with the existing "swapped a nozzle" record.
- The converter handling mixed nozzles (today it reads one size and falls
  back to 0.4 mm), and the auto-print slicer bridge and Photo Studio taking
  nozzle sizes into account (today neither mentions nozzles at all).
- Something that helps the owner plan a mixed-nozzle print (which heights
  share a grid, roughly what it saves), if you can make it honest.

Work out what the simulated printers need so all of it can be tried with
**Demo data**, and test against `tests/fake_moonraker.py` for the real path.
Build it to the standard of the slicer forks above, check it in a browser at
desktop and phone width, and keep the README's status table honest about
what hasn't run on a real U1.

Useful skills: `frontend-design` and `liquid-glass-universal` for anything on
screen, `context-efficient` for the session itself.
