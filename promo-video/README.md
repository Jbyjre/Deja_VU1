# Deja Vu1 launch video

For current standalone marketing images, use the eighteen cards in
[`marketing-library/09-current-campaign/`](../marketing-library/09-current-campaign/).
Reviewed video titles/descriptions are in
[`marketing-library/COPY.md`](../marketing-library/COPY.md#video-title-and-description).
The October still-image/copy refresh preserves all versioned films below;
it does not re-render them or make their old counts current. Keep each film’s
music attribution and simulated-data notice when posting.


Launch-video tooling and historical cuts filmed from the app's simulated farm.
These tools are separate from the Python-only application.

**The owner's rules from 25 October 2026 (they override older notes below):**

- **16:9 only.** One cut per version, 1920 × 1080. No 9:16 cut any more; the vertical projects of
  earlier versions are kept as history only.
- **Version 2 is set aside.** The owner's "V2" (version 13's 60 s pair and version 15, its update)
  and the marketing videos ChatGPT made are not to be built on or reused (none of the ChatGPT videos
  are in this repository). The "V1" line (version 12, version 14, version 16) is the current one.
- **Show what changed.** Each new version recognises the app's updates since the last one.

**Version 16 (25 October 2026): V1, 60 s, 16:9, with what changed.** In its own folder, `v16/`
(`build/` and the HyperFrames project `main/`), sharing only the filming scripts, footage and
`music/` with earlier versions. Version 14's opening (hook, what it is for, the name, how it works)
and its music (`compose10.py`, 160 BPM, recorded piano, bass and drums), then:

- **Every printer** (2.5 bars), **Needs you** (2), **Confirm Print** (3.5, now the 3DBenchy, all
  checks passing on a sandbox printer), **prepare & slice** (3, the Benchy duplicated, the copy on
  head T1, arranged), **the 3D twin** (4.5: the model, then the drawing, version 15's tighter take).
- **New: the quick tour** (4 bars, on the laptop): the tour's own glass callout glides from Needs
  you to the twin, over to Printers and on to Files (`tour_v16`).
- **New: your phone** (3 bars): Connect your phone opens the sheet with its QR code (`phone_qr`);
  as it is scanned the laptop steps back and the phone comes forward, the dashboard open on it and
  paired (`phone_paired`). Both are filmed under the example address `http://192.168.1.23:8000`
  (`capture/rec.js` `alias`; the end card says it is an example).
- **And plenty more** (screenshots of the real panels, `stills_v16`): the farm desk, mixed layer
  heights, the converter, live telemetry, automations (no longer a feature scene of its own) and
  version & updates. The Orca-style process settings were planned too, but they only appear once a
  slicing engine is installed, which the filming machine does not have.
- **The end card** shows the real install block from the README (Mac and Linux Terminal), pasted in
  one go, with the PowerShell and ZIP routes named under it, in place of `git clone`.
- The how-it-works printers are "Printer 1/2/3" (the app's demo printers are now "Demo printer
  1/2/3"). `capture/shots.js` now uses `3dbenchy_pla.gcode`, `3dbenchy.stl` and
  `hex_coaster_three_colour.gcode` in place of the retired cube, bracket and coaster names.

**Version 13 (October 2026; set aside by the owner on 25 October 2026 as "V2"):** two new 60-second cuts (the owner: "do a
60-second video, in both formats"), retold the way product-launch films explain a feature: the
problem first, the answer, how it works in one breath, then six features, each headline landing on
its own before the app shows it working. New music: a bright lounge-jazz tune at 144 BPM with a
recorded vibraphone carrying its melody. The clicks and keystrokes are version 11's sounds,
unchanged. All 13 shots were re-filmed from the current app with the same filming scripts (the
footage is not committed). Version 12's 75-second cuts stay in `marketing-library/07-videos/`
beside the new ones. Figures shown: up to 12 printers, 29 modules, ten games, 759 automated tests
(counted on 22 October 2026), each checked against the code. No slice is shown on film: slicing
needs a separately installed engine, which the filming machine does not have. Engine evidence is
in [workspace validation](../docs/slicer-workspace-validation.md).

**Version 14 (23 October 2026): the owner's "V1" at 60 seconds.** The owner calls version 12's
75-second pair "V1" and version 13's 60-second pair "V2". They asked for V1, in both shapes, cut to
60 s, showing the new digital twin (both the realistic 3D model and the drawing made from it) and
the new live background (shown, never captioned), keeping V1's music and the way it plays along
with every click and keystroke, and leaving V2 untouched. Version 14 is that cut. It lives in its
own folder, `v14/` (`build/`, `main/`, `vertical/`), so version 13's `build/`, `main/` and
`vertical/` and its finished files are unchanged; the two share only the filming scripts, the
footage and `music/` (whose `mix.py` now reads `DEJAVU_MUSIC_LEVEL`, unset for version 13).

- **Music:** version 12's (`compose10.py`: the 160 BPM jazz trio on recorded piano, bass and
  drums, written from the timeline's own cues), at version 12's level (.72). 60 s is exactly 40
  bars, so every scene change still lands on a bar line with its fill, crash and chord, and every
  click and keystroke still gets its dip in the music. Bars 0-6 (hook, purpose, name) are note for
  note version 12's.
- **The story, bar by bar:** hook 0-2, what it is for 2-4.5, the name 4.5-6, how it works 6-9.5
  (a bar per step), then every printer live 9.5-12, Needs you 12-14.5, Confirm Print 14.5-19.5 (the
  phone on beat 3 of bar 18), prepare & slice 19.5-23, **the digital twin 23-29** (3.5 bars of the
  3D model, then 2.5 of the drawing; version 12 gave the whole twin 3.5), automations 29-32, "and
  plenty more" 32-34 (one card per eighth note), why trust it 34-36, the end card 36-40.
- **Cut to fit:** "Files ready for the U1" became the first "and plenty more" card (in the games'
  place); "Get started" folded into the end card ("Or download it and double-click start", as
  version 13); how-it-works sentences were shortened to fit a bar each (Python 3.8 moved to the
  end card's fine print); Live fleet has one callout, "Progress and finish time".
- **The twin** (`twin3d` shot, one continuous take): the cursor comes in over the dots, flicks the
  3D model past the front (it glides to a stop on the side with the door, touchscreen and spools),
  clicks head T0 (it turns blue and its live details open). On the bar the caption gives way and
  the same model, in the same view, becomes the engineering drawing ("Show the case" is switched on
  before filming so the drawing shows the whole printer, as the model does), then its Front view.
  The drawing's caption says what is estimated: "≈ estimated · outside 584 × 499 × 730 mm, per
  Snapmaker", and a callout points at the drawing's "≈390 mm".
- **The background, shown not told:** the fleet shot (`fleet_bg`) opens with the cursor drifting
  through the empty page margin (the dots part, swirl and light up) and a click on an empty spot
  (a ripple), playing on the laptop while how it works is told; the twin shot enters over the dots.
  The film's own scenery is now the app's Dots field in its default Glacier colours (`v14/build/
  shared.css`), and the app's ripple of lit dots runs out from the film's key moments on the
  music's hits (the alert, the name, the laptop landing, each device scene, "and plenty more", the
  values, the end card).
- **Figures re-checked against the code on 23 October 2026:** up to 12 printers, 29 modules, four
  updates a second, ntfy/Discord/Telegram, MakerWorld/NexPrint conversion, Python 3.8, MIT, and
  771 automated tests (a full run passed, 771 tests in 153.9 s, Python 3.12, this machine).
- **Staged before filming, as an owner would:** the four heads' colours (Prepare, as version 12)
  and, new, three spools in the filament inventory (`filament_v14`), because the inventory now
  starts empty. Everything else is the built-in simulated farm.

**Version 15 (23 October 2026): the owner's "V2" updated the same way.** The owner then asked for
V2 (version 13's 60-second pair) to be edited the same way. Version 15 is that cut, in its own
folder, `v15/` (copied from `build/`, `main/`, `vertical/`, which stay as version 13 made them):

- **Music:** version 13's (`compose11.py`, the 144 BPM lounge-jazz tune with the vibraphone), at
  version 13's level, re-written from the new timeline's cues. The opening (the problem, bars 0-4,
  whose music is written to fixed bars), the answer and how it works are unchanged.
- **Retimed in bars of 1.667 s:** Live fleet 2.5 (was 3), Needs you 2.5, Confirm Print 5, prepare
  & slice 3 (was 3.5), **the digital twin 4.5 (was 3: 7.5 s)**, automations 3.5, "and plenty more"
  1.5 (was 2), why trust it 1.5, the end card 3.5. Version 13's headline move is kept: each
  feature's headline lands big over a veil, then glides aside as the app plays.
- **The twin** (`twin3d_tight`, a tighter take of the same story as `twin3d`): in over the dots, the
  flick and glide (the release lands as the headline settles), head T0's live details, then on the
  bar the drawing ("Drawn from the same model"; T0 stays blue in it). No Front view: at 7.5 s the
  drawing is held instead; the caption carries the estimate note, as version 14's.
- **The same background, fixes and checks as version 14:** `fleet_bg` on the laptop during how it
  works, the dot-field scenery with ripples on the music's hits, the two-row jam callout, 771
  automated tests, the spools still and the end card's note, and "Files ready for the U1" in the
  games' place in "and plenty more" (version 13 had left it out because its still rendered black).

**Done in version 14 (the owner's note of 23 October 2026, kept for reference): show the new
background and the new 3D twin.** The time drawn in dots was left out: under the filming clock it
would draw an arbitrary time, and the owner asked for the background's reaction to the cursor. The
app's background is now live (`frontend/backdrop.js`): Dots by default, parting,
swirling and lighting up around the cursor, with hidden surprises. When the videos are next made:

- Film with the default Dots background and keep the cursor moving through the empty parts of the
  page, so the dots visibly react. Include at least one click on an empty part of the page (a
  ripple) and, once, the time drawn in dots. The clock surprises follow the real clock, so under
  the filming scripts' fake clock trigger them from the page: `Backdrop.showText('3:00', 5)`,
  `Backdrop.ripple(x, y, 1.5)`, `Backdrop.bloom(x, y)`, `Backdrop.celebrate(['#ff7a00'])`.
- The video's own scenery should match the app: `build/shared.css` still draws the old layer-line
  background behind captions; move it to the same dot field so app and film look like one product.
- Show the Overview's digital twin as the new 3D model (`frontend/twin3d.js`): the angled view,
  one drag that glides to a stop, and a click on a toolhead opening its details; then one beat of
  the Drawing mode, which is made from the same model.
- Captions should say what is estimated (the body's own size and inside layout) the same way the
  card does; the outside figures (584 x 499 x 730 mm) are Snapmaker's.

| Folder | What it holds |
|---|---|
| `capture/` | The filming scripts. `rec.js` drives Chromium frame by frame at 60 fps (Playwright's fake clock plus every CSS animation stepped to the same time), draws a cursor, and logs each click and named moment. `shots.js` stages each shot on a freshly started server. |
| `footage/` | The filmed shots (H.264, 1440 × 900, 60 fps; the phone shot is 390 × 844) and, beside each, a `.json` of its clicks and markers. Not committed. |
| `music/` | `compose11.py`, the music (version 13): a new tune, bright lounge jazz at 144 BPM, a vibraphone melody (VCSL vibraphone, CC0) over piano comping, walking bass, ride and hi-hat, written from the timeline's own cue list. It plays the recorded piano, bass and drums of `compose10.py` (version 11): the arrangement in `compose9.py` (a bright, up-tempo jazz trio at 160 BPM in a major key that plays along with the picture, from the cues the timeline records), played on **recorded acoustic instruments**: Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0), the VSCO 2 Community Edition solo contrabass pizzicato (CC0) and Virtuosity Drums (CC0). `fetch_samples.sh` downloads them (and, since version 13, the VCSL vibraphone and a shaker, CC0) into `music/samples/` (about 1 GB, measured, git-ignored). `sfx.py` makes the mouse clicks and keystrokes, `mix.py` keeps the music under them and mixes the soundtrack. `compose.py` to `compose9.py` are earlier versions' music (all synthesised in code). |
| `build/` | `scene.html` and `scene.js` (the one template and timeline both cuts share), `main.layout.css` and `vertical.layout.css` (where things sit in each shape), shared CSS (tokens and the liquid-glass system), `build.py`, which places the footage on the timeline from the recorded markers, puts a click on every filmed click and a keystroke on every key press and typed character, and mixes the soundtrack, `finish.py` (sets the loudness and puts the sound on the rendered picture) and `stills.sh` (exports the marketing feature cards from the renders). |
| `main/`, `vertical/` | The [HyperFrames](https://github.com/heygen-com/hyperframes) projects: 16:9 (1920 × 1080) and 9:16 (1080 × 1920), both 60 s (version 13; 75 s up to version 12). `index.html` is generated by `build.py`. |
| `v1/` | The first version's compositions, for reference. |
| `v14/` | Version 14, the owner's "V1" (version 12) re-cut to 60 s: its own `build/` (template, timeline, layouts, `build.py`, `stills.sh`) and HyperFrames projects `main/` and `vertical/`. Built with `python3 v14/build/build.py main` (or `vertical`); renders go to `v14/renders/`. |
| `v15/` | Version 15 (set aside with V2), the owner's "V2" (version 13) updated the same way: its own `build/` and HyperFrames projects; `python3 v15/build/build.py main` (or `vertical`), renders in `v15/renders/`, cards by `v15/build/stills.sh`. |
| `v16/` | Version 16, V1 at 60 s in 16:9 only, with what changed in the app: its own `build/` and HyperFrames project `main/`. Built with `python3 v16/build/build.py`; renders in `v16/renders/`. |

Existing on-screen figures came from the simulated farm or the README at filming
time. Historical test counts are not current. Keep simulated readings, engine
predictions and physical measurements distinct; retain the Snapmaker disclaimer.

## Rebuilding

HyperFrames ships its own agent skills (camera moves, animation rules, launch-film
conventions): `npx hyperframes@0.8.166 skills update hyperframes-animation hyperframes-creative`
installs them (with `hyperframes-keyframes` and `hyperframes-studio`, used for version 10).

Needs Node 22+, FFmpeg, Playwright's Chromium, Python 3 with numpy, scipy and soundfile.
These are media-production dependencies, not app dependencies. Rebuilding this
pipeline was not part of the latest app validation.

```bash
# 0. once per container: the Python packages and the recorded instruments (about 900 MB)
pip install scipy soundfile && bash promo-video/music/fetch_samples.sh
# 1. film (each shot restarts the app on port 8791; APP_PORT picks another port)
cd promo-video/capture
NODE_PATH=/opt/node22/lib/node_modules node shots.js            # all shots
NODE_PATH=/opt/node22/lib/node_modules node shots.js fleet      # or just one

# 2. build (footage placement, markers; composes the music if it is missing or
#    older than compose9.py, renders the sound effects, mixes the soundtrack)
cd ..
python3 build/build.py main && python3 build/build.py vertical
cd main && npx hyperframes@0.8.166 render --fps 60 --quality delivery --video-frame-format png --output ../renders/main.mp4
cd ../vertical && npx hyperframes@0.8.166 render --fps 60 --quality delivery --video-frame-format png --output ../renders/vertical.mp4

# 3. finish (-16 LUFS through a limiter, sound muxed onto the untouched picture),
#    then the feature cards from the renders
cd .. && python3 build/finish.py main renders/main.mp4 renders/deja-vu1-launch-60s-16x9.mp4
python3 build/finish.py vertical renders/vertical.mp4 renders/deja-vu1-launch-60s-9x16.mp4
bash build/stills.sh
```

Version 14 (V1 at 60 s) films `fleet_bg overview_jam confirm_ok phone prepare twin3d automations
care filament_v14 skip_object ha convert`, then:

```bash
python3 v14/build/build.py main && python3 v14/build/build.py vertical
cd v14/main && npx hyperframes@0.8.166 render --fps 60 --quality delivery --video-frame-format png --output ../renders/main.mp4
cd ../vertical && npx hyperframes@0.8.166 render --fps 60 --quality delivery --video-frame-format png --output ../renders/vertical.mp4
cd ../.. && python3 v14/build/finish.py main v14/renders/main.mp4 v14/renders/deja-vu1-launch-v1-60s-16x9.mp4
python3 v14/build/finish.py vertical v14/renders/vertical.mp4 v14/renders/deja-vu1-launch-v1-60s-9x16.mp4
bash v14/build/stills.sh
```

Version 16 (16:9 only) films `fleet_bg overview_jam confirm_ok prepare twin3d_tight tour_v16
phone_qr phone_paired stills_v16`, then:

```bash
python3 v16/build/build.py
cd v16/main && npx hyperframes@0.8.166 render --fps 60 --quality delivery --video-frame-format png --output ../renders/main.mp4
cd ../.. && python3 v16/build/finish.py main v16/renders/main.mp4 v16/renders/deja-vu1-launch-v16-60s-16x9.mp4
```

To try a shot quickly, film it at a low frame rate somewhere else first:
`FILM_FPS=8 FOOTAGE_DIR=/tmp/test APP_PORT=8793 node shots.js care` (about 15 s a shot).

Since version 6, `shots.js` gives each shot a temporary `DEJAVU_DATA_DIR`; filming
does not need the owner's live data. Keep app/demo servers stopped during the
full Python test suite and run filming separately.

Fonts are the app's own (SIL Open Font License, licence files in `fonts/`).
GSAP 3.14.2 is bundled in `vendor/` under GreenSock's standard licence.

## How it works (read before changing anything)

**Filming (`capture/`).** On this machine (4 CPUs, no GPU) Chromium draws the app at
about 6 frames a second, because its Liquid Glass filters are expensive in software, so
real-time recording is unusable. `rec.js` films frame by frame instead:
- `page.clock.install()` then `pauseAt()`: the page's JavaScript time (timers,
  `requestAnimationFrame`, `Date`, `performance.now`) only moves when `frame()` calls
  `clock.runFor(1000 / fps)`.
- CSS transitions and animations do not follow that clock, so after every step `SYNC`
  pauses every `document.getAnimations()` entry and sets its `currentTime` to the
  virtual time (calling `finish()` once it passes its end, so `finished` promises still
  resolve).
- Each frame is a CDP `Page.captureScreenshot` JPEG (quality 93); `stop()` encodes them
  with ffmpeg (`libx264 -crf 12`, yuv420p) and writes `<shot>.json` with the click times
  and named marks (`r.mark(st, 'jam')`) in footage seconds.
- Cost: about 0.5 to 1 s of real time per frame (the 27-printer fleet and the WebGL
  viewer are the slowest). A 5 s shot at 60 fps takes 2 to 6 minutes.
- Server pushes (the 250 ms WebSocket feed) still arrive in real time, so slow-moving
  state like print progress ticks faster than real; nothing in the shots depends on it.
- A cursor (arrow, or a fingertip circle on the phone) is drawn into the page as two
  `popover` elements, re-raised above any `<dialog>` that opens (dialogs sit in the top
  layer). The "Continue from your Computer" banner is hidden with CSS during filming:
  it appears because every filming browser counts as another device.
- `shots.js` restarts the app (`python3 backend/app.py` on `APP_PORT`, default 8791)
  before every shot, so each starts from the same simulated farm. Since version 6 each shot
  also gets its own empty data folder (`DEJAVU_DATA_DIR` in the system's temp folder), so a
  spool, a module switched on or a task marked done never carries into the next shot or into
  `backend/data/`. Two batches can run in parallel on different ports.

**Building (`build/`).** `build.py <main|vertical>` reads every `footage/*.json`, then:
- pads each clip with 4 s of held first frame and 4 s of held last frame (ffmpeg
  `tpad`), so a window never shows a blank before or after its footage;
- places each `<video>` from the plan in `plan_main` / `plan_vertical`. Each entry is
  `(video id, shot, composition time of footage t=0, visible from, visible to)`, e.g.
  `12.4 - m('overview_jam', 'jam')` puts the jam on 12.4 s. One shot can appear under
  several ids (version 7's digital twin plays the twin shot twice: the 3D part, then front and top);
- inlines the markers as `const M`, keyed by video id, so the animation can use
  `at('v-sk', 'pick')`, and the end-card typing times as `const TY`;
- writes `sfx_<fmt>.json`: a click on every filmed click that is on screen, a keystroke
  on every logged key press (`r.key()` in `rec.js`) and every typed end-card character,
  only while that shot is actually on screen (no whooshes since version 7);
- reads back the moments the timeline put on the music's grid (`build/cues.js`, a headless browser), writes `build/music_<fmt>.json`, runs `compose11.py` with it (version 13; `compose10.py` before), `sfx.py`, then `mix.py`, which dips the music about 9 dB
  under each click and 6 dB under each keystroke, takes out most of the music's 2-6 kHz
  band at those moments, and writes `assets/audio/mix_<fmt>.wav`,
  the composition's only audio track.
`scene.html` is the page and `scene.js` the GSAP timeline, shared by both cuts (the steps,
their texts and line drawings, the callout points, the camera moves); `build.py` drops in
`main.layout.css` or `vertical.layout.css`. (Version 4 and earlier had one template per cut,
`main.tpl.html` / `vertical.tpl.html`; they are in git history.) `shared.css` holds the tokens, fonts, the layer-line background and the
liquid-glass system (`.glass`, `.win`, `.cap`, `.spot`, `.simchip`).

**The look (version 8: a 75-second SaaS promo that moves fast but reads easily).** The app
plays either on a device or full screen, about half and half (the owner: devices "maybe half",
not every scene). Device shots (`shot: 'D'` in `scene.js`) stand a real 3D laptop beside a
floating liquid-glass caption. Version 8 rebuilt the laptop to a real laptop's proportions
(the owner: "the angles the computer is at and the way the computer model looks is weird"):
lid and keyboard deck the same width (version 7's lid was narrower than its deck), the deck
about as deep as the lid is tall, a thin black glass bezel with an aluminium edge, a lid with
thickness, a dark hinge, a six-row keyboard near the hinge, a wide trackpad, a soft shadow
under it on the "table". The lid opens back to about 108 degrees, the way a laptop sits on a
desk (version 7 had a sign error that tipped the lid forward to 78 degrees, so it looked
half-closed), and the laptop turns only 15 degrees towards the caption, seen 10 degrees from
above. Full-screen shots (`shot: 'F'`) dolly the camera into the laptop's screen until it fills
the frame; the caption then floats over the app on the side where the app has least to show,
and the camera inside the screen frames each detail in the part the caption leaves clear
(`SAFE`). The camera moves the laptop with `z` (a dolly through the stage's perspective), not
with scale, so depth stays true. Callouts (a dot, a stem, a dark label) live inside the
screen's camera and keep one size on screen whatever the zoom or dolly; version 8 shows one or
two per feature, never more, and keeps each caption to a headline and a few words, so the eye
goes straight to what matters. A "Simulated farm" chip stays top right whenever the app is on
screen; the small logo top left shows over device shots only. Identity: the app's own "Layer
lines" look (`frontend/theme.css`), Bricolage Grotesque, Instrument Sans, IBM Plex Mono, the
app icon, and line icons drawn for the features (`IC` in `scene.js`). One liquid-glass
material for everything that floats (captions, icon tiles, chips, the Home Assistant card):
blur + saturation, SVG `feDisplacementMap` edge lensing, a 1 px rim lit from the top left, a
contact + ambient shadow, and a specular glint (`--sx`) that drifts.

**The story (version 13, 60 s, both cuts).** The owner asked for the shape of a product-launch
film: explain the problem and why the app exists, then show the features clearly, smoothly and
appealingly. Laid out in bars of the 144 BPM music (a bar is 1.667 s, so 36 bars are exactly
60 s; `ORDER`, `NAME`, `HIW`, `MORE`, `VALUES`, `END` in `build.py`):

| Bars | Seconds | Beat |
|---|---|---|
| 0-4 | 0-6.7 | The problem, in three plain lines: "Every printer has its own screen." (six separate printer windows appear, one per eighth note), "So you check them one by one." (a ring visits four of them on the beat), "And miss the one that needs you." (the sixth, never reached, flags a problem). An illustration: no figures, generic names, never presented as app footage. |
| 4-6 | 6.7-10 | The answer: every window folds into the app's icon. "Deja Vu1. One screen for every U1 you run. Free and open source, for Snapmaker U1 3D printers." |
| 6-8.5 | 10-14.2 | How it works, in one breath: the laptop lands showing the real app; three chips: runs on your computer, talks to your U1s on your network (three printers join it, a pulse on each wire every quarter of a second, the app's four updates a second), opens in any browser (the phone joins). |
| 8.5-29 | 14.2-48.3 | Six features: every printer live (3 bars), Needs you (2.5), Confirm Print then the phone (5), prepare & slice (3.5), the digital twin (3), automations (3.5). |
| 29-31 | 48.3-51.7 | "And plenty more": maintenance, filament and Spoolman, skip one object, Home Assistant, ten games, 29 modules, as stills from the same filmed shots. |
| 31-32.5 | 51.7-54.2 | Why trust it: free and open source, no account needed, runs on your own network, 759 automated tests. |
| 32.5-36 | 54.2-60 | The end card: "Get it free on GitHub.", the three install lines typed, "or download it and double-click start", the notes. |

**The signature move (version 13).** Each feature's headline first lands on its own, large, in
the middle of the frame over a soft veil (the "why"), holds for about a second while the music
plays the head of its tune, then glides to its caption's place as the veil lifts and the app
shows the feature working (the "how"). It is one element throughout, so the words never leave
the screen. Each shot is placed so its key moment comes 1.9 s into its feature (`LAND`), just
after the caption settles; one callout per feature (two for Confirm Print). "Files ready for the
U1" was left out: at 60 s each of the six needed its time, and its still shows the workspace's 3D
viewer, which renders black on this machine (no GPU).

**Version 10's story (75 s), kept for reference.** Laid out in bars of the 160 BPM music (a bar is 1.5 s):

| Bars | Seconds | Beat |
|---|---|---|
| 0-2 | 0-3 | The hook: "One printer is easy. A shelf of them isn't." A shelf of printer tiles fills up and one flags a problem. |
| 2-4.5 | 3-6.75 | What it is for: "For Snapmaker U1 3D printers", "Run your 3D printers from one screen.", three promises. |
| 4.5-6 | 6.75-9 | The name. |
| 6-10.5 | 9-15.75 | How it works: the laptop lands showing the real app; 1 runs on your computer, 2 talks to your U1s on your network, 3 open it in any browser (the phone joins). |
| 10.5-35.5 | 15.75-53.25 | Seven features: every printer live, Needs you, Confirm Print (then the phone), files for the U1, prepare & slice (version 12), the digital twin, automations. |
| 35.5-39.5 | 53.25-59.25 | "And plenty more", one per beat. |
| 39.5-41.5 | 59.25-62.25 | Why trust it. |
| 41.5-46 | 62.25-69 | Get started: download it free, double-click start, it opens in your browser. |
| 46-50 | 69-75 | The end card. |

**Sound and picture, together** (version 9's idea, version 13's tune). `scene.js` puts every
moment something appears on the music's grid (the nearest eighth note) and records it in `CUES`;
`build.py` reads them back from the built page (`build/cues.js`) and `music/compose11.py` plays
along. The problem is quiet and a little unsettled (piano and vibes alone, a rising vibes note on
each window, one on each window the ring checks, the bass walking in on the second line, a bass
pedal and a dark vibes chord on the alert); a drum fill, a crash and the band's chord on the name,
where the vibes state the tune in full; a piano chord on each how-it-works chip and a rising vibes
note on each printer and the phone; on every feature change a short fill, a crash, a kick and the
band's chord, then the head of the tune (or its answer) under the headline while it holds the
frame; a soft high vibes note on every callout; a piano run as the phone slides in; the ride's bell
as the twin changes view; a vibes note per "plenty more" card; a band hit on each value; ii-V-I
and the tune once more, quietly, under the end card, the last chord ringing to the final frame.
Measured on the build: the band's hit lands within 25 ms of each feature change.

**Motion vocabulary** (version 10):
- *the camera inside the screen*: an outer layer scales about the screen's centre, an inner
  one moves the page, both on one ease, so the detail being framed travels in a straight line
  while the zoom grows (HyperFrames' coordinate-target-zoom rule; version 9 moved and scaled one
  layer, so mid-zoom the detail swung along a curve). The zoom never goes past 1.9 times the
  page's own size, so the app keeps its proportions.
- *between features*: the caption fades, the laptop turns, dollies in or steps back in 0.85 s
  (`power3.inOut`), centred on the bar line, while the next screen fades in on top; full screen
  to full screen, the laptop holds still (version 9's quick step back and in read as a bump).
- *within a feature*: the laptop keeps drifting a little closer, so the frame is never still.
- *text*: words, cards and steps arrive on beats of the music (`expo.out`, half a second).
- *safe areas*: captions, steps and cards stay inside the title-safe box (80% of the frame).

## Lessons learned (each cost a re-render or a re-shoot)

- (v15) Version 14's first render kept "Ready-made rules" up until 0.6 s before the Save click,
  but the filmed scroll to Save starts 1.07 s before it, so for half a second the label pointed at
  blank space. Both cuts now take it down 1.3 s before the click; check every callout against the
  filmed scrolls, not only the clicks.
- (v15) Version 13's opening has music written to fixed bars (`compose11.py`), so time for the
  twin came from the features and "and plenty more", never from the opening.

- (v14) The twin's head labels are rebuilt whenever the live state moves anything. Under the
  filming clock several state updates arrive inside one filmed frame, so a press and a release a
  frame apart hit two different label elements and no click fires (the first take's details never
  opened). `twin3d` aims at the label where it is now and presses and releases in the same instant.
  In real time that is about four rebuilds a second, so a click on a label can occasionally be
  lost in the app too while a print runs (not changed here; worth a look).
- (v14) The twin's glide runs per screen frame (`requestAnimationFrame`): at a low test frame rate
  it lasts several times longer, so judge the drag and the glide only on 60 fps footage.
- (v14) Starting two filming batches at once on a just-restarted machine failed both with "Cannot
  fast-forward to the past": the page took longer than the 1.5 s `rec.open()` allows before
  `pauseAt`. Run them one after the other, or start the second a minute later.
- (v14) The filament inventory now starts empty, so a still of it says "No spools tracked";
  `filament_v14` enters three spools first and the end card says spools were entered for the film.
- (v14) A jam now shows as two Needs-you rows (the dock error it causes, then the jam): version
  12's spotlight sat on the wrong row. Re-measure every callout on new footage.
- (v14) With Confirm Print followed by a full-screen feature, the laptop stayed in the phone's
  stepped-back pose: a change out of the phone now always moves the laptop, even full to full.
- (v14) The workspace's 3D viewer now renders on this machine (frame 1 of `convert` shows the part),
  so "Files ready for the U1" could become a "plenty more" card again.
- (v14) Measured on the mix: clicks a median 5.5 dB and keystrokes 4.6 dB above the music (60 ms
  RMS); the six keystrokes typed under the final chord and crash (55.5 s) sit under it, exactly as
  in version 12, whose typing and final chord have the same offsets. Not checked by ear.

- (v13) The owner: a new 60-second version in both shapes, told like a product-launch film (the
  problem and why the app exists, then the features, clearly and smoothly), the same keystrokes,
  exciting "elevator" jazz. Anthropic's own launch-film conventions are still not documented
  anywhere searchable (searched again for this version), so the structure follows the owner's
  description, not a copied style. Checked instead against published 60-second launch-video
  guides (flowjam.com's one-minute launch video, typecast.ai's 60-second demo template, fliki.ai's
  Product Hunt guide; search snippets, October 2026): hook and problem in the first 5-15 s, the
  demo from about 15 to 45 s, proof at 45-55 s, one call to action at the end, on-screen text for
  viewers watching without sound. Version 13 lands on that: problem 0-7 s, answer and how it works
  7-14 s, features 14-48 s, trust 52-54 s, the GitHub address 54-60 s, every line on screen.
- (v13) Tempo: stock listings put relaxed lounge/elevator jazz at about 60-100 BPM and upbeat
  vibraphone tracks at about 110-145 BPM (one grooving-vibraphone listing at 145). The owner
  asked for "exciting" and liked 160 BPM in version 9, so 144 sits at the upbeat end of lounge.
- (v13) A tune makes music "interesting to listen to"; a trio that only hits chords on cues does
  not. The vibraphone is the sound people know from lounge and elevator jazz. No CC0 vibraphone is
  in VSCO 2 CE; VCSL (same author, CC0) has soft and hard mallets. Like VSCO's bass, VCSL names its
  vibes files an octave low (measured: "A2" is 220 Hz).
- (v13) With the vibraphone ringing under them, clicks and keystrokes measured 7.8 and 0.8 dB
  above the music (K-weighted, 60 ms), against version 7's 10 and 4 dB. `mix.py`'s music level went
  from .72 to .6 and the end-card typing from .5 to .75: now 9.3 and 5.9 dB.
- (v13) The 3D viewer renders black under software rendering, so a still of the slicing workspace
  just after conversion is mostly black; check every still at full size before using it.
- (v13) At 60 s the phone took over Confirm Print before the filmed Start click (the shot waits
  2.3 s on the dialog), so its second callout never showed. Confirm Print now plays as two parts of
  one shot (`v-ok`, `v-ok2`, like the twin), cut at `OK_CUT` where the dialog and cursor sit still:
  the two frames measured pixel-identical. Check every callout's in and out times after any retiming.
- (v13) `pkill -f` from a shell whose command line names the target killed the shell (the
  pitfall CLAUDE.md warns about); stop a render by PID.
- (v13) A caption's centre-of-frame start is measured with `getBoundingClientRect()` when the
  timeline is built, before any transform, so layout CSS must place the caption before `scene.js` runs.

- (v12) The owner: reflect the app's updates, keep the music, the keystrokes and the length.
  Every feature change stays on the same bar, so 56 of the 60 music cues are identical; only
  four soft callout notes moved with their callouts.
- (v12) A first-run setup guide (`#setup-dialog`) now opens over the app and blocked every
  click; `rec.open()` presses `#setup-skip` before filming.
- (v12) The page keeps its own list of modules that are on: switch a module on through the
  page's `postJSON` (as the Settings tab does), not a bare `fetch`, or the page still answers
  "Module disabled" for its routes. Head colours in the workspace come from saved tool
  choices (`/api/tools/assignments`) and need "Show original source colours" off.
- (v12) Opening a 3MF or STL now lands in the slicing workspace; the converter button lives
  in its collapsed "Source & import information" section.
- (v12) Callouts in 9:16 sit in a narrow crop of the screen: point at the middle of the
  thing, not at a control on the page's right edge (`PP` in `scene.js`).

- (v11) The owner on version 10: "find a music that doesn't sound electronic". Eleven versions
  of synthesised instruments (additive piano, plucked-string bass, modal cymbals) all read as
  electronic, however they were modelled. The fix was recordings: free sample libraries on
  GitHub (the stock-music sites are blocked from the sandbox; GitHub is not), each licence read
  in its repository before use. The arrangement and its sync to the picture stayed exactly as
  they were; only the instruments changed. Measured after the swap: piano, bass 3.3 dB under,
  drums 8.3 dB under (a jazz trio's usual balance); the cymbal crash within 4 ms of every scene
  change once each recording's 7-24 ms of lead-in was trimmed; the music set so clicks sit
  3.6 dB under it as before; the end-card typing 6 dB lower because a real piano's last chord
  fades sooner than the synthesised one did.
- (v11) Salamander Grand Piano is CC BY 3.0: it must be credited. The end card's fine print,
  this guide and `marketing-library/README.md` name it; keep the credit in any post's
  description too.
- (v11) The VSCO 2 contrabass files are named an octave low (`E0` is E1, 41.2 Hz, measured);
  `compose10.py` adds the octave.

- (v10) The owner's notes on version 9: it was still a list of features and the middle and end
  felt slow; show what the app is, how it works and where to get it; the zooms looked
  unnatural; fix the proportions. So: seven features instead of twelve (the rest in one quick
  "and plenty more" grid), a hook, how it works and get started as their own beats, a
  straight-line zoom capped at 1.9x, captions inside the title-safe box, a smaller phone.
- (v10) The filmed shots are 1440 x 900 (this guide said 2880 x 1800, and the phone 390 x 844,
  not 1170 x 2532): measure with ffprobe before cropping stills.
- (v10) Two `const cx` in one function stop the whole page script; `build/cues.js` now prints
  page errors, so a broken timeline fails the build with the reason.

- (v9) The owner's notes on version 8: music more positive, not electronic, and faster; the
  sound should match the visuals; the first scene should say what the app is for. So a major
  key, 160 BPM, acoustic trio with sticks on the ride, and the music written from the
  timeline's own cue list rather than in parallel with it. The opening says who it is for and
  what it does before it says the name.
- (v9) Removing a CSS block removes every rule in it: deleting version 8's icon-grid styles also
  removed the `.ico` stroke rules the caption icons use, and every icon drew as a black blob.
  Check a caption frame after any CSS cut.
- (v9) `hyperframes snapshot --at` with a single time returned an end-card frame; pass at least
  two times.

- (v8) The owner's notes on version 7: 75 s for the marketing cuts; it still felt like "a stiff
  feature video that you would give to investors"; make it look fast but stay easy for someone
  new (and for judges) to follow, with a little less information so the eye goes to what
  matters; faster jazz in the same genre; the laptop's angles and model looked weird; the
  keystroke and click sounds are "so much better now" (keep them as they are); leave the
  Photo-to-Print Studio out (too rough) and show automations in its place.
- (v8) Why the laptop looked weird: the lid's `rotationX` was negative, which in CSS tips the
  top of the lid towards the viewer, so with the rig seen from above the lid sat at 78 degrees
  to the deck (half-closed), and the lid was 1272 px wide on a 1480 px deck. A positive lid
  angle opens it back; lid and deck now share one width.
- (v8) Speed comes from rhythm, not from cramming: every feature change on a bar line of the
  music, quicker moves (0.85 s instead of 1.15 s), captions in half a second, and fewer words
  and callouts on screen. Each callout still stays up at least about a second.

- (v7) The owner's preferences so far, for the next version: at most 90 s; fast but clear
  enough for anyone; a SaaS promo, not a presentation (no step numbers, no progress bar);
  devices in about half the scenes, not all; smooth transitions; the app working at its
  best; very chill, light jazz elevator music in the background (it disliked trap, rock,
  electronic and the busier bossa); natural-sounding clicks and keystrokes; clean framing.
  Apply each note with judgement, where it fits, and re-check every earlier note.
- (v7) The owner's notes on version 6: back to 90 s (120 s was over the limit), move faster
  but stay clear; "chill, very chill jazz elevator music, nothing too special"; the clicks
  and keystrokes "sounded weird and annoying"; smoother laptop animations with better depth;
  devices in about half the scenes; smooth transitions.
- (v7) Why the clicks grated: version 6 built them from ringing sine tones (1-4 kHz, 6-16 ms),
  which sound like little electronic pings. Version 7's click and keystroke are only short
  filtered noise bursts (a snap and a soft body, then a lighter release), each a little
  different, with nothing tonal in them; the end card is typed at about ten keys a second
  instead of twenty-five. Measured with the loudness meters' K-weighting, in the mix: clicks a
  median 10 dB and keystrokes 4 dB above the music in the same 60 ms; in the finished file
  (after `finish.py`'s limiter) clicks 8.7 dB and keystrokes 5.8 dB: clearly there, not loud.
- (v7) With the keyboard deck in the same 3D scene, Chrome clipped part of the screen once the
  camera was pushed all the way in (only in 9:16, where the screen is wider than the frame).
  The deck now fades out on the way into a full-screen shot and back on the way out.
- (v7) In full screen with a side caption, content at the page's left edge could not move out
  from under the caption because the camera was clamped to the page; it may now slide the
  page sideways by up to the caption's width (only in 16:9).

- (v6) The owner's notes on version 5: the music was still too electronic (it wanted elevator
  music); show every feature as icons in under 3 s up front; drop the "1/7" labels and the
  bottom time bar, bring back the laptop and phone ("a SaaS promo, not a video for
  investors"); the click sounds were inaudible; give the "more" features full segments with
  visuals; show the twin's 3D view longer.
- (v6) Why the clicks were inaudible: version 5's clicks were 2 to 7 ms ticks. They measured
  22 dB over the music *in the 2-6 kHz band*, but a sound that short is heard as much quieter
  than its peak, and the band says nothing about the whole: with version 5's mix levels even
  version 6's longer click stood only about 4 dB above the music over the whole band
  (measured here; version 5's own mix was not re-measured). Version 6's click rings for
  about 15 ms (a press and, 75 ms later, a release), the keystroke has a 450 Hz / 1.6 kHz "thock", `sfx.py` no longer scales everything to its
  loudest sound, and `mix.py` keeps the music lower (0.5 instead of 0.78). Measured on the
  stems (`mix.py ... STEM_PREFIX`), over the whole band, in the same 60 ms: clicks a median
  16 dB and keystrokes 14 dB above the music in the mix; after mastering (the limiter in
  `finish.py` shaves the click peaks) clicks a median 11.6 dB (29 of 30 at least 9.8 dB) and
  keystrokes 11.1 dB above it. Version 6 also has more of them: 30 clicks (13 in version 5),
  31 typed keystrokes for the Home Assistant address and 5 Space presses in Sky Dash, plus
  the end card's typing.
- (v6) A -14 LUFS master of a mix this dynamic would clip (it measured -18 LUFS with peaks at
  -0.9 dBFS), so `finish.py` raises it through a limiter instead of a plain volume change. A
  limiter at -1 dBFS still gave +0.6 dBFS true peak after AAC encoding; at -2.5 dBFS it
  measures -14.0 LUFS and -1.1 dBFS true peak.
- (v6) "Acoustic" instruments without samples: plucked strings (Karplus-Strong, run through
  `scipy.signal.lfilter` with the delay line as the filter, so it is fast), a vibraphone from
  its 1 : 4 : 10 partials and motor tremolo, a breathy sine flute, brushes from shaped noise.
- (v6) Things the simulated farm can't show (time-lapse needs a camera, AR a phone with WebXR)
  are drawn and labelled "Illustration", never faked as app footage.
- (v6) Snapshots of a frame-stepped 3D laptop are cheap to check: a contact sheet of 15
  moments per cut caught a blank laptop screen (a video's window ended too early) and two
  callouts colliding before the render.

- (v5) The owner's notes on version 4: still too fast and hard to follow; make both cuts
  75 s, drop one or two features, order them best to "cherry on top", explain each with
  text and illustrations like a product tutorial; music: calm but quick, funky, bass-led,
  elevator-ish, less "AI". Version 5 films every action slowly (0.62 s cursor moves, a
  0.26 s pause before each click, holds of 1 to 2 s), gives each step 7 to 9 s, and adds
  the drawings and callouts.
- (v5) A callout's label must not sit on the very text it points at, nor run past the
  window edge: point at the end of a line and put the label above or below it.
- (v5) Anthropic's own tutorial-video style could not be found documented anywhere
  searchable; the tutorial look follows general product-demo guidance (one step at a time,
  callouts and zooms on the real UI, large readable text) rather than a copied style.

- (v4) The owner's notes on version 3: too fast to follow for someone who doesn't know the
  app, too much on screen at once, some crops looked off, and the jazzy music wasn't it
  (wanted harder rap/trap, nothing rock). Version 4: 53 s / 38.4 s, scenes of 2.4 to 4.8 s
  that reveal one part at a time, whole-component crops, a calmer cursor (0.45 s moves,
  a 30% bigger arrow and ripple), and only the app working well: Confirm Print on an idle
  printer passes and starts (`confirm_ok`), the fleet shot rests on a printing card
  instead of a pause-all with red results.
- (v4) Opening a file plays the app's morph animation, which looks like a blur when zoomed;
  the Confirm Print scene starts on the already open file.
- (v4) To film on an idle printer, press "Open Sim 04" inside that printer's own fleet card
  (`.fleet-card[data-printer="sim-04"]`); a plain `text=Open Sim 04` match finds a hidden
  copy first, and setting `localStorage` does not switch printers.

- (v3) The Files tab is now a grid of picture cards, so the sample files start below the
  visible area and the cursor clicked off-screen; `intoView()` in `shots.js` scrolls a
  card or button into view first.
- (v3) A clap and a mouse click share the 2-5 kHz range: clicks and keystrokes that landed
  on beat 3 were masked. A plain volume dip wasn't enough, and boosting the masked
  keystrokes made every other effect quieter (`sfx.py` scales the track to its loudest
  sound). What worked is a dynamic EQ in `mix.py`: around each click and keystroke the
  music loses most of its 2-6 kHz band while the bass keeps going. Measured: every click
  at least 15 dB above the music under it, keystrokes 23 dB at the median.
- (v3) The phone scene had no "Simulated farm" label (the app shows only "Simulated"
  under its figures); a glass label now sits beside the phone.
- (v3) `V.3d` is not valid JavaScript (a property name can't start with a digit); the 3D
  view is `V.d3`.

- GSAP `fromTo()` renders its *from* state immediately. Any entrance that starts
  part-visible (opacity .15 or .2 in zoom-through and cut-the-curve) showed as a faint ghost
  from the first frame until `immediateRender: false` was added. Several tweens on one
  property need the same.
- Never put a CSS `filter` on an element that has `backdrop-filter` (or on its parent):
  the glass stops sampling the page behind it. Captions blur their inner `.in` instead.
- `npx hyperframes check` times out on this machine for these compositions, even with
  `--timeout 60000`; `lint` and `snapshot` work. Check the real render with ffmpeg frames.
- `snapshot` can show footage up to about half a second off; the render was exact (the jam
  lands on 10.0 s). Judge timing on the render.
- The render browser cannot reach a CDN, so GSAP is vendored in `vendor/gsap.min.js`.
- HyperFrames warns when about 40 elements carry clip-path / blur / radial gradients
  (renders can go black). Version 1's layer-by-layer headline used clip-path and was
  rebuilt with overflow masks.
- Smooth-scrolling after opening a file keeps moving the page; measure an element's box
  only after the scroll settles (the 3D slider drag missed once).
- The fleet command bar sticks under the header once you scroll down; scroll back to
  `#tab-fleet` before clicking Select all / Pause.
- Sky Dash: flapping every 0.33 s flies into the ceiling within a second; every 0.65 s
  flies cleanly for over 3 s (tested without recording).
- `pgrep -f` / `pkill -f` patterns match the shell that runs them. Kill by PID, or match
  `ps` columns exactly.
- Music sites (freepd, Pixabay, Free Music Archive, Wikimedia, archive.org, incompetech)
  are blocked from the cloud sandbox. HyperFrames' own music library needs a HeyGen
  sign-in, and its offline generator uses MusicGen small, whose weights are CC-BY-NC 4.0
  (non-commercial; see huggingface.co/facebook/musicgen-small), so the music is
  synthesised in earlier versions. Version 11 uses the recorded instruments
  listed above.
- HyperFrames telemetry was switched off (`npx hyperframes telemetry disable`).

## Rendering cost

Version 16 (60 s, 16:9 only, 8 video windows from 8 shots plus 6 screenshots): rendered in 9 min
24 s. Filming the 3D twin alongside another shot crawled at about 10 s a frame until the app stopped
drawing the twin while it is out of sight (frontend/workshop.js); after that the fleet shot filmed in
131 s and the twin alone in about 7.5 minutes.

Version 15 (60 s each, 8 video windows from 7 shots plus 6 stills; one new shot, `twin3d_tight`,
filmed in about 5 minutes): the 16:9 cut rendered in 14 min 42 s, the 9:16 in 14 min 14 s. Version 14
was rendered again after the automation-callout fix: 16 min 32 s and 15 min 29 s (four renders in a
row, so slower than the first time).

Version 14 (60 s each, 7 video windows from 7 shots plus 6 stills; 13 shots filmed, mostly in
two parallel batches, about 3 s a frame for the 3D twin): the 16:9 cut rendered in 13 min 28 s,
the 9:16 in 12 min 54 s (frame capture 12 min 44 s and 12 min 4 s, measured by the renderer).

Version 13 (60 s each, 8 video windows from 7 shots plus 6 stills; all 13 shots re-filmed in two
parallel batches in about 13 minutes): the 16:9 cut rendered in about 12 minutes, the 9:16 in about
12 (frame capture 12 min 5 s and 11 min 42 s, measured by the renderer).

Version 8 (75 s each, 14 video windows from 13 shots, all re-filmed): the 16:9 cut rendered in about 21 minutes, the 9:16 in about 19.
Version 7 (90 s each, 15 video windows from 14 shots, version 6's footage reused): each cut rendered in about 20 to 25 minutes.

Version 6 (120 s each, 14 filmed shots): filming took about 15 minutes in two parallel
batches; each cut renders in about half an hour or more on this machine.

On this 4-CPU machine with software rendering: version 2's main 60 s at 60 fps took about
10 to 15 minutes, vertical 40 s about 7 to 9 minutes (slower while anything else runs).
Filming all 12 shots of version 3 took about 10 minutes in two parallel batches.
