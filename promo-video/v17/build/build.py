"""Builds version 17 (16:9 only, 60 s): version 16 made smoother. Version 16's own frame-by-frame
measurement found the filmed app swapping whole views in a single frame (the Overview after Start,
Arrange, the drawing); this script finds each of those frames in the new footage (`SOFT`) and hands
the timeline the frame before it, which dissolves into the new view. "And plenty more" shows what
changed in the app since version 16 (`stills_v17`). Usage: python3 v17/build/build.py

Version 16, kept for reference: the owner's "V1" line (version 14's story and version 12's
music), showing what changed in the app since: the 3DBenchy instead of the block and the cube
(Confirm Print, prepare & slice), the quick tour whose glass callouts glide around the app, and
scanning a QR code to open and pair the dashboard on a phone. "And plenty more" shows the farm
desk, mixed layer heights, the converter, live telemetry, the process settings and automations.

The owner (25 October 2026): version 2 (version 13/15's "V2") and ChatGPT-made videos are set
aside; only 16:9 from now on, so there is no vertical cut.

Places the footage on the timeline from each shot's recorded markers, inlines those markers for
the animation, renders the sound effects (a click on every filmed click, a keystroke on every key
press), then mixes them with version 12's music, written from this timeline's own cues.

Usage: python3 v16/build/build.py
"""
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
V17 = os.path.dirname(HERE)                     # promo-video/v17
ROOT = os.path.dirname(V17)                     # promo-video (footage/, music/, build/cues.js)
FMT = 'main'                                    # 16:9 only (the owner, 25 October 2026)
PROJ = os.path.join(V17, FMT)
FOOTAGE = os.environ.get('FOOTAGE_DIR', os.path.join(ROOT, 'footage'))
PAD_START, PAD_END = 4.0, 4.0     # seconds of held first / last frame added to every clip

SHARED_CSS = open(os.path.join(HERE, 'shared.css')).read()


def shot(name):
    return json.load(open(os.path.join(FOOTAGE, name + '.json')))


# Version 16: 60 s in bars of version 12's 160 BPM music (music/compose10.py; a bar is 1.5 s, so 40
# bars are exactly 60 s). Bars 0-9.5 are version 14's opening (hook, what it is for, the name, how
# it works); 9.5-32 seven features; 32-34 "and plenty more"; 34-36 why trust it; 36-40 the end card.
BPM = 160
BEAT = 60 / BPM                   # 0.375 s
BAR = 4 * BEAT                    # 1.5 s
ORDER = [('fl', 2.5), ('ov', 2), ('ok', 3.5), ('pp', 3), ('tw', 4.5), ('tg', 4), ('cp', 3)]
SEG, _b = {}, 9.5
for _k, _n in ORDER:
    SEG[_k] = (round(_b * BAR, 3), round((_b + _n) * BAR, 3))
    _b += _n
assert _b == 32, _b
HIW = {'t0': 6 * BAR, 's2': 7 * BAR, 's3': 8 * BAR}    # how it works: its three steps, a bar each
TWIN_CUT = round(SEG['tw'][0] + 2.5 * BAR, 3)          # the twin: the 3D model until here, then the drawing
MORE = 32 * BAR                                        # "and plenty more"
VALUES = 34 * BAR                                      # why trust it, one value per beat
END = 36 * BAR                                         # the end card (54 s)
LENGTH = 60.0


# Each entry: (video id, shot, composition time of the shot's t=0, visible from, visible to).
def plan_main(S):
    m = lambda s, k: S[s]['marks'][k]
    win = lambda k, src: (SEG[k][0] - src, SEG[k][0] - .6, SEG[k][1] + .1)   # footage time src lands on the feature's start
    fl0 = max(SEG['fl'][0] + 1.2 - m('fleet_bg', 'hover'), HIW['t0'] + .35 - m('fleet_bg', 'ripple'))
    # the phone: the sheet opens just after the caption; the phone comes forward as it is scanned
    cp0 = SEG['cp'][0] + .35 - m('phone_qr', 'sheet')
    return [
        ('v-fl', 'fleet_bg', fl0, HIW['t0'] - .6, SEG['fl'][1] + .1),
        ('v-ov', 'overview_jam', *win('ov', .5)),
        ('v-ok', 'confirm_ok', *win('ok', OK_SRC)),                                  # starts on the open file
        ('v-pp', 'prepare', *win('pp', PP_SRC)),
        # the twin plays as one continuous take: the drawing switch lands on the cut
        ('v-tw', 'twin3d_tight', TWIN_CUT - m('twin3d_tight', 'drawing'), SEG['tw'][0] - .6, SEG['tw'][1] + .1),
        # the tour: Show me lands just after the caption, then a stop a little under a bar apart
        ('v-tg', 'tour_v16', SEG['tg'][0] + .45 - S['tour_v16']['clicks'][0], SEG['tg'][0] - .6, SEG['tg'][1] + .1),
        ('v-cp', 'phone_qr', cp0, SEG['cp'][0] - .6, SEG['cp'][1] + .1),
        ('v-ph', 'phone_paired', PHONE_AT - .5, PHONE_AT - .4, SEG['cp'][1] + .1),
    ]


# where each feature's footage starts (seconds into the shot), set from the filmed marks so every
# callout stays up at least about a second
OK_SRC, PP_SRC = 2.6, 1.9       # version 16: Confirm Print opens on the Print… press (its dialog is up 0.6 s later)
S = {f[:-5]: shot(f[:-5]) for f in os.listdir(FOOTAGE) if f.endswith('.json')}
PHONE_AT = round(SEG['cp'][0] + .35 - S['phone_qr']['marks']['sheet'] + S['phone_qr']['marks']['scanned'], 3)
plan = plan_main(S)

# Version 17: where the filmed app swaps its whole view in one frame, a short dissolve. Each entry:
# (video id, shot, mark, search from / to in seconds around the mark, dissolve length). The frame
# with the largest change in that window is the swap; the frame before it is saved as a picture.
SOFT = [('v-ok', 'confirm_ok', 'start', 0, 1.6, .35),       # Start print: the app shows the Overview
        ('v-pp', 'prepare', 'arrange', -.1, 1.0, .3),       # Arrange: both boats move, the view re-frames
        ('v-tw', 'twin3d_tight', 'drawing', -.05, .8, .3)]  # the 3D model becomes the drawing, on the bar


def frame_diffs(path, w=160, h=100):
    """Mean change between consecutive frames of a clip (grey, scaled down): index i is frame i to i+1."""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={w}:{h}:flags=area,format=gray', '-f', 'rawvideo', '-'],
                         capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
    return np.abs(np.diff(f, axis=0)).mean(axis=(1, 2))

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

soft = []
os.makedirs(os.path.join(PROJ, 'assets', 'soft'), exist_ok=True)
for vid, name, mk, a, b, dur in SOFT:
    fps = S[name]['fps']
    d = frame_diffs(os.path.join(FOOTAGE, name + '.mp4'))
    i0, i1 = max(0, int((S[name]['marks'][mk] + a) * fps)), min(len(d), int((S[name]['marks'][mk] + b) * fps))
    j = i0 + int(d[i0:i1].argmax()) + 1                 # the first frame of the new view
    near = sorted(d[max(0, i0 - 30):i1 + 30])
    print(f'soft cut {vid}: frame {j} ({j / fps:.3f} s), change {d[j - 1]:.1f} against a typical {near[len(near) // 2]:.2f}')
    img = f'assets/soft/{vid}.jpg'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{PAD_START + (j - 1) / fps:.4f}', '-i',
                    os.path.join(PROJ, 'assets', 'footage', name + '.mp4'), '-frames:v', '1', '-q:v', '1', os.path.join(PROJ, img)], check=True)
    soft.append({'vid': vid, 't': round(marks[vid]['start'] + j / fps, 4), 'img': img, 'd': dur})

# The end card: the install block from the README (Mac and Linux; Windows has the same in
# PowerShell), pasted with one keystroke, a line at a time as a terminal draws a paste, then Enter.
# TYPING holds, per line, one time per character (scene.js widens the line a character at a time).
TERM = open(os.path.join(HERE, 'scene.html')).read()
import re as _re
LINES = [_re.sub(r'<[^>]+>', '', l).replace('&amp;', '&').replace('&gt;', '>') for l in _re.findall(r'<div class="ln"><b>\$</b> (.*?)</div>', TERM)]
assert len(LINES) == 3, LINES
KEY_END = .5                      # version 11: the real piano's last chord fades sooner, so the keys sit 6 dB lower
PASTE = round(END + .9, 3)
typing = [[round(PASTE + .07 * i, 3)] * (len(line) + 1) for i, line in enumerate(LINES)]
cues.append({'t': PASTE, 'type': 'key', 'gain': .8 * KEY_END, 'pan': 0, 'pitch': 1.0})          # the paste
cues.append({'t': round(PASTE + .75, 3), 'type': 'key', 'gain': .8 * KEY_END, 'pan': 0, 'pitch': .85})   # Enter

W, H = 1920, 1080
tpl = open(os.path.join(HERE, 'scene.html')).read()
tpl = tpl.replace('/*LAYOUT_CSS*/', open(os.path.join(HERE, FMT + '.layout.css')).read()) \
         .replace('/*SCENE_JS*/', open(os.path.join(HERE, 'scene.js')).read()) \
         .replace('__FMT__', FMT).replace('__W__', str(W)).replace('__H__', str(H)).replace('__DUR__', f'{LENGTH:g}')
html = tpl.replace('/*SHARED_CSS*/', SHARED_CSS).replace('<!--VIDEOS-->', '\n'.join(videos)) \
          .replace('/*MARKS*/{}/*END*/', json.dumps(marks)).replace('/*TYPING*/[]/*END*/', json.dumps(typing)) \
          .replace('/*SEGS*/{}/*END*/', json.dumps({**{k: {'t0': a, 't1': b} for k, (a, b) in SEG.items()},
                                                     'values': VALUES, 'end': END, 'twinCut': TWIN_CUT, 'beat': BEAT,
                                                     'hiw': HIW, 'more': MORE, 'length': LENGTH,
                                                     'phone': PHONE_AT, 'enter': round(PASTE + .75, 3), 'soft': soft}))
open(os.path.join(PROJ, 'index.html'), 'w').write(html)

# "And plenty more": screenshots of the real panels (capture/shots.js `stills_v17`, 16:10 already),
# scaled to the cards' 960 x 600. Version 17: what changed since version 16 takes the second row.
STILLS = ['desk', 'convert', 'automations', 'away', 'updates', 'help']
os.makedirs(os.path.join(PROJ, 'assets', 'stills'), exist_ok=True)
for name in STILLS:
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', os.path.join(FOOTAGE, 'stills_v17', name + '.png'),
                    '-vf', 'scale=960:600:force_original_aspect_ratio=increase:flags=lanczos,crop=960:600:0:0', '-q:v', '2',
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
print('built', FMT, len(videos), 'videos,', len(cues), 'sound cues; phone at', PHONE_AT)
