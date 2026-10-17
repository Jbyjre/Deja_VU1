# 1 · Make everything work, every time

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

Every feature in Deja Vu1 behaves the same way every time, fails in words
instead of silently, and is a little smarter than it has to be.

## What's known

- `CLAUDE.md` → **Known open issues** lists what the October 2026 audit
  found and didn't fix: module switches that don't stop background work
  (automation rules, queue auto-advance, time-lapse, filament deduction), a
  config backup that misses most settings and has no restore, a refused
  real-printer start that erases the last finish summary, an unhelpful
  "Unauthorized" when the API key is missing, a simulated cancel with no
  history entry, a heater fault that makes a dock ring read "ready", an
  unused change listener, an unreachable `clear_error()`, and stale
  docstrings. (The port-range bug is fixed.)
- The audit never reached these end to end: **automations, the 3MF
  converter, the auto-print slicer bridge, Photo Studio, the print queue
  and the camera**. Nobody has tried to break them.
- `frontend/app.js` defines `initGames`, `renderGame`, `startCurrentGame`
  and `stopCurrentGame` twice, and may still carry code and styles for
  games the picker no longer offers. Confirm before removing.

## Directions, not steps

Fix every known issue, each with a test that fails on the old code
(`tests/test_audit_fixes.py` holds the audit's). Then use each unaudited
feature the way an owner would, with **Demo data** on and against
`tests/fake_moonraker.py`, and try to break it: odd files, a printer going
away mid-action, two browsers at once, a module switched off, a phone.
Compare each with the best dedicated tool for the job (Home Assistant
automations, OrcaSlicer's project loading, HueForge, OctoPrint or Fluidd
camera handling, Spoolman) and close the gaps that would cost an owner a
print or their trust.

"Smarter" is yours to define. Ideas the owner would welcome: the dashboard
noticing things before it's asked (a spool that won't last the print, a
maintenance task due mid-job, a printer that has been "Connecting" too
long, a file sliced for the wrong printer), and saying what to do next. For
the backup, think about what someone restoring onto a new computer needs.

When you're done: issues off the list in `CLAUDE.md`, README "Current
status" honest, `docs/architecture.md` matching the code, and the online
demo re-recorded (`python3 tools/online-demo/record.py`) if screens or
routes changed.
