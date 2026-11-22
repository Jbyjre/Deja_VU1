---
paths:
  - "tests/**"
---

# Test notes

- Error codes: `tests/test_error_codes.py` (the table, the reader, `wiki_page`, `printer_problems`, `translate_state`, a stand-in printer over the wire),
  `tests/test_printer_problem_feed.py` (live feed, logbook, rules, Tester mode), `tests/test_error_guides.py` (the fetcher with a canned wiki, the routes, the tester
  report) and `tests/test_error_assistant.py`. No test asks the internet.
- The Slicer: `tests/test_engine_installer.py` (a stand-in release server and engine from `tools/stand-in-engine.py --make-engine`: download, checksum, unpack, check, update, cancel, bad archive), `tests/test_slicer_working.py`, `tests/test_slicer_model.py` (runs `tests/slicer_model_check.js` in Node) `tests/test_slicer_gcode.py` (the Preview's G-code reader in Node: `tests/slicer_gcode_check.js`) and `tests/test_slicer_browser.py` (runs `node tools/slicer-check.js`: 86 browser checks with a stand-in engine, 22 of them on the camera and keys, 6 on the filament picker and 4 on saved settings; skipped without Node, Playwright and Chromium). No test runs the real engine; `python3 tools/engine-selftest.py` does (9 of 9 on 22 November 2026, Linux), and so can a person on their own computer.
- Standard-library `unittest`. API tests start the real server on a spare port. Tests use
  simulated printers, temporary folders and `tests/fake_moonraker.py` (a Moonraker stand-in built
  from Moonraker's source); none contacts a physical printer.
- The tests run in a temporary data folder (`storage.DATA_DIR`, set when the runner imports
  `storage`), never the real `backend/data/`. `test_tests_never_touch_the_real_data_folder` checks
  every module.
- Run the module you changed while working (`python3 -m unittest tests.test_api`), the full suite
  once before pushing (`python3 -m unittest discover tests`, about 15 minutes). Don't run an app or
  demo server while the full suite runs; one run failed an automation test that passed on its own.
- Count the tests with
  `python3 -c "import unittest; print(unittest.defaultTestLoader.discover('tests').countTestCases())"`.
  Quote a count and date only from a run you made, and change every copy together (README,
  `tools/readme-images/boards.html`, `docs/slicer-workspace-validation.md`, `docs/testing.md`).
- Some tests read source files as text (`test_frontend_refresh.py` reads the arcade, through
  `tests/frontend_parts.py`, which joins a split file's parts so a test finds code in whichever part holds it;
  `test_install_blocks.py` reads the README). Write such
  tests so spacing doesn't matter.
- `test_ai_assistant.py` holds the shared helpers (`Base`, `act`, the fake servers) and the first half of the AI tests;
  `test_ai_assistant_more.py` the rest, importing those helpers.
- The twin tests (`test_twin_fx`, `test_twin_sync`, `test_twin_homing`) run `twin3d-part1.js` and `twin3d.js` together in
  Node, in that order, as the page does.
- Tests that finish prints must reset the print queue (bed clearance). Tests that start the launcher
  set `DEJAVU_NO_REGISTER=1`.
- Don't `pkill -f 'backend/app.py'` from a shell whose own command line contains that text: it
  kills the shell. Kill by PID; stop and restart a server in two separate commands.
- Tester mode: `tests/test_tester.py` (the optional-switch build: it sets `modules.TESTER_ALWAYS_ON = False`; masking, thinning of a
  26 MB week, the zip, the demo sample, the guide's names), `tests/test_tester_study.py` (the always-on build, the 22 questions, answers,
  the study routes, the move from the 52-question file), `tests/test_tester_insights.py` (the wider record, how people pressed, paths,
  the first run, error kinds, the findings, `TestFixFirst`: stalls, the lost server, the ten, the whole engine output, nothing private
  in any file), `tests/test_tester_reports_tool.py` (`tools/tester-reports.py`, schemas 1 to 3, the combined fix-first list),
  `tests/test_tester_printer.py` and `tests/test_tester_browser.py`, which runs `node tools/tester-walk.js` (a run kept off with
  `DEJAVU_TESTER=0`, then the shipped build: setup with no pop-up, a print, mistakes on purpose, a tagged note, the questions opened from
  Settings, the download) and reads the zip. `node tools/tester-walk.js --overhead --same-server` measures what recording costs on the
  Printer page.
- Page bugs from a tester's report: `tests/test_testfix_browser.py` runs `node tools/testfix-check.js` (gauge, time-lapse list, Keep a
  copy, the AI shortcut's width, the camera fallback, a lost server, six copies at once, an idle printer's freezes; each fails on the
  code before the fix). `tests/test_long_jobs.py` covers the server side (a copy is a job, a video streams and answers Range) with
  `tests/fake_moonraker.py`'s throttled videos; `tests/fake_moonraker_serve.py` runs that stand-in as its own process for the browser
  checks. These browser checks block the service worker and mark setup as seen, and the Chromium here draws WebGL in software.
- Text and glass: `tests/test_text_system.py` checks glass.css, text.css and text.js as source (the two grades, the accessibility fallbacks, the room's framing values, the
  file-name splitter run in Node) and runs `node tools/text-audit.js --widths 1366,390` in Chromium: every screen with very long names, nothing may be clipped, outside its
  box, hidden by a box or pushed out of the window, stacked one character a line, flush against its panel's edge, touching or overlapping another panel, colliding, wrapping a compact control, unreadable when cut or under 11 px, and every control needs 24 px and a name. `--focus` adds a Tab walk (every stop must show a
  focus ring and not be hidden); run it by hand after changing a screen. A finding is fixed in text.css or the screen's own CSS, never by loosening the audit.
- GitHub Actions runs the suite on Python 3.8, 3.10, 3.12 and 3.13 (Ubuntu 24.04). Write no
  parenthesised `with (a, b):`; `ruff check --select E701,E702 backend tests tools` must stay clean.
