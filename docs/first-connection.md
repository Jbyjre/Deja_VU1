# Try Deja Vu1 on your own U1

Deja Vu1 has been tested on a real Snapmaker U1 with stock firmware: adding the printer, live
readings and the 3D twin, starting prints through Confirm Print, pausing and cancelling, the camera
and time-lapses, and the Printer page controls ([what was tested](testing.md)). Snapmaker sponsored
that printer through the Innovation Fund.

One printer can't show everything. A session on your U1, on another network and with other
filaments, finds what ours can't. This page is how to run one.

## What it involves

- **About 30 to 45 minutes** on your own, then you send what you saw.
- **Watch-only.** Watch a print you're already running, with Deja Vu1 in
  **watch-only mode**: its server then refuses every command to the printer
  (pause, resume, cancel, temperatures, home, G-code, start, uploads), so
  nothing moves or heats even if a button is pressed. Emergency stop still
  works. Step 2 starts it that way.
- **Nothing installed on the printer.** Deja Vu1 runs on a computer on the
  same network and talks to Moonraker, the web API built into the U1.

On a fresh install Deja Vu1 has no automation rules and an empty print queue,
so it only asks the printer for information (live state, print history and
the like) until someone presses a control.

Deja Vu1 has no login: anyone who can reach port 8000 on that computer can use
its controls. Keep it on your home network for the session (see
[security](../SECURITY.md)).

## Before you start

- A computer on the same network as the U1 (Windows, macOS or Linux) with Python 3.8 or newer.
- The printer's address: the same one Fluidd or Mainsail uses, usually
  `http://<printer-ip>:7125`.
- Which firmware the U1 runs (stock or the community Extended Firmware), and
  its version if you know it.

## Steps

1. Get the code: `git clone https://github.com/Jbyjre/Deja_VU1.git`, then
   `cd Deja_VU1`. Or use GitHub's **Code → Download ZIP**, unzip it, and open a
   terminal in the unzipped folder (GitHub names it `Deja_VU1-main`).
2. Start it with every exchange recorded, saved to a file:
   - macOS or Linux: `DEJAVU_WATCH_ONLY=1 DEJAVU_MOONRAKER_LOG=1 python3 backend/app.py 2> dejavu-log.txt`
   - Windows PowerShell: `$env:DEJAVU_WATCH_ONLY = "1"; $env:DEJAVU_MOONRAKER_LOG = "1"; python backend\app.py 2> dejavu-log.txt`

   `DEJAVU_WATCH_ONLY=1` keeps watch-only mode on until Deja Vu1 is started
   without it, whatever the Settings switch says. A **Watch-only** label shows
   in the top bar while it is on.

   While a print runs, Klipper reports several times a second, so the detailed
   log is long. The `2> dejavu-log.txt` part puts it in a file in that folder
   instead of the terminal; the terminal still shows the address to open. If
   the dashboard doesn't start, the reason is in that file.
3. Open **http://localhost:8000** in a browser on that computer. It will say
   no printer is connected.
4. **Printers → Add a printer.** Give it a name, paste the address, and add an API
   key only if your Moonraker asks for one. The printer's IP address alone
   (`192.168.1.50`) is enough. An address copied from the browser bar while the
   printer's web page is open (`http://192.168.1.50/#/`) works too: **Test** and
   **Add printer** tidy it and, when nothing on port 80 is Moonraker, use port 7125.
5. Within a few seconds the row shows **Connected**, or says in words why it
   isn't. [real-printer.md](real-printer.md#what-happens-if-something-is-wrong)
   explains each message.
6. Watch your print for a few minutes. Compare the dock states, temperatures,
   progress and finish time with the printer's own screen.
7. Optional, and only if you're happy for the printer to move: stop Deja Vu1,
   start it again without `DEJAVU_WATCH_ONLY=1` (and check Settings → Watch-only
   mode is off), then, while nothing is printing, press **Printer → Home all**
   and watch the 3D twin. Its head should travel with the printer's head, at about the
   same pace (it trails by about a third of a second), and stop where the
   printer stops. Until the printer has homed, the twin card says "not homed,
   position unknown".
8. Open **Details** on the printer's row. It shows whether the link is open,
   Klipper's state, which toolheads and chamber sensor were found, how much
   print history was read, and the newest 14 exchanges with Moonraker.
9. Save the full record, once right after connecting and again at the end:
   open **http://localhost:8000/api/fleet/registry**, find your printer's `id`
   (it looks like `printer-1a2b3c`), then open
   `http://localhost:8000/api/printers/diagnostics?printer=` followed by that
   id, and save the page (File → Save Page As). It holds the last 300
   exchanges; with detailed logging on, live updates fill those quickly, which
   is why the first save matters.

## What to send back

- What looked right and what looked wrong, compared with the printer's screen.
- The saved diagnostics pages from step 8 and `dejavu-log.txt` from step 2.
- **Read them before you share them.** They include the printer's address on
  your network and can include the names of your print files. They never
  contain your API key (only whether one is set). Remove anything you'd rather
  keep private.

## Sign up

[Open a "First connection" issue](https://github.com/Jbyjre/Deja_VU1/issues/new?title=First+connection%3A+I+have+a+U1&body=%2A%2AFirmware+on+my+U1%3A%2A%2A+stock+%2F+Extended+Firmware+%28version%2C+if+known%3A+%29%0A%2A%2AComputer+that+will+run+Deja+Vu1%3A%2A%2A+macOS+%2F+Linux+%2F+Windows%0A%2A%2AThank+me+by+name+in+the+release+notes%3F%2A%2A+yes%2C+as%3A+%2F+no%0A)
on GitHub. The questions are filled in already; you need a free GitHub account. Keep personal
details out of the issue; send logs only after reading them (see above).

Whatever breaks gets fixed in the open, and [testing.md](testing.md) is updated to say exactly what
was tested, and on which firmware.
