/* i18n.js: the dashboard's words in the language a person chose.
 *
 * The English words stay where they are, in the page and the scripts. frontend/strings/en.json lists every one of them under a short
 * key (tools/i18n.py makes the list from the page files), and frontend/strings/<code>.json holds the same keys translated. This file
 * reads both and puts the translation where the English text appears:
 *
 *   - every piece of text and every title, placeholder, aria-label, alt and data-tip on the page, when it appears and whenever it changes
 *     (a MutationObserver, so no screen has to call anything);
 *   - a sentence made of pieces ("Couldn't change ${name}: ${why}", listed as "Couldn't change {0}: {1}") is matched as a pattern and
 *     the pieces are put into the translated sentence;
 *   - alert, confirm and prompt;
 *   - I18n.t('Saved {name}', { name }) for words that never reach the page as one text node.
 *
 * English is the original and costs nothing: with English chosen nothing is fetched and nothing watches the page. A text with no
 * translation shows in English. Pieces of code (pre, code, kbd, textarea) and anything marked translate="no" or data-no-i18n are left alone.
 *
 * Choosing a language (Settings, Appearance) saves it in this browser (dejavu1.lang) and reloads the page, so every screen starts again
 * in it. ?lang=de uses a language for that visit and saves it; ?lang=pseudo shows every catalogued text accented and about a quarter longer
 * (nothing is saved), which is how text that is not in the catalogue and text that does not fit are found. ?i18n=debug also lists the
 * text that was seen and not found: I18n.misses().
 *
 * Code that needs the English words of something on screen (a heading to look up, a card to find) asks I18n.source(text), which
 * turns a translated text back into its English, I18n.englishText(element) does that for an element a piece at a time, and
 * I18n.same(text, 'English') compares either.
 */
(() => {
  'use strict';
  const STORE = 'dejavu1.lang';
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-tip', 'data-title', 'label'];
  const SKIP = 'script, style, pre, code, kbd, samp, textarea, [translate="no"], [data-no-i18n]';
  const SLOT = /\{[A-Za-z0-9_]+\}/g;
  const WORDS = /[^\W\d_]{2,}/;
  const CACHE_MAX = 4000;
  const SHOW_ENGLISH_AFTER_MS = 2500;

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private window: the choice lasts for this visit only */ } },
  };
  const collapse = s => s.replace(/\s+/g, ' ').trim();
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const query = new URLSearchParams(location.search);
  let lang = 'en';
  let pseudo = false;
  const asked = query.get('lang');
  if (asked === 'pseudo') { pseudo = true; lang = 'pseudo'; }
  else if (asked && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(asked)) { lang = asked; store.set(STORE, asked); }
  else if (store.get(STORE) === 'pseudo') { pseudo = true; lang = 'pseudo'; }      // set by hand or by tools/text-audit.js --lang pseudo
  else if (store.get(STORE) && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(store.get(STORE))) lang = store.get(STORE);
  if (asked === 'en') store.set(STORE, 'en');
  const debug = query.get('i18n') === 'debug';

  // ---- the catalogue, once loaded ------------------------------------------------------------------
  let ready = lang === 'en';
  const exact = new Map();                 // English text -> translation (plain texts and templates alike)
  const reverse = new Map();               // translation -> English text, for plain texts
  const byHead = new Map();                // first 3 letters of a pattern's opening words -> [pattern]
  const loose = [];                        // patterns that open with a piece: tested by their longest fixed part
  const backwards = [];                    // the translated sentences with pieces, to turn a translated text with figures in it back into English
  const cache = new Map();                 // text -> translation or null
  const missed = new Map();                // text -> { count, where } (debug only)
  let observer = null;

  const PSEUDO_MAP = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ç', n: 'ñ', s: 'š', z: 'ž', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', C: 'Ç', N: 'Ñ', S: 'Š' };
  const PSEUDO_KEEP = /\{[A-Za-z0-9_]*\}|%[sdif]|<[^<>\n]{1,200}>|`[^`\n]+`|\[\[[^\]\n]+\]\]|https?:\/\/[^\s)<>"]+/g;
  function pseudoize(text) {
    const parts = [];
    let last = 0;
    text.replace(PSEUDO_KEEP, (m, at) => { parts.push(text.slice(last, at).replace(/[a-zA-Z]/g, ch => PSEUDO_MAP[ch] || ch).replace(/[aeiouáéíóúý]/g, v => v + v), m); last = at + m.length; return m; });
    parts.push(text.slice(last).replace(/[a-zA-Z]/g, ch => PSEUDO_MAP[ch] || ch).replace(/[aeiouáéíóúý]/g, v => v + v));
    const out = parts.join('');
    return /[áéíóúýçñšž]/.test(out) ? out : out + 'ž';                 // a word with nothing to accent still shows that it went through
  }

  function compile(english, translation) {
    const names = [], parts = [];
    let last = 0;
    english.replace(SLOT, (m, at) => { parts.push(english.slice(last, at)); names.push(m.slice(1, -1)); last = at + m.length; return m; });
    if (!names.length) return null;
    parts.push(english.slice(last));
    const fixed = parts.join('');
    if (!WORDS.test(fixed)) return null;
    return {
      re: new RegExp('^' + parts.map(escapeRe).join('([\\s\\S]+?)') + '$'),
      names, translation, size: fixed.length, head: parts[0], must: parts.reduce((a, b) => (b.length > a.length ? b : a), ''),
    };
  }

  function install(en, tr) {
    exact.clear(); reverse.clear(); byHead.clear(); loose.length = 0; backwards.length = 0; cache.clear();
    for (const key of Object.keys(en)) {
      const english = en[key];
      let translation = pseudo ? pseudoize(english) : tr[key];
      if (typeof translation !== 'string' || !translation.trim()) continue;
      if (translation === english) continue;
      exact.set(english, translation);
      const pattern = compile(english, translation);
      const back = pattern && compile(translation, english);
      if (back) backwards.push(back);
      if (pattern) {
        const head = pattern.head;
        if (head.length >= 3) {
          const k = head.slice(0, 3).toLowerCase();
          (byHead.get(k) || byHead.set(k, []).get(k)).push(pattern);
        } else {
          loose.push(pattern);
        }
      } else if (!reverse.has(translation)) {
        reverse.set(translation, english);
      }
    }
    for (const list of byHead.values()) list.sort((a, b) => b.size - a.size);
    loose.sort((a, b) => b.size - a.size);
  }

  function fill(template, values) {
    return template.replace(SLOT, (m, at) => {
      const name = m.slice(1, -1);
      return values && values[name] !== undefined && values[name] !== null ? String(values[name]) : m;
    });
  }

  function matchPattern(core) {
    const lists = [];
    if (core.length >= 3) { const h = byHead.get(core.slice(0, 3).toLowerCase()); if (h) lists.push(h); }
    lists.push(loose);
    for (const list of lists) {
      for (const p of list) {
        if (p.must.length > 2 && core.indexOf(p.must) < 0) continue;
        const m = p.re.exec(core);
        if (!m) continue;
        const values = {};
        p.names.forEach((n, i) => { if (!(n in values)) values[n] = pieceOf(m[i + 1]); });
        return fill(p.translation, values);
      }
    }
    return null;
  }

  // A piece of a sentence ("{0}") is translated too when it is a whole text of its own, such as "on" or "Sign in".
  function pieceOf(text) {
    const hit = exact.get(collapse(text));
    return hit !== undefined && !SLOT.test(hit) ? hit : text;
  }

  /* The translation of a text, or null when there is none. */
  function lookup(text) {
    const core = collapse(text);
    if (!core || !WORDS.test(core)) return null;
    if (cache.has(core)) return cache.get(core);
    let out = exact.get(core);
    if (out === undefined) out = matchPattern(core);
    if (out === undefined) out = null;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(core, out);
    return out;
  }

  // ---- the page ------------------------------------------------------------------------------------
  const doneText = new WeakMap();          // a text node -> the text this file wrote into it
  const doneAttr = new WeakMap();          // an element -> { attribute: the value this file wrote }

  const nameOf = el => {
    if (!el || !el.tagName) return '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
  };

  function note(text, where) {
    const core = collapse(text);
    if (!core || !WORDS.test(core)) return;
    const seen = missed.get(core);
    if (seen) seen.count++;
    else if (missed.size < 3000) missed.set(core, { count: 1, where: nameOf(where) });
  }

  function skipped(el) {
    return !el || (el.closest && el.closest(SKIP));
  }

  function text(node) {
    const value = node.nodeValue;
    if (!value || doneText.get(node) === value) return;
    if (skipped(node.parentElement)) return;
    const hit = lookup(value);
    if (hit === null) { if (debug) note(value, node.parentElement); return; }
    const lead = value.match(/^\s*/)[0], trail = value.match(/\s*$/)[0];
    const out = lead + hit + trail;
    doneText.set(node, out);
    node.nodeValue = out;
  }

  function attr(el, name) {
    const value = el.getAttribute(name);
    if (!value) return;
    const mine = doneAttr.get(el);
    if (mine && mine[name] === value) return;
    if (skipped(el)) return;
    const hit = lookup(value);
    if (hit === null) { if (debug) note(value, el); return; }
    const record = mine || {};
    record[name] = hit;
    doneAttr.set(el, record);
    el.setAttribute(name, hit);
  }

  function attrs(el) {
    for (const name of ATTRS) if (el.hasAttribute(name)) attr(el, name);
  }

  function walk(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipped(root)) return; attrs(root); }
    const walker = document.createTreeWalker(root, 1 | 4, {
      acceptNode: n => (n.nodeType === 1 && n.matches(SKIP) ? 2 : 1),
    });
    let n = walker.nextNode();
    while (n) {
      if (n.nodeType === 3) text(n);
      else attrs(n);
      n = walker.nextNode();
    }
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver(list => {
      for (const m of list) {
        try {
          if (m.type === 'characterData') text(m.target);
          else if (m.type === 'attributes') attr(m.target, m.attributeName);
          else m.addedNodes.forEach(n => walk(n));
        } catch (_) { /* a page must never break because a text could not be translated */ }
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function start() {
    document.documentElement.lang = lang === 'pseudo' ? 'en-XA' : lang;
    walk(document.documentElement);
    observe();
  }

  // alert, confirm and prompt are not on the page, so they are translated where they are called.
  function nativeDialogs() {
    ['alert', 'confirm', 'prompt'].forEach(name => {
      const original = window[name];
      if (typeof original !== 'function') return;
      window[name] = function (message, ...rest) { return original.call(this, translate(message), ...rest); };
    });
  }

  // Dates and times written with the page's language ("sábado", "Sa."), wherever the page asks for the browser's own way of writing them.
  // Numbers are left alone: the page writes them itself with a point, and one screen must not mix points and commas.
  function dateLanguage() {
    const tag = pseudo ? 'en' : lang;
    ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(name => {
      const original = Date.prototype[name];
      if (typeof original !== 'function') return;
      Date.prototype[name] = function (locales, ...rest) {
        if (locales !== undefined) return original.call(this, locales, ...rest);
        try { return original.call(this, tag, ...rest); } catch (_) { return original.call(this, locales, ...rest); }
      };
    });
  }

  // ---- the public part -----------------------------------------------------------------------------
  /* Words for a person, with {name} pieces filled in. Before a language is loaded, or when there is no translation, English. */
  function translate(english, values) {
    const text = String(english);
    if (lang === 'en' || !ready) return fill(text, values);
    const hit = exact.get(collapse(text));
    if (hit !== undefined) return fill(hit, values);
    const matched = matchPattern(collapse(text));
    return matched === null ? fill(text, values) : matched;
  }

  /* The English of a translated text, for code that looks something up by its English words. */
  function source(text) {
    const core = collapse(String(text == null ? '' : text));
    if (reverse.has(core)) return reverse.get(core);
    for (const p of backwards) {
      if (p.must.length > 2 && core.indexOf(p.must) < 0) continue;
      const m = p.re.exec(core);
      if (!m) continue;
      const values = {};
      p.names.forEach((n, i) => { if (!(n in values)) values[n] = m[i + 1]; });
      return fill(p.translation, values);
    }
    return core;
  }

  /* The English words of an element, a piece at a time (a heading with a badge in it is two texts), for code that looks a title up. */
  function englishText(el) {
    if (!el) return '';
    if (lang === 'en' || !ready) return el.textContent || '';
    let out = '';
    const walker = document.createTreeWalker(el, 4);
    let n = walker.nextNode();
    while (n) {
      const v = n.nodeValue;
      out += collapse(v) ? v.match(/^\s*/)[0] + source(v) + v.match(/\s*$/)[0] : v;
      n = walker.nextNode();
    }
    return out;
  }

  const same = (text, english) => { const core = collapse(String(text == null ? '' : text)); return core === collapse(english) || core === collapse(translate(english)); };

  let languageList = null;
  /* [{ code, name, native, translated, total }] for English and every language with a file. */
  function available() {
    if (languageList) return languageList;
    const get = name => fetch('strings/' + name, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    languageList = Promise.all([get('languages.json'), get('meta.json')]).then(([all, meta]) => {
      const have = (meta && meta.languages) || {};
      const list = [{ code: 'en', name: 'English', native: 'English', translated: 0, total: 0 }];
      for (const item of (all && all.languages) || []) {
        if (have[item.code]) list.push({ code: item.code, name: item.name, native: item.native, translated: have[item.code].translated || 0, total: meta.strings || 0 });
      }
      return list;
    });
    return languageList;
  }

  function setLanguage(code) {
    store.set(STORE, code);
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.toString());
  }

  // The picker in Settings, Appearance.
  function picker() {
    const select = document.getElementById('language-choice');
    if (!select) return;
    available().then(list => {
      select.textContent = '';
      for (const item of list) {
        const option = document.createElement('option');
        option.value = item.code;
        option.textContent = item.code === 'en' || item.native === item.name ? item.name : `${item.native} (${item.name})`;
        option.setAttribute('translate', 'no');
        select.append(option);
      }
      select.value = list.some(i => i.code === lang) ? lang : 'en';
      select.addEventListener('change', () => setLanguage(select.value));
      const noteEl = document.getElementById('language-note');
      if (noteEl) {
        const done = list.length > 1;
        noteEl.hidden = false;
        const item = list.find(i => i.code === lang);
        noteEl.textContent = !done ? 'No translations are installed yet. English is the original.'
          : item && item.code !== 'en' ? `${item.translated} of ${item.total} texts are translated. A text without a translation shows in English.` : '';
      }
    });
  }

  window.I18n = {
    t: translate,
    source,
    englishText,
    same,
    available,
    setLanguage,
    lang: () => lang,
    misses: () => [...missed].map(([textValue, v]) => ({ text: textValue, count: v.count, where: v.where })).sort((a, b) => b.count - a.count),
    translateNow: root => { if (lang !== 'en' && ready) walk(root || document.documentElement); },
    ready: null,
  };

  document.addEventListener('DOMContentLoaded', picker);
  if (lang === 'en') { window.I18n.ready = Promise.resolve(); return; }

  // ---- a language other than English: fetch the catalogue, then translate what is on the page --------
  const css = document.createElement('style');
  css.textContent = 'html.i18n-wait body{visibility:hidden}';
  document.head.append(css);
  document.documentElement.classList.add('i18n-wait');
  const reveal = () => document.documentElement.classList.remove('i18n-wait');
  const timer = setTimeout(reveal, SHOW_ENGLISH_AFTER_MS);

  const fetchJSON = name => fetch('strings/' + name, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  window.I18n.ready = Promise.all([fetchJSON('en.json'), pseudo ? {} : fetchJSON(lang + '.json')]).then(([en, tr]) => {
    install(en, tr);
    ready = true;
    nativeDialogs();
    dateLanguage();
    const go = () => { start(); clearTimeout(timer); reveal(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  });
})();
