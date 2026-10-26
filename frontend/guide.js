/* Guided tours. One engine runs three kinds:
     - the quick tour (setup, Settings → Your space): nine stops that hop
       between screens, about a minute,
     - "Show me this screen": a few stops on the open screen (the button in
       the line under the tab bar), and
     - each version's "What's new" tour (versions.js).
   A stop spotlights a real part of the dashboard with a glass callout whose
   tail points at it; the callout glides to the next stop, across screens,
   and the page stays usable, so "Try it" means really trying it. A step
   with no target floats in the middle; a chapter (version tours) fills the
   screen. Tours never send printer commands: "Try it" buttons only press
   buttons a person could press, and anything that would change a printer is
   left out. */
'use strict';
window.Guide = (() => {
  let root, ring, card, beacon, steps = [], at = 0, opts = {}, returnTab = null, returnFocus = null, raf = 0, target = null;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => matchMedia('(max-width: 720px)').matches;

  function build() {
    root = document.createElement('div');
    root.className = 'guide';
    root.innerHTML = `<div class="guide-scrim"></div><div class="guide-ring" aria-hidden="true"></div>
      <div class="guide-beacon" aria-hidden="true"></div>
      <section class="guide-card" role="dialog" aria-modal="false" aria-labelledby="guide-title">
        <div class="guide-tail" aria-hidden="true"></div><div class="guide-body"></div></section>`;
    ring = root.querySelector('.guide-ring');
    beacon = root.querySelector('.guide-beacon');
    card = root.querySelector('.guide-card');
    document.body.append(root);
    card.addEventListener('click', onCardClick);
    // The glint on the glass follows the pointer, as on the dashboard's own glass.
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    });
  }

  /* Things a "Try it" button may do. Each is something a person can do by hand. */
  const ACTIONS = {
    'demo-on': () => { if (tourOn() || demoOn) return; $('demo-toggle').checked = true; $('demo-toggle').dispatchEvent(new Event('change')); },
    'focus-search': () => { const f = $('feature-search'); f.focus(); f.value = 'twin'; f.dispatchEvent(new Event('input', { bubbles: true })); },
    'twin-drawing': () => document.querySelector('#twin-modes button:not(.active)')?.click(),
    'printer-menu': () => $('printer-chip').click(),
    'samples': () => $('file-samples')?.click(),
    'orb-demo': () => toast('This is a message. It rose out of the orb and will sink back in.', 'ok'),
    'open-orb': () => setTimeout(() => window.Orb && Orb.open(), 60),
    'check-updates': () => $('app-update-check')?.click(),
    'install-app': () => $('da-install')?.click(),
    'phone': () => window.Phone && Phone.open(),
    'sandbox': () => $('tab-sandbox')?.scrollIntoView({ block: 'center' }),
  };

  function resolve(step) {
    if (!step.target) return null;
    let el = document.querySelector(step.target);
    if (el && step.closest) el = el.closest(step.closest) || el;
    if (!el || el.closest('[hidden]') || !el.getClientRects().length) return null;
    return el;
  }

  /* Where the callout goes: beside the spotlight where it fits (right, then
     left), else below or above it; on a phone, docked to the top or bottom
     edge. Its tail points back at the spotlight, and the beacon sits where
     the tail points. */
  function place() {
    raf = 0;
    if (!root || !target) return;
    const pad = 8, vw = innerWidth, vh = innerHeight, raw = target.getBoundingClientRect();
    // Only the part of the target that is on screen counts.
    const r = { left: Math.max(raw.left, 0), right: Math.min(raw.right, vw), top: Math.max(raw.top, 0), bottom: Math.min(raw.bottom, vh) };
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    const w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 12;
    ring.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.width = `${Math.max(24, w)}px`;
    ring.style.height = `${Math.max(24, h)}px`;
    ring.style.borderRadius = `${Math.min(radius + pad, 40)}px`;
    const c = card.getBoundingClientRect(), gap = 22, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    let left, top, side;
    if (narrow()) {
      left = 12;
      if (cy > vh / 2) { top = 12; side = 'bottom'; } else { top = vh - c.height - 12; side = 'top'; }
    } else if (r.right + gap + c.width < vw - 12) {
      left = r.right + gap; top = cy - Math.min(c.height / 2, 60); side = 'left';
    } else if (r.left - gap - c.width > 12) {
      left = r.left - gap - c.width; top = cy - Math.min(c.height / 2, 60); side = 'right';
    } else {
      left = cx - c.width / 2;
      if (r.bottom + gap + c.height < vh - 12) { top = r.bottom + gap; side = 'top'; } else { top = r.top - gap - c.height; side = 'bottom'; }
    }
    left = Math.min(Math.max(12, left), vw - c.width - 12);
    top = Math.min(Math.max(12, top), vh - c.height - 12);
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    // The tail, on the callout's edge nearest the spotlight, aimed at its middle.
    card.dataset.tail = side;
    const along = side === 'left' || side === 'right'
      ? Math.min(Math.max(cy - top, 26), c.height - 26)
      : Math.min(Math.max(cx - left, 30), c.width - 30);
    card.style.setProperty('--tail', `${Math.round(along)}px`);
    let bx, by;
    if (side === 'left') { bx = x + w; by = top + along; }
    else if (side === 'right') { bx = x; by = top + along; }
    else if (side === 'top') { bx = left + along; by = y + h; }
    else { bx = left + along; by = y; }
    bx = Math.min(Math.max(bx, x), x + w); by = Math.min(Math.max(by, y), y + h);
    beacon.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
    if (ring.classList.contains('is-fresh')) { void ring.offsetWidth; ring.classList.remove('is-fresh'); beacon.classList.remove('is-fresh'); }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  function chapterList() {
    const chapters = steps.map((s, i) => [s, i]).filter(([s]) => s.chapter && s.section);
    if (chapters.length < 3) return '';
    return `<nav class="guide-sections" aria-label="Jump to a part of the tour">${chapters.map(([s, i]) =>
      `<button type="button" class="chip-btn${i === at ? ' is-now' : ''}" data-go="${i}">${esc(s.section)}</button>`).join('')}</nav>`;
  }

  const val = v => (typeof v === 'function' ? v() : v);

  function dots() {
    if (steps.length > 14) return `<span class="guide-count">${at + 1} / ${steps.length}</span>`;
    return `<span class="guide-dots" role="img" aria-label="Stop ${at + 1} of ${steps.length}">${steps.map((_, i) =>
      `<i class="${i < at ? 'done' : i === at ? 'now' : ''}"></i>`).join('')}</span>`;
  }

  function render() {
    const step = steps[at];
    const tryLabel = val(step.try), html = val(step.html);
    if (step.before) step.before();
    if (step.tab) showTab(step.tab);
    target = step.chapter ? null : resolve(step);
    const missing = !step.chapter && step.target && !target;
    // A callout floating in the middle glides from there to its first spotlight,
    // rather than starting again from the corner of the screen.
    const from = card.classList.contains('is-free') || card.classList.contains('is-chapter') ? card.getBoundingClientRect() : null;
    root.classList.toggle('is-chapter', !!step.chapter);
    root.classList.toggle('is-free', !step.chapter && !target);
    const section = [...steps.slice(0, at + 1)].reverse().find(s => s.section)?.section || opts.name || 'Tour';
    card.classList.toggle('is-chapter', !!step.chapter);
    card.classList.toggle('is-free', !step.chapter && !target);
    const body = card.querySelector('.guide-body');
    body.innerHTML = `
      <div class="guide-top"><span class="eyebrow">${esc(step.eyebrow || section)}</span>
        ${dots()}
        <button type="button" class="guide-x" data-act="end" aria-label="End the tour">×</button></div>
      ${step.hero ? `<div class="guide-hero" aria-hidden="true">${esc(step.hero)}</div>` : ''}
      <h2 id="guide-title" class="guide-title">${esc(step.title)}</h2>
      <div class="guide-text">${html || `<p>${esc(step.text || '')}</p>`}</div>
      ${missing ? '<p class="guide-note">This part is switched off or not shown here, so there is nothing to point at. It works the same once it is on.</p>' : ''}
      ${tryLabel ? `<button type="button" class="btn guide-try" data-act="try">${esc(tryLabel)} <span aria-hidden="true">↗</span></button>` : ''}
      ${step.chapter ? chapterList() : ''}
      <div class="guide-foot">
        <button type="button" class="btn" data-act="back" ${at === 0 ? 'hidden' : ''}>Back</button>
        <button type="button" class="btn primary" data-act="next">${at === steps.length - 1 ? (opts.doneLabel || 'Finish') : at === 0 && opts.startLabel ? opts.startLabel : 'Next'}</button>
      </div>`;
    body.classList.remove('is-in'); void body.offsetWidth; body.classList.add('is-in');
    card.scrollTop = 0;
    if (target) {
      // A spotlight that was hidden fades in where it belongs instead of flying in from the corner.
      if (ring.hidden) { ring.classList.add('is-fresh'); beacon.classList.add('is-fresh'); }
      ring.hidden = false; beacon.hidden = false;
      if (from && from.width) {
        card.style.transition = 'none';
        card.style.transform = `translate(${Math.round(from.left)}px, ${Math.round(from.top)}px)`;
        void card.offsetWidth;
        card.style.transition = '';
      }
      // Centre the target in the space under the sticky top bar; a tall one starts just below it.
      const bar = document.querySelector('.topbar'), r = target.getBoundingClientRect();
      const top = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom + 12 : 12;
      const room = innerHeight - top, y = r.height > room * .85 ? r.top - top : r.top - top - (room - r.height) / 2;
      scrollTo({ top: Math.max(0, scrollY + y), behavior: still() ? 'instant' : 'smooth' });
    } else {
      ring.hidden = true; beacon.hidden = true;
      card.style.transform = '';
      delete card.dataset.tail;
    }
    requestAnimationFrame(place);
    // Smooth scrolling moves the target after this; the scroll listener keeps the
    // callout on it, and one more placement once it settles catches the end.
    setTimeout(schedule, 420);
    const title = $('guide-title');
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }

  function go(i) {
    if (i < 0) return;
    if (i >= steps.length) return end(true);
    at = i;
    render();
  }

  function onCardClick(e) {
    const b = e.target.closest('[data-act], [data-go]');
    if (!b) return;
    if (b.dataset.go) return go(+b.dataset.go);
    const act = b.dataset.act;
    if (act === 'next') go(at + 1);
    else if (act === 'back') go(at - 1);
    else if (act === 'end') end(false);
    else if (act === 'try') {
      const step = steps[at];
      if (typeof step.action === 'function') step.action();
      else if (ACTIONS[step.action]) ACTIONS[step.action]();
      else if (step.target) document.querySelector(step.target)?.click?.();
      b.classList.add('is-done');
      setTimeout(schedule, 60);
    }
  }

  function onKey(e) {
    if (!root || e.defaultPrevented || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]:modal')) return;   // a sheet the tour opened answers its own keys
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
  }

  function start(list, options = {}) {
    if (root) end(false);
    steps = list.filter(s => !s.when || s.when());
    if (!steps.length) return;
    opts = options; at = Math.min(options.startAt || 0, steps.length - 1);
    returnFocus = document.activeElement;
    returnTab = document.querySelector('.navtab.active')?.dataset.tab || 'overview';
    build();
    document.documentElement.classList.add('guide-open');
    addEventListener('scroll', schedule, { passive: true, capture: true });
    addEventListener('resize', schedule, { passive: true });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => root.classList.add('is-in'));
    render();
  }

  function end(finished) {
    if (!root) return;
    removeEventListener('scroll', schedule, { capture: true });
    removeEventListener('resize', schedule);
    document.removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf); raf = 0;
    const old = root;
    root = null; target = null;
    old.classList.remove('is-in');
    setTimeout(() => old.remove(), still() ? 0 : 300);
    document.documentElement.classList.remove('guide-open');
    if (!opts.keepTab && returnTab) showTab(returnTab);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    if (opts.onEnd) opts.onEnd(finished);
  }

  /* ---- the quick tour ----------------------------------------------------- */
  const needsDemo = () => !(demoOn || tourOn());
  const QUICK = [
    { eyebrow: 'Quick tour', title: 'A quick look around.',
      html: () => `<p>Nine stops across the dashboard, about a minute. Each one points at the real thing, and you can click it while the tour waits.</p>
        ${needsDemo() ? '<p class="guide-aside">The screens are empty until a printer is connected. Demo data fills them with pretend printers (Demo printer 1, 2 and 3) so there is something to see. The switch in the header turns it off again.</p>' : ''}`,
      try: () => needsDemo() ? 'Turn on demo data' : null, action: 'demo-on' },
    { tab: 'overview', target: '#attention', title: 'What needs you',
      text: 'Jams, errors, finished prints and maintenance that is due, for every printer, most urgent first. Keep this screen open and nothing slips by.' },
    { tab: 'overview', target: '#twin-card', title: 'Your printer, live in 3D',
      text: 'A model of the U1 that moves with the real one: heads, bed, spools and the print itself, layer by layer. Drag to turn it; click a head for its details.',
      try: 'Show it as a drawing', action: 'twin-drawing' },
    { tab: 'fleet', target: '#fleet-grid', title: 'Every printer at once',
      text: 'One card per printer: progress, its four colours, temperatures and health. Tick several to pause or preheat them together.' },
    { tab: 'files', target: '#file-drop', closest: '.card', title: 'From a file to a print',
      text: 'Drop G-code, STL or 3MF files here. Look inside in 3D, slice with your own slicer, and queue it. Every print is checked before it starts.',
      try: () => tourOn() ? null : 'Add the sample files', action: 'samples' },
    { tab: 'control', target: '#ctrl-pause-resume', closest: '.card', title: 'Drive one printer',
      text: 'Pause, resume or cancel, stop just one failed object, set temperatures and move the head. Every button says what the printer answered.' },
    { tab: 'maintenance', target: '#tasks', closest: '.card', title: 'Looking after it',
      text: 'Maintenance reminders counted from real print hours, a logbook of problems and fixes, and your filament shelf.' },
    { target: '#feature-search', title: 'Find anything',
      text: 'Any screen, setting, printer or file. Press Ctrl+K (Cmd+K on a Mac) from anywhere.', try: 'Search for “twin”', action: 'focus-search' },
    { tab: 'overview', target: '#overview-pair-btn', closest: '.card', title: 'On your phone too',
      text: 'Scan a code with your phone’s camera and the same dashboard opens there. Nothing to type, no app store.',
      try: 'Connect your phone', action: 'phone' },
    { target: '#orb', title: 'Messages live here',
      text: 'Updates and alerts rise out of this orb and sink back in. Click it to read the last 30.', try: 'Send a test message', action: 'orb-demo' },
    { eyebrow: 'That’s the tour', title: 'You’re ready.',
      html: `<p>Every screen has a <strong>Show me this screen</strong> button under the tab bar with a few more tips.</p>
        <p>Replay this tour from <strong>Settings → Your space</strong>. Ready for your own printer? <strong>Printers → Add a printer</strong>.</p>` },
  ];

  /* ---- "Show me this screen": a few stops per screen ------------------------ */
  const SCREENS = {
    overview: [
      { target: '#attention', title: 'Needs you', text: 'Jams, errors, finished prints and due maintenance, most urgent first, for every printer.' },
      { target: '#twin-modes', title: 'Model or drawing', text: 'The same printer as an engineering drawing with dimensions, made from the same geometry.', try: 'Show the drawing', action: 'twin-drawing' },
      { target: '#overview-control', title: 'Quick controls', text: 'Pause, resume and the most-used actions. A refusal from the printer is shown in words.' },
      { target: '#telemetry', title: 'Live readings and health', text: 'Readings as they arrive, how often they arrive, and a health score with its reasons.' },
    ],
    fleet: [
      { target: '#fleet-grid', title: 'Printer cards', text: 'State, progress, the four heads’ colours, temperatures and health. Drag a file onto a card to queue it there.' },
      { target: '#fc-bar', title: 'Command several', text: 'Tick printers, then preheat, pause, resume, home or cancel them together. Each printer’s answer gets its own line.' },
      { target: '#tab-desk', title: 'The farm desk', text: 'Which printer suits a file best, what could print right now, and how long your filament lasts.' },
      { target: '#fleet-registry', title: 'Add your printer', text: 'Find printers looks for U1s on your home network, or type its address. Test first; adding never starts a print. Below: a sandbox of extra pretend printers to practise on.' },
    ],
    control: [
      { target: '#ctrl-pause-resume', closest: '.card', title: 'Pause, resume, cancel', text: 'The current print and its controls. Cancel asks first.' },
      { target: '#ctrl-plate', title: 'Skip one object', text: 'When a print labels its objects, pick a failed one on the bed map and stop only that one.' },
      { target: '#ctrl-temps', title: 'Temperatures and movement', text: 'Nozzle and bed temperatures, homing, moving the head, and a G-code console.' },
    ],
    files: [
      { target: '#convert-card', title: 'Convert a project', text: 'Turn a Bambu Studio, MakerWorld or OrcaSlicer project into one the U1 can print, with a report of every change.' },
      { target: '#file-drop', closest: '.card', title: 'Your files', text: 'Click a file for its 3D view, layers, plate editor and checks.', try: () => tourOn() ? null : 'Add the sample files', action: 'samples' },
      { target: '#queue-host', closest: '.card', title: 'The queue', text: 'Prints waiting their turn, per printer. Confirm Print checks each one before it starts.' },
      { target: '#tab-layerplan', title: 'Slicing and layer heights', text: 'Auto-print slices with an OrcaSlicer you installed; Mixed layer heights plans a height per head; Import from Orca brings in your presets.' },
    ],
    studio: [
      { target: '#st-body', title: 'Pictures into prints', text: 'Drop a photo, choose from the four colours you have loaded, and save a 3MF or STL tile or relief. Works in the browser.' },
    ],
    automations: [
      { target: '#rule-list', closest: '.card', title: 'When this, do that', text: 'For example, a message to your phone when a print finishes. Rules run on your computer, with no cloud.' },
    ],
    maintenance: [
      { target: '#tasks', closest: '.card', title: 'Maintenance', text: 'Reminders counted from real print hours. Mark a task done and its count starts again.' },
      { target: '#logbook', title: 'The logbook', text: 'Problems, fixes and print hours for each printer. Failed prints add themselves.' },
      { target: '#tab-filament', title: 'Filament and colour', text: 'Your spools, what each head has loaded, and how much is left.' },
    ],
    modules: [
      { target: '#version-card', title: 'Version and updates', text: 'Which version you run, how it updates, and every version’s changes with a tour of each.' },
      { target: '#appearance-card', title: 'Appearance', text: 'The background and its colours. Try clicking the page background, or triple-clicking it.' },
      { target: '#module-list', closest: '.card', title: 'Modules', text: 'Switch whole features on or off. A switched-off feature stops completely, background work included.' },
      { target: '#memory-card', title: 'Your data is safe', text: 'Safety copies every six hours, at start-up and before each update; restore one with a click. Below: backups, phones and the device lock.' },
    ],
    games: [
      { target: '#game-picker', title: 'Games', text: 'Pac-Man, Tetris, Snake and Sky Dash, for while a print runs. Nothing here reads or controls a printer.' },
    ],
  };

  function everything(options = {}) { start(QUICK, { name: 'Quick tour', startLabel: 'Show me', ...options }); }
  function screen(tab, options = {}) {
    const list = SCREENS[tab];
    if (!list) return;
    const name = (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[tab]) || tab;
    start(list.map(s => ({ tab, eyebrow: name, ...s })), { name, doneLabel: 'Got it', keepTab: true, ...options });
  }
  // Stops that point at something (the welcome and the ending don't count).
  function count() { return QUICK.filter(s => s.target && (!s.when || s.when())).length; }

  // The "Show me this screen" button in the line under the tab bar (app.js puts it there).
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tips]');
    if (b) screen(b.dataset.tips);
  });

  // The first screen's intro line is written before this script loads, so it gets its button here.
  document.addEventListener('DOMContentLoaded', () => {
    const intro = document.getElementById('tab-intro'), tab = document.querySelector('.navtab.active')?.dataset.tab;
    if (intro && tab && SCREENS[tab] && !intro.querySelector('[data-tips]'))
      intro.insertAdjacentHTML('beforeend', ` <button type="button" class="tips-btn" data-tips="${tab}"><span aria-hidden="true">✦</span> Show me this screen</button>`);
  });

  return { start, end, everything, screen, count, has: tab => !!SCREENS[tab], active: () => !!root };
})();
