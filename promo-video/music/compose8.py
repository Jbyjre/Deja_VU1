"""Version 8 music: the same quiet jazz piano trio as version 7 (the owner: "I'm liking the
current genre more but make it faster"), moved up to a medium-up swing at 132 BPM.

What makes it feel faster, not just the tempo number:
- the bass walks four notes to the bar the whole way (version 7 played two, a "two-feel");
- the brushes play the ride pattern (swung eighths, "ding, ding-a ding") over the swirl, with
  the slap on 2 and 4;
- the piano comps the Charleston rhythm (beat 1 and the swung "and" of 2) and sometimes pushes
  a chord early, on the "and" of 4, the way jazz pianists drive a tune forward.
It stays light: same soft piano, same small room, no key change, no stop-time hits, no effects.

Every feature change in the video falls on a bar line of this music (build.py lays the timeline
out in bars of it), so the cuts land with the band.

Every instrument imitates an acoustic one, synthesised with numpy and SciPy (no samples, no
third-party audio, nothing to license); the instruments are version 7's.

Usage: python3 compose8.py OUT.wav main|vertical   (both cuts are 75 s)
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 132
BEAT = 60 / BPM                  # 0.4545 s
BAR = 4 * BEAT                   # 1.818 s
LENGTH = 75.0
N = int(LENGTH * SR)
SWING = .60                      # the off-beat eighth at 60% of the beat (a faster tune swings a little straighter)
rng = np.random.default_rng(7)

# 40 bars: intro 2 (the icons and the name), A A B A of eight bars, a four-bar tag (the last
# four bars of A again, under the closing values), a two-bar ending, then the last chord rings.
GROOVE_BAR = 2                   # 3.64 s: bass and brushes come in as the laptop lands
MELODY_SECTIONS = (1, 2, 3)      # which eight-bar sections (0 = first A) carry the melody


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def jit(t, ms=8):
    return t + rng.uniform(-ms, ms) / 1000


def vel(g, spread=.12):
    return g * (1 + rng.uniform(-spread, spread))


def place(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= buf.shape[1] or i < 0:
        return
    x = x[: buf.shape[1] - i] * gain
    buf[0, i:i + len(x)] += x * np.cos((pan + 1) * np.pi / 4) * 1.414
    buf[1, i:i + len(x)] += x * np.sin((pan + 1) * np.pi / 4) * 1.414


def filt(x, kind, fc, order=2):
    b, a = signal.butter(order, np.array(fc) / (SR / 2), kind)
    return signal.lfilter(b, a, x)


def swing(beat):
    """A position in beats, with the off-beat eighths swung."""
    whole, frac = divmod(beat, 1)
    return (whole + (SWING if abs(frac - .5) < 1e-6 else frac)) * BEAT


# ---------- the instruments ----------
def piano(m, dur, v=.6):
    """One piano note, held for dur seconds then damped."""
    f0 = hz(m)
    rel = .18
    n = int((dur + rel) * SR); t = np.arange(n) / SR
    B = 1.2e-4 * (f0 / 261.6) ** 1.2              # inharmonicity grows up the keyboard
    base = 2.6 * (261.6 / f0) ** .45               # lower notes ring longer
    K = int(min(18, 7000 / f0))
    out = np.zeros(n)
    bright = .35 + .65 * v                         # a harder touch has more upper partials
    for k in range(1, K + 1):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        a = (1 / k ** 1.25) * np.exp(-(k - 1) * (1.1 - bright) * .55)
        tau = base / (1 + .45 * (k - 1))
        env = .72 * np.exp(-t / (tau * .32)) + .28 * np.exp(-t / tau)     # prompt sound, then aftersound
        det = 1 + rng.uniform(.0002, .0005)                                # the second string, slightly sharp
        ph = rng.uniform(0, 2 * np.pi)
        out += a * env * (np.sin(2 * np.pi * fk * t + ph) + .8 * np.sin(2 * np.pi * fk * det * t + ph))
    hammer = filt(rng.standard_normal(n), 'band', [min(f0 * 2, 3000), min(f0 * 8, 9000)]) * np.exp(-t / .004) * .05 * v
    out = (out + hammer) * np.minimum(1, t / .003)
    damp = np.clip((dur + rel - t) / rel, 0, 1) ** 2                       # the damper comes down
    out *= damp
    return filt(out, 'low', 2200 + 3800 * v) * .055 * v


def chord(notes, dur, v=.5, roll=.012):
    """A soft chord, the notes a few milliseconds apart like a real hand."""
    n = int((dur + .4) * SR)
    out = np.zeros(n)
    for i, m in enumerate(notes):
        x = piano(m, dur - i * roll, vel(v, .1))
        o = int(i * roll * SR)
        out[o:o + len(x)] += x[: n - o]
    return out


def ks(m, dur, decay, bright):
    n = int(dur * SR)
    d = max(2, int(round(SR / hz(m))))
    exc = np.zeros(n)
    exc[:d] = filt(rng.standard_normal(d), 'low', bright) * np.hanning(d) ** .5
    a = np.zeros(d + 2); a[0] = 1; a[d] = -decay / 2; a[d + 1] = -decay / 2
    return signal.lfilter([1], a, exc)


def bass(m, dur, v=1.0):
    x = ks(m, dur + .1, .9978, 650)
    t = np.arange(len(x)) / SR
    x = filt(x, 'low', 800) * 1.3
    x += np.sin(2 * np.pi * hz(m) * t) * np.exp(-t / .1) * .35
    x *= np.clip((dur + .1 - t) / .1, 0, 1)
    return np.tanh(x * 1.1) * .42 * v


def swirl(dur):
    """The brush circling the snare head: soft noise that swells once per beat."""
    n = int(dur * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'band', [900, 5500])
    env = .55 + .45 * np.sin(2 * np.pi * t / BEAT - np.pi / 2) ** 2
    return x * env * .0095


def slap(v=1.0):
    n = int(.14 * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'band', [700, 6000]) * (np.minimum(1, t / .002) * np.exp(-t / .035))
    return x * .045 * v


# ---------- the tune ----------
A_CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [58, 62, 65, 69], [58, 62, 64, 69],      # Fmaj9 Dm9 Gm9 C13
            [60, 64, 67, 71], [54, 60, 63, 69], [58, 62, 65, 69], [57, 60, 64, 67]]      # Am9 D7b9 Gm9 Fmaj9
A_ROOTS = [41, 38, 43, 36, 45, 38, 43, 41]
B_CHORDS = [[57, 62, 65, 69], [58, 61, 65, 67], [60, 64, 67, 71], [54, 60, 64, 69],      # Bbmaj9 Bbm6 Am9 D9
            [58, 62, 65, 69], [58, 62, 64, 69], [57, 60, 64, 67], [58, 62, 64, 69]]      # Gm9 C13 Fmaj9 C13
B_ROOTS = [46, 46, 45, 38, 43, 36, 41, 36]
A_MEL = [(0, 72, 1.5), (1.5, 69, .5), (2, 72, 1), (3, 76, 1), (4, 74, 2), (6, 72, 1), (7, 69, 1),
         (8, 70, 1.5), (9.5, 69, .5), (10, 67, 1), (11, 70, 1), (12, 69, 3), (15, 67, 1),
         (16, 72, 1.5), (17.5, 71, .5), (18, 72, 1), (19, 76, 1), (20, 78, 1.5), (21.5, 75, .5), (22, 72, 2),
         (24, 70, 1), (25, 69, 1), (26, 67, 1), (27, 64, 1), (28, 65, 4)]
B_MEL = [(0, 74, 2), (2, 72, 1), (3, 69, 1), (4, 73, 2), (6, 70, 2), (8, 72, 2), (10, 76, 2),
         (12, 78, 2), (14, 74, 2), (16, 70, 2), (18, 74, 2), (20, 76, 3), (23, 70, 1),
         (24, 69, 4), (28, 67, 2), (30, 70, 1), (31, 72, 1)]


def ride(v=1.0):
    """A brush tapped on the ride's edge: a short, bright, airy tick."""
    n = int(.09 * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'band', [3000, 9000]) * (np.minimum(1, t / .001) * np.exp(-t / .028))
    return x * .016 * v


def bar(mus, wet, t0, chords, roots, b, si, last=False):
    """One bar of the trio: comping, walking bass, brushes."""
    # piano: Charleston (beat 1, the swung "and" of 2); every fourth bar a held chord; now and then
    # the next chord pushed in early on the "and" of 4
    if (b + si) % 4 == 3:
        hits = [(0, 2.6, .40)]
    else:
        hits = [(0, .9, .44), (1.5, 1.6, .34)]
    for beat, ln, v in hits:
        x = chord(chords[b], ln * BEAT, v)
        place(mus, x, jit(t0 + swing(beat), 6), pan=-.15); place(wet, x * .8, t0 + swing(beat))
    if (b + si) % 4 == 1 and not last:
        nb = chords[(b + 1) % len(chords)]
        x = chord(nb, .9 * BEAT, .30)
        place(mus, x, jit(t0 + swing(3.5), 6), pan=-.15); place(wet, x * .8, t0 + swing(3.5))
    # bass: four to the bar: root, third (or fifth), fifth (or sixth), then a half step into the
    # next root, so every line leads smoothly into the next chord
    r, nxt = roots[b], roots[(b + 1) % len(roots)]
    pcs = {m % 12 for m in chords[b]}
    third = 3 if (r + 3) % 12 in pcs and (r + 4) % 12 not in pcs else 4
    walk = [r, r + third, r + 7, nxt + 1 if r + 7 > nxt else nxt - 1] if b % 2 == 0 else \
           [r, r + 7, r + 9, nxt + 1 if r + 9 > nxt else nxt - 1]
    for q, m in enumerate(walk):
        place(mus, bass(m, BEAT * .92, vel(.92 if q == 0 else .8, .07)), jit(t0 + q * BEAT, 5))
    # brushes: swirl, the ride pattern (1, 2, and-of-2, 3, 4, and-of-4), slap on 2 and 4
    place(mus, swirl(BAR + .05), t0, pan=.25)
    for beat, v in ((0, .9), (1, 1.0), (1.5, .55), (2, .9), (3, 1.0), (3.5, .55)):
        place(mus, ride(vel(v, .15)), jit(t0 + swing(beat), 4), pan=.35)
    for q in (1, 3):
        x = slap(vel(.85, .2))
        place(mus, x, jit(t0 + q * BEAT, 4), pan=.2); place(wet, x * .5, t0 + q * BEAT)


def build():
    mus = np.zeros((2, N + 3 * SR))
    wet = np.zeros_like(mus)
    # intro: a quick rising arpeggio over the icons (one note per icon, 0.08 s apart, as the
    # icons are), then the chord under the name
    for i, m in enumerate([53, 57, 60, 64, 67, 69, 72, 76, 79, 81, 84, 88, 91, 93]):
        x = piano(m, .7, .32 + .012 * i)
        place(mus, x, .1 + i * .08, pan=-.35 + i * .05); place(wet, x, .1 + i * .08)
    x = chord([45, 52, 57, 60, 64, 67], 1.8, .42)
    place(mus, x, 2.0, pan=-.1); place(wet, x, 2.0)
    # a pickup on the bass into the band
    for q, m in enumerate((36, 38, 40)):
        place(mus, bass(m, BEAT * .9, .8), (GROOVE_BAR - 1) * BAR + (q + 1) * BEAT)
    sections = [(A_CHORDS, A_ROOTS, A_MEL), (A_CHORDS, A_ROOTS, A_MEL), (B_CHORDS, B_ROOTS, B_MEL), (A_CHORDS, A_ROOTS, A_MEL)]
    for si, (chords, roots, mel) in enumerate(sections):
        t_sec = (GROOVE_BAR + si * 8) * BAR
        for b in range(8):
            bar(mus, wet, t_sec + b * BAR, chords, roots, b, si)
        if si in MELODY_SECTIONS:
            for beat, m, ln in mel:
                x = piano(m + 12, ln * BEAT * .9, vel(.42, .08))
                place(mus, x, jit(t_sec + swing(beat), 8), pan=.1); place(wet, x * .9, t_sec + swing(beat))
    # the tag: the last four bars of A once more, under the values
    t_tag = (GROOVE_BAR + 32) * BAR
    for b in range(4):
        bar(mus, wet, t_tag + b * BAR, A_CHORDS, A_ROOTS, 4 + b, 0, last=b == 3)
    # the ending (as the end card comes in): ii-V, then the home chord rings to the last frame
    t_end = (GROOVE_BAR + 36) * BAR                 # 69.1 s
    for beat, ch, r in ((0, [58, 62, 65, 69], 43), (2, [58, 62, 64, 69], 36)):
        x = chord(ch, BEAT * 1.9, .42)
        place(mus, x, jit(t_end + beat * BEAT), pan=-.15); place(wet, x * .8, t_end + beat * BEAT)
        place(mus, bass(r, BEAT * 1.9, .9), t_end + beat * BEAT)
    place(mus, swirl(BAR), t_end, pan=.25)
    x = chord([45, 52, 57, 60, 64, 67], LENGTH - t_end - BAR, .45)
    place(mus, x, t_end + BAR, pan=-.15); place(wet, x, t_end + BAR)
    place(mus, bass(29, 3.2, .9), t_end + BAR)
    for i, m in enumerate([72, 76, 79, 81]):
        x = piano(m + 12, 2.0, .3)
        place(mus, x, t_end + BAR + .4 + i * .12, pan=.2); place(wet, x, t_end + BAR + .4 + i * .12)
    # a small room
    tt = np.arange(int(1.2 * SR)) / SR
    ir = rng.standard_normal((2, len(tt))) * np.exp(-tt / .28)
    ir = np.stack([filt(c, 'low', 4200) for c in ir])
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    for ch in range(2):
        mus[ch] += signal.fftconvolve(wet[ch], ir[ch])[: mus.shape[1]] * .32
    mus = mus[:, :N]
    t = np.arange(N) / SR
    mus *= np.clip((LENGTH - t) / 1.2, 0, 1) * np.clip(t / .02, 0, 1)
    mus = filt(mus, 'high', 35)
    mus = np.tanh(mus * 1.2) / np.tanh(1.2)
    return mus * (.89 / (np.max(np.abs(mus)) or 1))


if __name__ == '__main__':
    out = build()
    wavfile.write(sys.argv[1], SR, (out.T * 32767).astype(np.int16))
    print('wrote', sys.argv[1], f'{LENGTH:.1f} s at {BPM} BPM')
