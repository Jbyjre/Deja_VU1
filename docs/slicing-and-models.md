# Prepare, slice and inspect a plate

A model describes a shape. A slicing engine turns it into G-code: the movement,
heating and extrusion instructions a printer follows. The viewer and nozzle
calculator do not create those instructions.

## One workspace

Open an STL, triangular OBJ or 3MF in Files. **Prepare** has an object list,
precise position/rotation/scale, duplicate, arrange, mirror, lay-flat, drop,
contact checks and surface measurement. Click a model to select it, or use the
keyboard in the object list. Arrange frames the moved objects automatically.
The selected object shows its base physical tool; source paint can override it.

**Profiles & tools** uses the same saved tool assignments and profile editor as
Auto-print. **Slice plate** saves a new source-preserving 3MF, then starts the
local engine. The original remains intact. A slice has named stages, cancellation
and actual output validation; no fabricated percentage is shown.

**Preview** inspects that output, with a layer slider, direct layer number,
previous/next, one-layer mode, travel visibility, tool/speed/feature colours,
legends and event markers. On phones, optional display controls fold away and
settings replace the viewport. Editing the plate or changing its profile
invalidates the preview. A result from an earlier revision stays in the library.
Open the result to inspect pre-flight and enter **Confirm Print**. Queueing never
starts a print or bypasses Confirm Print. Blocked output remains inspectable and
never enters the automatic queue handoff.

## Install and select an external engine

No engine, engine presets or Linux libraries are bundled or downloaded by the
app. Use an independently installed Orca-compatible program with U1 presets.
The current verified specialised Linux build identifies itself as
**Snapmaker_Orca 02.08.01.55**. The owner's delivery report identifies the exact
release and source. Stock OrcaSlicer 2.4.2 remains a shared-height route; its
historical successful slices do not prove per-head support.

1. Install and open your engine normally. First verify its own U1 setup.
2. Enable **Auto-print pipeline** and **Filament inventory** in Settings.
3. Save the fitted T0–T3 nozzles, materials, colours, preferred heights and
   explicit spool identities. These records do not change fitted hardware.
4. Enter the full engine program path and **Check slicer**. The check reads its
   actual version/help and, where available, exported option schema. Changing the
   executable invalidates its capability result. Schema recognition is not a
   claim that every geometry or platform has been tested.
5. **Find installed U1 profiles**. Some engine builds package presets in an opaque
   cache. For those, select a matching unpacked profiles folder containing
   `Snapmaker/`, or use complete exported JSON files in advanced setup. The app
   does not download or unpack proprietary engine caches. Linux validation used
   matching source presets outside this repository. Normal Windows/macOS setup
   remains unverified. The Linux build needed WebKitGTK 4.1, JavaScriptCore and
   mspack runtime libraries; follow the engine's installation requirements.
6. Select printer, process and four material presets. Review compatibility;
   explicitly acknowledge using another U1 nozzle/material variant where needed.
   Save a new named profile. Installed files stay intact. Internal working copies
   live in application storage and enter app-data backups.

Quality/shells, infill, support/adhesion, speed and per-material temperature,
flow/cooling groups expose validated engine options. Blank numeric overrides
inherit their installed preset. Unsupported inherited values are preserved;
unsupported edits are refused. Cooling enablement and bed-type selection still
come from the resolved presets. Smooth-plate temperature fields apply only to
that bed type. Edit-as-new keeps the previous profile for recovery. External
exported preset paths remain external resources and must be backed up separately.

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
