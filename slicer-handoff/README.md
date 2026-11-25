# Send from your slicer to Deja Vu1

Keep slicing in Snapmaker Orca or OrcaSlicer. With this small script set up once, every G-code file you export is
also copied to Deja Vu1, where it waits in Files for Confirm Print: the heads, the filament, the plate and your plugins'
house rules are checked before it prints.

The script changes nothing in the exported file, and if Deja Vu1 isn't running your export still finishes; the
script only says it couldn't reach Deja Vu1.

## Set it up (once)

1. Have Python 3 on the computer (the same one Deja Vu1 uses).
2. In the slicer, open the process settings and find **Others › Post-processing scripts**.
3. Type the path to Python, a space, then the path to `send_to_dejavu1.py` in this folder, each in quotes:

   Windows:
   ```
   "C:\Users\you\AppData\Local\Programs\Python\Python312\python.exe" "C:\Users\you\Deja_VU1\slicer-handoff\send_to_dejavu1.py";
   ```
   macOS or Linux:
   ```
   /usr/bin/python3 /home/you/Deja_VU1/slicer-handoff/send_to_dejavu1.py;
   ```
4. Save the process preset, slice and export as usual.

Add `--open` before the file path to open Deja Vu1's Files screen after each export, and `--to http://ADDRESS:8000`
if Deja Vu1 runs on another computer on your network (add that computer's name to `DEJAVU_ALLOWED_HOSTS` there).

## Check it by hand

```
python3 send_to_dejavu1.py some-export.gcode
```

It prints `Deja Vu1: Sent some-export.gcode to Deja Vu1...` when it worked, and the reason when it didn't.

## What has been checked

The script was run by hand against Deja Vu1 (a file arrived in Files, and a closed address gave its message and no
error). It has not yet been run from inside Snapmaker Orca or OrcaSlicer; the setup steps follow the slicers'
documented post-processing field, which hands the script the exported file's path as its last word.
