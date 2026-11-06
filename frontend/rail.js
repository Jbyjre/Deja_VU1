/* rail.js: the left sidebar and the page links behind it.
 *
 * Each destination is a screen (a data-tab panel) and, where the screen is in
 * parts, one part of it (app.js SECTIONS). Nothing moves between screens, so
 * remembered tabs, tours, search and another device's handoff keep working.
 *
 * Page links: every destination has its own address (#/prepare, #/printer/<id>
 * and so on). Moving around adds a step to the browser's history, so Back and
 * Forward move between screens, a refresh opens the same one, and a copied
 * link opens it on another browser. Old names (#/files, #/maintenance) still
 * resolve.
 *
 * Desktop: about 224 px wide with labels, or 64 px with icons only (the
 * collapse button, remembered). Below 1180 px it starts collapsed; at phone
 * width (720 px and less) the bottom bar and the More sheet stay in charge.
 */
(() => {
  const ICON = {
    overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
    printers: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
    printer: 'M6 3h12v6H6zM4 9h16v8H4zM7 17h10v4H7zM16 12.5h.01',
    library: 'M4 4h5v16H4zM10 4h4v16h-4zM15.5 5l3.8-1 2.6 15.4-3.8 1z',
    prepare: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
    jobs: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    materials: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    care: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
    settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
    prefs: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
    automations: 'M4 8h12l-3-3M20 16H8l3 3',
    desk: 'M3 20h18M5 20V9h14v11M9 9V5h6v4',
    layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
    studio: 'M4 6h16v12H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
    sandbox: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z',
    games: 'M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.5a2 2 0 0 1-3.4.9L15 15H9l-1.9 2.3a2 2 0 0 1-3.4-.9l-.6-2.5A4 4 0 0 1 7 9z',
    collapse: 'M15 6l-6 6 6 6'
  };
  // [id, label, screen, part, group]
  const DEST = [
    ['overview', 'Overview', 'overview', null, 'main'],
    ['printers', 'Printers', 'fleet', 'printers', 'main'],
    ['printer', 'Printer', 'control', null, 'main'],
    ['library', 'Library', 'files', 'library', 'main'],
    ['prepare', 'Prepare', 'files', 'slicing', 'main'],
    ['jobs', 'Jobs', 'files', 'jobs', 'main'],
    ['materials', 'Materials', 'maintenance', 'filament', 'main'],
    ['care', 'Care', 'maintenance', 'upkeep', 'main'],
    ['settings', 'Settings', 'modules', null, 'main'],
    ['prefs', 'Preferences', 'prefs', null, 'main'],
    ['automations', 'Automations', 'automations', null, 'tools'],
    ['desk', 'Farm desk', 'fleet', 'desk', 'tools'],
    ['layers', 'Layer heights', 'files', 'layers', 'tools'],
    ['studio', 'Photo studio', 'studio', null, 'tools'],
    ['sandbox', 'Practice farm', 'fleet', 'sandbox', 'tools'],
    ['games', 'Games', 'games', null, 'tools']
  ].map(([id, label, tab, part, group]) => ({ id, label, tab, part, group }));
  const byId = Object.fromEntries(DEST.map(d => [d.id, d]));
  // Old screen names in links and remembered values.
  const OLD = { fleet: 'printers', control: 'printer', files: 'library', maintenance: 'care', modules: 'settings',
    autoprint: 'prepare', filament: 'materials' };
  const COLLAPSE_KEY = 'dejavu1.rail.collapsed';
  const WIDE = window.matchMedia('(min-width: 1180px)');
  const PHONE = window.matchMedia('(max-width: 720px)');
  let restoring = false;

  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

  /* Where the page is now: the destination for this screen and part. */
  function current() {
    const tab = document.body.dataset.tab || 'overview';
    const part = window.Sections && Sections.current(tab);
    return DEST.find(d => d.tab === tab && d.part && d.part === part) || DEST.find(d => d.tab === tab) || byId.overview;
  }

  function routeFor(d) {
    const pid = typeof currentPrinter !== 'undefined' && currentPrinter;
    return `#/${d.id}${d.id === 'printer' && pid ? `/${encodeURIComponent(pid)}` : ''}`;
  }

  function parse(hash) {
    const m = /^#\/([a-z-]+)(?:\/([^/?#]+))?/.exec(hash || '');
    if (!m) return null;
    const d = byId[m[1]] || byId[OLD[m[1]]];
    return d ? { d, printer: m[2] ? decodeURIComponent(m[2]) : null } : null;
  }

  function go(d, printer) {
    if (printer && window.Workshop && printer !== currentPrinter) Workshop.selectPrinter(printer, null, true);
    showTab(d.tab);
    if (d.part && window.Sections) Sections.choose(d.tab, d.part);
    window.scrollTo({ top: 0 });
  }

  /* Keep the address and the highlighted item in step with the page. */
  function sync() {
    const d = current();
    const rail = document.getElementById('rail');
    if (rail) rail.querySelectorAll('[data-dest]').forEach(a => {
      const on = a.dataset.dest === d.id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const who = document.getElementById('rail-printer');
    if (who && window.Workshop && currentPrinter) who.textContent = Workshop.printerName(currentPrinter);
    const route = routeFor(d);
    if (location.hash === route) return;
    const url = location.pathname + location.search + route;
    if (restoring) history.replaceState({ dest: d.id }, '', url);
    else history.pushState({ dest: d.id }, '', url);
  }

  function setCollapsed(on, remember) {
    document.documentElement.classList.toggle('rail-collapsed', on);
    const btn = document.getElementById('rail-collapse');
    if (btn) {
      btn.setAttribute('aria-expanded', String(!on));
      btn.setAttribute('aria-label', on ? 'Show the sidebar labels' : 'Hide the sidebar labels');
    }
    if (remember) store.set(COLLAPSE_KEY, on ? '1' : '0');
  }

  function build() {
    const item = d => `<a href="${routeFor(d)}" class="rail-item" data-dest="${d.id}" title="${esc(d.label)}">
      ${svg(ICON[d.id])}<span class="rail-label">${esc(d.label)}${d.id === 'printer' ? '<small id="rail-printer"></small>' : ''}</span></a>`;
    const nav = document.createElement('nav');
    nav.className = 'rail liquid-glass';
    nav.id = 'rail';
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML = `
      <div class="rail-list">${DEST.filter(d => d.group === 'main').map(item).join('')}</div>
      <p class="rail-group" id="rail-tools-h">Tools &amp; learn</p>
      <div class="rail-list" role="group" aria-labelledby="rail-tools-h">${DEST.filter(d => d.group === 'tools').map(item).join('')}</div>
      <button class="rail-collapse" id="rail-collapse" type="button" aria-controls="rail">${svg(ICON.collapse)}<span class="rail-label">Hide labels</span></button>`;
    document.body.prepend(nav);
    nav.addEventListener('click', e => {
      const a = e.target.closest('[data-dest]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a new tab keeps its own link
      e.preventDefault();
      go(byId[a.dataset.dest]);
    });
    document.getElementById('rail-collapse').addEventListener('click', () =>
      setCollapsed(!document.documentElement.classList.contains('rail-collapsed'), true));
  }

  function init() {
    if (!window.showTab || !window.Sections) return;
    build();
    document.documentElement.classList.add('has-rail');
    const saved = store.get(COLLAPSE_KEY);
    setCollapsed(saved == null ? !WIDE.matches : saved === '1', false);
    WIDE.addEventListener('change', e => { if (store.get(COLLAPSE_KEY) == null) setCollapsed(!e.matches, false); });
    window.addEventListener('dv-tab', () => sync());
    window.addEventListener('dv-section', () => sync());
    // Another printer on the same page: the address follows without a new history step.
    window.addEventListener('dv-printer', () => { restoring = true; try { sync(); } finally { restoring = false; } });
    window.addEventListener('popstate', () => {
      const r = parse(location.hash);
      if (!r) return;
      restoring = true;
      try { go(r.d, r.printer); } finally { restoring = false; }
      sync();
    });
    // A link with a destination wins over the remembered screen.
    const start = parse(location.hash);
    restoring = true;
    try { if (start) go(start.d, start.printer); sync(); } finally { restoring = false; }
  }

  window.Rail = {
    destinations: DEST.map(d => ({ ...d })), parse, current: () => current().id,
    destFor: tab => (DEST.find(d => d.tab === tab) || byId.overview).id,
    shown: () => !!document.getElementById('rail') && !PHONE.matches
  };
  init();
})();
