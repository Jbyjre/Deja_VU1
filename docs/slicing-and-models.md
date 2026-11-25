# Prepare, slice and inspect a plate

A model describes a shape. A slicing engine turns it into G-code: the movement,
heating and extrusion instructions a printer follows. The Slicer is the screen
where that happens in Deja Vu1. It is laid out like Snapmaker Orca, with the
settings at the left, a tool strip across the top and Slice plate in the
corner, so nothing has to be learned. It runs on Snapmaker Orca, which does the
slicing, and the whole screen is Deja Vu1's own.

## The Slicer

**Prepare** shows the U1's own plate: a 276 × 293 mm sheet with a 270 × 270 ×
270 mm printable area, drawn from the outline and numbers in Snapmaker's U1
profile (version 2.4.1), in the app's light or dark room. Put a model on it by
dropping an STL, 3MF or OBJ, pressing **Add models**, choosing a file in the
empty plate's list, or pressing **Open in Slicer** on a model in Files. A 3MF
saved by the Slicer comes back with its objects where they were.

- **Tool strip.** Add, Delete, Arrange, Auto-orient; Move, Rotate, Scale, Lay on
  face, Split into parts; Measure and Show overhangs; Undo and Redo. Press **?**
  for every key. They are Snapmaker Orca's: A arranges, Q orients, M, R, S, F and
  U pick the tool, 1 to 4 give the selection a head, Ctrl+C, X, V and K copy,
  cut, paste and clone, Ctrl+A selects all, Ctrl+D deletes all (Ctrl+Z brings it
  back), Ctrl+R slices, Ctrl+G saves the G-code, Ctrl+Shift+G prints, Tab switches
  between Prepare and Preview.
- **The view.** The left button turns the view round the selected model (or all of
  them), 0.8° a pixel, and the model stays where it is on the screen. Ctrl and the
  left button turn it round the middle of the screen. The right or middle button
  pans, so what was under the pointer follows it. The wheel zooms a tenth a notch
  towards the pointer (small trackpad steps add up); I and O zoom, Z fits. Ctrl+0
  is the default view (from the front, at 45°); Ctrl+1 to 6 are top, bottom,
  front, rear, left and right through a flat lens, until you turn the view again.
  Shift and the left button draw a box that selects what it touches (Ctrl adds,
  Alt takes away). On a touch screen two fingers pinch and pan. The camera button
  offers Orca's four options: zoom to the pointer, swap the turn and pan buttons,
  reverse the wheel, and the turning speed.
- **On the plate.** Drag a model to move it. The selected model shows handles:
  arrows to move along an axis, rings to turn (5° steps, Alt for free), a corner
  to scale. The arrow keys move the selection 10 mm (Shift 1 mm, Alt 0.1 mm, Ctrl
  the way the camera sees it).
- **Object panel.** Exact position, size, turn and scale, the head that prints
  it, walls, infill and supports for that object only, Drop to plate, Lay flat,
  Reset, Mirror, Duplicate and Set aside.
- **Plates.** Tabs along the bottom. Each plate is sliced on its own.
- **Problems.** Shown on the plate as they happen, each with its fix one press
  away: over the edge, bigger than the U1 can print, floating or below the plate,
  overlapping, a model that looks drawn in inches or metres, surfaces that hang
  out more than 45° where supports are off, a multi-head plate with the prime
  tower off, and a prime tower that will be tall and narrow.
- **Prime tower.** Shown as a see-through block as soon as two heads are used.
  Arrange keeps objects clear of it. Its position is the engine's default corner
  (15, 220 mm) and it cannot be moved yet.
- **Heads and filament.** Press a head to choose its filament: what the printer
  reports for that head (one press uses it), the spools you own, the material
  (PLA, PETG, ABS, ASA, TPU, PVA, PA or PC), one of the engine's own filaments
  for that material (Snapmaker's, Generic and others; its temperatures, flow and
  cooling go into the slice), the colour, and a fold of eleven numbers (nozzle and
  bed temperature, first-layer temperatures, flow ratio, most flow, fan limits, fan
  on overhangs, fan off for the first layers, slow down under so many seconds a
  layer) with the filament's own value shown in each box; a blank box keeps it.
  The bed number is for the textured plate the U1 comes with. **Sync** reads the four heads from
  the printer again. A line under the heads says where one differs from what the
  printer reports (material, colour or nozzle). Nothing is written to the
  printer from here, and a blend a head cannot hold (carbon fibre, for example) is
  set on the printer.
- **Settings dock.** The printer; the four heads with the nozzle and a layer
  height for each; the print preset with its
  layer height, infill, walls, supports and prime tower dials and a speed slider
  from 50 to 120 % of the preset; and **All settings**, a sheet of every print
  setting the app offers (118) in Orca's groups (Quality, Strength, Speed,
  Support, Multi-material, Others) with Simple and Advanced, a search, the
  preset's own value in each box, changed values marked and a plain-words note
  beside each. A blank box uses the preset. The dock keeps no profile of its own:
  it rebuilds one working profile from the stock U1 presets that fit the four
  heads (read from the installed engine) plus what you changed, so the engine's
  own refusals appear where you type.
- **Saved settings.** Under the dock's print settings, **Save** keeps the preset, every
  changed setting, the speed and each head's filament choice and numbers under a
  name. Pick one to put them all back; the arrow beside Save offers Rename, Delete,
  Export and Import. A file is a plain JSON file; one that holds a setting the engine
  does not have, or a value that does not fit, is read with those left out and says
  how many. The heads' colours and spools are not part of a set.

**Slice plate** saves the plate as a source-preserving 3MF (the original files
stay intact), rebuilds the working profile, and runs the engine on that one
plate with `--arrange 0`, so objects stay where you put them. A slice has named
stages and Cancel; no fabricated percentage is shown. A change to the plate or
the settings marks the slice out of date at once.

**Preview** reads the sliced G-code in the browser with every move kept. Its layer
numbers are the slicer's own: the purge line the U1's start code lays down before
the first layer is drawn with layer 1 and is not counted as a layer. It
colours the toolpath by line type, head, speed, flow, layer height or line width;
has a layer slider with two ends, a move slider with play, a switch for travel
moves and a view from underneath; and shows the slicer's own time and filament
(the file's header), the filament per head, tool changes and retractions. The
shares by line type are nominal (length over requested speed). Checks that
matter on a tool changer each jump to the layer where they happen: a head that
prints where no object uses it, a multi-head plate sliced without a prime tower,
a tall and narrow tower (with a one-press strengthening: rib wall, internal ribs,
a brim), and overhangs with supports off.

**Print plate** opens Confirm Print for the sliced file, which checks it against
the printer and says no in words. **More** saves the G-code or adds it to the
queue. Queueing never starts a print or bypasses Confirm Print. Blocked output
remains inspectable and never enters the automatic queue handoff.

Built into Deja Vu1 for now: **Arrange** is a quick packing (it names objects
that do not fit) and **Auto-orient** picks the way up with the least overhang.
The engine also has its own arrange and orient. They ran for real on
22 November 2026 ([engine support](engine-support.md)), but the Slicer does not use
them yet. Not built yet: cut,
painting colours or supports, calibration prints and printing one object at a
time.

## The slicing engine

Press **Install engine** in the Slicer's Printer block and Deja Vu1 downloads
the official Snapmaker Orca release for this computer (about 137 MB on Linux, 175
MB on Windows, 274 MB on macOS), checks it is the file Snapmaker published,
unpacks it into its own folder and uses it. Snapmaker Orca is open source under
the AGPL-3.0 and runs as a separate program; Deja Vu1 does not include its
code, and the card shows its source and licence. The engine and its settings
live under the app's data folder, and your own Snapmaker Orca or OrcaSlicer is
never read or changed. Nothing is downloaded until you press the button, and a
newer release is looked for only when you press **Check for a newer one**. How
the file is trusted, and what was and was not run, is in
[engine support](engine-support.md).

You can also use a Snapmaker Orca you installed yourself (**Use my own Snapmaker
Orca**). The current verified specialised Linux build identifies itself as
**Snapmaker_Orca 02.08.01.55**. Stock OrcaSlicer 2.4.2 remains a shared-height
route; its historical successful slices do not prove per-head support. The builds
and systems that have been run for real are listed in
[engine support](engine-support.md).

For an engine of your own, in order:

1. Install and open your engine normally. First verify its own U1 setup.
2. Enable **Auto-print pipeline** and **Filament inventory** in Settings.
3. Save the fitted T0–T3 nozzles, materials, colours, preferred heights and
   explicit spool identities. These records do not change fitted hardware (the
   Slicer's **Heads** block reads and writes the same records; **Sync** reads
   them from the printer again).
4. Choose the program (**Use my own Snapmaker Orca**, or enter its full path in
   the older Slicing settings) and let the Slicer check it. The check reads its
   actual version/help and, where available, exported option schema. Changing the
   executable invalidates its capability result. Schema recognition is not a
   claim that every geometry or platform has been tested.
5. The Slicer lists the engine's stock U1 presets that fit your heads. Some
   engine builds package presets in an opaque cache. For those, select a matching
   unpacked profiles folder containing `Snapmaker/`, or use complete exported
   JSON files in advanced setup. The app does not unpack proprietary engine
   caches. The Linux build needed WebKitGTK 4.1, JavaScriptCore and mspack runtime
   libraries; follow the engine's installation requirements.
6. Review compatibility; explicitly acknowledge using another U1 nozzle/material
   variant where needed. Installed files stay intact. Internal working copies
   live in application storage and enter app-data backups.

Quality/shells, infill, support/adhesion, speed and per-material temperature,
flow/cooling groups expose validated engine options. Blank numeric overrides
inherit their installed preset. Unsupported inherited values are preserved;
unsupported edits are refused. Cooling enablement and bed-type selection still
come from the resolved presets. Smooth-plate temperature fields apply only to
that bed type. Edit-as-new keeps the previous profile for recovery. External
exported preset paths remain external resources and must be backed up separately.

## When the engine check or a slice fails

The message names the cause and what to try, in the Slicer (the slice bar's **Why?**). Each failed slice also says where it stopped: reading the
model, checking the engine, checking the presets, checking layer heights,
preparing the plate, slicing, checking the G-code or saving it.

Causes Deja Vu1 recognises by the text the engine or the system prints, or by
how the program ended:

| Cause | What it looks like | What the message offers |
|---|---|---|
| Missing library (Linux) | `error while loading shared libraries: X: cannot open shared object file` | The library name. For `libwebkit2gtk-4.1.so.0` and `libjavascriptcoregtk-4.1.so.0`, the Debian or Ubuntu package and a command to copy. For any other library, a hint to search the package manager. |
| AppImage without FUSE 2 | `libfuse.so.2` in the output | Install FUSE 2, or use a build that is not an AppImage. |
| System too old | ``version `GLIBC_2.38' not found`` | Use an engine build made for this system, or update the system. |
| Missing library (macOS) | `Library not loaded: X` | Reinstall the engine. |
| No screen | `cannot open display` | Start Deja Vu1 from a desktop session, or run the engine under `xvfb-run`. |
| Out of memory | `std::bad_alloc`, or the system killing the process | Close other programs, try a smaller model. |
| Crash | A POSIX signal (segmentation fault, abort, killed) | Slice again, then copy the report. |
| Windows load errors | Exit codes 0xC0000135, 0xC000007B, 0xC0000005 | Reinstall the engine; repair the Visual C++ Redistributable for 0xC0000135. |
| Not a runnable program | The system refuses to start the file | Download the build for this computer's system and processor. |
| Help printed to a console window (Windows) | `--help` exits cleanly with only start-up log lines such as `sentry_init returned: 0` | None needed: Deja Vu1 asks for the settings file instead and reads the version from it. If that file is not Orca's, the check says it didn't answer like OrcaSlicer's command line. |
| Orca's own errors | Its `result.json` return codes | The code's meaning and one fix (a model outside the plate, an incompatible preset, and so on). |

On Windows, Snapmaker Orca's `--help` writes to a console window of its own (its source calls
`attach_console_on_demand` before it prints), so a program that reads the engine's output never sees the help
text. The check then runs `--export-settings` into a throw-away folder; a file with a version, `layer_height` and
`nozzle_diameter` counts as Orca's answer and its `version` is the one shown. The program's name decides whether
the app is shown as Snapmaker_Orca or OrcaSlicer. This route has run only against a stand-in engine so far.

Anything else keeps the old wording ("Orca exited with code N") and its last
line, and the report still holds the engine's output.

**Copy report for help** (and **Copy report** on a finished slice) makes one JSON
report: the Deja Vu1 version, how it was running (local server, printer, watch-only),
the computer's operating system, the engine's version and last check, the profile
and preset file names, the model's name, size and a short fingerprint, the stage
reached, the command that ran, the exit code, the start and end of the engine's
output, which G-code files came out, and the cause. Home folders are shown as `~`.
It names your files and engine output, so read it before you share it. Settings,
**Copy a report for help**, also carries the slicing lines. The last 20 slices are kept in
`slice-receipts.json` in the data folder, so a report is still there after an update or a restart. A slice that was
waiting or running when Deja Vu1 stopped comes back as failed with the cause "interrupted": it did not finish and
nothing from it was queued.

What is verified: the cause rules run against the text real failing programs print
(the Linux loader, the AppImage runtime, GTK) and against stand-in engines that fail
each way, on Linux. The Windows exit codes and the macOS loader text are matched by
their documented values and have not been seen from a real Windows or macOS engine.
The package names are checked against Debian's and Ubuntu's package lists;
`libmspack.so.0` has no single name because Ubuntu 24.04 calls it `libmspack0t64`.

## Different heights per head

Choose **Different preferred heights per head** in a native profile. It uses the
saved physical-head heights, not the older standalone calculator's drawing.
A capable engine receives `extruder_layer_height` and, when advertised, exact
coordination mode in the machine working copy; the process receives the computed
common step. Shared mode removes these preferences and uses the common height.
Unsupported engines refuse per-tool mode; they never silently substitute shared
heights. Changing fitted tools makes an old profile stale.

The integration accepts exact multiples of 0.005 mm. Each preference and the
first layer must fit the nozzle's limits. The common step must also satisfy every
fitted head's minimum, because purge and fallback paths can use that step. This
is deliberately more conservative than the engine's experimental fine-grid mode.
For example 0.14/0.28 mm works on 0.4/0.6 mm nozzles; 0.2/0.3 mm requires a
0.1 mm grid below the fitted 0.6 mm nozzle's 0.12 mm minimum and is refused.

Actual verified pairs: 0.14/0.28 mm on 0.4/0.6 mm nozzles; 0.2/0.4 mm on
0.4/0.8 mm; 0.1/0.2 mm on two 0.4 mm nozzles. These are preferred heights.
First layers, shared geometry and features that cannot combine may be finer.
Bridges span a gap and can use round strands whose declared height reflects
nozzle width. Inspect model deposition and tool changes, not layer comments alone.
This differs from adaptive layers, which change thickness through a model's height.
No physical mixed-nozzle print is verified here.

Native U1 startup macros passed pre-flight without changing safety limits or
removing commands. The historical stock preset failure came from a generic
inherited toolchanger sequence containing X300 travel and X290 purge extrusion.
Known literal out-of-volume startup extrusion is now refused during profile
creation. The entire output is still checked against 270 × 270 × 270 mm. No
physical purge-region exception has been established.

## Finding models and bringing them in

**Models, Find a model.** Type what you want and press Search: a new tab opens with results from the sites you
starred (MakerWorld, Printables and Thingiverse start starred; Cults, MyMiniFactory, Thangs, Yeggi and GrabCAD are a
press away). Each site's tile searches only that site. When Printables is the only starred site the search uses
Printables' own search page; otherwise it is one web search limited to the starred sites, because the other sites'
own search addresses could not be checked. Model sites refuse to be shown inside another page, so they always open
in their own tab, signed in as you, and Deja Vu1 sends them nothing but your search words. Stars and your last six
searches stay in this browser only. Snapmaker's wiki, forum and store are listed under Snapmaker.

**Models, Bring it in.** Download a model the usual way. With Watch my Downloads on, each new `.3mf`, `.stl`, `.obj`
or `.zip` that lands in your Downloads folder (or a folder you choose) is offered on any screen within about two
seconds: Open in Slicer, Keep in Files, or Not this one.

- Only files that arrive after you switch it on are offered. The folder is only read: nothing in it is moved,
  changed or deleted.
- The page asks for new files while it is open and visible, so nothing watches the folder while Deja Vu1 is closed.
- Only the computer running Deja Vu1 can switch the watcher on, choose its folder or take a file from it. A phone or
  another computer sees whether it is on, never the folder's path or the names of the files in it.
- A `.zip` is unpacked with the same checks as a 3MF: at most 20 model files, each up to 64 MB, everything else left
  out.
- **Or paste a link to a model file:** `https://` links only, to public sites only (never this computer or your home
  network, including after a redirect), up to 64 MB. A link to a model's web page is refused with a note to use the
  page's download button instead.

Every model brought in keeps where it came from, shown under its name in Files: the site and page (from the pasted
link, or the address Windows or Linux recorded with the download), and the designer, title and licence when a 3MF's
own metadata says them. Reading the page Windows records beside a download (its Zone.Identifier note) has not run on
Windows yet; macOS does not record it in a form Deja Vu1 reads, so there only the
3MF's own credits show.

## Models and project fidelity

Sources are immutable; editing stores transforms separately. Save-as includes
original input files for recovery. Core material/vertex colours and simple face
paint are displayed; external OBJ materials, textures and subdivided paint are
not fully interpreted. Preserving payloads does not establish correct rendering
or full vendor per-part semantics. Review complex imported projects in the engine.
STL is shape-only; AR still uses the original source geometry.

Multi-plate projects require selecting one plate. Separation retains model parts,
paint, per-part settings and original recovery data. Inconsistent instance lists,
unknown bed origins and unsupported document encodings are refused. All three
plates of the historical crashing fixture now slice separately with clear
pre-flight. When a source has fewer material slots than the chosen four-head
profile, temporary engine input reconciles its preset identity arrays with that
explicit profile. Source bytes and per-part assignments remain intact.

The viewport allows two million triangles total; detailed contact/picking checks
are bounded at 250,000 triangles per object. Bounding boxes and mesh contacts do
not guarantee watertightness, support adequacy or toolhead clearance. Heavy model
frame pacing is still poor with the cloud's SwiftShader software renderer.

## Images, calibration and reliefs

Photo Studio makes four-tool dithered colour tiles, sixteen-swatch calibration
sheets, measured layered-colour images and closed image-heightmap reliefs. A
heightmap uses image brightness, with no geographic elevation or full CAD.
Generated colour layers must remain upright and at their original thickness.

For new measured colour recipes, load and select the exact slicing profile used
for the printed swatches. The recipe records process/material settings, backing,
layer order, printer, spools, nozzles and thickness. Changes invalidate tracked
recipes or refuse their slicing contract. Older recipes are explicitly
`process_untracked`; recreate them with a tracked profile. Lighting, humidity,
material ageing and physical colour measurements are not automatically measured.
Generated colour projects refuse different preferred heights across tools.

## What the numbers mean

Job time/grams come from engine metadata and remain unknown when missing. The
file inspector separately labels nominal distance/speed time, excluding heating,
acceleration, pauses and macros. Its length-derived weight states the 1.75 mm
filament/reference-density assumptions. Retraction recovery does not add new
filament. Preview sampling is disclosed; full pre-flight checks every instruction.
See [current evidence](slicer-workspace-validation.md) and
[app-data recovery](backup-and-recovery.md).
