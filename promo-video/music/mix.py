"""Mixes the music and the sound effects into the one audio track the video plays.

The music dips briefly under every click (about 9 dB) and keystroke (about 6 dB) for a tenth of a
second, and in the same moments loses most of its 2-6 kHz band (a dynamic EQ: the clap and
the clicks share that band), so each one cuts through clearly while the bass keeps going.
Usage: python3 mix.py music.wav sfx.wav cues.json OUT.wav [STEM_PREFIX]
"""
import json
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR, mus = wavfile.read(sys.argv[1])
_, fx = wavfile.read(sys.argv[2])
cues = json.load(open(sys.argv[3]))
mus = mus.astype(float) / 32767
fx = fx.astype(float) / 32767
n = max(len(mus), len(fx))
mus = np.pad(mus, ((0, n - len(mus)), (0, 0)))
fx = np.pad(fx, ((0, n - len(fx)), (0, 0)))
t = np.arange(n) / SR
dip = np.zeros(n)
for c in cues:
    if c['type'] in ('click', 'key'):
        k = np.exp(-((t - c['t'] - .03) / .07) ** 2)          # starts just before, gone 0.15 s later
        dip = np.maximum(dip, k * (.65 if c['type'] == 'click' else .5))
gain = 1 - dip                                              # 0.35 = about -9 dB at the deepest
band = np.zeros(n)
for c in cues:
    if c['type'] in ('click', 'key'):
        band = np.maximum(band, np.exp(-((t - c['t'] - .035) / .08) ** 2) * .85)
b, a = signal.butter(2, [2000 / (SR / 2), 6000 / (SR / 2)], 'band')
mid = signal.filtfilt(b, a, mus, axis=0)                    # zero-phase, so subtracting it is clean
mus = mus - mid * band[:, None]
# Version 6: the music sits lower (it is background music; the owner could not hear the
# clicks over version 5's mix) and the clicks and keystrokes higher.
MUSIC, FX = .5, 1.7
m_part, f_part = mus * MUSIC * gain[:, None], fx * FX
out = m_part + f_part
norm = .9 / (np.max(np.abs(np.tanh(out * 1.05) / np.tanh(1.05))) or 1)
out = np.tanh(out * 1.05) / np.tanh(1.05) * norm
wavfile.write(sys.argv[4], SR, (out * 32767).astype(np.int16))
if len(sys.argv) > 5:          # stems, for measuring: the music and the effects as they sit in the mix
    for name, part in (('music', m_part), ('fx', f_part)):
        wavfile.write(sys.argv[5] + f'_{name}.wav', SR, (np.clip(part * norm, -1, 1) * 32767).astype(np.int16))
print('mixed', sys.argv[4], f'{n / SR:.2f} s')
