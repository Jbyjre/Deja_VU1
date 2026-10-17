"""Sound effects for the promo, synthesised from noise and sine waves (no samples).

Reads a cue list [{"t": seconds, "type": "click"|"whoosh"|"tick", "gain": 1, "pan": 0}, ...]
and writes one stereo WAV of the given length.
Usage: python3 sfx.py cues.json LENGTH_S OUT.wav
"""
import json
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
rng = np.random.default_rng(3)


def bp(x, lo, hi):
    b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return signal.lfilter(b, a, x)


def click():
    """A soft trackpad click: a short filtered tick plus a tiny high blip."""
    n = int(.06 * SR); t = np.arange(n) / SR
    tick = bp(rng.standard_normal(n), 1800, 6000) * np.exp(-t / .004)
    blip = np.sin(2 * np.pi * 2600 * t) * np.exp(-t / .012) * .25
    return (tick * .8 + blip) * .5


def tick():
    n = int(.04 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1700 * t) * np.exp(-t / .008) * .25


def whoosh(dur=.42):
    """Air moving past: noise through a band-pass that sweeps up, swelling then fading."""
    n = int(dur * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 512
    for i in range(0, n, seg):
        k = i / n
        lo = 300 + 2200 * k ** 1.5
        out[i:i + seg] = bp(x[max(0, i - 2048):i + seg], lo, lo * 3.2)[-len(out[i:i + seg]):]
    env = np.sin(np.pi * np.minimum(1, t / dur)) ** 2 * np.exp(-t / (dur * 1.4))
    return out * env * .35


def main():
    cues = json.load(open(sys.argv[1]))
    n = int(float(sys.argv[2]) * SR)
    mix = np.zeros((2, n))
    for c in cues:
        x = {'click': click, 'whoosh': whoosh, 'tick': tick}[c['type']]()
        pan = c.get('pan', 0)
        lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        start = int(c['t'] * SR)
        if c['type'] == 'whoosh':
            start -= int(.3 * SR)          # the swell peaks on the cue
        start = max(0, start)
        x = x[: n - start] * c.get('gain', 1)
        mix[0, start:start + len(x)] += x * lg
        mix[1, start:start + len(x)] += x * rg
    peak = np.max(np.abs(mix)) or 1
    mix *= min(1, .5 / peak)
    wavfile.write(sys.argv[3], SR, (mix.T * 32767).astype(np.int16))
    print('wrote', sys.argv[3], len(cues), 'cues')


main()
