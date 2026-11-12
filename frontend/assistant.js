/* assistant.js: the AI assistant.
 *
 * The panel is a strip on the right edge (a sheet on a phone), so the twin and the camera stay in view
 * while the assistant works. It has four views:
 *   chat      the conversation: your message shows the moment you send it, the steps it takes are drawn
 *             like a toolpath, and results come back as small cards (readings, a sliced file, a new model,
 *             spools) with buttons that go straight there
 *   history   every saved conversation, newest first, to pick up where you left off
 *   connect   your own AI: a Claude or ChatGPT plan first (signed in from here), then a model on this
 *             computer, then an API key
 *   settle    a short moment after connecting while it reads the printer
 * It also draws the AI screen (#ai-page): the features first (print watch, print doctor, a spool from a
 * photo, rules in your own words, making a part, catching up), and the set-up in small cards below.
 *
 * With no AI connected the app looks as it does without this file, apart from a small Ask button and the
 * AI screen: the shortcuts in SPOTS, html.ai-on and every AI hint around the app exist only while an AI
 * answers, and go away the moment the last one is disconnected.
 * The server (backend/ai_assistant.py) decides what is allowed; this file only shows it. In the online
 * demo there is no server, so a small scripted helper answers and says that it is one.
 */
(function () {
  const KEY = 'dejavu1.ai.thread';
  const OPENS = 'dejavu1.ai.opens';
  const IDEAS_FOR = 3;                // the suggestions show on the first few opens of the chat, then step aside
  const GLOW_MS = 60000;
  const el = {};
  let st = null;            // GET /api/assistant
  let open = false, seen = 0, polling = null, live = {}, lastTrouble = '', picked = null, wasReady = false, glowing = null;
  let autoFrom = Infinity;  // steps numbered above this arrived live, so their hand-offs (open a screen) run once
  let photo = null;         // a photo waiting to go with the next message: { data, name }
  const rows = new Map();   // message number -> element
  const lists = {};         // provider id -> its model list, as the server last read it
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PHONE = window.matchMedia('(max-width: 720px)');

  const isDemo = () => typeof tour !== 'undefined' && tour.on;
  const newId = () => 'dv' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const threadId = () => {
    let id = store.get(KEY);
    if (!id) { id = newId(); store.set(KEY, id); }
    return id;
  };
  const short = name => String(name || '').split(' (')[0];
  const count = n => Number(n || 0).toLocaleString('en-US');
  const ready = () => !!(st && st.ready);
  const live_ = () => ready() && !st.demo;
  const now = () => (st && (st.connections || []).find(c => c.id === st.provider)) || null;

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

  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
  const ICON = svg('<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 9.5h8M8 12.5h5"/>');
  const I = {
    spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4M12 7.5V12l3 2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    send: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
    camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    chevron: svg('<path d="M7 10l5 5 5-5"/>'),
    trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    doctor: svg('<path d="M9 3v5a3 3 0 0 0 6 0V3"/><path d="M12 11v3a4 4 0 0 0 8 0v-1"/><circle cx="20" cy="11" r="2"/>'),
    spool: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v5.5M12 14.5V20"/>'),
    rule: svg('<path d="M4 7h7M4 17h4M15 7h5M12 17h8"/><circle cx="13" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
    part: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
    brief: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    tune: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>')
  };

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
        <div class="ai-head-main">
          <button class="ai-icon-btn ai-back" id="ai-back" type="button" aria-label="Back to the chat" hidden>${I.back}</button>
          <h2 id="ai-title" tabindex="-1">Assistant</h2>
          <button class="ai-who" id="ai-who" type="button" aria-haspopup="true" aria-expanded="false" hidden></button>
        </div>
        <div class="ai-head-btns">
          <button class="ai-icon-btn" id="ai-history" type="button" aria-label="Your conversations" hidden>${I.history}</button>
          <button class="ai-icon-btn" id="ai-new" type="button" aria-label="New conversation" hidden>${I.plus}</button>
          <button class="ai-icon-btn" id="ai-close" type="button" aria-label="Close the assistant">${I.close}</button>
        </div>
      </header>
      <div class="ai-pop liquid-glass" id="ai-pop" hidden></div>
      <div class="ai-body" id="ai-body"></div>`;
    const glow = document.createElement('div');
    glow.className = 'ai-glow';
    glow.setAttribute('aria-hidden', 'true');
    glow.innerHTML = '<i></i><i></i><i></i><i></i>';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.id = 'ai-photo-input';
    document.body.append(launch, panel, glow, file);
    Object.assign(el, { launch, panel, glow, file, body: panel.querySelector('#ai-body'), who: panel.querySelector('#ai-who'),
      pop: panel.querySelector('#ai-pop'), back: panel.querySelector('#ai-back'), history: panel.querySelector('#ai-history'),
      fresh: panel.querySelector('#ai-new') });
    launch.addEventListener('click', () => toggle());
    panel.querySelector('#ai-close').addEventListener('click', () => toggle(false));
    el.back.addEventListener('click', () => showChat());
    el.history.addEventListener('click', () => showHistory());
    el.fresh.addEventListener('click', () => newChat());
    el.who.addEventListener('click', () => whoMenu());
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); }
      else if (e.key === 'Escape' && !el.pop.hidden) { closePop(); el.who.focus(); }
      else if (e.key === 'Escape' && open && panel.contains(document.activeElement)) toggle(false);
    });
    document.addEventListener('click', e => { if (!el.pop.hidden && !el.pop.contains(e.target) && !el.who.contains(e.target)) closePop(); });
  }

  /* The one switch every AI touch in the app hangs on. */
  function mark() {
    const on = ready();
    document.documentElement.classList.toggle('ai-on', on);
    el.launch.classList.toggle('is-quiet', !on);
    el.launch.setAttribute('aria-label', on ? 'Open the assistant' : 'Set up an AI assistant (optional)');
    if (!on) {
      lastTrouble = '';
      clearTimeout(glowing);
      document.documentElement.classList.remove('ai-glow-on');
    }
  }

  function take(body) {
    if (body && body.providers) st = body;
    mark();
    decorate();
    drawPage();
    return st;
  }

  async function refresh() {
    if (isDemo()) {
      st = st || { demo: true, ready: true, mode: 'free', providers: [], modes: {}, provider: 'demo', connections: [], never_ask: [] };
      const rec = await getJSON('/api/assistant').catch(() => ({}));
      if (rec && rec.providers) Object.assign(st, { providers: rec.providers.map(p => ({ ...p, installed: false, has_key: false, ready: false })), modes: rec.modes, default_mode: rec.default_mode, limits: rec.limits, security: rec.security });
      st.watch = demoWatch();
      mark(); decorate(); drawPage();
      return st;
    }
    const body = await getJSON('/api/assistant');
    st = body && body.providers ? body : null;
    el.launch.hidden = !st;
    mark(); decorate(); drawPage();
    return st;
  }

  async function toggle(want) {
    open = want === undefined ? !open : want;
    el.launch.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('ai-open', open);
    closePop();
    if (!open) { el.panel.classList.remove('is-in'); setTimeout(() => { if (!open) el.panel.hidden = true; }, 220); stopPoll(); el.launch.focus({ preventScroll: true }); return; }
    el.panel.hidden = false;
    requestAnimationFrame(() => el.panel.classList.add('is-in'));
    if (!st || !el.body.dataset.view) await refresh();
    else refresh();
    if (!st) { el.body.innerHTML = '<p class="ai-empty">The assistant is switched off. Turn it on in Settings, Optional extras.</p>'; return; }
    if (st.ready) { store.set(OPENS, String((+store.get(OPENS) || 0) + 1)); showChat(); } else showConnect();
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

  function head(view) {
    el.body.dataset.view = view;
    const chat = view === 'chat';
    el.back.hidden = chat || !ready();
    el.history.hidden = !chat || !ready() || !!st.demo;
    el.fresh.hidden = !chat || !ready();
    el.who.hidden = !chat || !ready() || !!st.demo;
    el.panel.querySelector('#ai-title').textContent = { chat: 'Assistant', history: 'Conversations', connect: ready() ? 'Connections' : 'Connect an AI', settle: 'Connected' }[view] || 'Assistant';
    if (chat) whoLabel();
  }

  /* ---- photos: shrunk in the browser, so a phone picture is a few hundred KB, not several MB ---- */

  function pickPhoto(capture) {
    return new Promise(resolve => {
      el.file.value = '';
      if (capture) el.file.setAttribute('capture', 'environment'); else el.file.removeAttribute('capture');
      el.file.onchange = async () => {
        const f = el.file.files && el.file.files[0];
        if (!f) return resolve(null);
        try { resolve({ data: await shrink(f), name: f.name || 'photo' }); } catch (_) { toast('That photo couldn’t be read', 'bad'); resolve(null); }
      };
      el.file.click();
    });
  }

  function shrink(file, max = 1280) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85, data = c.toDataURL('image/jpeg', q);
        while (data.length > 900000 && q > 0.4) { q -= 0.12; data = c.toDataURL('image/jpeg', q); }
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  /* ---- connect ---------------------------------------------------------- */

  const provider = id => ((st && st.providers) || []).find(p => p.id === id);

  function planState(p) {
    if (st.demo) return '';
    if (p.kind === 'account') return p.ready ? 'Signed in' : p.signed_in ? 'Allow plan use' : '';
    if (!p.installed) return p.id === 'codex' ? 'Not installed' : 'Needs Claude Code';
    if (p.signed_in === false) return 'Sign in';
    return p.signed_in ? 'Signed in' : 'Installed';
  }

  function tile(p) {
    const inUse = p.id === st.provider && st.ready;
    const joined = (st.connections || []).some(c => c.id === p.id);
    const state = inUse ? 'In use' : joined ? 'Connected' : (p.kind === 'cli' || p.kind === 'account') ? planState(p) : p.has_key ? 'Key saved' : '';
    return `<li><button type="button" class="ai-prov${inUse ? ' is-on' : ''}" data-id="${esc(p.id)}">
      <span class="ai-prov-name">${esc(p.kind === 'key' ? short(p.name) : p.name)}</span>
      <span class="ai-prov-state">${esc(state)}</span></button></li>`;
  }

  const modesHTML = group => Object.entries(st.modes || {}).map(([id, text]) => {
    const [name, rest] = text.split(': ');
    return `<label class="ai-mode"><input type="radio" name="${group}" value="${esc(id)}" ${id === st.mode ? 'checked' : ''}><span><b>${esc(name)}${id === st.default_mode ? ' <i>the usual choice</i>' : ''}</b>${esc(rest || '')}</span></label>`;
  }).join('');
  const limitsText = () => `These limits hold whatever you choose: heater limits, the printer’s own size, no moves before homing, the nozzle kept ${esc(String((st.limits || {}).z_floor_mm || 2))} mm off the bed, and a print starts only from Confirm Print.`;
  // Said once, where keys are offered (the owner's request, 12 November).
  const KEY_NOTE = 'Deja Vu1 runs entirely on your computer: no account, no cloud of ours and nothing opened to the internet, so there is nothing of ours online for a key to leak from. Keys are discouraged only as a precaution, because a key works like a password that can spend money wherever it ends up. A plan or a model on this computer means there is no key at all.';

  function showConnect() {
    stopPoll();
    head('connect');
    const of = kind => st.providers.filter(p => (kind === 'local' ? p.kind === 'local' || p.kind === 'custom'
      : kind === 'plan' ? p.kind === 'cli' || p.kind === 'account' : p.kind === kind));
    const plans = of('plan').sort((a, b) => ({ 'claude-code': 0, chatgpt: 1, codex: 2 }[a.id] ?? 3) - ({ 'claude-code': 0, chatgpt: 1, codex: 2 }[b.id] ?? 3));
    const sec = st.security || {};
    const keysOpen = of('key').some(p => p.has_key) || (picked && (provider(picked) || {}).kind === 'key');
    const joined = st.connections || [];
    el.body.innerHTML = `
      ${st.demo ? '<p class="ai-note">Online demo: a scripted helper answers here, on a simulated printer. On your own computer you connect one of these.</p>' : ''}
      ${joined.length ? `<section class="ai-group"><h3>Connected</h3>
        <ul class="ai-joined">${joined.map(c => `<li class="${c.id === st.provider ? 'is-on' : ''}">
          <button type="button" class="ai-joined-main" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(c.model || 'its usual model')}</span></button>
          ${c.id === st.provider ? '<span class="ai-prov-state">In use</span>' : `<button type="button" class="btn small" data-use="${esc(c.id)}">Use</button>`}
          <button type="button" class="btn small" data-drop="${esc(c.id)}" aria-label="Disconnect ${esc(c.name)}">Disconnect</button></li>`).join('')}</ul></section>` : ''}
      <section class="ai-group" data-kind="cli"><h3>Use a plan you already pay for <span class="ai-badge">Best choice</span></h3>
        <p class="ai-hint">Sign in once and Deja Vu1 uses your plan: no key and no extra bill. Plans run online, so this computer needs the internet for them.</p>
        <ul class="ai-providers">${plans.map(tile).join('')}</ul><div class="ai-slot" data-slot="cli"></div></section>
      <section class="ai-group" data-kind="local"><h3>Run a model on this computer</h3>
        <p class="ai-hint">Free, private and works offline. Smaller models make more mistakes with printer commands.</p>
        <ul class="ai-providers">${of('local').map(tile).join('')}</ul><div class="ai-slot" data-slot="local"></div></section>
      <details class="ai-group ai-keys" data-kind="key"${keysOpen ? ' open' : ''}><summary><h3>Use an API key instead</h3><span>${of('key').length} services</span></summary>
        <p class="ai-key-note">${esc(KEY_NOTE)}</p>
        <div class="ai-safe"><h4>How a key is kept</h4>
          <p>${esc(st.demo ? 'Deja Vu1 hands the key to your computer’s own keyring: Windows Data Protection, the macOS Keychain, or the desktop keyring on Linux. Where none answers it uses a file only your account can open, and tells you so.' : sec.how || '')}</p>${sec.problem && !st.demo ? `<p class="ai-safe-warn">${esc(sec.problem)}</p>` : ''}
          <ul>${(sec.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
        <div class="ai-slot" data-slot="key"></div>
        <label class="ai-search"><span class="sr-only">Find a service</span><input id="ai-find" type="search" placeholder="Find a service" autocomplete="off"></label>
        <ul class="ai-providers">${of('key').map(tile).join('')}</ul></details>
      <p class="ai-hint ai-online-note">Claude, ChatGPT and the key services run on their makers’ computers, so they need this computer to be online. A model on this computer works without the internet, and the rest of Deja Vu1 always does.</p>`;
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
      if (await post('/api/assistant/forget', { provider: b.dataset.drop })) { picked = null; afterDisconnect(); toast(`${name}: disconnected`, 'info'); }
    }));
    el.body.querySelector('#ai-find').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      el.body.querySelectorAll('.ai-keys .ai-providers li').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
    });
    if (picked) openForm(picked, true);
  }

  /* After the last AI goes, nothing of it stays behind: no shortcuts, no glow, no chat. */
  function afterDisconnect() {
    mark(); decorate(); drawPage();
    if (!ready()) { wasReady = false; photo = null; }
    showConnect();
  }

  /* The model chooser: the list the service or program itself reports, newest first. */
  function modelField(p, list, current) {
    const rowsOf = (list && list.rows) || [];
    const plan = p.kind === 'cli' || p.kind === 'account';
    const known = rowsOf.some(r => r.id === current);
    const price = r => (r.in_per_million != null && r.out_per_million != null ? ` · $${r.in_per_million} in, $${r.out_per_million} out per million tokens` : '');
    const text = r => (r.label && r.label.length < 60 && r.label !== r.id ? `${r.label} · ${r.id}` : r.id) + price(r);
    return `<label class="ai-field"><span>Model${plan ? ' <i>optional</i>' : rowsOf.length ? ` <i>${rowsOf.length} listed, newest first</i>` : ''}</span>
      <select id="ai-model">
        ${plan ? `<option value="">${p.kind === 'account' ? 'The first one your account offers' : 'Your plan’s usual model'}</option>` : rowsOf.length ? '' : '<option value="">Connect to see the list</option>'}
        ${rowsOf.map(r => `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(text(r))}</option>`).join('')}
        <option value="__other"${current && !known ? ' selected' : ''}>Type a name…</option>
      </select>
      <input id="ai-model-other" type="text" value="${esc(current && !known ? current : '')}" placeholder="The model’s exact name" autocomplete="off" spellcheck="false" aria-label="Model name"${current && !known ? '' : ' hidden'}></label>`;
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

  /* One provider's form: sign in (plans), an address (local), a key (services), then Connect. */
  async function openForm(id, quiet) {
    const p = provider(id);
    if (!p) return;
    const slotKind = p.kind === 'custom' ? 'local' : p.kind === 'account' ? 'cli' : p.kind;
    const slot = el.body.querySelector(`.ai-slot[data-slot="${slotKind}"]`);
    if (!slot) return;
    picked = id;
    if (p.kind === 'key') el.body.querySelector('.ai-keys').open = true;
    el.body.querySelectorAll('.ai-slot').forEach(s => { if (s !== slot) s.innerHTML = ''; });
    el.body.querySelectorAll('.ai-prov').forEach(b => b.classList.toggle('is-picked', b.dataset.id === id));
    const cli = p.kind === 'cli', account = p.kind === 'account', plan = cli || account;
    const needsKey = p.kind === 'key', address = p.kind === 'local' || p.kind === 'custom';
    const joined = (st.connections || []).some(c => c.id === id);
    let signing = null;   // { url, running } while a sign-in waits
    const draw = () => {
      const q = provider(id) || p, model = (st.models || {})[id] || '';
      const absent = cli && !st.demo && !q.installed;
      const signedOut = !st.demo && ((cli && q.installed && q.signed_in === false) || (account && !q.ready));
      slot.innerHTML = `<div class="ai-form" id="ai-form">
        <h3>${esc(q.name)}</h3>
        ${q.note ? `<p class="ai-hint">${esc(q.note)}</p>` : ''}
        ${absent ? `<p class="ai-step-help">${q.id === 'codex' ? 'Codex isn’t installed on this computer. Most people should use <b>ChatGPT plan</b> instead, which needs nothing installed.' : `Claude Code isn’t on this computer yet. It is Anthropic’s free program that lets other apps use your Claude plan. <a href="${esc(q.install_url)}" target="_blank" rel="noopener">Install it</a> (one command), then press Check again.`}</p>` : ''}
        ${signedOut ? signHTML(q) : ''}
        ${plan && !st.demo && !signedOut && !absent && (q.signed_in || q.ready) ? `<p class="ai-ok">${account && q.email ? `Signed in as ${esc(q.email)}.` : `Found and signed in${q.version ? ` (${esc(q.version)})` : ''}.`}</p>` : ''}
        ${address ? `<label class="ai-field"><span>Address</span><input id="ai-base" type="url" value="${esc(q.base_url || '')}" placeholder="http://localhost:8080/v1" autocomplete="off"></label>` : ''}
        ${plan ? '' : `<label class="ai-field"><span>${needsKey ? 'Key' : 'Key (only if it asks for one)'}</span>
          <input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="${q.has_key && !q.from_environment ? `Saved ${esc(q.key_hint || '')}. Paste a new one to replace it` : 'Paste the key'}"></label>
          ${q.key_url ? `<p class="ai-hint"><a href="${esc(q.key_url)}" target="_blank" rel="noopener">Get a key from ${esc(short(q.name))}</a>${q.from_environment ? `. This computer’s ${esc(q.env)} setting holds a key, so Deja Vu1 stores nothing.` : q.env ? `. Or set ${esc(q.env)} on this computer and Deja Vu1 stores nothing.` : ''}</p>` : ''}`}
        ${absent || signedOut ? '' : modelField(q, lists[id], model)}
        <p class="ai-status" id="ai-status" role="status"></p>
        <div class="ai-actions">
          ${absent ? '<button class="btn primary" id="ai-recheck" type="button">Check again</button>' : signedOut ? '' : `<button class="btn primary" id="ai-connect" type="button">${joined ? 'Save and use' : 'Connect'}</button>`}
          ${!plan && lists[id] && lists[id].rows && lists[id].rows.length ? '<button class="btn" id="ai-relist" type="button">Refresh the list</button>' : ''}
          ${joined || q.has_key && !q.from_environment || (address && q.ready && q.kind === 'custom') || (account && q.signed_in) ? `<button class="btn" id="ai-forget" type="button">${plan ? (account ? 'Sign out' : 'Disconnect') : 'Forget'}</button>` : ''}
        </div></div>`;
      const mark_ = el.body.querySelector(`.ai-prov[data-id="${id}"] .ai-prov-state`);
      if (mark_ && plan && !joined) mark_.textContent = planState(q);
      wire();
    };
    /* Signing in from here: ChatGPT through OpenAI's Sign in with ChatGPT, Claude through Claude Code's own sign-in. */
    function signHTML(q) {
      if (q.kind === 'account') {
        if (q.signed_in && !q.plan_use) return '<p class="ai-step-help">You signed in, but plan use wasn’t allowed. Press Continue with ChatGPT and allow it on the page that opens.</p>' + signButtons(q);
        return signButtons(q);
      }
      return `<p class="ai-step-help">Claude Code is on this computer${q.version ? ` (${esc(q.version)})` : ''} but isn’t signed in yet. The Claude desktop app keeps its own sign-in, so Claude Code signs in once by itself: press Sign in and approve it in your browser.</p>${signButtons(q)}`;
    }
    function signButtons(q) {
      const waiting = signing && signing.running;
      const label = q.kind === 'account' ? 'Continue with ChatGPT' : 'Sign in with Claude';
      return `<div class="ai-sign">
        <div class="ai-actions"><button class="btn primary" id="ai-sign" type="button">${waiting ? 'Open the sign-in page again' : label}</button>
          ${q.kind === 'cli' && !waiting ? '<button class="btn" id="ai-probe" type="button">I’m already signed in</button>' : ''}</div>
        ${waiting ? `<p class="ai-hint">${q.kind === 'account' ? 'Approve Deja Vu1 in the ChatGPT page that opened. This screen updates by itself.' : 'Approve it in the page that opened. If the page shows a code, paste it here.'}</p>
          <label class="ai-field"><span>${q.kind === 'account' ? 'On another device? Paste the address the browser ended on' : 'Code from the sign-in page'}</span>
            <span class="ai-paste"><input id="ai-paste" type="text" autocomplete="off" spellcheck="false" placeholder="${q.kind === 'account' ? 'http://127.0.0.1:1455/auth/callback?code=…' : 'Paste the code'}"><button class="btn" id="ai-paste-go" type="button">Finish</button></span></label>` : ''}
      </div>`;
    }
    const say = (text, kind) => { const s = slot.querySelector('#ai-status'); if (s) { s.textContent = text; s.dataset.kind = kind || ''; } };
    const check = async () => {
      if (st.demo || !cli) return;
      const res = await postJSON('/api/assistant/check', { provider: id });
      if (res.ok) take(res.body);
    };
    const signin = async (action, value) => {
      const res = await postJSON('/api/assistant/signin', { provider: id, action, value });
      if (!res.ok) { say(res.body.error || 'The sign-in didn’t go through', 'bad'); return null; }
      take(res.body);
      return res.body.signin || {};
    };
    async function waitForSignIn(started) {
      // Poll quietly until the browser comes back (ChatGPT) or Claude Code's own sign-in finishes.
      for (let i = 0; i < 200 && signing === started && picked === id && slot.isConnected; i++) {
        await new Promise(r => setTimeout(r, 2500));
        if (signing !== started) return;
        const res = account ? { ok: true, body: await getJSON('/api/assistant').catch(() => null) }
          : await postJSON('/api/assistant/signin', { provider: id, action: 'status' });
        if (!res.ok || !res.body) continue;
        take(res.body);
        const q = provider(id) || {};
        const s = res.body.signin || {};
        if ((account && q.ready) || (cli && (s.done || q.signed_in))) { signing = null; draw(); say('Signed in. Connecting…'); const c = slot.querySelector('#ai-connect'); if (c) c.click(); return; }
        if (cli && s.failed) { signing = null; draw(); say(`Claude Code’s sign-in stopped${s.said ? `: ${s.said}` : ''}. Press Sign in to try again.`, 'bad'); return; }
        if (account && q.signin_error) { signing = null; draw(); say(q.signin_error, 'bad'); return; }
      }
    }
    function wire() {
      const form = slot.querySelector('#ai-form');
      wireModel(form);
      const sign = form.querySelector('#ai-sign');
      if (sign) sign.addEventListener('click', async () => {
        if (st.demo) { say('The online demo can’t sign in. Install Deja Vu1 on your computer to use your own plan.', 'warn'); return; }
        if (signing && signing.url) { window.open(signing.url, '_blank', 'noopener'); return; }
        // A tab opened now, during the click, isn't blocked as a pop-up; it gets the address once the server has it.
        const tab = account ? window.open('about:blank', '_blank') : null;
        sign.disabled = true; say('Starting the sign-in…');
        const out = await signin('start');
        sign.disabled = false;
        if (!out) { if (tab) tab.close(); return; }
        signing = { url: out.url || '', running: true };
        if (account && out.url) { if (tab) tab.location.href = out.url; else window.open(out.url, '_blank', 'noopener'); }
        draw();
        say(account ? 'Waiting for you to approve it in ChatGPT…' : out.url ? 'Waiting for you to approve it in the browser…' : 'Claude Code is opening the sign-in page…');
        waitForSignIn(signing);
      });
      const probe = form.querySelector('#ai-probe');
      if (probe) probe.addEventListener('click', async () => {
        probe.disabled = true; say('Checking with one tiny request…');
        await signin('probe');
        const q = provider(id) || {};
        draw();
        if (q.signed_in) say('It answered, so it is signed in. Press Connect.', 'ok');
        else say('Claude Code didn’t answer, so it isn’t signed in for other programs yet. Press Sign in with Claude.', 'warn');
      });
      const pasteGo = form.querySelector('#ai-paste-go');
      if (pasteGo) pasteGo.addEventListener('click', async () => {
        const v = form.querySelector('#ai-paste').value.trim();
        if (!v) return;
        pasteGo.disabled = true; say('Finishing…');
        const out = await signin(account ? 'finish' : 'code', v);
        pasteGo.disabled = false;
        if (out) { const q = provider(id) || {}; if (q.ready || q.signed_in || out.done) { signing = null; draw(); say('Signed in. Connecting…'); const c = slot.querySelector('#ai-connect'); if (c) c.click(); } }
      });
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
        if (res.ok) { take(res.body); delete lists[id]; picked = null; afterDisconnect(); toast(`${p.name}: ${account ? 'signed out' : cli ? 'disconnected' : 'key forgotten'}`, 'info'); }
      });
      const connect = form.querySelector('#ai-connect');
      if (connect) connect.addEventListener('click', async () => {
        if (st.demo) { say('The online demo can’t connect a real AI. Install Deja Vu1 on your computer to use your own.', 'warn'); return; }
        const key = (form.querySelector('#ai-key') || {}).value || '', base = (form.querySelector('#ai-base') || {}).value || '';
        let wanted = modelValue(form);
        connect.disabled = true;
        try {
          if (!plan && (key || base || !(provider(id) || p).ready)) {
            say('Saving…');
            const saved = await postJSON('/api/assistant/key', { provider: id, api_key: key || undefined, base_url: base || undefined });
            if (!saved.ok) { say(saved.body.error || 'That could not be saved', 'bad'); return; }
            take(saved.body);
            delete lists[id];
          }
          if (!plan && !lists[id]) {
            say('Reading the list of models…');
            const list = await readModels(id);
            if (!list.ok) { say(list.body.error || 'The list of models could not be read', 'bad'); return; }
            if (!wanted) wanted = list.body.suggested || '';
            if (!wanted) { st.models = { ...st.models, [id]: '' }; draw(); say(list.body.note || 'Pick a model, then press Connect', 'warn'); return; }
          }
          if (!plan && !wanted) { say('Pick a model, then press Connect', 'warn'); return; }
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
      if (cli ? q.installed && q.signed_in !== false : q.ready) await readModels(id);
    }
    draw();
    if (!quiet) slot.scrollIntoView({ block: 'nearest', behavior: REDUCED.matches ? 'auto' : 'smooth' });
    if (!st.demo) { await check(); await loadList(); if (picked === id && slot.isConnected && !signing) draw(); }
  }

  /* ---- settle: a short look at the printer, then it gets out of the way ---- */

  async function settle() {
    head('settle');
    const steps = [['Reading the printer', '/api/printer'], ['Looking through your files', '/api/files'], ['Checking what care is due', '/api/maintenance']];
    el.body.innerHTML = `<div class="ai-settle"><div class="ai-pulse" aria-hidden="true"><i></i><i></i><i></i></div>
      <h3>Getting to know your printer</h3><ol>${steps.map(s => `<li>${s[0]}</li>`).join('')}</ol></div>`;
    const items = el.body.querySelectorAll('.ai-settle li');
    for (let i = 0; i < steps.length; i++) {
      items[i].classList.add('is-now');
      await Promise.all([getJSON(api(steps[i][1])).catch(() => null), new Promise(r => setTimeout(r, REDUCED.matches ? 150 : 520))]);
      items[i].classList.replace('is-now', 'is-done');
    }
    el.body.querySelector('.ai-settle').classList.add('is-out');
    setTimeout(showChat, 380);
  }

  /* ---- who answers: the AI and its model, behind one chip in the header ---- */

  function whoLabel() {
    const c = now();
    el.who.innerHTML = c ? `<span>${esc(short(c.name))}</span><small>${esc(c.model || 'usual model')}</small>${I.chevron}` : '';
    el.who.setAttribute('aria-label', c ? `Answering: ${c.name}, ${c.model || 'its usual model'}. Change` : 'Choose an AI');
  }
  function closePop() { el.pop.hidden = true; el.who.setAttribute('aria-expanded', 'false'); }
  async function whoMenu() {
    if (!el.pop.hidden) { closePop(); return; }
    const joined = st.connections || [];
    const draw = () => {
      const p = provider(st.provider) || {}, list = lists[st.provider], current = st.model || '';
      const rowsOf = (list && list.rows) || [];
      el.pop.innerHTML = `<p class="ai-pop-h">Answering</p>
        <div class="ai-pop-list" role="group" aria-label="AI in use">${joined.map(c => `<button type="button" class="ai-pop-item${c.id === st.provider ? ' is-on' : ''}" data-conn="${esc(c.id)}" aria-pressed="${c.id === st.provider}">${esc(c.name)}</button>`).join('')}</div>
        <label class="ai-field"><span>Model</span><select id="ai-pick">
          ${p.kind === 'cli' || p.kind === 'account' ? '<option value="">Usual model</option>' : ''}
          ${rowsOf.map(r => `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(r.label && r.label !== r.id && r.label.length < 40 ? r.label : r.id)}</option>`).join('')}
          ${current && !rowsOf.some(r => r.id === current) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : ''}
        </select></label>
        <div class="ai-pop-links"><button type="button" class="ai-link" data-pop="connect">Add or manage connections</button>
          <button type="button" class="ai-link" data-pop="page">How much it may do</button></div>`;
      el.pop.querySelectorAll('[data-conn]').forEach(b => b.addEventListener('click', async () => {
        const res = await postJSON('/api/assistant/select', { provider: b.dataset.conn });
        if (res.ok) take(res.body); else toast(res.body.error || 'That AI could not be chosen', 'bad');
        if (!lists[st.provider]) await readModels(st.provider);
        whoLabel(); draw();
      }));
      el.pop.querySelector('#ai-pick').addEventListener('change', async e => {
        const res = await postJSON('/api/assistant/select', { provider: st.provider, model: e.target.value });
        if (res.ok) take(res.body); else toast(res.body.error || 'That model could not be chosen', 'bad');
        whoLabel();
      });
      el.pop.querySelectorAll('[data-pop]').forEach(b => b.addEventListener('click', () => {
        closePop();
        if (b.dataset.pop === 'connect') showConnect(); else goTo('ai', '#ai-setup');
      }));
    };
    draw();
    el.pop.hidden = false;
    el.who.setAttribute('aria-expanded', 'true');
    if (!lists[st.provider]) { await readModels(st.provider); if (!el.pop.hidden) draw(); }
    const first = el.pop.querySelector('button');
    if (first) first.focus();
  }

  /* ---- chat ------------------------------------------------------------- */

  function ideas() {
    const out = [], s = live || {};
    if (lastTrouble) out.push(['Explain the last warning', `Explain this message from Deja Vu1 in plain words, and what to try: "${lastTrouble}"`]);
    const file = document.querySelector('#file-detail:not([hidden]) #fd-name');
    const name = file ? file.textContent.trim() : '';
    if (name && /\.(stl|3mf|obj)$/i.test(name)) out.push([`Slice ${name}`, `Slice ${name} with my default profile and tell me the time and filament.`]);
    else if (name) out.push([`About ${name}`, `Tell me what ${name} needs to print: time, filament and anything to watch for.`]);
    if (s.state === 'printing' || s.state === 'paused') out.push(['How is the print going?', 'How is the print going?'], ['Look at the camera', 'Look through the camera and tell me if the print looks right.']);
    else out.push(['Show me the digital twin', 'Take me to the digital twin.'], ['Warm up for PLA', 'Warm up for PLA: the bed and the active head.']);
    out.push(['Catch me up', BRIEF], ['Make a phone stand', 'Make a phone stand with a slot cut through the base for the charging cable, and save it to my files.']);
    return out.slice(0, 4);
  }
  const BRIEF = 'Catch me up: anything that needs me, prints that finished or failed lately, care that is due, filament running low and what is in the queue. Keep it short, and skip anything that is fine.';
  const showIdeas = () => (+store.get(OPENS) || 0) <= IDEAS_FOR;

  function showChat() {
    head('chat');
    el.body.innerHTML = `
      <div class="ai-log" id="ai-log" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div class="ai-ideas" id="ai-ideas"></div>
      <div class="ai-attached" id="ai-attached" hidden></div>
      <form class="ai-compose" id="ai-compose">
        <button class="ai-icon-btn ai-attach" id="ai-attach" type="button" aria-label="Attach a photo">${I.camera}</button>
        <label class="sr-only" for="ai-text">Message the assistant</label>
        <textarea id="ai-text" rows="1" maxlength="6000" placeholder="Ask, or tell it what to do"></textarea>
        <button class="ai-send" id="ai-send" type="submit" aria-label="Send">${I.send}</button>
        <button class="btn danger small" id="ai-stop" type="button" hidden>Stop</button>
      </form>
      <p class="ai-cost" id="ai-cost" aria-live="polite"></p>`;
    rows.clear(); seen = 0; autoFrom = Infinity;
    const text = el.body.querySelector('#ai-text');
    el.body.querySelector('#ai-compose').addEventListener('submit', e => { e.preventDefault(); send(text.value); });
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(text.value); } });
    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; costSoon(); });
    el.body.querySelector('#ai-stop').addEventListener('click', () => (st.demo ? demoStop() : postJSON('/api/assistant/stop', { thread: threadId() }).then(poll)));
    el.body.querySelector('#ai-attach').addEventListener('click', async () => {
      if (st.demo) { toast('The online demo can’t read photos. With your own AI connected it can.', 'info'); return; }
      const got = await pickPhoto(false);
      if (got) { photo = got; drawAttached(); text.focus(); }
    });
    drawAttached();
    if (!wasReady) wasReady = true;
    if (st.demo) { demoPaint(); greet(); } else poll(true);
    drawIdeas();
    costSoon(0);
    text.focus({ preventScroll: true });
  }

  function drawAttached() {
    const host = el.body.querySelector('#ai-attached');
    if (!host) return;
    host.hidden = !photo;
    host.innerHTML = photo ? `<img src="${esc(photo.data)}" alt=""><span>Photo attached</span><button type="button" class="ai-link" id="ai-unattach">Remove</button>` : '';
    const rm = host.querySelector('#ai-unattach');
    if (rm) rm.addEventListener('click', () => { photo = null; drawAttached(); });
  }

  function greet() {
    const log = el.body.querySelector('#ai-log');
    if (!log || log.querySelector('.ai-msg, .ai-step, .ai-hello')) return;
    const first = showIdeas();
    log.insertAdjacentHTML('beforeend', `<div class="ai-hello"><span class="ai-hello-mark" aria-hidden="true">${I.spark}</span>
      <p>${first ? 'Ask in your own words. I can run the printer, read your files and history, look through the camera, make and slice parts, and set up print watch and automations.' : 'What can I do for you?'}</p></div>`);
  }

  function drawIdeas() {
    const host = el.body.querySelector('#ai-ideas');
    if (!host) return;
    const log = el.body.querySelector('#ai-log');
    const empty = !log || !log.querySelector('.ai-msg, .ai-step');
    const list = (showIdeas() && empty) || lastTrouble ? ideas() : [];
    const shown = lastTrouble && !(showIdeas() && empty) ? list.slice(0, 1) : list;
    host.hidden = !shown.length;
    host.innerHTML = shown.map(([label], i) => `<button type="button" class="ai-idea" data-i="${i}">${esc(label)}</button>`).join('');
    host.querySelectorAll('.ai-idea').forEach(b => b.addEventListener('click', () => send(shown[+b.dataset.i][1])));
  }

  const dollars = n => '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
  const brief = n => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : count(n));
  const paysPerMessage = () => st && st.price && ['tokens', 'unknown'].includes(st.price.charge);

  /* Before sending: what the next answer is likely to read and cost. Shown only where a message costs money. */
  let costTimer = 0;
  function costSoon(wait = 450) {
    clearTimeout(costTimer);
    costTimer = setTimeout(drawCost, wait);
  }
  async function drawCost() {
    const host = el.body.querySelector('#ai-cost'), box = el.body.querySelector('#ai-text');
    if (!host || !st || st.demo || !st.ready || !paysPerMessage()) { if (host) host.textContent = ''; return; }
    const res = await postJSON(api('/api/assistant/estimate'), { thread: threadId(), text: box ? box.value : '' }).catch(() => null);
    if (!res || !res.ok || !res.body.ready || !host.isConnected) return;
    host.innerHTML = costText(res.body);
    host.classList.toggle('is-over', !!res.body.over_cap);
  }
  function costText(e) {
    const p = e.price || {};
    const tokens = `about ${brief(e.tokens_in)} tokens in`;
    const how = e.basis === 'estimate' ? ' (estimated)' : '';
    if (p.charge !== 'tokens' || e.cost_usd == null) {
      return `Next answer: ${tokens}${how}. <button type="button" class="ai-link" data-place="ai" data-part="#ai-cost-card">Add this model’s price</button> to see a cost first.`;
    }
    const cap = e.cap_usd ? ` · limit ${dollars(e.cap_usd)}` : '';
    const over = e.over_cap ? ' <b>Over your limit, so it won’t send.</b>' : '';
    return `Next answer: about <b>${dollars(e.cost_usd)}</b>, ${tokens}${how}${cap}.${over}`;
  }

  const STATUS = { running: 'Working', waiting: 'Needs your yes', done: 'Done', refused: 'Refused', declined: 'Declined' };
  const PLACE = { printers: 'Printers', printer: 'the Printer page', files: 'Files', slice: 'Slice', queue: 'the queue', filament: 'Filament', maintenance: 'Maintenance', settings: 'Settings', automations: 'Automations', overview: 'Overview', ai: 'the AI screen', prefs: 'Preferences', desk: 'the Farm desk', layers: 'Layer heights', studio: 'Photo studio', sandbox: 'the Practice farm', games: 'Games' };
  const SPOT_NAME = { '#twin-card': 'the digital twin', '#pp-camera-card': 'the camera', '#pp-move': 'the move pad', '#pp-heaters': 'temperatures', '#pp-console': 'the console', '#timelapse-card': 'time-lapses', '#pp-mesh': 'the bed mesh', '#tab-filament': 'Filament', '#logbook': 'the logbook', '#tab-autoprint': 'Slice' };

  function proposalHTML(m) {
    const p = m.proposal;
    return `<div class="ai-proposal">${p.why ? `<p>${esc(p.why)}</p>` : ''}
      <table><tbody>${(p.changes || []).map(c => `<tr><th scope="row">${esc(c.label)}<small>${esc(c.group)}</small></th><td>${esc(c.value)}${c.unit && !String(c.value).endsWith('%') ? ' ' + esc(c.unit) : ''}</td></tr>`).join('')}</tbody></table>
      <div class="ai-approve"><button class="btn primary" type="button" data-apply="${m.n}">Put these in the profile editor</button></div>
      <p class="ai-step-detail">Nothing changes until you save the profile there.</p></div>`;
  }

  /* ---- result cards: a small picture of what a step found or made ---- */

  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '–');
  function gauge(label, temp, target, max) {
    const t = typeof temp === 'number' ? temp : 0, goal = typeof target === 'number' && target > 0 ? target : 0;
    const frac = Math.max(0, Math.min(1, t / max)), C = 2 * Math.PI * 18;
    const hot = goal ? (t >= goal - 3 ? 'is-at' : 'is-heating') : t > 50 ? 'is-warm' : '';
    return `<figure class="ai-gauge ${hot}"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="ai-g-track"/>
      <circle cx="22" cy="22" r="18" class="ai-g-fill" style="--c:${C.toFixed(1)};--to:${(C * (1 - frac)).toFixed(1)}"/></svg>
      <figcaption><b>${num(temp)}°</b><span>${esc(label)}${goal ? ` → ${num(goal)}°` : ''}</span></figcaption></figure>`;
  }
  const hours = h => (typeof h === 'number' ? (h >= 1 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min` : `${Math.max(1, Math.round(h * 60))} min`) : '–');
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', standby: 'Idle', ready: 'Ready', complete: 'Finished', error: 'Error', cancelled: 'Cancelled' };

  function cardHTML(m) {
    const c = m.card;
    if (!c || m.status !== 'done') return '';
    if (c.kind === 'printer') {
      return `<div class="ai-card ai-card-printer"><p class="ai-card-h"><b>${esc(c.name || 'Printer')}</b><span class="ai-pill is-${esc(c.state || 'idle')}">${esc(STATE_WORD[c.state] || c.state || '')}</span></p>
        ${c.file ? `<p class="ai-card-sub">${esc(c.file)}${typeof c.progress === 'number' ? ` · ${num(c.progress)}%` : ''}</p>${typeof c.progress === 'number' ? `<div class="ai-bar-prog"><i style="--p:${Math.max(0, Math.min(100, c.progress))}%"></i></div>` : ''}` : ''}
        <div class="ai-gauges">${(c.heads || []).map(h => gauge(h.name + (h.name === c.active ? ' ●' : ''), h.temp, h.target, 300)).join('')}${gauge('Bed', (c.bed || {}).temperature, (c.bed || {}).target, 120)}</div></div>`;
    }
    if (c.kind === 'slice') {
      return `<div class="ai-card">${(c.files || []).map(f => `<div class="ai-card-row"><div><p class="ai-card-h"><b>${esc(f.name)}</b></p>
        <dl class="ai-stats"><div><dt>Time</dt><dd>${hours(f.hours)}</dd></div><div><dt>Filament</dt><dd>${num(f.grams)} g</dd></div><div><dt>Layers</dt><dd>${num(f.layers)}</dd></div></dl></div>
        <div class="ai-approve"><button class="btn primary small" type="button" data-print="${esc(f.name)}">Print it</button><button class="btn small" type="button" data-file="${esc(f.name)}">Open the file</button></div></div>`).join('')}</div>`;
    }
    if (c.kind === 'model') {
      const size = Array.isArray(c.size) ? c.size.map(v => num(v, v < 10 ? 1 : 0)).join(' × ') + ' mm' : '';
      return `<div class="ai-card ai-card-model"><img class="ai-thumb" alt="" loading="lazy" src="${esc(api('/api/files/thumb?name=' + encodeURIComponent(c.file)))}" onerror="this.remove()">
        <div><p class="ai-card-h"><b>${esc(c.file)}</b></p>${size ? `<p class="ai-card-sub">${esc(size)}</p>` : ''}
        <div class="ai-approve"><button class="btn primary small" type="button" data-file="${esc(c.file)}">Open it</button><button class="btn small" type="button" data-say="${esc(`Slice ${c.file} with my default profile.`)}">Slice it</button></div></div></div>`;
    }
    if (c.kind === 'spools') {
      return `<div class="ai-card"><ul class="ai-swatches">${(c.spools || []).map(s => `<li><i style="background:${esc(s.hex || '#bbb')}"></i><span>${esc(s.name || 'Spool')}</span><small>${s.grams == null ? 'weight unknown' : num(s.grams) + ' g'}</small></li>`).join('') || '<li><span>No spools on the shelf yet</span></li>'}</ul>
        <div class="ai-approve"><button class="btn small" type="button" data-place="filament" data-part="#tab-filament">Open Filament</button></div></div>`;
    }
    if (c.kind === 'care') {
      return `<div class="ai-card"><ul class="ai-list">${(c.tasks || []).map(t => `<li><span class="ai-pill is-${esc(t.status)}">${esc(t.status === 'overdue' ? 'Overdue' : 'Due soon')}</span><b>${esc(t.name)}</b><small>${esc(t.why || '')}</small></li>`).join('') || `<li><b>Nothing is due</b><small>${c.total || 0} tasks tracked</small></li>`}</ul>
        <div class="ai-approve"><button class="btn small" type="button" data-place="maintenance">Open Maintenance</button></div></div>`;
    }
    if (c.kind === 'queue') {
      return `<div class="ai-card"><ul class="ai-list">${(c.jobs || []).map((j, i) => `<li><span class="ai-pill">${i + 1}</span><b>${esc(j.name || '')}</b><small>${esc(j.status || '')}</small></li>`).join('') || '<li><b>The queue is empty</b></li>'}</ul></div>`;
    }
    if (c.kind === 'rule') {
      return `<div class="ai-card ai-card-rule"><p class="ai-card-h">${I.rule}<b>${esc(c.name || 'New rule')}</b></p><div class="ai-approve"><button class="btn small" type="button" data-place="automations">See it in Automations</button></div></div>`;
    }
    if (c.kind === 'look') {
      return `<div class="ai-approve"><button class="btn small" type="button" data-place="printer" data-part="#pp-camera-card">Open the camera</button></div>`;
    }
    return '';
  }

  function rowHTML(m) {
    if (m.role === 'user') return `<div class="ai-msg is-user${m.sending ? ' is-sending' : ''}">${m.picture ? `<span class="ai-msg-photo">${m.preview ? `<img src="${esc(m.preview)}" alt="">` : ''}${I.camera}<span>Photo</span></span>` : ''}<p>${esc(m.text)}</p>${m.sending ? '<span class="sr-only">Sending</span>' : ''}</div>`;
    if (m.role === 'assistant') return `<div class="ai-msg is-assistant">${rich(m.text)}</div>`;
    if (m.role === 'error' || m.role === 'note') return `<div class="ai-msg is-${m.role}" role="${m.role === 'error' ? 'alert' : 'status'}"><p>${esc(m.text)}</p></div>`;
    const wait = m.status === 'waiting', done = m.status === 'done';
    const h = m.handoff || {};
    const where = h.kind === 'page' ? (SPOT_NAME[h.spot] || PLACE[h.place] || h.place) : '';
    return `<div class="ai-step is-${esc(m.status)}${m.level === 'read' ? ' is-read' : ''}">
      <span class="ai-node" aria-hidden="true"></span>
      <div class="ai-step-main"><span class="ai-step-label">${esc(m.label)}</span><span class="ai-step-state">${STATUS[m.status] || ''}</span>
        ${m.detail && !(m.proposal && done) && !(h.kind && done) && !(m.card && done) ? `<p class="ai-step-detail">${esc(m.detail)}</p>` : ''}
        ${wait ? `<div class="ai-approve"><button class="btn primary" type="button" data-yes="${m.n}">Approve</button><button class="btn" type="button" data-no="${m.n}">Decline</button><button class="ai-always" type="button" data-always="${m.n}">Approve, and don’t ask about this again</button></div>` : ''}
        ${m.proposal && done ? proposalHTML(m) : ''}
        ${h.kind === 'confirm_print' && done ? `<div class="ai-approve"><button class="btn primary" type="button" data-print="${esc(h.filename)}">Open Confirm Print</button></div>` : ''}
        ${h.kind === 'page' && done ? `<div class="ai-approve"><button class="btn ai-go" type="button" data-place="${esc(h.place)}" data-part="${esc(h.spot || '')}">Go to ${esc(where)}</button></div>` : ''}
        ${m.file && !(m.card && m.card.kind === 'model') ? `<div class="ai-approve"><button class="btn" type="button" data-file="${esc(m.file)}">Open ${esc(m.file)}</button></div>` : ''}
        ${cardHTML(m)}
      </div></div>`;
  }

  const proposals = new Map();   // message number -> the settings it suggested

  function paint(messages, busy) {
    const log = el.body.querySelector('#ai-log');
    if (!log) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    const hello = log.querySelector('.ai-hello');
    if (hello && messages.length) hello.remove();
    for (const m of messages) {
      if (m.role === 'user' && !m.sending) {      // the real copy replaces the one drawn the moment it was sent
        const sent = log.querySelector('.ai-msg.is-user.is-sending');
        if (sent) { sent.classList.remove('is-sending'); const sr = sent.querySelector('.sr-only'); if (sr) sr.remove(); rows.set(m.n, sent); continue; }
      }
      const html = rowHTML(m), old = rows.get(m.n);
      if (old && old.outerHTML === html) continue;
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const node = holder.firstElementChild;
      if (old) { node.style.animation = 'none'; old.replaceWith(node); } else log.appendChild(node);
      rows.set(m.n, node);
      if (m.proposal) proposals.set(m.n, m.proposal);
      if (m.handoff && m.status === 'done' && m.n > autoFrom && !node.dataset.ran) {
        node.dataset.ran = '1';
        handoff(m.handoff, node);
      }
    }
    let dots = log.querySelector('.ai-thinking');
    if (busy && !dots) log.insertAdjacentHTML('beforeend', '<div class="ai-thinking" role="status"><i></i><i></i><i></i><span class="sr-only">The assistant is working</span></div>');
    else if (busy && dots) log.appendChild(dots);
    else if (dots) dots.remove();
    const waiting = !!log.querySelector('.ai-step.is-waiting');
    el.body.querySelector('#ai-send').hidden = busy || waiting;
    el.body.querySelector('#ai-stop').hidden = !(busy || waiting);
    if (busy || waiting) el.body.querySelector('#ai-ideas').hidden = true;
    if (stick) log.scrollTop = log.scrollHeight;
  }

  /* A step that hands something to the owner runs once, as it arrives: a screen opens, Confirm Print opens,
   * the look changes or a tour starts. Reopening an old conversation never runs them again. */
  function handoff(h, node) {
    if (h.kind === 'confirm_print' && window.Workshop) Workshop.openConfirm(h.filename, node);
    else if (h.kind === 'page') goTo(h.place, h.spot);
    else if (h.kind === 'ui' && h.action === 'theme' && window.DVTheme) DVTheme.set(h.value);
    else if (h.kind === 'ui' && h.action === 'tour' && window.Guide) {
      const tab = window.Rail && h.value ? (Rail.destinations.find(d => d.id === h.value || d.tab === h.value) || {}).tab : '';
      if (PHONE.matches) toggle(false);
      setTimeout(() => (tab && Guide.has(tab) ? Guide.screen(tab) : Guide.everything()), 300);
    }
  }

  /* Go to a place, open the part of the screen that holds `spot`, scroll it into view and light it briefly. */
  function goTo(place, spot) {
    if (window.Rail && Rail.go) Rail.go(place); else location.hash = '#/' + place;
    if (PHONE.matches && open) toggle(false);
    if (!spot) return;
    setTimeout(() => {
      const n = document.querySelector(spot);
      if (!n) return;
      if (window.Sections) Sections.reveal(n);
      n.scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
      n.classList.remove('ai-spot');
      void n.offsetWidth;
      n.classList.add('ai-spot');
      setTimeout(() => n.classList.remove('ai-spot'), 2600);
    }, 280);
  }

  /* Open a file: Files first (the file panel lives there), then the file itself. */
  function openFile(name) {
    goTo('files');
    setTimeout(async () => {
      if (window.Workshop && Workshop.openFile) {
        if (Workshop.loadFiles) await Workshop.loadFiles();
        Workshop.openFile(name);
      }
    }, 300);
  }

  function applyProposal(n) {
    const p = proposals.get(n);
    if (!p || !window.PrintRoom) return;
    const map = {};
    (p.changes || []).forEach(c => { map[c.key] = c.value; });
    const shown = PrintRoom.applySuggested(map);
    goTo('slice', '#tab-autoprint');
    toast(shown ? 'The suggested settings are in the profile editor. Review them, then save the profile.'
      : 'Open your presets in Slice (Find presets) and the suggested settings fill in. Review them, then save the profile.', 'info', 7000);
  }

  function wire() {
    el.body.addEventListener('click', e => {
      const t = e.target.closest('[data-yes],[data-no],[data-always],[data-print],[data-file],[data-place],[data-apply],[data-say],[data-chat],[data-del]');
      if (!t || !el.body.contains(t)) return;
      if (t.dataset.chat) { openChat(t.dataset.chat); return; }
      if (t.dataset.del) { deleteChat(t.dataset.del, t); return; }
      if (t.dataset.print) { if (window.Workshop) Workshop.openConfirm(t.dataset.print, t); return; }
      if (t.dataset.file) { openFile(t.dataset.file); return; }
      if (t.dataset.say) { send(t.dataset.say); return; }
      if (t.dataset.place) { goTo(t.dataset.place, t.dataset.part); return; }
      if (t.dataset.apply) { applyProposal(+t.dataset.apply); return; }
      const always = 'always' in t.dataset, yes = always || 'yes' in t.dataset, n = +(t.dataset.yes || t.dataset.no || t.dataset.always);
      t.parentElement.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (st.demo) return demoDecide(n, yes);
      autoFrom = Math.min(autoFrom, seen);
      postJSON(api('/api/assistant/decide'), { thread: threadId(), n, approve: yes, always }).then(res => {
        if (!res.ok) toast(res.body.error || 'That step could not be decided', 'bad');
        if (always) refresh();
        poll();
      });
    });
  }

  function stopPoll() { clearTimeout(polling); polling = null; }
  async function poll(first) {
    stopPoll();
    if (!open || el.body.dataset.view !== 'chat' || st.demo) return;
    const body = await getJSON(`/api/assistant/thread?id=${encodeURIComponent(threadId())}&since=${seen}`).catch(() => null);
    if (el.body.dataset.view !== 'chat') return;
    if (body && body.messages) {
      paint(body.messages, body.busy);
      seen = body.seq;
      if (first && !body.messages.length) greet();
      if (body.busy) polling = setTimeout(poll, 600);
      else { drawIdeas(); costSoon(0); }
    }
  }

  /* Your message shows the moment you send it; the server's copy takes its place when it arrives. */
  async function send(text, context, picture) {
    text = String(text || '').trim();
    const pic = picture || (photo && photo.data) || null;
    if (!text && !pic) return;
    if (!open) await toggle(true);
    if (!st || !st.ready) { showConnect(); return; }
    if (el.body.dataset.view !== 'chat') showChat();
    const box = el.body.querySelector('#ai-text');
    box.value = ''; box.style.height = 'auto';
    if (lastTrouble && text.includes(lastTrouble)) lastTrouble = '';
    el.body.querySelector('#ai-ideas').hidden = true;
    if (st.demo) return demoSend(text);
    photo = null; drawAttached();
    const shown = text || 'What do you see in this photo?';
    paint([{ n: -Date.now(), role: 'user', text: shown, sending: true, picture: !!pic, preview: pic }], true);
    const log = el.body.querySelector('#ai-log');
    log.scrollTop = log.scrollHeight;
    autoFrom = Math.min(autoFrom, seen);
    const res = await postJSON(api('/api/assistant/chat'), { thread: threadId(), text, context, picture: pic || undefined });
    if (!res.ok) {
      const pending = log.querySelector('.ai-msg.is-user.is-sending');
      if (pending) pending.remove();
      paint([], false);
      toast(res.body.error || 'The message was not sent', 'bad');
      box.value = text;
      return;
    }
    if (res.body && res.body.messages) { paint(res.body.messages, res.body.busy); seen = res.body.seq; }
    polling = setTimeout(poll, 500);
  }

  /* ---- conversations: kept on this computer, newest first ---- */

  function newChat() {
    stopPoll();
    store.set(KEY, newId());
    demo.log = []; demo.n = 0;
    photo = null;
    showChat();
  }

  async function showHistory() {
    stopPoll();
    head('history');
    el.body.innerHTML = '<p class="ai-empty">Reading your conversations…</p>';
    const body = await getJSON('/api/assistant/chats').catch(() => null);
    if (el.body.dataset.view !== 'history') return;
    const list = (body && body.chats) || [];
    const when = t => {
      const d = new Date(t * 1000), days = Math.floor((Date.now() - d) / 864e5);
      return days < 1 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : days < 7 ? d.toLocaleDateString([], { weekday: 'long' }) : d.toLocaleDateString();
    };
    el.body.innerHTML = list.length ? `<ul class="ai-chats">${list.map(c => `<li class="${c.id === threadId() ? 'is-on' : ''}">
        <button type="button" class="ai-chat-open" data-chat="${esc(c.id)}"><b>${esc(c.title)}</b><span>${esc(c.last || '')}</span><small>${esc(when(c.updated))} · ${c.count} message${c.count === 1 ? '' : 's'}</small></button>
        <button type="button" class="ai-icon-btn" data-del="${esc(c.id)}" aria-label="Delete “${esc(c.title)}”">${I.trash}</button></li>`).join('')}</ul>
        <p class="ai-hint">Conversations stay on this computer. The newest 80 are kept.</p>`
      : '<div class="ai-hello"><span class="ai-hello-mark" aria-hidden="true">' + I.history + '</span><p>No saved conversations yet. Each one you have is kept here, so you can pick up where you left off.</p></div>';
  }

  function openChat(id) {
    store.set(KEY, id);
    showChat();
  }

  async function deleteChat(id, button) {
    button.disabled = true;
    const res = await postJSON('/api/assistant/clear', { thread: id });
    if (!res.ok) { button.disabled = false; toast(res.body.error || 'That conversation wasn’t deleted', 'bad'); return; }
    if (id === threadId()) store.set(KEY, newId());
    const li = button.closest('li');
    li.classList.add('is-gone');
    setTimeout(() => (el.body.dataset.view === 'history' ? showHistory() : null), REDUCED.matches ? 0 : 220);
  }

  /* ---- the AI screen: what it can do first, the set-up below ------------- */

  const FEATURES = [
    { id: 'doctor', icon: 'doctor', title: 'Print doctor', text: 'Photograph a print that went wrong. It names the likely cause, the fix, and notes it in the logbook.', photo: true,
      ask: 'This is a photo of a print that went wrong. Name the most likely cause and one or two fixes, in plain words. Check my logbook and print history for the same problem first, then note the problem and the fix in the logbook.' },
    { id: 'spool', icon: 'spool', title: 'Spool from a photo', text: 'Snap the spool’s label. It reads the material, colour and weight and adds it to your filament shelf.', photo: true,
      ask: 'This is a photo of a filament spool or its label. Read the material, the colour (its name and a hex code close to it), the brand and the weight left if it shows. Then add it to my filament shelf with spool_add. Say what you could not read.' },
    { id: 'rule', icon: 'rule', title: 'Rules in your words', text: 'Say what should happen, like “at layer 3, check the camera” or “tell me when 10 minutes are left”.', input: 'When…',
      ask: t => `Make this automation: ${t}. Use automation_add, then say in one line what it will do.` },
    { id: 'part', icon: 'part', title: 'Make a part', text: 'Describe a part, or photograph a sketch with sizes. It builds the model and can slice it.', input: 'A 60 mm hook with two screw holes…', photo: 'optional',
      ask: t => `Make this part and save it to my files: ${t || 'the part in the sketch'}. Check its size, then tell me how to print it.` },
    { id: 'tune', icon: 'tune', title: 'Better print settings', text: 'Say what is wrong with your prints, like stringing or weak layers. It suggests settings to try, ready for the profile editor.', input: 'Stringing between the parts…',
      ask: t => `My prints have this problem: ${t}. Find the setting names with print_settings, then suggest a small set of changes to try with suggest_settings, and say why in one or two lines.` },
    { id: 'brief', icon: 'brief', title: 'Catch me up', text: 'What finished, what failed, what is due and what is running low, in a few lines.', ask: BRIEF }
  ];

  function drawPage() {
    const host = document.getElementById('ai-page');
    if (!host || host.closest('[hidden]')) return;
    if (!st) { host.innerHTML = '<section class="card liquid-glass"><div class="card-head"><div><h2>AI assistant</h2><p class="card-sub">Switched off. Turn it on in Settings, Optional extras.</p></div></div></section>'; return; }
    const keepOpen = [...host.querySelectorAll('details[open]')].map(d => d.id);
    const focus = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id : '';
    const typed = [...host.querySelectorAll('textarea[id^="ai-fi-"]')].map(t => [t.id, t.value]);
    host.innerHTML = ready() ? connectedPage() : introPage();
    keepOpen.forEach(id => { const d = host.querySelector('#' + id); if (d) d.open = true; });
    typed.forEach(([id, v]) => { const t = host.querySelector('#' + id); if (t) t.value = v; });
    if (focus) { const f = host.querySelector('#' + focus); if (f) f.focus({ preventScroll: true }); }
  }

  /* With no AI: one card that says what it adds, and the ways to connect. Nothing greyed out. */
  function introPage() {
    return `<section class="card liquid-glass ai-intro">
      <div class="ai-intro-text"><p class="ai-eyebrow">Optional</p><h2>Your own AI, inside Deja Vu1</h2>
        <p>Deja Vu1 does everything without one. Connect a plan you already pay for and you can also ask for things in your own words, and it can watch your prints through the camera.</p>
        <ul class="ai-intro-list"><li>${I.eye}<span><b>Print watch</b> looks at the camera every few minutes and can pause a failed print.</span></li>
          <li>${I.doctor}<span><b>Print doctor</b> reads a photo of a bad print and tells you the fix.</span></li>
          <li>${I.part}<span><b>Make, slice and run</b>: parts from a description, slicing, the printer itself, inside its safety limits.</span></li></ul>
        <div class="ai-actions"><button class="btn primary" type="button" data-ai-open="connect">Connect an AI</button></div>
        <p class="ai-hint">Best with a Claude or ChatGPT plan: sign in once, no key and no extra bill. A model on this computer works too, offline.</p></div>
    </section>`;
  }

  function connectedPage() {
    const c = now();
    return `${watchCard()}
      <section class="ai-features" aria-label="More AI features">${FEATURES.map(f => `
        <article class="card liquid-glass ai-feature" id="ai-f-${f.id}"><div class="ai-feature-h"><span class="ai-feature-icon" aria-hidden="true">${I[f.icon]}</span><h2>${esc(f.title)}</h2></div>
          <p>${esc(f.text)}</p>
          ${f.input ? `<label class="sr-only" for="ai-fi-${f.id}">${esc(f.title)}</label><textarea id="ai-fi-${f.id}" rows="2" placeholder="${esc(f.input)}"></textarea>` : ''}
          <div class="ai-actions">${f.photo ? `<button class="btn${f.photo === true ? ' primary' : ''}" type="button" data-feature="${f.id}" data-photo="1">${I.camera}<span>${f.photo === true ? 'Take or choose a photo' : 'Add a sketch'}</span></button>` : ''}
            ${f.photo !== true ? `<button class="btn${f.photo ? '' : ' primary'}" type="button" data-feature="${f.id}">${{ brief: 'Catch me up', rule: 'Make the rule', tune: 'Suggest settings' }[f.id] || 'Make it'}</button>` : ''}</div>
        </article>`).join('')}</section>
      <section class="ai-setup" id="ai-setup" aria-label="Set-up">
        <details class="card liquid-glass ai-mini" id="ai-yours"><summary><h2>Your AI</h2><span>${esc(c ? short(c.name) : 'Demo helper')}</span></summary>
          <p class="ai-mini-big">${esc(c ? c.name : 'Online demo helper')}</p><p class="ai-hint">${esc(c ? (c.model || 'its usual model') : 'A scripted stand-in')}</p>
          <div class="ai-actions"><button class="btn small" type="button" data-ai-open="chat">Open the chat</button><button class="btn small" type="button" data-ai-open="connect">Manage</button></div>
          <p class="ai-hint ai-kbd-tip">Ctrl+J (Cmd+J on a Mac) opens it anywhere.</p></details>
        <details class="card liquid-glass ai-mini" id="ai-may"><summary><h2>How much it may do</h2><span>${esc(((st.modes || {})[st.mode] || '').split(':')[0])}</span></summary>
          <div class="ai-modes">${modesHTML('ai-mode-page')}</div>
          ${(st.never_ask || []).length ? `<p class="ai-hint ai-never">Never asks about: ${st.never_ask.map(n => `<button type="button" class="ai-chip" data-reask="${esc(n.tool)}" aria-label="Ask again about: ${esc(n.label)}">${esc(n.label)} <span aria-hidden="true">×</span></button>`).join('')}</p>` : ''}
          <p class="ai-hint">${limitsText()}</p></details>
        ${paysPerMessage() ? costCard() : ''}
        <details class="card liquid-glass ai-mini" id="ai-private"><summary><h2>Privacy</h2><span>What leaves this computer</span></summary>
          <p class="ai-hint">The AI you choose receives what you type, the printer’s readings, the results of its steps and any photo you attach. A camera picture goes only when it looks through the camera. Conversations are saved on this computer only. A model on this computer keeps everything at home.</p>
          <p class="ai-hint">${(st.tools || []).length || 'A fixed set of'} named steps are its only way to reach the printer, and every one passes the same checks as the buttons.</p></details>
      </section>`;
  }

  function costCard() {
    const p = st.price || {}, c = now();
    const where = { service: 'the price the service lists', yours: 'the price you entered' }[p.from] || '';
    const state = p.charge === 'tokens' ? `${esc(c.model || c.name)}: $${esc(p.in)} per million tokens in, $${esc(p.out)} out, from ${where}.`
      : `${esc(c.model || c.name)}: the service lists no price, so no cost is shown. Type it from the service’s pricing page.`;
    return `<details class="card liquid-glass ai-mini" id="ai-cost-card"><summary><h2>Cost and limit</h2><span>${st.cap_usd ? `Limit $${esc(st.cap_usd)}` : 'No limit'}</span></summary>
      <p class="ai-hint">${state}</p>
      <form class="ai-budget" id="ai-budget">
        <div class="ai-budget-row"><label class="ai-field"><span>Price in <i>$ per million tokens</i></span><input id="ai-price-in" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${p.from === 'yours' ? esc(p.in) : ''}" placeholder="${p.from === 'service' ? esc(p.in) : 'From its pricing page'}"></label>
        <label class="ai-field"><span>Price out <i>$ per million tokens</i></span><input id="ai-price-out" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${p.from === 'yours' ? esc(p.out) : ''}" placeholder="${p.from === 'service' ? esc(p.out) : ''}"></label></div>
        <label class="ai-field"><span>Stop a request after <i>$, empty for no limit</i></span><input id="ai-cap" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${st.cap_usd ? esc(st.cap_usd) : ''}" placeholder="No limit"></label>
        <div class="ai-actions"><button class="btn primary" type="submit">Save</button>${p.from === 'yours' ? '<button class="btn" type="button" id="ai-price-clear">Forget my price</button>' : ''}</div>
      </form></details>`;
  }

  /* ---- print watch: the headline feature -------------------------------- */

  function demoWatch() {
    const w = (st && st.watch && st.watch.looks_known) ? st.watch : {};
    return Object.assign({ on: true, minutes: 10, pause: true, first_layer: true, compare: true, confirm: true, notify: false,
      looks: ['spaghetti', 'detached', 'blob', 'layer_shift'], sensitivity: 'normal', notes: '', minutes_range: [2, 60],
      looks_known: { spaghetti: 'loose strands like spaghetti, or plastic laid in mid-air', detached: 'a part knocked loose, moved or toppled on the bed', blob: 'a large blob of plastic building up around a nozzle', layer_shift: 'layers suddenly offset sideways', warping: 'corners or edges lifting off the bed', stringing: 'fine strings between parts' },
      log: [{ at: Date.now() / 1000 - 240, verdict: 'ok', why: 'Clean walls, both parts still stuck down.', printer_name: 'Demo printer 1', reason: 'every 10 minutes' },
        { at: Date.now() / 1000 - 1500, verdict: 'ok', why: 'The first layer is down evenly.', printer_name: 'Demo printer 1', reason: 'first layers' }],
      usage: {}, pictures: [], next_in_s: {} }, w);
  }

  const LOOK_NAME = { spaghetti: 'Spaghetti', detached: 'Knocked loose', blob: 'Nozzle blob', layer_shift: 'Layer shift', warping: 'Warping', stringing: 'Stringing' };
  function watchCard() {
    const w = Object.assign({ looks: [], looks_known: {}, log: [], usage: {}, pictures: [], next_in_s: {}, minutes_range: [2, 60] }, st.watch || {});
    const when = t => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const word = { ok: 'Looks fine', worry: 'Worth a look', failed: 'Looks failed', skipped: 'Not checked' };
    const last = (w.log || [])[0];
    const pic = last && (w.pictures || []).includes(last.printer) && !st.demo
      ? `<img class="ai-watch-pic" alt="What print watch saw at ${esc(when(last.at))}" src="/api/assistant/watch/picture?printer=${encodeURIComponent(last.printer)}&t=${Math.round(last.at)}">`
      : `<div class="ai-watch-pic is-empty" aria-hidden="true">${I.eye}</div>`;
    const next = Object.values(w.next_in_s || {})[0];
    const state = !w.on ? 'Off' : next != null ? `Watching · next look in ${Math.max(1, Math.round(next / 60))} min` : `On · every ${w.minutes} min while printing`;
    const minutes = [2, 5, 10, 15, 30, 60].filter(m => m >= w.minutes_range[0] && m <= w.minutes_range[1]);
    const log = (w.log || []).slice(0, 5).map(e => `<li class="ai-watch-${esc(e.verdict)}"><b>${esc(word[e.verdict] || e.verdict)}</b>
      <span>${esc(e.printer_name || e.printer || '')} · ${when(e.at)}${e.reason ? ` · ${esc(e.reason)}` : ''}${e.paused ? ' · paused' : ''}</span><p>${esc(e.why || '')}</p></li>`).join('');
    const u = w.usage || {};
    const toggle = (id, on, label, hint) => `<label class="ai-tog"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    return `<section class="card liquid-glass ai-watch" id="ai-watch-card">
      <div class="ai-watch-top">
        <div class="ai-watch-main">
          <p class="ai-eyebrow">${I.eye} Print watch</p>
          <h2>Your AI keeps an eye on every print</h2>
          <p class="ai-watch-state${w.on ? ' is-on' : ''}" aria-live="polite">${esc(state)}</p>
          <label class="ai-bigswitch"><input type="checkbox" id="ai-watch-on" role="switch"${w.on ? ' checked' : ''}><span class="ai-bigswitch-track" aria-hidden="true"><i></i></span><span>Watch my prints through the camera</span></label>
          <ul class="ai-watch-sum" aria-label="How it is set">${[`Every ${w.minutes} min`, w.first_layer && 'First layers', w.compare && 'Compares pictures',
            w.pause ? (w.confirm ? 'Looks twice, then pauses' : 'Pauses a failure') : 'Tells you, never pauses', w.notify && 'Sends alerts',
            w.sensitivity !== 'normal' && `${w.sensitivity[0].toUpperCase() + w.sensitivity.slice(1)}`].filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          <div class="ai-actions"><button class="btn" type="button" id="ai-watch-now">${I.camera}<span>Check now</span></button></div>
          ${st.demo ? '<p class="ai-hint">In the online demo these settings are a preview: print watch needs a real printer’s camera.</p>' : ''}
        </div>
        <figure class="ai-watch-last">${pic}<figcaption>${last ? `<span class="ai-pill is-${esc(last.verdict)}">${esc(word[last.verdict] || last.verdict)}</span> ${esc(last.why || '')}` : 'Its first look will show here, with what it saw.'}</figcaption></figure>
      </div>
      <details class="ai-watch-more" id="ai-watch-more"><summary>Customize${I.chevron}</summary>
        <div class="ai-watch-grid">
          <div><h3>How often</h3><div class="ai-seg" role="radiogroup" aria-label="How often">${minutes.map(m => `<label><input type="radio" name="ai-watch-min" value="${m}"${m === w.minutes ? ' checked' : ''}><span>${m} min</span></label>`).join('')}</div>
            <h3>How readily it worries</h3><div class="ai-seg" role="radiogroup" aria-label="Sensitivity">${['relaxed', 'normal', 'careful'].map(k => `<label><input type="radio" name="ai-watch-sense" value="${k}"${k === w.sensitivity ? ' checked' : ''}><span>${k[0].toUpperCase() + k.slice(1)}</span></label>`).join('')}</div>
            <h3>What to look for</h3><div class="ai-looks">${Object.keys(w.looks_known || {}).map(k => `<label class="ai-look"><input type="checkbox" name="ai-watch-look" value="${esc(k)}"${(w.looks || []).includes(k) ? ' checked' : ''}><span>${esc(LOOK_NAME[k] || k)}</span></label>`).join('')}</div></div>
          <div>${toggle('ai-watch-first', w.first_layer, 'Check the first layers', 'An extra look early on, where most prints fail')}
            ${toggle('ai-watch-compare', w.compare, 'Compare with the last picture', 'Spots a print that stopped growing: a clog or an empty spool')}
            ${toggle('ai-watch-pause', w.pause, 'Pause a clear failure', 'Watch-only mode and the safety checks still apply')}
            ${toggle('ai-watch-confirm', w.confirm, 'Look twice before pausing', 'A second picture must agree, so one odd frame never stops a print')}
            ${toggle('ai-watch-notify', w.notify, 'Send me an alert', 'Through the channels in Settings, Alerts')}</div>
        </div>
        <label class="ai-field"><span>Notes for it <i>about your setup, up to 300 characters</i></span><textarea id="ai-watch-notes" rows="2" maxlength="300" placeholder="The mark on the left of the sheet is old; ignore it.">${esc(w.notes || '')}</textarea></label>
      </details>
      ${log ? `<details class="ai-watch-more" id="ai-watch-history"><summary>Recent looks${I.chevron}</summary><ul class="ai-watch-log">${log}</ul>
        ${u.checks ? `<p class="ai-hint">${u.checks} look${u.checks === 1 ? '' : 's'} so far${u.cost_usd ? `, about $${u.cost_usd.toFixed(u.cost_usd < 0.01 ? 4 : 2)}` : ''}.</p>` : ''}</details>` : ''}
    </section>`;
  }

  async function saveWatch(host) {
    const v = id => host.querySelector(id);
    const body = { on: v('#ai-watch-on').checked, first_layer: v('#ai-watch-first').checked, compare: v('#ai-watch-compare').checked,
      pause: v('#ai-watch-pause').checked, confirm: v('#ai-watch-confirm').checked, notify: v('#ai-watch-notify').checked,
      looks: [...host.querySelectorAll('[name=ai-watch-look]:checked')].map(i => i.value),
      notes: v('#ai-watch-notes').value };
    const min = host.querySelector('[name=ai-watch-min]:checked'), sense = host.querySelector('[name=ai-watch-sense]:checked');
    if (min) body.minutes = +min.value;
    if (sense) body.sensitivity = sense.value;
    if (!body.looks.length) { toast('Pick at least one thing to look for', 'warn'); return; }
    if (st.demo) { Object.assign(st.watch, body); drawPage(); return; }
    const res = await postJSON('/api/assistant/watch', body);
    if (res.ok) take(res.body); else toast(res.body.error || 'That was not saved', 'bad');
  }

  async function feature(id, withPhoto) {
    const f = FEATURES.find(x => x.id === id);
    if (!f) return;
    const box = document.getElementById('ai-fi-' + id);
    const typed = box ? box.value.trim() : '';
    if (f.input && !typed && !withPhoto) { box.focus(); toast('Type what you want first', 'info'); return; }
    let pic = null;
    if (withPhoto) {
      if (st.demo) { toast('The online demo can’t read photos. With your own AI connected it can.', 'info'); return; }
      const got = await pickPhoto(true);
      if (!got) return;
      pic = got.data;
    }
    const ask = typeof f.ask === 'function' ? f.ask(typed) : f.ask;
    if (box) box.value = '';
    if (st.demo && id !== 'brief') { send(typed || f.title); return; }
    store.set(KEY, newId());
    if (!open) await toggle(true); else showChat();
    send(ask, null, pic);
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
    host.addEventListener('change', async e => {
      const t = e.target;
      if (t.closest('#ai-watch-card')) { saveWatch(host); return; }
      if (t.name === 'ai-mode-page') post({ mode: t.value });
    });
    host.addEventListener('click', async e => {
      const t = e.target;
      if (t.id === 'ai-price-clear') {
        const res = await postJSON('/api/assistant/budget', { clear_price: true });
        if (res.ok) take(res.body);
        return;
      }
      const now_ = t.closest('#ai-watch-now');
      if (now_) {
        if (st.demo) { toast('Check now needs a real printer’s camera. Demo printers have none.', 'info'); return; }
        now_.disabled = true;
        now_.querySelector('span').textContent = 'Looking…';
        const res = await postJSON(api('/api/assistant/watch/now'), {});
        now_.disabled = false;
        if (res.ok) { st.watch = res.body.watch; drawPage(); toast(`Print watch: ${res.body.why || res.body.verdict}`, res.body.verdict === 'failed' ? 'bad' : res.body.verdict === 'worry' ? 'warn' : 'ok'); }
        else { now_.querySelector('span').textContent = 'Check now'; toast(res.body.error || 'It couldn’t look just now', 'bad'); }
        return;
      }
      const f = t.closest('[data-feature]');
      if (f) { feature(f.dataset.feature, !!f.dataset.photo); return; }
      const go = t.closest('[data-ai-open]'), again = t.closest('[data-reask]');
      if (again) return post({ never_ask: st.never_ask.map(n => n.tool).filter(x => x !== again.dataset.reask) });
      if (!go) return;
      if (!open) await toggle(true);
      if (go.dataset.aiOpen === 'connect') showConnect(); else if (st.ready) showChat();
    });
  }

  /* ---- shortcuts around the app -------------------------------------------
   * One small sparkle in the heading of a card the assistant can help with: just an icon, with its words on
   * hover and focus, so it never crowds a card. They exist only while an AI is connected, so an app with no
   * AI has nothing missing and nothing greyed out. Each sends what is on that card along with the question. */
  const words = sel => { const n = document.querySelector(sel); return n ? n.innerText.replace(/\s+\n/g, '\n').trim().slice(0, 3500) : ''; };
  const SPOTS = [
    ['#file-detail .card-head', 'Ask about this file', () => [`Tell me what ${words('#fd-name')} needs to print and anything to watch for.`, words('#file-detail')]],
    ['#confirm-dialog .dialog-head, #confirm-dialog header', 'Explain these checks', () => ['Confirm Print is open. Explain each warning or block in plain words and what I should do about it.', words('#confirm-dialog')]],
    ['#attention .card-head', 'What first?', () => ['These things need me. Which one first, and how do I deal with it?', words('#attention')]],
    ['#insights-card .card-head', 'Explain my history', () => ['Explain what my print history says and what I should change.', words('#insights-card')]],
    ['#pp-console .card-head', 'Explain the replies', () => ['Explain the printer’s latest replies in the console in plain words.', words('#pp-console')]],
    ['#ov-upkeep .card-head', 'What matters most?', () => ['Which care task matters most right now, and how do I do it?', words('#ov-upkeep')]],
    ['#pp-mesh .card-head', 'Read this mesh', () => ['Read the bed mesh and tell me whether the bed is level enough, in plain words.', words('#pp-mesh')]],
    ['#tab-filament .card-head', 'Add a spool from a photo', () => ['photo:spool']],
    ['#tab-autoprint .card-head', 'Help me set up slicing', () => ['Help me get slicing working: check what is set up, then tell me the one next step. If the stock Snapmaker U1 settings are available, use them.', words('#tab-autoprint')]],
    ['#timelapse-card .card-head', 'Find my time-lapses', () => ['Find my time-lapses, including any the printer still holds, and tell me which ones I can save.', words('#timelapse-card')]],
    ['#logbook .card-head', 'Diagnose from a photo', () => ['photo:doctor']]
  ];
  function decorate() {
    const on = !!(st && st.ready && !st.demo);
    document.querySelectorAll('.ai-ask, .ai-rule-maker').forEach(b => { if (!on) b.remove(); });
    if (!on) return;
    SPOTS.forEach(([sel, label, make], i) => {
      const head_ = document.querySelector(sel);
      if (!head_ || head_.querySelector('.ai-ask')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-ask';
      b.dataset.spot = i;
      b.setAttribute('aria-label', label);
      b.innerHTML = I.spark + `<span>${esc(label)}</span>`;
      b.addEventListener('click', async () => {
        const [text, context] = make();
        if (text.startsWith('photo:')) { const f = FEATURES.find(x => x.id === text.slice(6)); const got = await pickPhoto(true); if (got) { store.set(KEY, newId()); if (!open) await toggle(true); else showChat(); send(f.ask, null, got.data); } return; }
        send(text, context);
      });
      head_.appendChild(b);
    });
    ruleMaker();
  }

  /* Automations: write a rule in your own words (only while an AI is connected). */
  function ruleMaker() {
    const tab = document.getElementById('tab-automations');
    if (!tab || tab.querySelector('.ai-rule-maker')) return;
    const box = document.createElement('section');
    box.className = 'card liquid-glass ai-rule-maker ai-only';
    box.innerHTML = `<div class="ai-feature-h"><span class="ai-feature-icon" aria-hidden="true">${I.rule}</span><h2>Describe a rule</h2></div>
      <p class="ai-hint">Say what should happen and your AI sets it up, like “when a print fails, flash the lights red” or “at layer 3, check the first layer through the camera and pause if it failed”.</p>
      <div class="ai-rule-row"><label class="sr-only" for="ai-rule-text">The rule, in your words</label><textarea id="ai-rule-text" rows="2" placeholder="When…"></textarea>
        <button class="btn primary" type="button" id="ai-rule-go">Make the rule</button></div>`;
    const first = tab.querySelector('section.card, .card');
    if (first) first.before(box); else tab.prepend(box);
    box.querySelector('#ai-rule-go').addEventListener('click', () => {
      const t = box.querySelector('#ai-rule-text').value.trim();
      if (!t) { box.querySelector('#ai-rule-text').focus(); return; }
      box.querySelector('#ai-rule-text').value = '';
      store.set(KEY, newId());
      send(FEATURES.find(f => f.id === 'rule').ask(t));
    });
  }

  /* ---- the online demo's scripted helper ----------------------------------
   * No AI runs on the public demo page. This reads a few plain requests and sends the same simulated
   * commands the demo's own buttons send, so the twin moves. It says what it is. */
  const demo = { log: [], n: 0, wait: null };
  const demoAdd = m => { m.n = ++demo.n; demo.log.push(m); demoPaint(); return m; };
  function demoPaint(busy) { paint(demo.log, !!busy); }
  const demoSay = text => demoAdd({ role: 'assistant', text });
  async function demoStep(label, path, body, level, extra) {
    const m = demoAdd({ role: 'action', label, status: 'running', level: level || 'safe' });
    demoPaint(true);
    await new Promise(r => setTimeout(r, 450));
    const res = path ? await postJSON(api(path), body || {}) : { ok: true, body: {} };
    m.status = res.ok ? 'done' : 'refused';
    m.detail = res.ok ? '' : (res.body.error || 'The printer refused');
    if (res.ok && extra) Object.assign(m, extra);
    demoPaint(true);
    return res.ok;
  }
  /* A step that waits for a yes, the way the real assistant shows one. */
  function demoAsk(label, run, after) {
    const m = demoAdd({ role: 'action', label, status: 'waiting', level: 'ask' });
    demo.wait = { m, run: async () => { m.status = 'running'; demoPaint(true); const res = await run(); m.status = res.ok ? 'done' : 'refused'; m.detail = res.ok ? '' : (res.body.error || ''); demoSay(after(res.ok)); } };
  }
  async function demoSend(text) {
    autoFrom = Math.min(autoFrom, demo.n);
    demoAdd({ role: 'user', text });
    demoPaint(true);
    await new Promise(r => setTimeout(r, 450));
    const t = text.toLowerCase(), s = await getJSON(api('/api/printer')).catch(() => ({})) || {};
    const temp = (t.match(/(\d{2,3})\s*(?:°|degrees|c\b)/) || t.match(/to\s+(\d{2,3})/) || [])[1];
    const head_ = ((t.match(/\bt([0-3])\b/) || [])[1]) || '0';
    const busyPrint = s.state === 'printing' || s.state === 'paused';
    const asks = st.mode === 'ask', advice = st.mode === 'advice';
    const heads = Object.entries(s.toolheads || {}).map(([k, h]) => ({ name: k, temp: h.temperature, target: h.target_temperature }));
    const printerCard = { kind: 'printer', name: s.printer_name || 'Demo printer', state: s.state || 'standby', file: s.current_file || '', progress: s.current_file ? Math.round((s.progress || 0) * 100) : null, heads, bed: { temperature: s.bed_temperature, target: s.bed_target }, active: s.active_toolhead || '' };
    const goTwin = /twin|3d|digital/.test(t), goCam = /camera|webcam/.test(t) && /show|open|take|go/.test(t);
    if (goTwin || goCam) {
      const spot = goTwin ? '#twin-card' : '#pp-camera-card';
      await demoStep(goTwin ? 'Show you the 3D digital twin' : 'Show you the live camera', null, null, 'handoff', { handoff: { kind: 'page', place: 'printer', spot } });
      demoSay(goTwin ? 'Here is the digital twin: a live 3D model of the printer, drawn from what it reports.' : 'Here is the camera view.');
    } else if (advice && /home|cool|warm|heat|pause|resume|fan|cancel/.test(t)) demoSay('You set me to advice only, so I send the printer nothing. Choose another setting on the AI screen and ask again.');
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
      const heat = () => postJSON(api('/api/printer/control/temperature'), { toolhead: 'T' + head_, target });
      if (target > 300) demoSay(`I won’t set ${target} °C. The heater limit is 300 °C, and Deja Vu1 refuses anything above it whatever I ask for.`);
      else if (asks) demoAsk(`Set T${head_} to ${target} °C`, heat, ok => (ok ? `T${head_} is heating to ${target} °C.` : 'The printer refused that temperature.'));
      else { const ok = await demoStep(`Set T${head_} to ${target} °C`, '/api/printer/control/temperature', { toolhead: 'T' + head_, target }); demoSay(ok ? `T${head_} is heating to ${target} °C.` : 'The printer refused that temperature.'); }
    } else if (/pause/.test(t)) { const ok = await demoStep('Pause the print', '/api/printer/control/pause'); demoSay(ok ? 'Paused. Say resume when you are ready.' : 'There is nothing to pause right now.'); }
    else if (/resume|continue/.test(t)) { const ok = await demoStep('Resume the print', '/api/printer/control/resume'); demoSay(ok ? 'Resumed.' : 'There is nothing to resume right now.'); }
    else if (/fan/.test(t)) { const pct = Math.min(100, +(t.match(/(\d{1,3})\s*%?/) || [0, 50])[1]); const ok = await demoStep(`Set the fan to ${pct}%`, '/api/printer/control/fan', { percent: pct }); demoSay(ok ? `The fan is at ${pct}%.` : 'The printer refused the fan change.'); }
    else if (/print going|status|temperature|how is|where|catch me up/.test(t)) {
      await demoStep('Read the printer', null, null, 'read', { card: printerCard });
      demoSay(busyPrint ? `It’s ${Math.round((s.progress || 0) * 100)}% through ${s.current_file || 'the print'}, and the temperatures are holding.` : 'It’s ready for the next print.');
    } else demoSay('This is the online demo’s scripted helper, so it only knows a few requests: show the twin or the camera, home, warm up, cool down, pause, resume, cancel, set the fan, or how the print is going. With your own AI connected it reads your files, history and camera, makes parts, watches prints and works the whole app in your own words.');
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
    window.addEventListener('dv-tab', e => { if (e.detail && e.detail.tab === 'ai') refresh(); });
    window.addEventListener('dv-state', e => { live = e.detail || {}; });
    ['dv-tab', 'dv-section'].forEach(name => window.addEventListener(name, () => setTimeout(decorate, 0)));
    // Warnings and refusals anywhere in the app become something the assistant can explain, while one is connected.
    const plain = window.toast;
    if (typeof plain === 'function') window.toast = function (message, kind) {
      if (ready() && (kind === 'bad' || kind === 'warn') && typeof message === 'string') { lastTrouble = message.slice(0, 400); if (open && el.body.dataset.view === 'chat') drawIdeas(); }
      return plain.apply(this, arguments);
    };
    setTimeout(refresh, 1200);
  });

  window.Assistant = { open: () => toggle(true), close: () => toggle(false), ask: send, refresh, glow, goTo, openFile, pickPhoto, shrink };
})();
