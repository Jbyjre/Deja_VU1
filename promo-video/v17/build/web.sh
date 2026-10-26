#!/usr/bin/env bash
# Version 17: the product page's copy of the finished film, its poster and the README picture.
# Version 16's web copy was 30 fps at 1.4 Mbit/s (half the master's frame rate, so motion looked
# less smooth); this one keeps all 60 frames a second, in two passes at about 3 Mbit/s, which still
# fits Cloudflare's 25 MiB file limit (checked below). Run after finish.py.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; V17="$(dirname "$HERE")"; ROOT="$(dirname "$(dirname "$V17")")"
SRC="$V17/renders/deja-vu1-launch-v17-60s-16x9.mp4"
WEB="$ROOT/frontend/media/deja-vu1-launch-v17-16x9.mp4"
POSTER="$ROOT/frontend/media/deja-vu1-launch-v17-poster.jpg"
README_PIC="$ROOT/docs/img/launch-video-v17.jpg"
PASS="$(mktemp -d)/x264"
X264=(-c:v libx264 -preset slow -tune animation -profile:v high -level:v 4.2 -pix_fmt yuv420p -r 60 -b:v 3000k -maxrate 6000k -bufsize 6000k -g 120)
ffmpeg -loglevel error -y -i "$SRC" "${X264[@]}" -pass 1 -passlogfile "$PASS" -an -f mp4 /dev/null
ffmpeg -loglevel error -y -i "$SRC" "${X264[@]}" -pass 2 -passlogfile "$PASS" -c:a aac -b:a 160k -movflags +faststart "$WEB"
SIZE=$(stat -c %s "$WEB"); LIMIT=$((25 * 1024 * 1024))
echo "web copy: $SIZE bytes ($(python3 -c "print(round($SIZE / 1048576, 1))") MiB, limit 25 MiB)"
[ "$SIZE" -lt "$LIMIT" ] || { echo "too large for Cloudflare" >&2; exit 1; }
# The poster: what it is for, with its three promises (as version 16's).
ffmpeg -loglevel error -y -ss 6.2 -i "$SRC" -frames:v 1 -q:v 2 "$POSTER"
# The README picture: the poster at 1280 x 720 with a play button, so it reads as a film.
python3 - "$POSTER" "$README_PIC" <<'EOF'
import sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert('RGB').resize((1280, 720), Image.LANCZOS)
S = 4                                    # drawn four times larger, then scaled down: smooth edges
o = Image.new('RGBA', (1280 * S, 720 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(o)
cx, cy, r = 640 * S, 360 * S, 104 * S
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(28, 31, 40, 205))
t = 44 * S
d.polygon([(cx - t * .62, cy - t), (cx - t * .62, cy + t), (cx + t * 1.05, cy)], fill=(255, 255, 255, 255))
im.paste(o.resize((1280, 720), Image.LANCZOS), (0, 0), o.resize((1280, 720), Image.LANCZOS))
im.save(sys.argv[2], quality=90)
EOF
ls -la "$WEB" "$POSTER" "$README_PIC"
