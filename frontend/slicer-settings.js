/* The Slicer, part 3 of 5: the settings in the dock. The Printer block (the target U1 and the slicing engine, which this part installs for
 * the person), the Heads block (the four heads with the spools the printer reports, each head's layer height) and the Process block (the
 * preset, the dials people reach for, a speed slider, and a button for every setting).
 *
 * The sidebar keeps no profile of its own. It asks the server for the engine's stock presets that fit the four heads
 * (GET /api/slicer/working), remembers what was changed on top of them, and rebuilds one working profile (POST /api/slicer/working) when
 * something changes and before a slice, so a setting the engine refuses is refused where it is typed, in words. */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, fmt, say, hexRGB } = SL;
  const KEY = 'dejavu1.slicer.settings';
  let poll = 0;                      // the install watcher (watchInstall)
  const w = state.work = { data: null, profileId: null, warnings: [], error: null, pending: 0, busy: false, token: 0, headsVersion: 0 };

  /* ---- remembered choices ----------------------------------------------------------------------------------------------------- */
  function load() {
    state.preset.filaments = ['', '', '', ''];
    state.preset.tune = [{}, {}, {}, {}];
    try {
      const saved = JSON.parse(store.get(KEY) || '{}');
      state.preset.process = saved.process || null;
      if (Array.isArray(saved.filaments)) state.preset.filaments = [0, 1, 2, 3].map(i => (typeof saved.filaments[i] === 'string' ? saved.filaments[i].slice(0, 80) : ''));
      if (Array.isArray(saved.tune)) state.preset.tune = [0, 1, 2, 3].map(i => Object.fromEntries(Object.entries(saved.tune[i] && typeof saved.tune[i] === 'object' ? saved.tune[i] : {}).filter(([, v]) => Number.isFinite(v))));
      state.overrides = saved.overrides && typeof saved.overrides === 'object' ? saved.overrides : {};
      state.speed = Number.isFinite(saved.speed) ? saved.speed : 100;
    } catch (_) { /* a damaged value is the same as none */ }
  }
  function save() {
    try { store.set(KEY, JSON.stringify({ process: state.preset.process, overrides: state.overrides, speed: state.speed, filaments: state.preset.filaments, tune: state.preset.tune })); } catch (_) { /* no storage */ }
  }

  /* ---- reading the server ------------------------------------------------------------------------------------------------------ */
  async function refresh() {
    const versionAtStart = w.headsVersion;
    const [engine, work, printer, assigned] = await Promise.all([
      getJSON('/api/slicer/engine').catch(() => null), getJSON('/api/slicer/working').catch(() => null),
      getJSON(api('/api/printer')).catch(() => null), getJSON(api('/api/tools/assignments')).catch(() => null)]);
    const headsBefore = JSON.stringify(state.heads);
    state.engine = engine; w.data = work; state.printer = printer;
    if (engine && engine.job && engine.job.state === 'running') watchInstall();
    // The first time an engine is found it is asked once what it can do (a local run, nothing is sent anywhere).
    if (work && work.engine && work.engine.path && !work.engine.checked && !w.checking) {
      w.checking = true;
      try { await postJSON('/api/slicer/check', {}); w.data = await getJSON('/api/slicer/working').catch(() => work); } finally { w.checking = false; }
    }
    const saved = (assigned && assigned.heads && assigned.heads.length ? assigned.heads : null) || (work && work.heads) || [];
    // A head was changed here while this read was on its way: what came back is older, so the heads stay as they are.
    const keepHeads = w.headsVersion !== versionAtStart && state.heads.length === 4;
    if (!keepHeads) state.heads = [0, 1, 2, 3].map(i => {
      const live = printer && printer.toolheads && printer.toolheads['T' + i] || {}, rec = saved.find(h => h.toolhead === 'T' + i) || {};
      return { i, hex: rec.color_hex || (/^#[0-9a-f]{6}$/i.test(live.filament_color_hex || '') ? live.filament_color_hex : '#9aa3ae'), name: live.filament_color_name || '',
        material: rec.material || live.filament_material || '', nozzle: Number(rec.nozzle || live.nozzle_diameter || 0.4), height: Number(rec.height || 0.2), saved: !!rec.toolhead,
        loaded: live.filament_loaded !== false, spool: rec.spool_id || '' };
    });
    if (!keepHeads) sanitizeFilaments(work);
    if (state.preset.process && work && work.processes && !work.processes.some(p => p.id === state.preset.process)) state.preset.process = null;
    render();
    // The object list, the object panel and the colours on the plate follow the heads only when the heads changed; a refresh that found the
    // same answer leaves them alone, so whatever is being typed in the object panel keeps its place.
    if (SL.prepare && JSON.stringify(state.heads) !== headsBefore) { SL.prepare.renderObjects(); SL.prepare.renderInspector(); if (state.view) SL.prepare.syncScene(); }
  }

  /* A filament chosen for a head stays only while the engine still lists it and its material is the head's. */
  function sanitizeFilaments(work) {
    const offered = ((work || w.data) && (work || w.data).filaments) || [];
    if (!offered.length || state.heads.length !== 4) return;
    state.preset.filaments = [0, 1, 2, 3].map(i => {
      const name = state.preset.filaments[i], row = name && offered.find(r => r.name === name || r.label === name);
      return row && row.material === String(state.heads[i].material || '').toUpperCase() ? name : '';
    });
  }

  const baseProcess = () => {
    const d = w.data;
    if (!d || !d.processes) return null;
    return d.processes.find(p => p.id === (state.preset.process || (d.stock && d.stock.process))) || d.processes[0] || null;
  };
  const baseOpt = key => {
    const p = baseProcess(), v = p && p.options ? p.options[key] : undefined;
    return Array.isArray(v) ? v[0] : v;
  };
  const baseHeight = () => Number(state.overrides.layer_height ?? (baseProcess() || {}).layer_height ?? 0.2);
  SL.baseOpt = baseOpt; SL.baseHeight = baseHeight;

  /* ---- the blocks ------------------------------------------------------------------------------------------------------------------ */
  function build() {
    load();
    renderGoStub();
    for (const id of ['printer', 'heads', 'process']) { /* filled by render() */ }
    refresh();
    window.addEventListener('dv-printer', () => refresh());
  }

  function engineButton() {
    const e = state.engine, job = e && e.job, btn = q('#sl-engine-btn');
    if (!btn) return;
    let words = 'Engine', cls = 'sl-btn';
    if (!e) words = 'Engine';
    else if (job && job.state === 'running') words = `Installing ${Math.round((job.progress || 0) * 100)}%`;
    else if (e.installed && e.update) { words = 'Update engine'; cls += ' sl-primary'; }
    else if (state.engine && state.engine.installed) words = `Engine ${esc(e.installed.engine_version || e.installed.version || '')}`;
    else if (w.data && w.data.engine && w.data.engine.path) words = 'Engine ' + esc((w.data.engine.version || 'ready'));
    else if (e.supported) { words = `Install engine · ${esc((e.offer || {}).size_words || '')}`; cls += ' sl-primary'; }
    else words = 'Engine';
    btn.className = cls;
    btn.innerHTML = `${ic('download')}${words}`;
  }

  function render() {
    renderPrinter(); renderHeads(); renderProcess(); engineButton();
    if (SL.sheet && SL.sheet.refresh) SL.sheet.refresh();
    renderGo();
  }

  function renderPrinter() {
    const p = state.printer || {}, d = w.data;
    const nozzles = [...new Set(state.heads.map(h => h.nozzle))];
    const name = p.printer_name || p.machine || 'Snapmaker U1';
    q('#sl-blk-printer').innerHTML = `
      <div class="sl-bh"><span class="sl-bt">Printer</span><button type="button" class="sl-btn" id="sl-engine-btn"></button></div>
      <div class="sl-row"><span><b>${esc(name)}</b></span><span class="sl-dim">${esc(({ printing: 'printing', paused: 'paused', error: 'error', complete: 'finished', standby: 'ready', ready: 'ready' })[p.state] || p.state || (p.connected === false ? 'not connected' : ''))}</span></div>
      <div class="sl-row sl-dim"><span>${nozzles.length === 1 ? nozzles[0] + ' mm nozzles' : 'Nozzles ' + nozzles.join(' · ') + ' mm'} · Textured PEI plate · 270 × 270 × 270 mm</span></div>
      ${d && d.problem && state.engine && !(state.engine.job && state.engine.job.state === 'running') ? `<p class="sl-hint sl-warn">${esc(d.problem)}</p>` : ''}`;
    on(q('#sl-engine-btn'), 'click', openEngine);
  }

  /* ---- heads ------------------------------------------------------------------------------------------------------------------------ */
  function headNote() {
    try {
      const rows = state.heads.map(h => ({ toolhead: 'T' + h.i, nozzle: h.nozzle, height: state.headHeights[h.i] || baseHeight() }));
      if (!rows.some(r => Math.abs(r.height - baseHeight()) > 1e-6)) return '';
      const plan = window.planLayers && planLayers({ heads: rows });
      if (!plan) return '';
      const bad = plan.heads.find(h => !h.ok);
      if (bad) return `${bad.toolhead}: ${fmt(bad.preferred, 3)} mm is outside what this nozzle can print (${bad.limits[0]}–${bad.limits[1]} mm).`;
      const caps = w.data && w.data.per_tool_heights;
      return (caps === false ? 'This engine cannot print a different height per head, so a slice will say so. ' : '') + plan.heads.filter(h => Math.abs(h.height - h.preferred) > 1e-6).map(h => `${h.toolhead}: ${fmt(h.preferred, 3)} prints as ${fmt(h.height, 3)} mm`).join('; ');
    } catch (e) { return e.message; }
  }

  /* the filament a head will print with: the one chosen for it, else the engine's stock one for its material */
  function activeFilament(i) {
    const chosen = state.preset.filaments[i];
    if (chosen) return chosen.split(' @')[0];
    const material = String((state.heads[i] || {}).material || '').toUpperCase();
    const row = ((w.data && w.data.filaments) || []).find(r => r.stock && r.material === material);
    return row ? row.label : '';
  }

  /* where a head differs from what the printer reports (its material, its colour, its nozzle), in words; Sync reads the printer */
  function printerDiff() {
    const p = state.printer;
    if (!p || !p.toolheads) return [];   // with no printer there are no toolhead readings at all
    const out = [];
    for (const h of state.heads) {
      const live = p.toolheads['T' + h.i];
      if (!live) continue;
      const liveMat = String(live.filament_material || '').toUpperCase(), mat = String(h.material || '').toUpperCase();
      const liveHex = /^#[0-9a-f]{6}$/i.test(live.filament_color_hex || '') ? live.filament_color_hex.toLowerCase() : '';
      const [a, b] = [hexRGB(liveHex), hexRGB(h.hex)], parts = [];
      if (liveMat && mat && liveMat !== mat) parts.push(`the printer has ${liveMat}, here it is ${mat}`);
      else if (liveHex && h.hex && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.25) parts.push(`the printer has ${live.filament_color_name || liveHex}`);
      if (live.nozzle_diameter && Math.abs(Number(live.nozzle_diameter) - h.nozzle) > 0.001) parts.push(`the printer has a ${fmt(Number(live.nozzle_diameter), 2)} mm nozzle, here it is ${fmt(h.nozzle, 1)} mm`);
      if (parts.length) out.push(`T${h.i}: ${parts.join('; ')}`);
    }
    return out;
  }

  /* a head's filament changed here (colour, material, spool or preset): the profile, the plate's colours and the object panel follow */
  function headsChanged() {
    w.headsVersion++;
    renderHeads(); scheduleProfile(); save();
    if (SL.prepare) { SL.prepare.renderObjects(); SL.prepare.renderInspector(); if (state.view) SL.prepare.syncScene(); }
  }

  function renderHeads() {
    const uses = [0, 0, 0, 0];
    for (const o of state.model.onPlate()) uses[o.tool]++;
    const rows = state.heads.map(h => {
      const mine = state.headHeights[h.i];
      return `<div class="sl-hrow${uses[h.i] ? ' is-used' : ''}" data-head="${h.i}">
        <button type="button" class="sl-hpick" data-pick="${h.i}" aria-label="Choose the filament for T${h.i}" aria-haspopup="dialog" title="${esc([h.material, h.name].filter(Boolean).join(' · ') || 'Choose the filament')}">
          <span class="sl-hdot" style="--c:${esc(h.hex)}" aria-hidden="true"></span>
          <span class="sl-hname"><b>T${h.i}</b><span>${esc(activeFilament(h.i) || h.material || 'no spool reported')}</span></span></button>
        <span class="sl-dim">${fmt(h.nozzle, 1)}</span>
        <label class="sl-hh"><input type="number" step="0.02" min="0.04" max="0.6" inputmode="decimal" data-hh="${h.i}" aria-label="Layer height for T${h.i}" placeholder="${fmt(baseHeight(), 2)}" value="${mine ? fmt(mine, 3) : ''}"></label>
        <span class="sl-uses" title="Objects on this plate printed by T${h.i}">${uses[h.i] ? '×' + uses[h.i] : ''}</span></div>`;
    }).join('');
    const note = headNote(), differs = printerDiff();
    q('#sl-blk-heads').innerHTML = `
      <div class="sl-bh"><span class="sl-bt">Heads</span><span class="sl-bs">nozzle mm · layer mm</span><button type="button" class="sl-btn sl-quiet" id="sl-sync" aria-label="Read the spools from the printer again" data-tip="Read the spools again">${ic('refresh')}Sync</button></div>
      ${rows}
      ${note ? `<p class="sl-hint">${esc(note)}</p>` : ''}
      ${differs.length ? `<p class="sl-hint sl-warn">${esc(differs.slice(0, 2).join('. '))}${differs.length > 2 ? `. ${differs.length - 2} more differ` : ''}. Sync reads the printer.</p>` : ''}
      ${w.error ? `<p class="sl-hint sl-bad" role="alert">${esc(w.error)}</p>` : ''}`;
    for (const input of qa('[data-hh]', q('#sl-blk-heads'))) on(input, 'change', () => {
      const i = Number(input.dataset.hh), v = parseFloat(input.value);
      state.headHeights[i] = Number.isFinite(v) && v > 0 ? v : 0;
      state.layerMode = state.headHeights.some(x => x && Math.abs(x - baseHeight()) > 1e-6) ? 'per_tool' : 'shared';
      renderHeads(); scheduleProfile();
    });
    for (const b of qa('[data-pick]', q('#sl-blk-heads'))) on(b, 'click', e => { e.stopPropagation(); if (SL.filament) SL.filament.open(Number(b.dataset.pick), b); });
    for (const row of qa('.sl-hrow', q('#sl-blk-heads'))) on(row, 'click', e => {
      if (e.target.closest('input, .sl-hpick')) return;
      const ids = [...state.model.selected];
      if (ids.length) state.model.setTool(ids, Number(row.dataset.head));
    });
    on(q('#sl-sync'), 'click', e => SL.busy(e.currentTarget, 'Reading…', async () => {
      const r = await postJSON('/api/slicer/working/sync-heads', {});
      if (!r.ok) return say(r.body.error || 'The heads could not be read', 'warn');
      if (SL.filament) SL.filament.close();
      await refresh();
      say('Read the four heads from the printer: ' + state.heads.map(h => `T${h.i} ${h.material || 'no spool'}${h.name ? ' ' + h.name : ''}`).join(', ') + '.', 'ok');
    }));
  }

  /* ---- process ---------------------------------------------------------------------------------------------------------------------- */
  const SPEED_SHARE = key => (SL.sheetSpeedKeys && SL.sheetSpeedKeys()) || (w.data && w.data.speed_keys) || [];

  /* The speed slider scales every printing speed of the preset together, from the preset's own values. */
  function speedOverrides() {
    if (state.speed === 100) return {};
    const out = {};
    for (const key of SPEED_SHARE()) {
      const v = parseFloat(baseOpt(key));
      if (!(v > 0)) continue;
      if (key in state.overrides) continue;
      out[key] = Math.max(1, Math.round(v * state.speed / 100));
    }
    return out;
  }

  function effective() {
    const o = { ...speedOverrides(), ...state.overrides };
    if (state.model.needsTower() && !('enable_prime_tower' in o)) o.enable_prime_tower = true;
    return o;
  }
  SL.effectiveOptions = effective;

  const isOn = v => v === true || v === 1 || v === '1' || v === 'true';

  function renderProcess() {
    const d = w.data, box = q('#sl-blk-process');
    if (!d || !d.ready) {
      box.innerHTML = `<div class="sl-bh"><span class="sl-bt">Process</span></div><p class="sl-hint">${esc(d && d.problem ? d.problem : 'Reading the engine’s presets…')}</p>`;
      return;
    }
    const base = baseProcess(), ov = state.overrides, val = (k, fb) => (k in ov ? ov[k] : (baseOpt(k) ?? fb));
    const changed = k => k in ov;
    const pct = v => String(v ?? '').replace('%', '');
    const towerOn = state.model.needsTower() || isOn(val('enable_prime_tower', false));
    box.innerHTML = `
      <div class="sl-bh"><span class="sl-bt">Process</span><button type="button" class="sl-btn" id="sl-all">${ic('sliders')}All settings</button></div>
      <label class="sl-sel-row"><select id="sl-preset" aria-label="Print preset">${d.processes.map(p => `<option value="${esc(p.id)}"${base && p.id === base.id ? ' selected' : ''}>${esc(p.name.replace(/ @.*$/, ''))}</option>`).join('')}</select></label>
      <div class="sl-quick">
        ${quick('layer_height', 'Layer', val('layer_height', ''), 'mm', changed('layer_height'), 'step="0.02" min="0.04" max="0.56"')}
        ${quick('sparse_infill_density', 'Infill', pct(val('sparse_infill_density', '')), '%', changed('sparse_infill_density'), 'step="5" min="0" max="100"')}
        ${quick('wall_loops', 'Walls', val('wall_loops', ''), '', changed('wall_loops'), 'step="1" min="1" max="20"')}
      </div>
      <div class="sl-toggles">
        <label class="sl-switch${changed('enable_support') ? ' is-changed' : ''}"><input type="checkbox" id="sl-sup" ${isOn(val('enable_support', false)) ? 'checked' : ''}><span class="sl-sw" aria-hidden="true"></span>Supports</label>
        <label class="sl-switch${changed('enable_prime_tower') ? ' is-changed' : ''}"><input type="checkbox" id="sl-tower" ${towerOn ? 'checked' : ''}><span class="sl-sw" aria-hidden="true"></span>Prime tower</label>
      </div>
      <div class="sl-speed"><label for="sl-spd">Speed</label><input type="range" id="sl-spd" min="50" max="120" step="5" value="${state.speed}" aria-valuetext="${state.speed}% of the preset"><output id="sl-spd-o">${state.speed}%</output></div>
      ${Object.keys(ov).length ? `<div class="sl-changed"><span>${Object.keys(ov).length} setting${Object.keys(ov).length > 1 ? 's' : ''} changed</span><button type="button" class="sl-btn sl-quiet" id="sl-reset-all">${ic('reset')}Back to the preset</button></div>` : ''}
      ${w.warnings.length ? `<p class="sl-hint">${esc(w.warnings[0])}</p>` : ''}
      <div class="sl-sets" id="sl-sets"></div>`;
    if (SL.sets) SL.sets.paint();
    on(q('#sl-all'), 'click', () => SL.sheet && SL.sheet.open());
    on(q('#sl-preset'), 'change', e => { state.preset.process = e.target.value; state.overrides = {}; save(); render(); scheduleProfile(); });
    for (const input of qa('[data-quick]', box)) on(input, 'change', () => {
      const key = input.dataset.quick, raw = input.value.trim();
      if (raw === '') delete state.overrides[key];
      else {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return renderProcess();
        state.overrides[key] = key === 'wall_loops' ? Math.round(n) : n;
      }
      save(); render(); scheduleProfile();
    });
    on(q('#sl-sup'), 'change', e => { state.overrides.enable_support = e.target.checked; save(); render(); scheduleProfile(); });
    on(q('#sl-tower'), 'change', e => { state.overrides.enable_prime_tower = e.target.checked; save(); render(); scheduleProfile(); });
    on(q('#sl-spd'), 'input', e => { state.speed = Number(e.target.value); q('#sl-spd-o').textContent = state.speed + '%'; });
    on(q('#sl-spd'), 'change', () => { save(); scheduleProfile(); renderProcess(); });
    on(q('#sl-reset-all'), 'click', () => { state.overrides = {}; state.speed = 100; save(); render(); scheduleProfile(); });
  }
  const quick = (key, label, value, unit, changed, attrs) =>
    `<label class="sl-qf${changed ? ' is-changed' : ''}"><span>${label}</span><input type="number" inputmode="decimal" data-quick="${key}" ${attrs} value="${esc(value)}" aria-label="${label}"><i>${unit}</i></label>`;

  /* ---- the working profile --------------------------------------------------------------------------------------------------------------- */
  let timer = 0;
  function scheduleProfile() {
    state.slice.stale = state.slice.state === 'done' ? true : state.slice.stale;
    w.pending++;
    clearTimeout(timer);
    timer = setTimeout(() => applyProfile(false), 450);
    if (SL.preview && SL.preview.markStale) SL.preview.markStale();
    if (SL.syncTower) SL.syncTower();
    if (SL.prepare && state.model) { state.problems = state.model.problems({ overhangs: true }).concat(SL.towerProblems ? SL.towerProblems() : []); SL.prepare.renderProblems(); }
  }

  /* Build the working profile from the sidebar now. Returns its id, or throws the engine's refusal in words. */
  async function applyProfile(strict) {
    clearTimeout(timer);
    const mine = ++w.token;
    // The engine may have become ready since this page last asked (an install that finished while the card was shut): ask once more before refusing.
    if (strict && (!w.data || !w.data.ready)) await refresh();
    const d = w.data;
    if (!d || !d.ready) { if (strict) throw new Error(d && d.problem ? d.problem : 'The slicing engine is not ready yet'); return null; }
    const heads = state.heads.map(h => ({ toolhead: 'T' + h.i, nozzle: h.nozzle, material: (h.material || 'PLA').toUpperCase(), color_hex: h.hex, height: state.headHeights[h.i] || baseHeight(), spool_id: h.spool || '' }));
    const body = { process: state.preset.process || null, options: effective(), layer_mode: state.layerMode, heads, filament_presets: state.preset.filaments.map(n => n || null), material_options: state.preset.tune.map(o => ({ ...o })) };
    const r = await postJSON('/api/slicer/working', body);
    if (mine !== w.token) return w.profileId;
    if (!r.ok) {
      w.error = r.body.error || 'The engine refused these settings'; w.pending = 0; renderHeads();
      if (strict) throw new Error(w.error);
      return null;
    }
    w.error = null; w.profileId = r.body.profile_id; w.warnings = r.body.warnings || []; w.pending = 0;
    renderHeads(); renderProcess();
    return w.profileId;
  }
  SL.ensureProfile = () => applyProfile(true);

  /* ---- the engine card ----------------------------------------------------------------------------------------------------------------- */
  function openEngine() {
    closeEngine();
    const card = document.createElement('section');
    card.className = 'sl-card sl-engine'; card.id = 'sl-engine'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Slicing engine');
    SL.root().append(card);
    SL.engineEsc = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeEngine(); } };
    document.addEventListener('keydown', SL.engineEsc);
    paintEngine();
    getJSON('/api/slicer/settings').then(r => { state.limit = r && r.timeout_s; paintEngine(); }).catch(() => {});
    const first = card.querySelector('button'); first && first.focus();
    if (state.engine && state.engine.job && state.engine.job.state === 'running') watchInstall();
  }
  /* An install takes minutes, and the card may be closed while it runs (22 November 2026: the first slice after an install said "engine not ready" until
     the page was loaded again, because only the open card noticed the end). This watcher belongs to the page, not to the card: it runs while a job runs. */
  function watchInstall() {
    if (poll) return;
    poll = setInterval(async () => {
      const prev = state.engine && state.engine.job && state.engine.job.state, before = JSON.stringify(state.engine);
      const next = await getJSON('/api/slicer/engine').catch(() => null);
      if (!next) return;
      state.engine = next;
      if (JSON.stringify(next) !== before && q('#sl-engine')) paintEngine();
      engineButton();
      const now = next.job && next.job.state;
      if (now === 'running') return;
      clearInterval(poll); poll = 0;
      if (prev === 'running') { await refresh(); if (now === 'done') say('The slicing engine is installed.', 'ok'); }
    }, 900);
  }
  function closeEngine() { if (SL.engineEsc) document.removeEventListener('keydown', SL.engineEsc); const c = q('#sl-engine'); if (c) c.remove(); }

  function paintEngine() {
    const card = q('#sl-engine'), e = state.engine;
    if (!card || !e) return;
    if (card.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const job = e.job, running = job && job.state === 'running', inst = e.installed;
    const verified = { pinned: 'Matches the checksum Deja Vu1 recorded from Snapmaker’s release.', github: 'Matches the checksum GitHub lists for Snapmaker’s release file.', none: 'Installed without a checksum to compare against.' };
    const stage = { starting: 'Starting', downloading: 'Downloading', verifying: 'Checking the file', unpacking: 'Unpacking', checking: 'Starting it once to check it' };
    let body = '';
    if (running) {
      const pctv = Math.round((job.progress || 0) * 100);
      body = `<p class="sl-es">${esc(stage[job.stage] || 'Working')}… ${pctv}%${job.total ? ` <span class="sl-dim">${fmt((job.bytes || 0) / 1e6, 0)} of ${fmt(job.total / 1e6, 0)} MB</span>` : ''}</p>
        <div class="sl-bar" role="progressbar" aria-valuenow="${pctv}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pctv}%"></i></div>
        <div class="sl-ea"><button type="button" class="sl-btn" id="sl-e-cancel">Cancel</button></div>`;
    } else {
      const lines = [];
      if (inst) lines.push(`<p class="sl-es sl-ok">${ic('check')} Installed: ${esc(inst.app || 'Snapmaker Orca')} ${esc(inst.engine_version || inst.version)}</p>`, `<p class="sl-hint">${esc(verified[inst.verified] || '')}</p>`);
      else if (w.data && w.data.engine && w.data.engine.path) lines.push(`<p class="sl-es sl-ok">${ic('check')} Using the slicing engine already set up on this computer${w.data.engine.version ? ' (' + esc(w.data.engine.version) + ')' : ''}.</p>`,
        e.supported ? '<p class="sl-hint">Deja Vu1 can also install and keep up to date an engine of its own, kept apart from yours.</p>' : '');
      else if (!e.supported) lines.push(`<p class="sl-es sl-warn">${esc(e.reason)}</p>`);
      else lines.push(`<p class="sl-es">Deja Vu1 can download the official Snapmaker Orca for this computer (${esc((e.offer || {}).size_words || '')}), check it, and keep it up to date. It slices, arranges and orients for you.</p>`);
      if (job && job.state === 'failed') lines.push(`<p class="sl-es sl-bad" role="alert">${esc(job.error)}</p>${job.cause && job.cause.fixes ? `<ul class="sl-fixes">${job.cause.fixes.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`);
      if (job && job.state === 'cancelled') lines.push(`<p class="sl-hint">${esc(job.error)}</p>`);
      if (e.update) lines.push(`<p class="sl-es">A newer engine is out: ${esc((e.offer || {}).version)}. The one you have keeps working until the new one passes its check.</p>`);
      const buttons = [];
      if (e.supported && (!inst || e.update)) buttons.push(`<button type="button" class="sl-btn sl-primary" id="sl-e-install">${inst ? 'Update' : 'Install'} · ${esc((e.offer || {}).size_words || '')}</button>`);
      if (e.supported && job && job.state === 'failed' && /no checksum/i.test(job.error || '')) buttons.push('<button type="button" class="sl-btn" id="sl-e-anyway">Install anyway</button>');
      if (e.supported) buttons.push('<button type="button" class="sl-btn" id="sl-e-check">Check for a newer one</button>');
      buttons.push('<button type="button" class="sl-btn sl-quiet" id="sl-e-mine">Use my own Snapmaker Orca…</button>');
      body = lines.join('') + `<div class="sl-ea">${buttons.join('')}</div><div id="sl-e-find"></div>
        <label class="sl-e-limit"><span>Time limit per slice<small class="sl-dim">Big models can need more than ten minutes.</small></span>
          <span class="sl-s-num"><input type="number" id="sl-e-limit" min="30" max="3600" step="30" value="${state.limit || 600}" aria-label="Time limit per slice, in seconds"><i>seconds</i></span></label>`;
    }
    card.innerHTML = `<div class="sl-ch"><b>Slicing engine</b><button type="button" class="sl-ix" id="sl-e-close" aria-label="Close">${ic('x')}</button></div>${body}
      <p class="sl-hint sl-lic">${esc((e.separate || ''))} Snapmaker Orca is open source under the ${esc((e.licence || {}).name || 'AGPL-3.0')} and runs as a separate program; Deja Vu1 does not include its code.
        <a href="${esc((e.licence || {}).source || '#')}" target="_blank" rel="noopener noreferrer">Source</a> · <a href="${esc((e.licence || {}).url || '#')}" target="_blank" rel="noopener noreferrer">Licence</a></p>`;
    on(q('#sl-e-close'), 'click', closeEngine);
    on(q('#sl-e-cancel'), 'click', async () => { state.engine = (await postJSON('/api/slicer/engine/cancel', {})).body; paintEngine(); });
    const start = (anyway) => async ev => SL.busy(ev.currentTarget, 'Starting…', async () => {
      const r = await postJSON('/api/slicer/engine/install', { allow_unverified: !!anyway });
      if (!r.ok) return say(r.body.error || 'The install could not start', 'warn');
      state.engine = r.body; paintEngine(); engineButton();
      watchInstall();
      if (window.Activity) Activity.refresh();
    });
    on(q('#sl-e-limit'), 'change', async ev => {
      const r = await postJSON('/api/slicer/settings', { timeout_s: Number(ev.target.value) });
      if (!r.ok) { say(r.body.error || 'The time limit was not saved', 'warn'); ev.target.value = state.limit || 600; return; }
      state.limit = r.body.timeout_s; say(`Slices now stop after ${state.limit} seconds.`, 'ok');
    });
    on(q('#sl-e-install'), 'click', start(false));
    on(q('#sl-e-anyway'), 'click', start(true));
    on(q('#sl-e-check'), 'click', ev => SL.busy(ev.currentTarget, 'Asking GitHub…', async () => {
      const r = await postJSON('/api/slicer/engine/check', {});
      if (!r.ok) return say(r.body.error || 'The release list could not be read', 'warn');
      state.engine = r.body; paintEngine(); engineButton();
      say(r.body.update ? `A newer engine is out: ${r.body.offer.version}.` : 'This is the newest engine.', r.body.update ? 'info' : 'ok');
    }));
    on(q('#sl-e-mine'), 'click', findOwn);
  }

  async function findOwn() {
    const host = q('#sl-e-find');
    host.innerHTML = '<p class="sl-hint">Looking in the usual places…</p>';
    const r = await postJSON('/api/slicer/find', {});
    const found = (r.body && r.body.found) || [];
    if (!found.length) { host.innerHTML = '<p class="sl-hint">No Snapmaker Orca or OrcaSlicer was found. Install one, or use the button above and Deja Vu1 installs its own.</p>'; return; }
    host.innerHTML = `<ul class="sl-found">${found.map((f, i) => `<li><span><b>${esc(f.name)}</b><br><span class="sl-dim">${esc(f.where)}</span></span><button type="button" class="sl-btn" data-pick="${i}" ${f.runnable ? '' : 'disabled'}>${f.in_use ? 'In use' : 'Use this'}</button></li>`).join('')}</ul>`;
    for (const b of qa('[data-pick]', host)) on(b, 'click', ev => SL.busy(ev.currentTarget, 'Checking…', async () => {
      const f = found[Number(b.dataset.pick)];
      const s = await postJSON('/api/slicer/settings', { slicer_path: f.path });
      if (!s.ok) return say(s.body.error || 'That program could not be chosen', 'warn');
      const c = await postJSON('/api/slicer/check', {});
      say(c.body.ok ? `Using ${c.body.app} ${c.body.version}.` : (c.body.error || 'That program did not answer.'), c.body.ok ? 'ok' : 'warn');
      await refresh(); paintEngine();
    }));
  }

  /* ---- the go area is the preview part's; until it is built the dock only needs a place to put it ------------------------------------------- */
  function renderGoStub() { /* slicer-preview.js fills #sl-go */ }
  function renderGo() { if (SL.preview && SL.preview.renderGo) SL.preview.renderGo(); }

  /* ---- the prime tower: where it stands, and what is wrong with it ---------------------------------------------------------------------------- */
  const TOWER_ID = 990, TOWER_DEFAULT = { x: 15, y: 220 };        // the engine's own default corner (wipe_tower_x, wipe_tower_y)
  function boxMesh() {
    const pos = [], nrm = [];
    const quad = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) { pos.push(...p); nrm.push(...n); } };
    quad([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]); quad([0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 0, -1]);
    quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, -1, 0]); quad([1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0]);
    quad([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]); quad([0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1], [-1, 0, 0]);
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), bounds: { min: [0, 0, 0], max: [1, 1, 1] }, warnings: [] };
  }
  const BOX = boxMesh();
  const towerSpec = () => {
    const o = effective(), m = state.model, mine = m.onPlate().filter(x => !x.hidden);
    const w = parseFloat(o.prime_tower_width ?? baseOpt('prime_tower_width')) || 30;
    const top = mine.reduce((hh, x) => Math.max(hh, SlicerModel.boundsOf(x).max[2]), 0);
    return { w, h: top + 2, wall: String(o.wipe_tower_wall_type ?? baseOpt('wipe_tower_wall_type') ?? 'rectangle'), frame: isOn(o.prime_tower_enable_framework ?? baseOpt('prime_tower_enable_framework')),
      on: isOn(o.enable_prime_tower ?? baseOpt('enable_prime_tower') ?? true), top };
  };

  /* the see-through block on the plate, only while two or more heads are in use */
  SL.syncTower = () => {
    const v = state.view, m = state.model;
    if (!v) return;
    const spec = towerSpec(), need = m.needsTower() && spec.on;
    if (!need || !(spec.top > 0)) { v.removeItem(TOWER_ID); m.tower = null; return; }
    m.tower = { x: TOWER_DEFAULT.x + spec.w / 2, y: TOWER_DEFAULT.y + spec.w / 2, w: spec.w, d: spec.w };
    const t = [spec.w, 0, 0, 0, spec.w, 0, 0, 0, spec.h, TOWER_DEFAULT.x, TOWER_DEFAULT.y, 0];
    if (!v.items.has(TOWER_ID)) v.addItem({ id: TOWER_ID, mesh: BOX, transform: t, color: [0.62, 0.6, 0.72], ghost: true, fixedSize: true });
    else v.setItemTransform(TOWER_ID, t);
  };

  SL.towerProblems = () => {
    const m = state.model, out = [];
    if (!m.needsTower()) return out;
    const spec = towerSpec();
    if (!spec.on) { out.push({ kind: 'notower', level: 'error', ids: [], text: 'This plate prints with several heads and the prime tower is off, so colours will mix.', fix: { label: 'Turn the tower on', action: 'tower-on' } }); return out; }
    const ratio = spec.h / spec.w;
    if ((ratio > 5 && spec.wall !== 'rib') || ratio > 8) {
      out.push({ kind: 'tallTower', level: 'info', ids: [], text: `The prime tower will be about ${fmt(spec.h, 0)} mm tall and ${fmt(spec.w, 0)} mm wide. Tall, narrow towers can fall over mid-print. (Community advice, not Snapmaker’s.)`,
        fix: { label: 'Strengthen the tower', action: 'strengthen' } });
    }
    return out;
  };

  SL.strengthenTower = () => {
    const o = state.overrides, spec = towerSpec();
    o.wipe_tower_wall_type = 'rib'; o.prime_tower_enable_framework = true;
    o.prime_tower_brim_width = Math.max(5, parseFloat(o.prime_tower_brim_width ?? baseOpt('prime_tower_brim_width')) || 5);
    if (spec.w < 35) o.prime_tower_width = 35;
  };
  SL.fixAction = action => {
    if (action === 'tower-on') state.overrides.enable_prime_tower = true;
    else if (action === 'strengthen') SL.strengthenTower();
    else return false;
    save(); render(); scheduleProfile();
    if (SL.prepare) SL.prepare.afterChange('settings', []);
    return true;
  };

  SL.settings = { build, refresh, render, openEngine, closeEngine, scheduleProfile, applyProfile, effective, save, baseProcess, w, headsChanged, activeFilament, printerDiff, sanitizeFilaments };
  void hexRGB;
})();
