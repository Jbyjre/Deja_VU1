      // Version 16 (16:9 only; the owner set version 2 and 9:16 aside on 25 October 2026): version 14's
      // story and music, showing what changed in the app: the 3DBenchy in Confirm Print and prepare &
      // slice, the quick tour whose glass callouts glide around the app, and scanning a QR code to open
      // and pair the dashboard on a phone. Automations joins "and plenty more".
      // Version 14 (the owner's "V1", version 12's 75-second film, re-cut to 60 s): the same story
      // in 40 bars of the same 160 BPM music, with the new digital twin shown both ways it is drawn
      // (the 3D model, then the drawing made from it) and the app's live Dots background, both in
      // the footage (the cursor plays through it) and as the film's own scenery.
      // Version 10: a 75-second SaaS launch video. The problem, what the app is for, the name,
      // how it works (the laptop with the real app, the printers and the phone joining it), seven
      // features shown working (sometimes on the laptop standing in 3D, sometimes full screen),
      // "and plenty more", why trust it, get started, the end card. Every change lands on a bar
      // line of the 160 BPM music, and every moment something appears is put on the music's grid
      // and written to CUES, so the music plays along with the picture (music/compose9.py).
      // Shared by both cuts; the layout CSS places things, this file times them. build.py fills
      // in M (each shot's clicks and marks), TY (the end-card typing) and SEG (the timings).
      const FMT = '__FMT__', V9 = FMT === 'vertical';
      const M = /*MARKS*/{}/*END*/;
      const TY = /*TYPING*/[]/*END*/;
      const SEG = /*SEGS*/{}/*END*/;
      const $ = (s) => document.querySelector(s);
      const FW = 1440, FH = 900, SW = 1240, SH = 775;       // filmed page (CSS px), laptop screen
      const FRW = V9 ? 1080 : 1920, FRH = V9 ? 1920 : 1080;  // the film's frame
      const at = (vid, mark) => M[vid].start + (mark in M[vid].marks ? M[vid].marks[mark] : 0);
      const click = (vid, i) => M[vid].start + M[vid].clicks[i];

      // ---------- the feature icons (48 x 48, drawn as lines) ----------
      const IC = {
        fl: '<rect x="5" y="8" width="38" height="26" rx="5"/><path d="M18 41h12M24 34v7"/><path class="heat" d="M10 22h7l3-6 5 12 3-6h10"/>',
        ov: '<path d="M14 32V22a10 10 0 0 1 20 0v10l3 4H11z"/><path d="M21 40a3.5 3.5 0 0 0 6 0"/><circle class="fill" cx="35" cy="12" r="5"/>',
        ok: '<path d="M24 5l14 5v12c0 9-6 16-14 20-8-4-14-11-14-20V10z"/><path d="M17 24l5 5 9-10"/>',
        cv: '<path d="M11 5h16l9 9v29H11z"/><path d="M27 5v9h9"/><path class="heat" d="M17 30h13M26 25l5 5-5 5"/>',
        sk: '<rect x="6" y="6" width="36" height="36" rx="5"/><rect x="12" y="25" width="9" height="9" rx="2"/><rect x="27" y="25" width="9" height="9" rx="2"/><path class="heat" d="M13 11l8 8M21 11l-8 8"/><rect x="27" y="11" width="9" height="9" rx="2"/>',
        tw: '<path d="M24 5l16 9v19l-16 9-16-9V14z"/><path d="M8 14l16 9 16-9M24 23v19"/>',
        st: '<rect x="5" y="9" width="38" height="30" rx="5"/><path d="M9 35l10-11 7 7 5-5 8 9"/><circle class="heat" cx="33" cy="17" r="4"/>',
        pp: '<path d="M24 6l18 9-18 9-18-9z"/><path d="M6 24l18 9 18-9"/><path class="heat" d="M6 33l18 9 18-9"/>',
        au: '<path d="M27 4L11 27h12l-3 17 17-24H25z"/>',
        ca: '<path d="M31 6a9 9 0 0 0-8 12L8 33a3.6 3.6 0 0 0 5 5l15-15a9 9 0 0 0 12-8l-6 2-4-4 2-6z"/>',
        fi: '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="6"/><circle class="heat" cx="24" cy="24" r="12" stroke-dasharray="4 5"/>',
        co: '<circle cx="24" cy="24" r="18"/><path d="M30 17c-2-3-12-3-12 2.5S30 23 30 29s-10 5.5-12 2.5M24 11v4M24 33v4"/>',
        ha: '<path d="M7 23L24 8l17 15v18H7z"/><circle cx="24" cy="27" r="3"/><circle cx="17" cy="33" r="2"/><circle cx="31" cy="31" r="2"/><path d="M24 30v11M22 28l-4 4M26 28l4 2"/>',
        tl: '<circle cx="24" cy="26" r="16"/><path d="M24 17v9l6 4M19 5h10"/><path class="heat" d="M24 5v5"/>',
        ar: '<path d="M7 15V7h8M33 7h8v8M41 33v8h-8M15 41H7v-8"/><path d="M24 14l9 5v10l-9 5-9-5V19zM15 19l9 5 9-5M24 24v10"/>',
        ga: '<path d="M14 15h20a9 9 0 0 1 9 9v4a6 6 0 0 1-11 3.5L30 29H18l-2 2.5A6 6 0 0 1 5 28v-4a9 9 0 0 1 9-9z"/><path d="M14 20v7M10.5 23.5h7"/><circle class="fill" cx="31" cy="22" r="2.2"/><circle class="fill" cx="36" cy="26" r="2.2"/>',
        ph: '<rect x="13" y="4" width="22" height="40" rx="5"/><path d="M21 9h6"/><circle class="fill" cx="24" cy="37" r="2"/>',
        pr: '<rect x="7" y="5" width="34" height="38" rx="4"/><path d="M7 13h34M19 13v7l5 5 5-5v-7M13 35h22"/><path class="heat" d="M17 31h14"/>',
        mod: '<rect x="4" y="15" width="40" height="20" rx="10"/><circle class="fill" cx="34" cy="25" r="6"/>',
        // version 16
        tg: '<rect x="5" y="9" width="38" height="24" rx="6"/><path d="M17 33l-5 7 11-7"/><circle class="fill" cx="38" cy="38" r="4"/><path class="heat" d="M12 18h18M12 25h12"/>',
        cp: '<rect x="13" y="4" width="22" height="40" rx="5"/><path d="M21 9h6"/><path class="heat" d="M18 16h5v5h-5zM25 23h5v5h-5zM18 25h3M27 16h3"/>',
        dk: '<rect x="6" y="9" width="36" height="32" rx="4"/><path d="M6 17h36M15 5v8M33 5v8"/><path class="heat" d="M13 25h8M13 32h14"/>',
        ly: '<rect x="8" y="8" width="32" height="6" rx="2"/><rect x="8" y="18" width="32" height="10" rx="2"/><rect class="heat" x="8" y="32" width="32" height="8" rx="2"/>',
        te: '<path d="M5 26h8l4-12 6 22 5-14 3 4h12"/>',
        up: '<path d="M38 20a15 15 0 1 0 1 9"/><path class="heat" d="M39 8v12H27"/>',
      };
      const svgIcon = (id) => `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true">${IC[id]}</svg>`;


      // ---------- the features: seven filmed ones, in the order MESSAGING.md leads with ----------
      // shot: D = on a device (the laptop turned towards the caption, its keyboard in view),
      //       F = the app full screen (the camera dollies into the laptop's screen).
      // The owner: "not the laptop and phone in every one, maybe half". The device shots are
      // where a device says something (the first look at the app, the phone, the moments that
      // step back for breath, the games); the full-screen shots are where the detail matters.
      // Version 8: Automations takes the studio's place and its device slot, so the two kinds
      // alternate through the second half. cap: the caption's side in 16:9 (on top in 9:16).
      const F = [
        { id: 'fl', lb: 'Live fleet', k: 'Every printer, live', shot: 'D', cap: 'L',
          h: 'See every printer at once.', s: 'Up to <em>12 printers</em>, live.' },
        { id: 'ov', lb: 'Needs you', k: 'Needs you', shot: 'F', cap: 'R',
          h: 'Know what needs you.', s: 'One list, <em>most urgent first</em>.' },
        { id: 'ok', lb: 'Confirm Print', k: 'Confirm Print', shot: 'F', cap: 'L',
          h: 'Every print, checked first.', s: 'File, colours and maintenance, <em>before it starts</em>.' },
        { id: 'pp', lb: 'Prepare &amp; slice', k: 'Prepare & slice', shot: 'F', cap: 'L',
          h: 'Prepare the whole plate.', s: 'Each part on its own head, <em>T0 to T3</em>. Then slice.' },
        // The twin (frontend/twin3d.js): the 3D model first; on the cut its caption gives way to TW2,
        // the drawing made from the same model.
        { id: 'tw', lb: 'Digital twin', k: 'Digital twin · 3D model', shot: 'F', cap: 'R',
          h: 'A live 3D twin of each printer.', s: 'Turn it by hand. <em>Click a head</em> for its details.' },
        // Version 16: the quick tour (frontend/guide.js), on the laptop so the whole app is in view as
        // the callout glides from screen to screen.
        { id: 'tg', lb: 'Quick tour', k: 'Quick tour', shot: 'D', cap: 'R',
          h: 'A tour that shows you around.', s: '<em>Nine stops</em>, about a minute, on the real screens.' },
        // Version 16: your phone (frontend/phone.js): the computer shows a QR code; the phone scans it,
        // opens the dashboard and pairs itself.
        { id: 'cp', lb: 'Your phone', k: 'On your phone', shot: 'D', cap: 'L',
          h: 'Scan it onto your phone.', s: 'Nothing to type. <em>It pairs itself.</em>' },
      ];
      // The drawing's sizes: the outside figures are Snapmaker's; the body's own size is estimated,
      // and the drawing marks it with "≈" (the twin card says the same, frontend/index.html).
      const TW2 = { id: 'tw2', cap: 'R', k: 'Digital twin · Drawing', h: 'The same model, as a drawing.', s: '<em>Live dimensions</em>, balloons, a title block.',
        fine: '≈ estimated · outside 584 × 499 × 730 mm, per Snapmaker' };
      // The opening (version 9, the owner: "change the first scene to defining the purpose of the
      // app"): who it is for, what it does, three promises, then the name. Each promise is a
      // feature shown later in the film: the live fleet, Confirm Print, Needs you.
      const PURPOSE = [
        { id: 'fl', t: 'Watch every print, <em>live</em>.' },
        { id: 'ok', t: 'Prepare and check <em>every file</em>.' },
        { id: 'ov', t: 'Know the moment one <em>needs you</em>.' },
      ];

      // How it works (version 10): three steps around the laptop, each sentence checked against
      // docs/getting-started.md, backend/live_feed.py (four updates a second) and backend/fleet.py.
      const STEPS = [
        // version 14: a bar each, so each sentence is shorter (Python 3.8 moves to the end card)
        { h: 'Runs on your computer.', s: 'Windows, Mac, Linux or a <em>Raspberry Pi</em>.' },
        { h: 'Talks to your U1s on your network.', s: '<em>Four updates a second.</em> Nothing installed on the printer.' },
        { h: 'Open it in any browser.', s: 'On that computer, or <em>scan it onto your phone</em>.' },
      ];
      const PRINTERS = ['Printer 1', 'Printer 2', 'Printer 3'];     // version 16: your printers, by number (the demo names changed)
      // "And plenty more": the supporting features, as screenshots of their real panels (version 16:
      // what is new since version 14, and automations, which was a feature of its own).
      const MORE = [
        { id: 'dk', lb: 'Farm desk', img: 'desk' }, { id: 'ly', lb: 'Mixed layer heights', img: 'layers' },
        { id: 'cv', lb: 'Files ready for the U1', img: 'convert' }, { id: 'te', lb: 'Live telemetry', img: 'telemetry' },
        { id: 'au', lb: 'Automations, no cloud', img: 'automations' }, { id: 'up', lb: 'Updates that find you', img: 'updates' },
      ];

      // where the twin shot's camera and callouts go (page px, measured on the filmed shot)
      // The model fills page 182-835 x 243-730 (the card's mode switch at y 150), the details open at
      // y 780-900 under the head chips; the Front drawing's "≈390 mm" sits at (510, 681).
      const TW = { model: [160, 120, 700, 640], pick: [160, 330, 700, 570], draw: [160, 120, 700, 650],
        drag: [500, 590], dragDir: 'b', detail: [330, 836], detailDir: 'r', ink: [560, 540], inkDir: 't' };   // version 16: re-measured on twin3d_tight's new take
      // version 16: where the phone sheet's QR code sits (page px, measured on the filmed shot)
      const CP = { frame: [330, 120, 790, 660], qr: [502, 380] };
      // where the prepare shot's callouts point (page px, measured on the filmed shot)
      // version 16 (the Benchy, measured on the filmed shot): the copy's head choice, and the plate under both boats
      const PP = { tool: [1138, 509], toolDir: 'b', plate: [880, 700], plateDir: 'b', frame: [540, 280, 740, 520] };

      // ---------- DOM ----------
      $('#nodes').innerHTML = PRINTERS.map((p, i) => `<div class="node col" id="nd-${i}"><div class="tile glass">${svgIcon('pr')}</div><div class="lb">U1<b>${p}</b></div></div>`).join('')
        + `<div class="node col" id="nd-ph"><div class="tile glass">${svgIcon('ph')}</div><div class="lb">Browser<b>Your phone</b></div></div>`;
      $('#steps').innerHTML = STEPS.map((p, i) => `<div class="step" id="st-${i}"><div class="card glass"><div class="n">${i + 1}</div><div class="in"><div class="h">${p.h}</div><div class="s">${p.s}</div></div></div></div>`).join('');
      $('#more-g').innerHTML = MORE.map(m => `<div class="mc glass" id="mc-${m.id}"><div class="shot${m.txt ? ' txt' : ''}">${m.txt ? m.txt : `<img src="assets/stills/${m.img}.jpg" alt="">`}</div><div class="lb">${svgIcon(m.id)}${m.lb}</div></div>`).join('');
      $('#p-list').innerHTML = PURPOSE.map(p => `<div class="pi" id="pi-${p.id}"><div class="tile glass">${svgIcon(p.id)}</div><div class="t">${p.t}</div></div>`).join('');
      $('#caps').innerHTML = [...F, TW2].map(f => `<div class="cap ${V9 ? 'T' : f.cap}" id="cap-${f.id}"><div class="card glass"><div class="in">
          <div class="k"><span class="mini">${svgIcon(f.id === 'tw2' ? 'tw' : f.id)}</span>${f.k.replace('&', '&amp;')}</div><div class="h">${f.h}</div><div class="s">${f.s}</div>${f.fine ? `<div class="fine">${f.fine}</div>` : ''}</div></div></div>`).join('');
      $('#keys').innerHTML = '<i></i>'.repeat(74) + '<i class="sp"></i>' + '<i></i>'.repeat(4);   // five rows of 14, then the space bar row
      const screen = $('#screen');
      const LAYERS = F.map(f => f.id);   // version 14: the twin is one continuous take
      LAYERS.forEach(id => { const l = document.createElement('div'); l.className = 'layer'; l.id = 'L-' + id; l.innerHTML = '<div class="cam"></div>'; screen.insertBefore(l, screen.querySelector('.glare')); });

      const V = {};
      function mount(viewEl, vid, vw, vh) {
        const s = Math.max(vw / FW, vh / FH), cam = viewEl.querySelector('.cam'), inner = document.createElement('div');
        Object.assign(cam.style, { width: vw + 'px', height: vh + 'px', transformOrigin: `${vw / 2}px ${vh / 2}px` });
        Object.assign(inner.style, { position: 'absolute', left: 0, top: 0, width: FW * s + 'px', height: FH * s + 'px' });
        inner.appendChild(document.getElementById(vid)); cam.appendChild(inner);
        return { cam, inner, vw, vh, s, safe: [0, 0, 1, 1], cs: 1 };
      }
      LAYERS.forEach(id => { V[id] = mount($('#L-' + id), 'v-' + id, SW, SH); });
      (() => { const cam = document.createElement('div'); cam.className = 'cam'; Object.assign(cam.style, { inset: '0', width: '100%', height: '100%' });
        cam.appendChild($('#v-ph')); $('#ph-screen').appendChild(cam); })();
      document.querySelectorAll('.ico path, .ico rect, .ico circle:not(.fill)').forEach(el => {
        if (el.getAttribute('stroke-dasharray')) return;
        const n = el.getTotalLength ? el.getTotalLength() : 200;
        el.style.strokeDasharray = n; el.dataset.len = n;
      });

      // ---------- the camera ----------
      // Poses of the laptop. z is a dolly towards (+) or away from (-) the viewer; with the
      // stage's 2600 px perspective the laptop looks 2600 / (2600 - z) times its size. lid is
      // the hinge: positive opens it back past upright (18 = a 108 degree opening, the way a
      // laptop sits on a desk). R / L: standing right / left of the caption, turned a little
      // towards it and seen a little from above, so the keyboard shows without the screen
      // looking stretched. full: the screen fills the frame (lid upright, seen straight on).
      const PERSP = 2600, look = z => PERSP / (PERSP - z);
      const POSE = V9 ? {
        R: { x: 0, y: 120, z: -1450, rotationX: -12, rotationY: -13, lid: 16 },
        L: { x: 0, y: 120, z: -1450, rotationX: -12, rotationY: 13, lid: 16 },
        full: { x: 0, y: 247, z: 889, rotationX: 0, rotationY: 0, lid: 0 },   // the screen fills the frame below the caption, its bezel off the bottom edge
        back: { x: 0, y: 220, z: -2400, rotationX: -10, rotationY: -12, lid: 16 },
        rise: { x: 0, y: 1300, z: -1900, rotationX: -40, rotationY: 0, lid: 16 },
        hub: { x: 0, y: 40, z: -1900, rotationX: -9, rotationY: 0, lid: 15 },     // how it works: square on, the printers above, the phone below
      } : {
        R: { x: 290, y: -150, z: -1000, rotationX: -10, rotationY: -15, lid: 16 },
        L: { x: -290, y: -150, z: -1000, rotationX: -10, rotationY: 15, lid: 16 },
        full: { x: 0, y: 2.5, z: 930, rotationX: 0, rotationY: 0, lid: 0 },
        back: { x: 220, y: -90, z: -1850, rotationX: -10, rotationY: -20, lid: 16 },
        rise: { x: 0, y: 1000, z: -1700, rotationX: -40, rotationY: 0, lid: 16 },
        hub: { x: 0, y: -150, z: -1700, rotationX: -9, rotationY: 0, lid: 15 },   // how it works: square on, the printers left, the phone right
      };
      // In full screen the caption covers one side of the app, so the camera inside the screen
      // frames each detail in the part that stays clear (fractions of the screen).
      const SAFE = V9 ? { T: [.22, .03, .78, .97] } : { L: [.44, .09, .98, .91], R: [.02, .09, .56, .91] };
      const DEVICE_LOOK = look(POSE.R.z);
      function shotPose(f) { return f.shot === 'F' ? 'full' : (f.cap === 'L' ? 'R' : 'L'); }
      function setView(v, pose, cap) {
        v.safe = pose === 'full' ? SAFE[V9 ? 'T' : cap] : [0, 0, 1, 1];
        v.cs = DEVICE_LOOK / look(POSE[pose].z);          // callouts keep one size on screen
      }

      const tl = gsap.timeline({ paused: true });
      // Version 9: the sound follows the picture. Every moment something appears (a word of the
      // opening, a promise, a callout, the phone, a sensor row, a value) is put on the music's
      // grid (the nearest eighth note of the 160 BPM music) and written to CUES, which build.py
      // reads back so music/compose9.py plays a note, a chord or a drum hit exactly then.
      const CUES = [];
      const cue = (t, k, extra = {}) => { CUES.push({ t: +t.toFixed(3), k, ...extra }); return t; };
      const snap = t => Math.round(t / (SEG.beat / 2)) * (SEG.beat / 2);
      window.__cues = CUES;
      // A smooth move of the whole laptop (and its hinge) to a pose.
      function rigTo(t, d, pose, extra = {}, ease = 'power2.inOut') {
        const { lid, ...p } = POSE[pose];
        tl.to('#rig', { ...p, ...extra, duration: d, ease }, t);
        tl.to('#lid', { rotationX: lid, duration: d, ease }, t);
      }
      function camK(v, r) {
        const sw = v.vw * (v.safe[2] - v.safe[0]), sh = v.vh * (v.safe[3] - v.safe[1]);
        // never more than 1.9 times the page's size on the screen: past that the app's text and
        // controls look out of proportion (the owner: the zooms went too far)
        return Math.max(Math.min(sw / (r[2] * v.s), sh / (r[3] * v.s), 1.9), Math.max(v.vw / (FW * v.s), v.vh / (FH * v.s)));
      }
      // Frame a rectangle of the footage (CSS px of the filmed page) in the clear part of the screen.
      function camTo(v, t, d, r, ease = 'power2.inOut') {
        const k = camK(v, r), cx = (r[0] + r[2] / 2) * v.s, cy = (r[1] + r[3] / 2) * v.s;
        const tx = v.vw * (v.safe[0] + v.safe[2]) / 2, ty = v.vh * (v.safe[1] + v.safe[3]) / 2;
        let x = tx - k * cx, y = ty - k * cy;
        // The page may slide out from under the caption (the strip it leaves is the app's own
        // light background, behind the caption's glass), but never past the clear part's edge.
        // (In 9:16 the strip it leaves falls in the part of the screen cropped off the frame.)
        const slide = [v.vw * v.safe[0], v.vw * (1 - v.safe[2])];
        x = Math.min(slide[0], Math.max(v.vw - k * FW * v.s - slide[1], x));
        y = Math.min(0, Math.max(v.vh - k * FH * v.s, y));
        // Version 10 (the owner: the zooms looked unnatural). Version 9 tweened scale and position
        // on one element with x/y in screen pixels, so mid-zoom the detail being framed swung
        // along a curve and arrived late. Now the outer layer scales about the screen's centre and
        // the inner one moves the page in page pixels, both on one ease: the framed point travels
        // in a straight line while the zoom grows (HyperFrames' coordinate-target-zoom rule).
        const ox = v.vw / 2, oy = v.vh / 2, ix = (x - ox * (1 - k)) / k, iy = (y - oy * (1 - k)) / k;
        if (d === 0) { tl.set(v.cam, { scale: k }, t); tl.set(v.inner, { x: ix, y: iy }, t); }
        else { tl.to(v.cam, { scale: k, duration: d, ease }, t); tl.to(v.inner, { x: ix, y: iy, duration: d, ease }, t); }
        return k;
      }
      // A callout: a dot on the thing, a short stem, a dark label, inside the screen's camera
      // (it stays on its target through every move) and scaled to keep one size on screen.
      function callout(v, pt, label, dir, tIn, tOut, k) {
        tIn = cue(snap(tIn), 'callout');
        const el = document.createElement('div'); el.className = 'co ' + dir;
        el.innerHTML = `<i class="dot"></i><b class="stem"></b><span class="pill">${label}</span>`;
        Object.assign(el.style, { left: pt[0] * v.s + 'px', top: pt[1] * v.s + 'px' });
        v.inner.appendChild(el);
        tl.set(el, { scale: v.cs / k, transformOrigin: '0 0' }, 0);
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: .3, ease: 'power2.out', immediateRender: false }, tIn);
        tl.fromTo(el.querySelector('.dot'), { scale: 0 }, { scale: 1, duration: .45, ease: 'back.out(2.2)', immediateRender: false }, tIn);
        tl.fromTo(el.querySelector('.stem'), { scale: 0 }, { scale: 1, duration: .35, ease: 'power3.out', immediateRender: false,
          transformOrigin: { r: '0 50%', l: '100% 50%', t: '50% 100%', b: '50% 0' }[dir] }, tIn + .05);
        tl.fromTo(el.querySelector('.pill'), { opacity: 0 }, { opacity: 1, duration: .35, ease: 'power2.out', immediateRender: false }, tIn + .12);
        tl.to(el, { opacity: 0, duration: .25, ease: 'power1.in' }, tOut);
      }
      function spot(v, r, tIn, tOut) {
        const el = document.createElement('div'); el.className = 'spot';
        Object.assign(el.style, { left: r[0] * v.s + 'px', top: r[1] * v.s + 'px', width: r[2] * v.s + 'px', height: r[3] * v.s + 'px' });
        v.inner.appendChild(el);
        tl.fromTo(el, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: .45, ease: 'power3.out', immediateRender: false }, tIn);
        tl.to(el, { opacity: 0, duration: .3, ease: 'power1.in' }, tOut);
      }
      function zin(el, t, d = .4) {
        tl.fromTo(el, { opacity: 0, scale: .9, y: 18 }, { opacity: 1, scale: 1, y: 0, duration: d, ease: 'power3.out', immediateRender: false }, t);
      }
      // Captions: the card glides in, then its label, headline and sentence close behind (version
      // 8: about half a second in all, so the words are there while the camera is still settling).
      function capIn(id, t) {
        const c = '#cap-' + id, dx = V9 ? 0 : $(c).classList.contains('L') ? -44 : 44;
        tl.set(c, { opacity: 1 }, t);
        tl.fromTo(`${c} .card`, { opacity: 0, x: dx, y: V9 ? -24 : 0, scale: .96 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: .5, ease: 'expo.out', immediateRender: false }, t);
        tl.fromTo(`${c} .k`, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .35, ease: 'power3.out', immediateRender: false }, t + .05);
        tl.fromTo(`${c} .h`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .4, ease: 'expo.out', immediateRender: false }, t + .09);
        tl.fromTo(`${c} .s`, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .4, ease: 'expo.out', immediateRender: false }, t + .17);
        tl.fromTo(`${c} .mini .ico *`, { strokeDashoffset: (i, el) => el.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .06);
        tl.fromTo(`${c} .card`, { '--sx': '0%' }, { '--sx': '90%', duration: 5, ease: 'none', immediateRender: false }, t);
      }
      // Full screen, the keyboard deck is out of the picture; it fades away on the way in and back
      // on the way out (left in place, Chrome clips part of the screen when the camera is this
      // close to a 3D scene that also holds the deck).
      function deck(show, t) {
        if (show) { tl.set('.deck', { visibility: 'visible' }, t); tl.to('.deck', { opacity: 1, duration: .4, ease: 'power1.out' }, t); }
        else { tl.to('.deck', { opacity: 0, duration: .4, ease: 'power1.in' }, t); tl.set('.deck', { visibility: 'hidden' }, t + .4); }
      }
      function capOut(id, t) {
        tl.to(`#cap-${id} .card`, { opacity: 0, scale: .98, duration: .25, ease: 'power1.in' }, t);
        tl.set('#cap-' + id, { opacity: 0 }, t + .26);
      }

      tl.fromTo('#pool-a', { x: 0, y: 0 }, { x: 140, y: 60, duration: SEG.length, ease: 'none' }, 0);
      tl.fromTo('#pool-b', { x: 0, y: 0 }, { x: -120, y: -40, duration: SEG.length, ease: 'none' }, 0);
      // Version 14: the app's click ripple, run out through the scenery's dots from the film's key
      // moments, on the music's hits. Three ripples take turns (each lives about 1.6 s).
      let nRip = 0;
      function ripple(t, x, y, power = 1) {
        const el = '#rip-' + (nRip++ % 3), reach = (V9 ? 1500 : 1700) * (.75 + .25 * power);
        tl.set(el, { '--x': x + 'px', '--y': y + 'px' }, t);
        tl.fromTo(el, { '--r': '0px' }, { '--r': reach + 'px', duration: 1.6, ease: 'power2.out', immediateRender: false }, t);
        tl.fromTo(el, { opacity: 0 }, { keyframes: [{ opacity: .9 * Math.min(1, power), duration: .12 }, { opacity: 0, duration: 1.45, ease: 'power1.in' }], immediateRender: false }, t);
      }
      const centre = (sel) => { const r = $(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      { const { lid, ...p } = POSE.rise; gsap.set('#rig', p); gsap.set('#lid', { rotationX: lid }); }

      // ===== version 10's story, bar by bar (a bar of the 160 BPM music is 1.5 s) =====
      const B = SEG.beat, BAR = 4 * B;
      // bars 0-2: the hook, the problem in two lines
      gsap.utils.toArray('#hook .hk').forEach((el, i) => tl.fromTo(el, { opacity: 0, y: 46 },
        { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, cue(i ? BAR : .05, 'hook', { i })));
      // the shelf: one printer with the first line, five more with the second, then one of them
      // flags a problem (the red dot), the reason to want one screen
      $('#shelf').innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="sh glass" id="sh-${i}">${svgIcon('pr')}<i class="dot"></i></div>`).join('');
      $('#shelf').querySelectorAll('.ico path, .ico rect').forEach(el => { const n = el.getTotalLength(); el.style.strokeDasharray = n; el.dataset.len = n; });
      for (let i = 0; i < 6; i++) {
        const t = cue(i ? BAR + (i - 1) * B / 2 : .1, 'tile', { i }), el = '#sh-' + i;
        tl.fromTo(el, { opacity: 0, scale: .6, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: .4, ease: 'back.out(1.8)', immediateRender: false }, t);
        tl.fromTo(`${el} .ico *`, { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .4, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .03);
        tl.fromTo(el, { '--sx': '0%' }, { '--sx': '100%', duration: 2.5, ease: 'none', immediateRender: false }, t);
      }
      tl.fromTo('#sh-4 .dot', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .35, ease: 'back.out(2.5)', immediateRender: false }, cue(BAR + 3 * B, 'alert'));
      tl.to('#sh-4', { x: 6, duration: .06, yoyo: true, repeat: 5, ease: 'sine.inOut' }, BAR + 3 * B);
      ripple(BAR + 3 * B, ...centre('#sh-4'), .7);
      tl.to(['#hook', '#shelf'], { y: V9 ? -120 : -90, opacity: 0, duration: .3, ease: 'power2.in' }, 2 * BAR - .32);

      // bars 2-4.5: what it is for. The label, the headline a word an eighth note, then the three
      // promises on beats 1, 2 and 3 of bar 3 (a chord on each).
      const P0 = 2 * BAR;
      tl.fromTo('#p-for', { opacity: 0, y: 14, scale: .96 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: 'expo.out', immediateRender: false }, cue(P0, 'for'));
      tl.fromTo('#p-for', { '--sx': '0%' }, { '--sx': '90%', duration: 3.6, ease: 'none', immediateRender: false }, P0);
      tl.fromTo('#p-for .ico *', { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .5, ease: 'power2.out', stagger: .04, immediateRender: false }, P0 + .05);
      gsap.utils.toArray('#p-head .w').forEach((w, i) => {
        tl.fromTo(w, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .4, ease: 'expo.out', immediateRender: false }, cue(P0 + B * (.5 + i * .5), 'word', { i }));
      });
      PURPOSE.forEach((p, i) => {
        const t = cue(3 * BAR + i * B, 'item', { i }), el = '#pi-' + p.id;
        tl.fromTo(el, { opacity: 0, y: 26, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: 'expo.out', immediateRender: false }, t);
        tl.fromTo(`${el} .ico *`, { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .04);
        tl.fromTo(`${el} .tile`, { '--sx': '0%' }, { '--sx': '100%', duration: 2.2, ease: 'none', immediateRender: false }, t);
      });
      tl.fromTo('#purpose', { scale: 1 }, { scale: 1.025, duration: 3.6, ease: 'none', immediateRender: false }, P0);
      tl.set('#purpose', { opacity: 1 }, 0);
      tl.to('#purpose', { y: V9 ? -160 : -120, opacity: 0, duration: .3, ease: 'power2.in' }, 4.5 * BAR - .34);

      // bar 4.5: the name, on a full chord and a cymbal
      const NAME = cue(4.5 * BAR, 'name');
      tl.set('#brand', { opacity: 1 }, NAME);
      tl.fromTo('#b-icon', { scale: .4, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: 'back.out(1.7)', immediateRender: false }, NAME);
      tl.to('#b-ring', { attr: { 'stroke-dashoffset': 0 }, duration: .6, ease: 'power3.out' }, NAME + .03);
      tl.fromTo('#b-dot', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: .35, ease: 'back.out(2)', immediateRender: false }, NAME + .12);
      ripple(NAME, ...centre('#b-icon'), 1.2);
      tl.fromTo('#b-word', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, NAME + .06);
      tl.fromTo('#b-sub2', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .4, ease: 'power3.out', immediateRender: false }, NAME + B);
      tl.to('#brand', { y: V9 ? -420 : -260, opacity: 0, duration: .32, ease: 'power2.in' }, SEG.hiw.t0 - .82);

      // ===== bars 6-10.5: how it works. The laptop lands showing the real app; the printers and
      // the phone come in around it, joined by the network, a pulse on each wire every quarter of
      // a second (the app's four updates a second). =====
      const H0 = SEG.hiw.t0, HS = [H0, SEG.hiw.s2, SEG.hiw.s3], H1 = SEG.fl.t0;
      tl.set('#rig', { opacity: 1 }, H0 - .55);
      tl.set('#L-fl', { opacity: 1 }, H0 - .55);
      rigTo(H0 - .55, .9, 'hub', {}, 'expo.out');
      tl.fromTo('#corner', { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: .5, ease: 'power3.out', immediateRender: false }, H0);
      ripple(H0, FRW / 2, FRH / 2, 1);
      tl.fromTo('#simtag', { opacity: 0 }, { opacity: 1, duration: .5, ease: 'power2.out', immediateRender: false }, H0);
      tl.to('#rig', { z: POSE.hub.z + 90, duration: H1 - H0 - .5, ease: 'sine.inOut' }, H0 + .4);
      STEPS.forEach((p, i) => {
        const el = '#st-' + i, t = cue(HS[i], 'step', { i });
        tl.set(el, { opacity: 1 }, t);
        tl.fromTo(`${el} .card`, { opacity: 0, y: V9 ? -20 : 24, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .5, ease: 'expo.out', immediateRender: false }, t + .04);
        tl.fromTo(`${el} .n`, { scale: .4 }, { scale: 1, duration: .45, ease: 'back.out(2)', immediateRender: false }, t + .08);
        tl.fromTo(`${el} .card`, { '--sx': '0%' }, { '--sx': '90%', duration: 2.3, ease: 'none', immediateRender: false }, t);
        const out = i < 2 ? HS[i + 1] - .3 : H1 - .38;
        tl.to(`${el} .card`, { opacity: 0, y: V9 ? -12 : 12, duration: .26, ease: 'power1.in' }, out);
        tl.set(el, { opacity: 0 }, out + .27);
      });
      // where the nodes sit, in frame pixels: (left, top) of each node, and the wire ends
      const NODE = V9 ? { w: 230, pr: [[135, 500], [425, 500], [715, 500]], ph: [425, 1420] } : { w: 230, pr: [[250, 205], [250, 385], [250, 565]], ph: [1440, 360] };
      const T = V9 ? 128 : 120;
      const WIRE = V9 ? {
        pr: NODE.pr.map(([l, tp], i) => [l + 115, tp + T + 66, 360 + i * 180, 746]),
        ph: [540, 1330, 540, NODE.ph[1] - 8],
      } : {
        pr: NODE.pr.map(([l, tp]) => [l + 115 + T / 2 + 4, tp + T / 2, 588, 449]),
        ph: [1334, 449, NODE.ph[0] + 115 - T / 2 - 4, NODE.ph[1] + T / 2],
      };
      [...NODE.pr, NODE.ph].forEach(([l, tp], i) => Object.assign($(i < 3 ? '#nd-' + i : '#nd-ph').style, { left: l + 'px', top: tp + 'px', width: NODE.w + 'px', alignItems: 'center' }));
      const svgNS = 'http://www.w3.org/2000/svg', wires = $('#wires');
      function wire([x1, y1, x2, y2], t0, t1, back) {
        const ln = document.createElementNS(svgNS, 'line');
        Object.entries({ x1, y1, x2: x1, y2: y1 }).forEach(([k, v]) => ln.setAttribute(k, v)); wires.appendChild(ln);
        tl.fromTo(ln, { attr: { x2: x1, y2: y1 }, opacity: 0 }, { attr: { x2, y2 }, opacity: .55, duration: .45, ease: 'power2.out', immediateRender: false }, t0);
        tl.to(ln, { opacity: 0, duration: .3, ease: 'power1.in' }, t1);
        // a pulse every quarter of a second: the data going one way (printer to app, app to phone)
        const [ax, ay, bx, by] = back ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
        for (let t = t0 + .45; t < t1 - .4; t += .25) {
          const d = document.createElementNS(svgNS, 'circle'); d.setAttribute('r', V9 ? 7 : 6); wires.appendChild(d);
          tl.fromTo(d, { attr: { cx: ax, cy: ay }, opacity: 0 }, { attr: { cx: bx, cy: by }, duration: .5, ease: 'none', immediateRender: false }, t);
          tl.fromTo(d, { opacity: 0 }, { keyframes: [{ opacity: .95, duration: .08 }, { opacity: .95, duration: .34 }, { opacity: 0, duration: .08 }], immediateRender: false }, t);
        }
      }
      NODE.pr.forEach((_, i) => {
        const t = cue(HS[1] + i * B, 'node', { i }), el = '#nd-' + i;
        tl.fromTo(el, { opacity: 0, scale: .8, x: V9 ? 0 : -30, y: V9 ? -20 : 0 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: .45, ease: 'back.out(1.6)', immediateRender: false }, t);
        tl.fromTo(`${el} .ico *`, { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .04);
        tl.fromTo(`${el} .tile`, { '--sx': '0%' }, { '--sx': '100%', duration: 3, ease: 'none', immediateRender: false }, t);
        wire(WIRE.pr[i], t + .1, H1 - .45, false);
        tl.to(el, { opacity: 0, scale: .9, duration: .3, ease: 'power1.in' }, H1 - .45);
      });
      { const t = cue(HS[2] + B, 'node', { i: 3 });
        tl.fromTo('#nd-ph', { opacity: 0, scale: .8, x: V9 ? 0 : 30, y: V9 ? 20 : 0 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: .45, ease: 'back.out(1.6)', immediateRender: false }, t);
        tl.fromTo('#nd-ph .ico *', { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .04);
        wire(WIRE.ph, t + .1, H1 - .45, false);
        tl.to('#nd-ph', { opacity: 0, scale: .9, duration: .3, ease: 'power1.in' }, H1 - .45);
      }

      // ===== the features =====
      // The laptop turns from the how-it-works pose to the first feature's, the same app still on it.
      rigTo(H1 - .42, .85, shotPose(F[0]), {}, 'power3.inOut');
      capIn('fl', H1 + .06);
      F.forEach(f => setView(V[f.id], shotPose(f), f.cap));

      // Between two features: one continuous move. The caption fades, the laptop turns, dollies
      // in or steps back while its screen crossfades to the next app view (no cuts, no blur).
      F.forEach((f, i) => {
        if (!i) return;
        const p = F[i - 1], t0 = SEG[f.id].t0, from = shotPose(p), to = shotPose(f);
        capOut(p.id === 'tw' ? 'tw2' : p.id, t0 - .38);
        capIn(f.id, t0 + .06);
        // full screen to full screen: the laptop stays where it is (version 9's quick step back
        // and in again read as a bump); the new screen settles in as it fades up
        // (version 16: the phone is the last feature now, so no feature follows the laptop standing back)
        const back = false;
        if (from !== to || back) rigTo(t0 - .42, .85, to, back ? { opacity: 1 } : {}, 'power3.inOut');
        if (to === 'full' && (from !== 'full' || back)) deck(false, t0 - .1);
        if (from === 'full' && to !== 'full') deck(true, t0 - .42);
        // the new screen fades in on top of the old one, which only goes once it is covered
        tl.set('#L-' + f.id, { zIndex: 2 + i }, t0 - .26);
        tl.fromTo('#L-' + f.id, { scale: 1.04 }, { scale: 1, duration: .75, ease: 'expo.out', immediateRender: false }, t0 - .22);
        tl.fromTo('#L-' + f.id, { opacity: 0 }, { opacity: 1, duration: .32, ease: 'power1.inOut', immediateRender: false }, t0 - .22);
        tl.set('#L-' + p.id, { opacity: 0 }, t0 + .14);
        // the scenery answers each change into or out of a device shot (where it is in view)
        if (f.shot === 'D' || p.shot === 'D') ripple(t0, FRW / 2, FRH / 2, .8);
      });
      // The small logo shows over device shots only: full screen, it would sit on top of the app.
      F.forEach((f, i) => {
        if (!i) return;
        const was = F[i - 1].shot === 'D', is = f.shot === 'D';
        if (was !== is) tl.to('#corner', { opacity: is ? 1 : 0, duration: .4, ease: 'power1.inOut' }, SEG[f.id].t0 - .4);
      });

      // While a feature plays the laptop keeps drifting a little closer (and, on the device,
      // turns towards the viewer), so the frame is never quite still.
      F.forEach(f => {
        const s = SEG[f.id], pose = POSE[shotPose(f)];
        const end = f.id === 'cp' ? SEG.phone - .5 : s.t1 - .42;
        const drift = f.shot === 'F' ? { z: pose.z + 45 } : { z: pose.z + 110, rotationY: pose.rotationY * .75 };
        tl.to('#rig', { ...drift, duration: end - s.t0 - .45, ease: 'sine.inOut' }, s.t0 + .45);
      });

      // Version 8: one or two callouts per feature, each up long enough to read, so the eye
      // goes straight to the one thing that matters. OUT: when a feature's callouts leave.
      const OUT = id => SEG[id].t1 - .32;
      // 1. every printer, live
      { const v = V.fl, H = at('v-fl', 'hover');
        camTo(v, SEG.hiw.t0 - .6, 0, [0, 0, FW, FH]);                 // the whole page while how it works plays
        camTo(v, SEG.fl.t0 - .3, .9, [170, 280, 1110, 640]);
        const k = camTo(v, H - .5, .8, [470, 280, 700, 440]);
        spot(v, [556, 346, 336, 104], H + .1, OUT('fl'));
        callout(v, [760, 418], 'Progress and finish time', 't', H + .25, OUT('fl'), k);   // version 14: one callout, as version 13
      }
      // 2. needs you
      { const v = V.ov, J = at('v-ov', 'jam');
        camTo(v, SEG.ov.t0 - .5, 0, [150, 280, 800, 600]);
        const k = camTo(v, J, .7, [165, 400, 760, 300]);
        // version 14: the jam now arrives as two rows (the dock error it causes, then the jam itself)
        spot(v, [172, 490, 1106, 112], J + .2, OUT('ov'));
        callout(v, [572, 566], 'A jam, the moment it happens', 'r', J + .35, OUT('ov'), k);
      }
      // 3. confirm print (version 16: the 3DBenchy; the phone has its own feature now)
      { const v = V.ok, P = click('v-ok', 1), G = click('v-ok', 2);
        camTo(v, SEG.ok.t0 - .5, 0, [600, 250, 760, 330]);
        const k = camTo(v, P + .1, .75, [350, 250, 740, 400]);
        spot(v, [383, 364, 674, 50], P + .55, G - .25);
        callout(v, [720, 410], 'Every check passed', 'b', P + .65, G - .25, k);
        // version 16: after Start the app shows Overview, and the printer's confirmation arrives bottom right
        const k2 = camTo(v, G + .1, .7, [780, 500, 660, 360]);
        callout(v, [1230, 742], 'Started, confirmed by the printer', 't', G + .45, OUT('ok'), k2);
      }
      // 5. prepare & slice (version 12, the new workspace): duplicate the part, put the copy on
      // head T1 (it turns that head's colour), arrange the plate
      { const v = V.pp, D = at('v-pp', 'dup'), BL = at('v-pp', 'blue'), AR = at('v-pp', 'arrange');
        camTo(v, SEG.pp.t0 - .5, 0, [560, 200, 720, 600]);
        const k = camTo(v, Math.max(D + .2, SEG.pp.t0 + .1), .8, PP.frame);   // version 16: the copy is made just before the scene
        callout(v, PP.tool, 'The copy goes on head T1', PP.toolDir, BL + .1, AR - .1, k);
        callout(v, PP.plate, 'Both fit the U1 plate', PP.plateDir, AR + .35, OUT('pp'), k);
      }
      // 6. the digital twin, one continuous take (version 15's tighter take): the cursor flicks the 3D
      // model (it glides to a stop), clicks head T0 (its live details open); on the cut (the Drawing
      // switch, on the bar) the caption gives way and the same model is an engineering drawing.
      { const v = V.tw, GR = at('v-tw', 'grab'), PK = at('v-tw', 'pick'), CUT = SEG.twinCut;
        camTo(v, SEG.tw.t0 - .5, 0, TW.model);
        const k = camK(v, TW.model);
        callout(v, TW.drag, 'Drag it: it glides to a stop', TW.dragDir, Math.max(GR + .15, SEG.tw.t0 + .3), PK - .3, k);
        const k2 = camTo(v, PK - .05, .75, TW.pick);
        callout(v, TW.detail, 'Its live details', TW.detailDir, PK + .4, CUT - .3, k2);
        capOut('tw', CUT - .38);
        capIn('tw2', CUT + .06);
        cue(CUT, 'cut');
        const k3 = camTo(v, CUT - .35, .75, TW.draw);
        callout(v, TW.ink, 'Drawn from the same model', TW.inkDir, CUT + .6, OUT('tw'), k3);
      }
      // 7. the quick tour (version 16): the whole app on the laptop while the tour's own glass callout
      // glides from Needs you to the twin, over to the Printers screen and on to Files. The app's
      // callouts do the pointing, so the film adds none; each hop lands on a note.
      { const v = V.tg;
        camTo(v, SEG.tg.t0 - .6, 0, [0, 0, FW, FH]);
        ['needs', 'twin', 'fleet', 'files'].forEach((m, i) => { const t = at('v-tg', m); if (t < SEG.tg.t1) cue(t, 'card', { i }); });
        ripple(SEG.tg.t0, FRW * .3, FRH * .5, .7);
      }
      // 8. your phone (version 16): Connect your phone opens the sheet with its QR code; as the phone
      // scans it the laptop steps back and the phone comes forward, the dashboard open on it and paired.
      { const v = V.cp, PH0 = SEG.phone, SH = at('v-cp', 'sheet');
        camTo(v, SEG.cp.t0 - .6, 0, [0, 0, FW, FH]);
        const k = camTo(v, SH + .15, .7, CP.frame);
        callout(v, CP.qr, 'Point the phone’s camera here', 'r', SH + .45, PH0 - .35, k);
        rigTo(PH0 - .5, .9, 'back', { opacity: .55 }, 'power3.inOut');
        tl.fromTo('#ph', { opacity: 0, x: 380, y: 30, rotationY: -30, rotationX: 6, transformPerspective: 1800 },
          { opacity: 1, x: 0, y: 0, rotationY: -11, rotationX: 2, duration: .8, ease: 'expo.out', immediateRender: false }, PH0 - .3);
        tl.to('#ph', { rotationY: -2, duration: SEG.cp.t1 - PH0 - .2, ease: 'sine.inOut' }, PH0 + .5);
        cue(PH0 - .3, 'phone');
        ripple(PH0, FRW * .7, FRH * .5, .8);
      }

      // ===== bars 32-34: "and plenty more": the supporting features as stills (version 14: one per
      // eighth note, so all six are up for a second and a half) =====
      capOut('cp', SEG.more - .36);
      tl.to('#ph', { opacity: 0, x: 420, y: 0, rotationY: -28, duration: .55, ease: 'power2.in' }, SEG.more - .45);
      tl.to('#rig', { z: POSE.R.z - 700, y: '-=120', opacity: 0, duration: .5, ease: 'power2.in' }, SEG.more - .4);
      tl.to('#corner', { opacity: 0, duration: .3, ease: 'power1.in' }, SEG.more - .3);
      { const M0 = SEG.more;
        tl.set('#more', { opacity: 1 }, M0);
        tl.fromTo('#more-t', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, cue(M0, 'more'));
        ripple(M0, FRW * .2, FRH * .15, .9);
        MORE.forEach((m, i) => {
          const t = cue(M0 + B * (1 + i / 2), 'card', { i }), el = '#mc-' + m.id;
          tl.fromTo(el, { opacity: 0, y: 40, scale: .94 }, { opacity: 1, y: 0, scale: 1, duration: .5, ease: 'expo.out', immediateRender: false }, t);
          tl.fromTo(`${el} .ico *`, { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .05);
          tl.fromTo(el, { '--sx': '0%' }, { '--sx': '90%', duration: 3.5, ease: 'none', immediateRender: false }, t);
        });
        tl.fromTo('#more-g', { scale: 1, transformOrigin: '50% 40%' }, { scale: 1.035, duration: SEG.values - M0, ease: 'none', immediateRender: false }, M0);
        tl.to('#more', { opacity: 0, y: -30, duration: .3, ease: 'power2.in' }, SEG.values - .32);
        tl.to('#simtag', { opacity: 0, duration: .3, ease: 'power1.in' }, SEG.values - .3);
      }

      // ===== bars 34-36: why trust it, one value per beat =====
      gsap.utils.toArray('#values .v').forEach((el, i) => zin(el, cue(SEG.values + i * SEG.beat, 'value', { i }), .32));
      ripple(SEG.values, FRW / 2, FRH / 2, .9);
      tl.to('#values', { opacity: 0, y: -20, duration: .3, ease: 'power2.in' }, SEG.end - .32);

      // ===== the end card =====
      { const E = SEG.end;
        tl.set('#end', { opacity: 1 }, cue(E, 'end'));
        tl.fromTo('#end-row', { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: .7, ease: 'power3.out', immediateRender: false }, E);
        tl.fromTo('#end-tag', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .55, ease: 'power3.out', immediateRender: false }, E + .25);
        tl.fromTo('#term', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', immediateRender: false }, E + .45);
        ripple(E, FRW / 2, FRH * (V9 ? .2 : .2), 1);
        // version 14: get started folds in here, under the install lines
        tl.fromTo('#end-get', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .5, ease: 'power3.out', immediateRender: false }, E + 1.2);
        tl.fromTo('#end-meta', { opacity: 0 }, { opacity: 1, duration: .5 }, E + 1.5);
        tl.fromTo('#end-fine', { opacity: 0 }, { opacity: 1, duration: .5 }, E + 1.8);
        gsap.utils.toArray('#term .ln').forEach((ln, i) => {
          const times = TY[i], n = times.length - 1;
          tl.set(ln, { width: '2ch' }, i ? TY[i - 1][TY[i - 1].length - 1] + .05 : E + .45);
          for (let j = 0; j < n; j++) tl.set(ln, { width: (3 + j) + 'ch' }, times[j]);
        });
      }
