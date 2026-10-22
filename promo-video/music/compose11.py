"""Version 13 music: a new tune, bright lounge jazz with a vibraphone melody, played along with
the picture.

The owner on version 12: make it 60 s, with "elevator and jazzy" music that is "exciting, just
interesting to listen to". Every earlier tune was a trio comping under the picture, mostly chords
on cues, without a tune of its own. This one has one: a short, singable vibraphone hook (the
classic sound of lounge and "elevator" jazz) stated in full when the name appears, answered and
restated as each feature's headline lands, and played one last time over the end card. Under it a
swinging quartet at 144 BPM (a bar is 1.667 s, so 36 bars make exactly 60 s): piano comping in
the Charleston rhythm, a walking upright bass, ride cymbal and hi-hat.

It builds the way the film does: the problem is quiet and a little unsettled (piano and vibes
alone, then the bass walks in, a bass pedal under "And miss the one that needs you."), the band
arrives with a full chord and a cymbal on the name, and from there it swings to the end.

How the sound follows the picture (all from the plan build.py writes, which comes from the
timeline itself):
- the problem: a low piano chord on each line; a soft rising vibes note on each window that
  appears; a vibes note on each window the ring checks; a dark two-note vibes chord on the alert;
- the name: drum fill, crash, kick, the band's chord and the hook; the tagline rides the hook;
- how it works: a piano chord on each chip, a rising vibes note on each printer and the phone;
- every feature change (all on bar or half-bar lines): a short fill before it, then a crash, a
  kick and the band's chord as it arrives, and the head of the hook (or its answer) under the
  headline while it holds the frame; the harmony restarts from the home chord on every scene;
- every callout: one soft, high vibes note from the chord of that moment;
- the phone: a quick piano run up; the twin's change of view: the ride's bell;
- "and plenty more": one rising vibes note per card; the values: a band hit on each line;
- the end card: ii-V-I, the hook once more, quietly, and the home chord rings to the last frame.

Instruments (recorded, all downloaded by music/fetch_samples.sh; nothing synthesised):
- vibraphone: VCSL (Versilian Community Sample Library), soft and hard mallets (CC0).
  Source: github.com/sgossner/VCSL. Its files are named an octave low (measured: "A2" is 220 Hz,
  A3), so one octave is added, as for the bass.
- piano, upright bass, drums: as in version 11 (compose10.py): Salamander Grand Piano V3
  (CC BY 3.0, credited), VSCO 2 CE contrabass pizzicato (CC0), Virtuosity Drums (CC0).

Usage: python3 compose11.py OUT.wav PLAN.json   (PLAN is build/music_<fmt>.json)
"""
import glob
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose10 as c10                                  # noqa: E402  (the recorded piano, bass and drums)

c9 = c10.c9
SR = c10.SR
PLAN = json.load(open(sys.argv[2]))
BPM = PLAN['bpm']
BEAT = 60 / BPM                  # 0.4167 s
BAR = 4 * BEAT                   # 1.667 s
LENGTH = PLAN['length']
N = int(LENGTH * SR)
SWING = .62
rng = np.random.default_rng(13)
c10.rng = rng
place, filt = c9.place, c9.filt
piano, chord, bass = c10.piano, c10.chord, c10.bass
ride, crash, chick, kick, snare = c10.ride, c10.crash, c10.chick, c10.kick, c10.snare


def jit(t, ms=5):
    return t + rng.uniform(-ms, ms) / 1000


def vel(g, spread=.1):
    return g * (1 + rng.uniform(-spread, spread))


def sw(t0, b):
    """The time of beat b after t0, swung: an off-beat eighth moves to 62% of the beat."""
    whole = np.floor(b + 1e-6)
    return t0 + (whole + (SWING if abs(b - whole - .5) < 1e-6 else b - whole)) * BEAT


# ---------- the vibraphone (VCSL: Vibes_soft_A2_v2_rr1_Main.wav; named an octave low) ----------
VIBES = {}
for p in glob.glob(os.path.join(c10.SAMPLES, 'vibes', '*.wav')):
    m = re.match(r'Vibes_(soft|hard)_([A-G]#?\d)_v(\d)_rr(\d)_Main\.wav', os.path.basename(p))
    if m:
        VIBES.setdefault(m.group(1), {}).setdefault(c10.midi(m.group(2), 1), {})[int(m.group(3))] = p


def vibes(m, dur, v=.6, hard=False):
    """One vibraphone note: the nearest recorded bar and dynamic, rung for dur, then the pedal
    comes up (a soft damp, as a vibes player's pedal does)."""
    bank = VIBES['hard' if hard and 'hard' in VIBES else 'soft']
    notes = np.array(sorted(bank))
    n = int(notes[np.argmin(np.abs(notes - m))])
    layers = bank[n]
    layer = max(layers) if v > .55 else min(layers)
    x = c10.repitch(c10.load(layers[layer]), m - n)
    rel = .35
    end = min(len(x), int((dur + rel) * SR))
    x = x[:end].copy()
    k = max(0, end - int(rel * SR))
    x[k:] *= np.linspace(1, 0, end - k) ** 1.5
    return x * (.35 + .65 * v) * 1.15


# ---------- harmony: the four-bar loop of up-tempo standards, two beats a chord ----------
V = {  # rootless voicings, mid register (MIDI)
    'Fmaj7': [57, 60, 64, 67], 'Fmaj9': [57, 60, 64, 67, 69], 'D7': [54, 57, 60, 64], 'Gm7': [58, 62, 65, 69],
    'C7': [58, 62, 64, 69], 'Am7': [55, 60, 64, 67], 'Bb7': [56, 60, 62, 67], 'Dm7': [57, 60, 62, 65],
}
ROOT = {'Fmaj7': 41, 'Fmaj9': 41, 'D7': 38, 'Gm7': 43, 'C7': 36, 'Am7': 45, 'Bb7': 46, 'Dm7': 38}
TONES = {'Fmaj7': [0, 4, 7, 11, 2], 'Fmaj9': [0, 4, 7, 11, 2], 'D7': [0, 4, 7, 10, 2], 'Gm7': [0, 3, 7, 10, 2],
         'C7': [0, 4, 7, 10, 9], 'Am7': [0, 3, 7, 10], 'Bb7': [0, 4, 7, 10], 'Dm7': [0, 3, 7, 10]}
LOOP = ['Fmaj7', 'D7', 'Gm7', 'C7', 'Am7', 'D7', 'Gm7', 'C7']


def tones(name, lo, hi):
    r = ROOT[name] % 12
    return sorted(m for m in range(lo, hi) if (m - r) % 12 in TONES[name])


# where the harmony restarts from the home chord: the name, how it works, each feature, the rest
STARTS = sorted({0.0, PLAN['name'], PLAN['hiw'], *PLAN['changes'], PLAN['values'], PLAN['end']})


def chord_at(t):
    s = max(x for x in STARTS if x <= t + 1e-6)
    if s == PLAN['end']:                                       # the end card: ii-V, then home
        b = (t - s) / BEAT
        return 'Gm7' if b < 2 else 'C7' if b < 4 else 'Fmaj9'
    if t < PLAN['name']:                                       # the problem: unsettled, no home chord yet
        return ['Dm7', 'Gm7', 'Dm7', 'Gm7', 'Bb7', 'Am7', 'Gm7', 'C7', 'C7', 'C7'][min(9, int(t / (2 * BEAT)))]
    return LOOP[int((t - s) / (2 * BEAT) + 1e-6) % 8]


# ---------- the tune ----------
# (beat from the phrase's start, MIDI note, length in beats); off-beats are swung by sw()
HOOK = [(.5, 72, .5), (1, 69, .5), (1.5, 72, .5), (2, 74, 1), (3, 78, 1.5), (4.5, 76, .5), (5, 74, .5), (5.5, 72, .5), (6, 69, 2)]
ANSWER = [(.5, 76, .5), (1, 72, .5), (1.5, 76, .5), (2, 78, 1), (3, 81, 1.5), (4.5, 79, .5), (5, 77, .5), (5.5, 76, .5), (6, 74, 1), (7, 72, 1)]


def build():
    mus = np.zeros((2, N + SR * 3), dtype=np.float32)
    wet = np.zeros_like(mus)
    cues = PLAN['cues']
    NAME, HIW, MORE, VALUES, END = PLAN['name'], PLAN['hiw'], PLAN['more'], PLAN['values'], PLAN['end']

    def vb(m, t, dur, v=.55, pan=.25, hard=False, send=.35):
        x = vibes(m, dur, vel(v), hard)
        place(mus, x, t, pan=pan); place(wet, x * send, t, pan=pan)

    def pn(m, t, dur, v=.4, pan=-.15):
        x = piano(m, dur, vel(v))
        place(mus, x, t, pan=pan); place(wet, x * .3, t, pan=pan)

    def ch(name, t, dur, v=.42, pan=-.2):
        x = chord(V[name], dur, v)
        place(mus, x, jit(t, 3), pan=pan); place(wet, x * .3, t, pan=pan)

    def bs(m, t, dur, v=1.0):
        place(mus, bass(m, dur, vel(v, .06)), jit(t, 3), pan=.05)

    def tune(phrase, t0, upto=99, v=.6, shift=0):
        for b, m, d in phrase:
            if b < upto:
                vb(m + shift, sw(t0, b), d * BEAT * .95, v * (1.1 if d >= 1.5 else 1), pan=.22)

    def fill(t, v=.5):                                         # two beats of snare and toms into t
        for i, b in enumerate((-2, -1.5, -1, -.5)):
            place(mus, snare(v + .1 * i), jit(sw(t, b + 4) - 4 * BEAT, 3), pan=-.1)
        place(mus, c10.tom(100, .6), jit(t - .5 * BEAT * (1 - SWING) * 2, 3), pan=.2)

    def hit(t, name='Fmaj7', v=.9):                            # a scene arrives: crash, kick, the band's chord
        place(mus, crash(.8 * v), t, pan=-.3); place(mus, kick(1.0 * v), t)
        ch(name, t, BEAT * 1.6, .55 * v); bs(ROOT[name], t, BEAT * .9)

    # ===== time-keeping: ride, hi-hat, a light kick, piano comping and walking bass =====
    def groove(t0, t1, drums=1.0, comp=1.0, walk=1.0):
        t = t0
        while t < t1 - 1e-6:
            bar_end = min(t1, t + BAR)
            if drums:
                for b, v in ((0, .8), (1, 1.0), (1.5, .55), (2, .8), (3, 1.0), (3.5, .55)):
                    tt = sw(t, b)
                    if tt < bar_end - .01:
                        place(mus, ride(vel(v * drums)), jit(tt), pan=.35)
                for b in (1, 3):
                    tt = t + b * BEAT
                    if tt < bar_end - .01:
                        place(mus, chick(vel(.7 * drums)), jit(tt), pan=-.3)
                for b in (0, 1, 2, 3):
                    tt = t + b * BEAT
                    if tt < bar_end - .01:
                        place(mus, kick(.18 * drums), jit(tt))
                if rng.random() < .35:                          # a ghosted snare comping on the "and" of 4
                    tt = sw(t, 3.5)
                    if tt < bar_end - .01:
                        place(mus, snare(.18 * drums), jit(tt), pan=-.1)
            if comp:                                            # Charleston: beat 1, the "and" of 2
                for b, d in ((0, 1.2), (1.5, .9)):
                    tt = sw(t, b)
                    if tt < bar_end - .05:
                        ch(chord_at(tt + .01), tt, BEAT * d, .3 * comp)
            if walk:
                for b in range(4):
                    tt = t + b * BEAT
                    if tt >= bar_end - .01:
                        break
                    name = chord_at(tt + .01)
                    nxt = chord_at(tt + BEAT + .01)
                    if b % 2 == 0 and name != chord_at(tt - .01):
                        m = ROOT[name]
                    elif nxt != name:                           # a half step into the next chord's root
                        m = ROOT[nxt] + (1 if rng.random() < .5 else -1)
                    else:
                        m = int(rng.choice(tones(name, 36, 51)))
                    bs(m, tt, BEAT * .9, .85 * walk)
            t += BAR

    # ===== bars 0-4: the problem =====
    groove(1.5 * BAR, 3 * BAR, drums=.5, comp=0, walk=.8)       # the bass walks in with the second line
    groove(3 * BAR, NAME - BEAT, drums=.65, comp=0, walk=0)
    for b in range(int((NAME - 3 * BAR) / BEAT)):               # under "And miss the one...": a pedal on C
        bs(36, 3 * BAR + b * BEAT, BEAT * .9, .9)
    for c in cues:
        t, k = c['t'], c['k']
        if t >= NAME:
            continue
        if k == 'pline':
            ch(chord_at(t + .01), t, BEAT * 3.5, .36)
            if c['i'] == 0:
                bs(ROOT['Dm7'], t, BEAT * 3.5, .7)
        elif k == 'win':
            name = chord_at(t + .01)
            vb(tones(name, 72, 90)[min(c['i'], 5)], t, BEAT * 1.2, .38)
        elif k == 'hop':
            vb([77, 79, 81, 84][c['i']], t, BEAT * .8, .45, pan=.3)
        elif k == 'alert':
            vb(73, t, BEAT * 2.5, .5, hard=True); vb(79, t, BEAT * 2.5, .45, hard=True)   # a b9 and the 7th over C: unsettled
            pn(37, t, BEAT * 2.5, .45)
    fill(NAME, .45)

    # ===== bar 4: the name; the band arrives and the hook is stated in full =====
    hit(NAME, 'Fmaj7', 1.0)
    groove(NAME, HIW, comp=1.0)
    tune(HOOK, NAME, v=.62)
    tune(ANSWER, NAME + 2 * BAR - 2 * BEAT, upto=4.5, v=.55)   # the answer's head, into how it works

    # ===== bars 6-8.5: how it works =====
    hit(HIW, 'Fmaj7', .75)
    groove(HIW, END - .01)
    for c in cues:
        if HIW <= c['t'] < PLAN['segs']['fl'][0]:
            if c['k'] == 'chip':
                ch(chord_at(c['t'] + .01), c['t'], BEAT * .8, .42)
            elif c['k'] == 'node':
                vb(tones(chord_at(c['t'] + .01), 79, 96)[c['i']], c['t'], BEAT * .9, .42)

    # ===== the features: a fill, then the hit, and the hook's head under each headline =====
    for i, t in enumerate(PLAN['changes']):
        fill(t, .42)
        hit(t, 'Fmaj7')
        if t < MORE:
            tune(HOOK if i % 2 == 0 else ANSWER, t, upto=4.5, v=.58)
    for c in cues:
        t, k = c['t'], c['k']
        if k == 'callout':
            vb(tones(chord_at(t + .01), 84, 96)[int(rng.integers(3))], t, BEAT * 1.2, .34, pan=.3)
        elif k == 'phone':                                      # a quick piano run up as the phone slides in
            for j, m in enumerate(tones(chord_at(t + .01), 72, 92)[:6]):
                pn(m, t + j * .055, .35, .3, pan=.2)
        elif k == 'cut':
            place(mus, c10.c9.BELL * .9, t, pan=.35)
        elif k == 'card':
            vb(tones(chord_at(t + .01), 76, 96)[c['i']], t, BEAT * 1.1, .42)

    # ===== the values: a band hit on each line =====
    vals = [c for c in cues if c['k'] == 'value']
    for c, name in zip(vals, ['Fmaj7', 'D7', 'Gm7', 'C7']):
        t = c['t']
        ch(name, t, BEAT * .7, .5); bs(ROOT[name], t, BEAT * .8, 1.0)
        place(mus, kick(.85), t); place(mus, snare(.42), t, pan=-.1)
        if c['i'] == 0:
            place(mus, crash(.65), t, pan=.3)
        vb(tones(name, 79, 92)[-1], t, BEAT * .9, .45)
    fill(END, .5)

    # ===== the end card: ii-V-I, the hook once more, the home chord rings to the end =====
    place(mus, crash(.7), END, pan=-.3); place(mus, kick(.85), END)
    ch('Gm7', END, BEAT * 1.9, .42); bs(43, END, BEAT * 1.9)
    ch('C7', END + 2 * BEAT, BEAT * 1.9, .4); bs(36, END + 2 * BEAT, BEAT * 1.9)
    fin = END + BAR
    tune(HOOK, fin - 2 * BEAT, v=.5)
    x = chord(V['Fmaj9'] + [72], LENGTH - fin, .42); place(mus, x, fin, pan=-.1); place(wet, x * .4, fin)
    bs(29, fin, 3.4, .9)
    place(mus, crash(.5), fin, pan=.3); place(mus, c10.c9.BELL * .6, fin, pan=.35)
    for b, v in ((0, .5), (1, .6), (2, .5), (3, .6)):           # the ride keeps a soft pulse under the typing
        for k in range(2):
            tt = fin + k * BAR + b * BEAT
            if tt < LENGTH - .8:
                place(mus, ride(vel(v * .5)), jit(tt), pan=.35)
    vb(84, LENGTH - 1.6, 1.4, .35); vb(88, LENGTH - 1.5, 1.3, .32)

    # a small room
    tt = np.arange(int(1.4 * SR)) / SR
    ir = rng.standard_normal((2, len(tt))) * np.exp(-tt / .32)
    ir = np.stack([filt(cc, 'low', 5000) for cc in ir])
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    for k in range(2):
        mus[k] += signal.fftconvolve(wet[k], ir[k])[: mus.shape[1]] * .32
    mus = mus[:, :N]
    t = np.arange(N) / SR
    mus *= np.clip((LENGTH - t) / 1.0, 0, 1) * np.clip(t / .01, 0, 1)
    mus = filt(mus, 'high', 35)
    mus = np.tanh(mus * 1.2) / np.tanh(1.2)
    return mus * (.89 / (np.max(np.abs(mus)) or 1))


if __name__ == '__main__':
    assert len(c10.PIANO) >= 29 and len(c10.BASS) >= 14 and c10.RIDE and len(VIBES.get('soft', {})) >= 10, \
        f'samples missing in {c10.SAMPLES}: run music/fetch_samples.sh'
    out = build()
    sf.write(sys.argv[1], out.T, SR, subtype='PCM_16')
    print('wrote', sys.argv[1], f'{LENGTH:.1f} s at {BPM} BPM:', len(PLAN['cues']), 'picture cues,',
          len(PLAN['changes']), 'scene changes, vibes', sorted(VIBES.get('soft', {})))
