/* The Slicer's Preview page: the sliced G-code drawn as the toolpath, a layer slider on the right edge, a move slider along the bottom, a legend
 * coloured by line type, head, speed, flow, layer height or line width, the time and filament the slicer worked out, and the warnings that
 * matter on a tool changer, each of which jumps to the layer where it happens.
 *
 * The G-code is read in a worker (slicer-gcode-worker.js) with every move kept, and drawn by the scene (slicer-scene.js, setPath). The figures
 * for time and filament are the slicer's own, from the file's header comments; the per-line-type times here are nominal (length over
 * requested speed) and are labelled so. */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, fmt, say, timeWords, hexRGB } = SL;
  const P = { data: null, name: null, worker: null, id: 0, mode: 0, min: 1, max: 1, move: 0, playing: false, hidden: new Set(), travel: false, under: false, warnings: [] };
  SL.pathState = P;
  const MODES = [['Line type', 0], ['Head', 1], ['Speed', 2], ['Flow', 3], ['Layer height', 4], ['Line width', 5]];
  const GRADIENT = 'linear-gradient(90deg, #2957db, #1fbd94 33%, #f5d633 66%, #ed4338)';

  /* ---- reading the file ----------------------------------------------------------------------------------------------------------------- */
  function parseInWorker(buffer) {
    return new Promise((resolve, reject) => {
      if (!P.worker) {
        P.worker = new Worker('/slicer-gcode-worker.js');
        P.worker.onmessage = ev => { const slot = P.waiting && P.waiting.get(ev.data.id); if (slot) { P.waiting.delete(ev.data.id); ev.data.ok ? slot.resolve(ev.data) : slot.reject(new Error(ev.data.error)); } };
        P.worker.onerror = () => { for (const s of (P.waiting || new Map()).values()) s.reject(new Error('The G-code reader stopped.')); P.waiting = new Map(); P.worker = null; };
        P.waiting = new Map();
      }
      const id = ++P.id;
      P.waiting.set(id, { resolve, reject });
      P.worker.postMessage({ id, buffer }, [buffer]);
    });
  }

  async function load(name) {
    P.loading = true; P.name = name; paintMessage('Reading the G-code…');
    try {
      const res = await fetch(`/api/files/raw?name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`The file could not be read (${res.status})`);
      const data = await parseInWorker(await res.arrayBuffer());
      if (!data.n) throw new Error('This G-code has no moves to show.');
      setData(data);
    } catch (e) { P.data = null; paintMessage(e.message, true); }
    P.loading = false;
  }

  /* typical ranges for the colour ramps: from the 5th to the 95th percentile of the moves that print, so one outlier does not wash the rest out */
  function ranges(d) {
    const sp = [], fl = [], hh = [], ww = [], step = Math.max(1, Math.floor(d.n / 40000));
    for (let i = 0; i < d.n; i += step) {
      if (!(d.a[i * 4] >= 256)) continue;
      const w = d.c[i * 4] / 100, h = d.c[i * 4 + 1] / 100, v = d.a[i * 4 + 2];
      sp.push(v); fl.push(w * h * v); hh.push(h); ww.push(w);
    }
    const pick = (arr, lo = 0.03, hi = 0.97) => { if (!arr.length) return [0, 1]; arr.sort((a, b) => a - b); const a = arr[Math.floor(arr.length * lo)], b = arr[Math.floor(arr.length * hi)]; return a === b ? [a - 1, b + 1] : [a, b]; };
    return [null, null, pick(sp), pick(fl), pick(hh), pick(ww)];
  }

  function setData(d) {
    const v = state.view;
    P.data = { ...d, p: null, a: d.a, c: d.c };           // the arrays the page still needs for warnings stay; positions go to the graphics card
    P.ranges = ranges(d);
    P.first = firstUse(d);
    v.setPath({ n: d.n, p: d.p, a: d.a.slice(), c: d.c.slice(), layers: d.layers });
    P.min = 1; P.max = d.layers.length; P.one = false; P.hidden = new Set(); P.mode = 0; P.travel = false; P.under = false;
    v.hidePlate = false;
    applyView(true);
    buildDock(); buildLayerSlider(); buildMoveSlider(); computeWarnings();
    v.setMode('preview'); paintMessage('');
    const b = d.bounds;
    if (isFinite(b.min[0])) { v.animateTo({ target: b.min.map((x, i) => (x + b.max[i]) / 2), dist: v.fitDistance(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 40) * 1.5) }); }
    SL.preview.renderGo && SL.preview.renderGo();
  }

  /* for each head: the first move that prints with it outside the prime tower and the skirt, for the "stray head" warning */
  function firstUse(d) {
    const out = {};
    for (let i = 0; i < d.n; i++) {
      const code = d.a[i * 4];
      if (code < 256) continue;
      const rest = code - 256, tool = Math.floor(rest / 32), feature = rest - tool * 32;
      if (feature === 13 || feature === 9 || feature === 10) continue;
      if (!(tool in out)) out[tool] = { i, layer: d.a[i * 4 + 1] };
    }
    return out;
  }

  /* ---- the view ---------------------------------------------------------------------------------------------------------------------------- */
  function applyView(resetMove) {
    const v = state.view, d = P.data;
    if (!v || !d) return;
    const layers = d.layers, top = layers[Math.min(P.max, layers.length) - 1];
    if (resetMove) P.move = top ? top.last : 0;
    P.move = Math.max(top ? top.first : 0, Math.min(P.move, top ? top.last : 0));
    const range = P.ranges[P.mode] || [0, 1];
    v.setPathView({ mode: P.mode, minL: P.min - 1, maxL: P.max - 1, limit: P.move, showTravel: P.travel,
      fshow: Array.from({ length: 16 }, (_, i) => (P.hidden.has(i) ? 0 : 1)), range, tools: [0, 1, 2, 3].map(i => SL.headColour(i)) });
  }

  /* ---- messages ---------------------------------------------------------------------------------------------------------------------------- */
  function paintMessage(text, bad) {
    const host = q('#sl-pv');
    if (!host) return;
    let m = q('#sl-pv-msg', host);
    if (!m) { m = document.createElement('div'); m.id = 'sl-pv-msg'; m.className = 'sl-note'; host.append(m); }
    m.textContent = text; m.hidden = !text; m.style.color = bad ? 'var(--bad-text)' : '';
  }

  /* ---- the dock ---------------------------------------------------------------------------------------------------------------------------- */
  function build(host) {
    host.innerHTML = '<aside class="sl-dock sl-pdock" id="sl-pdock" aria-label="Preview"></aside><div class="sl-ls" id="sl-ls" hidden></div><div class="sl-moves" id="sl-moves" hidden></div>';
    emptyDock();
  }
  function emptyDock() {
    const d = q('#sl-pdock');
    if (!d) return;
    d.innerHTML = `<div class="sl-blk"><div class="sl-bh"><span class="sl-bt">Preview</span></div><p class="sl-hint">Slice the plate to see its toolpath here: every layer, every line type, the heads and the time.</p></div>`;
  }

  function heads() { return (P.data && P.data.tools) || []; }

  function buildDock() {
    const d = P.data, dock = q('#sl-pdock'), m = d.meta || {};
    const total = d.layers.length, hours = SL.state.slice.result && SL.state.slice.result.hours;
    const grams = (m['filament used [g]'] || '').split(',').map(s => parseFloat(s));
    const mmUsed = (m['filament used [mm]'] || '').split(',').map(s => parseFloat(s));
    const toolsUsed = d.totals.extrudedByTool.map((mmv, i) => ({ i, mm: mmv })).filter(t => t.mm > 0);
    const slicerTime = m['estimated printing time (normal mode)'] || m['total estimated time'] || '';
    const sel = MODES.map(([n, i]) => `<option value="${i}"${i === P.mode ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const sum = d.features.reduce((s, f) => s + f.time, 0) || 1;
    let legend = '';
    if (P.mode === 0) legend = d.features.filter(f => f.time > 0 || f.length > 0).map(f => {
      const c = SliceScene.FEATURE_COLOURS[f.index] || [0.6, 0.6, 0.6];
      return `<button type="button" class="sl-lg${P.hidden.has(f.index) ? ' is-off' : ''}" data-f="${f.index}" aria-pressed="${!P.hidden.has(f.index)}"><i style="background:rgb(${c.map(x => Math.round(x * 255)).join(',')})"></i><span>${esc(f.name)}</span><em>${fmt(100 * f.time / sum, 0)}%</em></button>`;
    }).join('');
    else if (P.mode === 1) legend = toolsUsed.map(t => `<div class="sl-lg"><i style="background:${esc(state.heads[t.i] ? state.heads[t.i].hex : '#888')}"></i><span>T${t.i}${state.heads[t.i] && state.heads[t.i].material ? ' · ' + esc(state.heads[t.i].material) : ''}</span><em>${Number.isFinite(grams[t.i]) ? fmt(grams[t.i], 1) + ' g' : fmt(t.mm / 1000, 1) + ' m'}</em></div>`).join('');
    else {
      const r = P.ranges[P.mode], unit = ['', '', 'mm/s', 'mm³/s', 'mm', 'mm'][P.mode], val = x => P.mode === 3 ? fmt(x, 1) : P.mode >= 4 ? fmt(x, 2) : fmt(x, 0);
      legend = `<div class="sl-grad" style="background:${GRADIENT}"></div><div class="sl-gradl"><span>${val(r[0])} ${unit}</span><span>${val(r[1])} ${unit}</span></div>`;
    }
    dock.innerHTML = `
      <div class="sl-blk"><div class="sl-bh"><span class="sl-bt">Preview</span><span class="sl-bs">${total} layers</span></div>
        <label class="sl-sel-row"><select id="sl-pv-mode" aria-label="Colour by">${sel}</select></label>
        <div class="sl-legend">${legend}</div></div>
      <div class="sl-blk"><div class="sl-bh"><span class="sl-bt">This slice</span></div>
        <div class="sl-row"><span>Print time</span><b class="sl-fig">${esc(hours ? timeWords(hours) : slicerTime || '–')}</b></div>
        <div class="sl-row"><span>Filament</span><b class="sl-fig">${Number.isFinite(parseFloat(m['total filament used [g]'])) ? fmt(parseFloat(m['total filament used [g]']), 1) + ' g' : '–'}</b></div>
        ${toolsUsed.map(t => `<div class="sl-row sl-sub"><span><i class="sl-dot" style="background:${esc(state.heads[t.i] ? state.heads[t.i].hex : '#888')}"></i>T${t.i}</span><span class="sl-dim">${Number.isFinite(grams[t.i]) ? fmt(grams[t.i], 1) + ' g · ' : ''}${fmt((Number.isFinite(mmUsed[t.i]) ? mmUsed[t.i] : t.mm) / 1000, 2)} m</span></div>`).join('')}
        <div class="sl-row"><span>Tool changes</span><b class="sl-fig">${d.totals.toolChanges}</b></div>
        <div class="sl-row"><span>Retractions</span><b class="sl-fig">${d.totals.retractions}</b></div>
        <p class="sl-hint">Time and filament are the slicer’s own figures. The shares by line type are nominal (length over requested speed).${d.capped ? ' This file has more moves than can be drawn; the drawing stops early.' : ''}</p></div>
      <div class="sl-blk"><label class="sl-switch"><input type="checkbox" id="sl-pv-travel" ${P.travel ? 'checked' : ''}><span class="sl-sw" aria-hidden="true"></span>Travel moves</label>
        <label class="sl-switch"><input type="checkbox" id="sl-pv-under" ${P.under ? 'checked' : ''}><span class="sl-sw" aria-hidden="true"></span>From underneath</label></div>
      <div class="sl-blk sl-blk-objects" id="sl-pv-warn"></div>`;
    on(q('#sl-pv-mode'), 'change', e => { P.mode = Number(e.target.value); applyView(false); buildDock(); });
    for (const b of qa('.sl-lg[data-f]', dock)) on(b, 'click', () => { const f = Number(b.dataset.f); if (P.hidden.has(f)) P.hidden.delete(f); else P.hidden.add(f); applyView(false); buildDock(); });
    on(q('#sl-pv-travel'), 'change', e => { P.travel = e.target.checked; applyView(false); });
    on(q('#sl-pv-under'), 'change', e => { P.under = e.target.checked; state.view.hidePlate = P.under; state.view.setView(P.under ? 'bottom' : 'iso'); applyView(false); });
    renderWarnings();
  }

  /* ---- the layer slider ---------------------------------------------------------------------------------------------------------------------- */
  function buildLayerSlider() {
    const box = q('#sl-ls'), n = P.data.layers.length;
    box.hidden = n < 1;
    box.innerHTML = `<div class="sl-lt" id="sl-lt-top"></div><div class="sl-lrail" id="sl-lrail"><div class="sl-lfill" id="sl-lfill"></div>
      <button type="button" class="sl-lth" id="sl-th-top" role="slider" aria-label="Top layer" aria-orientation="vertical" aria-valuemin="1" aria-valuemax="${n}"></button>
      <button type="button" class="sl-lth sl-lth-b" id="sl-th-bot" role="slider" aria-label="Bottom layer" aria-orientation="vertical" aria-valuemin="1" aria-valuemax="${n}"></button></div><div class="sl-lt" id="sl-lt-bot"></div>`;
    const rail = q('#sl-lrail'), pos = layer => (1 - (layer - 1) / Math.max(1, n - 1)) * 100;
    const paint = () => {
      const t = q('#sl-th-top'), b = q('#sl-th-bot'), fill = q('#sl-lfill');
      t.style.top = pos(P.max) + '%'; b.style.top = pos(P.min) + '%';
      fill.style.top = pos(P.max) + '%'; fill.style.height = (pos(P.min) - pos(P.max)) + '%';
      t.setAttribute('aria-valuenow', P.max); b.setAttribute('aria-valuenow', P.min);
      const lz = l => (P.data.layers[l - 1] ? P.data.layers[l - 1].z : 0);
      q('#sl-lt-top').innerHTML = `<b>${P.max}</b><span>${fmt(lz(P.max), 2)} mm</span>`;
      q('#sl-lt-bot').innerHTML = `<b>${P.min}</b><span>${fmt(lz(P.min), 2)} mm</span>`;
    };
    const set = (which, layer, fromKey) => {
      layer = Math.max(1, Math.min(n, Math.round(layer)));
      if (P.one) P.max = P.min = layer;          // one-layer mode: both ends travel together
      else if (which === 'top') P.max = Math.max(layer, P.min); else P.min = Math.min(layer, P.max);
      paint(); applyView(true); buildMoveSlider(); void fromKey;
    };
    P.setLayers = (a, b) => { P.min = Math.max(1, Math.min(n, a)); P.max = Math.max(P.min, Math.min(n, b)); paint(); applyView(true); buildMoveSlider(); };
    for (const [id, which] of [['#sl-th-top', 'top'], ['#sl-th-bot', 'bot']]) {
      const el = q(id);
      on(el, 'pointerdown', e => {
        el.setPointerCapture(e.pointerId);
        const move = ev => { const r = rail.getBoundingClientRect(); set(which, 1 + (1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))) * (n - 1)); };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); e.preventDefault();
      });
      on(el, 'keydown', e => {
        const cur = which === 'top' ? P.max : P.min, k = e.key;
        const next = k === 'ArrowUp' || k === 'ArrowRight' ? cur + 1 : k === 'ArrowDown' || k === 'ArrowLeft' ? cur - 1 : k === 'PageUp' ? cur + 10 : k === 'PageDown' ? cur - 10 : k === 'Home' ? 1 : k === 'End' ? n : null;
        if (next !== null) { e.preventDefault(); set(which, next, true); }
      });
    }
    on(rail, 'pointerdown', e => { if (e.target !== rail && !e.target.classList.contains('sl-lfill')) return; const r = rail.getBoundingClientRect(), l = 1 + (1 - (e.clientY - r.top) / r.height) * (n - 1); set(Math.abs(l - P.max) < Math.abs(l - P.min) ? 'top' : 'bot', l); });
    paint();
  }

  /* ---- the move slider and play -------------------------------------------------------------------------------------------------------------- */
  function buildMoveSlider() {
    const box = q('#sl-moves'), d = P.data, top = d.layers[P.max - 1];
    box.hidden = !top;
    if (!top) return;
    box.innerHTML = `<button type="button" class="sl-btn sl-quiet" id="sl-play" aria-label="${P.playing ? 'Pause' : 'Play the print'}">${ic(P.playing ? 'pause' : 'play')}</button>
      <input type="range" id="sl-mv" min="${top.first}" max="${top.last}" step="1" value="${Math.min(P.move, top.last)}" aria-label="Moves in this layer"><output id="sl-mv-o">${Math.max(0, Math.min(P.move, top.last) - top.first + 1)} / ${top.last - top.first + 1}</output>`;
    on(q('#sl-mv'), 'input', e => { P.move = Number(e.target.value); q('#sl-mv-o').textContent = `${P.move - top.first + 1} / ${top.last - top.first + 1}`; state.view.setPathView({ limit: P.move }); });
    on(q('#sl-play'), 'click', togglePlay);
  }

  function togglePlay() {
    P.playing = !P.playing;
    const d = P.data;
    if (P.playing) {
      if (P.max >= d.layers.length && P.move >= d.layers[d.layers.length - 1].last) { P.max = 1; P.min = 1; P.move = d.layers[0].first; }
      P.min = 1;
      const perFrame = Math.max(8, d.n / 1500);
      const step = () => {
        if (!P.playing) return;
        const top = d.layers[P.max - 1];
        P.move += perFrame;
        if (P.move > top.last) { if (P.max >= d.layers.length) { P.playing = false; P.move = top.last; } else { P.max++; P.move = d.layers[P.max - 1].first; } }
        applyView(false);
        const mv = q('#sl-mv'); if (mv) { const t = d.layers[P.max - 1]; mv.min = t.first; mv.max = t.last; mv.value = Math.min(P.move, t.last); q('#sl-mv-o').textContent = `${Math.round(Math.min(P.move, t.last) - t.first + 1)} / ${t.last - t.first + 1}`; }
        const th = q('#sl-th-top'); if (th) { th.style.top = (1 - (P.max - 1) / Math.max(1, d.layers.length - 1)) * 100 + '%'; q('#sl-lfill').style.top = th.style.top; q('#sl-lfill').style.height = (parseFloat(q('#sl-th-bot').style.top) - parseFloat(th.style.top)) + '%'; q('#sl-lt-top').innerHTML = `<b>${P.max}</b><span>${fmt(d.layers[P.max - 1].z, 2)} mm</span>`; }
        if (P.playing) requestAnimationFrame(step); else buildMoveSlider();
      };
      requestAnimationFrame(step);
    }
    buildMoveSlider();
  }

  /* ---- warnings: what trips people on a tool changer, each with the layer where it happens ----------------------------------------------------- */
  function computeWarnings() {
    const d = P.data, w = [], assigned = new Set(state.model.onPlate().filter(o => !o.hidden).map(o => o.tool));
    const used = d.totals.extrudedByTool.map((mmv, i) => (mmv > 0 ? i : -1)).filter(i => i >= 0);
    const hasTower = d.features.some(f => f.index === 13);
    for (const t of used) {
      if (!assigned.has(t) && P.first && P.first[t]) w.push({ level: 'warn', text: `T${t} prints something, but no object on this plate is assigned to it.`, layer: P.first[t].layer + 1, help: 'A head used where nobody asked for it can leave a stray blob. Check the object’s head, or the colours of a painted model.' });
    }
    if (assigned.size > 1 && !hasTower) w.push({ level: 'error', text: 'This plate uses several heads but was sliced without a prime tower, so colour changes will mix.', layer: 1, fix: { label: 'Turn the tower on and slice again', action: 'tower' } });
    const tower = d.features.find(f => f.index === 13);
    if (tower && hasTower) {
      const tmax = d.layers.length ? d.layers[d.layers.length - 1].z : 0, wTower = towerWidth();
      if (wTower && tmax / wTower > 5) w.push({ level: 'info', text: `The prime tower is about ${fmt(tmax, 0)} mm tall and ${fmt(wTower, 0)} mm wide. Tall, narrow towers can fall over mid-print.`, layer: d.layers.length,
        help: 'Community advice, not Snapmaker’s: a wider base, a ribbed wall or a brim keeps a tall tower standing.', fix: { label: 'Strengthen the tower', action: 'strengthen' } });
    }
    const overhangs = state.problems.find(p => p.kind === 'overhang');
    if (overhangs && !SL.isOn(SL.effectiveOptions().enable_support ?? SL.baseOpt('enable_support'))) w.push({ level: 'warn', text: 'Some surfaces hang out more than 45° and supports are off.', layer: 1, fix: { label: 'Turn supports on and slice again', action: 'supports' } });
    P.warnings = w;
  }
  SL.isOn = v => v === true || v === 1 || v === '1' || v === 'true';

  function towerWidth() {
    const o = SL.effectiveOptions(), v = parseFloat(o.prime_tower_width ?? SL.baseOpt('prime_tower_width'));
    return Number.isFinite(v) ? v : 0;
  }

  function renderWarnings() {
    const box = q('#sl-pv-warn');
    if (!box) return;
    box.innerHTML = `<div class="sl-bh"><span class="sl-bt">Checks</span><span class="sl-bs">${P.warnings.length ? P.warnings.length + ' to look at' : 'nothing found'}</span></div>
      ${P.warnings.length ? P.warnings.map((x, i) => `<div class="sl-wn sl-${x.level}" data-w="${i}"><button type="button" class="sl-wt" data-jump="${i}">${ic(x.level === 'info' ? 'info' : 'warn')}<span>${esc(x.text)}</span></button>${x.help ? `<p class="sl-hint">${esc(x.help)}</p>` : ''}${x.fix ? `<button type="button" class="sl-pf" data-fix="${i}">${esc(x.fix.label)}</button>` : ''}</div>`).join('')
        : '<p class="sl-hint sl-ok">No stray heads, a prime tower where one is needed, and supports where surfaces hang out.</p>'}`;
    for (const b of qa('[data-jump]', box)) on(b, 'click', () => jump(P.warnings[Number(b.dataset.jump)]));
    for (const b of qa('[data-fix]', box)) on(b, 'click', () => fix(P.warnings[Number(b.dataset.fix)].fix.action));
  }

  function jump(w) {
    if (!w || !P.data) return;
    const n = P.data.layers.length, layer = Math.max(1, Math.min(n, w.layer || 1));
    P.setLayers && P.setLayers(Math.max(1, layer - 2), layer);
    const l = P.data.layers[layer - 1];
    if (l && state.view) { const b = P.data.bounds; state.view.animateTo({ target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, l.z] }); }
  }

  function fix(action) {
    if (action === 'supports') { state.overrides.enable_support = true; SL.settings.save(); SL.settings.render(); SL.settings.scheduleProfile(); }
    else if (!(SL.fixAction && SL.fixAction(action === 'tower' ? 'tower-on' : action))) return;
    say('Changed in the settings. Slice again to see the effect.', 'ok');
    if (window.Sections) Sections.choose('slicer', 'prepare');
  }

  function onPage(page) {
    if (!state.view) return;
    if (page === 'preview') {
      state.view.setMode('preview');
      if (P.data) state.view.draw(); else if (SL.state.slice.result && !P.loading) load(SL.state.slice.result.name);
      else paintMessage('');
    } else { P.playing = false; state.view.setMode('prepare'); state.view.hidePlate = false; if (P.under) { P.under = false; } paintMessage(''); }
  }

  /* Snapmaker Orca's Preview keys: Up and Down move the layer slider, Left and Right the moves along the layer, Shift or Ctrl make a step five
     times longer, Home and End go to the first and last move, and L shows one layer. True when the key was used. */
  function key(e) {
    if (!P.data || state.page !== 'preview' || !P.setLayers) return false;
    const n = P.data.layers.length, k = e.key, big = e.shiftKey || e.ctrlKey || e.metaKey ? 5 : 1;
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      const top = Math.max(1, Math.min(n, P.max + (k === 'ArrowUp' ? 1 : -1) * big));
      P.setLayers(P.one ? top : P.min, top);
      return true;
    }
    const mv = q('#sl-mv');
    if (mv && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End')) {
      const lo = Number(mv.min), hi = Number(mv.max);
      mv.value = k === 'Home' ? lo : k === 'End' ? hi : Math.max(lo, Math.min(hi, Number(mv.value) + (k === 'ArrowRight' ? 1 : -1) * big));
      mv.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (k.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      P.one = !P.one;
      P.setLayers(P.one ? P.max : 1, P.max);
      say(P.one ? 'Showing one layer. Up and Down step through the layers; L again shows them all.' : 'Showing every layer up to this one.', 'info');
      return true;
    }
    return false;
  }

  SL.path = { build, load, onPage, state: P, key };
})();
