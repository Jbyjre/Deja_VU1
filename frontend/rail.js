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
 * collapse button or the [ key, remembered). Below 1180 px it starts collapsed;
 * at phone width (720 px and less) the bottom bar and the More sheet stay in charge.
 *
 * What the sidebar shows from the live fleet (the dv-fleet event): the selected
 * printer's state and progress on the Printer item, a count on Overview of the
 * printers that need you and on Care of the printers with upkeep due, and, from two
 * printers on, a menu to choose which printer the Printer page shows. Arrow keys,
 * Home and End move between items; "Tools & learn" folds; with icons only, a label
 * appears beside the item you point at or focus.
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
    collapse: 'M15 6l-6 6 6 6',
    chevron: 'M6 9l6 6 6-6'
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
  const TOOLS_KEY = 'dejavu1.rail.tools';
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', error: 'Error', complete: 'Finished', ready: 'Ready' };
  const WIDE = window.matchMedia('(min-width: 1180px)');
  const PHONE = window.matchMedia('(max-width: 720px)');
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
    if (d.group === 'tools') setTools(true, false);   // you can't be somewhere that is folded away
    paintStatus(true);
    if (rail && !rail.contains(document.activeElement)) roving();
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
    if (on) closeMenu(false);
    if (remember) store.set(COLLAPSE_KEY, on ? '1' : '0');
  }

  function setTools(open, remember) {
    const list = document.getElementById('rail-tools');
    const head = document.getElementById('rail-tools-h');
    if (!list || !head) return;
    list.classList.toggle('is-folded', !open);
    head.setAttribute('aria-expanded', String(open));
    if (remember) store.set(TOOLS_KEY, open ? '1' : '0');
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

  function badge(id, count, level, words) {
    const item = document.querySelector(`#rail [data-dest="${id}"]`);
    const el = item && item.querySelector('.rail-badge');
    if (!el) return '';
    el.hidden = !count;
    el.textContent = count > 99 ? '99+' : String(count || '');
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
      flagged.length, worst, due, fleet.map(f => [f.id, f.name, f.state, f.link_lost]), document.documentElement.dataset.theme]);
    if (!force && sig === paintedFor) return;
    paintedFor = sig;

    const label = {};
    DEST.forEach(d => { label[d.id] = d.label; });
    label.overview += badge('overview', flagged.length, worst,
      plural(flagged.length, 'printer needs you', 'printers need you'));
    label.care += badge('care', due, 'warn', plural(due, 'printer has upkeep due', 'printers have upkeep due'));
    const tip = document.querySelector('#rail [data-dest="printer"]');
    if (tip) {
      const state = stateOf(p);
      const dot = tip.querySelector('.rail-dot');
      dot.dataset.state = state;
      dot.hidden = !state;
      const bar = tip.querySelector('.rail-progress');
      const printing = state === 'printing';
      bar.hidden = !printing;
      if (printing) bar.firstElementChild.style.width = `${Math.round((p.progress || 0) * 100)}%`;
      const who = document.getElementById('rail-printer');
      if (who) who.textContent = name || '';
      label.printer = `Printer${name ? `: ${name}` : ''}${p ? `, ${stateWords(p)}` : ''}`;
    }
    DEST.forEach(d => {
      const a = rail.querySelector(`[data-dest="${d.id}"]`);
      if (a) a.setAttribute('aria-label', label[d.id]);
    });
    const sw = document.getElementById('rail-switch');
    if (sw) sw.hidden = fleet.length < 2;
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
    const row = document.getElementById('rail-printer-row');
    const menu = document.getElementById('rail-menu');
    const sw = document.getElementById('rail-switch');
    if (!row || !menu || !sw || sw.hidden || fleet.length < 2) return;
    drawMenu();
    menu.hidden = false;
    const box = row.getBoundingClientRect();
    const rail = document.getElementById('rail').getBoundingClientRect();
    menu.style.left = `${Math.round(rail.right + 8)}px`;
    menu.style.top = `${Math.max(8, Math.round(Math.min(box.top, window.innerHeight - menu.offsetHeight - 8)))}px`;
    menuOpen = true;
    sw.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild).focus();
  }
  function closeMenu(refocus) {
    const menu = document.getElementById('rail-menu');
    const sw = document.getElementById('rail-switch');
    if (!menu || !menuOpen) return;
    menuOpen = false;
    menu.hidden = true;
    if (sw) sw.setAttribute('aria-expanded', 'false');
    if (refocus && sw) sw.focus();
  }

  /* ---- the label beside an icon in the narrow sidebar ---- */
  function showTip(el) {
    const tip = document.getElementById('rail-tip');
    if (!tip || !document.documentElement.classList.contains('rail-collapsed') || menuOpen) return;
    tip.textContent = el.getAttribute('aria-label') || el.textContent.trim();
    tip.hidden = false;
    const box = el.getBoundingClientRect();
    const rail = document.getElementById('rail').getBoundingClientRect();
    tip.style.left = `${Math.round(rail.right + 8)}px`;
    tip.style.top = `${Math.round(box.top + box.height / 2 - tip.offsetHeight / 2)}px`;
  }
  const hideTip = () => { const tip = document.getElementById('rail-tip'); if (tip) tip.hidden = true; };

  /* ---- keyboard: one tab stop, arrows inside ---- */
  const stops = () => [...document.querySelectorAll('#rail .rail-item, #rail .rail-switch, #rail .rail-fold, #rail .rail-collapse')]
    .filter(el => !el.hidden && el.offsetParent !== null
      && !(el.classList.contains('rail-fold') && document.documentElement.classList.contains('rail-collapsed')));
  function roving(focused) {
    const mine = focused || document.querySelector('#rail .rail-item.active');
    document.querySelectorAll('#rail .rail-item, #rail .rail-switch, #rail .rail-fold, #rail .rail-collapse')
      .forEach(el => el.setAttribute('tabindex', el === mine ? '0' : '-1'));
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
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function build() {
    const item = d => `<a href="${routeFor(d)}" class="rail-item" data-dest="${d.id}">
      ${svg(ICON[d.id])}${d.id === 'printer' ? '<i class="rail-dot" hidden aria-hidden="true"></i>' : ''}<span class="rail-label">${esc(d.label)}${d.id === 'printer' ? '<small id="rail-printer"></small>' : ''}</span>${
      d.id === 'printer' ? '<i class="rail-progress" hidden aria-hidden="true"><b></b></i>' : ''}<span class="rail-badge" hidden aria-hidden="true"></span></a>`;
    const row = d => d.id === 'printer'
      ? `<div class="rail-row" id="rail-printer-row">${item(d)}<button class="rail-switch" id="rail-switch" type="button" hidden
          aria-haspopup="menu" aria-expanded="false" aria-controls="rail-menu" aria-label="Choose which printer to show">${svg(ICON.chevron)}</button></div>`
      : item(d);
    const nav = document.createElement('nav');
    nav.className = 'rail liquid-glass';
    nav.id = 'rail';
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML = `
      <div class="rail-list">${DEST.filter(d => d.group === 'main').map(row).join('')}</div>
      <button class="rail-group rail-fold" id="rail-tools-h" type="button" aria-expanded="true" aria-controls="rail-tools">
        <span>Tools &amp; learn</span>${svg(ICON.chevron)}</button>
      <div class="rail-list" id="rail-tools" role="group" aria-labelledby="rail-tools-h">${DEST.filter(d => d.group === 'tools').map(item).join('')}</div>
      <button class="rail-collapse" id="rail-collapse" type="button" aria-controls="rail">${svg(ICON.collapse)}<span class="rail-label">Hide labels</span></button>`;
    document.body.prepend(nav);
    const menu = document.createElement('div');
    menu.className = 'rail-menu liquid-glass';
    menu.id = 'rail-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Printers');
    const tip = document.createElement('div');
    tip.className = 'rail-tip';
    tip.id = 'rail-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'presentation');
    document.body.append(menu, tip);

    nav.addEventListener('click', e => {
      const a = e.target.closest('[data-dest]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a new tab keeps its own link
      e.preventDefault();
      go(byId[a.dataset.dest]);
    });
    document.getElementById('rail-collapse').addEventListener('click', () =>
      setCollapsed(!document.documentElement.classList.contains('rail-collapsed'), true));
    document.getElementById('rail-tools-h').addEventListener('click', () =>
      setTools(document.getElementById('rail-tools').classList.contains('is-folded'), true));
    document.getElementById('rail-switch').addEventListener('click', () => (menuOpen ? closeMenu(true) : openMenu()));
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
    nav.addEventListener('focusin', e => { roving(e.target.closest('.rail-item, .rail-switch, .rail-fold, .rail-collapse')); });
    nav.addEventListener('mouseover', e => { const el = e.target.closest('.rail-item, .rail-collapse, .rail-switch'); if (el) showTip(el); });
    nav.addEventListener('mouseleave', hideTip);
    nav.addEventListener('focusin', e => { const el = e.target.closest('.rail-item, .rail-collapse, .rail-switch'); if (el && e.target.matches(':focus-visible')) showTip(el); else hideTip(); });
    nav.addEventListener('focusout', hideTip);
    nav.addEventListener('scroll', hideTip, { passive: true });
    document.addEventListener('keydown', e => {
      if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !PHONE.matches) {
        setCollapsed(!document.documentElement.classList.contains('rail-collapsed'), true);
      }
    });
  }

  function init() {
    if (!window.showTab || !window.Sections) return;
    build();
    document.documentElement.classList.add('has-rail');
    const saved = store.get(COLLAPSE_KEY);
    setCollapsed(saved == null ? !WIDE.matches : saved === '1', false);
    setTools(store.get(TOOLS_KEY) !== '0', false);
    window.addEventListener('dv-fleet', e => { fleet = Array.isArray(e.detail) ? e.detail : []; paintStatus(false); });
    window.addEventListener('dv-theme', () => paintStatus(true));
    roving();
    WIDE.addEventListener('change', e => { if (store.get(COLLAPSE_KEY) == null) setCollapsed(!e.matches, false); });
    window.addEventListener('dv-tab', () => sync());
    window.addEventListener('dv-section', () => sync());
    // Another printer on the same page: the address follows without a new history step.
    window.addEventListener('dv-printer', () => { restoring = true; try { sync(); } finally { restoring = false; } });
    window.addEventListener('resize', hideTip);
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
