# Preparing a model and making a print file

A model describes a shape. A slicer turns it into G-code: the movement,
temperature and extrusion instructions the printer follows. A preview is not a
slicer, and passing the dashboard's checks is not a guarantee of a safe print.

## Model preparation available now

**Plate workspace:** source geometry stays immutable; edits are separate
position/rotation/scale matrices. Add STL, 3MF or triangular OBJ files, select
objects by name, move their centre/bottom numerically, rotate by any angle,
scale, mirror, duplicate, arrange with 5 mm spacing, undo/redo and drop to bed.
Lay-flat uses the largest triangle's face, not an automatic support optimiser.
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

The G-code inspector steps through actual extrusion heights, optionally isolates
one layer, filters tools and colours by tool, requested speed or file feature
labels. Yellow dots are tool changes; pink dots are retractions. Missing labels
are shown as unspecified. File-derived nominal motion time is distance/speed,
with no allowance for acceleration, heating, macros or pauses. Slicer-reported
time remains labelled separately. Retraction recovery does not add new filament.

Open **Files**, upload a model and open its preview. STL and 3MF are supported;
OBJ support reads triangular geometry only. Export an OBJ with triangulated faces
from its authoring program if it contains polygons. OBJ textures and material
files are not loaded. Dimensions use millimetres, so check the size of unitless
STL/OBJ exports before slicing.

- Drag to orbit; scroll or pinch to zoom. Hold Shift or select **Pan** to move
  the view. **Pan** moves the view, not the model on the plate.
- Use **Rotate X/Y/Z 90°** or enter **Scale %** and choose **Apply scale**.
  Transforms centre the shape on the bed and put its lowest point at bed height.
- The measured dimensions come from the model's geometry. The fit message checks
  dimensions against 270 × 270 × 270 mm. It does not detect overlap, toolhead
  collisions, unsupported overhangs or unsafe print paths.
- **Download prepared STL** saves a geometry-only copy. **Save prepared copy to
  Files** is available for server-library models and leaves the original alone.
  STL drops colour, texture and tool assignments; set those again in the slicer.
- **Reset** returns to the model as opened. The existing AR preview still uses
  the original model, so do not use it to verify edited dimensions.

The G-code viewer already offers layers, tool colours and travel/extrusion views.
Times and filament quantities shown from a file are supplied or estimated by
that file's slicer metadata. Missing values must remain unknown. Visual colour
is not a calibrated prediction of physical filament appearance.

## Recommended slicing route: locally installed OrcaSlicer

## Images and heightmaps

In **Photo Studio → From image to print project**, choose a photo or the test
image. **Colour tiles** selects among the four saved tool colours. Optional
dithering spreads colour differences across neighbouring tiles; it does not mix
filament inside the nozzle. The output includes a backing and closed tile solids.
Cell width must be at least two of the widest selected nozzle widths.

For **Layered colour**, build the sixteen-swatch sheet, slice at the displayed
layer thickness, print it, then record each measured tile colour in row order.
Confirm the measurements came from your printed swatches. The app stores them
for that exact tool/spool/nozzle setup and thickness. The layered workflow then
chooses among those measured four-layer recipes. Nothing here measures colour
automatically or promises physical matching without a printer check.

**Heightmap relief** makes lighter pixels higher and closes the mesh with a
flat bottom and side walls. Width and relief height are explicit millimetres;
there is no geographical scale or elevation lookup. Save the generated model,
open it in the plate workspace and slice to obtain engine-derived quantities.

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
options were checked in the [official source](https://github.com/SoftFever/OrcaSlicer/blob/5a36120c588100e6bff01fa595e18de83ca67af2/src/OrcaSlicer.cpp),
[option definitions](https://github.com/SoftFever/OrcaSlicer/blob/5a36120c588100e6bff01fa595e18de83ca67af2/src/libslic3r/PrintConfig.cpp)
and [licence](https://github.com/SoftFever/OrcaSlicer/blob/5a36120c588100e6bff01fa595e18de83ca67af2/LICENSE.txt).

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
4. Add a profile using the machine, process and up to four filament JSON preset
   files from your installation. JSON is a text format for structured settings.
   These must be complete presets accepted by that Orca version, not fragments
   whose missing values depend on an unresolved parent. The current form checks
   basic file structure, not all inherited settings; this is still an advanced
   setup step. If a preset fails, use Orca's own interface until compatibility is
   resolved. Do not guess missing tool/nozzle settings.
5. Select an STL or 3MF in the pipeline, choose that profile and **Slice**.
   To use an OBJ, first save it as prepared STL. Inspect the resulting G-code,
   pre-flight report and tool assignments. **Slice and queue** puts successful
   output in the queue; it is not permission to skip the printer's checks.
6. Start only after checking the physical bed, toolheads and filaments. Confirm
   Print rechecks the file and printer state before sending it.

The bridge has a timeout, reports engine errors, checks that actual G-code was
produced and records the engine version. Its automated tests use a stand-in
executable. **A real OrcaSlicer install has not been exercised here.** Do not
advertise this as a proven beginner slicing workflow yet.

A full native preset editor, plate assembly, tool painting and mixed-nozzle
slicing are future work. The existing mixed-nozzle planner is arithmetic, not
an implementation of mixed-nozzle slicing. A browser-only engine compiled to
WebAssembly would require a separate build, dependency and licence investigation;
none has been built or benchmarked. Keeping the real engine separate is the
smallest practical path for now.
