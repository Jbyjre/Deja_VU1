# Error codes

When the Snapmaker U1 pauses a print or stops it, its touchscreen shows a pop-up with a code such as
`0002-0523-0000-0038`. Deja Vu1 reads the same code from the printer, says what it means in Snapmaker's own
words, and opens Snapmaker's troubleshooting guide and videos next to it.

## What you see

- **The Printer screen and Overview.** The print card shows the level (Notice, Warning or Error), the title
  Snapmaker gives the code and the code itself, with a **What does this mean?** button.
- **A notification** the moment the printer reports a code, with the same button.
- **The explanation window.** The code is split into its four groups (level, module, sub-module, issue). Under
  it sit Snapmaker's title and details, quoted word for word with the page they came from and the day they were
  read. A video appears where Snapmaker has one for that code, and **Show Snapmaker's guide here** opens the
  wiki's guide in the window: its steps, pictures and clips. A search box at the top looks up any other code,
  by number or by words ("filament runout").
- **Needs you and the farm cards** name the problem ("Demo printer 2 is paused: Printing Anomaly") instead of
  only saying "paused".
- **Maintenance → Error codes** looks a code up without a printer connected, and lists what the printer said
  lately: problems with their codes, error replies and the reason for a shutdown.
- **The logbook** adds an entry by itself when a code appears: what was printing, how far along, the readings
  from the seconds before, and the time the printer stopped reporting it. A pause you press yourself is not
  logged as a problem.
- **The AI assistant** explains a code from the same table and guide when you ask, shows the video in the chat,
  and knows about the problem the printer is reporting. Its instructions tell it to answer in Snapmaker's words
  and to say so when the table does not list a code.
- **Tester mode** counts the codes a real printer reports and lists each as a printer finding in the report: the
  code and Snapmaker's title, with no file name and nothing else. The report marks them as the printer's own report,
  not a fault in the app.
- **Automations.** The rule trigger "the printer reports an error" now also fires for a pause the printer
  raised with a warning or error code. A notice does not trigger it.

A pause you press yourself shows no code and reads "Paused", as before.

## Where the words come from

Snapmaker publishes a [U1 error code reference table](https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting/u1_error_codes)
on its wiki. Deja Vu1 keeps that table in `backend/reference/u1_error_codes.json` with the page address and the
day it was read (21 November 2026). It holds 413 codes: 40 notices, 241 warnings and 132 errors, in nine
modules (motion control, toolhead, filament feeder, heated bed, chamber temperature, homing, G-code,
detection and calibration, slicing file). 218 codes have a guide (11 of them a guide with the same name as the error, which the window labels as
such) and 140 have a video. 64 have neither, and the window says so and shows the table's text alone.

The wiki also lists guides that name codes missing from its own table (`0003-0528-0000-0027` is one). The app
finds those guides too. A code that neither the table nor a guide lists is reported as not listed, with what its
four groups still say. Deja Vu1 never writes an explanation of its own.

Snapmaker's wiki carries its own caution, which the window repeats: the code on the screen may not be the real
source of the fault. If a fix does not work, Snapmaker asks you to record the code and contact their support.

To refresh the table, run `python3 tools/update-error-codes.py`. It reads the wiki's table and guide pages,
checks each video with YouTube's embed check and rewrites the file. Run it before a release and when Snapmaker
adds codes.

## Guides and videos

- A guide is read from the wiki when you press the button, not before. Deja Vu1 asks for a guide only if its
  table lists it, over https, to the wiki's own address. The page arrives as plain headings, paragraphs, lists,
  notes, pictures and clips; nothing from the wiki runs in the app. A copy stays on your computer for 14
  days and opens without the internet. **Read it again** fetches a fresh copy.
- 9 videos from Snapmaker's YouTube channels are linked, some starting at the minute the wiki points to. A video
  waits behind a button. Pressing it loads YouTube's player and sends YouTube the address of the page, which
  the line under the button says. **Open it on YouTube instead** is always there. Snapmaker's own clips on its
  wiki download only when you play them.
- The online demo does not read the wiki. It shows the table's words and videos for the codes it recorded and
  links to the guide on the wiki.

## How the printer reports a code

The U1's firmware reports a problem in four places, and Deja Vu1 now reads all four:

1. `print_stats.exception`: why the print is paused or stopped. It clears when the print resumes, restarts or
   is cancelled. Deja Vu1 shows it only while the print is paused or stopped.
2. `exception_manager.exceptions`: problems that stay until something clears them.
3. Two notifications to every connected program: one when a problem is raised (with the time) and one with the
   list of standing problems.
4. The code written into a message, such as an error reply to a G-code line.

The code is the printer's own numbers joined as level, module, sub-module and issue, four digits each. Until
this version Deja Vu1 asked for none of these, so a pause with a code looked the same as a pause you pressed.
Printers that are not U1s report none of the first three fields and behave as before.

Nothing about this changes what the printer does. Deja Vu1 only reads.

## What was checked

- **Read from source.** The firmware's published source was read to learn the field names, the order of the four
  groups and which level pauses or stops. The table was read from the wiki on 21 November 2026, and
  every YouTube video passed YouTube's embed check that day.
- **Stand-in printer, in the test suite.** `tests/fake_moonraker.py` raises problems the way that firmware
  does, and the tests cover a pause with a code, a stop with a code, a standing problem and its clearing, a
  resume, and a printer without the fields.
- **Browser.** The window, the guide with 10 pictures, the video button, the Care card and the assistant card
  were checked in Chromium at 1366 and 390 pixels, light and dark.

## What was not checked

- **A real U1's own codes, beyond one run.** On 22 November 2026 a real U1 (firmware 2.1.2) paused a print by
  itself for a dirty bed and went into shutdown twice after Halt. The Logbook recorded all three, and the guide
  explained the Halt code as not in Snapmaker's table. That run did not record the dirty-bed pause's code on the
  Printer screen or whether its guide opened. The fields and the notification names still come from the firmware
  source. A tester who sees a code on a real U1 can confirm the match: the window should show the same code as
  the screen.
- **A video playing in the sandbox where this was built.** The player loaded and showed each video's title, but
  its network did not let playback start. Playback in a normal browser is expected and unconfirmed.
- **Other languages.** The table and guides are Snapmaker's English wiki.
