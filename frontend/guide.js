/* Guided tours. One engine runs two kinds:
     - the tour of every screen (Settings → Tour every screen, and setup), and
     - each version's "What's new" tour (versions.js).
   A step either spotlights a real part of the dashboard (the rest of the page
   dims; you can still click anything) or fills the screen as a chapter card.
   Tours never send printer commands; "Try it" buttons only press buttons a
   person could press, and anything that would change a printer is left out. */
'use strict';
window.Guide = (() => {
  let root, ring, card, steps = [], at = 0, opts = {}, returnTab = null, returnFocus = null, raf = 0, target = null;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => matchMedia('(max-width: 720px)').matches;

  function build() {
    root = document.createElement('div');
    root.className = 'guide';
    root.innerHTML = `<div class="guide-scrim"></div><div class="guide-ring" aria-hidden="true"></div>
      <section class="guide-card liquid-glass deep" role="dialog" aria-modal="false" aria-labelledby="guide-title"></section>`;
    ring = root.querySelector('.guide-ring');
    card = root.querySelector('.guide-card');
    document.body.append(root);
    card.addEventListener('click', onCardClick);
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
    'sandbox': () => $('tab-sandbox')?.scrollIntoView({ block: 'center' }),
  };

  function resolve(step) {
    if (!step.target) return null;
    let el = document.querySelector(step.target);
    if (el && step.closest) el = el.closest(step.closest) || el;
    if (!el || el.closest('[hidden]') || !el.getClientRects().length) return null;
    return el;
  }

  function place() {
    raf = 0;
    if (!root || !target) return;
    const pad = 8, r = target.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    const w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 12;
    ring.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.width = `${Math.max(24, w)}px`;
    ring.style.height = `${Math.max(24, h)}px`;
    ring.style.borderRadius = `${Math.min(radius + pad, 40)}px`;
    // The card goes beside the spotlight where it fits, else above or below it.
    const c = card.getBoundingClientRect(), gap = 16;
    let left, top;
    if (narrow()) {
      left = 12;
      top = (r.top + r.bottom) / 2 > vh / 2 ? 12 : vh - c.height - 12;
    } else if (r.right + gap + c.width < vw - 12) {
      left = r.right + gap; top = r.top;
    } else if (r.left - gap - c.width > 12) {
      left = r.left - gap - c.width; top = r.top;
    } else {
      left = r.left + r.width / 2 - c.width / 2;
      top = r.bottom + gap + c.height < vh - 12 ? r.bottom + gap : r.top - gap - c.height;
    }
    left = Math.min(Math.max(12, left), vw - c.width - 12);
    top = Math.min(Math.max(12, top), vh - c.height - 12);
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  function chapterList() {
    const chapters = steps.map((s, i) => [s, i]).filter(([s]) => s.chapter && s.section);
    if (chapters.length < 3) return '';
    return `<nav class="guide-sections" aria-label="Jump to a part of the tour">${chapters.map(([s, i]) =>
      `<button type="button" class="chip-btn${i === at ? ' is-now' : ''}" data-go="${i}">${esc(s.section)}</button>`).join('')}</nav>`;
  }

  const val = v => (typeof v === 'function' ? v() : v);

  function render() {
    const step = steps[at];
    const tryLabel = val(step.try), html = val(step.html);
    if (step.before) step.before();
    if (step.tab) showTab(step.tab);
    target = step.chapter ? null : resolve(step);
    const missing = !step.chapter && step.target && !target;
    root.classList.toggle('is-chapter', !!step.chapter);
    root.classList.toggle('is-free', !step.chapter && !target);
    const section = [...steps.slice(0, at + 1)].reverse().find(s => s.section)?.section || opts.name || 'Tour';
    const pct = Math.round(((at + 1) / steps.length) * 100);
    card.classList.toggle('is-chapter', !!step.chapter);
    card.innerHTML = `
      <div class="guide-top"><span class="eyebrow">${esc(step.eyebrow || section)}</span>
        <span class="guide-count">${at + 1} / ${steps.length}</span>
        <button type="button" class="guide-x" data-act="end" aria-label="End the tour">×</button></div>
      <div class="guide-progress" aria-hidden="true"><span style="transform:scaleX(${pct / 100})"></span></div>
      ${step.hero ? `<div class="guide-hero" aria-hidden="true">${esc(step.hero)}</div>` : ''}
      <h2 id="guide-title" class="guide-title">${esc(step.title)}</h2>
      <div class="guide-text">${html || `<p>${esc(step.text || '')}</p>`}</div>
      ${missing ? '<p class="guide-note">This part is switched off or not shown here, so there is nothing to point at. It works the same once it is on.</p>' : ''}
      ${tryLabel ? `<button type="button" class="btn guide-try" data-act="try">${esc(tryLabel)} <span aria-hidden="true">↗</span></button>` : ''}
      ${step.chapter ? chapterList() : ''}
      <div class="guide-foot">
        <button type="button" class="btn" data-act="back" ${at === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="btn primary" data-act="next">${at === steps.length - 1 ? (opts.doneLabel || 'Finish') : 'Next'}</button>
      </div>`;
    card.scrollTop = 0;
    if (target) {
      target.scrollIntoView({ block: target.getBoundingClientRect().height > innerHeight * .7 ? 'start' : 'center', behavior: 'instant' });
      ring.hidden = false;
    } else {
      ring.hidden = true;
      card.style.transform = '';
    }
    requestAnimationFrame(place);
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
      schedule();
    }
  }

  function onKey(e) {
    if (!root || e.defaultPrevented || e.target.closest('input, textarea, select, [contenteditable]')) return;
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

  /* ---- the tour of every screen ------------------------------------------ */
  const demoNote = () => (demoOn || tourOn()) ? '' : '<p class="guide-aside">Tip: the screens fill up with Demo data on. The button below turns it on; the switch in the header turns it off again.</p>';
  const EVERYTHING = [
    { chapter: true, section: 'The big picture', eyebrow: 'Welcome to the tour', title: 'One dashboard, any screen.',
      html: () => `<p>Deja Vu1 runs on one computer at home. That computer talks to your U1 printers over your home network. Every screen you use, a browser tab, the desktop app window or your phone, opens the same dashboard from that computer.</p>
        <div class="guide-map" aria-label="How it connects">
          <div class="gm-node"><strong>Your screens</strong><span>Browser tab · App window · Phone</span></div>
          <div class="gm-line"><span>home Wi-Fi</span></div>
          <div class="gm-node is-core"><strong>The computer running Deja Vu1</strong><span>the launcher window keeps it on</span></div>
          <div class="gm-line"><span>home network</span></div>
          <div class="gm-node"><strong>Your U1 printers</strong><span>up to 12</span></div>
        </div>
        <p>This tour visits every screen in ${count()} stops, a few minutes in all. Use the arrow keys or the buttons, jump to any part below, and end it with × whenever you like. Nothing here moves or starts a printer.</p>` },
    { chapter: true, section: 'Workshop, Studio, Garage', eyebrow: 'The names you will see', title: 'Workshop, Studio and Garage are pretend printers.',
      html: () => `<p>With <strong>Demo data</strong> on, Deja Vu1 runs three simulated U1s so you can learn without risk. They are named after rooms in a house:</p>
        <ul class="guide-trio">
          <li><strong>U1 · Workshop</strong><span>prints, and jams halfway through in the online demo</span></li>
          <li><strong>U1 · Studio</strong><span>paused partway through a print</span></li>
          <li><strong>U1 · Garage</strong><span>idle, with filament loaded, ready to start</span></li>
        </ul>
        <p>They are examples, not parts of the app. Your own printer appears under the name you give it, and the demo printers never touch a real one.</p>
        <p>Two more names look similar. <strong>Photo studio</strong> is a tab that turns pictures into prints. <strong>Your workshop</strong>, above the search box, is what the dashboard calls your print bench.</p>
        ${demoNote()}`,
      try: () => (demoOn || tourOn()) ? null : 'Turn on Demo data', action: 'demo-on' },

    { section: 'Around the edges', title: 'Choose a printer', target: '#printer-chip',
      text: 'Every screen shows the printer picked here. With Demo data on, the list holds Workshop, Studio and Garage.', try: 'Open the list', action: 'printer-menu' },
    { title: 'Demo data', target: 'label[for=demo-toggle]',
      text: 'On: simulated printers and figures, clearly labelled. Off: only your real printers. Without a printer and with this off, the dashboard shows no numbers at all rather than inventing them.' },
    { title: 'Connection', target: '#conn', when: () => !narrow(), text: 'Whether the selected printer is connected, and how its readings arrive.' },
    { title: 'Search everything', target: '#feature-search',
      text: 'Find any screen, setting, printer or file. Press Ctrl+K (Cmd+K on a Mac) from anywhere.', try: 'Search for “twin”', action: 'focus-search' },
    { title: 'Help and the camera', target: '#setup-open', closest: '.launch-strip',
      text: 'Set up & help replays setup. Camera opens the selected printer’s own camera picture.' },
    { title: 'The screens', target: '#tabbar', when: () => !narrow(),
      text: 'Nine screens. The line under this bar always says, in one sentence, what the open screen is for.' },
    { title: 'The screens', target: '#thumb-dock', when: () => narrow(),
      text: 'On a phone the screens sit at the bottom, in reach of your thumb. More holds the rest.' },
    { title: 'The status ribbon', target: '#status-ribbon',
      text: 'Stays on every screen, games included, so a finished or failed print is never missed.' },

    { chapter: true, section: 'Overview', eyebrow: 'Screen 1 of 9', title: 'Overview: what needs you, right now.',
      html: '<p>The screen to keep open. Problems first, then the selected printer: its live 3D twin, quick controls, health and readings.</p>' },
    { tab: 'overview', title: 'Needs you', target: '#attention', text: 'Jams, errors, finished prints and due maintenance, most urgent first, for every printer.' },
    { tab: 'overview', title: 'The digital twin', target: '#twin-card',
      text: 'A 3D model of the U1 that moves with the real one: heads, bed, docks, spools and the print itself. Drag to turn it, click a part for its details.' },
    { tab: 'overview', title: 'Model or drawing', target: '#twin-modes',
      text: 'The same printer as an engineering drawing with dimensions, made from the same geometry.', try: 'Show the drawing', action: 'twin-drawing' },
    { tab: 'overview', title: 'Quick controls', target: '#overview-control',
      text: 'Pause, resume and the most-used actions. A button reports what the printer says back, and shows a refusal in words.' },
    { tab: 'overview', title: 'Health', target: '#health-host', text: 'A health score from temperatures, errors and maintenance, with the reasons.' },
    { tab: 'overview', title: 'Live telemetry', target: '#telemetry', text: 'The selected printer’s readings as they arrive, and how often they arrive.' },
    { tab: 'overview', title: 'Insights', target: '#insights-card', text: 'Patterns from the printer’s own history: what tends to fail, which files print well, and where the hours go.' },

    { chapter: true, section: 'Printers', eyebrow: 'Screen 2 of 9', title: 'Printers: the whole farm.',
      html: '<p>Every printer you have added, side by side. Command several at once, plan what to print where, and practise on simulated printers.</p>' },
    { tab: 'fleet', title: 'Printer cards', target: '#fleet-grid', text: 'One card per printer: state, progress, its four heads’ colours, temperatures and health. Drag a file onto a card to queue it there.' },
    { tab: 'fleet', title: 'Command several', target: '#fc-bar', text: 'Tick printers, then preheat, pause, resume, home or cancel them together. Each printer’s answer is listed on its own line.' },
    { tab: 'fleet', title: 'The farm desk', target: '#tab-desk', text: 'Which printer suits a file best, what could print right now, and how long your filament lasts.' },
    { tab: 'fleet', title: 'Add your printer', target: '#fleet-registry', text: 'Find printers finds U1s on your home network; or type the printer’s address. Test before adding. Adding never starts a print.' },
    { tab: 'fleet', title: 'The farm sandbox', target: '#tab-sandbox', text: 'Add up to 24 more simulated printers and fire jams, errors and finishes on purpose, to see how the dashboard reacts.' },

    { chapter: true, section: 'Control', eyebrow: 'Screen 3 of 9', title: 'Control: drive one printer.',
      html: '<p>Everything for the selected printer: pause and cancel, the objects on the plate, temperatures, moving the head and a command console.</p>' },
    { tab: 'control', title: 'Pause, resume, cancel', target: '#ctrl-pause-resume', closest: '.card', text: 'The current print and its controls. Cancel asks you to confirm first.' },
    { tab: 'control', title: 'Skip one object', target: '#ctrl-plate', text: 'When a print labels its objects, pick a failed one on the bed map and stop only that one.' },
    { tab: 'control', title: 'Temperatures and movement', target: '#ctrl-temps', text: 'Set nozzle and bed temperatures, home and move the head, and send G-code commands.' },

    { chapter: true, section: 'Files', eyebrow: 'Screen 4 of 9', title: 'Files: from a model to a print.',
      html: '<p>Convert projects, keep your files, look inside them in 3D, slice with your own engine and queue prints. Every print is checked before it starts.</p>' },
    { tab: 'files', title: 'Convert a project', target: '#convert-card', text: 'Turn a Bambu Studio, MakerWorld or OrcaSlicer project into one the U1 can print, with a report of every change.' },
    { tab: 'files', title: 'Your files', target: '#file-drop', closest: '.card', text: 'Drop G-code, STL or 3MF files here. Click one for its 3D view, layers, plate editor and checks.', try: 'Add the sample files', action: 'samples', when: () => !tourOn() },
    { tab: 'files', title: 'The queue', target: '#queue-host', closest: '.card', text: 'Prints waiting their turn, per printer. Confirm Print checks each one before it starts.' },
    { tab: 'files', title: 'Auto-print', target: '#tab-autoprint', text: 'Slice with an OrcaSlicer you installed, using your profiles and the heads actually fitted, then queue the result.' },
    { tab: 'files', title: 'Mixed layer heights', target: '#tab-layerplan', text: 'Plan a different layer height per head. Crossed-out choices say why they won’t work.' },
    { tab: 'files', title: 'Import from Orca', target: '#orca-import', text: 'Bring in recent projects and your own presets from OrcaSlicer or Snapmaker Orca on this computer.' },

    { chapter: true, section: 'Photo studio', eyebrow: 'Screen 5 of 9', title: 'Photo studio: pictures into prints.',
      html: '<p>Not the Studio printer. This tab turns a photo into a multi-colour tile or relief, using the four filament colours you have loaded. It works in the browser, even without the server.</p>' },
    { tab: 'studio', title: 'Make a colour print from a photo', target: '#st-body', text: 'Drop a photo, choose the colours, and save a 3MF or STL to print.' },

    { chapter: true, section: 'Automations and Care', eyebrow: 'Screens 6 and 7 of 9', title: 'Rules that run by themselves, and looking after the printer.',
      html: '<p><strong>Automations</strong> are “when this happens, do that” rules. <strong>Care</strong> keeps maintenance, the logbook and your filament shelf.</p>' },
    { tab: 'automations', title: 'Automations', target: '#rule-list', closest: '.card', text: 'For example: send a message to your phone when a print finishes. Rules run on your computer, with no cloud.' },
    { tab: 'maintenance', title: 'Maintenance', target: '#tasks', closest: '.card', text: 'Reminders counted from real print hours. Mark a task done and the count starts again.' },
    { tab: 'maintenance', title: 'The logbook', target: '#logbook', text: 'Problems, fixes and print hours for each printer. Failed prints add themselves.' },
    { tab: 'maintenance', title: 'Filament and colour', target: '#tab-filament', text: 'Your spools, what is loaded in each head, and how much is left.' },

    { chapter: true, section: 'Settings and Games', eyebrow: 'Screens 8 and 9 of 9', title: 'Make it yours, keep it current.',
      html: '<p>Settings holds your version and updates, the desktop app, the look, which features are on, phones and notifications. Games are for while a print runs.</p>' },
    { tab: 'modules', title: 'Version and updates', target: '#version-card',
      text: 'Which version you run, how this copy updates, and every version’s changes with a tour of each.' },
    { tab: 'modules', title: 'The desktop app', target: '#desktop-card', text: 'Install Deja Vu1 as an app, or have the launcher open it in a window of its own.' },
    { tab: 'modules', title: 'Appearance', target: '#appearance-card', text: 'The background and its colours. Try clicking the page background, or triple-clicking it.' },
    { tab: 'modules', title: 'Modules', target: '#module-list', closest: '.card', text: 'Switch whole features on or off. A switched-off feature stops completely, background work included.' },
    { tab: 'modules', title: 'Backup', target: '#backup-btn', closest: '.card', text: 'Download all your settings and files as one ZIP, and restore it safely later.' },
    { tab: 'modules', title: 'Your data is safe', target: '#memory-card', text: 'Safety copies every six hours, at start-up and before each update. Restore one with a click, and undo that too.' },
    { tab: 'modules', title: 'About and Check it yourself', target: '#about-card', text: 'What Deja Vu1 adds, who it builds on, and a self-check you can run to see the safety rules working.' },
    { tab: 'modules', title: 'Device lock', target: '#device-lock', closest: '.card', text: 'Optional: only phones and computers you have paired can use the dashboard.' },
    { tab: 'games', title: 'Games', target: '#game-picker', text: 'Pac-Man, Tetris, Snake and Sky Dash. Nothing here reads or controls a printer.' },

    { title: 'The notification orb', target: '#orb',
      text: 'Messages rise out of this orb and sink back in. Click it to read the last 30, and for version and update news.', try: 'Send a test message', action: 'orb-demo' },
    { chapter: true, section: 'Done', eyebrow: 'End of the tour', title: 'You’ve seen every screen.',
      html: `<p>Replay this tour any time from <strong>Settings → Your space → Tour every screen</strong>. Each version also has its own tour of what it added, in <strong>Settings → Version &amp; updates</strong>.</p>
        <p>Ready for your own printer? <strong>Printers → Add a printer</strong>, or run setup again.</p>` },
  ];

  function everything(options = {}) { start(EVERYTHING, { name: 'Tour every screen', ...options }); }
  function count() { return EVERYTHING.filter(s => !s.when || s.when()).length; }

  return { start, end, everything, count, active: () => !!root };
})();
