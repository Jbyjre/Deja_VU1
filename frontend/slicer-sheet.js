/* The Slicer's settings sheet: every one of the engine's print settings (backend/process_settings.py), grouped the way Snapmaker Orca groups them
 * (Quality, Strength, Speed, Support, Multi-material, Others), with Simple and Advanced, a search that looks in the names and the help, the
 * value the preset has under each box, the settings you changed marked and one press to put each back, and a plain-words note beside every
 * one (slicer-help.js). Nothing is written unless you typed it: a blank box means "use the preset". */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, fmt } = SL;
  const W = () => SL.settings.w;
  const SH = { open: false, tab: 'Quality', mode: 'simple', query: '', onlyChanged: false, schema: null, loading: false };

  async function loadSchema() {
    if (SH.schema || SH.loading) return;
    SH.loading = true;
    try { SH.schema = await getJSON('/api/slicer/schema'); } catch (_) { SH.schema = null; }
    SH.loading = false;
  }
  SL.sheetSpeedKeys = () => (SH.schema ? SH.schema.options.filter(o => o.tab === 'Speed' && o.unit === 'mm/s').map(o => o.key) : null);

  const plain = v => String(Array.isArray(v) ? v[0] : (v ?? '')).replace(/%$/, '');
  const isBool = v => v === true || v === '1' || v === 1 || v === 'true';

  async function open() {
    if (SH.open) return close();
    await loadSchema();
    if (!SH.schema) return SL.say('The settings list could not be read.', 'warn');
    SH.open = true;
    const card = document.createElement('section');
    card.className = 'sl-card sl-sheet'; card.id = 'sl-sheet'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'All print settings');
    SL.root().append(card);
    SH.esc = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } };
    document.addEventListener('keydown', SH.esc);
    paint();
    const s = q('#sl-s-search'); s && s.focus();
    SL.setInsets && SL.setInsets();
  }
  function close() { SH.open = false; document.removeEventListener('keydown', SH.esc); const c = q('#sl-sheet'); if (c) c.remove(); SL.setInsets && SL.setInsets(); }

  function visible(o) {
    const text = SH.query.trim().toLowerCase();
    if (SH.onlyChanged) return o.key in state.overrides;
    if (text) return (o.label + ' ' + o.key + ' ' + o.section + ' ' + (SLHELP.HELP[o.key] || o.tip || '')).toLowerCase().includes(text);
    if (o.tab !== SH.tab) return false;
    return SH.mode === 'advanced' || !!o.simple;
  }

  function control(o) {
    const base = SL.baseOpt(o.key), has = o.key in state.overrides, v = state.overrides[o.key];
    if (o.type === 'bool') {
      const on_ = has ? isBool(v) : isBool(base);
      return `<label class="sl-switch sl-s-sw${has ? ' is-changed' : ''}"><input type="checkbox" data-k="${esc(o.key)}" ${on_ ? 'checked' : ''} aria-label="${esc(o.label)}"><span class="sl-sw" aria-hidden="true"></span><span class="sl-s-state">${on_ ? 'On' : 'Off'}</span></label>`;
    }
    if (o.type === 'enum') {
      const cur = has ? v : '';
      return `<select data-k="${esc(o.key)}" aria-label="${esc(o.label)}" class="${has ? 'is-changed' : ''}"><option value="">Preset${base !== undefined ? ': ' + esc(SLHELP.choiceLabel(String(base))) : ''}</option>${o.choices.map(c => `<option value="${esc(c)}"${cur === c ? ' selected' : ''}>${esc(SLHELP.choiceLabel(c))}</option>`).join('')}</select>`;
    }
    const text = o.type === 'speed_or_percent';
    const step = o.type === 'int' ? 1 : o.type === 'percent' ? 5 : (o.max !== undefined && o.max <= 2 ? 0.01 : o.max <= 10 ? 0.05 : 1);
    return `<span class="sl-s-num${has ? ' is-changed' : ''}"><input ${text ? 'type="text" inputmode="decimal"' : `type="number" step="${step}"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''}`}
      data-k="${esc(o.key)}" aria-label="${esc(o.label)}" placeholder="${esc(plain(base))}" value="${has ? esc(plain(v)) : ''}"><i>${esc(o.unit || '')}</i></span>`;
  }

  function row(o) {
    const has = o.key in state.overrides, help = SLHELP.HELP[o.key] || o.tip || '';
    return `<div class="sl-s-row${has ? ' is-changed' : ''}" data-row="${esc(o.key)}">
      <div class="sl-s-l"><span class="sl-s-name">${esc(o.label)}</span>${help ? `<span class="sl-s-help">${esc(help)}</span>` : ''}</div>
      <div class="sl-s-c">${control(o)}</div>
      <button type="button" class="sl-s-reset" data-reset="${esc(o.key)}" aria-label="Put ${esc(o.label)} back to the preset"${has ? '' : ' hidden'}>${ic('reset')}</button></div>`;
  }

  function paint() {
    const card = q('#sl-sheet');
    if (!card || !SH.schema) return;
    const all = SH.schema.options, changed = Object.keys(state.overrides).length, tabs = SH.schema.tabs;
    const count = tab => all.filter(o => o.tab === tab && o.key in state.overrides).length;
    const rows = all.filter(visible);
    const bySection = [];
    for (const o of rows) { const key = SH.query.trim() || SH.onlyChanged ? o.tab + ' · ' + o.section : o.section; let g = bySection.find(x => x.name === key); if (!g) bySection.push(g = { name: key, rows: [] }); g.rows.push(o); }
    const p = SL.settings.baseProcess(), searching = SH.query.trim() || SH.onlyChanged;
    card.innerHTML = `
      <div class="sl-ch"><b>Print settings <span class="sl-dim">${esc(p ? p.name.replace(/ @.*$/, '') : '')}</span></b><button type="button" class="sl-ix" id="sl-s-close" aria-label="Close">${ic('x')}</button></div>
      <div class="sl-s-bar">
        <label class="sl-s-search">${ic('search')}<input type="search" id="sl-s-search" placeholder="Search every setting" value="${esc(SH.query)}" aria-label="Search the settings"></label>
        <div class="sl-seg" role="group" aria-label="How many settings">
          <button type="button" data-mode="simple" aria-pressed="${SH.mode === 'simple'}">Simple</button><button type="button" data-mode="advanced" aria-pressed="${SH.mode === 'advanced'}">Advanced</button></div>
      </div>
      <div class="sl-s-tabs" role="tablist" aria-label="Groups of settings">${tabs.map(t => `<button type="button" role="tab" data-tab="${esc(t)}" aria-selected="${!searching && SH.tab === t}" class="${!searching && SH.tab === t ? 'is-on' : ''}">${esc(t)}${count(t) ? `<i>${count(t)}</i>` : ''}</button>`).join('')}
        <button type="button" class="sl-s-chg${SH.onlyChanged ? ' is-on' : ''}" id="sl-s-chg" aria-pressed="${SH.onlyChanged}"${changed ? '' : ' disabled'}>Changed${changed ? ` <i>${changed}</i>` : ''}</button></div>
      ${W().error ? `<p class="sl-hint sl-bad" role="alert">${esc(W().error)}</p>` : ''}
      <div class="sl-s-body">${bySection.length ? bySection.map(g => `<h3 class="sl-s-sec">${esc(g.name)}</h3>${g.rows.map(row).join('')}`).join('') : `<p class="sl-hint">${searching ? 'No setting matches.' : 'Nothing here in Simple mode. Choose Advanced to see every setting in this group.'}</p>`}</div>
      <div class="sl-s-foot"><span class="sl-dim">${changed ? changed + ' changed from the preset' : 'Every box blank uses the preset. A faint number is the preset’s own value.'}</span><button type="button" class="sl-btn" id="sl-s-reset"${changed ? '' : ' disabled'}>${ic('reset')}Back to the preset</button></div>`;
    on(q('#sl-s-close'), 'click', close);
    on(q('#sl-s-search'), 'input', e => { SH.query = e.target.value; SH.onlyChanged = false; const pos = e.target.selectionStart; paint(); const s = q('#sl-s-search'); s.focus(); s.setSelectionRange(pos, pos); });
    for (const b of qa('[data-mode]', card)) on(b, 'click', () => { SH.mode = b.dataset.mode; paint(); });
    for (const b of qa('[data-tab]', card)) on(b, 'click', () => { SH.tab = b.dataset.tab; SH.query = ''; SH.onlyChanged = false; paint(); });
    on(q('#sl-s-chg'), 'click', () => { SH.onlyChanged = !SH.onlyChanged; SH.query = ''; paint(); });
    on(q('#sl-s-reset'), 'click', () => { state.overrides = {}; apply(); });
    for (const b of qa('[data-reset]', card)) on(b, 'click', () => { delete state.overrides[b.dataset.reset]; apply(); });
    for (const el of qa('[data-k]', card)) on(el, 'change', () => set(el));
  }

  function set(el) {
    const key = el.dataset.k, o = SH.schema.options.find(x => x.key === key);
    if (!o) return;
    if (o.type === 'bool') state.overrides[key] = el.checked;
    else if (el.value === '') delete state.overrides[key];
    else if (o.type === 'enum') state.overrides[key] = el.value;
    else if (o.type === 'speed_or_percent') state.overrides[key] = el.value.trim();
    else { const n = parseFloat(el.value); if (Number.isFinite(n)) state.overrides[key] = o.type === 'int' ? Math.round(n) : n; else delete state.overrides[key]; }
    apply();
  }

  function apply() { SL.settings.save(); SL.settings.render(); SL.settings.scheduleProfile(); paint(); }

  SL.sheet = { open, close, refresh: () => { if (SH.open) paint(); }, state: SH };
})();
