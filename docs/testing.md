# What has been tested

Updated 23 November 2026. Three kinds of evidence, kept apart so you can see which is which:

- **Real U1:** run on a real Snapmaker U1.
- **Automated and stand-in:** the test suite (it runs before every release is published), a
  Moonraker stand-in built from Moonraker's source, stand-ins for each outside service built from
  that service's own source, and browser checks in Chromium.
- **In progress:** the hardware still being built, listed at the end.

## On a real Snapmaker U1

Snapmaker sponsored a U1 for Deja Vu1 through the Innovation Fund (delivered 31 October 2026). It
runs Snapmaker's stock firmware, and Deja Vu1 runs on a Windows computer on the same network.

**The live run of 22 November 2026.** Snapmaker U1 on firmware 2.1.2 (software
2.1.2.159_20261110113009) with four 0.4 mm heads, all loaded with PLA. Deja Vu1 0.20.37 from the
download install (not a git checkout) on Windows 11, with demo data off (`/api/health` answered
connected true, demo false). A script drove Google Chrome at 1366 × 800 and 390 × 844. Each result
was checked against two witnesses besides the app's screen: the printer's own Moonraker readings,
polled about four times a second by a recorder, and the camera. It ran from about 13:30 to 17:05.

- **Readings and motion.** Live readings matched the printer's own. Home all (twice) and Home X, Y
  and Z one at a time, with the 3D twin and the camera side by side: the twin's labels read
  "homing", then "on carriage", while the camera showed the head moving. Four corner moves and the
  centre landed within 0.1 mm of the target. Tool changes T0 to T3 took about 6 s each. Fan, light,
  speed, flow, Z nudge, extrude and retract (10 mm accepted), the G-code console, the bed mesh read
  and motors off worked. The nozzle reached 200 °C in 23 s and the bed 60 °C in 2 minutes 18 s.
- **Slicing on Windows.** The Slicer's Install engine button installed Snapmaker Orca 2.4.1 (4
  minutes 3 s). It sliced 3DBenchy in 12.7 s and cubes. An unreadable file and a model bigger than
  the U1 were refused in words, with a Scale to fit button for the second.
- **Two prints that ran to the end.** A 20 mm cube, then a two-colour, two-object print (16 mm
  cubes on T0 and T1, 80 layers, 33 minutes estimated), each started through Confirm Print. The
  two-colour print finished 80 of 80 layers (1733 s of printing). The app showed Finished, the
  queue marked the bed as awaiting clearing, the maintenance count rose to 20 prints and Cost
  history recorded 9.6 g and $0.21.
- **Print control.** Pause (the printer paused 3 s after the click), Resume (13 to 26 s from click
  to printing), speed 80 and 100 (the printer read back 0.8 and 1.0 within 3 s), cancel with its
  two-step button (the printer cancelled within 3 s and the heaters were off about 10 s later), and
  skipping one object during the print (the printer's own list showed it excluded, the app said
  "confirmed by the printer in 1239 ms", and the camera showed that cube was never printed).
- **Halt and Watch-only.** Halt put the printer in shutdown 0.13 s after the click and 0.15 s after
  the second H of H H. Restart firmware brought it back to Ready in 8 to 10 s, twice. Watch-only
  refused 11 kinds of command with a 409 and the reason in words; the snapshot and the camera still
  answered and the printer did not change.
- **Refusals in words.** Extruding more than 100 mm, speed 5 %, Home Z before X and Y ("Must home X
  and Y axes first"), skipping with nothing chosen, and a notification test with no channel set up.
- **Camera, files and records.** Live view and snapshots; a time-lapse of 12 frames played in the
  browser; upload, library and the G-code queue (add, reorder, remove, an STL refused in words); the
  Logbook wrote fault entries by itself, including the printer's own pause for a dirty bed and both
  Halts.
- **The assistant.** With the Claude plan provider it read the printer correctly (about 21 s an
  answer, half a US cent to 2 cents), said so when it lacked data, refused to act in Advice mode and
  waited for approval in Ask mode. One Print watch picture check took 21 s. The saved Gemini
  provider answered "503 high demand" twice. The error guide explained the Halt code as not in
  Snapmaker's table.
- **Screens.** Alt+1 to 8, G plus a letter, ?, Ctrl+J and H H; three looks in light and dark at 1366
  and 390 px with no sideways scroll; 21 screens in four variants without bad text. Pressing Home
  all twice, and reloading the page in the middle of homing, caused no crash.

**Not verified on a real U1:** a link that drops during a move, two browser tabs at once, a real
notification send (no channel was set up), Backup restore (the read said more than 10,000 data
files need an offline backup), installing an app update, the Colour, Farm, Sandbox, plugins and
Compare screens beyond opening them, the Away from home card beyond opening it (Tailscale was not
installed on that computer), playing one of the printer's own time-lapse videos, how much plastic a
10 mm extrude moved, Print watch running by itself over a whole print, and the Windows launcher,
start at sign-in and recovery paths. The engine's own arrange and orient steps crash on Windows
(`tools/engine-selftest.py` passed 7 of 9); the Slicer uses its own arrange.

**Earlier, 13 November 2026:** adding the printer and connecting to it, live readings, the 3D twin,
Confirm Print, pausing and cancelling, the camera and time-lapses, the Printer page controls and the
AI assistant, which also ran through a paid API key.

## Automated and stand-in

- **The test suite:** 2120 tests passed on Python 3.13.18 (Linux, 25 November 2026, version 0.20.39 plus the releases that remember your files and read your print history), after one serial run of 2,323.8 seconds (39 minutes) of test time, in which the only failure was this count, which each release updates. The run before it: 2101 tests passed on Python 3.13.18 (Linux, 24 November 2026, version 0.20.39 plus this release's changes), after one serial run of 2,270.8 seconds (38 minutes) of test time with other browser checks running beside it, in which 11 tests failed. Eight were records this release had to refresh (the Spanish for 195 new texts, the online demo recording, the tester sample page, the setup walk and the tester walk, which expected seven setup steps where there are now nine, and this count), one was the time-lapse copy check, whose stand-in printer listed the kept copy later than a real one does, and two were the Slicer walk, which timed out under the extra load and passed alone. Each was fixed and those seven modules (109 tests) passed on a rerun.
  The run before it: 2030 tests passed on Python 3.13.18 (Linux, 23 November 2026, version 0.20.38 plus the live-run fixes), one serial run, 1,760.3 seconds (29 minutes) of test time in all; the one test that failed in that run, the tester walk's check of the first run, expected seven setup steps and setup now has an eighth, the Language step, so the walk and the test were updated and that module (8 tests) passed on a rerun. The first full run of this version (1,787 seconds) had three failures, all real: the explain button's click handler swallowed every click for 700 ms after it opened the error window (two error-window checks), and the 409 for a refused command also answered a read that a stand-in printer does not support, which the browser walk reported as a console error; both were fixed (a read stays 502) and each module passed on a rerun. The run before it: 1993 tests (22 November 2026, version 0.20.37 plus the translation setup), one serial run, 1950 seconds (32 minutes 30 seconds); the test that checks the quoted test count failed on the first pass (this page still said 1951) and passed once the count was updated. The run before it, the same day: 1951 tests (version 0.20.36 plus the fixes for 3MF projects that the slicing engine refused), five serial parts of 265, 426, 337, 460 and 463 tests (1719 seconds in all, 28 minutes 39 seconds), after one fix of the same kind (it still said 1922). The run before that, the same day: 1922 tests (version 0.20.34 plus the Slicer's camera, keys, filament picker and saved settings), one serial run, 1600.9 seconds (26 minutes 41 seconds), after one fix: the test that checks the quoted test count failed first (it still said 1911) and passed once the count was updated; the other 1921 passed the first time. The run before it, the same night: 1911 tests, 1672.9 seconds, no failures. The run before that, also the same night: 1911 tests, 1781.1 seconds; six failed (the stylesheet-order test, the browser walk's old set-up card and model panel, a settings-file test that replaced the path where it was not read, a message-text test, a tester code pointer to a removed file, and the Slicer's reload check once under load); each passed after its fix. The run before that: 1882 tests (21 November 2026, version 0.20.32 plus error codes), 1685.7 seconds (28 minutes 6 seconds), no failures. The run before that: 1877 tests (the same day, before the reconnect reading and the window's browser check were added), 1725.9 seconds; one test failed in that run, the quoted test count, and passed once the count was updated. The run before that: 1806 tests (version 0.20.30 plus the spacing and padding fixes and the stronger text audit), 1545.0 seconds, no failures. The run before that: 1805 tests (the same day, before the last two spacing fixes), 1551.7 seconds, no failures. The run before that: 1803 tests (Linux, 21 November 2026, version 0.20.29 plus the Printer room, the glass and text systems and the Overview rebuild), 1553.1 seconds; one test failed in that run, the quoted test count (1789 until that change added 14 tests), and passed once the count was updated. The run before that: 1789 tests (Linux, 20 November 2026, version 0.20.27 plus the Printer screen, Overview and frame rebuild), one serial run, 1275.4 seconds (21 minutes 15 seconds); three tests failed in that run and passed when run again after their fixes: the quoted test count (1762 until this change added 27 tests), the setup walk (the opening scene read the browser's storage directly, which broke start-up where a browser blocks it) and the frame test (it looked for a phrase from the old layout). The run before it: 1762 tests (Linux, 20 November 2026, version 0.20.25 plus the SHELL frame), one serial run, 1379.0 seconds (22 minutes 59 seconds), no failures. The run before it, on slightly earlier code, ran the same 1762 tests with two failures, both in tests written for the frame (one expected a label that the accessibility fix had removed, one read the strip's printers by that label); both were corrected. The run before that: 1729 tests (Linux, 20 November 2026, version 0.20.24 plus the fixes for three tests that failed now and then on GitHub), one serial run, 1290.8 seconds (21 minutes 31 seconds); its one failure was the check that the quoted count is right (it still said 1727), which passed once the number was updated. The run before that: 1727 tests (Linux, 20 November 2026, version 0.20.22 plus the tester fix and its replay test), one serial run, 1308.9 seconds (21 minutes 49 seconds); the run had one error, in the test of the failed-slice report, which read Tester mode's event a few milliseconds before the slicing thread wrote it (the job reads "failed" slightly earlier); the test now waits for the event, and the slicer bridge, slice diagnosis and count-check tests (104) passed when run again on their own (39.7 seconds), the count check among them. The run before that: 1726 tests (Linux, 19 November 2026, version 0.20.22 plus the tester fix), one serial run, 1305.4 seconds (21 minutes 46 seconds); the check that the quoted count is right failed on that run (it still said 1692) and passed once the number was updated. The run before that: 1692 tests (Linux, 18 November 2026, version 0.20.18 plus the page bar), run in four serial parts of 509, 407, 343 and 433 tests (1018 seconds in all); the check that the quoted count is right failed on the first pass (it still said 1681) and passed once the number was updated. The run before that: 1681 tests (Linux, 18 November 2026, version 0.20.17 plus the 3D twin following homing), one serial run, 1062.8 seconds; the same check failed on that run (it still said 1674) and passed once the number was updated. The run before that: 1674 tests (Linux, 18 November 2026, version 0.20.15 plus the first-run
  fixes and the always-on Tester mode with its test round and questions, together), run in two waves of parallel
  groups: four groups of tests that need no browser (1601 tests, 270 seconds from start to finish), then four groups
  of browser-driven tests (73 tests, 134 seconds). Together that is 960.2 seconds of test time. The browser walk
  failed once in the second wave, when a 45-second wait ran out while three other browser groups shared the four
  processor cores, and passed when run again on its own (82.1 seconds); the total counts that passing run. The run
  before it, on the Tester mode branch alone: 1665 tests (17 November 2026), in three parts of the test files: 275.4,
  420.6 and 382.7 seconds of test time (1078.7 seconds in all). The run before that, on the first-run fixes branch
  alone: 1621 tests (17 November 2026), five parallel groups: 1278.8 seconds of test time in all, 516 seconds from
  start to finish; the check that the count quoted here is right failed on that run (it still said 1612) and passed
  once the number was updated. The run before that: 1612 tests (17 November 2026, version 0.20.15 plus Tester mode and
  its checks), one serial run: 1369.6 seconds (22 minutes 50 seconds). The run before that: 1557
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
- **Translations** (22 November 2026, Chromium on Linux, demo data, the pseudo language and a two-text German stand-in served in place of a file; before any real language existed). `tests/test_i18n.py` (38 tests, also on Python 3.8) covers the scanner (what counts as a word on screen, sentences with pieces, HTML text and attributes, icons stuck to labels, the server's sentences), the catalogue files, the checks on a translation and the commands in a temporary folder. `tests/test_i18n_browser.py` runs `node tools/i18n-check.js`: 25 loader scenarios (English fetches nothing, text added later and changed in place, pieces moved by a pattern, code and `translate="no"` left alone, attributes and dialogs, a missing language file, the picker and the saved choice), then all 19 screens and every part of them in English and in pseudo with no script error and the same cards, headings, help buttons and part buttons (with the old English-only lookup put back, 17 screens differed). `node tools/text-audit.js --lang pseudo` ran on 270 screens (1366, 1024 and 390 px, light and dark, very long names): one run reported 10 findings on the 3D printer sheet at 1024 px while four other browser runs used the computer, and the same screens alone found nothing. 67 percent of the visible words on those screens were reached by the catalogue. The online demo on a static host loaded in English and pseudo with no script error. Not tested: a real translation, a native speaker's reading, a phone, searching the command bar in another language, a real printer.
- **Spanish** (23 November 2026, Chromium on Linux, demo data). Written by an AI in one session; no native speaker has read it. `tests/test_i18n.py` is 43 tests now, five of them new: every English text has a Spanish one and none is left over, the picker offers it by its own name, the six screen names read the same everywhere, no answer repeats or drops a piece of a sentence, and no server sentence is glued together from bare English words (`TestSentencesStayWhole`). `python3 tools/i18n.py check`: 6,278 good, 0 refused, 0 stale. `node tools/i18n-check.js` with Spanish installed: 19 screens and every part, 0 script errors, 0 screens built differently; of 2,426 distinct visible texts, 424 are not in the list (300 are release notes). `node tools/text-audit.js --lang es --widths 1366,390`: 90 screens, 0 findings after one fix. `node tools/setup-walk.js`: 30 checks, 11 of them on the new Language step. Found by this work and fixed: choosing a language did not reload the page (every address ends in `#/place`), and sixteen sentences were built from a bare English word. Not tested: a native speaker's reading, a phone, the command bar's search in Spanish, a real printer with the app in Spanish.
- **The browser walk** (`node tools/browser-walk.js --axe`, 16 November 2026, Chromium on Linux): all 17
  places at 1366 px and 390 px, in light and dark, with demo data and with none (136 visits), plus 17
  workflow runs: importing a file, Confirm Print on every sample G-code file, a slow answer for an earlier
  file, the queue, opening a model, the slicer set-up card, phone pairing, the colour sensor on a stand-in
  printer, and script payloads planted in file names, printer names, spools and notes. No script error, server
  error, sideways scrolling or stray `undefined` text, and no payload ran. It took 5 minutes 20 seconds. Each
  check was shown to fail on a planted fault first. [Check Deja Vu1 yourself](for-reviewers.md).
- **The frame and the Printer room** (21 November 2026, Chromium on Linux, demo data, software graphics). `node tools/pagebar-walk.js` makes 93 checks: nothing across the top or the bottom of the page, the eight places and their parts, Practice printers left out of the toolbar until Settings switches them on (and a link to them opening All printers while they are off), 14 old links landing on the new home, the sidebar resting as icons in three places and opening over the page without moving it, still open while the pointer is just beside it or comes back within the grace period, closed about a second after the pointer goes far away, closed at once by a press outside and opened by a flick to the window edge, the floating dock with the orb and no printers or Find in it, a printer picked from the sidebar, Halt on the Printer screen and on none of seven other places (one press, the two-press setting, H H and Restart firmware, each said in words), the command bar with its shortcuts, the 3D scene filling the window behind everything with no rails or dividers, the print card top left, the camera top right and the tool palette down the left, the heads, the bed and the chamber carrying their temperature on the machine, the camera window taking the picture's own shape and showing all of it, Overview showing no 3D printer, a Move sheet that brings the 3D printer and the camera beside the pad and hands them back on Escape, cards over the room that do not scroll, Settings' groups and search, Maintenance's rows and its filter band, Files' drop zone, no explainer lines for "I know my way around", eight places at 390 px with no sideways scrolling and Halt only on the Printer screen, and the Workbench, Control room and Glass looks (`tests/test_pagebar.py` runs it where Chromium is installed). The same build passed the first-run walk (`node tools/tester-walk.js`, 40 checks), the set-up walk (`node tools/setup-walk.js`, 19 checks) and the page-bug checks (`node tools/testfix-check.js`, 62 checks, including no freeze over 200 ms in ten idle seconds on the Printer screen).
- **Text that does not fit** (21 November 2026, Chromium on Linux, demo data with every printer, file and task name made about 70 characters longer, software graphics). `node tools/text-audit.js --widths 1366,1024,768,600,390 --dark --focus` opens every screen, sheet and Settings group in light and dark, 450 screens in all, and reports text that is cut with no way to read it, outside its panel, a control that a box cuts away or pushes out of the window, over other text, broken down to one character a line, touching the edge of its panel, wrapped where a label must not wrap, under 11 px, on a control under 24 px or without a name, panels that touch, overlap or are not 14 px apart, and any Tab stop with no visible focus. Its first run, at 1366 and 390 px, found 1033 problems. A later round of checks (hidden controls, stacked text, text flush with its panel, panel gaps), each shown to fail on a planted fault first, found stacked cards with no gap on five screens, printer cards without padding, a button pushed out of a Settings card and a time label broken to one character a line, all fixed; the last run, 450 screens in light and dark, found none, and the keyboard pass at 1366 and 390 px (90 screens) found none. The audit is part of `tests/test_text_system.py` at 1366 and 390 px. Not tested: very long names in a language other than English, and right-to-left text.
- **Accessibility after the Printer room** (axe-core 4.14.1, WCAG 2.0 to 2.2 A and AA plus best practices, `node tools/browser-walk.js --axe`, 21 November 2026): 21 places, 168 visits and 17 workflow runs, no problems, and again with the same result after the spacing and padding fixes. An automated check covers part of WCAG; it does not replace a screen-reader test.
- **The opening scene** (21 November 2026, software graphics, `?intro=force` because this browser skips it by design): at 1366 and 390 px it holds the close-up, pulls back, hands the 3D printer back to the Printer screen and leaves no class or layer behind, with no script error. Not tested: how it looks and feels on a real graphics card.
- **Tester mode** (19 November 2026, Chromium on Linux, against a stand-in printer, not a real U1). The tests
  cover the always-on build (no switch on screen, the server refuses to switch it off, `DEJAVU_TESTER=0` keeps a run out of the
  record and every `/api/tester` route answers 403), the 22 questions (nine sections, every one skippable, a one-press "Didn't try
  it" on the two phone and AI questions, answers saved as typed, answers from the earlier 52-question build moved aside, and the
  wording compared with the list sent to testers where that file sits next to the repository), the masking of addresses, keys,
  folders with a user name and the names of files, printers and spools through every way in (answers included), a synthetic week
  of 26 MB thinned to a zip under 25 MB with the totals unchanged, the five files of the saved zip, how presses were made, the
  paths between screens, the first run, errors named by kind and tied to a part of the app, and the "Fix first" list: requests
  that waited at the same moment as one item with what the server was doing, requests that failed because the page lost the
  server as one item, the app's own faults apart from conditions around it, a failed slice's whole engine output, no more than
  ten items, and nothing private in any file. Watch-only mode with Tester mode on, and `tools/tester-reports.py` combining
  reports of schemas 1 to 3, are covered too. `node tools/tester-walk.js` (40 checks) starts one server with `DEJAVU_TESTER=0`
  (the browser sends nothing) and then the shipped build: the first-run setup with no tester pop-up, the note button in the floating dock in the corner and away from the middle of the page, every place, a double and a
  right press, a list choice, shortcuts, the quick tour, a print on the stand-in printer, a request held back 2.6 seconds, a
  button that freezes the page for 1.4 seconds, an error, a failed promise, an error toast, a tagged note written right after the
  error, the 22 questions opened from Settings with 7 answered, and the zip saved from Settings. A phone-sized touch browser taps
  something and the record says touch. It opens the zip's `report.html` with no network at 1366 px and 390 px in light and dark.
  axe-core 4.10.2 (WCAG 2.2 AA and best-practice rules) finds nothing on the Settings card, the questions (the first section and
  the Phone and AI quick answers) or the note panel, at 1366 px and 390 px in light and dark (20 November). An automated scan covers part
  of WCAG and does not replace a screen-reader test. Not repeated for this build: the measurement of what recording costs on the
  Printer page (17 November, earlier build: press to next paint -1.1 %, main-thread time +3.7 %, mean frame time +9 % from a few
  slow frames, median equal at 16.7 ms). Not tested: Tester mode on a real U1, on Windows or macOS, or in a browser other than
  Chromium.
- **Page and server fixes from a tester's report** (19 November 2026, Chromium on Linux with software graphics, against the
  stand-in printer in `tests/fake_moonraker.py`, not a real U1). `node tools/testfix-check.js` runs nine scenarios and 62 checks;
  `tests/test_testfix_browser.py` runs it. The first eight were run on the code from before the fixes and failed there, and
  pass now: the print-health gauge replaced while it animates (no script error), the time-lapse list staying on screen while the
  switch is flipped and while the printer is slow, "Keep a copy here" as a background copy with progress, the AI shortcut keeping
  its width on hover, a failed camera address falling back to the printer's own camera by itself with a note and no recorded
  error, a lost server shown as nothing at first and as one line once it lasts more than ten seconds, six copies started at once with the next request
  still answered in 3 ms, and an idle printer with the 3D twin on screen (10 freezes over 200 ms, 4,044 ms in all, in ten idle
  seconds before; none after). The ninth measures the report: its headline and ten closed "Fix first" rows end at 786 px of an
  800 px screen on the sample and at 772 px on a real report, in light and dark, with nothing running off the side at 390 px
  (the earlier layout measured 1,106 px). `tests/test_long_jobs.py` covers the server side with throttled stand-in videos: a copy
  is a background job, a video plays as it arrives and answers Range. `tests/test_slice_diagnosis.py` and
  `tests/test_slicer_bridge.py` cover Orca's exit codes: 4294967196 (Windows) and 156 (macOS, the low byte) read as -100, a
  negative code is a signal and is never converted. Not tested: a real slice on Windows (the cause of the tester's -100 is not
  known; the whole engine output is now kept so the next report shows it), the camera fallback on a real U1's built-in camera,
  and page freezes on a computer with a graphics card (software drawing is slower, so read those figures as the stand-in's).
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

Deja Vu1 runs Snapmaker Orca as a separate program: the Slicer's Engine button downloads Snapmaker's own release, or you choose one you installed. Builds run for real:

| Engine | Version | System |
|---|---|---|
| Snapmaker_Orca | 02.08.01.55 | Linux |
| Snapmaker_Orca | 01.10.01.50 (v2.4.1, the release the Slicer installs) | Linux, Windows |
| OrcaSlicer | 2.4.2 | Linux |

Any other build shows "Not tested" when the Slicer checks it and still slices. Snapmaker_Orca
sliced different heights per head (0.4/0.6 mm nozzles at 0.14/0.28 mm, 0.4/0.8 mm at 0.2/0.4 mm,
two 0.4 mm at 0.1/0.2 mm). OrcaSlicer 2.4.2 sliced multi-object plates, four-tool image tiles,
layered swatches and heightmap reliefs. All three plates of the converted MakerWorld fixture
sliced, each on its own. Details:
[engine support](engine-support.md) and [slicer workspace validation](slicer-workspace-validation.md).

The Slicer (22 November 2026) was checked with a stand-in engine (`tools/stand-in-engine.py`): 54 browser checks in Chromium at 1366 and 390 px, light and dark (`tools/slicer-check.js`), and the engine install against a local stand-in release server (`tests/test_engine_installer.py`). Snapmaker Orca v2.4.1, the release the Engine button downloads, was then run for real on Linux and on Windows (below). Its macOS copy has not been run.

The real Snapmaker Orca engine (v2.4.1 Linux AppImage, build 01.10.01.50, checksum equal to the pin) was run for the first time on 22 November 2026, on Ubuntu 24.04. `python3 tools/engine-selftest.py` passes 9 of 9 steps, and the Slicer's own screen, driven in Chromium against that engine, sliced the 3DBenchy and the Preview drew its G-code (242 layers, line types, 32 min, 12.1 g). That run found that a plate project stored every triangle with its own three corners, which the engine could not slice ("empty layer", exit code -100) for every model except one with whole-number corners; this is fixed and `tests/test_plate_project.py` guards it. The Slicer's camera and keys were measured in Chromium (`tools/slicer-check.js`, now 88 checks): the turn rate, where the view turns, the pan, the wheel step, the six flat views, the arrow steps, copy and paste, the box selection and the key list. The filament picker was driven the same way: a spool, a material, one of the engine's filaments and a colour were chosen, and the G-code the real engine wrote carries that filament's name and colour. **Windows, 22 November 2026, beside the real U1:** the Install engine button installed the Windows zip (4 minutes 3 seconds), and the engine sliced the 3DBenchy (12.7 s), a 20 mm cube and the two-cube plate that then printed to the end. `python3 tools/engine-selftest.py` passed 7 of 9 steps there: the engine's own arrange and orient crash (exit code 3221225477), which the app does not use. **Not run:** the macOS install, the engine on a real graphics card, a trackpad, or a real phone.

## In progress

- **The colour checker** ("Right colour loaded?"). The comparison logic, a simulation and the
  companion API, the white-reference calibration and the Confirm Print advice are tested with synthetic sensor
  messages and a stand-in printer (`tests/test_sensor_calibration.py` and the sensor workflow in
  `tools/browser-walk.js`). The firmware, sensor drivers and a bench test of a physical sensor come next.
  [Design](hardware-modules.md)
- **LED dock rings.** The on-screen states exist; the ring driver doesn't. A WLED strip you already
  own can show the same states today.
- **Spool scales.** Planned after the colour checker.
- **Error codes on a real U1.** The reading follows the firmware's published source and is tested with a
  stand-in. On 22 November 2026 the real U1 paused a print by itself for a dirty bed and went into
  shutdown twice after Halt; the Logbook recorded all three and the error guide explained the Halt
  code as not in Snapmaker's table. That run did not record what the dirty-bed pause looked like on
  the Printer screen or whether its guide opened. [Error codes](error-codes.md)

## Tested with stand-ins

Each of these runs against a stand-in that answers the way the real program, service or device
does. The test files named below passed on 13 November 2026 (Linux, Python 3.13.18); the AR
preview and heavy-model checks ran in Chromium.

- **Error codes:** a stand-in printer raises problems the way the U1's firmware does (a pause with a code, a stop
  with a code, a standing problem and its clearing, a resume, and a printer without the fields). The printer's
  state, the logbook entry, the notification, the automation rule, the tester report and the assistant follow
  (`tests/test_error_codes.py`, `tests/test_printer_problem_feed.py`, `tests/test_error_guides.py`,
  `tests/test_error_assistant.py`, and the window in Chromium by `tools/errorhelp-check.js` through `tests/test_error_help_browser.py`). The wiki and YouTube are canned there, and the 413-code table is checked for
  consistency. The window, a guide with 10 pictures, the video button and the Care card were checked in Chromium
  at 1366 and 390 px, light and dark, on 21 November 2026. A video's player loaded with its title; playback itself
  did not start in the sandbox's network, so it is unconfirmed. A real U1 raised a code on 22 November 2026 (see "On a real Snapmaker U1").
- **Deja Vu1 remembers (the print record):** files recognised by fingerprint (a renamed copy, a model and the G-code
  sliced from it), the history line, Print it like the time it worked with the heads that changed, the facts from your
  own prints, the layer a print ended on, the AI watch's notes and its first-layer check, run against the stand-in
  printer and the record (`tests/test_recall.py`, 19 tests). Files, Confirm Print and Printer › Prints with the demo
  data were checked in Chromium at 1366 px light and 390 px dark on 25 November 2026. No real U1 has run it.
- **A second printer and other Klipper printers:** the fleet tests send one action to several
  stand-in printers at once and report each printer's own result (`tests/test_fleet_command.py`).
  A one-head 235 × 235 × 250 mm Klipper printer connects and describes its own size and heads
  (`tests/test_machines.py`).
- **macOS:** the start-at-sign-in file that versions before 24 November 2026 wrote is checked as a valid
  macOS launch file, and Deja Vu1 now takes it away (`tests/test_autostart.py`, `tests/test_idle_stop.py`), and the engine check names macOS for an engine there
  (`tests/test_engine_support.py`). The AI key store runs its macOS Keychain path against a
  stand-in `security` program.
- **Windows:** the server answers every command when started with no window, the way Windows
  starts it in the background (`tests/test_no_window.py`). the engine check reads a Windows build's
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
