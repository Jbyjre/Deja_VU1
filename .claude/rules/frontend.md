---
paths:
  - "frontend/**"
---

# Frontend notes

Plain HTML, CSS and JavaScript: no framework, no build, served as-is. **Everything in `frontend/` is
published** (Cloudflare serves it as the product page and the online demo), so never put notes,
keys or private text here. Every change shows in the online demo: check `/?demo` on a static
server. Load the frontend-design and liquid-glass skills before changing a screen.

**Direction (18 and 19 November 2026, built in the SHELL cluster):** each working screen is one connected, technical surface (the printer,
plate, files, camera and readings flowing into each other, edge to edge, no gaps, no explainer paragraphs), Glass by default everywhere, dark
mode at least as good as light. Cards stay only where a small, self-contained task belongs in one (a setting, a confirmation, a short form).
"Building blocks" below says what every screen is made from.

## Load order and shared names

- Scripts: `theme-boot.js` in `<head>`, then `app.js` and its six parts (below) → `tester.js` → `tester-study.js` → `layout.js` → `orb.js` → `backdrop.js` → `viewer3d.js` →
  `ar.js` → `twin3d-scene.js` → `twin3d-part1.js` → `twin3d.js` → `workshop-part1.js` … `workshop-part5.js` →
  `workshop.js` → `studio.js` → `layer-stack.js` →
  `farm-part1.js` → `farm-part2.js` → `farm.js` → `guide.js` → `launchpad.js` → `phone.js` → `explain.js` → `versions.js` → `finder.js`
  → `desk.js` → `telemetry.js` → `printer-page.js` → `printer-extras.js` → `logbook.js` →
  `insights.js` → `printroom.js` → `plate.js` → `gcode-view.js` → `slicer-workspace.js` →
  `backup.js` → `maker.js` → `assistant-part1.js` → `assistant-part2.js` → `assistant.js` → `panes.js` → `settings.js` → `strip.js` → `pagebar.js` → `rail.js`. The arcade loads on demand (`loadGames()`). `tester.js` loads
  right after the app parts (it wraps `fetch`, `toast` and `syncModuleBodies`, which they define).
- CSS: `style.css` → `style-games.css` → `style-layout.css` → `workshop.css` → `workshop-files.css` → `workshop-panels.css` → `farm.css` → `printer.css` →
  `guide.css` → `assistant.css` → `tester.css` → `theme.css` → `theme-screens.css` → `theme-shell.css` → `dark.css` →
  `shell.css` → `shell-panes.css` → `looks.css`.

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

- The frame (`#shell`, a grid of sidebar, working surface and strip; `html.has-shell` is set in `theme-boot.js` before paint). There is no top bar.
  `rail.js` (loaded last) is the sidebar of eight places: Overview, Printer, Slicer, Files, Models, AI, Maintenance, Settings, plus a "More" group
  (Automations, Photo studio, Games). A place is one or more screens (`data-tab` panels) and the parts of them (`SECTIONS`); `DEST` lists every
  address a link can name (`#/<dest>`, `#/printer/<id>`) with its place, and `OLD` maps old names. The sidebar is 212 px or 60 px; it narrows by
  itself in Printer, Slicer and Files (`narrow: true`), a width chosen with `[` or in Settings wins (`dejavu1.rail.mode`), and a narrow sidebar
  shows its labels over the page on hover or focus without moving it. It reads `dv-tab`, `dv-section`, `dv-printer` and `dv-fleet`. Items carry
  `aria-label` that starts with the visible label, never `title`. A new place needs a `PLACES` row, a `DEST` row and an icon (`tests/test_rail.py`).
  `#rail-menu` is a child of `body` (the card's backdrop-filter would trap a fixed child).
- The toolbar edge (`pagebar.js`, `#topbar`, the first row of the working surface; `tests/test_pagebar.py`, `node tools/pagebar-walk.js` is the
  browser walk of the whole frame): the place's icon and name (the printer's name beside it on Printer), its parts as `role="tab"` buttons in
  `#pb-parts` (from `Rail.partsOf`; a place with one part shows no row), the place's own buttons in `#pb-actions` and the search. A button in
  `ACTIONS` presses a control the screen already has (`mirror` copies its words, disabled state and hidden state): Pause and Cancel appear only while a
  print runs. Halt is not in it. Everything the old banner carried and other scripts write to by id (`#printer-chip`, `#demo-toggle`, `#ver-chip`,
  `#pb-help`) is kept in the hidden holder `.tb-hold`; `#pb-tabs` stays hidden for `Sections`' own part buttons. The search (`finder.js`) is the
  command bar: the input at rest, a centred sheet while it has focus (`.feature-finder:focus-within`). It lists every place, part, settings group and
  action with its shortcut (`hint`); a new action goes in `ACTIONS` with its keys.
- The strip (`strip.js`, `<footer id="strip">`): one instrument per printer (the layer-stack meter, name, progress or state, temperatures; three or
  more printers drop the extras), `#conn` (says "Simulated" in demo mode), Find, the Ask button (`assistant.js` builds it; the strip adopts it), the
  notification orb with its toasts (`orb.js`; its colour follows the link through `data-link`) and **Halt**. Halt (one press, or `H H`) stops the
  selected printer through `runCommand` so a refusal is shown in words, then offers Restart firmware (`/api/printer/control/restart`, refused unless the
  printer reports an error). Settings › Halt "Ask before Halt" (`dejavu1.pref.haltAsk`) adds a second press. Halt is #c8102e with white text in every
  look. On a phone only the selected printer shows. The "continue on this computer" offer (`#handoff`) is a line in the strip on computers and stays in
  the dock on phones (`initDockStack`, `workshop-part3.js`), where it has its own ground (`.thumb-dock > .handoff`). Tester mode's `#tester-dock` (the
  "Something felt off" button, `#tester-felt`) is moved by `tester.js` into `.strip-end` before Find (`.in-strip`), so no floating button covers the page; below
  1340 px and on phones only its flag shows (the words stay its accessible name), and its note panel still floats above the strip.
- Panes (`panes.js`, `shell-panes.css`): Overview is a stage (the twin) with its readings under it and a side pane; Printer › Control is a cockpit (left
  pane of heads, bed and tuning; the twin with the console under it; right pane of camera, move pad and files). `Panes.put(id, pane)` moves a card
  without losing its id, listeners or the `data-module-body` switch its wrapper carried. The twin is one shared instance: `Panes.dock()` moves
  `#twin-card` into the stage of the open place. `Panes.splitter(...)` makes a divider (W3C window splitter; sizes kept in `dejavu1.layout.*`;
  `Panes.reset()` is Settings › Reset layout). The cockpit's twin tools are two compact rows and the gesture hint (`#twin-hint`) shows only for "New to 3D
  printing" or on a phone. The cockpit is calm until you click into something (`foldCards`, `calmTwin` in panes.js): each
  pane section is a fold (`.fold-btn` in its h2, `.is-folded`; open ones kept in `dejavu1.cockpit.open`; Temperatures, Camera and Print a file open
  first; Reset layout restores that); Temperatures shows readings and `#pp-heat-set` (Set temperatures) shows the boxes and material buttons; the console
  folds to its title row. The twin turns by itself only on Printer (`autoSpin`, never with reduced motion), stops while the pointer is over it, hides
  its head and tools, and a click (or `#twin-open`) expands it over the cockpit with every control (`#cockpit.twin-expanded`, `Panes.expandTwin`;
  Escape or `#twin-close` closes). Anything that scrolls into a folded section opens it (`Panes.unfold`, from the scrollIntoView hook in app-shell.js).
  Walks that press the twin's buttons call `Panes.expandTwin(true)` first.
- Settings (`settings.js`): Preferences' cards are moved into the Settings screen, `SECTIONS.modules` sorts every card into a group (Printers &
  connection, Look & layout, Phone & away, Alerts & smart home, Tester mode, Updates, Advanced, Help), the left list shows one group at a time and the
  search shows every card that mentions the words. Demo data is in Advanced (`#demo-toggle` stays as a hidden input that `#demo-setting` mirrors).
- Maintenance (`app-modules.js`, `shell-panes.css`): `#mt-band` is a readouts band whose Overdue, Due soon and OK cells are buttons that filter `#tasks` (press the
  same one again for all; `renderTasks()` redraws and keeps the focus) beside the printer's totals; each `.task` row has three cells (name and description,
  gauge, actions) with a hairline under it and a 3 px status stripe, flat in every look. Overview's small `.task` rows are untouched. Files: the whole
  `#tab-files` takes a dropped file (`html.is-dropping` outlines the surface, `#file-drop` is the label) and an empty library is one dashed button
  (`#file-empty`). AI with none connected: the headline and the three gains as rows beside it (`.ai-intro`).
- Tabs: Overview (cards about now, no twin); Printer (data-tab `control`, kept for saved tabs and
  tours: the twin, camera, Move pad, temperatures, extrude, tune, fans, mesh, macros, console);
  Preferences (`prefs`). Photo studio has no tab button.
- Sections (`app.js` `SECTIONS`, `window.Sections`): Printer, Printers, Files, Care and Settings show
  one part at a time. Cards are sorted by `#id`, `.class` or the start of their h2 title; a card no
  rule names joins the first part. A new card on those screens needs a rule.
  `Sections.reveal` opens the part of anything scrolled to. The toolbar edge's parts row (`#pb-parts`) replaces `Sections`' own
  buttons (`.sec-bar`, kept hidden in `#pb-tabs` for ids); `Sections.choose(tab, key)` is still the one way to open a part. "Everything" is gone.
- `printer-page.js` + `printer.css`: the Printer page, the Overview cards, the camera view (`.pcam`,
  at most five pictures a second, only while visible) and Preferences.
- `workshop.js`: live WebSocket with a polling fallback (asks once a second and retries the WebSocket
  every 10 s); `nudgeLive` reconnects on visibilitychange, online and bfcache pageshow. Fleet cards,
  Needs you, files, dialogs, morph animations.
- `launchpad.js`: setup (skippable), the desktop-app card, update settings. One quiet offer after the first real connection (`offerDesktop`: a message
  with "See how", once, key `dejavu1.desktopOffer`; never on a phone, in the demo, in the installed app or when the launcher already opens a window). Browser-only names never
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
- `orb.js`: the notification orb (in the strip); `toast()` hands every message to `Orb.notify`. One translucent
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
  recorder leaves out. `#tester-dock` holds the "Something felt off" button (`#tester-felt`, flat on purpose: glass behind the moving 3D
  view cost frames) and is hidden while the guided tour is open; there is no chip, hub, welcome panel or end-of-test panel, and nothing
  appears with the first-run setup. `#tester-note` takes a tag and the error just before it (a lost server is recorded but never turns the
  button into an alert). `tester-study.js` is the 22 questions: the dialog `#tester-q` (opened by `#tester-answer` in Settings or
  `Tester.answer()`), nine steps and a last one that saves the report; "Didn't try it" only on the two optional questions. The Settings
  card (`#tester-card`) has no switch (an "Always on" pill, `#tester-progress`, Answer the questions, View report, Save tester report,
  Delete tester data) and `#tester-off-note` for a run started with `DEJAVU_TESTER=0`. In the demo it shows `SAMPLE` figures that must
  match `tester-report-sample.html` (`python3 tools/tester-sample-report.py`; `tests/test_tester.py` checks both); the questions never
  show there.
- Reads that fail: `getJSON` (app-demo.js) asks again once after 0.7 s and then throws `ServerLost` (`quiet: true`), which no page shows
  as an error; a global `unhandledrejection` listener swallows network losses and asks `watchServer` (app-start.js) to look at once.
  The "stopped answering" strip appears only after `QUIET_MS` (10 s) of silence. Commands (`postJSON`) are never retried.
- The time-lapse list (`loadTimelapse`, workshop-part5.js; `loadPrinterVideos`, part3) draws into three boxes (`#tl-note`, `#tl-flips`,
  `#tl-printer`) and replaces one only when its HTML changed; a failed or refused read leaves what is drawn (a switched-off module adds a
  note and dims it). Keep a copy is a server job: the press returns at once, `/api/timelapse/jobs` is polled while one runs and the
  row shows "Copying 63%". Do not hold a long request open from the page: a browser keeps at most six connections to one address.
- The Printer page camera (`printer-page.js` `startCam`) tries a saved stream address, then WebRTC where offered, then the live stream, then
  still pictures, skipping what fails (remembered per printer until reload) and saying which is showing in `.pcam-note`.
- The 3D twin draws again only when `twinSignature()` (workshop-part2.js) changes, it follows a print, or something moves; its drawing
  steps down in resolution (`twin3d.js` `adaptQuality`) when a draw is slow and waits 2.5 times a slow draw's cost. `tools/freeze-profile.js`
  shows where a screen's freezes come from; `tools/testfix-check.js` holds the browser checks for all of this.
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
- `rail.js` keyboard: `GO_KEYS` (G then a letter), Alt+1 to 8 (the eight places), `[` narrows or widens the sidebar, `H H` is Halt (`strip.js`), `?` opens
  `#kb-sheet`; `typing()` skips text fields but not switches. `OLD` maps fleet, control, library, care, modules, autoprint, prepare, jobs and materials.

## Building blocks (the SHELL frame)

Every screen is made from these. Reuse them; add a variant only when a screen needs one, and say so here. `design/shell/PLAN.md` (private
repository) holds the reasons.

| Block | Where | What to know |
|---|---|---|
| Frame | `#shell`, `shell.css` | Grid: sidebar, working surface (`main.wrap`), strip. 8 px gutters. At 720 px and less the surface is the page and the strip and the dock are fixed at the bottom. |
| Surface | `html.has-shell .wrap`, `shell-panes.css` | Paper, one shape. A `.card` inside it has no box: it is a cell with a hairline under it, its `h2` is a small mono-caps label, and `.card-head` is a 38 px row. Write cards as before; do not add backgrounds, borders or shadows to them. |
| Toolbar edge | `#topbar`, `pagebar.js` | The place's name, its parts (`Rail.partsOf`), its buttons (`ACTIONS`), the search. Parts never open another place. |
| Pane, divider | `panes.js` | `.pane` scrolls by itself; `.split` is a W3C window splitter. Put cards in a pane with `Panes.put`; give a new divider a name so Reset layout covers it. |
| Stage | `.stage` | The main view that fills the space (the twin). Panes dock around it; nothing floats over it. |
| Readouts, row | `.readouts`, `.ro`, `.row` | Mono figures with units; a row is dot or meter, title, mono sub-line and one action, 44 px high. |
| Sheet | dialogs, `.orb-panel`, the command bar | The card that stays: a confirmation, a short form, one setting. Floating, so tier 3 glass: the strongest shadow. |
| Layer-stack meter | `.stack` in the strip | A few lines that fill from the bottom as a print grows. The only decoration. |
| Halt, orb | `strip.js` | See "The strip" above. |

- **Glass by tier** (the `liquid-glass` skill): the sidebar and the strip are tier 4 (anchored: soft, wide shadow, edge lensing), sheets and the narrow
  sidebar's hover overlay are tier 3, segmented controls tier 1. The working surface is paper because it is content; never put glass on glass.
- **Tokens:** `shell.css` redefines the existing names (`--bg`, `--text`, `--text-dim`, `--text-faint`, `--hair`, `--paper`, `--paper-solid`, `--raised`,
  `--edge`) in OKLCH and adds `--well` (sunk: inputs, segmented tracks), `--surface`, `--surface-2`, `--hair-strong`, `--accent-soft`, `--halt`. Dark is
  built first: lighter surfaces show elevation, accent and states are desaturated, the room is deep blue. Never use a raw colour in a screen.
- **Words:** no explainer line without a reason. A static `.card-sub` or `.field-hint` has no `id` and is hidden for "I know my way around"
  (`html[data-experience]`, `DVTheme.experience()`) and, after a few visits, for "New to 3D printing" (`html.familiar`). A line with an `id`, a
  `role="status"` or `aria-live`, or `.keep` is live or essential and stays. Names truncate with an ellipsis and keep the full name in `aria-label`.
- **A new screen** needs: a `DEST` row and place in `rail.js`, parts in `SECTIONS`, a Workbench and Control room check (solid panel, one hairline),
  a dark check, a 390 px check, and its actions in the command bar. `node tools/pagebar-walk.js --shots <folder>` takes the pictures.

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
pattern in `tourPost`, or the demo refuses it. Halt (`estop`) puts the simulated printer into `sim.mode = 'error'` (heaters off) until Restart firmware, which the demo
refuses unless the printer reports an error, as the server does. `/api/print/preview?file=` is recorded per sample file, and
`tourGet` asks for the file on the plate, so a print started in the demo is drawn from its own layers.
