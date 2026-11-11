/* assistant.js: the AI assistant's panel.
 *
 * A strip on the right edge (a sheet on a phone), so the twin and the camera stay in view while the
 * assistant works the printer. Three screens in one panel:
 *   connect   choose your own AI: a Claude or ChatGPT plan, an API key, or a model on this computer
 *   settle    a short moment after connecting while it reads the printer, then it fades into
 *   chat      messages, the steps it took (drawn like a toolpath), and Approve / Decline for a step
 *             that needs your yes
 * The server (backend/ai_assistant.py) decides what is allowed; this file only shows it. In the online
 * demo there is no server, so a small scripted helper answers and says that it is one.
 */
(function () {
  const KEY = 'dejavu1.ai.thread';
  const el = {};
  let st = null;            // GET /api/assistant
  let open = false, seen = 0, polling = null, live = {}, lastTrouble = '', picked = null, wasReady = false;
  const rows = new Map();   // message number -> element

  const isDemo = () => typeof tour !== 'undefined' && tour.on;
  const threadId = () => {
    let id = store.get(KEY);
    if (!id) { id = 'dv' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set(KEY, id); }
    return id;
  };

  /* Model text is escaped first, then given the few marks people expect in a chat. */
  function rich(text) {
    const lines = esc(String(text || '')).split('\n');
    let html = '', list = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
      if (item) { html += (list ? '' : '<ul>') + `<li>${item[1]}</li>`; list = true; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (line.trim()) html += `<p>${line.replace(/^#+\s*/, '')}</p>`;
    }
    return html + (list ? '</ul>' : '');
  }

  function build() {
    const launch = document.createElement('button');
    launch.className = 'ai-launch liquid-glass';
    launch.id = 'ai-launch';
    launch.type = 'button';
    launch.setAttribute('aria-label', 'Open the assistant');
    launch.setAttribute('aria-expanded', 'false');
    launch.setAttribute('aria-controls', 'ai-panel');
    launch.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 9.5h8M8 12.5h5"/></svg><span>Ask</span>';
    const panel = document.createElement('section');
    panel.className = 'ai-panel liquid-glass deep';
    panel.id = 'ai-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'ai-title');
    panel.innerHTML = `
      <header class="ai-head">
        <div><h2 id="ai-title" tabindex="-1">Assistant</h2><p class="ai-sub" id="ai-sub"></p></div>
        <div class="ai-head-btns">
          <button class="btn small" id="ai-settings" type="button" hidden>Settings</button>
          <button class="btn small" id="ai-close" type="button" aria-label="Close the assistant">Close</button>
        </div>
      </header>
      <div class="ai-body" id="ai-body"></div>`;
    document.body.append(launch, panel);
    Object.assign(el, { launch, panel, body: panel.querySelector('#ai-body'), sub: panel.querySelector('#ai-sub'),
      settings: panel.querySelector('#ai-settings') });
    launch.addEventListener('click', () => toggle());
    panel.querySelector('#ai-close').addEventListener('click', () => toggle(false));
    el.settings.addEventListener('click', () => (el.body.dataset.view === 'chat' ? showConnect() : showChat()));
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); }
      else if (e.key === 'Escape' && open && panel.contains(document.activeElement)) toggle(false);
    });
  }

  async function refresh() {
    if (isDemo()) {
      st = st || { demo: true, ready: true, mode: 'balanced', providers: [], modes: {}, provider: 'demo' };
      const rec = await getJSON('/api/assistant').catch(() => ({}));
      if (rec && rec.providers) Object.assign(st, { providers: rec.providers.map(p => ({ ...p, installed: false, has_key: false, ready: false })), modes: rec.modes, limits: rec.limits });
      return st;
    }
    const body = await getJSON('/api/assistant');
    st = body && body.providers ? body : null;
    el.launch.hidden = !st;
    return st;
  }

  async function toggle(want) {
    open = want === undefined ? !open : want;
    el.launch.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('ai-open', open);
    if (!open) { el.panel.classList.remove('is-in'); setTimeout(() => { if (!open) el.panel.hidden = true; }, 220); stopPoll(); el.launch.focus(); return; }
    el.panel.hidden = false;
    requestAnimationFrame(() => el.panel.classList.add('is-in'));
    await refresh();
    if (!st) { el.body.innerHTML = '<p class="ai-empty">The assistant is switched off. Turn it on in Settings, Optional extras.</p>'; return; }
    if (st.ready) showChat(); else showConnect();
    el.panel.querySelector('#ai-title').focus({ preventScroll: true });
  }

  /* ---- connect ---------------------------------------------------------- */

  const GROUPS = [
    ['cli', 'A plan you already pay for', 'Runs the program you are signed in to. Deja Vu1 never sees a password or a key.'],
    ['key', 'An API key', 'Paste a key from the service. It stays on this computer and is left out of backups.'],
    ['local', 'A model on this computer', 'Nothing leaves your computer.']
  ];

  function showConnect() {
    stopPoll();
    el.body.dataset.view = 'connect';
    el.settings.hidden = !st.ready;
    el.settings.textContent = 'Back to chat';
    el.sub.textContent = st.ready ? 'Change the AI or how much it may do' : 'Connect your own AI to begin';
    const group = kind => st.providers.filter(p => (kind === 'local' ? p.kind === 'local' || p.kind === 'custom' : p.kind === kind));
    const modes = Object.entries(st.modes || {}).map(([id, text]) => {
      const [name, rest] = text.split(': ');
      return `<label class="ai-mode"><input type="radio" name="ai-mode" value="${esc(id)}" ${id === st.mode ? 'checked' : ''}><span><b>${esc(name)}</b>${esc(rest || '')}</span></label>`;
    }).join('');
    el.body.innerHTML = `
      ${st.demo ? '<p class="ai-note">Online demo: a scripted helper answers here, on a simulated printer. On your own computer you connect one of these.</p>' : ''}
      <label class="ai-search"><span class="sr-only">Find a service</span><input id="ai-find" type="search" placeholder="Find a service" autocomplete="off"></label>
      <div class="ai-form" id="ai-form" hidden></div>
      ${GROUPS.map(([kind, title, hint]) => `
        <section class="ai-group" data-kind="${kind}"><h3>${title}</h3><p class="ai-hint">${hint}</p>
          <ul class="ai-providers">${group(kind).map(p => `
            <li><button type="button" class="ai-prov${p.id === st.provider ? ' is-on' : ''}" data-id="${esc(p.id)}">
              <span class="ai-prov-name">${esc(p.name)}</span>
              <span class="ai-prov-state">${p.id === st.provider && st.ready ? 'In use' : p.kind === 'cli' ? (st.demo ? '' : p.installed ? 'Installed' : 'Not installed') : p.has_key ? 'Key saved' : ''}</span>
            </button></li>`).join('')}</ul>
        </section>`).join('')}
      <section class="ai-group"><h3>How much it may do</h3>
        <p class="ai-hint">The safety limits hold in every setting: heater limits, the printer's own size, no moves before homing, the nozzle kept ${esc(String((st.limits || {}).z_floor_mm || 2))} mm off the bed, and only you can start a print.</p>
        <div class="ai-modes">${modes}</div>
      </section>`;
    el.body.querySelectorAll('.ai-prov').forEach(b => b.addEventListener('click', () => openForm(b.dataset.id)));
    el.body.querySelectorAll('[name=ai-mode]').forEach(r => r.addEventListener('change', async () => {
      if (st.demo) { st.mode = r.value; return; }
      const res = await postJSON('/api/assistant/select', { mode: r.value });
      if (res.ok) st = res.body; else toast(res.body.error || 'That setting was not saved', 'bad');
    }));
    el.body.querySelector('#ai-find').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      el.body.querySelectorAll('.ai-providers li').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
      el.body.querySelectorAll('.ai-group[data-kind]').forEach(g => { g.hidden = !g.querySelector('li:not([hidden])'); });
    });
    if (picked) openForm(picked, true);
  }

  function openForm(id, quiet) {
    const p = st.providers.find(x => x.id === id);
    const form = el.body.querySelector('#ai-form');
    if (!p || !form) return;
    picked = id;
    el.body.querySelectorAll('.ai-prov').forEach(b => b.classList.toggle('is-picked', b.dataset.id === id));
    const model = (st.models || {})[id] || '';
    const cli = p.kind === 'cli', needsKey = p.kind === 'key', address = p.kind === 'local' || p.kind === 'custom';
    form.hidden = false;
    form.innerHTML = `
      <h3>${esc(p.name)}</h3>
      ${p.note ? `<p class="ai-hint">${esc(p.note)}</p>` : ''}
      ${cli && !st.demo ? `<p class="ai-hint">${p.installed ? 'Found on this computer. Press Connect to check that it is signed in.' : `Not found on this computer. <a href="${esc(p.install_url)}" target="_blank" rel="noopener">Install it</a>, sign in, then come back.`}</p>` : ''}
      ${address ? `<label class="ai-field"><span>Address</span><input id="ai-base" type="url" value="${esc(p.base_url || '')}" placeholder="http://localhost:8080/v1" autocomplete="off"></label>` : ''}
      ${cli ? '' : `<label class="ai-field"><span>${needsKey ? 'Key' : 'Key (only if it asks for one)'}</span>
        <input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="${p.has_key ? `Saved ${esc(p.key_hint || '')}. Paste a new one to replace it` : 'Paste the key'}"></label>
        ${p.key_url ? `<p class="ai-hint"><a href="${esc(p.key_url)}" target="_blank" rel="noopener">Get a key from ${esc(p.name.split(' (')[0])}</a>${p.from_environment ? '. A key from this computer’s environment is in use.' : ''}</p>` : ''}`}
      <label class="ai-field"><span>Model${cli ? ' (optional)' : ''}</span>
        <input id="ai-model" list="ai-models" value="${esc(model)}" placeholder="${cli ? 'Your plan’s usual model' : 'Connect to see the list'}" autocomplete="off"><datalist id="ai-models"></datalist></label>
      <p class="ai-status" id="ai-status" role="status"></p>
      <div class="ai-actions">
        <button class="btn primary" id="ai-connect" type="button">Connect</button>
        ${p.has_key || (address && p.ready) ? '<button class="btn" id="ai-forget" type="button">Forget</button>' : ''}
      </div>`;
    const say = (text, kind) => { const s = form.querySelector('#ai-status'); s.textContent = text; s.dataset.kind = kind || ''; };
    form.querySelector('#ai-connect').addEventListener('click', async e => {
      if (st.demo) { say('The online demo can’t connect a real AI. Install Deja Vu1 on your computer to use your own.', 'warn'); return; }
      const button = e.currentTarget, key = (form.querySelector('#ai-key') || {}).value || '', base = (form.querySelector('#ai-base') || {}).value || '';
      button.disabled = true;
      try {
        if (!cli && (key || base || !p.ready)) {
          say('Saving…');
          const saved = await postJSON('/api/assistant/key', { provider: id, api_key: key || undefined, base_url: base || undefined });
          if (!saved.ok) { say(saved.body.error || 'That could not be saved', 'bad'); return; }
        }
        let wanted = form.querySelector('#ai-model').value.trim();
        if (!cli) {
          say('Reading the list of models…');
          const list = await postJSON('/api/assistant/models', { provider: id });
          if (!list.ok) { say(list.body.error || 'The list of models could not be read', 'bad'); return; }
          form.querySelector('#ai-models').innerHTML = (list.body.models || []).map(m => `<option value="${esc(m)}">`).join('');
          if (!wanted) { wanted = list.body.suggested || ''; form.querySelector('#ai-model').value = wanted; }
          if (!wanted) { say(list.body.note || 'Type the model’s name, then press Connect again', 'warn'); return; }
        }
        await postJSON('/api/assistant/select', { provider: id, model: wanted });
        say('Checking the connection…');
        const test = await postJSON('/api/assistant/test', { provider: id });
        if (!test.ok) { say(test.body.error || 'The connection check failed', 'bad'); return; }
        st = test.body;
        picked = null;
        settle();
      } finally { button.disabled = false; }
    });
    const forget = form.querySelector('#ai-forget');
    if (forget) forget.addEventListener('click', async () => {
      const res = await postJSON('/api/assistant/forget', { provider: id });
      if (res.ok) { st = res.body; picked = null; showConnect(); toast(`${p.name}: key forgotten`, 'info'); }
    });
    if (!quiet) el.body.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---- settle: a short look at the printer, then it gets out of the way ---- */

  async function settle() {
    el.body.dataset.view = 'settle';
    el.settings.hidden = true;
    el.sub.textContent = 'Connected';
    const steps = [['Reading the printer', '/api/printer'], ['Looking through your files', '/api/files'], ['Checking what care is due', '/api/maintenance']];
    el.body.innerHTML = `<div class="ai-settle"><div class="ai-pulse" aria-hidden="true"><i></i><i></i><i></i></div>
      <h3>Getting to know your printer</h3><ol>${steps.map(s => `<li>${s[0]}</li>`).join('')}</ol></div>`;
    const items = el.body.querySelectorAll('.ai-settle li');
    for (let i = 0; i < steps.length; i++) {
      items[i].classList.add('is-now');
      await Promise.all([getJSON(api(steps[i][1])).catch(() => null), new Promise(r => setTimeout(r, 650))]);
      items[i].classList.replace('is-now', 'is-done');
    }
    el.body.querySelector('.ai-settle').classList.add('is-out');
    setTimeout(showChat, 420);
  }

  /* ---- chat ------------------------------------------------------------- */

  function ideas() {
    const out = [], s = live || {};
    if (lastTrouble) out.push(['Explain the last warning', `Explain this message from Deja Vu1 in plain words, and what to try: "${lastTrouble}"`]);
    const file = document.querySelector('#file-detail:not([hidden]) #fd-name, .file-detail:not([hidden]) .fd-name');
    if (file && file.textContent.trim()) out.push([`About ${file.textContent.trim()}`, `Tell me what ${file.textContent.trim()} needs to print: time, filament and anything to watch for.`]);
    if (s.state === 'printing' || s.state === 'paused') out.push(['How is the print going?', 'How is the print going? Check the temperatures and progress.'], ['Look at the camera', 'Look through the camera and tell me if the print looks right.']);
    else out.push(['Home all axes', 'Home all axes, then tell me where the head is.'], ['Warm up for PLA', 'Warm up for PLA: the bed and the active head.']);
    out.push(['What care is due?', 'What maintenance is due, and which task matters most?'], ['Do I have enough filament?', 'Check my filament against the queue and tell me if anything will run short.'],
      ['Make a 30 mm test cube', 'Make a 30 mm calibration cube and save it to my files.']);
    return out.slice(0, 5);
  }

  function showChat() {
    el.body.dataset.view = 'chat';
    el.settings.hidden = false;
    el.settings.textContent = 'Settings';
    const p = st.providers.find(x => x.id === st.provider);
    el.sub.textContent = st.demo ? 'Online demo: a scripted helper on a simulated printer' : `${p ? p.name : ''}${st.model ? ' · ' + st.model : ''}`;
    el.body.innerHTML = `
      <div class="ai-log" id="ai-log" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div class="ai-ideas" id="ai-ideas"></div>
      <form class="ai-compose" id="ai-compose">
        <label class="sr-only" for="ai-text">Message the assistant</label>
        <textarea id="ai-text" rows="1" maxlength="6000" placeholder="Ask, or tell it what to do"></textarea>
        <button class="btn primary" id="ai-send" type="submit">Send</button>
        <button class="btn danger" id="ai-stop" type="button" hidden>Stop</button>
      </form>
      <button class="ai-clear" id="ai-clear" type="button">Start over</button>`;
    rows.clear(); seen = 0;
    const text = el.body.querySelector('#ai-text');
    el.body.querySelector('#ai-compose').addEventListener('submit', e => { e.preventDefault(); send(text.value); });
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text.value); } });
    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; });
    el.body.querySelector('#ai-stop').addEventListener('click', () => (st.demo ? demoStop() : postJSON('/api/assistant/stop', { thread: threadId() }).then(poll)));
    el.body.querySelector('#ai-clear').addEventListener('click', async () => {
      if (!st.demo) await postJSON('/api/assistant/clear', { thread: threadId() });
      store.set(KEY, ''); demo.log = []; demo.n = 0; showChat();
    });
    drawIdeas();
    if (!wasReady) { wasReady = true; greet(); }
    if (st.demo) demoPaint(); else poll();
    text.focus({ preventScroll: true });
  }

  function greet() {
    const log = el.body.querySelector('#ai-log');
    if (!log || log.children.length) return;
    log.insertAdjacentHTML('beforeend', `<div class="ai-msg is-assistant ai-hello"><p>Ready. I can read the printer, your files and its history, and work the printer inside the safety limits. Ask in your own words.</p></div>`);
  }

  function drawIdeas() {
    const host = el.body.querySelector('#ai-ideas');
    if (!host) return;
    host.innerHTML = ideas().map(([label], i) => `<button type="button" class="ai-idea" data-i="${i}">${esc(label)}</button>`).join('');
    host.querySelectorAll('.ai-idea').forEach(b => b.addEventListener('click', () => send(ideas()[+b.dataset.i][1])));
  }

  const STATUS = { running: 'Working', waiting: 'Needs your yes', done: 'Done', refused: 'Refused', declined: 'Declined' };

  function rowHTML(m) {
    if (m.role === 'user') return `<div class="ai-msg is-user"><p>${esc(m.text)}</p></div>`;
    if (m.role === 'assistant') return `<div class="ai-msg is-assistant">${rich(m.text)}</div>`;
    if (m.role === 'error' || m.role === 'note') return `<div class="ai-msg is-${m.role}" role="${m.role === 'error' ? 'alert' : 'status'}"><p>${esc(m.text)}</p></div>`;
    const wait = m.status === 'waiting';
    return `<div class="ai-step is-${esc(m.status)}${m.level === 'read' ? ' is-read' : ''}">
      <span class="ai-node" aria-hidden="true"></span>
      <div class="ai-step-main"><span class="ai-step-label">${esc(m.label)}</span><span class="ai-step-state">${STATUS[m.status] || ''}</span>
        ${m.detail ? `<p class="ai-step-detail">${esc(m.detail)}</p>` : ''}
        ${wait ? `<div class="ai-approve"><button class="btn primary" type="button" data-yes="${m.n}">Approve</button><button class="btn" type="button" data-no="${m.n}">Decline</button></div>` : ''}
        ${m.handoff && m.handoff.kind === 'confirm_print' && m.status === 'done' ? `<div class="ai-approve"><button class="btn primary" type="button" data-print="${esc(m.handoff.filename)}">Open Confirm Print</button></div>` : ''}
        ${m.file ? `<div class="ai-approve"><button class="btn" type="button" data-file="${esc(m.file)}">Open ${esc(m.file)}</button></div>` : ''}
      </div></div>`;
  }

  function paint(messages, busy) {
    const log = el.body.querySelector('#ai-log');
    if (!log) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    for (const m of messages) {
      const html = rowHTML(m), old = rows.get(m.n);
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const node = holder.firstElementChild;
      if (old) old.replaceWith(node); else log.appendChild(node);
      rows.set(m.n, node);
      if (m.handoff && m.status === 'done' && !old && window.Workshop) Workshop.openConfirm(m.handoff.filename, node);
    }
    let dots = log.querySelector('.ai-thinking');
    if (busy && !dots) log.insertAdjacentHTML('beforeend', '<div class="ai-thinking" role="status"><i></i><i></i><i></i><span class="sr-only">The assistant is working</span></div>');
    else if (busy && dots) log.appendChild(dots);
    else if (dots) dots.remove();
    const waiting = !!log.querySelector('.ai-step.is-waiting');
    el.body.querySelector('#ai-send').hidden = busy || waiting;
    el.body.querySelector('#ai-stop').hidden = !(busy || waiting);
    el.body.querySelector('#ai-ideas').hidden = busy || waiting;
    if (stick) log.scrollTop = log.scrollHeight;
  }

  function wire() {
    el.body.addEventListener('click', e => {
      const t = e.target.closest('[data-yes],[data-no],[data-print],[data-file]');
      if (!t) return;
      if (t.dataset.print) { if (window.Workshop) Workshop.openConfirm(t.dataset.print, t); return; }
      if (t.dataset.file) { if (window.Workshop && Workshop.openFile) Workshop.openFile(t.dataset.file, t); return; }
      const yes = 'yes' in t.dataset, n = +(t.dataset.yes || t.dataset.no);
      t.parentElement.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (st.demo) return demoDecide(n, yes);
      postJSON(api('/api/assistant/decide'), { thread: threadId(), n, approve: yes }).then(res => {
        if (!res.ok) toast(res.body.error || 'That step could not be decided', 'bad');
        poll();
      });
    });
  }

  function stopPoll() { clearTimeout(polling); polling = null; }
  async function poll() {
    stopPoll();
    if (!open || el.body.dataset.view !== 'chat' || st.demo) return;
    const body = await getJSON(`/api/assistant/thread?id=${encodeURIComponent(threadId())}&since=${seen}`).catch(() => null);
    if (body && body.messages) {
      paint(body.messages, body.busy);
      seen = body.seq;
      if (body.busy) polling = setTimeout(poll, 700);
      else drawIdeas();
    }
  }

  async function send(text, context) {
    text = String(text || '').trim();
    if (!text) return;
    if (!open) await toggle(true);
    if (!st || !st.ready) { showConnect(); return; }
    if (el.body.dataset.view !== 'chat') showChat();
    const box = el.body.querySelector('#ai-text');
    box.value = ''; box.style.height = 'auto';
    const hello = el.body.querySelector('.ai-hello');
    if (hello) hello.remove();
    if (lastTrouble && text.includes(lastTrouble)) lastTrouble = '';
    if (st.demo) return demoSend(text);
    const res = await postJSON(api('/api/assistant/chat'), { thread: threadId(), text, context });
    if (!res.ok) { toast(res.body.error || 'The message was not sent', 'bad'); box.value = text; return; }
    poll();
  }

  /* ---- the online demo's scripted helper ----------------------------------
   * No AI runs on the public demo page. This reads a few plain requests and sends the same simulated
   * commands the demo's own buttons send, so the twin moves. It says what it is. */
  const demo = { log: [], n: 0, wait: null };
  const demoAdd = m => { m.n = ++demo.n; demo.log.push(m); demoPaint(); return m; };
  function demoPaint(busy) { paint(demo.log, !!busy); }
  const demoSay = text => demoAdd({ role: 'assistant', text });
  async function demoStep(label, path, body, level) {
    const m = demoAdd({ role: 'action', label, status: 'running', level: level || 'safe' });
    demoPaint(true);
    await new Promise(r => setTimeout(r, 500));
    const res = path ? await postJSON(api(path), body || {}) : { ok: true, body: {} };
    m.status = res.ok ? 'done' : 'refused';
    m.detail = res.ok ? '' : (res.body.error || 'The printer refused');
    demoPaint(true);
    return res.ok;
  }
  async function demoSend(text) {
    demoAdd({ role: 'user', text });
    demoPaint(true);
    await new Promise(r => setTimeout(r, 600));
    const t = text.toLowerCase(), s = await getJSON(api('/api/printer')).catch(() => ({})) || {};
    const temp = (t.match(/(\d{2,3})\s*(?:°|degrees|c\b)/) || t.match(/to\s+(\d{2,3})/) || [])[1];
    const head = ((t.match(/\bt([0-3])\b/) || [])[1]) || '0';
    const busyPrint = s.state === 'printing' || s.state === 'paused';
    if (/home/.test(t)) {
      if (busyPrint) demoSay('A print is on the bed, so I will leave the head where it is. Homing now would move it through the print.');
      else { const ok = await demoStep('Home all axes', '/api/printer/control/home', { axes: ['X', 'Y', 'Z'] }); demoSay(ok ? 'Homed X, Y and Z. Watch the twin: the head is back at its start.' : 'The printer refused to home.'); }
    } else if (/cool|heaters? off/.test(t)) {
      for (const h of ['T0', 'T1', 'T2', 'T3']) await demoStep(`Set ${h} to 0 °C`, '/api/printer/control/temperature', { toolhead: h, target: 0 });
      await demoStep('Set the bed to 0 °C', '/api/printer/control/bed-temperature', { target: 0 });
      demoSay('Every heater is off and cooling.');
    } else if (/warm|heat|preheat|pla|petg/.test(t)) {
      const target = +(temp || (/petg/.test(t) ? 240 : 210));
      if (target > 300) demoSay(`I won’t set ${target} °C. The heater limit is 300 °C, and Deja Vu1 refuses anything above it whatever I ask for.`);
      else {
        demoSay('Heating needs your yes first.');
        const m = demoAdd({ role: 'action', label: `Set T${head} to ${target} °C`, status: 'waiting', level: 'ask' });
        demo.wait = { m, run: async () => { m.status = 'running'; demoPaint(true); const res = await postJSON(api('/api/printer/control/temperature'), { toolhead: 'T' + head, target }); m.status = res.ok ? 'done' : 'refused'; m.detail = res.ok ? '' : (res.body.error || ''); demoSay(res.ok ? `T${head} is heating to ${target} °C. Heating always waits for your yes in this setting.` : 'The printer refused that temperature.'); } };
      }
    } else if (/pause/.test(t)) { const ok = await demoStep('Pause the print', '/api/printer/control/pause'); demoSay(ok ? 'Paused. Say resume when you are ready.' : 'There is nothing to pause right now.'); }
    else if (/resume|continue/.test(t)) { const ok = await demoStep('Resume the print', '/api/printer/control/resume'); demoSay(ok ? 'Resumed.' : 'There is nothing to resume right now.'); }
    else if (/fan/.test(t)) { const pct = Math.min(100, +(t.match(/(\d{1,3})\s*%?/) || [0, 50])[1]); const ok = await demoStep(`Set the fan to ${pct}%`, '/api/printer/control/fan', { percent: pct }); demoSay(ok ? `The fan is at ${pct}%.` : 'The printer refused the fan change.'); }
    else if (/print going|status|temperature|how is|where/.test(t)) {
      await demoStep('Read the printer', null, null, 'read');
      const heads = Object.entries(s.toolheads || {}).map(([k, h]) => `${k} ${Math.round(h.temperature)} °C`).join(', ');
      demoSay(`**${s.printer_name || 'The printer'}** is ${s.state || 'idle'}${s.current_file ? ` on ${s.current_file}, ${Math.round((s.progress || 0) * 100)}% done` : ''}.\n- Heads: ${heads || 'not reported'}\n- Bed: ${Math.round(s.bed_temperature || 0)} °C`);
    } else demoSay('This is the online demo’s scripted helper, so it only knows a few requests: home, warm up, cool down, pause, resume, set the fan, or how the print is going. With your own AI connected it reads your files, history and camera, edits models and works the printer in your own words.');
    demoPaint(false); drawIdeas();
  }
  async function demoDecide(n, yes) {
    const w = demo.wait;
    demo.wait = null;
    if (!w || w.m.n !== n) return;
    if (yes) await w.run(); else { w.m.status = 'declined'; demoSay('Left as it is.'); }
    demoPaint(false);
  }
  function demoStop() { if (demo.wait) { demo.wait.m.status = 'declined'; demo.wait = null; } demoPaint(false); }

  /* ---- start ------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', () => {
    build(); wire();
    window.addEventListener('dv-state', e => { live = e.detail || {}; });
    // Warnings and refusals anywhere in the app become something the assistant can explain.
    const plain = window.toast;
    if (typeof plain === 'function') window.toast = function (message, kind) {
      if ((kind === 'bad' || kind === 'warn') && typeof message === 'string') { lastTrouble = message.slice(0, 400); if (open && el.body.dataset.view === 'chat') drawIdeas(); }
      return plain.apply(this, arguments);
    };
    setTimeout(refresh, 1200);
  });

  window.Assistant = { open: () => toggle(true), close: () => toggle(false), ask: send, refresh };
})();
