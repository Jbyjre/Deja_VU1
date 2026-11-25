/* assistant-part1.js: part 1 of 2 of assistant.js, the AI assistant's panel, chat, cards, print watch and
 * settings. Split out of the one closure assistant.js was (18 November 2026) so a session reads only the part it
 * needs. Loaded before assistant.js, after the scripts before it; it hands its names on through AssistantPart1.
 * Holds: BRIEF, FEATURES, GLOW_MS, I, ICON, IDEAS_FOR, KEY, KEY_NOTE, LOOK_NAME, OPENS, PHONE, PLACE, REDUCED,
 * SPOTS, SPOT_NAME, STATE_WORD, STATUS, aiState, brief, cardHTML, closePop, connectedPage, costCard, costSoon,
 * costText, count, deleteChat, demo, demoWatch, dollars, drawAttached, drawCost, drawPage, el, gauge, glow, greet,
 * head, hours, ideas, introPage, isDemo, limitsText, lists, live_, mark, modelField, modelValue, modesHTML, newId,
 * now, num, paysPerMessage, pickPhoto, planState, proposalHTML, proposals, provider, readModels, ready, rich,
 * rowHTML, rows, short, showHistory, showIdeas, shrink, stopPoll, svg, threadId, tile, watchCard, whoLabel,
 * wireModel, words
 */
const AssistantPart1 = (() => {
  /* State the parts of this file share (one object, so every file sees the same values). */
const aiState = {
    st: null,
    open: false,
    seen: 0,
    polling: null,
    live: {},
    lastTrouble: '',
    picked: null,
    wasReady: false,
    glowing: null,
    autoFrom: Infinity,
    photo: null,
    costTimer: 0
  };
const KEY = 'dejavu1.ai.thread';
const OPENS = 'dejavu1.ai.opens';
const IDEAS_FOR = 3;
const GLOW_MS = 60000;
const el = {};
// GET /api/assistant
// steps numbered above this arrived live, so their hand-offs (open a screen) run once
// a photo waiting to go with the next message: { data, name }
const rows = new Map();
const lists = {};
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
const ready = () => !!(aiState.st && aiState.st.ready);
const live_ = () => ready() && !aiState.st.demo;
const now = () => (aiState.st && (aiState.st.connections || []).find(c => c.id === aiState.st.provider)) || null;

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

  /* The one switch every AI touch in the app hangs on. */
function mark() {
    const on = ready();
    document.documentElement.classList.toggle('ai-on', on);
    el.launch.classList.toggle('is-quiet', !on);
    el.launch.setAttribute('aria-label', on ? 'Ask the assistant' : 'Set up an AI assistant (optional)');
    if (!on) {
      aiState.lastTrouble = '';
      clearTimeout(aiState.glowing);
      document.documentElement.classList.remove('ai-glow-on');
    }
  }

  /* The edge of the screen glows for a minute the first time an AI answers, then goes back to normal. */
function glow() {
    clearTimeout(aiState.glowing);
    document.documentElement.classList.remove('ai-glow-on');
    void el.glow.offsetWidth;                       // restart the animation if it was already running
    document.documentElement.classList.add('ai-glow-on');
    aiState.glowing = setTimeout(() => document.documentElement.classList.remove('ai-glow-on'), GLOW_MS);
  }

function head(view) {
    el.body.dataset.view = view;
    const chat = view === 'chat';
    el.back.hidden = chat || !ready();
    el.history.hidden = !chat || !ready() || !!aiState.st.demo;
    el.fresh.hidden = !chat || !ready();
    el.who.hidden = !chat || !ready() || !!aiState.st.demo;
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

const provider = id => ((aiState.st && aiState.st.providers) || []).find(p => p.id === id);

function planState(p) {
    if (aiState.st.demo) return '';
    if (p.kind === 'account') return p.ready ? 'Signed in' : p.signed_in ? 'Allow plan use' : '';
    if (!p.installed) return p.id === 'codex' ? 'Not installed' : 'Needs Claude Code';
    if (p.signed_in === false) return 'Sign in';
    return p.signed_in ? 'Signed in' : 'Installed';
  }

function tile(p) {
    const inUse = p.id === aiState.st.provider && aiState.st.ready;
    const joined = (aiState.st.connections || []).some(c => c.id === p.id);
    const state = inUse ? 'In use' : joined ? 'Connected' : (p.kind === 'cli' || p.kind === 'account') ? planState(p) : p.has_key ? 'Key saved' : '';
    return `<li><button type="button" class="ai-prov${inUse ? ' is-on' : ''}" data-id="${esc(p.id)}">
      <span class="ai-prov-name">${esc(p.kind === 'key' ? short(p.name) : p.name)}</span>
      <span class="ai-prov-state">${esc(state)}</span></button></li>`;
  }

const modesHTML = group => Object.entries(aiState.st.modes || {}).map(([id, text]) => {
    const [name, rest] = text.split(': ');
    return `<label class="ai-mode"><input type="radio" name="${group}" value="${esc(id)}" ${id === aiState.st.mode ? 'checked' : ''}><span><b>${esc(name)}${id === aiState.st.default_mode ? ' <i>the usual choice</i>' : ''}</b>${esc(rest || '')}</span></label>`;
  }).join('');
const limitsText = () => `These limits hold whatever you choose: heater limits, the printer’s own size, no moves before homing, the nozzle kept ${esc(String((aiState.st.limits || {}).z_floor_mm || 2))} mm off the bed, and a print starts only from Confirm Print.`;
  // Said once, where keys are offered (the owner's request, 12 November).
const KEY_NOTE = 'Deja Vu1 runs entirely on your computer: no account, no cloud of ours and nothing opened to the internet, so there is nothing of ours online for a key to leak from. Keys are discouraged only as a precaution, because a key works like a password that can spend money wherever it ends up. A plan or a model on this computer means there is no key at all.';

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

  /* ---- who answers: the AI and its model, behind one chip in the header ---- */

function whoLabel() {
    const c = now();
    el.who.innerHTML = c ? `<span>${esc(short(c.name))}</span><small>${esc(c.model || 'usual model')}</small>${I.chevron}` : '';
    el.who.setAttribute('aria-label', c ? `Answering: ${c.name}, ${c.model || 'its usual model'}. Change` : 'Choose an AI');
  }
function closePop() { el.pop.hidden = true; el.who.setAttribute('aria-expanded', 'false'); }

  /* ---- chat ------------------------------------------------------------- */

function ideas() {
    const out = [], s = aiState.live || {};
    if (aiState.lastTrouble) out.push(['Explain the last warning', `Explain this message from Deja Vu1 in plain words, and what to try: "${aiState.lastTrouble}"`]);
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

function drawAttached() {
    const host = el.body.querySelector('#ai-attached');
    if (!host) return;
    host.hidden = !aiState.photo;
    host.innerHTML = aiState.photo ? `<img src="${esc(aiState.photo.data)}" alt=""><span>Photo attached</span><button type="button" class="ai-link" id="ai-unattach">Remove</button>` : '';
    const rm = host.querySelector('#ai-unattach');
    if (rm) rm.addEventListener('click', () => { aiState.photo = null; drawAttached(); });
  }

function greet() {
    const log = el.body.querySelector('#ai-log');
    if (!log || log.querySelector('.ai-msg, .ai-step, .ai-hello')) return;
    const first = showIdeas();
    log.insertAdjacentHTML('beforeend', `<div class="ai-hello"><span class="ai-hello-mark" aria-hidden="true">${I.spark}</span>
      <p>${first ? 'Ask in your own words. I can run the printer, read your files and history, look through the camera, make and slice parts, and set up print watch and automations.' : 'What can I do for you?'}</p></div>`);
  }

const dollars = n => '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
const brief = n => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : count(n));
const paysPerMessage = () => aiState.st && aiState.st.price && ['tokens', 'unknown'].includes(aiState.st.price.charge);

  /* Before sending: what the next answer is likely to read and cost. Shown only where a message costs money. */
function costSoon(wait = 450) {
    clearTimeout(aiState.costTimer);
    aiState.costTimer = setTimeout(drawCost, wait);
  }
async function drawCost() {
    const host = el.body.querySelector('#ai-cost'), box = el.body.querySelector('#ai-text');
    if (!host || !aiState.st || aiState.st.demo || !aiState.st.ready || !paysPerMessage()) { if (host) host.textContent = ''; return; }
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
const PLACE = { printers: 'All printers', printer: 'the Printer screen', files: 'the file Library', slice: 'the Slicer', queue: 'the queue', filament: 'Filament', maintenance: 'Maintenance', settings: 'Settings', automations: 'Automations', overview: 'Overview', ai: 'the AI screen', prefs: 'Settings › Look & layout', desk: 'the Farm screen', layers: 'Layer heights', studio: 'Photo studio', sandbox: 'the practice printers', games: 'Games', models: 'Models', readings: 'the printer\u2019s readings', camera: 'the camera and time-lapses', history: 'the printer\u2019s history' };
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
    if (c.kind === 'error') {
      // explain_error (backend/ai_assistant_part2.py _card): Snapmaker's own words for a code, its video, its guide. errorhelp.js draws the video.
      const kind = { Notice: 'notice', Warning: 'warning', Error: 'error' }[c.level] || 'notice';
      const effect = { paused: 'The print is paused', stopped: 'The print was stopped', continues: 'The print carries on' }[c.effect] || '';
      const guide = c.guide && /^https:\/\/wiki\.snapmaker\.com\//.test(c.guide.url || '') ? c.guide : null;
      return `<div class="ai-card eh-chat"><div class="eh-top"><span class="eh-level is-${kind}">${esc(c.level || 'Code')}</span>${effect ? `<span class="eh-effect">${esc(effect)}</span>` : ''}</div>
        <p class="ai-card-h"><b class="eh-chat-title">${esc(c.title || (c.known ? 'Printer error' : 'Not in Snapmaker\'s table'))}</b> <code>${esc(c.code)}</code></p>
        ${c.details ? `<p>${esc(c.details)}</p>` : ''}${c.video && window.ErrorHelp ? ErrorHelp.video(c.video.id, c.video.title, c.video.start) : ''}
        <div class="ai-approve"><button class="btn primary small" type="button" data-errhelp="${esc(c.code)}">Open it in full</button>${guide ? `<a class="btn small" href="${esc(guide.url)}" target="_blank" rel="noopener noreferrer">Snapmaker's guide</a>` : ''}</div></div>`;
    }
    return '';
  }

function rowHTML(m) {
    if (m.role === 'user') return `<div class="ai-msg is-user${m.sending ? ' is-sending' : ''}">${m.picture ? `<span class="ai-msg-photo">${m.preview ? `<img src="${esc(m.preview)}" alt="">` : ''}${I.camera}<span>Photo</span></span>` : ''}<p>${esc(m.text)}</p>${m.sending ? '<span class="sr-only">Sending</span>' : ''}</div>`;
    if (m.role === 'assistant') return `<div class="ai-msg is-assistant">${rich(m.text)}</div>`;
    if (m.role === 'error' || m.role === 'note') {
      // After an error from the AI in use, the other AIs you have connected are one press away (the server lists them).
      const again = m.role === 'error' && Array.isArray(m.alternatives) && m.alternatives.length
        ? `<p class="ai-again">${m.alternatives.map(a => `<button class="btn small" type="button" data-retry="${esc(a.id)}">Ask again with ${esc(a.name)}</button>`).join(' ')}</p>` : '';
      return `<div class="ai-msg is-${m.role}" role="${m.role === 'error' ? 'alert' : 'status'}"><p>${esc(m.text)}</p>${again}</div>`;
    }
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

const proposals = new Map();

function stopPoll() { clearTimeout(aiState.polling); aiState.polling = null; }

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

let watchCam = null;
/* The one live player the print watch card shows: made once, moved into each new drawing of the page. */
function watchCamHost() {
    if (!watchCam) {
      watchCam = document.createElement('div');
      watchCam.className = 'pcam';
      watchCam.dataset.cam = 'ai';
      if (window.PrinterPage && PrinterPage.attachCam) PrinterPage.attachCam(watchCam);
    }
    return watchCam;
  }

function drawPage() {
    const host = document.getElementById('ai-page');
    if (!host || host.closest('[hidden]')) return;
    if (!aiState.st) { host.innerHTML = '<section class="card liquid-glass"><div class="card-head"><div><h2>AI assistant</h2><p class="card-sub">Switched off. Turn it on in Settings, Optional extras.</p></div></div></section>'; return; }
    const keepCam = watchCam && watchCam.parentElement;
    if (keepCam) watchCam.remove();                              // the live picture outlives the redraw: it is put back below
    const keepOpen = [...host.querySelectorAll('details[open]')].map(d => d.id);
    const focus = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id : '';
    const typed = [...host.querySelectorAll('textarea[id^="ai-fi-"]')].map(t => [t.id, t.value]);
    host.innerHTML = ready() ? connectedPage() : introPage();
    const slot = host.querySelector('#ai-watch-cam');
    if (slot) { slot.append(watchCamHost()); if (window.PrinterPage && PrinterPage.syncCams) PrinterPage.syncCams(); }
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
        <details class="card liquid-glass ai-mini" id="ai-may"><summary><h2>How much it may do</h2><span>${esc(((aiState.st.modes || {})[aiState.st.mode] || '').split(':')[0])}</span></summary>
          <div class="ai-modes">${modesHTML('ai-mode-page')}</div>
          ${(aiState.st.never_ask || []).length ? `<p class="ai-hint ai-never">Never asks about: ${aiState.st.never_ask.map(n => `<button type="button" class="ai-chip" data-reask="${esc(n.tool)}" aria-label="Ask again about: ${esc(n.label)}">${esc(n.label)} <span aria-hidden="true">×</span></button>`).join('')}</p>` : ''}
          <p class="ai-hint">${limitsText()}</p></details>
        ${paysPerMessage() ? costCard() : ''}
        <details class="card liquid-glass ai-mini" id="ai-private"><summary><h2>Privacy</h2><span>What leaves this computer</span></summary>
          <p class="ai-hint">The AI you choose receives what you type, the printer’s readings, the results of its steps and any photo you attach. A camera picture goes only when it looks through the camera. Conversations are saved on this computer only. A model on this computer keeps everything at home.</p>
          <p class="ai-hint">${(aiState.st.tools || []).length || 'A fixed set of'} named steps are its only way to reach the printer, and every one passes the same checks as the buttons.</p></details>
      </section>`;
  }

function costCard() {
    const p = aiState.st.price || {}, c = now();
    const where = { service: 'the price the service lists', yours: 'the price you entered' }[p.from] || '';
    const state = p.charge === 'tokens' ? `${esc(c.model || c.name)}: $${esc(p.in)} per million tokens in, $${esc(p.out)} out, from ${where}.`
      : `${esc(c.model || c.name)}: the service lists no price, so no cost is shown. Type it from the service’s pricing page.`;
    return `<details class="card liquid-glass ai-mini" id="ai-cost-card"><summary><h2>Cost and limit</h2><span>${aiState.st.cap_usd ? `Limit $${esc(aiState.st.cap_usd)}` : 'No limit'}</span></summary>
      <p class="ai-hint">${state}</p>
      <form class="ai-budget" id="ai-budget">
        <div class="ai-budget-row"><label class="ai-field"><span>Price in <i>$ per million tokens</i></span><input id="ai-price-in" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${p.from === 'yours' ? esc(p.in) : ''}" placeholder="${p.from === 'service' ? esc(p.in) : 'From its pricing page'}"></label>
        <label class="ai-field"><span>Price out <i>$ per million tokens</i></span><input id="ai-price-out" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${p.from === 'yours' ? esc(p.out) : ''}" placeholder="${p.from === 'service' ? esc(p.out) : ''}"></label></div>
        <label class="ai-field"><span>Stop a request after <i>$, empty for no limit</i></span><input id="ai-cap" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${aiState.st.cap_usd ? esc(aiState.st.cap_usd) : ''}" placeholder="No limit"></label>
        <div class="ai-actions"><button class="btn primary" type="submit">Save</button>${p.from === 'yours' ? '<button class="btn" type="button" id="ai-price-clear">Forget my price</button>' : ''}</div>
      </form></details>`;
  }

  /* ---- print watch: the headline feature -------------------------------- */

function demoWatch() {
    const w = (aiState.st && aiState.st.watch && aiState.st.watch.looks_known) ? aiState.st.watch : {};
    return Object.assign({ on: true, minutes: 10, pause: true, first_layer: true, last_layers: true, compare: true, confirm: true, notify: true,
      policy: { cosmetic: 'note', fixable: 'notify', failing: 'pause', crash: 'decide' }, lessons: [],
      severities: ['cosmetic', 'fixable', 'failing', 'crash'], actions: ['note', 'notify', 'pause', 'decide'],
      looks: ['spaghetti', 'detached', 'blob', 'layer_shift'], sensitivity: 'normal', notes: '', minutes_range: [2, 60],
      looks_known: { spaghetti: 'loose strands like spaghetti, or plastic laid in mid-air', detached: 'a part knocked loose, moved or toppled on the bed', blob: 'a large blob of plastic building up around a nozzle', layer_shift: 'layers suddenly offset sideways', warping: 'corners or edges lifting off the bed', stringing: 'fine strings between parts' },
      log: [{ id: 'demo000001', at: Date.now() / 1000 - 240, verdict: 'ok', severity: 'none', why: 'Clean walls, both parts still stuck down.', printer_name: 'Demo printer 1', reason: 'every 10 minutes', confidence: 0.9, action: 'none',
          reasoning: 'Compared with the picture ten minutes ago the walls are taller and straight, and both parts sit where they started. No strings or blobs near the nozzles.' },
        { id: 'demo000002', at: Date.now() / 1000 - 840, verdict: 'worry', severity: 'cosmetic', why: 'Thin strings between the two towers.', printer_name: 'Demo printer 1', reason: 'every 10 minutes', confidence: 0.7, action: 'note',
          reasoning: 'A few fine strings cross the gap between the towers. They are light and the walls under them are clean, so the parts will be fine after a quick clean-up.', action_why: 'Your policy for a cosmetic flaw: note it.' },
        { id: 'demo000003', at: Date.now() / 1000 - 1500, verdict: 'ok', severity: 'none', why: 'The first layer is down evenly.', printer_name: 'Demo printer 1', reason: 'first layers', confidence: 0.85, action: 'none',
          reasoning: 'The first lines are flat and joined, with no gaps and no corners lifting.' }],
      usage: {}, pictures: [], next_in_s: {} }, w);
  }

const SEV_NAME = { cosmetic: 'Cosmetic flaw', fixable: 'Fixable problem', failing: 'Failing print', crash: 'Crash risk' };
const SEV_HINT = { cosmetic: 'Light strings, a small blemish', fixable: 'A corner starting to lift', failing: 'Spaghetti, a part knocked loose', crash: 'Plastic around a nozzle, a head dragging' };
const ACT_NAME = { note: 'Note it', notify: 'Send an alert', pause: 'Pause and ask', decide: 'Let the AI decide' };
const LOOK_NAME = { spaghetti: 'Spaghetti', detached: 'Knocked loose', blob: 'Nozzle blob', layer_shift: 'Layer shift', warping: 'Warping', stringing: 'Stringing' };
function watchCard() {
    const w = Object.assign({ looks: [], looks_known: {}, log: [], usage: {}, pictures: [], next_in_s: {}, minutes_range: [2, 60] }, aiState.st.watch || {});
    const when = t => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const word = { ok: 'Looks fine', worry: 'Worth a look', failed: 'Looks failed', skipped: 'Not checked' };
    const last = (w.log || [])[0];
    // What it last saw, kept as a small picture over the live view (a real printer only: the demo has no stored pictures).
    const saw = last && (w.pictures || []).includes(last.printer) && !aiState.st.demo
      ? `<img class="ai-watch-saw" alt="What print watch saw at ${esc(when(last.at))}" title="What it saw at ${esc(when(last.at))}" src="/api/assistant/watch/picture?printer=${encodeURIComponent(last.printer)}&t=${Math.round(last.at)}">` : '';
    const lookNames = (w.looks || []).map(k => LOOK_NAME[k] || k);
    const next = Object.values(w.next_in_s || {})[0];
    const state = !w.on ? 'Off' : next != null ? `Watching · next look in ${Math.max(1, Math.round(next / 60))} min` : `On · every ${w.minutes} min while printing`;
    const minutes = [2, 5, 10, 15, 30, 60].filter(m => m >= w.minutes_range[0] && m <= w.minutes_range[1]);
    const pol = Object.assign({ cosmetic: 'note', fixable: 'note', failing: 'note', crash: 'note' }, w.policy || {});
    const acts = Object.values(pol);
    const log = (w.log || []).slice(0, 8).map(watchLook).join('');
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
            w.last_layers && 'Last layers',
            acts.includes('pause') ? (w.confirm ? 'Looks twice, then pauses' : 'Pauses a failure') : !acts.includes('decide') && 'Tells you, never pauses',
            acts.includes('decide') && 'The AI decides some', acts.some(a => a === 'notify' || a === 'decide') && 'Sends alerts',
            w.sensitivity !== 'normal' && `${w.sensitivity[0].toUpperCase() + w.sensitivity.slice(1)}`].filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          <div class="ai-actions"><button class="btn" type="button" id="ai-watch-now">${I.camera}<span>Check now</span></button></div>
          ${aiState.st.demo ? '<p class="ai-hint">In the online demo these settings are a preview: print watch needs a real printer’s camera.</p>' : ''}
        </div>
        <figure class="ai-watch-last">
          <div class="ai-watch-view" id="ai-watch-view">
            <div class="ai-watch-cam" id="ai-watch-cam"></div>
            <svg class="ai-brackets" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden="true"><path d="M5 15V5h10M85 5h10v10M95 60v10H85M15 70H5V60" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg>
            <span class="ai-scan" aria-hidden="true"></span>
            ${lookNames.length ? `<ul class="ai-watch-for" aria-label="What it looks for">${lookNames.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            ${saw}
            <div class="ai-watch-overlay" aria-live="polite">${last ? `<span class="ai-pill is-${esc(last.verdict)}">${esc(word[last.verdict] || last.verdict)}</span> <span>${esc(last.why || '')}</span>` : '<span>Its first look will show here, over the live picture.</span>'}</div>
          </div>
          <figcaption>${esc(state)}${last ? ` · last look ${esc(when(last.at))}` : ''}</figcaption></figure>
      </div>
      <details class="ai-watch-more" id="ai-watch-more"><summary>Customize${I.chevron}</summary>
        <div class="ai-watch-grid">
          <div><h3>How often</h3><div class="ai-seg" role="radiogroup" aria-label="How often">${minutes.map(m => `<label><input type="radio" name="ai-watch-min" value="${m}"${m === w.minutes ? ' checked' : ''}><span>${m} min</span></label>`).join('')}</div>
            <h3>How readily it worries</h3><div class="ai-seg" role="radiogroup" aria-label="Sensitivity">${['relaxed', 'normal', 'careful'].map(k => `<label><input type="radio" name="ai-watch-sense" value="${k}"${k === w.sensitivity ? ' checked' : ''}><span>${k[0].toUpperCase() + k.slice(1)}</span></label>`).join('')}</div>
            <h3>What to look for</h3><div class="ai-looks">${Object.keys(w.looks_known || {}).map(k => `<label class="ai-look"><input type="checkbox" name="ai-watch-look" value="${esc(k)}"${(w.looks || []).includes(k) ? ' checked' : ''}><span>${esc(LOOK_NAME[k] || k)}</span></label>`).join('')}</div></div>
          <div>${toggle('ai-watch-first', w.first_layer, 'Check the first layers', 'An extra look early on, where most prints fail')}
            ${toggle('ai-watch-compare', w.compare, 'Compare with the last picture', 'Spots a print that stopped growing: a clog or an empty spool')}
            ${toggle('ai-watch-last', w.last_layers, 'Check the last layers', 'One look near the end, where a tall print can topple')}
            ${toggle('ai-watch-confirm', w.confirm, 'Look twice before pausing', 'A second picture must agree, so one odd frame never stops a print')}</div>
        </div>
        <h3>What it does about each kind of problem</h3>
        <div class="ai-pol">${['cosmetic', 'fixable', 'failing', 'crash'].map(k => `<label class="ai-pol-row"><span><b>${esc(SEV_NAME[k])}</b><small>${esc(SEV_HINT[k])}</small></span>
          <select name="ai-watch-pol" data-sev="${k}">${['note', 'notify', 'pause', 'decide'].map(a => `<option value="${a}"${pol[k] === a ? ' selected' : ''}>${esc(ACT_NAME[a])}</option>`).join('')}</select></label>`).join('')}</div>
        <p class="ai-hint">Alerts go through the channels in Settings, Alerts. A pause happens only while printing, and watch-only mode and the safety checks still apply. Print watch can pause a print but never cancels or starts one. When the AI decides, it says why in each look.</p>
        <label class="ai-field"><span>Notes for it <i>about your setup, up to 300 characters</i></span><textarea id="ai-watch-notes" rows="2" maxlength="300" placeholder="The mark on the left of the sheet is old; ignore it.">${esc(w.notes || '')}</textarea></label>
      </details>
      ${log ? `<details class="ai-watch-more" id="ai-watch-history"><summary>Recent looks${I.chevron}</summary>
        <p class="ai-hint">Mark a look right or wrong, or tell it to ignore things like it. The next looks get your marks as examples.</p>
        <ul class="ai-watch-log">${log}</ul>
        ${u.checks ? `<p class="ai-hint">${u.checks} look${u.checks === 1 ? '' : 's'} so far${u.cost_usd ? `, about $${u.cost_usd.toFixed(u.cost_usd < 0.01 ? 4 : 2)}` : ''}.</p>` : ''}</details>` : ''}
      <details class="ai-watch-more" id="ai-watch-rehearse"><summary>Try it on a recorded time-lapse${I.chevron}</summary>
        <p class="ai-hint">Pick a time-lapse video of an earlier print. Your browser takes frames from it and your AI judges each one as if the print were running, with the policy above. Nothing is paused or sent. The looks show under Recent looks as rehearsals, so you can mark them right or wrong. Each frame costs the same as one look while printing.</p>
        <div class="ai-actions ai-rehearse"><label class="ai-rehearse-n"><span>Frames</span><select id="ai-rehearse-n">${[6, 12, 24].map(n => `<option value="${n}"${n === 12 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="btn" id="ai-rehearse-pick">${I.camera}<span>Choose a video</span><input class="sr-only" type="file" id="ai-rehearse-file" accept="video/*"></label></div>
        <p class="ai-rehearse-state" id="ai-rehearse-state" aria-live="polite"></p></details>
    </section>`;
  }

const DID = { note: 'Noted it', notify: 'Sent you an alert', pause: 'Paused the print' };
const WOULD = { note: 'Would have noted it', notify: 'Would have sent an alert', pause: 'Would have paused' };
function watchLook(e) {
    const when = new Date(e.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const word = { ok: 'Looks fine', worry: 'Worth a look', failed: 'Looks failed', skipped: 'Not checked' };
    const did = !e.action || e.action === 'none' ? '' : e.rehearsal ? WOULD[e.action]
      : e.action === 'pause' && !e.paused ? 'Left it running' : e.action === 'notify' && e.alerted === false ? 'The alert couldn’t be sent' : DID[e.action];
    const pic = e.picture && e.id && !aiState.st.demo
      ? `<img class="ai-watch-thumb" loading="lazy" alt="What it saw at ${esc(when)}" src="/api/assistant/watch/picture?look=${encodeURIComponent(e.id)}">` : '';
    const why = [e.reasoning, e.action_why, e.confidence != null ? `How sure: ${Math.round(e.confidence * 100)}%` : ''].filter(Boolean);
    const judge = e.id && e.verdict !== 'skipped' ? `<div class="ai-watch-judge" role="group" aria-label="Was this look right?">${[['right', 'Correct'], ['wrong', 'Wrong'], ['ignore', 'Ignore things like this']]
      .map(([k, label]) => `<button type="button" class="chip-btn" data-judge="${esc(e.id)}" data-j="${k}" aria-pressed="${e.judged === k}">${esc(label)}</button>`).join('')}</div>` : '';
    return `<li class="ai-watch-${esc(e.verdict)}${pic ? ' has-pic' : ''}">${pic}<div>
      <b>${esc(word[e.verdict] || e.verdict)}</b>${e.severity && SEV_NAME[e.severity] ? ` <em class="ai-sev is-${esc(e.severity)}">${esc(SEV_NAME[e.severity])}</em>` : ''}${e.rehearsal ? ' <em class="ai-sev">Rehearsal</em>' : ''}
      <span>${esc(e.printer_name || e.printer || '')} · ${esc(when)}${e.reason ? ` · ${esc(e.reason)}` : ''}</span><p>${esc(e.why || '')}</p>
      ${did ? `<p class="ai-watch-did">${esc(did)}</p>` : ''}
      ${e.paused && !e.rehearsal ? '<p class="ai-watch-did">The print is paused. <a href="#/printer">Resume or cancel it on the Printer screen.</a></p>' : ''}
      ${why.length ? `<details class="ai-watch-why"><summary>Why</summary>${why.map(t => `<p>${esc(t)}</p>`).join('')}</details>` : ''}
      ${judge}</div></li>`;
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

  /* ---- the online demo's scripted helper ----------------------------------
   * No AI runs on the public demo page. This reads a few plain requests and sends the same simulated
   * commands the demo's own buttons send, so the twin moves. It says what it is. */
const demo = { log: [], n: 0, wait: null };
  return { FEATURES, I, ICON, KEY, KEY_NOTE, OPENS, PHONE, REDUCED, SPOTS, aiState, closePop, costSoon, deleteChat,
    demo, demoWatch, drawAttached, drawPage, el, glow, greet, head, ideas, isDemo, lists, mark, modelField,
    modelValue, newId, pickPhoto, planState, proposals, provider, readModels, ready, rowHTML, rows, short,
    showHistory, showIdeas, shrink, stopPoll, threadId, tile, whoLabel, wireModel };
})();
