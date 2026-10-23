#!/usr/bin/env bash
# Version 14 (V1 re-cut to 60 s): exports its marketing feature cards, one still per beat of the
# film, taken at the moment its caption and callouts are all on screen, in both shapes.
# Run after rendering both cuts to v14/renders/main.mp4 and v14/renders/vertical.mp4. Writes JPEGs
# to marketing-library/08-feature-cards/v1-60s/ and replaces only the cards in that folder (the
# cards beside it belong to version 13 and are left alone).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; V14="$(dirname "$HERE")"
OUT="$(dirname "$(dirname "$V14")")/marketing-library/08-feature-cards/v1-60s"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (both cuts share the same timing; from build.py SEG, each just before its beat ends)
CARDS="00-the-problem:2.6 00-what-it-is-for:6.2 00-title:8.0 01-how-it-works:13.6 02-every-printer-live:17.5 03-needs-you:21.3 04-confirm-print:25.6 04b-on-your-phone:28.7 05-prepare-and-slice:34.0 06-digital-twin-3d-model:39.3 06b-digital-twin-drawing:43.0 07-automations:47.5 08-and-plenty-more:50.5 09-why-trust-it:52.9 10-get-it:59.5"
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  for c in $CARDS; do
    ffmpeg -loglevel error -y -ss "${c#*:}" -i "$V14/renders/$fmt.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-$suffix.jpg"
  done
done
ls -1 "$OUT" | wc -l
