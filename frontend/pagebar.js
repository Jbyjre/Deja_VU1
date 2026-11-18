/* pagebar.js: the slim bar at the top of every screen except Overview.
 *
 * The header (index.html #topbar) has two looks, chosen by data-page on <html>: "overview" is the banner
 * (brand, printer, demo switch) and "page" is this bar. theme-boot.js sets data-page before the first paint and
 * app.js showTab keeps it right. This file fills the bar: the screen's name and icon (the sidebar's own), the
 * printer's name on the Printer screen, that screen's main buttons, and the ? note, which is the screen's
 * one-line intro with its "Show me this screen" button. The screen's parts are the bar's tabs: app.js Sections
 * puts their row in #pb-tabs.
 *
 * A button here never does more than the screen's own button: it presses that button, so Emergency stop still
 * asks first and still says in words when the printer refuses. A screen without the control shows no button.
 */
(() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  let fleet = [];
  let watcher = null;
  let paintedFor = '';

  const tabName = () => {
    const tab = document.body.dataset.tab || 'overview';
    return (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[tab]) || tab;
  };
  /* The sidebar's destination for the open screen and part: { id, label }. */
  function here() {
    if (!window.Rail) return { id: '', label: tabName() };
    const id = Rail.current();
    return { id, label: Rail.label(id) };
  }
  function printerName() {
    const id = typeof currentPrinter !== 'undefined' && currentPrinter;
    const p = fleet.find(f => f.id === id) || fleet[0];
    if (p && p.name) return p.name;
    return id && window.Workshop && Workshop.printerName ? Workshop.printerName(id) || '' : '';
  }

  /* ---- main buttons ---- */
  function openAddPrinter() {
    const form = $('add-printer-form'), name = $('fleet-add-name');
    if (form) form.open = true;
    if (!name) return;
    name.scrollIntoView({ block: 'center' });   // opens the part and any fold it sits in (app.js Sections)
    name.focus({ preventScroll: true });
  }
  // `mirror` copies a control the screen already has (its words, its disabled state) and presses it.
  const ACTIONS = {
    printer: [{ key: 'estop', mirror: 'pp-estop', cls: 'estop' }],
    printers: [{ key: 'add-printer', label: 'Add printer', cls: 'primary', run: openAddPrinter }],
    files: [{ key: 'add-files', label: 'Add files', cls: 'primary', run: () => { const f = $('file-upload'); if (f) f.click(); } }]
  };

  function mirror(btn, src) {
    const copy = () => {
      btn.disabled = src.disabled;
      const words = src.textContent.trim();
      if (words && btn.textContent !== words) btn.textContent = words;
      btn.title = src.title || '';
    };
    copy();
    watcher = new MutationObserver(copy);
    watcher.observe(src, { attributes: true, childList: true, characterData: true, subtree: true });
  }

  function paintActions(id) {
    const box = $('pb-actions');
    if (!box) return;
    if (watcher) { watcher.disconnect(); watcher = null; }
    box.textContent = '';
    (ACTIONS[id] || []).forEach(a => {
      const src = a.mirror ? $(a.mirror) : null;
      if (a.mirror && !src) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${a.cls || ''}`.trim();
      btn.dataset.pb = a.key;
      btn.textContent = a.label || '';
      btn.addEventListener('click', () => { if (src) { if (!src.disabled) src.click(); } else a.run(); });
      if (src) mirror(btn, src);
      box.append(btn);
    });
  }

  /* ---- the screen's name ---- */
  function render() {
    const d = here();
    const sub = d.id === 'printer' ? printerName() : '';
    const sig = JSON.stringify([d.id, d.label, sub]);
    if (sig === paintedFor) return;
    const placeChanged = !paintedFor || JSON.parse(paintedFor)[0] !== d.id;
    paintedFor = sig;
    $('pb-title').textContent = d.label;
    const icon = $('pb-icon');
    if (icon) icon.innerHTML = window.Rail ? Rail.icon(d.id) : '';
    const line = $('pb-sub');
    if (line) { line.textContent = sub; line.hidden = !sub; }
    if (placeChanged) paintActions(d.id);
  }

  /* ---- the ? note: what this screen is for, and its tips ---- */
  const help = $('pb-help'), note = $('tab-intro');
  const noteOpen = () => root.classList.contains('pb-help-open');
  function placeNote() {
    const bar = $('topbar').getBoundingClientRect(), at = help.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    const left = Math.max(12, Math.min(at.right - w, window.innerWidth - w - 12));
    note.style.setProperty('--pb-note-top', `${Math.round(bar.bottom + 8)}px`);
    note.style.setProperty('--pb-note-left', `${Math.round(left)}px`);
    note.style.setProperty('--pb-note-w', `${Math.round(w)}px`);
  }
  function setNote(open) {
    root.classList.toggle('pb-help-open', open);
    help.setAttribute('aria-expanded', String(open));
    if (open) placeNote();
  }
  help.addEventListener('click', () => setNote(!noteOpen()));
  document.addEventListener('click', e => {
    if (!noteOpen()) return;
    // A tip button starts its tour, which takes over the screen: the note has done its job.
    if (e.target.closest('[data-tips]') || !e.target.closest('#tab-intro, #pb-help')) setNote(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !noteOpen()) return;
    setNote(false);
    help.focus();
  });
  window.addEventListener('resize', () => { if (noteOpen()) placeNote(); });

  // The sidebar has opened the screen a link asked for: make the header's look match it.
  const settle = () => { root.dataset.page = (document.body.dataset.tab || 'overview') === 'overview' ? 'overview' : 'page'; };
  window.addEventListener('dv-tab', () => { setNote(false); render(); });
  window.addEventListener('dv-rail', () => { settle(); render(); });
  ['dv-section', 'dv-printer'].forEach(name => window.addEventListener(name, render));
  window.addEventListener('dv-fleet', e => { fleet = Array.isArray(e.detail) ? e.detail : []; render(); });
  document.addEventListener('DOMContentLoaded', render);
  render();
})();
