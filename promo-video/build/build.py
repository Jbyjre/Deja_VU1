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
BEAT = 0.4                        # 150 BPM

SHARED_CSS = open(os.path.join(HERE, 'shared.css')).read()


def shot(name):
    return json.load(open(os.path.join(ROOT, 'footage', name + '.json')))


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
# One shot can appear more than once (the opening montage reuses the best moment of four).
def plan_main(S):
    """Version 5: one plan for both cuts (both 75 s, the same scenes and timing)."""
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    return [
        ('v-fl', 'fleet', 12.2 - m('fleet', 'hover'), 7.6, 16.1),          # the card hover at 12.2
        ('v-ov', 'overview_jam', 17.6 - m('overview_jam', 'jam'), 15.8, 23.1),
        ('v-ok', 'confirm_ok', 21.3, 22.8, 29.8),                           # opens on the open file
        ('v-ph', 'phone', 31.0 - c('phone', 2), 29.6, 32.0),                # hold to cancel at 31.0
        ('v-cv', 'convert', 33.42 - c('convert', 1), 31.8, 39.1),           # opens on the open file
        ('v-sk', 'skip_object', 44.0 - m('skip_object', 'skip'), 38.8, 47.1),
        ('v-tw', 'twin', 49.33 - m('twin', 'front'), 46.8, 55.1),
        ('v-st', 'studio', 56.38 - c('studio', 0), 54.8, 62.1),
    ]


plan_vertical = plan_main
MAIN_WHOOSH = [8.0, 16.0, 23.0, 29.6, 32.0, 39.0, 47.0, 55.0, 62.0, 68.0]
VERT_WHOOSH = MAIN_WHOOSH
MAIN_TERM = VERT_TERM = (69.6, [48, 11, 22])     # typing starts, characters per line (end card)
MAIN_LENGTH = VERT_LENGTH = 75.0

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

cues += [{'t': t, 'type': 'whoosh', 'gain': .5, 'pan': -.2 + .4 * (i % 2)} for i, t in enumerate(whooshes)]

W, H = (1920, 1080) if FMT == 'main' else (1080, 1920)
tpl = open(os.path.join(HERE, 'scene.html')).read()
tpl = tpl.replace('/*LAYOUT_CSS*/', open(os.path.join(HERE, FMT + '.layout.css')).read()) \
         .replace('/*SCENE_JS*/', open(os.path.join(HERE, 'scene.js')).read()) \
         .replace('__FMT__', FMT).replace('__W__', str(W)).replace('__H__', str(H)).replace('__DUR__', f'{LENGTH:g}')
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks)).replace('/*TYPING*/[]/*END*/', json.dumps(typing))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
audio = os.path.join(PROJ, 'assets', 'audio')
os.makedirs(audio, exist_ok=True)
music_wav = os.path.join(audio, f'music5_{FMT}.wav')
composer = os.path.join(ROOT, 'music', 'compose5.py')
if not os.path.exists(music_wav) or os.path.getmtime(music_wav) < os.path.getmtime(composer):
    subprocess.run(['python3', composer, music_wav, FMT], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
