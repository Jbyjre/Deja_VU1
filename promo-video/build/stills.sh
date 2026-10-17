#!/usr/bin/env bash
# Exports the marketing feature cards: one still per feature of the launch film (all 12, and
# the phone), taken at the moment its caption and callouts are all on screen, in both shapes,
# plus the icon opening, the title and the end card. Replaces every card in the folder.
# Run after rendering both cuts to renders/main.mp4 and renders/vertical.mp4. Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing; version 8, from build.py SEG: each just before its feature ends)
CARDS="00-every-feature:1.55 00-title:2.95 01-every-printer-live:8.6 02-needs-you:13.2 03-confirm-print:18.6 03b-on-your-phone:21.2 04-files-for-the-u1:25.9 05-skip-one-object:31.4 06-digital-twin:37.7 07-automations:43.2 08-maintenance:47.7 09-filament-and-spoolman:52.3 10-print-cost:55.9 11-home-assistant:60.4 12-ten-games:65.9 13-get-it:74.6"
# Version 6: taken from the finished renders (exact), not from snapshots (which can be off).
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$ROOT/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
