# Contributing

Thanks for looking. Reports from your own U1 help most: Deja Vu1 has been
tested on one real U1, and yours is on another network with other filaments
([docs/beta-testing.md](docs/beta-testing.md)).

## Running it

```bash
python3 backend/app.py                 # http://localhost:8000
python3 -m unittest discover tests     # the whole suite: about 11 to 15 minutes
```

Python 3.8 or newer, nothing else. Flip **Demo data** in the header to try
everything without a printer.

## House rules

These are what the project is built on; a change that breaks one needs a
very good reason.

- **No dependencies.** Standard-library Python, plain HTML, CSS and
  JavaScript. No build step and no CDN: the fonts are bundled in
  `frontend/fonts/`, so it works offline.
- **No invented numbers.** With no printer and no demo data, panels show
  empty states, never zeros or placeholders. Demo data is always labelled.
- **Honest controls.** A button says what it sent, then shows only what the
  printer reports back. A refusal is shown as a refusal, in words.
- **Facts from source.** Anything about Moonraker, Klipper, Snapmaker's
  firmware, Orca or another service is read from its source or docs, with
  the commit noted, and tested against a stand-in built from that source.
  If something couldn't be checked, the docs say so.
- **Ideas, not code, from GPL projects.** This project is MIT. Studying how
  a GPL or non-commercial project works is fine; write the code fresh and
  never paste theirs. [CREDITS.md](CREDITS.md) lists what Deja Vu1 talks to
  and ships.
- **Plain words.** Errors say what happened and what to do, in the
  dashboard's own voice.
- **Accessible.** Real buttons and form controls, visible focus, 24 px or
  bigger targets, reduced-motion, reduced-transparency and increased-
  contrast all respected.

## Making a change

1. Add or update a test in `tests/` for what you changed.
2. Run the suite; it should pass.
3. For anything on screen, try it at desktop width and at phone width
   (390 px), with demo data on and off.
4. Title the pull request with what a U1 owner can now do. Every merge to
   `main` publishes a release, and the title becomes its release note
   ([docs/releasing.md](docs/releasing.md)).
5. GitHub runs the whole suite on Python 3.8, 3.10, 3.12 and 3.13 for every
   pull request (`.github/workflows/tests.yml`).

## Good places to help

- Reports from your Snapmaker U1: what Moonraker sends, what the
  dashboard got right and wrong ([docs/first-connection.md](docs/first-connection.md)).
  Other firmware versions and the Extended Firmware are the most useful.
- Drivers for the LED dock rings and the colour sensor, once the hardware
  exists ([docs/hardware-modules.md](docs/hardware-modules.md)).
- Maintenance intervals backed by Snapmaker's documentation or measured
  wear.
- Accessibility fixes, clearer error messages, and tests for edge cases.
