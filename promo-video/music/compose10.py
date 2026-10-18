"""Version 11 music: version 10's arrangement, played by recorded acoustic instruments.

The owner on version 10: "find a music that doesn't sound electronic". Every earlier version
synthesised its instruments in code, and however carefully they were modelled they still read as
electronic. This one keeps compose9.py's arrangement note for note (a bright, up-tempo jazz trio
at 160 BPM in a major key, every scene change, word, callout and value landing on the picture,
from the cue plan build.py writes), but each note is now a recording of a real instrument:

- piano: Salamander Grand Piano V3, a Yamaha C5 grand recorded by Alexander Holm, 16 velocity
  layers, a sample every three semitones (CC BY 3.0: credited in the end card, README and
  marketing-library/README.md). Source: github.com/sfzinstruments/SalamanderGrandPiano.
- upright bass: VSCO 2 Community Edition, solo contrabass pizzicato, two dynamics, two
  round-robins (CC0). Source: github.com/sgossner/VSCO-2-CE.
- drums: Virtuosity Drums, the mid-field mic, played with sticks (CC0). Source:
  github.com/sfzinstruments/virtuosity_drums.

The samples are not committed (about 700 MB); `music/fetch_samples.sh` downloads exactly the
folders used into promo-video/music/samples/ (git-ignored).

Balance (measured, one instrument at a time, before mastering): the bass about 3.5 dB under
the piano and the drums about 8 dB under, the way a jazz trio is usually mixed.

Each note is the nearest recorded note (at most a semitone and a half away) resampled to pitch,
the velocity layer chosen from the note's loudness, alternating round-robins so repeated notes
are not identical, and a damper fade when a piano note is let go.

Usage: python3 compose10.py OUT.wav PLAN.json
"""
import glob
import os
import re
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose9 as c9                                   # noqa: E402  (the arrangement)

SR = c9.SR
HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.environ.get('DEJAVU_SAMPLES', os.path.join(HERE, 'samples'))
rng = np.random.default_rng(10)
NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
_cache = {}


def load(path):
    if path not in _cache:
        x, sr = sf.read(path, dtype='float32', always_2d=True)
        x = x.mean(axis=1)
        if sr != SR:
            n = int(round(len(x) * SR / sr))
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
        # recordings start 7-24 ms before the sound (measured); trim to 2 ms before the attack so
        # every hit lands exactly where the picture's cue is
        a = np.abs(x); on = int(np.argmax(a > a.max() * .03))
        _cache[path] = x[max(0, on - int(.002 * SR)):]
    return _cache[path]


def repitch(x, semis):
    if abs(semis) < 1e-6:
        return x
    r = 2 ** (semis / 12)
    n = int(len(x) / r)
    return np.interp(np.arange(n) * r, np.arange(len(x)), x).astype(np.float32)


def midi(name, octave_shift=0):
    m = re.match(r'([A-G]#?)(-?\d)', name)
    return 12 * (int(m.group(2)) + 1 + octave_shift) + NOTE[m.group(1)]


# ---------- the piano (Salamander: A0v1.flac ... C8v16.flac) ----------
PIANO = {}
for p in glob.glob(os.path.join(SAMPLES, 'piano', '*.flac')):
    m = re.match(r'([A-G]#?\d)v(\d+)\.flac', os.path.basename(p))
    if m:
        PIANO.setdefault(midi(m.group(1)), {})[int(m.group(2))] = p
P_NOTES = np.array(sorted(PIANO))


def piano(m, dur, v=.6):
    """One piano note: the nearest recorded note and velocity layer, held for dur, then damped."""
    n = int(P_NOTES[np.argmin(np.abs(P_NOTES - m))])
    layer = int(np.clip(round(2 + v * 13), 1, 16))
    layer = min(PIANO[n], key=lambda L: abs(L - layer))
    x = repitch(load(PIANO[n][layer]), m - n)
    rel = .22
    end = min(len(x), int((dur + rel) * SR))
    x = x[:end].copy()
    k = max(0, end - int(rel * SR))
    x[k:] *= np.linspace(1, 0, end - k) ** 2              # the damper comes down
    return x * (.55 + .6 * v) * .55


def chord(notes, dur, v=.5, roll=.012):
    out = np.zeros(int((dur + .4) * SR), dtype=np.float32)
    for i, m in enumerate(notes):
        x = piano(m, dur - i * roll, c9.vel(v, .1))
        o = int(i * roll * SR)
        out[o:o + len(x)] += x[: len(out) - o]
    return out


# ---------- the upright bass (VSCO 2 CE: named one octave low, E0 = E1; measured) ----------
BASS = {}
for p in glob.glob(os.path.join(SAMPLES, 'bass', '*.wav')):
    m = re.match(r'BKCtbss_Pizz_([A-G]#?\d)_v(\d)_rr(\d)\.wav', os.path.basename(p))
    if m:
        BASS.setdefault(midi(m.group(1), 1), {}).setdefault(int(m.group(2)), []).append(p)
B_NOTES = np.array(sorted(BASS))


def bass(m, dur, v=1.0):
    n = int(B_NOTES[np.argmin(np.abs(B_NOTES - m))])
    layers = BASS[n]
    layer = max(layers) if v > .85 and max(layers) > 1 else min(layers)
    x = repitch(load(layers[layer][int(rng.integers(len(layers[layer])))]), m - n)
    end = min(len(x), int((dur + .08) * SR))
    x = x[:end].copy()
    k = max(0, end - int(.08 * SR))
    x[k:] *= np.linspace(1, 0, end - k)                    # the finger stops the string
    return x * v * 2.85


# ---------- the drums (Virtuosity Drums, mid-field mic) ----------
def kit(folder, pattern):
    return sorted(glob.glob(os.path.join(SAMPLES, 'drums', folder, pattern)))


def layers(files):
    out = {}
    for p in files:
        m = re.search(r'_vl(\d+)', os.path.basename(p))
        out.setdefault(int(m.group(1)) if m else 1, []).append(p)
    return out


RIDE, BELLS, CRASH = layers(kit('ride', '*_ride_ride_*')), layers(kit('ride', '*_ride_bell_*')), layers(kit('crash', '*_crash_crash_*'))
PEDAL, KICK = layers(kit('hh', '*_hh_pedal_*')), layers(kit('kick', '*_kick_snoff_*'))
SNARE, HTOM, LTOM = layers(kit('snare', '*_snare_center_*')), layers(kit('htom', '*_htom_center_*')), layers(kit('ltom', '*_ltom_center_*'))


def hit(lay, v, gain, length=None):
    keys = sorted(lay)
    k = keys[int(np.clip(round(v * (len(keys) - 1)), 0, len(keys) - 1))]
    x = load(lay[k][int(rng.integers(len(lay[k])))])
    if length:
        x = x[: int(length * SR)].copy()
        x[-int(.05 * SR):] *= np.linspace(1, 0, int(.05 * SR))
    return x * gain


def ride(v=1.0):
    return hit(RIDE, min(1, v * .7), .48, 1.6)


def crash(v=1.0):
    return hit(CRASH, min(1, v), .6, 2.6)


def chick(v=1.0):
    return hit(PEDAL, min(1, v), .55, .3)


def kick(v=1.0):
    return hit(KICK, min(1, v * .9), .85, .5)


def snare(v=1.0):
    return hit(SNARE, min(1, v * 1.2), .75, .45)


def tom(f0, v=1.0):
    return hit(HTOM if f0 > 130 else LTOM, min(1, v), .75, .6)


# play version 10's arrangement on these instruments
for name in ('piano', 'chord', 'bass', 'ride', 'crash', 'chick', 'kick', 'snare', 'tom'):
    setattr(c9, name, globals()[name])
c9.BELL = hit(BELLS, .6, .7, 1.8)
c9.rng = rng

if __name__ == '__main__':
    assert len(PIANO) >= 29 and len(BASS) >= 14 and RIDE and SNARE, f'samples missing in {SAMPLES}: run music/fetch_samples.sh'
    out = c9.build()
    sf.write(sys.argv[1], out.T, SR, subtype='PCM_16')
    print('wrote', sys.argv[1], f'{c9.LENGTH:.1f} s at {c9.BPM} BPM on recorded instruments:',
          len(PIANO), 'piano notes,', len(BASS), 'bass notes')
