/* assistant.js: the AI assistant's panel.
 *
 * A strip on the right edge (a sheet on a phone), so the twin and the camera stay in view while the
 * assistant works the printer. Three screens in one panel:
 *   connect   your own AI: a Claude or ChatGPT plan first, then a model on this computer, then an API
 *             key. Any number stay connected; one is in use.
 *   settle    a short moment after connecting while it reads the printer, then it fades into
 *   chat      messages, the steps it took (drawn like a toolpath), a switcher for the AI and its model,
 *             and Approve / Decline for the few steps that wait for a yes
 * The server (backend/ai_assistant.py) decides what is allowed; this file only shows it. In the online
 * demo there is no server, so a small scripted helper answers and says that it is one.
 *
 * With no AI connected the app looks exactly as it does without this file, apart from the Ask button:
 * the shortcuts in SPOTS are added to cards only once an AI answers, and taken away when it is gone.
 */
(function () {
  const KEY = 'dejavu1.ai.thread';
  const GLOW_MS = 60000;
  const el = {};
  let st = null;            // GET /api/assistant
  let open = false, seen = 0, polling = null, live = {}, lastTrouble = '', picked = null, wasReady = false, glowing = null;
  const rows = new Map();   // message number -> element
  const lists = {};         // provider id -> its model list, as the server last read it

  const isDemo = () => typeof tour !== 'undefined' && tour.on;
  const threadId = () => {
    let id = store.get(KEY);
    if (!id) { id = 'dv' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set(KEY, id); }
    return id;
  };
  const short = name => String(name || '').split(' (')[0];
  const count = n => Number(n || 0).toLocaleString('en-US');

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

  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 9.5h8M8 12.5h5"/></svg>';

  function build() {
    const launch = document.createElement('button');
    launch.className = 'ai-launch liquid-glass';
    launch.id = 'ai-launch';
    launch.type = 'button';
    launch.setAttribute('aria-label', 'Open the assistant');
    launch.setAttribute('aria-expanded', 'false');
    launch.setAttribute('aria-controls', 'ai-panel');
    launch.innerHTML = ICON + '<span>Ask</span>';
    const panel = document.createElement('section');
    panel.className = 'ai-panel liquid-glass deep';
    panel.id = 'ai-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'ai-title');
    panel.innerHTML = `
      <header class="ai-head">
        <div><h2 id="ai-title" tabindex="-1">Assistant</h2><p class="ai-sub" id="ai-sub"></p></div>
        <div class="ai-head-btns">
          <button class="btn small" id="ai-settings" type="button" hidden>Connections</button>
          <button class="btn small" id="ai-close" type="button" aria-label="Close the assistant">Close</button>
        </div>
      </header>
      <div class="ai-body" id="ai-body"></div>`;
    const glow = document.createElement('div');
    glow.className = 'ai-glow';
    glow.setAttribute('aria-hidden', 'true');
    glow.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.append(launch, panel, glow);
    Object.assign(el, { launch, panel, glow, body: panel.querySelector('#ai-body'), sub: panel.querySelector('#ai-sub'),
      settings: panel.querySelector('#ai-settings') });
    launch.addEventListener('click', () => toggle());
    panel.querySelector('#ai-close').addEventListener('click', () => toggle(false));
    el.settings.addEventListener('click', () => (el.body.dataset.view === 'chat' ? showConnect() : showChat()));
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); }
      else if (e.key === 'Escape' && open && panel.contains(document.activeElement)) toggle(false);
    });
  }

  function take(body) {
    if (body && body.providers) st = body;
    decorate();
    drawPage();
    return st;
  }

  async function refresh() {
    if (isDemo()) {
      st = st || { demo: true, ready: true, mode: 'free', providers: [], modes: {}, provider: 'demo', connections: [], never_ask: [] };
      const rec = await getJSON('/api/assistant').catch(() => ({}));
      if (rec && rec.providers) Object.assign(st, { providers: rec.providers.map(p => ({ ...p, installed: false, has_key: false, ready: false })), modes: rec.modes, default_mode: rec.default_mode, limits: rec.limits, security: rec.security });
      decorate();
      drawPage();
      return st;
    }
    const body = await getJSON('/api/assistant');
    st = body && body.providers ? body : null;
    el.launch.hidden = !st;
    decorate();
    drawPage();
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

  /* The edge of the screen glows for a minute the first time an AI answers, then goes back to normal. */
  function glow() {
    clearTimeout(glowing);
    document.documentElement.classList.remove('ai-glow-on');
    void el.glow.offsetWidth;                       // restart the animation if it was already running
    document.documentElement.classList.add('ai-glow-on');
    glowing = setTimeout(() => document.documentElement.classList.remove('ai-glow-on'), GLOW_MS);
  }

  /* ---- connect ---------------------------------------------------------- */

  const provider = id => (st.providers || []).find(p => p.id === id);

  function planState(p) {
    if (st.demo) return '';
    if (!p.installed) return 'Not installed';
    if (p.signed_in === false) return 'Not signed in';
    return p.signed_in ? 'Signed in' : 'Installed';
  }

  function tile(p) {
    const inUse = p.id === st.provider && st.ready;
    const joined = (st.connections || []).some(c => c.id === p.id);
    const state = inUse ? 'In use' : joined ? 'Connected' : p.kind === 'cli' ? planState(p) : p.has_key ? 'Key saved' : '';
    return `<li><button type="button" class="ai-prov${inUse ? ' is-on' : ''}" data-id="${esc(p.id)}">
      <span class="ai-prov-name">${esc(p.kind === 'key' ? short(p.name) : p.name)}</span>
      <span class="ai-prov-state">${esc(state)}</span></button></li>`;
  }

  const modesHTML = group => Object.entries(st.modes || {}).map(([id, text]) => {
    const [name, rest] = text.split(': ');
    return `<label class="ai-mode"><input type="radio" name="${group}" value="${esc(id)}" ${id === st.mode ? 'checked' : ''}><span><b>${esc(name)}${id === st.default_mode ? ' <i>the usual choice</i>' : ''}</b>${esc(rest || '')}</span></label>`;
  }).join('');
  const limitsText = () => `These limits hold whatever you choose: heater limits, the printer’s own size, no moves before homing, the nozzle kept ${esc(String((st.limits || {}).z_floor_mm || 2))} mm off the bed, and a print starts only from Confirm Print.`;

  /* ---- the AI tab: everything about the assistant on one screen ------------ */

  function drawPage() {
    const host = document.getElementById('ai-page');
    if (!host || host.closest('[hidden]')) return;
    if (!st) { host.innerHTML = '<section class="card liquid-glass"><div class="card-head"><div><h2>AI assistant</h2><p class="card-sub">Switched off. Turn it on in Settings, Optional extras.</p></div></div></section>'; return; }
    const joined = st.connections || [], now = joined.find(c => c.id === st.provider), sec = st.security || {};
    const by = level => (st.tools || []).filter(t => level.includes(t.level)).map(t => esc(t.what.replace(/\.$/, ''))).join(' · ');
    host.innerHTML = `
      <section class="card liquid-glass" id="ai-now"><div class="card-head"><div><h2>Your AI</h2><p class="card-sub">${st.demo ? 'Online demo: a scripted helper stands in for an AI' : now ? 'Connected and in use' : 'Nothing connected yet'}</p></div></div>
        ${now ? `<p class="ai-page-now"><b>${esc(now.name)}</b><span>${esc(now.model || 'its usual model')}</span></p>
          ${joined.length > 1 ? `<label class="ai-field"><span>Switch to</span><select id="ai-page-conn">${joined.map(c => `<option value="${esc(c.id)}"${c.id === st.provider ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}`
        : `<p class="ai-hint">Deja Vu1 does everything without an AI. Connect one and you can also ask for things in your own words: run the printer, explain a warning, check a print through the camera, make a part or cut holes in one of yours.</p>
          <p class="ai-hint">Best with a Claude or ChatGPT plan you already pay for. A model on this computer and an API key work too.</p>`}
        <div class="ai-actions">${now || st.demo ? '<button class="btn primary" type="button" data-ai-open="chat">Open the assistant</button>' : ''}
          <button class="btn${now || st.demo ? '' : ' primary'}" type="button" data-ai-open="connect">${now ? 'Add or manage connections' : 'Connect an AI'}</button></div>
        <p class="ai-hint ai-page-tip">The Ask button at the bottom right opens it from any screen. So does Ctrl+J (Cmd+J on a Mac).</p></section>
      <section class="card liquid-glass" id="ai-may"><div class="card-head"><div><h2>How much it may do</h2><p class="card-sub">Applies to every AI you connect</p></div></div>
        <div class="ai-modes">${modesHTML('ai-mode-page')}</div>
        ${(st.never_ask || []).length ? `<p class="ai-hint ai-never">Never asks about: ${st.never_ask.map(n => `<button type="button" class="ai-chip" data-reask="${esc(n.tool)}" aria-label="Ask again about: ${esc(n.label)}">${esc(n.label)} <span aria-hidden="true">×</span></button>`).join('')}</p>` : ''}
        <p class="ai-hint ai-page-tip">${limitsText()}</p></section>
      ${costCard()}
      <section class="card liquid-glass" id="ai-private"><div class="card-head"><div><h2>Privacy and keys</h2><p class="card-sub">What leaves this computer, and how a key is kept</p></div></div>
        <p class="ai-hint">The AI you choose receives what you type, the printer’s readings and the results of its steps. A camera picture goes only when it looks through the camera. A model on this computer keeps all of that at home.</p>
        <div class="ai-safe"><h4>How a key is kept on this computer</h4>
          <p>${esc(st.demo ? 'Deja Vu1 hands the key to your computer’s own keyring: Windows Data Protection, the macOS Keychain, or the desktop keyring on Linux. Where none answers it uses a file only your account can open, and tells you so.' : sec.how || '')}</p>${sec.problem && !st.demo ? `<p class="ai-safe-warn">${esc(sec.problem)}</p>` : ''}
          <ul>${(sec.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
        <p class="ai-hint ai-page-tip">A plan stores nothing here at all. If you use a key, make one only for Deja Vu1 and set a spending limit at the service.</p></section>
      <section class="card liquid-glass" id="ai-can"><div class="card-head"><div><h2>What it can do</h2><p class="card-sub">${(st.tools || []).length} named steps. It has no other way to reach the printer</p></div></div>
        <details class="ai-can"><summary>Reads</summary><p>${by(['read'])}</p></details>
        <details class="ai-can"><summary>Does, inside the limits</summary><p>${by(['safe', 'ask'])}</p></details>
        <details class="ai-can"><summary>Hands to you</summary><p>${by(['handoff', 'proposal'])}</p></details></section>`;
  }

  function costCard() {
    const p = st.price || {}, now = (st.connections || []).find(c => c.id === st.provider);
    const where = { service: 'the price the service lists', yours: 'the price you entered' }[p.from] || '';
    const state = st.demo ? 'Nothing in the online demo costs anything.'
      : !now ? 'Connect an AI to see what a message costs.'
      : p.charge === 'plan' ? 'Your plan covers it: messages use its allowance, with no charge per message.'
      : p.charge === 'none' ? 'It runs on this computer, so a message costs nothing.'
      : p.charge === 'tokens' ? `${esc(now.model || now.name)}: $${esc(p.in)} per million tokens in, $${esc(p.out)} out, from ${where}.`
      : `${esc(now.model || now.name)}: the service lists no price, so no cost is shown. Type it from the service’s pricing page.`;
    const keyed = now && !st.demo && ['tokens', 'unknown'].includes(p.charge);
    return `<section class="card liquid-glass" id="ai-cost-card"><div class="card-head"><div><h2>Cost and limit</h2><p class="card-sub">See what a message costs before you send it</p></div></div>
      <p class="ai-hint">${state}</p>
      ${keyed ? `<form class="ai-budget" id="ai-budget">
        <div class="ai-budget-row"><label class="ai-field"><span>Price in <i>$ per million tokens</i></span><input id="ai-price-in" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${p.from === 'yours' ? esc(p.in) : ''}" placeholder="${p.from === 'service' ? esc(p.in) : 'From its pricing page'}"></label>
        <label class="ai-field"><span>Price out <i>$ per million tokens</i></span><input id="ai-price-out" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${p.from === 'yours' ? esc(p.out) : ''}" placeholder="${p.from === 'service' ? esc(p.out) : ''}"></label></div>
        <label class="ai-field"><span>Stop a request after <i>$, empty for no limit</i></span><input id="ai-cap" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${st.cap_usd ? esc(st.cap_usd) : ''}" placeholder="No limit"></label>
        <div class="ai-actions"><button class="btn primary" type="submit">Save</button>${p.from === 'yours' ? '<button class="btn" type="button" id="ai-price-clear">Forget my price</button>' : ''}</div>
      </form>
      <p class="ai-hint ai-page-tip">Before each message the assistant shows about how many tokens it will read and what that costs. Once the service answers, its own count is used. With a limit, a request that would pass it stops and says so.</p>` : ''}</section>`;
  }

  function wirePage() {
    const host = document.getElementById('ai-page');
    if (!host) return;
    const post = async body => {
      if (st.demo) { if (body.mode) st.mode = body.mode; return; }
      const res = await postJSON('/api/assistant/select', body);
      if (res.ok) take(res.body); else toast(res.body.error || 'That was not saved', 'bad');
    };
    host.addEventListener('submit', async e => {
      if (e.target.id !== 'ai-budget') return;
      e.preventDefault();
      const v = id => host.querySelector(id).value.trim();
      const body = { cap_usd: v('#ai-cap') || 0 };
      if (v('#ai-price-in') || v('#ai-price-out')) Object.assign(body, { price_in: v('#ai-price-in') || 0, price_out: v('#ai-price-out') || 0 });
      const res = await postJSON('/api/assistant/budget', body);
      if (res.ok) { take(res.body); toast('Saved', 'ok'); } else toast(res.body.error || 'That was not saved', 'bad');
    });
    host.addEventListener('change', e => {
      if (e.target.name === 'ai-mode-page') post({ mode: e.target.value });
      else if (e.target.id === 'ai-page-conn') post({ provider: e.target.value });
    });
    host.addEventListener('click', async e => {
      if (e.target.id === 'ai-price-clear') {
        const res = await postJSON('/api/assistant/budget', { clear_price: true });
        if (res.ok) take(res.body);
        return;
      }
      const go = e.target.closest('[data-ai-open]'), again = e.target.closest('[data-reask]');
      if (again) return post({ never_ask: st.never_ask.map(n => n.tool).filter(t => t !== again.dataset.reask) });
      if (!go) return;
      if (!open) await toggle(true);
      if (go.dataset.aiOpen === 'connect') showConnect(); else if (st.ready) showChat();
    });
  }

  function showConnect() {
    stopPoll();
    el.body.dataset.view = 'connect';
    el.settings.hidden = !st.ready;
    el.settings.textContent = 'Back to chat';
    el.sub.textContent = st.ready ? 'Your connections and what the assistant may do' : 'Connect an AI you already have';
    const of = kind => st.providers.filter(p => (kind === 'local' ? p.kind === 'local' || p.kind === 'custom' : p.kind === kind));
    const sec = st.security || {};
    const keysOpen = of('key').some(p => p.has_key) || (picked && (provider(picked) || {}).kind === 'key');
    const joined = st.connections || [];
    const modes = modesHTML('ai-mode');
    el.body.innerHTML = `
      ${st.demo ? '<p class="ai-note">Online demo: a scripted helper answers here, on a simulated printer. On your own computer you connect one of these.</p>' : ''}
      ${joined.length ? `<section class="ai-group"><h3>Connected</h3>
        <ul class="ai-joined">${joined.map(c => `<li class="${c.id === st.provider ? 'is-on' : ''}">
          <button type="button" class="ai-joined-main" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(c.model || 'its usual model')}</span></button>
          ${c.id === st.provider ? '<span class="ai-prov-state">In use</span>' : `<button type="button" class="btn small" data-use="${esc(c.id)}">Use</button>`}
          <button type="button" class="btn small" data-drop="${esc(c.id)}" aria-label="Disconnect ${esc(c.name)}">Disconnect</button></li>`).join('')}</ul>
        <p class="ai-hint">Keep as many as you like and switch at any time, here or above the chat.</p></section>` : ''}
      <section class="ai-group" data-kind="cli"><h3>Use a plan you already pay for <span class="ai-badge">Best choice</span></h3>
        <p class="ai-hint">Deja Vu1 runs the program you are signed in to and reads its answer. Nothing is stored here: no password, no key, no extra bill.</p>
        <ul class="ai-providers">${of('cli').map(tile).join('')}</ul><div class="ai-slot" data-slot="cli"></div></section>
      <section class="ai-group" data-kind="local"><h3>Run a model on this computer</h3>
        <p class="ai-hint">Free and private: nothing leaves your computer. Smaller models make more mistakes with printer commands.</p>
        <ul class="ai-providers">${of('local').map(tile).join('')}</ul><div class="ai-slot" data-slot="local"></div></section>
      <details class="ai-group ai-keys" data-kind="key"${keysOpen ? ' open' : ''}><summary><h3>Use an API key instead</h3><span>${of('key').length} services</span></summary>
        <p class="ai-hint">It works, and it is the least private way. A key is a password that spends your money, so use a plan or a local model when you can. If you use a key, make one only for Deja Vu1 and set a spending limit at the service.</p>
        <div class="ai-safe"><h4>How a key is kept on this computer</h4>
          <p>${esc(st.demo ? 'Deja Vu1 hands the key to your computer’s own keyring: Windows Data Protection, the macOS Keychain, or the desktop keyring on Linux. Where none answers it uses a file only your account can open, and tells you so.' : sec.how || '')}</p>${sec.problem && !st.demo ? `<p class="ai-safe-warn">${esc(sec.problem)}</p>` : ''}
          <ul>${(sec.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
        <div class="ai-slot" data-slot="key"></div>
        <label class="ai-search"><span class="sr-only">Find a service</span><input id="ai-find" type="search" placeholder="Find a service" autocomplete="off"></label>
        <ul class="ai-providers">${of('key').map(tile).join('')}</ul></details>
      <section class="ai-group"><h3>How much it may do</h3>
        <p class="ai-hint">${limitsText()}</p>
        <div class="ai-modes">${modes}</div>
        ${(st.never_ask || []).length ? `<p class="ai-hint ai-never">Never asks about: ${st.never_ask.map(n => `<button type="button" class="ai-chip" data-reask="${esc(n.tool)}" aria-label="Ask again about: ${esc(n.label)}">${esc(n.label)} <span aria-hidden="true">×</span></button>`).join('')}</p>` : ''}
      </section>`;
    const post = async (path, body) => {
      if (st.demo) return false;
      const res = await postJSON(path, body);
      if (res.ok) take(res.body); else toast(res.body.error || 'That was not saved', 'bad');
      return res.ok;
    };
    el.body.querySelectorAll('.ai-prov, .ai-joined-main').forEach(b => b.addEventListener('click', () => openForm(b.dataset.id)));
    el.body.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', async () => { if (await post('/api/assistant/select', { provider: b.dataset.use })) showConnect(); }));
    el.body.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', async () => {
      const name = (provider(b.dataset.drop) || {}).name;
      if (await post('/api/assistant/forget', { provider: b.dataset.drop })) { picked = null; showConnect(); toast(`${name}: disconnected`, 'info'); }
    }));
    el.body.querySelectorAll('[data-reask]').forEach(b => b.addEventListener('click', async () => {
      if (await post('/api/assistant/select', { never_ask: st.never_ask.map(n => n.tool).filter(t => t !== b.dataset.reask) })) showConnect();
    }));
    el.body.querySelectorAll('[name=ai-mode]').forEach(r => r.addEventListener('change', () => {
      if (st.demo) { st.mode = r.value; return; }
      post('/api/assistant/select', { mode: r.value });
    }));
    el.body.querySelector('#ai-find').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      el.body.querySelectorAll('.ai-keys .ai-providers li').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
    });
    if (picked) openForm(picked, true);
  }

  /* The model chooser: the list the service or program itself reports, newest first. */
  function modelField(p, list, current) {
    const rowsOf = (list && list.rows) || [];
    const cli = p.kind === 'cli';
    const known = rowsOf.some(r => r.id === current);
    const price = r => (r.in_per_million != null && r.out_per_million != null ? ` · $${r.in_per_million} in, $${r.out_per_million} out per million tokens` : '');
    const text = r => (r.label && r.label.length < 60 ? `${r.id} · ${r.label}` : r.id) + price(r);
    return `<label class="ai-field"><span>Model${cli ? '' : rowsOf.length ? ` <i>${rowsOf.length} listed, newest first</i>` : ''}</span>
      <select id="ai-model">
        ${cli ? '<option value="">Your plan’s usual model</option>' : rowsOf.length ? '' : '<option value="">Connect to see the list</option>'}
        ${rowsOf.map(r => `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(text(r))}</option>`).join('')}
        <option value="__other"${current && !known ? ' selected' : ''}>Type a name…</option>
      </select>
      <input id="ai-model-other" type="text" value="${esc(current && !known ? current : '')}" placeholder="The model’s exact name" autocomplete="off" spellcheck="false" aria-label="Model name"${current && !known ? '' : ' hidden'}></label>
      ${list && list.note ? `<p class="ai-hint">${esc(list.note)}</p>` : ''}`;
  }
  function wireModel(form) {
    const select = form.querySelector('#ai-model'), other = form.querySelector('#ai-model-other');
    if (select) select.addEventListener('change', () => { other.hidden = select.value !== '__other'; if (!other.hidden) other.focus(); });
  }
  const modelValue = form => {
    const select = form.querySelector('#ai-model');
    if (!select) return '';
    return (select.value === '__other' ? form.querySelector('#ai-model-other').value : select.value).trim();
  };

  async function readModels(id, refreshList) {
    const res = await postJSON('/api/assistant/models', { provider: id, refresh: !!refreshList });
    if (res.ok) lists[id] = res.body;
    return res;
  }

  async function openForm(id, quiet) {
    const p = provider(id);
    if (!p) return;
    const slot = el.body.querySelector(`.ai-slot[data-slot="${p.kind === 'custom' ? 'local' : p.kind}"]`);
    if (!slot) return;
    picked = id;
    if (p.kind === 'key') el.body.querySelector('.ai-keys').open = true;
    el.body.querySelectorAll('.ai-slot').forEach(s => { if (s !== slot) s.innerHTML = ''; });
    el.body.querySelectorAll('.ai-prov').forEach(b => b.classList.toggle('is-picked', b.dataset.id === id));
    const cli = p.kind === 'cli', needsKey = p.kind === 'key', address = p.kind === 'local' || p.kind === 'custom';
    const joined = (st.connections || []).some(c => c.id === id);
    const draw = () => {
      const q = provider(id) || p, model = (st.models || {})[id] || '';
      const absent = cli && !st.demo && !q.installed, signedOut = cli && !st.demo && q.installed && q.signed_in === false;
      slot.innerHTML = `<div class="ai-form" id="ai-form">
        <h3>${esc(q.name)}</h3>
        ${q.note ? `<p class="ai-hint">${esc(q.note)}</p>` : ''}
        ${absent ? `<p class="ai-step-help"><b>1.</b> <a href="${esc(q.install_url)}" target="_blank" rel="noopener">Install ${esc(q.id === 'codex' ? 'Codex' : 'Claude Code')}</a> (one command). <b>2.</b> Sign in with <code>${esc(q.signin)}</code>. <b>3.</b> Come back and press Check again.</p>` : ''}
        ${signedOut ? `<p class="ai-step-help">Found${q.version ? ` (${esc(q.version)})` : ''}, but nobody is signed in. Open a terminal, run <code>${esc(q.signin)}</code> <button type="button" class="ai-copy" data-copy="${esc(q.signin)}">Copy</button>, then press Check again.</p>` : ''}
        ${cli && !st.demo && q.installed && q.signed_in ? `<p class="ai-ok">Found and signed in${q.version ? ` (${esc(q.version)})` : ''}.</p>` : ''}
        ${address ? `<label class="ai-field"><span>Address</span><input id="ai-base" type="url" value="${esc(q.base_url || '')}" placeholder="http://localhost:8080/v1" autocomplete="off"></label>` : ''}
        ${cli ? '' : `<label class="ai-field"><span>${needsKey ? 'Key' : 'Key (only if it asks for one)'}</span>
          <input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="${q.has_key && !q.from_environment ? `Saved ${esc(q.key_hint || '')}. Paste a new one to replace it` : 'Paste the key'}"></label>
          ${q.key_url ? `<p class="ai-hint"><a href="${esc(q.key_url)}" target="_blank" rel="noopener">Get a key from ${esc(short(q.name))}</a>${q.from_environment ? `. This computer’s ${esc(q.env)} setting holds a key, so Deja Vu1 stores nothing.` : q.env ? `. Or set ${esc(q.env)} on this computer and Deja Vu1 stores nothing.` : ''}</p>` : ''}`}
        ${absent || signedOut ? '' : modelField(q, lists[id], model)}
        <p class="ai-status" id="ai-status" role="status"></p>
        <div class="ai-actions">
          ${absent || signedOut ? '<button class="btn primary" id="ai-recheck" type="button">Check again</button>' : `<button class="btn primary" id="ai-connect" type="button">${joined ? 'Save and use' : 'Connect'}</button>`}
          ${!cli && lists[id] && lists[id].rows && lists[id].rows.length ? '<button class="btn" id="ai-relist" type="button">Refresh the list</button>' : ''}
          ${joined || q.has_key && !q.from_environment || (address && q.ready && q.kind === 'custom') ? `<button class="btn" id="ai-forget" type="button">${cli ? 'Disconnect' : 'Forget'}</button>` : ''}
        </div></div>`;
      const mark = el.body.querySelector(`.ai-prov[data-id="${id}"] .ai-prov-state`);
      if (mark && cli && !joined) mark.textContent = planState(q);
      wire();
    };
    const say = (text, kind) => { const s = slot.querySelector('#ai-status'); if (s) { s.textContent = text; s.dataset.kind = kind || ''; } };
    const check = async () => {
      if (st.demo || !cli) return;
      const res = await postJSON('/api/assistant/check', { provider: id });
      if (res.ok) take(res.body);
    };
    function wire() {
      const form = slot.querySelector('#ai-form');
      wireModel(form);
      form.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; }, () => {});
      }));
      const again = form.querySelector('#ai-recheck');
      if (again) again.addEventListener('click', async () => { again.disabled = true; say('Checking…'); await check(); await loadList(); draw(); });
      const relist = form.querySelector('#ai-relist');
      if (relist) relist.addEventListener('click', async () => { relist.disabled = true; say('Reading the list of models…'); const res = await readModels(id, true); draw(); if (!res.ok) say(res.body.error || 'The list could not be read', 'bad'); });
      const forget = form.querySelector('#ai-forget');
      if (forget) forget.addEventListener('click', async () => {
        const res = await postJSON('/api/assistant/forget', { provider: id });
        if (res.ok) { take(res.body); delete lists[id]; picked = null; showConnect(); toast(`${p.name}: ${cli ? 'disconnected' : 'key forgotten'}`, 'info'); }
      });
      const connect = form.querySelector('#ai-connect');
      if (connect) connect.addEventListener('click', async () => {
        if (st.demo) { say('The online demo can’t connect a real AI. Install Deja Vu1 on your computer to use your own.', 'warn'); return; }
        const key = (form.querySelector('#ai-key') || {}).value || '', base = (form.querySelector('#ai-base') || {}).value || '';
        let wanted = modelValue(form);
        connect.disabled = true;
        try {
          if (!cli && (key || base || !(provider(id) || p).ready)) {
            say('Saving…');
            const saved = await postJSON('/api/assistant/key', { provider: id, api_key: key || undefined, base_url: base || undefined });
            if (!saved.ok) { say(saved.body.error || 'That could not be saved', 'bad'); return; }
            take(saved.body);
            delete lists[id];
          }
          if (!cli && !lists[id]) {
            say('Reading the list of models…');
            const list = await readModels(id);
            if (!list.ok) { say(list.body.error || 'The list of models could not be read', 'bad'); return; }
            if (!wanted) wanted = list.body.suggested || '';
            if (!wanted) { st.models = { ...st.models, [id]: '' }; draw(); say(list.body.note || 'Pick a model, then press Connect', 'warn'); return; }
          }
          if (!cli && !wanted) { say('Pick a model, then press Connect', 'warn'); return; }
          const chosen = await postJSON('/api/assistant/select', { provider: id, model: wanted });
          if (!chosen.ok) { say(chosen.body.error || 'That model name was not accepted', 'bad'); return; }
          say('Checking the connection…');
          const test = await postJSON('/api/assistant/test', { provider: id });
          if (!test.ok) { await check(); draw(); say(test.body.error || 'The connection check failed', 'bad'); return; }
          take(test.body);
          picked = null;
          if (test.body.first) glow();
          settle();
        } finally { connect.disabled = false; }
      });
    }
    async function loadList() {
      const q = provider(id) || p;
      if (st.demo || lists[id]) return;
      if (cli ? q.installed : q.ready) await readModels(id);
    }
    draw();
    if (!quiet) slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!st.demo) { await check(); await loadList(); if (picked === id && slot.isConnected) draw(); }
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
      ['Make a phone stand', 'Make a simple phone stand from a few solid parts and save it to my files.']);
    return out.slice(0, 5);
  }

  function showChat() {
    el.body.dataset.view = 'chat';
    el.settings.hidden = false;
    el.settings.textContent = 'Connections';
    el.sub.textContent = st.demo ? 'Online demo: a scripted helper on a simulated printer' : 'Your own AI, inside the printer’s limits';
    const joined = st.connections || [];
    el.body.innerHTML = `
      ${st.demo ? '' : `<div class="ai-bar" role="group" aria-label="The AI in use">
        <label><span class="sr-only">AI in use</span><select id="ai-conn">${joined.map(c => `<option value="${esc(c.id)}"${c.id === st.provider ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__more">Add or manage…</option></select></label>
        <label><span class="sr-only">Model</span><select id="ai-pick"></select></label></div>`}
      <div class="ai-log" id="ai-log" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div class="ai-ideas" id="ai-ideas"></div>
      <form class="ai-compose" id="ai-compose">
        <label class="sr-only" for="ai-text">Message the assistant</label>
        <textarea id="ai-text" rows="1" maxlength="6000" placeholder="Ask, or tell it what to do"></textarea>
        <button class="btn primary" id="ai-send" type="submit">Send</button>
        <button class="btn danger" id="ai-stop" type="button" hidden>Stop</button>
      </form>
      <p class="ai-cost" id="ai-cost" aria-live="polite"></p>
      <div class="ai-foot"><span id="ai-usage" class="ai-usage"></span><button class="ai-clear" id="ai-clear" type="button">Start over</button></div>`;
    rows.clear(); seen = 0;
    const text = el.body.querySelector('#ai-text');
    el.body.querySelector('#ai-compose').addEventListener('submit', e => { e.preventDefault(); send(text.value); });
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text.value); } });
    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; costSoon(); });
    el.body.querySelector('#ai-stop').addEventListener('click', () => (st.demo ? demoStop() : postJSON('/api/assistant/stop', { thread: threadId() }).then(poll)));
    el.body.querySelector('#ai-clear').addEventListener('click', async () => {
      if (!st.demo) await postJSON('/api/assistant/clear', { thread: threadId() });
      store.set(KEY, ''); demo.log = []; demo.n = 0; showChat();
    });
    wireBar();
    drawIdeas();
    costSoon(0);
    if (!wasReady) { wasReady = true; greet(); }
    if (st.demo) demoPaint(); else poll();
    text.focus({ preventScroll: true });
  }

  /* Above the chat: which AI is answering, and its model. Both change with one pick. */
  async function wireBar() {
    const conn = el.body.querySelector('#ai-conn'), pick = el.body.querySelector('#ai-pick');
    if (!conn) return;
    const fill = () => {
      const p = provider(st.provider) || {}, list = lists[st.provider], current = st.model || '';
      const rowsOf = (list && list.rows) || [];
      pick.innerHTML = (p.kind === 'cli' ? '<option value="">Usual model</option>' : '')
        + rowsOf.map(r => `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(r.id)}</option>`).join('')
        + (current && !rowsOf.some(r => r.id === current) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : '')
        + '<option value="__other">Another model…</option>';
    };
    fill();
    conn.addEventListener('change', async () => {
      if (conn.value === '__more') { showConnect(); return; }
      const res = await postJSON('/api/assistant/select', { provider: conn.value });
      if (res.ok) take(res.body); else toast(res.body.error || 'That AI could not be chosen', 'bad');
      fill();
      if (!lists[st.provider]) { await readModels(st.provider); fill(); }
    });
    pick.addEventListener('change', async () => {
      if (pick.value === '__other') { picked = st.provider; showConnect(); return; }
      const res = await postJSON('/api/assistant/select', { provider: st.provider, model: pick.value });
      if (res.ok) take(res.body); else toast(res.body.error || 'That model could not be chosen', 'bad');
      fill();
    });
    if (!lists[st.provider]) { await readModels(st.provider); if (pick.isConnected) fill(); }
  }

  function greet() {
    const log = el.body.querySelector('#ai-log');
    if (!log || log.children.length) return;
    log.insertAdjacentHTML('beforeend', `<div class="ai-msg is-assistant ai-hello"><p>Ready. Tell me what you want in your own words: I can run the printer, read your files and history, look through the camera, make parts and cut holes in your models.</p></div>`);
  }

  function drawIdeas() {
    const host = el.body.querySelector('#ai-ideas');
    if (!host) return;
    host.innerHTML = ideas().map(([label], i) => `<button type="button" class="ai-idea" data-i="${i}">${esc(label)}</button>`).join('');
    host.querySelectorAll('.ai-idea').forEach(b => b.addEventListener('click', () => send(ideas()[+b.dataset.i][1])));
  }

  const dollars = n => '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
  const brief = n => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : count(n));

  /* Before sending: what the next answer is likely to read and cost. The server counts the conversation
   * so far (the service's own figure once it has answered) and prices it only at a known price. */
  let costTimer = 0;
  function costSoon(wait = 450) {
    clearTimeout(costTimer);
    costTimer = setTimeout(drawCost, wait);
  }
  async function drawCost() {
    const host = el.body.querySelector('#ai-cost'), box = el.body.querySelector('#ai-text');
    if (!host || !st || st.demo || !st.ready) { if (host) host.textContent = ''; return; }
    const res = await postJSON(api('/api/assistant/estimate'), { thread: threadId(), text: box ? box.value : '' }).catch(() => null);
    if (!res || !res.ok || !res.body.ready || !host.isConnected) return;
    host.innerHTML = costText(res.body);
    host.classList.toggle('is-over', !!res.body.over_cap);
  }
  function costText(e) {
    const p = e.price || {};
    if (p.charge === 'plan') return 'Uses your plan’s allowance: no charge per message.';
    if (p.charge === 'none') return 'Runs on this computer: no charge.';
    const tokens = `about ${brief(e.tokens_in)} tokens in`;
    const how = e.basis === 'estimate' ? ' Estimated from the text, at about 4 characters a token.' : '';
    if (p.charge !== 'tokens' || e.cost_usd == null) {
      return `Next answer: ${tokens}.${how} <button type="button" class="ai-link" data-place="ai" data-part="ai-cost-card">Add this model’s price</button> to see a cost before you send.`;
    }
    const out = e.tokens_out != null ? `, with answers here about ${brief(e.tokens_out)} tokens long` : ', plus the answer';
    const rounds = e.answers_per_request > 1 ? ` A request here has taken about ${e.answers_per_request} answers.` : '';
    const cap = e.cap_usd ? ` Your limit: ${dollars(e.cap_usd)} a request.` : '';
    const over = e.over_cap ? ' <b>That is over your limit, so it won’t send.</b>' : '';
    return `Next answer: about <b>${dollars(e.cost_usd)}</b> for ${tokens}${out}.${how}${rounds}${cap}${over}`;
  }

  /* Only what the service itself reported; nothing here is an estimate of ours. */
  function drawUsage(u) {
    const host = el.body.querySelector('#ai-usage');
    if (!host) return;
    if (!u || !u.counted) { host.textContent = ''; return; }
    const plan = (provider(st.provider) || {}).kind === 'cli';
    const cost = u.cost_usd ? ` · ${dollars(u.cost_usd)}${plan ? ' list price, in your plan' : ''}`
      : u.priced_usd ? ` · about ${dollars(u.priced_usd)} at ${(st.price || {}).from === 'yours' ? 'your' : 'the listed'} price` : '';
    host.textContent = `${brief(u.in)} tokens in · ${brief(u.out)} out${cost}`;
    host.title = u.model ? `As reported by the service. Last answer came from ${u.model}.` : 'As reported by the service.';
  }

  const STATUS = { running: 'Working', waiting: 'Needs your yes', done: 'Done', refused: 'Refused', declined: 'Declined' };
  const PLACE = { printers: 'Printers', printer: 'the Printer page', library: 'the Library', prepare: 'Prepare', jobs: 'Jobs', materials: 'Materials', care: 'Care', settings: 'Settings', automations: 'Automations', overview: 'Overview' };

  function proposalHTML(m) {
    const p = m.proposal;
    return `<div class="ai-proposal">${p.why ? `<p>${esc(p.why)}</p>` : ''}
      <table><tbody>${(p.changes || []).map(c => `<tr><th scope="row">${esc(c.label)}<small>${esc(c.group)}</small></th><td>${esc(c.value)}${c.unit && !String(c.value).endsWith('%') ? ' ' + esc(c.unit) : ''}</td></tr>`).join('')}</tbody></table>
      <div class="ai-approve"><button class="btn primary" type="button" data-apply="${m.n}">Put these in the profile editor</button></div>
      <p class="ai-step-detail">Nothing changes until you save the profile there.</p></div>`;
  }

  function rowHTML(m) {
    if (m.role === 'user') return `<div class="ai-msg is-user"><p>${esc(m.text)}</p></div>`;
    if (m.role === 'assistant') return `<div class="ai-msg is-assistant">${rich(m.text)}</div>`;
    if (m.role === 'error' || m.role === 'note') return `<div class="ai-msg is-${m.role}" role="${m.role === 'error' ? 'alert' : 'status'}"><p>${esc(m.text)}</p></div>`;
    const wait = m.status === 'waiting', done = m.status === 'done';
    return `<div class="ai-step is-${esc(m.status)}${m.level === 'read' ? ' is-read' : ''}">
      <span class="ai-node" aria-hidden="true"></span>
      <div class="ai-step-main"><span class="ai-step-label">${esc(m.label)}</span><span class="ai-step-state">${STATUS[m.status] || ''}</span>
        ${m.detail && !(m.proposal && done) ? `<p class="ai-step-detail">${esc(m.detail)}</p>` : ''}
        ${wait ? `<div class="ai-approve"><button class="btn primary" type="button" data-yes="${m.n}">Approve</button><button class="btn" type="button" data-no="${m.n}">Decline</button><button class="ai-always" type="button" data-always="${m.n}">Approve, and don’t ask about this again</button></div>` : ''}
        ${m.proposal && done ? proposalHTML(m) : ''}
        ${m.handoff && m.handoff.kind === 'confirm_print' && done ? `<div class="ai-approve"><button class="btn primary" type="button" data-print="${esc(m.handoff.filename)}">Open Confirm Print</button></div>` : ''}
        ${m.handoff && m.handoff.kind === 'page' && done ? `<div class="ai-approve"><button class="btn" type="button" data-place="${esc(m.handoff.place)}">Go to ${esc(PLACE[m.handoff.place] || m.handoff.place)}</button></div>` : ''}
        ${m.file ? `<div class="ai-approve"><button class="btn" type="button" data-file="${esc(m.file)}">Open ${esc(m.file)}</button></div>` : ''}
      </div></div>`;
  }

  const proposals = new Map();   // message number -> the settings it suggested

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
      if (m.proposal) proposals.set(m.n, m.proposal);
      if (m.handoff && m.status === 'done' && !old) {
        if (m.handoff.kind === 'confirm_print' && window.Workshop) Workshop.openConfirm(m.handoff.filename, node);
        if (m.handoff.kind === 'page') location.hash = '#/' + m.handoff.place;
      }
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

  function applyProposal(n) {
    const p = proposals.get(n);
    if (!p || !window.PrintRoom) return;
    const map = {};
    (p.changes || []).forEach(c => { map[c.key] = c.value; });
    const shown = PrintRoom.applySuggested(map);
    location.hash = '#/prepare';
    toast(shown ? 'The suggested settings are in the profile editor. Review them, then save the profile.'
      : 'Open your presets in Prepare (Find presets) and the suggested settings fill in. Review them, then save the profile.', 'info', 7000);
  }

  function wire() {
    el.body.addEventListener('click', e => {
      const t = e.target.closest('[data-yes],[data-no],[data-always],[data-print],[data-file],[data-place],[data-apply]');
      if (!t) return;
      if (t.dataset.print) { if (window.Workshop) Workshop.openConfirm(t.dataset.print, t); return; }
      if (t.dataset.file) { if (window.Workshop && Workshop.openFile) Workshop.openFile(t.dataset.file, t); return; }
      if (t.dataset.place) {
        location.hash = '#/' + t.dataset.place;
        const part = t.dataset.part;
        if (part) setTimeout(() => { const n = document.getElementById(part); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
        return;
      }
      if (t.dataset.apply) { applyProposal(+t.dataset.apply); return; }
      const always = 'always' in t.dataset, yes = always || 'yes' in t.dataset, n = +(t.dataset.yes || t.dataset.no || t.dataset.always);
      t.parentElement.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (st.demo) return demoDecide(n, yes);
      postJSON(api('/api/assistant/decide'), { thread: threadId(), n, approve: yes, always }).then(res => {
        if (!res.ok) toast(res.body.error || 'That step could not be decided', 'bad');
        if (always) refresh();
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
      drawUsage(body.usage);
      seen = body.seq;
      if (body.busy) polling = setTimeout(poll, 700);
      else { drawIdeas(); costSoon(0); }
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

  /* ---- shortcuts around the app -------------------------------------------
   * One small "Ask" button in the heading of a card the assistant can help with. They exist only while
   * an AI is connected, so an app with no AI has nothing missing and nothing greyed out. Each sends what
   * is on that card along with the question. */
  const words = sel => { const n = document.querySelector(sel); return n ? n.innerText.replace(/\s+\n/g, '\n').trim().slice(0, 3500) : ''; };
  const SPOTS = [
    ['#file-detail .card-head', 'Ask about this file', () => [`Tell me what ${words('#fd-name')} needs to print and anything to watch for.`, words('#file-detail')]],
    ['#confirm-dialog .dialog-head, #confirm-dialog header', 'Explain these checks', () => ['Confirm Print is open. Explain each warning or block in plain words and what I should do about it.', words('#confirm-dialog')]],
    ['#attention .card-head', 'What first?', () => ['These things need me. Which one first, and how do I deal with it?', words('#attention')]],
    ['#insights-card .card-head', 'Explain', () => ['Explain what my print history says and what I should change.', words('#insights-card')]],
    ['#pp-console .card-head', 'Explain the replies', () => ['Explain the printer’s latest replies in the console in plain words.', words('#pp-console')]],
    ['#ov-upkeep .card-head', 'What matters most?', () => ['Which care task matters most right now, and how do I do it?', words('#ov-upkeep')]],
    ['#pp-mesh .card-head', 'Read this mesh', () => ['Read the bed mesh and tell me whether the bed is level enough, in plain words.', words('#pp-mesh')]]
  ];
  function decorate() {
    const ready = !!(st && st.ready && !st.demo);
    document.querySelectorAll('.ai-ask').forEach(b => { if (!ready) b.remove(); });
    if (!ready) return;
    SPOTS.forEach(([sel, label, make], i) => {
      const head = document.querySelector(sel);
      if (!head || head.querySelector('.ai-ask')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-ask';
      b.dataset.spot = i;
      b.innerHTML = ICON + `<span>${esc(label)}</span>`;
      b.addEventListener('click', () => { const [text, context] = make(); send(text, context); });
      head.appendChild(b);
    });
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
  /* A step that waits for a yes, the way the real assistant shows one. */
  function demoAsk(label, run, after) {
    const m = demoAdd({ role: 'action', label, status: 'waiting', level: 'ask' });
    demo.wait = { m, run: async () => { m.status = 'running'; demoPaint(true); const res = await run(); m.status = res.ok ? 'done' : 'refused'; m.detail = res.ok ? '' : (res.body.error || ''); demoSay(after(res.ok)); } };
  }
  async function demoSend(text) {
    demoAdd({ role: 'user', text });
    demoPaint(true);
    await new Promise(r => setTimeout(r, 600));
    const t = text.toLowerCase(), s = await getJSON(api('/api/printer')).catch(() => ({})) || {};
    const temp = (t.match(/(\d{2,3})\s*(?:°|degrees|c\b)/) || t.match(/to\s+(\d{2,3})/) || [])[1];
    const head = ((t.match(/\bt([0-3])\b/) || [])[1]) || '0';
    const busyPrint = s.state === 'printing' || s.state === 'paused';
    const asks = st.mode === 'ask', advice = st.mode === 'advice';
    if (advice && /home|cool|warm|heat|pause|resume|fan|cancel/.test(t)) demoSay('You set me to advice only, so I send the printer nothing. Choose another setting under Connections and ask again.');
    else if (/cancel|stop the print/.test(t)) {
      if (!busyPrint) demoSay('Nothing is printing, so there is nothing to cancel.');
      else if (st.mode === 'open') { const ok = await demoStep('Cancel the print', '/api/printer/control/cancel'); demoSay(ok ? 'Cancelled. The head is parked.' : 'The printer refused to cancel.'); }
      else { demoSay('Ending a print early is the one thing I ask about first.'); demoAsk('Cancel the print', () => postJSON(api('/api/printer/control/cancel'), {}), ok => (ok ? 'Cancelled. The head is parked.' : 'The printer refused to cancel.')); }
    } else if (/home/.test(t)) {
      if (busyPrint) demoSay('A print is on the bed, so I will leave the head where it is. Homing now would move it through the print.');
      else if (asks) demoAsk('Home all axes', () => postJSON(api('/api/printer/control/home'), { axes: ['X', 'Y', 'Z'] }), ok => (ok ? 'Homed X, Y and Z.' : 'The printer refused to home.'));
      else { const ok = await demoStep('Home all axes', '/api/printer/control/home', { axes: ['X', 'Y', 'Z'] }); demoSay(ok ? 'Homed X, Y and Z. Watch the twin: the head is back at its start.' : 'The printer refused to home.'); }
    } else if (/cool|heaters? off/.test(t)) {
      for (const h of ['T0', 'T1', 'T2', 'T3']) await demoStep(`Set ${h} to 0 °C`, '/api/printer/control/temperature', { toolhead: h, target: 0 });
      await demoStep('Set the bed to 0 °C', '/api/printer/control/bed-temperature', { target: 0 });
      demoSay('Every heater is off and cooling.');
    } else if (/warm|heat|preheat|pla|petg/.test(t)) {
      const target = +(temp || (/petg/.test(t) ? 240 : 210));
      const heat = () => postJSON(api('/api/printer/control/temperature'), { toolhead: 'T' + head, target });
      if (target > 300) demoSay(`I won’t set ${target} °C. The heater limit is 300 °C, and Deja Vu1 refuses anything above it whatever I ask for.`);
      else if (asks) demoAsk(`Set T${head} to ${target} °C`, heat, ok => (ok ? `T${head} is heating to ${target} °C.` : 'The printer refused that temperature.'));
      else { const ok = await demoStep(`Set T${head} to ${target} °C`, '/api/printer/control/temperature', { toolhead: 'T' + head, target }); demoSay(ok ? `T${head} is heating to ${target} °C. Watch its reading climb on the Printer page.` : 'The printer refused that temperature.'); }
    } else if (/pause/.test(t)) { const ok = await demoStep('Pause the print', '/api/printer/control/pause'); demoSay(ok ? 'Paused. Say resume when you are ready.' : 'There is nothing to pause right now.'); }
    else if (/resume|continue/.test(t)) { const ok = await demoStep('Resume the print', '/api/printer/control/resume'); demoSay(ok ? 'Resumed.' : 'There is nothing to resume right now.'); }
    else if (/fan/.test(t)) { const pct = Math.min(100, +(t.match(/(\d{1,3})\s*%?/) || [0, 50])[1]); const ok = await demoStep(`Set the fan to ${pct}%`, '/api/printer/control/fan', { percent: pct }); demoSay(ok ? `The fan is at ${pct}%.` : 'The printer refused the fan change.'); }
    else if (/print going|status|temperature|how is|where/.test(t)) {
      await demoStep('Read the printer', null, null, 'read');
      const heads = Object.entries(s.toolheads || {}).map(([k, h]) => `${k} ${Math.round(h.temperature)} °C`).join(', ');
      demoSay(`**${s.printer_name || 'The printer'}** is ${s.state || 'idle'}${s.current_file ? ` on ${s.current_file}, ${Math.round((s.progress || 0) * 100)}% done` : ''}.\n- Heads: ${heads || 'not reported'}\n- Bed: ${Math.round(s.bed_temperature || 0)} °C`);
    } else demoSay('This is the online demo’s scripted helper, so it only knows a few requests: home, warm up, cool down, pause, resume, cancel, set the fan, or how the print is going. With your own AI connected it reads your files, history and camera, makes parts and cuts holes in your models, suggests print settings and works the printer in your own words.');
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
    build(); wire(); wirePage();
    window.addEventListener('dv-tab', e => { if (e.detail && e.detail.tab === 'ai') (st ? drawPage() : refresh()); });
    window.addEventListener('dv-state', e => { live = e.detail || {}; });
    ['dv-tab', 'dv-section'].forEach(name => window.addEventListener(name, () => setTimeout(decorate, 0)));
    // Warnings and refusals anywhere in the app become something the assistant can explain.
    const plain = window.toast;
    if (typeof plain === 'function') window.toast = function (message, kind) {
      if ((kind === 'bad' || kind === 'warn') && typeof message === 'string') { lastTrouble = message.slice(0, 400); if (open && el.body.dataset.view === 'chat') drawIdeas(); }
      return plain.apply(this, arguments);
    };
    setTimeout(refresh, 1200);
  });

  window.Assistant = { open: () => toggle(true), close: () => toggle(false), ask: send, refresh, glow };
})();
