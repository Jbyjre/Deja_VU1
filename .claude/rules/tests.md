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
- Some tests read source files as text (`test_frontend_refresh.py` reads `games.js`,
  `test_plate_keyboard.py` reads `plate.js`, `test_install_blocks.py` reads the README). Write such
  tests so spacing doesn't matter.
- Tests that finish prints must reset the print queue (bed clearance). Tests that start the launcher
  set `DEJAVU_NO_REGISTER=1`.
- Don't `pkill -f 'backend/app.py'` from a shell whose own command line contains that text: it
  kills the shell. Kill by PID; stop and restart a server in two separate commands.
- GitHub Actions runs the suite on Python 3.8, 3.10, 3.12 and 3.13 (Ubuntu 24.04). Write no
  parenthesised `with (a, b):`; `ruff check --select E701,E702 backend tests tools` must stay clean.
