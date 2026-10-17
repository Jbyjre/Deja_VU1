"""Version 3 music: a fast hip-hop / trap instrumental with jazzy electric-piano chords.

Everything is synthesised here from sine waves and noise with numpy and SciPy: no samples,
no loops, no third-party audio, so there is nothing to license.

150 BPM, so one beat is 0.4 s and one bar is 1.6 s: every cut in the edit lands on a beat.
- 808: a sine bass with a pitch drop at the start of each note, gentle saturation, and
  glides into the next chord's root (the trap signature).
- Drums: punchy kick, clap + snare on beat 3 of every bar (the half-time feel of most
  rap beats), hi-hats in eighths with sixteenth and triplet rolls.
- Keys: an FM electric piano ("Rhodes") playing jazzy minor ninth chords, the elevator-
  music colour, plus a small bell motif.
- The 2-5 kHz band is kept fairly clear (keys low-passed, hats high-passed) so the mouse
  clicks and keystrokes on the sound-effects track stay easy to hear.

Usage: python3 compose3.py OUT.wav main|vertical
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 150
BEAT = 60 / BPM            # 0.4 s
BAR = 4 * BEAT             # 1.6 s
S16 = BEAT / 4             # 0.1 s

# Section map, in bars. drop: the beat comes in; stops: stop-time hits (the values lines);
# end: the last drop (end card); outro: the final filtered bar.
CUTS = {'main': dict(drop=2, stops=22, end=24, outro=27, bars=28, tail=.2),
        'vertical': dict(drop=2, stops=14, end=16, outro=18, bars=19, tail=0.0)}
FMT = sys.argv[2]
C = CUTS[FMT]
LENGTH = C['bars'] * BAR + C['tail']
N = int(LENGTH * SR)
rng = np.random.default_rng(11)


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


# ---------- instruments ----------
def kick(g=1.0):
    n = int(.32 * SR); t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / .028)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .16)
    click = filt(rng.standard_normal(n), 'high', 1500) * np.exp(-t / .0025) * .35
    return np.tanh((body + click) * 1.6) * .75 * g


def eight08(m, dur, glide_to=None, g=1.0):
    """808 bass: pitch drop at the attack, long body, optional glide to another note."""
    n = int((dur + .08) * SR); t = np.arange(n) / SR
    f0 = hz(m)
    f = f0 * (1 + 1.2 * np.exp(-t / .012))
    if glide_to is not None:
        k = np.clip((t - dur * .62) / (dur * .3), 0, 1)
        f = f * (hz(glide_to) / f0) ** (k * k * (3 - 2 * k))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + .18 * np.sin(2 * ph)
    env = np.minimum(1, t / .004) * np.exp(-t / max(.35, dur * .9))
    env *= np.clip((dur + .08 - t) / .08, 0, 1)
    return np.tanh(x * env * 2.2) * .62 * g


def clap(g=1.0):
    n = int(.35 * SR); t = np.arange(n) / SR
    nz = filt(rng.standard_normal(n), 'band', [900, 5200])
    env = np.zeros(n)
    for d in (0, .011, .022):                                   # three quick hands
        env += np.where(t >= d, np.exp(-(t - d) / .006), 0) * .6
    env += np.where(t >= .03, np.exp(-(t - .03) / .09), 0)
    snare = np.sin(2 * np.pi * 190 * t) * np.exp(-t / .05) * .5
    return (nz * env * .55 + snare) * g


def hat(g=1.0, open_=False):
    n = int((.22 if open_ else .05) * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'high', 7200, 3)
    return x * np.exp(-t / (.07 if open_ else .012)) * .3 * g


def rhodes(notes, dur, g=1.0, bright=1.0):
    """FM electric piano: a sine carrier, a ratio-1 modulator whose depth decays, a tine ping."""
    n = int((dur + .5) * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f = hz(m)
        idx = (.4 + 2.2 * bright * np.exp(-t / .25))
        mod = np.sin(2 * np.pi * f * t) * idx
        tone = np.sin(2 * np.pi * f * t + mod)
        tine = np.sin(2 * np.pi * f * 14 * t) * np.exp(-t / .03) * .12
        env = np.minimum(1, t / .006) * np.exp(-t / 1.4) * np.clip((dur + .5 - t) / .5, 0, 1)
        out += (tone + tine) * env
    trem = 1 + .12 * np.sin(2 * np.pi * 4.8 * t)
    return filt(out * trem, 'low', 3000) * .11 * g


def bell(m, g=1.0):
    n = int(.9 * SR); t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + .35 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / .12)
    return x * np.minimum(1, t / .002) * np.exp(-t / .32) * .09 * g


def riser(dur, g=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); out = np.zeros(n); seg = 1024
    for i in range(0, n, seg):
        k = i / n; lo = 400 + 5000 * k ** 2
        out[i:i + seg] = filt(x[max(0, i - 4096):i + seg], 'band', [lo, min(lo * 2.5, 20000)])[-len(out[i:i + seg]):]
    return out * (t / dur) ** 2.2 * .28 * g


def impact(g=1.0):
    n = int(1.6 * SR); t = np.arange(n) / SR
    f = 38 + 60 * np.exp(-t / .05)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .6)
    air = filt(rng.standard_normal(n), 'low', 2500) * np.exp(-t / .25) * .25
    return np.tanh((boom + air) * 1.5) * .6 * g


# ---------- the song ----------
# A minor, jazzy: Am9 | Fmaj9 | Dm9 | E7(b9). One chord per bar.
CHORDS = [[60, 64, 67, 71], [57, 60, 64, 67], [60, 64, 65, 69], [56, 59, 62, 65]]
ROOTS = [33, 29, 26, 28]                    # A1, F1, D1, E1 (808)
# 808 rhythm in sixteenths: (step, length in steps). The last note glides to the next root.
BASS = [(0, 5), (6, 3), (10, 6)]
KICKS = [0, 10]
MOTIF = [(0, 76), (3, 79), (6, 81), (8, 84), (11, 83), (14, 79)]       # bell, in sixteenths
MOTIF_B = [(0, 81), (2, 79), (4, 76), (8, 74), (10, 76), (12, 72)]


def bar_t(b):
    return b * BAR


def drums(mus, b, full=True, roll=False):
    t0 = bar_t(b)
    for s in KICKS if full else [0]:
        place(mus, kick(), t0 + s * S16)
    place(mus, clap(.9), t0 + 2 * BEAT, pan=.05)
    for i in range(8):                                      # eighth hats
        place(mus, hat(.8 if i % 2 == 0 else .55), t0 + i * BEAT / 2, pan=.25)
    if roll:                                                # sixteenths, then triplets on the last beat
        for i in range(8, 12):
            place(mus, hat(.5), t0 + i * S16 + S16 * 4, pan=.25)
        for i in range(6):
            place(mus, hat(.35 + .08 * i), t0 + 3 * BEAT + i * BEAT / 6, pan=.3)
    elif b % 2 == 1:
        place(mus, hat(.5, open_=True), t0 + 3.5 * BEAT, pan=.2)


def bass_bar(mus, b, g=1.0):
    t0 = bar_t(b); ci = b % 4; nxt = ROOTS[(b + 1) % 4]
    for j, (s, ln) in enumerate(BASS):
        root = ROOTS[ci] + (12 if j == 1 else 0)            # the middle note jumps an octave
        place(mus, eight08(root, ln * S16, glide_to=nxt if j == 2 else None, g=g), t0 + s * S16)


def keys_bar(mus, b, g=1.0, bright=1.0):
    t0 = bar_t(b); ch = CHORDS[b % 4]
    place(mus, rhodes(ch, BAR * .55, g, bright), t0, pan=-.15)
    place(mus, rhodes(ch[1:], BAR * .3, g * .6, bright), t0 + 10 * S16, pan=.15)   # an off-beat answer


def bells_bar(mus, b, g=1.0):
    t0 = bar_t(b); motif = MOTIF if (b // 4) % 2 == 0 else MOTIF_B
    for s, m in motif:
        place(mus, bell(m, g), t0 + s * S16, pan=.35 if s % 2 else -.35)


def build():
    mus = np.zeros((2, N + SR))
    pre = np.zeros_like(mus)        # the part that gets a low-pass in the intro and outro
    bars = C['bars']
    for b in range(bars):
        if b < C['drop']:                                   # intro: filtered keys, hats, kicks on the cuts
            keys_bar(pre, b, 1.1, .7)
            for i in range(2):
                place(mus, kick(.8), bar_t(b) + i * 2 * BEAT)
            for i in range(8):
                place(mus, hat(.45), bar_t(b) + i * BEAT / 2, pan=.25)
            if b == C['drop'] - 1:
                for i in range(8):                          # snare build into the drop
                    place(mus, clap(.25 + .09 * i), bar_t(b) + 2 * BEAT + i * BEAT / 4)
                place(mus, riser(BAR), bar_t(b))
        elif C['stops'] <= b < C['end']:                    # stop-time: one hit per value line, then a build
            if b == C['stops']:
                for i in range(5):
                    t = bar_t(b) + i * BEAT
                    place(mus, kick(), t); place(mus, eight08(ROOTS[i % 4] + 12 * (i == 4), BEAT * .9), t)
                    place(mus, clap(.6), t, pan=.05)
                    place(mus, rhodes(CHORDS[i % 4], BEAT * .8, .9), t)
            else:
                keys_bar(pre, b, 1.0, .6)
                for i in range(16):
                    place(mus, clap(.15 + .05 * i), bar_t(b) + i * S16 + (0 if i < 8 else 0))
                for i in range(12):
                    place(mus, hat(.4), bar_t(b) + i * BEAT / 3, pan=.3)
                place(mus, riser(BAR, 1.2), bar_t(b))
        elif b >= C['outro']:                               # outro: filtered keys, one last 808
            keys_bar(pre, b, 1.1, .5)
            place(mus, eight08(ROOTS[0], BAR * .9, g=.9), bar_t(b))
            place(mus, kick(), bar_t(b))
        else:                                               # the groove
            roll = (b % 4 == 3) or b == C['end'] - 1
            drums(mus, b, roll=roll)
            bass_bar(mus, b)
            keys_bar(mus, b)
            if (b - C['drop']) >= 4 or b >= C['end']:
                bells_bar(mus, b, .9 if b >= C['end'] else .7)
        if b in (C['drop'], C['end']):
            place(mus, impact(.8), bar_t(b))
    # intro / outro keys through a low-pass that opens toward the drop
    lp = np.zeros_like(pre)
    for ch in range(2):
        lp[ch] = filt(pre[ch], 'low', 1400)
    mus += lp
    # gentle sidechain: everything but the kick breathes on each beat
    t = np.arange(mus.shape[1]) / SR
    duck = 1 - .18 * np.exp(-((t % BEAT) / .09))
    mus *= duck
    # the end: fade the last 0.6 s
    end = int(LENGTH * SR)
    mus = mus[:, :end]
    fade = np.clip((LENGTH - t[:end]) / .6, 0, 1)
    mus *= fade
    mus = np.tanh(mus * 1.1) / np.tanh(1.1)
    mus *= .89 / (np.max(np.abs(mus)) or 1)
    return mus


if __name__ == '__main__':
    mix = build()
    wavfile.write(sys.argv[1], SR, (mix.T * 32767).astype(np.int16))
    print('wrote', sys.argv[1], f'{LENGTH:.2f} s at {BPM} BPM')
