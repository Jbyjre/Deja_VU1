# 2 · Fix the known open issues

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify.

## What the owner wants

An app with many features that work every time, not many features that work
a quarter of the time. The project is about to be posted publicly, and every
known bug should be gone before that.

## The work

`CLAUDE.md` has a section, **Known open issues**, listing what the October
2026 audit found and didn't fix: module switches that don't stop background
work, a config backup that misses most settings and has no restore, a
refused real-printer start that erases the last finish summary, ports
outside 1-65535 accepted, an unhelpful message for a missing API key, a
simulated cancel with no history entry, a heater fault that makes a dock
read "ready", an unused change listener, an unreachable `clear_error()`,
and docstrings that still say no real Moonraker client exists.

Fix every one, or, where a fix needs a real U1 to confirm, make the code
correct against Moonraker's, Klipper's and Snapmaker's source and say so.
Two small leftovers found while merging on 16 October are worth a look too:
`frontend/app.js` defines `initGames`, `renderGame`, `startCurrentGame` and
`stopCurrentGame` twice (the later definitions win), and it still carries
code and `style.css` rules for games the picker no longer offers (Echo
Maze, Block World). Confirm what's dead before removing it.

You decide the order and the approach. Each fix gets a test that fails on
the old code (`tests/test_audit_fixes.py` is where the audit's regression
tests live). When an issue is fixed, take it off the list in `CLAUDE.md`,
and keep the README's "Current status" honest. For the backup, think about
what an owner restoring onto a new computer actually needs back.
