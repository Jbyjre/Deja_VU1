#!/usr/bin/env bash
# Exports the marketing feature cards: one still per feature of the launch film (all 15, and
# the phone), taken at the moment its caption and callouts are all on screen, in both shapes,
# plus the icon opening, the title and the end card. Replaces every card in the folder.
# Run after rendering both cuts to renders/main.mp4 and renders/vertical.mp4. Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing)
CARDS="00-every-feature:2.35 00-title:4.9 01-every-printer-live:12.5 02-needs-you:18.9 03-confirm-print:23.6 03b-on-your-phone:27.9 04-files-for-the-u1:34.4 05-skip-one-object:43.4 06-digital-twin:47.5 07-photo-studio:59.9 08-automations:66.4 09-maintenance:72.4 10-filament-and-spoolman:78.9 11-print-cost:84.9 12-home-assistant:91.4 13-time-lapse:97.2 14-ar-preview:103.3 15-ten-games:109.4 16-get-it:119.6"
# Version 6: taken from the finished renders (exact), not from snapshots (which can be off).
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$ROOT/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
