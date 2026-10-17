#!/usr/bin/env bash
# Exports the marketing feature cards: one still per step of the launch film, taken at the
# moment its headline, line drawing and callouts are all on screen, in both shapes.
# Run after build.py (main and vertical). Writes JPEGs to marketing-library/08-feature-cards/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
OUT="$(dirname "$ROOT")/marketing-library/08-feature-cards"
mkdir -p "$OUT"
# name:time (both cuts share the same timing)
CARDS="00-title:3.7 01-every-printer-live:15.0 02-needs-you:21.6 03-confirm-print:27.2 04-files-for-the-u1:37.6 05-skip-one-object:45.6 06-digital-twin:53.6 07-photo-studio:60.6 08-get-it:74.2"
AT=$(for c in $CARDS; do printf '%s,' "${c#*:}"; done); AT=${AT%,}
for fmt in main vertical; do
  suffix=$([ "$fmt" = main ] && echo 16x9 || echo 9x16)
  log=$(cd "$ROOT/$fmt" && npx hyperframes@0.8.166 snapshot --at "$AT" 2>&1)
  dir=$(echo "$log" | grep -o '[^ ]*contact-sheet[^ ]*' | head -1 | xargs dirname)
  i=0
  for c in $CARDS; do
    name=${c%%:*}
    src=$(ls "$dir"/frame-$(printf %02d $i)-at-*.png | head -1)
    ffmpeg -loglevel error -y -i "$src" -q:v 2 "$OUT/$name-$suffix.jpg"
    i=$((i + 1))
  done
done
ls -1 "$OUT" | wc -l
