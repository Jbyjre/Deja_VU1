/* tester-study.js: the 22 questions, inside the app.
 *
 * The tester opens them from Settings, Tester mode, whenever they like (there is no round, no end date and no pop-up). They
 * are 22 questions in 9 short sections, saved as the tester types, any of them skippable. Questions 16 and 17 (the phone and
 * the AI assistant) also have a one-press "Didn't try it". The answers are kept on this computer by the server
 * (backend/tester_study.py); nothing is sent anywhere. It runs only while the recorder (tester.js) runs, so never in the
 * online demo.
 *
 * The tester's own panels carry the class tester-ui, which tester.js leaves out of what it records.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const json = { 'Content-Type': 'application/json' };
  let progress = null, sections = null, choices = {}, hints = { auto: {}, saw: {} }, local = {}, step = 0, stepSince = 0, saveTimer = 0, savedName = '';
  const dirty = new Set();

  const ready = () => !!(window.Tester && Tester.wanted());
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

  const toastSafe = (message, kind) => { if (typeof toast === 'function') toast(message, kind || 'info', 4200); };

  /* ---- the progress line in Settings ------------------------------------------------------------------ */

  function take(next) {
    progress = next;
    paintCard();
  }

  async function load() {
    if (!ready()) return;
    try { take(await getJSON('/api/tester/study')); } catch (_) { /* the server is restarting, or Tester mode is off for this run */ }
  }

  function paintCard() {
    const line = $('tester-progress');
    if (!line || !progress) return;
    const saved = progress.last_export ? ' Report last saved ' + progress.last_export.replace('T', ' ').slice(0, 16) + '.' : '';
    line.textContent = progress.answered + ' of ' + progress.total + ' questions answered.' + saved;
    const button = $('tester-answer');
    if (button) button.textContent = progress.answered ? 'Keep answering' : 'Answer the questions';
  }

  /* ---- the questions --------------------------------------------------------------------------------- */

  async function openQuestions() {
    const dialog = $('tester-q');
    if (!dialog || !ready()) return;
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
    const auto = hints.auto && hints.auto[q.id], saw = hints.saw && hints.saw[q.id];
    return '<fieldset class="tq" data-q="' + esc(q.id) + '"><legend><span class="tq-n">' + q.n + '</span> ' + esc(q.text) + '</legend>'
      + (q.help ? '<p class="tq-help">' + esc(q.help) + '</p>' : '')
      + (auto ? '<p class="tq-saw">The app recorded: ' + esc(auto) + ' <button type="button" class="tester-link" data-use="' + esc(auto) + '">Use this</button></p>' : '')
      + (saw ? '<p class="tq-saw">' + esc(saw) + '</p>' : '')
      + (q.optional ? '<div class="tq-choices" role="group" aria-label="Quick answer to question ' + q.n + '">'
        + '<button type="button" class="tq-chip" data-choice="didnt_try" aria-pressed="' + (a.c === 'didnt_try') + '">' + esc(choices.didnt_try || 'Didn’t try it') + '</button></div>' : '')
      + '<label class="sr-only" for="tq-' + esc(q.id) + '">Your answer to question ' + q.n + '</label>'
      + '<textarea id="tq-' + esc(q.id) + '" class="tq-text" rows="3" maxlength="1500" placeholder="Your answer">' + esc(a.t || '') + '</textarea></fieldset>';
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
      sub.textContent = 'Answer what you can. Skip the rest.';
      body.innerHTML = '<div class="tq-intro"><p>There are ' + progress.total + ' questions in ' + sections.length + ' short sections. Every one can be skipped, and your answers are saved as you type, so you can stop and come back whenever you like.</p>'
        + '<ul><li>Say what you did, what you expected and what happened. The exact words of an error help most.</li>'
        + '<li>If you did not try something, say so instead of guessing. The phone and AI questions have a <b>Didn’t try it</b> button.</li>'
        + '<li>Please write the answers yourself, without an AI.</li>'
        + '<li>Your answers go into the report next to what the app recorded. Leave out anything private, such as your network’s name or the printer’s address.</li></ul></div>';
    } else if (step === last) {
      const total = progress.total, got = answeredCount(), words = Object.keys(local).filter(id => (local[id].t || '').trim()).length;
      title.textContent = 'That is everything';
      sub.textContent = 'Last step: save your report.';
      body.innerHTML = '<div class="tq-done"><p>You answered <b>' + got + ' of ' + total + '</b> questions (' + words + ' with words). Skipped ones are fine, and you can come back to Settings, Tester mode, to answer more.</p>'
        + '<p>The report holds your answers and everything the app recorded while you tested. Read it first if you like, then save it and attach the file to your message. If something broke, add the exact error words and a screenshot to the message.</p>'
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
    if (step === last) event({ ev: 'finish', n: answeredCount() });
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
    savedName = done.ok ? 'Saved ' + done.name + ' (' + done.size + '). Attach it to your message. Thank you for testing!' : done.error;
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
    if (t.id === 'tester-answer') { openQuestions(); return; }
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

  window.addEventListener('tester-status', e => { if (e.detail && e.detail.study) take(e.detail.study); });
  window.addEventListener('tester-deleted', () => { progress = null; local = {}; dirty.clear(); setTimeout(load, 300); });
  if (window.Tester) window.Tester.answer = openQuestions;
  // The recorder starts once the app knows a server is here; look for the progress until it does.
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (ready()) { clearInterval(wait); load(); } else if (tries > 120) clearInterval(wait);
  }, 1000);
  setInterval(load, 5 * 60 * 1000);
})();
