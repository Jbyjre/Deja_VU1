# Contributing

Thanks for looking. Bug reports from real U1s are the most valuable thing
anyone can send - see [docs/beta-testing.md](docs/beta-testing.md).

## Running it

```bash
python3 backend/app.py                 # http://localhost:8000
python3 -m unittest discover tests     # the whole suite, about two and a half minutes
```

Python 3.8 or newer, nothing else. Flip **Demo data** in the header to try
everything without a printer.

## House rules

These are what the project is built on; a change that breaks one needs a
very good reason.

- **No dependencies.** Standard-library Python, plain HTML, CSS and
  JavaScript. No build step, no CDN, no webfonts - it must work offline.
- **No invented numbers.** With no printer and no demo data, panels show
  empty states, never zeros or placeholders. Demo data is always labelled.
- **Honest controls.** A button says what it sent, then shows only what the
  printer reports back. A refusal is shown as a refusal, in words.
- **Facts from source.** Anything about Moonraker, Klipper, Snapmaker's
  firmware, Orca or another service is read from its source or docs, with
  the commit noted, and tested against a stand-in built from that source.
  If something couldn't be checked, the docs say so.
- **Ideas, not code, from GPL projects.** This project is MIT. Borrowing an
  idea from a GPL or non-commercial project is fine - credit it - but write
  the code fresh.
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
4. Add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.
