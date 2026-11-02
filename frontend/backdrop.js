/* Deja Vu1 - the background behind the dashboard.
 *
 * One canvas behind everything that answers you. Move the mouse (or drag a
 * finger) and it parts and swirls around the pointer, then springs back.
 * Plain JavaScript, no library. Chosen in Settings > Appearance and in setup.
 *
 * Styles
 *   Dots           a dot grid that springs aside, swirls with the pointer
 *                  and lights up near it (the default)
 *   Constellation  the same grid, with the dots near the pointer joined up
 *   Flow           soft pools of colour that swirl out of the pointer's way
 *   Layer lines    the side wall of a print: fine lines that part around it
 *   Still          a calm gradient that never moves
 *
 * Reaction (Gentle / Lively / Wild) scales how far, how fast and how
 * springy everything moves. "Little surprises" (on by default) adds the
 * hidden things: a ripple where you click an empty part of the page, a
 * bloom after three quick clicks, a charge-and-release on a long press, a
 * sweep across the screen as each minute turns over, the time drawn in dots
 * on the hour, a burst when a print finishes, and two secrets typed on the
 * keyboard. New surprises go in SURPRISES below.
 *
 * Every dot is one colour (the owner, October 2026: a print-progress fill
 * in the filament's colours read as a stray orange line over black). It is
 * the colour set's own colour unless "Dot colour" in the picker sets another.
 *
 * Cost, which matters because the glass bars blur what is behind them: the
 * canvas only draws while something is moving (the pointer, a ripple, a
 * surprise), then stops completely. A hidden tab, "reduce motion" (which
 * also switches the surprises off) and "reduce transparency" (which hides
 * the background) stop it too. Choices stay in this browser (localStorage).
 */
'use strict';

const Backdrop = (() => {
  const KEY = 'dejavu1.backdrop';
  const STYLES = {
    dots:          { label: 'Dots',          hint: 'A dot grid that parts, swirls and lights up around your cursor' },
    constellation: { label: 'Constellation', hint: 'Dots near your cursor join up like a star map' },
    flow:          { label: 'Flow',          hint: 'Soft colour that swirls out of your cursor’s way' },
    lines:         { label: 'Layer lines',   hint: 'Fine print lines that part around your cursor' },
    still:         { label: 'Still',         hint: 'A calm gradient that never moves' },
  };
  /* Light colours only: text sits straight on this background in places,
   * so every set keeps the page pale enough for the dashboard's measured
   * text contrast. `ink` draws lines and dots; `glow` is the lit colour. */
  const PALETTES = {
    glacier:  { label: 'Glacier',  bg: '#edf2f8', blobs: ['#9cc8ff', '#a6e4e0', '#c3cffd', '#d9ecff', '#b4dcf5'], ink: [40, 62, 98], glow: '#3f8cff' },
    mint:     { label: 'Mint',     bg: '#edf5f1', blobs: ['#a3e2c3', '#c4efd8', '#94d6cf', '#ddf3c4', '#b9e8e2'], ink: [30, 80, 66], glow: '#18b07b' },
    dusk:     { label: 'Dusk',     bg: '#f5f0f3', blobs: ['#ffcfb6', '#f0c0d8', '#cbc4f3', '#ffe2ae', '#e6c9f0'], ink: [86, 52, 80], glow: '#ff7f57' },
    graphite: { label: 'Graphite', bg: '#eceef2', blobs: ['#d2d7df', '#c1c8d3', '#e2e5ea', '#b6c0ce', '#d9dde4'], ink: [44, 50, 62], glow: '#5d6f8c' },
    daylight: { label: 'Time of day', bg: null, blobs: null, ink: null, glow: null, hint: 'Shifts with the clock: dawn, day, dusk and night' },
    filament: { label: 'Filament', bg: '#eef0f4', blobs: null, ink: [40, 50, 70], glow: null, hint: 'Takes the colours of the filament loaded on your printer' },
  };
  const ENERGY = {
    gentle: { label: 'Gentle', reach: 0.75, push: 0.6, swirl: 0.6, spring: 1.15 },
    lively: { label: 'Lively', reach: 1, push: 1, swirl: 1, spring: 1 },
    wild:   { label: 'Wild',   reach: 1.35, push: 1.7, swirl: 1.6, spring: 0.8 },
  };
  const DEFAULT = { style: 'dots', palette: 'glacier', energy: 'lively', surprises: true, dot: '' };
  /* Dot colour choices; '' follows the colour set. Any other #rrggbb comes
   * from the colour well. Mid-tone, so the pale page keeps its text contrast. */
  const DOTS = [
    { id: '', label: 'Match the colours' },
    { id: '#3f8cff', label: 'Blue' }, { id: '#18b07b', label: 'Green' }, { id: '#8a5cf6', label: 'Violet' },
    { id: '#e0567a', label: 'Pink' }, { id: '#f08a24', label: 'Orange' }, { id: '#5d6f8c', label: 'Slate' }, { id: '#1c1c1e', label: 'Black' },
  ];

  let prefs = load();
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, lastInput = -1e9, energy = 0, clock = 0;
  const pointer = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, vx: 0, vy: 0, t: 0, inside: false, down: 0, downAt: 0 };
  let blobs = [], glow = { x: 0, y: 0, a: 0 }, trail = [], grid = null, colours = null;
  let waves = [], sweeps = [], sparks = [], mask = null, charge = null, rainbow = 0;
  const pickers = new Set();

  function load() {
    const out = { ...DEFAULT };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      // Earlier versions saved only style and palette, with Flow as the
      // default; a saved Flow from then becomes the new default, Dots.
      if (STYLES[saved.style] && !(saved.v !== 2 && saved.style === 'flow')) out.style = saved.style;
      if (PALETTES[saved.palette]) out.palette = saved.palette;
      if (ENERGY[saved.energy]) out.energy = saved.energy;
      if (typeof saved.surprises === 'boolean') out.surprises = saved.surprises;
      if (hexToRgb(saved.dot)) out.dot = saved.dot.toLowerCase();
    } catch (e) { /* private mode or blocked storage: the defaults are fine */ }
    return out;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, v: 2 })); } catch (e) { /* see load() */ } }

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectiveStyle = () => (reducedMotion() ? 'still' : prefs.style);
  const surprisesOn = () => prefs.surprises && !reducedMotion() && effectiveStyle() !== 'still';
  const E = () => ENERGY[prefs.energy] || ENERGY.lively;

  /* ---- colours ---- */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  }
  /* Lighten a colour towards white, so even a dark red becomes a soft wash. */
  const soften = (rgb, k) => rgb.map(v => Math.round(v + (255 - v) * k));
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const css = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  /* Time of day: four anchor sets, blended by the hour. */
  const DAY = [
    { h: 6,  bg: '#f7efe9', blobs: ['#ffd1b8', '#ffe3a8', '#f7c6d6', '#ffe9d6', '#f3d5c0'], ink: [92, 60, 50], glow: '#ff8a5c' },   // dawn
    { h: 12, bg: '#edf3f9', blobs: ['#9cc8ff', '#a6e4e0', '#c3cffd', '#d9ecff', '#b4dcf5'], ink: [40, 62, 98], glow: '#3f8cff' },   // day
    { h: 18, bg: '#f5eff4', blobs: ['#f4b8c8', '#cbb8f2', '#ffc9a3', '#e8c6ee', '#d3c3f5'], ink: [84, 52, 88], glow: '#c05ad8' },   // dusk
    { h: 23, bg: '#e9ecf4', blobs: ['#aab6e6', '#b9c2ee', '#9fb0dc', '#c6cdee', '#b2bce4'], ink: [36, 44, 84], glow: '#5c6cff' },   // night
  ];
  function daylight(date = new Date()) {
    const h = date.getHours() + date.getMinutes() / 60;
    const k = DAY.length;
    let i = DAY.findIndex((d, j) => h >= d.h && h < DAY[(j + 1) % k].h + (j === k - 1 ? 24 : 0));
    if (i < 0) i = k - 1;                       // 23:00 to 06:00 is night into dawn
    const a = DAY[i], b = DAY[(i + 1) % k];
    const span = ((b.h - a.h) + 24) % 24, t = Math.min(1, (((h - a.h) + 24) % 24) / span);
    const e = t * t * (3 - 2 * t);
    return {
      bg: mix(hexToRgb(a.bg), hexToRgb(b.bg), e),
      blobs: a.blobs.map((c, j) => mix(hexToRgb(c), hexToRgb(b.blobs[j]), e)),
      ink: mix(a.ink, b.ink, e), glow: mix(hexToRgb(a.glow), hexToRgb(b.glow), e),
    };
  }
  function resolveColours() {
    const c = paletteColours();
    c.dot = hexToRgb(prefs.dot) || c.glow;
    return c;
  }
  function paletteColours() {
    const p = PALETTES[prefs.palette] || PALETTES.glacier;
    if (prefs.palette === 'daylight') return daylight();
    if (prefs.palette !== 'filament') {
      return { bg: hexToRgb(p.bg), blobs: p.blobs.map(hexToRgb), ink: p.ink, glow: hexToRgb(p.glow) };
    }
    // The filament set reads the colours workshop.js tintRoom() puts on the
    // page (--fil-a, --fil-b), so it follows whatever is loaded.
    const root = getComputedStyle(document.documentElement);
    const a = hexToRgb(root.getPropertyValue('--fil-a')) || [125, 178, 255];
    const b = hexToRgb(root.getPropertyValue('--fil-b')) || [154, 184, 232];
    return {
      bg: hexToRgb(p.bg),
      blobs: [soften(a, 0.55), soften(b, 0.55), soften(a, 0.72), soften(b, 0.72), [222, 228, 238]],
      ink: p.ink, glow: mix(a, [40, 50, 70], 0.15),
    };
  }
  /* The lit colour, or a hue that walks round the wheel in rainbow mode. */
  function litColour(i = 0) {
    if (rainbow > 0) {
      const h = ((clock * 90 + i * 7) % 360) / 60, c = 200, x = c * (1 - Math.abs(h % 2 - 1));
      const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
      return [r + 30, g + 30, b + 30];
    }
    return colours.dot;
  }

  /* ---- setup ---- */
  function mount() {
    const host = document.querySelector('.bg');
    if (!host || canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'backdrop-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    ctx = canvas.getContext('2d', { alpha: false });
    addEventListener('pointermove', onPointer, { passive: true });
    addEventListener('pointerdown', onDown, { passive: true });
    addEventListener('pointerup', onUp, { passive: true });
    addEventListener('pointercancel', () => { charge = null; pointer.down = 0; }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { pointer.inside = false; wake(); });
    addEventListener('blur', () => { pointer.inside = false; charge = null; wake(); });
    addEventListener('resize', () => { resize(); drawFrame(0); });
    addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else { colours = resolveColours(); drawFrame(0); } });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
    // The filament set follows the printer: tintRoom() edits <html>'s style.
    new MutationObserver(() => {
      if (prefs.palette !== 'filament') return;
      colours = resolveColours();
      drawFrame(0);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    // One cheap check a second for the clock surprises and the time-of-day colours.
    setInterval(tickClock, 1000);
    apply();
    document.querySelectorAll('[data-backdrop-picker]').forEach(picker);
  }

  function apply() {
    if (!canvas) return;
    const root = document.documentElement;
    root.dataset.backdrop = effectiveStyle();
    root.dataset.backdropPalette = prefs.palette;
    colours = resolveColours();
    resize();
    stop();
    drawFrame(0);
    pickers.forEach(paintPicker);
  }

  function resize() {
    if (!canvas) return;
    W = innerWidth; H = innerHeight;
    const style = effectiveStyle();
    // Flow and Still are soft gradients: a small canvas stretched to the
    // window is just as smooth and a tiny fraction of the work.
    dpr = style === 'flow' || style === 'still' ? 1 / 6 : Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(2, Math.round(W * dpr));
    canvas.height = Math.max(2, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    initBlobs();
    grid = null; trail = []; mask = null;
  }

  function initBlobs() {
    const homes = [[0.18, 0.12], [0.78, 0.2], [0.55, 0.62], [0.12, 0.78], [0.9, 0.86]];
    const size = Math.max(W, H);
    blobs = homes.map(([hx, hy], i) => ({ hx, hy, x: hx * W, y: hy * H, vx: 0, vy: 0, r: size * [0.42, 0.36, 0.4, 0.34, 0.3][i] }));
    glow = { x: W / 2, y: H / 3, a: 0 };
  }

  /* ---- input ---- */
  function onPointer(e) {
    const now = performance.now();
    const dt = Math.max(8, now - (pointer.t || now - 16)) / 1000;
    if (pointer.inside) {
      // Velocity in px/s, smoothed so one jumpy event doesn't fling things.
      pointer.vx = pointer.vx * 0.55 + ((e.clientX - pointer.x) / dt) * 0.45;
      pointer.vy = pointer.vy * 0.55 + ((e.clientY - pointer.y) / dt) * 0.45;
    } else {
      pointer.sx = e.clientX; pointer.sy = e.clientY; pointer.vx = pointer.vy = 0;
    }
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = now; pointer.inside = true;
    lastInput = now;
    wake();
  }
  /* Only clicks on the background itself (the gaps between cards, the page
   * margins) set off surprises; a click on anything you can use doesn't. */
  const onBackground = (t) => !(t && t.closest && t.closest('.card, button, a, input, select, textarea, label, summary, dialog, nav, header, .topbar, .tabbar, .status-ribbon, .live-pill, .notice, .stats, canvas:not(.backdrop-canvas), [role="button"], .game-frame'));
  const taps = [];
  function onDown(e) {
    onPointer(e);
    if (!surprisesOn() || !onBackground(e.target)) return;
    const now = performance.now();
    pointer.down = 1; pointer.downAt = now;
    taps.push(now); while (taps.length && now - taps[0] > 900) taps.shift();
    if (taps.length >= 3) { taps.length = 0; bloom(e.clientX, e.clientY); return; }
    ripple(e.clientX, e.clientY, 1);
    // Hold still for half a second and the dots gather; let go to release.
    charge = { x: e.clientX, y: e.clientY, at: now, level: 0 };
  }
  function onUp(e) {
    pointer.down = 0;
    if (charge && charge.level > 0.25) {
      ripple(charge.x, charge.y, 1 + charge.level * 2.4);
      sparksAt(charge.x, charge.y, 14 + Math.round(charge.level * 30), [litColour()]);
    }
    charge = null;
    wake();
  }
  let typed = '';
  const KONAMI = 'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,b,a';
  let konami = [];
  function onKey(e) {
    if (!surprisesOn() || e.target.closest?.('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('tab-games')?.hidden) return;   // games own the keyboard
    konami.push(e.key.length === 1 ? e.key.toLowerCase() : e.key); konami = konami.slice(-10);
    if (konami.join(',') === KONAMI) { konami = []; rainbow = 12; bloom(W / 2, H / 2); return; }
    if (e.key.length === 1) {
      typed = (typed + e.key.toLowerCase()).slice(-3);
      if (typed.endsWith('u1')) { typed = ''; showText('U1', 4.5); ripple(W / 2, H / 2, 1.6); }
    }
  }

  /* ---- surprises (the hidden things) ----------------------------------
   * Each is a small function that adds waves, sparks, sweeps or a dot
   * pattern; the styles below all respond to the same four. To add one,
   * write it here and trigger it from input, the clock or an app event. */
  function ripple(x, y, power = 1) {
    if (!surprisesOn()) return;
    waves.push({ x, y, t: 0, power, speed: 520 + power * 140, life: 1.6 + power * 0.4 });
    if (waves.length > 12) waves.shift();
    wake();
  }
  function bloom(x, y) {
    for (let i = 0; i < 4; i++) setTimeout(() => ripple(x, y, 1.2 + i * 0.35), i * 140);
    sparksAt(x, y, 46, [litColour()]);
  }
  function sparksAt(x, y, n, palette) {
    if (!surprisesOn()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 420;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 1, decay: 0.55 + Math.random() * 0.6, r: 1.5 + Math.random() * 3, c: palette[i % palette.length] });
    }
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
    wake();
  }
  /* A band that crosses the screen like a nozzle laying down a line. */
  function sweep(dir = 1) {
    if (!surprisesOn()) return;
    sweeps.push({ t: 0, dir, dur: 2.2 });
    wake();
  }
  /* Draw words in the dots (or as a glow in Flow): the clock on the hour,
   * "U1" when you type it. */
  function showText(text, seconds = 4) {
    if (!surprisesOn()) return;
    mask = { text, t: 0, dur: seconds, cells: null };
    wake();
  }
  /* A print finished: the dots ripple out from the middle, a line sweeps across
   * like a nozzle laying the last layer, and two bursts follow. About 2.5 s, in
   * the set's one dot colour; nothing to dismiss. */
  function celebrate() {
    const pal = [litColour()];
    bloom(W / 2, H * 0.4);
    sweep(1);
    setTimeout(() => sparksAt(W * 0.25, H * 0.3, 40, pal), 250);
    setTimeout(() => sparksAt(W * 0.75, H * 0.3, 40, pal), 450);
  }
  let lastMinute = -1;
  function tickClock() {
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    if (lastMinute < 0) { lastMinute = m; return; }
    if (m === lastMinute || document.hidden) return;
    lastMinute = m;
    if (prefs.palette === 'daylight') { colours = resolveColours(); if (!raf) drawFrame(0); }
    if (!surprisesOn()) return;
    if (now.getMinutes() === 0) {
      const label = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM|am|pm)$/, '');
      showText(label, 5);
      ripple(W / 2, H / 2, 2);
    } else if (now.getMinutes() === 30) {
      ripple(0, 0, 1.4); ripple(W, H, 1.4);
    } else {
      sweep(now.getMinutes() % 2 ? -1 : 1);
    }
  }

  /* ---- the loop: runs only while something is moving ---- */
  function wake() {
    if (raf || !canvas || document.hidden || effectiveStyle() === 'still') return;
    if (getComputedStyle(canvas.parentElement).display === 'none') return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    clock += dt;
    // Follow the pointer with a little lag: that lag is what reads as fluid.
    const follow = 1 - Math.exp(-dt * 18);
    pointer.sx += (pointer.x - pointer.sx) * follow;
    pointer.sy += (pointer.y - pointer.sy) * follow;
    if (now - lastInput > 60) { pointer.vx *= Math.exp(-dt * 8); pointer.vy *= Math.exp(-dt * 8); }
    stepSurprises(dt, now);
    drawFrame(dt, now);
    const busy = waves.length || sparks.length || sweeps.length || mask || charge || rainbow > 0;
    const settled = energy < ({ flow: 1, lines: 0.02, dots: 0.012, constellation: 0.012 }[effectiveStyle()] ?? 0.02);
    raf = now - lastInput < 900 || busy || !settled ? requestAnimationFrame(frame) : 0;
  }
  function stepSurprises(dt, now) {
    waves.forEach(w => { w.t += dt; }); waves = waves.filter(w => w.t < w.life);
    sweeps.forEach(s => { s.t += dt; }); sweeps = sweeps.filter(s => s.t < s.dur);
    sparks.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.vx *= Math.exp(-dt * 1.6); p.life -= dt * p.decay; });
    sparks = sparks.filter(p => p.life > 0);
    if (mask) { mask.t += dt; if (mask.t > mask.dur) mask = null; }
    if (charge && pointer.down) charge.level = Math.min(1, Math.max(0, (now - charge.at - 450) / 1400));
    if (rainbow > 0) rainbow = Math.max(0, rainbow - dt);
  }
  /* How far a ripple pushes a point outward at its distance, right now. */
  function waveAt(x, y) {
    let dx = 0, dy = 0, lit = 0;
    for (const w of waves) {
      const ex = x - w.x, ey = y - w.y, d = Math.hypot(ex, ey) || 1, front = w.t * w.speed, fade = 1 - w.t / w.life;
      const k = Math.exp(-((d - front) ** 2) / (2 * 36 * 36)) * fade * w.power;
      if (k < 0.01) continue;
      dx += (ex / d) * k * 16; dy += (ey / d) * k * 16; lit = Math.max(lit, k);
    }
    for (const s of sweeps) {
      const p = s.t / s.dur, bx = s.dir > 0 ? -80 + p * (W + 160) : W + 80 - p * (W + 160);
      const k = Math.exp(-((x - bx) ** 2) / (2 * 26 * 26)) * Math.sin(Math.PI * p);
      if (k < 0.01) continue;
      dy -= k * 5; lit = Math.max(lit, k * 0.8);
    }
    return { dx, dy, lit };
  }

  function drawFrame(dt, now = performance.now()) {
    if (!ctx) return;
    const style = effectiveStyle();
    if (style === 'flow' || style === 'still') flow(dt, style === 'still');
    else if (style === 'lines') lines(dt, now);
    else dotsFrame(dt, style === 'constellation');
    drawSparks();
  }
  function drawSparks() {
    if (!sparks.length) return;
    for (const p of sparks) {
      ctx.fillStyle = css(p.c, Math.max(0, p.life) * 0.9);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + p.life * 0.6), 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---- Flow ---- */
  function flow(dt, still) {
    energy = 0;
    const R = Math.max(W, H) * 0.32 * E().reach;
    for (const b of blobs) {
      if (!still && dt) {
        // Pulled home by a soft spring, stirred by the pointer's motion and
        // nudged out of its way; ripples push them outward too.
        let ax = (b.hx * W - b.x) * 3.2 * E().spring, ay = (b.hy * H - b.y) * 3.2 * E().spring;
        if (pointer.inside) {
          const dx = b.x - pointer.sx, dy = b.y - pointer.sy, d = Math.hypot(dx, dy) || 1;
          const w = Math.exp(-(d * d) / (R * R));
          ax += pointer.vx * w * 2.6 * E().swirl + (dx / d) * w * 1000 * E().push;
          ay += pointer.vy * w * 2.6 * E().swirl + (dy / d) * w * 1000 * E().push;
        }
        const wv = waveAt(b.x, b.y);
        ax += wv.dx * 60; ay += wv.dy * 60;
        b.vx = (b.vx + ax * dt) * Math.exp(-dt * 2.6);
        b.vy = (b.vy + ay * dt) * Math.exp(-dt * 2.6);
        b.x += b.vx * dt; b.y += b.vy * dt;
        energy += Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.hx * W - b.x) * 0.05 + Math.abs(b.hy * H - b.y) * 0.05;
      }
    }
    if (!still && dt) {
      const target = pointer.inside ? 1 : 0;
      glow.a += (target - glow.a) * (1 - Math.exp(-dt * 3));
      glow.x += (pointer.sx - glow.x) * (1 - Math.exp(-dt * 7));
      glow.y += (pointer.sy - glow.y) * (1 - Math.exp(-dt * 7));
      if (Math.abs(target - glow.a) > 0.01) energy += 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css(colours.bg);
    ctx.fillRect(0, 0, W, H);
    blobs.forEach((b, i) => {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      const c = colours.blobs[i % colours.blobs.length];
      g.addColorStop(0, css(c, 0.72)); g.addColorStop(0.45, css(c, 0.32)); g.addColorStop(1, css(c, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
    const glowA = Math.max(glow.a, charge ? charge.level : 0);
    if (glowA > 0.01) {
      const r = Math.max(W, H) * (0.2 + (charge ? charge.level * 0.15 : 0));
      const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, r);
      g.addColorStop(0, css(litColour(), 0.3 * glowA)); g.addColorStop(1, css(litColour(), 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (mask && !still) {
      // Words glow softly in Flow rather than being drawn in dots.
      const k = Math.sin(Math.PI * Math.min(1, mask.t / mask.dur));
      ctx.save(); ctx.globalAlpha = 0.5 * k; ctx.fillStyle = css(litColour());
      ctx.font = `700 ${Math.round(Math.min(W, H) * 0.22)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.filter = 'blur(6px)';
      ctx.fillText(mask.text, W / 2, H * 0.24); ctx.restore();
    }
  }

  /* ---- Layer lines ---- */
  const GAP = 6, SIGMA = 70;
  function lines(dt, now) {
    // The pointer leaves a wake: points that fade over about a second.
    if (dt && pointer.inside) {
      const lastPt = trail[trail.length - 1];
      if (!lastPt || Math.hypot(lastPt.x - pointer.sx, lastPt.y - pointer.sy) > 10) trail.push({ x: pointer.sx, y: pointer.sy, s: 1 });
      else lastPt.s = 1;
    }
    trail.forEach(p => { p.s *= Math.exp(-dt * 2.4 * E().spring); });
    trail = trail.filter(p => p.s > 0.02).slice(-14);
    energy = trail.reduce((n, p) => n + p.s, 0);

    ctx.fillStyle = css(colours.bg);
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, Math.max(W, H) * 0.8);
    g.addColorStop(0, css(colours.blobs[0], 0.5)); g.addColorStop(1, css(colours.blobs[0], 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const ink = colours.ink, near = [], far = new Path2D(), sig = SIGMA * E().reach, reach = sig * 3;
    const lit = waves.length || sweeps.length;
    for (let y0 = GAP / 2; y0 < H; y0 += GAP) {
      const active = trail.filter(p => Math.abs(p.y - y0) < reach);
      if (!active.length && !lit) { far.moveTo(0, y0); far.lineTo(W, y0); continue; }
      const path = new Path2D();
      let peak = 0;
      const x0 = active.length ? Math.max(0, Math.min(...active.map(p => p.x)) - reach) : 0;
      const x1 = active.length && !lit ? Math.min(W, Math.max(...active.map(p => p.x)) + reach) : W;
      path.moveTo(0, y0); path.lineTo(x0, y0);
      for (let x = x0; x <= x1; x += 8) {
        let dy = 0;
        for (const p of active) {
          const ex = x - p.x, ey = y0 - p.y;
          // Lines bow away from the pointer: up above it, down below it.
          dy += p.s * ey * 0.9 * E().push * Math.exp(-(ex * ex + ey * ey) / (2 * sig * sig));
        }
        if (lit) { const wv = waveAt(x, y0); dy += wv.dy * 1.2; peak = Math.max(peak, wv.lit * 18); }
        peak = Math.max(peak, Math.abs(dy));
        path.lineTo(x, y0 + dy);
      }
      path.lineTo(W, y0);
      near.push({ path, peak });
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = css(ink, 0.06);
    ctx.stroke(far);
    for (const n of near) {
      const k = Math.min(1, n.peak / 18);
      ctx.strokeStyle = k > 0.05 ? css(litColour(), 0.08 + k * 0.3) : css(ink, 0.06);
      ctx.stroke(n.path);
    }
  }

  /* ---- Dots and Constellation ---- */
  const STEP = 22;
  function buildGrid() {
    const cols = Math.ceil(W / STEP) + 1, rows = Math.ceil(H / STEP) + 1, n = cols * rows;
    const hx = new Float32Array(n), hy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // A whisper of jitter so the grid reads as material, not graph paper.
      const c = i % cols, r = Math.floor(i / cols), j = Math.sin(i * 12.9898) * 43758.5453;
      hx[i] = c * STEP + STEP / 2 + (j - Math.floor(j) - 0.5) * 3;
      hy[i] = r * STEP + STEP / 2 + (Math.sin(i * 78.233) * 0.5) * 3;
    }
    grid = { cols, rows, n, hx, hy, ox: new Float32Array(n), oy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), glow: new Float32Array(n), lit: new Float32Array(n) };
  }
  /* Which grid dots are inside the words being shown, drawn once into a
   * tiny canvas the size of the grid. */
  function maskCells() {
    if (!mask || mask.cells) return mask && mask.cells;
    const { cols, rows } = grid, c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.font = `800 ${Math.round(rows * 0.34)}px "Bricolage Grotesque", system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    let size = rows * 0.34;
    while (x.measureText(mask.text).width > cols * 0.8 && size > 6) { size -= 1; x.font = `800 ${Math.round(size)}px "Bricolage Grotesque", system-ui, sans-serif`; }
    // High on the screen, where the glass bars show the background.
    x.fillText(mask.text, cols / 2, rows * 0.24);
    const data = x.getImageData(0, 0, cols, rows).data, cells = new Uint8Array(cols * rows);
    for (let i = 0; i < cells.length; i++) cells[i] = data[i * 4 + 3] > 110 ? 1 : 0;
    mask.cells = cells;
    return cells;
  }
  function dotsFrame(dt, joined) {
    if (!grid) buildGrid();
    const { cols, n, hx, hy, ox, oy, vx, vy, glow: gl, lit } = grid, e = E();
    const R = 170 * e.reach, R2 = R * R;
    const cells = mask ? maskCells() : null;
    const maskK = mask ? Math.min(1, mask.t / 0.6, (mask.dur - mask.t) / 0.8) : 0;
    const chargeR = charge ? 60 + charge.level * 160 : 0;
    energy = 0;
    if (dt) {
      const k = 64 / e.spring, damp = Math.exp(-dt * 8 * e.spring), pv = Math.hypot(pointer.vx, pointer.vy);
      for (let i = 0; i < n; i++) {
        let ax = -ox[i] * k, ay = -oy[i] * k, glowT = 0;
        const x = hx[i] + ox[i], y = hy[i] + oy[i];
        if (pointer.inside) {
          const dx = x - pointer.sx, dy = y - pointer.sy, d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2), f = (1 - d / R) ** 2;
            // Pushed away, and dragged along with the pointer's motion: a stir.
            ax += (dx / d) * f * 3000 * e.push + pointer.vx * f * 9 * e.swirl;
            ay += (dy / d) * f * 3000 * e.push + pointer.vy * f * 9 * e.swirl;
            // A gentle curl around the pointer when it moves fast.
            ax += (-dy / d) * f * Math.min(900, pv) * 1.2 * e.swirl;
            ay += (dx / d) * f * Math.min(900, pv) * 1.2 * e.swirl;
            glowT = Math.max(glowT, f * 1.6);
          }
        }
        if (charge) {
          // Long press: dots are drawn into a ring around the finger.
          const dx = x - charge.x, dy = y - charge.y, d = Math.hypot(dx, dy) || 1;
          if (d < chargeR * 1.8) { const f = (1 - d / (chargeR * 1.8)) * charge.level; ax -= (dx / d) * f * 2200; ay -= (dy / d) * f * 2200; glowT = Math.max(glowT, f * 1.5); }
        }
        if (waves.length || sweeps.length) {
          const wv = waveAt(hx[i], hy[i]);
          ax += wv.dx * 260; ay += wv.dy * 260; glowT = Math.max(glowT, wv.lit);
        }
        vx[i] = (vx[i] + ax * dt) * damp;
        vy[i] = (vy[i] + ay * dt) * damp;
        ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
        const target = cells && cells[i] ? maskK : 0;
        lit[i] += (target - lit[i]) * (1 - Math.exp(-dt * 10));
        gl[i] += (glowT - gl[i]) * (1 - Math.exp(-dt * (glowT > gl[i] ? 20 : 3.5)));
        energy += Math.abs(ox[i]) + Math.abs(vx[i]) * 0.1 + gl[i] * 4 + lit[i] * 4;
      }
      energy /= n;
    }
    ctx.fillStyle = css(colours.bg);
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.8, H, 0, W * 0.8, H, Math.max(W, H) * 0.9);
    g.addColorStop(0, css(colours.blobs[1], 0.55)); g.addColorStop(1, css(colours.blobs[1], 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W * 0.1, 0, 0, W * 0.1, 0, Math.max(W, H) * 0.7);
    g2.addColorStop(0, css(colours.blobs[0], 0.45)); g2.addColorStop(1, css(colours.blobs[0], 0));
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

    if (joined && pointer.inside) {
      // Constellation: join each lit dot to its lit neighbours, and the
      // brightest few to the pointer.
      const path = new Path2D(), hub = new Path2D();
      for (let i = 0; i < n; i++) {
        if (gl[i] < 0.12) continue;
        const x = hx[i] + ox[i], y = hy[i] + oy[i];
        for (const j of [i + 1, i + cols, i + cols + 1, i + cols - 1]) {
          if (j >= n || gl[j] < 0.12 || (j === i + 1 && (i + 1) % cols === 0)) continue;
          path.moveTo(x, y); path.lineTo(hx[j] + ox[j], hy[j] + oy[j]);
        }
        if (gl[i] > 0.9) { hub.moveTo(pointer.sx, pointer.sy); hub.lineTo(x, y); }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = css(litColour(), 0.32); ctx.stroke(path);
      ctx.strokeStyle = css(litColour(), 0.14); ctx.stroke(hub);
    }
    // Four brightness buckets keep this to a handful of fills, all one colour:
    // a lit dot is the same colour, only bigger and stronger.
    const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const textDots = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = hx[i] + ox[i], y = hy[i] + oy[i], b = Math.min(1, gl[i]);
      if (lit[i] > 0.05) { const r = 2 + lit[i] * 2.6; textDots.moveTo(x + r, y); textDots.arc(x, y, r, 0, Math.PI * 2); continue; }
      const moved = Math.min(1, (Math.abs(ox[i]) + Math.abs(oy[i])) / 30);
      const r = (joined ? 1.5 : 1.35) + b * 1.9 + moved * 0.9;
      const q = b < 0.08 ? 0 : b < 0.35 ? 1 : b < 0.7 ? 2 : 3;
      buckets[q].moveTo(x + r, y); buckets[q].arc(x, y, r, 0, Math.PI * 2);
    }
    const glowC = litColour();
    ctx.fillStyle = css(glowC, joined ? 0.3 : 0.26); ctx.fill(buckets[0]);
    ctx.fillStyle = css(glowC, 0.42); ctx.fill(buckets[1]);
    ctx.fillStyle = css(glowC, 0.6); ctx.fill(buckets[2]);
    ctx.fillStyle = css(glowC, 0.85); ctx.fill(buckets[3]);
    if (mask) { ctx.fillStyle = css(glowC, 0.9); ctx.fill(textDots); }
  }

  /* ---- the picker (Settings, setup screens) ---- */
  function picker(host) {
    if (!host || pickers.has(host)) return;
    host.classList.add('backdrop-picker');
    host.innerHTML = `
      <fieldset class="bp-group"><legend>Background</legend>
        <div class="bp-styles">${Object.entries(STYLES).map(([id, s]) => `
          <button type="button" class="bp-style" data-style="${id}" aria-pressed="false">
            <span class="bp-thumb bp-thumb-${id}" aria-hidden="true"></span>
            <span class="bp-name">${s.label}</span><span class="bp-hint">${s.hint}</span>
          </button>`).join('')}</div>
      </fieldset>
      <fieldset class="bp-group"><legend>Colours</legend>
        <div class="bp-palettes">${Object.entries(PALETTES).map(([id, p]) => `
          <button type="button" class="bp-palette" data-palette="${id}" aria-pressed="false" title="${p.hint || p.label}">
            <span class="bp-swatch" aria-hidden="true" style="background:${swatch(id, p)}"></span>
            <span class="bp-name">${p.label}</span>
          </button>`).join('')}</div>
      </fieldset>
      <fieldset class="bp-group"><legend>Dot colour</legend>
        <div class="bp-dots" role="group" aria-label="Dot colour">${DOTS.map(d => `
          <button type="button" class="bp-dot" data-dot="${d.id}" aria-pressed="false" title="${d.label}" aria-label="${d.label}">
            <span aria-hidden="true" ${d.id ? `style="background:${d.id}"` : 'class="bp-dot-auto"'}></span></button>`).join('')}
          <label class="bp-dot bp-dot-custom" title="Any colour"><span class="sr-only">Any colour</span>
            <input type="color" data-dot-custom value="#3f8cff"></label>
        </div>
        <p class="bp-hint">Every dot uses this one colour, at rest and when it lights up.</p>
      </fieldset>
      <div class="bp-row">
        <fieldset class="bp-group"><legend>Reaction</legend>
          <div class="pill-toggle bp-energy" role="group" aria-label="How strongly the background reacts">${Object.entries(ENERGY).map(([id, e]) => `
            <button type="button" data-energy="${id}" aria-pressed="false">${e.label}</button>`).join('')}</div>
        </fieldset>
        <fieldset class="bp-group"><legend>Little surprises</legend>
          <label class="bp-switch"><input type="checkbox" data-surprises> On</label>
          <p class="bp-hint">Try clicking an empty part of the page, and keep an eye on it on the hour. There are a couple of secrets too.</p>
        </fieldset>
      </div>
      <p class="bp-note" data-note></p>`;
    host.addEventListener('click', (e) => {
      const s = e.target.closest('[data-style]'), p = e.target.closest('[data-palette]'), en = e.target.closest('[data-energy]');
      if (s) set({ style: s.dataset.style });
      if (p) set({ palette: p.dataset.palette });
      const d = e.target.closest('[data-dot]');
      if (d) { set({ dot: d.dataset.dot }); ripple(innerWidth / 2, innerHeight / 2, 0.9); }
      if (en) { set({ energy: en.dataset.energy }); ripple(innerWidth / 2, innerHeight / 2, 1.2); }
    });
    host.querySelector('[data-dot-custom]').addEventListener('input', (e) => set({ dot: e.target.value }));
    host.querySelector('[data-surprises]').addEventListener('change', (e) => {
      set({ surprises: e.target.checked });
      if (e.target.checked) { const r = e.target.getBoundingClientRect(); bloom(r.left + r.width / 2, r.top); }
    });
    pickers.add(host);
    paintPicker(host);
  }
  function swatch(id, p) {
    if (id === 'filament') return 'conic-gradient(from 90deg, #ff9a8a, #ffd36b, #8be0a8, #7fb2ff, #c99bff, #ff9a8a)';
    if (id === 'daylight') return `linear-gradient(135deg, ${DAY[0].blobs[0]}, ${DAY[1].blobs[0]} 40%, ${DAY[2].blobs[1]} 70%, ${DAY[3].blobs[0]})`;
    return `linear-gradient(135deg, ${p.blobs[0]}, ${p.blobs[1]} 50%, ${p.blobs[2]})`;
  }
  function paintPicker(host) {
    if (!host.isConnected) { pickers.delete(host); return; }
    // The style thumbnails preview the chosen colours.
    const c = colours || resolveColours();
    host.style.setProperty('--bp-bg', css(c.bg));
    host.style.setProperty('--bp-a', css(c.blobs[0]));
    host.style.setProperty('--bp-b', css(c.blobs[1]));
    host.style.setProperty('--bp-c', css(c.blobs[2]));
    host.style.setProperty('--bp-ink', css(c.dot, 0.35));
    host.style.setProperty('--bp-glow', css(c.dot));
    host.style.setProperty('--bp-auto', css(paletteColours().glow));
    const mark = (sel, key) => host.querySelectorAll(sel).forEach(b => { const on = b.dataset[key] === prefs[key === 'energy' ? 'energy' : key]; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    mark('[data-style]', 'style'); mark('[data-palette]', 'palette'); mark('[data-energy]', 'energy');
    const preset = DOTS.some(d => d.id === prefs.dot);
    host.querySelectorAll('[data-dot]').forEach(b => { const on = b.dataset.dot === prefs.dot; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const well = host.querySelector('[data-dot-custom]');
    if (well) { well.closest('.bp-dot').classList.toggle('active', !preset); if (!preset) well.value = prefs.dot; }
    const box = host.querySelector('[data-surprises]');
    if (box) { box.checked = prefs.surprises; box.disabled = reducedMotion(); }
    const note = host.querySelector('[data-note]');
    if (note) {
      const bits = [];
      if (PALETTES[prefs.palette].hint) bits.push(PALETTES[prefs.palette].hint + '.');
      if (prefs.palette === 'filament') bits.push('With nothing colourful loaded it stays neutral.');
      if (reducedMotion()) bits.push('Your device asks for reduced motion, so the background stays still and the surprises are off.');
      note.textContent = bits.join(' ');
      note.hidden = !bits.length;
    }
  }

  function set(next) {
    prefs = { ...prefs, ...next };
    if (!STYLES[prefs.style]) prefs.style = DEFAULT.style;
    if (!PALETTES[prefs.palette]) prefs.palette = DEFAULT.palette;
    if (!ENERGY[prefs.energy]) prefs.energy = DEFAULT.energy;
    if (prefs.dot && !hexToRgb(prefs.dot)) prefs.dot = DEFAULT.dot;
    save();
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  return { STYLES, PALETTES, ENERGY, DOTS, get: () => ({ ...prefs }), set, picker, ripple, bloom, celebrate, sweep, showText };
})();
