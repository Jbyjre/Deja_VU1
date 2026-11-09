/* layout.js: two-column card grids without gaps.
 *
 * A plain grid lays cards in rows, and a row is as tall as its tallest card. A short card beside a long one
 * either sits above a hole (the next card waits below its neighbour) or is stretched with blank space inside.
 * Here every card asks for the height it needs, counted in 1 px rows, and the grid puts the next card in
 * the column that is shorter. Cards stay in the order they are written: none moves above one before it.
 *
 * Grids that follow each other directly (Printer: Extrude and Tune, Fans and Bed mesh, ...) are joined into
 * one run, so the cards of the next grid fill the space under a short card instead of starting below the
 * tall one. The grids and their cards stay where they are in the page; only a wrapper, .flow-run, is added.
 * Hidden cards (another part of a screen) take no space. Without ResizeObserver the grids stay as plain rows.
 */
(function () {
  'use strict';
  var BOXES = '.flow-run, .grid-2, .desk-grid';
  if (!window.ResizeObserver || !window.MutationObserver) return;

  var attached = new WeakSet();
  var queued = new Set();
  var raf = 0;

  var inRun = function (el) { return !!el.parentElement && el.parentElement.classList.contains('flow-run'); };
  var isRun = function (el) { return el.classList.contains('flow-run'); };
  // The cards of a box: its children, or for a run the children of each grid in it.
  function cardsOf(box) {
    var out = [];
    Array.prototype.forEach.call(box.children, function (child) {
      if (isRun(box)) Array.prototype.forEach.call(child.children, function (c) { out.push(c); });
      else out.push(child);
    });
    return out;
  }
  var boxOf = function (el) {
    var p = el.parentElement;
    if (!p) return null;
    if (isRun(p)) return p;
    if (inRun(p)) return p.parentElement;
    return p.matches(BOXES) ? p : null;
  };

  function schedule(box) {
    if (box) queued.add(box);
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var list = Array.from(queued);
      queued.clear();
      list.forEach(place);
    });
  }
  function scheduleAll() { document.querySelectorAll(BOXES).forEach(function (b) { if (attached.has(b)) schedule(b); }); }

  function place(box) {
    if (!box.isConnected) return;
    var style = getComputedStyle(box);
    // The grid's own gap becomes part of each card's rows, so the spacing stays what the look chose.
    var gap = parseFloat(style.columnGap) || 0;
    if (box.dataset.flowMargin === undefined) box.dataset.flowMargin = String(parseFloat(style.marginBottom) || 0);
    box.style.rowGap = '0px';
    box.style.gridAutoRows = '1px';
    box.style.alignItems = 'start';
    box.style.gridAutoFlow = 'row';
    // The last cards carry one gap below them; the box's bottom margin gives it back.
    box.style.marginBottom = (parseFloat(box.dataset.flowMargin) - gap) + 'px';
    var shown = 0, last = null;
    cardsOf(box).forEach(function (card) {
      // offsetHeight ignores transforms, so a card fading in doesn't measure short.
      var height = card.offsetHeight;
      var edge = 0;
      if (height > 0) {
        var cs = getComputedStyle(card);
        edge = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
      var rows = height > 0 ? 'span ' + Math.ceil(height + edge + gap + 1) : '';
      if (card.style.gridRowEnd !== rows) card.style.gridRowEnd = rows;
      if (height > 0) { shown++; last = card; }
      if (isRun(box) && card.style.gridColumn) card.style.gridColumn = '';
    });
    // One card left in a run (the other parts of the screen are hidden) takes the whole width.
    if (isRun(box) && shown === 1) last.style.gridColumn = '1 / -1';
  }

  var sizes = new ResizeObserver(function (entries) {
    entries.forEach(function (entry) {
      var box = entry.target.matches(BOXES) && !inRun(entry.target) ? entry.target : boxOf(entry.target);
      if (box && attached.has(box)) schedule(box);
    });
  });
  var kids = new MutationObserver(function (records) {
    records.forEach(function (r) {
      var box = isRun(r.target) || !inRun(r.target) ? r.target : r.target.parentElement;
      if (!attached.has(box)) return;
      observeCards(box);
      schedule(box);
    });
  });
  function observeCards(box) { cardsOf(box).forEach(function (c) { sizes.observe(c); }); }

  function attach(box) {
    if (attached.has(box)) return;
    attached.add(box);
    sizes.observe(box);
    observeCards(box);
    kids.observe(box, { childList: true });
    if (isRun(box)) Array.prototype.forEach.call(box.children, function (g) { kids.observe(g, { childList: true }); });
    schedule(box);
  }

  // Grids that follow each other directly share one wrapper.
  function joinRuns() {
    document.querySelectorAll('.grid-2').forEach(function (grid) {
      if (inRun(grid)) return;
      var prev = grid.previousElementSibling;
      if (!prev || !prev.matches('.grid-2')) return;
      // `grid` follows a grid: start (or extend) the run at the first grid of this stretch.
      var first = prev;
      while (first.previousElementSibling && first.previousElementSibling.matches('.grid-2') && !inRun(first.previousElementSibling)) first = first.previousElementSibling;
      var run = document.createElement('div');
      run.className = 'flow-run';
      var members = [];
      for (var el = first; el && el.matches('.grid-2'); el = el.nextElementSibling) members.push(el);
      var margin = getComputedStyle(members[members.length - 1]).marginBottom;
      first.parentNode.insertBefore(run, first);
      members.forEach(function (g) {
        if (attached.has(g)) { g.removeAttribute('style'); Array.prototype.forEach.call(g.children, function (c) { c.style.gridRowEnd = ''; }); }
        run.appendChild(g);
      });
      run.dataset.flowMargin = String(parseFloat(margin) || 0);
    });
  }

  function scan() {
    joinRuns();
    document.querySelectorAll(BOXES).forEach(function (b) { if (!inRun(b)) attach(b); });
  }

  var pending = 0;
  new MutationObserver(function () {
    if (pending) return;
    pending = requestAnimationFrame(function () { pending = 0; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('resize', scheduleAll);
  ['dv-density', 'dv-ui', 'dv-theme', 'dv-section', 'dv-tab'].forEach(function (name) { window.addEventListener(name, scheduleAll); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleAll);
  scan();
})();
