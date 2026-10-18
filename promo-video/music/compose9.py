"""Version 9 music: a brighter, faster jazz trio that plays along with the picture.

The owner on version 8: "make the music more positive but not electronic, and faster ... make
the sound match the visuals so a better connection can be made". So, still acoustic jazz (the
genre the owner likes), but:
- faster: 160 BPM, an up-tempo swing (version 8: 132);
- more positive: a major key with bright, rising changes (the "I-VI-ii-V" of up-tempo standards,
  dominant chords rather than minor ones, a bridge that climbs round the cycle A7 D7 G7 C7),
  and a bouncy melody high on the piano;
- more drive: sticks on a ride cymbal (version 8 had brushes), hi-hat on 2 and 4, a walking
  bass, a light kick.

How the sound follows the picture (all from the plan build.py writes, which comes from the
timeline itself):
- the opening: a piano note on each word of the headline as it appears, the band coming in on
  "screen.", a chord on each of the three promises, a full chord and a cymbal on the name, a
  drum fill into the laptop landing;
- every feature change (all on bar lines): a short drum fill in the beat before it, then a
  cymbal crash, a kick and the band's chord exactly as the new scene arrives;
- every callout: one soft, high piano note from the chord of that moment, as it pops up;
- the phone: a quick piano run up as it slides in; the twin's change of view: a ride-bell
  accent; the Home Assistant sensors: one note per row, rising;
- the values: a band hit on each word, on each beat; then the end card's cadence, and the last
  chord rings to the final frame.

Every instrument imitates an acoustic one, synthesised with numpy and SciPy (no samples, no
third-party audio, nothing to license). The piano and the bass are version 7's; the cymbals are
modal (dozens of inharmonic partials, each decaying at its own rate, as a struck metal plate
does) over a little noise, the drums are tuned membranes with a noise layer.

Usage: python3 compose9.py OUT.wav PLAN.json   (PLAN is build/music_<fmt>.json)
"""
import json
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose8 as c8                                   # noqa: E402  (the piano, the bass, the room)

SR = c8.SR
PLAN = json.load(open(sys.argv[2]))
BPM = PLAN['bpm']
BEAT = 60 / BPM                  # 0.375 s
BAR = 4 * BEAT                   # 1.5 s
LENGTH = PLAN['length']
N = int(LENGTH * SR)
SWING = .60
rng = np.random.default_rng(9)
c8.rng = rng
filt, piano, chord, bass, hz = c8.filt, c8.piano, c8.chord, c8.bass, c8.hz


def jit(t, ms=6):
    return t + rng.uniform(-ms, ms) / 1000


def vel(g, spread=.1):
    return g * (1 + rng.uniform(-spread, spread))


def place(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i < 0 or i >= buf.shape[1]:
        return
    x = x[: buf.shape[1] - i] * gain
    buf[0, i:i + len(x)] += x * np.cos((pan + 1) * np.pi / 4) * 1.414
    buf[1, i:i + len(x)] += x * np.sin((pan + 1) * np.pi / 4) * 1.414


def sw(t):
    """Swing a time: an off-beat eighth (half a beat after a beat) moves to 60% of the beat."""
    h = t / BEAT * 2
    if abs(h - round(h)) > 1e-3 or round(h) % 2 == 0:
        return t
    return (round(h) // 2 + SWING) * BEAT


# ---------- the drums ----------
def _modal(n_part, lo, hi, taus, dur, seed, tilt=.5):
    r = np.random.default_rng(seed)
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for f in np.exp(r.uniform(np.log(lo), np.log(hi), n_part)):
        tau = r.uniform(*taus) * (2500 / f) ** .35
        out += np.sin(2 * np.pi * f * t + r.uniform(0, 6.3)) * np.exp(-t / tau) * (1000 / f) ** tilt
    return out / n_part


def _ride(seed, bell=False):
    n = int(1.8 * SR); t = np.arange(n) / SR
    body = _modal(70, 420, 11000, (.5, 1.4), 1.8, seed)
    ping = filt(np.random.default_rng(seed + 1).standard_normal(n), 'band', [2500, 9000]) * np.exp(-t / .012) * .25
    x = body * (.9 if not bell else .5) + ping
    if bell:
        for f in (735, 1910, 3080):
            x += np.sin(2 * np.pi * f * t) * np.exp(-t / .9) * .05
    return filt(x, 'high', 300) * .9


RIDES = [_ride(s) for s in range(6)]
BELL = _ride(41, bell=True)


def ride(v=1.0):
    return RIDES[rng.integers(len(RIDES))] * .05 * v


def crash(v=1.0):
    n = int(2.6 * SR); t = np.arange(n) / SR
    wash = filt(rng.standard_normal(n), 'band', [2200, 12000]) * np.exp(-t / .9)
    body = _modal(90, 500, 12000, (.4, 1.1), 2.6, int(rng.integers(1000)), tilt=.3)
    x = (wash * .28 + body * 1.4) * np.minimum(1, t / .002)
    return filt(x, 'high', 400) * .085 * v


def chick(v=1.0):
    """The hi-hat closed with the foot on 2 and 4."""
    n = int(.08 * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'band', [5000, 11000]) * np.exp(-t / .018)
    x += _modal(20, 3000, 9000, (.02, .04), .08, int(rng.integers(1000))) * 2
    return x * .03 * v


def kick(v=1.0):
    n = int(.4 * SR); t = np.arange(n) / SR
    f = 52 + 50 * np.exp(-t / .03)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .2)
    x += filt(rng.standard_normal(n), 'band', [1500, 5000]) * np.exp(-t / .004) * .15     # the beater
    return x * .2 * v


def snare(v=1.0):
    n = int(.3 * SR); t = np.arange(n) / SR
    head = (np.sin(2 * np.pi * 190 * t) * .7 + np.sin(2 * np.pi * 330 * t) * .3) * np.exp(-t / .06)
    wires = filt(rng.standard_normal(n), 'band', [1800, 8000]) * np.exp(-t / .12)
    stick = filt(rng.standard_normal(n), 'band', [3000, 9000]) * np.exp(-t / .003) * .6
    return (head * .5 + wires * .55 + stick) * .09 * v


def tom(f0, v=1.0):
    n = int(.45 * SR); t = np.arange(n) / SR
    f = f0 * (1 + .25 * np.exp(-t / .03))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .22)
    x += filt(rng.standard_normal(n), 'band', [1500, 6000]) * np.exp(-t / .006) * .2
    return x * .11 * v


# ---------- the harmony ----------
# voicings (left hand, rootless, the way jazz pianists play them) and bass roots
V = {'F6': [57, 60, 62, 64], 'D7': [54, 57, 60, 64], 'Gm7': [53, 57, 58, 62], 'C7': [52, 57, 58, 62],
     'Am7': [55, 60, 64, 67], 'F7': [57, 60, 63, 67], 'Bb6': [58, 62, 65, 67], 'Bdim7': [59, 62, 65, 68],
     'F/C': [57, 60, 62, 65], 'A7': [55, 61, 64, 66], 'G7': [53, 57, 59, 64], 'Fmaj9': [57, 60, 64, 67, 69]}
ROOT = {'F6': 41, 'D7': 38, 'Gm7': 43, 'C7': 36, 'Am7': 45, 'F7': 41, 'Bb6': 46, 'Bdim7': 47, 'F/C': 36,
        'A7': 45, 'G7': 43, 'Fmaj9': 41}
# two chords a bar
A1 = [('F6', 'D7'), ('Gm7', 'C7'), ('Am7', 'D7'), ('Gm7', 'C7'), ('F7', 'F7'), ('Bb6', 'Bdim7'), ('F/C', 'D7'), ('Gm7', 'C7')]
A2 = A1[:7] + [('Gm7', 'C7')]
BR = [('A7', 'A7'), ('A7', 'A7'), ('D7', 'D7'), ('D7', 'D7'), ('G7', 'G7'), ('G7', 'G7'), ('C7', 'C7'), ('Gm7', 'C7')]
CHORUS = A1 + A2 + BR + A1
# the melody (beat, MIDI note, beats), eight bars; bright, bouncy, high on the piano
MEL_A = [(0, 72, 1), (1, 77, .5), (1.5, 76, .5), (2, 74, 1), (3, 72, 1),
         (4, 70, 1), (5, 74, .5), (5.5, 72, .5), (6, 70, 1), (7, 67, 1),
         (8, 69, 1.5), (9.5, 72, .5), (10, 74, 1), (11, 78, 1),
         (12, 79, 1.5), (13.5, 77, .5), (14, 76, 2),
         (16, 77, 1), (17, 75, .5), (17.5, 77, .5), (18, 81, 2),
         (20, 82, 1), (21, 79, 1), (22, 80, 1), (23, 77, 1),
         (24, 77, 1), (25, 74, 1), (26, 78, 1), (27, 74, 1),
         (28, 79, 1), (29, 77, 1), (30, 76, 1), (31, 72, 1)]
MEL_BR = [(0, 73, 2), (2, 76, 1), (3, 79, 1), (4, 81, 3), (7, 79, 1),
          (8, 78, 2), (10, 81, 1), (11, 84, 1), (12, 81, 3), (15, 78, 1),
          (16, 79, 2), (18, 83, 1), (19, 86, 1), (20, 83, 3), (23, 77, 1),
          (24, 76, 2), (26, 79, 1), (27, 82, 1), (28, 79, 2), (30, 76, 1), (31, 72, 1)]
MELODY = [MEL_A, None, MEL_BR, MEL_A]          # the second A lays out: the piano comps


BAND = PLAN['band']                    # bar 6: the band kicks in as the laptop lands (how it works)
VALUES, START, END = PLAN['values'], PLAN['start'], PLAN['end']
INTRO = [  # (bar, beat, chord) under the opening: the hook, what it is for, the name
    (0, 0, 'Fmaj9'), (1, 0, 'Bb6'), (2, 0, 'F6'), (2, 2, 'Am7'), (3, 0, 'Bb6'), (3, 1, 'Am7'), (3, 2, 'D7'),
    (4, 0, 'Gm7'), (4, 1, 'C7'), (4, 2, 'Fmaj9'), (5, 0, 'F6'), (5, 2, 'Gm7'), (5, 3, 'C7')]


def chord_at(t):
    """The chord sounding at time t (for the callout notes)."""
    if t < BAND:
        cur = 'Fmaj9'
        for bar, beat, ch in INTRO:
            if bar * BAR + beat * BEAT <= t + 1e-6:
                cur = ch
        return cur
    if VALUES <= t < START:
        return 'F6'
    k = int((t - BAND) // (BAR / 2))
    bar, half = divmod(k, 2)
    return CHORUS[bar % 32][half]


def tones(ch, lo=79, hi=93):
    """The chord's notes (with its 9th or 6th, the bright ones) in the piano's top octave."""
    pcs = sorted({m % 12 for m in V[ch]} | {ROOT[ch] % 12})
    return [m for m in range(lo, hi) if m % 12 in pcs]


def build():
    mus = np.zeros((2, N + 3 * SR))
    wet = np.zeros_like(mus)

    def pn(m, t, ln, v, pan=.1, w=.9):
        x = piano(m, ln, vel(v, .06)); place(mus, x, t, pan=pan); place(wet, x * w, t)

    def ch(name, t, ln, v, pan=-.15):
        x = chord(V[name], ln, vel(v, .06)); place(mus, x, t, pan=pan); place(wet, x * .8, t)

    def bs(m, t, ln, v=.9):
        place(mus, bass(m, ln, vel(v, .06)), t)

    def time_keeping(t0, n_bars, light=False):
        """Ride (ding, ding-a ding), hi-hat on 2 and 4, a feathered kick, the odd snare ghost."""
        for b in range(int(n_bars)):
            tb = t0 + b * BAR
            for beat, v in ((0, .85), (1, 1.0), (1.5, .55), (2, .85), (3, 1.0), (3.5, .55)):
                place(mus, ride(vel(v * (.7 if light else 1), .15)), jit(tb + sw(beat * BEAT), 4), pan=.35)
            for q in (1, 3):
                place(mus, chick(vel(.9, .15)), jit(tb + q * BEAT, 3), pan=.25)
            if not light:
                for q in range(4):
                    place(mus, kick(vel(.25, .2)), jit(tb + q * BEAT, 3))
                if rng.random() < .55:
                    place(mus, snare(vel(.22, .3)), jit(tb + sw((rng.integers(4) + .5) * BEAT), 4), pan=-.1)

    def walk(t0, c1, c2, nxt):
        """Four walking bass notes over a bar of two chords, leading into the next root."""
        r1, r2 = ROOT[c1], ROOT[c2]
        third = 3 if 'm' in c1 and 'maj' not in c1 else 4
        if c1 == c2:
            notes = [r1, r1 + third, r1 + 7, nxt + (1 if r1 + 7 > nxt else -1)]
        else:
            notes = [r1, r1 + 7, r2, nxt + 1 if nxt + 1 != r2 else nxt - 1]
        for q, m in enumerate(notes):
            while m > 52: m -= 12
            while m < 31: m += 12
            bs(m, jit(t0 + q * BEAT, 4), BEAT * .9, .95 if q == 0 else .82)

    # ===== the opening: the hook, what it is for, the name =====
    cues = PLAN['cues']
    for c in cues:
        if c['k'] == 'hook':                                         # each line of the hook: a soft chord and a high note
            ch('Fmaj9' if c['i'] == 0 else 'Bb6', c['t'], 1.4, .34)
            pn(84 if c['i'] == 0 else 86, c['t'], 1.0, .4, pan=.2)
            if c['i']:
                bs(46, c['t'], 1.3, .7)
    words = [c for c in cues if c['k'] == 'word']
    for c, m in zip(words, [72, 74, 77, 79, 81, 84, 86]):           # one note per word, rising
        pn(m, c['t'], .5, .5, pan=.15)
    for bar, beat, name in INTRO[2:]:
        t = bar * BAR + beat * BEAT
        ch(name, t, (2 if beat in (0, 2) else 1) * BEAT * .95, .5 if beat == 0 else .42)
        bs(ROOT[name], t, BEAT * (1.9 if beat in (0, 2) else .9), .9)
    time_keeping(2 * BAR, 4, light=True)                              # ride and hi-hat from "what it is for"
    for c in cues:
        if c['k'] == 'item':                                           # each promise: a kick and a snare hit
            place(mus, kick(.7), c['t']); place(mus, snare(.35), c['t'], pan=-.1)
    name_t = next(c['t'] for c in cues if c['k'] == 'name')
    place(mus, crash(.8), name_t, pan=-.3); place(mus, kick(.9), name_t)
    for i, m in enumerate([77, 81, 84, 88]):                            # a little sparkle over the name
        pn(m, name_t + .06 + i * .07, .9, .3, pan=.25)
    # the fill into the band: snare eighths, then toms
    for i, (beat, kind) in enumerate([(2, 's'), (2.5, 's'), (3, 't1'), (3.5, 't2')]):
        t = BAND - BAR + sw(beat * BEAT)
        place(mus, snare(.5 + .1 * i) if kind == 's' else tom(150 if kind == 't1' else 110, .9), jit(t, 3), pan=-.1)

    # ===== the band: from how it works to the end card (the values have hits of their own) =====
    rest = lambda t: VALUES - 1e-6 <= t < START - 1e-6                # the values' two bars
    n_bars = int(round((END - BAND) / BAR))
    time_keeping(BAND, int(round((VALUES - BAND) / BAR)))
    time_keeping(VALUES, 2, light=True)
    time_keeping(START, int((END - START) // BAR))
    for b in range(n_bars):
        t0 = BAND + b * BAR
        c1, c2 = CHORUS[b % 32]
        nxt = ROOT[CHORUS[(b + 1) % 32][0]]
        if rest(t0):
            continue
        walk(t0, c1, c2, nxt)
        # piano: the Charleston (1, and-of-2) on the first chord, a push on the and-of-4 every other bar
        ch(c1, jit(t0), .9 * BEAT, .46)
        ch(c2, jit(t0 + sw(1.5 * BEAT)), 1.2 * BEAT, .38)
        if b % 2 == 1 and not rest(t0 + BAR) and t0 + BAR < END:
            ch(CHORUS[(b + 1) % 32][0], jit(t0 + sw(3.5 * BEAT)), .8 * BEAT, .32)
    # the melody: the first, third and fourth eight-bar sections of each chorus
    for start in range(0, n_bars, 8):
        mel = MELODY[(start // 8) % 4]
        if mel is None:
            continue
        for beat, m, ln in mel:
            t = BAND + start * BAR + sw(beat * BEAT)
            if t < END - .1 and not rest(t):
                pn(m + 12, jit(t, 6), ln * BEAT * .9, .34, pan=.1)

    # ===== the picture's moments =====
    for c in cues:
        t, k = c['t'], c['k']
        if k == 'callout':                                  # one soft high note from the chord
            cand = tones(chord_at(t), 84, 96)
            pn(cand[int(rng.integers(len(cand)))], sw(t), .45, .42, pan=.3)
        elif k == 'row':                                    # the sensor rows: rising, one note each
            tt = tones(chord_at(t), 81, 98)
            pn(tt[min(c['i'], len(tt) - 1)], sw(t), .35, .36, pan=.3)
        elif k == 'phone':                                  # a quick run up as the phone slides in
            tt = tones(chord_at(t + .4), 72, 98)[:8]
            for i, m in enumerate(tt):
                pn(m, t + i * BEAT / 4, .35, .3 + .02 * i, pan=.25)
        elif k == 'cut':                                    # the twin's change of view: the ride's bell
            place(mus, BELL * .07, t, pan=.35)
        elif k == 'step':                                   # each step of how it works: a bright two-note bell
            tt = tones(chord_at(t), 84, 98)
            pn(tt[-1], t, .8, .38, pan=.25); pn(tt[-3], t + .02, .8, .32, pan=.25)
        elif k == 'tile':                                   # the shelf filling up: one soft note per printer
            pn([72, 76, 79, 81, 84, 88][c['i']], t, .4, .3, pan=.3)
        elif k == 'alert':                                  # one of them flags a problem: a light snare tap
            place(mus, snare(.3), t, pan=-.1)
        elif k in ('node', 'card', 'start'):                # each printer, phone, card, step: one rising note
            tt = tones(chord_at(t), 79, 99)
            pn(tt[min(c['i'] * 2, len(tt) - 1)], sw(t), .45, .4, pan=.3)
    # every feature change: a fill in the beat before, then a crash, a kick, the band's chord
    for i, t in enumerate(PLAN['changes']):
        fill = [(-1, 's', .5), (-.5, 's', .65)] if i % 3 else [(-1, 't1', .8), (-.5, 't2', .85)]
        if i % 3 == 2:
            fill = [(-1.5, 's', .4), (-1, 's', .5), (-.5, 's', .6)]
        for beat, kind, v in fill:
            tt = t + beat * BEAT
            tt = t - BEAT + sw(.5 * BEAT) if beat == -.5 else tt
            place(mus, snare(v) if kind == 's' else tom(150 if kind == 't1' else 110, v), jit(tt, 3), pan=-.1)
        place(mus, crash(.55 if i % 2 else .7), t, pan=(-.3 if i % 2 else .3))
        place(mus, kick(.8), t)
    place(mus, crash(.8), BAND, pan=-.3); place(mus, kick(1.0), BAND)

    # ===== the values: a band hit on each word, on each beat =====
    vals = [c for c in cues if c['k'] == 'value']
    for c, name in zip(vals, ['F6', 'D7', 'Gm7', 'C7', 'F6']):
        t = c['t']
        ch(name, t, BEAT * .7, .55); bs(ROOT[name], t, BEAT * .8, 1.0)
        place(mus, kick(.9), t); place(mus, snare(.45), t, pan=-.1)
        if c['i'] == 0:
            place(mus, crash(.7), t, pan=.3)
        pn(tones(name, 84, 96)[-1], t, .4, .4, pan=.2)
    for beat, v in ((2, .4), (2.5, .5), (3, .6), (3.5, .7)):                    # the fill into the end card
        place(mus, snare(v), jit(END - BAR + sw(beat * BEAT), 3), pan=-.1)

    # ===== the end card: ii-V, then the home chord rings to the last frame =====
    place(mus, crash(.75), END, pan=-.3); place(mus, kick(.9), END)
    ch('Gm7', END, BEAT * 1.9, .48); bs(43, END, BEAT * 1.9)
    ch('C7', END + 2 * BEAT, BEAT * 1.9, .46); bs(36, END + 2 * BEAT, BEAT * 1.9)
    time_keeping(END, 1, light=True)
    fin = END + BAR
    x = chord(V['Fmaj9'] + [72], LENGTH - fin, .5); place(mus, x, fin, pan=-.1); place(wet, x, fin)
    bs(29, fin, 3.6, .95)
    place(mus, crash(.6), fin, pan=.3); place(mus, BELL * .06, fin, pan=.35)
    for i, m in enumerate([79, 81, 84, 88, 91]):
        pn(m, fin + .3 + i * .09, 2.2, .3, pan=.2)

    # a small room
    tt = np.arange(int(1.2 * SR)) / SR
    ir = rng.standard_normal((2, len(tt))) * np.exp(-tt / .28)
    ir = np.stack([filt(cc, 'low', 4200) for cc in ir])
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    for k in range(2):
        mus[k] += signal.fftconvolve(wet[k], ir[k])[: mus.shape[1]] * .3
    mus = mus[:, :N]
    t = np.arange(N) / SR
    mus *= np.clip((LENGTH - t) / 1.2, 0, 1) * np.clip(t / .01, 0, 1)
    mus = filt(mus, 'high', 35)
    mus = np.tanh(mus * 1.2) / np.tanh(1.2)
    return mus * (.89 / (np.max(np.abs(mus)) or 1))


if __name__ == '__main__':
    out = build()
    wavfile.write(sys.argv[1], SR, (out.T * 32767).astype(np.int16))
    print('wrote', sys.argv[1], f'{LENGTH:.1f} s at {BPM} BPM,', len(PLAN['cues']), 'picture cues,',
          len(PLAN['changes']), 'feature changes')
