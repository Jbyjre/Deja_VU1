"""Version 4 music: a hard, fast rap / trap beat with heavy bass and a dark synth hook.

Everything is synthesised here from sine, saw and noise with numpy and SciPy: no samples,
no loops, no third-party audio, so there is nothing to license.

150 BPM (one beat 0.4 s, one bar 1.6 s), F minor.
- 808: a driven sine bass with a clean sub underneath, a pitch punch on every note and
  slides into the next one; octave jumps keep it moving.
- Drums: punchy kick, a crisp trap snare layered with a clap on beat 3, sixteenth hats
  with thirty-second and triplet rolls, open hats on the off-beats.
- Hook: a dark, plucky synth riff (detuned saws, low-passed) over a low pad;
  a beat switch halfway (triplet hats, the hook up an octave, a bell answer).
- A one-beat silence right before the last drop.
- Kept clear of the 2-6 kHz band where the mouse clicks and keystrokes sit (no guitars,
  nothing rock: the brightness lives in the hats, above 7 kHz).

Usage: python3 compose4.py OUT.wav main|vertical
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 150
BEAT = 60 / BPM
BAR = 4 * BEAT
S16 = BEAT / 4

# Sections in bars. drop: the beat lands (the one line); switch: the beat switch;
# stops: stop-time hits under the values lines, then a build; end: the last drop; outro: last bar.
CUTS = {'main': dict(drop=3, switch=15, stops=27, end=29, outro=32, bars=33, tail=.2),
        'vertical': dict(drop=3, switch=11, stops=18, end=20, outro=23, bars=24, tail=0.0)}
FMT = sys.argv[2]
C = CUTS[FMT]
LENGTH = C['bars'] * BAR + C['tail']
N = int(LENGTH * SR)
rng = np.random.default_rng(21)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= buf.shape[1] or i + len(x) <= 0:
        return
    x = x[: buf.shape[1] - i] * gain
    lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + len(x)] += x * lg * 1.414
    buf[1, i:i + len(x)] += x * rg * 1.414


def filt(x, kind, fc, order=2):
    b, a = signal.butter(order, np.array(fc) / (SR / 2), kind)
    return signal.lfilter(b, a, x)


# ---------- drums ----------
def kick(g=1.0):
    n = int(.3 * SR); t = np.arange(n) / SR
    f = 52 + 150 * np.exp(-t / .022)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .13)
    click = filt(rng.standard_normal(n), 'band', [1200, 4000]) * np.exp(-t / .0015) * .5
    return np.tanh((body + click) * 2.0) * .8 * g


def snare(g=1.0):
    """Trap snare: a pitched body that drops, a noise crack, three quick claps on top."""
    n = int(.32 * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * np.cumsum(230 * (1 + .5 * np.exp(-t / .01))) / SR) * np.exp(-t / .045) * .7
    crack = filt(rng.standard_normal(n), 'high', 1800) * np.exp(-t / .06) * .45
    clp = np.zeros(n)
    for d in (0, .009, .018):
        clp += np.where(t >= d, np.exp(-(t - d) / .005), 0) * .4
    clp = filt(rng.standard_normal(n), 'band', [1000, 4500]) * (clp + np.where(t >= .025, np.exp(-(t - .025) / .07), 0) * .6)
    return np.tanh((body + crack + clp * .6) * 1.4) * .62 * g


def hat(g=1.0, open_=False, tone=1.0):
    n = int((.25 if open_ else .045) * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'high', 7500 * tone, 3)
    return x * np.exp(-t / (.08 if open_ else .011)) * .3 * g


def perc(g=1.0):
    """A short rim-like tick for fills."""
    n = int(.06 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1650 * t) + .4 * np.sin(2 * np.pi * 2480 * t)) * np.exp(-t / .012) * .18 * g


# ---------- bass and synths ----------
def bass808(m, dur, glide_to=None, g=1.0):
    n = int((dur + .06) * SR); t = np.arange(n) / SR
    f0 = hz(m)
    f = f0 * (1 + 1.6 * np.exp(-t / .01))
    if glide_to is not None:
        k = np.clip((t - dur * .55) / (dur * .35), 0, 1)
        f = f * (hz(glide_to) / f0) ** (k * k * (3 - 2 * k))
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.minimum(1, t / .003) * np.exp(-t / max(.4, dur * 1.1)) * np.clip((dur + .06 - t) / .06, 0, 1)
    driven = np.tanh(np.sin(ph) * env * 3.4)               # the growl
    driven = filt(driven, 'low', 1800)
    sub = np.sin(ph) * env                                  # keeps the low end round
    return (driven * .45 + sub * .55) * .7 * g


def saw(f, t, detune=0.0):
    ph = (f * (1 + detune) * t) % 1.0
    return 2 * ph - 1


def lead(m, dur, g=1.0, bright=1.0):
    """The hook: two detuned saws, a fast filter pluck, low-passed so it stays dark."""
    n = int((dur + .25) * SR); t = np.arange(n) / SR
    f = hz(m)
    x = saw(f, t, -.006) + saw(f, t, .006) + .5 * np.sin(2 * np.pi * f / 2 * t)
    env = np.minimum(1, t / .004) * np.exp(-t / (.18 + .2 * dur)) * np.clip((dur + .25 - t) / .25, 0, 1)
    # a moving low-pass: bright at the attack, closing fast
    out = np.zeros(n); seg = 480
    for i in range(0, n, seg):
        fc = 600 + 2000 * bright * np.exp(-(i / SR) / .07)
        out[i:i + seg] = filt(x[max(0, i - 2048):i + seg], 'low', fc)[-len(out[i:i + seg]):]
    return out * env * .16 * g


def bell(m, g=1.0):
    n = int(.8 * SR); t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / .08)
    return x * np.minimum(1, t / .002) * np.exp(-t / .3) * .08 * g


def pad(notes, dur, g=1.0):
    n = int((dur + .4) * SR); t = np.arange(n) / SR
    x = sum(saw(hz(m), t, d) for m in notes for d in (-.004, .004))
    env = np.minimum(1, t / .25) * np.clip((dur + .4 - t) / .4, 0, 1)
    return filt(x, 'low', 900) * env * .035 * g


def riser(dur, g=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); out = np.zeros(n); seg = 1024
    for i in range(0, n, seg):
        k = i / n; lo = 500 + 6000 * k ** 2
        out[i:i + seg] = filt(x[max(0, i - 4096):i + seg], 'band', [lo, min(lo * 2.2, 20000)])[-len(out[i:i + seg]):]
    return out * (t / dur) ** 2.4 * .26 * g


def impact(g=1.0):
    n = int(1.4 * SR); t = np.arange(n) / SR
    f = 36 + 70 * np.exp(-t / .04)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .55)
    return np.tanh(boom * 1.8) * .55 * g


def dive(g=1.0):
    """An 808 that dives in pitch: the classic fill before a drop."""
    n = int(.4 * SR); t = np.arange(n) / SR
    f = hz(41) * np.exp(-t / .18) + 25
    return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * 2.5) * np.exp(-t / .3) * .5 * g


# ---------- the song ----------
# F minor: Fm | Db | Bbm | C (the C major chord gives the minor key its pull back home)
ROOTS = [29, 25, 34, 24]                    # F1, Db1, Bb1, C1 (808)
CHORDS = [[53, 56, 60], [49, 53, 56], [46, 49, 53], [48, 52, 55]]
# 808 rhythm in sixteenths (step, length, octave up?); varies on odd bars
BASS_A = [(0, 4, 0), (6, 2, 1), (8, 3, 0), (11, 5, 0)]
BASS_B = [(0, 3, 0), (3, 3, 0), (7, 2, 1), (10, 6, 0)]
KICK_A, KICK_B = [0, 8, 11], [0, 3, 10]
# hook: two bars, in sixteenths (step, note, length in steps)
HOOK = [(0, 77, 2), (3, 80, 2), (6, 79, 2), (8, 77, 3), (12, 75, 2), (14, 72, 2),
        (16, 77, 2), (19, 80, 2), (22, 84, 3), (26, 82, 2), (28, 80, 2), (30, 79, 2)]
BELL_ANSWER = [(10, 84), (13, 87), (26, 89), (29, 87)]


def bt(b):
    return b * BAR


def drums(mus, b, switched, roll):
    t0 = bt(b)
    for s in (KICK_A if b % 2 == 0 else KICK_B):
        place(mus, kick(), t0 + s * S16)
    place(mus, snare(), t0 + 2 * BEAT, pan=.04)
    if b % 4 == 3:
        place(mus, snare(.35), t0 + 3.75 * BEAT, pan=.04)               # a ghost before the next bar
    if switched:                                            # triplet hats after the switch
        for i in range(12):
            place(mus, hat(.75 if i % 3 == 0 else .45), t0 + i * BEAT / 3, pan=.28)
    else:
        for i in range(16):
            place(mus, hat(.75 if i % 2 == 0 else .4), t0 + i * S16, pan=.28)
    if roll:                                                # 32nd roll, rising, on beat 4
        for i in range(8):
            place(mus, hat(.3 + .07 * i, tone=1 + .03 * i), t0 + 3 * BEAT + i * S16 / 2, pan=.32)
        place(mus, perc(), t0 + 3.5 * BEAT, pan=-.3)
    place(mus, hat(.45, open_=True), t0 + 1.5 * BEAT, pan=.2)
    place(mus, hat(.4, open_=True), t0 + 3.5 * BEAT if not roll else t0 + 2.5 * BEAT, pan=.2)


def bass_bar(mus, b, g=1.0):
    t0 = bt(b); ci = b % 4; nxt = ROOTS[(b + 1) % 4]
    pat = BASS_A if b % 2 == 0 else BASS_B
    for j, (s, ln, up) in enumerate(pat):
        last = j == len(pat) - 1
        place(mus, bass808(ROOTS[ci] + 12 * up, ln * S16, glide_to=nxt if last else None, g=g), t0 + s * S16)


def hook_bars(mus, b, up=0, g=1.0, bright=1.0):
    """The hook spans two bars; call it on even bars."""
    t0 = bt(b)
    for s, m, ln in HOOK:
        place(mus, lead(m + up, ln * S16, g, bright), t0 + s * S16, pan=-.12)


def build():
    mus = np.zeros((2, N + 2 * SR))
    intro = np.zeros_like(mus)        # low-passed: the intro and the build bar
    for b in range(C['bars']):
        t0 = bt(b)
        place(mus if b >= C['drop'] else intro, pad(CHORDS[b % 4], BAR * .95), t0)
        if b < C['drop']:                                   # intro: filtered hook, hats, kicks on the cuts
            if b % 2 == 0:
                hook_bars(intro, b, 0, 1.2, .7)
            for i in range(8):
                place(mus, hat(.4), t0 + i * BEAT / 2, pan=.28)
            for i in range(0, 4, 3):
                place(mus, kick(.75), t0 + i * BEAT)        # 0 and 1.2 s: the montage cuts are every 1.2 s
            if b == C['drop'] - 1:
                for i in range(8):
                    place(mus, snare(.2 + .1 * i), t0 + 2 * BEAT + i * BEAT / 4)
                place(mus, riser(BAR), t0)
        elif C['stops'] <= b < C['end']:
            if b == C['stops']:                             # five hits, one per values line
                for i in range(5):
                    t = t0 + i * BEAT
                    place(mus, kick(), t); place(mus, snare(.55), t, pan=.04)
                    place(mus, bass808(ROOTS[i % 4] + 12 * (i == 4), BEAT * .85), t)
                    place(mus, lead(77 + [0, 3, 7, 10, 12][i], BEAT * .6, 1.1), t, pan=-.12)
            else:                                           # build, then one beat of silence
                hook_bars(intro, b, 0, 1.0, .5) if b % 2 == 0 else None
                for i in range(12):
                    place(mus, snare(.15 + .06 * i), t0 + i * S16)
                place(mus, riser(3 * BEAT, 1.2), t0)
                place(mus, dive(), t0 + 2.0 * BEAT)
        elif b >= C['outro']:                               # last bar: filtered hook, one 808
            hook_bars(intro, b - (b % 2), 0, 1.0, .5) if b % 2 == 0 else None
            place(mus, bass808(ROOTS[0], BAR * .9, g=.9), t0)
            place(mus, kick(), t0)
        else:                                               # the groove
            switched = C['switch'] <= b < C['stops']
            roll = (b % 4 == 3) or b == C['switch'] - 1
            drums(mus, b, switched, roll)
            bass_bar(mus, b)
            if b % 2 == (C['drop'] % 2):
                hook_bars(mus, b, 12 if switched else 0, .9 if switched else 1.0)
            if switched or b >= C['end']:
                for s, m in BELL_ANSWER:
                    if s < 16 or b % 2 == (C['drop'] % 2):
                        place(mus, bell(m - 12 * (s >= 16)), t0 + (s % 16) * S16, pan=.35)
        if b in (C['drop'], C['switch'], C['end']):
            place(mus, impact(.8), t0)
    for ch in range(2):
        intro[ch] = filt(intro[ch], 'low', 1100)
    mus += intro
    t = np.arange(mus.shape[1]) / SR
    # the bass and synths breathe with the kick (a gentle sidechain on each beat)
    mus *= 1 - .2 * np.exp(-((t % BEAT) / .08))
    # the one beat of silence before the last drop
    gap0, gap1 = bt(C['end']) - BEAT, bt(C['end'])
    i0, i1 = int(gap0 * SR), int(gap1 * SR)
    mus[:, i0:i1] *= np.clip(1 - (t[i0:i1] - gap0) / .015, 0, 1)    # a 15 ms fade into silence
    end = int(LENGTH * SR)
    mus = mus[:, :end]
    mus *= np.clip((LENGTH - t[:end]) / .6, 0, 1)
    mus = np.tanh(mus * .9) / np.tanh(.9)                   # gentle: no fuzz on the master
    mus *= .89 / (np.max(np.abs(mus)) or 1)
    return mus


if __name__ == '__main__':
    mix = build()
    wavfile.write(sys.argv[1], SR, (mix.T * 32767).astype(np.int16))
    print('wrote', sys.argv[1], f'{LENGTH:.2f} s at {BPM} BPM')
