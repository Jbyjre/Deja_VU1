#!/usr/bin/env bash
# Version 15 (V2 updated): exports its marketing feature cards, one still per beat of the
# film, taken at the moment its caption and callouts are all on screen, in both shapes.
# Run after rendering both cuts to v15/renders/main.mp4 and v15/renders/vertical.mp4. Writes JPEGs
# to marketing-library/08-feature-cards/v2-60s/ and replaces only the cards in that folder (the
# cards beside it belong to the other versions and are left alone).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; V15="$(dirname "$HERE")"
OUT="$(dirname "$(dirname "$V15")")/marketing-library/08-feature-cards/v2-60s"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing; from build.py SEG, each just before its beat ends)
CARDS="00-the-problem:6.2 00-the-answer:9.0 01-how-it-works:13.4 02-every-printer-live:17.9 03-needs-you:22.1 04-confirm-print:27.7 04b-on-your-phone:30.3 05-prepare-and-slice:35.4 06-digital-twin-3d-model:40.4 06b-digital-twin-drawing:42.9 07-automations:48.7 08-and-plenty-more:51.25 09-why-trust-it:53.8 10-get-it:59.5"
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$V15/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
