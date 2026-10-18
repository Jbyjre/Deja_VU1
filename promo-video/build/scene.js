      // Version 9: a 75-second SaaS promo that moves fast but reads easily. It opens on what the
      // app is for (who it is for, what it does, three promises), then the name, then the app
      // itself, sometimes on a laptop standing in 3D, sometimes full screen, one feature after
      // another, each with a short caption and one or two callouts. Every feature change is one
      // quick camera move on a bar line of the 160 BPM music, and every moment something appears
      // is put on the music's grid and written to CUES, so the music plays along with the picture
      // (music/compose9.py). Shared by both cuts; the layout CSS places things, this file times
      // them. build.py fills in M (each shot's clicks and marks), TY (the end-card typing) and
      // SEG (when each feature starts and ends).
      const FMT = '__FMT__', V9 = FMT === 'vertical';
      const M = /*MARKS*/{}/*END*/;
      const TY = /*TYPING*/[]/*END*/;
      const SEG = /*SEGS*/{}/*END*/;
      const $ = (s) => document.querySelector(s);
      const FW = 1440, FH = 900, SW = 1240, SH = 775;       // filmed page (CSS px), laptop screen
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
        au: '<path d="M27 4L11 27h12l-3 17 17-24H25z"/>',
        ca: '<path d="M31 6a9 9 0 0 0-8 12L8 33a3.6 3.6 0 0 0 5 5l15-15a9 9 0 0 0 12-8l-6 2-4-4 2-6z"/>',
        fi: '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="6"/><circle class="heat" cx="24" cy="24" r="12" stroke-dasharray="4 5"/>',
        co: '<circle cx="24" cy="24" r="18"/><path d="M30 17c-2-3-12-3-12 2.5S30 23 30 29s-10 5.5-12 2.5M24 11v4M24 33v4"/>',
        ha: '<path d="M7 23L24 8l17 15v18H7z"/><circle cx="24" cy="27" r="3"/><circle cx="17" cy="33" r="2"/><circle cx="31" cy="31" r="2"/><path d="M24 30v11M22 28l-4 4M26 28l4 2"/>',
        tl: '<circle cx="24" cy="26" r="16"/><path d="M24 17v9l6 4M19 5h10"/><path class="heat" d="M24 5v5"/>',
        ar: '<path d="M7 15V7h8M33 7h8v8M41 33v8h-8M15 41H7v-8"/><path d="M24 14l9 5v10l-9 5-9-5V19zM15 19l9 5 9-5M24 24v10"/>',
        ga: '<path d="M14 15h20a9 9 0 0 1 9 9v4a6 6 0 0 1-11 3.5L30 29H18l-2 2.5A6 6 0 0 1 5 28v-4a9 9 0 0 1 9-9z"/><path d="M14 20v7M10.5 23.5h7"/><circle class="fill" cx="31" cy="22" r="2.2"/><circle class="fill" cx="36" cy="26" r="2.2"/>',
        ph: '<rect x="13" y="4" width="22" height="40" rx="5"/><path d="M21 9h6"/><circle class="fill" cx="24" cy="37" r="2"/>',
      };
      const svgIcon = (id) => `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true">${IC[id]}</svg>`;


      // ---------- the features: twelve filmed ones, best first, the cherry on top last ----------
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
        { id: 'cv', lb: 'Convert for U1', k: 'Files ready for the U1', shot: 'D', cap: 'R',
          h: 'Any project, ready for the U1.', s: '<em>MakerWorld, NexPrint, OrcaSlicer.</em> One click.' },
        { id: 'sk', lb: 'Skip one object', k: 'Skip one object', shot: 'F', cap: 'R',
          h: 'Skip one failed part.', s: '<em>The rest keep printing.</em>' },
        { id: 'tw', lb: 'Digital twin', k: 'Digital twin', shot: 'F', cap: 'R',
          h: 'A live drawing of each printer.', s: '<em>Drawn to scale.</em> Turn it in 3D.' },
        { id: 'au', lb: 'Automations', k: 'Automations', shot: 'D', cap: 'L',
          h: 'When this happens, do that.', s: 'Alerts to <em>ntfy, Discord or Telegram</em>. No cloud.' },
        { id: 'ca', lb: 'Maintenance', k: 'Maintenance', shot: 'F', cap: 'L',
          h: 'Maintenance that keeps count.', s: 'Counted from <em>real print hours</em>.' },
        { id: 'fi', lb: 'Filament & Spoolman', k: 'Filament & Spoolman', shot: 'D', cap: 'R',
          h: 'Know what’s on the shelf.', s: '<em>Prints left</em> on every spool.' },
        { id: 'co', lb: 'Print cost', k: 'Print cost', shot: 'F', cap: 'R',
          h: 'What each print costs.', s: '<em>Filament plus electricity.</em>' },
        { id: 'ha', lb: 'Home Assistant', k: 'Home Assistant', shot: 'D', cap: 'R',
          h: 'Home Assistant, built in.', s: '<em>28 sensors</em> per printer. No add-on.' },
        { id: 'ga', lb: 'Ten games', k: 'Ten games', shot: 'D', cap: 'L',
          h: 'Something to play while it prints.', s: '<em>Ten games</em>, built in.' },
      ];
      const PH = { id: 'ph', cap: 'L', k: 'On your phone', h: 'And from your phone.', s: '<em>No account, no cloud.</em>' };
      // The opening (version 9, the owner: "change the first scene to defining the purpose of the
      // app"): who it is for, what it does, three promises, then the name. Each promise is a
      // feature shown later in the film: the live fleet, Confirm Print, Needs you.
      const PURPOSE = [
        { id: 'fl', t: 'Watch every print, <em>live</em>.' },
        { id: 'ok', t: 'Check every file <em>before it prints</em>.' },
        { id: 'ov', t: 'Know the moment one <em>needs you</em>.' },
      ];

      // ---------- DOM ----------
      $('#p-list').innerHTML = PURPOSE.map(p => `<div class="pi" id="pi-${p.id}"><div class="tile glass">${svgIcon(p.id)}</div><div class="t">${p.t}</div></div>`).join('');
      $('#caps').innerHTML = [...F, PH].map(f => `<div class="cap ${V9 ? 'T' : f.cap}" id="cap-${f.id}"><div class="card glass"><div class="in">
          <div class="k"><span class="mini">${svgIcon(f.id)}</span>${f.k.replace('&', '&amp;')}</div><div class="h">${f.h}</div><div class="s">${f.s}</div></div></div></div>`).join('');
      $('#keys').innerHTML = '<i></i>'.repeat(74) + '<i class="sp"></i>' + '<i></i>'.repeat(4);   // five rows of 14, then the space bar row
      const screen = $('#screen');
      const LAYERS = [...F.map(f => f.id), 'tw2'];
      LAYERS.forEach(id => { const l = document.createElement('div'); l.className = 'layer'; l.id = 'L-' + id; l.innerHTML = '<div class="cam"></div>'; screen.insertBefore(l, screen.querySelector('.glare')); });

      const V = {};
      function mount(viewEl, vid, vw, vh) {
        const s = Math.max(vw / FW, vh / FH), cam = viewEl.querySelector('.cam');
        Object.assign(cam.style, { width: FW * s + 'px', height: FH * s + 'px' });
        cam.appendChild(document.getElementById(vid));
        return { cam, vw, vh, s, safe: [0, 0, 1, 1], cs: 1 };
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
      } : {
        R: { x: 250, y: -150, z: -1000, rotationX: -10, rotationY: -15, lid: 16 },
        L: { x: -250, y: -150, z: -1000, rotationX: -10, rotationY: 15, lid: 16 },
        full: { x: 0, y: 2.5, z: 930, rotationX: 0, rotationY: 0, lid: 0 },
        back: { x: 220, y: -90, z: -1850, rotationX: -10, rotationY: -20, lid: 16 },
        rise: { x: 250, y: 1000, z: -1500, rotationX: -40, rotationY: -15, lid: 16 },
      };
      // In full screen the caption covers one side of the app, so the camera inside the screen
      // frames each detail in the part that stays clear (fractions of the screen).
      const SAFE = V9 ? { T: [.22, .03, .78, .97] } : { L: [.41, .09, .98, .91], R: [.02, .09, .59, .91] };
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
        return Math.max(Math.min(sw / (r[2] * v.s), sh / (r[3] * v.s)), Math.max(v.vw / (FW * v.s), v.vh / (FH * v.s)));
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
        if (d === 0) tl.set(v.cam, { scale: k, x, y }, t); else tl.to(v.cam, { scale: k, x, y, duration: d, ease }, t);
        return k;
      }
      // A callout: a dot on the thing, a short stem, a dark label, inside the screen's camera
      // (it stays on its target through every move) and scaled to keep one size on screen.
      function callout(v, pt, label, dir, tIn, tOut, k) {
        tIn = cue(snap(tIn), 'callout');
        const el = document.createElement('div'); el.className = 'co ' + dir;
        el.innerHTML = `<i class="dot"></i><b class="stem"></b><span class="pill">${label}</span>`;
        Object.assign(el.style, { left: pt[0] * v.s + 'px', top: pt[1] * v.s + 'px' });
        v.cam.appendChild(el);
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
        v.cam.appendChild(el);
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

      tl.fromTo('#pool-a', { x: 0, y: 0 }, { x: 170, y: 70, duration: 75, ease: 'none' }, 0);
      tl.fromTo('#pool-b', { x: 0, y: 0 }, { x: -150, y: -50, duration: 75, ease: 'none' }, 0);
      { const { lid, ...p } = POSE.rise; gsap.set('#rig', p); gsap.set('#lid', { rotationX: lid }); }

      // ===== 0-4.2 what it is for. Bar 0: the label, then the headline a word at a time, a piano
      // note on each word; bar 1: the band comes in on "screen." and the three promises land on
      // beats 3, 4 and the next 1, a chord on each. =====
      const B = SEG.beat;
      tl.fromTo('#p-for', { opacity: 0, y: 14, scale: .96 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: 'expo.out', immediateRender: false }, cue(0.05, 'for'));
      tl.fromTo('#p-for', { '--sx': '0%' }, { '--sx': '90%', duration: 4, ease: 'none', immediateRender: false }, 0);
      tl.fromTo('#p-for .ico *', { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .5, ease: 'power2.out', stagger: .04, immediateRender: false }, .1);
      gsap.utils.toArray('#p-head .w').forEach((w, i) => {
        tl.fromTo(w, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .4, ease: 'expo.out', immediateRender: false }, cue(B * (1 + i * .5), 'word', { i }));
      });
      PURPOSE.forEach((p, i) => {
        const t = cue(B * (6 + i), 'item', { i }), el = '#pi-' + p.id;
        tl.fromTo(el, { opacity: 0, y: 26, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: 'expo.out', immediateRender: false }, t);
        tl.fromTo(`${el} .ico *`, { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .04);
        tl.fromTo(`${el} .tile`, { '--sx': '0%' }, { '--sx': '100%', duration: 2.4, ease: 'none', immediateRender: false }, t);
      });
      tl.fromTo('#purpose', { scale: 1 }, { scale: 1.025, duration: 4.1, ease: 'none' }, 0);
      tl.to('#purpose', { y: V9 ? -160 : -120, opacity: 0, duration: .32, ease: 'power2.in' }, B * 11 - .32);

      // ===== bar 3 (4.5 s): the name, on a full chord and a cymbal =====
      const NAME = cue(B * 12, 'name');
      tl.set('#brand', { opacity: 1 }, NAME);
      tl.fromTo('#b-icon', { scale: .4, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: 'back.out(1.7)', immediateRender: false }, NAME);
      tl.to('#b-ring', { attr: { 'stroke-dashoffset': 0 }, duration: .6, ease: 'power3.out' }, NAME + .03);
      tl.fromTo('#b-dot', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: .35, ease: 'back.out(2)', immediateRender: false }, NAME + .12);
      tl.fromTo('#b-word', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, NAME + .06);
      tl.fromTo('#b-sub2', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .4, ease: 'power3.out', immediateRender: false }, NAME + B);
      tl.to('#brand', { y: V9 ? -420 : -260, opacity: 0, duration: .32, ease: 'power2.in' }, SEG.fl.t0 - .82);

      // ===== the features =====
      // The laptop rises into place, landing as the band comes in, and Fleet is clicked on its screen.
      const T0 = SEG.fl.t0;
      tl.set('#rig', { opacity: 1 }, T0 - .55);
      tl.set('#L-fl', { opacity: 1 }, T0 - .55);
      rigTo(T0 - .55, .9, shotPose(F[0]), {}, 'expo.out');
      tl.fromTo('#corner', { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: .5, ease: 'power3.out', immediateRender: false }, T0);
      tl.fromTo('#simtag', { opacity: 0 }, { opacity: 1, duration: .5, ease: 'power2.out', immediateRender: false }, T0);
      capIn('fl', T0 + .05);
      F.forEach(f => setView(V[f.id], shotPose(f), f.cap));
      setView(V.tw2, 'full', 'R');

      // Between two features: one continuous move. The caption fades, the laptop turns, dollies
      // in or steps back while its screen crossfades to the next app view (no cuts, no blur).
      F.forEach((f, i) => {
        if (!i) return;
        const p = F[i - 1], t0 = SEG[f.id].t0, from = shotPose(p), to = shotPose(f);
        capOut(p.id === 'ok' ? 'ph' : p.id, t0 - .38);
        capIn(f.id, t0 + .06);
        if (from === to) {                                   // full screen to full screen: a quick breath
          const z = POSE[to].z;
          tl.to('#rig', { z: z - 150, duration: .4, ease: 'power2.inOut' }, t0 - .4);
          tl.to('#rig', { z, duration: .55, ease: 'expo.out' }, t0);
        } else rigTo(t0 - .42, .85, to, p.id === 'ok' ? { opacity: 1 } : {}, 'power3.inOut');
        if (to === 'full' && from !== 'full') deck(false, t0 - .1);
        if (from === 'full' && to !== 'full' && p.id !== 'ok') deck(true, t0 - .42);
        // the new screen fades in on top of the old one, which only goes once it is covered
        tl.set('#L-' + f.id, { zIndex: 2 + i }, t0 - .26);
        tl.fromTo('#L-' + f.id, { scale: 1.04 }, { scale: 1, duration: .75, ease: 'expo.out', immediateRender: false }, t0 - .22);
        tl.fromTo('#L-' + f.id, { opacity: 0 }, { opacity: 1, duration: .32, ease: 'power1.inOut', immediateRender: false }, t0 - .22);
        tl.set('#L-' + (p.id === 'tw' ? 'tw2' : p.id), { opacity: 0 }, t0 + .14);
      });
      // The small logo shows over device shots only: full screen, it would sit on top of the app.
      F.forEach((f, i) => {
        if (!i) return;
        const was = F[i - 1].shot === 'D' || F[i - 1].id === 'ok', is = f.shot === 'D';
        if (was !== is) tl.to('#corner', { opacity: is ? 1 : 0, duration: .4, ease: 'power1.inOut' }, SEG[f.id].t0 - .4);
      });
      tl.to('#corner', { opacity: 1, duration: .5, ease: 'power1.inOut' }, SEG.ok.phone - .4);
      tl.to('#corner', { opacity: 0, duration: .5, ease: 'power1.inOut' }, SEG.ga.t0 + (M['v-ga'].start + M['v-ga'].clicks[1] - SEG.ga.t0));

      // While a feature plays the laptop keeps drifting a little closer (and, on the device,
      // turns towards the viewer), so the frame is never quite still.
      F.forEach(f => {
        const s = SEG[f.id], pose = POSE[shotPose(f)];
        const end = f.id === 'ok' ? s.phone - .5 : f.id === 'ga' ? null : s.t1 - .42;
        if (end === null) return;
        const drift = f.shot === 'F' ? { z: pose.z + 45 } : { z: pose.z + 110, rotationY: pose.rotationY * .75 };
        tl.to('#rig', { ...drift, duration: end - s.t0 - .45, ease: 'sine.inOut' }, s.t0 + .45);
      });

      // Version 8: one or two callouts per feature, each up long enough to read, so the eye
      // goes straight to the one thing that matters. OUT: when a feature's callouts leave.
      const OUT = id => SEG[id].t1 - .32;
      // 1. every printer, live
      { const v = V.fl, H = at('v-fl', 'hover');
        camTo(v, SEG.fl.t0 - .8, 0, [0, 0, FW, FH]);
        camTo(v, at('v-fl', 'cards') - .3, .8, [170, 280, 1110, 640]);
        const k = camTo(v, H - .5, .8, [470, 280, 700, 440]);
        spot(v, [556, 346, 336, 104], H + .1, OUT('fl'));
        callout(v, [592, 432], 'Progress', 'b', H + .15, OUT('fl'), k);
        callout(v, [760, 418], 'Finish time', 't', H + .45, OUT('fl'), k);
      }
      // 2. needs you
      { const v = V.ov, J = at('v-ov', 'jam');
        camTo(v, SEG.ov.t0 - .5, 0, [150, 220, 800, 600]);
        const k = camTo(v, J, .7, [165, 330, 760, 300]);
        spot(v, [172, 391, 1106, 98], J + .2, OUT('ov'));
        callout(v, [460, 470], 'A jam, the moment it happens', 'b', J + .35, OUT('ov'), k);
      }
      // 3. confirm print, then the phone
      { const v = V.ok, P = click('v-ok', 1), G = click('v-ok', 2), PH0 = SEG.ok.phone;
        camTo(v, SEG.ok.t0 - .5, 0, [600, 250, 760, 330]);
        const k = camTo(v, P + .1, .75, [350, 250, 740, 400]);
        spot(v, [383, 364, 674, 50], P + .55, G - .25);
        callout(v, [720, 410], 'Every check passed', 'b', P + .65, G - .25, k);
        const k2 = camTo(v, G + .1, .7, [520, 20, 760, 380]);
        callout(v, [720, 110], 'Started, confirmed by the printer', 'b', G + .45, PH0 - .4, k2);
        // ...and from your phone: the laptop steps back, the phone comes forward
        capOut('ok', PH0 - .4);
        rigTo(PH0 - .5, .9, 'back', { opacity: .55 }, 'power3.inOut');
        deck(true, PH0 - .5);
        tl.fromTo('#ph', { opacity: 0, x: V9 ? 0 : 380, y: V9 ? 420 : 30, rotationY: V9 ? -14 : -30, rotationX: 6, transformPerspective: 1800 },
          { opacity: 1, x: 0, y: 0, rotationY: V9 ? -5 : -11, rotationX: 2, duration: .8, ease: 'expo.out', immediateRender: false }, PH0 - .3);
        tl.to('#ph', { rotationY: V9 ? 4 : -2, duration: SEG.ok.t1 - PH0 - .2, ease: 'sine.inOut' }, PH0 + .5);
        capIn('ph', PH0 + .06);
        cue(PH0 - .3, 'phone');
        tl.to('#ph', { opacity: 0, x: V9 ? 0 : 420, y: V9 ? 380 : 0, rotationY: V9 ? -10 : -28, duration: .55, ease: 'power2.in' }, SEG.ok.t1 - .45);
      }
      // 4. files ready for the U1
      { const v = V.cv, C = click('v-cv', 1), RP = at('v-cv', 'report');
        camTo(v, SEG.cv.t0 - .5, 0, [560, 280, 800, 400]);
        const k = camTo(v, C - .5, .6, [700, 330, 620, 240]);
        callout(v, [918, 422], 'One click', 't', C - .35, C + .4, k);
        const k2 = camTo(v, C + .3, .75, [760, 560, 560, 340]);
        callout(v, [1010, 690], 'Converted for the U1', 't', RP - .15, OUT('cv'), k2);
      }
      // 5. skip one object
      { const v = V.sk, PK = at('v-sk', 'pick'), S = at('v-sk', 'skip');
        camTo(v, SEG.sk.t0 - .5, 0, [300, 140, 800, 420]);
        const k = camTo(v, PK - .5, .7, [440, 170, 800, 300]);
        spot(v, [492, 243, 772, 46], PK + .1, OUT('sk'));
        callout(v, [640, 278], 'Pick the failed part', 'b', PK + .15, S - .1, k);
        callout(v, [640, 278], 'Skipped. The rest keep going.', 'b', S + .25, OUT('sk'), k);
      }
      // 6. the digital twin: the 3D view longest (turned by hand), then front and top
      { const v = V.tw, v2 = V.tw2, O = at('v-tw', 'orbit'), FR = at('v-tw2', 'front'), CUT = SEG.twinCut;
        const r = [130, 95, 510, 600];
        camTo(v, SEG.tw.t0 - .5, 0, r); camTo(v2, SEG.tw.t0 - .5, 0, r);
        const k = camK(v, r);
        callout(v, [330, 330], 'Drag to turn it in 3D', 'r', O + .15, CUT - .3, k);
        tl.set('#L-tw2', { zIndex: 30 }, CUT - .25);
        cue(CUT, 'cut');
        tl.fromTo('#L-tw2', { opacity: 0 }, { opacity: 1, duration: .35, ease: 'power1.inOut', immediateRender: false }, CUT - .2);
        tl.set('#L-tw', { opacity: 0 }, CUT + .2);
        callout(v2, [330, 218], 'Front and top, drawn to scale', 'r', FR + .05, OUT('tw'), k);
      }
      // 7. automations (version 8: on the laptop, in the studio's old place): a ready-made rule
      // in one click, then saved
      { const v = V.au, T = at('v-au', 'template'), S = at('v-au', 'save');
        camTo(v, SEG.au.t0 - .5, 0, [160, 220, 900, 640]);
        const k = camTo(v, T - .45, .7, [160, 310, 760, 520]);
        callout(v, [575, 410], 'Ready-made rules', 'r', T + .05, S - .9, k);
        const k2 = camTo(v, S - .45, .75, [150, 440, 800, 360]);
        callout(v, [366, 709], 'Saved. It runs on your computer.', 'r', S + .3, OUT('au'), k2);
      }
      // 8. maintenance: overdue tasks, one marked done
      { const v = V.ca, O = at('v-ca', 'overdue'), D = at('v-ca', 'done');
        camTo(v, SEG.ca.t0 - .5, 0, [150, 100, 800, 640]);
        const k = camTo(v, O - .6, .7, [170, 380, 780, 260]);
        spot(v, [178, 396, 1084, 112], O - .1, D - .1);
        callout(v, [418, 423], 'Overdue', 't', O, D - .1, k);
        const k2 = camTo(v, D + .1, .7, [420, 0, 700, 420]);
        callout(v, [720, 62], 'Done: the count starts again', 'b', D + .35, OUT('ca'), k2);
      }
      // 9. filament: the inventory switched on, then how long each spool will last
      { const v = V.fi, SP = at('v-fi', 'spools'), FO = at('v-fi', 'forecast');
        camTo(v, SEG.fi.t0 - .5, 0, [0, 0, FW, FH]);
        const k = camTo(v, SP - .7, .7, [140, 260, 640, 520]);
        callout(v, [612, 481], 'Running low', 'r', SP - .1, FO - .2, k);
        const k2 = camTo(v, FO + .3, .7, [130, 420, 700, 400]);
        callout(v, [645, 534], 'Prints left on each spool', 't', FO + .9, OUT('fi'), k2);
      }
      // 10. print cost: the print running now
      { const v = V.co, C = at('v-co', 'card');
        camTo(v, SEG.co.t0 - .5, 0, [150, 200, 800, 600]);
        const k = camTo(v, C - .35, .75, [150, 400, 800, 330]);
        spot(v, [188, 474, 1074, 36], C + .3, OUT('co'));
        callout(v, [430, 478], 'This print, so far', 't', C + .4, OUT('co'), k);
      }
      // 11. Home Assistant: the bridge switched on, its address typed in; the sensors float out
      { const v = V.ha, FL = at('v-ha', 'field'), TY2 = at('v-ha', 'typed');
        camTo(v, SEG.ha.t0 - .5, 0, [560, 100, 880, 560]);
        const k = camTo(v, SEG.ha.t0 + .15, .75, [660, 150, 700, 440]);
        callout(v, [975, 340], 'Just its address', 'b', TY2 + .05, OUT('ha'), k);
        const rows = ['printer state', 'print progress', 'time remaining (estimate)', 'T0 to T3 temperatures'];   // 7 of the 28 sensors (home_assistant_bridge.py)
        $('#ha-in').innerHTML = '<div class="t">Home Assistant <b>28 sensors</b></div>' + rows.map(r => `<div class="row"><i></i>${r}</div>`).join('') + '<div class="row more">+ 21 more for each U1</div>';
        tl.fromTo('#ha-card', { opacity: 0, x: V9 ? 0 : -50, y: V9 ? 50 : 30, z: -200, rotationY: V9 ? 0 : 16, transformPerspective: 1600 },
          { opacity: 1, x: 0, y: 0, z: 0, rotationY: V9 ? 0 : 7, duration: .7, ease: 'expo.out', immediateRender: false }, FL + .2);
        tl.fromTo('#ha-card', { '--sx': '0%' }, { '--sx': '90%', duration: 3.5, ease: 'none', immediateRender: false }, FL + .2);
        const R0 = snap(FL + .45);
        gsap.utils.toArray('#ha-card .row').forEach((r, i) => tl.fromTo(r, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: .28, ease: 'power3.out', immediateRender: false }, cue(R0 + i * SEG.beat / 2, 'row', { i })));
        tl.to('#ha-card', { opacity: 0, y: -16, duration: .3, ease: 'power1.in' }, SEG.ha.t1 - .4);
      }
      // 12. the cherry on top: ten games. The laptop, then a push into the game as it starts.
      { const v = V.ga, SF = click('v-ga', 1), TB = at('v-ga', 'tab');
        camTo(v, SEG.ga.t0 - .5, 0, [0, 0, FW, FH]);
        const k = camTo(v, TB + .05, .7, [150, 300, 1140, 600]);
        callout(v, [612, 338], 'Ten games, built in', 't', TB + .35, SF - .1, k);
        tl.to('#rig', { z: POSE.R.z + 70, rotationY: POSE.R.rotationY * .8, duration: Math.max(.3, SF - SEG.ga.t0 - .45), ease: 'sine.inOut' }, SEG.ga.t0 + .45);
        rigTo(SF + .1, 1.1, 'full', {}, 'power3.inOut');
        deck(false, SF + .7);
        v.safe = SAFE[V9 ? 'T' : 'L'];
        camTo(v, SF + .1, 1.1, [360, 420, 720, 430], 'power3.inOut');
      }

      // ===== the values, one per beat of the music =====
      capOut('ga', SEG.values - .35);
      tl.to('#rig', { z: POSE.full.z - 500, opacity: 0, duration: .5, ease: 'power2.in' }, SEG.values - .35);
      tl.to(['#corner', '#simtag'], { opacity: 0, duration: .3, ease: 'power1.in' }, SEG.values - .3);
      gsap.utils.toArray('#values .v').forEach((el, i) => zin(el, cue(SEG.values + i * SEG.beat, 'value', { i }), .32));
      tl.to('#values', { opacity: 0, y: -20, duration: .3, ease: 'power2.in' }, SEG.end - .3);

      // ===== the end card =====
      { const E = SEG.end;
        tl.set('#end', { opacity: 1 }, cue(E, 'end'));
        tl.fromTo('#end-row', { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: .7, ease: 'power3.out', immediateRender: false }, E);
        tl.fromTo('#end-tag', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .55, ease: 'power3.out', immediateRender: false }, E + .25);
        tl.fromTo('#term', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', immediateRender: false }, E + .45);
        tl.fromTo('#end-meta', { opacity: 0 }, { opacity: 1, duration: .5 }, E + .8);
        tl.fromTo('#end-fine', { opacity: 0 }, { opacity: 1, duration: .5 }, E + 1.1);
        gsap.utils.toArray('#term .ln').forEach((ln, i) => {
          const times = TY[i], n = times.length - 1;
          tl.set(ln, { width: '2ch' }, i ? TY[i - 1][TY[i - 1].length - 1] + .05 : E + .45);
          for (let j = 0; j < n; j++) tl.set(ln, { width: (3 + j) + 'ch' }, times[j]);
        });
      }
