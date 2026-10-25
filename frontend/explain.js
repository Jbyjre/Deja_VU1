/* Plain-language help, on every card.
   Each card title gets a small ⓘ. Pressing it, or the title itself, opens a short glass note:
   what the card is, how you use it, and sometimes one tip. Words that need explaining are
   underlined in the note; pressing one shows what it means, right there. Settings → Your space
   has the whole word list. Nothing here talks to the server.
   HELP is keyed by the card's title (lower case, letters and digits only); a test checks that
   every key still matches a card (tests/test_explain.py). [[word]] links a GLOSS entry. */
'use strict';
window.Explain = (() => {
  const HELP = {
    // ---- Overview
    'needs you': ['Everything that wants you right now, from every printer: jams, errors, finished prints and maintenance that is due.',
      'The most urgent item sits on top. Each row has a button that takes you where you can deal with it.'],
    'digital twin': ['A 3D copy of the printer you picked. It moves when the real one moves: the four [[heads]], the [[plate]], the spools, and the print growing layer by layer.',
      'Drag to turn it. Click a head to see its filament and temperature. Drawing shows the same printer as a technical drawing with sizes.',
      'The outer size comes from Snapmaker. Some inside parts are estimates, marked ≈.'],
    'printer control': ['Pause or cancel the print on the printer you picked at the top.',
      'Cancel asks you first. If the printer refuses, you see its reason in words.'],
    'print health': ['A score out of 100 for how ready this printer is to print.',
      'Overdue maintenance and failed checks cost points. The lines under the dial say what each one costs.'],
    'what your history says': ['Patterns in this printer’s past prints: which materials fail more, your busiest day, how much [[filament]] you get through.',
      'A pattern only shows up once enough prints back it up.'],
    'maintenance': ['Upkeep jobs such as cleaning the [[nozzle]] or checking the belts, counted from real print hours.',
      'When a job is due, do it on the printer, then press Mark done. Its count starts again.'],
    'chamber climate': ['The temperature inside the printer’s enclosure over the last 30 minutes.',
      'Some materials, like ABS, print better in a warm chamber.'],
    'print cost': ['What the current print costs so far: filament plus electricity.',
      'Set your filament and electricity prices in Settings → Print cost pricing.'],
    'use this dashboard on your phone': ['Open this same dashboard on your phone, on your home Wi-Fi.',
      'Press Connect your phone and point the phone’s camera at the code. It opens and pairs by itself.',
      'Typing instead? Put a colon before the port (10.0.0.10:8000). A dot there makes the phone search the web.'],
    'telemetry': ['Live readings from the printer you picked: temperatures, position, the active head, and how often readings arrive.',
      'Each head’s line shows its last few readings, so you can spot a temperature that wanders.'],
    // ---- Printers
    'your printers': ['One card per printer, with progress, its four colours, temperatures and health.',
      'Tick a few to pause, preheat or cancel them together. Open one to point the whole dashboard at it.',
      'Drag a file onto a card to add it to that printer’s queue.'],
    'farm history': ['Prints, successes, failures and filament used, per day or week, for each printer and all together.',
      'Deja Vu1 adds up each printer’s own history. It estimates nothing.'],
    'add a printer': ['Connect a real U1 so the dashboard can show and control it.',
      'Press Find printers to look on your home network, or type the address from the printer’s screen, like http://192.168.1.50:7125. Test it, then add it.',
      'Adding a printer never starts a print. You install nothing on the printer: Deja Vu1 talks to [[Moonraker]].'],
    'farm sandbox': ['A practice farm: add up to 24 pretend printers and make things go wrong on purpose.',
      'Fire a jam or an error and watch how the dashboard warns you. Your real printers never notice.'],
    'the farm': ['How many pretend printers the sandbox runs, and how fast its clock goes.', ''],
    'something happens now': ['Make one thing happen to a pretend printer right away: a jam, a lost connection, a finished print.', ''],
    'scenario': ['A script of events for the pretend printers, played over time, like a rough night of failures.',
      'Loading one restarts its clock. The printers keep their state.'],
    'farm desk': ['A planning board for your whole farm: what runs when, which printer suits a file, and whether your filament will last.', ''],
    'dispatch': ['Every running job and queue on a 24-hour line.',
      'Set the hours you are around. Deja Vu1 marks prints that would finish outside them, so a finished print doesn’t sit on the plate all night.'],
    'best printer for a file': ['Pick a file and see which printer suits it best.',
      'It compares material first, then colour, then [[nozzle]] sizes and when each printer is free.'],
    'print right now': ['Files an idle printer could start straight away with the filament it has loaded.', ''],
    'filament outlook': ['How much [[filament]] your running and queued prints still need, against the spools you track.', ''],
    'worth printing': ['Cost per piece and what each printer hour earns, for files you sell.',
      'A file name ending in x24 means 24 pieces on one plate.'],
    // ---- Control
    'objects on the plate': ['When a print has several separate objects, you can stop the one that failed and keep the rest going.',
      'Pick the failed one on the bed map and press Skip. The printer needs to know the objects’ names, which most slicers add.'],
    'home axes': ['Send the print head to its starting corner so the printer knows where it is.',
      'Only do this when nothing is printing.'],
    'g code console': ['Type commands straight to the printer, in [[G-code]].',
      'For people who know the commands. The printer’s replies show underneath.'],
    // ---- Files
    'bambu studio or makerworld project to snapmaker u1': ['Turn a project made for a Bambu printer, often from MakerWorld, into one the U1 can print.',
      'Choose the [[3MF]] file. You get a U1 copy and a report of every change. Your original stays as it was.',
      'It keeps the designer’s walls, infill and supports, and moves each plate to fit the U1.'],
    'file library': ['Your print files: [[G-code]] ready to print, and [[STL]] or [[3MF]] models to look at and prepare.',
      'Drop files here. Click one to see it in 3D, check it, or print it. Add sample files gives you a few to try.'],
    'print queue': ['Prints waiting their turn on each printer.',
      'Each one gets the Confirm Print check before it starts, so a wrong colour or a file that runs off the plate gets caught.'],
    'auto print': ['Slice a model with your own [[slicer]] and queue the result, without leaving the dashboard.', ''],
    'slicer': ['Where Deja Vu1 finds the OrcaSlicer you installed.',
      'Deja Vu1 runs it for you. It never downloads or installs a slicer itself.'],
    'profiles': ['Which OrcaSlicer settings to slice with: printer, print quality and [[filament]].',
      'These are the same profile files OrcaSlicer keeps. Deja Vu1 works on copies.'],
    'slice a model': ['Turn a model into [[G-code]] with your installed slicer.',
      'The result lands in your file library. It still gets the Confirm Print check before printing.'],
    'mixed layer heights': ['Plan a different layer thickness for each [[heads|head]].', ''],
    'layer heights per head': ['The U1 can carry a different [[nozzle]] in each head. Thin layers give crisp detail; thick layers print faster.',
      'Pick what matters most, and Deja Vu1 suggests a thickness per head. Deja Vu1 greys out choices that won’t work and says why.'],
    'tools filaments': ['This printer’s setup: which [[filament]] and [[nozzle]] sits in each of the four [[heads]].',
      'Preparing and checking a print use this, so keep it matching the real printer.'],
    'pick up where you left off': ['Bring in your recent projects and your own settings from OrcaSlicer or Snapmaker Orca on this computer.',
      'Nothing in the slicer changes. Deja Vu1 makes copies.'],
    // ---- Photo studio
    'photo to print studio': ['Turn a photo into a print made of coloured layers, using the filament colours you have loaded.',
      'Drop a picture, adjust it, and save a [[3MF]] or [[STL]] to print. It all happens in your browser.'],
    'from image to print project': ['Make colour tiles, a measured layer print, or a raised relief from a picture.',
      'Your saved head colours go into the [[3MF]], so the slicer knows which colour goes where.'],
    // ---- Automations
    'new rule': ['Make a “when this happens, do that” rule. For example: when a print finishes, send a message to my phone.',
      'Pick an event, then an action. Ready-made rules fill this in for you.'],
    'what fired': ['A list of every time a rule ran, and what happened.', 'If a message didn’t arrive, look here first.'],
    'rules': ['Your rules. Switch each one on or off, test it, or delete it.',
      'Rules run on this computer, with no cloud. The computer needs to stay on.'],
    // ---- Care
    'swapped a nozzle or hotend': ['Tell Deja Vu1 when you change a [[nozzle]] or hotend.',
      'It then asks you to recalibrate, until you mark that done.'],
    'filament colour': ['Your spools, what each head has loaded, and checks that the right colour is in.', ''],
    'dock status rings': ['Optional lights around each [[dock]] that show what each head is doing, with LED rings or a WLED strip you already own.',
      'The screen works today. The light hardware isn’t finished yet.'],
    'right colour loaded': ['An optional colour sensor that checks the right filament is loaded before a print starts.',
      'The screen works today. The sensor hardware isn’t finished yet.'],
    'filament inventory': ['The spools you have on hand, and how much is left on each.',
      'Add a spool once. Prints take their filament off it as they run.'],
    'what changed': ['Compares the print you are about to start with the last time this same file printed well.',
      'It flags real differences, like a different head or filament colour.'],
    'logbook': ['A diary per printer: problems, what fixed them, and the print hours at the time.',
      'Failed prints and pauses add themselves. Add your own notes too.'],
    // ---- Settings
    'your space': ['Help when you want it: the quick tour, setup again, and the meaning of the words used here.', ''],
    'version updates': ['Which version of Deja Vu1 you have, how it gets updates, and what each version changed.',
      'Check for updates whenever you like, or let it look by itself.'],
    'desktop app': ['Use Deja Vu1 in its own window, with its own icon, instead of a browser tab.',
      'Same dashboard, same data. Installing needs Chrome or Edge.'],
    'about deja vu1': ['What Deja Vu1 is, who made what it builds on, and a self-check you can run.', ''],
    'your data is safe': ['Deja Vu1 keeps safety copies of everything it remembers: printers, spools, maintenance, rules and more.',
      'It makes one every six hours, when it starts and before each update. Restore one with a click, and undo that too.'],
    'appearance': ['How the dashboard looks on this device: the moving background and its colours.',
      'Only this browser remembers it.'],
    'modules': ['Switch whole features on or off.',
      'A switched-off feature stops completely, including anything it did in the background.'],
    'paired devices': ['Phones and other computers you use with this dashboard.',
      'Pairing is optional. Turn on the device lock to let only paired devices in.'],
    'preferences': ['Small choices for this browser, such as °C or °F.', ''],
    'notifications': ['Where messages go when a rule sends one: ntfy, Discord or Telegram.',
      'Only automation rules send messages, and only to the services you set up here.'],
    'printer firmware app recovery': ['Back up everything Deja Vu1 keeps, and restore a backup into a separate folder if something goes wrong.',
      'Restoring never overwrites the copy you are running. Printer [[firmware]] is separate and Deja Vu1 doesn’t install it.'],
    'print cost pricing': ['Your filament and electricity prices, used to work out what each print costs.', ''],
    'wled bridge': ['Send the dock-light colours to a WLED light strip on your network.', ''],
    'home assistant bridge': ['Share each printer’s state with Home Assistant, if you use it for your smart home.', ''],
    'camera': ['The printer’s own camera picture, passed through this dashboard.', ''],
    'time lapses': ['Short movies of your prints: one picture every two layers, played back here.', ''],
    'away from home': ['How to reach this dashboard when you are out, through a private connection like Tailscale.',
      'The dashboard has no login. Use a private connection, never an open one.'],
    'demo controls': ['Buttons for trying things out while demo data is on.', ''],
  };

  const GLOSS = {
    'g code': ['G-code', 'The step-by-step instructions a 3D printer follows: where to move, how hot to get, how much plastic to push. A slicer makes it from a 3D model.'],
    'slicer': ['Slicer', 'A program that turns a 3D model into G-code by cutting it into thin layers. OrcaSlicer is one. Deja Vu1 can run one you install.'],
    'stl': ['STL', 'A common 3D model file. It holds the shape only, with no colours or print settings.'],
    '3mf': ['3MF', 'A 3D project file. It can hold several models, their colours, several plates and the print settings.'],
    'moonraker': ['Moonraker', 'The small web service already running inside every U1. Deja Vu1 talks to it over your home network, so you install nothing on the printer.'],
    'heads': ['Heads (T0 to T3)', 'The U1 has four print heads, named T0, T1, T2 and T3. Each holds its own filament, so one print can use up to four colours or materials.'],
    'nozzle': ['Nozzle', 'The metal tip the melted plastic comes out of. A smaller one prints finer detail; a bigger one prints faster. 0.4 mm is the usual size.'],
    'dock': ['Dock', 'Where a head waits while another one prints. The U1 swaps heads by picking them up from their docks.'],
    'plate': ['Plate', 'The flat sheet the print is built on, also called the bed. The U1 prints up to 270 × 270 × 270 mm.'],
    'filament': ['Filament', 'The plastic thread a 3D printer melts, sold on spools. PLA is the easiest to print; PETG is tougher.'],
    'firmware': ['Firmware', 'The software inside the printer itself. It comes from Snapmaker.'],
    'demo data': ['Demo data', 'Pretend printers and numbers for trying the app. They are labelled everywhere and never reach a real printer.'],
  };

  const key = text => String(text || '').toLowerCase().replace(/new version available/g, '').replace(/&amp;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = text => esc(text).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, term, shown) => {
    const k = key(term);
    return GLOSS[k] ? `<button type="button" class="xp-term" data-term="${k}" aria-expanded="false">${esc(shown || term)}</button>` : esc(shown || term);
  });

  let pop = null, owner = null;
  function build() {
    pop = document.createElement('div');
    pop.className = 'xp-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.append(pop);
    pop.addEventListener('click', e => {
      const t = e.target.closest('.xp-term');
      if (t) return toggleTerm(t);
      if (e.target.closest('[data-xp-close]')) close(true);
      if (e.target.closest('[data-xp-tips]')) { const tab = e.target.closest('[data-xp-tips]').dataset.xpTips; close(false); window.Guide && Guide.screen(tab); }
    });
  }

  function toggleTerm(t) {
    const open = t.getAttribute('aria-expanded') === 'true';
    const box = t.closest('p, li, .xp-gloss-row');
    box.parentElement.querySelectorAll('.xp-def').forEach(d => d.remove());
    pop.querySelectorAll('.xp-term[aria-expanded="true"]').forEach(x => x.setAttribute('aria-expanded', 'false'));
    if (open) return place();
    const [name, text] = GLOSS[t.dataset.term];
    const def = document.createElement('p');
    def.className = 'xp-def';
    def.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`;
    box.after(def);
    t.setAttribute('aria-expanded', 'true');
    place();
  }

  function open(btn) {
    if (!pop) build();
    if (owner === btn && !pop.hidden) return close(true);
    const k = btn.dataset.xp, [what, use, tip] = HELP[k];
    const title = btn.dataset.title;
    const tab = btn.closest('.tab-panel')?.id.replace('tab-', '');
    const tips = tab && window.Guide && Guide.has(tab);
    pop.innerHTML = `<div class="xp-head"><span class="xp-badge" aria-hidden="true">i</span><strong id="xp-title">${esc(title)}</strong>
        <button type="button" class="xp-x" data-xp-close aria-label="Close">×</button></div>
      <p class="xp-what">${words(what)}</p>${use ? `<p>${words(use)}</p>` : ''}${tip ? `<p class="xp-tip">${words(tip)}</p>` : ''}
      ${tips ? `<button type="button" class="xp-more" data-xp-tips="${esc(tab)}">Show me around this screen <span aria-hidden="true">→</span></button>` : ''}`;
    pop.setAttribute('aria-labelledby', 'xp-title');
    pop.classList.remove('is-center');
    if (owner) owner.setAttribute('aria-expanded', 'false');
    owner = btn;
    btn.setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    pop.classList.remove('is-in'); void pop.offsetWidth; pop.classList.add('is-in');
    place();
    pop.querySelector('.xp-x').focus({ preventScroll: true });
  }

  function close(refocus) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (owner) { owner.setAttribute('aria-expanded', 'false'); if (refocus) owner.focus({ preventScroll: true }); }
    owner = null;
  }

  // Under the ⓘ (or above, if there's no room); a sheet from the bottom on a phone.
  function place() {
    if (!pop || pop.hidden || !owner || pop.classList.contains('is-center')) return;
    if (matchMedia('(max-width: 560px)').matches) { pop.classList.add('is-sheet'); pop.style.left = pop.style.top = ''; return; }
    pop.classList.remove('is-sheet');
    const b = owner.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(Math.max(12, b.left + b.width / 2 - 32), innerWidth - w - 12);
    const below = b.bottom + 10, top = below + h < innerHeight - 12 ? below : Math.max(12, b.top - 10 - h);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.setProperty('--xp-arrow', `${Math.round(b.left + b.width / 2 - left)}px`);
    pop.classList.toggle('is-above', top < b.top);
  }

  // Give each known card title its ⓘ. Runs again when cards are drawn later.
  function decorate() {
    document.querySelectorAll('section.card h2, .card-head h2, .tab-sub-title, .dk-sec h2, section h2').forEach(h => {
      if (h.dataset.xpDone || h.closest('dialog, .guide, .xp-pop, .setup-dialog')) return;
      const k = key(h.textContent);
      if (!HELP[k]) return;
      h.dataset.xpDone = '1';
      h.classList.add('xp-title');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'xp-btn';
      b.dataset.xp = k;
      const shown = h.cloneNode(true);
      shown.querySelectorAll('.sr-only').forEach(n => n.remove());
      b.dataset.title = shown.textContent.replace(/New version available/, '').replace(/\s+/g, ' ').trim();
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('aria-label', `What is ${h.textContent.trim()}?`);
      b.innerHTML = '<span aria-hidden="true">i</span>';
      h.append(b);
    });
  }

  // The whole word list (Settings → Your space → What the words mean).
  function glossary(btn) {
    if (!pop) build();
    owner = btn;
    pop.innerHTML = `<div class="xp-head"><span class="xp-badge" aria-hidden="true">i</span><strong id="xp-title">What the words mean</strong>
        <button type="button" class="xp-x" data-xp-close aria-label="Close">×</button></div>
      <dl class="xp-gloss">${Object.values(GLOSS).map(([n, t]) => `<div class="xp-gloss-row"><dt>${esc(n)}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl>`;
    pop.setAttribute('aria-labelledby', 'xp-title');
    pop.classList.remove('is-sheet', 'is-above');
    pop.classList.add('is-center');
    pop.style.left = pop.style.top = '';
    pop.hidden = false;
    pop.classList.remove('is-in'); void pop.offsetWidth; pop.classList.add('is-in');
    place();
    pop.querySelector('.xp-x').focus({ preventScroll: true });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('.xp-btn');
    if (b) { e.preventDefault(); e.stopPropagation(); return open(b); }
    const t = e.target.closest('.xp-title');
    if (t && !e.target.closest('button, a, input, select, label')) { const ib = t.querySelector('.xp-btn'); if (ib) return open(ib); }
    const g = e.target.closest('[data-glossary]');
    if (g) return glossary(g);
    if (pop && !pop.hidden && !pop.contains(e.target)) close(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop && !pop.hidden) { e.stopPropagation(); close(true); } }, true);
  addEventListener('resize', () => place());
  addEventListener('scroll', () => place(), { passive: true, capture: true });
  document.addEventListener('DOMContentLoaded', () => {
    decorate();
    let queued = false;
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; decorate(); }); } })
      .observe(document.body, { childList: true, subtree: true });
  });
  return { HELP, GLOSS, open, close, glossary, decorate };
})();
