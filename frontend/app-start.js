/* Deja Vu1 dashboard, part 7 of 7: start-up and the "program stopped answering" notice.
 * Loaded right after app-extras.js (index.html keeps the order). The parts share one global scope: names from
 * earlier parts are used here as is, and code that runs at load only calls what is already defined above.
 */
/* ---- start up ------------------------------------------------------------*/

/* These same files are also published as a plain website (wrangler.jsonc ->
 * Cloudflare), with no Python server behind them. There the dashboard has
 * nothing to show, so it hands over to the product page. Only a 404 for
 * /api/modules means "no Deja Vu1 server here" (a static host answers
 * that for any file it doesn't have); a server that is down or unreachable
 * keeps the dashboard and its "Could not reach the backend" message.
 * ?demo (the online demo: a recording of the simulated farm, see "the
 * online demo" above) and ?dashboard skip the hand-over. */
if (!['dashboard', 'demo'].some(k => new URLSearchParams(location.search).has(k))) {
  fetch('/api/modules', { cache: 'no-store' })
    .then(r => { if (r.status === 404) location.replace('welcome.html'); })
    .catch(() => {});
}

/* The time at the bottom of the page is when the dashboard last heard from the
 * printer. It used to be written only on a full refresh, so it sat still (3:50:28
 * at 4:02) while live readings kept arriving. Now every live reading moves it, at
 * most once a second, and the 5-second refresh keeps it going without a printer. */
let stampAt = 0;
function stampNow() {
  const now = Date.now();
  if (now - stampAt < 1000) return;
  stampAt = now;
  const el = $('stamp');
  if (el) { el.textContent = `Updated ${new Date(now).toLocaleTimeString()}`; el.dateTime = new Date(now).toISOString(); }
}
window.addEventListener('dv-state', stampNow);

async function refreshAll() {
  try {
    await loadConnection();
    // Before the cards draw: an added printer that isn't answering is named in them.
    if (!liveData()) await loadAddedPrinters();
    await Promise.all([
      loadMaintenance(), loadRings(), loadColorCheck(), loadStatusRibbon(),
      loadFilament(), loadCompare(), loadModules(), loadDevices(),
      loadUpdates(), loadPrinterControl(), loadCost(),
    ]);
    if (window.Workshop) await Workshop.refresh();
    stampNow();
  } catch (err) {
    console.error('Dashboard failed to load:', err);
    $('foot-state').textContent = 'Could not reach the backend.';
  }
}

/* Segmented controls mark the chosen option with .active; screen readers
 * need that as aria-pressed. One observer keeps the two in step for every
 * .pill-toggle, whichever code changed it. */
function initPressedSync() {
  const sync = b => {
    // A radio reports its choice with aria-checked (set where it is chosen); aria-pressed is not allowed on it.
    if (b.getAttribute('role') === 'radio') b.removeAttribute('aria-pressed');
    else b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  };
  const watch = new MutationObserver(records => records.forEach(r => { if (r.target.tagName === 'BUTTON') sync(r.target); }));
  document.querySelectorAll('.pill-toggle').forEach(group => {
    group.querySelectorAll('button').forEach(sync);
    watch.observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

function initDemoToggle() {
  const toggle = $('demo-toggle');
  toggle.checked = demoOn;
  const mirror = $('demo-setting');
  if (mirror) {
    mirror.checked = demoOn;
    mirror.addEventListener('change', () => { toggle.checked = mirror.checked; toggle.dispatchEvent(new Event('change')); });
    toggle.addEventListener('change', () => { mirror.checked = toggle.checked; });
  }
  toggle.addEventListener('change', () => {
    demoOn = toggle.checked;
    store.set(STORE_KEY, demoOn ? '1' : '0');
    if (window.Workshop) Workshop.reconnect();
    refreshAll();
  });
}

serverReady();
initServerBanner();
initDemoToggle();
initPressedSync();
initTabs();
initPreferences();
initSpoolForm();
initWatchOnly();
initRepeatSettings();
initPairing();
initNotifications();
initCostSettings();
initBridges();
// initGames() now runs inside games.js when the Games tab first opens.
trackHighlights();
refreshAll();
loadNotificationSettings();

// Printer state itself arrives live (workshop.js, every 250 ms over the
// WebSocket). These slower panels only need a periodic refresh.
/* An update can come from anywhere: Install on another page or the phone,
 * automatic updates, or the one-paste command. A page left open would keep
 * running the old dashboard against the new server, so each page notices the
 * new version and reloads (or offers to, while something is being typed). */
const updateWatch = { version: null, offered: false };
async function watchForUpdate() {
  if (serverMissing() || (typeof tourOn === 'function' && tourOn())) return;
  let info;
  try { info = await (await fetch('/api/app/info', { cache: 'no-store' })).json(); } catch (_) { return; }
  showWatchOnly(info && info.watch_only);
  const v = info && info.version;
  if (!v) return;
  // The build changes too on the "newest builds" channel, where the number can stay the same.
  const key = `${v}|${info.build || ''}`;
  if (!updateWatch.version) { updateWatch.version = key; return; }
  if (key === updateWatch.version || updateWatch.offered) return;
  updateWatch.offered = true;
  const el = document.activeElement;
  const typing = el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value));
  if (typing || document.querySelector('dialog[open]')) {
    toast(`Deja Vu1 was updated to v${v}. Reload this page to use it.`, 'info', 60000,
      { action: { label: 'Reload', run: () => location.reload() } });
  } else {
    toast(`Deja Vu1 was updated to v${v}. Reloading this page…`, 'ok', 3000);
    setTimeout(() => location.reload(), 1500);
  }
}
let updateTicks = 0;

/* ---- the program stopped answering ----------------------------------------
 * A page left open when Deja Vu1 stops (its window closed, an update
 * restarting, the computer asleep) used to sit there with stale figures. Now
 * it says so in a strip at the top, keeps trying every 4 seconds, and after
 * 20 seconds offers the page with the paste-in fix. When the program answers
 * again the strip goes, and a restarted program reloads the page. */
const QUIET_MS = 10000;       // how long the server must stay silent before the page says anything: a restart or a wake-up from sleep is over by then
const serverWatch = { fails: 0, since: 0, pid: null, el: null, shown: false };
function serverStrip(text, help) {
  if (!serverWatch.el) {
    const el = document.createElement('div');
    el.className = 'server-lost liquid-glass';
    el.setAttribute('role', 'status');
    el.innerHTML = '<i class="sl-dot" aria-hidden="true"></i><div class="sl-text"><b></b> <span></span> <a class="sl-start" href="deja-vu1://start" hidden>Start Deja Vu1</a> <a href="offline.html">How to start it again</a></div>';
    document.body.appendChild(el);
    serverWatch.el = el;
  }
  serverWatch.el.querySelector('b').textContent = text;
  serverWatch.el.querySelector('span').textContent = help;
  const longGone = help.includes('start');
  serverWatch.el.querySelector('a[href="offline.html"]').hidden = !longGone;
  // The start link only works on the computer Deja Vu1 runs on (it registers it there).
  serverWatch.el.querySelector('.sl-start').hidden = !longGone || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  serverWatch.el.hidden = false;
}
/* Who answers on this address. /api/app/alive does no slow work, so a busy moment on the server
 * (a GitHub check, the Windows Task Scheduler) can't make a healthy Deja Vu1 look stopped; an older
 * server without it is asked the long way. */
async function aliveInfo(signal) {
  for (const route of ['/api/app/alive', '/api/app/info']) {
    const r = await fetch(route, { cache: 'no-store', signal });
    if (r.status === 404) continue;
    return r.json();
  }
  return null;
}
async function watchServer() {
  if (serverMissing() || (typeof tourOn === 'function' && tourOn())) return;
  let d = null;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 6000);
  try { d = await aliveInfo(stop.signal); } catch (_) { d = null; }
  clearTimeout(timer);
  if (d && d.version) {
    const restarted = serverWatch.pid && d.server_pid && d.server_pid !== serverWatch.pid;
    serverWatch.pid = d.server_pid || serverWatch.pid;
    if (serverWatch.shown || restarted) {
      if (serverWatch.el) serverWatch.el.hidden = true;
      const el = document.activeElement;
      const typing = el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value));
      if (restarted && !typing && !document.querySelector('dialog[open]')) {
        toast('Deja Vu1 is back. Reloading this page…', 'ok', 3000);
        setTimeout(() => location.reload(), 1200);
      } else if (serverWatch.shown) toast('Deja Vu1 is answering again.', 'ok');         // only if the page had said it stopped
    }
    serverWatch.shown = false;
    serverWatch.fails = 0;
    return;
  }
  if (++serverWatch.fails === 1) serverWatch.since = Date.now();
  if (Date.now() - serverWatch.since < QUIET_MS) return;          // a short loss is carried through quietly (reads that fail ask for an early check, so this counts time, not checks)
  serverWatch.shown = true;
  let updating = 0;
  try { updating = Number(sessionStorage.getItem('dv-updating')) || 0; } catch (_) { updating = 0; }
  const secs = Math.round((Date.now() - serverWatch.since) / 1000);
  if (Date.now() - updating < 5 * 60 * 1000 && secs < 90) serverStrip('Deja Vu1 is restarting after the update.', 'This page carries on by itself in a moment. A print on your printer keeps going.');
  else if (secs < 20) serverStrip('Deja Vu1 stopped answering.', 'Trying again every few seconds…');
  else serverStrip('Deja Vu1 isn’t answering.', 'It starts again by itself within a few minutes if it is set to start with the computer. You can also press Start. This page reconnects by itself.');
}
setInterval(watchServer, 4000);

setInterval(() => {
  loadConnection().then(stampNow).catch(() => {});
  if (updateTicks++ % 3 === 0) watchForUpdate();
  if (liveData()) {
    loadRings(); loadColorCheck(); loadCost();
    if (!window.Workshop || !Workshop.isLive()) loadStatusRibbon();
  }
}, 5000);
