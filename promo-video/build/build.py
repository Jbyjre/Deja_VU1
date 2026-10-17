"""Builds a composition from its template: places the footage on the timeline from each
shot's recorded markers, inlines those markers for the animation, renders the sound
effects (a click on every filmed click, a keystroke on every key press and every typed
character), then mixes them with the music.

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


# Version 7: one timeline for both cuts, 90 s (the owner's limit). SEG says when each feature
# starts and ends on screen; scene.js follows it, and music/compose7.py is laid out to it
# (two bars of intro, the band coming in at 5 s as the laptop lands). Time-lapse and AR
# preview (drawings in version 6) are left out so the filmed features can move faster.
SEG = {'fl': (5.0, 11.0), 'ov': (11.0, 16.5), 'ok': (16.5, 25.0), 'cv': (25.0, 30.5), 'sk': (30.5, 37.0),
       'tw': (37.0, 44.0), 'st': (44.0, 49.0), 'au': (49.0, 54.0), 'ca': (54.0, 59.0), 'fi': (59.0, 64.5),
       'co': (64.5, 69.5), 'ha': (69.5, 75.0), 'ga': (75.0, 80.5)}
PHONE_AT = 22.4                   # inside Confirm Print: the phone takes over
TWIN_CUT = 40.6                   # the twin: 3D (turned by hand) until here, then front and top
VALUES, END = 80.5, 83.5


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
# Most shots enter part-way in, so each feature gets straight to the point.
def plan_main(S):
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    win = lambda k, src: (SEG[k][0] - src, SEG[k][0] - .6, SEG[k][1] + .1)   # footage time src lands on the feature's start
    return [
        ('v-fl', 'fleet', 4.7 - m('fleet', 'tab'), 4.0, SEG['fl'][1] + .1),       # Fleet is clicked as the laptop lands
        ('v-ov', 'overview_jam', *win('ov', .5)),
        ('v-ok', 'confirm_ok', *win('ok', 2.6)),                                   # starts on the open file
        ('v-ph', 'phone', PHONE_AT + 1.5 - c('phone', 2), PHONE_AT - .4, SEG['ok'][1] + .1),  # hold to cancel 1.5 s in
        ('v-cv', 'convert', *win('cv', 1.4)),
        ('v-sk', 'skip_object', *win('sk', 3.0)),
        ('v-tw', 'twin', SEG['tw'][0] - 1.4, SEG['tw'][0] - .6, TWIN_CUT + .3),     # part 1: the 3D drawing, turned
        ('v-tw2', 'twin', TWIN_CUT - 5.9, TWIN_CUT - .3, SEG['tw'][1] + .1),        # part 2: front, then top
        ('v-st', 'studio', *win('st', 2.4)),
        ('v-au', 'automations', *win('au', 1.9)),
        ('v-ca', 'care', *win('ca', .9)),
        ('v-fi', 'filament', *win('fi', .8)),
        ('v-co', 'cost', *win('co', 1.0)),
        ('v-ha', 'ha', *win('ha', .8)),
        ('v-ga', 'games', *win('ga', 1.0)),
    ]


plan_vertical = plan_main
MAIN_LENGTH = VERT_LENGTH = 90.0

plans = {'main': (plan_main, MAIN_LENGTH), 'vertical': (plan_vertical, VERT_LENGTH)}
plan_fn, LENGTH = plans[FMT]
S = {f[:-5]: shot(f[:-5]) for f in os.listdir(os.path.join(ROOT, 'footage')) if f.endswith('.json')}
plan = plan_fn(S)

os.makedirs(os.path.join(PROJ, 'assets', 'footage'), exist_ok=True)
videos, marks, cues, heard = [], {}, [], set()
random.seed(7)
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
    lo, hi = vfrom + (.3 if vid == 'v-fl' else .5), vto - .1      # only while the shot is really on screen
    for c in S[name]['clicks']:
        t = round(start + c, 3)
        if lo <= t <= hi and t not in heard:
            heard.add(t)
            cues.append({'t': t, 'type': 'click', 'gain': 1.0, 'pan': .12})
    for k in S[name].get('keys', []):
        t = round(start + k, 3)
        if lo <= t <= hi and t not in heard:
            heard.add(t)
            space = name == 'games'                        # Sky Dash is played with the space bar
            cues.append({'t': t, 'type': 'key', 'gain': .85 if space else random.uniform(.5, .7), 'pan': -.05,
                         'pitch': .8 if space else random.uniform(.94, 1.06)})

# End-card typing (version 7: at a person's pace, about ten keys a second, each a little
# uneven). The clone line is already there (pasted: one keystroke); the next two are typed.
random.seed(4)
typing = [[round(END + 1.0, 3)] * 49]
cues.append({'t': round(END + 1.0, 3), 'type': 'key', 'gain': .8, 'pan': 0, 'pitch': 1.0})
t = END + 1.5
for n in (11, 22):
    per = []
    for i in range(n + 1):
        per.append(round(t, 3))
        last = i == n
        cues.append({'t': round(t, 3), 'type': 'key', 'gain': .8 if last else random.uniform(.55, .75),
                     'pan': random.uniform(-.15, .15), 'pitch': .85 if last else random.uniform(.94, 1.06)})
        t += random.uniform(.07, .12) if i < n - 1 else .2
    typing.append(per)
    t += .3

W, H = (1920, 1080) if FMT == 'main' else (1080, 1920)
tpl = open(os.path.join(HERE, 'scene.html')).read()
tpl = tpl.replace('/*LAYOUT_CSS*/', open(os.path.join(HERE, FMT + '.layout.css')).read()) \
         .replace('/*SCENE_JS*/', open(os.path.join(HERE, 'scene.js')).read()) \
         .replace('__FMT__', FMT).replace('__W__', str(W)).replace('__H__', str(H)).replace('__DUR__', f'{LENGTH:g}')
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks)).replace('/*TYPING*/[]/*END*/', json.dumps(typing)) \
          .replace('/*SEGS*/{}/*END*/', json.dumps({**{k: {'t0': a, 't1': b} for k, (a, b) in SEG.items()},
                                                     'values': VALUES, 'end': END, 'twinCut': TWIN_CUT,
                                                     'ok': {'t0': SEG['ok'][0], 't1': SEG['ok'][1], 'phone': PHONE_AT}}))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
audio = os.path.join(PROJ, 'assets', 'audio')
os.makedirs(audio, exist_ok=True)
music_wav = os.path.join(audio, f'music7_{FMT}.wav')
composer = os.path.join(ROOT, 'music', 'compose7.py')
if not os.path.exists(music_wav) or os.path.getmtime(music_wav) < os.path.getmtime(composer):
    subprocess.run(['python3', composer, music_wav, FMT], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
