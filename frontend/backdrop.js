/* Deja Vu1 - the background behind the dashboard.
 *
 * One canvas behind everything that answers the pointer: move the mouse (or
 * drag a finger) and the background makes room for it, then glides back.
 * Four styles and five colour sets, chosen in Settings > Appearance (and
 * in the setup screens). Plain JavaScript, no library.
 *
 *   Flow         soft pools of colour that swirl out of the pointer's way
 *   Layer lines  the side wall of a print: fine lines that part around it
 *   Dots         a grid of dots that springs aside and settles back
 *   Still        a calm gradient that never moves
 *
 * Cost, which matters because every glass panel blurs what's behind it:
 * the canvas only animates while the pointer is moving and for the glide
 * after it, then stops drawing completely. A tab in the background, a
 * "reduce motion" setting or a "reduce transparency" setting (which hides
 * the background) all stop it too. The choice is kept in this browser
 * only (localStorage), like the accent colour.
 */
'use strict';

const Backdrop = (() => {
  const KEY = 'dejavu1.backdrop';
  const STYLES = {
    flow:  { label: 'Flow',        hint: 'Soft colour that swirls out of your cursor’s way' },
    lines: { label: 'Layer lines', hint: 'Fine print lines that part around your cursor' },
    dots:  { label: 'Dots',        hint: 'A dot grid that springs aside and settles back' },
    still: { label: 'Still',       hint: 'A calm gradient that never moves' },
  };
  /* Light colours only: text sits straight on this background in places,
   * so every set keeps the page pale enough for the dashboard's measured
   * text contrast. `ink` draws lines and dots; `glow` follows the cursor. */
  const PALETTES = {
    glacier:  { label: 'Glacier',  bg: '#edf2f8', blobs: ['#9cc8ff', '#a6e4e0', '#c3cffd', '#d9ecff', '#b4dcf5'], ink: [40, 62, 98], glow: '#5aa2ff' },
    mint:     { label: 'Mint',     bg: '#edf5f1', blobs: ['#a3e2c3', '#c4efd8', '#94d6cf', '#ddf3c4', '#b9e8e2'], ink: [30, 80, 66], glow: '#2fbf8c' },
    dusk:     { label: 'Dusk',     bg: '#f5f0f3', blobs: ['#ffcfb6', '#f0c0d8', '#cbc4f3', '#ffe2ae', '#e6c9f0'], ink: [86, 52, 80], glow: '#ff9a72' },
    graphite: { label: 'Graphite', bg: '#eceef2', blobs: ['#d2d7df', '#c1c8d3', '#e2e5ea', '#b6c0ce', '#d9dde4'], ink: [44, 50, 62], glow: '#8796ad' },
    filament: { label: 'Filament', bg: '#eef0f4', blobs: null, ink: [40, 50, 70], glow: null, hint: 'Takes the colours of the filament loaded on your printer' },
  };
  const DEFAULT = { style: 'flow', palette: 'glacier' };

  let prefs = load();
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, lastInput = -1e9, energy = 0;
  const pointer = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, vx: 0, vy: 0, t: 0, inside: false };
  let blobs = [], glow = { x: 0, y: 0, a: 0 }, trail = [], dots = null, colours = null;
  const pickers = new Set();

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && STYLES[saved.style] && PALETTES[saved.palette]) return saved;
    } catch (e) { /* private mode or blocked storage: the default is fine */ }
    return { ...DEFAULT };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* see load() */ } }

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectiveStyle = () => (reducedMotion() ? 'still' : prefs.style);

  /* ---- colours ---- */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  }
  /* Lighten a filament colour towards white, so even a dark red becomes a
   * soft wash rather than a red page. */
  const soften = (rgb, k) => rgb.map(v => Math.round(v + (255 - v) * k));
  const css = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  function resolveColours() {
    const p = PALETTES[prefs.palette] || PALETTES.glacier;
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
      ink: p.ink,
      glow: soften(a, 0.25),
    };
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
    addEventListener('pointerdown', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { pointer.inside = false; wake(); });
    addEventListener('blur', () => { pointer.inside = false; wake(); });
    addEventListener('resize', () => { resize(); drawFrame(0); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
    // The filament set follows the printer: tintRoom() edits <html>'s style.
    new MutationObserver(() => {
      if (prefs.palette !== 'filament') return;
      colours = resolveColours();
      drawFrame(0);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
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
    dots = null;
    trail = [];
  }

  function initBlobs() {
    const homes = [[0.18, 0.12], [0.78, 0.2], [0.55, 0.62], [0.12, 0.78], [0.9, 0.86]];
    const size = Math.max(W, H);
    blobs = homes.map(([hx, hy], i) => ({
      hx, hy, x: hx * W, y: hy * H, vx: 0, vy: 0,
      r: size * [0.42, 0.36, 0.4, 0.34, 0.3][i], c: i,
    }));
    glow = { x: W / 2, y: H / 3, a: 0 };
  }

  /* ---- pointer ---- */
  function onPointer(e) {
    const now = performance.now();
    const dt = Math.max(8, now - (pointer.t || now - 16)) / 1000;
    if (pointer.inside) {
      // Velocity in px/s, smoothed so one jumpy event doesn't fling things.
      pointer.vx = pointer.vx * 0.6 + ((e.clientX - pointer.x) / dt) * 0.4;
      pointer.vy = pointer.vy * 0.6 + ((e.clientY - pointer.y) / dt) * 0.4;
    } else {
      pointer.sx = e.clientX; pointer.sy = e.clientY; pointer.vx = pointer.vy = 0;
    }
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = now; pointer.inside = true;
    lastInput = now;
    wake();
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
    // Follow the pointer with a little lag: that lag is what reads as fluid.
    const follow = 1 - Math.exp(-dt * 14);
    pointer.sx += (pointer.x - pointer.sx) * follow;
    pointer.sy += (pointer.y - pointer.sy) * follow;
    if (now - lastInput > 60) { pointer.vx *= Math.exp(-dt * 10); pointer.vy *= Math.exp(-dt * 10); }
    drawFrame(dt, now);
    // Keep going while the pointer moves and until everything has settled
    // (each style measures "still moving" in its own units).
    const recent = now - lastInput < 900;
    const settled = energy < ({ flow: 1, lines: 0.02, dots: 0.01 }[effectiveStyle()] ?? 0.02);
    raf = recent || !settled ? requestAnimationFrame(frame) : 0;
  }

  function drawFrame(dt, now = performance.now()) {
    if (!ctx) return;
    const style = effectiveStyle();
    if (style === 'flow' || style === 'still') flow(dt, style === 'still');
    else if (style === 'lines') lines(dt, now);
    else dotsFrame(dt);
  }

  /* ---- Flow ---- */
  function flow(dt, still) {
    energy = 0;
    const R = Math.max(W, H) * 0.32;
    for (const b of blobs) {
      if (!still && dt) {
        // Pulled home by a soft spring, stirred by the pointer's motion and
        // nudged out of its way.
        let ax = (b.hx * W - b.x) * 3.2, ay = (b.hy * H - b.y) * 3.2;
        if (pointer.inside) {
          const dx = b.x - pointer.sx, dy = b.y - pointer.sy, d = Math.hypot(dx, dy) || 1;
          const w = Math.exp(-(d * d) / (R * R));
          ax += pointer.vx * w * 2.4 + (dx / d) * w * 900;
          ay += pointer.vy * w * 2.4 + (dy / d) * w * 900;
        }
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
    if (glow.a > 0.01) {
      const r = Math.max(W, H) * 0.2;
      const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, r);
      g.addColorStop(0, css(colours.glow, 0.32 * glow.a)); g.addColorStop(1, css(colours.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
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
    trail.forEach(p => { p.s *= Math.exp(-dt * 2.4); });
    trail = trail.filter(p => p.s > 0.02).slice(-14);
    energy = trail.reduce((n, p) => n + p.s, 0);

    ctx.fillStyle = css(colours.bg);
    ctx.fillRect(0, 0, W, H);
    // A whisper of the palette so the page isn't flat grey.
    const g = ctx.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, Math.max(W, H) * 0.8);
    g.addColorStop(0, css(colours.blobs[0], 0.5)); g.addColorStop(1, css(colours.blobs[0], 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const ink = colours.ink, near = [], far = new Path2D(), reach = SIGMA * 3;
    for (let y0 = GAP / 2; y0 < H; y0 += GAP) {
      const active = trail.filter(p => Math.abs(p.y - y0) < reach);
      if (!active.length) { far.moveTo(0, y0); far.lineTo(W, y0); continue; }
      const path = new Path2D();
      let peak = 0;
      const x0 = Math.max(0, Math.min(...active.map(p => p.x)) - reach), x1 = Math.min(W, Math.max(...active.map(p => p.x)) + reach);
      path.moveTo(0, y0); path.lineTo(x0, y0);
      for (let x = x0; x <= x1; x += 8) {
        let dy = 0;
        for (const p of active) {
          const ex = x - p.x, ey = y0 - p.y;
          // Lines bow away from the pointer: up above it, down below it.
          dy += p.s * ey * 0.9 * Math.exp(-(ex * ex + ey * ey) / (2 * SIGMA * SIGMA));
        }
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
      ctx.strokeStyle = k > 0.05 ? css(colours.glow, 0.08 + k * 0.26) : css(ink, 0.06);
      ctx.stroke(n.path);
    }
  }

  /* ---- Dots ---- */
  const STEP = 26;
  function dotsFrame(dt) {
    if (!dots) {
      const cols = Math.ceil(W / STEP) + 1, rows = Math.ceil(H / STEP) + 1, n = cols * rows;
      dots = { cols, rows, n, ox: new Float32Array(n), oy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n) };
    }
    const { cols, n, ox, oy, vx, vy } = dots, R = 150;
    energy = 0;
    if (dt) {
      for (let i = 0; i < n; i++) {
        const hx = (i % cols) * STEP + STEP / 2, hy = Math.floor(i / cols) * STEP + STEP / 2;
        let ax = -ox[i] * 70, ay = -oy[i] * 70;
        if (pointer.inside) {
          const dx = hx + ox[i] - pointer.sx, dy = hy + oy[i] - pointer.sy, d = Math.hypot(dx, dy);
          if (d < R && d > 0.01) { const f = (1 - d / R) ** 2 * 2600; ax += (dx / d) * f; ay += (dy / d) * f; }
        }
        vx[i] = (vx[i] + ax * dt) * Math.exp(-dt * 9);
        vy[i] = (vy[i] + ay * dt) * Math.exp(-dt * 9);
        ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
        energy += Math.abs(ox[i]) + Math.abs(vx[i]) * 0.1;
      }
      energy /= n;
    }
    ctx.fillStyle = css(colours.bg);
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.8, H, 0, W * 0.8, H, Math.max(W, H) * 0.9);
    g.addColorStop(0, css(colours.blobs[1], 0.55)); g.addColorStop(1, css(colours.blobs[1], 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const calm = new Path2D(), lit = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * STEP + STEP / 2 + ox[i], y = Math.floor(i / cols) * STEP + STEP / 2 + oy[i];
      const moved = Math.abs(ox[i]) + Math.abs(oy[i]);
      const r = 1.3 + Math.min(1.4, moved * 0.06);
      const p = moved > 2 ? lit : calm;
      p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = css(colours.ink, 0.2); ctx.fill(calm);
    ctx.fillStyle = css(colours.glow, 0.6); ctx.fill(lit);
  }

  /* ---- the picker (Settings, setup screens) ---- */
  function picker(host) {
    if (!host) return;
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
            <span class="bp-swatch" aria-hidden="true" style="background:${p.blobs ? `linear-gradient(135deg, ${p.blobs[0]}, ${p.blobs[1]} 50%, ${p.blobs[2]})` : 'conic-gradient(from 90deg, #ff9a8a, #ffd36b, #8be0a8, #7fb2ff, #c99bff, #ff9a8a)'}"></span>
            <span class="bp-name">${p.label}</span>
          </button>`).join('')}</div>
        <p class="bp-note" data-note></p>
      </fieldset>`;
    host.addEventListener('click', (e) => {
      const s = e.target.closest('[data-style]'), p = e.target.closest('[data-palette]');
      if (s) set({ style: s.dataset.style });
      if (p) set({ palette: p.dataset.palette });
    });
    pickers.add(host);
    paintPicker(host);
  }
  function paintPicker(host) {
    if (!host.isConnected) { pickers.delete(host); return; }
    // The style thumbnails preview the chosen colours.
    const c = colours || resolveColours();
    host.style.setProperty('--bp-bg', css(c.bg));
    host.style.setProperty('--bp-a', css(c.blobs[0]));
    host.style.setProperty('--bp-b', css(c.blobs[1]));
    host.style.setProperty('--bp-c', css(c.blobs[2]));
    host.style.setProperty('--bp-ink', css(c.ink, 0.35));
    host.style.setProperty('--bp-glow', css(c.glow));
    host.querySelectorAll('[data-style]').forEach(b => { const on = b.dataset.style === prefs.style; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    host.querySelectorAll('[data-palette]').forEach(b => { const on = b.dataset.palette === prefs.palette; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const note = host.querySelector('[data-note]');
    if (note) {
      const bits = [];
      if (prefs.palette === 'filament') bits.push(PALETTES.filament.hint + '. With nothing colourful loaded it stays neutral.');
      if (reducedMotion() && prefs.style !== 'still') bits.push('Your device asks for reduced motion, so the background stays still.');
      note.textContent = bits.join(' ');
      note.hidden = !bits.length;
    }
  }

  function set(next) {
    prefs = { ...prefs, ...next };
    if (!STYLES[prefs.style]) prefs.style = DEFAULT.style;
    if (!PALETTES[prefs.palette]) prefs.palette = DEFAULT.palette;
    save();
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  return { STYLES, PALETTES, get: () => ({ ...prefs }), set, picker };
})();
