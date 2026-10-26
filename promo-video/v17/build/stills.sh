#!/usr/bin/env bash
# Version 17 (16:9 only): exports its marketing feature cards, one still per beat of the film,
# taken while its caption and callouts are all on screen. Run after rendering to
# v17/renders/main.mp4. Writes JPEGs to marketing-library/08-feature-cards/v17-60s/ and replaces
# only the cards in that folder.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; V17="$(dirname "$HERE")"
OUT="$(dirname "$(dirname "$V17")")/marketing-library/08-feature-cards/v17-60s"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
# name:time (from build.py SEG and the filmed marks, each while its callout is up)
CARDS="00-the-problem:2.6 00-what-it-is-for:6.2 00-title:8.0 01-how-it-works:13.6 02-every-printer-live:17.5 03-needs-you:20.7 04-confirm-print:23.8 05-prepare-and-slice:28.6 06-digital-twin-3d-model:34.0 06b-digital-twin-drawing:36.8 07-quick-tour:41.0 08-on-your-phone:47.0 09-and-plenty-more:50.5 10-why-trust-it:52.9 11-get-it:59.5"
for c in $CARDS; do
  ffmpeg -loglevel error -y -ss "${c#*:}" -i "$V17/renders/main.mp4" -frames:v 1 -q:v 2 "$OUT/${c%%:*}-16x9.jpg"
done
ls -1 "$OUT" | wc -l
