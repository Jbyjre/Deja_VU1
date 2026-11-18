# Testing Deja Vu1 on your own U1

Deja Vu1 has been tested on a real Snapmaker U1 with stock firmware
([what was tested](testing.md)). Your U1, your network and your filaments can
show problems that ours did not. This page is for people who agreed to test it.

You install Deja Vu1 and use it for 1, 2 or 3 days, whatever you choose. The
app keeps a report of how it behaved. When your days are up it asks you some
questions, you read the report, and you attach one file to a forum message.

## Before you start

- **The tester build records from the first start.** There is no switch to turn
  on. Everything it records stays on your computer, and you decide whether to
  send it. [What it records](#what-tester-mode-records) is listed below, and so is
  [what it never records](#what-it-never-records).
- **It works the same as the normal app.** Recording only watches. Every part of
  Deja Vu1 behaves the same.
- **Nothing is installed on the printer.** Deja Vu1 runs on your computer and
  talks to the printer's Moonraker over your network, the way Fluidd or
  Mainsail does. No firmware changes.
- **Watch-only mode still works.** Switch on **Settings → Watch-only mode** (or
  start with `DEJAVU_WATCH_ONLY=1`) and Deja Vu1 refuses every command to the
  printer. Reads, the camera and the emergency stop still go through. The
  report lists each refusal.
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

## Your test round

1. **Setup opens by itself** the first time. Go through it, or skip it. The
   report notes how it went, so do whichever you would do anyway.
2. **A panel asks how long you will test: 1, 2 or 3 days.** It is 3 days unless
   you pick another. Press **Start testing**. You can change the length later
   from the **Test day** button at the bottom right, or in **Settings → Tester
   mode**.
3. **Use Deja Vu1 the way you would anyway.** Two buttons sit at the bottom
   right on every screen: **Test day 1 of 3** shows where you are in the round,
   and **Something felt off** saves a note.
4. **When your days are up** the app asks you to answer the questions. You can
   also open them at any time with **Answer the questions**.
5. **Read the report and save it.** The last step of the questions saves it.

If you quit Deja Vu1 and start it again, the round carries on where it was.

## Something felt off

Press **Something felt off** (or Alt + Shift + N) whenever something looks
wrong, feels slow or confuses you. Pick **Broken**, **Slow**, **Confusing**,
**Looks wrong**, **Idea** or **Works well**, and add a few words if you like. A
tag alone is enough.

The note saves with the screen you were on and your last ten actions. When it
comes right after an error, the button reads **Something went wrong? Tell us**
for 20 seconds, and the note carries that error with it.

## The questions

There are 52, in 12 short sections: your setup, the first run, speed, watching
the printer, printing, files and slicing, filament and care, phone and away from
home, the AI assistant, updates and settings, overall, and one last section.

- Every question can be skipped. Your answers are saved as you type, so you can
  stop and come back.
- Where a question has Yes and No buttons, press one and add a few words about
  what happened.
- If you did not try something, press **Didn't try it** instead of guessing.
- Next to some questions the app shows what it recorded ("the printer
  connected 2 times"), so you can check your memory. Where it knows the answer
  (your computer, Python, browser), press **Use this**.
- Please write the answers yourself, without an AI. Leave out your network's
  name and the printer's address.

Your answers go into the report beside what the app recorded.

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
  Python, your browser, your screen size, how many processor cores and how much
  memory the browser reports, the firmware and software versions your U1 reports
  about itself, how many printers you added, which features are on, whether
  watch-only mode is on, your look (Glass and so on), light or dark, your language
  and your slicing engine and its version.
- Each time you opened the app and for how long, and whether it was a desk or a
  phone screen.
- Every screen you opened, in order, how long you stayed and what you pressed to
  get there.
- Every button, link, tab or switch you pressed, named by its id or action word,
  in the order you pressed it. For each press: how you made it (mouse, touch, pen
  or keyboard), which mouse button, whether it was a double press, which modifier
  keys were held, roughly where on the screen it landed, how long you paused
  before it, how long until the screen changed and, if it sent a request, until
  that request finished.
- Switches, sliders and choices in lists you changed (the new setting or the
  place in the list, never typed words), and keyboard shortcuts such as Ctrl + K.
- How setup and the quick tour went: each step, how long you stayed and whether
  you skipped, finished or closed it.
- Anything slow: a press that took over a second to show a change, a request
  over two seconds, every time the browser froze for over 0.2 seconds, and every
  request the server itself took over 1.5 seconds to answer.
- Every request to Deja Vu1's own server: the route without its query, the
  method, the answer and the time. Routine background reads that worked are
  summed up in five-minute groups. Every other request, and every request that
  failed or was slow, is recorded on its own.
- Every error: in the browser (with the control you pressed just before it, your
  last ten actions, the lines of code it came from and what the printer was
  doing), on the server, in the browser's error log, a picture or file that
  failed to load, something the browser blocked, and every error message the app
  showed.
- How fast the app opens, how much memory the page and the server use, and when
  the connection to the server dropped.
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
- The notes you write with **Something felt off**, and your answers to the
  questions. They are the only places your own typing is kept.
- Every update Deja Vu1 installed: from which version to which, and whether it
  worked.

## What it never records

- File names or model contents. A file shows as "file 3, .3mf, 2.4 MB".
- Camera pictures or time-lapse frames.
- IP addresses, host names or printer serial numbers.
- Wi-Fi names, API keys or AI sign-ins.
- AI chat text.
- Anything you type into a field, except your own notes and answers.
- The contents of the printer's G-code.

Text that looks like an IP address, a key, a password, a Wi-Fi name, a serial
number, a file name or a folder with your user name in it (`/Users/<name>/`,
`C:\Users\<name>\`) is replaced with a marker such as `<ip>` before anything is
written, and again when the report is built. The masking looks for patterns, so
it can miss something unusual, such as a network name you write in a note with no
label. That is why you can read everything before you send it.

Nothing leaves your computer by itself. Deja Vu1 has no server that receives
reports.

## Read it, save it, send it

1. Press **View report** in **Settings → Tester mode** (or on the last step of
   the questions). The report opens in a window inside the app. Read it. It is the
   same page the saved file holds.
2. Save it. The last step of the questions has **Save my tester report**;
   **Settings → Tester mode** has **Save tester report**. Your browser downloads
   `deja-vu1-tester-report-YYYY-MM-DD.zip`.
3. Attach the zip to your reply on the forum. The forum accepts a .zip up to
   30 MB, and the report stays under 25 MB.

The zip holds five files:

| File | What it is |
|---|---|
| `report.html` | The report. Opens in any browser with no internet and runs no scripts. It starts with a list of what to fix first, then your answers, your notes, how the first run went, how you used the app and the details. |
| `findings.md` | What went wrong or felt wrong, ranked, each with the part of the app and where to look. |
| `report.json` | The same numbers as data, so reports from several testers can be combined. |
| `events.jsonl` | The raw record, one event per line, after masking. Open it in any text editor to check. |
| `README.txt` | What each file is. |

You can save the report again at any time, for example after a few more days.

If the record grows past 20 MB, Deja Vu1 sums up the oldest routine events
(presses that were not slow, background requests that worked, screen visits)
into one line per day and control. It keeps every error, every slow action,
every note and the printer's whole story, and the report says how many events it
summed up.

To remove everything Tester mode recorded, press **Delete tester data**. It also
removes your answers and starts the test round again.

## What has and has not been checked

Tester mode has run in Chromium on Linux against a stand-in printer (a
pretend Moonraker, not a real U1): the setup and the tour, every screen, presses
of every kind, a print on the stand-in printer, errors made on purpose, the
questions and both ways of saving the report. It has not been run on Windows or
macOS yet. If something does not work on your computer, that is worth a note.

[Real printer notes](real-printer.md) lists everything that could not be checked
without a printer, and why.
