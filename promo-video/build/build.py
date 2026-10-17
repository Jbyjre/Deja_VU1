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
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    return [
        # opening montage: four features, 1.2 s each
        ('h-fl', 'fleet', 0.0 - (m('fleet', 'hover') - .5), 0.0, 1.25),
        ('h-ok', 'confirm_ok', 1.2 + .15 - m('confirm_ok', 'dialog'), 1.15, 2.45),
        ('h-sk', 'skip_object', 2.4 + .35 - m('skip_object', 'skip'), 2.35, 3.65),
        ('h-tw', 'twin', 3.6 + .25 - m('twin', 'front'), 3.55, 4.85),
        # the feature scenes (15.5 s of the one line, the app and the laptop come first)
        ('v-fl', 'fleet', 7.6, 7.0, 12.9),
        ('v-ov', 'overview_jam', 14.0 - m('overview_jam', 'jam'), 12.5, 16.1),
        ('v-ok', 'confirm_ok', 16.75 - c('confirm_ok', 1), 15.8, 20.9),     # opens on the file, Print... at 16.75
        ('v-ph', 'phone', 23.0 - c('phone', 2), 20.8, 24.1),                # hold to cancel at 23.0
        ('v-cv', 'convert', 25.2 - c('convert', 1), 23.9, 27.3),
        ('v-3d', 'coaster_3d', 27.1, 27.0, 30.5),
        ('v-sk', 'skip_object', 32.6 - m('skip_object', 'skip'), 30.2, 33.7),
        ('v-au', 'automations', 34.3 - c('automations', 0), 33.4, 36.1),
        ('v-tw', 'twin', 36.9 - m('twin', 'front'), 35.8, 39.3),
        ('v-st', 'studio', 39.7 - c('studio', 0), 39.0, 41.7),
        ('v-gm', 'games', 40.7, 41.4, 43.3),
    ]


MAIN_WHOOSH = [6.4, 8.0, 12.8, 20.8, 24.0, 30.4, 36.0, 41.6, 46.4]
MAIN_TERM = (47.55, [48, 11, 22])     # typing starts, characters per line (end card)
MAIN_LENGTH = 53.0


def plan_vertical(S):
    m = lambda s, k: S[s]['marks'][k]
    c = lambda s, i: S[s]['clicks'][i]
    return [
        ('h-fl', 'fleet', 0.0 - (m('fleet', 'hover') - .5), 0.0, 1.25),
        ('h-ok', 'confirm_ok', 1.2 + .15 - m('confirm_ok', 'dialog'), 1.15, 2.45),
        ('h-sk', 'skip_object', 2.4 + .35 - m('skip_object', 'skip'), 2.35, 3.65),
        ('h-tw', 'twin', 3.6 + .25 - m('twin', 'front'), 3.55, 4.85),
        ('v-lap', 'fleet', 7.6, 7.0, 8.3),                                   # on the laptop as it rises
        ('v-fl', 'fleet', 7.6, 7.9, 11.3),
        ('v-ov', 'overview_jam', 12.4 - m('overview_jam', 'jam'), 11.0, 14.5),
        ('v-ok', 'confirm_ok', 14.9 - c('confirm_ok', 1), 14.2, 17.7),       # starts on the open file
        ('v-ph', 'phone', 19.0 - c('phone', 2), 17.6, 20.1),
        ('v-cv', 'convert', 21.0 - c('convert', 1), 19.9, 22.5),
        ('v-sk', 'skip_object', 24.6 - m('skip_object', 'skip'), 22.2, 25.7),
        ('v-tw', 'twin', 26.5 - m('twin', 'front'), 25.4, 28.9),
    ]


VERT_WHOOSH = [6.4, 8.0, 11.2, 17.6, 20.0, 22.4, 25.6, 28.8, 32.0]
VERT_TERM = (33.1, [48, 11, 22])
VERT_LENGTH = 38.4

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

tpl = open(os.path.join(HERE, FMT + '.tpl.html')).read()
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks)).replace('/*TYPING*/[]/*END*/', json.dumps(typing))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

cue_file = os.path.join(HERE, f'sfx_{FMT}.json')
json.dump(sorted(cues, key=lambda c: c['t']), open(cue_file, 'w'), indent=0)
audio = os.path.join(PROJ, 'assets', 'audio')
os.makedirs(audio, exist_ok=True)
music_wav = os.path.join(audio, f'music4_{FMT}.wav')
composer = os.path.join(ROOT, 'music', 'compose4.py')
if not os.path.exists(music_wav) or os.path.getmtime(music_wav) < os.path.getmtime(composer):
    subprocess.run(['python3', composer, music_wav, FMT], check=True)
sfx_wav = os.path.join(audio, f'sfx_{FMT}.wav')
subprocess.run(['python3', os.path.join(ROOT, 'music', 'sfx.py'), cue_file, str(LENGTH), sfx_wav], check=True)
subprocess.run(['python3', os.path.join(ROOT, 'music', 'mix.py'), music_wav, sfx_wav, cue_file,
                os.path.join(audio, f'mix_{FMT}.wav')], check=True)
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues')
