"""Sound effects for the promo, synthesised from noise and sine waves (no samples).

Reads a cue list [{"t": seconds, "type": "click"|"key"|"whoosh"|"tick", "gain": 1, "pan": 0}, ...]
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
    """A mouse click you can hear: a sharp press (noise burst plus a short 3.2 kHz body and a
    low thock), then a quieter, higher release 55 ms later."""
    n = int(.12 * SR); t = np.arange(n) / SR
    def part(f, g):
        burst = bp(rng.standard_normal(n), 2000, 7500) * np.exp(-t / .0022)
        body = np.sin(2 * np.pi * f * t) * np.exp(-t / .007) * .45
        thock = np.sin(2 * np.pi * 900 * t) * np.exp(-t / .005) * .5
        return (burst + body + thock) * g
    x = part(3200, 1.0)
    rel = part(3900, .45); d = int(.055 * SR)
    x[d:] += rel[:n - d]
    return x * .55


def key(pitch=1.0):
    """A mechanical keystroke: the click of the switch, the key bottoming out, a light upstroke."""
    n = int(.11 * SR); t = np.arange(n) / SR
    clk = bp(rng.standard_normal(n), 3000, 8500) * np.exp(-t / .0018) * .9
    thock = (np.sin(2 * np.pi * 340 * pitch * t) + .6 * np.sin(2 * np.pi * 1250 * pitch * t)) * np.exp(-t / .011) * .55
    up = np.zeros(n); d = int(.045 * SR)
    up[d:] = bp(rng.standard_normal(n - d), 2500, 7000) * np.exp(-t[:n - d] / .0015) * .3
    return (clk + thock + up) * .5


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
        x = key(c.get('pitch', 1.0)) if c['type'] == 'key' else {'click': click, 'whoosh': whoosh, 'tick': tick}[c['type']]()
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
