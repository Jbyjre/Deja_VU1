"""Version 5 music: calm but quick funky nu-disco / lounge, with the bassline up front.

Everything is synthesised here with numpy and SciPy: no samples, no loops, no third-party
audio, so there is nothing to license.

120 BPM (one beat 0.5 s, one bar 2 s), jazzy chords in C major / A minor:
Dm9 | G13 | Cmaj9 | A7(b13).
- Drums: a soft four-on-the-floor kick, a dry clap on 2 and 4, swung sixteenth hats, a shaker.
  Production guides for the style say perfect quantising sounds robotic, so every hit is
  nudged by a few milliseconds and its level varies a little, like a player.
- Bass: a plucky square/saw bass through a closing low-pass (the Juno-style pluck), short
  "funky" note lengths, octave jumps and ghost notes. It leads.
- Keys: an FM electric piano playing short syncopated stabs, with a slow chorus.
- Guitar: muted chicken-scratch chops (a plucked comb filter), quiet.
- Strings and a soft synth melody in the second half.
- A short room reverb on keys, clap and strings.
- The 2-6 kHz band stays light so the mouse clicks and keystrokes cut through.

Usage: python3 compose5.py OUT.wav main|vertical   (both cuts are 75 s)
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
S16 = BEAT / 4
SWING = .57                     # the off sixteenths land at 57% of the eighth, not 50%
LENGTH = 75.0
N = int(LENGTH * SR)
rng = np.random.default_rng(5)

# Arrangement, in seconds (matches both videos):
INTRO_END = 8.0                 # filtered keys, shaker, the bass sneaking in
B_SECTION = 32.0                # guitar chops and the melody join
BREAK = (64.0, 65.0)            # one bar of keys and bass alone
HITS = [65.0, 65.5, 66.0, 66.5, 67.0]   # the values lines
BUILD = (67.0, 68.0)
FINAL = 68.0                    # the end card
OUTRO = 74.0


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def jit(t, ms=5):
    return t + rng.uniform(-ms, ms) / 1000


def vel(g, spread=.12):
    return g * (1 + rng.uniform(-spread, spread))


def place(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= buf.shape[1] or i + len(x) <= 0 or i < 0:
        return
    x = x[: buf.shape[1] - i] * gain
    buf[0, i:i + len(x)] += x * np.cos((pan + 1) * np.pi / 4) * 1.414
    buf[1, i:i + len(x)] += x * np.sin((pan + 1) * np.pi / 4) * 1.414


def filt(x, kind, fc, order=2):
    b, a = signal.butter(order, np.array(fc) / (SR / 2), kind)
    return signal.lfilter(b, a, x)


def st(step):
    """Time of a sixteenth step inside a bar, with swing on the off sixteenths."""
    eighth, odd = divmod(step, 2)
    return eighth * 2 * S16 + (odd * 2 * S16 * SWING)


# ---------- drums ----------
def kick(g=1.0):
    n = int(.3 * SR); t = np.arange(n) / SR
    f = 50 + 70 * np.exp(-t / .03)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .2)
    x += filt(rng.standard_normal(n), 'band', [800, 2500]) * np.exp(-t / .002) * .08
    return np.tanh(x * 1.4) * .7 * g


def clap(g=1.0):
    n = int(.3 * SR); t = np.arange(n) / SR
    env = sum(np.where(t >= d, np.exp(-(t - d) / .006), 0) for d in (0, .01, .02)) * .5
    env += np.where(t >= .028, np.exp(-(t - .028) / .08), 0)
    return filt(rng.standard_normal(n), 'band', [900, 3800]) * env * .4 * g


def hat(g=1.0, open_=False):
    n = int((.22 if open_ else .04) * SR); t = np.arange(n) / SR
    return filt(rng.standard_normal(n), 'high', 8000, 3) * np.exp(-t / (.07 if open_ else .01)) * .22 * g


def shaker(g=1.0):
    n = int(.07 * SR); t = np.arange(n) / SR
    env = np.minimum(1, t / .012) * np.exp(-t / .025)
    return filt(rng.standard_normal(n), 'band', [6000, 11000]) * env * .12 * g


# ---------- bass ----------
def bass(m, dur, g=1.0, slide_to=None):
    """A plucky bass: square + saw, a low-pass that snaps shut, a short release."""
    n = int((dur + .03) * SR); t = np.arange(n) / SR
    f = np.full(n, hz(m))
    if slide_to is not None:
        k = np.clip((t - dur * .4) / (dur * .5), 0, 1)
        f = f * (hz(slide_to) / hz(m)) ** k
    ph = np.cumsum(f) / SR
    x = .6 * np.sign(np.sin(2 * np.pi * ph)) + .5 * (2 * (ph % 1) - 1) + .7 * np.sin(2 * np.pi * ph)
    out = np.zeros(n); seg = 240
    for i in range(0, n, seg):
        fc = 220 + 1500 * np.exp(-(i / SR) / .06)
        out[i:i + seg] = filt(x[max(0, i - 2000):i + seg], 'low', fc)[-len(out[i:i + seg]):]
    env = np.minimum(1, t / .003) * np.clip((dur + .03 - t) / .03, 0, 1) * (0.75 + .25 * np.exp(-t / .1))
    return np.tanh(out * env * 1.6) * .42 * g


# ---------- keys, guitar, strings, lead ----------
def epiano(notes, dur, g=1.0):
    n = int((dur + .35) * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f = hz(m) * (1 + rng.uniform(-.0015, .0015))
        idx = .3 + 1.6 * np.exp(-t / .18)
        out += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
        out += .1 * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t / .025)
    env = np.minimum(1, t / .004) * np.exp(-t / .9) * np.clip((dur + .35 - t) / .35, 0, 1)
    out = out * env * (1 + .1 * np.sin(2 * np.pi * 5 * t))
    return filt(out, 'low', 2600) * .08 * g


def chop(notes, g=1.0):
    """A muted guitar 'chk': a noise burst through a short comb per string, damped fast."""
    n = int(.12 * SR); t = np.arange(n) / SR
    burst = rng.standard_normal(n) * np.exp(-t / .004)
    out = np.zeros(n)
    for m in notes:
        d = max(2, int(SR / hz(m)))
        a = np.zeros(d + 1); a[0] = 1; a[d] = -.85
        out += signal.lfilter([1], a, burst)
    out = filt(out, 'band', [400, 2200]) * np.exp(-t / .035)
    return out * .05 * g


def strings(notes, dur, g=1.0):
    n = int((dur + .6) * SR); t = np.arange(n) / SR
    x = sum(2 * ((hz(m) * (1 + d) * t) % 1) - 1 for m in notes for d in (-.003, 0, .003))
    env = np.minimum(1, t / .5) * np.clip((dur + .6 - t) / .6, 0, 1)
    return filt(x, 'low', 1400) * env * .018 * g


def lead(m, dur, g=1.0, glide_from=None):
    n = int((dur + .15) * SR); t = np.arange(n) / SR
    f = hz(m) * (1 + .006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - .12) / .2, 0, 1))
    if glide_from is not None:
        f = f * (hz(glide_from) / hz(m)) ** np.exp(-t / .04)
    ph = np.cumsum(f) / SR
    x = np.sin(2 * np.pi * ph) + .25 * np.sin(4 * np.pi * ph) + .1 * np.sign(np.sin(2 * np.pi * ph))
    env = np.minimum(1, t / .02) * np.clip((dur + .15 - t) / .15, 0, 1)
    return filt(x, 'low', 2400) * env * .07 * g


# ---------- the song ----------
CHORDS = [[53, 57, 60, 64], [53, 59, 64, 69], [52, 55, 59, 62], [55, 61, 65, 69]]   # Dm9, G13, Cmaj9, A7b13
ROOTS = [38, 31, 36, 33]                                                            # D2, G1, C2, A1
# bass in sixteenths: (step, semitones above the root, length in steps, level)
BASS_A = [(0, 0, 2, 1), (3, 12, 1, .7), (4, 0, 1, .5), (6, 12, 1, .8), (8, 0, 2, 1), (10, 7, 1, .7), (11, 12, 1, .6), (14, 10, 2, .8)]
BASS_B = [(0, 0, 2, 1), (2, 0, 1, .4), (3, 12, 1, .8), (6, 7, 1, .7), (7, 12, 1, .6), (8, 0, 2, 1), (11, 12, 1, .7), (13, 10, 1, .6), (14, 12, 1, .8)]
STABS = [(2, 2), (6, 1), (10, 2), (13, 1)]        # electric piano: (step, length in steps)
CHOPS = [2, 6, 10, 14]                            # guitar on the off-beats
# melody, two bars, in sixteenths: (step, note, length)
MELODY = [(0, 76, 3), (4, 74, 2), (6, 72, 2), (8, 74, 4), (14, 69, 2),
          (16, 72, 3), (20, 74, 2), (22, 76, 2), (24, 79, 4), (28, 76, 4)]


def build():
    mus = np.zeros((2, N + SR))
    wet = np.zeros_like(mus)                       # reverb send
    low = np.zeros_like(mus)                       # low-passed (intro, break)
    nbars = int(np.ceil(LENGTH / BAR))
    for b in range(nbars):
        t0 = b * BAR
        ci = b % 4
        intro = t0 < INTRO_END
        outro = t0 >= OUTRO
        keys_bus = low if intro else mus
        # --- keys (always) ---
        for s, ln in STABS:
            if outro and s > 4:
                continue
            x = epiano(CHORDS[ci], ln * S16 * 1.6, vel(1.0))
            place(keys_bus, x, jit(t0 + st(s)), pan=-.2)
            place(wet, x * .5, jit(t0 + st(s)), pan=-.2)
        if BREAK[0] <= t0 < FINAL:
            continue                               # keys alone; the hits and the build are written below
        # --- drums ---
        if not intro or t0 >= INTRO_END - 2 * BAR:
            for q in range(4):
                place(mus, kick(vel(1, .05)), jit(t0 + q * BEAT, 2))
        if not intro:
            for q in (1, 3):
                x = clap(vel(1))
                place(mus, x, jit(t0 + q * BEAT, 4), pan=.05)
                place(wet, x * .6, t0 + q * BEAT)
            for s in range(16):
                accent = 1 if s % 4 == 2 else (.55 if s % 2 else .75)
                place(mus, hat(vel(accent, .2)), jit(t0 + st(s), 3), pan=.25)
            for q in range(4):
                place(mus, hat(vel(.5), open_=True), jit(t0 + q * BEAT + BEAT / 2, 3), pan=.2)
        for s in range(16):                        # shaker, even in the intro
            place(mus, shaker(vel(.9 if s % 2 else .6, .25)), jit(t0 + st(s), 4), pan=-.3)
        # --- bass ---
        if t0 >= INTRO_END - BAR and not outro:
            pat = BASS_A if b % 2 == 0 else BASS_B
            bus = low if intro else mus
            for j, (s, iv, ln, lv) in enumerate(pat):
                slide = ROOTS[(ci + 1) % 4] if (j == len(pat) - 1 and ci == 3) else None
                place(bus, bass(ROOTS[ci] + iv, ln * S16 * .8, vel(lv, .1), slide), jit(t0 + st(s), 4))
        if outro:
            place(mus, bass(ROOTS[0], BAR * .8), t0)
        # --- guitar, strings, melody in the second half and the end ---
        if t0 >= B_SECTION and not outro:
            for s in CHOPS:
                place(mus, chop(CHORDS[ci][1:], vel(1, .2)), jit(t0 + st(s), 4), pan=.4)
            if b % 2 == 0:
                place(mus, strings(CHORDS[ci], BAR * 2), t0)
                place(wet, strings(CHORDS[ci], BAR * 2) * .8, t0)
                prev = None
                for s, m, ln in MELODY:
                    x = lead(m, ln * S16 * .9, vel(1, .08), glide_from=prev if prev and abs(prev - m) <= 3 else None)
                    place(mus, x, jit(t0 + st(s % 16) + (s // 16) * BAR, 6), pan=.1)
                    place(wet, x * .7, t0 + st(s % 16) + (s // 16) * BAR, pan=.1)
                    prev = m
    # stop-time hits under the values lines, then a clap build into the end card
    for i, t in enumerate(HITS):
        place(mus, kick(), t); place(mus, clap(.8), t, pan=.05)
        place(mus, bass(ROOTS[i % 4] + (12 if i == 4 else 0), BEAT * .7), t)
        place(mus, epiano(CHORDS[i % 4], BEAT * .8, 1.1), t, pan=-.2)
        place(wet, epiano(CHORDS[i % 4], BEAT * .8), t)
    for i in range(8):
        place(mus, clap(.25 + .1 * i), BUILD[0] + i * BEAT / 4, pan=.05)
    # reverb: a short room (decaying filtered noise), on the send only
    ir_t = np.arange(int(1.4 * SR)) / SR
    ir = rng.standard_normal((2, len(ir_t))) * np.exp(-ir_t / .35)
    for ch in range(2):
        ir[ch] = filt(ir[ch], 'low', 5000)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    for ch in range(2):
        mus[ch] += signal.fftconvolve(wet[ch], ir[ch])[: mus.shape[1]] * .35
        mus[ch] += filt(low[ch], 'low', 900) * 1.7
    t = np.arange(mus.shape[1]) / SR
    # gentle pump on everything but the kick region (four-on-the-floor feel)
    mus *= 1 - .12 * np.exp(-((t % BEAT) / .09))
    end = N
    mus = mus[:, :end]
    mus *= np.clip((LENGTH - t[:end]) / 1.2, 0, 1)        # a soft fade on the final chord
    mus *= np.clip(t[:end] / .05, 0, 1)
    mus = np.tanh(mus * 1.1) / np.tanh(1.1)
    mus *= .89 / (np.max(np.abs(mus)) or 1)
    return mus


if __name__ == '__main__':
    mix = build()
    wavfile.write(sys.argv[1], SR, (mix.T * 32767).astype(np.int16))
    print('wrote', sys.argv[1], f'{LENGTH:.1f} s at {BPM} BPM')
