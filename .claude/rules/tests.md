---
paths:
  - "tests/**"
---

# Test notes

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
  `test_plate_keyboard.py` reads `plate.js`, `test_install_blocks.py` reads the README). Write such
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
  26 MB week, the zip, the demo sample, the guide's names), `tests/test_tester_study.py` (the always-on build, the 52 questions, the
  round, answers, the study routes), `tests/test_tester_insights.py` (the wider record, how people pressed, paths, the first run,
  error kinds, the ranked findings, nothing private in any file), `tests/test_tester_reports_tool.py` (`tools/tester-reports.py`,
  schema 1 and 2), `tests/test_tester_printer.py` and `tests/test_tester_browser.py`, which runs `node tools/tester-walk.js` (a run kept
  off with `DEJAVU_TESTER=0`, then the shipped build: setup, welcome, a print, mistakes on purpose, a tagged note, the questions, the
  download) and reads the zip. `node tools/tester-walk.js --overhead --same-server` measures what recording costs on the Printer page.
- GitHub Actions runs the suite on Python 3.8, 3.10, 3.12 and 3.13 (Ubuntu 24.04). Write no
  parenthesised `with (a, b):`; `ruff check --select E701,E702 backend tests tools` must stay clean.
