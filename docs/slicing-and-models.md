# Preparing a model and making a print file

A model describes a shape. A slicer turns it into G-code: the movement,
temperature and extrusion instructions the printer follows. A preview is not a
slicer, and passing the dashboard's checks is not a guarantee of a safe print.

## Model preparation available now

**Plate workspace:** source geometry stays immutable; edits are separate
position/rotation/scale matrices. Add STL, 3MF or triangular OBJ files, select
objects by name, move their centre/bottom numerically, rotate by any angle,
scale, mirror, duplicate, arrange with 5 mm spacing, undo/redo and drop to bed.
Lay-flat uses the broadest coplanar surface, not an automatic support optimiser.
Surface measurement uses actual ray/triangle intersections. Mesh contact and
measurement run off the browser's main thread, capped at 250,000 triangles per
object; the visual workspace allows two million triangles total.

Save a **new 3MF plate** to Files or save and open slicing. Original 3MF model,
property and texture parts are relocated into separate source folders, and
untouched original input files are included for recovery. Current base-tool and
object wall/infill choices are written into project settings. Inspect complex
imported per-part settings in Orca; not every vendor extension is interpreted
by the dashboard. The preview supports core material colours, colour groups,
simple whole-face paint and OBJ vertex colours. Texture images and subdivided
face paint are kept in source data but not fully rendered. Geometry STL export
is explicitly shape-only. AR still uses the original source model.

Reopening a native saved plate restores its individual objects and transforms
from the embedded original files, even if their old library entries are gone.
OBJ vertex colours in the `v x y z r g b` form are converted to standard 3MF
colour groups when saving. External OBJ material/texture files remain unsupported.

The G-code inspector steps through layers in file order, including sequential objects whose height resets, optionally isolates
one layer, filters tools and colours by tool, requested speed or file feature
labels. Yellow dots are tool changes; pink dots are retractions. Missing labels
are shown as unspecified. File-derived nominal motion time is distance/speed,
with no allowance for acceleration, heating, macros or pauses. Slicer-reported
time remains labelled separately. Retraction recovery does not add new filament.

## Images and heightmaps

In **Photo Studio → From image to print project**, choose a photo or the test
image. **Colour tiles** selects among the four saved tool colours. Optional
dithering spreads colour differences across neighbouring tiles; it does not mix
filament inside the nozzle. The output includes a backing and closed tile solids.
Cell width must be at least two of the widest selected nozzle widths.

For **Layered colour**, build the sixteen-swatch sheet, slice at the displayed
layer thickness, print it, then record each measured tile colour in row order.
Confirm the measurements came from your printed swatches. The app stores them
for that exact printer/tool/spool/nozzle setup and thickness. Both first and subsequent layers must match the generated thickness; the bridge refuses a mismatch. Keep the same process and material settings, especially temperatures and flow, for swatches and images. Backing thickness rounds up to a whole number of layers. The layered workflow then
chooses among those measured four-layer recipes. Nothing here measures colour
automatically or promises physical matching without a printer check.

**Heightmap relief** makes lighter pixels higher and closes the mesh with a
flat bottom and side walls. Width and relief height are explicit millimetres;
there is no geographical scale or elevation lookup. Save the generated model,
open it in the plate workspace and slice to obtain engine-derived quantities.

## Local slicing setup

**Verified engine path:** OrcaSlicer 2.4.2 on Linux has sliced the sample bracket
through this bridge, using its own resolved U1 presets. Output: 125 layers,
6.62 g and 0.231 hours from the engine; Deja Vu1 pre-flight was clear. This
does not verify a physical print, other operating systems or arbitrary projects.

**Beginner profile setup:** in Auto-print, load and save **Tools & filaments**,
then choose **Find installed U1 profiles**. Pick matching printer, quality and
four material presets by name. Set layer height, walls, infill and supports;
more settings expose speeds and shell counts. Save a new named profile. The
app resolves parent presets from the installed engine and writes private working
copies; it never edits the installation. The saved nozzles and colours feed
those copies. Changing tool preparation requires a new profile. All heads use
the selected common layer height, validated through the nozzle planner.

Use a separately installed OrcaSlicer with known-compatible U1 presets. Deja Vu1
runs its command line as a child program; it does not include a slicing engine,
download one automatically or send the model to a cloud slicer. OrcaSlicer's
root licence is AGPL-3.0; packaging, modifying or distributing it would require
its own licence review. This app does not bundle it. The current command-line
options were checked in the [official source](https://github.com/OrcaSlicer/OrcaSlicer/blob/8500fcdccaa10b5099ac20d252af3a7c560046f1/src/OrcaSlicer.cpp),
[option definitions](https://github.com/OrcaSlicer/OrcaSlicer/blob/8500fcdccaa10b5099ac20d252af3a7c560046f1/src/libslic3r/PrintConfig.cpp)
and [licence](https://github.com/OrcaSlicer/OrcaSlicer/blob/8500fcdccaa10b5099ac20d252af3a7c560046f1/LICENSE.txt).

1. Install OrcaSlicer from its official project and first slice a small U1 model
   in its own interface. Confirm your printer, nozzle and material presets there.
2. In Deja Vu1 **Settings → Modules**, enable **Auto-print pipeline**. Then open
   **Files → Auto-print pipeline**. Automatic here means preparation can be queued;
   Confirm Print still applies before a print starts.
3. **Check slicer**. Deja Vu1 searches normal program paths, including the macOS
   app path and the usual Windows Program Files location. If it cannot find it,
   enter the full program path. `DEJAVU_SLICER_PATH`, if set by the computer owner,
   takes priority over the saved path. A downloaded Linux AppImage may need to be
   made executable and its full path entered.
4. Enable **Filament inventory** and save the four-tool setup in Auto-print.
   Add only spools you own and have weighed; a new inventory starts empty.
   Choose **Find installed U1 profiles**, then matching printer/nozzle, quality
   and material presets by name. Save a named profile. More print settings
   expose shell counts, infill pattern and speeds. Advanced setup still accepts
   complete exported preset files; it does not resolve those files' parents.
5. Select an STL or 3MF, choose the saved profile and **Slice**. Save edited or
   OBJ models as a new 3MF plate first. Inspect the resulting G-code, pre-flight
   and tool assignments. **Slice and queue** puts successful output in the queue;
   it never starts a printer or skips Confirm Print.
6. Start only after checking the physical bed, toolheads and filaments. Confirm
   Print rechecks the file and printer state before sending it.

The bridge has a timeout, reports engine errors, checks for actual printable
G-code and records the engine version. Portable unit tests use a stand-in
executable; the Linux integration checks ran real OrcaSlicer 2.4.2. Tested
examples include a bracket, a two-object T0/T1 plate, all-four-tool colour tiles,
a calibration sheet and a heightmap relief. All passed pre-flight. Physical
printing, Windows/macOS, arbitrary imported extensions and physical colour
accuracy remain unverified.

## Engine choice and limits

The application runs the separately installed engine as a child program. It
neither imports engine libraries nor bundles/downloads engine binaries or presets.
Installed preset working copies are created only on the user's computer. Orca's
AGPLv3 text permits running the unmodified program (section 2) and discusses
separate independent works (section 5). This is a technical integration decision,
not a legal opinion about future packaging; bundling or modifying an engine
requires a fresh review.

No working WebAssembly slicing build was verified. A browser engine would need
its own build, licence, memory, cancellation and output-parity investigation.
No new pure-Python slicing engine was written: the existing nozzle planner is
arithmetic, and the renderer/contact worker are previews and geometry checks.
The installed mature engine is the verified route to real movement instructions.

The native editor covers the common requested print settings, not every setting
Orca exposes. Mixed nozzle sizes are passed to the engine after checking the
installed printer variant and the shared layer-height limits. Different preferred
heights per head are not implemented by the stock-engine path; use a separately
verified specialised engine for that. Multi-plate import editing, full subdivided
face painting, automatic support design, sequential-head clearance and all
vendor-specific per-part settings are not complete.

### Verified limits from the expanded engine checks

The four-tool generated geometry is one multipart object, preserving the vertical position of each colour layer. Orca 2.4.2 has sliced a layered-image fixture with synthetic calibration values; that verifies geometry and tool handling, not physical colour accuracy. Mixed 0.4/0.6 mm nozzle preparation feeds real machine settings and limits bridge width to the smallest nozzle. Material presets listed for another U1 nozzle variant require explicit temperature/flow review. A real mixed-nozzle slice computed eight layers, but its installed machine preset emitted startup extrusion at X290 and was blocked by the 270 mm pre-flight check. Do not print that result or bypass the check; use a hardware-verified U1 startup preset. Different preferred layer heights per head remain unsupported.

Converted single-plate Bambu-style and Elegoo-style fixtures sliced with installed U1 settings. The converted three-plate fixture crashed Orca 2.4.2 (signal 11); no output was accepted. Open and verify multi-plate projects in Orca, or export each plate separately. Full vendor preset/paint compatibility is not claimed.
