# 4 · Send each job to the right printer

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them (up to 12 printers). Read
`CLAUDE.md` first; its rules apply. The owner isn't a programmer: explain
what you did in plain words, verify every fact before you state it, and say
plainly what you couldn't verify.

## What the owner wants

The app's lead promise is now **"One screen for every U1 you run."** The
owner wants features strong enough to back that up, as capable as the
dedicated farm tools, and working every time.

## Where things stand

Today each printer has its own queue (`backend/print_queue.py`), every queued
file passes Confirm Print before it starts (`backend/print_gate.py`), you can
drag a file onto a printer to queue it there (`fleet.route_file` in
`backend/fleet.py`), and the Fleet tab can command several printers at once.
What's missing is the step a farm owner actually wants: **put a job in one
farm-wide list and let Deja Vu1 start it on a printer that can print it**:
idle, healthy, with the right filament colours and materials loaded on the
right toolheads (and, once prompt 1 lands, the right nozzles), maintenance
not overdue.

## The work

Design and build that, to the standard of the tools that already do it.
Look at how farm tools handle job routing (for example Printago, which
documents connecting Snapmaker printers, and OctoFarm or SimplyPrint), and
verify what they do from their own docs before you borrow an idea; credit
it in the README. You decide the rules, the screens and the order. Some
questions you'll have to answer well: what happens when no printer fits, how
an owner sees why a job is waiting, how a job that the printer refuses
comes back, what "the right filament" means when colours are close, and
how it behaves when the owner overrides it.

It must work with the simulated farm (**Demo data**, and the farm sandbox's
scripted problems in `backend/sandbox.py`) and against
`tests/fake_moonraker.py`. Every start still goes through Confirm Print on
the server. Test it in a browser at desktop and phone width, and keep the
README's status table honest.

Useful skills: `frontend-design` and `liquid-glass-universal` for the
screens, `context-efficient` for the session itself.
