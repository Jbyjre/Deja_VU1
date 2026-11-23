"""
Run the Moonraker stand-in (tests/fake_moonraker.py, a pretend printer, not a real U1) as its own process, for the browser checks.

    python3 tests/fake_moonraker_serve.py [seconds to wait after each 64 KB of a video]

It serves six 4 MB videos (camera/v1.mp4 to v6.mp4), prints its address on the first line and runs until its standard input closes.
A line of JSON on standard input changes its state as the real printer would on its own, for a browser check that needs a printer in a
particular situation: {"set": ["virtual_sdcard", {"pl_env_valid": true}]} (Klipper's status objects),
{"raise": [level, id, index, number, "message"]} (a problem the way the U1 reports one), {"clear": [id, index, number]}, {"print": "name.gcode"} (starts a print),
{"finish": 1} (the print is complete). A line that is not understood is ignored.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))

from fake_moonraker import FakeMoonraker   # noqa: E402


def command(fake, cmd):
    if "set" in cmd:
        fake.set(cmd["set"][0], **cmd["set"][1])
    elif "raise" in cmd:
        level, ident, index, number, message = cmd["raise"]
        fake.raise_exception(level, ident, index, number, message, oneshot=False)
    elif "clear" in cmd:
        fake.clear_exception(*cmd["clear"])
    elif "print" in cmd:
        fake.begin_print(cmd["print"])
    elif "finish" in cmd:
        fake.set("print_stats", state="complete")
        fake.set("virtual_sdcard", is_active=False, progress=1.0)


def main():
    fake = FakeMoonraker()
    for number in range(1, 7):
        fake.videos[("camera", "v%d.mp4" % number)] = b"\x00\x00\x00\x18ftypmp42" + bytes(4 * 1024 * 1024)
    fake.video_chunk_delay = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1
    print(fake.url, flush=True)
    try:
        for line in sys.stdin:
            try:
                command(fake, json.loads(line))
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
    finally:
        fake.close()


if __name__ == "__main__":
    main()
