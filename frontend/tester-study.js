/* tester-study.js: the test round, inside the app.
 *
 * The tester picks a round of 1, 2 or 3 days (3 unless they change it). A small chip beside "Something felt off" says which
 * day it is. When the days are up, the app asks the tester to answer the questions (52, in 12 short sections, saved as they
 * type, any of them skippable) and then to save the report. All of it is kept on this computer by the server
 * (backend/tester_study.py); nothing is sent anywhere. It runs only while the recorder (tester.js) runs, so never in the
 * online demo.
 *
 * The tester's own panels carry the class tester-ui, which tester.js leaves out of what it records.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const json = { 'Content-Type': 'application/json' };
  const LENGTHS = [1, 2, 3];
  let plan = null, skew = 0, chip = null, hub = null, panel = null, panelKind = '', endShown = false, welcomeDone = false;
  let sections = null, choices = {}, hints = { auto: {}, saw: {} }, local = {}, step = 0, stepSince = 0, saveTimer = 0, savedName = '';
  const dirty = new Set();

  const ready = () => !!(window.Tester && Tester.wanted());
  const now = () => Date.now() + skew;
  const event = (fields) => { if (window.Tester) Tester.event('study', fields); };

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function postJSON(url, body) {
    const res = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  /* ---- the plan ---------------------------------------------------------------------------------- */

  function take(next) {
    plan = next;
    skew = next.now_ms - Date.now();
    if (plan.status === 'running' && now() >= plan.ends_ms) plan = Object.assign({}, plan, { status: 'due' });
    paint();
  }

  async function load() {
    if (!ready()) { clear(); return; }
    try { take(await getJSON('/api/tester/study')); } catch (_) { /* the server is restarting, or Tester mode is off for this run */ }
  }

  function leftText() {
    const hours = Math.max(0, (plan.ends_ms - now()) / 3600000);
    if (hours < 1) return 'less than an hour left';
    if (hours < 48) return 'about ' + Math.round(hours) + ' hour' + (Math.round(hours) === 1 ? '' : 's') + ' left';
    return 'about ' + Math.round(hours / 24) + ' days left';
  }

  function dayText() {
    if (plan.status === 'finished') return 'Test finished';
    if (plan.status === 'due') return 'The test round is over';
    const day = Math.max(1, Math.min(plan.length_days, Math.floor((now() - plan.started_ms) / 86400000) + 1));
    return 'Day ' + day + ' of ' + plan.length_days;
  }

  function progress() {
    const total = plan.length_days * 86400000;
    return Math.max(0, Math.min(100, Math.round(((now() - plan.started_ms) / total) * 100)));
  }

  function clear() {
    if (chip) { chip.remove(); chip = null; }
    if (hub) closeHub();
    if (panel) closePanel();
  }

  function paint() {
    if (!plan || !ready()) { clear(); return; }
    paintChip();
    paintCard();
    if (hub) renderHub();
    maybePrompt();
  }

  function paintChip() {
    const dock = $('tester-dock');
    if (!dock) { if (chip) { chip.remove(); chip = null; } return; }
    if (!chip || !chip.isConnected) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'tester-chip';
      chip.className = 'tester-chip tester-ui';
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.addEventListener('click', toggleHub);
      dock.insertBefore(chip, dock.firstChild);
    }
    chip.textContent = plan.status === 'running' ? 'Test ' + dayText().toLowerCase() : plan.status === 'due' ? 'Answer the questions' : 'Test finished';
    chip.classList.toggle('is-due', plan.status === 'due');
    chip.title = plan.status === 'running' ? 'Your test round: ' + leftText() : 'Your test round';
  }

  function paintCard() {
    const box = $('tester-plan');
    if (!box) return;
    box.hidden = false;
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
    set('tester-plan-title', dayText());
    set('tester-plan-sub', plan.status === 'running' ? leftText() + ' (ends ' + plan.ends.replace('T', ' ').slice(0, 16) + ')'
      : plan.status === 'due' ? 'Time is up. Answer the questions, then save your report.' : 'Thank you. You can still answer more or save the report again.');
    const fill = $('tester-plan-fill');
    if (fill) fill.style.width = (plan.status === 'running' ? progress() : 100) + '%';
    set('tester-plan-q', plan.answered + ' of ' + plan.total + ' questions answered' + (plan.last_export ? '. Report last saved ' + plan.last_export.replace('T', ' ').slice(0, 16) + '.' : '.'));
    box.querySelectorAll('[data-length]').forEach(b => b.setAttribute('aria-pressed', String(+b.getAttribute('data-length') === plan.length_days)));
  }

  async function setLength(days) {
    if (!plan || days === plan.length_days) return;
    try {
      take(await postJSON('/api/tester/study', { length_days: days }));
      event({ ev: 'length', days });
    } catch (_) { toastSafe('The test length could not be saved. Try again in a moment.', 'bad'); }
  }

  const toastSafe = (message, kind) => { if (typeof toast === 'function') toast(message, kind || 'info', 4200); };

  /* ---- the hub: the chip's popover ------------------------------------------------------------------ */

  function lengthButtons() {
    return '<div class="tester-lengths" role="group" aria-label="How many days to test">' + LENGTHS.map(n =>
      '<button type="button" class="tester-length" data-length="' + n + '" aria-pressed="' + (plan && plan.length_days === n) + '">' + n + (n === 1 ? ' day' : ' days') + '</button>').join('') + '</div>';
  }

  function renderHub() {
    if (!hub || !plan) return;
    const running = plan.status === 'running';
    hub.innerHTML = '<h2 class="tester-hub-title">Your test round</h2>'
      + '<p class="tester-hub-status"><b>' + esc(dayText()) + '</b>' + (running ? ' &middot; ' + esc(leftText()) : '') + '</p>'
      + '<div class="tester-bar" aria-hidden="true"><i style="width:' + (running ? progress() : 100) + '%"></i></div>'
      + '<p class="tester-hub-label">Test for</p>' + lengthButtons()
      + '<p class="tester-hub-q">' + plan.answered + ' of ' + plan.total + ' questions answered</p>'
      + '<div class="tester-hub-row"><button type="button" class="btn primary" data-hub="answer">' + (plan.answered ? 'Keep answering' : 'Answer the questions') + '</button>'
      + '<button type="button" class="btn" data-hub="save">Save tester report</button></div>'
      + '<button type="button" class="tester-link" data-hub="settings">What is recorded, and how to delete it</button>';
  }

  function openHub() {
    if (!plan || hub) return;
    closePanel();
    hub = document.createElement('div');
    hub.id = 'tester-hub';
    hub.className = 'tester-hub liquid-glass deep tester-ui';
    hub.setAttribute('role', 'dialog');
    hub.setAttribute('aria-label', 'Your test round');
    document.body.appendChild(hub);
    renderHub();
    hub.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeHub(); if (chip) chip.focus(); } });
    const first = hub.querySelector('button');
    if (first) first.focus();
  }

  function closeHub() { if (hub) { hub.remove(); hub = null; } }
  function toggleHub() { if (hub) closeHub(); else openHub(); }

  /* ---- the welcome and the end-of-test prompts ----------------------------------------------------- */

  function setupOpen() {
    const dialog = $('setup-dialog');
    return !!(dialog && dialog.open) || document.documentElement.classList.contains('guide-open');
  }

  function showPanel(kind) {
    if (panel || !plan) return;
    panelKind = kind;
    panel = document.createElement('div');
    panel.id = 'tester-panel';
    panel.className = 'tester-panel liquid-glass deep tester-ui';
    panel.setAttribute('role', 'dialog');
    if (kind === 'welcome') {
      panel.setAttribute('aria-label', 'You are testing Deja Vu1');
      panel.innerHTML = '<h2>You are testing Deja Vu1</h2>'
        + '<p>This tester build keeps a report of how the app behaves while you use it: what you press, errors, slow spots and what you try. It stays on this computer and is never sent anywhere. '
        + 'When your test round ends, the app asks you some questions and you send one file back. If something feels off, the <b>Something felt off</b> button is always on screen.</p>'
        + '<p class="tester-hub-label">How long will you test?</p>' + lengthButtons()
        + '<div class="tester-panel-row"><button type="button" class="btn" data-panel="more">What is recorded</button><button type="button" class="btn primary" data-panel="start">Start testing</button></div>';
      event({ ev: 'welcome_shown' });
    } else {
      panel.setAttribute('aria-label', 'The test round is over');
      panel.innerHTML = '<h2>Your test round is over</h2>'
        + '<p>Thank you for testing. Two last steps: answer the questions (about ten minutes, you can skip any and it saves as you go), then save your report and send it back.</p>'
        + '<div class="tester-panel-row"><button type="button" class="btn" data-panel="later">Later</button><button type="button" class="btn primary" data-panel="answer">Answer the questions</button></div>';
      event({ ev: 'end_prompt' });
    }
    document.body.appendChild(panel);
    const go = panel.querySelector('.btn.primary');
    if (go) go.focus({ preventScroll: true });
  }

  function closePanel() { if (panel) { panel.remove(); panel = null; panelKind = ''; } }

  function maybePrompt() {
    if (!plan || panel || setupOpen() || (document.getElementById('tester-q') || {}).open) return;
    if (!plan.welcomed && !welcomeDone) showPanel('welcome');
    else if (plan.status === 'due' && !endShown) { endShown = true; showPanel('end'); }
  }

  /* ---- the questions --------------------------------------------------------------------------------- */

  async function openQuestions() {
    const dialog = $('tester-q');
    if (!dialog || !plan) return;
    closeHub();
    closePanel();
    try {
      const data = await getJSON('/api/tester/study?questions=1');
      take(data);
      sections = data.sections;
      choices = data.choices || {};
      hints = data.hints || hints;
      local = {};
      Object.keys(data.answers || {}).forEach(id => { local[id] = { c: data.answers[id].c || null, t: data.answers[id].t || '' }; });
    } catch (_) {
      toastSafe('The questions could not be loaded. Try again in a moment.', 'bad');
      return;
    }
    savedName = '';
    dirty.clear();
    step = answeredCount() ? 1 : 0;
    stepSince = performance.now();
    event({ ev: 'questions_open', n: answeredCount() });
    try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
    renderStep();
  }

  const isAnswered = a => !!(a && (a.c || (a.t || '').trim()));
  const answeredCount = () => Object.keys(local).filter(id => isAnswered(local[id])).length;

  function dots() {
    return '<ol class="tq-dots" aria-label="Sections">' + sections.map((s, i) => {
      const done = s.questions.filter(q => isAnswered(local[q.id])).length;
      const cls = (step === i + 1 ? 'is-now ' : '') + (done === s.questions.length ? 'is-done' : done ? 'is-some' : '');
      return '<li><button type="button" class="tq-dot ' + cls + '" data-step="' + (i + 1) + '" aria-label="Section ' + (i + 1) + ', ' + esc(s.name) + ', ' + done + ' of ' + s.questions.length + ' answered"' + (step === i + 1 ? ' aria-current="step"' : '') + '>' + (i + 1) + '</button></li>';
    }).join('') + '</ol>';
  }

  function questionHtml(q) {
    const a = local[q.id] || {};
    const chipIds = q.kind === 'yn' ? ['yes', 'no', 'didnt_try'] : q.optional ? ['didnt_try'] : [];
    const auto = hints.auto && hints.auto[q.id], saw = hints.saw && hints.saw[q.id];
    return '<fieldset class="tq" data-q="' + esc(q.id) + '"><legend><span class="tq-n">' + q.n + '</span> ' + esc(q.text) + '</legend>'
      + (q.help ? '<p class="tq-help">' + esc(q.help) + '</p>' : '')
      + (auto ? '<p class="tq-saw">The app recorded: ' + esc(auto) + ' <button type="button" class="tester-link" data-use="' + esc(auto) + '">Use this</button></p>' : '')
      + (saw ? '<p class="tq-saw">' + esc(saw) + '</p>' : '')
      + (chipIds.length ? '<div class="tq-choices" role="group" aria-label="Quick answer to question ' + q.n + '">' + chipIds.map(c =>
        '<button type="button" class="tq-chip" data-choice="' + c + '" aria-pressed="' + (a.c === c) + '">' + esc(choices[c] || c) + '</button>').join('') + '</div>' : '')
      + '<label class="sr-only" for="tq-' + esc(q.id) + '">Your answer to question ' + q.n + '</label>'
      + '<textarea id="tq-' + esc(q.id) + '" class="tq-text" rows="' + (q.kind === 'yn' ? 2 : 3) + '" maxlength="1500" placeholder="' + (q.kind === 'yn' ? 'What happened? (optional)' : 'Your answer') + '">' + esc(a.t || '') + '</textarea></fieldset>';
  }

  function renderStep() {
    const body = $('tester-q-body'), next = $('tester-q-next'), back = $('tester-q-back'), title = $('tester-q-title'), sub = $('tester-q-sub');
    if (!body || !sections) return;
    const last = sections.length + 1;
    back.hidden = step === 0;
    next.hidden = false;
    next.textContent = step === 0 ? 'Start' : step === last ? 'Close' : step === last - 1 ? 'Finish' : 'Next';
    $('tester-q-fill').style.width = Math.round((step / last) * 100) + '%';
    $('tester-q-dots').innerHTML = step > 0 ? dots() : '';
    if (step === 0) {
      title.textContent = 'A few questions';
      sub.textContent = 'About ten minutes. Answer what you can.';
      body.innerHTML = '<div class="tq-intro"><p>There are ' + plan.total + ' questions in ' + sections.length + ' short sections. Every one can be skipped, and your answers are saved as you type, so you can stop and come back.</p>'
        + '<ul><li>Say what you did, what you expected and what happened. The exact words of an error help most.</li>'
        + '<li>If you did not try something, press <b>Didn’t try it</b> instead of guessing.</li>'
        + '<li>Please write the answers yourself, without an AI.</li>'
        + '<li>Your answers go into the report next to what the app recorded. Leave out anything private.</li></ul></div>';
    } else if (step === last) {
      const total = plan.total, got = answeredCount(), words = Object.keys(local).filter(id => (local[id].t || '').trim()).length;
      title.textContent = 'That is everything';
      sub.textContent = 'Last step: save your report.';
      body.innerHTML = '<div class="tq-done"><p>You answered <b>' + got + ' of ' + total + '</b> questions (' + words + ' with words). Skipped ones are fine.</p>'
        + '<p>The report holds your answers and everything the app recorded while you tested. You can read it first, then save it and attach the file to your forum message.</p>'
        + '<div class="tq-done-row"><button type="button" class="btn" data-q-act="view">View report first</button><button type="button" class="btn primary" data-q-act="save">Save my tester report</button></div>'
        + '<p class="field-hint" id="tester-q-saved" role="status">' + esc(savedName) + '</p></div>';
    } else {
      const sec = sections[step - 1];
      title.textContent = sec.name;
      sub.textContent = 'Section ' + step + ' of ' + sections.length + (sec.optional ? ' · optional' : '') + ' · ' + sec.blurb;
      body.innerHTML = sec.questions.map(questionHtml).join('');
    }
    body.scrollTop = 0;
    const heading = $('tester-q-title');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  function leaveStep() {
    if (step > 0 && sections && step <= sections.length) event({ ev: 'section', sec: sections[step - 1].id, ms: Math.round(performance.now() - stepSince) });
    stepSince = performance.now();
  }

  async function go(to) {
    await saveNow();
    leaveStep();
    const last = sections.length + 1;
    step = Math.max(0, Math.min(last, to));
    if (step === last) {
      try { take(await postJSON('/api/tester/study', { finish: true })); event({ ev: 'finish', n: answeredCount() }); } catch (_) { /* it is marked finished next time */ }
    }
    renderStep();
  }

  function setSaved(text) { const el = $('tester-q-saved-note'); if (el) el.textContent = text; }

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty.size) return true;
    const ids = Array.from(dirty), batch = {};
    ids.forEach(id => { const a = local[id] || {}; batch[id] = { c: a.c || null, t: a.t || '' }; });
    try {
      take(await postJSON('/api/tester/answers', { answers: batch }));
      ids.forEach(id => dirty.delete(id));
      setSaved('Saved');
      return true;
    } catch (_) {
      setSaved('Not saved yet. Deja Vu1 may be restarting; it will try again.');
      saveTimer = setTimeout(saveNow, 5000);
      return false;
    }
  }

  function touch(id) {
    dirty.add(id);
    setSaved('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
    if ($('tester-q-dots')) { $('tester-q-dots').innerHTML = dots(); }
  }

  async function saveReport() {
    const status = $('tester-q-saved');
    await saveNow();
    if (status) status.textContent = 'Building the report…';
    const done = await Tester.download();
    savedName = done.ok ? 'Saved ' + done.name + ' (' + done.size + '). Attach it to your forum message. Thank you for testing!' : done.error;
    if (status) status.textContent = savedName;
    await load();
  }

  document.addEventListener('input', e => {
    const area = e.target && e.target.classList && e.target.classList.contains('tq-text') ? e.target : null;
    if (!area) return;
    const id = area.closest('.tq').getAttribute('data-q');
    (local[id] = local[id] || { c: null, t: '' }).t = area.value;
    touch(id);
  });

  document.addEventListener('click', e => {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    const inCard = t.closest('#tester-plan');
    if (t.hasAttribute('data-length') && (inCard || t.closest('#tester-hub, #tester-panel'))) { setLength(+t.getAttribute('data-length')); if (panelKind === 'welcome') paintLengthButtons(); return; }
    if (t.id === 'tester-answer') { openQuestions(); return; }
    if (t.dataset.hub) {
      const what = t.dataset.hub;
      if (what === 'answer') openQuestions();
      else if (what === 'save') { closeHub(); Tester.download().then(r => toastSafe(r.ok ? 'Saved ' + r.name + ' (' + r.size + '). Attach it to your forum message.' : r.error, r.ok ? 'ok' : 'bad')).then(load); }
      else if (what === 'settings') { closeHub(); openSettings(); }
      return;
    }
    if (t.dataset.panel) {
      const what = t.dataset.panel;
      if (what === 'start') {
        welcomeDone = true;
        postJSON('/api/tester/study', { welcomed: true }).then(take).catch(() => {});
        event({ ev: 'welcome_done', days: plan ? plan.length_days : undefined });
        closePanel();
      } else if (what === 'more') { welcomeDone = true; postJSON('/api/tester/study', { welcomed: true }).then(take).catch(() => {}); closePanel(); openSettings(); }
      else if (what === 'later') closePanel();
      else if (what === 'answer') openQuestions();
      return;
    }
    const dialog = t.closest('#tester-q');
    if (!dialog) return;
    if (t.id === 'tester-q-close') { dialog.close(); return; }
    if (t.id === 'tester-q-back') { go(step - 1); return; }
    if (t.id === 'tester-q-next') { if (step === sections.length + 1) dialog.close(); else go(step + 1); return; }
    if (t.dataset.step) { go(+t.dataset.step); return; }
    if (t.dataset.qAct === 'view') { dialog.close(); Tester.view(); return; }
    if (t.dataset.qAct === 'save') { saveReport(); return; }
    const box = t.closest('.tq');
    if (!box) return;
    const id = box.getAttribute('data-q');
    const a = local[id] = local[id] || { c: null, t: '' };
    if (t.dataset.choice) {
      a.c = a.c === t.dataset.choice ? null : t.dataset.choice;
      box.querySelectorAll('.tq-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.choice === a.c)));
      touch(id);
    } else if (t.dataset.use) {
      a.t = t.dataset.use;
      box.querySelector('.tq-text').value = a.t;
      touch(id);
    }
  });

  document.addEventListener('close', e => {
    if (e.target && e.target.id === 'tester-q') { leaveStep(); saveNow().then(load); }
  }, true);

  function paintLengthButtons() {
    document.querySelectorAll('#tester-panel [data-length], #tester-hub [data-length], #tester-plan [data-length]').forEach(b =>
      b.setAttribute('aria-pressed', String(plan && +b.getAttribute('data-length') === plan.length_days)));
  }

  function openSettings() {
    if (typeof showTab === 'function') showTab('modules');
    setTimeout(() => {
      const card = $('tester-card');
      if (card) { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); card.setAttribute('tabindex', '-1'); card.focus({ preventScroll: true }); }
    }, 120);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel && !hub) { closePanel(); }
  });
  document.addEventListener('click', e => {
    if (hub && !hub.contains(e.target) && !(chip && chip.contains(e.target))) closeHub();
  }, true);

  window.addEventListener('tester-status', e => { if (e.detail && e.detail.study) take(e.detail.study); });
  window.addEventListener('tester-deleted', () => { plan = null; welcomeDone = false; endShown = false; clear(); setTimeout(load, 300); });
  setInterval(() => { if (plan && !document.hidden) { if (plan.status === 'running' && now() >= plan.ends_ms) take(Object.assign({}, plan, { status: 'due' })); else paint(); } }, 30000);
  setInterval(load, 5 * 60 * 1000);
  // The recorder starts once the app knows a server is here; look for it until then (the first run also waits for setup to close).
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (ready() && $('tester-dock')) { clearInterval(wait); load(); }
    else if (ready() && tries % 5 === 0) load();
    else if (tries > 120) clearInterval(wait);
  }, 1000);
  setInterval(() => { if (plan && ready()) { paintChip(); maybePrompt(); } }, 3000);
})();
