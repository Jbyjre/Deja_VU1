/* Deja Vu1 dashboard, part 3 of 7: saved settings, first-visit hints, which printer the dashboard shows,
 * announcements, honest commands, temperature units, the browser tab title, accent colour, connection state, the
 * browser-only preview, tabs, sections and the status ribbon.
 * Loaded right after app-demo.js (index.html keeps the order). The parts share one global scope: names from
 * earlier parts are used here as is, and code that runs at load only calls what is already defined above.
 */
/* localStorage can throw (private browsing in some browsers, or site data
 * blocked). Remembered choices are a convenience, so a failure here must
 * never stop the dashboard loading. */
/* This browser's memory. A browser that blocks saved site data (strict privacy settings, some private windows) makes
 * localStorage throw, so a value then goes to the tab's own memory (sessionStorage), and failing that to the page, so
 * the setup screen and the chosen screen at least hold until the tab closes or reloads. set() says whether the value
 * will outlive the tab. */
const store = (() => {
  const page = new Map();
  const tries = [() => localStorage, () => sessionStorage];
  return {
    get(key) {
      for (const area of tries) { try { const v = area().getItem(key); if (v !== null) return v; } catch (_) { /* blocked */ } }
      return page.has(key) ? page.get(key) : null;
    },
    set(key, value) {
      for (const [i, area] of tries.entries()) { try { area().setItem(key, value); return i === 0; } catch (_) { /* blocked or full */ } }
      page.set(key, String(value));
      return false;
    },
    remove(key) {
      for (const area of tries) { try { area().removeItem(key); } catch (_) { /* blocked */ } }
      page.delete(key);
    },
  };
})();

/* Familiar: once someone has opened the app a few times and used a few screens, the beginner help
 * steps aside: the "Show me this screen" buttons and each screen's intro line. They come back with
 * Preferences → "Show beginner tips again" (or Ctrl+K, "tips"). Remembered in this browser only. */
window.Familiar = (() => {
  const OPENS = 'dejavu1.opens', USED = 'dejavu1.used', FORCE = 'dejavu1.tips';
  const OPENS_NEEDED = 4, SCREENS_NEEDED = 3;
  let opens = (+store.get(OPENS) || 0) + 1;
  store.set(OPENS, String(opens));
  let used = [];
  try { used = JSON.parse(store.get(USED) || '[]'); } catch (_) { used = []; }
  const familiar = () => store.get(FORCE) !== 'on' && opens >= OPENS_NEEDED && new Set(used).size >= SCREENS_NEEDED;
  const mark = () => document.documentElement.classList.toggle('familiar', familiar());
  mark();
  window.addEventListener('dv-tab', e => {
    const tab = e.detail && e.detail.tab;
    if (tab && !used.includes(tab)) { used.push(tab); store.set(USED, JSON.stringify(used.slice(-40))); mark(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const on = document.getElementById('tips-on'), off = document.getElementById('tips-off');
    const paint = () => { on && on.classList.toggle('active', !familiar()); off && off.classList.toggle('active', familiar()); };
    if (on) on.addEventListener('click', () => { store.set(FORCE, 'on'); mark(); paint(); });
    if (off) off.addEventListener('click', () => { api.tipsAway(); paint(); });
    paint();
  });
  const api = {
    familiar, opens: () => opens,
    tipsAgain() { store.set(FORCE, 'on'); mark(); },
    tipsAway() { store.set(FORCE, ''); opens = Math.max(opens, OPENS_NEEDED); store.set(OPENS, String(opens)); used = [...new Set([...used, 'overview', 'control', 'files'])]; store.set(USED, JSON.stringify(used)); mark(); }
  };
  return api;
})();

const STORE_KEY = 'dejavu1.demo';
let demoOn = store.get(STORE_KEY) === '1';

/* A real printer (added by address) with its connection open. Live figures
 * come from either source: demo data, or a connected printer. */
let realOn = false;
function liveData() { return demoOn || realOn; }

/* Which printer the whole dashboard is looking at. Every request carries
 * ?printer=<id>, and the server answers every module for that printer. */
const PRINTER_KEY = 'dejavu1.printer';
let currentPrinter = store.get(PRINTER_KEY) || '';

function api(path) {
  const params = [];
  if (demoOn) params.push('demo=1');
  if (currentPrinter) params.push(`printer=${encodeURIComponent(currentPrinter)}`);
  return params.length ? path + (path.includes('?') ? '&' : '?') + params.join('&') : path;
}

/* ---- announcements --------------------------------------------------------
 * One polite live region for toasts, so screen-reader users hear the same
 * "Paused - confirmed" or "Pause failed" a sighted user sees. */

/* Copy text for a bug report. navigator.clipboard only exists on https://
 * and localhost, and a phone on the LAN reaches this over plain http, so
 * fall back to the old select-and-copy - and say so if both are refused. */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) { /* fall through to the fallback */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  area.remove();
  return ok;
}

function toast(message, kind = 'info', ms = 4200, options) {
  // The notification orb (orb.js) shows and keeps every message when it is loaded.
  if (window.Orb) return Orb.notify(message, kind, ms, options);
  const host = $('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast liquid-glass is-${kind}`;
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 400); }, ms);
}

/* ---- honest commands --------------------------------------------------------
 * Every control action follows the same three steps, and never skips one:
 *   1. the button says what is being sent, straight away ("Pausing…")
 *   2. the server sends the command, then re-reads the printer
 *   3. the button shows what the printer now actually reports - or the
 *      failure, in words, if the printer refused or the request failed.
 * The UI never flips to "Paused" because the button was pressed; only
 * because the printer said so. */

async function runCommand(button, path, body, labels) {
  const original = button ? button.textContent : '';
  const started = performance.now();
  if (button) {
    button.disabled = true;
    button.dataset.phase = 'sending';
    button.textContent = labels.sending;
  }
  let result;
  try {
    result = await postJSON(api(path), body || {});
  } catch (err) {
    result = { ok: false, status: 0, body: { error: 'Could not reach the dashboard server' } };
  }
  const ms = Math.round(performance.now() - started);
  if (button) delete button.dataset.phase;
  if (!result.ok) {
    const why = result.body.error || `HTTP ${result.status}`;
    if (button) { button.textContent = original; button.disabled = false; button.dataset.phase = 'failed'; setTimeout(() => delete button.dataset.phase, 2400); }
    toast(`${labels.failed}: ${why}`, 'bad', 7000);
    if (window.Workshop) Workshop.refreshPrinter();
    return { ok: false, result };
  }
  const state = result.body.confirmed_state;
  // Hands-on printer commands show up in the G-code console straight away.
  if (/^\/api\/printer\/control\//.test(String(path).replace(/^https?:\/\/[^/]+/, '').split('?')[0]) && typeof loadPrinterConsole === 'function') setTimeout(loadPrinterConsole, 0);
  const confirmed = !labels.expect || (state && labels.expect(state));
  if (state && window.Workshop) Workshop.applyState(state, true);
  if (button) { button.textContent = original; button.disabled = false; button.dataset.phase = confirmed ? 'done' : 'failed'; setTimeout(() => delete button.dataset.phase, 1600); }
  // "Confirmed by the printer" only when the printer's own state was read
  // back and checked - saving a rule or a queue entry is not a printer act.
  if (confirmed && labels.expect && state) toast(`${labels.done}: confirmed by the printer in ${ms} ms`, 'ok');
  else if (confirmed) toast(`${labels.done} (${ms} ms)`, 'ok');
  else toast(`${labels.done.split(' ')[0]} sent, but the printer now reports "${state ? state.state : 'unknown'}"`, 'warn', 7000);
  return { ok: true, result, confirmed };
}

/* One part of the screen that can't draw must never blank the others: the
 * live update draws the ribbon, the cards, the twin and the controls in turn,
 * and an error in one used to skip every part after it. The failure is said
 * once per part, in words a person can pass on, and logged in full. */
const drawFailed = new Set();
function drawSafely(part, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`Deja Vu1: ${part} could not be drawn`, err);
    if (!drawFailed.has(part)) {
      drawFailed.add(part);
      toast(`${part} couldn't be drawn (${err && err.message ? err.message : err}). The rest of the dashboard ` +
        'keeps working. Please send this message to the developer.', 'bad', 15000);
    }
    return undefined;
  }
}

function hasData(payload) {
  return payload && payload.connected !== undefined
    ? (payload.connected || payload.demo)
    : Boolean(payload);
}

function isModuleDisabled(payload) {
  return Boolean(payload && payload.module_disabled);
}

/* Every switched-off panel, old or new, reads the same way: which module,
 * where its switch lives, and the switch itself. */
function moduleDisabledEmpty(name) {
  const id = modGate.idOf[name];
  return `
  <div class="empty is-off">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(name)}</p>
    <p class="empty-sub">${modGate.kindOf[id] === 'extra' ? 'Switched off in Settings → Optional extras.' : 'Switched off.'}</p>
    ${id ? `<button class="btn small" type="button" data-turn-on="${esc(id)}">Turn on</button>` : ''}
  </div>`;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest && e.target.closest('[data-turn-on]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.turnOn;
  btn.disabled = true;
  btn.textContent = 'Turning on…';
  const { ok, body } = await postJSON(api(`/api/modules/${id}/toggle`), { enabled: true });
  if (!ok) {
    btn.disabled = false;
    btn.textContent = 'Turn on';
    toast(`Couldn't turn it on: ${body.error || 'the server refused'}`, 'bad', 6000);
    return;
  }
  toast(`${modGate.nameOf[id] || 'Module'} is on`, 'ok', 2200);
  await refreshAll();
  if (window.showTab) window.showTab(store.get(TAB_KEY) || 'overview');
});

const STATUS_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'OK' };

function stagger(nodes, step = 45) {
  nodes.forEach((node, i) => { node.style.animationDelay = `${i * step}ms`; });
}

/* Panels on the five-second refresh used to rebuild their rows every time,
 * so each row replayed its entrance animation and the panel visibly
 * flickered. paint() leaves an unchanged panel alone, and once a panel has
 * shown its rows it marks itself settled, which turns the entrance
 * animation off for later updates (style.css, .is-settled). Returns true
 * when it painted for the first time, so callers stagger only then. */
const painted = new WeakMap();
function paint(host, html) {
  if (!host || painted.get(host) === html) return false;
  const first = !painted.has(host);
  host.classList.toggle('is-settled', !first);
  host.innerHTML = html;
  painted.set(host, html);
  return first;
}

const EMPTY = (title, sub) => {
  // Every "No printer connected" card names an added printer that isn't answering instead.
  const away = title === 'No printer connected' && unreachablePrinter();
  if (away) [title, sub] = unreachableWords(away);
  return `
  <div class="empty">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(title)}</p>
    <p class="empty-sub">${esc(sub)}</p>
  </div>`;
};

/* ---- temperature units --------------------------------------------------
 * A real user-facing preference: stored per-viewer, used everywhere a
 * temperature is displayed. */

const UNIT_KEY = 'dejavu1.units';
let tempUnit = store.get(UNIT_KEY) === 'F' ? 'F' : 'C';

function formatTemp(celsius) {
  if (celsius === null || celsius === undefined) return '—';
  const value = tempUnit === 'F' ? (celsius * 9 / 5) + 32 : celsius;
  return `${value.toFixed(0)}°${tempUnit}`;
}

/* When a print should finish, as a time on the clock rather than a duration:
 * "4:12 PM", "tomorrow 1:05 AM", or "Sat 9:40 AM" further out. Empty when
 * there is no estimate. The estimate is the one used everywhere else here
 * (elapsed time scaled by progress), so it is only as good as that. */
function doneAt(hoursLeft) {
  if (hoursLeft == null || !isFinite(hoursLeft) || hoursLeft < 0) return '';
  const at = new Date(Date.now() + hoursLeft * 3600e3);
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date())) / 864e5);
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
}

/* Time left from a printer state: elapsed time scaled by progress, the same
 * estimate the fleet uses (backend/fleet.py). Null when there isn't one. */
function hoursLeft(state) {
  const p = state && state.progress, elapsed = state && state.print_duration_hours;
  return state && state.state === 'printing' && p > 0 && p < 1 && elapsed != null ? elapsed / p - elapsed : null;
}

/* ---- the browser tab mirrors the print -------------------------------------
 * With the dashboard in a background tab, its title and icon still say how
 * the print is going: "46% · Demo printer 1", "Paused · …", "Finished · …".
 * The icon draws the same progress ring. Both change only when what they
 * show changes, not on every live update. */
const BASE_TITLE = document.title;
const tabMirror = { title: null, icon: null };
function mirrorInTab(data) {
  const s = data && data.state;
  const name = (data && data.printer_name) || 'Printer';
  const pct = s ? Math.round((data.progress || 0) * 100) : 0;
  const lead = { printing: `${pct}%`, paused: 'Paused', complete: 'Finished', error: 'Needs attention' }[s];
  const title = lead ? `${lead} · ${name} · Deja Vu1` : BASE_TITLE;
  if (title !== tabMirror.title) { document.title = title; tabMirror.title = title; }

  // Redrawn per whole percent, not per live update.
  const key = `${s}|${pct}|${document.documentElement.style.getPropertyValue('--accent')}`;
  if (key === tabMirror.icon) return;
  tabMirror.icon = key;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a8df8';
  const color = { paused: '#d9a400', error: '#e5483e', complete: '#2fa84f' }[s] || accent;
  const frac = s === 'printing' || s === 'paused' ? Math.max(0.02, pct / 100) : s === 'complete' ? 1 : 0;
  const c = 2 * Math.PI * 12;
  const ring = frac
    ? `<circle cx='16' cy='16' r='12' fill='none' stroke='${color}' stroke-opacity='.22' stroke-width='5'/>` +
      `<circle cx='16' cy='16' r='12' fill='none' stroke='${color}' stroke-width='5' stroke-linecap='round' stroke-dasharray='${(c * frac).toFixed(1)} ${c.toFixed(1)}' transform='rotate(-90 16 16)'/>`
    : `<circle cx='16' cy='16' r='12' fill='none' stroke='${color}' stroke-width='4'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>${ring}<circle cx='16' cy='16' r='5' fill='${color}'/></svg>`;
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ---- accent colour -------------------------------------------------------
 * A real user-facing preference: swaps the CSS custom properties every
 * accent-coloured element already reads from. */

// Blue is the default. Each accent carries its own text-on-fill colour
// ("on") and text colour, measured for WCAG AA against it.
const ACCENTS = [
  // darkText: the accent as text on the dark theme's panels (#18212d), 7:1 or better.
  { id: 'blue', label: 'Sky Blue', hex: '#4a8df8', light: '#7db2ff', on: '#04122b', text: '#1d5fc8', darkText: '#9cc4ff' },
  { id: 'orange', label: 'Snapmaker Orange', hex: '#ff7a2f', light: '#ff9c66', on: '#2a1200', text: '#a8430a', darkText: '#ffb48a' },
  { id: 'red', label: 'Signal Red', hex: '#c8102e', light: '#d42640', on: '#ffffff', text: '#a50d26', darkText: '#ff9aa6' },
  { id: 'green', label: 'Grass Green', hex: '#2f9e44', light: '#5cc16f', on: '#04200c', text: '#1d6d31', darkText: '#8fdc9f' },
];
// Only a colour you picked is remembered. (The old key was written on every
// load, so every browser had "orange" stored whether or not it was chosen;
// a deliberate red or green there is still honoured.)
const ACCENT_KEY = 'dejavu1.accent-choice';
const OLD_ACCENT_KEY = 'dejavu1.accent';

function applyAccent(id) {
  const accent = ACCENTS.find(a => a.id === id) || ACCENTS[0];
  document.documentElement.style.setProperty('--accent', accent.hex);
  document.documentElement.style.setProperty('--accent-light', accent.light);
  document.documentElement.style.setProperty('--on-accent', accent.on);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.style.setProperty('--accent-text', dark ? accent.darkText : accent.text);
  document.documentElement.dataset.accent = accent.id;
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.classList.toggle('is-active', el.dataset.accent === accent.id);
  });
}

function initPreferences() {
  const host = $('accent-swatches');
  host.innerHTML = ACCENTS.map(a => `
    <button class="accent-swatch" data-accent="${a.id}" aria-label="${esc(a.label)}"
            style="background:${a.hex};"></button>
  `).join('');
  host.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.addEventListener('click', () => { applyAccent(btn.dataset.accent); store.set(ACCENT_KEY, btn.dataset.accent); });
  });
  const old = store.get(OLD_ACCENT_KEY);
  applyAccent(store.get(ACCENT_KEY) || (old === 'red' || old === 'green' ? old : 'blue'));

  // Light / Dark / System (theme-boot.js applies it before the page is drawn).
  const showTheme = () => {
    const pref = window.DVTheme ? DVTheme.get() : 'light';
    document.querySelectorAll('[data-theme-choice]').forEach(b => {
      const on = b.dataset.themeChoice === pref;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  document.querySelectorAll('[data-theme-choice]').forEach(b => b.addEventListener('click', () => {
    if (window.DVTheme) DVTheme.set(b.dataset.themeChoice);
  }));
  window.addEventListener('dv-theme', () => { showTheme(); applyAccent(document.documentElement.dataset.accent); });
  showTheme();

  // Glass (the default) / Workbench / Control room (theme-boot.js applies it before the page is drawn).
  const showLook = () => {
    const look = window.DVTheme ? DVTheme.look() : 'glass';
    document.querySelectorAll('[data-look-choice]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lookChoice === look)));
  };
  document.querySelectorAll('[data-look-choice]').forEach(b => b.addEventListener('click', () => {
    if (window.DVTheme) DVTheme.setLook(b.dataset.lookChoice);
  }));
  window.addEventListener('dv-ui', showLook);
  showLook();

  // Comfortable / Compact spacing (theme-boot.js applies it before the page is drawn).
  const showDensity = () => {
    const density = window.DVTheme ? DVTheme.density() : 'comfortable';
    document.querySelectorAll('[data-density-choice]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.densityChoice === density)));
  };
  document.querySelectorAll('[data-density-choice]').forEach(b => b.addEventListener('click', () => {
    if (window.DVTheme) DVTheme.setDensity(b.dataset.densityChoice);
  }));
  window.addEventListener('dv-density', showDensity);
  showDensity();

  const setUnits = (unit) => {
    tempUnit = unit;
    store.set(UNIT_KEY, unit);
    $('units-c').classList.toggle('active', unit === 'C');
    $('units-f').classList.toggle('active', unit === 'F');
    loadPrinterControl();
    renderOverviewControl(lastPrinterState);
  };
  $('units-c').addEventListener('click', () => setUnits('C'));
  $('units-f').addEventListener('click', () => setUnits('F'));
  setUnits(tempUnit);
}

/* ---- connection state ---------------------------------------------------*/

async function loadConnection() {
  const data = await getJSON('/api/connection');
  if (data.server_missing) return;          // showServerMissing() has said so already
  const pill = $('conn');
  const label = $('conn-label');
  const wasReal = realOn;
  realOn = !!data.connected || (data.printers || []).some(p => p.connected);
  // With a real printer, demo data is a Settings choice, not a switch in the top bar.
  document.body.classList.toggle('has-printer', realOn);
  // A printer connecting (or dropping) while the page is open: open or
  // close the live connection to match, without waiting for a reload.
  if (wasReal !== realOn && window.Workshop) setTimeout(() => Workshop.reconnect(), 0);

  pill.classList.toggle('is-live', !!data.connected);
  if (data.connected) {
    pill.classList.remove('is-demo');
    label.textContent = 'Connected';
    $('foot-state').textContent = 'Connected to Moonraker.';
  } else if (demoOn) {
    pill.classList.add('is-demo');
    label.textContent = 'Simulated';
    $('foot-state').textContent = 'Demo data: no printer connected, nothing is contacted.';
  } else {
    pill.classList.remove('is-demo');
    label.textContent = 'Not connected';
    $('foot-state').textContent = (data.printers || []).length
      ? data.message : 'No printer connected. Nothing is contacted.';
  }

  // Demo data stays labelled: the chip says Simulated, the switch beside it is on, and this is the whole sentence.
  pill.title = demoOn && !data.connected ? 'Demo data: no printer is connected, so every figure is simulated.' : '';
}

/* ---- no server: a browser-only preview ----------------------------------
 * One banner says what's missing and what still works. Every card that
 * needs the server keeps its heading (so you can see what the dashboard
 * does) and says so in one line, instead of an empty box or an offer of
 * demo data that can't run. Demo data is switched off, not hidden: the
 * simulated printers live on the server too. */
const RUN_IT_URL = 'https://github.com/Jbyjre/Deja_VU1#install';
const BROWSER_ONLY = '[data-browser-only], [data-module-off], #sb-off, #ap-off, #demo-tools-card, #file-detail';

function needsServerNote(what) {
  return `<p class="needs-server-note">${what ? `${esc(what)} needs` : 'Needs'} the Deja Vu1 server, which isn't running at this address.
    <a href="${RUN_IT_URL}" target="_blank" rel="noopener">How to run it</a></p>`;
}

function needsServerEmpty(what) {
  return `
  <div class="empty is-off">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">Needs the Deja Vu1 server</p>
    <p class="empty-sub">${esc(what ? `${what[0].toUpperCase()}${what.slice(1)} runs` : 'This runs')} on the server, which isn't running at this address.
      <a href="${RUN_IT_URL}" target="_blank" rel="noopener">How to run it</a></p>
  </div>`;
}

/* Printers added by address, from the dashboard's own list (/api/fleet/registry,
 * loaded by workshop.js): names and link words, never printer figures. */
let addedPrinters = [];

/* The added printer this screen is waiting for, when none of them answers. With
 * demo data off, "No printer connected" would read as if it had been removed. */
function unreachablePrinter() {
  if (demoOn || serverMissing() || !addedPrinters.length || addedPrinters.some(p => p.connected)) return null;
  return addedPrinters.find(p => p.id === currentPrinter) || addedPrinters[0];
}

async function loadAddedPrinters() {
  const data = await getJSON('/api/fleet/registry').catch(() => null);
  if (data && Array.isArray(data.printers)) addedPrinters = data.printers;
}

/* [title, sub] for a printer that was added but isn't answering. */
function unreachableWords(p) {
  const why = String(p.link || '').replace(/^Not connected:\s*/i, '').replace(/[.\s]+$/, '');
  if (!why || /^connecting/i.test(why)) {
    return [`Connecting to ${p.name}…`, 'This takes a few seconds once it is switched on.'];
  }
  // When the two addresses show they are on different networks, that is the likely reason, so it is said first.
  const hint = p.network_hint && (p.network_hint.short || p.network_hint.words);
  return [`${p.name} isn't answering`,
    `${why}. ${hint || 'Check it is switched on and that this computer can reach its network.'} The dashboard keeps trying, and looks for it at a new address by itself.`];
}

/* "No printer" wording, unless there's no server to have a printer at all. */
function noPrinterEmpty(sub, what) {
  return serverMissing() ? needsServerEmpty(what) : EMPTY('No printer connected', sub);
}

function showServerMissing() {
  document.body.classList.add('no-server');
  $('server-banner').hidden = false;

  const toggle = $('demo-toggle');
  demoOn = false;                       // the remembered choice is kept for when the server is back
  toggle.checked = false;
  toggle.disabled = true;
  toggle.closest('.switch').title = 'Demo data runs on the Deja Vu1 server, which isn\'t running at this address.';
  toggle.setAttribute('aria-describedby', 'server-banner-text');

  const pill = $('conn');
  pill.classList.remove('is-demo');
  pill.classList.add('is-offline');
  $('conn-label').textContent = 'No server';
  $('printer-chip').hidden = true;
  $('foot-state').textContent = 'Browser-only preview: the Deja Vu1 server isn\'t running at this address.';
  $('rb-text').textContent = 'Browser-only preview - no printer or demo farm without the server.';

  document.querySelectorAll('.tab-panel section.card').forEach(card => {
    if (card.matches(BROWSER_ONLY) || card.querySelector(':scope > .needs-server-note')) return;
    card.classList.add('needs-server');
    const head = card.querySelector(':scope > .card-head');
    if (head) head.insertAdjacentHTML('afterend', needsServerNote());
    else card.insertAdjacentHTML('afterbegin', needsServerNote(card.dataset.serverWhat || card.querySelector('h2')?.textContent.trim()));
  });
  if (window.Workshop) Workshop.reconnect();
}

function initServerBanner() {
  document.querySelectorAll('#server-banner [data-go]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.go)));
  $('server-retry').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Checking…';
    let here = false;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      here = r.status !== 404 && (r.headers.get('content-type') || '').includes('application/json');
    } catch (_) { here = false; }
    if (here) { location.reload(); return; }
    btn.disabled = false; btn.textContent = 'Check again';
    toast('Still no server at this address.', 'warn');
  });
}

/* ---- tabs -----------------------------------------------------------------*/

const TAB_KEY = 'dejavu1.tab';
/* One plain sentence per tab, behind the ? button in the top bar, so a first-time
   visitor knows what each section is for before reading it. */
const TAB_NAMES = { overview: 'Overview', fleet: 'Printers', control: 'Printer', files: 'Files', studio: 'Photo studio',
  ai: 'AI', automations: 'Automations', maintenance: 'Maintenance', prefs: 'Preferences', modules: 'Settings', games: 'Games' };
const TAB_INTROS = {
  ai: 'What your own AI can do here: watch prints through the camera, diagnose a print from a photo, add a spool from a photo and more. Deja Vu1 works fully without one.',
  overview: 'What is happening now: what needs you, the selected printer, its camera and temperatures, and your printers.',
  fleet: 'All your printers side by side. Add a printer here, or practise on pretend ones.',
  control: 'Everything about one printer: its live 3D twin and camera, moving and heating it, tuning, its readings and its history. If the printer says no, you see why.',
  files: 'Your print files. Look inside them, prepare and slice models, and queue prints. Every print gets checked before it starts.',
  studio: 'Turn a photo into a colour print, using the filaments you have loaded.',
  automations: '“When this happens, do that” rules, like a message when a print finishes. They run on this computer, not in the cloud.',
  maintenance: 'Keep the printer in shape: upkeep reminders from real print hours, a logbook, and your spools.',
  prefs: 'How the dashboard looks and behaves on this device: units, warm-up buttons, cameras, the background and more.',
  modules: 'Updates, which features are on, your phone, messages and your data.',
  games: 'Something to play while a print runs. Nothing here touches a printer.',
};

/* ---- sections: one part of a busy screen at a time -------------------------
   Screens with many cards open on their first part, with a row of buttons
   for the others and "Everything" for the old long page. Cards are sorted
   by their title (or id), so a card another script adds later lands in its
   part; a card no rule names joins the first part, so nothing is ever lost.
   Anything that scrolls to a card in a hidden part (search, tours, "Slice…"
   buttons) opens that part first. */
const SECTIONS = {
  control: [
    ['control', 'Control', ['#pp-head', '#twin-card', '#pp-camera-card', '#pp-move', '#pp-heaters', '#pp-extrude', '#pp-tune',
      '#pp-outputs', '#pp-mesh', '#pp-macros', '#pp-console', '#pp-print', '#ctrl-plate']],
    ['live', 'Live readings', ['#telemetry', '#chamber-card']],
    ['history', 'History & upkeep', ['#insights-card', 'print health', 'print cost']],
    ['camera', 'Camera & time-lapses', ['#camera-card', '#timelapse-card']],
  ],
  fleet: [
    ['printers', 'Your printers', ['your printers', 'add a printer']],
    ['desk', 'Farm desk', ['#tab-desk', 'farm history']],
    ['sandbox', 'Practice farm', ['#tab-sandbox']],
  ],
  files: [
    ['library', 'Your files', ['#orca-import', '#convert-card', 'file library', '#file-detail', '#studio-link']],
    ['slicing', 'Slice', ['#tab-autoprint']],
    ['jobs', 'Queue', ['print queue']],
    ['layers', 'Layer heights', ['#tab-layerplan']],
  ],
  maintenance: [
    ['upkeep', 'Maintenance', ['maintenance', '#logbook', 'swapped a nozzle']],
    ['filament', 'Filament', ['#tab-filament']],
  ],
  modules: [
    ['copy', 'This copy', ['your space', '#demo-card', '#watch-only-card', '#phone-install-card', '#version-card', '#desktop-card', '#about-card', '#memory-card', 'printer firmware', '#demo-tools-card']],
    ['extras', 'Optional extras', ['optional extras']],
    ['phone', 'Phone & away', ['paired devices', '#remote-card']],
    ['alerts', 'Alerts & smart home', ['notifications', 'wled bridge', 'home assistant bridge']],
    ['tester', 'Tester mode', ['#tester-card']],
  ],
};
const SECTION_KEY = 'dejavu1.section.';
// Fixed ids for each screen's row of parts, so tours can point at them.
const SECTION_BAR_IDS = { control: 'sec-control', fleet: 'sec-fleet', files: 'sec-files', maintenance: 'sec-maintenance', modules: 'sec-modules' };

window.Sections = (() => {
  const chosen = {};
  const UNIT = 'section.card, section.stats, .tab-sub';
  const unitsOf = panel => [...panel.querySelectorAll(UNIT)].filter(u => !u.parentElement.closest(UNIT));
  const titleOf = u => (u.querySelector('h2')?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const matches = (u, rule, title) => rule[0] === '#' ? u.id === rule.slice(1)
    : rule[0] === '.' ? u.classList.contains(rule.slice(1)) : title.startsWith(rule);
  function groupOf(tab, unit) {
    const title = titleOf(unit);
    const hit = SECTIONS[tab].find(([, , rules]) => rules.some(r => matches(unit, r, title)));
    return (hit || SECTIONS[tab][0])[0];
  }
  function apply(tab) {
    const panel = $(`tab-${tab}`), groups = SECTIONS[tab];
    if (!panel || !groups) return;
    const now = chosen[tab];
    panel.classList.toggle('sec-one', now !== 'all');
    const units = unitsOf(panel);
    const wrappers = new Set();
    units.forEach(u => {
      u.classList.toggle('sec-off', now !== 'all' && groupOf(tab, u) !== now);
      for (let p = u.parentElement; p && p !== panel; p = p.parentElement) wrappers.add(p);
    });
    // A grid or column whose every card is in another part goes too, so no gap is left.
    wrappers.forEach(w => w.classList.toggle('sec-off', units.some(u => w.contains(u)) && units.every(u => !w.contains(u) || u.classList.contains('sec-off'))));
    // A two-column row left with one card gives it the whole width.
    panel.querySelectorAll('.grid-2').forEach(g => g.classList.toggle('sec-single',
      [...g.children].filter(c => !c.hidden && !c.classList.contains('sec-off')).length === 1));
    // The row of parts lives in the page bar (#pb-tabs), not inside the panel.
    const bar = $(SECTION_BAR_IDS[tab]);
    if (bar) bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sec === now)));
  }
  function choose(tab, key, remember = true) {
    if (!SECTIONS[tab] || (key !== 'all' && !SECTIONS[tab].some(([k]) => k === key))) return;
    const panel = $(`tab-${tab}`), was = new Set(unitsOf(panel).filter(u => u.classList.contains('sec-off')));
    chosen[tab] = key;
    if (remember) store.set(SECTION_KEY + tab, key);
    apply(tab);
    window.dispatchEvent(new CustomEvent('dv-section', { detail: { tab, key } }));
    // Only the cards that just appeared fade in; the 5-second refresh never replays it.
    unitsOf(panel).filter(u => was.has(u) && !u.classList.contains('sec-off')).forEach(u => {
      u.classList.remove('sec-enter'); void u.offsetWidth; u.classList.add('sec-enter');
      const done = e => { if (e.target === u) { u.classList.remove('sec-enter'); u.removeEventListener('animationend', done); } };
      u.addEventListener('animationend', done);
    });
  }
  /* Opens the part that holds `el`, so it can be seen. */
  function reveal(el) {
    const panel = el?.closest?.('.tab-panel');
    const tab = panel?.id.replace(/^tab-/, '');
    if (!tab || !SECTIONS[tab] || !el.closest('.sec-off')) return;
    const unit = el.matches(UNIT) && !el.parentElement.closest(UNIT) ? el : unitsOf(panel).find(u => u.contains(el));
    if (unit) choose(tab, groupOf(tab, unit));
  }
  function init() {
    for (const tab of Object.keys(SECTIONS)) {
      const panel = $(`tab-${tab}`);
      if (!panel) continue;
      const saved = store.get(SECTION_KEY + tab);
      chosen[tab] = saved === 'all' || SECTIONS[tab].some(([k]) => k === saved) ? saved : SECTIONS[tab][0][0];
      const bar = document.createElement('nav');
      bar.className = 'sec-bar'; bar.id = SECTION_BAR_IDS[tab]; bar.dataset.tab = tab; bar.hidden = true;
      bar.setAttribute('aria-label', `Parts of ${TAB_NAMES[tab] || tab}`);
      bar.innerHTML = `<div class="sec-track">${[...SECTIONS[tab], ['all', 'Everything']].map(([k, label]) =>
        `<button type="button" data-sec="${k}" aria-pressed="false"${k === 'all' ? ' class="sec-all"' : ''}>${esc(label)}</button>`).join('')}</div>`;
      bar.addEventListener('click', e => {
        const b = e.target.closest('button[data-sec]');
        if (!b) return;
        choose(tab, b.dataset.sec);
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      const home = $('pb-tabs');            // the slim bar at the top; the panel itself only if the page has none
      if (home) home.append(bar); else { bar.hidden = false; panel.prepend(bar); }
      apply(tab);
      // Cards drawn later (telemetry, logbook, the farm desk…) are sorted as they arrive.
      let queued = 0;
      new MutationObserver(records => {
        if (queued || !records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && n.matches(UNIT)))) return;
        queued = requestAnimationFrame(() => { queued = 0; apply(tab); });
      }).observe(panel, { childList: true, subtree: true });
    }
    // Every way of jumping to a card (search, tours, links) goes through scrollIntoView.
    const scrollTo = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      // A folded section (<details>) opens when something points into it.
      const fold = this.closest && this.closest('details:not([open])');
      if (fold && fold !== this) fold.open = true;
      if (this.closest && this.closest('.sec-off')) reveal(this);
      return scrollTo.apply(this, args);
    };
  }
  return { init, reveal, choose, current: tab => chosen[tab] };
})();

function initTabs() {
  Sections.init();
  const tabs = document.querySelectorAll('.navtab[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');

  // Sections folded into another tab: their old names (a remembered tab,
  // a "Slice…" button, another device's handoff) open the parent tab and
  // scroll to the section.
  const FOLDED = { sandbox: 'fleet', autoprint: 'files', filament: 'maintenance' };

  function show(requested, initial = false) {
    const name = FOLDED[requested] || requested;
    tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
      if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    panels.forEach(p => { p.hidden = p.id !== `tab-${name}`; });
    store.set(TAB_KEY, name);
    document.body.dataset.tab = name;
    // The top of the page: the banner on Overview, the slim bar with this screen's parts elsewhere. The first call
    // only repeats what theme-boot.js chose from the link; pagebar.js settles it once the sidebar has opened the screen.
    if (!initial) document.documentElement.dataset.page = name === 'overview' ? 'overview' : 'page';
    document.querySelectorAll('#pb-tabs > .sec-bar').forEach(b => { b.hidden = b.dataset.tab !== name; });
    const intro = $('tab-intro');
    if (intro && TAB_INTROS[name]) intro.innerHTML = `<strong>${esc(TAB_NAMES[name] || name)}</strong> ${esc(TAB_INTROS[name])}`
      + (window.Guide && Guide.has(name) ? ` <button type="button" class="tips-btn" data-tips="${esc(name)}"><span aria-hidden="true">✦</span> Show me this screen</button>` : '');
    if (name === 'games') startCurrentGame();
    else stopCurrentGame();
    if (window.Workshop) Workshop.onTab(name);
    window.dispatchEvent(new CustomEvent('dv-tab', { detail: { tab: name } }));
    // A folded section's old name opens its part; after a short wait (the
    // cards above it fill in first) it scrolls there, so it doesn't slide away.
    if (FOLDED[requested]) {
      Sections.reveal($(`tab-${requested}`)?.querySelector('h2') || $(`tab-${requested}`));
      setTimeout(() => $(`tab-${requested}`)?.scrollIntoView({ block: 'start' }), 350);
    }
  }
  window.showTab = show;

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  $('overview-pair-btn').addEventListener('click', () => window.Phone && Phone.open());

  // Preferences → Open on: a fixed screen, or the one used last.
  const opening = store.get('dejavu1.pref.start');
  show(opening && opening !== 'last' ? opening : (store.get(TAB_KEY) || 'overview'), true);
}

/* ---- status ribbon (always visible) --------------------------------------*/

let lastPrinterState = null;

async function loadStatusRibbon() {
  renderStatusRibbon(await getJSON(api('/api/printer')));
}

/* The printer button in the top bar carries the state the old strip under the
 * tabs did: a word, the progress and the finish time, so it's never out of
 * sight on any tab. */
function renderChipStatus(data) {
  const chip = $('printer-chip'), status = $('pc-status'), bar = $('pc-progress');
  if (!chip || !status) return;
  const st = data && data.state ? (data.link_lost ? 'lost' : data.state) : 'none';
  if (chip.dataset.state !== st) chip.dataset.state = st;
  const running = st === 'printing' || st === 'paused';
  const finish = running ? doneAt(hoursLeft(data)) : '';
  const words = { printing: 'Printing', paused: 'Paused', complete: 'Finished', error: 'Stopped', ready: 'Ready', lost: 'No live link', none: '' }[st] || st;
  setText(status, running ? `${words} ${Math.round((data.progress || 0) * 100)}%` : words);
  setText($('pc-finish'), finish ? `done ${finish}` : '');
  const w = running || st === 'complete' ? `${((data.progress || 0) * 100).toFixed(1)}%` : '0%';
  if (bar && bar.style.width !== w) bar.style.width = w;
}

function renderStatusRibbon(data) {
  const ribbon = $('status-ribbon');
  const text = $('rb-text');
  const bar = $('rb-bar');
  const fill = $('rb-bar-fill');
  const pct = $('rb-pct');

  drawSafely('The printer button', () => renderChipStatus(data));
  if (!hasData(data) || !data.state) {
    ribbon.classList.remove('is-live');
    const away = unreachablePrinter();
    text.textContent = serverMissing() ? 'Browser-only preview - no printer or demo farm without the server.'
      : away ? `${unreachableWords(away)[0]}. Retrying by itself.` : 'No printer connected.';
    bar.hidden = true;
    pct.hidden = true;
    $('rb-done').hidden = true;
    lastPrinterState = null;
    mirrorInTab(null);
    renderOverviewControl(null);
    return;
  }

  lastPrinterState = data;
  mirrorInTab(data);
  const isPrinting = data.state === 'printing';
  ribbon.classList.toggle('is-live', isPrinting);

  if (data.state === 'ready' || data.state === 'error') {
    setText(text, data.state === 'error' ? `Error: ${data.state_message || ''}` : 'Ready for a print.');
    bar.hidden = true; pct.hidden = true; $('rb-done').hidden = true;
  } else {
    const word = { paused: 'Paused', complete: 'Finished' }[data.state] || 'Printing';
    const who = data.printer_name ? data.printer_name + ' · ' : '';
    setText(text, `${who}${word}: ${data.current_file || 'unknown file'}` + (data.link_lost ? ' · no live link, last reading' : ''));
    bar.hidden = false; pct.hidden = false;
    // Eases like the other progress visuals (Workshop.tween: each frame
    // closes a fixed fraction of the gap), so switching printers glides.
    const setFill = v => { fill.style.width = `${(v * 100).toFixed(2)}%`; };
    if (window.Workshop && Workshop.tween) Workshop.tween('ribbon', data.progress, setFill); else setFill(data.progress);
    setText(pct, `${Math.round(data.progress * 100)}%`);
    const finish = doneAt(hoursLeft(data));
    setText($('rb-done'), finish ? `done ${finish}` : '');
    $('rb-done').hidden = !finish;
  }

  drawSafely('Printer control on Overview', () => renderOverviewControl(data));
  drawSafely('The Control screen', () => renderControlTab(data));
}
