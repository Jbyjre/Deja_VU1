"""Builds a composition of version 14 (the owner's "V1", version 12's 75-second film, re-cut to
60 s with the new digital twin and the live background) from its template: places the footage on
the timeline from each shot's recorded markers, inlines those markers for the animation, renders
the sound effects (a click on every filmed click, a keystroke on every key press and every typed
character), then mixes them with version 12's music, written from this timeline's own cues.

Version 13 (the owner's "V2") lives in promo-video/build/, main/ and vertical/ and is untouched;
this cut shares only the filming scripts (capture/), the footage and the music tools (music/).

Usage: python3 v14/build/build.py main|vertical
"""
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
V14 = os.path.dirname(HERE)                     # promo-video/v14
ROOT = os.path.dirname(V14)                     # promo-video (footage/, music/, build/cues.js)
FMT = sys.argv[1]
PROJ = os.path.join(V14, FMT)
FOOTAGE = os.environ.get('FOOTAGE_DIR', os.path.join(ROOT, 'footage'))
PAD_START, PAD_END = 4.0, 4.0     # seconds of held first / last frame added to every clip

SHARED_CSS = open(os.path.join(HERE, 'shared.css')).read()


def shot(name):
    return json.load(open(os.path.join(FOOTAGE, name + '.json')))


# Version 14: 60 s, laid out in bars of version 12's 160 BPM music (music/compose10.py; a bar is
# 1.5 s, so 40 bars are exactly 60 s). Version 12's story, tightened:
#   bars 0-2 the hook, 2-4.5 what it is for, 4.5-6 the name, 6-9.5 how it works, 9.5-32 six
#   features (the digital twin longest: its 3D model, then its drawing), 32-34 "and plenty more"
#   (Files ready for the U1 joins it), 34-36 why trust it, 36-40 the end card (get started folds
#   into it: the install lines typed, "or download it and double-click start").
BPM = 160
BEAT = 60 / BPM                   # 0.375 s
BAR = 4 * BEAT                    # 1.5 s
ORDER = [('fl', 2.5), ('ov', 2.5), ('ok', 5), ('pp', 3.5), ('tw', 6), ('au', 3)]
SEG, _b = {}, 9.5
for _k, _n in ORDER:
    SEG[_k] = (round(_b * BAR, 3), round((_b + _n) * BAR, 3))
    _b += _n
assert _b == 32, _b
HIW = {'t0': 6 * BAR, 's2': 7 * BAR, 's3': 8 * BAR}    # how it works: its three steps, a bar each
PHONE_AT = round(SEG['ok'][0] + 3.5 * BAR, 3)          # inside Confirm Print: the phone takes over (on beat 3, as version 12)
TWIN_CUT = round(SEG['tw'][0] + 3.5 * BAR, 3)          # the twin: the 3D model until here, then the drawing
MORE = 32 * BAR                                        # "and plenty more"
VALUES = 34 * BAR                                      # why trust it, one value per beat
END = 36 * BAR                                         # the end card (54 s)
LENGTH = 60.0


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
def plan_main(S):
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    win = lambda k, src: (SEG[k][0] - src, SEG[k][0] - .6, SEG[k][1] + .1)   # footage time src lands on the feature's start
    # The fleet shot opens with the live background (the cursor drifting through the page margin,
    # then a click on an empty spot). It plays on the laptop during how it works, so the ripple
    # lands while the first step is up, and the hover still lands early in the feature.
    fl0 = max(SEG['fl'][0] + 1.2 - m('fleet_bg', 'hover'), HIW['t0'] + .35 - m('fleet_bg', 'ripple'))
    return [
        ('v-fl', 'fleet_bg', fl0, HIW['t0'] - .6, SEG['fl'][1] + .1),
        ('v-ov', 'overview_jam', *win('ov', .5)),
        ('v-ok', 'confirm_ok', *win('ok', OK_SRC)),                                  # starts on the open file
        ('v-ph', 'phone', PHONE_AT + 1.1 - c('phone', 2), PHONE_AT - .4, SEG['ok'][1] + .1),  # hold to cancel 1.1 s in
        ('v-pp', 'prepare', *win('pp', PP_SRC)),
        # the twin plays as one continuous take: the drawing switch lands on the cut
        ('v-tw', 'twin3d', TWIN_CUT - m('twin3d', 'drawing'), SEG['tw'][0] - .6, SEG['tw'][1] + .1),
        ('v-au', 'automations', *win('au', AU_SRC)),
    ]


# where each feature's footage starts (seconds into the shot), set from the filmed marks so every
# callout stays up at least about a second
OK_SRC, PP_SRC, AU_SRC = 3.4, 1.3, 2.2
plan_vertical = plan_main
plans = {'main': plan_main, 'vertical': plan_vertical}
S = {f[:-5]: shot(f[:-5]) for f in os.listdir(FOOTAGE) if f.endswith('.json')}
plan = plans[FMT](S)

os.makedirs(os.path.join(PROJ, 'assets', 'footage'), exist_ok=True)
videos, marks, cues, heard = [], {}, [], set()
random.seed(7)
for vid, name, start, vfrom, vto in plan:
    src = os.path.join(FOOTAGE, name + '.mp4')
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
            cues.append({'t': t, 'type': 'key', 'gain': random.uniform(.5, .7), 'pan': -.05, 'pitch': random.uniform(.94, 1.06)})

# End-card typing, as version 12: a quick typist, about thirteen keys a second, each a little
# uneven. The clone line is pasted (one keystroke); the next two are typed.
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
                                                     'hiw': HIW, 'more': MORE, 'length': LENGTH,
                                                     'ok': {'t0': SEG['ok'][0], 't1': SEG['ok'][1], 'phone': PHONE_AT}}))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

# "And plenty more": stills of the supporting features, from the same filmed shots, each cropped
# to 16:10 around the panel that matters (x, y, width in page pixels; the footage is 1440 x 900).
# Version 14: Files ready for the U1 (a feature of its own in version 12) joins them, in place of
# the games.
# Measured on version 14's footage: the maintenance card itself; the filament inventory's spool list
# with how many prints each has left (the staged spools of `filament_v14`, cropped below the card's
# header); the MakerWorld project open in the U1 workspace, its part in the 3D viewer.
STILLS = {'care': ('care', 4.6, (150, 330, 900)), 'filament': ('filament_v14', 4.3, (170, 545, 560)),
          'skip': ('skip_object', 9.3, (160, 100, 900)), 'ha': ('ha', 5.2, (700, 180, 620)),
          'modules': ('ha', 5.2, (150, 120, 600)), 'convert': ('convert', .5, (170, 95, 880))}
os.makedirs(os.path.join(PROJ, 'assets', 'stills'), exist_ok=True)
for name, (src, at, (x, y, w)) in STILLS.items():
    h = round(w * 10 / 16)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', str(at), '-i', os.path.join(FOOTAGE, src + '.mp4'), '-frames:v', '1',
                    '-vf', f'crop={w}:{h}:{x}:{y},scale=960:600:flags=lanczos', '-q:v', '2',
                    os.path.join(PROJ, 'assets', 'stills', name + '.jpg')], check=True)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
audio = os.path.join(PROJ, 'assets', 'audio')
os.makedirs(audio, exist_ok=True)

# The music follows the picture (version 9's idea): read back from the built page the moments
# scene.js put on the music's grid, add the feature changes, and hand the lot to the composer.
# There is no separate "get started" section any more, so `start` is the end card: the values
# keep their two light bars and no second time-keeping section is laid.
pcues = json.loads(subprocess.run(['node', os.path.join(ROOT, 'build', 'cues.js'), os.path.join(PROJ, 'index.html'), FMT],
                                  check=True, capture_output=True, text=True,
                                  env={**os.environ, 'NODE_PATH': os.environ.get('NODE_PATH', '/opt/node22/lib/node_modules')}).stdout)
plan_file = os.path.join(HERE, f'music_{FMT}.json')
json.dump({'bpm': BPM, 'length': LENGTH, 'cues': sorted(pcues, key=lambda c: c['t']),
           'changes': [SEG[k][0] for k, _ in ORDER] + [MORE], 'band': HIW['t0'], 'values': VALUES,
           'more': MORE, 'start': END, 'end': END},
          open(plan_file, 'w'), indent=0)
music_wav = os.path.join(audio, f'music10_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'compose10.py'), music_wav, plan_file], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True, env={**os.environ, 'DEJAVU_MUSIC_LEVEL': '.72'})
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
