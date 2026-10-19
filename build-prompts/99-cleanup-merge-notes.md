# Cleanup pass: merge notes

Temporary, like the rest of this folder. Delete it before the launch post.

This branch is a consistency and wording pass done while a separate session
adds features. It changes no behaviour: the 638 tests passed on this branch
before these notes were written.

## What changed

- **Facts fixed** (the code was checked, then the text made to agree):
  - Confirm Print runs **seven** checks (the nozzle check was missing from
    the docstring, README, product page, board picture and marketing notes).
  - The marketing notes said 608 tests; the suite has 638.
  - The README said Python 3.8 had never been run; GitHub Actions passes on
    3.8, 3.10, 3.12 and 3.13.
  - Four module headers said no real Moonraker client exists.
  - `CLAUDE.md`: the backup holds 5 files (not 4); the stale-docstring item
    is gone; `DEJAVU_NO_BROWSER` is listed.
  - The frontend file count in `docs/architecture.md`.
  - The "What's in it" board said 17 features in its first group (the README
    has 19) and called features "modules".
- **Source references**: no document, comment or screen names another
  project as the origin of a feature any more. The README ends with one
  thank-you line to the community and the Phase 1 winners as a group.
  Facts taken from Moonraker's, Klipper's and Snapmaker's own source are
  kept. `CLAUDE.md` now says other projects are study material only and to
  stop and tell the owner if code is ever copied.
- **Wording**: em dashes removed from the dashboard text, the product page,
  the README, the docs and the code comments. The button "Try the winning
  example" is now "Try an example". Two unused imports removed.
- **Pictures re-rendered**: `docs/img/explainer-confirm-print.jpg` and
  `docs/img/explainer-whats-in-it.jpg` (and their copies in
  `marketing-library/02-explainer-boards/`).

## Likely merge conflicts, and how to merge

Merge the feature branch first. Then merge this branch and resolve in favour
of the feature branch's content, re-applying the wording rules below.

Most likely to conflict:

- `README.md`, `CHANGELOG.md`, `CLAUDE.md`
- `docs/architecture.md`, `docs/real-printer.md`, `docs/getting-started.md`
- `frontend/app.js`, `frontend/workshop.js`, `frontend/index.html`,
  `frontend/welcome.html`, `frontend/style.css`
- `backend/moonraker_client.py`, `backend/layer_planner.py`,
  `backend/print_gate.py`, `backend/mock_moonraker.py`

## A second pass is needed after the merge

New code and text from the feature branch has not been through this pass.
After the merge, re-check:

1. Test count (`python3 -c "import unittest; print(unittest.defaultTestLoader.discover('tests').countTestCases())"`)
   against README, `CLAUDE.md`, `docs/architecture.md`, `welcome.html`, the
   "By the numbers" board and `marketing-library/`.
2. Module count (29 today), sensors (28), maintenance tasks (7), games (10),
   Confirm Print checks (7), environment variables (6 today, listed in
   `CLAUDE.md`).
3. Any new feature: no other project named as its source; no em dashes; the
   README feature tables and the "What's in it" board still agree.
4. The two re-rendered boards, and the boards that quote figures
   (`tools/readme-images/boards.html`).

## Not changed, and why

- Screenshots in `docs/img/` still show the old text (for example the
  footer "Demo data - ..." with an em dash). Re-take them with
  `tools/readme-images/README.md` once the UI work is final.
- The launch videos and the online demo recording were not touched. The
  recording replays recorded server replies, so it keeps old wording until
  it is re-recorded (`python3 tools/online-demo/record.py`).
- `build-prompts/` and `marketing-library/` still name the Phase 1 projects
  in planning notes. Both folders are deleted before launch.
- The README line "Much of the code is written with Claude Code, and every
  change is in the public history" is kept on purpose.
- The "Why it exists" section answers its own questions. That is a pitch
  choice, left alone.
- About 100 decorative section lines in Python files (`# ----- name -----`)
  are left: they mark real sections.

## Paste into the GitHub repository page (the cog next to About)

Description:

> Free, open-source dashboard for the Snapmaker U1: watch every printer
> live, start prints from your phone behind a server-checked safety check,
> convert MakerWorld/NexPrint/Orca projects for the U1, and get alerts.
> Runs on your own network, Python only.

Topics: `snapmaker`, `snapmaker-u1`, `moonraker`, `klipper`, `3d-printing`,
`print-farm`, `dashboard`, `toolchanger`.

## Decisions for the owner

- Keep or remove the one-line thank-you in the README ("Thanks").
- The README still says the plan is to enter Phase 2 "partly to request a
  unit". Decide if you want that sentence public before you post.
