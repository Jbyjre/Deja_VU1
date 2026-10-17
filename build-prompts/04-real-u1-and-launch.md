# 4 · On a real U1, then launch

Copy everything below the line into a new Claude Code session on this repository. Run it last.

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

A U1 owner can install Deja Vu1 without help, the first real connection
happens, and the repository is ready to post publicly.

## What's known

- Deja Vu1 has never talked to a physical U1. `docs/first-connection.md`
  (linked from the README) asks owners for a watch-only test.
- Today it runs on a separate computer: double-click starters
  (`start.py` and wrappers), `docs/getting-started.md`, **Find printers on
  my network** (mDNS `_snapmaker._tcp` from u1-moonraker, then port 7125)
  and **Test** before adding. The Windows and Mac starters haven't been run
  on those systems.
- The README roadmap lists packaging as a Moonraker component that installs
  next to Fluidd or Mainsail and updates through Moonraker's update
  manager. **U1 Extended Firmware by paxx12**, another Phase 1 winner, is
  reported to add SSH, camera streaming and metrics: find its repository
  and confirm what it really does.
- The public Cloudflare link (`wrangler.jsonc`) serves the product page
  and, at `/?demo`, the online demo (a recording of the simulated farm;
  `tools/online-demo/record.py`). It hadn't been opened on the published
  site when this was written.
- Two folders are temporary: `marketing-library/` (pictures plus
  `MESSAGING.md`) and `build-prompts/` (these prompts).
- `marketing-library/` is behind the app. Apart from the launch videos in
  `07-videos/`, its pictures and `MESSAGING.md` (feature order, paste-ready
  text, a test count of 608) predate the 17 October work: the clickable
  twin, the mixed-nozzle planner, Find printers, Studio tone fitting and
  the online demo. The current pictures are in `docs/img/`. Treat
  `docs/img/` and the README as the source, not the library.

## Directions, not steps

First, the real-printer side: the install paths that are safe for a
printer owner (a separate computer or Pi, next to Moonraker on the printer,
through the update manager), with updates, uninstall and what to send back
when something's wrong, written for non-programmers and tested as far as a
container and `tests/fake_moonraker.py` allow. Mark every step only a real
U1 can confirm. Nothing may start, stop or change a print during a first
connection unless the owner asks.

Then launch: regenerate every picture and the online demo recording from
the app as it is (`tools/readme-images/README.md`), update every figure the
boards quote, read the README and `welcome.html` against the code (run the
`stop-slop` skill over the prose), check every link, open the published
link's `/?demo` if you can reach it, run the full suite, and give the owner
the exact clicks for what only they can do on GitHub (About text and
topics, the social preview image). Ask before deleting the two temporary
folders. Finish with a short list of anything not ready to post, and why.
