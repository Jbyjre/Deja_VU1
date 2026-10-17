"""Builds a composition from its template: places the footage on the timeline from each
shot's recorded markers, inlines those markers for the animation, renders the sound
effects (a click on every filmed click, a keystroke on every key press and every typed
character, whooshes on the big transitions), then mixes them with the music.

Usage: python3 build/build.py main|vertical
"""
import json
import os
import random
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


# Version 6: one timeline for both cuts (both 120 s). SEG says when each feature starts and
# ends on screen; scene.js and music/compose6.py follow it (compose6.py repeats the few times
# the music needs: the groove at 6 s, the key change at 60 s, the values at 110 s, the end at 114 s).
SEG = {'fl': (6.0, 13.0), 'ov': (13.0, 19.5), 'ok': (19.5, 28.5), 'cv': (28.5, 35.0), 'sk': (35.0, 44.0),
       'tw': (44.0, 54.0), 'st': (54.0, 60.5), 'au': (60.5, 67.0), 'ca': (67.0, 73.0), 'fi': (73.0, 79.5),
       'co': (79.5, 85.5), 'ha': (85.5, 92.0), 'tl': (92.0, 98.0), 'ar': (98.0, 104.0), 'ga': (104.0, 110.0)}
PHONE_AT = 26.0                   # inside Confirm Print: the phone takes over
VALUES, END = 110.0, 114.0


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
def plan_main(S):
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    seg = lambda k, a=-.6, b=.1: (SEG[k][0] + a, SEG[k][1] + b)
    return [
        ('v-fl', 'fleet', 6.35 - m('fleet', 'tab'), 5.2, SEG['fl'][1] + .1),       # the tab click at 6.35
        ('v-ov', 'overview_jam', 14.5 - m('overview_jam', 'jam'), *seg('ov')),       # the jam at 14.5
        ('v-ok', 'confirm_ok', 19.5 - 1.15, SEG['ok'][0] - .6, SEG['ok'][1] + .1),  # opens on the open file
        ('v-ph', 'phone', 27.6 - c('phone', 2), PHONE_AT - .4, SEG['ok'][1] + .1),   # hold to cancel at 27.6
        ('v-cv', 'convert', 30.5 - m('convert', 'convert'), *seg('cv')),
        ('v-sk', 'skip_object', 35.4 - m('skip_object', 'tab'), *seg('sk')),
        ('v-tw', 'twin', 44.32 - m('twin', 'orbit'), *seg('tw')),                    # the 3D drag starts as it arrives
        ('v-st', 'studio', 54.4 - m('studio', 'tab'), *seg('st')),
        ('v-au', 'automations', 60.9 - m('automations', 'tab'), *seg('au')),
        ('v-ca', 'care', 67.4 - m('care', 'tab'), *seg('ca')),
        ('v-fi', 'filament', 73.5 - m('filament', 'on'), *seg('fi')),
        ('v-co', 'cost', 79.4, *seg('co')),
        ('v-ha', 'ha', 86.0 - m('ha', 'on'), *seg('ha')),
        ('v-ga', 'games', 104.4 - m('games', 'tab'), SEG['ga'][0] - .9, SEG['ga'][1] + .1),
    ]


plan_vertical = plan_main
MAIN_WHOOSH = [2.55, 5.4] + [SEG[k][0] for k in list(SEG)[1:]] + [VALUES, END]
VERT_WHOOSH = MAIN_WHOOSH
MAIN_TERM = VERT_TERM = (END + .75, [48, 11, 22])     # typing starts, characters per line (end card)
MAIN_LENGTH = VERT_LENGTH = 120.0
# taps drawn in the illustrations (no footage there): the AR placement tap
EXTRA_CLICKS = [SEG['ar'][0] + 3.2]

plans = {'main': (plan_main, MAIN_WHOOSH, MAIN_TERM, MAIN_LENGTH),
         'vertical': (plan_vertical, VERT_WHOOSH, VERT_TERM, VERT_LENGTH)}
plan_fn, whooshes, term, LENGTH = plans[FMT]
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
    marks[vid] = {'start': round(start, 3), 'marks': S[name]['marks'], 'clicks': S[name]['clicks']}
    for c in S[name]['clicks']:
        t = start + c
        if vfrom + .05 <= t <= vto - .05:
            cues.append({'t': round(t, 3), 'type': 'click', 'gain': 1.0, 'pan': .12})
    for k in S[name].get('keys', []):
        t = start + k
        if vfrom + .05 <= t <= vto - .05:
            cues.append({'t': round(t, 3), 'type': 'key', 'gain': 1.1, 'pan': -.05, 'pitch': 1.0})

# end-card typing: one keystroke per character, a little uneven like a real hand
random.seed(4)
t0, lines = term
typing = []
t = t0
for n in lines:
    per = []
    for i in range(n + 1):
        per.append(round(t, 3))
        cues.append({'t': round(t, 3), 'type': 'key', 'gain': .9 if i < n else 1.2, 'pan': random.uniform(-.2, .2),
                     'pitch': 1.6 if i == n else random.uniform(.9, 1.12)})   # the last one is Return
        t += random.uniform(.03, .045) if i < n - 1 else .11
    typing.append(per)
    t += .22

cues += [{'t': t, 'type': 'click', 'gain': 1.0, 'pan': -.1} for t in EXTRA_CLICKS]
cues += [{'t': t, 'type': 'whoosh', 'gain': .5, 'pan': -.2 + .4 * (i % 2)} for i, t in enumerate(whooshes)]

W, H = (1920, 1080) if FMT == 'main' else (1080, 1920)
tpl = open(os.path.join(HERE, 'scene.html')).read()
tpl = tpl.replace('/*LAYOUT_CSS*/', open(os.path.join(HERE, FMT + '.layout.css')).read()) \
         .replace('/*SCENE_JS*/', open(os.path.join(HERE, 'scene.js')).read()) \
         .replace('__FMT__', FMT).replace('__W__', str(W)).replace('__H__', str(H)).replace('__DUR__', f'{LENGTH:g}')
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks)).replace('/*TYPING*/[]/*END*/', json.dumps(typing)) \
          .replace('/*SEGS*/{}/*END*/', json.dumps({**{k: {'t0': a, 't1': b} for k, (a, b) in SEG.items()},
                                                     'values': VALUES, 'end': END, 'ok': {'t0': SEG['ok'][0], 't1': SEG['ok'][1], 'phone': PHONE_AT}}))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
audio = os.path.join(PROJ, 'assets', 'audio')
os.makedirs(audio, exist_ok=True)
music_wav = os.path.join(audio, f'music6_{FMT}.wav')
composer = os.path.join(ROOT, 'music', 'compose6.py')
if not os.path.exists(music_wav) or os.path.getmtime(music_wav) < os.path.getmtime(composer):
    subprocess.run(['python3', composer, music_wav, FMT], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
