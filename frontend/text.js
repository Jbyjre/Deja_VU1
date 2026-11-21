/* text.js: text that does not fit.
 *
 * Two small jobs for the whole app, both done once here so no screen has to remember them:
 *
 *   1. Cut text can be read. When the pointer rests on, or the keyboard focuses, anything that ends in an ellipsis, its title becomes its full
 *      text (and goes again when the text fits). A title someone wrote is never replaced.
 *   2. A file name that is laid out to be cut is cut in the middle: the start gives way and the end, which is where the version and the extension
 *      are, stays. ("two_benchies_two_c…olours_v2.gcode".) The text stays one piece for a screen reader; the split is two spans (text.css `.mt`).
 *      The cut falls between words (_ - space) where one is near the end, as a name should not be cut inside an identifier.
 *
 * Screens that draw names do not call anything: a MutationObserver looks at what was added or changed, once a frame. */
(() => {
  const FILE = /\.(gcode|bgcode|3mf|stl|obj|ufp|step|stp|png|jpe?g|mp4|webm)$/i;
  const KEEP = 18;                                                   // the most of the name's end that is kept whole, extension included
  const SKIP = '#twin-model, .tester-ui, [data-no-mid], textarea, input, script, style';

  /* ---- 1. the full text on hover and focus ---- */
  const cutOf = el => {
    for (let e = el, i = 0; e && e !== document.body && i < 5; e = e.parentElement, i++) {
      const cs = getComputedStyle(e);
      if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) return e;
      if (cs.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 1) return e;
    }
    return null;
  };
  function fullText(target) {
    if (!target || target.nodeType !== 1) return;
    const stale = target.closest('[data-cut-title]');
    const cut = cutOf(target);
    if (cut) {
      const host = cut.classList.contains('mt-a') ? cut.parentElement : cut;
      if (!host.hasAttribute('title') || host.dataset.cutTitle) { host.title = host.textContent.replace(/\s+/g, ' ').trim(); host.dataset.cutTitle = '1'; }
    } else if (stale) {
      stale.removeAttribute('title');
      delete stale.dataset.cutTitle;
    }
  }
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'touch') fullText(e.target); }, true);
  document.addEventListener('focusin', e => fullText(e.target), true);

  /* ---- 2. file names are cut in the middle ---- */
  function split(text) {
    const ext = (FILE.exec(text) || [''])[0];
    const stem = text.slice(0, text.length - ext.length);
    // the longest end (at most KEEP characters, extension included) that starts at a word break
    let at = -1;
    for (let i = Math.max(1, stem.length - (KEEP - ext.length)); i < stem.length - 2; i++) if (/[_\-\s.]/.test(stem[i])) { at = i; break; }
    if (at < 1) at = Math.max(1, stem.length - Math.max(4, KEEP - ext.length - 4));      // no break near the end: a fixed tail
    return [text.slice(0, at), text.slice(at)];
  }
  function enhance(el) {
    if (el.nodeType !== 1 || el.classList.contains('mt') || el.classList.contains('mt-a') || el.classList.contains('mt-b')) return;
    if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) return;
    const text = el.firstChild.nodeValue.trim();
    if (text.length < 16 || !FILE.test(text)) return;
    if (getComputedStyle(el).textOverflow !== 'ellipsis') return;      // only names that are laid out to be cut
    const [a, b] = split(text);
    if (!a || !b) return;
    const sa = document.createElement('span'), sb = document.createElement('span');
    sa.className = 'mt-a'; sb.className = 'mt-b';
    sa.textContent = a; sb.textContent = b;
    el.textContent = '';
    el.classList.add('mt');
    el.append(sa, sb);
  }
  function scan(root) {
    if (!root || !root.isConnected || (root.closest && root.closest(SKIP))) return;
    enhance(root);
    if (root.querySelectorAll) root.querySelectorAll('*').forEach(enhance);
  }

  const pending = new Set();
  let scheduled = false;
  const options = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(n => pending.add(n.nodeType === 3 ? n.parentElement : n));
      else pending.add(r.target.parentElement);
    }
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  });
  function flush() {
    scheduled = false;
    const list = [...pending];
    pending.clear();
    observer.disconnect();                                           // what this file changes is not looked at again
    list.forEach(n => { if (n) scan(n); });
    observer.observe(document.body, options);
  }
  window.DVText = { scan, split };
  const start = () => { scan(document.body); observer.observe(document.body, options); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
