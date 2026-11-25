#!/bin/sh
# Deja Vu1: start the dashboard (or run: python3 start.py). It stops by itself 5 minutes after its last page closes, and never starts with the computer.
cd "$(dirname "$0")" || exit 1
if python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then
  exec python3 start.py
fi
echo
echo "Deja Vu1 couldn't start: it needs Python 3.8 or newer."
echo "Install it with your system's software centre, or in a terminal (Ubuntu, Debian, Mint, Raspberry Pi OS):"
echo "  sudo apt install python3"
echo "Then start Deja Vu1 again."
exit 1
