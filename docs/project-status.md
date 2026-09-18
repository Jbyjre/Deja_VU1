# Project status

A single, thorough snapshot of Deja Vu1: what it is, what's been asked for,
what's built, what the owner prefers, and what's next. Written so a new
session — human or AI — can pick this project up without re-deriving any of
it from chat history. Updated 2026-09-18.

## What this project is

Deja Vu1 is a Moonraker dashboard and companion app for the Snapmaker U1
3D printer, built as an application to the **Snapmaker U1 Innovation Fund**
(Phase 1 closed Sept 7 2026; target is Phase 2, opens Oct 1 2026). The
owner does not currently own a U1 — this project is partly a request for
one. Everything runs against a simulated Moonraker layer
(`backend/mock_moonraker.py`); no real printer has ever been contacted.
Repo: `github.com/Jbyjre/Deja_VU1`.

Hard constraints, honored throughout: **zero dependencies**. Backend is
Python 3.8+ standard library only (`http.server`, no Flask/FastAPI).
Frontend is vanilla HTML/CSS/JS — no framework, no build step, no webfonts,
nothing fetched from the internet at runtime.

## Who's asking, and how they want to work

The owner (Jake) has no coding background — technical terms need to be
explained in plain language, not assumed. Standing behavioral rules that
apply for the rest of this project, established explicitly and repeatedly:

- **Never assume — always verify.** Don't guess at ambiguous instructions
  (an unclear product/platform name, an unclear "try again") — ask, or
  research, rather than proceed on a guess.
- **Don't stonewall on feature requests.** When a clear feature is asked
  for, build it — don't ask clarifying questions as a way to avoid
  building, don't scope-trim what was asked for down to something smaller.
  Reasonable interpretive calls on ambiguous *details* are fine and
  expected; refusing or deferring a clearly-stated feature is not.
- **Be context-efficient.** Usage isn't unlimited — avoid unnecessary
  re-reads, redundant verification loops, and bloated output. Reuse
  information already established rather than re-deriving it.
- **Be supportive, not condescending**, and explain coding concepts simply
  when they come up.
- **Never subscribe this session to PR/notification activity.** Standing
  instruction as of this doc — no `subscribe_pr_activity`, no recurring
  check-in triggers, on this or future PRs, unless explicitly asked again.
- Screenshots/claims about what the app does should be **verified**, not
  asserted — this project's working pattern has been to check real
  behavior with Playwright rather than trust that code "should" work.

## What's been built, in the order it was asked for

1. **Research phase** — summarized project status, researched the
   Innovation Fund's other 66 Phase-1 submissions for feature ideas and
   competitive differentiation, researched "AI slop" visual design tells
   (purple/blue gradients, generic `rounded-lg` cards, Inter/Space
   Grotesk) to explicitly avoid them.
2. **Apple Liquid Glass redesign** — light theme (not the project's
   original dark theme), five real layers: backdrop blur, edge refraction
   via an SVG displacement filter (not just blur), a pointer-tracked
   specular highlight, a bright rim, elevation shadow. Brand-specific
   accent (`#ff7a2f`, "Snapmaker Orange") and bespoke ring motifs instead
   of generic decorative blur blobs.
3. **Full backend build-out** (13 real Python modules, all tested):
   maintenance reminders, printer control (pause/resume/cancel/temp/home/
   gcode), priority-aware notifications (ntfy/Discord/Telegram, quiet
   hours), filament inventory, "what changed?" + likely-cause pattern
   matching, pre-print sanity check, update checker, config backup,
   camera freeze watchdog, phone pairing (no login wall), print cost
   calculator, a WLED bridge, and a Home Assistant bridge. Every module
   has a server-enforced on/off switch (`modules.py`) — disabling one
   returns HTTP 403 on its routes, not just a hidden UI element.
4. **"No printer, no figures" rule**, enforced server-side: printer-data
   routes return `{"connected": false, "demo": false}` with nothing else
   unless a real printer is connected or `?demo=1` is explicitly
   requested. Settings/pairing/module routes are never gated by this,
   since they aren't printer data.
5. **Six-tab frontend** (Overview, Printer control, Maintenance, Filament
   & colour, Modules & devices, While you wait) wired to every backend
   route, with a status ribbon pinned across all six tabs so a print is
   never missed mid-game.
6. **Six games** in "While you wait," rebuilt and hardened across several
   rounds of feedback:
   - **Sky Dash** — gravity-dodge, difficulty ramps with score (faster
     obstacles, tighter gap).
   - **Echo Maze** — a real CSS 3D maze (no canvas/WebGL), 7×7, fog-of-war
     minimap that only remembers visited rooms.
   - **Block World** — free-roam 3D voxel mining/building game,
     Minecraft-inspired (not a clone): procedurally generated terrain
     with real extruded CSS cube geometry, mine ore/wood, spend wood to
     place your own blocks, new chunk each level.
   - **Block Stacker** — speeds up with height.
   - **Merge Puzzle** — 2048-style, harder tile draws at higher score.
   - **Brick Break** — clearing the board advances a level instead of
     ending (shrinking paddle, faster ball, more bricks) rather than
     stopping at "Cleared!".
   - **Current owner verdict on the games: not good enough yet** — see
     "Known gaps" below. A standalone handoff prompt for a dedicated pass
     on the games lives at `docs/games-improvement-handoff.md`.
7. **Mobile/touch fixes** — `touch-action: none` on game surfaces (a
   touch-drag was previously being captured as a page-scroll instead of
   reaching the game), plus a stray-touch release safety net for Block
   World's hold-to-move buttons.
8. **An interactive artifact** — not a slideshow explainer, but the real
   `frontend/app.js` and `frontend/style.css` running unmodified against
   an in-page mock of the backend, so the whole app (all 6 tabs, all 6
   games) is clickable in a shareable link without a server running.

## Current technical status

- **170 backend tests passing** (`python3 -m unittest discover tests`),
  one file per module plus `test_api.py`, which starts the real server on
  a spare port and tests what a browser would actually receive (module
  gating, connection gating, the no-printer-no-figures rule).
- **Zero dependencies**, confirmed — nothing to `pip install` or `npm
  install` to run the real app.
- **PR #3** ("Add printer control, mobile pairing, notifications,
  filament tracking, and games") — opened, driven to green, and
  **merged into `main`** as of this status update. It carried the entire
  build described above, including every follow-up round (harder games,
  Block World, cost calculator, bridges, touch fixes).
- This branch (`claude/jolly-lamport-rxyikv`) was restarted from `main`
  after that merge, per the project's own convention for follow-up work
  on an already-merged branch.
- No CI is configured in this repository (0 GitHub Actions check runs on
  the last PR) — "driving a PR green" here has meant: tests pass locally,
  no merge conflicts, no unresolved review threads.

## Known gaps / explicitly deferred

Named and consciously not built, to avoid ever presenting these as done:

- **Real printer connection.** Everything is demo/mock data. Swapping
  `backend/mock_moonraker.py` for a real Moonraker HTTP client is the
  only change needed per the architecture, but it hasn't been done — no
  U1 is available yet.
- **LED dock rings and colour-check hardware.** Decision logic and
  console simulations are complete and tested; the physical driver code
  is not written (see `docs/hardware-modules.md`).
- **Multi-printer fleet management** — explicitly ruled out as out of
  scope for this pass.
- **Import-compatibility check** for slicer-converted files — roadmap
  item, not built.
- **Chamber climate monitoring** — roadmap item, not built.
- **The games, as the owner currently rates them.** Structurally real
  (each is a genuine playable game with persisted best scores, difficulty
  curves, and — for Block World — real CSS 3D geometry), but per direct
  owner feedback as of this status update they are **not good enough**:
  not realistic enough, not smart enough, not fun enough to hold up as a
  standout feature. This is the single biggest open item. A dedicated
  handoff prompt for an AI session whose *only* job is improving the
  games is at `docs/games-improvement-handoff.md` — do not fold games
  work into unrelated changes; keep it scoped there.

## Where things live

- `backend/` — one Python file per feature module; `app.py` is the HTTP
  server and route table (its own docstring lists every endpoint).
  `modules.py` is the on/off registry.
- `frontend/` — `index.html` (all 6 tab panels), `style.css` (the Liquid
  Glass system + all game visuals), `app.js` (all data loading, all 6
  games).
- `tests/` — one file per backend module, plus `test_api.py`.
- `docs/architecture.md` — how the pieces fit together, the CSS 3D
  techniques used, how to swap in a real printer.
- `docs/hardware-modules.md` — parts lists, wiring, non-invasive design
  constraint for the two hardware-pending modules.
- `docs/project-status.md` — this file.
- `docs/games-improvement-handoff.md` — standalone prompt for the next
  games-only work session.

## What's next

1. Hand `docs/games-improvement-handoff.md` to a session whose only job
   is making the six games genuinely good — realistic, well-tuned,
   smarter where that applies.
2. If/when U1 hardware access is granted, replace the mock Moonraker
   layer with a real HTTP client (the one-file swap the architecture was
   built around).
3. Revisit the explicitly-deferred roadmap items above if there's reason
   to prioritize any of them for a future Fund phase.
