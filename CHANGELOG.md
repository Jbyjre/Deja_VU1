# Changelog

Newest first. Each entry says what changed for someone using the dashboard,
and what is and isn't verified. The version numbers match the `VERSION` file,
the app's version history (Settings → Version & updates, from
`frontend/versions.json`) and the releases on GitHub. Version numbers before
0.8.0 were given afterwards to rounds of work, dated from the git history;
0.8.0 is the first version published as a download.

From 0.9.0 on, every merge to `main` publishes a release: a merge that does not
raise `VERSION` by hand gets the next number by itself (`tools/next-release.py`).

**25 November 2026, choose which AI watches your prints and how much it says.** With two or more AIs connected, Print watch's Customize has Which AI looks: it can be another connected AI than the one you chat with, for example a cheaper one for the many looks a long print takes. If that AI is later removed, the watch goes back to the one in use. The AI screen has How much it says (Short, Normal or Detailed), which sets how long its chat replies are. Tested with stand-in AIs and in Chromium at 1366 and 390 px in English and Spanish; not tried with two real paid services.

**25 November 2026, a ChatGPT sign-in that says what happened.** When Sign in with ChatGPT or your plan says no, the AI screen now names the case in words: plan use not allowed on the approval page, with a Try again and allow plan use button; a plan, workspace or setting that doesn't let apps use it, where signing in again won't help; the plan's allowance for apps used up; a sign-in code that ran out or was already used; ChatGPT's sign-in busy or refusing; or a network that blocks OpenAI. When port 1455 is taken by another program, the screen says the sign-in comes back on another port. Checked against a stand-in for OpenAI's sign-in and API with each refusal recorded; not checked against OpenAI itself, and whether a free ChatGPT plan works this way is still not known. The new words on the AI screen have Spanish written by AI that no Spanish speaker has read yet.

**25 November 2026, print watch follows your rules and learns from your marks.** On the AI screen, Print watch now rates each look as nothing wrong, a cosmetic flaw, a fixable problem, a failing print or a crash risk, and says why in two or three sentences with how sure it is. Under Customize you choose what it does about each kind: note it, send an alert, pause and ask you, or let the AI decide, in which case it says why it chose what it did. A pause still goes through the Pause button's checks, happens only while printing and, with Look twice before pausing, only once a second picture agrees; print watch never cancels or starts a print. It also takes one look near the end of a print. Recent looks keeps the last 30 looks on your computer with the picture each one studied. Mark a look Correct or Wrong, or Ignore things like this, and your last ten marks go with the next looks as examples. Try it on a recorded time-lapse takes frames from a video in your browser and has your AI judge them with your rules, pausing and sending nothing, so you can see what it would have done. The earlier Pause a clear failure and Send me an alert switches carry over into the new rules. Checked with tests against a stand-in printer and a scripted AI, and in Chromium at 1366 and 390 pixels wide, with frames taken from a real video. An alert from print watch now carries the picture it studied on ntfy.sh, Discord and Telegram (Add the picture to alerts, on unless you turn it off; an alert held for quiet hours goes later with its words only). Not checked with a real AI judging a real U1's camera, and the pictures were checked against stand-ins of the three services, not the services themselves. The new words have Spanish written by AI that no Spanish speaker has read yet.

**25 November 2026, replay an ended print on the 3D twin.** Printer › Prints has Replay on each ended G-code print, and the history line in Files has Replay the last print. The window opens close on the print as the twin draws it from the file's own G-code, layer by layer, with the whole printer a press away. Under it are the layer, the time in, the bed's and the working head's temperatures at that layer, a chart of the temperatures with a mark at each AI watch note and pause and at the end, and the time-lapse frame of that moment when one was taken. Play runs the print forward, the bar scrubs to any layer, and Jump to where it went wrong goes to the first note or pause before a failure. While a print runs, Deja Vu1 now keeps a light trace of it on your computer: a point each layer and every 30 seconds, thinned on a long print so it stays a few hundred kilobytes at most, carried on after a restart and deleted with its print. Prints from before this version replay their layers without the readings, and a print whose file has left Files says its layers can't be drawn; nothing is filled in. Checked with the stand-in printer and demo prints given a trace, at 1366 and 390 pixels wide, light and dark. Not checked on a real U1. The new words have Spanish written by AI that no Spanish speaker has read yet.

**25 November 2026, Deja Vu1 remembers the files you printed.** A file that comes back now carries its history. Files, under the file's name, Confirm Print, at the top, and the Slicer, in its status line, say how often it printed before and how the last time ended, on which day and printer; a print that failed or was stopped also says the layer it stopped at and what the AI watch or the printer said. A file is known again by a fingerprint of its contents worked out on your computer, so a renamed copy counts, and a model counts with the G-code sliced from it. When the file once finished, Print it like the time it worked opens Confirm Print on the G-code of that print, which checks it as usual and lists each head that now holds another material, colour or roll; a head is compared only where both prints report it, so nothing is guessed. Show that print opens Printer › Prints with only the prints behind the line. Prints also has What your prints say: how much longer or shorter a printer runs than its estimates, how often each material finished, how much filament prints use against their files' plans and how many failed prints stopped in the first three layers, each shown once three or more prints back it and each opening the prints behind it. The record now keeps the layer a print ended on and up to five notes from the AI watch, which the print's page shows. The AI watch's first-layer check now sees the layer the printer reports; before, it never fired on a U1. Checked with a stand-in printer and the demo data at 1366 and 390 pixels wide, light and dark. Not checked on a real U1. The new words have Spanish written by AI that no Spanish speaker has read yet.

**24 November 2026, Deja Vu1 runs only while you use it, uses the Snapmaker Orca you already have, and opens faster.** Deja Vu1 no longer starts with the computer: the Settings switch is gone, and a start-up entry from an older version is taken away the next time Deja Vu1 starts (Windows, macOS and Linux). Started from a launcher, it stops by itself 5 minutes after its last page closes, so no Python is left running; a running print, a slice, a time-lapse being copied, an update or an engine install keeps it going until that ends. With no page open it reads the printer every 2 seconds instead of 4 times a second, and the search for a printer that moved to a new address waits until a page is open. When Snapmaker Orca is already on the computer, setup and the Slicer use that copy and say so, instead of offering to download it again. The double-click launchers check for Python 3.8 or newer and say what to do when it is missing; on Windows, the launcher offers to install Python 3.12 with winget, Windows' own installer, after you press Y. A phone or tablet on the home network now gets the dashboard's files compressed, about 1.2 MB on a first visit instead of about 3.1 MB, and a browser on the same computer gets them as they are, which measured faster there. Keeping a connection open made each request on the same computer wait for the network's small-packet delay; that delay is off now. [How Deja Vu1 runs](docs/how-it-runs.md) says what it needs from your computer, what runs and when, and when it stops. Checked in the cloud sandbox: the timings, memory and processor figures in that page, the tests for each change and the setup walk. Not checked: the Windows launcher and winget were not run on Windows, the places a Windows or macOS Snapmaker Orca install is looked for come from its documentation, and no fix has run on a real U1 yet.

**24 November 2026, one path through the app: from a model to a print and back, a camera window you control, and every print on record.** Each screen now leads to the next one. Confirm Print offers a way out for each reason it holds a print (open the model in the Slicer, see what each head has loaded, record a nozzle swap, go to the bed check, or add the file to the queue while another print runs), and each one takes you to its spot. A print that starts opens the Printer page. When it ends, its summary leads to the print's record, a second print of the same file and the next file in the queue; the queue never starts a print by itself. One Activity button in the top bar lists the long jobs (a slice, an upload, a print starting, a download) in words, each one press from its place. Printer › Prints keeps every print on this computer, day by day and searchable, with the picture at the end, the time it took against the estimate, filament per head, notes, the time-lapse, Reprint and Open in Slicer. Time-lapses play inside Deja Vu1 with play and pause, a scrub bar, frame steps, speed and full screen, and stop at the end unless you turn Loop on. The arrow on any camera view opens one camera window you can move, resize, zoom into, pin over every screen, show full screen or save a picture from; the other camera views wait while it is open, so the printer sends one stream. Setup now looks for the printer as soon as its step opens, says that the U1 joins 2.4 GHz Wi-Fi only when none is found, installs the slicing engine, offers your own AI as optional, and opens the sample 3DBenchy in the Slicer at the end. After an update, Show me what's new walks through every spot that changed and puts you back on the screen, part and scroll position where you started. The page also opens a new live connection when it has heard nothing from Deja Vu1 for 50 seconds, so a dropped link no longer leaves the readings frozen. Checked with a stand-in printer at 1366 and 390 pixels wide. Not checked on a real U1. The camera window has no share button yet, and the new words have Spanish written by AI that no Spanish speaker has read yet.

**23 November 2026, Deja Vu1 has run on a real U1, and what that run found is fixed.** On 22 November 2026 Deja Vu1 0.20.37 on Windows 11 ran against a real Snapmaker U1 (stock firmware 2.1.2): it connected, homed, moved, heated, tool-changed, sliced with the real engine and printed a two-colour file to the end (80 of 80 layers), paused, resumed, skipped an object, cancelled and pressed Halt; [docs/testing.md](docs/testing.md) has the dated record and the README no longer says the app is untested on a U1. What it found and what changed: after Halt and a firmware restart the U1 kept the halted print and restarted it by itself ten minutes later. Deja Vu1 now reads the printer's saved-print flag, shows "The printer still holds a halted print" with a Discard button that asks twice, lists it under Needs you and holds Confirm Print until you decide. Confirm Print asks you to tick that you looked at the bed and it is clear after a print ended, and draws where the leftover part sits on the plate map. The printer's own "detected dirty bed" pause says "Take what is on the bed off, then press Resume". "What does this mean?" on an error opens the explanation and no longer the This print panel. Time-lapse takes a frame every 90 seconds as well as every few layers, so a long print is not left with one frame, and says so when the camera keeps sending the same picture. The assistant says nothing happens until you approve a step, and offers your other connected AIs and a Retry when the saved one fails. The Slicer refreshes by itself after the engine installs, and Slice plate is off with the reason beside it for a model larger than the U1. The slicing engine runs at lower priority so the dashboard keeps answering while it works. A command the printer refuses comes back as a 409 (a printer that cannot be reached stays 502), the raw JSON text after Halt is a sentence, Resume shows "heating" while it heats, and buttons are at least 36 px high on a touch screen. The engine table lists Snapmaker Orca 01.10.01.50 on Windows as run. Not fixed and not reproduced here: the dashboard stopping for seconds under load and the head position lagging the printer (2 ms idle and 90 to 140 ms under load against the stand-in printer; a Windows localhost delay is a possibility that is written down, not confirmed), the Printer screen half drawn after switching looks, and the exact text of the Halt error. The saved-print flag is named from the firmware's published source; no real U1 has been run with the fix. Checked: the full suite of 2,030 tests on Python 3.13 in 29 minutes (one failure, the tester walk's count of setup steps, fixed and rerun: it passed); browser checks of each fix against a stand-in Moonraker printer in Chromium (`tools/livefix-check.js`, 32 checks), the error-code window and the whole browser walk after a click-handling fault they found in the first version of the explain-button fix, and the text audit.

**23 November 2026, Deja Vu1 in Spanish, with a language step in setup.** The first start now opens with Language: English or Español (Spanish). A Spanish browser sees Spanish highlighted and nothing changes until you press it. Pressing it reloads the page in Spanish and setup goes on there; Continue keeps English. Settings, Appearance, Language lists both. All 6,278 texts on screen have a Spanish version, with the screen names Confirmar impresión, Requiere tu atención, Imprimir un archivo, Precalentar, Empezar de nuevo and Preguntar used the same way everywhere. An AI wrote the Spanish in one session and no native speaker has read it, so expect word choices a Spanish speaker would change; the release notes, the product page and the documents stay English, and so do the words a printer reports about itself ("docked", "active") and printer and file names. Choosing a language in Settings never reloaded the page when the address ended in #/place, which it always does after the first click; it reloads now. Sixteen sentences that were built from a bare English word ("1 maintenance task overdue", "It was cancelled", "were left out", a nozzle or hotend swap) are whole sentences per case, so a translation can reorder them, and the Readings table's Head heading no longer breaks into pieces at phone width. Checked in Chromium on Linux with demo data: 6,278 of 6,278 texts pass the placeholder, tag, link and kept-name checks; all 19 screens and every part of them open the same cards in English and pseudo with no script error; the text audit with Spanish on 90 screens at 1366 and 390 px found one fault, fixed, and then none; setup has 30 checks, 11 on the Language step. Not checked: a native speaker's reading, a phone, searching the command bar in Spanish, a real printer with the app in Spanish. [Translating Deja Vu1](docs/translating.md).

**22 November 2026, a language list in Settings and the machinery to translate Deja Vu1.** Settings, Look & layout, Appearance has a Language list. It shows English and every language whose translation is installed. None is installed yet: the first round of translation has not been made, so the list holds English only. When a language is installed, choosing it reloads the page in that language, dates and times follow it, and a text without a translation stays English. Behind the list: `frontend/strings/en.json` holds the 6,231 texts on screen (the page, its scripts and the sentences the server writes for Confirm Print, maintenance, slicing, the engine install and the queue), each under a short key made from the words, so a changed text becomes a missing one and a removed text drops out. `python3 tools/i18n.py extract` writes the list, `status` says what each of 20 languages lacks and how many merges have passed since the last round, `todo` hands a translator the missing texts, and `merge` stores an answer only when its placeholders, tags, code, links and kept names came back unchanged, and `review` shows what a reviewer should read first. Four places in the app looked at their own English words to decide what to do (the Settings groups, the help buttons beside card titles, the command bar's search targets, the Farm and Maintenance anchors) and now work in any language, and the 3D printer's tags no longer rebuild every frame when the words on screen differ from the ones the code drew. `?lang=pseudo` shows every listed text accented and about a third longer, which is how missing texts and labels that no longer fit are found. Checked in Chromium on Linux with demo data, with the pseudo language and a two-text German stand-in: 25 loader scenarios; all 19 screens and every part of them open the same cards, headings and help buttons in English and in pseudo (putting the old English-only lookup back made 17 screens differ); the text audit with longer words ran on 270 screens at three widths, light and dark, and one run reported 10 findings on the 3D printer's sheet at 1024 px while four other browser runs shared the computer, while the same screens run alone found nothing; 67 percent of the visible words on those screens come from the list, and the rest are figures, file and printer names, release notes and sentences the code builds in pieces. Not checked: a real translation, a native speaker's reading, a phone, a right-to-left language (Arabic and Hebrew wait for a mirrored layout), the product page, which stays English. [How a round of translation runs](docs/translating.md).

**22 November 2026, 3MF projects slice: stray points, projects from other slicers and the engine's version check.** A slice could end with "Nothing to slice" while the model sat well inside the plate on screen. The real Snapmaker Orca engine (the v2.4.1 Linux release) reproduced three refusals, and each one slices now. A 3MF file can store a point that no triangle uses. The engine measures every stored point when it checks that a model fits, so one stray point outside the plate made it refuse the whole plate, at any height and even under the bed. Deja Vu1 now leaves unused points out of the temporary copy it hands the engine, and your library file stays as it was. Projects saved by Bambu Studio, Orca and Snapmaker Orca describe a model through a container object, and the engine read a plate built from one as empty. The plate now points at the model's parts, with their positions combined. The engine also refused a project that its own window had saved ("Unsupported 3MF version": the file says 2.4.0.1 and the engine is build 01.10.01.50). Deja Vu1 now tries once more with the engine's own `--allow-newer-file` switch after that refusal, and keeps the first message if the engine has no such switch. When the engine still finds no model inside the plate, the message names the object and says how far it reaches past which edge, or how tall it is against the printer's limit. It no longer tells you to add a model to a plate that has one, and it no longer quotes the "Unable to create exclude triangles" line that every U1 slice prints. Fifteen more of the engine's error codes have words and next steps. The v2.4.1 release calls itself 2.4.1 in its settings file and 01.10.01.50 in its help text, so a Windows engine of that release is no longer shown as a different build from the one tested on Linux. Checked with the real engine on Linux: the three refusals, then slices of the repaired files, a model rotated and scaled, one object on each of three heads, an OBJ, a 3MF the engine exported (as a plate source and on its own) and an STL on its own; 1951 tests pass. Not checked: Windows and macOS engine runs. The model from the Windows tester's report was not available, so which of these causes produced that report is not confirmed.

**22 November 2026, the Slicer: models slice again, the controls are Snapmaker Orca's, and each head gets its own filament.** The first run of the real Snapmaker Orca engine (the v2.4.1 Linux release the Engine button downloads) found a fault in Deja Vu1. A plate stored every triangle with three private corners, so the engine saw a surface in loose pieces and refused the 3DBenchy, a gear and a vase with "empty layer" (exit code -100). Corners that meet are now shared, and all of them slice. The mouse and keys follow Orca's own list: the left button turns the view round the selected model at 0.8° a pixel, the right button pans so what was under the pointer follows it, the wheel zooms a tenth a notch toward the pointer, Ctrl+0 to 6 give the default, top, bottom, front, rear, left and right views (the six flat ones through a flat lens), 1 to 4 choose the head, A arranges, Q orients, arrows move 10 mm, Ctrl+C, X, V, K and D copy, cut, paste, clone and delete all, Shift and a drag select with a box, Ctrl+R slices, Ctrl+G saves the G-code and Ctrl+Shift+G prints. Press ? for every key. The camera button offers Orca's four camera options. In the Preview the arrows move the layer and move sliders and L shows one layer. Press a head to choose its filament: what the printer reports, your own spools, the material, one of the engine's filaments for the U1 (34 of them), a colour, and eleven temperature, flow and cooling numbers shown beside the filament's own. A line under the heads says where one differs from the printer, and Sync names what it read. Save keeps the print settings, the speed and each head's filament choice under a name; the sets can be renamed, exported to a file and imported. The Preview's layer numbers equal the engine's (a 48 mm model showed 242 layers and now shows 240). Camera and keys were read from Orca's v2.4.1 source and measured in Chromium (`tools/slicer-check.js`, 86 checks). The real engine passed `tools/engine-selftest.py` (9 of 9 steps) on Linux, and a slice made through the Slicer's own screen carried the chosen filament, colour and temperatures. Not verified: the Windows and macOS installs, a trackpad pinch, a touch screen, a real graphics card. The managed engine has no per-head layer-height options, so different heights per head are refused with a plain message. Cut, painting, text and the other Orca tools say they are not in the Slicer yet.

**22 November 2026, the Slicer: Snapmaker Orca's layout on the U1's own plate, with the engine installed for you.** Slicing has a place of its own in the sidebar, with two parts, Prepare and Preview. Prepare draws the U1's plate in the app's own colours, with its printable area (270 × 270 mm, 270 mm tall), its sheet outline and the printer's name where the real plate carries it, instead of the dark blue grid, and the 3D view in Files draws the same plate (the printer's 3D twin keeps its own bed for now). Put STL, 3MF and OBJ models on it (drop them on the plate, press Add, or press Open in Slicer in Files), then move, turn, scale, mirror, duplicate, lay one on a face, split a model into its parts, arrange and auto-orient them. Each model gets a head from T0 to T3 and its own walls, infill and supports. Every change has undo and redo, and the common tools have keys. The four heads sit beside the printer with the spools it reports and a layer height for each head. The Process block has Layer, Infill, Walls, Supports, the prime tower and a speed slider, and **All settings** opens a sheet with all 118 print settings in Orca's groups (Quality, Strength, Speed, Support, Multi-material, Others), Simple and Advanced, a search that reads the names and the notes, a plain-words note beside each setting, the settings you changed marked and one press to put each back to the preset. Problems show as they happen, each with a fix: an object over the plate's edge, a plate with several heads and no prime tower (the tower is drawn on the plate, and a tall, narrow one offers the engine's stronger wall and frame settings), and overhangs that probably need supports. Slice plate runs the engine, follows its stages and opens the Preview: the toolpaths in 3D coloured by line type, head, speed, flow, layer height or line width, a layer slider, a move slider with play, the time and filament the engine worked out, and warnings that jump to the spot. Print plate opens Confirm Print, and More saves the G-code or adds it to the queue. The plate comes back where you left it after a reload. The links to Slice, Layers and Prepare open the Slicer, and the first Files slicing screens are out of sight. The **Engine** button downloads Snapmaker's own Orca release (v2.4.1 for Linux, Windows or macOS) into Deja Vu1's own folder, checks it against the file's SHA-256 (recorded from the release, or the one GitHub lists for a newer release), starts it once before using it, keeps it apart from any Snapmaker Orca or OrcaSlicer you have, and offers updates while the old engine keeps working. It stays a separate program under its AGPL-3.0 licence, with the source and licence linked in its card; the card also holds the time limit per slice. Error messages that sent you to Files, Slicing now point to the Engine button. What was checked: the full test suite (1911 tests, no failures on the second full run; the first had six failures, all fixed), 54 browser checks of the Slicer in Chromium at 1366 and 390 px in light and dark against a stand-in engine (`tools/slicer-check.js`), the install against a local stand-in release server (download, checksum, unpacking, a bad archive, a bad engine, cancel, update), pictures of every part, and the online demo re-recorded. Not checked: **Snapmaker's own engine was not run**, so the Linux unpacking, the macOS copy, a real slice and the engine's own arrange and orient are unverified (`python3 tools/engine-selftest.py` runs them on your computer and prints each step), nor was a real graphics card or a real phone. Not built yet: cutting a model, painting colours and supports, calibration prints, printing one object at a time, saving a project with several plates, sending a plate to another U1, a movable prime tower and a time estimate corrected by your printer's history. Details: `docs/slicing-and-models.md` and `docs/engine-support.md`.

**21 November 2026, error codes: the printer's own code, in Snapmaker's words, with their guide and videos.** A U1 that pauses or stops a print on its own shows a code such as 0002-0523-0000-0038 on its touchscreen. Deja Vu1 read none of the four places where the printer reports it, so a pause with a code looked like a pause you pressed, and the logbook skipped it. It now reads all four. The Printer screen, Overview and Needs you name the problem ("Paused: Printing Anomaly (0002-0523-0000-0038)"), a notification carries a **What does this mean?** button, and the logbook adds an entry by itself with what was printing, how far along, the readings from the seconds before and the time the printer stopped reporting it. The window splits the code into level, module, sub-module and issue and quotes Snapmaker's title and details word for word from the 413 codes of their error code reference table (read from the wiki on 21 November 2026, with its address and date). It opens the wiki's guide inside the app on request (read from the wiki, kept on your computer for 14 days, pictures and clips included) and shows Snapmaker's YouTube videos behind a play button, some starting at the minute the wiki links. Maintenance → Error codes looks up any code by number or by words and lists what the printer said lately: problems, error replies and shutdown reasons. The AI assistant explains a code from the same table and guide and shows the video in the chat. Automation rules that fire on "the printer reports an error" now also fire for a pause raised with a warning or error code. Tester mode lists the codes a real printer reported as printer findings, with the code and Snapmaker's title only. A code the table does not list is shown as not listed, and Deja Vu1 writes no explanation of its own. After a reconnect the app asks the printer for the problems it holds and forgets any that cleared while the link was down. `tools/update-error-codes.py` rebuilds the table from the wiki. What was checked: the full test suite (1882 tests, no failures), 18 browser checks of the window in Chromium at 1366 and 390 px (`tools/errorhelp-check.js`), the text and layout audit (no findings), pictures in light and dark, a stand-in printer that raises problems the way the firmware's published source describes, and each video against YouTube's embed check. Not checked: a real U1 raising a code, and video playback, which the build sandbox's network did not let start (the player loaded and showed each video's title). Details: `docs/error-codes.md`.

**21 November 2026, cards that stack have their gap back, printer cards have their padding back, and the text audit finds both.** A rule added in the last build outweighed the ones that spaced panels and padded the printer cards, so panels that stack touched on Readings, History, Slicer, Files and Maintenance, and the printer cards on All printers had no inner padding (their checkboxes sat on the card edge and "Ready" touched the right side). Panels are 14 px apart again on every screen, the printer cards have their padding, and Readings, History and Camera & time-lapses start 14 px under the toolbar (an empty leftover container had added 34 px). Smaller fixes: the last time label on the Farm timeline no longer breaks to one character a line, the Files converter card lines up with the cards below it, Photo studio and Automations use the same 14 px, the camera screen's "U1 built-in camera" and low-latency rows match the app's other disclosure rows and its placeholder says what is true (the demo does show a picture), and the camera note in an Overview sheet has padding. `tools/text-audit.js` now also reports text broken into slivers, text touching the edge of its panel, panels touching, overlapping or not 14 px apart, and controls that a box cuts away or pushes out of the window, each shown to fail on a planted fault first. What was checked: the full test suite (1806 tests, no failures), the text audit over 450 screens (five widths, light and dark, very long names, no findings) and its keyboard pass at 1366 and 390 px (no findings), the browser walk with axe-core on 21 places (168 visits, 17 workflow runs, no problems), screenshots of every changed screen at 1366 px, all in Chromium on Linux with demo data and software graphics. Not checked: the glass over the moving 3D printer on a real graphics card (software graphics here), a real phone, and a real U1.

**21 November 2026, the Printer screen as one room, a camera you see whole, text that always fits, and a technical glass look.** The 3D printer now fills the whole window behind the sidebar and the toolbar, and everything else floats over it as glass. Each head, the bed and the chamber show their temperature on the machine itself, on a short line to the part; press one to open the temperatures. The print card sits top left, the camera window top right under Halt, and a column of labelled buttons (Temperatures, Move, Extrude, Fans and lights, Bed mesh, Buttons, Console, Print) at the left, which shrinks to icons in a narrow window. The side columns and their dividers are gone. The camera window takes the shape of the picture the printer sends, on the Printer screen and on Overview, so the whole print shows instead of a cropped strip. Overview is rebuilt around that camera, with a status card under it (progress has a tick at every tenth) and readable Needs you and printer lists at the side. Every screen is glass over one calm room: the sidebar, the toolbar and the tool column are clear glass, panels are frosted, and a faint grid and the colours of the loaded filaments sit behind them. Corners are tighter, buttons are flat with a hairline, figures are monospaced, and reduced transparency, increased contrast and reduced motion are honoured. Text stays inside its box. Names and labels stay on one line and end in an ellipsis, and the full text shows when you rest the pointer on it. File names are cut in the middle so the extension stays visible, long names inside a sentence break at underscores and dots, nothing is smaller than 11 px, and a notification shows three lines at most. The sidebar opens when you rest on its icons or flick the pointer to the left edge of the window, stays open while you are near it, closes about a second and a half after you leave, closes sooner when you move far away or click elsewhere, and now opens above a sheet. The Sidebar setting under Look & layout (Always open) still keeps it open. Small things fixed on the way: the Preview a backup button no longer slips out of the Settings card beside Download full app backup, the search shortcut hint sits in the middle of the search box, small controls meet the 24 px target size, a control you reach with the keyboard scrolls clear of the floating corner, and the "continue on this computer" offer no longer sits under notifications. `tools/text-audit.js` is the check behind this: it opens every screen, sheet and Settings group at five widths (1366, 1024, 768, 600 and 390 px), in light and dark, with printer, file and task names made about 70 characters longer, and reports text that is cut, outside its panel, a control that a box cuts away or pushes out of the window, over other text, wrapped where a label must not wrap, under 11 px, unreadable when cut, or on a control under 24 px or without a name; with `--focus` it also tabs through each screen and reports any stop with no visible focus. Its first run, at two widths, found 1033 problems; its last run, 450 screens with the keyboard check, found none. What was checked: the full test suite (1803 tests), the frame walk (93 checks), the first-run walk (40), the set-up walk (19), the page-bug checks (62), the browser walk with axe-core on 21 places (168 visits and 17 workflow runs, no problems), the text audit (450 screens, no findings) and the opening scene captured again at laptop and phone size, all in Chromium on Linux with demo data and software graphics, plus screenshots at 1366, 1024 and 390 px in light and dark. Not checked: the glass over the moving 3D printer on a real graphics card (software graphics here), the opening scene, a real phone, and a real U1.

**20 November 2026, the printer in the middle of the Printer screen, a calm Overview, a sidebar that opens when you point at it, and a time left that follows your file.** The Printer screen puts the 3D printer in the middle with nothing around it. Small tiles on either side show temperatures, tuning, the print and the camera; a row of buttons under the printer opens Move, Extrude, Fans and lights, Bed mesh, the printer's own buttons, the console and Print. A press on a tile or a button opens a sheet over the screen. Move, Extrude, Tune and the printer's own buttons bring the 3D printer and the camera next to the controls, so you can watch what each press does. Nothing on the screen scrolls. Drag the edge of a side column to resize it; the 3D picture holds still while you drag and redraws once when you let go. Halt appears on the Printer screen and on no other screen; H H still halts the selected printer from anywhere. Overview shows what the selected printer is doing with its camera under it, what needs you (the first three, with the rest one press away) and every printer; temperatures, quick control, maintenance, totals and the phone link open in sheets. The 3D printer no longer sits on Overview. The bar along the bottom is gone: pick a printer in the sidebar, and the notification orb, Ask and the connection words float in the bottom right corner. The connection words show only for demo data, watch-only mode or a lost link. The sidebar shows icons and opens over the page when you point at it. It closes 3 seconds after your pointer leaves, or 0.7 seconds after you choose a place, and Settings, Look and layout keeps it open instead. When Deja Vu1 starts, the 3D printer fills the screen for 3 seconds, turning slowly, then pulls back into place while the rest of the app rises around it. A click or a key skips it and Settings, Look and layout turns it off. It stays out of the way with reduced motion and on a computer that draws 3D in software. A first start now opens on the Printer screen. The 3D printer stays sharp when nothing moves it: it used to drop to a third of its resolution after one slow drawing and stay there, and now a still picture draws at full size and a moving one drops no lower than half. Time left uses one estimate everywhere (Overview, Printer, the printers list, automations and Home Assistant). It starts from the estimate the slicer wrote into the file, adds how this print is running as it goes, and uses the slicer's own progress or the file's own time track where it has them. A 7 hour file with a slow start no longer reads as 16 hours, and the screen says where the figure comes from. Practice printers appear under Printer only after you switch them on in Settings. "Print health" is now "Ready to print": a quiet ring, a short kind phrase, and a list of what would help instead of what costs points. The AI screen's print watch shows the live camera with what the AI looks for and its last verdict laid over it, and a scan line runs while it checks. Bambu Studio, MakerWorld and other slicers' projects turn into Snapmaker U1 profiles from a banner at the top of Files, and from a "Bambu to U1 profiles" button in the toolbar. Checked in Chromium on Linux with demo data and software graphics: all 1789 unit tests (three failed on the first full run and passed after their fixes), the frame walk (94 checks), the tester walk (40 checks), the page-bug checks (62 checks, including no freezes on an idle printer), the accessibility pass over 21 places (no problems), and screenshots at 1366, 1024 and 390 px in light and dark. Not tried on a real graphics card, a real phone or a real U1. The time estimate is tested with stand-in numbers; whether the U1 reports the slicer's progress (M73) is not verified.

**20 November 2026, a calmer Printer screen you click into, Maintenance as a list you can filter, Files takes a dropped file anywhere, and the note button no longer covers the page.** Maintenance shows each job as one flat row (its name, how far along it is, Mark done and Not now) under a band that counts Overdue, Due soon and OK next to your print hours, prints and filament. Press a count to see only those jobs and press it again to see all of them; the keyboard works too. Files with nothing in it is one drop zone that opens the file chooser when you press it, and a file dragged over the Files screen outlines the whole screen. On Printer the twin's tools take two compact rows, which leaves the 3D view more height, and the temperature target boxes show °C so the text fits. The gesture hint under the twin shows for people who chose "New to 3D printing". Tester mode's "Something felt off" button now sits in the strip beside Find (only its flag shows in a narrow window or on a phone) and no longer floats over the camera and the move pad. On a phone, the "continue here" offer has its own background, so the page no longer shows through it, and the strip keeps the printer's name by dropping its small meter. The offer says "your other computer" when it cannot name the device. After you first connect a real printer, one message offers to open Deja Vu1 in its own window; Settings, Desktop app keeps the full choice. With no AI connected, the AI screen shows its headline with the three things it adds beside it. The Printer screen is calm until you click into something: Temperatures, Camera and Print a file are open and every other section (Extrude, Tune, Fans and lights, Move, the printer's own buttons, Bed mesh, Objects on the plate, the G-code console) shows its title and opens with one press, and the screen remembers what you opened. Temperatures shows the readings; Set temperatures shows the target boxes and the material buttons. The 3D printer turns slowly by itself on the Printer screen and stops while your pointer is over it (it stays still if your system asks for reduced motion); click it and it fills the screen with all its view buttons, and Escape or Close puts it back. Checked in Chromium on Linux with demo data and a 390 px window: the frame walk (83 checks), the tester walk (40 checks), the accessibility pass over 21 places (no problems) and the unit tests that read the frontend. Not tried on a real phone or a real U1.

**20 November 2026, Deja Vu1 is one connected surface: a sidebar of eight places, panes you can resize, and a strip along the bottom with Halt.** The bar across the top is gone. Overview opens on the selected printer in 3D with its readings under it and a side pane for what needs you, your printers and your totals. Printer is one cockpit: heads, bed and tuning on the left, the twin in the middle with the console under it, the camera and the move pad on the right. Each divider moves with the mouse, by touch, or from the keyboard (arrow keys move it 12 px, Shift 48 px, Home and End go to the limits, Enter collapses the pane); the sizes stay in your browser and Settings, Look & layout, Reset layout puts them back. The sidebar lists Overview, Printer, Slicer, Files, Models, AI, Maintenance and Settings, with Automations, Photo studio and Games under More, and narrows to icons by itself in Printer, Slicer and Files. Printers, the Farm and the practice printers are now parts of Printer, and old links such as `#/slice`, `#/queue` and `#/prefs` land in the new place. Each place shows its parts as tabs in the first row of the screen. A strip along the bottom holds one instrument per printer (a small stack of lines fills as its print grows), the connection, the notification orb and **Halt**: one press stops the selected printer (or press H twice), then one line says what happened and offers Restart firmware. If the printer refuses, the line says so. Settings, Halt has "Ask before Halt" for a second press. Ctrl+K lists every place, part, settings group and action with its keys. Settings is one place with groups and a search, Preferences folded in, demo data under Advanced, and watch-only described in one line. Setup now asks whether you are new to 3D printing or know your way around; the second shows no explainer lines, the first keeps short hints for the first few visits. Cards lose their boxes and become cells on one surface, and dark mode is rebuilt on lighter surfaces instead of shadows. Models holds the Bambu and MakerWorld converter and links to five model sites. The online demo follows: Halt there shuts the simulated printer down until Restart firmware. Checked: the frame walk (`node tools/pagebar-walk.js`, 79 checks in Chromium: no bar across the top, the eight places and their parts, old links, auto-narrow, Halt with its two-press setting, the H H shortcut and Restart, the command bar, dividers by keyboard and mouse, Settings search, no explainer lines, a 390 px phone, Workbench and Control room and dark), the browser walk, the first-run walk, axe-core 4.14.1 (no violations on the places scanned in light and dark), text contrast measured from rendered pixels (lowest 5.36:1), and frame time on the Printer screen with software graphics (median frame 16.7 ms, was 33.3 ms). Overview now draws the 3D printer, so its mean frame went from about 22 ms to about 29 ms in the same setup. Not tested: Halt on a real U1 (it uses the same stop route as the old Emergency stop; the runs used the simulated printer and the Moonraker stand-in), Windows and macOS browsers, a real phone, and screen readers other than axe-core's rules.

**20 November 2026, Start over in the assistant stays started over, and a failed slice always says where it stopped.** If you pressed Start over in the AI assistant as an answer was arriving, the answer could save the old conversation back to disk, and it came back on the next message or after a restart. Deja Vu1 now saves an answer before the chat reads as finished and never writes a cleared conversation again. A slice job that failed, was cancelled or finished now gets its stage ("Slicing", for example) and its finish time in the same update as its result, so the Slicing screen never shows a failed job without the stage for a moment. The server no longer prints a traceback when a browser closes a connection before its answer arrives. The automatic tests on GitHub use the current checkout and Python set-up steps, and three tests that failed now and then on a busy machine wait for what they check. Two new tests cover the assistant and slice fixes; each fails on the code before the fix. Verified: 1729 tests on Python 3.13.18 (Linux, 20 November 2026); the three tests ran 38 times in a row with no failure.

**19 November 2026, Tester mode needs no setup, asks the same 22 questions any time, and its report opens with what to fix first.** Recording starts with the first launch. There is no day picker, no end date and no first-run pop-up; a quiet line in Settings, Tester mode says what is recorded and what is never recorded. The 22 questions (nine sections, each skippable, with a one-press "Didn't try it" on the two phone and AI questions) can be answered whenever you like from Settings, Tester mode, and the answers go into the report as typed. The report opens with six headline figures and at most ten "Fix first" items, each with what happened, how often, the screen, the last presses before it and where to look in the code. Requests that waited at the same moment are one item that names what the server was doing, requests that failed because the page lost the server are one item, the app's own faults are kept apart from conditions around it (the printer off, the network down, the computer asleep), and a failed slice keeps the engine's whole output. The headline and the ten closed rows fit one 1366 by 800 screen. `tools/tester-reports.py` combines several reports the same way. Fixed from a tester's report: a script error when the print-health gauge was replaced while it animated; keeping a time-lapse or a printer video held a connection for the whole copy, and a browser keeps six connections to one address, so six long copies made every other request wait; a copy is now a background job with progress and videos play as they arrive; the time-lapse list stays on screen when the switch is flipped; the AI shortcut in the Time-lapses heading keeps its width; a saved camera address that fails falls back to the printer's own camera by itself and says so; a moment without the server shows no "Failed to fetch" errors and the page speaks only when it lasts; an idle printer's page no longer freezes (10 freezes, 4,044 ms in all, in ten idle seconds before; none after, on the stand-in printer with software graphics). A slice that exited with 4294967196 on Windows is now read as Orca's -100 (a slicing error) and its whole output is kept; the cause of that one slice is not known yet. Tested: 1726 tests passed (34 more than before), `node tools/testfix-check.js` (62 checks in Chromium), `node tools/tester-walk.js` (39 checks) and the online demo, re-recorded for the new copy-jobs route. Not tested: a real Windows slice, a real U1 with this build, a real phone, a computer with a graphics card; the checks use a stand-in printer.

**18 November 2026, every screen has one slim bar at the top, and the work starts higher on the page.** The large banner with the
Deja Vu1 name stays on Overview. Every other screen opens with a bar that names the screen, shows its parts as tabs (on
Printer: Control, Live readings, History & upkeep, Camera & time-lapses; on Files: Your files, Slice, Queue, Layer heights)
and carries the buttons that screen needs: Emergency stop on Printer, Add printer on Printers, Add files on Files. Search,
the printer button, the demo switch and a ? button sit at the right. The ? button opens a short note about the screen with
its Show me this screen button, also for people who turned the beginner tips off. The greeting row, the demo banner and the
intro sentence under the tabs are gone from the page: demo data is still labelled by the Simulated label and the switch. The
first card now starts 112 px down an 800 px laptop window on Overview (it was 323) and 143 px down on Printer, Files and
Settings (it was 379); on a 390 px phone it starts at 92 and 131 (it was 144 and 204). The Emergency stop in the bar presses
the Printer screen's own button, so it still asks first and still says so when the printer refuses, and the card's copy
steps aside on a computer so there is one. A link to a screen opens it with the right top from the first moment. The sidebar
shows the Deja Vu1 name at its top. Dark, Workbench, Control room, reduced transparency, increased contrast and reduced
motion each have their form of the bar. Tested: 1692 tests passed (11 new, `tests/test_pagebar.py`), a new Chromium walk of
the bar (`node tools/pagebar-walk.js`, 22 checks), the browser walk again (136 visits and 17 workflow runs, no problems), the
first-run walk (19 checks) and the online demo served from static files. Not tested: pressing Yes on the bar's Emergency
stop, because that stops a printer (the button it presses is the unchanged one on the Printer screen), a real phone, and a
real U1; the screenshots and walks use simulated printers. An accessibility scan with the newest axe release also reports
six controls whose spoken name leaves out their visible text (the sidebar's Overview, Printer and Maintenance items and its
fold button, the version chip, the printer button). The same six appear on the code from before the bar. They are not fixed yet.

**18 November 2026, the 3D twin follows homing as the printer really moves.** Pressing Home made the twin's bed drop
to the bottom of the machine at once while the real bed had not moved: at the start of a homing move Klipper reports a
position it makes up past the far end of the axis and counts the real motion from there. The twin now keeps each homing
axis where it was and moves it by the motion the printer reports, so the bed rises toward the nozzle at the real speed, and
it takes the printer's own position again once Klipper sets the endstop position. The readout under the twin says Homing
meanwhile. Tested with a stand-in printer replaying Klipper's Z homing sequence, watched in Chromium, and with seven tests
of the sequence (`tests/test_twin_homing.py`).

**17 November 2026, Tester mode is always on in this build and asks its own questions.** A tester no longer turns anything on:
Deja Vu1 keeps its record from the first start, on your computer only, and nothing is sent anywhere. The record is wider. It
holds how each control was pressed (mouse, touch, pen or keyboard, a double or right press, held keys, where it landed, the
pause before it) in the order it happened, switches, sliders and list choices you changed, keyboard shortcuts, each step of
setup and the quick tour, how fast the app opens, how much memory the page and the server use, dropped connections, requests the
server itself answered slowly, and every error with the control pressed just before it, the lines of code, the part of the app
and what the printer was doing. You choose a test round of 1, 2 or 3 days; a button beside **Something felt off** shows the day,
and when the days are up the app asks 52 questions in 12 short sections (saved as you type, every one skippable, with what the
app recorded next to it) and then saves the report. **Something felt off** takes a tag (Broken, Slow, Confusing, Looks wrong,
Idea, Works well), and right after an error one press saves a note with that error. The report opens with **Fix these first**, a
ranked list of errors, slow controls, failed requests, failed slices, low frame rates, notes and troubled answers, each naming the
part of the app and where to look; the zip adds `findings.md` with the same list. `tools/tester-reports.py` reads both report
versions and adds the questions, the combined work list (`--findings`), every written answer (`--answers`) and how the first run
went. `TESTER_ALWAYS_ON` in `backend/modules.py` gives back the optional switch, and `DEJAVU_TESTER=0` keeps one run out of the
record. Checked in Chromium on Linux against a stand-in printer at 1366 and 390 px, and the online demo on a static server
(it records nothing). Recording cost on the Printer page with the 3D twin: press to next paint -1.1 %, the page's main-thread
time +3.7 %, median frame time equal, mean frame time +9 % from a few slow frames in software rendering (`docs/testing.md`).
Not yet tried on a real U1, on Windows or on macOS.

**17 November 2026, Tester mode.** Settings has a new Tester mode part. Switched on (or started with `DEJAVU_TESTER=1`),
Deja Vu1 keeps a record on your computer of how it behaved while you used it: every error, every button that was slow to
show a change, every request that failed or took over two seconds, printer connects and drops, refused commands and how
each print ended, Confirm Print checks, slices and conversions, how smoothly the 3D twin and the G-code preview drew, and
which features you tried. A **Something felt off** button on every screen saves a note with the screen and your last ten
actions. **View report** shows everything before you send it, and **Save tester report** writes one zip (a report page that
opens with no internet, the same data as JSON, the raw events and a README) that stays under 25 MB. Addresses, keys, Wi-Fi
names, serial numbers, folders with a user name, and file, printer and spool names are replaced before anything is
written, in the browser and again on the server. Nothing is sent anywhere. `tools/tester-reports.py` combines several
reports into totals, and `docs/beta-testing.md` is rewritten for the double-click install and this flow. Checked in Chromium
on Linux against a stand-in printer, with the switch off (the browser sends nothing, every route answers 403) and on;
recording cost on the Printer page with the 3D twin, measured over 24 alternating pairs: press to next paint +2.5 %,
page main-thread time +2.1 %, frame time within the noise (`docs/testing.md`). Not yet tried on a real U1, on Windows or
on macOS.

## 0.20.42 (25 November 2026): Replay an ended print on the 3D twin

- Replay an ended print on the 3D twin

## 0.20.41 (25 November 2026): Deja Vu1 remembers the files you printed: their history where you open them,...

- Deja Vu1 remembers the files you printed: their history where you open them, Print it like the time it worked, and facts from your own prints

## 0.20.40 (25 November 2026): One path from a model to a print and back, every print on record, a camera wi...

- One path from a model to a print and back, every print on record, a camera window you control, and Deja Vu1 runs only while you use it

## 0.20.39 (23 November 2026): Deja Vu1 on a real U1: a halted print it still holds, a bed-clear tick, and S...

- Deja Vu1 on a real U1: a halted print it still holds, a bed-clear tick, and Spanish with a language step

## 0.20.38 (22 November 2026): A language list in Settings and the machinery to translate Deja Vu1

- A language list in Settings and the machinery to translate Deja Vu1

## 0.20.37 (22 November 2026): 3MF projects slice: stray points, projects from other slicers and the engine'...

- 3MF projects slice: stray points, projects from other slicers and the engine's version check

## 0.20.36 (22 November 2026): Credits say where the Slicer's mouse and key behaviour was read from

- Credits say where the Slicer's mouse and key behaviour was read from

## 0.20.35 (22 November 2026): The Slicer: models slice on the real engine, Orca's camera and keys, a filame...

- The Slicer: models slice on the real engine, Orca's camera and keys, a filament picker per head, saved settings

## 0.20.34 (22 November 2026): The Slicer: Snapmaker Orca's layout on the U1's own plate, with the engine in...

- The Slicer: Snapmaker Orca's layout on the U1's own plate, with the engine installed for you

## 0.20.33 (21 November 2026): Error codes: the printer's code, in Snapmaker's words, with their guides and...

- Error codes: the printer's code, in Snapmaker's words, with their guides and videos

## 0.20.32 (21 November 2026): Dark mode readings you can read, Farm jobs labelled, and tidier panels and to...

- Dark mode readings you can read, Farm jobs labelled, and tidier panels and toggles

## 0.20.31 (21 November 2026): Cards that stack have their gap back, printer cards have their padding back,...

- Cards that stack have their gap back, printer cards have their padding back, and the text audit finds both

## 0.20.30 (21 November 2026): The Printer screen is one room, Overview shows the whole camera picture, and...

- The Printer screen is one room, Overview shows the whole camera picture, and every screen is glass with text that always fits

## 0.20.29 (21 November 2026): Ready to print lists what would help as +30 and +5

- Ready to print lists what would help as +30 and +5

## 0.20.28 (21 November 2026): The printer in the middle of the Printer screen, a calmer Overview, a sidebar...

- The printer in the middle of the Printer screen, a calmer Overview, a sidebar that opens on hover, and a time left that follows your file

## 0.20.27 (20 November 2026): A calmer Printer screen you click into, Maintenance as a list you can filter,...

- A calmer Printer screen you click into, Maintenance as a list you can filter, and Files takes a dropped file anywhere

## 0.20.26 (20 November 2026): A new frame: one connected surface, a sidebar of eight places, and a strip al...

- A new frame: one connected surface, a sidebar of eight places, and a strip along the bottom with Halt

## 0.20.25 (20 November 2026): Start over in the assistant stays started over, and a failed slice always say...

- Start over in the assistant stays started over, and a failed slice always says where it stopped

## 0.20.24 (20 November 2026): The tester report is checked against a replay of the first testers' run, and...

- The tester report is checked against a replay of the first testers' run, and the Tester card and questions pass an accessibility scan

## 0.20.23 (19 November 2026): Tester mode records from the first start, asks the same 22 questions any time...

- Tester mode records from the first start, asks the same 22 questions any time, and its report opens with what to fix first

## 0.20.22 (19 November 2026): The remaining large files are split into smaller parts; nothing changes on sc...

- The remaining large files are split into smaller parts; nothing changes on screen

## 0.20.21 (18 November 2026): The dashboard's largest files are split into smaller parts; nothing changes o...

- The dashboard's largest files are split into smaller parts; nothing changes on screen

## 0.20.20 (18 November 2026): Session notes: the core skill as the source of truth, and screens moving to o...

- Session notes: the core skill as the source of truth, and screens moving to one surface (#107)

## 0.20.19 (18 November 2026): Every screen has one slim top bar with its own tabs and buttons

- Every screen has one slim top bar with its own tabs and buttons

## 0.20.18 (18 November 2026): The 3D twin's bed and head stay where they really are while the printer homes

- The 3D twin's bed and head stay where they really are while the printer homes

## 0.20.17 (18 November 2026): Keep Tester mode on from the first start, ask the test questions in the app a...

- Keep Tester mode on from the first start, ask the test questions in the app and rank what to fix

## 0.20.16 (18 November 2026): Connect a printer with Continue in setup, set up from a phone, see start-up p...

- Connect a printer with Continue in setup, set up from a phone, see start-up problems at once, and keep files with non-English names

## 0.20.15 (16 November 2026): Calibrate a colour sensor from a white reference, see it in Confirm Print, an...

- Calibrate a colour sensor from a white reference, see it in Confirm Print, and check every screen in a real browser

## 0.20.14 (16 November 2026): Follow the Extended Firmware links to its current home (#100)

- Follow the Extended Firmware links to its current home (#100)

## 0.20.13 (16 November 2026): Read each release's full notes under its own version in the changelog (#99)

- Read each release's full notes under its own version in the changelog (#99)

## 0.20.12 (16 November 2026): Open the online demo on the dashboard, see the camera as soon as demo data st...

- Open the online demo on the dashboard, see the camera as soon as demo data starts, and keep printer file rows inside a phone screen (#98)

## 0.20.11 (13 November 2026): See how each part of Deja Vu1 is tested, including the AI assistant on a real...

- See how each part of Deja Vu1 is tested, including the AI assistant on a real U1 (#97)

## 0.20.10 (12 November 2026): Sign in to your Claude or ChatGPT plan from the app, set up print watch, reop...

- Sign in to your Claude or ChatGPT plan from the app, set up print watch, reopen saved chats, and slice with the stock U1 settings in one press (#96)

- Sign in to your ChatGPT plan from inside Deja Vu1 with OpenAI's Sign in with ChatGPT for open-source
  apps: press Continue with ChatGPT, approve it in the browser, and requests count against your plan through
  OpenAI's Responses API. Nothing to install, no key. The sign-in is kept by the computer's keyring,
  refreshed before it runs out and revoked at OpenAI when you sign out. From another device, paste the
  address the browser ended on. Codex stays available for people who already use it. Tested against a
  stand-in for OpenAI's sign-in and API.
- Claude plan: Sign in with Claude runs Claude Code's own sign-in from the app and passes on the code the
  page shows, so no terminal is needed. When Claude Code says nobody is signed in, "I'm already signed in"
  checks with one tiny request, because that status can be wrong while requests still work.
- The AI screen leads with what your AI does: print watch first, then print doctor (a photo of a failed
  print gives the cause and the fix, and goes in the logbook), a spool from a photo, rules in your own
  words, making a part, better print settings and catch me up. Your AI, how much it may do, cost and
  privacy are small cards below. Keys are explained once, where they are offered.
- Print watch can be set up: how often (2 to 60 minutes), an extra look at the first layers, what to look
  for (spaghetti, knocked loose, nozzle blob, layer shift, warping, stringing), how readily it worries,
  your own notes, a comparison with the last picture (a print that stopped growing), a second look before
  it pauses, and an alert. Check now looks at once, and the card shows the picture it studied.
- Conversations are saved on this computer: the clock button lists them, newest first, and opens one
  where you left off. Your message shows the moment you send it.
- The chat is simpler: one chip in the header for the AI and its model, a photo button, and suggestions
  only on the first few opens. Results come back as cards: temperatures as gauges, a sliced file with
  Print it, a new model with its picture and Open it, spools as swatches, care tasks and queue lists.
- Ask to go somewhere and the assistant opens the right card and lights it: the digital twin, the
  camera, the console, time-lapses, the logbook and 30 more places. It no longer opens every answer with
  the printer's state, and when it can't do something it says what it can do instead.
- The assistant can add, switch and delete automations, change print watch, read the printers, list and
  keep time-lapses, delete a file (it asks first), switch light and dark, and start a tour.
- Automations: "Have my AI look through the camera" as an action, two ready-made AI rules, and Describe a
  rule, which turns a sentence into a rule. These appear only while an AI is connected.
- Disconnecting the last AI removes every AI touch: the shortcuts, the glow and the features. The Ask
  button stays as a small round button.
- Slicing setup: Use the stock U1 settings makes a profile from Snapmaker's own presets for your nozzles
  in one press (the printer preset, its Standard process near 0.2 mm and each head's stock material), then
  Check it all works slices the sample 3DBenchy. Find installed U1 profiles now lists the stock materials
  for the 0.4 mm nozzle ("Generic PLA", "Generic PETG"), which were left out because their names don't
  say U1.
- Time-lapses: the printer's own recorded videos are listed under the flipbooks, to play or keep a copy on
  this computer, and any flipbook saves as a video file made in the browser.
- Add a spool from a photo: with an AI connected it reads the label and adds the spool; without one, the
  colour is measured from the photo and the form fills in.
- Clearer names in the sidebar: Files, Slice, Queue, Filament and Maintenance. Old links still work.
- Keyboard: G then a letter goes to a place (G F for Files, G S for Slice), Alt+1 to 9 for the first
  nine, and ? lists every shortcut. After a few visits the "Show me this screen" buttons and intro lines
  step aside; Preferences, Beginner tips brings them back.

## 0.20.9 (12 November 2026): Draw a part as an outline or profile, make gears, slice from the chat, and le...

- Draw a part as an outline or profile, make gears, slice from the chat, and let your AI watch a print through the camera (#95)

- Draw a part and ask for it: the assistant pushes any outline up into a solid (with holes and
  rounded corners), spins a profile into a round part such as a cup or a knob, makes spur gears from
  their teeth and tooth size, and rounds the corners of boxes. It can trace an outline from a photo
  of a sketch. These shapes are exact, closed solids and can be cut like any other part.
- Ask the assistant to slice a model with one of your saved profiles: it reports the slicer's own
  time and filament figures and opens Confirm Print for the result.
- Print watch: switch it on from the AI screen and your AI looks at the camera every 5 to 60 minutes
  while a real printer prints, warns you on screen when something looks wrong, and pauses only if
  you allow it. Tested with stand-in cameras and AIs in the suite.

## 0.20.8 (11 November 2026): Ask an AI assistant to explain, plan and work the printer, using your own AI...

- Ask an AI assistant to explain, plan and work the printer, using your own AI (#92)

- Ask the assistant for a part with holes, slots or pockets: it builds a model from parts that are
  added, cut away or kept where they overlap, can use a model from your library as one of the parts,
  and drills round holes straight into a library model. A wedge and a torus join the simple shapes.
  The cuts are made on a 0.4 mm grid (coarser for a large part, and the answer gives the size); flat
  faces stay exact and edges round off by about one grid step. Checked: closed surfaces and volumes
  within 0.2% of the exact figure in the suite, and a plate with four holes and a pocket made through
  a full conversation in the browser.
- See what a message costs before you send it. The assistant shows about how many tokens the next
  answer reads and its price, from the service's list price or a price you type on the AI screen
  (Cost and limit), and starts from the service's own count once it has answered. Set a limit per
  request: a message over it isn't sent, and a request with several rounds stops before passing it.
  Plans and local models show no charge per message.
- Write to the assistant in any language and it answers in that language, keeping screen names,
  settings, file names and G-code as they are. Checked through a Claude plan with a question in
  Spanish.
- `tools/translate.py` translates the app's strings or a guide through the AI you connected, with
  code, placeholders and links protected, kept names checked and screen names translated once and
  reused. Checked through a Claude plan with five strings into Simplified Chinese.
- GitHub Models is off the list of key services: GitHub retired it on 30 July 2026. A saved
  connection to it is dropped and another connection takes over. 29 key services remain.
- The assistant's tests pass on machines without Claude Code installed (they failed on GitHub's
  test machines after the last release).

- An AI assistant, using your own AI: a Claude plan through Claude Code, a ChatGPT plan through Codex,
  an API key from any of 30 services, or a model on your computer (Ollama, LM Studio or another
  address). It reads the printer, files, queue, care list, spools, history and camera, homes, moves,
  cools and adjusts by itself, and waits for Approve before it heats, pushes filament, runs a macro
  or cancels a print. It makes simple shapes and scaled, turned or mirrored copies of models. Heater
  limits, the printer's size, homing, a 2 mm gap above the bed and read-only typed G-code hold in
  every setting, and it cannot start a print: it opens Confirm Print. Keys stay on your computer and
  out of backups. Verified with a real Claude plan on a demo printer; the 30 service addresses
  answered without a key. The assistant has since run on a real U1 and through a paid API key
  (13 November, `docs/testing.md`).

## 0.20.7 (11 November 2026): Receive colour-checker readings with their sensor identity and age

- Receive colour-checker readings with their sensor identity and age

- Colour-checker companions can send identified raw and calibrated observations through a versioned
  API. Each channel is assigned to one head on one printer; old, repeated, wrong-sensor and low-quality
  readings cannot appear as a current colour. The colour card shows each sensor's status and reading
  details. Assignments survive restart; readings do not. Pico firmware, guided calibration and optical
  advice in Confirm Print remain to build. Verified with synthetic messages and a Moonraker stand-in,
  not a physical colour sensor.

## 0.20.6 (9 November 2026): The 3D twin shows filament moving in its tubes, spools turning, belts running...

- The 3D twin shows filament moving in its tubes, spools turning, belts running, the chamber light and heads docking, and the online demo accepts Feed and the lights

## 0.20.5 (9 November 2026): The 3D twin draws prints from their own layers and shows where the head reall...

- The 3D twin draws prints from their own layers and shows where the head really is, the online demo's fleet bar works, and cards fill their screens without gaps

## 0.20.4 (8 November 2026): A shorter README with fresh pictures, and a dated record of what was tested o...

- A shorter README with fresh pictures, and a dated record of what was tested on a real U1

## 0.20.3 (6 November 2026): Updates install while a print runs, connections recover faster, and Settings...

- Updates install while a print runs, connections recover faster, and Settings lists only the optional extras
- Glass is the default look again, the sidebar shows what is happening, Check slicer reads Windows builds of Snapmaker Orca, and the plate has keyboard commands

**7 November 2026, the Glass look, a sidebar that shows what is happening, and Check slicer on Windows.**
Glass (frosted panels and the moving background) is the look a new copy opens in; a look you chose yourself
stays as you chose it, and Preferences → Appearance → Look still offers Workbench and Control room. The
sidebar now shows the live state of the printer you are looking at (a coloured dot, its name and a progress
line while it prints), a count on Overview of the printers that need you and on Care of the printers with
upkeep due, and, from two printers on, a small menu beside Printer to choose which one the Printer page shows.
Arrow keys, Home and End move through the items, `[` hides or shows the labels, "Tools & learn" folds, and with
icons only a label appears beside the item you point at or focus. Preferences → Appearance has a new Spacing
choice, Comfortable (as before) or Compact (less room around cards and sidebar items, same text size; the
Overview page is about 5 % shorter). In the plate editor, click the model view and use Shift + arrow keys to move the selected object (Alt for 0.1 mm, Ctrl or Cmd for 10 mm), Shift + Page Up/Down to lift it, R to turn it, comma and full stop to pick another object, L, D and F to lay flat, drop and fit, Delete to remove, and Ctrl or Cmd with Z, Y, D and S to undo, redo, duplicate and save; typing in a field never triggers them, and the arrow keys alone still turn the camera. Check slicer now works with the Windows builds of Snapmaker Orca and
OrcaSlicer: read from Snapmaker's source, `--help` on Windows prints to a console window of its own, so a
program that reads the engine's output (Deja Vu1) got only start-up log lines and the check said "didn't answer
like OrcaSlicer's command line". When `--help` prints nothing readable and the engine exits cleanly, Deja Vu1
now asks it to write its settings file (`--export-settings`), accepts it only if the file has Orca's shape (a
version, `layer_height`, `nozzle_diameter`) and reads the version from it, with the line "this build prints its
help to a console window" in the result. Engine runs on Windows also no longer open a console window, and Snapmaker's U1 presets are also read from the slicer's own data folder (`system/Snapmaker`, which Snapmaker's source says holds a copy) when the program folder has none. The last 20 slices and their reports are now kept across a restart (`slice-receipts.json` in the data folder); a slice that was waiting or running when Deja Vu1 stopped comes back as failed with the cause "interrupted" instead of vanishing. Checked:
the new check against a stand-in engine that behaves as the Windows report showed (4 new tests), the restart receipts (6 new tests), the preset-folder fallback (3 new tests), the plate keyboard commands (5 source tests, and in Chromium on the library's sample model), and the
sidebar in Chromium in all three looks, light and dark, at 1366 px, 1000 px and 390 px (18 combinations: no page errors, no sideways scroll, every item named, hidden on the phone), with Spacing measured at 1366 px. Not checked:
the engine check on a real Windows computer (no Windows build could be run here) and a slice after it.

**6 November 2026, updates, connections and Settings.** An update no longer waits for a print, a paused
print or a printer that isn't answering: the printer holds the file it prints and runs it by itself, so Deja Vu1
restarting never touches a print. From the moment an install is ready to restart, Deja Vu1 sends no printer
anything new (moves, heating, uploads, G-code and the camera's stop message are held back, the emergency stop
still goes through) and lets a command already on its way finish. A running slice gets up to 90 seconds to
finish, then is stopped cleanly. A print that finishes or is cancelled during the restart is still noticed, an
unfinished time-lapse carries on, and an automation rule that was already true does not fire again. The update
check no longer holds the lock that the launcher's "is it alive?" question needs, so a slow GitHub answer can't
make a healthy dashboard look stopped or a fresh update look dead; the first check waits 45 seconds after a
start; the launcher, the page and the offline page ask a new light route, `/api/app/alive`; a left-over staging
folder no longer blocks the next update; a second launcher waits instead of applying the same update twice;
and Stop keeps Deja Vu1 stopped for at most four hours (found by reading the code: the old rule could outlive a
Windows "Shut down" with Fast Startup, so the 5-minute check never started it). A printer link that was open
when the computer slept reopens at once, the live page reconnects when a phone is unlocked or the network
returns, and a printer on another network is explained in words. Settings > Modules became **Optional extras**
with six rows (Slicing, the low-latency camera, Dock status rings, the WLED bridge, the Home Assistant bridge, the
colour check); the camera, time-lapses and Continue on another device switch in their own cards, the print cost
prices moved into the Print cost card, and every other part of Deja Vu1 is always on (a copy that had switched one
off gets it back once). Checked with unit tests, a stand-in printer and the real launcher on Linux (a real
download, restart and health check took 7 seconds); not tried on Windows or macOS.

## 0.20.2 (6 November 2026): Check slicer says which engine builds have been run, and a changed engine wai...

- Check slicer says which engine builds have been run, and a changed engine waits for a new check

## 0.20.1 (6 November 2026): Slicing says why it failed, and one report holds the details

- Slicing says why it failed, and one report holds the details

## 0.20.0 (6 November 2026): Workbench

- Preferences, Appearance, Look: Workbench (the new default: flat panels with thin borders, small corners, numbers that line up, colour only for status, nothing moving behind the page), Control room (denser, squarer and grey, with colour only when something needs you) or Glass (the frosted look with the moving background).
- Every look works with the Light, Dark and System themes.
- Emergency stop has a deep red fill with white words in every look, so it always stands out.
- In the dark theme, overdue and due-soon tasks show their red and yellow again, and twelve tinted labels are easier to read.
- The Copy buttons on the command boxes and the twin's printing tag are easier to read.

**Why a new default look.** Design writing from 2026 lists the same signs of interfaces
made with AI tools: frosted glass with glows, purple or blue gradients, the same default
typefaces, pill-shaped controls, sparkle icons, cards inside cards and decoration that moves
for no reason (for example [925 Studios](https://www.925studios.co/blog/ai-slop-design-tells)
and [Superdesign](https://superdesign.dev/blog/why-ai-design-looks-generic); these are blog
posts, not studies). Deja Vu1's Glass look had most of them. Guidance for operator screens
points the other way: neutral surfaces, colour kept for status, density where the readings
are, precise readouts over decoration (the ISA-101 approach described by
[Control.com](https://control.com/technical-articles/going-gray/) and the
[ISA blog](https://blog.isa.org/the-high-performance-hmi)). Workbench and Control room follow
that guidance in `frontend/looks.css`; nothing was copied from another product.

**How it was checked, and a correction to 0.19.0.** `theme-boot.js` sets `data-ui` before the
page is drawn. A Chromium pass measured every piece of text against the flat background
behind it on all 16 places at 1366 px, for each look in light and dark: none below WCAG AA in
Workbench or Control room, and in Glass only a disabled button (WCAG sets no contrast
requirement for disabled controls). The 0.19.0 check of the dark theme read some colours
wrongly (the `oklch()` and `color(srgb ...)` formats), so it reported no failures where twelve
tinted labels were still mixed with white; the check now converts every colour through the
browser, and those labels are fixed here. Grouped dark rules that carried an id had hidden the
overdue and due-soon tints; `tests/test_looks.py` now fails on an id inside a group. The
README's older screenshots still show the Glass look; the new picture of the three looks is
`docs/img/looks.jpg`. Not seen on a real phone, Windows or macOS.

## 0.19.0 (6 November 2026): Find your way

- A sidebar on the left lists every place: Overview, Printers, Printer, Library, Prepare, Jobs, Materials, Care, Settings and Preferences, with Automations, the farm desk, layer heights, Photo studio, the practice farm and games under Tools & learn. It folds to icons, and phones keep the bottom bar.
- Every page has its own link. Back and Forward move between pages, a refresh stays where you were, and a copied link opens the same page on another browser.
- The print queue has its own place, Jobs, and search uses the new names.
- Preferences, Appearance, Theme: Light, Dark, or System to follow your computer. The choice is applied before the page is drawn, so a reload never flashes the other theme.
- In the dark theme, filament swatches, camera pictures and the 3D print keep their real colours, and a black filament keeps a thin outline so you can see it.
- Confirm Print says when a file is no longer in your files, instead of showing a server error.

**How the sidebar is built.** Each sidebar place opens an existing screen and, where the
screen is in parts, one part of it (`frontend/rail.js`), so no card moved: remembered
screens, tours, search places and another device's handoff still resolve. Links are
`#/<place>` (for the Printer page `#/printer/<printer id>`); old screen names such as
`#/files` or `#/maintenance` open the matching place. Checked in Chromium at 1366, 1024
and 390 px: all 16 places, Back, Forward, a refresh, a copied link and an old link, with no
page errors (`tests/test_rail.py` keeps every place pointing at a real screen and part).

**How the dark theme was checked.** `frontend/theme-boot.js` runs in the page head, before
the page is drawn, and sets `data-theme` on the page; `frontend/dark.css` (loaded last)
holds the dark colours. A Chromium pass on all 16 places, at 1366 and 390 px, measured every
piece of text against the flat background behind it: the first dark version had 95 places
below WCAG AA (4.5:1, or 3:1 for large text), the released one has none. Text on gradients
and inside canvases was checked by eye in screenshots, not measured. The colour tokens and
each accent's dark text shade are measured in `tests/test_dark_theme.py` (4.5:1 or better
on every dark panel). Light stays the default. Not yet seen on a real phone or on Windows
or macOS.

## 0.18.0 (5 November 2026): Checks you can trust

- Watch-only mode (Settings): the server refuses every command to your real printers, so nothing moves, heats, prints or changes. You still see everything, the camera works, and emergency stop always goes through.
- The print health score is held below fair, and reads Can't start, whenever Confirm Print would refuse the start. A wrong material now costs points like a wrong colour.
- A spool with no known weight shows Weight unknown instead of 0 g. Weights say whether they were weighed or estimated, Spoolman imports keep unknown weights unknown, and every spool has a Weigh button.
- A finished print is charged to the roll its head had when the print started, even if another roll was picked during the print. Recent charges can be moved to another roll.
- After a print ends, the next queued print waits until you press Part removed, bed clear for that printer and that print. Confirm Print and Needs you remind you too.

**Watch-only mode, and where it is enforced.** The refusal happens where Deja Vu1 talks
to a printer (`backend/moonraker_client.py`): while the mode is on, its HTTP requests may
only read (GET, plus the status query and emergency stop Moonraker takes as POSTs) and its
WebSocket calls may only be the read methods it uses. So a screen, an automation rule or
the queue cannot send a command another way. Printer commands sent from the page are
refused first with the same words (409, `watch_only: true`). `DEJAVU_WATCH_ONLY=1` keeps it
on for one start. Tested against the stand-in Moonraker in `tests/fake_moonraker.py`:
pause, cancel, home, the console and a start were refused and no write reached it, while
emergency stop went through (`tests/test_real_printer.py` `TestWatchOnly`). Not yet run on
a physical U1.

**Three trust problems reproduced by research, now fixed.** A file needing PLA, with PETG
loaded in the same red, was refused by Confirm Print while the health dial read 100 / good
(`tests/test_print_gate.py`). A Spoolman spool with no starting weight was stored as 0 g, the
same as an empty roll; Spoolman's own `remaining_weight` is the starting weight minus the
used weight, or none when the starting weight is unknown (Spoolman `eccb05e`,
`spoolman/api/v1/models.py`, checked 5 November 2026). Spools an older import saved as 0 g
go back to Weight unknown on the next import, unless they were weighed here. A finished
print was charged to the roll assigned at the end, not the one loaded at the start; the
start-time map is now saved when a real printer starts a print and kept through a restart.
A print Deja Vu1 did not see start is not charged to an assigned roll.

**Bed clearance.** A print that finishes, fails or is cancelled leaves that printer's bed
waiting to be cleared. The confirmation is tied to the printer and to the print that ended
last there, and is saved in `print_queue.json`. Nothing in that printer's queue starts,
by hand or by itself, until it is given. Prints started outside the queue are not stopped;
Confirm Print warns instead.

## 0.17.0 (2 November 2026): Wherever the printer is

- Find printers now looks from every network connection this computer has. Look further also tries the address ranges a second router or mesh system often uses, and your Tailscale network, including home networks a device there shares.
- If a saved U1 stops answering, Deja Vu1 looks for its serial number at a new address and switches to it by itself, then tells you.
- Settings, Away from home explains how Snapmaker's app reaches a printer on another network (through Snapmaker's cloud) and the three ways Deja Vu1 does it without a cloud.
- A printer's readings keep reaching the page even when one of Deja Vu1's own checks fails, so the twin no longer freezes while the printer prints.
- If a printer's own updates stop mid-print while the connection stays open, Deja Vu1 reads it directly every 2 seconds, and the twin says so.
- A U1 is also recognised by the model name its software reports, so the twin always draws it.
- Print a file lists the files already on the printer. Copy to my files brings one over so Confirm Print checks it; the printer's own queue shows too.
- Bed mesh has a 3D view you can turn.
- With the community Extended Firmware, the printer's camera plays as WebRTC video. Elsewhere the picture stream works as before.
- A printer without a temperature history shows the chart from live readings instead of an error.

**How Snapmaker's app reaches a printer on another network, and what Deja Vu1 does.**
The owner asked how Snapmaker's phone app and Snapmaker Orca reach a U1 that isn't on
the same network. Snapmaker's quick start for Snapmaker Orca (wiki.snapmaker.com,
checked 2 November 2026) describes two binding modes: in Cloud mode "the printer and
computer are not required to be on the same local area network" and the ports include
MQTTS 8883; LAN mode needs the same network. Snapmaker's printer software matches: its
Moonraker talks to a local MQTT broker and a separate Snapmaker program carries the cloud
link and the link mode "cloud" or "lan" (u1-moonraker a308cfa,
`components/client_manager.py`, `lava/moonraker.conf`). So the printer connects out to
Snapmaker's servers and the app meets it there. Deja Vu1 has no cloud and Snapmaker's
cloud protocol is not published, so it does not use it. Instead, the side at home connects
out through Tailscale (Away from home), and finding a printer now covers every network
the computer is on, the ranges home routers often use, and the Tailscale network:
online devices and the home networks they share (`tailscale status --json`, fields
checked in Tailscale 57ca6e1 `ipn/ipnstate/ipnstate.go`; `tailscale set
--advertise-routes` and `--accept-routes` in `cmd/tailscale/cli/set.go`). An earlier
version found the owner's U1 on what looked like another network most likely because the
two networks were one home network under two Wi-Fi names, where the printer's mDNS
announcement still reaches the computer; this is not verified.

**The twin that didn't move.** The owner's U1, joined mid-print, showed a twin that
didn't move. A stand-in U1 replaying a real G-code file mid-print through the real
connection code followed correctly ("In step with the printer, within 0.1 mm" in
Chromium), so the cause is something a physical U1 does differently, not yet seen. Three
ways a real printer could freeze the page are closed: the live feed published a reading
only after its own checks ran, so one failing check stopped all updates for that printer
(the reading now goes out first, `tests/test_live_feed_robust.py`); a status stream that
goes quiet mid-print while the socket stays open is now noticed after 5 s and the printer
is read directly (`tests/test_printer_extras.py` TestQuietStream); and a U1 is also
recognised by `product_info.machine_type`. The next report from the owner's computer will
show which, if any, it was: failing checks are written to the logs once a minute.

**WebRTC camera.** The Extended Firmware lists its camera in Moonraker as
`webrtc-camerastreamer` at `/webcam/webrtc` (SnapmakerU1-Extended-Firmware 36fbd40). Its
signalling was read from the camera program it builds (paxx12/v4l2-mpp 87bda8e,
`apps/stream-http`; GPL-3, protocol only, no code copied). Tested against the stand-in's
signalling; video from a real camera has not been tried.

**Checked here:** the new code against the simulated printer and the Moonraker stand-in
(`tests/test_refind.py`, `tests/test_webrtc_relay.py`, `tests/test_printer_extras.py`,
`tests/test_live_feed_robust.py`), the pages in Chromium at 1366 px and 390 px. **Not yet
tried:** a physical U1, a real Tailscale subnet route, a real second router, and WebRTC
video from a real Extended Firmware camera.

## 0.16.0 (2 November 2026): Everything your printer offers

- Temperatures has a chart of every heater and sensor over the last 5, 10 or 20 minutes, from the printer's own record when it keeps one.
- Bed mesh shows how flat your bed measured as a coloured map, with the spread from lowest to highest point. Probe again, load a mesh the printer saved, or stop using it.
- Macros that take settings, such as a temperature, are marked with … and open a small form with the macro's own defaults.
- Fans, lights and sensors: set the printer's other fans and its lights, switch each filament sensor on or off, see whether filament is in, and check the endstops.
- On a U1, Feed runs the printer's own automatic feeding for a head. The printer picks the right feeder and channel itself.
- The G-code console suggests every command the printer knows, with the printer's own description.
- Print a file on the Printer page: add a G-code file, preview it and start it through Confirm Print without leaving the page.
- A printer waiting for work looks ready: Pause and Cancel appear only during a print; otherwise you see Print a file and Warm up. Heaters at rest say not heating instead of showing an empty bar.
- Your printers: calm cards without coloured tints, the readings in one row, a quiet Open printer button, group commands that appear once you tick a printer, and Add a printer folded to one button.
- The twin's bed no longer flickers while the model turns, and it looks like the real U1 plate: bronze-brown, with its markings.
- Settings, Modules: switches move at once and the list stays put. Modules are grouped and can be searched.

**Where the new readings come from.** Every reading is the printer's own answer,
read from Moonraker's endpoints: `server/temperature_store` (one reading a second,
20 minutes), `printer/objects/query` for the bed mesh, the macros' own text and the
feeder variable, `printer/query_endstops/status` and `printer/gcode/help`
(`backend/printer_extras.py`). Every new button is checked in `printer_control.py`
before any G-code: fan speeds `SET_FAN_SPEED` only for the printer's `fan_generic`
fans, lights `SET_LED`, sensors `SET_FILAMENT_SENSOR`, saved meshes
`BED_MESH_PROFILE LOAD=` or `BED_MESH_CLEAR` (not during a print), macro settings
only those the macro's text reads and only as one word each, so a value can't add a
second command. The fan, light, sensor and feeding names follow Snapmaker's
published U1 configuration (u1-klipper `lava/printer.cfg`: `cavity_fan`,
`cavity_led`, `e0_filament` to `e3_filament`, the `AUTO_FEEDING` macro and its
`_FILAMENT_FEED_VARIABLE` table). Deja Vu1 never names a feeder module or channel
itself; it shows the ones the printer reports and runs the printer's own macro. The
printer's output pins are shown and never switched: on the U1 they are the heads'
heater switches.

**The twin's bed.** Measured frame by frame while turning the model 2 px at a time
(software rendering): the jagged flicker seen through the door came from the case's
inside floor and the hidden frame's base plate, both topped at 40 mm, drawn at the
same height. The base plate now stops 1.5 mm lower. In the door area the
back-and-forth change between frames fell from 15.5 to 3.9; what is left is the
ordinary shimmer of moving edges. The plate's colour and markings follow Snapmaker's
shop photo of the U1 textured PEI plate (checked 2 November 2026).

**Checked here:** the new readings and commands against the simulated printer and the
Moonraker stand-in (`tests/test_printer_extras.py`), the Printer page, Your printers
and Modules in Chromium at 1366 px and 390 px. **Not yet tried:** any of this on a
physical U1, and whether the shipped U1 firmware's configuration still matches
Snapmaker's published one.

## 0.15.0 (2 November 2026): Always there

- Started without a window, Deja Vu1 0.14.0 lost the answer to every button you pressed, so buttons said the dashboard server might not be running. Every button gets its answer again, and what Deja Vu1 writes goes to files in its logs folder.
- Every way of starting Deja Vu1 (the double-click files and the paste blocks) runs it without a window, so closing a window never stops it.
- On Windows, Deja Vu1 now starts by itself when you sign in and after the computer wakes, and Windows checks every 5 minutes that it is running. Stop in Settings keeps it stopped until you start it again or restart the computer.
- If Deja Vu1 keeps running but stops answering, it is restarted after about 2 minutes. If it stops, it starts again within seconds.
- The page you see when Deja Vu1 isn't answering waits and reconnects by itself first, then offers a Start Deja Vu1 button. The paste-in commands are the last thing on it.
- A printer's own camera shows as a live picture, up to 15 a second, on the Printer page and Overview. The camera starts faster, uses the picture address the printer gives and tries the printer's web port too.
- Deja Vu1 reaches the printer through either port it answers on, 7125 or the web port 80, and switches by itself when one doesn't answer.
- A button whose answer is lost says it isn't known whether the printer got the command, so you check before sending it again.
- Settings, Version & updates, Copy a report for help: version, how Deja Vu1 started, the checks, the printer link and recent notes, ready to paste. Keys and passwords are left out.

**What went wrong, and the evidence.** The owner reported (2 November 2026) that
after pasting the Start block the dashboard loaded, but moving or homing "didn't go
through", connecting kept asking whether the dashboard server was on, and a reload
showed the offline page. The 0.14.0 background start runs the server with
`pythonw.exe` and no console on Windows, so Python starts it with no output streams
(`sys.stderr` is `None`). The server wrote one line per command to `sys.stderr`
while sending the reply, so every command (POST) raised an error and the browser's
connection closed with no answer; pages and readings (GET) were not logged and kept
working. Reproduced on Linux by starting the server with its output streams closed:
`POST /api/printer/control/jog` got no reply (curl status 000), and the same request
answers normally after this change (`tests/test_no_window.py`). Also found: on Windows
the server's "reuse address" option lets a second copy take the same port at the same
time; it now holds the port exclusively. Not yet known: whether the owner's reload
landed on the offline page because the server had stopped (the new logs and Copy a
report for help will show it). Linux checks made here: a killed server was back in
2 seconds, a frozen one restarted after 2 minutes 22 seconds, Stop was respected by
the 5-minute check, `deja-vu1://start` started Deja Vu1 through the desktop's own link
handler, and the offline page in Chromium went back to the dashboard by itself.
Not tested on Windows or macOS: the Task Scheduler task, the Windows link
registration, the macOS link app and LaunchAgent restart, Quick Edit switching off.

## 0.14.0 (1 November 2026): Your printer, its own page

- Each printer has its own page (Printer, where Control was): the 3D twin with the camera and a Move pad beside it, temperatures with PLA, PETG and TPU warm-up buttons, extrude and retract, speed, flow, part fan and pressure advance, the printer's own macros and bed mesh, motors off, the G-code console and an emergency stop. Opening a printer goes there.
- Overview is a page of cards about now: Needs you, Right now, the camera, temperatures, quick control, your printers, maintenance and totals.
- The camera and time-lapses moved from Settings to the printer page, and the camera picture refreshes as fast as the printer makes pictures.
- The name you gave the printer on the printer itself is shown everywhere. Connected is green, a ready printer says Ready, and the printer button in the top bar shows its state, progress and finish time.
- Deja Vu1 keeps running after the PowerShell or Terminal window is closed, and the Start block also starts it at sign-in.
- The twin keeps the head inside the printer while it homes, no longer flickers while it turns, has a Turn slowly button, and lets you drag the real head with Move head.
- Slicing shows Layer heights per head under the slice bar and loads your tools by itself; the slicing cards no longer run into each other.
- A finished print sets off the background dots and a message, with no pop-up to close.
- Automations: rules for a percentage, minutes left, a layer, an error or a lost printer; actions to turn the heaters off or run a printer macro; ten examples to start from.
- Care: Not now snoozes a due task without hiding it; a recorded nozzle swap updates that head's nozzle for slicing.
- Preferences has its own tab: units, the screen to open on, the Move step, cameras, the finish celebration and your warm-up temperatures.
- Notifications and remote access explain how to set them up; Look on this computer is short and clear; phones get a tighter layout without the computer-only tools.
- One phone that pairs twice is listed once, and the version history reads as app news.

The new movement, extrude, tuning, macro, bed mesh and emergency stop commands were tested against the simulated printer and the Moonraker stand-in. Not yet tried: the background start on Windows and macOS (tested on Linux).

## 0.13.8 (1 November 2026): Give each printer its own page with full controls, and make Overview a page o...

- Give each printer its own page with full controls, and make Overview a page of cards

## 0.13.7 (31 October 2026): Make updates finish every time, and say plainly when Deja Vu1 is ready

- Make updates finish every time, and say plainly when Deja Vu1 is ready

## 0.13.6 (31 October 2026): Keep every part drawing with a real printer, and reload pages after any update

- Keep every part drawing with a real printer, and reload pages after any update

## 0.13.5 (31 October 2026): Keep the dashboard reachable: start with the computer, restart after a crash

- Keep the dashboard reachable: start with the computer, restart after a crash

## 0.13.4 (31 October 2026): Get ready for a real U1: connection, controls and the twin following the head

- Get ready for a real U1: connection, controls and the twin following the head

## 0.13.3 (31 October 2026): Make the 3D twin match the production U1 in Snapmaker's photos

- Make the 3D twin match the production U1 in Snapmaker's photos

## 0.13.2 (30 October 2026): Product page wording

- Updated wording on the product page.

## 0.13.1 (30 October 2026): Housekeeping

- Behind-the-scenes housekeeping. Nothing in the app changed.

## 0.13.0 (28 October 2026): in step with the print

- **The 3D twin follows the print's own G-code.** The preview of the running
  file (`backend/print_preview.py`) now carries a timeline: where the nozzle is
  after each move, which byte of the file that move ends at, and when it happens
  by the file's own feed rates. On a real printer Deja Vu1 now also reads
  Klipper's `motion_report.live_position` (where the nozzle is now; `toolhead`'s
  `position` is the last command and runs up to a second or two ahead) and
  `virtual_sdcard.file_position` (the byte read up to), both named in Klipper's
  `docs/Status_Reference.md`. Each reading looks for the nozzle along the path
  just before that byte, which fixes the moment in the file; between readings
  the nozzle runs along the G-code at the pace the printer has been keeping, and
  each reading pulls it back into step over a third of a second. The walls
  appear where and when they are laid (each bit of wall carries the time it is
  printed), the plastic just laid glows for three seconds, and a move the file
  doesn't hold (a tool change, a purge, a park) shows the live position instead.
  A line under the twin says whether it is in step. Tested in Node against the
  two-Benchy sample with a printer simulated from the same file: one reading
  finds the moment exactly, and with readings four times a second and the
  printer at 0.8 times the file's speeds the playhead stayed within 0.016 s.
  The simulated printer, which reports no live position, is followed from its
  progress. A U1 that prints a file's T1 on another head (`extruder_map`) now
  colours the walls by the head that prints them.
- **Colours from any slicer, on four heads.** `backend/colour_map.py` reads which
  filaments a project actually uses (each object's and part's filament, per-feature
  settings, height ranges and the colour painted on each triangle) and suggests a
  head for each: unused ones are dropped, four or fewer keep a head each, and more
  than four are grouped by how alike they look (OKLab), never putting two
  materials on one head while another grouping exists. With a printer connected,
  **Match the printer's heads** sends each colour to the closest loaded head. A
  new panel in Files, **Colours on the U1's heads**, shows the four heads and a
  row per filament to change; **Save a copy with these heads** writes a project
  that uses at most four (`GET /api/colours/plan`, `POST /api/colours/apply`).
  The painted-triangle format, the per-feature setting names and how Orca opens
  PrusaSlicer files were read from OrcaSlicer's source (commit `97e6c71`). The
  converter applies the plan by itself to a project with more than four filaments,
  so a five-colour MakerWorld project converts instead of only warning, and the
  slicing workspace points to the panel instead of refusing with "more material
  slots". A new sample, `sample_makerworld_five_colours.3mf`, is a Benchy painted
  in five colours with a sixth, unused slot. Opening a saved copy in Snapmaker
  Orca has not been tried.
- **More slicers.** The converter now takes projects from Creality Print, QIDI
  Studio, Flashforge's Orca and other OrcaSlicer forks (recognised by their
  project settings) and from PrusaSlicer, whose own layout Orca opens with its
  paint and per-object extruders (its colours are listed for you to load).
  **Pick up where you left off** also finds recent projects from Bambu Studio,
  Creality Print, Elegoo Slicer, QIDI Studio, Flashforge Orca and PrusaSlicer
  (folder names from each project's `version.inc`; PrusaSlicer's
  `PrusaSlicer.ini`), and a profile made from your Orca presets can now set a
  filament for each of the four heads. Cura's `;TYPE:WALL-OUTER` and
  `;TYPE:SKIN` (read in CuraEngine's `gcodeExport.cpp`) are drawn in the twin.
- **Slicing, clearer.** In the slicing workspace, converting a project made for
  another printer and fitting its colours now sit under the slice bar instead of
  inside the folded "Source & import information".
- **Notifications.** A repeated message counts up (×2, ×3) instead of stacking, a
  long message stays longer (about a quarter of a second a word, nine seconds for a
  problem), a hairline shows the time left and stops while you point at it, a
  message that arrives while the tab is hidden waits for you, a bubble can be
  flicked away on a touch screen, and the list survives a reload in the same tab.
  "Open the same here?" moves into the orb after nine seconds, button and all.
- **Faster, tidier.** Large JSON replies (a print's preview, the file list) are
  sent compressed when the browser accepts it: the two-Benchy preview drops from
  842 KB to 271 KB. File names wrap after `_`, `-` and `.` instead of mid-word,
  and search fits its placeholder.

**27 October 2026, internal folders moved.** `marketing-library/`, `promo-video/`
and `build-prompts/` moved to the owner's private repository. Removing them from
this repository's history is still to do. When it happens, every commit ID
changes, the six release tags move to the matching new commits with every file
outside those folders unchanged, and the release downloads stay as they are.
Copies installed with git or GitHub Desktop before then will need a one-time
step: see [getting started](docs/getting-started.md#installed-with-git-or-github-desktop-before-the-history-rewrite).
The same change brought the colour checker design in
[`docs/hardware-modules.md`](docs/hardware-modules.md) up to date.

**27 October 2026, launch film version 18.** The product page and the README now
show a 75-second film (version 18) in place of the 60-second version 17. It tells
the same story with no new information, at a calmer pace: the music slower, each
caption on screen longer, fewer things moving at once, and the scenes filmed again
from the 0.12.0 app with slower cursor moves. It shows 920 automated tests (a full
run passed on 27 October 2026).

## 0.12.0 (27 October 2026): one thing at a time

- **One part of a screen at a time.** Overview (Right now, Live readings,
  History & upkeep), Printers (Your printers, Farm desk, Practice farm), Files
  (Your files, Slicing, Layer heights), Care (Upkeep, Filament & colour) and
  Settings (This copy, Look & feel, Features, Phone & away, Alerts & smart home,
  Camera) open on their first part, with **Everything** for the full page. Measured
  at 1366 px: Settings went from 8,803 to 4,643 pixels tall, Printers from 4,233 to
  1,544, Files from 3,047 to 1,410. Cards are sorted by id or title (`app.js`
  `SECTIONS`), so cards drawn later find their part and a card no rule names joins
  the first one. Search, tours and links open the part that holds their target.
- **Get ready to slice.** Files → Slicing starts with five steps: turn on, find the
  slicer, check it answers, pick presets, add a model. **Find it for me**
  (`POST /api/slicer/find`) lists Snapmaker Orca and OrcaSlicer programs in the
  usual install folders, one level deep, skipping installers, archives and project
  files; nothing runs until **Use this**, which saves the path and checks it. With
  nothing found it links both slicers' GitHub release pages. Walked through in
  Chromium with a stand-in program; no real Windows or macOS install searched yet.
- **Other Klipper printers** (`backend/machines.py`). A printer without Snapmaker's
  `print_task_config` is described from its own report: volume from the toolhead's
  `axis_minimum` / `axis_maximum`, heads from its extruders, kinematics and nozzle
  from `configfile` settings (Klipper `ee2c6fb`). The pre-flight and Confirm Print
  check files against that printer; an unreported size turns the bounds check off
  with a warning. Its card says "untested type"; the twin card shows its facts
  instead of a U1. Tested against the Moonraker stand-in playing a one-head
  235 × 235 × 250 mm printer; no physical non-U1 printer.
- **Search fixed.** `finder.js` compared titles that explain.js had given an ⓘ
  button, so 55 of 58 "Go to" places opened nothing. Titles are compared without
  it; `tests/test_finder.py` checks every place names a real card.
- **Wording.** "Auto-print" reads "Slicing" wherever a person sees it (the module
  id stays `auto_print`). The greyed-out Slice button on a plate says why and links
  the set-up.
- **Smaller downloads.** The unused version 1 and 16 web films left
  `frontend/media/` (masters stay in `marketing-library/07-videos/`): the update
  package is 56 MB instead of 74 MB.
- **Not verified:** a non-U1 printer, the slicer search on Windows
  or macOS, real phones. With software graphics, the 3D twin in view costs about
  460 ms a frame on both 0.11.1 and this version; real GPUs unmeasured here.

## 0.11.1 (27 October 2026): Tidier code and clearer wording

- Tidier code and clearer wording across the app.
- The quick tour, sheets and 3D twin run more smoothly.

## 0.11.0 (26 October 2026): your phone, from anywhere

- **Away from home.** Settings → Away from home now does the setup. It finds
  Tailscale on this computer (`tailscale status --json`), and **Turn on Away from
  home** runs Tailscale's own `tailscale serve --bg --yes http://127.0.0.1:<port>`,
  which shares the dashboard privately with your own Tailscale devices at an
  `https://<computer>.<tailnet>.ts.net` address. Funnel (public sharing) is never
  used. If the tailnet hasn't switched HTTPS on, the link Tailscale prints becomes
  a button and the card checks again every few seconds until it is done. Then it
  shows the address and a code to scan, with the one-time pairing code in it.
  **Stop sharing** runs `tailscale serve --https=443 off`. Formats were read from
  Tailscale's source (`ipn/ipnstate`, `ipn/serve.go`, `cmd/tailscale/cli`).
- **Only this computer can switch it.** `POST /api/remote/share` and `/stop`
  answer 403 unless the request is from this computer at `localhost`. Tailscale
  Serve passes on the phone's own Host header (`ipn/ipnlocal/serve.go`), so a
  phone through the share is never taken for this computer and the device lock
  still applies.
- **Installable away from home.** The shared address is https, so Chrome on the
  phone installs Deja Vu1 without the home-network setting.
- **The printer itself.** The remote guide covers the Extended Firmware's
  experimental Tailscale option, which lets a computer elsewhere add the printer
  by its Tailscale address.
- **A glass orb.** The notification orb loses its centre dot. The whole
  translucent sphere carries the colour (blue at rest, green, amber or red for a
  message) and glides between them; unread messages make it glow softly.
- Verified: unit tests against a stand-in `tailscale` program in Tailscale's
  formats (not connected, connected, HTTPS approval, sharing, stopping, its own
  refusal) and through the real server (a phone's or a tailnet request is refused
  with 403); Chromium at 1366 px and 412 px. Not verified: a real Tailscale
  account, phone or printer.

## 0.10.0 (26 October 2026): connections you can count on

- **Printer connections checked against the printers' own code.** Every
  connection path was read against Snapmaker's `u1-moonraker` (`a308cfa`, still
  the newest), Snapmaker's `u1-klipper` (now `93cb12f`, firmware 2.0.0) and the
  community Extended Firmware (`417e639`, with its camera service `v4l2-mpp`
  `9279584`). These are GPL-3 projects and Deja Vu1 is MIT, so no code was
  copied: the addresses, login rules, camera paths and message formats were
  matched to what their code does.
- **Printers with a login.** The Extended Firmware's "Web Authentication"
  switches off Moonraker's trusted-network rule and creates an `admin` user
  with a random password. **Add a printer** and setup now offer a sign-in when
  a printer asks for one: `POST /access/login`, then `GET /access/api_key` with
  that token (both from Moonraker's `authorization.py`). Only the key is saved;
  the password is used for those two requests and never stored or logged
  (`POST /api/printers/login`).
- **Addresses as people type them.** `192.168.1.50` or `u1.local` become
  `http://…:7125`; the address boxes no longer insist on `http://`.
- **Camera.** Pictures come first from the camera Moonraker lists
  (`/server/webcams/list`; the Extended Firmware publishes
  `/webcam/snapshot.jpg` there), then from Snapmaker's own monitor. The monitor
  request now carries the integer `req_id` that `repeater.py` expects, waits
  past its 10-second limit, and a `{"state": "failed"}` reply is shown as a
  failure instead of being taken for success. If both fail, both reasons are
  shown. A listed camera address is only ever fetched from the printer itself.
- **Find my printer's camera** (Settings → Camera, `POST /api/camera/find`)
  tries the listed camera's MJPEG feed (`/webcam/stream.mjpg` on the Extended
  Firmware), checks that a picture really arrives and saves it.
- **Firmware 2.0.0 file names.** Klipper ends a command's arguments at `#`, `*`
  or `;` (`klippy/gcode.py`), and 2.0.0 refuses the resulting empty name. Start
  now refuses such a name first, in words. The app's own uploads already
  replace those characters.
- **A simpler phone.** The strip under the header (search, Camera, Set up &
  help) and the line under the tab bar move into **More**, which becomes a
  sheet: search, Care, Automations, Photo studio, Games, Settings, then Camera,
  Show me this screen, Help & setup and Install app. The demo notice is one
  line, the print bar is one row (hidden on Control, which has its own
  buttons), the status strip steps aside while the print bar shows the same
  thing, and "Needs you" keeps its buttons beside each item. Cards that belong
  to the computer stay there: the desktop app, the update commands, recovery
  folders, remote-access setup, slicer paths, Stop and the phone QR code.
  Settings shows the newest two versions and the first six modules, with one
  tap for the rest. Measured at 390 px wide against 0.9.0, the page
  is shorter on every screen: Settings 16,779 → 9,952 pixels, Overview
  5,825 → 5,062, Files 5,154 → 4,775, Care 4,959 → 4,542, Control 2,470 → 2,091.
- **Install on Android.** Chrome installs a web app only from a secure address
  (Chromium `installable_evaluator.cc`): HTTPS with a valid certificate,
  localhost, or an address in its "Insecure origins treated as secure" setting
  (`chrome://flags`, available on Android). A phone opens Deja Vu1 at a plain
  home-network address, so Chrome offered only a shortcut. **More → Install
  app** (and Settings → Install on this phone) now detects the case: a one-tap
  Install button when Chrome allows it; otherwise the exact setting and this
  computer's address with copy buttons; Safari's Share steps on iPhone; and the
  HTTPS tunnel as the other route.
- **One dot colour.** While a print ran, the dots filled from the bottom in the
  filament's colours, which read as an orange line over black. Every dot is now
  one colour, the colour set's own unless **Settings → Appearance → Dot colour**
  picks another (seven presets or any colour).
- **Wording.** The app, the product page and the link-preview image no longer
  carry testing-status notes. Demo data stays labelled as demo data. The
  README's Current status keeps the full record.
- Verified: the full suite, Chromium at 1366 px and at 412 px (the Pixel 6 Pro's
  width) on the local server, a network address and the static online demo.
  Not verified: a real Extended Firmware camera, a real Android
  install through the Chrome setting.

## 0.9.0 (25 October 2026): updates that install every time

- **Fixed: 0.8.0's Install button could never install.** Its check for running
  slice jobs read the job list wrongly and crashed with a server error before
  anything was downloaded, on every copy and every channel (reproduced with the
  real 0.8.0 release). The check was fixed on `main`, and now a check that fails
  this way is logged and no longer blocks the update that fixes it. 0.8.0 copies
  need one manual update (the one-paste command below); from 0.9.0 on the button
  works. Tested end to end on Linux: a downloaded copy installed the published
  release and the newest files from GitHub, then restarted.
- **A release with every merge.** The release workflow now runs on every merge
  to `main`. If `VERSION` is new it publishes it; otherwise it numbers the next
  patch release, writes it into `VERSION`, `frontend/versions.json` and this
  changelog, commits that to `main` and publishes it. Automatic checks for
  releases now run every hour instead of once a day.
- **Update with a command.** One paste for PowerShell or Terminal stops Deja Vu1
  in Documents (politely through the new stop action, or by ending its server
  process on older copies), installs the newest release over it and starts it.
  It is in the README, the getting-started guide, the product page and Settings,
  and `tests/test_install_blocks.py` keeps every copy identical. The Mac/Linux
  block was run on Linux against the real 0.8.0 release; the Windows block has
  not been run on Windows yet.
- **Look after this copy.** Settings → Version & updates gains Restart, Repair
  files (the newest published files go back over the app, even at the same
  version; data untouched), Safety copy now and Stop (from the computer it runs
  on only). A failed install opens the update command.
- **A second launcher opens the first.** Starting Deja Vu1 while it already runs
  opens the running copy instead of failing with a misleading Python message.
- **Shorter words.** The About card and the update card say less, more plainly.

### Also in 0.9.0: your phone by QR code, help on every card, a nine-stop tour, clearer demo printers

- **Your phone, by scanning a code.** Overview → Connect your phone (also in
  Settings and setup) shows a QR code of this computer's address with a
  one-time pairing code in it. The phone's camera opens the dashboard and the
  phone pairs itself; the sheet on the computer says when it has. Typing
  stays possible, with the colon picked out, because a dot in its place
  (`10.0.0.10.8000`) or a missing `http://` makes phones search the web and
  show unrelated pages about routers. Help covers the firewall, guest Wi-Fi,
  VPNs and computers with more than one address. A phone arriving by the code
  skips the computer's setup. The launcher window draws the code too.
  `backend/qr.py` makes the codes with the standard library only.
- **A quick tour of nine stops** replaces the 53-stop tour of every screen. A
  glass callout with a pointer and a pulsing beacon glides from stop to stop
  across screens, and the page stays clickable. Every screen has a "Show me
  this screen" button with one to four more tips. Version tours use the same
  callouts.
- **Help on every card.** A small ⓘ sits after each of the 65 card titles. Press it, or the
  title itself, for a short note: what the card is, how you use it, and sometimes a tip.
  Words such as G-code, slicer, 3MF or heads are underlined in the notes; press one to see
  what it means right there. Settings → Your space → What the words mean lists them all, and
  Ctrl+K finds it. Each screen's intro line, setup and the update step are shorter and plainer,
  with the fine print folded under "More about…". `tests/test_explain.py` checks every note
  still matches a card and keeps the wording free of filler.
- **Demo printer 1, 2 and 3.** The pretend printers were called U1 · Workshop,
  Studio and Garage, which read like parts of the app. Saved records still
  match (their ids did not change).
- **Fixes found by pressing every button on every screen:** installing an
  update failed with a server error before it started (the slicing check
  misread its job list); if setup closed some other way, the header and tabs
  stayed hidden; the online demo's "Mark done" showed an error; tour stops
  could sit under the sticky top bar; the first screen lacked its "Show me this
  screen" button; the 3D twin kept drawing while out of
  sight (about a CPU core in software WebGL), and now draws only when seen.
- **Launch film version 16**, 16:9 only, now on the product page and in the
  README: the 3DBenchy, the quick tour and scanning onto a phone. By the
  owner's decision the "V2" films and 9:16 cuts are set aside.
- Tested: 867 automated tests; QR codes identical, module for module, to
  python-qrcode across 872 cases and read back by zxing-cpp and OpenCV; the
  phone flow end to end in Chromium (a computer page and an iPhone-sized page
  on a network address); every visible button on every screen at 1366 and
  390 px and on the online demo. Not tested: a real phone camera scanning the
  code, a real home network, Windows' firewall prompt.

### Also in 0.9.0: install in one paste

- README, getting started and the product page now lead with copy-and-paste
  install blocks: PowerShell for Windows, Terminal for Mac, Linux and a
  Raspberry Pi. Each downloads the newest release into Documents, unzips it and
  starts it; running it again repairs the app and keeps `backend/data/`. A
  winget line installs Python on Windows. The ZIP download and GitHub Desktop
  stay as no-code options. The product page has Copy buttons and an Install
  link in its menu. `tests/test_install_blocks.py` keeps the three copies identical.
- Tested: the Terminal block on Linux (download, unzip, start; the copy reports
  itself as an updatable download and keeps saved data when run again). Not run
  here: the PowerShell block on Windows and the Terminal block on a Mac.

### Also in 0.9.0: campaign art direction and clearer app copy

- Rebuilt the campaign around six distinct compositions: large typography,
  cobalt/ink/paper fields, enlarged UI details, a dimensional conceptual loop,
  a vermilion refusal panel and an owner-testing poster. Twenty-four exports
  cover square, 4:5 feed, 16:9 and native 1200 × 628 horizontal feed layouts.
  The loop is labelled AI-generated conceptual art, not hardware evidence.
- Added purpose, stage and suggested primary text to campaign captions, with
  a placement/use guide. Render checks now cover palette contrast, text bounds,
  evidence/action overlap and file sizes. Marketing effectiveness is unmeasured.
- Replaced vague onboarding titles and clarified phone pairing, automation
  services and core-vs-optional requirements. The copy review records exact
  before/after scope; most operational app strings retain their existing wording.

### Also in 0.9.0: public copy and marketing images

- Shorter project-page and README introductions, consistent search/share
  descriptions, and a visible first-connection invitation. Claims distinguish
  reported filament data, missing information, target update timing and
  separately installed slicing engines.
- Current editorial screenshots, two share-image sizes, five explainer boards
  and the standalone campaign pack. Simulation, historical Linux engine
  evidence and estimated twin geometry are labelled. Existing versioned films
  and brand icons are preserved; current post/video descriptions are drafted.
- Reproducible capture/render tools and a desktop/phone product-page check.
  Plain-text captions and alternatives accompany the campaign pack. Real-device
  performance remains unverified.

## 0.8.0 (24 October 2026): updates that find you

The first version published as a GitHub release.

- Updates: the updater only ever looked for published GitHub releases, and none
  existed, so no copy could update. `.github/workflows/release.yml` now publishes
  a release, with `deja-vu1-update.zip` and notes from `frontend/versions.json`,
  whenever `main` gets a new stable `VERSION`. Tests run first.
- Copies made with git or GitHub Desktop now update in the app too
  (`app_updates.git_info`, `_git_prepare`): fetch, then a fast-forward only. It
  refuses when tracked files were changed by hand or the copy has its own
  commits, and the launcher returns to the previous commit (`git reset --keep`)
  if the new version fails its startup check. On Windows it finds GitHub
  Desktop's own git when git is not installed separately. Tested with real git
  repositories on Linux; not yet run on Windows.
- Automatic update checks (still off until you turn them on) repeat daily while
  the server runs, not only at startup.
- Version history: Settings → Version & updates shows the installed version,
  how this copy updates, every version's changes and a full-screen interactive
  tour for each. `tests/test_versions.py` keeps `VERSION`, `versions.json`, this
  file and the release notes in step.
- Notification orb: a translucent orb in the bottom-right corner. Messages rise
  out of it and sink back in; click it for the last 30 and for update news.
- Desktop app: Settings → Desktop app installs Deja Vu1 from Chrome or Edge, or
  makes the launcher open its own app window (Edge or Chrome `--app` mode,
  `backend/desktop.py`, `DEJAVU_WINDOW`). The launcher now opens a window once
  per start, not again after an update restart.
- Setup tour: 54 stops on a computer (53 on a phone) covering every screen, with things to try, and an
  explanation of the three demo printers (Workshop, Studio, Garage) and the
  Photo studio tab.
- README and product page: the ways to use Deja Vu1, how the pieces connect,
  and install/update steps for each kind of copy, at the top.
- Fixed: `test_heaters_settle_toward_their_target` failed in the full suite for
  about half of the possible simulator clock positions, because the deliberate
  heater ripple can read up to about 0.3 °C over target. It now allows that.
- Validation: 852 tests pass (473.0 s, Python 3.13.17, Linux) with both rounds combined. Chromium at 1366
  and 390 px walked setup, all 54 tour stops (none missing where the part is shown), every version tour,
  the orb and both new Settings cards, plus the static online demo. Chromium
  reports the dashboard installable on `localhost`; installing in a visible
  Chrome/Edge window and the launcher's app window on Windows/macOS are untried.

### Also in 0.8.0: the real print in the twin, newest builds, a memory that lasts

- Digital twin: the print itself, from its own G-code (`backend/print_preview.py`,
  `GET /api/print/preview`): outside walls per layer and head, in each head's loaded colour,
  clipped at the layer being printed, the rest faint above; a Print close-up view. A real
  printer's copy is downloaded with Moonraker's file download (checked in its docs); the
  library or the samples otherwise. Case on / See-through / Case off, with frame, motors,
  belts and lead screw (estimated, labelled); print, rest, labels and turntable options.
- Engineering drawing: zoned border, numbered balloons with leaders and a parts list, notes,
  centre lines, the print's height, the print in its colours, a full title block.
- Demo: the Workshop printer prints a new sample, two two-colour Benchies
  (`two_benchies_two_colours.gcode`), its head following the boat it prints. Tests that
  assumed the old 4.6 h job were updated.
- 3D viewer: a textured 276 × 293 mm plate with a grid on it only, a studio backdrop drawn
  in the view, a contact shadow and better lighting; plate objects take loaded colours.
- Mixed layer heights: rebuilt around a goal (detail, balanced, fastest, one height), plain
  sentences per head with Thinner/Thicker, expert controls under Fine-tune. Rules unchanged.
- Updates: a Newest builds channel (`backend/app_updates.py`): per-file git-hash checks
  against GitHub's tree, only changed files downloaded, launcher rollback as before;
  15-minute automatic checks, optional automatic install when idle; Update with git for
  git copies; the page reloads itself after a restart.
- Memory: last-good copies beside every record and self-repair (`backend/storage.py`);
  safety copies every 6 hours, at start-up and before updates, restorable with undo
  (`backend/memory.py`, Settings → Your data is safe).
- Insights from the printer's history (`backend/insights.py`, Overview); Orca import of
  recent projects and own presets (`backend/orca_import.py`, Files); an optional device
  lock (`backend/pairing.py`); About, credits and Check it yourself (`backend/selfcheck.py`,
  `CREDITS.md`).
- Games moved to `frontend/games.js`, loaded when the Games tab opens.
- Fixed: Snapmaker Orca is detected for slicing; API-key refusals over the WebSocket say
  how to fix them; a heater fault shows on its own dock ring; Restart firmware clears an
  error on a real printer (only while it reports one); time-lapse frame lists skip hidden
  files.
- Not verified: a real phone; Orca import on Windows/macOS;
  automatic install outside tests.

## 0.7.0 (23 October 2026): technical tools, the real Benchy and a working online demo

Built and tested; never published as a download.

- Sample files: the real 3DBenchy (public domain, CC0, since February 2025; reduced from
  225,706 to 60,000 triangles with its edge structure unchanged), an involute 24-tooth
  module-2 gear and a twisted vase replace the cubes and the L-bracket. A new, clearly
  labelled sample slicer (`backend/sample_slicer.py`) cuts real layers from them: a
  240-layer Benchy, a Benchy + gear + vase plate with skip-object labels, a three-colour
  coaster. The 3MF project samples carry the new models. Old names stay buildable.
- Mixed layer heights: the Layer stack (`frontend/layer-stack.js`) replaces the four loose
  height boxes in the Files planner and Tools & filaments: a base layer, ×N per head, the
  allowed range, crossed-out choices with reasons, a section view and four smart set-ups.
  "Mixed" profiles add the thick-layer mode and tolerance; they reach an engine only when
  its exported schema lists `extruder_layer_height_mode`.
- Process settings: 106 OrcaSlicer settings in an Orca-style tabbed editor driven by one
  table (`backend/process_settings.py`, `GET /api/slicer/schema`); names and choices
  checked against OrcaSlicer's `PrintConfig.cpp`. Blank inherits; per-extruder list values
  keep their shape. Not yet sliced with a real engine in this round.
- Farm desk (`frontend/desk.js`): dispatch timeline, best printer, print right now, filament
  outlook, worth printing. Telemetry panel (`frontend/telemetry.js`). Logbook
  (`backend/logbook.py`, `frontend/logbook.js`, `/api/logbook`), with failures logged by
  themselves. Real printers' cards link to the printer's own web page.
- Converter card at the top of Files; finder (`frontend/finder.js`) over screens, settings,
  actions, printers and files.
- Online demo: print controls, skip-object, temperatures, homing, console, queueing, the
  logbook and the converter (real recorded reports) work in an in-browser simulation;
  everything else still says it's a recording.
- Digital twin: parked heads inside the chamber, level with the carriage; touchscreen above
  the door; lit chamber; clearer door glass. Simulated heaters report a small PID ripple.
- Launch film: the 60-second V1 (16:9) on the product page and in the README (a 10 MB web
  encode; the local server now answers byte ranges under `/media/`).
- Fixed: embedded thumbnail text no longer appears as a G-code setting; the printer-page
  link handles bracketed IPv6 addresses.
- Noted for the next video run: show the Benchy, then replace the film in the README and on
  the product page (`promo-video/README.md`, `build-prompts/09-launch-film-with-benchy.md`).

## 0.6.0 (23 October 2026): a realistic 3D twin and a livelier background

Built and tested; never published as a download.

- Launch video version 14 ("V1 at 60 s"): version 12's 75-second film, its music and
  its click and keystroke sounds, re-cut to exactly 60 s in both shapes and re-filmed from
  the current app. The new twin gets 9 s (the 3D model turned by hand and gliding to a stop,
  a toolhead clicked open, then the same model as a drawing and its Front view, estimated
  sizes marked "≈"); the live Dots background is shown through the cursor and as the film's
  own scenery. Version 13's cuts are unchanged. Not checked by ear; measured only.
- Launch video version 15 ("V2 updated"): version 13's 60-second film, music and headline
  move, re-cut so the twin gets 7.5 s (model, glide, a head's live details, then the
  drawing), with the same live background, scenery and fixes as version 14. Version 13's
  files are kept. A version 14 callout that pointed at blank space during a scroll is fixed
  in both.
- Digital twin rebuilt (`frontend/twin3d.js`, `frontend/twin3d-scene.js`, WebGL 2): a
  detailed model of the U1 from Snapmaker's official product picture (in Snapmaker's
  Orca profile) and published figures, with studio lighting, reflections, soft
  shadows, real materials, live head/bed/docks/spools/screen/print, exact click
  picking and a gliding drag. The Drawing mode is now made from the same geometry
  (edge ink, dimensions, balloons, title block, "Show the case", PNG download); the
  previous SVG drawing remains for browsers without WebGL 2. Estimated: the body's
  own size (about 390 × 460 × 480 mm), dock spacing, inside layout. Measured in
  software WebGL only (about 250 ms a frame on the CPU); real GPUs unmeasured.
- Background: Dots by default; stronger, faster reactions (push, stir, curl, glow);
  Constellation style, Time of day colours, Reaction setting; "Little surprises" (click
  ripple, triple-click bloom, long-press charge, minute sweep, the time in dots on the
  hour, a burst when a print finishes, two keyboard secrets); a running print fills
  the dots from the bottom in its filament's colour. Reduced motion turns it all off.
- Owner's note for future launch videos: show the Dots background reacting and the
  new 3D twin (`promo-video/README.md`). Next ideas: `build-prompts/08-background-and-twin-next.md`.

## 0.5.0 (22 October 2026): interface refresh: live background, 3D twin, games, setup

Built and tested; never published as a download.

- New background that reacts to the cursor (`frontend/backdrop.js`): Flow, Layer
  lines, Dots and Still, in Glacier, Mint, Dusk, Graphite or Filament colours, chosen
  in Settings → Appearance and in setup. Glacier (blue) replaces the red/filament
  glow as the default; the old behaviour is the "Filament" set. It animates only while
  the pointer moves and for the glide afterwards, and stops for a hidden tab, reduced
  motion or reduced transparency. Content cards no longer blur what is behind them.
  Measured in headless Chromium (software rendering) with the mouse moving over the
  Overview: median frame 16.7 ms with Flow, Layer lines or Dots, against 33.4 ms for the
  previous version; 95th percentile 33 ms. Not measured on real devices.
- Digital twin: a shaded 3D model of the U1 (`frontend/twin3d.js`, raw WebGL) beside
  the engineering drawing. Built to Snapmaker's published outer size (584 × 499 ×
  730 mm) and 270 mm build cube; head, bed, docked heads, spools and parts are live.
  Colours, panel tints, screen and spool placement, dock spacing and which side feeds
  which head are drawn by eye and labelled as illustrative. The drawing gained zoom,
  an "Outer size" option with overall dimensions, and SVG download.
- Games: Pac-Man rewritten (a new maze with a ghost house, ghosts released one at a
  time, smooth movement at sensible speeds, a two-second READY, pause on tab switch);
  it previously lost all three lives in about four seconds without input. Tetris
  rewritten (tapping the board used to restart the game; now it turns the piece; ghost
  piece, hold, wall kicks, lock delay, touch buttons). Snake rewritten (no longer starts
  by itself; buffered turns, smooth movement, game-over card). Sky Dash rebuilt on a
  canvas (it rebuilt every pipe element 50 times a second). Every game's timer now runs
  from the screen's refresh at a fixed rate, so speed is the same at 60 Hz and 144 Hz,
  and every playing field is sized to fit the window.
- Setup is now full screen with a named step bar and a new "Make it yours" step.
  Fixed during the work: a closed full-screen dialog must not stay laid out over the page.
- Clearer layout: Overview first in the tab bar, "Fleet" shown as "Printers", one
  sentence under the tab bar explaining each tab, the Overview reorganised (twin with
  controls and health beside it), plainer card subtitles, jump links at the top of
  Settings, and plainer wording for the continue-on-another-device banner.
- README rule: every change, by any AI or person, must also be reflected in the online
  demo. Frontend changes reach it automatically; changed routes need the recorder.
- Tests: `tests/test_frontend_refresh.py` (maze reachability, published outer size,
  script order, tab introductions, game timers). README pictures re-captured.

## 0.4.0 (21 October 2026): slicing workspace and app-data recovery

Built and tested; never published as a download.

- Launch video version 13: two new 60-second cuts (16:9 and 9:16), told problem
  first, then six features, each headline landing before the app shows it. New
  lounge-jazz music with a recorded vibraphone; same click and keystroke sounds.
  Re-filmed from the simulated farm; checked by measurement, not by ear. The
  75-second version 12 cuts are kept.
- Refresh all five README files, product-page/PWA descriptions and maintainer
  context. Distinguish core/optional dependencies, current/historical media and
  actual engine output/physical testing; remove repeated launch history.
- Unified object editing, profiles, fitted tools, slicing status and output preview.
  Phone settings omit the viewport; phone preview keeps layer navigation visible.
  Arrange now frames the moved objects, and selection reuses unchanged geometry.
- Supported external engines consume distinct physical-head layer heights. Exact
  coordination, first layers, nozzle limits, capability changes and stale tools
  are validated. Three real Linux nozzle/height combinations passed pre-flight.
- Fixed CLI working-preset context and legacy standard-flow migration; no engine
  source or startup commands are modified. Generic out-of-volume startup
  extrusion is refused. Added cancellation, per-printer jobs and atomic queue handoff.
- Separate 3MF plates with original recovery data. Reconcile source preset identity
  slots with selected CLI materials; three separated fixture plates now real-slice.
- Expand profile groups, material temperature/flow/cooling overrides and edit-as-new.
  Unexposed or inherited settings remain in the resolved working copies.
- Tracked colour recipes bind to print/material settings, backing and layer order.
  Changed conditions refuse stale recipes; physical colour accuracy remains unverified.
- Full app-data ZIP, checksums and isolated recovery with launchers. Connection
  secrets are omitted, existing data stays intact and restored automatic actions
  are disabled. Linux recovery startup tested; Windows/macOS remain unverified.

## 0.3.0 (20 October 2026): plate editing, real slicing and a first updater

Built and tested; never published as a download. Recorded at the time as "round-two launch readiness".

- Blocked engine output is kept for inspection and never automatically queued.
  Slice reports show unknown when the engine supplies no time or weight. The
  file inspector labels its older length/density assumptions explicitly.
- Tool forms reject a changed printer immediately, including late load replies;
  a browser check confirms no filament command is sent from a stale form.

- Generated four-tool colour paint survives a plate save-as and real-engine
  round trip. Layer settings remain attached; transforms that would invalidate
  the layer recipe are refused.
- Colour recipes now export as a single multipart object, keeping raised colour
  layers together. The bridge checks printer/tool identity and both first and
  later layer heights. Measured recipes are printer-specific. Selected-settings
  export included tool assignments and measured recipes; this historical pass did not include full restore.
- Mixed-nozzle presets limit bridge width to the smallest nozzle and require
  explicit review before using materials listed for another U1 nozzle variant.
  A real mixed-nozzle slice was blocked by startup extrusion outside 270 mm.
  A converted three-plate fixture crashed Orca; single-plate conversions passed.
- G-code layers follow file order, including sequential objects; startup purge
  can be excluded when framing a layer. Added selected-object outlines, broadest
  surface lay-flat, cached transforms, bounded ZIP streaming and 3MF unit handling.


- Connected explicit spool assignments to Confirm Print’s weight check. New
  inventories start empty; existing records are preserved. Duplicate physical
  spool assignments are refused. Without measured per-tool usage, a multi-tool
  print no longer consumes the whole weight from one guessed spool.
- Converter now refuses unknown materials, unsupported nozzles, malformed
  settings objects and nonfinite layer heights. Mixed-nozzle arrays stay intact
  with explicit limitations. Simulated cancel records partial history, docks
  the active head and turns off all heater targets. Offline local settings and
  slice workers retain the selected printer without opening a connection.

- Added original four-tool image-to-3MF generation with optional serpentine
  error diffusion, physically measurable sixteen-swatch recipes and calibrated
  layer stacks. Measurements are tied to spool identity, colour, nozzle and
  layer thickness. Layered mode refuses uncalibrated settings.
- Added closed heightmap relief geometry. Real Orca 2.4.2 sliced tile, swatch
  and relief projects; all passed pre-flight. Physical colour tests
  remain outstanding. Image brightness is not geographic elevation.

- Replaced the single-model transform controls with an undoable multi-model
  plate workspace, arbitrary rotation, mirroring, scaling, arrange, drop/lay-flat,
  object settings and exact surface-point measurements. Geometry checks run in
  a bounded browser worker and distinguish box overlap from mesh contact.
- 3MF save-as retains original model/property/texture parts and source recovery
  copies. Added required model relationships after a real-engine test exposed
  empty imported geometry. A two-object T0/T1 slice now passes pre-flight.
- Added G-code speed/feature information, layer heights, event markers and
  nominal movement time with its limits. Retraction recovery no longer counts
  as newly consumed filament. Travel filtering now uses one GPU draw call.

- Added installed-preset discovery, bounded inheritance resolution, matching
  machine/material checks and a native print-settings form. Generated working
  presets leave the installation intact. Saved tools feed nozzle arrays and
  colours; a shared layer height passes through the nozzle planner. Separate
  preferred heights are explicitly unsupported by this stock-engine path.
- Verified a real OrcaSlicer 2.4.2 Linux slice through the bridge: 125 layers,
  6.62 g, 0.231 h from the engine, clear pre-flight. Fixed lost system identity
  during preset resolution and selected-printer scope on slicing workers.

- Time-lapse now captures each real printer’s own stock camera, independently of
  open browser tabs. Duplicate pictures are skipped, failures are visible and
  retried, and late replies cannot enter a different print’s session. Real status notifications now wake the live feed.

- Added per-printer four-tool preparation records and a native editor in
  Auto-print. Idle-only colour/material changes use physical head numbers and
  read-back verification; firmware refusals remain errors. Confirm Print also
  checks known material mismatches.

Validation: all 732 Python tests pass on Python 3.12 Linux (133.8 s); Chromium desktop/phone checks
cover setup, privacy, search, viewer transforms and offline handling. A browser
connection test rejects a wrong API key, accepts the authenticated stand-in
and keeps the selected printer after reload.

- Added skippable/replayable setup, a name stored only in the browser, feature
  search and explicit public-demo guidance. Added a network-only service worker
  with an offline explanation; printer readings and commands are never cached.
- Added opt-in app release checks, SHA-256 verification, safe staging and a
  supervising launcher with file rollback after failed startup. Linux process
  tests cover good/broken releases and preserved data. No real release published;
  Windows/macOS and real network delivery remain unverified.
- Added selected-printer stock camera snapshots with a dedicated authenticated
  monitor connection, renewals and idle shutdown. Tested with fake Moonraker;
  a real U1 camera still needs testing. Existing manual MJPEG is separate.
- Added triangulated OBJ geometry loading, viewer pan/scale/quarter-turn rotation,
  measured bounds and save/export of prepared STL copies. STL loses colour/tool
  metadata; overlap checking and multi-model editing are future work.
- Added local OrcaSlicer path detection; actual slicing still needs a separately
  installed engine and compatible presets, and has not run with a real engine here.
- Fixed refused print starts overwriting job summaries and disabled modules
  continuing background actions. A request already in flight cannot be recalled.
- Rewrote computer, phone, firewall, remote-access and release guides. Clarified
  incomplete configuration backup and the real-hardware test requirements.

## 0.2.0 (14 October 2026): online demo, planner and printer finder

Built and tested; never published as a download. Recorded at the time as "Phase 2 work".

Local setup, printer reliability and file preparation improvements.

### Added
- **Online demo on the public Cloudflare link** (`/?demo`, and **Try the
  demo** on the product page). The real dashboard plays a recording of the
  simulated farm (`tools/online-demo/record.py` → `frontend/demo/`): every
  reading for the three simulated U1s and 150 seconds of live feed on a
  loop, with a jam halfway. Files, the planner and Photo Studio work;
  changes say "this is a recording". Checked in Chromium against a plain
  static server; the published link can't be reached from the build
  sandbox, so it hasn't been opened there yet.
- **Digital twin v2.** Drawn the drafting way: one ink, ISO-style line
  weights, hidden edges dashed (worked out per solid from the view), a
  phantom-line build volume, dimensions with arrowheads, a sheet border and
  a title block with the scale. Click a toolhead, a balloon, a part or the
  bed for its details. Dock spacing is approximate (the printer doesn't report it).
- **Nozzle size and swap counters from the U1's firmware** (u1-klipper
  `extruder.get_status`: `nozzle_diameter`, `switch_count`, `retry_count`,
  `error_count`), shown in the twin's details. Printers that don't report
  them show "not reported", never 0.
- **Mixed-nozzle planner** (Files tab) and **a nozzle check in Confirm
  Print.** Limits from Snapmaker/OrcaSlicer `8931178`; a common grid keeps
  each toolhead's preferred layer height on whole steps.
- **Find printers on my network** and **Test** (Fleet → Add a printer):
  mDNS `_snapmaker._tcp` (from u1-moonraker `a308cfa`) and `_moonraker._tcp`,
  then port 7125 on the home network. Tested against the stand-in
  Moonraker.
- **Double-click starters** (`start-windows.bat`, `start-mac.command`,
  `start-linux.sh`, `start.py`) and `docs/getting-started.md`. Tested on
  Linux only.
- **Photo Studio fits the photo's tones** to the filaments (on by
  default), and leaves out tool changes the model never reaches.
- **The plate map is a top-view drawing** with numbered balloons.
- `GET /api/printer/job`, `POST /api/tools/layer-plan`,
  `POST /api/printers/discover`, `POST /api/printers/test`.

### Fixed
- A port outside 1-65535 was accepted, and the printer showed
  "Connecting…" forever. It's refused in words now.
- Spoolman's settings were saved in the real `backend/data/` even under
  the test runner.

### Added (earlier in Phase 2)
- **Skip one object** (Control tab). When a print labels its objects, they
  show on a map of the bed; pick one, confirm, and only that one stops.
  Refuses names the print doesn't have and the last object left. Read back
  from the printer. Protocol checked in Snapmaker's
  u1-klipper `exclude_object.py`.
- **Multi-plate conversions land on the right plates.** Every plate's
  objects are moved onto the U1's 270 mm plate grid, from Snapmaker Orca's
  `PartPlate.cpp`. Before, plate 2 onward landed between plates.
- **Conversion errors with codes** (`CV-101`...), the stage that failed and
  what to try, and a **Copy report** button for bug reports.
- **OrcaSlicer projects** convert too.
- **Import from Spoolman** (Care tab → Filament inventory). Imports again
  update instead of duplicating; hand-added spools are left alone.
- **Add to Home Screen**: an app icon, name and manifest.
- A sample with three labelled cubes, and a three-plate MakerWorld-style
  sample, to try skip-object and the plate fix in demo mode.
- README screenshots, a status table, and [docs/beta-testing.md](docs/beta-testing.md).

### Changed
- **Photo Studio stays in step with what's set.** Changing a colour, TD,
  size or layer setting rebuilds the model by itself; until it has, the old
  model is greyed out and can't be saved. A change made mid-build is built
  straight after instead of being lost. A rough colour match now says which
  colour would help. HEIC photos get a clear message.
- **Filament colours are asked for every 30 s** as well as pushed, so
  missed touchscreen-change notifications do not leave stale readings.
- A raw `T4`-`T15` in a file now says to run the filament add-on's
  post-processor (multiACE rewrites them into `ACE_SWAP_HEAD`).
- The demo's idle printer (Garage) now has the sample files' colours
  loaded, so the demo tour can really start a print.

### Fixed
- Panels that refresh every 5 s (print cost, dock rings, colour check,
  maintenance on Overview) no longer blink: their entrance animation played
  on every refresh, and the cost row could sit invisible mid-animation.
- **Add spool** cleared the form even when the server refused the spool;
  it now keeps what was typed and says why.
- Converted and studio files no longer offer "Convert" again.

### Not verified yet
The converter's output and studio
3MFs haven't been opened in Snapmaker Orca; Spoolman import hasn't met a
running Spoolman. See the status table in the README.

## 0.1.0 (4 August 2026): the first dashboard

Built and tested; never published as a download.

The history before this changelog, in short (see `git log` for detail):

- **Real printer connection** - a Moonraker client written from Moonraker's,
  Klipper's and Snapmaker's U1 source, contract-tested over real sockets
  against a stand-in built from that source.
- **Flagship features** - fleet command center, Photo-to-Print Studio,
  auto-print pipeline, farm sandbox.
- **Dashboard screens** - fleet, live updates over WebSocket, files, G-code
  and 3D viewers, automations, phone layout, AR preview, low-latency camera.
- **Hardening** - safe saves, hidden secrets, stricter inputs, streamed
  model reading.
- **Liquid Glass** interface, the games tab, printer control, pairing,
  notifications, filament tracking, and the maintenance module it began with.
