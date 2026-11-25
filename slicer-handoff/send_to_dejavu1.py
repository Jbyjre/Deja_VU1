#!/usr/bin/env python3
"""
Send the G-code your slicer just exported to Deja Vu1, so it waits in Files for Confirm Print.

Snapmaker Orca, OrcaSlicer and the other slicers of that family run a post-processing script after each export and
hand it the path of the G-code file as the last word of the command. Put this script there (README.md in this folder
says where). It copies the file to Deja Vu1 on this computer, or on the address you give with --to, and changes
nothing in the file, so the export itself is never altered.

    python3 send_to_dejavu1.py [--to http://localhost:8000] [--open] FILE.gcode

If Deja Vu1 isn't running or refuses the file, the script says why and still ends without an error, so your export
always finishes. Standard-library Python only.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

DEFAULT = os.environ.get("DEJAVU_URL", "http://localhost:8000")


def parse(argv):
    """(address, open_after, path) from the command line; the path is the last word, as the slicer adds it."""
    address, open_after, rest = DEFAULT, False, []
    words = list(argv)
    while words:
        word = words.pop(0)
        if word == "--to" and words:
            address = words.pop(0)
        elif word == "--open":
            open_after = True
        else:
            rest.append(word)
    return address.rstrip("/"), open_after, (rest[-1] if rest else "")


def file_name(path):
    """The name the file gets in Deja Vu1: the slicer's final name when it says it, else the file's own."""
    final = os.environ.get("SLIC3R_PP_OUTPUT_NAME") or path
    name = os.path.basename(final.replace("\\", "/"))
    if not name.lower().endswith(".gcode"):
        name = os.path.splitext(name)[0] + ".gcode"
    return name


def send(address, path):
    """Upload the file. Returns (ok, words for the person)."""
    if not path or not os.path.isfile(path):
        return False, f"No G-code file to send (got {path!r}). The slicer adds the file's path at the end by itself."
    with open(path, "rb") as f:
        data = f.read()
    name = file_name(path)
    url = f"{address}/api/files/upload?name={urllib.parse.quote(name)}"
    request = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as err:
        try:
            reason = json.loads(err.read()).get("error") or err.reason
        except ValueError:
            reason = err.reason
        return False, f"Deja Vu1 refused {name}: {reason}"
    except (urllib.error.URLError, OSError) as err:
        return False, f"Deja Vu1 isn't answering at {address} ({getattr(err, 'reason', err)}). Start it and export again."
    saved = body.get("name", name) if isinstance(body, dict) else name
    return True, f"Sent {saved} to Deja Vu1. Open Files in Deja Vu1 to check it with Confirm Print and print it."


def main(argv=None):
    address, open_after, path = parse(sys.argv[1:] if argv is None else argv)
    ok, words = send(address, path)
    print(("Deja Vu1: " if ok else "Deja Vu1 hand-off: ") + words, file=sys.stdout if ok else sys.stderr)
    if ok and open_after:
        webbrowser.open(f"{address}/#/files")
    return 0          # never fail the slicer's export


if __name__ == "__main__":
    sys.exit(main())
