# 7 · Install on a real U1

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify.

## What the owner wants

Everything fully functional before the repository is posted publicly. The
biggest gap is that Deja Vu1 has never talked to a physical U1: the owner
doesn't own one, and the project relies on U1 owners for a first real
connection (`docs/first-connection.md`, linked from the README). The easier
it is for an owner to install and try, the sooner that happens.

## Where things stand

Today you run Deja Vu1 on your own computer with `python3 backend/app.py`
and add a printer by its Moonraker address (`docs/real-printer.md`). The
README's roadmap lists "package as a proper Moonraker component so it
installs alongside Fluidd or Mainsail". Snapmaker published their own
Moonraker and Klipper forks for the U1 (`Snapmaker/u1-moonraker`,
`Snapmaker/u1-klipper`; the commits the code was written against are in
`docs/real-printer.md`). Another Phase 1 Tier 1 winner, **U1 Extended
Firmware by paxx12**, is reported to add SSH access, debugging, camera
streaming and printer metrics; find its repository and confirm what it
really does before relying on it.

## The work

Find out, from those sources, the realistic ways an owner can run Deja Vu1:
on a separate computer or Raspberry Pi (today), next to Moonraker on the
printer itself (with or without the extended firmware), or through
Moonraker's update manager so it updates with everything else. Pick the
paths that are safe for a printer owner (nothing that risks the printer's
own software) and make them work: an install that a non-programmer can
follow, updates, uninstall, and what to send back when something's wrong.
Make the first-connection checklist fit whatever you build.

You decide the approach. Test every step you can in a container or against
`tests/fake_moonraker.py`, and mark plainly every step that only a real U1
can confirm. Nothing should ever start, stop or change a print during a
first connection unless the owner asks.

Useful skills: `context-efficient` for the session itself; `frontend-design`
for anything on screen.
