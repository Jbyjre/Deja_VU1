"""Original music bed for the Deja Vu1 promo, synthesised from scratch.

No samples, loops or third-party audio: every sound below is generated from sine
waves and noise in this file, so the track has no outside licence to worry about.

96 BPM, one bar = 2.5 s, so scene cuts in the video land on bar lines.
Usage: python3 compose.py OUT.wav [main|vertical]
"""
import sys
import numpy as np
from scipy import signal

SR = 48000
BPM = 96
BEAT = 60 / BPM            # 0.625 s
BAR = 4 * BEAT             # 2.5 s
# Section map in bars: brand reveal, groove start, lift start, breakdown, end chord, total.
CUTS = {'main': dict(brand=3, groove=5, lift=18, brk=28, end=30, bars=33),
        'vertical': dict(brand=2, groove=4, lift=12, brk=18, end=20, bars=23)}[sys.argv[2] if len(sys.argv) > 2 else 'main']
BRAND, GROOVE, LIFT, BRK, END, BARS = (CUTS[k] for k in ('brand', 'groove', 'lift', 'brk', 'end', 'bars'))
LENGTH = BARS * BAR + 0.0
N = int(LENGTH * SR)
rng = np.random.default_rng(7)


def hz(note):
    """MIDI note number to frequency."""
    return 440.0 * 2 ** ((note - 69) / 12)


def place(buf, x, t, gain=1.0):
    i = int(round(t * SR))
    if i >= buf.shape[-1]:
        return
    x = x[..., : buf.shape[-1] - i]
    buf[..., i:i + x.shape[-1]] += gain * x


def env_adsr(n, a, d, s, r, hold):
    """Attack/decay/sustain/release envelope; hold = seconds before release starts."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t > hold
    e[rel] *= np.exp(-(t[rel] - hold) / max(r, 1e-4))
    return e


def lowpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'low')
    return signal.lfilter(b, a, x, axis=-1)


def highpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'high')
    return signal.lfilter(b, a, x, axis=-1)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return signal.lfilter(b, a, x, axis=-1)


# ---------------------------------------------------------------- instruments

def pluck(note, dur=1.2, bright=1.0, pan=0.0):
    """Soft mallet / felt-piano tone: a few harmonics, the upper ones dying faster."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(note)
    x = np.zeros(n)
    for k, (amp, tau) in enumerate([(1.0, .55), (.32 * bright, .22), (.12 * bright, .12), (.05 * bright, .07)], 1):
        x += amp * np.sin(2 * np.pi * f * k * t * (1 + .0007 * (k - 1))) * np.exp(-t / tau)
    x *= np.minimum(1, t / .004)
    x *= np.exp(-np.maximum(0, t - dur + .15) / .05)
    lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * lg, x * rg]) * .9


def pad(notes, dur, cutoff=1800, attack=.9, release=1.4):
    """Warm detuned pad: band-limited saw stacks, rolled off above the cutoff."""
    n = int((dur + release * 3) * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for note in notes:
        f0 = hz(note)
        for ch, det in ((0, -6), (1, 6), (0, 2), (1, -2)):
            f = f0 * 2 ** (det / 1200)
            ph = rng.uniform(0, 2 * np.pi)
            v = np.zeros(n)
            for k in range(1, int(5000 / f)):
                fk = f * k
                v += (1 / k) / (1 + (fk / cutoff) ** 2) * np.sin(2 * np.pi * fk * t + ph * k)
            out[ch] += v
    e = env_adsr(n, attack, 1.5, .8, release, dur)
    return out * e / (len(notes) * 2.2)


def bass(note, dur):
    n = int((dur + .1) * SR)
    t = np.arange(n) / SR
    f = hz(note)
    x = np.sin(2 * np.pi * f * t) + .22 * np.sin(4 * np.pi * f * t)
    x = np.tanh(1.6 * x) * env_adsr(n, .006, .18, .55, .06, dur)
    return np.stack([x, x]) * .5


def kick(gain=1.0):
    n = int(.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t / .035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t / .26)
    x += .25 * rng.standard_normal(n) * np.exp(-t / .002)
    x = np.tanh(1.4 * x)
    return np.stack([x, x]) * gain


def clap(gain=1.0):
    n = int(.4 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    e = np.zeros(n)
    for d in (0, .011, .022):
        e += np.where(t >= d, np.exp(-(t - d) / (.008 if d < .02 else .13)), 0)
    x = bandpass(noise * e, 900, 2600)
    return np.stack([x * .9, x]) * .55 * gain


def hat(gain=1.0, open_=False):
    n = int((.25 if open_ else .08) * SR)
    t = np.arange(n) / SR
    x = highpass(rng.standard_normal(n), 7500) * np.exp(-t / (.09 if open_ else .022))
    return np.stack([x * .8, x]) * .32 * gain


def swell(dur, gain=1.0):
    """Reverse-swell into a downbeat: noise rising in brightness and level."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    lo, hi = lowpass(x, 900), lowpass(x, 6000)
    k = (t / dur) ** 2
    y = ((1 - k) * lo + k * hi) * (t / dur) ** 2.5
    return np.stack([y, np.roll(y, 300)]) * .32 * gain


def boom(gain=1.0):
    n = int(3.5 * SR)
    t = np.arange(n) / SR
    f = 38 + 30 * np.exp(-t / .08)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.1)
    x += lowpass(rng.standard_normal(n), 400) * np.exp(-t / .25) * .5
    return np.stack([x, x]) * .9 * gain


def reverb(x, seconds=2.4, decay=.55, tone=5000):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, x.shape[1] + n - 1))
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t / decay)
        ir[: int(.012 * SR)] = 0            # a short pre-delay
        ir = lowpass(ir, tone)
        ir /= np.sqrt(np.sum(ir ** 2))
        out[ch] = signal.fftconvolve(x[ch], ir)
    return out[:, : x.shape[1]]


# ---------------------------------------------------------------- the score

# Chords as MIDI notes. Key of D major; the opening sits on B minor (the "silent" docks).
Bm9 = [47, 54, 57, 61, 62]          # B F# A C# D
Gmaj7 = [43, 50, 54, 59, 62]        # G D F# B D
D_Fs = [42, 50, 54, 57, 64]         # D/F#  (F# in the bass)
Em9 = [40, 47, 54, 55, 59]          # E B F# G B
A7sus = [45, 52, 55, 57, 62]        # A E G A D
Dadd9 = [38, 50, 54, 57, 64, 66]    # D A F# A E F#
PROG = [Gmaj7, D_Fs, Em9, A7sus]
ROOT = {id(Gmaj7): 31, id(D_Fs): 30, id(Em9): 28, id(A7sus): 33, id(Bm9): 35, id(Dadd9): 26}

mix_dry = np.zeros((2, N))
mix_wet = np.zeros((2, N))       # sent to the reverb
drums = np.zeros((2, N))
side = np.ones(N)                # kick-driven duck for pad and bass
pads = np.zeros((2, N))
bassline = np.zeros((2, N))


def chord_at(bar):
    if bar < BRAND:
        return Bm9
    if bar >= END:
        return Dadd9
    return PROG[(bar - BRAND) % 4]


def duck(t, depth=.45):
    i = int(t * SR)
    n = min(int(.32 * SR), N - i)
    if n > 0:
        side[i:i + n] *= 1 - depth * np.exp(-np.arange(n) / SR / .09)


for bar in range(BARS):
    t0 = bar * BAR
    ch = chord_at(bar)

    # pads: one chord per bar (the end chord holds)
    if bar < END:
        cutoff = 900 if bar < BRAND else (1500 if bar < GROOVE else (2300 if LIFT <= bar < BRK else 1900))
        place(pads, pad(ch[1:], BAR, cutoff=cutoff, attack=.6 if bar else 1.6), t0, .85 if bar >= BRAND else .7)
    elif bar == END:
        place(pads, pad(Dadd9[1:], BAR * 2.2, cutoff=2400, attack=.05, release=2.2), t0, 1.0)

    # bass
    root = ROOT[id(ch)]
    if bar < BRAND:
        place(bassline, bass(root, BAR * .95), t0, .55)
    elif GROOVE <= bar < BRK:
        for e in range(8):
            if e in (0, 3, 4, 6) or (bar % 4 == 3 and e == 7):
                place(bassline, bass(root + (12 if e == 7 else 0), BEAT * .45), t0 + e * BEAT / 2, .8)
    elif bar == END:
        place(bassline, bass(26, BAR * 2), t0, .9)

    # plucks
    if bar < BRAND:   # a single patient pulse, like a clock in a quiet room
        for b in range(4):
            place(mix_wet, pluck(ch[3] + 12, .9, .6), t0 + b * BEAT, .22 if b else .3)
    elif bar < END:
        top = sorted(ch[1:])
        arp = [top[0] + 12, top[2] + 12, top[1] + 12, top[3] + 12, top[2] + 12, top[3] + 12, top[1] + 24, top[3] + 12]
        steps = 8 if bar < GROOVE or bar >= BRK else 16
        for s in range(steps):
            note = arp[s % 8] if steps == 8 else arp[(s // 2) % 8] + (12 if s % 4 == 3 else 0)
            pan = [-.35, .35][s % 2]
            g = .32 if s % (steps // 4) == 0 else .2
            place(mix_wet, pluck(note, .7, .9 if bar >= LIFT else .75, pan), t0 + s * BAR / steps, g)
    # a bell counter-melody in the lift
    if LIFT <= bar < BRK and (bar - LIFT) % 2 == 0:
        mel = {0: [74, 73, 71], 1: [69, 71, 73]}[((bar - LIFT) // 2) % 2]
        for i, note in enumerate(mel):
            place(mix_wet, pluck(note + 12, 1.6, 1.2, .1), t0 + i * BEAT * (1.5 if i < 2 else 1), .16)

    # drums
    if GROOVE <= bar < BRK:
        for b in range(4):
            tb = t0 + b * BEAT
            if b in (0, 2) or (b == 3 and bar % 4 == 3):
                place(drums, kick(), tb, .95)
                duck(tb)
            if b in (1, 3):
                place(drums, clap(), tb, .5 if bar < LIFT else .62)
            for h in range(2):
                place(drums, hat(open_=(h == 1 and b == 3)), tb + h * BEAT / 2, .9 if h else .6)
    elif bar == GROOVE - 1:          # the brand bar: just a heartbeat kick
        for b in (0, 2):
            place(drums, kick(.8), t0 + b * BEAT, .8)
            duck(t0 + b * BEAT)

# transitions
place(mix_dry, swell(1.2), BRAND * BAR - 1.2, 1.0)         # into the brand reveal
place(mix_dry, boom(.7), BRAND * BAR)
place(mix_dry, swell(2.0, 1.1), GROOVE * BAR - 2.0)        # into the product
place(mix_dry, swell(4.5, 1.3), END * BAR - 4.5)           # out of the breakdown into the end card
place(mix_dry, boom(.9), END * BAR)
place(drums, kick(1.0), END * BAR, .9)

pads *= side
for name, bus in (('dry', mix_dry), ('plucks', mix_wet), ('pads', pads), ('bass', bassline), ('drums', drums)):
    print(f'{name:7s} rms {20*np.log10(np.sqrt(np.mean(bus**2))+1e-9):6.1f} dB  peak {20*np.log10(np.max(np.abs(bus))+1e-9):6.1f} dB')
bassline *= side
pads *= .25
drums *= .4
bassline *= .6
mix_dry *= .45
wet = mix_wet + pads * .6 + drums * .08
mix = mix_dry + mix_wet * .85 + pads + bassline + drums + reverb(wet) * .5

# master: gentle low cut, soft clip, fade in/out
mix = highpass(mix, 28)
mix /= np.max(np.abs(mix)) / .9
mix = np.tanh(mix * 1.05) / 1.05
fade_in = np.minimum(1, np.arange(N) / (.4 * SR))
tail = int(3.2 * SR)
fade_out = np.ones(N)
fade_out[-tail:] = np.linspace(1, 0, tail) ** 1.6
mix *= fade_in * fade_out
mix /= np.max(np.abs(mix)) * 1.12

from scipy.io import wavfile
wavfile.write(sys.argv[1], SR, (mix.T * 32767).astype(np.int16))
print('wrote', sys.argv[1], f'{LENGTH:.1f} s')
