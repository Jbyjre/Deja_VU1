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

- Scripts: `theme-boot.js` and `i18n.js` in `<head>`, then `app.js` and its six parts (below) → `tester.js` → `tester-study.js` → `layout.js` → `orb.js` → `backdrop.js` → `viewer3d.js` →
  `ar.js` → `twin3d-scene.js` → `twin3d-part1.js` → `twin3d.js` → `workshop-part1.js` … `workshop-part5.js` →
  `workshop.js` → `player.js` → `studio.js` → `layer-stack.js` →
  `farm-part1.js` → `farm-part2.js` → `farm.js` → `guide.js` → `launchpad.js` → `phone.js` → `explain.js` → `versions.js` → `finder.js`
  → `desk.js` → `telemetry.js` → `printer-page.js` → `printer-extras.js` → `colour-bridge.js` → `colour-setup.js` → `logbook.js` → `errorhelp.js` →
  `insights.js` → `prints.js` → `printroom.js` → `gcode-view.js` → `slicer-cut.js` → `slicer-model.js` → `slicer-scene.js` → `slicer-ui.js` → `slicer-prepare.js` → `slicer-cutui.js` → `slicer-keys.js` → `slicer-settings.js` → `slicer-filament.js` → `slicer-sets.js` → `slicer-help.js` → `slicer-sheet.js` → `slicer-path.js` → `slicer-preview.js` → `slicer.js` →
  `backup.js` → `maker.js` → `assistant-part1.js` → `assistant-part2.js` → `assistant.js` → `panes.js` → `deck.js` → `cockpit.js` → `overview.js` → `settings.js` → `strip.js` → `text.js` → `pagebar.js` → `activity.js` → `rail.js` → `intro.js`. The arcade loads on demand (`loadGames()`). `tester.js` loads
  right after the app parts (it wraps `fetch`, `toast` and `syncModuleBodies`, which they define).
- CSS: `style.css` → `style-games.css` → `style-layout.css` → `workshop.css` → `workshop-files.css` → `workshop-panels.css` → `farm.css` → `printer.css` →
  `guide.css` → `assistant.css` → `tester.css` → `errorhelp.css` → `colour-setup.css` → `theme.css` → `theme-screens.css` → `theme-shell.css` → `dark.css` →
  `shell.css` → `shell-panes.css` → `cockpit.css` → `glass.css` → `text.css` → `looks.css`.

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

- Translations (`i18n.js`, `strings/`, `docs/translating.md`): with English chosen the file does nothing and fetches nothing. With another
  language it loads `strings/en.json` and `strings/<code>.json`, translates every text node and the attributes `title`, `placeholder`,
  `aria-label`, `alt`, `data-tip`, `data-title` and `label` as they appear and change (a MutationObserver), matches a sentence with pieces
  (`{0}`) as a pattern, translates `alert`, `confirm` and `prompt`, and writes dates in the language. It skips `pre`, `code`, `kbd`, `samp`,
  `textarea`, `[translate="no"]` and `[data-no-i18n]`. So: write English as before, a whole sentence in one string; **never compare what is
  on screen with an English word** (`I18n.same(text, 'English')`, `I18n.source(text)`, `I18n.englishText(el)`; `Sections.titleOf`, explain.js and
  finder.js do); **never compare the DOM with a string you computed to skip a redraw** (keep what you drew, as `tags._drawn` in twin3d.js does).
  A text that reaches no DOM node as one piece goes through `I18n.t('Saved {name}', { name })`. `?lang=pseudo` accents and lengthens every
  catalogued text (nothing is saved), `?i18n=debug` makes `I18n.misses()` list what was seen and not found. The picker is in Settings,
  Appearance (`#language-choice`); on a first start setup opens with a Language step (`launchpad.js`, only while a language besides English is installed, none was chosen and
  `I18n.canSave()`; a browser language that is installed is highlighted, never applied by itself). `I18n.setLanguage` reloads with `location.reload()` when the address would not change (every address ends in `#/place`).
  A server or page sentence with a changing word is written as one whole sentence per case, never `${n === 1 ? 'task' : 'tasks'}` (`TestSentencesStayWhole`). Check a screen with `node tools/i18n-check.js` and its fit with `node tools/text-audit.js --lang pseudo`.

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

- The frame (`#shell`, a grid of sidebar and working surface; `html.has-shell` is set in `theme-boot.js` before paint). There is no top bar and no bottom bar.
  `rail.js` (loaded second to last) is the sidebar of eight places: Overview, Printer, Slicer, Files, Models, AI, Maintenance, Settings, plus a "More" group
  (Automations, Photo studio, Games). A place is one or more screens (`data-tab` panels) and the parts of them (`SECTIONS`); `DEST` lists every
  address a link can name (`#/<dest>`, `#/printer/<id>`) with its place, and `OLD` maps old names. **The sidebar rests as icons (60 px) in every place** and
  opens to 212 px over the page, never moving it, and above a sheet (z-index 40). `wireOpen` opens it when the pointer rests on the icons 110 ms (`INTENT_MS`) or on
  a 10 px strip at the window's left edge 140 ms (`.rail-edge`, so a flick to the edge is never missed), or when a keyboard focus lands in it (never for touch). While
  it is open the pointer's distance from it decides how soon it goes: inside it plus a 14 px margin (`SLACK_PX`) it stays; beside it, 1.5 s (`LINGER_MS`); over
  170 px away or out of the window, 0.45 s (`FAR_MS`); a press anywhere outside, 0.12 s (`CLICK_MS`); 0.6 s (`CHOSEN_MS`) after leaving once a place was chosen from it;
  focus that Tabs out of it, 0.24 s. A closing countdown is never made longer, and the pointer coming back cancels it. An open printer menu and a keyboard focus
  inside it (`:focus-visible`, so a mouse click leaves nothing that pins it) keep it open; Escape closes it. `tools/pagebar-walk.js` checks every one of these with a real
  pointer. `dejavu1.rail.mode` = `wide` keeps it open (the fold button, `[`, or Settings › Always open);
  anything else is the hover sidebar. The open and close are one `width` transition on `.rail-card` (0.3 s, ease-out quint) with the labels fading in after it.
  It reads `dv-tab`, `dv-section`, `dv-printer` and `dv-fleet`. Items carry `aria-label` that starts with the visible label, never `title`. A new place needs a
  `PLACES` row, a `DEST` row and an icon (`tests/test_rail.py`). `#rail-menu` is a child of `body` (the card's backdrop-filter would trap a fixed child).
  **Practice printers** (the simulated printers part of Printer) are hidden until Settings › Printers & connection › Show Practice printers is on
  (`dejavu1.pref.practice`; `shownDest` in rail.js hides the part, the command bar entry and a `#/sandbox` link, which opens All printers; `dv-practice` repaints
  the toolbar).
- The toolbar edge (`pagebar.js`, `#topbar`, the first row of the working surface; `tests/test_pagebar.py`, `node tools/pagebar-walk.js` is the
  browser walk of the whole frame): the place's icon and name (the printer's name beside it on Printer), its parts as `role="tab"` buttons in
  `#pb-parts` (from `Rail.partsOf`; a place with one part shows no row), the place's own buttons in `#pb-actions` and the search. A button in
  `ACTIONS` presses a control the screen already has (`mirror` copies its words, disabled state and hidden state) or runs a function (`run`): Pause and Cancel
  appear only while a print runs, Files has "Bambu to U1 profiles" (opens the converter's file chooser) and Add files. Halt is not in it. Everything the old banner
  carried and other scripts write to by id (`#printer-chip`, `#demo-toggle`, `#ver-chip`, `#pb-help`) is kept in the hidden holder `.tb-hold`; `#pb-tabs` stays
  hidden for `Sections`' own part buttons. The search (`finder.js`) is the command bar: the input at rest, a centred sheet while it has focus
  (`.feature-finder:focus-within`). It lists every place, part, settings group and action with its shortcut (`hint`); a new action goes in `ACTIONS` with its keys.
- The floating dock (`strip.js`, `<footer id="strip">`, `html.has-shell .strip`): **no bar along the bottom**. A fixed column in the bottom right corner holds the
  notification orb with its toasts (`orb.js`; its colour follows the link through `data-link`), the Ask button (`assistant.js` builds it; strip.js adopts it),
  Tester mode's "Something felt off" (`tester.js` moves it into `.strip-end`), the "continue on this computer" offer (`#handoff`, placed by `initDockStack` in
  workshop-part3.js; on phones it stays in the thumb dock) and `#conn`/`#watch-only-pill`, which show only when something is off: demo data ("Simulated"),
  watch-only, or no answer (a live link says nothing). Every screen keeps its last 60 px clear (`.tab-panel::after`; `scroll-padding` also scrolls a focused control clear of it). The printers are chosen in the sidebar (its printer row opens a menu); Find is in the toolbar. **Halt** (`strip.js` runs it, `cockpit.js` builds its
  button `#strip-halt` and the note `#strip-halted`) is on the Printer screen and on no other: `H H` still stops the selected printer from any place (an
  emergency stop should not depend on the open screen), through `runCommand` so a refusal is shown in words, then offers Restart firmware
  (`/api/printer/control/restart`, refused unless the printer reports an error). Settings › Halt "Ask before Halt" (`dejavu1.pref.haltAsk`) adds a second press.
  Halt is #c8102e with white text in every look.
- Slicer (`slicer*.js`, `slicer.css`, `u1-plate.js`; `data-tab` `slicer`, parts Prepare and Preview; old `#/slice`, `#/layers`, `#/prepare` links open it): a dock of glass blocks
  at the left (Printer with the Engine button, Heads, Process, Objects), the plate in the free area (the 3D view draws the U1's own plate from `U1Plate`
  in the app's room colours; `U1Plate` is shared with the twin's and the other viewers' plate), a floating toolbar, view buttons, a plate switcher, an
  inspector and a Slice bar. Built from the shared tokens, so it follows light, dark and the accessibility fallbacks. Details in `slicing.md` "The Slicer".
- Printer screen (`cockpit.js`, `cockpit.css`, `deck.js`): **the printer is the room.** The 3D scene (`#p-stage`, no card, no head) is a fixed layer the size of the window,
  behind the sidebar and the toolbar, and everything else floats over it as glass. The twin frames itself from three CSS values read where it sits (`--twin-fit`,
  `--twin-dx`, `--twin-dy`; `fit` in twin3d.js `resize()` and `matrices()`), so the printer sits in the free area and a sheet or the opening scene gets the same framing by
  setting the same values. The readings sit on the machine: each head, the bed and the chamber carry their temperature in a tag drawn by twin3d.js (`renderTags`, `tagTemp`,
  `.t3-tag` with a leader line to the part); pressing a tag opens the Temperatures sheet. Over the scene: the "This print" card top left (`#tile-job`; its foot is the
  tune row `#tile-tune`), Halt top right and the camera window under it (`#tile-cam`, `#cp-cam-slot`), and a tool palette of labelled buttons at the left (`#cp-dock`: Temperatures,
  Move, Extrude, Fans & lights, Bed mesh, Buttons, Console, Print; icons only under 1100 px, each with a title). The messages stay clear because they stack in the bottom right
  corner, above the "continue here" offer. **Nothing scrolls, and nothing is a rail or a divider.** A press on a tile, a tag or a palette button opens a **sheet**
  (`Deck.create`; `data-open="name"`): a dialog over the screen that holds the existing card(s) (moved, never rebuilt, so ids and listeners stay) and brings
  others beside them (`SHEETS` in cockpit.js: Move, Extrude, Tune, Printer's own buttons, Console, Fans & lights and This print bring the twin and/or the camera).
  Cards not on show wait in `#cp-hold` (laid out off screen at a real size). The twin and the camera are one shared instance each: a sheet takes them and hands
  them back on close; `Panes.dock()` skips the twin while it sits in a sheet. Escape, the close button and the dim area close a sheet; focus is kept inside and
  returns to what opened it; `Deck.unfold(el)` (called from the `scrollIntoView` hook in app-shell.js) opens the sheet that holds a card a tour, the search or a
  "Print a file…" button points at. The twin turns by itself on this screen (`autoSpin`; never with reduced motion, **never where drawing is in software**
  (`Cockpit.software()` reads the renderer from the twin's context), stops under the pointer); `Panes.expandTwin(true)` opens the twin sheet (the walks use it).
  `#cp-job` is the "This print" sheet's own card (progress, time left with where the figure comes from, `etaWords`, the old head's Pause/Cancel). **The camera window takes
  the picture's own shape** (`shape()` in printer-page.js reads the first frame's size into `--cam-ar` on the camera card; the picture is `object-fit: contain`, so the whole
  of it shows and nothing is cropped). On a phone the scene is a rounded picture at the top of the page, then the tool palette (scrolling sideways), the print card and the camera.
- Overview (`overview.js`): no 3D printer. The camera is the hero (`#ov-camera`: a glass window with the picture at its own shape, whole, capped at 54 vh), the
  selected printer's status is a compact card under it (`#ov-now`: state, file, progress with a tick at every tenth, the figures in a grid that wraps by width) and a row
  of chips (Temperatures, Quick control, Maintenance, Totals, Phone) opens sheets; the side is Needs you (the first three; "All N" opens the rest) and every printer
  (`#ov-printers`, the first five). It has its own deck (`Deck.create({ id: 'ov' })`).
- Opening scene (`intro.js`, last script; cover set in `theme-boot.js` as `html.intro-pending`): on a fresh start (navigation type `navigate`, not a reload) the
  twin card is borrowed into a full-screen layer, close up and turning, for 3 s (`.intro-stage` carries the room's `--twin-*` framing); then the camera pulls back
  (`[data-twin="reset"]`) to exactly where the Printer screen draws the printer, the layer's colour fades and the frame rises in (`html.intro-reveal`), and the card is docked
  back. Where the stage does not fill the window (a phone) the old shrink onto the stage runs instead. Off for reduced motion, an automated browser
  (`?intro` forces it), software drawing (`?intro=force` plays it anyway), Settings › Opening scene off, `?nointro`, or when the twin is not ready in 3.4 s; a click,
  a key or Skip ends it; the cover is also lifted by a 5.2 s timer so a page is never left covered. Replay: the command bar's "Play the opening scene". A first start
  (no saved screen and no Settings › Open on) opens on Printer.
- Ready to print (`loadHealth`, workshop-part2.js; the card was "Print health"): a quiet ring with a knob at its end (`#g-needle`, kept for `tools/testfix-check.js`),
  one of four kind phrases (Ready to go, Nearly there, Worth a look, Not ready yet) and what would help listed as gains ("+8 Overdue: ..."), never as penalties. The
  score is still Confirm Print's (`backend/print_gate.py`); blocked stays red and under 55. Its explainer is keyed `ready to print` in explain.js.
- AI print watch (`watchCard`, assistant-part1.js): the picture box is the printer's live camera (`PrinterPage.attachCam`; one player kept between redraws of the
  page, `watchCamHost`) with brackets, what the AI looks for, its last verdict and, on a real printer, a small copy of the picture it last judged; `Check now` runs a scan
  line over it (`.is-looking`, transform only).
- Time left (`hoursLeft`, `etaWords`, app-shell.js): the server's one estimate (`state.eta`, backend/print_eta.py); the old elapsed/progress guess remains only as the
  fallback for the static demo's recording. Show `etaWords(state)` beside a time so the figure says where it comes from.
- Files: the Snapmaker U1 profiles banner (`#convert-card`, the converter for .3mf projects from Bambu Studio and other slicers) is the first thing on Files; the toolbar
  has "Bambu to U1 profiles"; Models points to it (`#models-to-profiles`).
- Settings (`settings.js`): Preferences' cards are moved into the Settings screen, `SECTIONS.modules` sorts every card into a group (Printers &
  connection, Look & layout, Phone & away, Alerts & smart home, Tester mode, Updates, Advanced, Help), the left list shows one group at a time and the
  search shows every card that mentions the words. Demo data is in Advanced (`#demo-toggle` stays as a hidden input that `#demo-setting` mirrors).
- Maintenance (`app-modules.js`, `shell-panes.css`): `#mt-band` is a readouts band whose Overdue, Due soon and OK cells are buttons that filter `#tasks` (press the
  same one again for all; `renderTasks()` redraws and keeps the focus) beside the printer's totals; each `.task` row has three cells (name and description,
  gauge, actions) with a hairline under it and a 3 px status stripe, flat in every look. Overview's small `.task` rows are untouched. Files: the whole
  `#tab-files` takes a dropped file (`html.is-dropping` outlines the surface, `#file-drop` is the label) and an empty library is one dashed button
  (`#file-empty`). AI with none connected: the headline and the three gains as rows beside it (`.ai-intro`).
- Tabs: Overview (glance tiles, no twin); Printer (data-tab `control`, kept for saved tabs and
  tours: the cockpit above);
  Preferences (`prefs`). Photo studio has no tab button.
- Sections (`app.js` `SECTIONS`, `window.Sections`): Printer, Printers, Files, Care and Settings show
  one part at a time. Cards are sorted by `#id`, `.class` or the start of their h2 title; a card no
  rule names joins the first part. A new card on those screens needs a rule.
  `Sections.reveal` opens the part of anything scrolled to. The toolbar edge's parts row (`#pb-parts`) replaces `Sections`' own
  buttons (`.sec-bar`, kept hidden in `#pb-tabs` for ids); `Sections.choose(tab, key)` is still the one way to open a part. "Everything" is gone.
- `colour-bridge.js` + `colour-setup.js` + `colour-setup.css` (after `printer-extras.js`): the colour checker's setup window (`#colour-setup`, opened by
  `#colour-setup-open` on the Right colour loaded? card). `ColourBridge` is the USB route (Web Serial, only after Connect or an earlier allow; posts a reading
  only when its sensor has a head and the Pico is not already sending by Wi-Fi). `ColourSetup` makes `settings.toml` (`tomlString`, `tomlFor`, `problems`),
  lists sensors that wait for a head (Wi-Fi ones from the server, a USB one from the cable), runs the channel test, brightness (a command: over USB it is answered
  at once, over Wi-Fi it rides the next reading), the references and the bench. **The Wi-Fi password is used in this window only: never send it to a route.**
  A switched-off module shows a notice at the top (`#cs-module-live`; its button uses the global `[data-turn-on]` handler) and the address and printer problems wait until the app has answered
  (`problems(v, known)`; the module-off answer is not connection info). Up to three of this computer's addresses start ticked (the Pico keeps four, `problems` refuses more). **Copy the report**
  (`diagnosticsText`, `collectDiagnostics`) writes plain English for a message and blanks the Wi-Fi name, password and pairing code wherever they appear: add every new private field to `secrets`.
  `tools/colour-setup-check.js` drives all of it with the real firmware as a stand-in Pico and a fake `navigator.serial`.
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
- `errorhelp.js` + `errorhelp.css`: the error code window (a `glass-dialog`), the one-line strip (`ErrorHelp.strip(problem)`) the print tile, Overview card and logbook
  share, the Care tab's "Error codes" lookup card (`#error-codes`, named in `SECTIONS`) and "What the printer said lately". Anything with
  `data-errhelp="CODE"` opens the window (a capture-phase handler that stops the press, so a strip inside a tile does not also open the tile's sheet). Guides arrive as
  plain blocks from `/api/errors/guide` and go through `esc()`. YouTube loads only after the play button (`youtube-nocookie.com`, `referrerpolicy` set because the
  app sends no referrer and the player refuses with Error 153 without one); the page's own address goes to YouTube, which the line under the button says. The
  online demo's `tourGet` answers `/api/errors/guide` with a note and the wiki's link, and records a few codes (`error_variants` in record.py).
- `explain.js`: an ⓘ after each known card title (HELP, keyed by the title's letters and digits) and
  `[[word]]` glossary links. Write notes in plain words. `tests/test_explain.py` fails when a note's
  card is renamed. `finder.js` (Ctrl/Cmd+K) ignores the ⓘ button; `tests/test_finder.py`. Its search box lives at the right of the top bar (`.feature-finder`) and moves into the phone's More sheet.
- `guide.js`: tours. The quick tour (`Guide.everything()`) is nine stops; keep it short. More detail
  lives in `Guide.screen(tab)`, 1 to 4 stops per screen.
- `orb.js`: the notification orb (in the floating dock); `toast()` hands every message to `Orb.notify`. One translucent
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
- `rail.js` keyboard: `GO_KEYS` (G then a letter), Alt+1 to 8 (the eight places), `[` keeps the sidebar open or lets it close by itself, `H H` is Halt (`strip.js`), `?` opens
  `#kb-sheet`; `typing()` skips text fields but not switches. `OLD` maps fleet, control, library, care, modules, autoprint, prepare, jobs and materials.

## Glass and text systems (21 November 2026)

**Glass (`glass.css`, loaded after `cockpit.css`).** Two grades under one rule (Apple's Materials guidance): controls and navigation (the sidebar, the toolbar, the tool
palette, readings on the printer, sheets) are Liquid Glass, tier 3 and 4; content panels (cards, fleet cards, Settings groups, Overview's side panels) are the quieter
frosted material, tier 2 (`--m-tint`, `--g-blur`). Everything sits over **the room**: a neutral cool field with a faint 32 px grid (`body` background in glass.css),
the dots (`backdrop.js`) and, softly, the colours of the loaded filaments (`.pool-a`, `.pool-b`). No panel is opaque paper and no glass sits on glass. A card inside the
Printer room, Overview or a sheet is excluded from the generic card rule (`:not(.cp *):not(.ovd *)`): those are laid out by cockpit.css. The look is technical on purpose:
16 px panels, 10 px controls, hairline rims, flat buttons, rectangular tags on leader lines, gauge ticks on progress bars, viewfinder corners on the camera, mono figures.
Reduced transparency makes every panel solid, increased contrast adds borders, reduced motion removes the glints (end of glass.css and cockpit.css).
**Panel spacing and the specificity trap.** Panels are 14 px apart on every screen: the one floating-panel rule gives each panel `margin: 0 0 14px`, a grid or flex stack that
already has a `gap` (`.grid-2`, `.flow-run`, `.desk-grid`, `.ov-grid`, `.fleet-grid`, `.set-body`) takes it off its panels, and a wrapper's own top margin is zero. The rule carries two
`:not()` exclusions, so it is more specific than any plain `.card` or `.fleet-card` rule: **a later rule for the same panels must name the same exclusions or it silently loses**
(this is how the printer cards lost their padding and stacked cards lost their gap, on screens that looked fine). The audit's `flush`, `tight` and `uneven` checks find it.
**A panel whose heading is all that shows** (its body `[hidden]`, its `.card-sub` hidden for "I know my way around") has no line under its heading (glass.css, `:has()`), so it reads
as one row, not an empty box. **Dark mode and raw colours:** a tile drawn with a raw light colour (`rgba(255, 255, 255, .6)`) needs a line in `dark.css` or it is pale grey under white
text in dark (Readings' figures and History's findings were); prefer the tokens. **Fold toggles** (`details > summary`) are flex rows with `gap: 8px`, because a flex row drops the
space after a text marker; `.log` toggles draw a chevron. **Farm:** a job bar under 7% of the day is labelled just after it (`.dk-tag`) when the lane has room; `.dk-scroll` hides
its vertical overflow because the marker for now is drawn 9,999 px tall.

**Text (`text.css`, `text.js`).** One rule set for text that does not fit. Prose wraps and a long unbroken word wraps too (`overflow-wrap: anywhere`, which also lets flex
and grid items shrink to it). Names and labels are one line with an ellipsis (the selector list at the top of text.css; add a new kind of name there); a button keeps its words and
only a label that carries a printer or file name may shrink. Nothing is under 11 px (the floor list at the end). `text.js` does three things: it puts the full text in the
`title` of anything cut when the pointer rests on it, it cuts a file name in the middle (`.mt`: start gives way, extension and version stay; the cut falls between words), and
it adds `<wbr>` hints after `_ - . /` in long names inside wrapped text. **`node tools/text-audit.js`** is the check: every screen, each sheet and Settings group, at 1366, 1024
and 390 px (`--dark` adds dark, `--focus` tabs through every screen, `--only a,b` limits it), with the server's answers rewritten on the way so every printer, file and task name
is about 70 characters longer and the WebSocket is off. It reports clipped, outside, hidden (a control a box cuts away or pushes out of the window: text cut away whole is not "clipped" text), collide, stacked (text forced down one or two characters a line), flush (text touching its panel's edge: the panel lost its padding), overlap, tight (panels under 8 px apart), uneven (panels 8 to 48 px apart but not 14), wrap, mute, tiny, target, unnamed and focus findings and exits 1 on any;
`tests/test_text_system.py` runs it. Run it after any change to a screen.

## Building blocks (the SHELL frame)

Every screen is made from these. Reuse them; add a variant only when a screen needs one, and say so here. `design/shell/PLAN.md` (private
repository) holds the reasons.

| Block | Where | What to know |
|---|---|---|
| Frame | `#shell`, `shell.css` | Grid: sidebar, working surface (`main.wrap`). 8 px gutters. At 720 px and less the surface is the page and the dock is fixed at the bottom. |
| Surface | `html.has-shell .wrap`, `shell-panes.css` | Paper, one shape. A `.card` inside it has no box: it is a cell with a hairline under it, its `h2` is a small mono-caps label, and `.card-head` is a 38 px row. Write cards as before; do not add backgrounds, borders or shadows to them. |
| Toolbar edge | `#topbar`, `pagebar.js` | The place's name, its parts (`Rail.partsOf`), its buttons (`ACTIONS`), the search. Parts never open another place. |
| Activity tray | `#act-btn` in `#topbar`, `activity.js` | Long jobs in words (slicing, the engine install, uploads, a print starting, time-lapse copies) with one button each to where they belong. It only reads; jobs that run in the page report with `Activity.add()`, the rest it asks the server about. |
| Pane, divider | `panes.js` | `.pane` scrolls by itself; `.split` is a W3C window splitter. Put cards in a pane with `Panes.put`; give a new divider a name so Reset layout covers it. |
| Stage | `.stage` | The main view that fills the space (the twin). Tiles dock around it. |
| Tile, sheet | `cockpit.js`, `overview.js`, `deck.js`, `cockpit.css` | A tile is a glance (a few figures, one press); a sheet is the pop-up it opens, holding existing cards and bringing the twin and camera along. A screen that is a glance never scrolls. |
| Readouts, row | `.readouts`, `.ro`, `.row` | Mono figures with units; a row is dot or meter, title, mono sub-line and one action, 44 px high. |
| Floating card | dialogs, `.orb-panel`, the command bar, a deck sheet | The card that stays: a confirmation, a short form, one setting, a sheet. Floating, so the strongest shadow (a deck sheet is solid paper: it holds content, so no glass). |
| Halt, orb | `strip.js`, `cockpit.js` | See "The floating dock" and "Printer screen" above. |

- **Glass by tier** (the `liquid-glass` skill): the sidebar is tier 4 (anchored: soft, wide shadow, edge lensing), the open sidebar overlay, the orb panel and the
  floating dock's pills are tier 3, segmented controls tier 1. The working surface is paper because it is content; never put glass on glass.
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
