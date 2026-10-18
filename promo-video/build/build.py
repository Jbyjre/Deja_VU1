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


# Version 10: still 75 s, laid out in bars of the 160 BPM music (music/compose9.py; a bar is
# 1.5 s), so every change lands on a bar line (a half bar = beat 3). The story (the owner: less
# of a feature list, more about what the app is, how it works and where to get it):
#   bars 0-2 the hook, 2-4.5 what it is for, 4.5-6 the name, 6-10.5 how it works (the laptop
#   lands showing the app, the printers and the phone join it), 10.5-35.5 seven features,
#   35.5-39.5 "and plenty more", 39.5-41.5 why trust it, 41.5-46 get started, 46-50 the end card.
BPM = 160
BEAT = 60 / BPM                   # 0.375 s
BAR = 4 * BEAT                    # 1.5 s
ORDER = [('fl', 3), ('ov', 3), ('ok', 5.5), ('cv', 3), ('sk', 3.5), ('tw', 3.5), ('au', 3.5)]
SEG, _b = {}, 10.5
for _k, _n in ORDER:
    SEG[_k] = (round(_b * BAR, 3), round((_b + _n) * BAR, 3))
    _b += _n
assert _b == 35.5, _b
HIW = {'t0': 6 * BAR, 's2': 7.5 * BAR, 's3': 9 * BAR}  # how it works: its three steps
PHONE_AT = round(SEG['ok'][0] + 3.5 * BAR, 3)          # inside Confirm Print: the phone takes over (on beat 3)
TWIN_CUT = round(SEG['tw'][0] + 2 * BAR, 3)            # the twin: 3D (turned by hand) until here, then front and top
MORE = 35.5 * BAR                                      # "and plenty more"
VALUES = 39.5 * BAR                                    # why trust it, one value per beat
START = 41.5 * BAR                                     # get started
END = 46 * BAR                                         # the end card (69 s)
LENGTH = 75.0


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
# Most shots enter part-way in, so each feature gets straight to the point.
def plan_main(S):
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    win = lambda k, src: (SEG[k][0] - src, SEG[k][0] - .6, SEG[k][1] + .1)   # footage time src lands on the feature's start
    return [
        ('v-fl', 'fleet', SEG['fl'][0] + 1.2 - m('fleet', 'hover'), HIW['t0'] - .6, SEG['fl'][1] + .1),  # on the laptop from how it works on
        ('v-ov', 'overview_jam', *win('ov', .5)),
        ('v-ok', 'confirm_ok', *win('ok', 3.0)),                                     # starts on the open file
        ('v-ph', 'phone', PHONE_AT + 1.5 - c('phone', 2), PHONE_AT - .4, SEG['ok'][1] + .1),  # hold to cancel 1.5 s in
        ('v-cv', 'convert', *win('cv', 1.4)),
        ('v-sk', 'skip_object', *win('sk', 3.5)),
        ('v-tw', 'twin', SEG['tw'][0] - 1.4, SEG['tw'][0] - .6, TWIN_CUT + .3),     # part 1: the 3D drawing, turned
        ('v-tw2', 'twin', TWIN_CUT - 5.9, TWIN_CUT - .3, SEG['tw'][1] + .1),        # part 2: front, then top
        ('v-au', 'automations', *win('au', 1.9)),
    ]


plan_vertical = plan_main
MAIN_LENGTH = VERT_LENGTH = LENGTH

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

# End-card typing (version 8: a quick typist, about thirteen keys a second, each a little uneven,
# so it finishes with a second to spare before the 75 s end). The clone line is pasted (one
# keystroke); the next two are typed.
random.seed(4)
typing = [[round(END + .7, 3)] * 49]
KEY_END = .5                      # version 11: the real piano's last chord fades sooner, so the typing sits 6 dB lower
cues.append({'t': round(END + .7, 3), 'type': 'key', 'gain': .8 * KEY_END, 'pan': 0, 'pitch': 1.0})
t = END + 1.1
for n in (11, 22):
    per = []
    for i in range(n + 1):
        per.append(round(t, 3))
        last = i == n
        cues.append({'t': round(t, 3), 'type': 'key', 'gain': KEY_END * (.8 if last else random.uniform(.55, .75)),
                     'pan': random.uniform(-.15, .15), 'pitch': .85 if last else random.uniform(.94, 1.06)})
        t += random.uniform(.06, .09) if i < n - 1 else .18
    typing.append(per)
    t += .25
assert t < LENGTH - .8, t

W, H = (1920, 1080) if FMT == 'main' else (1080, 1920)
tpl = open(os.path.join(HERE, 'scene.html')).read()
tpl = tpl.replace('/*LAYOUT_CSS*/', open(os.path.join(HERE, FMT + '.layout.css')).read()) \
         .replace('/*SCENE_JS*/', open(os.path.join(HERE, 'scene.js')).read()) \
         .replace('__FMT__', FMT).replace('__W__', str(W)).replace('__H__', str(H)).replace('__DUR__', f'{LENGTH:g}')
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks)).replace('/*TYPING*/[]/*END*/', json.dumps(typing)) \
          .replace('/*SEGS*/{}/*END*/', json.dumps({**{k: {'t0': a, 't1': b} for k, (a, b) in SEG.items()},
                                                     'values': VALUES, 'end': END, 'twinCut': TWIN_CUT, 'beat': BEAT,
                                                     'hiw': HIW, 'more': MORE, 'start': START,
                                                     'ok': {'t0': SEG['ok'][0], 't1': SEG['ok'][1], 'phone': PHONE_AT}}))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

# "And plenty more": stills of the supporting features, from the same filmed shots, each cropped
# to 16:10 around the panel that matters (x, y, width in page pixels; the footage is 1440 x 900).
STILLS = {'care': ('care', 4.6, (150, 275, 1000)), 'filament': ('filament', 5.0, (150, 230, 640)),
          'cost': ('cost', 3.0, (150, 420, 760)), 'ha': ('ha', 5.2, (700, 180, 620)),
          'modules': ('ha', 5.2, (150, 120, 600)), 'games': ('games', 4.5, (260, 330, 900))}
os.makedirs(os.path.join(PROJ, 'assets', 'stills'), exist_ok=True)
for name, (src, at, (x, y, w)) in STILLS.items():
    h = round(w * 10 / 16)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', str(at), '-i', os.path.join(ROOT, 'footage', src + '.mp4'), '-frames:v', '1',
                    '-vf', f'crop={w}:{h}:{x}:{y},scale=960:600:flags=lanczos', '-q:v', '2',
                    os.path.join(PROJ, 'assets', 'stills', name + '.jpg')], check=True)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
audio = os.path.join(PROJ, 'assets', 'audio')
os.makedirs(audio, exist_ok=True)

# Version 9: the music follows the picture. Read back from the built page the moments scene.js
# put on the music's grid (words, promises, callouts, the phone, sensor rows, values), add the
# feature changes, and hand the lot to the composer.
pcues = json.loads(subprocess.run(['node', os.path.join(HERE, 'cues.js'), os.path.join(PROJ, 'index.html'), FMT],
                                  check=True, capture_output=True, text=True,
                                  env={**os.environ, 'NODE_PATH': os.environ.get('NODE_PATH', '/opt/node22/lib/node_modules')}).stdout)
plan_file = os.path.join(HERE, f'music_{FMT}.json')
json.dump({'bpm': BPM, 'length': LENGTH, 'cues': sorted(pcues, key=lambda c: c['t']),
           'changes': [SEG[k][0] for k, _ in ORDER] + [MORE, START], 'band': HIW['t0'], 'values': VALUES,
           'more': MORE, 'start': START, 'end': END},
          open(plan_file, 'w'), indent=0)
music_wav = os.path.join(audio, f'music10_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'compose10.py'), music_wav, plan_file], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
