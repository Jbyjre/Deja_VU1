#!/usr/bin/env bash
# Exports the marketing feature cards: one still per beat of the launch film's story (version 13: the problem,
# the answer, how it works, the six features and the phone, the rest, why trust it, the end card), taken at the
# moment its caption and callouts are all on screen, in both shapes. Replaces every card in the folder.
# Run after rendering both cuts to renders/main.mp4 and renders/vertical.mp4. Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing; version 13, from build.py: each where its words and callouts are on screen)
CARDS="00-the-problem:6.2 00-the-answer:9.0 01-how-it-works:13.4 02-every-printer-live:18.7 03-needs-you:22.9 04-confirm-print:28.4 04b-on-your-phone:31.0 05-prepare-and-slice:36.9 06-digital-twin:41.9 07-automations:47.7 08-and-plenty-more:51.2 09-why-trust-it:53.6 10-get-it:59.5"
# Version 6: taken from the finished renders (exact), not from snapshots (which can be off).
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$ROOT/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
