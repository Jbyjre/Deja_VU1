"""Finishes a rendered cut: brings its soundtrack to -14 LUFS (the usual level for YouTube and
social), with a limiter at -2.5 dBFS so even after AAC encoding no peak goes over -1 dBFS, and puts it on the rendered picture
(the picture is copied, not re-encoded).

Usage: python3 build/finish.py main|vertical RENDER.mp4 OUT.mp4
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FMT, RENDER, OUT = sys.argv[1:4]
WAV = os.path.join(os.path.dirname(HERE), FMT, 'assets', 'audio', f'mix_{FMT}.wav')
TARGET = -14.0


def loudness(path, chain=''):
    af = (chain + ',' if chain else '') + 'ebur128=peak=true'
    log = subprocess.run(['ffmpeg', '-nostats', '-i', path, '-af', af, '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    summary = log[log.rindex('Summary'):]
    return float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1)), float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', summary).group(1))


gain = TARGET - loudness(WAV)[0]
for _ in range(3):                                  # the limiter takes a little off: nudge until it lands
    chain = f'volume={gain:.2f}dB,alimiter=limit=0.75:attack=2:release=80:level=false'
    i, peak = loudness(WAV, chain)
    if abs(i - TARGET) < .15:
        break
    gain += TARGET - i
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', RENDER, '-i', WAV, '-filter_complex', f'[1:a]{chain}[a]',
                '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-shortest', OUT], check=True)
i, peak = loudness(OUT)
print(f'{OUT}: {i:.1f} LUFS, true peak {peak:.1f} dBFS (gain {gain:+.1f} dB)')
