# 2 · More colours, more nozzles, the whole farm

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of up to 12. Read `CLAUDE.md` first: its
rules apply, and its "How to work here" section is the method that has
worked (checklist, primary sources, Playwright screenshots, one commit per
feature, docs updated). The owner isn't a programmer: explain what you did
in plain words, verify every fact before you state it, and say plainly what
you couldn't verify. What the owner wants, in their words: a ton of
features that work all the time, as strong as the dedicated apps and repos
that each do one of these things, not a ton that work a quarter of the
time. You have a lot of freedom in how you get there.

## The goal

Deja Vu1 handles the prints that make a U1 farm worth having: many
filaments, mixed nozzles, and jobs that go to the right printer by
themselves.

## What's known (17 October 2026; re-check before relying on it)

- **Mixed nozzles are partly done.** The mixed-nozzle planner
  (`backend/layer_planner.py`, Files tab), Confirm Print's nozzle check,
  and each toolhead's fitted nozzle and swap counts from u1-klipper's
  `extruder.get_status` exist. Not done: the 3MF converter still reads one
  nozzle size and falls back to 0.4 mm; the auto-print slicer bridge and
  Photo Studio don't consider nozzles at all. The idea comes from LixNix's
  "Full Multi-Nozzle Printing" (`LixNix-Swap-Org/Snapmaker-Orca`, AGPL:
  ideas only, credit in the README's winners table). Upstream OrcaSlicer
  issue #16138 says mixed sizes can be tagged wrongly in G-code: check it.
- **multiACE** by decay71 (`github.com/decay71/multiACE`), another ,000
  Phase 1 winner, connects up to four Anycubic ACE units to a U1 for up to
  16 filaments. Deja Vu1 today only warns that files using T4-T15 need
  multiACE's post-processing. FOrcaSlicer's README describes its supply
  modes too. Read multiACE's own source for what it exposes to Moonraker
  and Klipper, and check its licence before reusing anything.
- **Farm routing.** Each printer has its own queue, every start passes
  Confirm Print on the server, and you can drag a file onto a printer.
  Missing: one farm-wide list where Deja Vu1 starts each job on a printer
  that can print it (idle, healthy, right filaments and nozzles, nothing
  overdue). Printago, OctoFarm and SimplyPrint do this; read their docs.
- **Photo Studio** now fits a photo's tones to the filaments and drops
  pointless swaps. HueForge is the standard to compare it with.

## Directions, not steps

You decide what to build and in what order. Questions worth answering well:
what happens when no printer fits a job, how an owner sees why a job waits,
what "the right filament" means when colours are close, how a runout on an
ACE slot reaches **Needs you**, and what the twin should draw for ACE units.
Simulate whatever needs hardware nobody here has (ACE units, mixed nozzles)
so it all works with **Demo data**, and build stand-ins from each project's
own source for tests, the way `tests/fake_moonraker.py` was built. Say
plainly that nobody here has an ACE unit or has printed a mixed-nozzle file.
