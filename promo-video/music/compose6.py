"""Version 6 music: elevator music. A soft bossa-nova lounge piece, the kind played in hotel
lobbies and lifts: nylon-string guitar, upright bass, brushes, vibraphone and flute, light
strings, and the classic lift-music key change up a tone half way through.

The owner found version 5 still too electronic, so every instrument here imitates an acoustic
one instead of a synthesiser:
- guitar and upright bass are plucked strings (Karplus-Strong: a short noise burst ringing
  in a delay line tuned to the note, the way a string rings);
- the vibraphone is a struck bar (its three tuned partials, each fading at its own rate)
  with the slow tremolo of its motor;
- the flute is a breathy sine with a little noise and a late vibrato;
- the drums are brushes: a swish, a rim click and a soft felt kick, played quietly.
Everything is synthesised here with numpy and SciPy: no samples, no loops, no third-party
audio, so there is nothing to license.

120 BPM (one beat 0.5 s, one bar 2 s, so the edit can cut on bar lines), the progression
I-vi-ii-V with jazz extensions: Cmaj9 | Am9 | Dm9 | G13, then a tone higher (D) from 60 s.
The 2-6 kHz band stays light so the mouse clicks and keystrokes cut through.

Usage: python3 compose6.py OUT.wav main|vertical   (both cuts are the same length)
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
LENGTH = 120.0
N = int(LENGTH * SR)
rng = np.random.default_rng(6)

# Arrangement, in seconds (matches both videos, see build/scene.js):
ICONS = [0.1 + i * 0.125 for i in range(15)]   # the opening icon run: one vibraphone note per icon
GROOVE = 6.0                    # the laptop arrives: guitar, bass and brushes start
MELODY_IN = 14.0                # the vibraphone melody
B_SECTION = 38.0                # strings and flute join
KEY_UP = 60.0                   # up a whole tone, the lift-music key change
THIN = 104.0                    # guitar and bass only, before the values
HITS = [110.0, 110.5, 111.0, 111.5, 112.0]     # the values lines
FINAL = 114.0                   # the end card
LAST_CHORD = 117.0


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def jit(t, ms=6):
    return t + rng.uniform(-ms, ms) / 1000


def vel(g, spread=.1):
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


def ks(m, dur, decay, bright):
    """A plucked string (Karplus-Strong): noise, low-passed by how soft the pluck is, ringing
    in a delay line one period long with a gentle averaging loss."""
    n = int(dur * SR)
    d = max(2, int(round(SR / hz(m))))
    exc = np.zeros(n)
    burst = filt(rng.standard_normal(d), 'low', bright)
    exc[:d] = burst * np.hanning(d) ** .5
    a = np.zeros(d + 2); a[0] = 1; a[d] = -decay / 2; a[d + 1] = -decay / 2
    return signal.lfilter([1], a, exc)


# ---------- the band ----------
def guitar_note(m, dur, g=1.0):
    x = ks(m, dur + .25, .9965, 4200)
    t = np.arange(len(x)) / SR
    x *= np.clip((dur + .25 - t) / .25, 0, 1)                 # the hand mutes it
    x = filt(x, 'low', 4800) + .25 * filt(x, 'band', [90, 260])   # a wooden body
    return x * .16 * g


def guitar(notes, dur, g=1.0, down=True):
    """A soft fingered chord: the notes rolled a few milliseconds apart."""
    order = notes if down else notes[::-1]
    n = int((dur + .3) * SR)
    out = np.zeros(n)
    for i, m in enumerate(order):
        x = guitar_note(m, dur - i * .009, vel(g, .15))
        o = int(i * .009 * SR)
        out[o:o + len(x)] += x[: n - o]
    return out


def upright(m, dur, g=1.0):
    x = ks(m, dur + .12, .9975, 700)
    t = np.arange(len(x)) / SR
    x = filt(x, 'low', 900) * 1.3
    x += np.sin(2 * np.pi * hz(m) * t) * np.exp(-t / .09) * .35   # the finger's thump
    x *= np.clip((dur + .12 - t) / .12, 0, 1)
    return np.tanh(x * 1.2) * .5 * g


def vibes(m, dur, g=1.0):
    """A vibraphone bar: partials at 1, 4 and 10 times the note, the upper ones dying first,
    a soft mallet, and the motor's slow tremolo."""
    n = int((dur + .6) * SR); t = np.arange(n) / SR
    f = hz(m)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 1.6)
         + .22 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / .35)
         + .05 * np.sin(2 * np.pi * 10 * f * t) * np.exp(-t / .08))
    x += filt(rng.standard_normal(n), 'band', [300, 1400]) * np.exp(-t / .004) * .15
    x *= 1 - .22 * (1 - np.cos(2 * np.pi * 4.6 * t)) / 2
    x *= np.minimum(1, t / .002) * np.clip((dur + .6 - t) / .6, 0, 1)
    return x * .1 * g


def flute(m, dur, g=1.0):
    n = int((dur + .12) * SR); t = np.arange(n) / SR
    vib = 1 + .005 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - .25) / .3, 0, 1)
    ph = np.cumsum(hz(m) * vib) / SR
    x = np.sin(2 * np.pi * ph) + .18 * np.sin(4 * np.pi * ph) + .06 * np.sin(6 * np.pi * ph)
    breath = filt(rng.standard_normal(n), 'band', [hz(m) * .8, min(hz(m) * 3, 9000)]) * .06
    env = np.minimum(1, t / .07) * np.clip((dur + .12 - t) / .12, 0, 1)
    return (x + breath) * env * .07 * g


def strings(notes, dur, g=1.0):
    """A soft section: many slightly detuned voices, mellow, slow to swell."""
    n = int((dur + .8) * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for m in notes:
        for d in (-.004, -.0015, .0015, .004):
            ph = hz(m) * (1 + d) * t + rng.uniform()
            x += 2 * (ph % 1) - 1
    env = np.minimum(1, t / .9) * np.clip((dur + .8 - t) / .8, 0, 1)
    x *= 1 + .03 * np.sin(2 * np.pi * 5 * t)
    return filt(filt(x, 'low', 1300), 'high', 180) * env * .006 * g


def rhodes(notes, dur, g=1.0):
    n = int((dur + .5) * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f = hz(m) * (1 + rng.uniform(-.001, .001))
        idx = .2 + .9 * np.exp(-t / .2)
        out += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    env = np.minimum(1, t / .005) * np.exp(-t / 1.4) * np.clip((dur + .5 - t) / .5, 0, 1)
    return filt(out * env * (1 + .08 * np.sin(2 * np.pi * 4 * t)), 'low', 2200) * .045 * g


def swish(dur=.22, g=1.0):
    """A brush drawn across the snare."""
    n = int(dur * SR); t = np.arange(n) / SR
    env = np.minimum(1, t / (dur * .35)) * np.exp(-t / (dur * .45))
    return filt(rng.standard_normal(n), 'band', [700, 5500]) * env * .05 * g


def tap(g=1.0):
    n = int(.08 * SR); t = np.arange(n) / SR
    return filt(rng.standard_normal(n), 'band', [900, 5000]) * np.exp(-t / .012) * .07 * g


def rim(g=1.0):
    """A cross-stick: a woody tock, kept below the band the mouse clicks use."""
    n = int(.09 * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), 'band', [600, 1700]) * np.exp(-t / .006) * .5
    x += np.sin(2 * np.pi * 540 * t) * np.exp(-t / .018) * .5
    return x * .12 * g


def felt_kick(g=1.0):
    n = int(.25 * SR); t = np.arange(n) / SR
    f = 52 + 30 * np.exp(-t / .03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .14) * np.minimum(1, t / .004) * .3 * g


# ---------- the song ----------
CHORDS = [[59, 62, 64, 67], [55, 60, 64, 67], [57, 60, 64, 65], [53, 57, 59, 64]]   # Cmaj9, Am9, Dm9, G13 voicings
ROOTS = [36, 33, 38, 31]                                                            # C2, A1, D2, G1
FIFTHS = [43, 40, 45, 38]
# bossa guitar rhythm over two bars, in eighth notes, and whether the strum is a down stroke
COMP = [(0, True), (3, False), (6, True), (10, False), (13, True)]
# the melody, four bars, in beats: (beat, note, length in beats); two phrases that answer
PHRASE_A = [(0, 76, 1.5), (1.5, 79, .5), (2, 76, 1), (3, 74, 1), (4, 72, 1.5), (5.5, 71, .5), (6, 72, 1), (7, 76, 1),
            (8, 77, 1.5), (9.5, 76, .5), (10, 74, 1), (11, 72, 1), (12, 71, 1), (13, 74, 1), (14, 79, 2)]
PHRASE_B = [(0, 79, 1.5), (1.5, 81, .5), (2, 79, 1), (3, 76, 1), (4, 74, 1.5), (5.5, 72, .5), (6, 74, 1), (7, 76, 1),
            (8, 77, 1), (9, 76, 1), (10, 74, 1), (11, 71, 1), (12, 72, 3)]
ICON_NOTES = [60, 64, 67, 71, 74, 72, 76, 79, 83, 86, 84, 88, 91, 95, 98]           # a rising Cmaj9 sparkle


def key(t):
    return 2 if t >= KEY_UP - .01 else 0


def build():
    mus = np.zeros((2, N + 2 * SR))
    hall = np.zeros_like(mus)                      # long reverb send (vibes, flute, strings)
    room = np.zeros_like(mus)                      # short room (guitar, brushes)

    # --- the opening icon run: one vibraphone note per icon, over a soft swell ---
    for t, m in zip(ICONS, ICON_NOTES):
        x = vibes(m, .5, vel(.75))
        place(mus, x, t, pan=-.5 + (m - 60) / 40); place(hall, x * .8, t)
    place(mus, strings([48, 55, 59, 64], 2.6, 1.2), 0.0); place(hall, strings([48, 55, 59, 64], 2.6), 0.0)
    for i in range(6):                              # a brush roll into the brand
        place(mus, swish(.16, .4 + .12 * i), 2.25 + i * S16, pan=.2)
    # --- the brand (3-6): a held chord, the bass walking in ---
    place(mus, rhodes([48, 55, 59, 62, 64], 2.8, 1.3), 3.0, pan=-.15); place(hall, rhodes([55, 59, 64], 2.8) * .6, 3.0)
    place(mus, vibes(79, 1.5, .8), 3.0, pan=.2); place(hall, vibes(79, 1.5, .6), 3.0)
    place(mus, upright(36, 1.4), 3.0)
    for i, (m, t) in enumerate([(40, 4.5), (41, 5.0), (43, 5.5)]):   # E, F, G up to the groove
        place(mus, upright(m, .45, .9), t)
    for i in range(4):
        place(mus, tap(.5 + .15 * i), 5.5 + i * S16 * 2, pan=.2)

    # --- the groove ---
    nbars = int(np.ceil(LENGTH / BAR))
    for b in range(nbars):
        t0 = b * BAR
        if t0 < GROOVE:
            continue
        k = key(t0)
        ci = b % 4
        chord = [m + k for m in CHORDS[ci]]
        stop = HITS[0] - .01 <= t0 < FINAL
        if stop:
            continue
        end = t0 >= FINAL
        # guitar: the bossa rhythm across two bars
        for e, down in COMP:
            if (e < 8) == (b % 2 == 0):
                tt = t0 + (e % 8) * BEAT / 2
                x = guitar(chord, BEAT * .9, vel(.95 if down else .75), down)
                place(mus, x, jit(tt, 5), pan=.35); place(room, x * .5, tt, pan=.35)
        # upright bass: root for a dotted quarter, the fifth for an eighth, twice a bar
        for half in (0, 1):
            tt = t0 + half * 2 * BEAT
            r = ROOTS[ci] + k
            f = FIFTHS[ci] + k if half == 0 else ROOTS[ci] + k + 12
            place(mus, upright(r, BEAT * 1.4, vel(1, .06)), jit(tt, 4))
            place(mus, upright(f, BEAT * .45, vel(.75, .08)), jit(tt + 1.5 * BEAT, 4))
        # brushes: a swish on 2 and 4, soft taps, the rim on the bossa clave, a felt kick
        if t0 < THIN or end:
            for q in (1, 3):
                x = swish(.24, vel(1))
                place(mus, x, jit(t0 + q * BEAT - .06, 4), pan=-.2); place(room, x * .6, t0 + q * BEAT)
            for s in range(16):
                if s % 4:
                    place(mus, tap(vel(.55 if s % 2 else .75, .25)), jit(t0 + s * S16, 4), pan=-.25)
            for e in ((0, 3, 6) if b % 2 == 0 else (2, 4)):
                place(mus, rim(vel(1)), jit(t0 + e * BEAT / 2, 3), pan=.1)
            for q in (0, 2):
                place(mus, felt_kick(vel(1, .05)), jit(t0 + q * BEAT, 2))
        # strings in the B section and after the key change
        if B_SECTION <= t0 < THIN and b % 2 == 0:
            s2 = [m - 12 for m in chord] + [chord[-1]]
            place(mus, strings(s2, BAR * 2), t0, pan=-.1); place(hall, strings(s2, BAR * 2), t0, pan=-.1)
        # melody: vibraphone, then flute from the B section, both after the key change
        if MELODY_IN <= t0 < THIN and ci == 0:
            phrase = PHRASE_A if (b // 4) % 2 == 0 else PHRASE_B
            for beat, m, ln in phrase:
                tt = jit(t0 + beat * BEAT, 8)
                if t0 < B_SECTION or t0 >= KEY_UP:     # vibes; an octave up and softer once the flute leads
                    up = 12 if t0 >= KEY_UP else 0
                    x = vibes(m + k + up, ln * BEAT, vel(.6 if up else 1, .08))
                    place(mus, x, tt, pan=.15); place(hall, x * .7, tt, pan=.15)
                if t0 >= B_SECTION:
                    x = flute(m + k, ln * BEAT * .95, vel(1, .05))
                    place(mus, x, tt + .01, pan=-.1); place(hall, x * .8, tt, pan=-.1)
        # vibraphone answers in the B section's gaps
        if B_SECTION <= t0 < KEY_UP and ci == 3:
            for j, m in enumerate([chord[3] + 12, chord[2] + 12, chord[1] + 12]):
                x = vibes(m, BEAT * .6, .6)
                place(mus, x, t0 + 3 * BEAT + j * BEAT / 3, pan=.4); place(hall, x * .8, t0 + 3 * BEAT + j * BEAT / 3)
        # the key change: a brush fill and a vibes glide up into the new key
        if abs(t0 - (KEY_UP - BAR)) < .01:
            for i in range(8):
                place(mus, tap(.5 + .08 * i), t0 + 3 * BEAT + i * S16 / 2 * 2, pan=.2)
            for i, m in enumerate([67, 71, 74, 78, 81]):
                place(mus, vibes(m, .4, .7), t0 + 3 * BEAT + i * .1, pan=.3)

    # --- the values: stop-time hits, everyone together, silence between ---
    hit_chords = [[62, 66, 69, 73], [59, 64, 66, 69], [64, 67, 71, 74], [62, 66, 69, 73], [64, 69, 71, 78]]
    hit_roots = [38, 35, 40, 38, 33]
    for t, ch, r in zip(HITS, hit_chords, hit_roots):
        place(mus, guitar(ch, BEAT * .55, 1.1), t, pan=.35)
        place(mus, upright(r, BEAT * .5, 1.1), t)
        place(mus, vibes(ch[-1] + 12, BEAT * .6, .9), t, pan=.2); place(hall, vibes(ch[-1] + 12, BEAT * .6, .7), t)
        place(mus, rim(1.1), t, pan=.1); place(mus, felt_kick(1.1), t)
    for i in range(4):                              # a brush pickup into the end card
        place(mus, tap(.45 + .15 * i), FINAL - .5 + i * S16, pan=.2)

    # --- the end: the last chord rings, a vibes glissando settles on it ---
    last = [62, 66, 69, 73, 76]                      # Dmaj9
    place(mus, guitar(last, 3.0, 1.0), LAST_CHORD + 1.0, pan=.35)
    place(mus, upright(38, 2.5), LAST_CHORD + 1.0)
    place(mus, strings([50, 57, 61, 64, 66], 2.6, 1.1), LAST_CHORD); place(hall, strings([57, 61, 66], 2.6), LAST_CHORD)
    for i, m in enumerate([74, 78, 81, 85, 88, 90]):
        place(mus, vibes(m, 1.6, .65), LAST_CHORD + 1.0 + i * .09, pan=-.3 + .12 * i)
        place(hall, vibes(m, 1.6, .5), LAST_CHORD + 1.0 + i * .09)

    # reverbs: decaying filtered noise, a long hall and a short room, on the sends only
    def ir(dur, tau, lp):
        tt = np.arange(int(dur * SR)) / SR
        x = rng.standard_normal((2, len(tt))) * np.exp(-tt / tau)
        x = np.stack([filt(c, 'low', lp) for c in x])
        return x / np.sqrt((x ** 2).sum(axis=1, keepdims=True))
    h, r = ir(3.0, .7, 4500), ir(1.0, .18, 5000)
    for ch in range(2):
        mus[ch] += signal.fftconvolve(hall[ch], h[ch])[: mus.shape[1]] * .45
        mus[ch] += signal.fftconvolve(room[ch], r[ch])[: mus.shape[1]] * .3
    t = np.arange(mus.shape[1]) / SR
    mus = mus[:, :N]
    t = t[:N]
    mus *= np.clip((LENGTH - t) / 1.5, 0, 1) * np.clip(t / .03, 0, 1)
    # keep the 2-6 kHz band soft (the clicks live there), and a touch of warmth
    mid = signal.filtfilt(*signal.butter(2, [2000 / (SR / 2), 6000 / (SR / 2)], 'band'), mus, axis=1)
    mus = mus - .2 * mid
    mus = np.tanh(mus * 1.4) / np.tanh(1.4)
    mus *= .89 / (np.max(np.abs(mus)) or 1)
    return mus


if __name__ == '__main__':
    mix = build()
    wavfile.write(sys.argv[1], SR, (mix.T * 32767).astype(np.int16))
    print('wrote', sys.argv[1], f'{LENGTH:.1f} s at {BPM} BPM')
