---
paths:
  - "frontend/**"
---

# Frontend notes

Plain HTML, CSS and JavaScript: no framework, no build, served as-is. **Everything in `frontend/` is
published** (Cloudflare serves it as the product page and the online demo), so never put notes,
keys or private text here. Every change shows in the online demo: check `/?demo` on a static
server. Load the frontend-design and liquid-glass skills before changing a screen.

**Direction (18 and 19 November 2026):** each working screen becomes one connected, technical surface (the printer,
plate, files, camera and readings flowing into each other, edge to edge, no gaps, no explainer paragraphs), Glass by
default everywhere, dark mode at least as good as light. Cards stay where a small, self-contained task belongs in one
(a setting, a confirmation, a short form). The SHELL cluster (private `FEATURES.md`) writes its building blocks here.

## Load order and shared names

- Scripts: `theme-boot.js` in `<head>`, then `app.js` and its six parts (below) → `tester.js` → `tester-study.js` → `layout.js` → `orb.js` → `backdrop.js` → `viewer3d.js` →
  `ar.js` → `twin3d-scene.js` → `twin3d-part1.js` → `twin3d.js` → `workshop-part1.js` … `workshop-part5.js` →
  `workshop.js` → `studio.js` → `layer-stack.js` →
  `farm-part1.js` → `farm-part2.js` → `farm.js` → `guide.js` → `launchpad.js` → `phone.js` → `explain.js` → `versions.js` → `finder.js`
  → `desk.js` → `telemetry.js` → `printer-page.js` → `printer-extras.js` → `logbook.js` →
  `insights.js` → `printroom.js` → `plate.js` → `gcode-view.js` → `slicer-workspace.js` →
  `backup.js` → `maker.js` → `assistant-part1.js` → `assistant-part2.js` → `assistant.js` → `pagebar.js` → `rail.js`. The arcade loads on demand (`loadGames()`). `tester.js` loads
  right after the app parts (it wraps `fetch`, `toast` and `syncModuleBodies`, which they define).
- CSS: `style.css` → `style-games.css` → `style-layout.css` → `workshop.css` → `workshop-files.css` → `workshop-panels.css` → `farm.css` → `printer.css` →
  `guide.css` → `assistant.css` → `tester.css` → `theme.css` → `theme-screens.css` → `theme-shell.css` → `dark.css` →
  `looks.css`.

## Split files (18 and 19 November 2026)

The big files were split into parts of one area each so a session reads only what it needs. Every part's header
says what it holds; `tests/frontend_parts.py` lists the families, and tests read a family whole (`read_frontend`).

| Family | Parts, in load order |
|---|---|
| `app.js` (scripts, `index.html`) | `app.js` (helpers, server check, demo routing), `app-demo.js` (the demo's simulation), `app-shell.js` (saved settings, hints, which printer, honest commands, units, tab title, accent, connection, preview, tabs, `SECTIONS`, the ribbon), `app-modules.js` (maintenance, LED rings, colour check, printer control), `app-print.js` (skip an object, watch-only, filament, what changed), `app-extras.js` (extras, pairing, notifications, updates, cost, smart home, the games loader, the highlight), `app-start.js` (start-up, stopped answering) |
| `games.js` (`GAME_PARTS` in `app-extras.js`) | `games.js`, `games-classic.js`, `games-arcade.js`, `games-shell.js`, `games-puzzle.js`, `games-v2.js`, `games-world.js` |
| `theme.css` | `theme.css` (the design system), `theme-screens.css`, `theme-shell.css` (phone layout, page bar) |
| `workshop.css` | `workshop.css`, `workshop-files.css`, `workshop-panels.css` |
| `backend/tester_report.py` | `tester_report.py` (numbers, findings, zip) and `tester_report_render.py` (report.html, findings.md, README) |
| `workshop.js` (closure `Workshop`) | `workshop-part1.js` … `workshop-part5.js` (definitions, each handing its names on as `WorkshopPart1` … `WorkshopPart5`; each header lists what it holds), then `workshop.js` (takes the names back, wires the page's listeners and timers, returns the `Workshop` API) |
| `twin3d.js` (closure `Twin3D`) | `twin3d-part1.js` (shapes, materials, maths, drawing helpers; `Twin3DPart1`), then `twin3d.js` (`create()`, one 75 KB function that builds each twin with its own state, kept whole for the TWIN cluster) |
| `assistant.js` (closure `Assistant`) | `assistant-part1.js`, `assistant-part2.js` (`AssistantPart1`, `AssistantPart2`), then `assistant.js` |
| `farm.js` (closure `Farm`) | `farm-part1.js`, `farm-part2.js` (`FarmPart1`, `FarmPart2`), then `farm.js` (also `planLayers` and `LayerPlanner`) |
| `style.css` | `style.css` (the base), `style-games.css`, `style-layout.css` (footer, responsive, accessibility, preview) |

How to split a classic script safely (what this split found): the parts share one global scope, but **function
hoisting stops at a file's edge**. Cut only between top-level statements, and check that nothing which runs while
the page loads (a `const x = someFunction`, a call, a timer started at load) reaches a function or `var` from a
later part. A name declared twice keeps its last declaration in one file but the latest-loaded one across files,
and a load-time reassignment (`renderGame = ...`) must stay in the same part as any later declaration of that name.
Timers that settle which functions are active go at the end of the last part. Prove it: the parts with their headers
removed equal the old file, and in Chromium every top-level name has the same type and source before and after.
A closure file (`const X = (() => { ... })()`) splits differently (19 November): pure definitions move into part files
that each run their own small closure and return their names; the main file takes them back with
`const { a, b } = XPart1;` at the top of its closure and keeps the code that wires the page. Variables the code changes
while it runs live on one shared object (`wsState` in workshop, `aiState` in the assistant), so every part sees the
same value: read and write `wsState.printerState`, never a copy. Order follows what depends on what, so one screen's
code can sit in more than one part: search the family (`grep -n "function renderFiles" frontend/workshop*.js`).
- `app.js` defines the shared globals: `$`, `esc`, `api()`, `getJSON`, `postJSON`, `paint()`,
  `doneAt()`, `hoursLeft()`, `toast`, `showTab`, `currentPrinter`, `demoOn`. A top-level `const` in
  a classic script is not a `window` property, so shared modules assign `window.Orb`,
  `window.Guide`, `window.Versions` and so on. A script that uses a later one at start-up waits for
  `DOMContentLoaded`.

## Rules the screens depend on

- Escape everything that reaches `innerHTML` with `esc()`, including file metadata.
- Panels on the 5-second refresh render through `paint()`; it skips unchanged HTML and stops the
  entrance animation replaying.
- `drawSafely(part, fn)`: one failing part no longer skips the rest; the first failure per part is a
  toast naming it.
- Honest controls: a button says what it is sending, then shows only what the printer reports. A
  refused command shows as refused, in words.
- With no printer and no demo, data routes return `{"connected": false, "demo": false}`; screens
  show empty states, never zeroes.
- Accessibility: `theme.css` loads late, so its reduced-transparency and increased-contrast blocks
  repeat the overrides with selectors at least as specific as the rules they override.
- The app and product page carry no "untested" or "simulated only" notes; demo data stays labelled.
- Idle printers are never grey or "down": Pause/Cancel are hidden unless a print runs; idle offers
  Print a file and Warm up.

## Places and screens

- Sidebar (`rail.js`, loaded last): each place is a screen plus, where it has parts, one part
  (`DEST`). Links are `#/<place>` (`#/printer/<id>`); `OLD` maps old names. 224 px or 64 px, folded
  by default below 1180 px, hidden at 720 px and less (bottom bar and More sheet). It reads
  `dv-tab`, `dv-section`, `dv-printer` and `dv-fleet`. `#rail-menu` is a child of `body` (the
  rail's backdrop-filter would trap a fixed child). Items carry `aria-label`, never `title`. A new
  place needs a `DEST` row and an icon (`tests/test_rail.py`).
- Page bar (`pagebar.js`, before `rail.js`, which stays last; `tests/test_pagebar.py`, `node tools/pagebar-walk.js`): the
  header (`#topbar`) has two looks, set by `data-page` on `<html>`. `overview` is the banner (brand, printer button, demo
  switch). `page`, every other screen, is one slim bar: the place's icon and name (the sidebar's, from `Rail.label` and
  `Rail.icon`), the screen's parts as tabs in `#pb-tabs` (a second row, only when the screen has parts), the place's main
  buttons in `#pb-actions`, then search, printer button, demo switch and the `?` button. `theme-boot.js` sets `data-page`
  from the link, the chosen start screen or the last screen before the first paint; `showTab` keeps it right, except that
  its first call (`initial`) leaves it alone and `pagebar.js` settles it on `dv-rail`, so a link to Printer never flashes
  the Overview look. A main button in `ACTIONS` presses a control the screen already has (`mirror` copies its words and
  disabled state): the bar's Emergency stop is `#pp-estop` pressed, so it still asks first and still shows a refusal in
  words, and that card button hides on a computer so there is one. A new place's button needs no new route. On a phone the
  bar drops the printer button, the demo switch and the main buttons (the dock and Overview say the state, the card keeps
  its Emergency stop) and keeps a Simulated label. The `?` button opens `#tab-intro` as a small card (the screen's
  sentence plus "Show me this screen"), also for people who turned beginner tips off. The search is a round button that
  opens leftwards (`.topbar .feature-finder`; a global `max-width: 100%` on inputs once held it at 40 px); its icon is
  `--pb-search-icon` because the dark and Workbench rules reset `background`. The sidebar carries the brand at its top.
- Tabs: Overview (cards about now, no twin); Printer (data-tab `control`, kept for saved tabs and
  tours: the twin, camera, Move pad, temperatures, extrude, tune, fans, mesh, macros, console);
  Preferences (`prefs`). Photo studio has no tab button.
- Sections (`app.js` `SECTIONS`, `window.Sections`): Printer, Printers, Files, Care and Settings show
  one part at a time. Cards are sorted by `#id`, `.class` or the start of their h2 title; a card no
  rule names joins the first part. A new card on those screens needs a rule.
  `Sections.reveal` opens the part of anything scrolled to. Each screen's row of parts (`.sec-bar`) is built into
  the header's `#pb-tabs` and shown for the open screen; look it up by its id (`SECTION_BAR_IDS`), not inside the panel.
- `printer-page.js` + `printer.css`: the Printer page, the Overview cards, the camera view (`.pcam`,
  at most five pictures a second, only while visible) and Preferences.
- `workshop.js`: live WebSocket with a polling fallback (asks once a second and retries the WebSocket
  every 10 s); `nudgeLive` reconnects on visibilitychange, online and bfcache pageshow. Fleet cards,
  Needs you, files, dialogs, morph animations.
- `launchpad.js`: setup (skippable), the desktop-app card, update settings. Browser-only names never
  enter requests. Setup has seven steps on a computer and five on a phone (`PHONE_STEPS`: no code to scan,
  no desktop app or updates, a Home Screen step instead; a phone is a narrow screen with a coarse pointer).
  Continue on the printer step connects a typed address first (`connectPrinter`; a second Continue skips it);
  a printer already in the list is reused. Its flags go through `store` (app.js), which falls back from
  localStorage to sessionStorage to the page's memory. `tools/setup-walk.js` checks all of it in Chromium. `phone.js`: the QR sheet and `?pair=` redemption; `Phone.install()` picks install
  steps (Chrome installs only from https, localhost or a flagged address).
- `explain.js`: an ⓘ after each known card title (HELP, keyed by the title's letters and digits) and
  `[[word]]` glossary links. Write notes in plain words. `tests/test_explain.py` fails when a note's
  card is renamed. `finder.js` (Ctrl/Cmd+K) ignores the ⓘ button; `tests/test_finder.py`. Its search box lives at the right of the top bar (`.feature-finder`) and moves into the phone's More sheet.
- `guide.js`: tours. The quick tour (`Guide.everything()`) is nine stops; keep it short. More detail
  lives in `Guide.screen(tab)`, 1 to 4 stops per screen.
- `orb.js`: the notification orb; `toast()` hands every message to `Orb.notify`. One translucent
  sphere tinted by `--orb-tint`, no centre dot.
- `versions.js` + `versions.json`: Version & updates, the header chip and each version's tour.
- `layout.js`: two-column card grids (`.grid-2`, `.desk-grid`) fill without holes. Each card gets rows as
  tall as itself (1 px rows) and the next card goes in the shorter column; grids that follow each other
  are wrapped in one `.flow-run`. A card in a grid needs no rule; a new full-width card goes outside one.
- - Phone layout (≤ 720 px, end of `theme.css`): `.desk-only` cards hide on phones, `.phone-only` the
  reverse; give new computer-only cards `desk-only`. Keep the first phone screen short.
- `sw.js` caches only `offline.html`, never API replies or commands.
- `welcome.html` is the product page; on a static host `/api/modules` returns 404 and `app.js` hands
  over to it. `/?demo` and `/?dashboard` skip that. Social-card tags use the published worker's
  absolute URL (`test_link_preview_image_is_the_bundled_card`).
- Each pull request gets a Cloudflare "Workers Builds" check and a preview-URL comment. A local
  static check doesn't prove the public deployment; check the network policy before opening a
  `*.workers.dev` preview.
- `desk.js` (Farm desk in Printers), `telemetry.js` (Overview readout, fed by workshop's `dv-state`
  event), `logbook.js` (Care), `insights.js`, `printroom.js` (four-head editor), `backup.js`.

- `tester.js` + `tester-study.js` + `tester.css`: Tester mode. `tester.js` records from the first start once `serverReady()` has
  resolved and the module list says the module is on, never in the online demo (`tour.on`) or without a server, and never sends
  `/api/tester/*` calls itself into the record. A control is named by its id, an action attribute from `ACTION_ATTRS` (never
  `data-file`, `data-id`, `data-printer`) or, last, its own words with file names replaced. Presses carry how they were made, the
  order, where they landed and the pause before them; clicks are timed to the next paint (a task queued from inside
  `requestAnimationFrame`) and wait up to 300 ms for the requests they started. Only trusted events are recorded. The setup
  wizard and the guided tour are watched from outside (MutationObservers on `#setup-dialog`, `#setup-step` and `<html>`'s
  `guide-open`); `launchpad.js` and `guide.js` are not changed for it. The tester's own panels carry `tester-ui`, which the
  recorder leaves out. `#tester-dock` holds the flat chip (`#tester-chip`, tester-study.js) and the "Something felt off" button
  (`#tester-felt`, flat on purpose: glass behind the moving 3D view cost frames). `#tester-note` takes a tag and the error just
  before it. `tester-study.js` is the round: the welcome panel, the hub, the end-of-test prompt and `#tester-q`, the 52 questions
  saved as typed. The Settings card (`#tester-card`) has no switch (an "Always on" pill, the plan, counts, Answer the questions,
  View report, Save tester report, Delete tester data) and `#tester-off-note` for a run started with `DEJAVU_TESTER=0`. In the demo
  it shows `SAMPLE` figures that must match `tester-report-sample.html` (`python3 tools/tester-sample-report.py`;
  `tests/test_tester.py` checks both); the plan and the questions never show there.
- `assistant.js` + `assistant.css`: the AI assistant's Ask button and panel (`.liquid-glass.deep`, a
  right-edge strip, a sheet on phones). Views: chat (your message is drawn at once with `is-sending` and
  replaced by the server's copy; steps as a toolpath; results as cards from `m.card`: printer gauges,
  slice, model with thumbnail, spools, care, queue, rule), history (saved conversations from
  `/api/assistant/chats`), connect (plans first: Claude Code sign-in and Sign in with ChatGPT run from the
  form, local, then keys behind a fold with the one note on keys, `KEY_NOTE`) and settle. The header chip
  (`#ai-who`) switches the AI and model. Hand-offs (`page` with `spot`, `confirm_print`, `ui` theme/tour)
  run once, only for steps that arrive live (`autoFrom`), never when an old conversation is reopened.
  `goTo(place, spot)` opens a place, reveals the card's part and lights it (`.ai-spot`); files open
  through Files first (`openFile`). Suggestions show only on the first few opens (`dejavu1.ai.opens`).
  It also draws the AI tab (`#ai-page`): features first (`watchCard`, `FEATURES`), set-up as small
  cards (`#ai-setup`). `html.ai-on` and the shortcuts in `SPOTS`, the Automations "Describe a rule" card
  and the AI presets exist only while an AI is connected; `afterDisconnect()` removes them all and the
  launcher turns into a quiet round button (`is-quiet`). With none, nothing else in the app may mention
  AI. `.ai-glow` is the one-minute welcome (transform and opacity only). It wraps `window.toast` to offer
  "Explain the last warning". Photos are shrunk in the browser (`shrink`, under 1 MB as JPEG). In the
  online demo (`tour.on`) it never calls the server: a scripted helper sends the demo's own simulated
  commands and says what it is. Model text goes through `rich()`, which escapes first.
- `app.js` `Familiar`: after four opens and three screens used, `html.familiar` hides the "Show me this
  screen" buttons and the intro line (Preferences → Beginner tips, or Ctrl+K "tips", brings them back).
- `rail.js` keyboard: `GO_KEYS` (G then a letter), Alt+1 to 9, `?` opens `#kb-sheet`; `typing()` skips
  text fields but not switches. Sidebar ids are `files`, `slice`, `queue`, `filament`, `maintenance`;
  `OLD` maps library, prepare, jobs, materials and care.

## Looks and theme

- `theme-boot.js` sets `data-theme` (light|dark), `data-theme-pref` (light|dark|system, default
  light), `data-ui` (glass by default | workbench | control) and `data-density`
  (comfortable | compact) before paint, and fires `dv-theme`, `dv-ui`, `dv-density`.
- `dark.css` tokens sit on `html[data-theme="dark"]:not(#dv)`. A new card, chip or pop-up with a
  white background needs a dark rule. Never invert pictures, swatches or the print; drawings stay
  white paper.
- `looks.css` (last): Workbench and Control room share rules under
  `:root:is([data-ui="workbench"], [data-ui="control"]):not(#ui)`. Never put an id inside `:is()`
  (`tests/test_looks.py`). The emergency stop stays #c8102e in every look. A new Glass component
  needs a Workbench check: solid panel, one hairline, `--wb-r` radii.
- Measure contrast with colours converted by the browser (a 1x1 canvas), not by parsing `rgb()`.
- Glass: a `backdrop-filter` blur of about 1.5 px or more erases the 5 px layer lines; the clear bars
  use `#lg-lens-clear` with a 0.4 px blur. Content cards drop their blur while the background moves.
- `backdrop.js`: Dots by default plus Constellation, Flow, Layer lines, Still; every dot is one
  colour (the set's own or Settings → Appearance → Dot colour). It draws only while something moves;
  reduced motion turns it Still. New surprises go in its SURPRISES section. Any look but Glass is
  Still.

## Games (`games.js` and its six parts)

Every game timer goes through `frameEvery()` (rAF-driven fixed steps). `fitGameCanvas()` sizes the
canvas. `tests/test_frontend_refresh.py` reads the arcade as text: keep it independent of spacing. `loadGames()`
loads the parts one after another and, after a failure, only the parts still missing (a part run twice would
declare its names twice). The two start-up timers that settle the active game functions sit at the end of
`games-world.js`.

## Online demo

Where no server answers `/api/health`, `app.js` `startTour()` answers `/api/` from
`demo/recording.json`; POSTs are simulated in `tourSim` and `tourControl`. A new or changed GET
route needs `python3 tools/online-demo/record.py` (about 3 minutes) and a commit of `frontend/demo/`
(`tests/test_online_demo.py`). A feature that can't work in a recording says so in words.
The demo simulates single-printer commands (`tourControl`, including Feed, chamber light, fans and sensor
toggles, remembered in `sim.tuning` and shown in the twin) and the fleet bar (`tourBroadcast`, with the
real answer's words); a cancel parks the head. A command in `HANDS_ON` also needs its name in the route
pattern in `tourPost`, or the demo refuses it. `/api/print/preview?file=` is recorded per sample file, and
`tourGet` asks for the file on the plate, so a print started in the demo is drawn from its own layers.
