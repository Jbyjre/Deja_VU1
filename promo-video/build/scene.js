      // Version 6: a SaaS promo. Every feature as an icon in under three seconds, the name, then
      // the app itself on a laptop (and a phone) standing in 3D, one feature after another, each
      // with a floating glass caption. Shared by both cuts; the layout CSS places things, this
      // file times them. build.py fills in M (each shot's clicks and marks), TY (the end-card
      // typing) and SEG (when each feature starts and ends).
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

      // ---------- the fifteen features, best first, the cherry on top last ----------
      // side: which side of the frame the laptop (or the illustration) stands on in 16:9.
      const F = [
        { id: 'fl', lb: 'Live fleet', k: 'Every printer, live', side: 'R',
          h: 'See every printer at once.', s: 'Up to <em>12 printers</em> on one screen, updated <em>four times a second</em>.' },
        { id: 'ov', lb: 'Needs you', k: 'Needs you', side: 'L',
          h: 'Know what needs you.', s: 'One list across the farm, <em>most urgent first</em>. A jam shows up the moment it happens.' },
        { id: 'ok', lb: 'Confirm Print', k: 'Confirm Print', side: 'R',
          h: 'Every print is checked first.', s: 'File, filament colours, maintenance and cost. The server <em>checks again</em> as it starts.' },
        { id: 'cv', lb: 'Convert for U1', k: 'Files ready for the U1', side: 'L',
          h: 'Convert projects in one click.', s: '<em>MakerWorld, NexPrint and OrcaSlicer</em> projects, set up for the U1, multi-plate included.' },
        { id: 'sk', lb: 'Skip one object', k: 'Skip one object', side: 'R',
          h: 'Skip one failed part.', s: 'One object on the plate failed? Skip just that one. <em>The rest keep printing.</em>' },
        { id: 'tw', lb: 'Digital twin', k: 'Digital twin', side: 'L',
          h: 'A live drawing of each printer.', s: 'Toolheads, bed and position <em>drawn to scale</em>, live. Turn it in 3D, or read it front and top.' },
        { id: 'st', lb: 'Photo studio', k: 'Photo-to-Print Studio', side: 'R',
          h: 'A photo becomes a relief.', s: 'Pick a photo and the studio models a <em>layered relief in four filament colours</em>.' },
        { id: 'au', lb: 'Automations', k: 'Automations', side: 'L',
          h: 'When this happens, do that.', s: 'Alerts to <em>ntfy, Discord or Telegram</em>, a light, Home Assistant, or pause the print. No cloud.' },
        { id: 'ca', lb: 'Maintenance', k: 'Maintenance', side: 'R',
          h: 'Maintenance that keeps count.', s: '<em>Seven tasks</em> tracked from real print hours. Mark one done and its counter starts again.' },
        { id: 'fi', lb: 'Filament & Spoolman', k: 'Filament & Spoolman', side: 'L',
          h: 'Know what’s on the shelf.', s: 'Every spool, the grams left and <em>how many prints it will last</em>. Import them from Spoolman.' },
        { id: 'co', lb: 'Print cost', k: 'Print cost', side: 'R',
          h: 'What each print costs.', s: '<em>Filament plus electricity</em>, for the print running now and every print before it.' },
        { id: 'ha', lb: 'Home Assistant', k: 'Home Assistant', side: 'L',
          h: 'Home Assistant, built in.', s: '<em>28 sensors</em> for each U1, sent straight to Home Assistant. No MQTT broker, no add-on.' },
        { id: 'tl', lb: 'Time-lapse', k: 'Time-lapse', side: 'R',
          h: 'Every print, as a time-lapse.', s: 'With your printer’s camera: <em>a frame every two layers</em>, played back as a flipbook.' },
        { id: 'ar', lb: 'AR preview', k: 'AR preview', side: 'L',
          h: 'See it on your desk first.', s: 'Place an STL or 3MF on your desk <em>at its real printed size</em>, through your phone’s camera.' },
        { id: 'ga', lb: 'Ten games', k: 'Ten games', side: 'R',
          h: 'Something to do while it prints.', s: '<em>Ten games</em> built in: Sky Dash, Tetris, Pac-Man, Snake and six more.' },
      ];
      const PH = { id: 'ph', side: 'R', k: 'On your phone', h: 'And from your phone.', s: 'The same dashboard, <em>made for thumbs</em>. No account, no cloud: it talks straight to your computer.' };
      const VIDEO = ['fl', 'ov', 'ok', 'cv', 'sk', 'tw', 'st', 'au', 'ca', 'fi', 'co', 'ha', 'ga'];   // tl and ar are drawn

      // ---------- DOM ----------
      $('#grid').innerHTML = F.map(f => `<div class="ft" id="ft-${f.id}"><div class="tile glass">${svgIcon(f.id)}</div><div class="lb">${f.lb.replace('&', '&amp;')}</div></div>`).join('');
      $('#b-sub').innerHTML = ['One', 'screen', 'for', '<span class="hl">every U1</span>', 'you', 'run.'].map(w => `<span class="word">${w}</span>`).join(' ');
      $('#caps').innerHTML = [...F, PH].map(f => `<div class="cap ${V9 ? 'T' : f.side === 'R' ? 'L' : 'R'}" id="cap-${f.id}"><div class="card glass"><div class="in">
          <div class="k"><span class="mini">${svgIcon(f.id)}</span>${f.k.replace('&', '&amp;')}</div><div class="h">${f.h}</div><div class="s">${f.s}</div></div></div></div>`).join('');
      const screen = $('#screen');
      VIDEO.forEach(id => { const l = document.createElement('div'); l.className = 'layer'; l.id = 'L-' + id; l.innerHTML = '<div class="cam"></div>'; screen.insertBefore(l, $('#Wchip')); });

      const V = {};
      function mount(viewEl, vid, vw, vh) {
        const s = Math.max(vw / FW, vh / FH), cam = viewEl.querySelector('.cam');
        Object.assign(cam.style, { width: FW * s + 'px', height: FH * s + 'px' });
        cam.appendChild(document.getElementById(vid));
        return { cam, vw, vh, s };
      }
      VIDEO.forEach(id => { V[id] = mount($('#L-' + id), 'v-' + id, SW, SH); });
      (() => { const cam = document.createElement('div'); cam.className = 'cam'; Object.assign(cam.style, { inset: '0', width: '100%', height: '100%' });
        cam.appendChild($('#v-ph')); $('#ph-screen').appendChild(cam); })();
      document.querySelectorAll('.ico path, .ico rect, .ico circle:not(.fill)').forEach(el => {
        if (el.getAttribute('stroke-dasharray')) return;
        const n = el.getTotalLength ? el.getTotalLength() : 200;
        el.style.strokeDasharray = n; el.dataset.len = n;
      });

      // ---------- motion vocabulary ----------
      const tl = gsap.timeline({ paused: true });
      function camK(v, r) {
        return Math.max(Math.min(v.vw / (r[2] * v.s), v.vh / (r[3] * v.s)), Math.max(v.vw / (FW * v.s), v.vh / (FH * v.s)));
      }
      // Frame a rectangle of the footage (CSS px of the filmed page) on the laptop screen; returns the zoom.
      function camTo(v, t, d, r, ease = 'expo.inOut') {
        const k = camK(v, r), cx = (r[0] + r[2] / 2) * v.s, cy = (r[1] + r[3] / 2) * v.s;
        let x = v.vw / 2 - k * cx, y = v.vh / 2 - k * cy;
        x = Math.min(0, Math.max(v.vw - k * FW * v.s, x)); y = Math.min(0, Math.max(v.vh - k * FH * v.s, y));
        if (d === 0) tl.set(v.cam, { scale: k, x, y }, t); else tl.to(v.cam, { scale: k, x, y, duration: d, ease }, t);
        return k;
      }
      // A callout: a dot on the thing, a short stem, a dark label, inside the screen's camera
      // (it stays on its target through every zoom) and scaled by 1/zoom (one text size).
      function callout(v, pt, label, dir, tIn, tOut, k) {
        const el = document.createElement('div'); el.className = 'co ' + dir;
        el.innerHTML = `<i class="dot"></i><b class="stem"></b><span class="pill">${label}</span>`;
        Object.assign(el.style, { left: pt[0] * v.s + 'px', top: pt[1] * v.s + 'px' });
        v.cam.appendChild(el);
        tl.set(el, { scale: 1 / k, transformOrigin: '0 0' }, 0);
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: .25, ease: 'power2.out', immediateRender: false }, tIn);
        tl.fromTo(el.querySelector('.dot'), { scale: 0 }, { scale: 1, duration: .4, ease: 'back.out(3)', immediateRender: false }, tIn);
        tl.fromTo(el.querySelector('.stem'), { scale: 0 }, { scale: 1, duration: .3, ease: 'expo.out', immediateRender: false,
          transformOrigin: { r: '0 50%', l: '100% 50%', t: '50% 100%', b: '50% 0' }[dir] }, tIn + .05);
        tl.fromTo(el.querySelector('.pill'), { opacity: 0 }, { opacity: 1, duration: .35, ease: 'expo.out', immediateRender: false }, tIn + .12);
        tl.to(el, { opacity: 0, duration: .2, ease: 'power2.in' }, tOut);
      }
      function spot(v, r, tIn, tOut) {
        const el = document.createElement('div'); el.className = 'spot';
        Object.assign(el.style, { left: r[0] * v.s + 'px', top: r[1] * v.s + 'px', width: r[2] * v.s + 'px', height: r[3] * v.s + 'px' });
        v.cam.appendChild(el);
        tl.fromTo(el, { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: .35, ease: 'expo.out', immediateRender: false }, tIn);
        tl.to(el, { opacity: 0, duration: .25, ease: 'power2.in' }, tOut);
      }
      function zin(el, t, d = .4) {
        tl.fromTo(el, { opacity: .15, scale: .85, filter: 'blur(10px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: d, ease: 'expo.out', immediateRender: false }, t);
      }
      // the laptop's poses: R / L = standing right / left of the caption, turned towards it
      const POSE = V9 ? {
        R: { x: 0, y: 170, scale: .68, rotationY: -12, rotationX: 5 },
        L: { x: 0, y: 170, scale: .68, rotationY: 12, rotationX: 5 },
        back: { x: 0, y: 330, scale: .5, rotationY: -6, rotationX: 5 },
        rise: { x: 0, y: 1100, scale: .6, rotationY: 0, rotationX: 40 },
      } : {
        R: { x: 255, y: 26, scale: .79, rotationY: -15, rotationX: 4 },
        L: { x: -255, y: 26, scale: .79, rotationY: 15, rotationX: 4 },
        back: { x: 120, y: -10, scale: .62, rotationY: -22, rotationX: 4 },
        rise: { x: 0, y: 900, scale: .74, rotationY: 0, rotationX: 40 },
      };
      const DRIFT = 4;     // degrees the laptop turns towards the viewer during one feature
      function capIn(id, t) {
        const c = '#cap-' + id, dx = V9 ? 0 : $(c).classList.contains('L') ? -50 : 50;
        tl.set(c, { opacity: 1 }, t);
        tl.fromTo(`${c} .card`, { opacity: 0, x: dx, y: V9 ? -30 : 0, scale: .96 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: .55, ease: 'expo.out', immediateRender: false }, t);
        tl.fromTo(`${c} .k`, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: .4, ease: 'expo.out', immediateRender: false }, t + .1);
        tl.fromTo(`${c} .h`, { opacity: 0, y: 26, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .5, ease: 'expo.out', immediateRender: false }, t + .18);
        tl.fromTo(`${c} .s`, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, t + .38);
        tl.fromTo(`${c} .mini .ico *`, { strokeDashoffset: (i, el) => el.dataset.len || 0 }, { strokeDashoffset: 0, duration: .6, ease: 'power2.out', stagger: .05, immediateRender: false }, t + .12);
        tl.fromTo(`${c} .card`, { '--sx': '0%' }, { '--sx': '90%', duration: 6, ease: 'none', immediateRender: false }, t);
      }
      function capOut(id, t) {
        tl.to(`#cap-${id} .card`, { opacity: 0, y: V9 ? -20 : 0, x: 0, scale: .97, duration: .25, ease: 'power3.in' }, t);
        tl.set('#cap-' + id, { opacity: 0 }, t + .26);
      }
      // the laptop turns to its new side while its screen cuts the curve to the next feature
      function rigTo(t, d, pose, extra = {}) { tl.to('#rig', { ...POSE[pose], ...extra, duration: d, ease: 'expo.inOut' }, t); }
      function screenSwap(a, b, t) {
        if (a) { tl.to(a, { x: -240, filter: 'blur(14px)', duration: .22, ease: 'power4.in' }, t - .22); tl.to(a, { opacity: 0, duration: .22, ease: 'none' }, t - .22); }
        tl.fromTo(b, { x: 240, opacity: .2, filter: 'blur(14px)' }, { x: 0, opacity: 1, filter: 'blur(0px)', duration: .45, ease: 'power4.out', immediateRender: false }, t);
      }

      tl.fromTo('#pool-a', { x: 0, y: 0 }, { x: 170, y: 70, duration: 117, ease: 'none' }, 0);
      tl.fromTo('#pool-b', { x: 0, y: 0 }, { x: -150, y: -50, duration: 117, ease: 'none' }, 0);
      gsap.set('#rig', POSE.rise);

      // ===== 0-2.9 every feature as an icon, one per sixteenth note (a vibraphone note each) =====
      F.forEach((f, i) => {
        const t = .1 + i * .125, el = '#ft-' + f.id;
        tl.fromTo(el, { opacity: 0, scale: .4, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: .45, ease: 'back.out(2)', immediateRender: false }, t);
        tl.fromTo(`${el} .ico *`, { strokeDashoffset: (j, e) => e.dataset.len || 0 }, { strokeDashoffset: 0, duration: .45, ease: 'power2.out', stagger: .03, immediateRender: false }, t + .05);
        tl.fromTo(`${el} .tile`, { '--sx': '0%' }, { '--sx': '100%', duration: 2.4, ease: 'none', immediateRender: false }, t);
      });
      tl.fromTo('#grid', { scale: 1 }, { scale: 1.04, duration: 2.5, ease: 'none' }, .1);
      // ...then they all fly into the middle and become the app icon
      { const g = $('#grid').getBoundingClientRect(), cx = g.left + g.width / 2, cy = g.top + g.height / 2;
        F.forEach((f, i) => {
          const r = $('#ft-' + f.id).getBoundingClientRect(), dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
          const d = Math.hypot(dx, dy);
          tl.to('#ft-' + f.id, { x: dx, y: dy, scale: .25, opacity: 0, duration: .42, ease: 'power3.in' }, 2.5 + (1 - d / 900) * .12);
        }); }

      // ===== 2.9-5.5 the name and the one line =====
      tl.set('#brand', { opacity: 1 }, 2.85);
      tl.fromTo('#b-icon', { scale: .3, opacity: 0, rotation: -20 }, { scale: 1, opacity: 1, rotation: 0, duration: .6, ease: 'back.out(1.8)', immediateRender: false }, 2.85);
      tl.to('#b-ring', { attr: { 'stroke-dashoffset': 0 }, duration: .7, ease: 'expo.out' }, 2.9);
      tl.fromTo('#b-dot', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: .45, ease: 'back.out(2.4)', immediateRender: false }, 3.05);
      tl.fromTo('#b-word', { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .5, ease: 'expo.out', immediateRender: false }, 3.0);
      gsap.utils.toArray('#b-sub .word').forEach((w, i) => tl.fromTo(w, { opacity: 0, y: 30, filter: 'blur(8px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: .3, ease: 'expo.out', immediateRender: false }, 3.45 + i * .14));
      tl.fromTo('#b-sub2', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, 4.35);
      tl.to('#brand', { y: V9 ? -500 : -320, scale: .7, opacity: 0, duration: .45, ease: 'power3.in' }, 5.3);

      // ===== the features =====
      const first = F[0];
      tl.set('#rig', { opacity: 1 }, 5.35);
      tl.to('#rig', { ...POSE[V9 ? 'R' : first.side], duration: .95, ease: 'expo.out' }, 5.35);
      tl.set('#L-fl', { opacity: 1 }, 5.3);
      tl.fromTo('#corner', { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: .5, ease: 'expo.out', immediateRender: false }, 6.0);
      let prevVideo = null;
      F.forEach((f, i) => {
        const s = SEG[f.id], side = V9 ? (i % 2 ? 'L' : 'R') : f.side;
        capIn(f.id, s.t0 + (i ? .2 : .25));
        if (f.id !== 'ok') capOut(f.id, s.t1 - .3);
        if (f.id === 'tl' || f.id === 'ar') return;            // drawn, see below
        if (i) {
          if (F[i - 1].id === prevVideo) {     // straight from another screen: turn and cut the curve
            rigTo(s.t0 - .45, .9, side);
            screenSwap('#L-' + prevVideo, '#L-' + f.id, s.t0);
          } else {                                              // back from a drawing: the laptop comes back in
            tl.set('#L-' + prevVideo, { opacity: 0 }, s.t0 - .5); tl.set('#L-' + f.id, { opacity: 1, x: 0, filter: 'blur(0px)' }, s.t0 - .5);
            tl.fromTo('#rig', { ...POSE[side], x: POSE[side].x + (V9 ? 0 : 500), y: POSE[side].y + (V9 ? 700 : 0), opacity: 0 },
              { ...POSE[side], opacity: 1, duration: .8, ease: 'expo.out', immediateRender: false }, s.t0 - .35);
          }
        }
        // a slow turn towards the viewer while the feature plays
        const turn = POSE[side].rotationY > 0 ? -DRIFT : DRIFT;
        tl.to('#rig', { rotationY: POSE[side].rotationY + turn, scale: POSE[side].scale * 1.025, duration: s.t1 - s.t0 - 1.0, ease: 'sine.inOut' }, s.t0 + .5);
        prevVideo = f.id;
      });

      // 1. every printer, live
      { const v = V.fl, H = at('v-fl', 'hover');
        camTo(v, 5.3, 0, [0, 0, FW, FH]);
        camTo(v, at('v-fl', 'cards') - .2, .8, [170, 280, 1110, 640]);
        const k = camTo(v, H - .5, .8, [470, 280, 700, 440]);
        spot(v, [556, 346, 336, 104], H + .1, SEG.fl.t1 - .3);
        callout(v, [592, 432], 'Progress', 'b', H + .3, SEG.fl.t1 - .3, k);
        callout(v, [760, 418], 'Finish time', 't', H + .75, SEG.fl.t1 - .3, k);
      }
      // 2. needs you
      { const v = V.ov, J = at('v-ov', 'jam'), R = at('v-ov', 'row');
        camTo(v, SEG.ov.t0 - .3, 0, [150, 200, 1140, 640]);
        const k = camTo(v, J + .15, .6, [165, 330, 1120, 420]);
        spot(v, [172, 391, 1106, 98], J + .35, SEG.ov.t1 - .3);
        callout(v, [460, 470], 'A jam, the moment it happens', 'b', J + .55, SEG.ov.t1 - .3, k);
        callout(v, [1195, 406], 'Act on it here', 'l', R + .1, SEG.ov.t1 - .3, k);
      }
      // 3. confirm print, then the phone
      { const v = V.ok, P = click('v-ok', 1), G = click('v-ok', 2), PH0 = SEG.ok.phone;
        camTo(v, SEG.ok.t0 - .3, 0, [160, 180, 1120, 600]);
        const k1 = camTo(v, P - .75, .6, [700, 300, 620, 240]);
        callout(v, [870, 378], 'Pre-flight: clear', 't', P - .25, P + .25, k1);
        const k = camTo(v, P + .25, .6, [350, 250, 740, 400]);
        spot(v, [383, 364, 674, 50], P + .8, G - .3);
        callout(v, [720, 410], 'Every check passed', 'b', P + 1.0, G - .3, k);
        callout(v, [1003, 575], 'Start print', 'l', G - .9, G + .1, k);
        const k2 = camTo(v, G + .2, .6, [440, 20, 860, 400]);
        callout(v, [720, 110], 'Confirmed by the printer', 'b', G + .65, PH0 - .2, k2);
        // ...and from your phone: the laptop steps back, the phone comes forward
        capOut('ok', PH0 - .3);
        rigTo(PH0 - .35, .8, 'back', { opacity: .55 });
        tl.fromTo('#ph', { opacity: 0, x: V9 ? 0 : 420, y: V9 ? 500 : 0, rotationY: V9 ? -10 : -30, transformPerspective: 1800 },
          { opacity: 1, x: 0, y: 0, rotationY: V9 ? -4 : -10, duration: .75, ease: 'power4.out', immediateRender: false }, PH0 - .2);
        tl.to('#ph', { rotationY: V9 ? 4 : 2, duration: SEG.ok.t1 - PH0 - .2, ease: 'none' }, PH0 + .55);
        capIn('ph', PH0 + .05); capOut('ph', SEG.ok.t1 - .3);
        tl.to('#ph', { opacity: 0, x: V9 ? 0 : -260, y: V9 ? 300 : 0, duration: .35, ease: 'power3.in' }, SEG.ok.t1 - .3);
        tl.to('#rig', { opacity: 1, duration: .6, ease: 'power2.out' }, SEG.ok.t1 - .35);
      }
      // 4. files ready for the U1
      { const v = V.cv, C = click('v-cv', 1), RP = at('v-cv', 'report');
        camTo(v, SEG.cv.t0 - .3, 0, [170, 180, 1110, 600]);
        const k = camTo(v, C - .8, .6, [700, 330, 620, 240]);
        callout(v, [918, 422], 'One click', 't', C - .3, C + .5, k);
        const k2 = camTo(v, C + .4, .7, [760, 560, 560, 340]);
        callout(v, [1010, 690], 'Converted for the U1', 't', RP, SEG.cv.t1 - .3, k2);
      }
      // 5. skip one object
      { const v = V.sk, PK = at('v-sk', 'pick'), A = at('v-sk', 'ask'), S = at('v-sk', 'skip');
        camTo(v, SEG.sk.t0 - .3, 0, [0, 0, FW, FH]);
        camTo(v, at('v-sk', 'plate') - .5, .8, [140, 100, 1160, 500]);
        const k = camTo(v, PK - .5, .6, [440, 170, 860, 300]);
        spot(v, [492, 243, 772, 46], PK + .15, SEG.sk.t1 - .3);
        callout(v, [640, 278], 'Pick the failed part', 'b', PK + .3, A - .1, k);
        callout(v, [553, 412], 'Confirm', 'r', A + .2, S - .1, k);
        callout(v, [640, 278], 'Skipped. The rest keep going.', 'b', S + .4, SEG.sk.t1 - .3, k);
      }
      // 6. the digital twin: the 3D view gets the most time (turned by hand), then front and top
      { const v = V.tw, O = at('v-tw', 'orbit'), FR = at('v-tw', 'front'), T = at('v-tw', 'top'), I = at('v-tw', 'iso');
        camTo(v, SEG.tw.t0 - .3, 0, [0, 0, FW, FH]);
        const k = camTo(v, SEG.tw.t0 + .3, .8, [130, 95, 510, 600]);
        callout(v, [330, 330], 'Drag to turn it in 3D', 'r', O + .3, FR - .6, k);
        callout(v, [330, 218], 'Front and top views', 'r', FR + .1, I - .1, k);
        callout(v, [400, 548], 'Drawn to scale, live', 't', I + .4, SEG.tw.t1 - .3, k);
      }
      // 7. photo-to-print studio
      { const v = V.st, TS = click('v-st', 1), RS = at('v-st', 'result');
        camTo(v, SEG.st.t0 - .3, 0, [0, 0, FW, FH]);
        const k0 = camTo(v, TS - .9, .6, [150, 380, 520, 380]);
        callout(v, [470, 563], 'Try it with any photo', 'r', TS - .4, TS + .6, k0);
        const k = camTo(v, TS + .7, .8, [530, 300, 760, 430]);
        callout(v, [720, 540], 'Your photo', 'b', RS - .6, SEG.st.t1 - .3, k);
        callout(v, [1040, 540], 'The relief, layer by layer', 'b', RS, SEG.st.t1 - .3, k);
      }
      // ---------- "and there's more": each one a full feature of its own (version 6) ----------
      // 8. automations: a ready-made rule in one click, saved
      { const v = V.au, T = at('v-au', 'template'), S = at('v-au', 'save');
        camTo(v, SEG.au.t0 - .3, 0, [0, 0, FW, FH]);
        const k = camTo(v, T - .7, .7, [160, 310, 760, 520]);
        callout(v, [575, 410], 'Ready-made rules', 'r', T + .1, S - 1.45, k);
        const k2 = camTo(v, S - .45, .7, [150, 440, 1150, 380]);
        callout(v, [366, 709], 'Saved. It runs on your computer.', 'r', S + .45, SEG.au.t1 - .3, k2);
      }
      // 9. maintenance: overdue tasks, one marked done
      { const v = V.ca, O = at('v-ca', 'overdue'), D = at('v-ca', 'done');
        camTo(v, SEG.ca.t0 - .3, 0, [0, 0, FW, FH]);
        const k = camTo(v, O - .8, .7, [170, 300, 1110, 420]);
        spot(v, [178, 396, 1084, 112], O - .1, D - .1);
        callout(v, [418, 423], 'Overdue, counted from print hours', 't', O + .1, D - .1, k);
        const k2 = camTo(v, D + .1, .7, [170, 0, 1110, 640]);
        callout(v, [720, 62], 'Done: its counter starts again', 'b', D + .5, SEG.ca.t1 - .3, k2);
      }
      // 10. filament: the inventory switched on, then how long each spool will last
      { const v = V.fi, SP = at('v-fi', 'spools'), FO = at('v-fi', 'forecast');
        camTo(v, SEG.fi.t0 - .3, 0, [0, 0, FW, FH]);
        const k = camTo(v, SP - .9, .7, [140, 260, 640, 520]);
        callout(v, [612, 481], 'Running low', 'r', SP, FO - .3, k);
        const k2 = camTo(v, FO + .5, .7, [130, 420, 700, 400]);
        callout(v, [350, 458], 'Import from Spoolman', 'r', FO + 1.0, FO + 2.1, k2);
        callout(v, [645, 534], 'Prints left on each spool', 't', FO + 2.2, SEG.fi.t1 - .3, k2);
      }
      // 11. print cost: the print running now, and every print before it
      { const v = V.co, C = at('v-co', 'card'), P = at('v-co', 'past');
        camTo(v, SEG.co.t0 - .3, 0, [0, 0, FW, FH]);
        const k = camTo(v, C - .3, .8, [150, 380, 1140, 360]);
        spot(v, [188, 474, 1074, 36], C + .4, SEG.co.t1 - .3);
        callout(v, [430, 478], 'This print, so far', 't', C + .6, SEG.co.t1 - .3, k);
        callout(v, [1150, 536], 'Every past print', 'l', P - .3, SEG.co.t1 - .3, k);
      }
      // 12. Home Assistant: the bridge switched on, its address typed in; 28 sensors float out
      { const v = V.ha, FL = at('v-ha', 'field'), TY2 = at('v-ha', 'typed');
        camTo(v, SEG.ha.t0 - .3, 0, [0, 0, FW, FH]);
        const k = camTo(v, SEG.ha.t0 + .2, .8, [660, 150, 700, 440]);
        callout(v, [975, 340], 'Just its address', 'b', TY2 + .1, SEG.ha.t1 - .3, k);
        const rows = ['printer state', 'print progress', 'time remaining (estimate)', 'current layer', 'bed temperature', 'T0 to T3 temperatures', 'maintenance tasks overdue'];
        $('#ha-in').innerHTML = '<div class="t">Home Assistant <b>28 sensors</b></div>' + rows.map(r => `<div class="row"><i></i>${r}</div>`).join('') + '<div class="row more">+ 18 more for each U1</div>';
        tl.fromTo('#ha-card', { opacity: 0, x: V9 ? 0 : -60, y: V9 ? 60 : 30, rotationY: V9 ? 0 : 18, scale: .9, transformPerspective: 1600 },
          { opacity: 1, x: 0, y: 0, rotationY: V9 ? 0 : 8, scale: 1, duration: .7, ease: 'expo.out', immediateRender: false }, FL + .4);
        tl.fromTo('#ha-card', { '--sx': '0%' }, { '--sx': '90%', duration: 4, ease: 'none', immediateRender: false }, FL + .4);
        tl.fromTo('#ha-card .row', { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: .35, ease: 'expo.out', stagger: .14, immediateRender: false }, FL + .7);
        tl.to('#ha-card', { opacity: 0, y: -20, duration: .3, ease: 'power3.in' }, SEG.ha.t1 - .3);
      }
      // 13. time-lapse (drawn: the simulated farm has no camera). The laptop steps out and a
      // flipbook plays: a vase growing a layer per frame, the frame counter ticking.
      { const s = SEG.tl, NL = 24;
        tl.to('#rig', { opacity: 0, x: V9 ? 0 : POSE.L.x - 420, y: V9 ? 900 : POSE.L.y, duration: .45, ease: 'power3.in' }, s.t0 - .45);
        const W = 940, Hh = 620, cx = 300, base = 520;
        let g = `<rect class="ln" x="20" y="20" width="560" height="560" rx="22"/><line class="ln2" x1="70" y1="${base + 2}" x2="530" y2="${base + 2}"/>
          <g transform="translate(500 50)"><rect class="ln" x="0" y="8" width="52" height="36" rx="7"/><circle class="acs" cx="26" cy="26" r="10"/><path class="ln" d="M16 8 l5 -7 h10 l5 7"/></g>`;
        for (let i = 0; i < NL; i++) {
          const w = 150 + 70 * Math.sin(Math.PI * (i / (NL - 1)) * 1.05) - (i > NL - 4 ? (i - NL + 4) * 14 : 0);
          g += `<rect class="lay" x="${cx - w / 2}" y="${base - (i + 1) * 15}" width="${w}" height="13.5" rx="4" fill="oklch(${68 - (i % 2) * 4}% 0.16 48)" opacity="0"/>`;
          g += `<text class="svgt fr" x="48" y="62" opacity="0">FRAME ${String(i + 1).padStart(2, '0')} / ${NL}</text>`;
        }
        g += `<rect x="48" y="548" width="504" height="8" rx="4" fill="oklch(30% 0.03 265 / .12)"/><rect id="tl-bar" x="48" y="548" width="504" height="8" rx="4" fill="var(--accent)"/>`;
        [6, 12, 18, 24].forEach((n, j) => {
          const y = 40 + j * 136;
          g += `<g class="thumb" opacity="0"><rect class="ln2" x="640" y="${y}" width="260" height="120" rx="14"/>`;
          for (let i = 0; i < n; i += 2) { const w = (150 + 70 * Math.sin(Math.PI * (i / (NL - 1)) * 1.05)) * .32; g += `<rect x="${770 - w / 2}" y="${y + 104 - (i + 2) * 3.4}" width="${w}" height="6" rx="2" fill="oklch(${68 - (i % 4) * 2}% 0.16 48)"/>`; }
          g += `<text class="svgt" x="656" y="${y + 26}">LAYER ${n * 2}</text></g>`;
        });
        g += `<text class="svgt" x="640" y="608">A FRAME EVERY TWO LAYERS</text>`;
        $('#tl-svg').setAttribute('viewBox', `0 0 ${W} ${Hh}`); $('#tl-svg').innerHTML = g;
        const T0 = s.t0 + .5, step = 3.2 / NL;
        tl.fromTo('#tl-card', { opacity: 0, x: V9 ? 0 : 160, y: V9 ? 120 : 0, rotationY: V9 ? 0 : -20, scale: .92, transformPerspective: 1800 },
          { opacity: 1, x: 0, y: 0, rotationY: V9 ? 0 : -8, scale: 1, duration: .8, ease: 'expo.out', immediateRender: false }, s.t0 - .2);
        tl.to('#tl-card', { rotationY: V9 ? 0 : -3, duration: s.t1 - s.t0 - .5, ease: 'sine.inOut' }, s.t0 + .6);
        tl.fromTo('#tl-card', { '--sx': '0%' }, { '--sx': '90%', duration: 6, ease: 'none', immediateRender: false }, s.t0);
        const lays = document.querySelectorAll('#tl-svg .lay'), frs = document.querySelectorAll('#tl-svg .fr');
        lays.forEach((el, i) => { tl.set(el, { opacity: 1 }, T0 + i * step); tl.set(frs[i], { opacity: 1 }, T0 + i * step); if (i) tl.set(frs[i - 1], { opacity: 0 }, T0 + i * step); });
        tl.fromTo('#tl-bar', { attr: { width: 8 } }, { attr: { width: 504 }, duration: NL * step, ease: 'none', immediateRender: false }, T0);
        tl.fromTo('#tl-svg .thumb', { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: .4, ease: 'expo.out', stagger: step * 6, immediateRender: false }, T0 + step * 5);
        tl.to('#tl-card', { opacity: 0, x: V9 ? 0 : -120, duration: .4, ease: 'power3.in' }, s.t1 - .4);
      }
      // 14. AR preview (drawn: it needs an Android phone's camera). A phone over a desk: the app's
      // own prompt, a tap, and the model standing on the desk at its printed size.
      { const s = SEG.ar, TAP = s.t0 + 3.2;
        $('#ar-screen').insertAdjacentHTML('beforeend', `<svg viewBox="0 0 402 892" width="402" height="892" style="position:absolute;inset:0">
          <defs><linearGradient id="ar-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d4cb"/><stop offset="1" stop-color="#b9ad9b"/></linearGradient>
          <linearGradient id="ar-desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c79a68"/><stop offset="1" stop-color="#9d7246"/></linearGradient></defs>
          <rect width="402" height="892" fill="url(#ar-sky)"/><path d="M0 420 L402 380 L402 892 L0 892 Z" fill="url(#ar-desk)"/>
          ${[0, 1, 2, 3, 4, 5].map(i => `<path d="M0 ${470 + i * 80} L402 ${430 + i * 86}" stroke="#8a6238" stroke-width="1.4" opacity=".35"/>`).join('')}
          <g opacity=".85"><path d="M296 300 v86 a30 10 0 0 0 60 0 v-86" fill="#f4f1ea" stroke="#6b5a48" stroke-width="2"/><ellipse cx="326" cy="300" rx="30" ry="10" fill="#e9e3d8" stroke="#6b5a48" stroke-width="2"/><path d="M356 320 q22 4 18 30 q-4 18 -18 18" fill="none" stroke="#6b5a48" stroke-width="5"/></g>
          <g id="ar-ret"><ellipse cx="190" cy="610" rx="92" ry="30" fill="none" stroke="#fff" stroke-width="5" opacity=".95"/><ellipse cx="190" cy="610" rx="64" ry="20" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-width="2"/></g>
          <g id="ar-model"><ellipse cx="190" cy="614" rx="98" ry="32" fill="rgba(40,30,20,.28)"/>
            <path d="M100 590 v16 a90 28 0 0 0 180 0 v-16" fill="#e8622a" stroke="#7a3112" stroke-width="2"/><ellipse cx="190" cy="590" rx="90" ry="28" fill="#ff7a3c" stroke="#7a3112" stroke-width="2"/>
            <ellipse cx="190" cy="590" rx="60" ry="18" fill="#1b1d22"/><ellipse cx="190" cy="590" rx="34" ry="10" fill="#ff7a3c"/>
            <path d="M96 650 h188 M96 642 v16 M284 642 v16" stroke="#fff" stroke-width="3" fill="none"/></g>
          <g id="ar-bar"><rect x="22" y="790" width="358" height="70" rx="22" fill="rgba(250,250,252,.78)" stroke="rgba(255,255,255,.9)"/>
            <text x="42" y="832" style="font:600 17px var(--sans);fill:#1d2230" id="ar-msg">Tap to place the model here</text>
            <rect x="300" y="806" width="64" height="38" rx="19" fill="#fff" stroke="#d5d9e0"/><text x="314" y="831" style="font:600 16px var(--sans);fill:#1d2230">Done</text></g>
          <circle id="ar-tap" cx="190" cy="610" r="30" fill="rgba(20,22,28,.18)" stroke="#fff" stroke-width="3" opacity="0"/></svg>`);
        tl.set('#ar-model', { opacity: 0 }, 0);
        tl.fromTo('#ar-ph', { opacity: 0, x: V9 ? 0 : -260, y: V9 ? 400 : 60, rotationY: V9 ? 0 : 28, rotationX: 8, transformPerspective: 1800 },
          { opacity: 1, x: 0, y: 0, rotationY: V9 ? -6 : 14, rotationX: 4, duration: .8, ease: 'expo.out', immediateRender: false }, s.t0 - .2);
        tl.to('#ar-ph', { rotationY: V9 ? 6 : 6, duration: s.t1 - s.t0 - .6, ease: 'sine.inOut' }, s.t0 + .6);
        tl.fromTo('#ar-ret', { scale: .9, transformOrigin: '190px 610px' }, { scale: 1.06, duration: .5, yoyo: true, repeat: 5, ease: 'sine.inOut', immediateRender: false }, s.t0 + .4);
        tl.fromTo('#ar-tap', { opacity: 0, scale: 1.4, transformOrigin: '190px 610px' }, { opacity: 1, scale: 1, duration: .35, ease: 'power2.out', immediateRender: false }, TAP - .45);
        tl.to('#ar-tap', { opacity: 0, scale: 1.8, duration: .45, ease: 'power2.out' }, TAP + .05);
        tl.to('#ar-ret', { opacity: 0, duration: .2 }, TAP);
        tl.fromTo('#ar-model', { opacity: 0, y: -60 }, { opacity: 1, y: 0, duration: .6, ease: 'bounce.out', immediateRender: false }, TAP + .05);
        tl.to('#ar-msg', { opacity: 0, duration: .2 }, TAP + .1);
        tl.to('#ar-ph', { opacity: 0, x: V9 ? 0 : -200, y: V9 ? 300 : 0, duration: .4, ease: 'power3.in' }, s.t1 - .4);
      }
      // 15. the cherry on top: ten games
      { const v = V.ga, SF = click('v-ga', 1);
        camTo(v, SEG.ga.t0 - .9, 0, [0, 0, FW, FH]);
        const k = camTo(v, at('v-ga', 'tab') + .5, .8, [150, 300, 1140, 600]);
        callout(v, [612, 338], 'Ten games, built in', 't', at('v-ga', 'tab') + 1.0, SF - .1, k);
        camTo(v, SF + .3, .8, [360, 420, 720, 430]);
      }

      // ===== the values, one per beat, on the stop-time hits =====
      tl.to(['#rig', '#corner'], { opacity: 0, duration: .3, ease: 'power3.in' }, SEG.values - .3);
      gsap.utils.toArray('#values .v').forEach((el, i) => zin(el, SEG.values + i * .5, .35));
      tl.to('#values', { opacity: 0, scale: 1.06, filter: 'blur(10px)', duration: .25, ease: 'power3.in' }, SEG.end - .25);

      // ===== the end card =====
      { const E = SEG.end;
        tl.set('#end', { opacity: 1 }, E);
        tl.fromTo('#end-row', { opacity: .15, scale: 1.18, filter: 'blur(10px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: .5, ease: 'expo.out', immediateRender: false }, E);
        tl.fromTo('#end-tag', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, E + .3);
        tl.fromTo('#term', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, E + .6);
        tl.fromTo('#end-meta', { opacity: 0 }, { opacity: 1, duration: .5 }, E + .9);
        tl.fromTo('#end-fine', { opacity: 0 }, { opacity: 1, duration: .5 }, E + 1.2);
        gsap.utils.toArray('#term .ln').forEach((ln, i) => {
          const times = TY[i], n = times.length - 1;
          tl.set(ln, { width: '2ch' }, i ? TY[i - 1][TY[i - 1].length - 1] + .05 : E + .6);
          for (let j = 0; j < n; j++) tl.set(ln, { width: (3 + j) + 'ch' }, times[j]);
        });
      }
