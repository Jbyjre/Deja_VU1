/* tester.js: Tester mode in the browser.
 *
 * Two jobs. This build records from the first start (the server decides: with it off, /api/tester answers 403 and
 * this file stops, and in the online demo or without a server it never starts):
 *
 *   1. The recorder. It watches how the app is used (screens, every press and how it was made, what was changed,
 *      the setup and the tour, requests, errors, slow spots, how fast the app opens, how smoothly the 3D twin and
 *      the G-code preview draw) and sends small batches to POST /api/tester/events. Everything stays on this
 *      computer: the server keeps it in its data folder and nothing leaves unless the tester saves the zip and
 *      attaches it to a message.
 *   2. The Settings card (counts, View report, Save tester report, Delete tester data) and a "Something felt off"
 *      button on every screen. tester-study.js adds the 22 questions on top of it.
 *
 * It never records what is typed into a field, a file's name, a picture, or an address. A control is named by its
 * id or an action word (data-tab, data-act...); a button's own words are used only when it has neither, and
 * the server hides anything that looks private before it is written.
 */
(() => {
  'use strict';
  const EVENTS_URL = '/api/tester/events';
  const FLUSH_MS = 4000, FLUSH_AT = 50, MAX_QUEUE = 3000, AGG_MS = 5 * 60 * 1000;
  const SLOW_CLICK = 1000, SLOW_REQ = 2000, LONG_TASK = 200, SAMPLE_EVERY = 20000, SAMPLE_MS = 3000, PERF_EVERY = 5 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);
  const lsGet = key => { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } };
  // Read now, before launchpad.js marks the setup as seen: is this the first time this browser opens the app?
  const firstRun = !lsGet('dejavu1.setup-seen');

  let on = false, ready = false, sid = '', seq = 0, queue = [], sending = false, flushTimer = 0, firstSample = 0, perfTimer = 0, bootSent = false;
  let screenName = '', screenSince = 0, screenVia = '', visTotal = 0, visSince = 0, lastActionAt = 0;
  let lastLayers = null, sampling = false, lastClick = null, clickCtx = null, printerState = '', longSince = 0;
  const actions = [];                       // the last few things done, saved with an error or a note
  const agg = new Map();                    // routine background requests, summed up in five-minute groups
  let errBurst = { at: 0, n: 0 }, lastErr = { msg: '', at: 0 }, keyBurst = { at: 0, n: 0 }, offlineAt = 0, wsClosed = { at: 0, n: 0 };

  const inDemo = () => typeof tour !== 'undefined' && tour.on;
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('');
  const base = path => String(path || '').split(/[\\/]/).pop().split('?')[0].slice(0, 48);

  /* ---- is it on? ------------------------------------------------------------------------------ */

  function wanted() {
    if (inDemo() || (typeof serverMissing === 'function' && serverMissing())) return false;
    if (!ready) return false;                 // the server check has not finished: the demo has not been ruled out yet
    // The module list says whether the server has Tester mode on for this run; until it has arrived, nothing starts.
    return typeof modGate !== 'undefined' && modGate.at > 0 && !modGate.off.has('tester');
  }

  function sync() {
    const want = wanted();
    if (want && !on) start();
    else if (!want && on) stop();
    paintFelt();
  }

  function start() {
    on = true;
    sid = rand();
    seq = 0;
    queue = [];
    actions.length = 0;
    visTotal = 0;
    visSince = document.hidden ? 0 : performance.now();
    screenName = '';
    lastActionAt = 0;
    push({ k: 'session', ev: 'start', device: window.innerWidth <= 720 ? 'phone' : 'desk', w: window.innerWidth, h: window.innerHeight,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, first: firstRun || undefined, up: Math.round(performance.now() / 1000) });
    push(setup());
    noteScreen();
    watchLongTasks();
    watchOnboarding();
    clearTimeout(firstSample);
    firstSample = setTimeout(sample, 6000);     // a first smoothness sample soon after recording starts, then every 20 s
    clearInterval(flushTimer);
    flushTimer = setInterval(() => { aggFlush(false); flush(false); }, FLUSH_MS);
    clearInterval(perfTimer);
    perfTimer = setInterval(perfSample, PERF_EVERY);
    setTimeout(bootPerf, 5000);
  }

  function stop() {
    // Turning it off stops the recording at once: what is waiting here is thrown away, not sent.
    on = false;
    queue = [];
    agg.clear();
    unwatchLongTasks();
    clearTimeout(firstSample);
    clearInterval(flushTimer);
    clearInterval(perfTimer);
  }

  function setup() {
    const ua = navigator.userAgent || '';
    const pick = [[/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/Firefox\/([\d.]+)/, 'Firefox'], [/Chrome\/([\d.]+)/, 'Chrome'],
      [/Version\/([\d.]+).*Safari/, 'Safari']].map(([re, name]) => { const m = re.exec(ua); return m && [name, m[1].split('.')[0]]; }).find(Boolean) || ['other', ''];
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux' : 'other';
    const root = document.documentElement;
    const mq = q => { try { return matchMedia(q).matches; } catch (_) { return false; } };
    const link = navigator.connection && /^[a-z0-9-]{1,8}$/.test(navigator.connection.effectiveType || '') ? navigator.connection.effectiveType : undefined;
    return { k: 'setup', browser: pick[0], bver: pick[1], ua_os: os, w: window.screen.width, h: window.screen.height,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, look: root.dataset.ui || 'glass', theme: root.dataset.theme || 'light',
      lang: (root.lang || navigator.language || 'en').split('-')[0].slice(0, 8), touch: (navigator.maxTouchPoints || 0) > 0,
      density: root.dataset.density || 'comfortable', motion: mq('(prefers-reduced-motion: reduce)') ? 'reduced' : 'full',
      cores: navigator.hardwareConcurrency || undefined, mem: navigator.deviceMemory || undefined, ptr: mq('(pointer: coarse)') ? 'coarse' : 'fine',
      standalone: mq('(display-mode: standalone)') || navigator.standalone === true, tz: -new Date().getTimezoneOffset(),
      contrast: mq('(prefers-contrast: more)') ? 'more' : 'normal', transp: mq('(prefers-reduced-transparency: reduce)') ? 'reduce' : 'normal',
      cpref: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light', conn: link, secure: window.isSecureContext === true };
  }

  /* ---- hiding what is private ------------------------------------------------------------------ */

  // Addresses, keys, Wi-Fi names, serial numbers, folders with a user name and file names are replaced here, before an
  // event is queued, and the server hides the same things again before it writes. The patterns are built from strings
  // inside try/catch: a browser without lookbehind skips those and the server still masks them.
  const OCT = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
  const HIDE = [
    ['((?:[a-z]:)?[\\\\/]{1,2}(?:users|home)[\\\\/]{1,2})(?:[^\\\\/\\r\\n\'"<>:|?*,;)\\]]+(?=[\\\\/])|[^\\\\/\\s\'"<>:|?*,;)\\]]+)', 'gi', '$1<user>'],
    ['\\b([a-z][a-z0-9+.-]{1,12}://)[^/\\s\'"<>?#]+', 'gi', '$1<host>'],
    ['([?&;](?:api[_-]?key|apikey|token|access[_-]?token|key|secret|password|pwd|auth|signature|sig)=)[^&\\s\'"<>]+', 'gi', '$1<hidden>'],
    ['\\b(bearer|basic|token)\\s+[A-Za-z0-9._~+/=-]{8,}', 'gi', '$1 <key>'],
    ['\\b(api[_-]?key|apikey|x-api-key|access[_-]?token|refresh[_-]?token|authorization|secret|password|passwd|pwd|token|webhook)(\\\\?["\']?\\s*[:=]\\s*\\\\?["\']?)[^\\s"\',;&}\\\\]{3,}', 'gi', '$1$2<hidden>'],
    ['\\bsk-[A-Za-z0-9_-]{10,}|\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\\bgithub_pat_[A-Za-z0-9_]{20,}|\\bxox[abprs]-[A-Za-z0-9-]{10,}|\\bAIza[0-9A-Za-z_-]{30,}|\\bAKIA[0-9A-Z]{16}|\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]*', 'g', '<key>'],
    ['\\b(ssid|network name)(\\\\?["\']?\\s*[:=]\\s*\\\\?["\']?)[^\\s"\',;]{1,40}', 'gi', '$1$2<network>'],
    ['\\b(serial(?:[_ -]?(?:number|no))?|s/n|device[_-]?id|machine[_-]?id|uuid)\\b(\\\\?["\']?\\s*[:=#]?\\s*\\\\?["\']?)[A-Za-z0-9-]{4,}', 'gi', '$1$2<id>'],
    ['[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', 'g', '<email>'],
    ['(?<![\\w:-])(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}(?![\\w:-])', 'gi', '<mac>'],
    ['(?<![\\w.])' + OCT + '(?:\\.' + OCT + '){3}(?![\\w])(?::\\d{2,5})?', 'g', '<ip>'],
    ['(?<![\\w:])(?:(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|::1)(?![\\w:])', 'gi', '<ip>'],
    ['\\b[0-9a-f]{20,}\\b', 'gi', '<key>'],
    ['(?<![\\w-])(?=[A-Za-z0-9_+-]*\\d)(?=[A-Za-z0-9_+-]*[A-Za-z])[A-Za-z0-9_+-]{24,}(?![\\w-])', 'g', '<key>']
  ].map(([source, flags, replacement]) => {
    try { return [new RegExp(source, flags), replacement]; } catch (_) { return null; }
  }).filter(Boolean);

  function hide(text) {
    let out = String(text).slice(0, 4000).replace(FILE_WORD, '<file>');
    for (const [re, replacement] of HIDE) out = out.replace(re, replacement);
    return out;
  }

  function hideAll(event) {
    for (const key of Object.keys(event)) {
      const value = event[key];
      if (key === 'k' || key === 's') continue;
      if (typeof value === 'string') event[key] = hide(value);
      else if (Array.isArray(value)) event[key] = value.map(v => (typeof v === 'string' ? hide(v) : v));
    }
    return event;
  }

  /* ---- sending -------------------------------------------------------------------------------- */

  function push(event) {
    if (!on) return;
    event.t = event.t || Date.now();
    event.s = sid;
    event.q = ++seq;
    queue.push(hideAll(event));
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    if (queue.length >= FLUSH_AT) setTimeout(() => flush(false), 0);
  }

  async function flush(final) {
    if (!on || !queue.length || (sending && !final)) return;
    const batch = queue.splice(0, 400);
    const body = JSON.stringify({ events: batch });
    if (final && navigator.sendBeacon && body.length < 60000) {
      try { if (navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: 'application/json' }))) return; } catch (_) { /* fall through */ }
    }
    sending = true;
    try {
      const res = await nativeFetch(EVENTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 });
      if (res.status === 403) { stop(); paintFelt(); refreshCard(true); }      // the server has Tester mode off for this run
    } catch (_) {
      queue.unshift(...batch.slice(0, 200));                    // the server is busy or restarting: try again next time
    } finally {
      sending = false;
    }
  }

  /* ---- screens -------------------------------------------------------------------------------- */

  function screenNow() {
    const first = location.hash.replace(/^#\/?/, '').split('/')[0].split('?')[0];
    if (/^[a-z0-9-]{1,24}$/.test(first)) return first;
    const panel = document.querySelector('.tab-panel:not([hidden])');
    return panel && /^tab-[a-z0-9-]{1,24}$/.test(panel.id) ? panel.id.slice(4) : 'overview';
  }

  function closeVisit(now) {
    if (screenName && screenSince) {
      push({ k: 'screen', screen: screenName, ms: Math.max(0, Math.round(now - screenSince)), t: Date.now() - Math.round(now - screenSince), via: screenVia || undefined });
    }
  }

  function noteScreen() {
    if (!on) return;
    const next = screenNow(), now = performance.now();
    if (next === screenName) return;
    closeVisit(now);
    screenName = next;
    screenSince = now;
    // How they got here: the control pressed in the last moment, else the address (a link, the back button, a shortcut).
    screenVia = lastClick && now - lastClick.t0 < 1500 ? lastClick.ctl : 'address';
    lastActionAt = now;
    remember('open ' + next);
  }

  function remember(text) {
    actions.push(text.slice(0, 80));
    if (actions.length > 10) actions.shift();
  }

  /* ---- presses ---------------------------------------------------------------------------------- */

  const INTERACTIVE = 'button, a[href], summary, select, input[type=checkbox], input[type=radio], input[type=range], input[type=file], '
    + 'input[type=color], [role=button], [role=tab], [role=switch], [role=menuitem], [role=option], [data-tab], .btn, .navtab';
  // Action words: what a control does, never a name someone typed (no data-file, data-id, data-printer...).
  const ACTION_ATTRS = ['data-tab', 'data-act', 'data-action', 'data-go', 'data-go-card', 'data-part', 'data-place', 'data-step', 'data-view',
    'data-mode', 'data-speed', 'data-home', 'data-nudge', 'data-twin', 'data-preset', 'data-dest', 'data-more', 'data-theme-choice',
    'data-look-choice', 'data-state', 'data-days', 'data-kind', 'data-head', 'data-slot', 'data-remote', 'data-os', 'data-phone',
    'data-merge-direction', 'data-hold', 'data-case', 'data-material', 'data-sr-act', 'data-tag', 'data-length'];
  const SAFE_WORD = /^[A-Za-z0-9:_-]{1,32}$/;
  const FILE_WORD = /\S+\.(gcode|gco|bgcode|3mf|stl|obj|step|stp|amf|ufp|ply|zip|png|jpe?g|gif|webp|mp4|webm|mov)\b/gi;
  const OWN_UI = '#tester-felt, #tester-note, .tester-ui';       // the tester's own panels are not part of what is recorded

  function roleOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return el.type === 'checkbox' ? 'switch' : el.type || 'input';
    return tag === 'a' ? 'link' : el.getAttribute('role') || tag;
  }

  function wordsOf(el) {
    if (el.matches('input, select, textarea')) {
      const label = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      return label ? label.textContent : el.getAttribute('aria-label') || '';
    }
    return el.getAttribute('aria-label') || el.textContent || '';
  }

  function describe(el) {
    let name = '';
    if (el.id && el.id.length <= 40 && !/\d{4,}/.test(el.id)) name = '#' + el.id;
    if (!name) {
      for (const attr of ACTION_ATTRS) {
        const value = el.getAttribute(attr);
        if (value && SAFE_WORD.test(value)) { name = '[' + attr + '=' + value + ']'; break; }
      }
    }
    if (!name) {
      const words = wordsOf(el).replace(/\s+/g, ' ').trim().replace(FILE_WORD, '<file>').slice(0, 40);
      name = words ? roleOf(el) + ' "' + words + '"' : roleOf(el) + (el.classList[0] ? '.' + el.classList[0] : '');
    }
    const region = el.closest('section[id], dialog[id], nav[id], aside[id], form[id], details[id]');
    if (region && region !== el && !name.startsWith('#')) name += ' in #' + region.id;
    return name.slice(0, 90);
  }

  /* One press: how it was made (mouse, touch, pen or the keyboard), which button, which keys were held, whether it was the
   * second of a double press, where on the screen it landed, and how long since the last thing they did. */
  function press(e, button) {
    if (!on || !e.isTrusted) return;
    const target = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (!target || target.closest(OWN_UI)) return;
    const t0 = performance.now();
    const how = SAFE_WORD.test(e.pointerType || '') ? e.pointerType : (e.detail === 0 && button === 0 ? 'key' : 'mouse');
    const mods = [e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.metaKey && 'meta'].filter(Boolean).join('-');
    const where = how !== 'key' && window.innerWidth > 0 && window.innerHeight > 0
      ? { x: Math.max(0, Math.min(100, Math.round(e.clientX / window.innerWidth * 100))), y: Math.max(0, Math.min(100, Math.round(e.clientY / window.innerHeight * 100))) } : {};
    const rec = { k: 'click', ctl: describe(target), screen: screenNow(), t: Date.now(), t0, pending: 0, req: 0, route: '', paint: null, closed: false, sent: false,
      how, btn: button, mods: mods || undefined, dbl: e.detail >= 2 ? true : undefined, role: SAFE_WORD.test(roleOf(target)) ? roleOf(target) : undefined,
      gap: lastActionAt ? Math.min(600000, Math.round(t0 - lastActionAt)) : undefined, ...where };
    lastActionAt = t0;
    clickCtx = rec;
    lastClick = rec;
    remember('click ' + rec.ctl);
    markOnboardingPress(target);
    // The next paint: a task queued from inside the animation frame runs after the browser has drawn it.
    requestAnimationFrame(() => setTimeout(() => { rec.paint = Math.round(performance.now() - t0); settle(rec); }, 0));
    setTimeout(() => { if (clickCtx === rec) clickCtx = null; rec.closed = true; settle(rec); }, 300);
    setTimeout(() => settle(rec, true), 20000);
  }

  function settle(rec, force) {
    if (rec.sent || !on) return;
    if (!force && (rec.paint === null || !rec.closed || rec.pending > 0)) return;
    rec.sent = true;
    const event = { k: 'click', ctl: rec.ctl, screen: rec.screen, t: rec.t, paint: rec.paint === null ? undefined : rec.paint, how: rec.how,
      btn: rec.btn || undefined, mods: rec.mods, dbl: rec.dbl, role: rec.role, gap: rec.gap, x: rec.x, y: rec.y };
    if (rec.req) { event.req = rec.req; event.route = rec.route; }
    if ((rec.paint || 0) > SLOW_CLICK) event.slow = true;
    push(event);
  }

  /* What a press changed: a switch, a slider, a choice in a list, a file picked. Never the words typed into a field. */
  const TYPED = 'textarea, input[type=text], input[type=search], input[type=password], input[type=email], input[type=url], input[type=tel], input[type=number], input:not([type])';

  function onChange(e) {
    const el = e.target;
    if (!on || !e.isTrusted || !el || !el.matches || el.matches(TYPED) || el.closest(OWN_UI)) return;
    const type = (el.type || '').toLowerCase();
    const event = { k: 'change', ctl: describe(el), screen: screenNow(), role: SAFE_WORD.test(roleOf(el)) ? roleOf(el) : undefined };
    if (type === 'checkbox' || type === 'radio') event.on = !!el.checked;
    else if (type === 'range') { const v = parseFloat(el.value); if (isFinite(v)) event.num = Math.round(v * 100) / 100; }
    else if (el.tagName === 'SELECT') { event.idx = el.selectedIndex + 1; event.of = el.options.length; }
    else if (type === 'file') {
      event.files = el.files ? el.files.length : 0;
      const ext = el.files && el.files[0] ? (/\.([A-Za-z0-9]{1,8})$/.exec(el.files[0].name) || [])[1] : '';
      if (ext) event.ext = ext.toLowerCase();
    }
    lastActionAt = performance.now();
    remember('change ' + event.ctl);
    push(event);
  }

  /* Keyboard shortcuts and chords, not typing: Escape, a lone letter or / when no field has focus, and Ctrl, Alt or Cmd chords. */
  function onKey(e) {
    if (!on || !e.isTrusted || e.repeat || !e.key || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    const el = document.activeElement;
    const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if (el && el.closest && el.closest(OWN_UI)) return;
    const chord = e.ctrlKey || e.metaKey || e.altKey;
    const key = e.altKey && /^Digit\d$/.test(e.code || '') ? e.code.slice(5) : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!(key === 'Escape' || (chord && key.length === 1) || (!typing && !chord && key.length === 1 && key !== ' '))) return;
    const now = Date.now();
    if (now - keyBurst.at > 60000) keyBurst = { at: now, n: 0 };
    if (++keyBurst.n > 60) return;
    const combo = [e.ctrlKey && 'ctrl', e.metaKey && 'cmd', e.altKey && 'alt', e.shiftKey && (key.length > 1 || chord) && 'shift', key].filter(Boolean).join('-');
    lastActionAt = performance.now();
    remember('key ' + combo);
    push({ k: 'key', combo, screen: screenNow() });
  }

  /* ---- requests --------------------------------------------------------------------------------- */

  function routeOf(url) {
    let path = String(url || '').replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0].split('#')[0];
    path = path.split('/').map((seg, i) => (i > 2 && seg && !/^[a-z][a-z_-]{0,23}$/.test(seg) ? ':id' : seg)).join('/');
    return path.slice(0, 120);
  }

  function note(method, route, status, ms, words) {
    if (!on) return;
    ms = Math.round(ms);
    if (method !== 'GET' || status >= 400 || status === 0 || ms > SLOW_REQ) {
      push({ k: 'req', route, method, status, ms, err: words || undefined, screen: screenNow(), slow: ms > SLOW_REQ || undefined });
      if (status >= 400 || status === 0) remember('failed ' + method + ' ' + route);
      if (status >= 500) alertNote('Server error ' + status + ' on ' + route);
      return;
    }
    const bucket = Math.floor(Date.now() / AGG_MS), key = method + ' ' + route + ' ' + bucket;
    let g = agg.get(key);
    if (!g) agg.set(key, g = { method, route, bucket, n: 0, vals: [], max: 0 });
    g.n++;
    g.max = Math.max(g.max, ms);
    if (g.vals.length < 200) g.vals.push(ms);
  }

  function aggFlush(all) {
    const current = Math.floor(Date.now() / AGG_MS);
    for (const [key, g] of agg) {
      if (!all && g.bucket >= current) continue;
      agg.delete(key);
      const sorted = g.vals.slice().sort((a, b) => a - b);
      push({ k: 'req', agg: true, route: g.route, method: g.method, n: g.n, ok: g.n, fail: 0, p50: sorted[Math.floor(sorted.length / 2)] || 0, max: g.max,
        bucket: g.bucket, t: (g.bucket + 1) * AGG_MS - 1000 < Date.now() ? (g.bucket + 1) * AGG_MS - 1000 : Date.now() });
    }
  }

  window.fetch = function (input, init) {
    if (!on) return nativeFetch(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!/^(?:[a-z]+:\/\/[^/]+)?\/api\//i.test(url) || url.indexOf('/api/tester/') !== -1) return nativeFetch(input, init);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const route = routeOf(url), t0 = performance.now();
    const ctx = clickCtx && t0 - clickCtx.t0 < 300 ? clickCtx : null;
    if (ctx) { ctx.pending++; ctx.route = route; }
    const finish = (status, words) => {
      const ms = performance.now() - t0;
      note(method, route, status, ms, words);
      if (ctx) { ctx.pending--; ctx.req = Math.max(ctx.req, Math.round(performance.now() - ctx.t0)); settle(ctx); }
    };
    return nativeFetch(input, init).then(res => {
      if (res.status >= 400) {
        res.clone().json().then(body => finish(res.status, body && body.error ? String(body.error) : ''), () => finish(res.status, ''));
      } else {
        finish(res.status, '');
      }
      return res;
    }, err => { finish(0, err && err.message ? String(err.message) : 'network error'); throw err; });
  };

  /* ---- errors, toasts and slow spots -------------------------------------------------------------- */

  // The lines of an error's call stack as "function file.js:line:column": names from the app's own code, never an address.
  function frames(stack) {
    return String(stack || '').split('\n').map(line => {
      line = line.trim();
      const chrome = /^at\s+(?:(.*?)\s+\()?(?:[a-z]+:\/\/[^\s)]*\/)?([\w.-]+\.js):(\d+):(\d+)\)?$/.exec(line);
      const gecko = /^(.*?)@(?:[a-z]+:\/\/[^\s]*\/)?([\w.-]+\.js):(\d+):(\d+)$/.exec(line);
      const m = chrome || gecko;
      return m ? ((m[1] || '').trim() + ' ' + m[2] + ':' + m[3] + ':' + m[4]).trim() : '';
    }).filter(Boolean).slice(0, 6);
  }

  function pushError(kind, msg, file, line, col, stack) {
    if (!on) return;
    msg = String(msg || '').slice(0, 300);
    const now = Date.now();
    if (msg === lastErr.msg && now - lastErr.at < 1000) return;
    lastErr = { msg, at: now };
    if (now - errBurst.at > 60000) errBurst = { at: now, n: 0 };
    if (++errBurst.n > 100) return;
    const control = lastClick && performance.now() - lastClick.t0 < 15000 ? lastClick.ctl : undefined;
    push({ k: 'err', kind, msg, file: file ? base(file) : undefined, line, col, screen: screenNow(), last: actions.slice(), stack: stack && stack.length ? stack : undefined,
      ctl: control, pstate: printerState || undefined, online: navigator.onLine === false ? false : undefined, age: Math.round(performance.now() / 1000) });
    // A lost server is recorded (the report groups it) but is not something to tell the tester about: the page reconnects by itself.
    if ((kind === 'js' || kind === 'promise' || kind === 'toast') && !/failed to fetch|networkerror|network error|load failed|network connection was lost|did not answer/i.test(msg)) alertNote(msg);
  }

  window.addEventListener('error', e => {
    if (e.target && e.target !== window) {
      const src = e.target.src || e.target.href || '';
      // The camera picture tries the saved address, then the live stream, then still pictures, and says which is showing (printer-page.js):
      // an image that does not load from either stream route is that fallback working, not a fault to report.
      if (e.target.tagName === 'IMG' && /\/api\/camera\/(live|stream)\b/.test(src)) return;
      if (/^(SCRIPT|LINK|IMG|VIDEO|AUDIO|SOURCE)$/.test(e.target.tagName) && src && !/^(data|blob):/i.test(src)) pushError('resource', 'Could not load ' + base(src));
      return;
    }
    pushError('js', e.message || (e.error && e.error.message) || 'Script error', e.filename, e.lineno, e.colno, frames(e.error && e.error.stack));
  }, true);
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    pushError('promise', r && r.message ? r.message : String(r), undefined, undefined, undefined, frames(r && r.stack));
  });
  document.addEventListener('securitypolicyviolation', e => {
    pushError('csp', 'Blocked ' + (e.violatedDirective || 'something') + ' from ' + String(e.blockedURI || 'inline').replace(/^([a-z]+:\/\/)[^/]+/i, '$1<host>').slice(0, 60));
  });
  const nativeConsoleError = console.error;
  console.error = function () {
    try {
      if (on) {
        const text = Array.prototype.map.call(arguments, a => {
          if (a instanceof Error) return a.name + ': ' + a.message;
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (_) { return String(a); }
        }).join(' ');
        pushError('console', text);
      }
    } catch (_) { /* recording never changes what the app does */ }
    return nativeConsoleError.apply(this, arguments);
  };

  const toastNow = window.toast;
  if (typeof toastNow === 'function') {
    window.toast = function (message, kind) {
      try {
        if (on) {
          const text = String(message == null ? '' : message);
          if (kind === 'bad') pushError('toast', text);
          const done = /^(.*): confirmed by the printer in (\d+) ms$/.exec(text);
          if (done) push({ k: 'printer', ev: 'confirmed', what: done[1].slice(0, 60), ms: +done[2] });
          else if (/sent, but the printer now reports/.test(text)) push({ k: 'printer', ev: 'unconfirmed', what: text.slice(0, 120) });
          else if (kind === 'ok') {
            const sent = /^(.*) \((\d+) ms\)$/.exec(text);
            if (sent) push({ k: 'printer', ev: 'sent', what: sent[1].slice(0, 60), ms: +sent[2] });
          }
        }
      } catch (_) { /* recording never changes what the app does */ }
      return toastNow.apply(this, arguments);
    };
  }

  let watcher = null, longCount = 0;
  function watchLongTasks() {
    if (watcher) return;
    try {
      watcher = new PerformanceObserver(list => {
        if (!on) return;
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK) continue;
          const recent = lastClick && performance.now() - lastClick.t0 < 1500 ? lastClick.ctl : undefined;
          longCount++;
          push({ k: 'long', ms: Math.round(entry.duration), screen: screenNow(), ctl: recent });
        }
      });
      watcher.observe({ entryTypes: ['longtask'] });
    } catch (_) { watcher = null; /* this browser has no long-task timing: slow clicks and requests are still recorded */ }
  }
  function unwatchLongTasks() {
    if (watcher) { try { watcher.disconnect(); } catch (_) { /* nothing to do */ } watcher = null; }
  }

  /* ---- how fast it opens, how much memory it holds ------------------------------------------------- */

  function bootPerf() {
    if (!on || bootSent) return;
    bootSent = true;
    try {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paint = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint');
      let lcp = null, cls = 0;
      const watch = (type, fn) => { try { const o = new PerformanceObserver(list => list.getEntries().forEach(fn)); o.observe({ type, buffered: true }); return o; } catch (_) { return null; } };
      const a = watch('largest-contentful-paint', en => { lcp = en.startTime; });
      const b = watch('layout-shift', en => { if (!en.hadRecentInput) cls += en.value; });
      setTimeout(() => {
        [a, b].forEach(o => { if (o) o.disconnect(); });
        const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : undefined;
        push({ k: 'perf', boot: true, fcp: paint ? Math.round(paint.startTime) : undefined, lcp: lcp ? Math.round(lcp) : undefined, cls: Math.round(cls * 1000),
          dcl: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : undefined, load: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : undefined,
          ttfb: nav.responseStart ? Math.round(nav.responseStart) : undefined, heap, nodes: document.getElementsByTagName('*').length });
      }, 1500);
    } catch (_) { /* a browser without these timings only skips this sample */ }
  }

  function perfSample() {
    if (!on || document.hidden) return;
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : undefined;
    push({ k: 'perf', heap, nodes: document.getElementsByTagName('*').length, long: longCount - longSince, up: Math.round(performance.now() / 1000) });
    longSince = longCount;
  }

  /* ---- the connection ----------------------------------------------------------------------------- */

  window.addEventListener('offline', () => { offlineAt = Date.now(); push({ k: 'net', ev: 'offline', screen: screenNow() }); });
  window.addEventListener('online', () => { push({ k: 'net', ev: 'online', ms: offlineAt ? Date.now() - offlineAt : undefined }); offlineAt = 0; });
  const NativeSocket = window.WebSocket;
  if (typeof NativeSocket === 'function') {
    // The live link to the server (readings, camera status). A subclass, so everything else about it stays as it was.
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        try {
          this.addEventListener('close', ev => {
            if (!on || ev.wasClean) return;
            const now = Date.now();
            if (now - wsClosed.at > 3600000) wsClosed = { at: now, n: 0 };
            if (++wsClosed.n <= 60) push({ k: 'net', ev: 'ws_close', code: ev.code, clean: false, screen: screenNow() });
          });
        } catch (_) { /* recording never changes what the app does */ }
      }
    };
  }

  /* ---- smoothness ---------------------------------------------------------------------------------- */

  window.addEventListener('dv-state', e => {
    const st = e.detail;
    lastLayers = st && st.layer && st.layer.total ? +st.layer.total : null;
    printerState = st && SAFE_WORD.test(String(st.state || '')) ? String(st.state) : '';
  });

  const shown = el => {
    if (!el || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40 && r.bottom > 0 && r.top < window.innerHeight;
  };

  function surfaces() {
    const out = [];
    if (shown(document.getElementById('twin-card'))) out.push(['twin', lastLayers]);
    const range = document.getElementById('gv-range');
    if (shown(range)) out.push(['gcode', +range.max || null]);
    return out;
  }

  function sample() {
    if (!on || document.hidden || sampling) return;
    const list = surfaces();
    if (!list.length) return;
    sampling = true;
    let frames = 0;
    const began = performance.now();
    const guard = setTimeout(() => { sampling = false; }, SAMPLE_MS * 3);
    const tick = now => {
      frames++;
      if (now - began < SAMPLE_MS && !document.hidden) { requestAnimationFrame(tick); return; }
      clearTimeout(guard);
      sampling = false;
      const secs = (now - began) / 1000;
      if (document.hidden || secs < 1) return;
      list.forEach(([surface, layers]) => push({ k: 'fps', surface, fps: Math.round(frames / secs * 10) / 10, secs: Math.round(secs * 10) / 10,
        layers: layers || undefined, screen: screenNow() }));
    };
    requestAnimationFrame(tick);
  }
  setInterval(sample, SAMPLE_EVERY);

  /* ---- the session ------------------------------------------------------------------------------------ */

  function visibleMs() { return Math.round(visTotal + (visSince ? performance.now() - visSince : 0)); }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (visSince) { visTotal += performance.now() - visSince; visSince = 0; }
      if (on) { closeVisit(performance.now()); screenSince = 0; screenName = ''; push({ k: 'session', ev: 'end', ms: visibleMs() }); aggFlush(true); flush(true); }
    } else {
      visSince = performance.now();
      noteScreen();
    }
  });
  window.addEventListener('pagehide', () => { if (on) { closeVisit(performance.now()); push({ k: 'session', ev: 'end', ms: visibleMs() }); aggFlush(true); flush(true); } });
  window.addEventListener('hashchange', noteScreen);
  window.addEventListener('dv-tab', () => setTimeout(noteScreen, 0));
  window.addEventListener('dv-section', () => setTimeout(noteScreen, 0));
  document.addEventListener('click', e => press(e, 0), true);
  document.addEventListener('auxclick', e => { if (e.button === 1) press(e, 1); }, true);     // the right button is the contextmenu event below
  document.addEventListener('contextmenu', e => press(e, 2), true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('keydown', onKey, true);
  let sizeClass = '';
  window.addEventListener('resize', () => {
    const next = window.innerWidth <= 720 ? 'phone' : window.innerWidth <= 1100 ? 'tablet' : 'desk';
    if (on && sizeClass && next !== sizeClass) push({ k: 'resize', w: window.innerWidth, h: window.innerHeight, bp: next });
    sizeClass = next;
  });
  sizeClass = window.innerWidth <= 720 ? 'phone' : window.innerWidth <= 1100 ? 'tablet' : 'desk';

  /* ---- the setup and the tour ------------------------------------------------------------------------ */

  // launchpad.js (setup) and guide.js (the tour) are watched from outside: the dialog opening, the step line changing, the
  // tour's class on <html>. Nothing in them is changed. Each step is reported when it is left, with how long it stayed.
  const wz = { open: false, step: 0, of: 0, name: '', since: 0, openedAt: 0, how: '', watching: false };
  const tr = { open: false, step: 0, of: 0, name: '', since: 0, openedAt: 0, how: '', watching: false, bodyObserver: null };

  function markOnboardingPress(target) {
    if (wz.open) wz.how = target.id === 'setup-next' ? 'next' : target.id === 'setup-back' ? 'back' : target.id === 'setup-skip' ? 'skip' : 'jump';
    if (tr.open) { const act = target.getAttribute('data-act'); if (act) tr.how = act; }
  }

  function wizardTick() {
    if (!on) return;
    const dialog = document.getElementById('setup-dialog');
    if (!dialog) return;
    const now = performance.now();
    const m = /^Step (\d+) of (\d+)\s*[·\u00b7]\s*(.+)$/.exec((document.getElementById('setup-step') || {}).textContent || '');
    if (dialog.open && !wz.open) {
      wz.open = true; wz.openedAt = wz.since = now; wz.how = '';
      wz.step = m ? +m[1] : 0; wz.of = m ? +m[2] : 0; wz.name = m ? m[3] : '';
      push({ k: 'onboarding', ev: 'wizard_open', first: firstRun || undefined, step: wz.step, of: wz.of });
      remember('setup opened');
    } else if (dialog.open && wz.open && m && +m[1] !== wz.step) {
      push({ k: 'onboarding', ev: 'wizard_step', step: wz.step, of: wz.of, name: wz.name, ms: Math.round(now - wz.since), how: wz.how || 'next' });
      wz.step = +m[1]; wz.of = +m[2]; wz.name = m[3]; wz.since = now; wz.how = '';
      remember('setup step ' + wz.step);
    } else if (!dialog.open && wz.open) {
      const last = wz.how === 'skip' ? 'skipped' : wz.how === 'next' && wz.step === wz.of ? 'done' : 'closed';
      push({ k: 'onboarding', ev: 'wizard_step', step: wz.step, of: wz.of, name: wz.name, ms: Math.round(now - wz.since), how: last });
      push({ k: 'onboarding', ev: 'wizard_end', how: last, step: wz.step, of: wz.of, ms: Math.round(now - wz.openedAt) });
      wz.open = false;
      remember('setup ' + last);
    }
  }

  function tourRead() {
    const card = document.querySelector('.guide .guide-card');
    if (!card) return null;
    const dots = card.querySelector('.guide-dots'), count = card.querySelector('.guide-count');
    const label = dots ? /Stop (\d+) of (\d+)/.exec(dots.getAttribute('aria-label') || '') : count ? /(\d+)\s*\/\s*(\d+)/.exec(count.textContent || '') : null;
    const title = card.querySelector('#guide-title');
    return { step: label ? +label[1] : 0, of: label ? +label[2] : 0, name: title ? title.textContent.slice(0, 60) : '' };
  }

  function tourTick() {
    if (!on) return;
    const open = document.documentElement.classList.contains('guide-open');
    const now = performance.now();
    if (open && !tr.open) {
      tr.open = true; tr.openedAt = tr.since = now; tr.how = '';
      const read = tourRead() || { step: 0, of: 0, name: '' };
      Object.assign(tr, read);
      push({ k: 'onboarding', ev: 'tour_start', of: tr.of, name: tr.name });
      remember('tour started');
      const body = document.querySelector('.guide .guide-body');
      if (body) { tr.bodyObserver = new MutationObserver(tourTick); tr.bodyObserver.observe(body, { childList: true }); }
    } else if (open && tr.open) {
      const read = tourRead();
      if (read && read.step && read.step !== tr.step) {
        push({ k: 'onboarding', ev: 'tour_step', step: tr.step, of: tr.of, name: tr.name, ms: Math.round(now - tr.since), how: tr.how || 'next' });
        Object.assign(tr, read, { since: now, how: '' });
      }
    } else if (!open && tr.open) {
      const finished = tr.how === 'next' && tr.step === tr.of;
      push({ k: 'onboarding', ev: 'tour_step', step: tr.step, of: tr.of, name: tr.name, ms: Math.round(now - tr.since), how: finished ? 'done' : 'end' });
      push({ k: 'onboarding', ev: 'tour_end', how: finished ? 'finished' : 'ended', step: tr.step, of: tr.of, ms: Math.round(now - tr.openedAt) });
      if (tr.bodyObserver) { tr.bodyObserver.disconnect(); tr.bodyObserver = null; }
      tr.open = false;
      remember('tour ' + (finished ? 'finished' : 'ended'));
    }
  }

  function watchOnboarding() {
    const dialog = document.getElementById('setup-dialog'), stepLine = document.getElementById('setup-step');
    if (dialog && !wz.watching) {
      wz.watching = true;
      new MutationObserver(wizardTick).observe(dialog, { attributes: true, attributeFilter: ['open'] });
      if (stepLine) new MutationObserver(wizardTick).observe(stepLine, { childList: true, characterData: true, subtree: true });
    }
    if (!tr.watching) {
      tr.watching = true;
      new MutationObserver(tourTick).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    wizardTick();
    tourTick();
  }

  /* ---- Something felt off ------------------------------------------------------------------------------ */

  let felt = null, dock = null, panel = null, alertUntil = 0, alertTimer = 0, alertWords = '', chosenTag = '';
  const TAGS = [['broken', 'Broken'], ['slow', 'Slow'], ['confusing', 'Confusing'], ['wrong', 'Looks wrong'], ['idea', 'Idea'], ['good', 'Works well']];

  // After an error, the button says so for a while: one press and the note already knows what just went wrong.
  function alertNote(words) {
    if (!felt) return;
    alertUntil = Date.now() + 20000;
    alertWords = String(words || '').slice(0, 200);
    felt.classList.add('is-alert');
    feltWords('Something went wrong? Tell us');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => { if (felt) { felt.classList.remove('is-alert'); feltWords('Something felt off'); } }, 20000);
  }

  // The button is a small flag and its words. In the strip a narrow window shows only the flag, so the words are also its name.
  function feltWords(words) {
    felt.setAttribute('aria-label', words);
    const t = felt.querySelector('.tester-felt-text');
    if (t) t.textContent = words;
  }

  function paintFelt() {
    if (!on) {
      if (dock) { dock.remove(); dock = null; }
      felt = null;
      if (panel) { panel.remove(); panel = null; }
      return;
    }
    if (felt) return;
    // The note button lives in the instrument strip, so it never sits over the page; without a strip it floats at the bottom right.
    dock = document.createElement('div');
    dock.id = 'tester-dock';
    dock.className = 'tester-dock tester-ui';
    felt = document.createElement('button');
    felt.type = 'button';
    felt.id = 'tester-felt';
    felt.className = 'tester-felt tester-ui';          // a flat pill: glass behind a moving 3D view costs frames on every screen
    felt.innerHTML = '<svg class="tester-felt-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">'
      + '<path d="M3.5 14V2.5M3.5 3h8l-2 3 2 3h-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '<span class="tester-felt-text"></span>';
    feltWords('Something felt off');
    felt.title = 'Something felt off (Alt + Shift + N)';
    felt.setAttribute('aria-haspopup', 'dialog');
    felt.addEventListener('click', openNote);
    dock.appendChild(felt);
    const end = document.querySelector('#strip .strip-end');
    if (end) {
      dock.classList.add('in-strip');
      end.insertBefore(dock, document.getElementById('strip-cmd') || end.firstChild);
    } else document.body.appendChild(dock);
  }

  document.addEventListener('keydown', e => {
    if (on && e.altKey && e.shiftKey && e.code === 'KeyN' && !e.repeat) { e.preventDefault(); openNote(); }
  });

  function openNote() {
    if (panel) { closeNote(); return; }
    const after = Date.now() < alertUntil;
    const error = after ? alertWords : '';
    chosenTag = '';
    panel = document.createElement('div');
    panel.id = 'tester-note';
    panel.className = 'tester-note liquid-glass deep tester-ui';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Something felt off');
    const where = screenNow();
    panel.innerHTML = '<h2 class="tester-note-title">Something felt off</h2>'
      + '<p class="tester-note-hint">Pick what it was, add a few words if you like. The screen you are on, your last few actions and any error that just happened are saved with it. '
      + 'It is one of the two places your own words are kept, so leave out anything private.</p>'
      + (error ? '<p class="tester-note-error" id="tester-note-error"></p>' : '')
      + '<div class="tester-tags" role="group" aria-label="What was it">' + TAGS.map(([id, label]) => '<button type="button" class="tester-tag" data-tag="' + id + '" aria-pressed="false">' + label + '</button>').join('') + '</div>'
      + '<label class="sr-only" for="tester-note-text">What felt off</label>'
      + '<textarea id="tester-note-text" maxlength="600" rows="3" placeholder="For example: Pause took a few seconds to react"></textarea>'
      + '<div class="tester-note-row"><span class="tester-note-where" id="tester-note-where"></span>'
      + '<button type="button" class="btn" id="tester-note-cancel">Cancel</button>'
      + '<button type="button" class="btn primary" id="tester-note-save">Save note</button></div>';
    document.body.appendChild(panel);
    panel.querySelector('#tester-note-where').textContent = 'On: ' + where;
    const errorLine = panel.querySelector('#tester-note-error');
    if (errorLine) errorLine.textContent = 'Just now: ' + error;
    const text = panel.querySelector('#tester-note-text');
    text.focus();
    panel.querySelectorAll('.tester-tag').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tag');
      chosenTag = chosenTag === id ? '' : id;
      panel.querySelectorAll('.tester-tag').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-tag') === chosenTag)));
      text.focus();
    }));
    panel.querySelector('#tester-note-cancel').addEventListener('click', closeNote);
    panel.querySelector('#tester-note-save').addEventListener('click', () => {
      const words = text.value.trim();
      if (!words && !chosenTag) { text.focus(); return; }
      push({ k: 'note', text: words.slice(0, 600) || undefined, tag: chosenTag || undefined, screen: where, last: actions.slice(), after_err: after || undefined,
        err: error || undefined, pstate: printerState || undefined });
      flush(false);
      closeNote();
      if (typeof toast === 'function') toast('Saved your note in the tester report', 'ok', 2600);
    });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeNote(); } });
  }

  function closeNote() {
    if (panel) { panel.remove(); panel = null; }
    if (felt) felt.focus();
  }

  /* ---- the Settings card ------------------------------------------------------------------------------- */

  const $t = id => document.getElementById(id);
  let sure = 0, statusAt = 0, lastInfo = null;
  // The online demo's made-up figures. They match the sample report page (tools/tester-sample-report.py; a test keeps them in step).
  const SAMPLE = { days: 6, actions: 459, errors: 2, slow: 26, since: 'sample', last: 'sample' };

  const when = iso => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
  function fill(info) {
    lastInfo = info;
    const problem = info.write_failures || info.refused ? " Some events could not be written to this computer's disk. Is it full?" : '';
    ['days', 'actions', 'errors', 'slow'].forEach(k => { const el = $t('tester-' + k); if (el) el.textContent = String(info[k] == null ? 0 : info[k]); });
    const since = $t('tester-since');
    if (since) since.textContent = info.since === 'sample' ? 'Sample numbers, made up to show the layout.' : info.since
      ? 'Recording since ' + when(info.since) + '. Last event ' + when(info.last) + '. ' + (info.notes ? info.notes + ' note' + (info.notes === 1 ? '' : 's') + '. ' : '')
        + (info.thinned ? 'The record was long, so ' + info.thinned.toLocaleString() + ' routine events were summed up; errors and slow spots are all kept. ' : '')
      : 'Nothing recorded yet. Use Deja Vu1 as usual.';
    if (since && problem) since.textContent += problem;
    window.dispatchEvent(new CustomEvent('tester-status', { detail: info }));
  }

  async function refreshCard(force) {
    const card = $t('tester-card');
    const demo = inDemo();
    if (!card || (!demo && !card.offsetParent && !force)) return;       // the card is not on screen: nothing to draw
    card.classList.toggle('is-demo', demo);
    const note = $t('tester-demo-note');
    if (note) note.hidden = !demo;
    const live = $t('tester-live'), offNote = $t('tester-off-note');
    if (demo) {
      if (live) live.hidden = false;
      if (offNote) offNote.hidden = true;
      fill(SAMPLE);
      return;
    }
    const running = wanted();
    if (live) live.hidden = !running;
    if (offNote) offNote.hidden = running || !ready || (typeof modGate !== 'undefined' && modGate.at === 0);
    if (!running || !card.offsetParent) return;
    if (!force && Date.now() - statusAt < 4000) return;
    statusAt = Date.now();
    try {
      const res = await nativeFetch('/api/tester/status');
      if (res.ok) fill(await res.json());
    } catch (_) { /* the numbers stay as they were */ }
  }

  function status(text) { const el = $t('tester-status'); if (el) el.textContent = text; }

  function openReport() {
    const dialog = $t('tester-dialog'), host = $t('tester-frame-host');
    if (!dialog || !host) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    // The frame exists only while the report is open: a sandboxed frame has no scripts and no access to this page.
    const frame = document.createElement('iframe');
    frame.id = 'tester-frame';
    frame.title = 'Tester report';
    frame.setAttribute('sandbox', '');
    frame.src = inDemo() ? 'tester-report-sample.html' : '/api/tester/report.html?theme=' + (dark ? 'dark' : 'light');
    host.textContent = '';
    host.appendChild(frame);
    try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
    push({ k: 'study', ev: 'report_viewed' });
  }

  /* Build the zip on the server and hand it to the browser as a download. Resolves { ok, name, size, error }. */
  async function downloadReport() {
    try {
      const res = await nativeFetch('/api/tester/report.zip');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || 'The report could not be built.' };
      }
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const name = match ? match[1] : 'deja-vu1-tester-report.zip';
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.className = 'tester-ui';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 30000);
      const size = blob.size >= 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB';
      push({ k: 'study', ev: 'report_saved', n: blob.size });
      flush(false);
      return { ok: true, name, size, bytes: blob.size };
    } catch (_) {
      return { ok: false, error: 'The report could not be saved. Deja Vu1 may be restarting; try again in a moment.' };
    }
  }

  async function saveReport(button) {
    button.disabled = true;
    status('Building the report…');
    const done = await downloadReport();
    status(done.ok ? 'Saved ' + done.name + ' (' + done.size + '). Attach it to your forum message.' : done.error);
    button.disabled = false;
  }

  async function deleteData(button) {
    if (!sure) {
      sure = setTimeout(() => { sure = 0; button.textContent = 'Delete tester data'; }, 6000);
      button.textContent = 'Press again to delete everything';
      return;
    }
    clearTimeout(sure);
    sure = 0;
    button.textContent = 'Delete tester data';
    try {
      const res = await nativeFetch(EVENTS_URL.replace('events', 'delete'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      status(res.ok ? 'Everything Tester mode recorded was deleted from this computer, your answers too.' : 'Nothing was deleted: Tester mode is off for this run.');
      queue = [];
      agg.clear();
      refreshCard(true);
      window.dispatchEvent(new CustomEvent('tester-deleted'));
    } catch (_) {
      status('Nothing was deleted. Deja Vu1 may be restarting; try again in a moment.');
    }
  }

  document.addEventListener('click', e => {
    const hit = e.target.closest && e.target.closest('#tester-view, #tester-save, #tester-delete, #tester-close');
    if (!hit) return;
    if (hit.id === 'tester-view') openReport();
    else if (hit.id === 'tester-save') saveReport(hit);
    else if (hit.id === 'tester-delete') deleteData(hit);
    else if (hit.id === 'tester-close') { const d = $t('tester-dialog'); if (d) d.close(); }
  });
  document.addEventListener('close', e => {
    if (e.target && e.target.id === 'tester-dialog') { const host = $t('tester-frame-host'); if (host) host.textContent = ''; }
  }, true);

  // The app calls syncModuleBodies() right after it learns whether a module is on: when the list is read at
  // start-up and every 20 s. Following it makes the recorder follow the server's answer (it stops if Tester mode is off for this run).
  const syncBodies = window.syncModuleBodies;
  if (typeof syncBodies === 'function') {
    window.syncModuleBodies = function () {
      const out = syncBodies.apply(this, arguments);
      sync();
      refreshCard();
      return out;
    };
  }
  window.addEventListener('dv-tab', () => setTimeout(refreshCard, 100));
  window.addEventListener('dv-section', () => setTimeout(refreshCard, 100));
  setInterval(() => { if (!document.hidden) refreshCard(); }, 10000);

  // Start once the app knows whether a server is here (the online demo has none and is never recorded).
  const gate = typeof serverReady === 'function' ? serverReady() : Promise.resolve(true);
  Promise.resolve(gate).then(() => { ready = true; sync(); refreshCard(); }, () => {});
  document.addEventListener('DOMContentLoaded', () => { sync(); refreshCard(); });

  window.Tester = {
    isOn: () => on, flush: () => flush(false), screen: screenNow, wanted, demo: inDemo,
    event: (kind, fields) => { if (on) push(Object.assign({ k: kind }, fields || {})); },
    download: downloadReport, view: openReport, refresh: refreshCard, state: () => lastInfo
  };
})();
