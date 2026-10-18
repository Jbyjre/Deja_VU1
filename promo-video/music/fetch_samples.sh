#!/usr/bin/env bash
# Downloads the recorded instruments music/compose10.py plays (about 700 MB, git-ignored):
#   piano  Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0)  github.com/sfzinstruments/SalamanderGrandPiano
#   bass   VSCO 2 CE solo contrabass pizzicato (CC0)               github.com/sgossner/VSCO-2-CE
#   drums  Virtuosity Drums, mid-field mic (CC0)                    github.com/sfzinstruments/virtuosity_drums
# Only the folders used are checked out. Usage: bash music/fetch_samples.sh [work dir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/samples"; WORK="${1:-$(mktemp -d)}"
get() {  # repo, then the paths to check out
  local repo=$1; shift; local dir="$WORK/$(basename "$repo")"
  [ -d "$dir" ] || git clone -q --depth 1 --filter=blob:none --no-checkout "https://github.com/$repo" "$dir"
  (cd "$dir" && git checkout -q HEAD -- "$@")
}
get sfzinstruments/SalamanderGrandPiano Samples LICENSE
get sgossner/VSCO-2-CE "Strings/Solo Contrabass/Pizz" LICENSE
get sfzinstruments/virtuosity_drums Samples/mid/ride Samples/mid/crash Samples/mid/hh Samples/mid/kick Samples/mid/snare Samples/mid/htom Samples/mid/ltom LICENSE
mkdir -p "$OUT/piano" "$OUT/bass" "$OUT/drums"
cp "$WORK/SalamanderGrandPiano/Samples/"*.flac "$OUT/piano/"
cp "$WORK/VSCO-2-CE/Strings/Solo Contrabass/Pizz/"*.wav "$OUT/bass/"
for d in ride crash hh kick snare htom ltom; do mkdir -p "$OUT/drums/$d"; cp "$WORK/virtuosity_drums/Samples/mid/$d/"*.flac "$OUT/drums/$d/"; done
cp "$WORK/SalamanderGrandPiano/LICENSE" "$OUT/piano/LICENSE"; cp "$WORK/VSCO-2-CE/LICENSE" "$OUT/bass/LICENSE"; cp "$WORK/virtuosity_drums/LICENSE" "$OUT/drums/LICENSE"
echo "samples in $OUT: $(find "$OUT" -type f | wc -l) files"
