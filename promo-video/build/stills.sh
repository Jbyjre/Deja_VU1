#!/usr/bin/env bash
# Exports the marketing feature cards: one still per feature of the launch film (all 13, and
# the phone), taken at the moment its caption and callouts are all on screen, in both shapes,
# plus the icon opening, the title and the end card. Replaces every card in the folder.
# Run after rendering both cuts to renders/main.mp4 and renders/vertical.mp4. Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing)
CARDS="00-every-feature:1.98 00-title:3.85 01-every-printer-live:10.4 02-needs-you:16.0 03-confirm-print:19.6 03b-on-your-phone:23.8 04-files-for-the-u1:29.9 05-skip-one-object:36.5 06-digital-twin:39.0 07-photo-studio:48.4 08-automations:53.4 09-maintenance:58.4 10-filament-and-spoolman:63.95 11-print-cost:68.9 12-home-assistant:74.3 13-ten-games:80.0 14-get-it:89.6"
# Version 6: taken from the finished renders (exact), not from snapshots (which can be off).
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$ROOT/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
