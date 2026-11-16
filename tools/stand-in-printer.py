#!/usr/bin/env python3
"""
A stand-in Moonraker for trying Deja Vu1 without a printer, and for the browser checks.

    python3 tools/stand-in-printer.py

It prints an address such as http://127.0.0.1:41873 and answers like a U1's Moonraker until you press
Ctrl+C. In Deja Vu1, open Printers, add a printer and paste that address. It is the same stand-in the test
suite uses (tests/fake_moonraker.py), so what you see is what the tests exercise: it is a pretend printer,
not a real one, and nothing it shows is a measurement.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "backend"))

from tests.fake_moonraker import FakeMoonraker  # noqa: E402


def main():
    fake = FakeMoonraker()
    print(fake.url, flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        fake.close()


if __name__ == "__main__":
    main()
