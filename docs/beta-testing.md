# Testing Deja Vu1 on your own U1

Deja Vu1 has been tested on a real Snapmaker U1 with stock firmware
([what was tested](testing.md)). Your U1, your network and your filaments can
show problems that ours did not. This page is for people who agreed to test it.
You install Deja Vu1, switch on **Tester mode**, use the app as you normally
would for a few days, then save one file and attach it to a forum message.

Tester mode keeps a report of how the app behaved: every error, every button
that was slow to respond, how your prints went and which features you tried.
You can read the whole report before you send it.

## Before you start

- **Tester mode changes nothing about how the app works.** It only watches and
  writes a report. Every part of Deja Vu1 behaves the same with it on or off.
- **Nothing is installed on the printer.** Deja Vu1 runs on your computer and
  talks to the printer's Moonraker over your network, the way Fluidd or
  Mainsail does. No firmware changes.
- **Watch-only mode still works.** Switch on **Settings → Watch-only mode** (or
  start with `DEJAVU_WATCH_ONLY=1`) and Deja Vu1 refuses every command to the
  printer. Reads, the camera and the emergency stop still go through. Tester
  mode records the refusals like any other event.
- **Start Print has a safety check.** Confirm Print refuses a file that
  extrudes off the bed, wants a toolhead the U1 does not have, or does not
  match the filament the printer reports. For a first print, pick something
  small that you do not mind losing, and stay near the machine.

## Install it

You need a computer on the same network as the U1 with Python 3.8 or newer
(get it from [python.org](https://www.python.org/downloads/) if you do not have
it; on Windows, let the installer add Python to PATH).

1. Download **deja-vu1-update.zip** from the
   [newest release](https://github.com/Jbyjre/Deja_VU1/releases/latest).
2. Extract it to a folder in your Documents. Keep the folder: your settings and
   the tester record live inside it, in `backend/data/`.
3. Double-click **start-windows.bat**, **start-mac.command** or
   **start-linux.sh**. If your Mac or Linux computer opens the file as text,
   open Terminal in the folder and run `python3 start.py`.
4. Your browser opens the dashboard at `http://localhost:8000`.

[Getting started](getting-started.md) has the same steps with pictures of what
each screen asks, and paste-in commands if you prefer those.

Then go to **Printers**, press **Find printers**, pick your U1 and press
**Test and connect**. If nothing turns up, type its address, usually
`http://<printer address>:7125`.

## Switch on Tester mode

1. Open **Settings**, then the **Tester mode** part.
2. Turn on **Record a tester report**.

A **Something felt off** button now sits on every screen. Press it whenever
something looks wrong, feels slow or confuses you. Write a line or two. Deja
Vu1 saves your note with the screen you were on and your last ten actions.

You can also start Deja Vu1 with `DEJAVU_TESTER=1` to have it on from the first
second. Updates keep it on. Turning it off stops the recording at once, and
what was recorded stays until you press **Delete tester data**.

## What to try

Use Deja Vu1 the way you would anyway. If you want a list, work down this one
and skip anything that does not apply to your setup. A skipped item is fine: the
report shows which features nobody opened.

1. **Overview.** Does the printer show as connected within a few seconds?
   Do **Needs you**, the temperatures and the progress match the touchscreen?
2. **Printer.** Do the four heads (T0 to T3) show the right temperatures,
   colours and materials? Does the 3D twin follow the real print? Does the
   camera picture appear?
3. **Files.** Add a small sliced file, open it and press **Print**. Read the
   Confirm Print summary before you press Start.
4. **During the print.** Pause and resume once. Both should say "confirmed by
   the printer". Put two or three small objects on one plate, then skip one.
5. **When it finishes.** Deja Vu1 should notice by itself, and the print should
   show in history with the right grams.
6. **Slice** and **Files → converter.** Slice a model if you have Snapmaker Orca
   or OrcaSlicer. Convert a MakerWorld, Printables, Bambu Studio or
   PrusaSlicer project and open the result in Snapmaker Orca.
7. **Queue, Filament, Maintenance.** Queue a print. Add a spool, or import your
   spools from Spoolman. Look at the maintenance tasks and their due dates.
8. **Phone and away from home.** Open Deja Vu1 on your phone with the QR code
   in **Settings**. Try **Away from home** if you use Tailscale.
9. **AI.** If you use the assistant, ask it something. Try print watch or print
   doctor.
10. **Settings.** Switch a few things on and off. If Deja Vu1 offers an update,
    let it install.

## What Tester mode records

- Your setup: the Deja Vu1 version, your operating system and its version,
  Python, your browser, your screen size, the firmware and software versions
  your U1 reports about itself, how many printers you added, which features are
  on, whether watch-only mode is on, your look (Glass and so on), light or dark,
  your language and your slicing engine and its version.
- Each time you opened the app and for how long, and whether it was a desk or a
  phone screen.
- Every screen you opened, in order, and how long you stayed.
- Every button, link, tab or switch you pressed, named by its id or action word,
  with the time until the screen changed and, if it sent a request, until that
  request finished.
- Anything slow: a press that took over a second to show a change, a request
  over two seconds, and every time the browser froze for over 0.2 seconds.
- Every request to Deja Vu1's own server: the route without its query, the
  method, the answer and the time. Routine background reads that worked are
  summed up in five-minute groups. Every other request, and every request that
  failed or was slow, is recorded on its own.
- Every error: in the browser (with your last ten actions), on the server, and
  every error message the app showed.
- The printer: connects, drops and reconnects, every command that was refused
  with the words the app showed, how long Pause, Resume and Cancel took to be
  confirmed by the printer, and how each print started, finished, failed or was
  cancelled.
- Every Confirm Print check, the reasons it gave and whether you went on to
  print.
- Every slice (engine, version, how long, worked or not, and the report for
  help when it failed) and every conversion (where the project came from,
  plates, colours, warnings).
- How many frames per second the 3D twin and the G-code preview drew while they
  were on screen, and how large the model was.
- Which of the main features you tried.
- The notes you write with **Something felt off**. They are the only place your
  own typing is kept.
- Every update Deja Vu1 installed: from which version to which, and whether it
  worked.

## What it never records

- File names or model contents. A file shows as "file 3, .3mf, 2.4 MB".
- Camera pictures or time-lapse frames.
- IP addresses, host names or printer serial numbers.
- Wi-Fi names, API keys or AI sign-ins.
- AI chat text.
- Anything you type into a field, except your own notes.
- The contents of the printer's G-code.

Text that looks like an IP address, a key, a password, a Wi-Fi name, a serial
number, a file name or a folder with your user name in it (`/Users/<name>/`,
`C:\Users\<name>\`) is replaced with a marker such as `<ip>` before anything is
written, and again when the report is built. The masking looks for patterns, so
it can miss something unusual. If a message mentions a file Deja Vu1 does not
know about, a few words of its name might remain. That is why you can read
everything before you send it.

Nothing leaves your computer by itself. Deja Vu1 has no server that receives
reports.

## Read it, save it, send it

1. In **Settings → Tester mode**, press **View report**. The report opens in a
   window inside the app. Read it. It is the same page the saved file holds.
2. Press **Save tester report**. Your browser downloads
   `deja-vu1-tester-report-YYYY-MM-DD.zip`.
3. Attach the zip to your reply on the forum. The forum accepts a .zip up to
   30 MB, and the report stays under 25 MB.

The zip holds four files:

| File | What it is |
|---|---|
| `report.html` | The report. Opens in any browser with no internet and runs no scripts. |
| `report.json` | The same numbers as data, so reports from several testers can be combined. |
| `events.jsonl` | The raw record, one event per line, after masking. Open it in any text editor to check. |
| `README.txt` | What each file is. |

If the record grows past 20 MB, Deja Vu1 sums up the oldest routine events
(presses that were not slow, background requests that worked, screen visits)
into one line per day and control. It keeps every error, every slow action,
every note and the printer's whole story, and the report says how many events it
summed up.

To remove everything Tester mode recorded, press **Delete tester data**.

## What has and has not been checked

Tester mode has run in Chromium on Linux against a stand-in printer (a
pretend Moonraker, not a real U1). It has not been run on Windows or macOS yet.
If something does not work on your computer, that is worth a note.

[Real printer notes](real-printer.md) lists everything that could not be checked
without a printer, and why.
