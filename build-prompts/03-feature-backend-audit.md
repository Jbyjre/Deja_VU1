# 3 · Make every feature work every time

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify.

## What the owner wants

In their words: an app with a ton of features that work all the time, as
powerful as the apps and repos that each do one of these things, not a ton
of features that only work a quarter of the time. Go the extra mile.

## The work

The October 2026 audit ran out of usage before it reached several features,
so nobody has checked them end to end (`CLAUDE.md`, last item under "Known
open issues"): **automations, the 3MF converter, the auto-print slicer
bridge, the Photo-to-Print Studio, the print queue and the camera**, plus
`docs/architecture.md` beyond its frontend section.

For each one, use it the way an owner would, in a browser with **Demo
data** on and against `tests/fake_moonraker.py`, and try to break it:
odd files, a printer going away mid-action, two people at once, a module
switched off, a phone. Compare it with the best dedicated tool for the
same job (for example Home Assistant automations, OrcaSlicer's own
project loading, HueForge, Spoolman, OctoPrint/Fluidd camera handling) and
note where Deja Vu1 falls short in ways that matter.

Fix what's broken, with a test that fails on the old code. For gaps that
are features rather than bugs, build the ones that are clearly worth it and
list the rest for the owner with a one-line reason each. You decide the
order and how deep to go on each; spend the effort where an owner would
lose a print or lose trust. Update `docs/architecture.md` and the README so
they match what the code does, and keep "Current status" honest about what
hasn't run on a real U1.

Useful skills: `frontend-design` for anything on screen, `context-efficient`
for the session itself.
