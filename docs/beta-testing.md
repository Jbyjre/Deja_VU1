# Trying Deja Vu1 on your own U1

Everything in this dashboard has been built and tested against the source
code of Moonraker, Klipper and Snapmaker's U1 firmware - but not yet against
a real U1. If you have one, an hour of your time closes that gap. This page
says what to do, what to look at, and what to send back.

## Before you start

- **It reads more than it writes.** Watching, the fleet view, files, the
  converter and the Photo Studio change nothing on the printer. Pause,
  resume, cancel, temperatures, homing, skip-object and start-print do -
  each one says what it sent and shows only what the printer reports back.
- **Start-print has a safety check.** It refuses a file that extrudes off the
  bed, wants a toolhead the U1 doesn't have, or doesn't match the filament
  the printer reports. Still: for a first test, print something small you
  don't mind losing, and stay near the machine.
- **Nothing is installed on the printer.** The dashboard runs on your
  computer and talks to the printer's Moonraker over your network, the same
  way Fluidd or Mainsail does. No firmware is changed.

## Setting up

You need Python 3.8 or newer on a computer on the same network as the U1.

```bash
git clone https://github.com/jbyjre/deja_vu1.git
cd deja_vu1
DEJAVU_MOONRAKER_LOG=1 python3 backend/app.py
```

Open **http://localhost:8000**, then **Fleet → Add a printer** with the U1's
address (usually `http://<printer-ip>:7125`). `DEJAVU_MOONRAKER_LOG=1` makes
the terminal print every exchange with the printer - that log is the most
useful thing you can send back.

## What to check, in order

Tick what you saw; anything that differs is exactly what's worth reporting.

1. **It connects.** The printer's row in Fleet says *Connected* within a few
   seconds. If not, the row says why, in words - copy that.
2. **The four toolheads.** The Overview and Control tabs show T0-T3 with
   temperatures that match the touchscreen.
3. **Filament.** The colour and material shown for each head match what's
   loaded. Change one on the touchscreen and check it updates here within
   about 30 seconds.
4. **Chamber.** The chamber panel shows a temperature, or says the printer
   doesn't report one. Either is fine - which one is useful to know.
5. **A small print.** Upload a small sliced file in **Files**, open it, press
   **Print…**, read the summary, start it. Check progress, layer numbers and
   the time left track the touchscreen.
6. **Pause and resume** once during that print. Both should say "confirmed by
   the printer".
7. **Skip one object.** Slice two or three small objects on one plate in
   Snapmaker Orca (its U1 profile labels objects already). During the print
   the Control tab should show them on a map of the bed; skip one and check
   the printer stops printing just that one.
8. **When it finishes,** the dashboard notices on its own and the print shows
   in history with the right grams.
9. **The converter.** Convert a multi-plate MakerWorld project in **Files**
   and open the result in Snapmaker Orca. Are the objects on the right
   plates? Do the profiles load without warnings? Does it slice?
10. **The Photo Studio.** Save a 3MF, open it in Snapmaker Orca: do the colour
    changes land on the layers the studio's plan says?

## Sending it back

Open an issue on GitHub with:

- what you checked, and what you saw instead of what this page says;
- the printer's **Details** panel (Fleet → the printer's row → Details) -
  it holds the last few hundred exchanges with Moonraker;
- the terminal output from `DEJAVU_MOONRAKER_LOG=1`;
- for the converter, the **Copy report** text.

Leave out anything private: the Details panel masks API keys, but check
before you paste.

[docs/real-printer.md](real-printer.md) lists everything that couldn't be
checked without a printer, and why.
