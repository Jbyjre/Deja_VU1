# Handoff prompt: make the "While you wait" games actually good

Paste everything below this line to a fresh AI coding session as its task.

---

## Your task

You are working on **Deja Vu1**, a Moonraker dashboard for the Snapmaker
U1 3D printer (`github.com/Jbyjre/Deja_VU1`). It has a "While you wait"
tab with six mini-games for while a print runs. **The owner has said
plainly that the games are not good enough** — not realistic enough,
don't function well enough, aren't smart enough. Your **only** job is to
fix that: make the six existing games genuinely good — better feel,
better logic, more depth, more polish. Read this whole document before
touching code; it tells you exactly what you may and may not change.

## Scope — read this twice

**In scope:** anything inside `frontend/app.js`'s games section (roughly
from the `/* ==== Games ==== */` header near line 900 to the end of the
file) and the corresponding game-only CSS classes in `frontend/style.css`
(the `/* Games */` section near line 736 onward, including per-game
blocks: Sky Dash, Echo Maze, Block Stacker, Merge Puzzle, Brick Break,
Block World/`beacon-*`/`voxel-*`). You may also touch the games tab's
markup in `frontend/index.html` (`<section id="tab-games">`) if a game
genuinely needs new DOM structure.

**Out of scope — do not touch:** `backend/` entirely (no game reads or
writes printer data — that's an intentional, tested rule, not an
oversight), any other frontend tab or its JS/CSS, `tests/`, `README.md`,
`docs/` other than noting your own changes if asked. If you think a game
needs something outside this boundary, stop and flag it rather than
crossing it.

## The six games today (what exists, so you don't rediscover it)

All defined in `frontend/app.js`. Dispatch table: `renderGame(name)` maps
`skydash|echomaze|beacon|stacker|merge|breakout` to
`initSkyDash|initEchoMaze|initBeacon|initStacker|initMerge|initBreakout`.
Only one game runs at a time; `stopCurrentGame()` clears the active
interval and removes that game's event listeners — **any new game or
input method you add must register its cleanup here too**, or switching
games/tabs will leak listeners.

1. **Sky Dash** (`initSkyDash`) — flappy-bird-style gravity dodge. Click
   to flap, difficulty ramps via `speedFor(score)`/`gapFor(score)`.
2. **Echo Maze** (`initEchoMaze`) — a real CSS 3D maze, 7×7, rendered
   with `rotateY`/`translateZ` cube walls (no canvas/WebGL). Turn/move
   buttons, fog-of-war minimap (`maze.visited` Set).
3. **Block World** (`initBeacon`, internal id stays `beacon` — don't
   rename the id, only the label, unless you have a reason to touch
   `localStorage` key migration too) — the newest and most complex: a
   free-roam 3D voxel chunk. Real extruded CSS cubes (`renderVoxel`
   helper: one flat top face + rotated side faces only toward a lower
   neighbor tile). WASD/arrows + on-screen hold buttons to move/turn,
   mine ore/wood, spend wood to place blocks (`place()`), new procedural
   chunk (`buildTerrain`, a cheap sine/cosine pseudo-noise, not real
   Perlin) each level with a countdown timer.
4. **Block Stacker** (`initStacker`) — falling/swinging block stack,
   speeds up with height.
5. **Merge Puzzle** (`initMerge`) — standard 2048 clone, arrow keys +
   on-screen buttons, tile-4 spawn chance increases with score.
6. **Brick Break** (`initBreakout`) — paddle/ball, pointermove to steer.
   Clearing the board advances a level (smaller paddle, faster ball, one
   more brick row, capped at `ROWS_MAX`) instead of ending.

Shared plumbing you should reuse, not duplicate: `readBest(key)` /
`saveBest(key, value)` (localStorage, wrapped in try/catch), `$(id)`,
`esc()`, `gameLoopHandle` (the one active `setInterval`),
`trackHighlights()` (pointer-tracked specular highlight on `.liquid-glass`
— don't fight it).

## What "not good enough" means — read the actual prior feedback

Across this project's history the owner has repeatedly rejected
first-pass games as "terrible," "boring," told the previous session not
to "be lazy," and most recently said the games "still suck" and asked for
them to be "more realistic," to "function better," and to be "smarter."
Take that at face value: shallow arcade clones with a difficulty
multiplier bolted on are not sufficient. You are expected to substantially
rework mechanics, feel, and depth — not just retune numbers.

Concretely, look hard at:

- **Physics/input feel.** Does movement feel responsive and readable, or
  stiff and arbitrary? Sky Dash and Brick Break in particular are simple
  enough that feel is everything — acceleration curves, collision
  forgiveness, visual feedback on hit/miss.
- **Actual intelligence, where it fits.** None of the six games currently
  have any adaptive or AI-driven behavior beyond a static difficulty
  formula. Consider genuine smarts where a game calls for it — e.g. an
  opponent, a pathfinding element, a procedural generator that reacts to
  player skill rather than just player score/level count.
- **Depth and replay value**, not just a harder number. A "level 40" that
  is mechanically identical to level 1 but faster is not depth.
- **Block World specifically** is the most ambitious and newest — it's
  the best candidate for a deeper pass (more block/resource variety, a
  better camera feel, terrain that reads as more "real," clearer
  mining/building feedback) rather than a ground-up replacement.
- **Visual polish** within the existing Apple Liquid Glass light theme —
  reuse the established palette (`--accent: #ff7a2f`, `--ok`, `--warn`,
  `--bad`, the neutral `--text`/`--text-faint` tokens) and avoid the
  generic "AI slop" tells this project has explicitly avoided elsewhere:
  purple-to-blue gradients, `rounded-lg`-everywhere cards, decorative
  blur blobs with no relation to the brand. New visuals should feel like
  they belong next to the existing ones, not like a different app.

You have real latitude to redesign a game's mechanics entirely if the
current version is fundamentally weak — this is not a "polish only"
request.

## Hard constraints (do not violate these)

- **Zero dependencies, still.** No npm packages, no CDN scripts, no
  webfonts. Canvas/WebGL are allowed if you judge them worth the
  trade-off for a specific game (none currently use them — all six are
  pure DOM + CSS transforms), but nothing may be fetched over the
  network at runtime. The whole app must keep working fully offline.
- **No backend involvement.** Games must not add fetch calls to `/api/*`
  or otherwise read/write printer state. This is an explicit, tested
  project rule (`tests/test_api.py`), not an oversight — do not "fix" it.
- **Keep the status ribbon working.** The pinned status strip above the
  games tab must keep showing print progress even mid-game — don't let a
  new game's DOM/CSS cover or break it.
- **Keep mobile/touch working.** `.game-surface` and `.beacon-viewport`
  both have `touch-action: none` specifically because touch-drags were
  previously being swallowed as page scrolls — preserve this for any new
  or restructured game surface. If you add new hold-to-move controls,
  also add a document-wide `pointerup`/`pointercancel` release the way
  Block World's `beaconPointerUpHandler` does, so a finger sliding off a
  small button on touch never leaves movement stuck on.
- **Keep best-score persistence working**, per game, via the existing
  `readBest`/`saveBest` localStorage pattern (or a reasonable evolution
  of it if a game's scoring model changes) — don't silently drop players'
  saved bests.
- **Keep games swappable.** Preserve the `renderGame`/`stopCurrentGame`
  dispatch pattern so switching games or tabs cleanly tears down
  whichever one was active — every `setInterval`, every
  `addEventListener` a game registers must have a matching teardown.

## Verification expected before you call this done

- Run `python3 -m unittest discover tests` from the repo root — should
  stay at (or above) 170 passing. Games are frontend-only, so this should
  be unaffected, but confirm rather than assume.
- Actually play-test each game you touch — headless browser
  (Playwright is pre-installed at `/opt/pw-browsers/chromium`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright` in a
  scratch dir, never committed to the repo) clicking/typing/dragging
  through real interactions, not just reading the code and assuming it
  works. Take at least one screenshot per reworked game and actually look
  at it.
- Specifically re-verify touch behavior (a touch-drag steering a paddle
  or camera, a stray release not sticking movement on) if you touched
  input handling — this exact class of bug has bitten this project
  before.
- Check `node --check frontend/app.js` for syntax sanity before you
  consider a change finished.

## How to land the work

Branch from the current `main` (the prior feature branch,
`claude/jolly-lamport-rxyikv`, has already been merged — start fresh,
don't stack on it). Commit with clear messages. Open a **draft** pull
request when done, following this repo's existing PR description style
(see the merged PR's description via `git log` / GitHub for tone — plain
language, what changed and why, an honest test-plan checklist). Do not
merge it yourself unless explicitly asked to.
