---
paths:
  - "frontend/**"
---

# Frontend notes

Plain HTML, CSS and JavaScript: no framework, no build, served as-is. **Everything in `frontend/` is
published** (Cloudflare serves it as the product page and the online demo), so never put notes,
keys or private text here. Every change shows in the online demo: check `/?demo` on a static
server. Load the frontend-design and liquid-glass skills before changing a screen.

## Load order and shared names

- Scripts: `theme-boot.js` in `<head>`, then `app.js` → `layout.js` → `orb.js` → `backdrop.js` → `viewer3d.js` →
  `ar.js` → `twin3d-scene.js` → `twin3d.js` → `workshop.js` → `studio.js` → `layer-stack.js` →
  `farm.js` → `guide.js` → `launchpad.js` → `phone.js` → `explain.js` → `versions.js` → `finder.js`
  → `desk.js` → `telemetry.js` → `printer-page.js` → `printer-extras.js` → `logbook.js` →
  `insights.js` → `printroom.js` → `plate.js` → `gcode-view.js` → `slicer-workspace.js` →
  `backup.js` → `maker.js` → `rail.js`. `games.js` loads on demand (`loadGames()`).
- CSS: `style.css` → `workshop.css` → `farm.css` → `printer.css` → `guide.css` → `theme.css` →
  `dark.css` → `looks.css`.
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
- Tabs: Overview (cards about now, no twin); Printer (data-tab `control`, kept for saved tabs and
  tours: the twin, camera, Move pad, temperatures, extrude, tune, fans, mesh, macros, console);
  Preferences (`prefs`). Photo studio has no tab button.
- Sections (`app.js` `SECTIONS`, `window.Sections`): Printer, Printers, Files, Care and Settings show
  one part at a time. Cards are sorted by `#id`, `.class` or the start of their h2 title; a card no
  rule names joins the first part. A new card on those screens needs a rule.
  `Sections.reveal` opens the part of anything scrolled to.
- `printer-page.js` + `printer.css`: the Printer page, the Overview cards, the camera view (`.pcam`,
  at most five pictures a second, only while visible) and Preferences.
- `workshop.js`: live WebSocket with a polling fallback (asks once a second and retries the WebSocket
  every 10 s); `nudgeLive` reconnects on visibilitychange, online and bfcache pageshow. Fleet cards,
  Needs you, files, dialogs, morph animations.
- `launchpad.js`: setup (skippable), the desktop-app card, update settings. Browser-only names never
  enter requests. `phone.js`: the QR sheet and `?pair=` redemption; `Phone.install()` picks install
  steps (Chrome installs only from https, localhost or a flagged address).
- `explain.js`: an ⓘ after each known card title (HELP, keyed by the title's letters and digits) and
  `[[word]]` glossary links. Write notes in plain words. `tests/test_explain.py` fails when a note's
  card is renamed. `finder.js` (Ctrl/Cmd+K) ignores the ⓘ button; `tests/test_finder.py`.
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

## Games (`games.js`)

Every game timer goes through `frameEvery()` (rAF-driven fixed steps). `fitGameCanvas()` sizes the
canvas. `tests/test_frontend_refresh.py` reads `games.js` as text: keep it independent of spacing.

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
