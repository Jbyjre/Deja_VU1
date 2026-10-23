/* Finder: one search box for every screen, setting, printer and file.
 *
 * Ctrl/Cmd+K or "/" focuses it. Results are grouped (Go to, Do, Printers,
 * Files), ranked by how well each word of the query matches a title, its
 * path or its synonyms (whole word, word start, inside a word, letters in
 * order, or one typo), and run with Enter or a click. With nothing typed
 * it shows recent picks and a few suggestions. Recent picks stay in this
 * browser only.
 */
'use strict';
window.Finder = (() => {
  const input = document.getElementById('feature-search');
  const panel = document.getElementById('feature-results');
  if (!input || !panel) return null;
  const RECENT_KEY = 'dv-finder-recent';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /* [title, path, synonyms, how to get there]. A string target is a card
     heading; the finder opens its tab and scrolls to it. */
  const PLACES = [
    ['Needs you', 'Overview', 'attention alerts problems errors jam warnings to do', 'Needs you'],
    ['Digital twin', 'Overview', '3d model printer view drawing engineering realistic twin', 'Digital twin'],
    ['Printer control', 'Overview', 'pause resume cancel stop print buttons', 'Printer control'],
    ['Print health', 'Overview', 'first layer quality health score', 'Print health'],
    ['Chamber climate', 'Overview', 'chamber temperature humidity enclosure air', 'Chamber climate'],
    ['Print cost', 'Overview', 'price money electricity cost per print spend', 'Print cost'],
    ['Use it on your phone', 'Overview', 'phone mobile qr code pair handoff', 'Use this dashboard on your phone'],
    ['Objects on the plate', 'Control', 'skip object exclude cancel one part plate objects', 'Objects on the plate'],
    ['Home axes', 'Control', 'home g28 xyz axes', 'Home axes'],
    ['G-code console', 'Control', 'terminal command macro gcode console klipper', 'G-code console'],
    ['Your printers', 'Printers', 'fleet farm printers cards all printers', 'Your printers'],
    ['Farm history', 'Printers', 'stats history chart success rate hours prints', 'Farm history'],
    ['Add a printer', 'Printers', 'connect ip address moonraker discover find printer network new printer', 'Add a printer'],
    ['Farm sandbox', 'Printers', 'simulate sandbox test events scenario practice', 'Farm sandbox'],
    ['Dispatch timeline', 'Printers › Farm desk', 'dispatch schedule timeline gantt plan day plates clear overnight when free', 'Dispatch'],
    ['Best printer for a file', 'Printers › Farm desk', 'best printer which printer match colours route send to', 'Best printer for a file'],
    ['Print right now', 'Printers › Farm desk', 'what can i print now loaded colours match idle', 'Print right now'],
    ['Filament outlook', 'Printers › Farm desk', 'filament needed shortfall buy stock queue grams resources', 'Filament outlook'],
    ['Worth printing?', 'Printers › Farm desk', 'profit price sell margin money per hour worth cost per piece', 'Worth printing?'],
    ['File library', 'Files', 'files upload gcode stl 3mf obj models library', 'File library'],
    ['Print queue', 'Files', 'queue next schedule auto advance waiting jobs', 'Print queue'],
    ['Bambu / MakerWorld to U1 converter', 'Files', 'convert converter bambu makerworld elegoo x1c p1s a1 h2d 3mf project import printables', '#convert-card'],
    ['Slicer and profiles', 'Files › Auto-print', 'slice slicer orca orcaslicer engine profile process preset quality speed infill supports', 'Slicer'],
    ['Slice a model', 'Files › Auto-print', 'slice now gcode from model stl', 'Slice a model'],
    ['Tools & filaments', 'Files › Auto-print', 'tools heads nozzles t0 t1 t2 t3 colours materials toolheads setup', 'Tools & filaments'],
    ['Layer stack · mixed layer heights', 'Files', 'mixed layer height multi nozzle per head variable thick thin base layer multiple', 'Layer stack'],
    ['Photo-to-Print studio', 'Photo studio', 'photo image picture heightmap tiles lithophane colour mosaic', 'Photo-to-Print Studio'],
    ['Automation rules', 'Automations', 'automations rules if this then notify trigger', 'Rules'],
    ['New automation rule', 'Automations', 'add rule create automation', 'New rule'],
    ['What fired', 'Automations', 'automation log history fired', 'What fired'],
    ['Logbook · problems and fixes', 'Care', 'logbook log problems fixes clog jam repair history notes what fixed', 'Logbook'],
    ['Maintenance tasks', 'Care', 'upkeep service lube belts clean grease rods maintenance due', 'Maintenance'],
    ['Swapped a nozzle or hotend', 'Care', 'nozzle swap hotend change replace', 'Swapped a nozzle or hotend?'],
    ['Filament & colour', 'Care', 'filament colour color spool loaded', 'Filament & colour'],
    ['Dock status rings', 'Care', 'led ring lights dock status', 'Dock status rings'],
    ['Right colour loaded?', 'Care', 'colour check color match wrong filament', 'Right colour loaded?'],
    ['Filament inventory', 'Care', 'spools spoolman inventory grams stock filament left', 'Filament inventory'],
    ['Appearance', 'Settings', 'theme background dots constellation colours accent look style', 'Appearance'],
    ['Modules · turn features on or off', 'Settings', 'modules features enable disable switch on off', 'Modules'],
    ['Paired devices', 'Settings', 'pair phone devices tablets', 'Paired devices'],
    ['Preferences', 'Settings', 'units accent preferences sounds', 'Preferences'],
    ['Notifications', 'Settings', 'ntfy discord telegram push email notify alerts', 'Notifications'],
    ['Backup, firmware & recovery', 'Settings', 'backup restore recovery firmware update snapshot', 'Printer firmware & app recovery'],
    ['Print cost pricing', 'Settings', 'electricity price filament price kwh cost settings', 'Print cost pricing'],
    ['WLED bridge', 'Settings', 'wled leds lights strip', 'WLED bridge'],
    ['Home Assistant bridge', 'Settings', 'home assistant hass sensors mqtt smart home', 'Home Assistant bridge'],
    ['Camera settings', 'Settings', 'camera webcam stream mjpeg webrtc go2rtc', 'Camera'],
    ['Time-lapses', 'Settings', 'timelapse time-lapse video recording', 'Time-lapses'],
    ['Away from home', 'Settings', 'remote access tunnel cloudflare outside internet', 'Away from home'],
    ['Demo controls', 'Settings', 'demo data simulated sample', 'Demo controls'],
    ['Games', 'Games', 'games tetris pacman pac-man snake sky dash play bored', 'tab:games'],
  ];
  const ACTIONS = [
    ['Open the camera', 'Do', 'camera live view webcam watch', () => document.getElementById('camera-open')?.click()],
    ['Turn demo data on or off', 'Do', 'demo simulated toggle sample data', () => document.querySelector('label[for=demo-toggle]')?.click()],
    ['Add the sample files', 'Do', 'samples benchy gear vase example test models', async () => { go('File library'); document.getElementById('file-samples')?.click(); }],
    ['Convert the 3-plate MakerWorld sample', 'Do', 'converter try sample bambu makerworld', async () => { go('#convert-card'); document.getElementById('cv-sample')?.click(); }],
    ['Open 3DBenchy', 'Do', 'benchy boat test model calibration', async () => { showTab('files'); if (window.Workshop) Workshop.openFile('3dbenchy.stl'); }],
    ['Set up and help', 'Do', 'setup help guide getting started tour', () => document.getElementById('setup-open')?.click()],
  ];
  const SUGGESTED = ['Needs you', 'Bambu / MakerWorld to U1 converter', 'Layer stack · mixed layer heights', 'Add a printer', 'Open the camera'];

  let items = [], active = -1, dynamic = { printers: [], files: [] }, loadedAt = 0;

  const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.#+]+/g, ' ').trim();
  function oneTypo(a, b) {
    if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function inOrder(q, w) { let i = 0; for (const c of w) if (c === q[i]) i++; return i === q.length; }
  function wordScore(q, words) {
    let best = 0;
    for (const w of words) {
      const s = w === q ? 10 : w.startsWith(q) ? 7 : (q.length > 2 && w.includes(q)) ? 4 : oneTypo(q, w.slice(0, q.length + 1)) || oneTypo(q, w) ? 3 : (q.length > 2 && inOrder(q, w)) ? 1.5 : 0;
      if (s > best) best = s;
    }
    return best;
  }
  function score(entry, q) {
    const tokens = norm(q).split(' ').filter(Boolean);
    if (!tokens.length) return 0;
    const title = norm(entry.title).split(' '), rest = norm(entry.path + ' ' + entry.keys).split(' ');
    let total = 0;
    for (const t of tokens) {
      const s = Math.max(wordScore(t, title) * 1.4, wordScore(t, rest));
      if (!s) return 0;
      total += s;
    }
    if (norm(entry.title).startsWith(norm(q))) total += 6;
    return total;
  }
  function mark(text, q) {
    const tokens = norm(q).split(' ').filter(t => t.length > 0);
    let html = esc(text);
    tokens.sort((a, b) => b.length - a.length).forEach(t => {
      const re = new RegExp(`(^|[^a-z0-9])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      html = html.replace(re, (m, pre, hit) => `${pre}<mark>${hit}</mark>`);
    });
    return html;
  }

  function entries() {
    const places = PLACES.map(([title, path, keys, target]) => ({ group: 'Go to', title, path, keys, run: () => go(target) }));
    const actions = ACTIONS.map(([title, path, keys, run]) => ({ group: 'Do', title, path, keys, run }));
    const printers = dynamic.printers.map(p => ({ group: 'Printers', title: p.name, path: `${p.state || 'printer'}${p.current_file ? ' · ' + p.current_file : ''}`, keys: 'printer select switch ' + p.id,
      run: () => { showTab('overview'); if (window.Workshop && Workshop.selectPrinter) Workshop.selectPrinter(p.id); } }));
    const files = dynamic.files.map(f => ({ group: 'Files', title: f.name, path: `${(f.kind || '').toUpperCase()} file${f.origin ? ' · ' + f.origin : ''}`, keys: 'file open ' + (f.kind || ''),
      run: () => { showTab('files'); if (window.Workshop) Workshop.openFile(f.name); } }));
    return [...places, ...actions, ...printers, ...files];
  }
  async function refreshDynamic() {
    if (Date.now() - loadedAt < 15000) return;
    loadedAt = Date.now();
    try {
      const [fleet, lib] = await Promise.all([getJSON(api('/api/fleet')).catch(() => null), getJSON(api('/api/files')).catch(() => null)]);
      dynamic.printers = (fleet && fleet.printers) || [];
      dynamic.files = (lib && lib.files) || [];
      if (!panel.hidden) render();
    } catch (_) { /* the finder works without them */ }
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 5); } catch (_) { return []; }
  }
  function remember(title) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([title, ...recent().filter(t => t !== title)].slice(0, 5))); } catch (_) { /* private window */ }
  }

  function go(target) {
    if (target.startsWith('tab:')) { showTab(target.slice(4)); focusPanel(document.getElementById('tab-' + target.slice(4))); return; }
    let el = target.startsWith('#') ? document.querySelector(target) : null;
    if (!el) el = [...document.querySelectorAll('main h2, main h3')].find(h => h.textContent.trim() === target) || null;
    const tab = el && el.closest('.tab-panel');
    if (tab) showTab(tab.id.replace(/^tab-/, ''));
    if (!el) return;
    const card = el.closest('.card, .tab-sub') || el;
    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      card.classList.remove('is-found'); void card.offsetWidth; card.classList.add('is-found');
      setTimeout(() => card.classList.remove('is-found'), 1800);
      focusPanel(card);
    });
  }
  function focusPanel(el) {
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }

  function render() {
    const q = input.value.trim(), all = entries();
    let list;
    if (!q) {
      const byTitle = t => all.find(e => e.title === t);
      const rec = recent().map(byTitle).filter(Boolean).map(e => ({ ...e, group: 'Recent' }));
      const sug = SUGGESTED.map(byTitle).filter(e => e && !rec.some(r => r.title === e.title)).map(e => ({ ...e, group: 'Suggested' }));
      list = [...rec, ...sug];
    } else {
      list = all.map(e => ({ e, s: score(e, q) })).filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || a.e.title.length - b.e.title.length).slice(0, 12).map(x => x.e);
      const order = ['Go to', 'Do', 'Printers', 'Files'];
      const firstGroup = list[0] ? list[0].group : null;
      list.sort((a, b) => (a.group === firstGroup ? -1 : 0) - (b.group === firstGroup ? -1 : 0) || order.indexOf(a.group) - order.indexOf(b.group));
    }
    items = list;
    active = list.length ? 0 : -1;
    if (!list.length) {
      panel.innerHTML = `<p class="fx-empty">Nothing matches “${esc(q)}”. Try <button type="button" data-try="camera">camera</button>, <button type="button" data-try="bambu">bambu</button> or <button type="button" data-try="layer height">layer height</button>.</p>`;
      panel.querySelectorAll('[data-try]').forEach(b => b.onmousedown = e => { e.preventDefault(); input.value = b.dataset.try; render(); });
    } else {
      let html = '', group = null;
      list.forEach((e, i) => {
        if (e.group !== group) { group = e.group; html += `<li class="fx-group" role="presentation">${esc(group)}</li>`; }
        html += `<li class="fx-item" role="option" id="fx-${i}" data-i="${i}" aria-selected="${i === active}">
          <span class="fx-ico" aria-hidden="true">${icon(e.group)}</span>
          <span class="fx-text"><span class="fx-title">${q ? mark(e.title, q) : esc(e.title)}</span><span class="fx-path">${esc(e.path)}</span></span>
          <span class="fx-enter" aria-hidden="true">↵</span></li>`;
      });
      panel.innerHTML = `<ul class="fx-list" role="listbox" id="fx-list" aria-label="Results">${html}</ul>
        <p class="fx-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</p>`;
      panel.querySelectorAll('.fx-item').forEach(li => {
        li.onmousedown = e => { e.preventDefault(); run(+li.dataset.i); };
        li.onmousemove = () => setActive(+li.dataset.i, false);
      });
    }
    input.setAttribute('aria-activedescendant', active >= 0 ? `fx-${active}` : '');
  }
  function icon(group) {
    const p = { 'Go to': 'M5 12h12M13 6l6 6-6 6', 'Do': 'M7 4l12 8-12 8z', 'Printers': 'M6 9V4h12v5M5 9h14v8H5zM8 17v3h8v-3', 'Files': 'M7 3h7l5 5v13H7zM14 3v5h5',
      'Recent': 'M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18', 'Suggested': 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z' }[group] || 'M5 12h14';
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${p}"/></svg>`;
  }
  function setActive(i, scroll = true) {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    panel.querySelectorAll('.fx-item').forEach(li => li.setAttribute('aria-selected', String(+li.dataset.i === active)));
    input.setAttribute('aria-activedescendant', `fx-${active}`);
    if (scroll) document.getElementById(`fx-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  async function run(i) {
    const e = items[i];
    if (!e) return;
    close(); input.value = ''; input.blur();
    remember(e.title);
    await e.run();
  }
  function open() {
    panel.hidden = false; input.setAttribute('aria-expanded', 'true');
    panel.classList.remove('is-open'); void panel.offsetWidth; panel.classList.add('is-open');
    render(); refreshDynamic();
  }
  function close() { panel.hidden = true; panel.classList.remove('is-open'); input.setAttribute('aria-expanded', 'false'); }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'feature-results');
  input.setAttribute('aria-expanded', 'false');
  input.placeholder = 'Search screens, printers, files…';
  const hint = document.createElement('kbd');
  hint.className = 'fx-hint'; hint.setAttribute('aria-hidden', 'true'); hint.textContent = mac ? '⌘K' : 'Ctrl K';
  input.after(hint);
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { if (panel.hidden) open(); else render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.hidden) open(); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Escape') { if (input.value) { input.value = ''; render(); } else { close(); input.blur(); } }
  });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); }
  });
  return { open, close, go, score: (title, q) => score({ title, path: '', keys: '' }, q) };
})();
