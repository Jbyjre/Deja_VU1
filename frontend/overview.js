/* overview.js: Overview as a glance, with everything deeper one press away.
 *
 * Overview answers three questions without a scroll: what is the selected printer doing, does anything need me, and how are my printers.
 * The middle is the selected printer (its state, file, progress, time left and readings, with its camera under them), the side has what
 * needs you (the first three, the rest in a sheet) and every printer, and a row of small buttons opens the rest (temperatures, quick control, totals, upkeep, the phone
 * link) in sheets (deck.js). The 3D printer is on the Printer screen only: it is the middle of that screen, not a decoration here.
 *
 * The cards that already exist are moved, never rebuilt (see deck.js), so everything that draws into them by id keeps working.
 */
(() => {
  const $ = id => document.getElementById(id);
  const ICON = {
    needs: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    printers: 'M6 9V4h12v5M6 17H4v-6h16v6h-2M7 14h10v6H7z',
    temps: 'M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v7',
    quick: 'M13 3L5 14h6l-1 7 8-11h-6z',
    upkeep: 'M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.500 2.500-2.500-.5-.5-2.500z',
    totals: 'M5 20V10M12 20V4M19 20v-7',
    phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
    camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  };
  const SHEETS = {
    needs: { title: 'Needs you', main: ['attention'], icon: ICON.needs },
    printers: { title: 'Your printers', main: ['ov-printers'], icon: ICON.printers },
    temps: { title: 'Temperatures', main: ['ov-temps'], side: ['ov-camera'], icon: ICON.temps },
    quick: { title: 'Quick control', main: ['ov-quick'], side: ['ov-camera'], icon: ICON.quick },
    upkeep: { title: 'Maintenance', main: ['ov-upkeep'], icon: ICON.upkeep },
    totals: { title: 'Totals for this printer', main: ['ov-totals'], icon: ICON.totals },
    phone: { title: 'Use Deja Vu1 on your phone', main: ['ov-phone'], icon: ICON.phone },
    camera: { title: 'Camera', main: ['ov-camera'], icon: ICON.camera },
  };
  const CHIPS = [['temps', 'Temperatures'], ['quick', 'Quick control'], ['upkeep', 'Maintenance'], ['totals', 'Totals'], ['phone', 'Phone']];
  const svg = d => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  let root = null, deck = null;

  function build() {
    const panel = $('tab-overview');
    if (!panel || panel.dataset.deck) return;
    panel.dataset.deck = '1';
    root = document.createElement('div');
    root.className = 'ovd';
    root.id = 'ov-deck';
    root.innerHTML = `
      <div class="cp-hold" id="ov-hold" aria-hidden="true"></div>
      <div class="ovd-main" id="ovd-main"></div>
      <div class="ovd-side" id="ovd-side"></div>`;
    panel.prepend(root);
    const hold = $('ov-hold'), main = $('ovd-main'), side = $('ovd-side');
    const put = window.Panes && Panes.put ? Panes.put : (id, into) => { const el = $(id); if (el && into) into.append(el); };

    // The cards that carry no id of their own get one, so a sheet can hold them and a tour can point at them.
    const stats = panel.querySelector(':scope > .stats');
    if (stats) { stats.id = stats.id || 'ov-totals'; stats.dataset.deckCard = stats.id; }
    const pair = panel.querySelector(':scope > .pair-card');
    if (pair) pair.id = pair.id || 'ov-phone';

    put('ov-now', main);
    put('ov-camera', main);
    const chips = document.createElement('nav');
    chips.className = 'ovd-chips';
    chips.setAttribute('aria-label', 'More on Overview');
    chips.innerHTML = CHIPS.map(([n, label]) => `<button type="button" class="ovd-chip" data-open="${n}" aria-haspopup="dialog">${svg(ICON[n])}<span>${label}</span></button>`).join('');
    main.append(chips);

    put('attention', side);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'att-more';
    more.id = 'att-more';
    more.dataset.open = 'needs';
    more.setAttribute('aria-haspopup', 'dialog');
    more.hidden = true;
    const att = $('attention');
    const attHead = att && att.querySelector('.card-head');
    if (attHead) attHead.append(more);
    put('ov-printers', side);
    ['ov-temps', 'ov-quick', 'ov-upkeep'].forEach(id => put(id, hold));
    if (stats) hold.append(stats);
    if (pair) hold.append(pair);
    panel.querySelectorAll(':scope > .ov-grid').forEach(g => { if (!g.children.length) g.remove(); });

    deck = Deck.create({
      id: 'ov', root, sheets: SHEETS, hold,
      always: ['ov-now', 'ov-camera', 'ov-printers'],
      skip: (o, e) => o.id === 'ov-camera' && e.target.closest('button, a, input, select'),
    });
    ['ov-temps', 'ov-quick', 'ov-upkeep', 'ov-totals', 'ov-phone'].forEach(id => deck.remember(id, hold));
    deck.remember('attention', side);
    deck.remember('ov-printers', side);
    deck.remember('ov-camera', main);

    // The camera opens large from a real button in its head, and from a press on its picture (its own buttons keep working).
    const cam = $('ov-camera');
    if (cam) {
      cam.dataset.open = 'camera';
      const head = cam.querySelector('.card-head');
      if (head && !head.querySelector('.tile-more')) head.insertAdjacentHTML('beforeend', '<button type="button" class="tile-more btn small" data-open="camera" aria-haspopup="dialog">Open large</button>');
    }
    // "Show all" appears only when Needs you has more than the first three.
    const list = $('attention-list');
    const count = () => {
      const n = list ? list.children.length : 0;
      more.hidden = n <= 3;
      more.textContent = n > 3 ? `All ${n}` : '';
    };
    if (list) new MutationObserver(count).observe(list, { childList: true });
    count();
  }

  function init() {
    build();
    window.addEventListener('dv-tab', () => { if (document.body.dataset.tab !== 'overview' && deck && deck.isOpen()) deck.close(); });
  }
  window.OverviewDeck = { open: (n, f) => deck && deck.open(n, f), close: () => deck && deck.close(), isOpen: () => !!deck && deck.isOpen() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
