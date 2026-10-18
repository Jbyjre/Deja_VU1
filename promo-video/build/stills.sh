#!/usr/bin/env bash
# Exports the marketing feature cards: one still per feature of the launch film (all 12, and
# the phone), taken at the moment its caption and callouts are all on screen, in both shapes,
# plus the opening (what the app is for), the title and the end card. Replaces every card in the folder.
# Run after rendering both cuts to renders/main.mp4 and renders/vertical.mp4. Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing; version 8, from build.py SEG: each just before its feature ends)
CARDS="00-what-it-is-for:3.6 00-title:5.0 01-every-printer-live:10.8 02-needs-you:15.3 03-confirm-print:20.5 03b-on-your-phone:23.4 04-files-for-the-u1:28.05 05-skip-one-object:33.3 06-digital-twin:38.55 07-automations:43.8 08-maintenance:48.3 09-filament-and-spoolman:52.8 10-print-cost:56.55 11-home-assistant:61.05 12-ten-games:66.3 13-get-it:74.6"
# Version 6: taken from the finished renders (exact), not from snapshots (which can be off).
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$ROOT/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
