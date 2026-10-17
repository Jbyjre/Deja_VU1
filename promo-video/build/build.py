"""Builds a composition from its template: places the footage on the timeline from each
shot's recorded markers, inlines those markers for the animation, and renders the
sound-effects track (clicks exactly on the filmed clicks, whooshes on the cuts).

Usage: python3 build/build.py main|vertical
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FMT = sys.argv[1]
PROJ = os.path.join(ROOT, FMT)
PAD_START, PAD_END = 4.0, 4.0     # seconds of held first / last frame added to every clip

SHARED_CSS = open(os.path.join(HERE, 'shared.css')).read()


def shot(name):
    return json.load(open(os.path.join(ROOT, 'footage', name + '.json')))


# (video id, shot, composition time of the shot's t=0 as a function of its data, visible from, visible to)
def plan_main(S):
    return [
        ('v-ov', 'overview_jam', 10.0 - S['overview_jam']['marks']['jam'], 5.4, 14.05),
        ('v-cf', 'confirm_refuse', 17.0 - S['confirm_refuse']['marks']['dialog'], 13.7, 20.1),
        ('v-fl', 'fleet', 23.5 - S['fleet']['marks']['pause'], 19.6, 26.1),
        ('v-3d', 'coaster_3d', 25.9, 25.6, 30.05),
        ('v-twin', 'twin', 26.0, 26.0, 30.05),
        ('v-ph', 'phone', 29.4, 30.0, 36.05),
        ('v-q1', 'studio', 35.7, 35.7, 37.9),
        ('v-q2', 'convert', 38.0 - S['convert']['clicks'][1], 37.3, 39.5),
        ('v-q3', 'automations', 39.4 - S['automations']['clicks'][0], 38.9, 41.1),
        ('v-q4', 'care', 40.3, 40.5, 42.7),
        ('v-q5', 'games', 42.5 - S['games']['clicks'][0], 42.1, 44.1),
    ]


MAIN_WHOOSH = [7.6, 14.0, 19.75, 25.75, 29.85, 36.0, 37.6, 39.2, 40.8, 42.4, 43.95, 51.85]
MAIN_TICK = [2.0, 2.25, 2.5, 2.75, 47.0, 47.5, 48.0, 48.5, 49.0]


def plan_vertical(S):
    return [
        ('v-ov', 'overview_jam', 8.6 - S['overview_jam']['marks']['jam'], 5.6, 12.05),
        ('v-cf', 'confirm_refuse', 14.6 - S['confirm_refuse']['marks']['dialog'], 11.7, 17.1),
        ('v-ph', 'phone', 16.5, 17.0, 23.05),
        ('v-fl', 'fleet', 26.0 - S['fleet']['marks']['pause'], 22.7, 29.1),
        ('v-q1', 'studio', 28.7, 28.7, 30.9),
        ('v-q2', 'convert', 31.0 - S['convert']['clicks'][1], 30.3, 32.5),
        ('v-q5', 'games', 32.5 - S['games']['clicks'][0], 31.9, 34.1),
    ]


VERT_WHOOSH = [5.6, 11.75, 16.85, 22.75, 28.75, 30.35, 31.95, 33.9, 35.85]
VERT_TICK = [2.0, 2.25, 2.5, 2.75, 34.0, 34.4, 34.8, 35.2]

plans = {'main': (plan_main, MAIN_WHOOSH, MAIN_TICK, 60.0), 'vertical': (plan_vertical, VERT_WHOOSH, VERT_TICK, 40.0)}
plan_fn, whooshes, ticks, LENGTH = plans[FMT]
S = {f[:-5]: shot(f[:-5]) for f in os.listdir(os.path.join(ROOT, 'footage')) if f.endswith('.json')}
plan = plan_fn(S)

os.makedirs(os.path.join(PROJ, 'assets', 'footage'), exist_ok=True)
videos, marks, cues = [], {}, []
for vid, name, start, vfrom, vto in plan:
    src = os.path.join(ROOT, 'footage', name + '.mp4')
    dst = os.path.join(PROJ, 'assets', 'footage', name + '.mp4')
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf',
                        f'tpad=start_mode=clone:start_duration={PAD_START}:stop_mode=clone:stop_duration={PAD_END}',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst], check=True)
    media = vfrom - start + PAD_START
    assert media >= 0, (vid, media)
    assert vto - start <= S[name]['seconds'] + PAD_END, (vid, 'runs past the held end')
    videos.append(f'      <video id="{vid}" src="assets/footage/{name}.mp4" muted playsinline data-start="{vfrom:.3f}" '
                  f'data-media-start="{media:.3f}" data-duration="{vto - vfrom:.3f}" data-track-index="2"></video>')
    marks[name] = {'start': round(start, 3), 'marks': S[name]['marks'], 'clicks': S[name]['clicks']}
    for c in S[name]['clicks']:
        t = start + c
        if vfrom + .05 <= t <= vto - .05:
            cues.append({'t': round(t, 3), 'type': 'click', 'gain': 1.0, 'pan': .15})

cues += [{'t': t, 'type': 'whoosh', 'gain': .75, 'pan': -.2 + .4 * (i % 2)} for i, t in enumerate(whooshes)]
cues += [{'t': t, 'type': 'tick', 'gain': .7} for t in ticks]

tpl = open(os.path.join(HERE, FMT + '.tpl.html')).read()
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
os.makedirs(os.path.join(PROJ, 'assets', 'audio'), exist_ok=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH),
                os.path.join(PROJ, 'assets', 'audio', f'sfx_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
