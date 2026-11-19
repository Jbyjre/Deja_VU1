"""
Run the Moonraker stand-in (tests/fake_moonraker.py, a pretend printer, not a real U1) as its own process, for the browser checks.

    python3 tests/fake_moonraker_serve.py [seconds to wait after each 64 KB of a video]

It serves six 4 MB videos (camera/v1.mp4 to v6.mp4), prints its address on the first line and runs until its standard input closes.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))

from fake_moonraker import FakeMoonraker   # noqa: E402


def main():
    fake = FakeMoonraker()
    for number in range(1, 7):
        fake.videos[("camera", "v%d.mp4" % number)] = b"\x00\x00\x00\x18ftypmp42" + bytes(4 * 1024 * 1024)
    fake.video_chunk_delay = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1
    print(fake.url, flush=True)
    try:
        sys.stdin.read()
    finally:
        fake.close()


if __name__ == "__main__":
    main()
