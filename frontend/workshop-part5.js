/* workshop-part5.js: part 5 of 5 of workshop.js, the live connection, fleet, files, automations and Liquid Glass
 * 2.0. Split out of the one closure workshop.js was (18 November 2026) so a session reads only the part it needs.
 * Loaded before workshop.js, after workshop-part4.js; it hands its names on through WorkshopPart5. Holds: bindTimelapse, celebrate,
 * checkHandoff, closeDialog, connect, convertFromCard, honourReducedMotion, init, initConfirm, initConverterCard,
 * initDialogs, initFiles, initFleet, initPhone, loadRules, loadTimelapse, nudgeLive, onEvent, onTab, openLocalFiles,
 * openPrinterMenu, playFlipbook, reconnect, refresh, renderFleet, ruleForm, selectPrinter, showSummary,
 * startPolling, uploadFiles, watchLive
 */
'use strict';
const WorkshopPart5 = (() => {
  const { REDUCED, STATE_COLOR, STATE_HEX, STATE_WORD, attention, badge, demoNeeded, enc, findPrinters, fmtHours,
    live, loadRegistry, money, printerName, qs, qsa, renderAttention, renderChip, ringSVG, showTest, since,
    tintRoom, wsState } = WorkshopPart1;
  const { LOCAL_MAX_BYTES, ar, files, kindOf, loadChamber, loadHealth, renderTwin } = WorkshopPart2;
  const { ACTIONS, PRESETS, TRIGGERS, aiOn, closeFile, currentTab, deviceId, flipbookVideo, initBlobResize,
    initCameraForm, initDemoTools, initDockStack, initGlassMenu, initHoldToCancel, initPressGlow, initScrollEdge,
    initSwap, loadCamera, loadForecast, loadPrinterVideos, loadRuleLog, loadSideBySide, morph, moveTabBlob,
    openMenu, renderGate, reportView, sentence, stopCamera, syncNav, tlForget, tlKeep, tlReset } = WorkshopPart3;
  const { applyState, convertFile, loadFiles, loadQueue, openConfirm, openDialog, openFile, refreshPrinter, renderLocalFiles,
    startNext } = WorkshopPart4;

function reconnect() {
    live.closing = true;
    if (live.ws) { try { live.ws.close(); } catch (e) { /* already closed */ } }
    live.ws = null;
    clearInterval(live.poll);
    live.poll = null;
    live.retries = 0;
    live.closing = false;
    connect();
  }

function connect() {
    if (!liveData()) { live.mode = 'off'; badge(); tintRoom({}); return; }
    // The online demo plays a recording through the same requests polling
    // makes (app.js, "the online demo"); there is no server to open a socket to.
    if (!('WebSocket' in window) || tourOn()) { startPolling(); return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // demo=1 only when demo data is on: a real printer's live feed must
    // never be asked for (or labelled as) simulated data.
    const params = demoOn ? ['demo=1', 'fleet=1'] : ['fleet=1'];
    if (currentPrinter) params.push(`printer=${enc(currentPrinter)}`);
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/api/live?${params.join('&')}`); }
    catch (e) { startPolling(); return; }
    live.ws = ws;
    ws.onopen = () => { clearInterval(live.poll); live.poll = null; live.mode = 'ws'; live.retries = 0; live.heardAt = performance.now(); badge(); };
    ws.onmessage = (e) => {
      if (live.ws !== ws) return;
      live.heardAt = performance.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg.type) { live.mode = 'off'; badge(); return; }          // {"connected":false,"demo":false}
      if (msg.type === 'state' && msg.printer === (currentPrinter || msg.printer)) {
        live.lastAt = performance.now();
        applyState(msg.state);
      } else if (msg.type === 'fleet') {
        drawSafely('Your printers', () => renderFleet(msg.printers));
      } else if (msg.type === 'event') {
        live.lastEvent = Math.max(live.lastEvent, msg.event.id);
        onEvent(msg.event);
      }
    };
    ws.onclose = () => {
      if (live.ws !== ws || live.closing) return;
      live.ws = null;
      if (!liveData()) { live.mode = 'off'; badge(); return; }
      live.retries += 1;
      if (live.retries >= 3) { startPolling(); return; }
      live.mode = 'reconnecting'; badge();
      setTimeout(() => { if (!live.ws && live.mode !== 'poll') connect(); }, 600 * live.retries);
    };
  }

  /* A phone that was locked, a laptop that slept, Wi-Fi that came back: the socket is often dead
   * without the page having been told. Come back to the front, or get the network back, and the live
   * connection is opened again at once instead of at the next slow retry. */
function nudgeLive() {
    if (!liveData() || tourOn() || document.hidden) return;
    if (live.mode !== 'ws' || (performance.now() - live.lastAt) > 5000) reconnect();
  }

  /* A link can die without the page being told (a router that dropped it, a computer that changed networks). The server
   * sends a line at least every 20 seconds, so a page that has heard nothing for 50 seconds opens a new link. */
  const LIVE_SILENT_MS = 50000;
function watchLive() {
    if (document.hidden || tourOn() || live.mode !== 'ws' || !live.ws) return;
    if (performance.now() - (live.heardAt || 0) > LIVE_SILENT_MS) reconnect();
  }

  /* Fallback when a WebSocket can't be opened (an old proxy, a strict
   * network): ask the same live cache once a second instead. Slower to
   * notice changes, but the numbers are the same. */
function startPolling() {
    live.mode = 'poll'; badge();
    clearInterval(live.poll);
    let tick = 0;
    const once = async () => {
      if (!liveData()) { clearInterval(live.poll); live.mode = 'off'; badge(); return; }
      const snap = await getJSON(api('/api/live/snapshot')).catch(() => null);
      if (snap && snap.state) { live.lastAt = performance.now(); applyState(snap.state); }
      const ev = await getJSON(api(`/api/live/events?since=${live.lastEvent}`)).catch(() => null);
      (ev && ev.events || []).forEach(e => { live.lastEvent = Math.max(live.lastEvent, e.id); onEvent(e); });
      if (tick++ % 2 === 0) {
        const fleet = await getJSON(api('/api/fleet')).catch(() => null);
        if (fleet && fleet.printers) drawSafely('Your printers', () => renderFleet(fleet.printers));
      }
      // Polling started because the WebSocket failed - often just a server
      // restart or a Wi-Fi blip. Try it again every 10 s; if it opens, it
      // stops this polling (ws.onopen).
      if (tick % 10 === 0 && 'WebSocket' in window && !live.ws && !tourOn()) connect();
    };
    once();
    live.poll = setInterval(once, 1000);
  }

function onEvent(event) {
    window.dispatchEvent(new CustomEvent('dv-live-event', { detail: event }));
    if (event.type === 'print_event') {
      const mine = !currentPrinter || event.printer === currentPrinter;
      const word = { started: 'started', finished: 'finished', failed: 'failed', paused: 'paused', resumed: 'resumed', cancelled: 'cancelled' }[event.event];
      if (event.event === 'finished' && event.summary) celebrate(event);
      else toast(`${event.printer_name}: print ${word}${event.file ? `: ${event.file}` : ''}`,
                 event.event === 'failed' ? 'bad' : 'info');
      // The roll a finished print was charged to, when there is something to check about it.
      if (event.event === 'finished' && event.filament && event.filament.reason) {
        toast(`${event.printer_name}: ${event.filament.reason}`, 'warn', 9000);
        if (typeof loadFilament === 'function') loadFilament();
      }
      if (mine) { loadHealth(); loadQueue(); loadTimelapse(); }
    } else if (event.type === 'printer_problem') {
      // backend/live_feed.py: the printer reported a problem (a code). Say what it is, and offer Snapmaker's explanation.
      const p = event.problem || {};
      const what = p.title ? `${p.title} (${p.code})` : `error ${p.code}`;
      const effect = { paused: ' The print is paused.', stopped: ' The print was stopped.' }[p.effect] || '';
      toast(`${event.printer_name}: ${what}.${effect}`, p.level >= 3 ? 'bad' : 'warn', 20000,
        window.ErrorHelp ? { action: { label: 'What does this mean?', run: () => ErrorHelp.open(p.code, event.printer) } } : undefined);
    } else if (event.type === 'automation') {
      toast(`Rule "${event.rule_name}": ${event.ok ? event.detail : event.error}`, event.ok ? 'ok' : 'warn', 6500);
      loadRuleLog();
      loadRules();
    } else if (event.type === 'ai_watch') {
      // backend/ai_assistant.py watch_tick: the AI looked at the camera during a print and something looked wrong.
      const what = event.verdict === 'failed' ? (event.paused ? 'the print looks failed, so it was paused' : 'the print looks failed') : 'the print may need a look';
      toast(`${event.printer_name || 'Printer'}: ${what}. ${event.why || ''}`, event.verdict === 'failed' ? 'bad' : 'warn', 15000);
    } else if (event.type === 'printer_moved') {
      // backend/refind.py: the same printer (same serial number) answered at another address.
      toast(`${event.printer_name} answered at a new address, ${event.to.replace(/^https?:\/\//, '')}. Deja Vu1 uses it now.`, 'ok', 9000);
      loadRegistry();
    } else if (event.type === 'queue') {
      if (event.started) toast(`Queue started ${event.started.filename}`, 'ok');
      if (event.held) toast(`Queue is holding ${event.held.filename}: ${event.held.note}`, 'warn', 8000);
      else if (event.bed && event.bed.state === 'awaiting_clear')
        toast(`${printerName(event.printer)}: take ${event.bed.file || 'the print'} off the bed, then press Part removed, bed clear in Files`, 'info', 8000);
      attention.queuesAt = 0;
      loadQueue();
    }
  }

  /* The chip's caret promised a list, so it opens one: every printer with
   * its state, picked without leaving the tab you're on. With one printer
   * (or none) there's nothing to choose, and it opens the Fleet tab. */
function openPrinterMenu(chip, fromKeyboard) {
    if (live.fleet.length < 2) { showTab('fleet'); return; }
    const current = currentPrinter || live.fleet[0].id;
    const items = live.fleet.map(p => ({
      value: p.id, current: p.id === current,
      html: `<span class="gm-dot" style="background:${STATE_HEX[p.state] || '#8e8e93'}" aria-hidden="true"></span>
             <span class="gm-label">${esc(p.name)}</span><span class="gm-note">${esc(STATE_WORD[p.state] || p.state || '')}${p.link_lost ? ' · no link' : ''}</span>`,
    }));
    items.push({ value: '__fleet', html: '<span class="gm-label">All printers</span><span class="gm-note">Fleet tab</span>', divider: true });
    openMenu(chip, items, (id) => {
      if (id === '__fleet') showTab('fleet');
      else if (id !== current) selectPrinter(id, null, true);
    }, 'Printers', fromKeyboard);
  }

function selectPrinter(id, fromEl, stay) {
    currentPrinter = id;
    store.set(PRINTER_KEY, id);
    window.dispatchEvent(new CustomEvent('dv-printer', { detail: { printer: id } }));
    if (live.ws && live.ws.readyState === 1) live.ws.send(JSON.stringify({ type: 'subscribe', printer: id, fleet: true }));
    else reconnect();
    renderChip();
    qsa('.fleet-card').forEach(c => c.classList.toggle('is-selected', c.dataset.printer === id));
    // From the chip's menu you stay where you were; the tab reloads for the
    // printer you picked. From a fleet card you go to that printer's own page.
    if (stay) { refreshAll(); onTab(currentTab()); toast(`Now showing ${printerName(id)}`, 'info', 2200); return; }
    const go = () => { showTab('control'); refreshAll(); };
    if (fromEl) morph(fromEl, () => qs('#tab-control .pp-stage') || qs('#tab-control'), go);
    else go();
    reportView();
  }

function renderFleet(printers) {
    live.fleet = printers || [];
    drawSafely('Needs you', () => renderAttention(live.fleet));
    // The remembered printer can be gone (removed, or a sandbox printer torn
    // down). Every request would then ask for an unknown printer and every
    // panel would say nothing is connected, so fall back to the default.
    if (currentPrinter && live.fleet.length && !live.fleet.some(p => p.id === currentPrinter)) {
      currentPrinter = '';
      store.set(PRINTER_KEY, '');
      reconnect();
      refreshAll();
      return;
    }
    renderChip();
    const grid = $('fleet-grid');
    if (!grid) return;
    if (!liveData()) { grid.innerHTML = demoNeeded('the fleet'); grid.dataset.ids = ''; return; }
    const ids = live.fleet.map(p => p.id).join(',');
    if (grid.dataset.ids !== ids) {
      grid.dataset.ids = ids;
      grid.innerHTML = live.fleet.map(p => `
        <article class="fleet-card liquid-glass" data-printer="${esc(p.id)}">
          <div class="fc-head">
            <label class="fc-pick" title="Select for fleet commands">
              <input type="checkbox" data-pick="${esc(p.id)}" aria-label="Select ${esc(p.name)} for fleet commands">
            </label>
            <h3 class="fc-name">${esc(p.name)}${p.sandbox ? ' <span class="fc-sim">sandbox</span>' : ''}</h3>
            <span class="fc-state" data-f="state"></span>
          </div>
          <p class="fc-kind" data-f="machine" hidden></p>
          <div class="fc-main">
            <div class="fc-ring" data-f="ring"></div>
            <div class="fc-info">
              <div class="fc-file" data-f="file"></div>
              <div class="fc-meta" data-f="meta"></div>
            </div>
          </div>
          <div class="fc-docks" data-f="docks" aria-label="Toolhead docks"></div>
          <div class="fc-temps" data-f="temps"></div>
          <ul class="fc-alerts" data-f="alerts"></ul>
          <div class="fc-queue" data-f="queue"></div>
          <div class="fc-foot">
            <button class="btn fc-open" type="button" data-open="${esc(p.id)}" aria-label="Open printer ${esc(p.name)}">Open printer</button>
            ${p.web_url && /^https?:\/\//.test(p.web_url) ? `<a class="fc-web" href="${esc(p.web_url)}" target="_blank" rel="noopener noreferrer" title="The web page built into the printer">Its own page ↗</a>` : ''}
          </div>
        </article>`).join('');
      qsa('[data-open]', grid).forEach(btn => btn.addEventListener('click', () => selectPrinter(btn.dataset.open, btn.closest('.fleet-card'))));
    }
    live.fleet.forEach(p => {
      const card = qs(`.fleet-card[data-printer="${CSS.escape(p.id)}"]`, grid);
      if (!card) return;
      const f = (k) => qs(`[data-f="${k}"]`, card);
      card.classList.toggle('is-selected', p.id === (currentPrinter || live.fleet[0].id));
      // Calm cards (no gradients, not colourful): the state is the dot and the ring.
      card.dataset.state = p.link_lost ? 'lost' : p.state || '';
      // Any printer but a U1 says what it is, from its own report (machines.py).
      const kind = f('machine'), other = p.machine && !p.machine.reference;
      kind.hidden = !other;
      if (other) { setText(kind, `${p.machine.label} · other Klipper printer`); kind.title = p.machine.note || ''; }
      const st = f('state');
      setText(st, STATE_WORD[p.state] || p.state);
      setVar(st, '--dot', STATE_COLOR[p.state] || '');
      // The ring is drawn once and then only its arc moves, so its CSS
      // transition can glide between readings instead of jumping.
      const ring = f('ring'), progress = Math.max(0, Math.min(1, p.progress || 0));
      if (!ring.firstElementChild) ring.innerHTML = `${ringSVG(progress, STATE_HEX[p.state])}<span class="fc-pct"></span>`;
      const arc = qs('.rs-fill', ring), circ = 2 * Math.PI * 15.5;
      setVar(arc, 'stroke', STATE_HEX[p.state] || '#8e8e93');
      // Ready draws a whole ring in ink: a printer waiting for work is up, never an empty grey circle.
      setVar(arc, 'stroke-dashoffset', String(p.state === 'ready' ? 0 : circ * (1 - progress)));
      setText(qs('.fc-pct', ring), p.state === 'ready' ? 'Ready' : `${Math.round(progress * 100)}%`);
      setText(f('file'), p.current_file || (p.state === 'error' ? p.state_message : 'Ready for a print'));
      setText(f('meta'), p.remaining_hours != null
        ? `${fmtHours(p.remaining_hours)} left · done ${doneAt(p.remaining_hours)}` : (p.state_message || ''));
      setHTML(f('docks'), Object.entries(p.docks || {}).map(([th, d]) => `
        <span class="fc-dock ${d.status}" title="${esc(th)}: ${esc(d.status)}">
          <span class="fc-dock-chip" style="background:${esc(d.color)}"></span>${esc(th)}
        </span>`).join(''));
      setHTML(f('temps'), `
        <span><small>Nozzle</small><b>${p.nozzle_temperature != null ? formatTemp(p.nozzle_temperature) : '—'}</b></span>
        <span><small>Bed</small><b>${formatTemp(p.bed_temperature)}</b></span>
        <span><small>Chamber</small><b>${p.chamber_temperature != null ? formatTemp(p.chamber_temperature) : '—'}</b></span>
        <span${p.health_band === 'blocked' ? ' class="is-blocked" title="Confirm Print would refuse the loaded job"' : ''}><small>Health</small><b>${p.health ?? '—'}${p.health_band === 'blocked' ? ' · can\'t start' : ''}</b></span>`);
      const alerts = p.alerts || [];
      setHTML(f('alerts'), alerts.length
        ? alerts.map(a => `<li class="fc-alert ${esc(a.level)}">${esc(a.text)}</li>`).join('')
        : '<li class="fc-alert ok">No alerts</li>');
      card.classList.toggle('is-stale', !!p.link_lost);
    });
    // The fleet command center (farm.js) adds selection, queues and drop targets.
    window.dispatchEvent(new CustomEvent('dv-fleet', { detail: live.fleet }));
  }

function initFleet() {
    $('printer-chip').addEventListener('click', (e) => openPrinterMenu(e.currentTarget, e.detail === 0));
    $('fleet-find').addEventListener('click', (e) => findPrinters(e.currentTarget));
    $('fleet-find-wider').addEventListener('click', (e) => findPrinters(e.currentTarget, true));
    $('fleet-add-test').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Testing…';
      const r = await postJSON('/api/printers/test', { moonraker_url: $('fleet-add-url').value, api_key: $('fleet-add-key').value });
      btn.disabled = false; btn.textContent = 'Test';
      // The address that answered (tidied, or on Moonraker's own port) is the one to add.
      if (r.ok && r.body.url && (r.body.ok || r.body.needs_key)) $('fleet-add-url').value = r.body.url;
      showTest(r.ok ? r.body : { ok: false, error: r.body.error });
    });
    $('fleet-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Signing in…';
      const r = await postJSON('/api/printers/login', { moonraker_url: $('fleet-add-url').value,
        username: $('fleet-login-user').value, password: $('fleet-login-pass').value });
      $('fleet-login-pass').value = '';
      btn.disabled = false; btn.textContent = 'Sign in';
      if (!r.ok) { showTest({ ok: false, needs_key: true, error: r.body.error }); return; }
      $('fleet-add-key').value = r.body.api_key;
      const t = await postJSON('/api/printers/test', { moonraker_url: r.body.url, api_key: r.body.api_key });
      showTest(t.ok ? t.body : { ok: false, error: t.body.error });
      if (t.ok && t.body.ok) toast('Signed in. The printer\'s key is filled in: press Add printer', 'ok', 6000);
    });
    $('fleet-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = e.submitter || e.target.querySelector('button[type=submit]');
      const label = submit ? submit.textContent : '';
      if (submit) { submit.disabled = true; submit.textContent = 'Checking the address…'; }
      // Add the address that really answers (a pasted web-page address becomes Moonraker's).
      // A printer that is switched off is still added; it connects when it comes on.
      const t = await postJSON('/api/printers/test',
        { moonraker_url: $('fleet-add-url').value, api_key: $('fleet-add-key').value });
      if (t.ok && t.body.url && (t.body.ok || t.body.needs_key)) $('fleet-add-url').value = t.body.url;
      if (submit) { submit.disabled = false; submit.textContent = label; }
      const r = await postJSON('/api/fleet/registry', { name: $('fleet-add-name').value, moonraker_url: $('fleet-add-url').value,
                                                         api_key: $('fleet-add-key').value });
      if (r.ok) { toast(`${r.body.name} added, connecting to it now`, 'ok', 5000); e.target.reset(); $('fleet-login').hidden = true; }
      else toast(`Couldn't add it: ${r.body.error}`, 'bad', 6000);
      loadRegistry();
      // Show the connection opening (or why it can't) without a reload.
      if (r.ok) [2000, 5000, 10000, 20000].forEach(ms => setTimeout(() => { loadRegistry(); refreshAll(); }, ms));
    });
  }

function openLocalFiles(list) {
    let last = null;
    for (const file of list) {
      const kind = kindOf(file.name);
      if (!kind) { toast(`${file.name} isn't a G-code, STL, OBJ or 3MF file`, 'warn'); continue; }
      if (file.size > LOCAL_MAX_BYTES) { toast(`${file.name} is over 64 MB - too big to open here`, 'warn'); continue; }
      files.local = files.local.filter(f => f.name !== file.name);
      files.local.unshift({ name: file.name, kind, local: file, origin: 'local', note: 'On this device - not uploaded' });
      last = file.name;
    }
    renderLocalFiles();
    if (last) openFile(last);
  }

async function uploadFiles(list) {
    if (serverMissing()) { openLocalFiles(list); return; }
    for (const file of list) {
      const act = window.Activity && Activity.add({ text: `Adding ${file.name} to your files`, go: 'files', label: 'Open Files' });
      const res = await fetch(`/api/files/upload?name=${enc(file.name)}`, { method: 'POST', body: file }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      const ok = !!(res && res.ok);
      toast(ok ? `Added ${body.name}` : `Couldn't add ${file.name}: ${body.error || (res ? res.status : 'the server did not answer')}`, ok ? 'ok' : 'bad', 6000);
      if (act) ok ? act.done(`Added ${body.name} to your files`) : act.fail(`Couldn't add ${file.name}`);
    }
    loadFiles();
  }

  /* The converter card: upload (or take the sample), open it, convert it, show the report. */
async function convertFromCard(name, button) {
    await loadFiles();
    if (!files.list.some(f => f.name === name)) { $('cv-note').textContent = `Couldn't find ${name} in the library.`; return; }
    await convertFile(name, button, $('cv-report'));
    $('cv-report').hidden = false;
  }

function initConverterCard() {
    const card = $('convert-card');
    if (!card) return;
    $('cv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (typeof tourOn === 'function' && tourOn()) {
        $('cv-note').textContent = 'The online demo converts the sample projects only. Run Deja Vu1 at home to convert your own files.';
        return;
      }
      if (!/\.3mf$/i.test(file.name)) { $('cv-note').textContent = 'Choose a .3mf project file.'; return; }
      $('cv-note').textContent = `Adding ${file.name}…`;
      const res = await fetch(`/api/files/upload?name=${enc(file.name)}`, { method: 'POST', body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('cv-note').textContent = `Couldn't add ${file.name}: ${body.error || res.status}`; return; }
      $('cv-note').textContent = `Converting ${body.name}…`;
      await convertFromCard(body.name, $('cv-sample'));
      $('cv-note').textContent = `${body.name}: report below. Open the U1 copy from the report or the library.`;
    });
    $('cv-sample').addEventListener('click', async (e) => {
      const btn = e.currentTarget, name = 'sample_makerworld_three_plates.3mf';
      try {
        if (!files.list.some(f => f.name === name)) await postJSON('/api/files/samples', {});
        $('cv-note').textContent = 'Converting the sample: a 3DBenchy and a gear on plate 1, a vase on plate 2, another Benchy on plate 3…';
        await convertFromCard(name, btn);
        $('cv-note').textContent = 'Sample converted: report below. Open the U1 copy to prepare and slice a plate.';
      } catch (err) { $('cv-note').textContent = err.message; }
    });
  }

function initFiles() {
    initConverterCard();
    $('file-upload').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });
    $('file-samples').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Adding… (about 15 s the first time)';
      const r = await postJSON('/api/files/samples', {});
      btn.disabled = false; btn.textContent = 'Add sample files';
      toast(r.ok ? (r.body.added.length ? `Added ${r.body.added.length} sample files` : 'The sample files are already here') : `Couldn't add samples: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadFiles();
    });
    // The whole Files screen takes a dropped file, not only the library's box.
    const lib = $('tab-files');
    const drop = $('file-drop');
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const showDrop = on => { drop.hidden = !on; document.documentElement.classList.toggle('is-dropping', on); };
    lib.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); showDrop(true); });
    lib.addEventListener('dragleave', (e) => { if (!lib.contains(e.relatedTarget)) showDrop(false); });
    lib.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); showDrop(false); uploadFiles([...e.dataTransfer.files]); });
    $('fd-close').addEventListener('click', closeFile);
    $('ar-exit').addEventListener('click', () => { if (ar.handle) ar.handle.end(); else $('ar-overlay').hidden = true; });
  }

function initConfirm() {
    $('confirm-cancel').addEventListener('click', () => closeDialog($('confirm-dialog')));
    $('confirm-go').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const name = wsState.confirmFile;
      const where = printerName(currentPrinter) || 'the printer';
      const act = window.Activity && Activity.add({ text: `Starting ${name} on ${where}`, go: 'printer', label: 'Open the Printer page' });
      const r = await runCommand(btn, '/api/printer/control/start', { filename: name, confirmed: true, bed_clear: !!($('confirm-bed-clear') && $('confirm-bed-clear').checked) }, {
        sending: 'Starting…', done: `Started ${name}`, failed: 'Start refused',
        expect: s => s.state === 'printing' && s.current_file === name,
      });
      if (act) r.ok ? act.done(`Started ${name} on ${where}`) : act.fail(`${where} did not start ${name}`);
      // A started print is watched on the Printer page, where the twin draws this file.
      if (r.ok) { closeDialog($('confirm-dialog')); goPlace('printer'); loadQueue(); }
      else if (r.result.body.gate) renderGate(r.result.body.gate);        // things changed: show why
    });
    // Each refusal's fix (print_gate.py, "fixes") lands on the place that fixes it. None of them starts a print.
    $('confirm-body').addEventListener('click', async e => {
      const b = e.target.closest('[data-fix]');
      if (!b) return;
      const name = wsState.confirmFile, kind = b.dataset.fix;
      if (kind === 'bed') { const t = $('confirm-bed-clear'); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } return; }
      if (kind === 'queue') {
        const r = await runCommand(b, '/api/queue/add', { filename: name }, { sending: 'Adding…', done: `Added ${name} to the queue`, failed: 'Could not queue it' });
        if (r.ok) { closeDialog($('confirm-dialog')); loadQueue(); goPlace('queue'); }
        return;
      }
      closeDialog($('confirm-dialog'));
      if (kind === 'slicer' && window.Slicer) Slicer.open(b.dataset.fixModel);
      else if (kind === 'nozzle' && window.Finder) { goPlace('maintenance'); setTimeout(() => Finder.go('#swap-form'), 120); }
      else goPlace('printer');
    });
  }

/* Goes to one of the rail's places (rail.js), or to the old tab where the rail isn't there. */
function goPlace(id) {
    if (window.Rail && Rail.goDest) Rail.goDest(id);
    else showTab({ printer: 'control', queue: 'files', maintenance: 'maintenance' }[id] || 'overview');
  }

function ruleForm() {
    const form = $('rule-form');
    const printers = live.fleet.length ? live.fleet : [];
    form.innerHTML = `
      <div class="rf-presets" role="group" aria-label="Start from an example"><p class="rf-presets-lead">Start from an example, then change anything:</p>
        ${[...new Set(PRESETS.filter(p => !p.ai || aiOn()).map(p => p.group))].map(g => `<div class="rf-group"><span class="rf-group-name">${esc(g)}</span>${PRESETS.map((p, i) => p.group === g && (!p.ai || aiOn())
          ? `<button class="chip-btn" type="button" data-preset="${i}">${esc(p.label)}</button>` : '').join('')}</div>`).join('')}</div>
      <fieldset class="rf-step"><legend>When</legend>
        <label class="sr-only" for="rf-trigger">Trigger</label>
        <select id="rf-trigger">${Object.entries(TRIGGERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        <div class="rf-params" id="rf-tparams"></div>
      </fieldset>
      <fieldset class="rf-step"><legend>Only if</legend>
        <label class="sr-only" for="rf-condition">Condition</label>
        <select id="rf-condition"><option value="always">Any time</option><option value="while_printing">The printer is printing</option><option value="outside_quiet_hours">It's outside quiet hours</option></select>
      </fieldset>
      <fieldset class="rf-step"><legend>Then</legend>
        <label class="sr-only" for="rf-action">Action</label>
        <select id="rf-action">${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}${aiOn() ? '<option value="ai_look">Have my AI look through the camera</option>' : ''}</select>
        <div class="rf-params" id="rf-aparams"></div>
      </fieldset>
      <fieldset class="rf-step"><legend>On</legend>
        <label class="sr-only" for="rf-printer">Printer</label>
        <select id="rf-printer"><option value="any">Any printer</option>${printers.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <label class="rf-inline" for="rf-cooldown">at most once every <input type="number" id="rf-cooldown" value="60" min="0" max="86400" style="width:80px"> seconds</label>
      </fieldset>
      <label class="sr-only" for="rf-name">Rule name (optional)</label>
      <input type="text" id="rf-name" placeholder="Name (optional)" maxlength="80">
      <p class="log-empty" id="rf-demo-note"></p>
      <button class="btn primary block" type="submit" id="rf-save">Save rule</button>`;
    const tparams = () => {
      const t = $('rf-trigger').value, host = $('rf-tparams');
      host.innerHTML = t === 'temperature' ? `
          <select id="rf-sensor" aria-label="Which temperature"><option value="active_nozzle">Active nozzle</option><option>T0</option><option>T1</option><option>T2</option><option>T3</option><option value="bed">Bed</option><option value="chamber">Chamber</option></select>
          <select id="rf-op" aria-label="Above or below"><option value="above">goes above</option><option value="below">drops below</option></select>
          <input type="number" id="rf-value" value="240" aria-label="Temperature in °C" style="width:90px"> °C`
        : t === 'progress' ? `<label class="rf-inline">at <input type="number" id="rf-value" value="50" min="1" max="100" style="width:80px" aria-label="Percentage"> % done</label>`
        : t === 'time_left' ? `<label class="rf-inline">with <input type="number" id="rf-value" value="10" min="1" max="1440" style="width:80px" aria-label="Minutes left"> minutes or less left</label>`
        : t === 'layer' ? `<label class="rf-inline">layer <input type="number" id="rf-value" value="3" min="1" step="1" style="width:90px" aria-label="Layer number"></label>`
        : t === 'error' ? '<span class="log-empty">Fires once when the printer stops with an error (not when it just stops answering).</span>'
        : t === 'link_lost' ? '<span class="log-empty">Fires once when Deja Vu1 loses its live link to the printer.</span>'
        : t === 'state' ? `<select id="rf-event" aria-label="Print event">${['started', 'paused', 'resumed', 'finished', 'failed', 'cancelled'].map(e => `<option>${e}</option>`).join('')}</select>`
          : t === 'maintenance_overdue' ? `<select id="rf-task" aria-label="Maintenance task"><option value="any">Any task</option><option value="nozzle_check">Nozzle check</option><option value="bed_level">Bed levelling</option><option value="belt_tension">Belt tension</option><option value="lubrication">Lubrication</option><option value="dock_alignment">Dock alignment</option><option value="fan_clean">Fan cleaning</option><option value="calibration">Recalibration</option></select>` : '';
    };
    const aparams = () => {
      const a = $('rf-action').value, host = $('rf-aparams');
      host.innerHTML = a === 'notify' ? `<input type="text" id="rf-message" placeholder="Message" value="Check the printer" aria-label="Notification message"><select id="rf-priority" aria-label="Priority"><option value="normal">Normal (respects quiet hours)</option><option value="high">Urgent (always sends)</option></select>`
        : a === 'light' ? `<input type="color" id="rf-color" value="#ffaa00" aria-label="Light colour"> <span class="log-empty">Sent to the WLED strip set up in Settings</span>`
          : a === 'home_assistant' ? `<input type="text" id="rf-entity" value="sensor.dejavu1_alert" aria-label="Entity"> <input type="text" id="rf-state" value="on" aria-label="State" style="width:90px">`
            : a === 'macro' ? `<input type="text" id="rf-macro" placeholder="LIGHT_OFF" aria-label="Macro name" style="text-transform:uppercase"> <span class="log-empty">As the printer lists it under Printer → Printer's own buttons</span>`
              : a === 'cool_down' ? '<span class="log-empty">Sets every head and the bed to off on the printer that triggered the rule. Never while it prints.</span>'
              : a.startsWith('plugin:') ? '<span class="log-empty">Runs the plugin’s own commands. Until you allow the real printer in Settings, Plugins, they go to the practice printer.</span>'
              : a === 'ai_look' ? '<label class="rf-check"><input type="checkbox" id="rf-ai-pause" checked> Pause the print if it clearly failed</label> <span class="log-empty">Your AI studies one camera picture, and a second one before it pauses. The result shows in What fired and on the AI screen.</span>'
                : '<span class="log-empty">Pauses the print on the printer that triggered the rule.</span>';
    };
    $('rf-trigger').addEventListener('change', tparams);
    $('rf-action').addEventListener('change', aparams);
    tparams(); aparams();
    addPluginActions($('rf-action'));
    $('rf-demo-note').textContent = demoOn ? 'Demo data is on, so this rule will only watch the simulated printers, and anything it sends is marked "[Demo data]".' : 'This rule will watch real, connected printers.';
    qsa('[data-preset]', form).forEach(b => b.addEventListener('click', () => {
      const p = PRESETS[+b.dataset.preset].rule;
      $('rf-trigger').value = p.trigger.type; tparams();
      if (p.trigger.sensor) { $('rf-sensor').value = p.trigger.sensor; $('rf-op').value = p.trigger.op; $('rf-value').value = p.trigger.value; }
      if (p.trigger.event) $('rf-event').value = p.trigger.event;
      if (p.trigger.value != null && !p.trigger.sensor) $('rf-value').value = p.trigger.value;
      if (p.trigger.task) $('rf-task').value = p.trigger.task;
      $('rf-action').value = p.action.type; aparams();
      if (p.action.message) { $('rf-message').value = p.action.message; $('rf-priority').value = p.action.priority; }
      if (p.action.color) $('rf-color').value = p.action.color;
      if (p.action.type === 'ai_look' && $('rf-ai-pause')) $('rf-ai-pause').checked = !!p.action.pause;
      $('rf-name').value = PRESETS[+b.dataset.preset].label;
      $('rf-save').scrollIntoView({ block: 'nearest', behavior: REDUCED.matches ? 'auto' : 'smooth' });
    }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const t = $('rf-trigger').value, a = $('rf-action').value;
      const trigger = { type: t };
      if (t === 'temperature') Object.assign(trigger, { sensor: $('rf-sensor').value, op: $('rf-op').value, value: +$('rf-value').value });
      if (t === 'state') trigger.event = $('rf-event').value;
      if (t === 'maintenance_overdue') trigger.task = $('rf-task').value;
      if (['progress', 'time_left', 'layer'].includes(t)) trigger.value = +$('rf-value').value;
      const action = a.startsWith('plugin:') ? { type: 'plugin', plugin: a.split(':')[1], action: a.split(':')[2] } : { type: a };
      if (a === 'notify') Object.assign(action, { message: $('rf-message').value, priority: $('rf-priority').value });
      if (a === 'light') action.color = $('rf-color').value;
      if (a === 'home_assistant') Object.assign(action, { entity_id: $('rf-entity').value, state: $('rf-state').value });
      if (a === 'macro') action.name = $('rf-macro').value.trim().toUpperCase();
      if (a === 'ai_look') action.pause = $('rf-ai-pause').checked;
      const rule = { name: $('rf-name').value, trigger, action, condition: $('rf-condition').value, printer: $('rf-printer').value, cooldown_s: +$('rf-cooldown').value };
      const r = await runCommand($('rf-save'), demoOn ? '/api/automations?demo=1' : '/api/automations', { rule },
        { sending: 'Saving…', done: 'Rule saved', failed: 'Rule not saved' });
      if (r.ok) { $('rf-name').value = ''; loadRules(); }
    };
  }

// Each action a switched-on plugin offers becomes one more choice under Then.
async function addPluginActions(select) {
  const r = await getJSON('/api/plugins').catch(() => null);
  if (!r || !Array.isArray(r.plugins) || !select.isConnected) return;
  const opts = [];
  r.plugins.filter(p => p.on && !p.broken).forEach(p => (p.actions || []).forEach(a => {
    opts.push(`<option value="plugin:${esc(p.id)}:${esc(a.id)}">${esc(pluginActionText(p.name, a.name))}</option>`);
  }));
  if (opts.length) select.insertAdjacentHTML('beforeend', opts.join(''));
}

function pluginActionText(plugin, action) {
  return `Run “${action}” from ${plugin}`;
}

async function loadRules() {
    const host = $('rule-list');
    if (!host) return;
    const data = await getJSON('/api/automations').catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Automations'); return; }
    const rules = (data && data.rules) || [];
    host.innerHTML = rules.length ? rules.map(r => `
      <div class="rule-row ${r.enabled ? '' : 'is-off'}">
        <div class="rr-main">
          <div class="rr-name">${esc(r.name)} ${r.demo ? '<span class="badge badge-sim">Demo</span>' : ''}</div>
          <div class="rr-text">${sentence(r)}</div>
          <div class="rr-meta">${r.fire_count ? `Fired ${r.fire_count} time${r.fire_count > 1 ? 's' : ''}, last ${since(r.last_fired_at)}` : 'Hasn\'t fired yet'}</div>
        </div>
        <div class="rr-tools">
          <label class="switch" title="${r.enabled ? 'On' : 'Off'}"><span class="sr-only">Rule on</span>
            <input type="checkbox" data-rule-toggle="${esc(r.id)}" ${r.enabled ? 'checked' : ''}>
            <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></label>
          <button class="btn small" data-rule-test="${esc(r.id)}" type="button">Test</button>
          <button class="btn small danger" data-rule-delete="${esc(r.id)}" type="button">Delete</button>
        </div>
      </div>`).join('') : '<p class="log-empty">No rules yet. Pick an example under New rule to start.</p>';
    qsa('[data-rule-toggle]', host).forEach(c => c.addEventListener('change', async () => {
      const r = await postJSON(`/api/automations/${enc(c.dataset.ruleToggle)}/update`, { changes: { enabled: c.checked } });
      if (!r.ok) toast(`Couldn't change it: ${r.body.error}`, 'bad');
      loadRules();
    }));
    qsa('[data-rule-test]', host).forEach(b => b.addEventListener('click', async () => {
      const original = b.textContent;
      b.disabled = true; b.textContent = 'Running…';
      const r = await postJSON(api(`/api/automations/${enc(b.dataset.ruleTest)}/test`), {});
      b.disabled = false; b.textContent = original;
      if (!r.ok) toast(`Test not run: ${r.body.error}`, 'bad');
      else toast(r.body.ok ? `Test: ${r.body.detail}` : `Test ran, action failed: ${r.body.error}`, r.body.ok ? 'ok' : 'warn', 7000);
      loadRuleLog();
      if (window.Workshop) refreshPrinter();
    }));
    qsa('[data-rule-delete]', host).forEach(b => b.addEventListener('click', async () => {
      const r = await postJSON(`/api/automations/${enc(b.dataset.ruleDelete)}/delete`, {});
      toast(r.ok ? 'Rule deleted' : `Couldn't delete: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadRules();
    }));
  }

/* The time-lapse list: three boxes (a note, the flipbooks, the printer's videos) that are filled in place and replaced only when their
 * content changed. A slow or failed answer, a refresh, or the Record time-lapses switch being flipped leaves the list where it is. */
function bindTimelapse(host) {
    if (host.dataset.bound) return;
    host.dataset.bound = '1';
    host.addEventListener('click', e => {
      const hit = sel => e.target.closest(sel);
      let b;
      if ((b = hit('[data-keep-path]'))) { if (!b.disabled) tlKeep(b); }
      else if ((b = hit('[data-forget-video]'))) tlForget(b);
      else if ((b = hit('[data-flip-video]'))) flipbookVideo(b.dataset.flipVideo, b.dataset.flipName, b);
      else if ((b = hit('[data-flip]'))) playFlipbook(b.dataset.flip, null, b.dataset.flipName);
      else if ((b = hit('[data-play-video]')) && window.Player) Player.video(b.dataset.playVideo, { title: b.dataset.playName, download: b.dataset.playDownload });
    });
  }

async function loadTimelapse() {
    const host = $('timelapse-host');
    if (!host) return;
    const printer = String(currentPrinter || '');
    if (host.dataset.printer !== printer || !host.querySelector('#tl-flips')) {
      host.dataset.printer = printer;
      host.dataset.drawn = '';
      host.innerHTML = '<p class="field-hint tl-note" id="tl-note" role="status" hidden></p><div id="tl-flips"></div><div id="tl-printer" class="tl-printer"></div>';
      tlReset();
      bindTimelapse(host);
    }
    const data = await getJSON(api('/api/timelapse')).catch(() => null);
    const note = host.querySelector('#tl-note');
    if (!note) return;
    if (isModuleDisabled(data)) {
      note.hidden = false;
      note.textContent = 'Time-lapses are switched off, so nothing new is recorded. Your recordings stay listed here and open again when it is switched on.';
      host.classList.add('is-off');
      if (!host.dataset.drawn) setHTML(host.querySelector('#tl-flips'), '');
      return;
    }
    host.classList.remove('is-off');
    note.hidden = true;
    const flips = host.querySelector('#tl-flips');
    if (!data || !hasData(data)) { if (!host.dataset.drawn) setHTML(flips, demoNeeded('time-lapses')); return; }       // a failed look keeps the list
    host.dataset.drawn = '1';
    setHTML(flips, data.sessions.length ? data.sessions.map(s => `
      <div class="reg-row">
        <span class="reg-name">${esc(s.filename || 'print')}</span>
        <span class="log-empty">${s.frames} frames · ${since(s.started_at)}${s.finished ? '' : ' · recording'} · ${esc(s.source)}${s.last_error ? ' · '+esc(s.last_error) : ''}</span>
        <span class="tl-acts"><button class="btn small" data-flip="${esc(s.session)}" data-flip-name="${esc(s.filename || 'print')}" type="button" ${s.frames ? '' : 'disabled'}>Play</button>
        <button class="btn small" data-flip-video="${esc(s.session)}" data-flip-name="${esc(s.filename || 'print')}" type="button" ${s.frames > 1 && window.MediaRecorder ? '' : 'hidden'}>Save as video</button></span>
      </div>`).join('') : '<p class="log-empty">No time-lapses yet. One is recorded during every print.</p>');
    loadPrinterVideos(host);
  }
/* Plays one flipbook in the time-lapse player (player.js): it stops at the last frame unless Loop is on. */
function playFlipbook(session, printer, title) {
    if (window.Player) return Player.frames(session, { printer: printer || undefined, title });
    toast('The time-lapse player did not load. Reload the page and try again.', 'warn');
  }

async function checkHandoff() {
    const el = $('handoff');
    const data = await getJSON(`/api/handoff?device=${enc(deviceId)}`).catch(() => null);
    const offer = data && data.offer;
    const same = offer && offer.tab === currentTab() && (offer.printer || '') === currentPrinter && !offer.file;
    if (!offer || same || offer.at <= wsState.dismissedOffer || offer.seconds_ago > 600) { el.hidden = true; return; }
    // In words: "Your iPhone was on Files · U1 Workshop · benchy.gcode".
    const tabName = (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[offer.tab]) || offer.tab;
    const where = [tabName, offer.printer ? printerName(offer.printer) : null, offer.file].filter(Boolean).join(' · ');
    const text = `Your ${offer.device_name} was on ${where}. Open the same here?`;
    $('handoff-text').textContent = text;
    const go = async () => {
      el.hidden = true;
      wsState.dismissedOffer = offer.at;
      if (offer.printer && offer.printer !== currentPrinter) selectPrinter(offer.printer);
      if (offer.tab) showTab(offer.tab);
      if (offer.file) { await loadFiles(); openFile(offer.file); }
    };
    $('handoff-go').onclick = go;
    $('handoff-dismiss').onclick = () => { el.hidden = true; wsState.dismissedOffer = offer.at; };
    if (!el.hidden) return;
    el.hidden = false;
    // The offer waits a few seconds, then moves into the notification orb (button and all), so it
    // doesn't sit over the page; pointing at it or tabbing into it keeps it where it is.
    clearTimeout(checkHandoff.fold);
    const fold = () => {
      if (el.hidden || el.matches(':hover') || el.contains(document.activeElement)) { if (!el.hidden) checkHandoff.fold = setTimeout(fold, 3000); return; }
      el.hidden = true;
      wsState.dismissedOffer = offer.at;
      toast(text, 'info', 3000, { action: { label: 'Open here', run: go } });
    };
    checkHandoff.fold = setTimeout(fold, 9000);
  }

function initPhone() {
    const nav = qs('.bottom-nav');
    const sheet = $('more-sheet');
    const more = $('bn-more');
    const setSheet = (open) => { sheet.hidden = !open; more.setAttribute('aria-expanded', String(open)); };
    qsa('[data-tab]', $('thumb-dock')).forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); setSheet(false); }));
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => setSheet(sheet.hidden));
    // The sheet closes the way a popover should: tap anywhere else, or Escape.
    document.addEventListener('pointerdown', (e) => {
      if (!sheet.hidden && !sheet.contains(e.target) && !more.contains(e.target)) setSheet(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.hidden) { setSheet(false); more.focus(); }
    });
    // The sheet's own tools: what the computer shows in the toolbar edge (search, the ? note)
    // and beside it (Camera, Set up & help).
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      setSheet(false);
      const act = b.dataset.more;
      if (act === 'camera') { showTab('control'); window.Sections && Sections.reveal($('pp-camera-card')); $('pp-camera-card').scrollIntoView({ block: 'start' }); }
      else if (act === 'help') $('setup-replay').click();
      else if (act === 'tips') { if (window.Guide && Guide.has(currentTab())) Guide.screen(currentTab()); else toast('This screen has no extra tips', 'info'); }
      else if (act === 'install' && window.Phone) Phone.install();
    });
    $('qa-next').addEventListener('click', (e) => startNext(e.currentTarget));
    $('live-pill').addEventListener('click', () => showTab('control'));
    $('qa-status').addEventListener('click', () => showTab('control'));
    initHoldToCancel();
    initDockStack();
    syncNav(currentTab());
    nav.dataset.ready = '1';
  }
function closeDialog(dialog) { dialog.close(); }
function initDialogs() {
    qsa('dialog.glass-dialog').forEach(d => {
      qsa('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
      d.addEventListener('close', () => { if (!qs('dialog[open]')) document.body.classList.remove('has-glass-dialog'); });
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });      // tap outside the panel
    });
  }

  /* A finished print: the background dots celebrate and a message rises out of
   * the orb, with See summary for the details. Nothing waits for a click, so a
   * farm of printers finishing one after another never stacks up pop-ups, and
   * the dots celebrate at most once every 10 seconds however many finish. */
function celebrate(event) {
    if (wsState.lastCelebrated === event.id) return;
    wsState.lastCelebrated = event.id;
    const s = event.summary;
    const dots = store.get('dejavu1.pref.celebrate') !== 'off';
    if (dots && Date.now() - wsState.lastBurst > 10000 && typeof Backdrop !== 'undefined') { wsState.lastBurst = Date.now(); Backdrop.celebrate(); }
    toast(`${event.printer_name} finished ${s.file} · ${fmtHours(s.hours)} · ${Number(s.grams).toFixed(1)} g`, 'ok', 9000,
      { action: { label: 'See summary', run: () => showSummary(event) } });
  }

  /* The summary card: the live pill's glass grows into it. */
function showSummary(event) {
    const s = event.summary;
    $('celebrate-title').textContent = `${event.printer_name}: print finished`;
    $('celebrate-sub').textContent = s.file;
    $('celebrate-stats').innerHTML = `
      <div><span class="stat-key">Time</span><b>${fmtHours(s.hours)}</b></div>
      <div><span class="stat-key">Filament</span><b>${Number(s.grams).toFixed(1)} g ${esc(s.material)}</b></div>
      <div><span class="stat-key">Cost</span><b>${money(s.cost.total_cost)}</b></div>`;
    const dialog = $('celebrate-dialog');
    qs('.dialog-panel', dialog).style.setProperty('--glass-tint', s.color || '#4a8df8');
    qs('.dialog-panel', dialog).style.setProperty('--cel', s.color || '#4a8df8');
    $('celebrate-timelapse').onclick = async () => {
      dialog.close();
      const data = await getJSON(api(`/api/timelapse?printer=${enc(event.printer)}`));
      const session = data.sessions && data.sessions[0];
      if (session) playFlipbook(session.session, event.printer, session.filename); else toast('No time-lapse was recorded for this print', 'warn');
    };
    // The print's record, the same file again, and the next queued print: offered here, never started from here.
    $('celebrate-record').onclick = () => { dialog.close(); goPlace('history'); if (window.Prints) Prints.load(); };
    $('celebrate-again').onclick = e => { dialog.close(); openConfirm(s.file, e.currentTarget); };
    const next = $('celebrate-next'), nextGo = $('celebrate-next-go');
    next.hidden = nextGo.hidden = true;
    getJSON(api(`/api/queue?printer=${enc(event.printer)}`)).then(q => {
      const item = q && (q.items || []).find(i => i.status === 'queued');
      if (!item || !dialog.open) return;
      next.textContent = q.auto_advance
        ? `Next in the queue for ${event.printer_name}: ${item.filename}. The automatic queue is on for this printer, so the queue moves on by itself.`
        : `Next in the queue for ${event.printer_name}: ${item.filename}. It starts only when you start it.`;
      next.hidden = nextGo.hidden = false;
      nextGo.onclick = ev => { dialog.close(); openConfirm(item.filename, ev.currentTarget); };
    }).catch(() => {});
    const pill = $('live-pill');
    openDialog(dialog, pill && !pill.hidden ? pill : null);
  }

  /* Ambient motion is CSS (workshop.css). SVG's own <animate> isn't covered
   * by the CSS reduced-motion rule, so pause it here when asked. */
function honourReducedMotion() {
    const svg = qs('svg.lg-defs');
    const apply = () => { if (svg && svg.pauseAnimations) (REDUCED.matches ? svg.pauseAnimations() : svg.unpauseAnimations()); };
    apply();
    REDUCED.addEventListener?.('change', apply);
  }

  /* ================================================================
   * wiring
   * ================================================================ */

function onTab(name) {
    syncNav(name);
    if (name === 'fleet') loadRegistry();
    if (name === 'files') { loadFiles(); loadQueue(); }
    if (name === 'automations') { ruleForm(); loadRules(); loadRuleLog(); }
    if (name === 'control') { loadCamera(); loadTimelapse(); } else stopCamera();
    if (name === 'maintenance') { loadForecast(); loadSideBySide(); }   // Filament & colour lives here
    window.dispatchEvent(new CustomEvent('dv-tab', { detail: name }));
    reportView();
  }

async function refresh() {
    $('demo-tools-card').hidden = !demoOn;
    // The empty cards name an added printer that isn't answering, so its list comes first.
    const reg = liveData() ? null : loadRegistry();
    if (!liveData()) {
      await reg;
      wsState.printerState = null;
      $('live-pill').hidden = true;
      $('quick-actions').hidden = true;
      renderTwin(null);
      renderFleet([]);
    }
    await Promise.all([loadHealth(), loadChamber(), loadFiles(), loadQueue(), reg || loadRegistry(),
      loadRules(), loadRuleLog(), loadForecast(), loadSideBySide(), loadTimelapse()]);
    if (liveData()) refreshPrinter();
    renderChip();
    window.dispatchEvent(new CustomEvent('dv-refresh'));
  }

function init() {
    initFleet();
    initFiles();
    initConfirm();
    initSwap();
    initDemoTools();
    initCameraForm();
    initPhone();
    initPressGlow();
    initScrollEdge();
    initBlobResize();
    initGlassMenu();
    initDialogs();
    honourReducedMotion();
    connect();
    refresh();
    onTab(currentTab());
    reportView();
    setInterval(reportView, 20000);
    setInterval(checkHandoff, 15000);
    setTimeout(checkHandoff, 3000);
    setInterval(() => { if (liveData()) { loadHealth(); loadChamber(); } }, 15000);
    window.addEventListener('resize', () => moveTabBlob(currentTab()));
  }
  return { closeDialog, init, nudgeLive, onTab, reconnect, refresh, selectPrinter, watchLive };
})();
