"""The copy-and-paste blocks. The one source is backend/paste_blocks.py, which
travels with every update; this file keeps the old names for the tests and the
docs. README, getting started, the product page, Settings and the offline page
show these exact lines (tests/test_install_blocks.py).
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
from paste_blocks import ASSET, START_BASH, START_POWERSHELL, UPDATE_BASH, UPDATE_POWERSHELL  # noqa: E402

POWERSHELL = UPDATE_POWERSHELL
BASH = UPDATE_BASH
__all__ = ['ASSET', 'POWERSHELL', 'BASH', 'START_POWERSHELL', 'START_BASH']

if __name__ == '__main__':
    print(POWERSHELL, BASH, START_POWERSHELL, START_BASH, sep='\n\n')
