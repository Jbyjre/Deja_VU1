/* The Slicer, part 3c: choosing the filament for a head. Press a head's dot and name in the Heads block and this opens beside it:
 * what the printer reports for that head (one press uses it), the spools you own (one press uses one), the material, the engine's own
 * filament presets for that material, and the colour. Every change is the head's saved record (the same one Tools & filaments keeps) and goes
 * into the next slice's profile; nothing is written to the printer from here. A head holds one of eight materials (PLA, PETG, ABS, ASA,
 * TPU, PVA, PA, PC); a preset for another blend (carbon fibre, say) is set on the printer. */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, fmt, say } = SL;
  const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PVA', 'PA', 'PC'];
  const COLOURS = [['White', '#f2f2f2'], ['Black', '#1a1a1a'], ['Grey', '#8a8f98'], ['Red', '#d7263d'], ['Orange', '#f2711c'], ['Yellow', '#f7c92b'], ['Green', '#2fa84f'],
    ['Teal', '#14a3a3'], ['Blue', '#2f6fe4'], ['Purple', '#7b4bd8'], ['Pink', '#e86aa8'], ['Brown', '#7a4a2a'], ['Natural', '#e9e1cf']];
  const HEX = /^#[0-9a-f]{6}$/i;
  let shown = -1, spools = null, spoolsAt = 0;
  // the head's button is drawn again whenever the Heads block is, so it is looked up each time rather than kept
  const anchorOf = () => q(`.sl-hpick[data-pick="${shown}"]`);
  const W = () => SL.settings.w;

  function close() {
    const c = q('#sl-fil');
    if (c) c.remove();
    shown = -1;
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', onEscape, true);
    qa('.sl-hpick').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function away(e) { if (!e.target.closest('#sl-fil, .sl-hpick')) close(); }
  function onEscape(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const n = shown; close(); const a = q(`.sl-hpick[data-pick="${n}"]`); if (a) a.focus(); } }

  async function loadSpools() {
    if (spools && Date.now() - spoolsAt < 15000) return spools;
    try { spools = ((await getJSON('/api/filament')) || {}).spools || []; } catch (_) { spools = []; }
    spoolsAt = Date.now();
    return spools;
  }

  /* what the engine offers for this head's material, by maker */
  const offered = h => ((W().data && W().data.filaments) || []).filter(r => r.material === String(h.material || '').toUpperCase());

  function apply(i, change) {
    const h = state.heads[i];
    if (!h) return;
    Object.assign(h, change);
    if (change.material !== undefined || change.hex !== undefined) {
      const chosen = state.preset.filaments[i], row = chosen && ((W().data && W().data.filaments) || []).find(r => r.name === chosen || r.label === chosen);
      if (!row || row.material !== String(h.material || '').toUpperCase()) state.preset.filaments[i] = '';
    }
    SL.settings.headsChanged();
    paint();
  }

  function paint() {
    const i = shown, h = state.heads[i], box = q('#sl-fil');
    if (!h || !box) return;
    const live = (state.printer && state.printer.toolheads && state.printer.toolheads['T' + i]) || null;
    const liveHex = live && HEX.test(live.filament_color_hex || '') ? live.filament_color_hex.toLowerCase() : '';
    const liveMat = live ? String(live.filament_material || '').toUpperCase() : '';
    const mat = String(h.material || '').toUpperCase(), chosen = state.preset.filaments[i], rows = offered(h);
    const groups = {};
    for (const r of rows) (groups[r.brand] = groups[r.brand] || []).push(r);
    const auto = rows.find(r => r.stock), stock = auto ? auto.label : '';
    const known = COLOURS.find(([, hex]) => hex === String(h.hex || '').toLowerCase());
    const mine = (spools || []).filter(s => s && s.color_hex);
    box.innerHTML = `
      <div class="sl-ch"><b>T${i} filament</b><button type="button" class="sl-ix" id="sl-fil-x" aria-label="Close">${ic('x')}</button></div>
      <section class="sl-fil-s"><h3>On the printer</h3>${live && (liveHex || liveMat)
        ? `<button type="button" class="sl-fil-row" id="sl-fil-live"><span class="sl-hdot" style="--c:${esc(liveHex || '#9aa3ae')}" aria-hidden="true"></span>
            <span class="sl-fil-t"><b>${esc(live.filament_color_name || liveHex || 'Unnamed colour')}</b><span>${esc(liveMat || 'material not reported')}${live.filament_loaded === false ? ' · not loaded' : ''}</span></span><span class="sl-fil-go">Use</span></button>`
        : '<p class="sl-hint">The printer is not connected, or it reports nothing for this head.</p>'}</section>
      ${mine.length ? `<section class="sl-fil-s"><h3>Your spools</h3><div class="sl-fil-list">${mine.map(s => {
        const m = String(s.material || '').toUpperCase(), ok = MATERIALS.includes(m) && HEX.test(s.color_hex), taken = state.heads.some(x => x.i !== i && x.spool === s.id);
        return `<button type="button" class="sl-fil-row${h.spool === s.id ? ' is-on' : ''}" data-spool="${esc(s.id)}"${ok && !taken ? '' : ' disabled'} title="${ok ? (taken ? 'Another head uses this spool' : '') : 'A head holds PLA, PETG, ABS, ASA, TPU, PVA, PA or PC'}">
          <span class="sl-hdot" style="--c:${esc(HEX.test(s.color_hex) ? s.color_hex : '#9aa3ae')}" aria-hidden="true"></span>
          <span class="sl-fil-t"><b>${esc(s.color_name || 'Unnamed')}</b><span>${esc(m)}${Number.isFinite(s.grams_remaining) ? ' · ' + fmt(s.grams_remaining, 0) + ' g left' : ''}</span></span></button>`;
      }).join('')}</div></section>` : ''}
      <section class="sl-fil-s"><h3>Material</h3><div class="sl-fil-chips" role="group" aria-label="Material">${MATERIALS.map(m => `<button type="button" class="sl-chip" data-mat="${m}" aria-pressed="${m === mat}">${m}</button>`).join('')}</div></section>
      <section class="sl-fil-s"><h3>Engine filament</h3>
        ${rows.length ? `<select id="sl-fil-preset" aria-label="Filament preset for T${i}"><option value="">${stock ? 'Automatic: ' + esc(stock) : 'Automatic'}</option>${Object.entries(groups).map(([brand, list]) =>
          `<optgroup label="${esc(brand)}">${list.map(r => `<option value="${esc(r.name)}"${chosen && (chosen === r.name || chosen === r.label) ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</optgroup>`).join('')}</select>
          <p class="sl-hint">Its temperatures, flow and cooling go into the slice for this head.</p>`
        : `<p class="sl-hint">${W().data && W().data.ready ? 'The engine lists no ' + esc(mat) + ' filament for this printer.' : 'Install the slicing engine to choose from its filaments.'}</p>`}</section>
      <section class="sl-fil-s"><h3>Colour${known ? ' · ' + esc(known[0]) : ''}</h3>
        <div class="sl-fil-sw" role="group" aria-label="Colour">${COLOURS.map(([name, hex]) => `<button type="button" class="sl-sw-c" data-hex="${hex}" style="--c:${hex}" aria-label="${esc(name)}" aria-pressed="${hex === String(h.hex || '').toLowerCase()}" title="${esc(name)}"></button>`).join('')}</div>
        <div class="sl-fil-hex"><input type="color" id="sl-fil-pick" value="${HEX.test(h.hex || '') ? h.hex : '#9aa3ae'}" aria-label="Pick a colour"><input type="text" id="sl-fil-hex" value="${esc(h.hex || '')}" maxlength="7" spellcheck="false" aria-label="Colour as #rrggbb"></div></section>`;
    on(q('#sl-fil-x'), 'click', () => { const n = shown; close(); const a = q(`.sl-hpick[data-pick="${n}"]`); if (a) a.focus(); });
    on(q('#sl-fil-live'), 'click', () => apply(i, { hex: liveHex || h.hex, material: MATERIALS.includes(liveMat) ? liveMat : h.material, name: (live && live.filament_color_name) || '', spool: '' }));
    for (const b of qa('[data-spool]', box)) on(b, 'click', () => {
      const s = (spools || []).find(x => x.id === b.dataset.spool);
      if (s) apply(i, { hex: s.color_hex.toLowerCase(), material: String(s.material).toUpperCase(), name: s.color_name || '', spool: s.id });
    });
    for (const b of qa('[data-mat]', box)) on(b, 'click', () => { if (b.dataset.mat !== mat) apply(i, { material: b.dataset.mat, spool: '' }); });
    on(q('#sl-fil-preset'), 'change', e => { state.preset.filaments[i] = e.target.value; SL.settings.headsChanged(); paint(); });
    for (const b of qa('[data-hex]', box)) on(b, 'click', () => { const c = COLOURS.find(x => x[1] === b.dataset.hex); apply(i, { hex: b.dataset.hex, name: c ? c[0] : '', spool: '' }); });
    on(q('#sl-fil-pick'), 'change', e => apply(i, { hex: e.target.value.toLowerCase(), name: '', spool: '' }));
    on(q('#sl-fil-hex'), 'change', e => {
      const v = e.target.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (HEX.test(v)) apply(i, { hex: v.toLowerCase(), name: '', spool: '' });
      else { say('A colour is written like #ff7a2f.', 'warn'); e.target.value = h.hex || ''; }
    });
    place();
  }

  /* beside the dock, level with the head that was pressed, and always inside the screen */
  function place() {
    const box = q('#sl-fil'), root = SL.root().getBoundingClientRect(), button = anchorOf();
    if (button) button.setAttribute('aria-expanded', 'true');
    if (!box || !button || matchMedia('(max-width: 720px)').matches) return;
    const a = button.getBoundingClientRect(), h = box.getBoundingClientRect().height;
    box.style.top = Math.max(12, Math.min(a.top - root.top - 12, root.height - h - 12)) + 'px';
  }

  async function open(i) {
    if (shown === i) return close();
    close();
    shown = i;
    const box = document.createElement('section');
    box.className = 'sl-card sl-fil'; box.id = 'sl-fil'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', `Filament for T${i}`);
    SL.root().append(box);
    paint();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', onEscape, true);
    await loadSpools();
    if (shown === i) paint();
    const first = q('#sl-fil-x');
    if (first) first.focus();
  }

  SL.filament = { open, close, COLOURS, MATERIALS };
})();
