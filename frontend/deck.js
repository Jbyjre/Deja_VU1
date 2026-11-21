/* deck.js: sheets that open from tiles, for the Printer screen (cockpit.js) and Overview (overview.js).
 *
 * A screen made of glance tiles keeps its deep controls in cards that already exist. A deck moves those cards, never rebuilds them: a moved
 * node keeps its id, its listeners and whatever draws into it, so nothing that reads a card by id changes. Cards that are not on show wait in
 * a holder that is laid out at a real size but invisible, so a chart or a field inside is drawn properly. Pressing anything with data-open="name"
 * inside the screen opens that sheet: it grows out of what was pressed, holds the cards it is defined with (main) and brings others in beside
 * them (side), so a sheet can be made smart: Move, for instance, docks the 3D printer and the camera next to the pad.
 *
 * Everything a sheet took goes back where it lived when it closes (Escape, the close button, the dim area). Focus stays inside an open sheet and
 * returns to what opened it. Nothing about a sheet is remembered between visits: a sheet is a pop-up, not a place.
 */
window.Deck = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const decks = [];
  const ICONS = {
    close: 'M6 6l12 12M18 6L6 18',
  };
  const icon = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 18}" height="${size || 18}" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

  function create(cfg) {
    const { root, sheets, hold } = cfg;
    const $ = id => document.getElementById(id);
    const uid = cfg.id || 'dk';
    const homes = new Map();           // card id -> { parent } where it lives when no sheet has it
    let openName = '', opener = null;

    const sheet = document.createElement('div');
    sheet.className = 'cp-sheet';
    sheet.id = `${uid}-sheet`;
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', `${uid}-sheet-title`);
    sheet.innerHTML = `<header class="cp-sheet-head"><span class="cp-sheet-ico" aria-hidden="true"></span><h2 id="${uid}-sheet-title"></h2>
      <button type="button" class="cp-x" aria-label="Close">${icon(ICONS.close)}</button></header>
      <div class="cp-sheet-body"><div class="cp-main"></div><div class="cp-side"></div></div>`;
    const scrim = document.createElement('div');
    scrim.className = 'cp-scrim';
    scrim.hidden = true;
    root.append(sheet, scrim);
    const titleEl = sheet.querySelector('h2'), icoEl = sheet.querySelector('.cp-sheet-ico'), mainEl = sheet.querySelector('.cp-main'),
      sideEl = sheet.querySelector('.cp-side'), xBtn = sheet.querySelector('.cp-x');

    // Which sheet a card belongs to: the first that lists it as main content.
    const homeSheet = {};
    Object.entries(sheets).forEach(([name, s]) => s.main.forEach(id => { if (!homeSheet[id]) homeSheet[id] = name; }));

    function remember(id, parent) {
      const el = $(id);
      if (el) homes.set(id, { parent: parent || el.parentElement });
    }
    const homeOf = id => { const h = homes.get(id); return h && h.parent && h.parent.isConnected ? h.parent : hold; };

    function release() {
      [...mainEl.children, ...sideEl.children].forEach(el => homeOf(el.id).append(el));
    }
    function open(name, from) {
      const def = sheets[name];
      if (!def) return;
      if (!sheet.hidden) release();
      openName = name;
      opener = from || document.activeElement;
      root.dataset.sheet = name;
      titleEl.textContent = def.title;
      icoEl.innerHTML = def.icon ? icon(def.icon) : '';
      def.main.forEach(id => { const el = $(id); if (el) mainEl.append(el); });
      const wants = (def.side || []).filter(id => $(id));
      wants.forEach(id => sideEl.append($(id)));
      sheet.classList.toggle('has-side', wants.length > 0);
      sheet.dataset.name = name;
      sheet.hidden = false;
      scrim.hidden = false;
      root.classList.add('has-sheet');
      if (cfg.onOpen) cfg.onOpen(name);
      window.dispatchEvent(new Event('resize'));                // the twin and the camera follow their new places
      animateOpen(from);
      xBtn.focus({ preventScroll: true });
    }
    function animateOpen(from) {
      if (reduced.matches || !sheet.animate) return;
      const r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
      const s = sheet.getBoundingClientRect();
      if (!r || !r.width || !s.width) { sheet.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' }); return; }
      // The sheet grows out of what opened it: its clip starts at that box and opens to the whole sheet, so nothing inside is stretched.
      const t = Math.max(0, r.top - s.top), l = Math.max(0, r.left - s.left), rr = Math.max(0, s.right - r.right), b = Math.max(0, s.bottom - r.bottom);
      sheet.animate([
        { clipPath: `inset(${t}px ${rr}px ${b}px ${l}px round 14px)`, opacity: 0.2 },
        { clipPath: 'inset(0 0 0 0 round 18px)', opacity: 1 },
      ], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    function close() {
      if (!openName) return;
      openName = '';
      const finish = () => {
        if (openName) return;                      // a sheet opened again in the meantime keeps what it has
        sheet.hidden = true;
        scrim.hidden = true;
        release();
        root.classList.remove('has-sheet');
        delete root.dataset.sheet;
        if (cfg.onClose) cfg.onClose();
        window.dispatchEvent(new Event('resize'));
        const back = opener && opener.isConnected ? opener : null;
        if (back && back.focus) back.focus({ preventScroll: true });
        opener = null;
      };
      if (reduced.matches || !sheet.animate) { finish(); return; }
      let done = false;
      const once = () => { if (!done) { done = true; finish(); } };
      sheet.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.985)' }], { duration: 140, easing: 'ease-in' }).onfinish = once;
      setTimeout(once, 220);
    }
    const isOpen = () => !!openName;
    const current = () => openName;

    /* A card somebody points at (a tour, the search, a "Print a file…" button) opens the sheet that holds it. */
    function unfold(el) {
      if (!el || !el.closest || !root.isConnected) return false;
      const card = el.closest('.card[id], [data-deck-card]');
      const id = card && (card.id || card.dataset.deckCard);
      if (!id || !homeSheet[id] || !root.contains(card) || (cfg.always && cfg.always.includes(id))) return false;
      if (openName && sheet.contains(card)) return false;
      open(homeSheet[id]);
      return true;
    }

    root.addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (!o || !root.contains(o) || sheet.contains(o)) return;
      if (o.dataset.openOnly === 'plain' && e.target.closest('button, a, input, select')) return;
      if (cfg.skip && cfg.skip(o, e)) return;
      open(o.dataset.open, o);
    });
    xBtn.addEventListener('click', () => close());
    scrim.addEventListener('click', () => close());
    document.addEventListener('keydown', e => {
      if (!openName) return;
      if (e.key === 'Escape') {
        if (document.querySelector('.guide:not([hidden])')) return;
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        const items = [...sheet.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
          .filter(el => !el.disabled && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    const deck = { open, close, isOpen, current, unfold, remember, release, sheet, root };
    decks.push(deck);
    return deck;
  }

  /* Whichever deck holds the card pointed at opens its sheet. */
  const unfold = el => decks.some(d => d.unfold(el));
  const anyOpen = () => decks.some(d => d.isOpen());
  const closeAll = () => decks.forEach(d => d.close());
  return { create, unfold, anyOpen, closeAll, icon };
})();
