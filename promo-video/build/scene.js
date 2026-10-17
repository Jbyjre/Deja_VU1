      // Version 5: a tutorial, one step at a time. Shared by both cuts; the layout CSS
      // (main.layout.css / vertical.layout.css) places things, this file times them.
      const FMT = '__FMT__', V9 = FMT === 'vertical';
      const M = /*MARKS*/{}/*END*/;
      const TY = /*TYPING*/[]/*END*/;
      const $ = (s) => document.querySelector(s);
      const FW = 1440, FH = 900;
      const at = (vid, mark) => M[vid].start + (mark in M[vid].marks ? M[vid].marks[mark] : 0);
      const click = (vid, i) => M[vid].start + M[vid].clicks[i];
      // where each callout points (footage CSS px, measured on the filmed frames)
      const CO = {
        fl_ring: [592, 432], fl_done: [760, 418],
        ov_jam: [460, 470], ov_ctl: [1195, 406],
        ok_pre: [870, 378], ok_all: [720, 410], ok_go: [1003, 575], ok_toast: [720, 110],
        cv_btn: [918, 422], cv_rep: [1010, 690],
        sk_row: [640, 278], sk_btn: [553, 412],
        tw_views: [330, 218], tw_block: [400, 548],
        st_btn: [470, 563], st_photo: [720, 540], st_relief: [1040, 540],
      };
      const WIN = V9 ? { w: 962, h: 802 } : { w: 1052, h: 742 };     // the window's inner view

      // ---------- the seven steps, best first, the cherry on top last ----------
      const STEPS = [
        { id: 'fl', t0: 8, t1: 16, rail: 'Live', ill: 'live', k: 'Every printer, live',
          t: 'See every printer at once.',
          b: 'Up to <em>12 printers</em> on one screen, updated <em>four times a second</em>. Each card shows progress, the file and the finish time.' },
        { id: 'ov', t0: 16, t1: 23, rail: 'Needs you', ill: 'needs', k: 'Needs you',
          t: 'Know what needs you.',
          b: 'One list across the farm, <em>most urgent first</em>. A filament jam shows up the moment it happens.' },
        { id: 'ok', t0: 23, t1: 32, rail: 'Confirm', ill: 'check', k: 'Confirm Print',
          t: 'Every print is checked first.',
          b: 'The file, filament colours, maintenance and cost, before it starts. The server <em>checks again</em> as it starts, even from your phone.' },
        { id: 'cv', t0: 32, t1: 39, rail: 'Files', ill: 'files', k: 'Files ready for the U1',
          t: 'Convert projects for the U1.',
          b: 'Open a <em>MakerWorld, NexPrint or OrcaSlicer</em> project and convert it in one click, multi-plate included.' },
        { id: 'sk', t0: 39, t1: 47, rail: 'Skip', ill: 'skip', k: 'Skip one object',
          t: 'Skip one failed part.',
          b: 'If one object on the plate fails, skip just that one. <em>The rest keep printing.</em>' },
        { id: 'tw', t0: 47, t1: 55, rail: 'Twin', ill: 'twin', k: 'Digital twin',
          t: 'A live drawing of each printer.',
          b: 'Toolheads, bed and position, <em>drawn to scale</em> and updated live, in 3D, front and top views.' },
        { id: 'st', t0: 55, t1: 62, rail: 'Studio', ill: 'studio', k: 'Photo-to-Print Studio',
          t: 'A photo becomes a relief.',
          b: 'Pick a photo and the studio models a <em>layered relief in four filament colours</em>.' },
      ];

      // ---------- line illustrations (viewBox 560 x 240) ----------
      const printer = (x, y, dot) => `<g class="pop"><rect class="ln d" x="${x}" y="${y}" width="86" height="54" rx="9"/>
        <line class="ln2 d" x1="${x + 8}" y1="${y + 16}" x2="${x + 78}" y2="${y + 16}"/><rect class="ln d" x="${x + 34}" y="${y + 10}" width="16" height="13" rx="3"/>
        <line class="ln2 d" x1="${x + 14}" y1="${y + 42}" x2="${x + 72}" y2="${y + 42}"/><circle cx="${x + 76}" cy="${y + 9}" r="5" fill="${dot}"/></g>`;
      const ILL = {
        live: `${printer(14, 14, '#34c759')}${printer(14, 93, '#4a8df8')}${printer(14, 172, '#ff9f0a')}
          <path class="flow" d="M104 41 C190 41 200 90 292 98"/><path class="flow" d="M104 120 C190 120 210 115 292 115"/><path class="flow" d="M104 199 C190 199 200 140 292 132"/>
          <g class="pop"><rect class="ln d" x="296" y="34" width="250" height="158" rx="14"/><line class="ln d" x1="421" y1="192" x2="421" y2="214"/><line class="ln d" x1="380" y1="216" x2="462" y2="216"/>
          ${[0, 1, 2].map(i => `<rect class="ln2 d" x="${312 + i * 78}" y="52" width="68" height="122" rx="8"/><circle class="ln2" cx="${346 + i * 78}" cy="84" r="17"/>
            <circle class="ac ring" cx="${346 + i * 78}" cy="84" r="17" transform="rotate(-90 ${346 + i * 78} 84)"/><line class="ln2 d" x1="${322 + i * 78}" y1="120" x2="${370 + i * 78}" y2="120"/>
            <line class="ln2 d" x1="${322 + i * 78}" y1="136" x2="${358 + i * 78}" y2="136"/>`).join('')}</g>
          <text x="296" y="238">4 UPDATES A SECOND</text>`,
        needs: `<g class="pop"><rect class="ln d" x="40" y="14" width="380" height="214" rx="16"/>
          ${[0, 1, 2, 3].map(i => `<g class="row"><circle cx="72" cy="${70 + i * 44}" r="6" fill="${i < 2 ? '#ff9f0a' : '#c7cbd3'}"/><line class="ln2" x1="92" y1="${70 + i * 44}" x2="${300 - i * 30}" y2="${70 + i * 44}"/></g>`).join('')}</g>
          <g class="newrow"><rect x="52" y="26" width="356" height="34" rx="9" fill="#ffeceb"/><circle cx="72" cy="43" r="7" fill="#ff3b30"/><text class="big" x="90" y="49">Filament jam on T2</text></g>
          <g class="bell" transform="translate(470 70)"><path class="ht d" d="M-26 18 Q-26 -24 0 -24 Q26 -24 26 18 L32 26 L-32 26 Z"/><path class="ht d" d="M-8 32 Q0 42 8 32"/></g>
          <text x="440" y="150">MOST</text><text x="440" y="172">URGENT</text><text x="440" y="194">FIRST</text>`,
        check: `${['Pre-flight', 'Filament colour', 'Maintenance', 'Cost'].map((l, i) => `<g class="pop"><rect class="ln2" x="20" y="${18 + i * 52}" width="32" height="32" rx="8"/>
            <path class="ac tick" d="M28 ${34 + i * 52} l7 7 l12 -14"/><text class="big" x="68" y="${41 + i * 52}">${l}</text></g>`).join('')}
          <g class="pop shield"><path class="ht d" d="M420 28 L486 50 L486 120 Q486 180 420 210 Q354 180 354 120 L354 50 Z"/><path class="ht tick" d="M396 120 l18 18 l32 -38"/></g>
          <text x="352" y="238">SERVER RE-CHECKS</text>`,
        files: `<g class="pop"><path class="ln d" d="M40 30 h120 l40 40 v140 h-160 z"/><path class="ln2 d" d="M160 30 v40 h40"/><text class="big" x="70" y="118" style="font-size:40px">3MF</text>
            <text x="58" y="150">MAKERWORLD</text><text x="58" y="172">NEXPRINT</text><text x="58" y="194">ORCASLICER</text></g>
          <path class="ac d" d="M222 120 H330 M312 102 L332 120 L312 138"/>
          <g class="pop"><rect class="ln d" x="352" y="30" width="180" height="180" rx="22"/><text class="big" x="402" y="132" style="font-size:52px">U1</text>
            <circle cx="510" cy="52" r="20" fill="#34c759"/><path d="M500 52 l7 7 l12 -14" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
          <text x="352" y="238">READY FOR THE U1</text>`,
        skip: `<g class="pop"><rect class="ln d" x="24" y="18" width="220" height="208" rx="12"/>
            ${[1, 2, 3, 4].map(i => `<line class="ln2" x1="${24 + i * 44}" y1="24" x2="${24 + i * 44}" y2="220" opacity=".35"/><line class="ln2" x1="30" y1="${18 + i * 42}" x2="238" y2="${18 + i * 42}" opacity=".35"/>`).join('')}
            <rect class="ln" x="56" y="120" width="44" height="44" rx="4"/><rect class="ln part2" x="112" y="76" width="44" height="44" rx="4"/><rect class="ln" x="168" y="128" width="44" height="44" rx="4"/>
            <path class="ht x d" d="M114 78 L154 118 M154 78 L114 118"/></g>
          ${['Part 1', 'Part 2', 'Part 3'].map((l, i) => `<g class="pop"><text class="big" x="280" y="${62 + i * 64}">${l}</text>
            <rect x="370" y="${48 + i * 64}" width="170" height="14" rx="7" fill="#e3e6ec"/>
            <rect class="bar${i === 1 ? ' skipbar' : ''}" x="370" y="${48 + i * 64}" width="170" height="14" rx="7" fill="${i === 1 ? '#ff9f0a' : '#4a8df8'}"/></g>`).join('')}
          <text class="skipped" x="370" y="148" style="fill:#c4561a">SKIPPED</text>`,
        twin: `<g class="pop"><path class="ln d" d="M50 70 L110 40 L170 70 L170 160 L110 190 L50 160 Z M50 70 L110 100 L170 70 M110 100 L110 190"/><text x="88" y="232">3D</text></g>
          <g class="pop"><rect class="ln d" x="210" y="40" width="140" height="150" rx="4"/><line class="ln d" x1="210" y1="80" x2="350" y2="80"/><rect class="ln d" x="262" y="66" width="34" height="26" rx="3"/><line class="ln2 d" x1="226" y1="160" x2="334" y2="160"/><text x="248" y="232">FRONT</text></g>
          <g class="pop"><rect class="ln d" x="390" y="40" width="150" height="150" rx="4"/><circle class="ac d" cx="465" cy="115" r="22"/><line class="ln2 d" x1="390" y1="115" x2="540" y2="115"/><line class="ln2 d" x1="465" y1="40" x2="465" y2="190"/><text x="444" y="232">TOP</text></g>`,
        studio: `<g class="pop"><rect class="ln d" x="20" y="36" width="190" height="156" rx="12"/><path class="ln d" d="M34 176 L92 104 L128 146 L156 118 L198 176"/><circle class="ht d" cx="160" cy="76" r="16"/><text x="60" y="232">PHOTO</text></g>
          <path class="ac d" d="M232 114 H310 M292 96 L312 114 L292 132"/>
          ${['#2a2826', '#6f6a63', '#b9b3a7', '#f4f1ea'].map((c, i) => `<g class="pop layer4"><rect x="${342 + i * 12}" y="${150 - i * 30}" width="170" height="54" rx="10" fill="${c}" stroke="#2a2d36" stroke-width="2"/></g>`).join('')}
          <text x="350" y="238">4 FILAMENT COLOURS</text>`,
      };

      // ---------- DOM ----------
      $('#panel').innerHTML = STEPS.map((s, i) => `<div class="tp" id="tp-${s.id}">
          <div class="k"><b>${i + 1} / ${STEPS.length}</b>${s.k}</div>
          <div class="t">${s.t}</div>
          <div class="b">${s.b}</div>
          <div class="ill glass"><svg viewBox="0 0 560 240" id="ill-${s.id}">${ILL[s.ill]}</svg></div>
        </div>`).join('');
      $('#Wv').innerHTML = STEPS.filter(s => s.id !== 'xx').map(s => `<div class="layer" id="L-${s.id}"><div class="cam"></div></div>`).join('');
      $('#rail').innerHTML = STEPS.map(s => `<div class="seg" style="flex:1"><i><u id="r-${s.id}"></u></i>${s.rail}</div>`).join('');
      $('#chips').innerHTML = ['Automations &amp; alerts', 'Maintenance tracking', 'Filament &amp; Spoolman', 'Print cost', 'Home Assistant', 'Time-lapse', 'AR preview', 'Ten games']
        .map(c => `<div class="chip glass"><span>${c}</span></div>`).join('');
      $('#hq2').innerHTML = ['One', 'screen', 'for', '<span class="hl">every U1</span>', 'you', 'run.'].map((w, i) => `<span class="word">${w}</span>${V9 && i === 2 ? '<br>' : ' '}`).join('');
      $('#hk-svg').innerHTML = `${printer(20, 20, '#34c759')}${printer(20, 103, '#4a8df8')}${printer(20, 186, '#ff9f0a')}
        <path class="flow" d="M112 47 C220 47 240 110 352 118"/><path class="flow" d="M112 130 C230 130 250 130 352 130"/><path class="flow" d="M112 213 C220 213 240 150 352 142"/>
        <g class="pop"><rect class="ln d" x="356" y="40" width="224" height="150" rx="14"/><line class="ln d" x1="468" y1="190" x2="468" y2="214"/><line class="ln d" x1="424" y1="218" x2="512" y2="218"/>
        ${[0, 1, 2].map(i => `<rect class="ln2 d" x="${372 + i * 68}" y="58" width="58" height="114" rx="8"/><circle class="ac ring" cx="${401 + i * 68}" cy="88" r="15" transform="rotate(-90 ${401 + i * 68} 88)"/>`).join('')}</g>`;

      const V = {};
      function mount(viewEl, vid, vw, vh) {
        const s = Math.max(vw / FW, vh / FH), cam = viewEl.querySelector('.cam');
        Object.assign(cam.style, { width: FW * s + 'px', height: FH * s + 'px' });
        cam.appendChild(document.getElementById(vid));
        return { cam, vw, vh, s };
      }
      STEPS.forEach(s => { V[s.id] = mount($('#L-' + s.id), 'v-' + s.id, WIN.w, WIN.h); });
      (() => { const cam = document.createElement('div'); cam.className = 'cam'; Object.assign(cam.style, { inset: '0', width: '100%', height: '100%' });
        cam.appendChild($('#v-ph')); $('#ph-screen').appendChild(cam); })();
      // stroke lengths for the draw-on lines
      document.querySelectorAll('.ill .d, .ill .tick, .ill .ring').forEach(el => {
        const n = el.getTotalLength ? el.getTotalLength() : 300;
        el.style.strokeDasharray = n; el.style.strokeDashoffset = n; el.dataset.len = n;
      });

      // ---------- motion vocabulary ----------
      const tl = gsap.timeline({ paused: true });
      function camK(v, r) {
        return Math.max(Math.min(v.vw / (r[2] * v.s), v.vh / (r[3] * v.s)), Math.max(v.vw / (FW * v.s), v.vh / (FH * v.s)));
      }
      // Frame a rectangle of the footage (CSS px of the filmed page) inside a view; returns the zoom.
      function camTo(v, t, d, r, ease = 'expo.inOut') {
        const k = camK(v, r), cx = (r[0] + r[2] / 2) * v.s, cy = (r[1] + r[3] / 2) * v.s;
        let x = v.vw / 2 - k * cx, y = v.vh / 2 - k * cy;
        x = Math.min(0, Math.max(v.vw - k * FW * v.s, x)); y = Math.min(0, Math.max(v.vh - k * FH * v.s, y));
        if (d === 0) tl.set(v.cam, { scale: k, x, y }, t); else tl.to(v.cam, { scale: k, x, y, duration: d, ease }, t);
        return k;
      }
      // A callout: a dot on the thing, a short stem, a dark label. It lives inside the camera
      // (so it stays on its target) and is scaled by 1/zoom (so its text keeps one size).
      function callout(v, pt, label, dir, tIn, tOut, k) {
        const el = document.createElement('div'); el.className = 'co ' + dir;
        el.innerHTML = `<i class="dot"></i><b class="stem"></b><span class="pill">${label}</span>`;
        Object.assign(el.style, { left: pt[0] * v.s + 'px', top: pt[1] * v.s + 'px' });
        v.cam.appendChild(el);
        tl.set(el, { scale: 1 / k, transformOrigin: '0 0' }, 0);
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: .25, ease: 'power2.out', immediateRender: false }, tIn);
        tl.fromTo(el.querySelector('.dot'), { scale: 0 }, { scale: 1, duration: .4, ease: 'back.out(3)', immediateRender: false }, tIn);
        tl.fromTo(el.querySelector('.pill'), { opacity: 0, y: dir === 't' ? 12 : dir === 'b' ? -12 : 0, x: dir === 'r' ? -12 : dir === 'l' ? 12 : 0 },
          { opacity: 1, y: 0, x: 0, duration: .4, ease: 'expo.out', immediateRender: false }, tIn + .08);
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
      function zout(el, t, d = .22) {
        tl.to(el, { scale: 1.12, filter: 'blur(10px)', duration: d, ease: 'power3.in' }, t);
        tl.to(el, { opacity: 0, duration: d, ease: 'none' }, t);
      }
      function draw(sel, t, d = .6, stagger = .08) {
        const els = typeof sel === 'string' ? document.querySelectorAll(sel) : sel;
        tl.to(els, { strokeDashoffset: 0, duration: d, ease: 'power2.out', stagger }, t);
      }
      function pops(sel, t, stagger = .12) {
        tl.fromTo(sel, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .4, ease: 'expo.out', stagger, immediateRender: false }, t);
      }
      // the text panel for a step: the label, then the headline, then the sentence, then the drawing
      function panelIn(id, t) {
        const p = '#tp-' + id;
        tl.set(p, { opacity: 1 }, t);
        tl.fromTo(`${p} .k`, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: .4, ease: 'expo.out', immediateRender: false }, t);
        tl.fromTo(`${p} .t`, { opacity: 0, y: 34, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .55, ease: 'expo.out', immediateRender: false }, t + .1);
        tl.fromTo(`${p} .b`, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .55, ease: 'expo.out', immediateRender: false }, t + .35);
        tl.fromTo(`${p} .ill`, { opacity: 0, y: 24, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .55, ease: 'expo.out', immediateRender: false }, t + .55);
        tl.fromTo(`${p} .ill`, { '--sx': '0%' }, { '--sx': '90%', duration: 6, ease: 'none', immediateRender: false }, t + .55);
      }
      function panelOut(id, t) {
        tl.to('#tp-' + id, { opacity: 0, y: -24, duration: .25, ease: 'power3.in' }, t);
      }
      // the window: cut the curve between layers, with a small zoom out and back in
      function swap(a, b, t) {
        tl.to('#W', { scale: .95, duration: .25, ease: 'power2.in' }, t - .25);
        tl.to('#W', { scale: 1, duration: .5, ease: 'expo.out' }, t);
        if (a) { tl.to(a, { x: -220, filter: 'blur(12px)', duration: .22, ease: 'power4.in' }, t - .22); tl.to(a, { opacity: 0, duration: .22, ease: 'none' }, t - .22); }
        tl.fromTo(b, { x: 220, opacity: .2, filter: 'blur(12px)' }, { x: 0, opacity: 1, filter: 'blur(0px)', duration: .45, ease: 'power4.out', immediateRender: false }, t);
      }

      tl.fromTo('#pool-a', { x: 0, y: 0 }, { x: 170, y: 70, duration: 75, ease: 'none' }, 0);
      tl.fromTo('#pool-b', { x: 0, y: 0 }, { x: -150, y: -50, duration: 75, ease: 'none' }, 0);

      // ===== 0-4 the hook: the problem, then the one line =====
      zin('#hq1', .15, .5);
      tl.fromTo('#hk-ill', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, .35);
      pops('#hk-svg .pop', .45, .18);
      draw('#hk-svg .d', .5, .7, .03);
      tl.fromTo('#hk-svg .flow', { strokeDashoffset: 0 }, { strokeDashoffset: -130, duration: 3.6, ease: 'none', immediateRender: false }, .4);
      tl.to('#hk-svg .ring', { strokeDashoffset: (i, el) => el.dataset.len * (.7 - i * .2), duration: 1.6, ease: 'power2.out', stagger: .15 }, 1.2);
      tl.to('#hq1', { opacity: 0, y: -20, duration: .25, ease: 'power2.in' }, 2.15);
      tl.set('#hq2', { opacity: 1 }, 2.3);
      gsap.utils.toArray('#hq2 .word').forEach((w, i) => tl.fromTo(w, { opacity: 0, y: 40, filter: 'blur(8px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: .3, ease: 'expo.out', immediateRender: false }, 2.35 + i * .2));
      tl.to('#hook', { opacity: 0, scale: 1.06, filter: 'blur(10px)', duration: .3, ease: 'power3.in' }, 3.9);

      // ===== 4-8 the app =====
      tl.set('#brand', { opacity: 1 }, 4.15);
      tl.fromTo('#b-icon', { scale: .5, opacity: 0, rotation: -12 }, { scale: 1, opacity: 1, rotation: 0, duration: .55, ease: 'back.out(1.8)', immediateRender: false }, 4.15);
      tl.to('#b-ring', { attr: { 'stroke-dashoffset': 0 }, duration: .7, ease: 'expo.out' }, 4.2);
      tl.fromTo('#b-dot', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: .45, ease: 'back.out(2.4)', immediateRender: false }, 4.4);
      tl.fromTo('#b-word', { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .5, ease: 'expo.out', immediateRender: false }, 4.3);
      tl.fromTo('#b-sub', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, 4.7);
      tl.to('#brand', { opacity: 0, scale: .9, filter: 'blur(8px)', duration: .35, ease: 'power3.in' }, 7.45);
      tl.fromTo('#corner', { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: .5, ease: 'expo.out', immediateRender: false }, 7.8);
      tl.fromTo('#rail', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, 7.9);
      tl.fromTo('#W', { opacity: 0, y: 60, scale: .94 }, { opacity: 1, y: 0, scale: 1, duration: .7, ease: 'expo.out', immediateRender: false }, 7.85);
      tl.fromTo('#W .view', { filter: 'blur(14px)' }, { filter: 'blur(0px)', duration: .5, ease: 'expo.out', immediateRender: false }, 7.85);

      // ===== the steps =====
      STEPS.forEach((s, i) => {
        panelIn(s.id, s.t0 + (i ? .1 : .05));
        if (i < STEPS.length - 1) panelOut(s.id, s.t1 - .25);
        tl.fromTo('#r-' + s.id, { scaleX: 0 }, { scaleX: 1, duration: s.t1 - s.t0, ease: 'none', immediateRender: false }, s.t0);
        if (i) swap('#L-' + STEPS[i - 1].id, '#L-' + s.id, s.t0); else tl.set('#L-' + s.id, { opacity: 1 }, s.t0 - .2);
      });

      // 1. every printer, live
      { const v = V.fl, H = at('v-fl', 'hover'), H2 = at('v-fl', 'hover2');
        camTo(v, 7.8, 0, [150, 90, 1140, 760]);
        camTo(v, at('v-fl', 'cards') - .2, .8, [170, 300, 1110, 600]);
        draw('#ill-fl .d', 8.7, .7, .03); pops('#ill-fl .pop', 8.6, .15);
        tl.fromTo('#ill-fl .flow', { strokeDashoffset: 0 }, { strokeDashoffset: -260, duration: 7, ease: 'none', immediateRender: false }, 8.6);
        tl.to('#ill-fl .ring', { strokeDashoffset: (i, el) => el.dataset.len * [.62, .25, .9][i], duration: 2.5, ease: 'power1.inOut', stagger: .2 }, 9.4);
        const k = camTo(v, H - .45, .8, [500, 300, 640, 420]);
        spot(v, [556, 346, 336, 104], H + .1, 15.7);
        callout(v, CO.fl_ring, 'Progress', 'b', H + .35, 15.7, k);
        callout(v, CO.fl_done, 'Finish time', 't', H + .9, 15.7, k);
      }
      // 2. needs you
      { const v = V.ov, J = at('v-ov', 'jam'), R = at('v-ov', 'row');
        camTo(v, 15.8, 0, [160, 230, 1130, 600]);
        draw('#ill-ov .d', 16.7, .6, .03); pops('#ill-ov .pop', 16.6);
        tl.fromTo('#ill-ov .newrow', { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: .5, ease: 'back.out(1.6)', immediateRender: false }, J);
        tl.fromTo('#ill-ov .row', { y: 0 }, { y: 18, duration: .4, ease: 'power2.out', immediateRender: false }, J);
        tl.fromTo('#ill-ov .bell', { rotation: -14, transformOrigin: '50% 0%' }, { rotation: 14, duration: .1, yoyo: true, repeat: 7, ease: 'sine.inOut', immediateRender: false }, J);
        const k = camTo(v, J + .15, .6, [165, 330, 1120, 420]);
        spot(v, [172, 391, 1106, 98], J + .35, 22.7);
        callout(v, CO.ov_jam, 'A jam, the moment it happens', 'b', J + .6, 22.7, k);
        callout(v, CO.ov_ctl, 'Act on it here', 'l', R + .2, 22.7, k);
      }
      // 3. confirm print, then the phone
      { const v = V.ok, P = click('v-ok', 1), G = click('v-ok', 2);
        camTo(v, 22.8, 0, [160, 180, 1120, 560]);
        pops('#ill-ok .pop', 23.6, .1);
        const k1 = camTo(v, P - .7, .6, [700, 300, 620, 240]);
        callout(v, CO.ok_pre, 'Pre-flight: clear', 't', P - .2, P + .25, k1);
        const k = camTo(v, P + .25, .6, [350, 250, 740, 400]);
        // the checklist ticks itself off, in time with the dialog
        draw('#ill-ok .pop:not(.shield) .tick', P + .7, .35, .3); draw('#ill-ok .shield .d', P + 2.0, .6); draw('#ill-ok .shield .tick', P + 2.45, .35);
        spot(v, [383, 364, 674, 50], P + .8, G - .3);
        callout(v, CO.ok_all, 'Every check passed', 'b', P + 1.0, G - .3, k);
        callout(v, CO.ok_go, 'Start print', 'l', G - .9, G + .1, k);
        const k2 = camTo(v, G + .2, .6, [440, 20, 860, 400]);
        callout(v, CO.ok_toast, 'Confirmed by the printer', 'b', G + .7, 29.4, k2);
        // ...and from your phone
        tl.to('#W', { x: V9 ? -40 : -60, scale: .9, opacity: .0, duration: .4, ease: 'power3.in' }, 29.4);
        tl.fromTo('#ph', { opacity: 0, x: 380, rotationY: -26, scale: V9 ? .9 : 1, transformPerspective: 1800 },
                         { opacity: 1, x: 0, rotationY: -6, scale: V9 ? .9 : 1, duration: .6, ease: 'power4.out', immediateRender: false }, 29.6);
        tl.to('#ph', { rotationY: 4, duration: 2.2, ease: 'none' }, 30.2);
        tl.to('#ph', { opacity: 0, x: -300, duration: .3, ease: 'power3.in' }, 31.7);
        tl.to('#W', { x: 0, scale: 1, opacity: 1, duration: .5, ease: 'expo.out' }, 31.85);
      }
      // 4. files ready for the U1
      { const v = V.cv, C = click('v-cv', 1), RP = at('v-cv', 'report');
        camTo(v, 31.8, 0, [170, 180, 1110, 560]);
        draw('#ill-cv .d', 32.7, .7, .05); pops('#ill-cv .pop', 32.6, .5);
        const k = camTo(v, C - .8, .6, [700, 330, 620, 240]);
        callout(v, CO.cv_btn, 'One click', 't', C - .3, C + .5, k);
        const k2 = camTo(v, C + .4, .7, [780, 600, 520, 300]);
        callout(v, CO.cv_rep, 'Converted for the U1', 't', RP, 38.7, k2);
      }
      // 5. skip one object
      { const v = V.sk, PK = at('v-sk', 'pick'), A = at('v-sk', 'ask'), S = at('v-sk', 'skip');
        camTo(v, 38.8, 0, [140, 100, 1160, 450]);
        draw('#ill-sk .d', 39.7, .6, .04); pops('#ill-sk .pop', 39.6, .12);
        tl.fromTo('#ill-sk .bar', { scaleX: 0, transformOrigin: '0 50%' }, { scaleX: (i) => [.85, .45, .7][i], duration: 2.2, ease: 'power1.inOut', immediateRender: false }, 40.0);
        tl.to('#ill-sk .bar:not(.skipbar)', { scaleX: 1, duration: 1.6, ease: 'power1.inOut' }, S + .3);
        tl.fromTo('#ill-sk .skipped', { opacity: 0 }, { opacity: 1, duration: .3, immediateRender: false }, S + .1);
        tl.fromTo('#ill-sk .x', { strokeDashoffset: (i, el) => el.dataset.len }, { strokeDashoffset: 0, duration: .4, immediateRender: false }, S);
        tl.set('#ill-sk .x', { strokeDashoffset: (i, el) => el.dataset.len }, 0);
        const k = camTo(v, PK - .5, .6, [440, 170, 860, 300]);
        spot(v, [492, 243, 772, 46], PK + .15, 46.7);
        callout(v, CO.sk_row, 'Pick the failed part', 'b', PK + .3, A - .1, k);
        callout(v, CO.sk_btn, 'Confirm', 'r', A + .2, S - .1, k);
        callout(v, CO.sk_row, 'Skipped. The rest keep going.', 'b', S + .4, 46.7, k);
      }
      // 6. the digital twin
      { const v = V.tw, F = at('v-tw', 'front'), T = at('v-tw', 'top');
        camTo(v, 46.8, 0, [0, 0, FW, FH]);
        const k = camTo(v, 47.1, .7, [140, 105, 490, 580]);
        tl.set('#ill-tw .pop', { opacity: 0 }, 0);
        tl.fromTo('#ill-tw .pop:nth-of-type(1)', { opacity: 0 }, { opacity: 1, duration: .3, immediateRender: false }, 47.8);
        draw('#ill-tw .pop:nth-of-type(1) .d', 47.8, .7);
        tl.fromTo('#ill-tw .pop:nth-of-type(2)', { opacity: 0 }, { opacity: 1, duration: .3, immediateRender: false }, F);
        draw('#ill-tw .pop:nth-of-type(2) .d', F, .7);
        tl.fromTo('#ill-tw .pop:nth-of-type(3)', { opacity: 0 }, { opacity: 1, duration: .3, immediateRender: false }, T);
        draw('#ill-tw .pop:nth-of-type(3) .d', T, .7);
        callout(v, CO.tw_views, 'Switch views', 'r', F - .7, T + .9, k);
        callout(v, CO.tw_block, 'Drawn to scale', 't', T + 1.0, 54.7, k);
      }
      // 7. the cherry on top: photo-to-print studio
      { const v = V.st, TS = click('v-st', 0), RS = at('v-st', 'result');
        camTo(v, 54.8, 0, [140, 290, 1130, 600]);
        draw('#ill-st .d', 55.7, .7, .05);
        tl.fromTo('#ill-st .pop:not(.layer4)', { opacity: 0 }, { opacity: 1, duration: .4, immediateRender: false }, 55.6);
        tl.fromTo('#ill-st .layer4', { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: .45, ease: 'back.out(1.6)', stagger: .2, immediateRender: false }, TS + .4);
        const k0 = camTo(v, TS - .9, .6, [150, 380, 520, 380]);
        callout(v, CO.st_btn, 'Try it with any photo', 'r', TS - .4, TS + .6, k0);
        const k = camTo(v, TS + .7, .8, [530, 300, 760, 430]);
        callout(v, CO.st_photo, 'Your photo', 'b', RS - .6, 61.7, k);
        callout(v, CO.st_relief, 'The relief, layer by layer', 'b', RS, 61.7, k);
      }
      panelOut('st', 61.75);
      tl.to(['#W', '#corner', '#rail'], { opacity: 0, y: 20, duration: .3, ease: 'power3.in' }, 61.75);

      // ===== 62-65 and there's more =====
      zin('#more-h', 62.1);
      gsap.utils.toArray('#chips .chip').forEach((c, i) => tl.fromTo(c, { opacity: 0, y: 26, scale: .92 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: 'expo.out', immediateRender: false }, 62.4 + i * .09));
      tl.to('#more', { opacity: 0, scale: 1.05, filter: 'blur(10px)', duration: .25, ease: 'power3.in' }, 64.7);

      // ===== 65-68 values, one per beat, on the stop-time hits =====
      gsap.utils.toArray('#values .v').forEach((el, i) => zin(el, 65.0 + i * .5, .35));
      tl.to('#values', { opacity: 0, scale: 1.06, filter: 'blur(10px)', duration: .25, ease: 'power3.in' }, 67.75);

      // ===== 68-75 the end card =====
      tl.set('#end', { opacity: 1 }, 68.0);
      tl.fromTo('#end-row', { opacity: .15, scale: 1.18, filter: 'blur(10px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: .5, ease: 'expo.out', immediateRender: false }, 68.0);
      tl.fromTo('#end-tag', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .45, ease: 'expo.out', immediateRender: false }, 68.3);
      tl.fromTo('#term', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', immediateRender: false }, 68.6);
      tl.fromTo('#end-meta', { opacity: 0 }, { opacity: 1, duration: .5 }, 68.9);
      tl.fromTo('#end-fine', { opacity: 0 }, { opacity: 1, duration: .5 }, 69.2);
      gsap.utils.toArray('#term .ln').forEach((ln, i) => {
        const times = TY[i], n = times.length - 1;
        tl.set(ln, { width: '2ch' }, i ? TY[i - 1][TY[i - 1].length - 1] + .05 : 68.6);
        for (let j = 0; j < n; j++) tl.set(ln, { width: (3 + j) + 'ch' }, times[j]);
      });
