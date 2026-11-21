#!/usr/bin/env node
/*
 * The text audit: every screen, at several widths, with very long names, looking for text that is cut, hidden, colliding or unreadable.
 *
 *   node tools/text-audit.js                 starts its own server, runs the audit and prints what it found (exit 1 when anything is found)
 *   node tools/text-audit.js --base URL      audits a server that is already running (demo data is switched on in the page)
 *   node tools/text-audit.js --probe         only says whether Playwright and a Chromium are available
 *   node tools/text-audit.js --plain         only the plain data, no very long names
 *   node tools/text-audit.js --only overview,printers   only those screens
 *   node tools/text-audit.js --focus         also tab through each screen and check that the focus is always visible
 *   node tools/text-audit.js --widths 1366,390 --dark --json FILE
 *
 * What it looks for, on each screen and with each sheet that opens from it:
 *   clipped    text cut off by its box with no ellipsis, so the end of it is simply gone
 *   outside    text that runs out of the panel, card or window that holds it
 *   collide    two pieces of text drawn over each other
 *   tight      two panels with less than 8 px between them, or lying over each other (overlap)
 *   uneven     two panels 8 to 48 px apart but not the usual 14 px
 *   flush      text touching the edge of the panel that holds it (the panel has lost its padding)
 *   stacked    text forced down one or two characters per line (a label squeezed into a column narrower than a word)
 *   mute       text cut with an ellipsis that gives no way to read it in full (no title, no accessible name; hovering is simulated first,
 *              because text.js fills the title in when the pointer rests on cut text)
 *   tiny       text smaller than 11 px
 *   wrap       a button or tag whose one-line label breaks onto a second line
 *   sideways   the page scrolls sideways
 *   hidden     a control or button-like label that a box above it cuts away (hidden or clip) or that sits beyond the window's edge, so it
 *              exists but cannot be seen or reached (text cut away whole is not 'clipped' text, so this is its own check)
 *   target     a control smaller than 24 px either way (WCAG 2.5.8)
 *   unnamed    a control with no accessible name
 *   focus      (with --focus) a keyboard stop with no visible focus ring, or hidden behind something
 *
 * "Very long names" means the server's answers are rewritten on their way to the page: every printer name, file name, task name, state line
 * and description gets a long tail (about 70 characters), a long unbroken word and, for files, the extension kept. The page only ever sees
 * the longer strings, so nothing in the product has to know it is being tested. The live WebSocket is blocked so the page polls over plain
 * HTTP, where the rewriting reaches it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const option = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

function findChromium(playwright) {
  const candidates = [process.env.DEJAVU_BROWSER, '/usr/bin/chromium', '/opt/pw-browsers/chromium', '/usr/bin/chromium-browser'];
  try { candidates.push(playwright.chromium.executablePath()); } catch (e) { /* no bundled browser */ }
  return candidates.find(p => p && fs.existsSync(p)) || null;
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});
const get = url => new Promise((resolve, reject) => { http.get(url, r => { r.resume(); resolve(r.statusCode); }).on('error', reject); });

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-textaudit-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1', DEJAVU_TESTER: '0' };
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { if ((await get(base + '/api/health')) === 200) return { base, child }; } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

/* ---- the long names ----------------------------------------------------------------------------------------------------------- */
const LONG_KEYS = new Set(['name', 'printer_name', 'current_file', 'filename', 'file', 'title', 'text', 'description', 'state_message', 'filament_material', 'reason']);
const TAIL = ' with a very long name that goes on and on_and_on_and_on_and_on_and_on_and_on_x7';
function lengthen(key, value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 90 || /^#|^\d|^https?:|^[a-f0-9-]{20,}$/.test(value)) return value;
  const dot = /\.(gcode|3mf|stl|obj|ufp|bgcode)$/i.exec(value);
  if (dot) return value.slice(0, dot.index) + '_very_long_file_name_that_keeps_going_and_going_and_going_for_the_audit_v12_final_copy' + dot[0];
  return value + TAIL;
}
function rewrite(node, key) {
  if (Array.isArray(node)) return node.map(v => rewrite(v, key));
  if (node && typeof node === 'object') { const o = {}; for (const k of Object.keys(node)) o[k] = rewrite(node[k], k); return o; }
  return LONG_KEYS.has(key) ? lengthen(key, node) : node;
}

/* ---- what is looked for, run inside the page ------------------------------------------------------------------------------------ */
function inspectPage() {
  const issues = [];
  const MAX_PER_KIND = 40;
  const counts = {};
  const add = (kind, el, detail, text) => {
    counts[kind] = (counts[kind] || 0) + 1;
    if (counts[kind] > MAX_PER_KIND) return;
    const name = e => (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const chain = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) chain.push(name(e));
    issues.push({ kind, at: chain.join(' < '), detail, text: (text || '').replace(/\s+/g, ' ').trim().slice(0, 70) });
  };
  const visible = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true' && e.classList.contains('cp-hold')) return false;
      if (e.id === 'cp-hold' || e.id === 'ov-hold' || e.classList.contains('cp-hold') || e.classList.contains('tester-ui')) return false;
      if (+cs.opacity === 0) return false;
      // inside a closed <details> only its <summary> is on show
      if (e.tagName === 'DETAILS' && !e.open && !(el.closest('summary') && e.contains(el.closest('summary')))) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'OPTION', 'SELECT', 'TEXTAREA', 'INPUT', 'CANVAS', 'NOSCRIPT', 'TITLE', 'HEAD']);
  // While a sheet, a dialog or the command bar is open, only it is looked at: the page behind is dimmed and out of reach.
  const layers = [...document.querySelectorAll('.cp-sheet:not([hidden]), dialog[open], .feature-finder:focus-within')].filter(e => getComputedStyle(e).display !== 'none');
  const scope = layers.length ? layers[layers.length - 1] : null;
  const leaves = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue;
    const el = n.parentElement;
    if (!el || !text.trim() || SKIP.has(el.tagName) || el.closest('svg, #intro, .twin3d-canvas, .sr-only, [data-audit-skip]')) continue;
    if (scope && !scope.contains(el)) continue;
    if (!visible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    // what can be seen of each line: cut by every box above it that clips (hidden, clip, auto, scroll)
    const clips = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clips.push(e.getBoundingClientRect()); }
    const rects = [];
    for (const q of range.getClientRects()) {
      if (q.width < 0.5 || q.height < 0.5) continue;
      let l = q.left, t = q.top, rr = q.right, bb = q.bottom;
      for (const c of clips) { l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); bb = Math.min(bb, c.bottom); }
      if (rr - l > 0.5 && bb - t > 0.5) rects.push({ left: l, top: t, right: rr, bottom: bb, width: rr - l, height: bb - t });
    }
    if (!rects.length) continue;
    const full = range.getBoundingClientRect();
    const r = { left: Math.min(...rects.map(q => q.left)), top: Math.min(...rects.map(q => q.top)), right: Math.max(...rects.map(q => q.right)), bottom: Math.max(...rects.map(q => q.bottom)) };
    // covered by another layer (a toast, a menu): not on show, so not a collision
    const q0 = rects[0], at = document.elementFromPoint((q0.left + q0.right) / 2, (q0.top + q0.bottom) / 2);
    const covered = !!at && !(el.contains(at) || at.contains(el));
    // a bar that floats over the page (position fixed or sticky) is an overlay, not part of the layout
    let floats = false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const ps = getComputedStyle(e).position; if (ps === 'fixed' || ps === 'sticky' || e.id === 'rail') { floats = true; break; } }
    leaves.push({ n, el, text: text.trim(), r, rects, full, covered, floats });
  }
  const vw = innerWidth, vh = innerHeight;
  // The nearest box that cuts what overflows it (the element itself counts), and whether a scroll bar or an ellipsis makes that fine.
  const clipOf = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.overflowX !== 'visible') return { e, cs }; } return null; };
  const scrollsSideways = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (['auto', 'scroll'].includes(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) { const b = e.getBoundingClientRect(); return b.left >= -1 && b.right <= vw + 1; } } return false; };
  const titled = el => !!(el.getAttribute('title') || el.getAttribute('aria-label') || (el.closest('[title]') && el.closest('[title]').getAttribute('title')) || (el.closest('[aria-label]') && el.closest('[aria-label]').getAttribute('aria-label')));
  for (const L of leaves) {
    const { el, full: r } = L;
    const cs = getComputedStyle(el);
    // tiny
    if (parseFloat(cs.fontSize) < 11 && !el.closest('.t3-tag, kbd, .fx-hint')) add('tiny', el, `${cs.fontSize}`, L.text);
    const clip = clipOf(el);
    if (clip) {
      const { e: C, cs: ccs } = clip, b = C.getBoundingClientRect();
      const cut = C.scrollWidth > C.clientWidth + 1 && ['hidden', 'clip'].includes(ccs.overflowX);
      if (cut && ccs.textOverflow === 'ellipsis') {
        if (!titled(C) && !titled(el)) add('mute', C, `cut by an ellipsis (${C.clientWidth}px of ${C.scrollWidth}px)`, L.text);
      } else if (cut && C === el) {
        add('clipped', el, `box ${el.clientWidth}px, text ${el.scrollWidth}px, overflow ${cs.overflowX}`, L.text);
      } else if (!['auto', 'scroll'].includes(ccs.overflowX) && (r.right > b.right + 1.5 || r.left < b.left - 1.5) && !el.closest('.cp-dock, .pb-parts, .set-groups, .rail-scroll')) {
        add('outside', el, `text ${Math.round(r.left)}–${Math.round(r.right)}, box ${Math.round(b.left)}–${Math.round(b.right)} (${C.tagName.toLowerCase()}${C.id ? '#' + C.id : ''})`, L.text);
      }
      if (b.right > vw + 1.5 && !scrollsSideways(C)) add('outside', C, `box ${Math.round(b.left)}–${Math.round(b.right)} in a ${vw}px window`, L.text);
    } else if ((r.right > vw + 1.5 || r.left < -1.5) && !scrollsSideways(el)) add('outside', el, `text ${Math.round(r.left)}–${Math.round(r.right)} in a ${vw}px window`, L.text);
    const clampedY = cs.webkitLineClamp === 'none' && ['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && cs.display !== 'inline';
    if (clampedY) add('clipped', el, `box ${el.clientHeight}px high, text ${el.scrollHeight}px, overflow-y ${cs.overflowY}`, L.text);
    // a short-label control whose one-line label breaks onto a second line
    const host = el.closest('.btn, .badge, .pill, .chip, .t3-tag, .dk-btn, .pb-part, .rail-item, .pill-toggle button, .seg button, [role="tab"]');
    if (host && L.rects.length > 1) {
      const lines = new Set(L.rects.map(q => Math.round(q.top / 4))).size;
      // a full-size button may carry its long label on two lines; a compact control never does
      const compact = !host.matches('.btn:not(.small)');
      if (lines > (compact ? 1 : 2)) add('wrap', host, `${lines} lines`, L.text);
    }
    // text touching the edge of the panel that holds it: the panel has lost its padding (a chip, button or table cell between them carries its own)
    const surface = el.closest('.card, .fleet-card, .notice, .stats, .pane, .pane-block');
    if (surface) {
      let own = false;
      for (let e = el; e && e !== surface; e = e.parentElement) {
        const q = getComputedStyle(e);
        if (!/rgba?\(0, 0, 0, 0\)|, 0\)$/.test(q.backgroundColor) || (parseFloat(q.borderTopWidth) > 0 && q.borderTopStyle !== 'none') || (parseFloat(q.borderLeftWidth) > 0 && q.borderLeftStyle !== 'none') || e.matches('button, a.btn, label.btn, input, select, th, td, summary, .pill, .badge, .chip, .tag')) { own = true; break; }
      }
      const sb = surface.getBoundingClientRect(), sq = getComputedStyle(surface);
      const drawn = !/rgba?\(0, 0, 0, 0\)|, 0\)$/.test(sq.backgroundColor) || sq.boxShadow !== 'none' || parseFloat(sq.borderTopWidth) > 0;   // a card that only holds other panels draws nothing
      const v = L.r;
      if (!own && drawn && sb.width > 140 && sb.height > 30 && (v.left - sb.left < 6 || sb.right - v.right < 6)) add('flush', el, `text ${Math.round(v.left - sb.left)} px from the left edge and ${Math.round(sb.right - v.right)} px from the right edge of its panel`, L.text);
    }
    // text broken into slivers: three or more lines that hold only a few characters each (a word forced down one character per line)
    if (L.rects.length > 2) {
      const lineCount = new Set(L.rects.map(q => Math.round(q.top / 4))).size;
      const chars = L.text.replace(/\s+/g, ' ').trim().length;
      if (lineCount >= 3 && chars / lineCount < 3.2) add('stacked', el, `${lineCount} lines for ${chars} characters`, L.text);
    }
  }
  // two pieces of text on top of each other
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i];
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || a.covered || b.covered || a.floats !== b.floats) continue;
      if (parseFloat(getComputedStyle(a.el).fontSize) > 36 || parseFloat(getComputedStyle(b.el).fontSize) > 36) continue;   // a big numeral's font box is taller than its drawn glyphs
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x < 3 || y < 4) continue;
      // exact line boxes, not the union, so a short word beside a tall block is not a collision
      let hit = false;
      for (const p of a.rects) { for (const q of b.rects) { const xx = Math.min(p.right, q.right) - Math.max(p.left, q.left), yy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top); if (xx > 3 && yy > Math.max(4, 0.35 * Math.min(p.height, q.height))) { hit = true; break; } } if (hit) break; }
      if (hit) add('collide', a.el, `"${b.text.slice(0, 28)}" in ${(b.el.tagName || '').toLowerCase()}${typeof b.el.className === 'string' && b.el.className ? '.' + b.el.className.split(/\s+/)[0] : ''}`, a.text);
    }
  }
  // panels that touch or nearly touch (a gap under 8 px reads as a mistake: panels are 14 px apart) or lie over each other
  {
    const panels = [...document.querySelectorAll('.card, .fleet-card, .notice, .stats, .pane-block')]
      .filter(e => visible(e) && (!scope || scope.contains(e)) && !e.closest('#intro, .tester-ui, [data-audit-skip], .cp-hold') && !e.parentElement.closest('.card, .fleet-card, .notice, .stats, .pane-block'))
      .filter(e => { const q = getComputedStyle(e); return (!/rgba?\(0, 0, 0, 0\)|, 0\)$/.test(q.backgroundColor) || q.boxShadow !== 'none') && getComputedStyle(e).position !== 'fixed' && getComputedStyle(e).position !== 'sticky'; })
      .map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 80 && x.r.height > 30);
    const nextVisible = e => { let n = e.nextElementSibling; while (n && (getComputedStyle(n).display === 'none' || n.getBoundingClientRect().height === 0)) n = n.nextElementSibling; return n; };
    const stacked = (a, b) => {
      if (/grid/.test(getComputedStyle(a.parentElement).display)) return false;
      const n = nextVisible(a);
      return !!n && (n === b || n.contains(b) && n.querySelector('.card, .fleet-card, .notice, .stats, .pane-block') === b);
    };
    const name = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''}`;
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i], b = panels[j];
      if (a.e.contains(b.e) || b.e.contains(a.e) || (a.e.closest('.cp-sheet') && b.e.closest('.cp-sheet'))) continue;      // a sheet spaces its own panels
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 3 && oy > 3) { add('overlap', a.e, `${Math.round(ox)}×${Math.round(oy)} px over ${name(b.e)}`, ''); continue; }
      const gapY = -oy, gapX = -ox;
      if (ox > 40 && gapY > -0.5 && gapY < 8) add('tight', a.e, `${Math.round(gapY)} px above ${name(b.e)} (in ${name(a.e.parentElement)}; margins ${getComputedStyle(a.e).marginBottom} / ${getComputedStyle(b.e).marginTop})`, '');
      else if (oy > 40 && gapX > -0.5 && gapX < 8) add('tight', a.e, `${Math.round(gapX)} px beside ${name(b.e)}`, '');
      else if (ox > 40 && gapY >= 8 && gapY < 48 && (gapY < 13 || gapY > 16) && stacked(a.e, b.e)) add('uneven', a.e, `${Math.round(gapY)} px above ${name(b.e)} (in ${name(a.e.parentElement)}; margins ${getComputedStyle(a.e).marginBottom} / ${getComputedStyle(b.e).marginTop}; panels are 14 px apart)`, '');
      else if (oy > 40 && gapX >= 8 && gapX < 48 && (gapX < 13 || gapX > 16)) add('uneven', a.e, `${Math.round(gapX)} px beside ${name(b.e)} (in ${name(a.e.parentElement)}; margins ${getComputedStyle(a.e).marginBottom} / ${getComputedStyle(b.e).marginTop}; panels are 14 px apart)`, '');
    }
  }
  // controls: big enough to hit (WCAG 2.5.8 asks for 24 px), and named for a screen reader
  const controls = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], summary')]
    .filter(c => visible(c) && (!scope || scope.contains(c)) && !c.closest('#intro, .tester-ui, [data-audit-skip]'));
  // How much of a control can be seen: the box above it that clips (overflow hidden or clip) and the window's edge cut it. A box that
  // scrolls (auto, scroll) only defers a control, so it does not count; an absolutely positioned control is clipped only by a positioned box.
  const shareInView = c => {
    const b = c.getBoundingClientRect();
    let l = b.left, t = b.top, r = b.right, bt = b.bottom;
    let needPositioned = false;
    let by = null;                                                   // the box that does the cutting (a box collapsed to nothing is a section that is shut)
    for (let e = c; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (e !== c && (!needPositioned || cs.position !== 'static')) {
        // a box that scrolls can bring the control into its own window, so by then the control counts as inside it
        const sx = ['auto', 'scroll'].includes(cs.overflowX) && e.scrollWidth > e.clientWidth + 1, sy = ['auto', 'scroll'].includes(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
        if (sx || sy) {
          const sb = e.getBoundingClientRect();
          if (sx) { const w = r - l; l = Math.min(Math.max(l, sb.left), Math.max(sb.left, sb.right - Math.min(w, sb.width))); r = l + w; }
          if (sy) { const h = bt - t; t = Math.min(Math.max(t, sb.top), Math.max(sb.top, sb.bottom - Math.min(h, sb.height))); bt = t + h; }
        }
        const cx = ['hidden', 'clip'].includes(cs.overflowX), cy = ['hidden', 'clip'].includes(cs.overflowY);
        if (cx || cy) {
          const eb = e.getBoundingClientRect();
          if (!by && ((cx && (eb.left > l + 1 || eb.right < r - 1)) || (cy && (eb.top > t + 1 || eb.bottom < bt - 1)))) by = e;
          if (cx) { l = Math.max(l, eb.left); r = Math.min(r, eb.right); }
          if (cy) { t = Math.max(t, eb.top); bt = Math.min(bt, eb.bottom); }
        }
        if (cs.position !== 'static') needPositioned = false;
      }
      if (cs.position === 'fixed') break;
      if (cs.position === 'absolute') needPositioned = true;
    }
    if (!scrollsSideways(c)) { l = Math.max(l, 0); r = Math.min(r, vw); }
    const area = b.width * b.height;
    const collapsed = by && (by.getBoundingClientRect().height < 8 || by.getBoundingClientRect().width < 8);
    return { share: area && !collapsed ? Math.max(0, r - l) * Math.max(0, bt - t) / area : 1, by };
  };
  const reach = [...new Set([...controls, ...document.querySelectorAll('label.btn, .btn')])]
    .filter(c => visible(c) && (!scope || scope.contains(c)) && !c.closest('#intro, .tester-ui, [data-audit-skip], .sr-only'));
  for (const c of reach) {
    const { share, by } = shareInView(c);
    if (share < 0.5) {
      const bb = by && by.getBoundingClientRect();
      add('hidden', c, `${Math.round(share * 100)}% of the control can be seen${by ? `, cut by ${by.tagName.toLowerCase()}${by.id ? '#' + by.id : ''}${typeof by.className === 'string' && by.className ? '.' + by.className.trim().split(/\s+/)[0] : ''} (${Math.round(bb.width)}×${Math.round(bb.height)})` : ' at the window edge'}`, c.textContent || c.getAttribute('aria-label') || '');
    }
  }
  const nameOf = c => {
    const t = [c.getAttribute('aria-label'), c.getAttribute('title'), c.getAttribute('alt')].find(x => x && x.trim());
    if (t) return t;
    const by = c.getAttribute('aria-labelledby');
    if (by && by.split(/\s+/).some(id => { const e = document.getElementById(id); return e && e.textContent.trim(); })) return 'x';
    if ((c.textContent || '').trim()) return c.textContent.trim();
    if (c.querySelector('img[alt]:not([alt=""]), svg title')) return 'x';
    if (c.id && document.querySelector(`label[for="${c.id}"]`)) return 'x';
    if (c.closest('label') && c.closest('label').textContent.trim()) return 'x';
    if (c.value && ['button', 'submit'].includes(c.type)) return c.value;
    return '';
  };
  for (const c of controls) {
    const b = c.getBoundingClientRect();
    const inline = c.tagName === 'A' && getComputedStyle(c).display === 'inline';
    const box = c.type === 'checkbox' || c.type === 'radio';
    if (!inline && (b.width < 24 || b.height < 24) && !(box && c.closest('label') && c.closest('label').getBoundingClientRect().height >= 24)) add('target', c, `${Math.round(b.width)}×${Math.round(b.height)} px`, c.textContent || c.getAttribute('aria-label') || '');
    if (!nameOf(c)) add('unnamed', c, 'no accessible name', '');
  }
  if (document.documentElement.scrollWidth > vw + 1) add('sideways', document.documentElement, `page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`, '');
  return { issues, counts, texts: leaves.length };
}

/* ---- the screens ----------------------------------------------------------------------------------------------------------------- */
const PLACES = ['overview', 'printer', 'readings', 'camera', 'history', 'printers', 'desk', 'slice', 'layers', 'files', 'queue', 'models', 'ai', 'maintenance', 'filament', 'settings', 'automations', 'studio'];

async function prepare(browser, base, width, height, dark, stress) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700, isMobile: width < 700 });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(d => {
    try { localStorage.setItem('dejavu1.pref.theme', d ? 'dark' : 'light'); localStorage.setItem('dejavu1.setup.done', '1'); } catch (e) { /* blocked */ }
    window.WebSocket = class { constructor() { throw new Error('WebSocket is off for this audit'); } };
  }, dark);
  if (stress) {
    await context.route('**/api/**', async route => {
      try {
        const response = await route.fetch();
        const type = response.headers()['content-type'] || '';
        if (!/json/.test(type)) return route.fulfill({ response });
        const body = await response.json();
        return route.fulfill({ response, json: rewrite(body, '') });
      } catch (e) { return route.continue(); }
    });
  }
  await page.goto(base + '/#/overview');
  await page.waitForTimeout(1200);
  const skip = await page.$('text=Skip setup');
  if (skip && (await skip.isVisible())) { await skip.click(); await page.waitForTimeout(400); }
  await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); } });
  await page.waitForTimeout(3200);
  return { context, page };
}

// What opens from a screen: its sheets and, in Settings, each group.
async function variants(page, place) {
  if (place === 'printer') return ['', ...(await page.evaluate(() => (window.Cockpit ? Cockpit.sheets() : [])))].map(s => s ? { label: `sheet ${s}`, run: x => x.evaluate(n => Cockpit.open(n), s) } : { label: '' });
  if (place === 'overview') return ['', 'needs', 'printers', 'temps', 'quick', 'upkeep', 'totals', 'phone', 'camera'].map(s => s ? { label: `sheet ${s}`, run: x => x.evaluate(n => OverviewDeck.open(n), s) } : { label: '' });
  if (place === 'settings') {
    const groups = await page.evaluate(() => [...document.querySelectorAll('#tab-modules .set-groups button')].map(b => b.textContent.trim()));
    return groups.map((g, i) => ({ label: `group ${g}`, run: x => x.evaluate(k => document.querySelectorAll('#tab-modules .set-groups button')[k].click(), i) }));
  }
  return [{ label: '' }];
}

async function hoverCut(page) {
  // The page's own rule: text that is cut shows its full text when the pointer rests on it. Do what a pointer does, then inspect.
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
  });
}

// Tab through a screen: every stop must show where the focus is, and must not be hidden behind something else.
async function focusWalk(page, place, width, dark, out) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.keyboard.press('Shift');
  const seen = new Set();
  for (let i = 0; i < 28; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(350);                                   // a scroll that brings the control clear of the floating dock takes a moment
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e), b = e.getBoundingClientRect();
      const fin = e.closest('.feature-finder');
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') || (!!fin && getComputedStyle(fin).outlineStyle !== 'none');
      const cx = Math.min(innerWidth - 1, Math.max(0, b.left + b.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, b.top + b.height / 2));
      const top = document.elementFromPoint(cx, cy);
      const name = (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      // (a message bubble over a control is a passing overlay, not a hidden control)
      const sameLabel = !!top && !!e.closest('label') && e.closest('label') === top.closest('label');
      const skip = ['checkbox', 'radio'].includes(e.type) || e.classList.contains('sr-only') || sameLabel;   // a switch draws its own focus on the label
      const tall = b.height > innerHeight * 0.9 || e.tagName === 'CANVAS';      // a tall container's middle may sit under a fixed bar; a canvas has readings laid over it by design
      const by = top ? (top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + '.' + String(top.className).slice(0, 30)) : '';
      return { by, skip, name, ring, covered: !tall && !!top && !(e.contains(top) || top.contains(e)) && !e.closest('#rail') && !top.closest('#rail, .orb-stack'), inView: b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth, text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40), inRail: !!e.closest('#rail') };
    });
    if (!r || seen.has(r.name + r.text) || r.skip) continue;
    seen.add(r.name + r.text);
    if (!r.ring && !r.inRail) out.push({ kind: 'focus', screen: place, width, dark, at: r.name, detail: 'no visible focus ring', text: r.text });
    else if (r.covered && r.inView) out.push({ kind: 'focus', screen: place, width, dark, at: r.name, detail: 'focused but covered by ' + r.by, text: r.text });
  }
}

async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch (e) { console.error('Playwright is not installed here.'); process.exit(2); }
  const exe = findChromium(playwright);
  if (!exe) { console.error('No Chromium found. Set DEJAVU_BROWSER to the file.'); process.exit(2); }
  if (flag('--probe')) { console.log('Playwright and a Chromium are available: ' + exe); process.exit(0); }
  const widths = (option('--widths') || '1366,1024,390').split(',').map(Number);
  const themes = flag('--dark') ? [false, true] : [false];
  const stress = !flag('--plain');
  const own = option('--base') ? null : await startServer();
  const base = option('--base') || own.base;
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const all = [];
  let screens = 0;
  try {
    for (const dark of themes) {
      for (const width of widths) {
        const height = width < 700 ? 844 : width < 1100 ? 760 : 800;
        const { context, page } = await prepare(browser, base, width, height, dark, stress);
        for (const place of PLACES.filter(pl => !option('--only') || option('--only').split(',').includes(pl))) {
          await page.evaluate(x => { location.hash = '#/' + x; }, place);
          await page.waitForTimeout(900);
          const vs = await variants(page, place);
          for (const v of vs) {
            if (v.run) { await v.run(page); await page.waitForTimeout(700); }
            await hoverCut(page);
            const res = await page.evaluate(inspectPage);
            if (flag('--focus') && !v.label) await focusWalk(page, place, width, dark, all);
            screens++;
            for (const i of res.issues) all.push({ ...i, screen: `${place}${v.label ? ' / ' + v.label : ''}`, width, dark });
            if (v.run) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
          }
        }
        if (page.errors.length) all.push({ kind: 'script', screen: 'page', width, dark, at: '', detail: page.errors.slice(0, 2).join(' | '), text: '' });
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (own) own.child.kill();
  }
  const byKind = {};
  all.forEach(i => { (byKind[i.kind] = byKind[i.kind] || []).push(i); });
  const order = ['script', 'sideways', 'clipped', 'outside', 'hidden', 'collide', 'stacked', 'flush', 'overlap', 'tight', 'uneven', 'wrap', 'mute', 'tiny', 'target', 'unnamed', 'focus'];
  console.log(`Text audit: ${screens} screens (${widths.join(', ')} px${themes.length > 1 ? ', light and dark' : ''}${stress ? ', very long names' : ', plain data'}); ${all.length} finding${all.length === 1 ? '' : 's'}.`);
  for (const k of order) {
    const list = byKind[k] || [];
    if (!list.length) continue;
    console.log(`\n## ${k}: ${list.length}`);
    // one entry per distinct cause: the element's own selector, with what was seen and where
    const groups = new Map();
    for (const i of list) {
      const leaf = i.at.split(' < ')[0];
      const key = `${leaf}|${i.detail.replace(/\d+/g, 'N').replace(/"[^"]*"/g, '"…"')}`;
      const g = groups.get(key) || { i, leaf, n: 0, screens: new Set() };
      g.n++;
      g.screens.add(`${i.screen}@${i.width}${i.dark ? 'd' : ''}`);
      groups.set(key, g);
    }
    [...groups.values()].slice(0, 70).forEach(({ i, leaf, n, screens: sc }) => console.log(`- ${leaf}  (${i.at.split(' < ').slice(1).join(' < ')})\n    ${i.detail}${i.text ? `  «${i.text.slice(0, 50)}»` : ''}  ×${n}\n    ${[...sc].slice(0, 4).join(', ')}${sc.size > 4 ? ` +${sc.size - 4}` : ''}`));
  }
  const file = option('--json');
  if (file) fs.writeFileSync(file, JSON.stringify(all, null, 1));
  process.exit(all.length ? 1 : 0);
}
main().catch(e => { console.error(e && e.stack || e); process.exit(2); });
