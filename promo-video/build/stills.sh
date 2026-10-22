#!/usr/bin/env bash
# Exports the marketing feature cards: one still per beat of the launch film's story (the problem, what it is
# for, how it works, the seven features and the phone, the rest, why trust it, get started), taken at the moment its caption and callouts are all on screen, in both shapes,
# plus the opening (what the app is for), the title and the end card. Replaces every card in the folder.
# Run after rendering both cuts to renders/main.mp4 and renders/vertical.mp4. Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing; version 8, from build.py SEG: each just before its feature ends)
CARDS="00-the-problem:2.8 00-what-it-is-for:6.2 00-title:8.2 01-how-it-works:15.0 02-every-printer-live:19.8 03-needs-you:24.3 04-confirm-print:29.5 04b-on-your-phone:32.5 05-files-for-the-u1:37.05 06-prepare-and-slice:42.3 07-digital-twin:47.55 08-automations:52.8 09-and-plenty-more:58.8 10-why-trust-it:61.9 11-get-started:68.6 12-get-it:74.6"
# Version 6: taken from the finished renders (exact), not from snapshots (which can be off).
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$ROOT/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
