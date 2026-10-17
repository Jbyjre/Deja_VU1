# 5 · multiACE and 16 colours

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify.

## What the owner wants

Strong features from the other projects in Snapmaker's Innovation Fund,
brought into Deja Vu1 and working every time. One of the three Phase 1
Tier 1 winners ($5,000 each) is **multiACE by decay71**
(`github.com/decay71/multiACE`), which connects up to four Anycubic ACE Pro
or ACE 2 filament units to a U1, so one print can use many more than four
filaments. (Reported by Snapmaker's announcement and press coverage; read
the project's own source to confirm.)

## Where things stand

Deja Vu1 knows the U1 has four toolheads, T0 to T3. Today it only tells
multiACE users that files using T4 to T15 need multiACE's post-processing
first (credited in the README's "Ideas from the Phase 1 winners" table).
FOrcaSlicer (`github.com/jiyang1018/FOrcaSlicer`) has a multiACE section in
its README describing supply modes and a "Read from printer" step; that's
another source to learn from.

## The work

Find out from multiACE's own source what it adds to the printer: what
Moonraker or Klipper objects it exposes, how a slot maps to a toolhead, what
a sliced file looks like, what can go wrong mid-print (runout, a stuck feed,
a unit going offline). Then decide what Deja Vu1 should do with it. Some
directions worth weighing: every ACE slot's filament shown beside the
toolheads; Confirm Print checking all the colours a file needs, not just
four; runouts and feed errors in **Needs you** and automations; the digital
twin showing the units. Build what's worth building, to the standard of
multiACE itself, with simulated ACE units so it works with **Demo data**,
and tests against a stand-in built from multiACE's source (the way
`tests/fake_moonraker.py` was built from Moonraker's).

multiACE's licence decides what you may reuse: Deja Vu1 is MIT, so if it's
GPL or non-commercial, take ideas only and credit them. Nobody here has an
ACE unit; say so wherever it matters.

Useful skills: `frontend-design` and `liquid-glass-universal` for the
screens, `context-efficient` for the session itself.
