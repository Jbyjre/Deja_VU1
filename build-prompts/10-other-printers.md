# Note: other printers (planning only, nothing built)

The owner (24 October 2026) wants to start supporting printers beyond the
Snapmaker U1, especially ones with ordinary hardware that already work, or
could be made to work, with this app. This is a note for a later session,
not a request to build it now.

## Why it is close

Deja Vu1 talks to the U1 through **Moonraker**, the same web interface most
Klipper printers use. `backend/moonraker_client.py` already speaks plain
Moonraker (status subscription, history, file upload and download, print
start, pause, cancel, G-code). Most of the dashboard (live status, history,
insights, maintenance, logbook, queue, pre-flight, Confirm Print, files,
safety copies, updates) does not care which printer is on the other end.

## What is U1-specific today (would need a printer profile)

- Four toolheads named `extruder` to `extruder3`, with dock "park sensor"
  states and `print_task_config` (moonraker_client `_toolheads`).
- The 270 x 270 x 270 mm volume in the pre-flight (`gcode_tools`), the
  print gate and the 3D viewer's plate (276 x 293 mm).
- The 3D twin and drawing (`twin3d.js`, `twin3d-scene.js`) model the U1 only.
- Nozzle layer limits from Snapmaker's Orca profiles (`layer-stack.js`,
  `layer_planner.py`, `slicing_contract.py`).
- Sample files, the demo farm and the converter target the U1.

A "printer profile" (name, volume, heads, nozzle limits, plate shape, a
simple generic twin) read from the printer's own Klipper config where
Moonraker exposes it (`printer.objects.query configfile`) would cover most
of this. Keep the U1 as the default and the reference.

## Candidates to research (none verified here)

Check each against the maker's own documentation and a real machine before
claiming support. A third-party guide (SimplyPrint) suggests:
- Elegoo Neptune 4 series and some Qidi models ship Klipper with Moonraker,
  but some run an older, locked-down Moonraker that can't be updated;
  check which API version they answer with (`/server/info`).
- Sovol SV07 / SV08 have Klipper set-up guides; confirm the stock firmware.
- Creality K1 family: not confirmed by that search; reportedly needs extra
  steps for Moonraker. Verify before listing.
- Self-built Klipper machines (Voron and similar) run standard Moonraker.

Printers that do not run Moonraker (Bambu Lab, Prusa, Snapmaker J1/A-series)
would need a different connection module and are a bigger job.

## Suggested shape of the work

1. Read a connected printer's config through Moonraker and build a profile
   from it; show "Untested printer" until a real owner confirms it.
2. Make the pre-flight and gate use the profile's volume and heads.
3. A plain, honest generic twin for non-U1 printers.
4. Test against `tests/fake_moonraker.py` extended with a second machine.

Sources for the candidate list: [SimplyPrint, Elegoo Neptune Klipper
guide](https://simplyprint.io/setup-guide/elegoo/neptune/klipper-powered),
[SimplyPrint, Sovol SV08 Klipper guide](https://simplyprint.io/setup-guide/sovol/sv08/klipper-powered),
[SimplyPrint, Qidi X-Plus Klipper guide](https://simplyprint.io/setup-guide/qidi-tech/x-plus/klipper-powered).
