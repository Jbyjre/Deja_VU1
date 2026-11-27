/* pagebar.js: the toolbar edge, the top of the working surface.
 *
 * It is not a bar across the page. It is the first row of the surface the place is drawn on, and it holds three things:
 * the place's name (the sidebar's own words and icon; the printer's name beside it on Printer), the place's parts as a
 * row of tabs (#pb-parts: Printer has Control, Readings, Camera & time-lapses, History and the All printers group;
 * a place with one part shows no row), and the place's own buttons (#pb-actions) next to the search. app.js Sections
 * still decides which cards show; the row only asks it through Rail.goDest.
 *
 * A button here never does more than the screen's own button: it presses that button, so Cancel still asks twice and
 * still says in words when the printer refuses. A mirrored button follows its source: its words, its disabled state and
 * whether it is shown at all (Pause and Cancel appear only while a print runs). Halt is not here: it sits on the Printer
 * screen (cockpit.js builds it, strip.js runs it), where the printer is.
 */
(() => {
  const $ = id => document.getElementById(id);
  let fleet = [];
  let watcher = null;
  let paintedFor = '';
  let partsFor = '';

  const tabName = () => {
    const tab = document.body.dataset.tab || 'overview';
    return (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[tab]) || tab;
  };
  /* The sidebar's place for the open screen and part: { id, place, label }. */
  function here() {
    if (!window.Rail) return { id: '', place: '', label: tabName() };
    const id = Rail.current();
    const place = Rail.place();
    return { id, place, label: Rail.placeLabel(place) };
  }
  function printerName() {
    const id = typeof currentPrinter !== 'undefined' && currentPrinter;
    const p = fleet.find(f => f.id === id) || fleet[0];
    if (p && p.name) return p.name;
    return id && window.Workshop && Workshop.printerName ? Workshop.printerName(id) || '' : '';
  }

  /* ---- the place's own buttons ---- */
  function openAddPrinter() {
    const form = $('add-printer-form'), name = $('fleet-add-name');
    if (form) form.open = true;
    if (!name) return;
    name.scrollIntoView({ block: 'center' });   // opens the part and any fold it sits in (app.js Sections)
    name.focus({ preventScroll: true });
  }
  // Keyed by the part's address. `mirror` copies a control the screen already has (its words, its disabled state and
  // whether it shows) and presses it.
  const ACTIONS = {
    printer: [{ key: 'pause', mirror: 'ctrl-pause-resume', cls: 'primary' }, { key: 'cancel', mirror: 'ctrl-cancel', cls: 'danger' }],
    printers: [{ key: 'add-printer', label: 'Add printer', cls: 'primary', run: openAddPrinter }],
    filament: [{ key: 'colour-setup', label: 'Set up the colour checker', title: 'Connect the colour checker (a Pico W with a colour sensor) to this computer', cls: 'primary', run: () => { if (window.ColourSetup) ColourSetup.open(null); } }],
    files: [{ key: 'convert', label: 'Bambu to U1 profiles', title: 'Turn a Bambu Studio or other slicer project into Snapmaker U1 profiles', run: () => { const f = $('cv-file'); if (f) f.click(); } },
      { key: 'add-files', label: 'Add files', cls: 'primary', run: () => { const f = $('file-upload'); if (f) f.click(); } }]
  };

  function mirror(btn, src) {
    const copy = () => {
      btn.disabled = src.disabled;
      btn.hidden = src.hidden;
      const words = src.textContent.trim();
      if (words && btn.textContent !== words) btn.textContent = words;
      btn.title = src.title || '';
    };
    copy();
    const w = new MutationObserver(copy);
    w.observe(src, { attributes: true, childList: true, characterData: true, subtree: true });
    return w;
  }

  let watchers = [];
  function paintActions(id) {
    const box = $('pb-actions');
    if (!box) return;
    watchers.forEach(w => w.disconnect());
    watchers = [];
    box.textContent = '';
    (ACTIONS[id] || []).forEach(a => {
      const src = a.mirror ? $(a.mirror) : null;
      if (a.mirror && !src) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${a.cls || ''}`.trim();
      btn.dataset.pb = a.key;
      btn.textContent = a.label || '';
      if (a.title) btn.title = a.title;
      btn.addEventListener('click', () => { if (src) { if (!src.disabled) src.click(); } else a.run(); });
      if (src) watchers.push(mirror(btn, src));
      box.append(btn);
    });
  }

  /* ---- the parts row ---- */
  function paintParts(place, destId) {
    const row = $('pb-parts');
    if (!row) return;
    const parts = window.Rail ? Rail.partsOf(place) : [];
    const sig = place + ':' + parts.length;
    if (sig !== partsFor) {
      partsFor = sig;
      row.innerHTML = parts.length < 2 ? '' : parts.map(p => `<button type="button" role="tab" class="pb-part${p.sep ? ' has-sep' : ''}" data-part="${esc(p.id)}"
        aria-selected="false" tabindex="-1">${esc(p.label)}</button>`).join('');
    }
    row.hidden = parts.length < 2;
    row.querySelectorAll('[data-part]').forEach(b => {
      const on = b.dataset.part === destId;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  const row = $('pb-parts');
  if (row) {
    row.addEventListener('click', e => {
      const b = e.target.closest('[data-part]');
      if (b && window.Rail) Rail.goDest(b.dataset.part);
    });
    row.addEventListener('keydown', e => {
      const all = [...row.querySelectorAll('[data-part]')];
      const at = all.indexOf(document.activeElement);
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 }[e.key];
      if (at < 0 || to == null) return;
      e.preventDefault();
      all[(to + all.length) % all.length].focus();
    });
  }

  /* ---- the place's name ---- */
  function render() {
    const d = here();
    const sub = d.place === 'printer' ? printerName() : '';
    const sig = JSON.stringify([d.id, d.place, d.label, sub, !!(window.Rail && Rail.practice && Rail.practice())]);
    if (sig === paintedFor) return;
    const placeChanged = !paintedFor || JSON.parse(paintedFor)[0] !== d.id;
    paintedFor = sig;
    $('pb-title').textContent = d.label;
    const icon = $('pb-icon');
    if (icon) icon.innerHTML = window.Rail ? Rail.icon(d.id) : '';
    const line = $('pb-sub');
    if (line) { line.textContent = sub; line.hidden = !sub; }
    paintParts(d.place, d.id);
    if (placeChanged) paintActions(d.id);
  }

  window.addEventListener('dv-tab', render);
  window.addEventListener('dv-rail', render);
  ['dv-section', 'dv-printer', 'dv-practice'].forEach(name => window.addEventListener(name, render));
  window.addEventListener('dv-fleet', e => { fleet = Array.isArray(e.detail) ? e.detail : []; render(); });
  document.addEventListener('DOMContentLoaded', render);
  render();
})();
