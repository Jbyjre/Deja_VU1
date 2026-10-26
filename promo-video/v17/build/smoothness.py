"""Measures how smooth a rendered film is, frame by frame (version 17).

Each frame is compared with the one before it (grey, scaled to 320 x 180): the mean change is
how much the picture moved. Smooth motion changes by similar amounts frame after frame, so this
reports the two things that read as a stutter:

- a jump: one frame that changes far more than the frames around it (a view swapped in one
  frame, an overlay that snaps on, a 3D object that flattens for a frame);
- a held frame: a frame with no change in the middle of motion.

Version 16 measured 6 jumps (the largest 67.1 at 24.55 s); version 17 is checked the same way.
A continuous move between scenes changes a lot on many frames in a row and is not counted.

Usage: python3 v17/build/smoothness.py FILM.mp4 [FILM2.mp4 ...]
Needs FFmpeg and numpy (media tools, not app dependencies).
"""
import subprocess
import sys

import numpy as np

W, H = 320, 180


def changes(path):
    """Mean change from each frame to the next, and the frame rate."""
    fps = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
                          '-of', 'csv=p=0', path], capture_output=True, text=True, check=True).stdout.strip()
    a, b = fps.split('/')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}:flags=area,format=gray',
                          '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
    return np.abs(np.diff(f, axis=0)).mean(axis=(1, 2)), int(a) / int(b)


def report(path):
    d, fps = changes(path)
    # what the neighbouring frames do (about a quarter of a second either side)
    med = np.array([np.median(d[max(0, i - 8):i + 9]) for i in range(len(d))])
    jumps = [i for i in range(len(d)) if d[i] > 2 and d[i] / (med[i] + .3) > 8]
    held = [i for i in range(1, len(d) - 1) if d[i] < .15 * min(d[i - 1], d[i + 1]) and min(d[i - 1], d[i + 1]) > .4]
    print(f'{path}: {len(d) + 1} frames at {fps:g} fps')
    print(f'  jumps (one frame changing over 8 times its neighbours): {len(jumps)}')
    for i in jumps:
        print(f'    {(i + 1) / fps:7.3f} s  change {d[i]:5.1f}, around it {med[i]:.2f}')
    print(f'  held frames in motion: {len(held)}')
    for i in held:
        print(f'    {(i + 1) / fps:7.3f} s  before {d[i - 1]:.2f}, this {d[i]:.2f}, after {d[i + 1]:.2f}')
    return len(jumps), len(held)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        report(p)
