/* assistant-part2.js: part 2 of 2 of assistant.js, the AI assistant's panel, chat, cards, print watch and
 * settings. Split out of the one closure assistant.js was (18 November 2026) so a session reads only the part it
 * needs. Loaded before assistant.js, after assistant-part1.js; it hands its names on through AssistantPart2. Holds:
 * afterDisconnect, applyProposal, build, decorate, demoAdd, demoAsk, demoPaint, demoSay, demoSend, demoStep,
 * demoStop, drawIdeas, feature, goTo, handoff, newChat, openChat, openFile, openForm, paint, poll, refresh,
 * ruleMaker, saveWatch, send, settle, showChat, showConnect, take, toggle, whoMenu, wirePage
 */
const AssistantPart2 = (() => {
  const { FEATURES, I, ICON, KEY, KEY_NOTE, OPENS, PHONE, REDUCED, SPOTS, aiState, closePop, costSoon, demo,
    demoWatch, drawAttached, drawPage, el, glow, greet, head, ideas, isDemo, lists, mark, modelField, modelValue,
    newId, pickPhoto, planState, proposals, provider, readModels, ready, rowHTML, rows, short, showHistory,
    showIdeas, stopPoll, threadId, tile, whoLabel, wireModel } = AssistantPart1;

function build() {
    const launch = document.createElement('button');
    launch.className = 'ai-launch liquid-glass';
    launch.id = 'ai-launch';
    launch.type = 'button';
    launch.setAttribute('aria-label', 'Ask the assistant');
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
      else if (e.key === 'Escape' && aiState.open && panel.contains(document.activeElement)) toggle(false);
    });
    document.addEventListener('click', e => { if (!el.pop.hidden && !el.pop.contains(e.target) && !el.who.contains(e.target)) closePop(); });
  }

function take(body) {
    if (body && body.providers) aiState.st = body;
    mark();
    decorate();
    drawPage();
    return aiState.st;
  }

async function refresh() {
    if (isDemo()) {
      aiState.st = aiState.st || { demo: true, ready: true, mode: 'free', providers: [], modes: {}, provider: 'demo', connections: [], never_ask: [] };
      const rec = await getJSON('/api/assistant').catch(() => ({}));
      if (rec && rec.providers) Object.assign(aiState.st, { providers: rec.providers.map(p => ({ ...p, installed: false, has_key: false, ready: false })), modes: rec.modes, default_mode: rec.default_mode, limits: rec.limits, security: rec.security });
      aiState.st.watch = demoWatch();
      mark(); decorate(); drawPage();
      return aiState.st;
    }
    const body = await getJSON('/api/assistant');
    aiState.st = body && body.providers ? body : null;
    el.launch.hidden = !aiState.st;
    mark(); decorate(); drawPage();
    return aiState.st;
  }

async function toggle(want) {
    aiState.open = want === undefined ? !aiState.open : want;
    el.launch.setAttribute('aria-expanded', String(aiState.open));
    document.documentElement.classList.toggle('ai-open', aiState.open);
    closePop();
    if (!aiState.open) { el.panel.classList.remove('is-in'); setTimeout(() => { if (!aiState.open) el.panel.hidden = true; }, 220); stopPoll(); el.launch.focus({ preventScroll: true }); return; }
    el.panel.hidden = false;
    requestAnimationFrame(() => el.panel.classList.add('is-in'));
    if (!aiState.st || !el.body.dataset.view) await refresh();
    else refresh();
    if (!aiState.st) { el.body.innerHTML = '<p class="ai-empty">The assistant is switched off. Turn it on in Settings, Optional extras.</p>'; return; }
    if (aiState.st.ready) { store.set(OPENS, String((+store.get(OPENS) || 0) + 1)); showChat(); } else showConnect();
    el.panel.querySelector('#ai-title').focus({ preventScroll: true });
  }

function showConnect() {
    stopPoll();
    head('connect');
    const of = kind => aiState.st.providers.filter(p => (kind === 'local' ? p.kind === 'local' || p.kind === 'custom'
      : kind === 'plan' ? p.kind === 'cli' || p.kind === 'account' : p.kind === kind));
    const plans = of('plan').sort((a, b) => ({ 'claude-code': 0, chatgpt: 1, codex: 2 }[a.id] ?? 3) - ({ 'claude-code': 0, chatgpt: 1, codex: 2 }[b.id] ?? 3));
    const sec = aiState.st.security || {};
    const keysOpen = of('key').some(p => p.has_key) || (aiState.picked && (provider(aiState.picked) || {}).kind === 'key');
    const joined = aiState.st.connections || [];
    el.body.innerHTML = `
      ${aiState.st.demo ? '<p class="ai-note">Online demo: a scripted helper answers here, on a simulated printer. On your own computer you connect one of these.</p>' : ''}
      ${joined.length ? `<section class="ai-group"><h3>Connected</h3>
        <ul class="ai-joined">${joined.map(c => `<li class="${c.id === aiState.st.provider ? 'is-on' : ''}">
          <button type="button" class="ai-joined-main" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(c.model || 'its usual model')}</span></button>
          ${c.id === aiState.st.provider ? '<span class="ai-prov-state">In use</span>' : `<button type="button" class="btn small" data-use="${esc(c.id)}">Use</button>`}
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
          <p>${esc(aiState.st.demo ? 'Deja Vu1 hands the key to your computer’s own keyring: Windows Data Protection, the macOS Keychain, or the desktop keyring on Linux. Where none answers it uses a file only your account can open, and tells you so.' : sec.how || '')}</p>${sec.problem && !aiState.st.demo ? `<p class="ai-safe-warn">${esc(sec.problem)}</p>` : ''}
          <ul>${(sec.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
        <div class="ai-slot" data-slot="key"></div>
        <label class="ai-search"><span class="sr-only">Find a service</span><input id="ai-find" type="search" placeholder="Find a service" autocomplete="off"></label>
        <ul class="ai-providers">${of('key').map(tile).join('')}</ul></details>
      <p class="ai-hint ai-online-note">Claude, ChatGPT and the key services run on their makers’ computers, so they need this computer to be online. A model on this computer works without the internet, and the rest of Deja Vu1 always does.</p>`;
    const post = async (path, body) => {
      if (aiState.st.demo) return false;
      const res = await postJSON(path, body);
      if (res.ok) take(res.body); else toast(res.body.error || 'That was not saved', 'bad');
      return res.ok;
    };
    el.body.querySelectorAll('.ai-prov, .ai-joined-main').forEach(b => b.addEventListener('click', () => openForm(b.dataset.id)));
    el.body.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', async () => { if (await post('/api/assistant/select', { provider: b.dataset.use })) showConnect(); }));
    el.body.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', async () => {
      const name = (provider(b.dataset.drop) || {}).name;
      if (await post('/api/assistant/forget', { provider: b.dataset.drop })) { aiState.picked = null; afterDisconnect(); toast(`${name}: disconnected`, 'info'); }
    }));
    el.body.querySelector('#ai-find').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      el.body.querySelectorAll('.ai-keys .ai-providers li').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
    });
    if (aiState.picked) openForm(aiState.picked, true);
  }

  /* After the last AI goes, nothing of it stays behind: no shortcuts, no glow, no chat. */
function afterDisconnect() {
    mark(); decorate(); drawPage();
    if (!ready()) { aiState.wasReady = false; aiState.photo = null; }
    showConnect();
  }

  /* One provider's form: sign in (plans), an address (local), a key (services), then Connect. */
async function openForm(id, quiet) {
    const p = provider(id);
    if (!p) return;
    const slotKind = p.kind === 'custom' ? 'local' : p.kind === 'account' ? 'cli' : p.kind;
    const slot = el.body.querySelector(`.ai-slot[data-slot="${slotKind}"]`);
    if (!slot) return;
    aiState.picked = id;
    if (p.kind === 'key') el.body.querySelector('.ai-keys').open = true;
    el.body.querySelectorAll('.ai-slot').forEach(s => { if (s !== slot) s.innerHTML = ''; });
    el.body.querySelectorAll('.ai-prov').forEach(b => b.classList.toggle('is-picked', b.dataset.id === id));
    const cli = p.kind === 'cli', account = p.kind === 'account', plan = cli || account;
    const needsKey = p.kind === 'key', address = p.kind === 'local' || p.kind === 'custom';
    const joined = (aiState.st.connections || []).some(c => c.id === id);
    let signing = null;   // { url, running } while a sign-in waits
    const draw = () => {
      const q = provider(id) || p, model = (aiState.st.models || {})[id] || '';
      const absent = cli && !aiState.st.demo && !q.installed;
      const signedOut = !aiState.st.demo && ((cli && q.installed && q.signed_in === false) || (account && !q.ready));
      slot.innerHTML = `<div class="ai-form" id="ai-form">
        <h3>${esc(q.name)}</h3>
        ${q.note ? `<p class="ai-hint">${esc(q.note)}</p>` : ''}
        ${absent ? `<p class="ai-step-help">${q.id === 'codex' ? 'Codex isn’t installed on this computer. Most people should use <b>ChatGPT plan</b> instead, which needs nothing installed.' : `Claude Code isn’t on this computer yet. It is Anthropic’s free program that lets other apps use your Claude plan. <a href="${esc(q.install_url)}" target="_blank" rel="noopener">Install it</a> (one command), then press Check again.`}</p>` : ''}
        ${signedOut ? signHTML(q) : ''}
        ${plan && !aiState.st.demo && !signedOut && !absent && (q.signed_in || q.ready) ? `<p class="ai-ok">${account && q.email ? `Signed in as ${esc(q.email)}.` : `Found and signed in${q.version ? ` (${esc(q.version)})` : ''}.`}</p>` : ''}
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
      if (aiState.st.demo || !cli) return;
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
      for (let i = 0; i < 200 && signing === started && aiState.picked === id && slot.isConnected; i++) {
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
        if (aiState.st.demo) { say('The online demo can’t sign in. Install Deja Vu1 on your computer to use your own plan.', 'warn'); return; }
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
        if (res.ok) { take(res.body); delete lists[id]; aiState.picked = null; afterDisconnect(); toast(`${p.name}: ${account ? 'signed out' : cli ? 'disconnected' : 'key forgotten'}`, 'info'); }
      });
      const connect = form.querySelector('#ai-connect');
      if (connect) connect.addEventListener('click', async () => {
        if (aiState.st.demo) { say('The online demo can’t connect a real AI. Install Deja Vu1 on your computer to use your own.', 'warn'); return; }
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
            if (!wanted) { aiState.st.models = { ...aiState.st.models, [id]: '' }; draw(); say(list.body.note || 'Pick a model, then press Connect', 'warn'); return; }
          }
          if (!plan && !wanted) { say('Pick a model, then press Connect', 'warn'); return; }
          const chosen = await postJSON('/api/assistant/select', { provider: id, model: wanted });
          if (!chosen.ok) { say(chosen.body.error || 'That model name was not accepted', 'bad'); return; }
          say('Checking the connection…');
          const test = await postJSON('/api/assistant/test', { provider: id });
          if (!test.ok) { await check(); draw(); say(test.body.error || 'The connection check failed', 'bad'); return; }
          take(test.body);
          aiState.picked = null;
          if (test.body.first) glow();
          settle();
        } finally { connect.disabled = false; }
      });
    }
    async function loadList() {
      const q = provider(id) || p;
      if (aiState.st.demo || lists[id]) return;
      if (cli ? q.installed && q.signed_in !== false : q.ready) await readModels(id);
    }
    draw();
    if (!quiet) slot.scrollIntoView({ block: 'nearest', behavior: REDUCED.matches ? 'auto' : 'smooth' });
    if (!aiState.st.demo) { await check(); await loadList(); if (aiState.picked === id && slot.isConnected && !signing) draw(); }
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
async function whoMenu() {
    if (!el.pop.hidden) { closePop(); return; }
    const joined = aiState.st.connections || [];
    const draw = () => {
      const p = provider(aiState.st.provider) || {}, list = lists[aiState.st.provider], current = aiState.st.model || '';
      const rowsOf = (list && list.rows) || [];
      el.pop.innerHTML = `<p class="ai-pop-h">Answering</p>
        <div class="ai-pop-list" role="group" aria-label="AI in use">${joined.map(c => `<button type="button" class="ai-pop-item${c.id === aiState.st.provider ? ' is-on' : ''}" data-conn="${esc(c.id)}" aria-pressed="${c.id === aiState.st.provider}">${esc(c.name)}</button>`).join('')}</div>
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
        if (!lists[aiState.st.provider]) await readModels(aiState.st.provider);
        whoLabel(); draw();
      }));
      el.pop.querySelector('#ai-pick').addEventListener('change', async e => {
        const res = await postJSON('/api/assistant/select', { provider: aiState.st.provider, model: e.target.value });
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
    if (!lists[aiState.st.provider]) { await readModels(aiState.st.provider); if (!el.pop.hidden) draw(); }
    const first = el.pop.querySelector('button');
    if (first) first.focus();
  }

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
    rows.clear(); aiState.seen = 0; aiState.autoFrom = Infinity;
    const text = el.body.querySelector('#ai-text');
    el.body.querySelector('#ai-compose').addEventListener('submit', e => { e.preventDefault(); send(text.value); });
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(text.value); } });
    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; costSoon(); });
    el.body.querySelector('#ai-stop').addEventListener('click', () => (aiState.st.demo ? demoStop() : postJSON('/api/assistant/stop', { thread: threadId() }).then(poll)));
    el.body.querySelector('#ai-attach').addEventListener('click', async () => {
      if (aiState.st.demo) { toast('The online demo can’t read photos. With your own AI connected it can.', 'info'); return; }
      const got = await pickPhoto(false);
      if (got) { aiState.photo = got; drawAttached(); text.focus(); }
    });
    drawAttached();
    if (!aiState.wasReady) aiState.wasReady = true;
    if (aiState.st.demo) { demoPaint(); greet(); } else poll(true);
    drawIdeas();
    costSoon(0);
    text.focus({ preventScroll: true });
  }

function drawIdeas() {
    const host = el.body.querySelector('#ai-ideas');
    if (!host) return;
    const log = el.body.querySelector('#ai-log');
    const empty = !log || !log.querySelector('.ai-msg, .ai-step');
    const list = (showIdeas() && empty) || aiState.lastTrouble ? ideas() : [];
    const shown = aiState.lastTrouble && !(showIdeas() && empty) ? list.slice(0, 1) : list;
    host.hidden = !shown.length;
    host.innerHTML = shown.map(([label], i) => `<button type="button" class="ai-idea" data-i="${i}">${esc(label)}</button>`).join('');
    host.querySelectorAll('.ai-idea').forEach(b => b.addEventListener('click', () => send(shown[+b.dataset.i][1])));
  }

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
      if (m.handoff && m.status === 'done' && m.n > aiState.autoFrom && !node.dataset.ran) {
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
    if (PHONE.matches && aiState.open) toggle(false);
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
async function poll(first) {
    stopPoll();
    if (!aiState.open || el.body.dataset.view !== 'chat' || aiState.st.demo) return;
    const body = await getJSON(`/api/assistant/thread?id=${encodeURIComponent(threadId())}&since=${aiState.seen}`).catch(() => null);
    if (el.body.dataset.view !== 'chat') return;
    if (body && body.messages) {
      paint(body.messages, body.busy);
      aiState.seen = body.seq;
      if (first && !body.messages.length) greet();
      if (body.busy) aiState.polling = setTimeout(poll, 600);
      else { drawIdeas(); costSoon(0); }
    }
  }

  /* Your message shows the moment you send it; the server's copy takes its place when it arrives. */
async function send(text, context, picture) {
    text = String(text || '').trim();
    const pic = picture || (aiState.photo && aiState.photo.data) || null;
    if (!text && !pic) return;
    if (!aiState.open) await toggle(true);
    if (!aiState.st || !aiState.st.ready) { showConnect(); return; }
    if (el.body.dataset.view !== 'chat') showChat();
    const box = el.body.querySelector('#ai-text');
    box.value = ''; box.style.height = 'auto';
    if (aiState.lastTrouble && text.includes(aiState.lastTrouble)) aiState.lastTrouble = '';
    el.body.querySelector('#ai-ideas').hidden = true;
    if (aiState.st.demo) return demoSend(text);
    aiState.photo = null; drawAttached();
    const shown = text || 'What do you see in this photo?';
    paint([{ n: -Date.now(), role: 'user', text: shown, sending: true, picture: !!pic, preview: pic }], true);
    const log = el.body.querySelector('#ai-log');
    log.scrollTop = log.scrollHeight;
    aiState.autoFrom = Math.min(aiState.autoFrom, aiState.seen);
    const res = await postJSON(api('/api/assistant/chat'), { thread: threadId(), text, context, picture: pic || undefined });
    if (!res.ok) {
      const pending = log.querySelector('.ai-msg.is-user.is-sending');
      if (pending) pending.remove();
      paint([], false);
      toast(res.body.error || 'The message was not sent', 'bad');
      box.value = text;
      return;
    }
    if (res.body && res.body.messages) { paint(res.body.messages, res.body.busy); aiState.seen = res.body.seq; }
    aiState.polling = setTimeout(poll, 500);
  }

  /* ---- conversations: kept on this computer, newest first ---- */

function newChat() {
    stopPoll();
    store.set(KEY, newId());
    demo.log = []; demo.n = 0;
    aiState.photo = null;
    showChat();
  }

function openChat(id) {
    store.set(KEY, id);
    showChat();
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
    if (aiState.st.demo) { Object.assign(aiState.st.watch, body); drawPage(); return; }
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
      if (aiState.st.demo) { toast('The online demo can’t read photos. With your own AI connected it can.', 'info'); return; }
      const got = await pickPhoto(true);
      if (!got) return;
      pic = got.data;
    }
    const ask = typeof f.ask === 'function' ? f.ask(typed) : f.ask;
    if (box) box.value = '';
    if (aiState.st.demo && id !== 'brief') { send(typed || f.title); return; }
    store.set(KEY, newId());
    if (!aiState.open) await toggle(true); else showChat();
    send(ask, null, pic);
  }

function wirePage() {
    const host = document.getElementById('ai-page');
    if (!host) return;
    const post = async body => {
      if (aiState.st.demo) { if (body.mode) aiState.st.mode = body.mode; return; }
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
        if (aiState.st.demo) { toast('Check now needs a real printer’s camera. Demo printers have none.', 'info'); return; }
        now_.disabled = true;
        now_.querySelector('span').textContent = 'Looking…';
        const res = await postJSON(api('/api/assistant/watch/now'), {});
        now_.disabled = false;
        if (res.ok) { aiState.st.watch = res.body.watch; drawPage(); toast(`Print watch: ${res.body.why || res.body.verdict}`, res.body.verdict === 'failed' ? 'bad' : res.body.verdict === 'worry' ? 'warn' : 'ok'); }
        else { now_.querySelector('span').textContent = 'Check now'; toast(res.body.error || 'It couldn’t look just now', 'bad'); }
        return;
      }
      const f = t.closest('[data-feature]');
      if (f) { feature(f.dataset.feature, !!f.dataset.photo); return; }
      const go = t.closest('[data-ai-open]'), again = t.closest('[data-reask]');
      if (again) return post({ never_ask: aiState.st.never_ask.map(n => n.tool).filter(x => x !== again.dataset.reask) });
      if (!go) return;
      if (!aiState.open) await toggle(true);
      if (go.dataset.aiOpen === 'connect') showConnect(); else if (aiState.st.ready) showChat();
    });
  }
function decorate() {
    const on = !!(aiState.st && aiState.st.ready && !aiState.st.demo);
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
        if (text.startsWith('photo:')) { const f = FEATURES.find(x => x.id === text.slice(6)); const got = await pickPhoto(true); if (got) { store.set(KEY, newId()); if (!aiState.open) await toggle(true); else showChat(); send(f.ask, null, got.data); } return; }
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
    aiState.autoFrom = Math.min(aiState.autoFrom, demo.n);
    demoAdd({ role: 'user', text });
    demoPaint(true);
    await new Promise(r => setTimeout(r, 450));
    const t = text.toLowerCase(), s = await getJSON(api('/api/printer')).catch(() => ({})) || {};
    const temp = (t.match(/(\d{2,3})\s*(?:°|degrees|c\b)/) || t.match(/to\s+(\d{2,3})/) || [])[1];
    const head_ = ((t.match(/\bt([0-3])\b/) || [])[1]) || '0';
    const busyPrint = s.state === 'printing' || s.state === 'paused';
    const asks = aiState.st.mode === 'ask', advice = aiState.st.mode === 'advice';
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
      else if (aiState.st.mode === 'open') { const ok = await demoStep('Cancel the print', '/api/printer/control/cancel'); demoSay(ok ? 'Cancelled. The head is parked.' : 'The printer refused to cancel.'); }
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
function demoStop() { if (demo.wait) { demo.wait.m.status = 'declined'; demo.wait = null; } demoPaint(false); }
  return { applyProposal, build, decorate, demoPaint, demoSay, drawIdeas, goTo, openChat, openFile, poll, refresh,
    send, toggle, wirePage };
})();
