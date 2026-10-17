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


def lowpass(x, fc):
    b, a = signal.butter(2, fc / (SR / 2), 'low')
    return signal.lfilter(b, a, x)


def bp(x, lo, hi):
    b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return signal.lfilter(b, a, x)


def burst(n, lo, hi, tau, t):
    """A short noise burst through a band-pass: the sound of plastic hitting plastic. No pure
    tones, so nothing rings or 'pings'."""
    return bp(rng.standard_normal(n), lo, hi) * np.exp(-t / tau)


def click():
    """A mouse click (version 7): the button snapping down, then lifting about 70 ms later.
    Made only of short filtered noise (version 6 used ringing sine tones, which sounded
    synthetic and grating), with a small random change each time, like a real mouse."""
    n = int(.13 * SR); t = np.arange(n) / SR
    v = rng.uniform(.9, 1.1); s = rng.uniform(.93, 1.07)
    def part(shift, g):
        snap = burst(n, 1500 * shift * s, 6000 * shift * s, .0016, t)
        body = burst(n, 350 * s, 1300 * s, .005, t) * .55
        return (snap + body) * np.minimum(1, t / .0003) * g
    x = part(1.0, 1.0)
    d = int(rng.uniform(.06, .08) * SR)
    x[d:] += part(1.15, .42)[:n - d]
    return lowpass(x, 8000) * .9 * v


def key(pitch=1.0):
    """A laptop keystroke: a soft 'tock' as the key bottoms out (a muffled thump with a little
    click on top), then a quieter lift. Each one a little different, so typing sounds human."""
    n = int(.12 * SR); t = np.arange(n) / SR
    s = pitch * rng.uniform(.9, 1.1); v = rng.uniform(.8, 1.15)
    down = burst(n, 1200 * s, 5000 * s, .0022, t) * .7 + burst(n, 160 * s, 700 * s, .008, t) * .8
    up = np.zeros(n); d = int(rng.uniform(.045, .07) * SR)
    up[d:] = burst(n - d, 2000 * s, 6000 * s, .0014, t[:n - d]) * .25
    return lowpass((down + up) * np.minimum(1, t / .0004), 8000) * 1.4 * v


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
    return out * env * .22


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
    # Version 6: a fixed level (version 5 scaled the whole track to its loudest sound, so a
    # loud whoosh made every click quieter); only a hard limit against clipping.
    mix = np.tanh(mix * .9) 
    wavfile.write(sys.argv[3], SR, (mix.T * 32767).astype(np.int16))
    print('wrote', sys.argv[3], len(cues), 'cues')


main()
