/* rail.js: the sidebar of eight places and the page links behind it.
 *
 * A place is what the sidebar lists: Overview, Printer, Slicer, Files, Models, AI, Maintenance, Settings, and a small
 * "More" group (Automations, Photo studio, Games). A place is one or more screens (data-tab panels) and, where a screen
 * is in parts, one part of it (app.js SECTIONS). Nothing moves between screens, so remembered tabs, tours, search and
 * another device's handoff keep working. A place's parts are the row in the toolbar edge (pagebar.js); no place opens a
 * part of another place.
 *
 * Page links: every destination has its own address (#/slice, #/printer/<id> and so on). Moving around adds a step to
 * the browser's history, so Back and Forward move between screens, a refresh opens the same one, and a copied link
 * opens it on another browser. Old names (#/library, #/care, #/prepare) still resolve. G then a letter goes to a
 * destination, Alt+1 to 8 to the eight places, and ? lists every shortcut.
 *
 * Width: 60 px with icons only at rest, in every place. The pointer or the keyboard opens it to 212 px with labels over the
 * page, without moving anything, and it closes by itself 3 seconds after the pointer or the focus leaves it. The fold
 * button or the [ key keeps it open (remembered). At phone width
 * (720 px and less) the bottom bar and the More sheet take over.
 *
 * What the sidebar shows from the live fleet (the dv-fleet event): the selected printer, its state and progress in the
 * row under the brand (it opens a menu to pick another), a count on Overview of the printers that need you and on
 * Maintenance of the printers with upkeep due. Arrow keys, Home and End move between items.
 */
(() => {
  const ICON = {
    overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
    printer: 'M6 3h12v6H6zM4 9h16v8H4zM7 17h10v4H7zM16 12.5h.01',
    slicer: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
    files: 'M4 4h5v16H4zM10 4h4v16h-4zM15.5 5l3.8-1 2.6 15.4-3.8 1z',
    models: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5M16 5.2l-8 4.6',
    ai: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 9.5h8M8 12.5h5',
    maintenance: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
    settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
    automations: 'M4 8h12l-3-3M20 16H8l3 3',
    studio: 'M4 6h16v12H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
    games: 'M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.5a2 2 0 0 1-3.4.9L15 15H9l-1.9 2.3a2 2 0 0 1-3.4-.9l-.6-2.5A4 4 0 0 1 7 9z',
    collapse: 'M15 6l-6 6 6 6',
    chevron: 'M6 9l6 6 6-6'
  };
  // The places, in the order the sidebar lists them.
  const PLACES = [
    { id: 'overview', label: 'Overview', group: 'main' },
    { id: 'printer', label: 'Printer', group: 'main' },
    { id: 'slicer', label: 'Slicer', group: 'main' },
    { id: 'files', label: 'Files', group: 'main' },
    { id: 'models', label: 'Models', group: 'main' },
    { id: 'ai', label: 'AI', group: 'main' },
    { id: 'maintenance', label: 'Maintenance', group: 'main' },
    { id: 'settings', label: 'Settings', group: 'foot' },
    { id: 'automations', label: 'Automations', group: 'more' },
    { id: 'studio', label: 'Photo studio', group: 'more' },
    { id: 'games', label: 'Games', group: 'more' }
  ];
  const placeById = Object.fromEntries(PLACES.map(p => [p.id, p]));
  // Every address a link can name: [id, label, place, screen, part]. The first one of a place is its home; the rest
  // are its parts, in the order the toolbar edge shows them. `sep` starts a new group in that row.
  const DEST = [
    ['overview', 'Overview', 'overview', 'overview', null],
    ['printer', 'Control', 'printer', 'control', 'control'],
    ['readings', 'Readings', 'printer', 'control', 'live'],
    ['camera', 'Camera & time-lapses', 'printer', 'control', 'camera'],
    ['history', 'History', 'printer', 'control', 'history'],
    ['printers', 'All printers', 'printer', 'fleet', 'printers', true],
    ['desk', 'Farm', 'printer', 'fleet', 'desk'],
    ['sandbox', 'Practice printers', 'printer', 'fleet', 'sandbox'],
    ['slice', 'Slice', 'slicer', 'files', 'slicing'],
    ['layers', 'Layer heights', 'slicer', 'files', 'layers'],
    ['files', 'Library', 'files', 'files', 'library'],
    ['queue', 'Queue', 'files', 'files', 'jobs'],
    ['models', 'Models', 'models', 'models', null],
    ['ai', 'AI', 'ai', 'ai', null],
    ['maintenance', 'Upkeep', 'maintenance', 'maintenance', 'upkeep'],
    ['filament', 'Filament', 'maintenance', 'maintenance', 'filament'],
    ['settings', 'Settings', 'settings', 'modules', null],
    ['prefs', 'Look & layout', 'settings', 'modules', 'look', false, true],
    ['automations', 'Automations', 'automations', 'automations', null],
    ['studio', 'Photo studio', 'studio', 'studio', null],
    ['games', 'Games', 'games', 'games', null]
  ].map(([id, label, place, tab, part, sep, hide]) => ({ id, label, place, tab, part, sep: !!sep, hide: !!hide, group: placeById[place].group }));
  const byId = Object.fromEntries(DEST.map(d => [d.id, d]));
  const homeOf = place => DEST.find(d => d.place === place);
  // Practice printers (simulated printers and scripted problems) are for trying the dashboard out: the part and every way to it stay out of sight
  // until Settings › Printers & connection switches them on.
  const PRACTICE_KEY = 'dejavu1.pref.practice';
  const practiceOn = () => store.get(PRACTICE_KEY) === 'on';
  const shownDest = d => !(d.id === 'sandbox' && !practiceOn());
  const partsOf = place => DEST.filter(d => d.place === place && !d.hide && shownDest(d));
  // Keyboard: G then a letter goes to a destination; Alt+1 to Alt+8 go to the eight places; ? lists them all.
  const GO_KEYS = { o: 'overview', r: 'printer', i: 'readings', p: 'printers', s: 'slice', h: 'layers', f: 'files', q: 'queue',
    w: 'models', a: 'ai', m: 'maintenance', l: 'filament', ',': 'settings', e: 'prefs', t: 'automations', d: 'desk',
    u: 'studio', g: 'games' };
  const keyFor = id => Object.keys(GO_KEYS).find(k => GO_KEYS[k] === id);
  // Old screen names in links and remembered values.
  const OLD = { fleet: 'printers', control: 'printer', library: 'files', care: 'maintenance', modules: 'settings',
    autoprint: 'slice', prepare: 'slice', jobs: 'queue', materials: 'filament', slicer: 'slice', sandbox: 'sandbox',
    live: 'readings', upkeep: 'maintenance' };
  const MODE_KEY = 'dejavu1.rail.mode';          // 'wide' | 'narrow' | nothing (the place decides)
  const OLD_COLLAPSE_KEY = 'dejavu1.rail.collapsed';
  const MORE_KEY = 'dejavu1.rail.tools';
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', error: 'Error', complete: 'Finished', ready: 'Ready' };
  const WIDE = window.matchMedia('(min-width: 1180px)');
  const PHONE = window.matchMedia('(max-width: 720px)');
  const root = document.documentElement;
  let restoring = false;
  let fleet = [];
  let paintedFor = '';
  let menuOpen = false;

  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

  /* Where the page is now: the destination for this screen and part. */
  function current() {
    const tab = document.body.dataset.tab || 'overview';
    const part = window.Sections && Sections.current(tab);
    return DEST.find(d => d.tab === tab && d.part && d.part === part) || DEST.find(d => d.tab === tab) || byId.overview;
  }
  const currentPlace = () => placeById[current().place];

  function routeFor(d) {
    const pid = typeof currentPrinter !== 'undefined' && currentPrinter;
    return `#/${d.id}${d.id === 'printer' && pid ? `/${encodeURIComponent(pid)}` : ''}`;
  }

  function parse(hash) {
    const m = /^#\/([a-z-]+)(?:\/([^/?#]+))?/.exec(hash || '');
    if (!m) return null;
    let d = byId[m[1]] || byId[OLD[m[1]]];
    if (d && !shownDest(d)) d = byId.printers;                      // a link to a part that is switched off opens the printers instead
    return d ? { d, printer: m[2] ? decodeURIComponent(m[2]) : null } : null;
  }

  function go(d, printer) {
    if (printer && window.Workshop && printer !== currentPrinter) Workshop.selectPrinter(printer, null, true);
    showTab(d.tab);
    if (d.part && window.Sections) Sections.choose(d.tab, d.part);
    const surface = document.getElementById('main');
    if (surface) surface.scrollTop = 0;
    window.scrollTo({ top: 0 });
  }

  /* ---- narrow or wide ---- */
  function chosenMode() {
    const m = store.get(MODE_KEY);
    if (m === 'wide' || m === 'narrow') return m;
    const old = store.get(OLD_COLLAPSE_KEY);          // the choice from before the places: '1' folded, '0' open
    return old === '1' ? 'narrow' : old === '0' ? 'wide' : null;
  }
  function applyNarrow() {
    const mode = chosenMode();
    const narrow = mode ? mode === 'narrow' : true;          // icons only at rest everywhere; wide only where someone kept it open
    root.classList.toggle('rail-collapsed', narrow);
    root.dataset.rail = narrow ? 'narrow' : 'wide';
    const btn = document.getElementById('rail-collapse');
    if (btn) {
      btn.setAttribute('aria-pressed', String(narrow));
      btn.setAttribute('aria-label', narrow ? 'Keep the sidebar open' : 'Let the sidebar close by itself');
      const lbl = btn.querySelector('.rail-label');
      if (lbl) lbl.textContent = narrow ? 'Keep open' : 'Auto-close';
    }
    if (narrow) closeMenu(false);
    window.dispatchEvent(new CustomEvent('dv-rail-width', { detail: { narrow } }));
  }
  function toggleNarrow() {
    store.set(MODE_KEY, root.classList.contains('rail-collapsed') ? 'wide' : 'narrow');
    applyNarrow();
  }

  /* ---- the sidebar opens over the page and closes by itself ----
     Icons only at rest. It opens when the pointer rests on the icons (INTENT_MS) or on a thin strip at the window's left edge (EDGE_MS), so a flick
     to the edge is never missed, and it stays open while the pointer is on it or within SLACK_PX of it, so drifting out and back never makes it flap.
     It closes LINGER_MS after the pointer left; sooner (FAR_MS) when the pointer is clearly somewhere else (over FAR_PX away, or out of the window);
     almost at once (CLICK_MS) when you press anywhere outside it; and CHOSEN_MS after leaving once a place was chosen from it, so it does not sit
     over the new screen. Never closed under you: an open printer menu and keyboard focus inside it keep it open (a mouse click leaves no focus ring,
     so it never pins it). Escape closes it. A sidebar someone chose to keep open is just wide. */
  const LINGER_MS = 1500, FAR_MS = 450, CLICK_MS = 120, CHOSEN_MS = 600, INTENT_MS = 110, EDGE_MS = 140, FAR_PX = 170, SLACK_PX = 14, EDGE_PX = 10;
  let closeTimer = 0, closeAt = 0, intentTimer = 0, chose = false;
  const setOpen = on => { if (root.classList.contains('rail-open') !== on) root.classList.toggle('rail-open', on); };
  function wireOpen() {
    const rail = document.getElementById('rail');
    const card = rail && rail.querySelector('.rail-card');
    if (!rail || !card) return;
    const edge = document.createElement('div');
    edge.className = 'rail-edge';
    edge.id = 'rail-edge';
    edge.setAttribute('aria-hidden', 'true');
    document.body.append(edge);
    const hover = () => root.classList.contains('rail-collapsed');          // a sidebar kept open has nothing to open or close
    const isOpen = () => root.classList.contains('rail-open');
    const keyboardIn = () => rail.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    const stays = () => menuOpen || rail.matches(':hover') || keyboardIn();
    const away = (x, y) => {                                              // how far the pointer is from the open sidebar (0 within its forgiving margin)
      const r = card.getBoundingClientRect();
      return Math.hypot(Math.max(r.left - SLACK_PX - x, 0, x - (r.right + SLACK_PX)), Math.max(r.top - SLACK_PX - y, 0, y - (r.bottom + SLACK_PX)));
    };
    const cancelClose = () => { clearTimeout(closeTimer); closeTimer = 0; closeAt = 0; };
    const fire = () => {
      closeTimer = 0; closeAt = 0;
      if (stays()) { if (!rail.matches(':hover')) { closeAt = performance.now() + 500; closeTimer = setTimeout(fire, 500); } return; }   // a menu or the keyboard still has it
      chose = false;
      setOpen(false);
    };
    const closeIn = ms => {                                               // never lengthens a close that is already counting down
      const at = performance.now() + ms;
      if (closeTimer && closeAt <= at) return;
      clearTimeout(closeTimer);
      closeAt = at;
      closeTimer = setTimeout(fire, ms);
    };
    const openSoon = ms => { if (!intentTimer) intentTimer = setTimeout(() => { intentTimer = 0; cancelClose(); setOpen(true); }, ms); };
    const dropIntent = () => { clearTimeout(intentTimer); intentTimer = 0; };

    rail.addEventListener('pointerenter', e => { if (e.pointerType === 'touch' || !hover()) return; cancelClose(); if (!isOpen()) openSoon(INTENT_MS); });
    rail.addEventListener('pointerleave', e => { dropIntent(); if (e.pointerType !== 'touch' && isOpen() && hover()) closeIn(chose ? CHOSEN_MS : LINGER_MS); });
    edge.addEventListener('pointerenter', e => { if (e.pointerType === 'touch' || !hover() || isOpen()) return; openSoon(EDGE_MS); });
    edge.addEventListener('pointerleave', dropIntent);
    // While it is open, how far the pointer has gone decides how soon it goes: near it, a grace period; far from it, no waiting.
    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !hover() || !isOpen() || menuOpen) return;
      const d = away(e.clientX, e.clientY);
      if (d === 0) { cancelClose(); return; }
      closeIn(d > FAR_PX ? FAR_MS : chose ? CHOSEN_MS : LINGER_MS);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch' && isOpen() && hover() && !stays()) closeIn(FAR_MS); });   // the pointer left the window
    // A press anywhere else is a clear "I am done with it".
    document.addEventListener('pointerdown', e => {
      if (!isOpen() || !hover() || e.target.closest('#rail, #rail-menu, #rail-switch')) return;
      dropIntent();
      closeIn(CLICK_MS);
    }, true);
    rail.addEventListener('click', e => { if (e.target.closest('.rail-item')) chose = true; });
    rail.addEventListener('focusin', e => { if (e.target.matches && e.target.matches(':focus-visible')) { cancelClose(); setOpen(true); } });
    // focus moved on to the page (Tab out of the sidebar): it has been left, so it gets out of the way of what the focus is now on
    rail.addEventListener('focusout', e => { if (!rail.contains(e.relatedTarget) && isOpen() && hover() && !rail.matches(':hover')) closeIn(e.relatedTarget ? CLICK_MS * 2 : LINGER_MS); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen() && hover() && (rail.contains(document.activeElement) || rail.matches(':hover'))) { cancelClose(); setOpen(false); } });
  }

  /* Keep the address and the highlighted item in step with the page. */
  function sync() {
    const d = current();
    root.dataset.place = d.place;
    const rail = document.getElementById('rail');
    if (rail) rail.querySelectorAll('[data-place]').forEach(a => {
      const on = a.dataset.place === d.place;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // The phone's bottom bar: one button per place, and More lit for every place the bar does not list.
    const dockPlaces = ['overview', 'printer', 'slicer', 'files'];
    document.querySelectorAll('.bottom-nav [data-dest]').forEach(b => {
      const on = byId[b.dataset.dest] && byId[b.dataset.dest].place === d.place;
      b.classList.toggle('active', !!on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const more = document.getElementById('bn-more');
    if (more) more.classList.toggle('active', !dockPlaces.includes(d.place));
    if (d.group === 'more') setMore(true, false);   // you can't be somewhere that is folded away
    applyNarrow();
    paintStatus(true);
    if (rail && !rail.contains(document.activeElement)) roving();
    const route = routeFor(d);
    if (location.hash === route) return;
    const url = location.pathname + location.search + route;
    if (restoring) history.replaceState({ dest: d.id }, '', url);
    else history.pushState({ dest: d.id }, '', url);
  }

  function setMore(open, remember) {
    const list = document.getElementById('rail-tools');
    const head = document.getElementById('rail-tools-h');
    if (!list || !head) return;
    list.classList.toggle('is-folded', !open);
    head.setAttribute('aria-expanded', String(open));
    if (remember) store.set(MORE_KEY, open ? '1' : '0');
  }

  /* ---- what the live fleet says ---- */
  function shownPrinter() {
    const id = typeof currentPrinter !== 'undefined' && currentPrinter;
    return fleet.find(p => p.id === id) || fleet[0] || null;
  }
  function stateOf(p) {
    if (!p) return '';
    if (p.link_lost) return 'lost';
    return STATE_WORD[p.state] ? p.state : 'ready';
  }
  function stateWords(p) {
    if (!p) return '';
    if (p.link_lost) return 'Not answering';
    const word = STATE_WORD[p.state] || (p.state ? p.state[0].toUpperCase() + p.state.slice(1) : '');
    return p.state === 'printing' ? `${word} ${Math.round((p.progress || 0) * 100)}%` : word;
  }
  function needsYou(p) {
    return !!(p.link_lost || p.state === 'error' || p.state === 'paused' || p.state === 'complete'
      || (p.alerts || []).some(a => a.level === 'error'));
  }
  function levelOf(p) {
    if (p.link_lost || p.state === 'error' || (p.alerts || []).some(a => a.level === 'error')) return 'bad';
    return p.state === 'paused' ? 'warn' : 'ok';
  }
  function dueCount() {
    return fleet.filter(p => (p.alerts || []).some(a => a.level === 'warning' && a.text !== 'Paused')).length;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function badge(placeId, count, level, words) {
    const item = document.querySelector(`#rail [data-place="${placeId}"]`);
    const el = item && item.querySelector('.rail-badge');
    if (!el) return '';
    el.hidden = !count;
    el.dataset.count = count > 99 ? '99+' : String(count || '');   // drawn by CSS, so the item's visible text is only its label
    el.dataset.level = level || '';
    return count ? `, ${words}` : '';
  }

  /* Redraws the live parts of the sidebar. Cheap when nothing changed: the fleet event comes often. */
  function paintStatus(force) {
    const rail = document.getElementById('rail');
    if (!rail) return;
    const p = shownPrinter();
    const name = p ? p.name : (typeof currentPrinter !== 'undefined' && currentPrinter && window.Workshop
      ? Workshop.printerName(currentPrinter) : '');
    const flagged = fleet.filter(needsYou);
    const levels = flagged.map(levelOf);
    const worst = levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : 'ok';
    const due = dueCount();
    const sig = JSON.stringify([name, p && [p.id, p.state, p.link_lost, Math.round((p.progress || 0) * 100)],
      flagged.length, worst, due, fleet.map(f => [f.id, f.name, f.state, f.link_lost]), root.dataset.theme]);
    if (!force && sig === paintedFor) return;
    paintedFor = sig;

    const label = {};
    PLACES.forEach(pl => { label[pl.id] = pl.label; });
    label.overview += badge('overview', flagged.length, worst,
      plural(flagged.length, 'printer needs you', 'printers need you'));
    label.maintenance += badge('maintenance', due, 'warn', plural(due, 'printer has upkeep due', 'printers have upkeep due'));
    PLACES.forEach(pl => {
      const a = rail.querySelector(`[data-place="${pl.id}"]`);
      if (a) a.setAttribute('aria-label', label[pl.id]);
    });
    const who = document.getElementById('rail-switch');
    if (who) {
      const state = stateOf(p);
      const dot = who.querySelector('.rail-dot');
      dot.dataset.state = state;
      document.getElementById('rail-printer').textContent = name || 'No printer';
      document.getElementById('rail-state').textContent = p ? stateWords(p) : 'Add one in Settings';
      who.disabled = !fleet.length;
    }
    if (menuOpen) drawMenu();
  }

  /* ---- the printer menu ---- */
  function drawMenu() {
    const menu = document.getElementById('rail-menu');
    if (!menu) return;
    const here = shownPrinter();
    menu.innerHTML = fleet.map(p => `<button type="button" role="menuitemradio" data-printer="${esc(p.id)}"
        aria-checked="${!!here && here.id === p.id}" tabindex="-1"><i class="rail-dot" data-state="${stateOf(p)}" aria-hidden="true"></i>
        <span>${esc(p.name)}</span><small>${esc(stateWords(p))}</small></button>`).join('');
  }
  function openMenu() {
    const row = document.getElementById('rail-switch');
    const menu = document.getElementById('rail-menu');
    if (!row || !menu || row.disabled || !fleet.length) return;
    drawMenu();
    menu.hidden = false;
    const box = row.getBoundingClientRect();
    menu.style.left = `${Math.round(Math.min(box.right + 8, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.round(Math.min(box.top, window.innerHeight - menu.offsetHeight - 8)))}px`;
    menuOpen = true;
    row.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild).focus();
  }
  function closeMenu(refocus) {
    const menu = document.getElementById('rail-menu');
    const row = document.getElementById('rail-switch');
    if (!menu || !menuOpen) return;
    menuOpen = false;
    menu.hidden = true;
    if (row) row.setAttribute('aria-expanded', 'false');
    if (refocus && row) row.focus();
  }

  /* ---- keyboard: one tab stop, arrows inside ---- */
  const STOP = '#rail .rail-item, #rail #rail-switch, #rail .rail-fold, #rail .rail-collapse';
  const stops = () => [...document.querySelectorAll(STOP)]
    .filter(el => !el.hidden && !el.disabled && el.offsetParent !== null && !el.closest('.is-folded'));
  function roving(focused) {
    const mine = focused || document.querySelector('#rail .rail-item.active');
    document.querySelectorAll(STOP).forEach(el => el.setAttribute('tabindex', el === mine ? '0' : '-1'));
  }
  function onRailKey(e) {
    const all = stops();
    const at = all.indexOf(document.activeElement);
    if (at < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, to))].focus();
  }
  function typing(el) {
    if (!el) return false;
    if (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    // A switch or a button with focus isn't typing, so the shortcuts still work after a click on one.
    return el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color)$/i.test(el.type || '');
  }

  function build() {
    const item = pl => {
      const d = homeOf(pl.id);
      const key = keyFor(d.id);
      return `<a href="${routeFor(d)}" class="rail-item" data-dest="${d.id}" data-place="${pl.id}"${key ? ` aria-keyshortcuts="G ${key.toUpperCase()}"` : ''}>
      ${svg(ICON[pl.id])}<span class="rail-label">${esc(pl.label)}</span><span class="rail-badge" hidden aria-hidden="true"></span></a>`;
    };
    const nav = document.createElement('nav');
    nav.className = 'rail';
    nav.id = 'rail';
    nav.setAttribute('aria-label', 'Places');
    nav.innerHTML = `<div class="rail-card liquid-glass">
      <a class="rail-brand" id="rail-brand" href="#/overview" aria-label="Deja Vu1, go to Overview"><span class="rail-mark" aria-hidden="true"><i></i></span><span class="rail-label">Deja&nbsp;Vu1</span></a>
      <button class="rail-who" id="rail-switch" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="rail-menu">
        <i class="rail-dot" data-state="" aria-hidden="true"></i>
        <span class="rail-label"><b id="rail-printer">No printer</b> <small id="rail-state"></small></span>${svg(ICON.chevron)}</button>
      <div class="rail-scroll">
        <div class="rail-list">${PLACES.filter(p => p.group === 'main').map(item).join('')}</div>
        <button class="rail-group rail-fold" id="rail-tools-h" type="button" aria-expanded="true" aria-controls="rail-tools" aria-label="More places">
          <span>More</span>${svg(ICON.chevron)}</button>
        <div class="rail-list" id="rail-tools" role="group" aria-labelledby="rail-tools-h">${PLACES.filter(p => p.group === 'more').map(item).join('')}</div>
      </div>
      <div class="rail-foot">
        ${PLACES.filter(p => p.group === 'foot').map(item).join('')}
        <button class="rail-collapse" id="rail-collapse" type="button" aria-controls="rail" aria-pressed="false">${svg(ICON.collapse)}<span class="rail-label">Narrow</span></button>
        <span class="rail-version" id="rail-version"></span>
      </div></div>`;
    const shell = document.getElementById('shell') || document.body;
    shell.prepend(nav);
    const chip = document.getElementById('ver-chip');     // the version chip lives at the foot of the sidebar
    if (chip) document.getElementById('rail-version').append(chip);
    const menu = document.createElement('div');
    menu.className = 'rail-menu liquid-glass';
    menu.id = 'rail-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Printers');
    document.body.append(menu);

    document.getElementById('rail-brand').addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      go(byId.overview);
    });
    nav.addEventListener('click', e => {
      const a = e.target.closest('.rail-item[data-place]');   // not <html>, which also carries data-place
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a new tab keeps its own link
      e.preventDefault();
      go(byId[a.dataset.dest]);
    });
    document.getElementById('rail-collapse').addEventListener('click', toggleNarrow);
    document.getElementById('rail-tools-h').addEventListener('click', () =>
      setMore(document.getElementById('rail-tools').classList.contains('is-folded'), true));
    document.getElementById('rail-switch').addEventListener('click', () => {
      if (menuOpen) closeMenu(true);
      else if (fleet.length > 1) openMenu();
      else go(byId.printer);
    });
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-printer]');
      if (!b) return;
      closeMenu(false);
      go(byId.printer, b.dataset.printer);
    });
    menu.addEventListener('keydown', e => {
      const all = [...menu.querySelectorAll('[data-printer]')];
      const at = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      all[(to + all.length) % all.length].focus();
    });
    document.addEventListener('click', e => {
      if (menuOpen && !e.target.closest('#rail-menu, #rail-switch')) closeMenu(false);
    });
    nav.addEventListener('keydown', onRailKey);
    nav.addEventListener('focusin', e => { roving(e.target.closest('.rail-item, #rail-switch, .rail-fold, .rail-collapse')); });
    // The phone's bottom bar and More sheet name places too; workshop-part5.js opens the screen, this picks the part.
    document.addEventListener('click', e => {
      const b = e.target.closest('#thumb-dock [data-dest]');
      if (b && byId[b.dataset.dest]) go(byId[b.dataset.dest]);
    });
    let leader = 0;
    document.addEventListener('keydown', e => {
      if (!typing(e.target) && !e.ctrlKey && !e.metaKey && !document.querySelector('.guide:not([hidden])')) onPageKey(e);
    });
    function onPageKey(e) {
      if (e.altKey) {
        const n = /^Digit([1-8])$/.exec(e.code || '');
        const eight = PLACES.filter(p => p.group !== 'more');
        if (n && eight[+n[1] - 1]) { e.preventDefault(); location.hash = routeFor(homeOf(eight[+n[1] - 1].id)); }
        return;
      }
      if (leader && Date.now() - leader < 1200) {
        leader = 0;
        const id = GO_KEYS[e.key.toLowerCase()];
        if (id && byId[id]) { e.preventDefault(); location.hash = routeFor(byId[id]); }
        return;
      }
      if (e.key === 'g' || e.key === 'G') { leader = Date.now(); return; }
      if (e.key === '?') { e.preventDefault(); keySheet(); return; }
      if (e.key === '[' && !PHONE.matches) toggleNarrow();
    }
  }

  /* ? : every shortcut on one sheet. */
  function keySheet() {
    let sheet = document.getElementById('kb-sheet');
    if (!sheet) {
      sheet = document.createElement('dialog');
      sheet.id = 'kb-sheet';
      sheet.className = 'kb-sheet liquid-glass';
      sheet.setAttribute('aria-labelledby', 'kb-title');
      const go = Object.entries(GO_KEYS).filter(([, id]) => byId[id])
        .map(([k, id]) => `<li><span>${esc(byId[id].label)}</span><span><kbd>G</kbd> <kbd>${esc(k.toUpperCase())}</kbd></span></li>`).join('');
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
      const mod = mac ? '⌘' : 'Ctrl';
      sheet.innerHTML = `<h2 id="kb-title">Keyboard shortcuts</h2>
        <div class="kb-cols"><section><h3>Go to</h3><ul>${go}</ul></section>
        <section><h3>Anywhere</h3><ul>
          <li><span>Find anything</span><span><kbd>${mod}</kbd> <kbd>K</kbd> or <kbd>/</kbd></span></li>
          <li><span>Halt the selected printer</span><span><kbd>H</kbd> <kbd>H</kbd></span></li>
          <li><span>Ask your AI</span><span><kbd>${mod}</kbd> <kbd>J</kbd></span></li>
          <li><span>The eight places</span><span><kbd>Alt</kbd> <kbd>1</kbd>–<kbd>8</kbd></span></li>
          <li><span>Back and forward</span><span><kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd></span></li>
          <li><span>Narrow or widen the sidebar</span><span><kbd>[</kbd></span></li>
          <li><span>This list</span><span><kbd>?</kbd></span></li></ul></section></div>
        <form method="dialog"><button class="btn primary" type="submit">Close</button></form>`;
      sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
      document.body.append(sheet);
    }
    if (!sheet.open) sheet.showModal();
  }

  function init() {
    if (!window.showTab || !window.Sections) return;
    build();
    root.classList.add('has-rail');
    wireOpen();
    setMore(store.get(MORE_KEY) !== '0', false);
    window.addEventListener('dv-fleet', e => { fleet = Array.isArray(e.detail) ? e.detail : []; paintStatus(false); });
    window.addEventListener('dv-theme', () => paintStatus(true));
    roving();
    WIDE.addEventListener('change', () => applyNarrow());
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
    window.dispatchEvent(new CustomEvent('dv-rail'));   // the toolbar edge (pagebar.js) can now ask for names and icons
  }

  window.Rail = {
    get destinations() { return DEST.filter(shownDest).map(d => ({ ...d })); }, places: PLACES.map(p => ({ ...p })), parse, current: () => current().id,
    practice: practiceOn,
    setPractice: on => {
      store.set(PRACTICE_KEY, on ? 'on' : 'off');
      if (!on && current().id === 'sandbox') location.hash = routeFor(byId.printers);
      window.dispatchEvent(new CustomEvent('dv-practice', { detail: { on: !!on } }));
    },
    place: () => current().place, partsOf: id => partsOf(id).map(d => ({ ...d })),
    destFor: tab => (DEST.find(d => d.tab === tab) ? homeOf(DEST.find(d => d.tab === tab).place) : byId.overview).id,
    label: id => (byId[id] || byId.overview).label, placeLabel: id => (placeById[id] || placeById.overview).label,
    icon: id => (ICON[(byId[id] || { place: id }).place] ? svg(ICON[(byId[id] || { place: id }).place]) : ''),
    shown: () => !!document.getElementById('rail') && !PHONE.matches,
    narrow: () => root.classList.contains('rail-collapsed'), toggleNarrow,
    mode: () => chosenMode() || 'auto',
    setMode: m => { store.set(MODE_KEY, m === 'wide' || m === 'narrow' ? m : ''); store.set(OLD_COLLAPSE_KEY, ''); applyNarrow(); },
    keyFor, keys: keySheet, go: id => { if (byId[id] || byId[OLD[id]]) location.hash = routeFor(byId[id] || byId[OLD[id]]); },
    goDest: (id, printer) => { const d = byId[id] || byId[OLD[id]]; if (d) go(d, printer); }
  };
  init();
})();
