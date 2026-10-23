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
# Version 15 (the owner's "V2", version 13, updated): this build lives in v15/; the footage,
# the music tools and cues.js are shared with promo-video/.
V15 = os.path.dirname(HERE)
ROOT = os.path.dirname(V15)
FMT = sys.argv[1]
PROJ = os.path.join(V15, FMT)
PAD_START, PAD_END = 4.0, 4.0     # seconds of held first / last frame added to every clip

SHARED_CSS = open(os.path.join(HERE, 'shared.css')).read()


def shot(name):
    return json.load(open(os.path.join(ROOT, 'footage', name + '.json')))


# Version 13: 60 s (the owner: "do a 60-second video"), laid out in bars of the new 144 BPM music
# (music/compose11.py; a bar is 1.667 s, so 36 bars make exactly 60 s), every change on a bar line.
# The story (the owner: explain the problem and why the app is there, then show the features
# clearly and smoothly):
#   bars 0-4 the problem, 4-6 the answer (the name), 6-8.5 how it works, 8.5-29 six features,
#   29-31 "and plenty more", 31-32.5 why trust it, 32.5-36 the end card (where to get it).
BPM = 144
BEAT = 60 / BPM                   # 0.4167 s
BAR = 4 * BEAT                    # 1.667 s
# Version 15: the twin gets 4.5 bars (version 13: 3), from half a bar each of the fleet, prepare &
# slice and "and plenty more"; the opening (its music is written to fixed bars) is unchanged.
ORDER = [('fl', 2.5), ('ov', 2.5), ('ok', 5), ('pp', 3), ('tw', 4.5), ('au', 3.5)]
SEG, _b = {}, 8.5
for _k, _n in ORDER:
    SEG[_k] = (round(_b * BAR, 3), round((_b + _n) * BAR, 3))
    _b += _n
assert _b == 29.5, _b                            # version 15: the features end on bar 29.5
NAME = 4 * BAR                                         # the answer: the windows fold into the app's icon
HIW = 6 * BAR                                          # how it works
PHONE_AT = round(SEG['ok'][0] + 3.5 * BAR, 3)          # inside Confirm Print: the phone takes over (on beat 3)
OK_CUT = round(SEG['ok'][0] + 2.9, 3)                  # Confirm Print: the dialog's filmed 2 s pause is cut short here
TWIN_CUT = round(SEG['tw'][0] + 3 * BAR, 3)            # the twin: the 3D model until here, then the drawing (on a bar)
MORE = 29.5 * BAR                                      # "and plenty more" (version 15: 1.5 bars)
VALUES = 31 * BAR                                      # why trust it, one line per beat
END = 32.5 * BAR                                       # the end card (54.2 s)
LENGTH = 60.0
LAND = 1.9                                             # a feature's key moment comes this long after its start,
                                                       # once its headline has landed and stepped aside


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
# Each shot is placed so its key moment (a mark or a click) lands LAND seconds into its feature.
def plan_main(S):
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    key = lambda k, t: SEG[k][0] + LAND - t               # footage time t lands on the feature's key moment
    w = lambda k, start: (start, SEG[k][0] - .6, SEG[k][1] + .1)
    return [
        # version 15: the fleet shot opens with the live background (the cursor drifts through the page
        # margin, then a click on an empty spot ripples the dots), playing on the laptop as it lands
        ('v-fl', 'fleet_bg', max(key('fl', m('fleet_bg', 'hover')), HIW + .1 - m('fleet_bg', 'ripple')), HIW - .6, SEG['fl'][1] + .1),
        ('v-ov', 'overview_jam', *w('ov', key('ov', m('overview_jam', 'jam')))),
        # Confirm Print in two parts of one shot: the Print click and the checks, then (cut where
        # the dialog sits still, so the frames match) the Start click a second sooner than filmed
        ('v-ok', 'confirm_ok', SEG['ok'][0] + 1.5 - c('confirm_ok', 1), SEG['ok'][0] - .6, OK_CUT + .3),
        ('v-ok2', 'confirm_ok', OK_CUT + .05 - m('confirm_ok', 'dialog'), OK_CUT - .3, SEG['ok'][1] + .1),
        ('v-ph', 'phone', PHONE_AT + 1.2 - c('phone', 2), PHONE_AT - .4, SEG['ok'][1] + .1),
        ('v-pp', 'prepare', *w('pp', key('pp', m('prepare', 'blue')))),                   # the copy turns blue as the caption settles (3 bars now)
        # version 15: the new twin, one continuous take; the Drawing switch lands on the cut
        ('v-tw', 'twin3d_tight', TWIN_CUT - m('twin3d_tight', 'drawing'), SEG['tw'][0] - .6, SEG['tw'][1] + .1),
        ('v-au', 'automations', *w('au', key('au', m('automations', 'template')) - .3)),   # version 15: .3 s sooner, so both callouts have time
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
# so it finishes with a second to spare before the end). The clone line is pasted (one
# keystroke); the next two are typed.
random.seed(4)
typing = [[round(END + .7, 3)] * 49]
KEY_END = .75                     # version 13: the vibes hook plays under the typing, so it comes back up 3.5 dB (v11: .5)
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
                                                     'hiw': HIW, 'more': MORE, 'name': NAME,
                                                     'ok': {'t0': SEG['ok'][0], 't1': SEG['ok'][1], 'phone': PHONE_AT, 'cut': OK_CUT}}))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

# "And plenty more": stills of the supporting features, from the same filmed shots, each cropped
# to 16:10 around the panel that matters (x, y, width in page pixels; the footage is 1440 x 900).
# Version 15 (measured on the current footage, as version 14): the maintenance card itself; the
# filament inventory's spool list (spools entered before filming in `filament_v14`); and Files ready
# for the U1 (the MakerWorld project open in the U1 workspace) in the games' place.
STILLS = {'care': ('care', 4.6, (150, 330, 900)), 'filament': ('filament_v14', 4.3, (170, 545, 560)),
          'skip': ('skip_object', 9.3, (160, 100, 900)), 'ha': ('ha', 5.2, (700, 180, 620)),
          'modules': ('ha', 5.2, (150, 120, 600)), 'convert': ('convert', .5, (170, 95, 880))}
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

# Version 9: the music follows the picture (version 13: a new tune, compose11.py). Read back from the built page the moments scene.js
# put on the music's grid (words, promises, callouts, the phone, sensor rows, values), add the
# feature changes, and hand the lot to the composer.
pcues = json.loads(subprocess.run(['node', os.path.join(ROOT, 'build', 'cues.js'), os.path.join(PROJ, 'index.html'), FMT],
                                  check=True, capture_output=True, text=True,
                                  env={**os.environ, 'NODE_PATH': os.environ.get('NODE_PATH', '/opt/node22/lib/node_modules')}).stdout)
plan_file = os.path.join(HERE, f'music_{FMT}.json')
json.dump({'bpm': BPM, 'length': LENGTH, 'cues': sorted(pcues, key=lambda c: c['t']),
           'changes': [SEG[k][0] for k, _ in ORDER] + [MORE], 'name': NAME, 'hiw': HIW, 'values': VALUES,
           'more': MORE, 'end': END, 'segs': {k: v for k, v in SEG.items()}, 'phone': PHONE_AT,
           'band': HIW, 'start': END},                          # band, start: read by compose9 when compose11 imports it
          open(plan_file, 'w'), indent=0)
music_wav = os.path.join(audio, f'music11_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'compose11.py'), music_wav, plan_file], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
