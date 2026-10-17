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


def ring(t, freqs, taus, amps):
    return sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / tau) for f, tau, a in zip(freqs, taus, amps))


def click():
    """A mouse click you can hear on a phone speaker (version 6: louder, fuller and longer than
    before, which were 2 to 7 ms ticks that vanished under the music). Two parts, like a real
    mouse: the press (a sharp transient, then the plastic shell ringing at 1.1, 2.4 and 3.6 kHz
    for about 10 ms) and, 75 ms later, a lighter, higher release."""
    n = int(.16 * SR); t = np.arange(n) / SR
    def part(shift, g):
        burst = bp(rng.standard_normal(n), 1500, 9000) * np.exp(-t / .0025)
        shell = ring(t, [1100 * shift, 2400 * shift, 3600 * shift], [.012, .009, .006], [.55, .7, .45])
        return (burst * .9 + shell) * np.minimum(1, t / .0004) * g
    x = part(1.0, 1.0)
    rel = part(1.18, .55); d = int(.075 * SR)
    x[d:] += rel[:n - d]
    return x * .9


def key(pitch=1.0):
    """A mechanical keystroke: the switch's click, the keycap bottoming out (a hollow 'thock'
    with real body around 450 Hz and 1.6 kHz), and the lighter upstroke 60 ms later."""
    n = int(.14 * SR); t = np.arange(n) / SR
    clk = bp(rng.standard_normal(n), 2500, 9000) * np.exp(-t / .002) * .8
    thock = ring(t, [450 * pitch, 1600 * pitch, 3100 * pitch], [.016, .01, .005], [.6, .55, .3])
    up = np.zeros(n); d = int(.06 * SR)
    up[d:] = (bp(rng.standard_normal(n - d), 2000, 8000) * np.exp(-t[:n - d] / .002) * .35
              + ring(t[:n - d], [1900 * pitch], [.006], [.25]))
    return (clk + thock + up) * np.minimum(1, t / .0004) * .75


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
