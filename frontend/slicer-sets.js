/* The Slicer, part 3d: saved sets of settings. A set is what the Process block and the settings sheet hold at a moment: the print preset, every
 * setting changed on top of it, the speed, and each head's filament choice and temperature, flow and cooling numbers. It is kept in this browser
 * under a name, can be switched to, renamed, deleted, written to a file and read back from one (a file from another computer works too). It never
 * holds the heads' colours or spools, which belong to the printer. A file is checked before it is used: a setting the engine's list does not
 * have, or a value of the wrong kind or size, is left out, and the person is told how many. */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, say } = SL;
  const KEY = 'dejavu1.slicer.sets', FORMAT = 'deja-vu1-slicer-settings', MAX = 30, MAX_FILE = 262144;
  let sets = [], schemaKeys = null, menuOpen = false, asking = null, picked = '';

  try {
    const v = JSON.parse(store.get(KEY) || '[]');
    sets = Array.isArray(v) ? v.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && s.overrides && typeof s.overrides === 'object').slice(0, MAX) : [];
  } catch (_) { sets = []; }
  const keep = () => { try { store.set(KEY, JSON.stringify(sets)); } catch (_) { say('This browser would not keep the saved settings.', 'warn'); } };
  const W = () => SL.settings.w;

  /* ---- what a set holds ------------------------------------------------------------------------------------------------------------------ */
  function current() {
    const d = W().data, proc = d && d.processes && d.processes.find(p => p.id === state.preset.process);
    return { process: proc ? proc.name : '', overrides: { ...state.overrides }, speed: state.speed, filaments: state.preset.filaments.slice(), tune: state.preset.tune.map(o => ({ ...o })) };
  }

  function apply(set) {
    const d = W().data, proc = set.process && d && d.processes && d.processes.find(p => p.name === set.process);
    state.preset.process = proc ? proc.id : null;
    state.overrides = { ...set.overrides };
    state.speed = Number.isFinite(set.speed) ? set.speed : 100;
    state.preset.filaments = [0, 1, 2, 3].map(i => (typeof (set.filaments || [])[i] === 'string' ? set.filaments[i] : ''));
    state.preset.tune = [0, 1, 2, 3].map(i => ({ ...((set.tune || [])[i] || {}) }));
    SL.settings.sanitizeFilaments();
    SL.settings.save(); SL.settings.render(); SL.settings.headsChanged();
    say(`Using “${set.name}”.${set.process && !proc ? ' Its print preset is not one this engine has, so the stock one is used.' : ''}`, 'ok');
  }

  /* ---- reading a file --------------------------------------------------------------------------------------------------------------------- */
  async function knownKeys() {
    if (schemaKeys) return schemaKeys;
    try { schemaKeys = new Set(((await getJSON('/api/slicer/schema')) || {}).options.map(o => o.key)); } catch (_) { schemaKeys = null; }
    return schemaKeys;
  }
  async function clean(raw) {
    if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) throw new Error('This is not a settings file from the Slicer.');
    const keys = await knownKeys(), limits = (W().data && W().data.filament_limits) || {};
    let dropped = 0;
    const overrides = {};
    for (const [k, v] of Object.entries(raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {}).slice(0, 600)) {
      const kind = typeof v;
      if (/^[a-z0-9_]{2,60}$/.test(k) && (!keys || keys.has(k)) && (kind === 'number' ? Number.isFinite(v) : kind === 'boolean' || (kind === 'string' && v.length <= 80))) overrides[k] = v;
      else dropped++;
    }
    const tune = [0, 1, 2, 3].map(i => {
      const out = {};
      for (const [k, v] of Object.entries((raw.tune || [])[i] && typeof raw.tune[i] === 'object' ? raw.tune[i] : {})) {
        if (limits[k] && Number.isFinite(v) && v >= limits[k][0] && v <= limits[k][1]) out[k] = v; else dropped++;
      }
      return out;
    });
    const speed = Number.isFinite(raw.speed) ? Math.max(50, Math.min(120, raw.speed)) : 100;
    const filaments = [0, 1, 2, 3].map(i => (typeof (raw.filaments || [])[i] === 'string' ? raw.filaments[i].slice(0, 80) : ''));
    const name = String(raw.name || 'Imported settings').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'Imported settings';
    return { set: { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, process: typeof raw.process === 'string' ? raw.process.slice(0, 120) : '', overrides, speed, filaments, tune }, dropped };
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) return say('That file is too big to be a settings file.', 'warn');
    let raw;
    try { raw = JSON.parse(await file.text()); } catch (_) { return say('That file could not be read as settings.', 'warn'); }
    try {
      const { set, dropped } = await clean(raw);
      if (sets.length >= MAX) return say(`At most ${MAX} sets are kept. Delete one first.`, 'warn');
      sets.push(set); keep(); picked = set.id; apply(set); paint();
      if (dropped) say(`${dropped} value${dropped > 1 ? 's' : ''} in that file were not recognised and were left out.`, 'warn');
    } catch (e) { say(e.message, 'warn'); }
  }

  function exportSet(set) {
    const body = { format: FORMAT, version: 1, name: set.name, process: set.process, overrides: set.overrides, speed: set.speed, filaments: set.filaments, tune: set.tune };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    a.download = (set.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'settings') + '.dejavu-settings.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---- the row in the Process block ------------------------------------------------------------------------------------------------------- */
  function saveAs(name) {
    const clash = sets.find(s => s.name.toLowerCase() === name.toLowerCase()), now = current();
    if (clash) Object.assign(clash, now, { name });
    else if (sets.length >= MAX) return say(`At most ${MAX} sets are kept. Delete one first.`, 'warn');
    else sets.push({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ...now });
    picked = (clash || sets[sets.length - 1]).id;
    keep();
    say(clash ? `Updated “${name}”.` : `Saved “${name}”.`, 'ok');
  }

  function paint() {
    const box = q('#sl-sets');
    if (!box) return;
    const set = sets.find(s => s.id === picked) || null;
    box.innerHTML = asking ? `<form class="sl-sets-row" id="sl-sets-form"><input type="text" id="sl-sets-name" maxlength="60" value="${esc(asking.value)}" placeholder="Name these settings" aria-label="Name for these settings"><button type="submit" class="sl-btn sl-primary">${esc(asking.ok)}</button><button type="button" class="sl-btn" id="sl-sets-cancel">Cancel</button></form>`
      : `<div class="sl-sets-row"><select id="sl-sets-pick" aria-label="Saved settings"><option value="">Saved settings…</option>${sets.map(s => `<option value="${esc(s.id)}"${s.id === picked ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <button type="button" class="sl-btn" id="sl-sets-save" data-tip="Keep these settings under a name">${ic('save')}Save</button>
        <button type="button" class="sl-btn sl-quiet" id="sl-sets-more" aria-label="More for saved settings" aria-expanded="${menuOpen}">${ic('down')}</button></div>
        ${menuOpen ? `<div class="sl-sets-menu" role="group" aria-label="Saved settings actions"><button type="button" class="sl-btn" id="sl-sets-rename"${set ? '' : ' disabled'}>Rename</button><button type="button" class="sl-btn" id="sl-sets-delete"${set ? '' : ' disabled'}>Delete</button><button type="button" class="sl-btn" id="sl-sets-export">${ic('download')}Export</button><button type="button" class="sl-btn" id="sl-sets-import">Import…</button></div>
        <p class="sl-hint">Export writes ${set ? '“' + esc(set.name) + '”' : 'the settings now on screen'} to a file you can keep or send. Import reads one back.</p>` : ''}
        <input type="file" id="sl-sets-file" accept=".json,application/json" hidden>`;
    if (asking) {
      const input = q('#sl-sets-name');
      input.focus(); input.select();
      on(q('#sl-sets-form'), 'submit', e => { e.preventDefault(); const name = input.value.trim(); if (!name) return input.focus(); const run = asking.run; asking = null; run(name); paint(); });
      on(q('#sl-sets-cancel'), 'click', () => { asking = null; paint(); });
      on(input, 'keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); asking = null; paint(); } });
      return;
    }
    on(q('#sl-sets-pick'), 'change', e => { picked = e.target.value; const s = sets.find(x => x.id === picked); if (s) apply(s); paint(); });
    on(q('#sl-sets-save'), 'click', () => { asking = { value: set ? set.name : '', ok: 'Save', run: saveAs }; paint(); });
    on(q('#sl-sets-more'), 'click', () => { menuOpen = !menuOpen; paint(); });
    on(q('#sl-sets-rename'), 'click', () => { asking = { value: set.name, ok: 'Rename', run: name => { set.name = name; keep(); say(`Renamed to “${name}”.`, 'ok'); } }; paint(); });
    on(q('#sl-sets-delete'), 'click', () => { sets = sets.filter(s => s !== set); picked = ''; keep(); say(`Deleted “${set.name}”.`, 'ok'); paint(); });
    on(q('#sl-sets-export'), 'click', () => exportSet(set || Object.assign({ name: 'My settings' }, current())));
    on(q('#sl-sets-import'), 'click', () => q('#sl-sets-file').click());
    on(q('#sl-sets-file'), 'change', e => { importFile(e.target.files[0]); e.target.value = ''; });
  }

  SL.sets = { paint, current, apply, clean, list: () => sets.slice() };
})();
