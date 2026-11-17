# What has been tested

Updated 16 November 2026. Three kinds of evidence, kept apart so you can see which is which:

- **Real U1:** run on a real Snapmaker U1.
- **Automated and stand-in:** the test suite (it runs before every release is published), a
  Moonraker stand-in built from Moonraker's source, stand-ins for each outside service built from
  that service's own source, and browser checks in Chromium.
- **In progress:** the hardware still being built, listed at the end.

## On a real Snapmaker U1

Snapmaker sponsored a U1 for Deja Vu1 through the Innovation Fund (delivered 31 October 2026). It
runs Snapmaker's stock firmware, and Deja Vu1 runs on a Windows computer on the same network.
Tested on it:

- Adding the printer and connecting to it.
- Live readings: state, temperatures, progress, the four heads, and the 3D twin following the print.
- Starting prints through Confirm Print, pausing and cancelling.
- The camera and time-lapses.
- The Printer page controls: moving the head, heating, fans, lights, macros and the console.
- The AI assistant, connected to this printer. A paid API key has run the assistant too
  (both confirmed 13 November 2026).

The rest of the dashboard was used with the same printer. The firmware version will be added here.

## Automated and stand-in

- **The test suite:** 1621 tests passed on Python 3.13.18 (Linux, 17 November 2026, version 0.20.15
  plus the first-run fixes), run as five parallel groups: 1278.8 seconds of test time in all, 516 seconds from
  start to finish. The check that the count quoted here is right failed on that run (it still said 1612) and
  passed once the number was updated. The run before it: 1612 tests (17 November 2026, version 0.20.15 plus
  Tester mode and its checks), one serial run: 1369.6 seconds (22 minutes 50 seconds). The run before that: 1557
  tests (16 November 2026, version 0.20.14 plus colour calibration, the sensor in Confirm Print, the browser
  walk and the screen fixes it found), run as five parallel groups (the browser walk on its own): 977.9 seconds of test time in all, about 254
  seconds from start to finish. The browser walk's group failed once on a wait that was too short while the
  other groups loaded the computer; its waits were lengthened and it passed again, also under artificial load.
  The run before it: 1513 tests, 868.0 seconds of test time in all and 373 seconds from start to finish
  (16 November, before these changes); the single run before that: 1510 tests in 1126.4 seconds
  (13 November). GitHub Actions runs the suite on Python 3.8, 3.10, 3.12 and 3.13, and the release job
  runs it again before publishing. A test (`tests/test_public_numbers.py`) fails when the test count in the
  README, this page, the board or the slicer record, or a figure in the board's picture, no longer matches
  the code.
- **The browser walk** (`node tools/browser-walk.js --axe`, 16 November 2026, Chromium on Linux): all 17
  places at 1366 px and 390 px, in light and dark, with demo data and with none (136 visits), plus 17
  workflow runs: importing a file, Confirm Print on every sample G-code file, a slow answer for an earlier
  file, the queue, opening a model, the slicer set-up card, phone pairing, the colour sensor on a stand-in
  printer, and script payloads planted in file names, printer names, spools and notes. No script error, server
  error, sideways scrolling or stray `undefined` text, and no payload ran. It took 5 minutes 20 seconds. Each
  check was shown to fail on a planted fault first. [Check Deja Vu1 yourself](for-reviewers.md).
- **Tester mode** (17 November 2026, Chromium on Linux, against a stand-in printer, not a real U1). The tests
  cover the switch (every `/api/tester` route answers 403 while it is off and nothing is written),
  the masking of addresses, keys, folders with a user name and the names of files, printers and spools through
  every way in, a synthetic week of 26 MB thinned to a zip under 25 MB with the totals unchanged, the sections of the
  saved zip, watch-only mode with Tester mode on, and `tools/tester-reports.py` combining two reports.
  `node tools/tester-walk.js` uses the app with the switch off (the browser sends nothing) and on (every place, a print
  on the stand-in printer, a request held back 2.6 seconds, a button that freezes the page for 1.4 seconds, an error, a
  failed promise, an error toast and a note), saves the zip, and opens its `report.html` with no network at 1366 px and
  390 px in light and dark. Cost of recording on the Printer page with the 3D twin, in Chromium with software
  rendering (24 alternating pairs of 6-second stretches, off against on, in two runs of 12): press to next paint +2.5 % (standard error
  1.2), the page's main-thread time +2.1 % (1.3), frame time +1.8 % (3.9, within the noise). A CPU profile puts the
  recorder's own script at 27 ms over 72.5 seconds, 0.04 % of the time. Not tested: Tester mode on a real U1, on
  Windows or macOS, or in a browser other than Chromium.
- **Accessibility** (axe-core 4.10.2, WCAG 2.2 AA and best-practice rules, every place at 1366 px light and
  dark and 390 px light, with demo data, 16 November 2026): three failing rules were found and fixed (the
  Light, Dark and System buttons carried an attribute their role does not allow, the Farm desk schedule and
  the G-code console could not be reached with the Tab key, the Overview progress bar had no name). After
  the fixes no rule fails. An automated check covers part of WCAG; it does not replace a screen-reader test.
- **Protections against other web pages** (a running server probed with curl, 16 November 2026): an unknown
  or rebinding-style Host header answered 421; a cross-site POST and `Origin: null` answered 403; a file
  name with `../` was refused or reduced to a plain name inside the library; the source files and the data
  folder were not served (404); the anti-framing headers were present; a WebSocket request from another
  origin answered 403.
- **The printer connection** in the suite, against a Moonraker stand-in (`tests/fake_moonraker.py`)
  over real sockets: commands, refusals, watch-only mode (no write gets through), sign-in, the
  camera list, pictures and live stream, reconnects, a printer that moved to another address, and
  updates while a print runs.
- **Install, start-up and updates** in the suite on Linux: staging, restart, rollback after a failed
  start, git-copy updates against real git repositories, and the paste blocks kept identical
  everywhere they appear. A real download, restart and health check with the real launcher took
  7 seconds on Linux (6 November 2026).
- **Screens** in Chromium at 1366 px and 390 px wide, checked by the session that changed them: each
  look in light and dark, text contrast measured against WCAG AA, and the online demo at both
  widths.
- **The AI assistant:** a full conversation through a Claude plan (Claude Code 2.1.322) on a demo
  printer on Linux, 12 November 2026: connecting, a cancel after one Approve, homing and heating with
  no approvals, a camera picture, a settings suggestion and the token count. Codex 0.167.2's options,
  model list and "not signed in" answer were read from the program. The key services' addresses
  answered a request without a key the same day. GitHub Models has since been taken off the list:
  GitHub's documentation says GitHub retired it on 30 July 2026. Later on 12 November, through the
  same Claude plan: a question asked in Spanish was answered in Spanish with the demo printer's bed
  reading, and `tools/translate.py` translated five strings into Simplified Chinese with the
  placeholder, link and `M112` unchanged. A stand-in chat service on the test computer drove the
  cost shown before sending, a price and a spending limit on the AI screen, and a conversation that
  built a plate with four holes and a pocket (a closed STL within 0.2% of the exact volume). The same
  stand-in drove a conversation that made a 24-tooth gear (39 mm across, as module 1.5 gives, closed)
  and switched on print watch from the AI screen. Slicing from the chat and print watch's camera
  checks have run only against stand-in engines, cameras and AIs in the suite; no slicing engine or
  real camera was on the test computer. In the suite, stand-in services, stand-in `claude` and `codex` programs and stand-in
  keyrings cover both wire formats, error messages, key storage, redirects and every safety limit.
  The assistant has also run on the real U1 and through a paid API key (see above).
  Panel and AI screen checked at 1366 px and 390 px, light and dark, and in the static online demo,
  with no page errors. [AI assistant](ai-assistant.md).
  Round 5, 12 November 2026, through the same Claude plan on a demo printer: "Take me to the digital
  twin" opened the Printer page at the twin; a phone stand was made, its card's Open it opened the file
  in Files, and the readings came back as a card; a saved conversation reopened after a server restart;
  disconnecting removed every AI shortcut (10 to 0). Sign in with ChatGPT ran against a stand-in for
  OpenAI's sign-in and Responses API in the suite (registration, PKCE, the ID token's signature,
  refresh, sign-out, the plan's usage-limit error). Claude
  Code's sign-in ran against a stand-in `claude` program. The stock U1 slicer settings were chosen from
  Snapmaker's own preset list (version 02.03.03.03, in `tests/fixtures`) and saved as a profile against
  stand-in preset files, with a stand-in engine for the test slice. Listing and keeping the printer's
  own videos ran against a stand-in Moonraker answering the `camera` root the way owners report the
  U1's firmware 2.0.0 does.
- **Colour-checker ingestion:** synthetic version 1 messages through the actual local HTTP API and
  a Moonraker stand-in, including identity mismatch, replay, clock changes, expiry, low quality,
  raw-only samples, reassignment and restart. The colour card was checked at both widths in all
  three looks, light and dark, with details and keyboard focus retained on refresh. There were no
  page errors or sideways scrolling; the static demo also passed its browser check.
  [Browser evidence](evidence/colour-sensor-browser.json) and [API contract](colour-sensor-api.md).

## Slicing engines

Deja Vu1 runs an engine you install; it doesn't bundle one. Builds run for real:

| Engine | Version | System |
|---|---|---|
| Snapmaker_Orca | 02.08.01.55 | Linux |
| OrcaSlicer | 2.4.2 | Linux |

Any other build shows "Not tested" when you press **Check slicer** and still slices. Snapmaker_Orca
sliced different heights per head (0.4/0.6 mm nozzles at 0.14/0.28 mm, 0.4/0.8 mm at 0.2/0.4 mm,
two 0.4 mm at 0.1/0.2 mm). OrcaSlicer 2.4.2 sliced multi-object plates, four-tool image tiles,
layered swatches and heightmap reliefs. All three plates of the converted MakerWorld fixture
sliced, each on its own. Details:
[engine support](engine-support.md) and [slicer workspace validation](slicer-workspace-validation.md).

## In progress

- **The colour checker** ("Right colour loaded?"). The comparison logic, a simulation and the
  companion API, the white-reference calibration and the Confirm Print advice are tested with synthetic sensor
  messages and a stand-in printer (`tests/test_sensor_calibration.py` and the sensor workflow in
  `tools/browser-walk.js`). The firmware, sensor drivers and a bench test of a physical sensor come next.
  [Design](hardware-modules.md)
- **LED dock rings.** The on-screen states exist; the ring driver doesn't. A WLED strip you already
  own can show the same states today.
- **Spool scales.** Planned after the colour checker.

## Tested with stand-ins

Each of these runs against a stand-in that answers the way the real program, service or device
does. The test files named below passed on 13 November 2026 (Linux, Python 3.13.18); the AR
preview and heavy-model checks ran in Chromium.

- **A second printer and other Klipper printers:** the fleet tests send one action to several
  stand-in printers at once and report each printer's own result (`tests/test_fleet_command.py`).
  A one-head 235 × 235 × 250 mm Klipper printer connects and describes its own size and heads
  (`tests/test_machines.py`).
- **macOS:** the start-at-sign-in file is checked as a valid macOS launch file
  (`tests/test_autostart.py`), and **Check slicer** names macOS for an engine there
  (`tests/test_engine_support.py`). The AI key store runs its macOS Keychain path against a
  stand-in `security` program.
- **Windows:** the server answers every command when started with no window, the way Windows
  starts it in the background (`tests/test_no_window.py`). **Check slicer** reads a Windows build's
  version from its settings file, run against a stand-in engine. When Windows key protection is
  missing, the AI key store falls back to its private file and says so.
- **The community Extended Firmware:** its camera listing, its camera signalling and its web sign-in
  run against the Moonraker stand-in (`tests/test_stock_camera.py`, `tests/test_webrtc_relay.py`,
  `tests/test_discovery.py`).
- **go2rtc low-latency video:** a stand-in go2rtc, and real WebRTC video between two Chromium pages
  ([low-latency camera](low-latency-camera.md)).
- **Spoolman:** spool import against a stand-in built from Spoolman's API source
  (`tests/test_spoolman.py`).
- **WLED and Home Assistant:** stand-in servers that follow each one's own rules
  (`tests/test_outbound.py`), plus refused and unreachable addresses (`tests/test_bridges.py`).
- **Tailscale and remote access:** a stand-in `tailscale` program answering in Tailscale's own
  formats (`tests/test_remote.py`).
- **AR preview:** a stand-in for a phone's WebXR in Chromium, at desktop and phone sizes with touch
  ([AR preview](ar-preview.md)).
- **Heavy models:** frame times measured in Chromium's software rendering with 200,000 triangles.

## Earlier records

- [Slicer workspace validation](slicer-workspace-validation.md): engine output, plate selection,
  recovery and browser checks for the slicing rounds.
- [Native studio](native-studio-validation.md): the round-two evidence, kept for history.
- [The CHANGELOG](../CHANGELOG.md): what each version changed and how it was checked.
