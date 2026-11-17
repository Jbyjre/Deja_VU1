/* tester.js: Tester mode in the browser.
 *
 * Two jobs, both idle until Settings > Tester mode is switched on (the server enforces the switch: with it
 * off every /api/tester route answers 403, and this file records nothing and sends nothing):
 *
 *   1. The recorder. It watches how the app is used (screens, presses, requests, errors, slow spots, how
 *      smoothly the 3D twin and the G-code preview draw) and sends small batches to POST /api/tester/events.
 *      Everything stays on this computer: the server keeps it in its data folder and nothing leaves unless
 *      the tester saves the zip and attaches it to a message.
 *   2. The Settings card: the switch, the counts so far, View report, Save tester report, Delete tester data,
 *      and a "Something felt off" button on every screen while recording.
 *
 * It never records what is typed into a field, a file's name, a picture, or an address. A control is named by its
 * id or an action word (data-tab, data-act...); a button's own words are used only when it has neither, and
 * the server hides anything that looks private before it is written. In the online demo nothing is sent.
 */
(() => {
  'use strict';
  const EVENTS_URL = '/api/tester/events';
  const FLUSH_MS = 4000, FLUSH_AT = 50, MAX_QUEUE = 3000, AGG_MS = 5 * 60 * 1000;
  const SLOW_CLICK = 1000, SLOW_REQ = 2000, LONG_TASK = 200, SAMPLE_EVERY = 20000, SAMPLE_MS = 3000;
  const nativeFetch = window.fetch.bind(window);

  let on = false, sid = '', queue = [], sending = false, flushTimer = 0, firstSample = 0;
  let screenName = '', screenSince = 0, visTotal = 0, visSince = 0;
  let lastLayers = null, sampling = false, lastClick = null, clickCtx = null;
  const actions = [];                       // the last few things done, saved with an error or a note
  const agg = new Map();                    // routine background requests, summed up in five-minute groups
  let errBurst = { at: 0, n: 0 }, lastErr = { msg: '', at: 0 };

  const inDemo = () => typeof tour !== 'undefined' && tour.on;
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('');
  const base = path => String(path || '').split(/[\\/]/).pop().split('?')[0].slice(0, 48);

  /* ---- is it on? ------------------------------------------------------------------------------ */

  function wanted() {
    if (inDemo() || (typeof serverMissing === 'function' && serverMissing())) return false;
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
    queue = [];
    actions.length = 0;
    visTotal = 0;
    visSince = document.hidden ? 0 : performance.now();
    screenName = '';
    push({ k: 'session', ev: 'start', device: window.innerWidth <= 720 ? 'phone' : 'desk', w: window.innerWidth, h: window.innerHeight,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100 });
    push(setup());
    noteScreen();
    watchLongTasks();
    clearTimeout(firstSample);
    firstSample = setTimeout(sample, 6000);     // a first smoothness sample soon after recording starts, then every 20 s
    clearInterval(flushTimer);
    flushTimer = setInterval(() => { aggFlush(false); flush(false); }, FLUSH_MS);
  }

  function stop() {
    // Turning it off stops the recording at once: what is waiting here is thrown away, not sent.
    on = false;
    queue = [];
    agg.clear();
    unwatchLongTasks();
    clearTimeout(firstSample);
    clearInterval(flushTimer);
  }

  function setup() {
    const ua = navigator.userAgent || '';
    const pick = [[/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/Firefox\/([\d.]+)/, 'Firefox'], [/Chrome\/([\d.]+)/, 'Chrome'],
      [/Version\/([\d.]+).*Safari/, 'Safari']].map(([re, name]) => { const m = re.exec(ua); return m && [name, m[1].split('.')[0]]; }).find(Boolean) || ['other', ''];
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux' : 'other';
    const root = document.documentElement;
    return { k: 'setup', browser: pick[0], bver: pick[1], ua_os: os, w: window.screen.width, h: window.screen.height,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, look: root.dataset.ui || 'glass', theme: root.dataset.theme || 'light',
      lang: (root.lang || navigator.language || 'en').split('-')[0].slice(0, 8), touch: (navigator.maxTouchPoints || 0) > 0,
      density: root.dataset.density || 'comfortable', motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full' };
  }

  /* ---- sending -------------------------------------------------------------------------------- */

  function push(event) {
    if (!on) return;
    event.t = event.t || Date.now();
    event.s = sid;
    queue.push(event);
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
      if (res.status === 403) { stop(); paintFelt(); }          // switched off somewhere else
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
    if (screenName && screenSince) push({ k: 'screen', screen: screenName, ms: Math.max(0, Math.round(now - screenSince)), t: Date.now() - Math.round(now - screenSince) });
  }

  function noteScreen() {
    if (!on) return;
    const next = screenNow(), now = performance.now();
    if (next === screenName) return;
    closeVisit(now);
    screenName = next;
    screenSince = now;
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
    'data-merge-direction', 'data-hold', 'data-case', 'data-material', 'data-sr-act'];
  const SAFE_WORD = /^[A-Za-z0-9:_-]{1,32}$/;
  const FILE_WORD = /\S+\.(gcode|gco|bgcode|3mf|stl|obj|step|stp|amf|ufp|ply|zip|png|jpe?g|gif|webp|mp4|webm|mov)\b/gi;

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

  function onClick(e) {
    if (!on || !e.isTrusted) return;
    const target = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (!target || target.closest('#tester-felt, #tester-note')) return;
    const t0 = performance.now();
    const rec = { k: 'click', ctl: describe(target), screen: screenNow(), t: Date.now(), t0, pending: 0, req: 0, route: '', paint: null, closed: false, sent: false };
    clickCtx = rec;
    lastClick = rec;
    remember('click ' + rec.ctl);
    // The next paint: a task queued from inside the animation frame runs after the browser has drawn it.
    requestAnimationFrame(() => setTimeout(() => { rec.paint = Math.round(performance.now() - t0); settle(rec); }, 0));
    setTimeout(() => { if (clickCtx === rec) clickCtx = null; rec.closed = true; settle(rec); }, 300);
    setTimeout(() => settle(rec, true), 20000);
  }

  function settle(rec, force) {
    if (rec.sent || !on) return;
    if (!force && (rec.paint === null || !rec.closed || rec.pending > 0)) return;
    rec.sent = true;
    const event = { k: 'click', ctl: rec.ctl, screen: rec.screen, t: rec.t, paint: rec.paint === null ? undefined : rec.paint };
    if (rec.req) { event.req = rec.req; event.route = rec.route; }
    if ((rec.paint || 0) > SLOW_CLICK) event.slow = true;
    push(event);
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

  function pushError(kind, msg, file, line, col) {
    if (!on) return;
    msg = String(msg || '').slice(0, 300);
    const now = Date.now();
    if (msg === lastErr.msg && now - lastErr.at < 1000) return;
    lastErr = { msg, at: now };
    if (now - errBurst.at > 60000) errBurst = { at: now, n: 0 };
    if (++errBurst.n > 100) return;
    push({ k: 'err', kind, msg, file: file ? base(file) : undefined, line, col, screen: screenNow(), last: actions.slice() });
  }

  window.addEventListener('error', e => {
    if (e.target && e.target !== window) {
      if (/^(SCRIPT|LINK)$/.test(e.target.tagName)) pushError('resource', 'Could not load ' + base(e.target.src || e.target.href));
      return;
    }
    pushError('js', e.message || (e.error && e.error.message) || 'Script error', e.filename, e.lineno, e.colno);
  }, true);
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    pushError('promise', r && r.message ? r.message : String(r));
  });

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
        }
      } catch (_) { /* recording never changes what the app does */ }
      return toastNow.apply(this, arguments);
    };
  }

  let watcher = null;
  function watchLongTasks() {
    if (watcher) return;
    try {
      watcher = new PerformanceObserver(list => {
        if (!on) return;
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK) continue;
          const recent = lastClick && performance.now() - lastClick.t0 < 1500 ? lastClick.ctl : undefined;
          push({ k: 'long', ms: Math.round(entry.duration), screen: screenNow(), ctl: recent });
        }
      });
      watcher.observe({ entryTypes: ['longtask'] });
    } catch (_) { watcher = null; /* this browser has no long-task timing: slow clicks and requests are still recorded */ }
  }
  function unwatchLongTasks() {
    if (watcher) { try { watcher.disconnect(); } catch (_) { /* nothing to do */ } watcher = null; }
  }

  /* ---- smoothness ---------------------------------------------------------------------------------- */

  window.addEventListener('dv-state', e => {
    const st = e.detail;
    lastLayers = st && st.layer && st.layer.total ? +st.layer.total : null;
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
  document.addEventListener('click', onClick, true);

  /* ---- Something felt off ------------------------------------------------------------------------------ */

  let felt = null, panel = null;

  function paintFelt() {
    if (!on) {
      if (felt) { felt.remove(); felt = null; }
      if (panel) { panel.remove(); panel = null; }
      return;
    }
    if (felt) return;
    felt = document.createElement('button');
    felt.type = 'button';
    felt.id = 'tester-felt';
    felt.className = 'tester-felt liquid-glass';
    felt.textContent = 'Something felt off';
    felt.setAttribute('aria-haspopup', 'dialog');
    felt.addEventListener('click', openNote);
    document.body.appendChild(felt);
  }

  function openNote() {
    if (panel) { closeNote(); return; }
    panel = document.createElement('div');
    panel.id = 'tester-note';
    panel.className = 'tester-note liquid-glass deep';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Something felt off');
    const where = screenNow();
    panel.innerHTML = '<h2 class="tester-note-title">Something felt off</h2>'
      + '<p class="tester-note-hint">Say what you saw. This note, the screen you are on and your last few actions are saved in the report. '
      + 'It is the only place your own words are kept, so leave out anything private.</p>'
      + '<label class="sr-only" for="tester-note-text">What felt off</label>'
      + '<textarea id="tester-note-text" maxlength="600" rows="4" placeholder="For example: Pause took a few seconds to react"></textarea>'
      + '<div class="tester-note-row"><span class="tester-note-where" id="tester-note-where"></span>'
      + '<button type="button" class="btn" id="tester-note-cancel">Cancel</button>'
      + '<button type="button" class="btn primary" id="tester-note-save">Save note</button></div>';
    document.body.appendChild(panel);
    panel.querySelector('#tester-note-where').textContent = 'On: ' + where;
    const text = panel.querySelector('#tester-note-text');
    text.focus();
    panel.querySelector('#tester-note-cancel').addEventListener('click', closeNote);
    panel.querySelector('#tester-note-save').addEventListener('click', () => {
      const words = text.value.trim();
      if (!words) { text.focus(); return; }
      push({ k: 'note', text: words.slice(0, 600), screen: where, last: actions.slice() });
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
  let sure = 0, statusAt = 0;
  const SAMPLE = { days: 5, actions: 1284, errors: 3, slow: 7, since: 'sample', last: 'sample' };

  const when = iso => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
  function fill(info) {
    ['days', 'actions', 'errors', 'slow'].forEach(k => { const el = $t('tester-' + k); if (el) el.textContent = String(info[k] == null ? 0 : info[k]); });
    const since = $t('tester-since');
    if (since) since.textContent = info.since === 'sample' ? 'Sample numbers, made up to show the layout.' : info.since
      ? 'Recording since ' + when(info.since) + '. Last event ' + when(info.last) + '. ' + (info.notes ? info.notes + ' note' + (info.notes === 1 ? '' : 's') + '. ' : '')
        + (info.thinned ? 'The record was long, so ' + info.thinned.toLocaleString() + ' routine events were summed up; errors and slow spots are all kept. ' : '')
      : 'Nothing recorded yet. Use Deja Vu1 as usual.';
  }

  async function refreshCard(force) {
    const card = $t('tester-card');
    if (!card) return;
    const demo = inDemo();
    card.classList.toggle('is-demo', demo);
    const note = $t('tester-demo-note');
    if (note) note.hidden = !demo;
    const live = $t('tester-live');
    if (demo) {
      const sw = $t('tester-setting');
      if (sw) { sw.checked = true; sw.disabled = true; }
      if (live) live.hidden = false;
      fill(SAMPLE);
      return;
    }
    if (live) live.hidden = !wanted();
    if (!wanted() || !card.offsetParent) return;
    if (!force && Date.now() - statusAt < 4000) return;
    statusAt = Date.now();
    try {
      const res = await nativeFetch('/api/tester/status');
      if (res.ok) fill(await res.json());
    } catch (_) { /* the numbers stay as they were */ }
  }

  function status(text) { const el = $t('tester-status'); if (el) el.textContent = text; }

  function openReport() {
    const dialog = $t('tester-dialog'), frame = $t('tester-frame');
    if (!dialog || !frame) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    frame.src = inDemo() ? 'demo/tester-report-sample.html' : '/api/tester/report.html?theme=' + (dark ? 'dark' : 'light');
    try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
  }

  async function saveReport(button) {
    button.disabled = true;
    status('Building the report…');
    try {
      const res = await nativeFetch('/api/tester/report.zip');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        status(body.error || 'The report could not be built.');
        return;
      }
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const name = match ? match[1] : 'deja-vu1-tester-report.zip';
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 30000);
      const size = blob.size >= 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB';
      status('Saved ' + name + ' (' + size + '). Attach it to your forum message.');
    } catch (_) {
      status('The report could not be saved. Deja Vu1 may be restarting; try again in a moment.');
    } finally {
      button.disabled = false;
    }
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
      status(res.ok ? 'Everything Tester mode recorded was deleted from this computer.' : 'Nothing was deleted: Tester mode is off. Switch it on first.');
      queue = [];
      agg.clear();
      refreshCard(true);
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
    if (e.target && e.target.id === 'tester-dialog') { const f = $t('tester-frame'); if (f) f.src = 'about:blank'; }
  }, true);

  // The app calls syncModuleBodies() right after it learns whether a module is on: when the list is read at
  // start-up and every 20 s, and the moment a switch is flipped here. Following it makes the recorder start
  // and stop as the switch moves.
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
  document.addEventListener('DOMContentLoaded', () => { sync(); refreshCard(); });

  window.Tester = { isOn: () => on, flush: () => flush(false), screen: screenNow };
})();
