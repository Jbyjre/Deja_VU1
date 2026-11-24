#!/bin/sh
# Deja Vu1: double-click to start the dashboard. It stops by itself 5 minutes after its last page closes, and never starts with the computer.
cd "$(dirname "$0")" || exit 1
if python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then
  exec python3 start.py
fi
echo
echo "Deja Vu1 couldn't start: it needs Python 3.8 or newer, a free program from python.org."
echo "1. If macOS just offered to install its command line developer tools, press Install and wait. That includes Python."
echo "   Otherwise open https://www.python.org/downloads/ , press the yellow Download button and run the installer."
echo "2. Double-click this file again."
printf 'Press Return to close this window. '
read -r _
exit 1
