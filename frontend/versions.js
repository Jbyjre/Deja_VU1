/* Which version this is, how it updates, and what every version changed.
   versions.json is the one history: the same entry becomes the GitHub release
   notes (tools/release-notes.py), so the app and GitHub always agree.
   Works on the public demo too: versions.json is a plain file. */
'use strict';
window.Versions = (() => {
  const SEEN = 'dejavu1.seen-version';
  let history = [], info = null, told = '';
  const loaded = fetch('versions.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : { versions: [] }))
    .then(d => { history = Array.isArray(d.versions) ? d.versions : []; })
    .catch(() => { history = []; });

  const key = v => (String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)/) || [0, 0, 0, 0]).slice(1).map(Number);
  const newer = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  const offline = () => tourOn() || serverMissing();
  const installed = () => (info && info.version) || (history[0] && history[0].version) || '';
  const entry = v => history.find(h => h.version === String(v).replace(/^v/, '').replace(/-.*$/, ''));
  const day = d => { try { return new Date(`${d}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return d; } };

  function kindText() {
    if (offline()) return 'This is the online demo. Updates belong to the copy on your own computer.';
    if (!info) return 'App information is unavailable. Check that the launcher window is still open.';
    if (info.install_kind === 'git') {
      if (!info.git_found) return 'A GitHub Desktop copy, but git can’t be found. In GitHub Desktop: Fetch origin, then Pull origin.';
      if (!info.launcher) return 'A GitHub Desktop copy, started without the launcher. Start it with the launcher to update from here.';
      return 'A GitHub Desktop copy: updates pull from GitHub, and stop if you changed its files by hand.';
    }
    const build = info.build && info.build.commit ? ` Build ${info.build.commit.slice(0, 7)}.` : '';
    if (!info.launcher) return `Started without the double-click launcher, so it can check but not install. Start it with the launcher, or use the update command below.${build}`;
    return (info.channel === 'latest' ? 'Gets the newest files from GitHub, each checked first.' : 'Gets each new release from GitHub.') + build;
  }

  // A check made on the other channel no longer applies; a git copy's answer always does.
  const current = () => { const l = info && info.latest; return l && (l.kind === 'git' || !l.channel || l.channel === info.channel) ? l : null; };

  function renderCard() {
    const v = installed(), e = entry(v), latest = current();
    $('vc-number').textContent = v ? `v${v}` : 'Unknown';
    $('vc-name').textContent = e ? e.name : (String(v).includes('-') ? 'A development build' : '');
    $('vc-meta').textContent = e ? `${day(e.date)} · ${e.published ? 'published on GitHub' : 'built and tested, not published as a download'}` : '';
    $('vc-tour').hidden = !(e && e.highlights && e.highlights.length);
    $('vc-kind').textContent = kindText();

    const status = $('app-update-status'), check = $('app-update-check'), install = $('app-update-install'), git = $('app-update-git');
    const channels = document.querySelectorAll('input[name=app-update-channel]');
    // Git copies follow their branch on GitHub, so the channel choice doesn't apply to them.
    $('app-update-channels').hidden = !!(info && info.install_kind === 'git');
    if (offline()) {
      status.textContent = 'Public demo only.';
      check.disabled = true; install.hidden = true; git.hidden = true;
      ['app-update-auto', 'app-update-autoinstall'].forEach(i => { $(i).disabled = true; });
      channels.forEach(r => { r.disabled = true; });
      $('app-update-note').textContent = '';
    } else if (info) {
      check.disabled = false; $('app-update-auto').disabled = false;
      channels.forEach(r => { r.disabled = false; r.checked = r.value === info.channel; });
      const what = latest && !latest.error && latest.title ? ` Newest: “${latest.title}”${latest.date ? `, ${new Date(latest.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.` : '';
      status.textContent = latest ? (latest.error || latest.message) + what : 'Not checked yet. Check for updates asks GitHub now.';
      $('app-update-auto').checked = !!info.automatic;
      $('app-update-autoinstall').checked = !!info.auto_install;
      $('app-update-autoinstall').disabled = !info.automatic;
      $('app-update-auto-when').textContent = info.install_kind === 'git' || info.channel === 'latest' ? '(every 15 minutes)' : '(every hour)';
      install.hidden = !(latest && latest.installable && info.install_supported);
      install.textContent = latest && latest.version && latest.kind !== 'git' ? `Install v${latest.version} & restart` : 'Install update & restart';
      // Without the launcher, a git copy can still pull; the person restarts it afterwards.
      git.hidden = !(info.install_kind === 'git' && info.git_found && !info.launcher);
      $('app-update-note').textContent = !install.hidden ? 'Installing restarts the dashboard and reloads this page. It waits while a real printer is busy or out of reach.'
        : !git.hidden ? 'Update with git, then restart Deja Vu1.' : '';
    }
    manageState();
    const coming = $('vc-coming'), changes = (latest && latest.changes) || [];
    coming.hidden = !changes.length;
    coming.innerHTML = changes.length ? `<li class="vc-coming-head">Coming in this update</li>${changes.map(c => `<li>${esc(c)}</li>`).join('')}` : '';
    $('app-update-badge').hidden = !(latest && latest.available);
    renderHistory(v, latest);
    renderChip(v, latest);
  }

  function renderHistory(v, latest) {
    const items = [];
    if (latest && latest.available && latest.version && !entry(latest.version) && newer(latest.version, v)) {
      items.push(`<li class="vh-item is-next"><div class="vh-head"><span class="vh-num">v${esc(latest.version)}</span><span class="vh-tag is-next">Ready to install</span></div>
        <p class="vh-sum">A newer version is on GitHub. Its full notes appear here once it is installed.</p></li>`);
    }
    history.forEach(h => {
      const here = h.version === String(v).replace(/-.*$/, '');
      items.push(`<li class="vh-item${here ? ' is-here' : ''}">
        <div class="vh-head"><span class="vh-num">v${esc(h.version)}</span><strong class="vh-name">${esc(h.name)}</strong>
          ${here ? '<span class="vh-tag is-here">You’re here</span>' : ''}
          ${h.published ? '<span class="vh-tag">Published</span>' : ''}
          <time class="vh-date" datetime="${esc(h.date)}">${esc(day(h.date))}</time></div>
        <p class="vh-sum">${esc(h.summary)}</p>
        <div class="vh-foot">
          <details class="vh-more"><summary>What changed · ${h.changes.length}</summary><ul>${h.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>
          ${h.highlights && h.highlights.length ? `<button type="button" class="btn small" data-vtour="${esc(h.version)}">Tour v${esc(h.version)}</button>` : ''}
        </div></li>`);
    });
    paint($('version-history'), items.join(''));
  }

  // "Deja Vu1 0.9.0", or "A newer build" for the newest-builds channel, which has no version number of its own.
  const readyName = l => (l.version && l.kind !== 'git' && l.channel !== 'latest' ? `Deja Vu1 ${l.version}` : 'A newer version');
  const readyKey = l => l.version + (l.commit || '') + (l.behind || '');

  function renderChip(v, latest) {
    const chip = $('ver-chip');
    if (v) { chip.hidden = false; chip.textContent = `v${v}`; }
    chip.classList.toggle('has-update', !!(latest && latest.available));
    $('foot-version').textContent = v ? `Version ${v} · ` : '';
    if (!window.Orb) return;
    const e = entry(v), actions = [];
    if (e && e.highlights && e.highlights.length) actions.push({ label: 'What’s new', run: () => tour(e.version) });
    if (latest && latest.available) actions.push({ label: latest.version ? `Get v${latest.version}` : 'Get the update', primary: true, run: openCard });
    else actions.push({ label: 'Version history', run: openCard });
    Orb.setApp({ version: v ? `v${v}` : '', update: !!(latest && latest.available),
      text: latest && latest.available ? `${readyName(latest)} is ready to install.` : (e ? e.name : 'Deja Vu1'), actions });
  }

  function openCard() {
    showTab('modules');
    const card = $('version-card');
    card.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    card.classList.remove('is-flash'); void card.offsetWidth; card.classList.add('is-flash');
  }

  /* A version's tour: a full-screen opening card, a stop per highlight, then the full list. */
  function tour(version) {
    const e = entry(version);
    if (!e || !window.Guide) return;
    const steps = [{ chapter: true, hero: `v${e.version}`, eyebrow: `What’s new · ${day(e.date)}`, title: e.name,
      html: `<p>${esc(e.summary)}</p><ol class="guide-stops">${e.highlights.map(h => `<li>${esc(h.title)}</li>`).join('')}</ol>
        <p class="guide-aside">${e.published ? 'Published on GitHub as a release.' : 'Built and tested in this round; never published as a download.'} ${e.highlights.length} stops, about a minute.</p>` }];
    e.highlights.forEach(h => steps.push({ section: e.name, eyebrow: `v${e.version} · What’s new`, ...h }));
    steps.push({ chapter: true, eyebrow: `Everything in v${e.version}`, title: 'The full list',
      html: `<ul class="guide-changes">${e.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` });
    Guide.start(steps, { name: `What’s new in v${e.version}`, doneLabel: 'Done' });
  }

  let toldUndone = null;
  async function refresh() {
    await loaded;
    if (!offline()) {
      try { info = await getJSON('/api/app/info'); if (!info || info.error || !info.version) info = null; } catch (_) { info = null; }
    } else info = null;
    renderCard();
    const job = info && info.update_job;
    if (job && (job.state === 'working' || job.state === 'restarting')) { showJob(job); followJob(); }
    else if (job && job.state === 'failed') $('app-update-status').textContent = `The last install didn’t finish: ${sentence(job.message)} Nothing was changed.`;
    const last = info && info.last_update;
    if (last && last.ok === false && Date.now() / 1000 - (last.at || 0) < 172800 && toldUndone !== last.at) {
      toldUndone = last.at;
      toast(`The update didn’t start, so version ${last.previous} was put back. Your settings and files are safe. ${sentence(last.message)}`, 'bad', 15000,
        { action: { label: 'Show me', run: openCard } });
    }
    const latest = current();
    if (latest && latest.available && told !== readyKey(latest) && window.Orb) {
      told = readyKey(latest);
      toast(`${readyName(latest)} is ready to install.`, 'info', 9000, { action: { label: 'Show me', run: openCard } });
    }
    return info;
  }

  /* After an update: say so once, with a way into that version's tour. */
  function greetNewVersion() {
    const v = installed(), e = entry(v);
    if (!v || offline()) return;
    const seen = store.get(SEEN);
    store.set(SEEN, v);
    // No record: either a brand-new copy (setup runs instead) or an update from a version before this existed.
    const upgraded = seen ? newer(v, seen) : !!store.get('dejavu1.setup-seen');
    if (upgraded && e) toast(`Updated to v${v}: ${e.name}.`, 'ok', 10000, { action: { label: 'See what’s new', run: () => tour(v) } });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-vtour]');
    if (b) tour(b.dataset.vtour);
  });
  $('vc-tour').onclick = () => tour(installed());
  $('ver-chip').onclick = openCard;
  $('app-update-check').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true; $('app-update-status').textContent = 'Asking GitHub…';
    try {
      const r = await postJSON('/api/app/updates/check', {});
      if (!r.ok) throw new Error(r.body.error);
      info = { ...info, ...r.body }; renderCard();
      const latest = current() || {};
      if (latest.error) toast(latest.error, 'warn');
      else if (!latest.available) toast(latest.message || 'You have the latest version.', 'ok');
      else if (told !== readyKey(latest)) { told = readyKey(latest); toast(`${readyName(latest)} is ready to install.`, 'info', 9000); }
    } catch (err) { $('app-update-status').textContent = err.message || 'Could not check. Try again when your connection is back.'; }
    finally { btn.disabled = offline(); }
  };
  $('app-update-auto').onchange = async e => {
    const r = await postJSON('/api/app/updates/settings', { automatic: e.target.checked });
    if (r.ok) { info = { ...info, ...r.body }; renderCard(); toast(e.target.checked ? 'Deja Vu1 will look for updates by itself.' : 'Automatic update checks are off.', 'ok'); }
    else { e.target.checked = !e.target.checked; toast(r.body.error || 'Could not save that preference', 'bad'); }
  };
  const savePref = async (body, undo, said) => {
    const r = await postJSON('/api/app/updates/settings', body);
    if (r.ok) { info = { ...info, ...r.body }; renderCard(); if (said) toast(said, 'ok'); }
    else { undo(); toast(r.body.error || 'Could not save that preference', 'bad'); }
  };
  $('app-update-autoinstall').onchange = e => savePref({ auto_install: e.target.checked }, () => { e.target.checked = !e.target.checked; },
    e.target.checked ? 'Updates will install by themselves while every printer is idle.' : 'Updates wait for you to press Install.');
  document.querySelectorAll('input[name=app-update-channel]').forEach(r => {
    r.onchange = () => savePref({ channel: r.value }, renderCard, r.value === 'latest' ? 'You’ll get the newest builds.' : 'You’ll get stable releases only.');
  });
  $('app-update-git').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true; $('app-update-status').textContent = 'Asking git for the newest commits…';
    try {
      const r = await postJSON('/api/app/updates/git', {});
      if (!r.ok) throw new Error(r.body.error);
      if (r.body.restarting) { $('app-update-status').textContent = 'Restarting. This page reloads by itself.'; waitForRestart(r.body.version); }
      else { $('app-update-status').textContent = r.body.updated ? 'Updated. Close the launcher window and start Deja Vu1 again to use the new version.' : 'Already up to date.'; btn.disabled = false; }
    } catch (err) { $('app-update-status').textContent = err.message || 'Git could not update this copy.'; btn.disabled = false; }
  };
  $('app-update-install').onclick = e => startJob('/api/app/updates/install', e.currentTarget);

  /* ---- the install job ------------------------------------------------------
   * Install and Repair start a job on the server and come straight back; this
   * follows it (download progress, checking, restarting). A reload, or another
   * page, picks the same job up from /api/app/info. */
  const sentence = text => { const t = String(text || '').trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };
  let following = false;
  async function startJob(route, btn) {
    btn.disabled = true;
    showJob({ state: 'working', words: 'Checking that every printer is idle' });
    try {
      const r = await postJSON(route, {});
      if (!r.ok) throw new Error(r.body.error);
      followJob();
    } catch (err) {
      jobFailed(err.message || 'The update could not be started.', btn);
    }
  }
  function showJob(job) {
    const box = $('app-update-progress'), bar = $('app-update-bar');
    box.hidden = false;
    let pct = null, words = job.words || 'Working';
    if (job.step === 'download' && job.total) {
      pct = Math.min(100, Math.round((job.done || 0) / job.total * 100));
      const mb = n => (n / 1048576).toFixed(1);
      words = `Downloading version ${job.version || ''}: ${mb(job.done || 0)} of ${mb(job.total)} MB (${pct}%)`.replace('version :', 'the update:');
    } else if (job.state === 'restarting') {
      pct = 100; words = `Restarting into version ${job.version || 'the new version'}. This page reloads by itself; keep the launcher window open.`;
    }
    bar.classList.toggle('is-unknown', pct === null);
    bar.style.setProperty('--done', `${pct === null ? 30 : Math.max(4, pct)}%`);
    if (pct === null) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(pct));
    $('app-update-step').textContent = sentence(words);
    $('app-update-status').textContent = job.repair ? 'Repairing the app files. Your settings, printers and files stay.' : 'Installing the update. Your settings, printers and files stay.';
  }
  function jobFailed(message, btn) {
    $('app-update-progress').hidden = true;
    $('app-update-status').textContent = `${sentence(message)} Nothing was changed. You can also update with the command below.`;
    if (btn) btn.disabled = false;
    $('app-update-install').disabled = false; $('app-repair').disabled = false;
    toast(sentence(message), 'bad', 12000);
    showCommand();
  }
  async function followJob() {
    if (following) return;
    following = true;
    let lost = 0;
    for (;;) {
      await new Promise(r => setTimeout(r, 700));
      let d = null;
      try { d = await (await fetch('/api/app/info', { cache: 'no-store' })).json(); } catch (_) { d = null; }
      const job = d && d.update_job;
      if (!job) {
        // Nothing answers: the server is already restarting into the new version.
        if (++lost >= 3) { following = false; return waitForRestart(null); }
        continue;
      }
      lost = 0;
      if (job.state === 'failed') { following = false; return jobFailed(job.message || 'The update could not be installed.'); }
      if (job.state === 'idle') { following = false; return waitForRestart(null); }
      showJob(job);
      if (job.state === 'restarting') { following = false; return waitForRestart(job.version); }
    }
  }

  /* ---- look after this copy ------------------------------------------------ */
  const launcherOnly = 'Start Deja Vu1 with its double-click launcher to use this.';
  function manageState() {
    const demo = offline(), launcher = !!(info && info.launcher), git = !!(info && info.install_kind === 'git');
    $('app-restart').disabled = demo || !launcher;
    $('app-repair').disabled = demo || !launcher || git;
    $('app-safety').disabled = demo;
    $('app-stop').disabled = demo || !info;
    $('app-ready').disabled = demo || !info;
    $('vc-manage-note').textContent = demo ? 'Public demo only.' : !info ? '' : !launcher ? `Restart and Repair: ${launcherOnly}`
      : git ? 'Repair a GitHub Desktop copy there: Repository, then Discard all changes.' : '';
  }
  const say = (text, kind) => { $('vc-manage-note').textContent = text; if (kind) toast(text, kind); };
  async function restartWith(route, button, doing, done) {
    button.disabled = true; say(doing);
    try {
      const r = await postJSON(route, {});
      if (!r.ok) throw new Error(r.body.error);
      say(done, 'info'); waitForRestart(r.body.version || installed());
    } catch (err) { say(err.message || 'That didn’t work. Nothing was changed.', 'bad'); button.disabled = false; if (route === '/api/app/repair') showCommand(); }
  }
  $('app-restart').onclick = e => restartWith('/api/app/restart', e.currentTarget, 'Restarting…', 'Restarting. This page reloads by itself.');
  $('app-repair').onclick = e => {
    if (!confirm('Repair files?\n\nDeja Vu1 downloads the newest release from GitHub, puts its app files back over this copy and restarts. Your settings, printers and files stay. A safety copy is made first.')) return;
    startJob('/api/app/repair', e.currentTarget);
  };
  $('app-ready').onclick = async e => {
    const btn = e.currentTarget, box = $('app-ready-box');
    btn.disabled = true; box.hidden = false; box.className = 'vc-ready'; box.innerHTML = '<h4>Checking…</h4>';
    try {
      const r = await postJSON('/api/app/ready', {});
      if (!r.ok) throw new Error(r.body.error);
      showReady(r.body);
    } catch (err) {
      box.className = 'vc-ready is-bad';
      box.innerHTML = `<h4>The check didn’t answer</h4><p>${esc(err.message || 'Deja Vu1 stopped answering.')} The command below starts it and checks it again.</p>`;
      $('vc-fix').open = true;
    }
    btn.disabled = offline();
  };
  function showReady(rep) {
    const box = $('app-ready-box'), mark = { ok: '✓', note: '!', bad: '✗' };
    box.className = `vc-ready ${rep.ready ? 'is-ok' : 'is-bad'}`;
    box.innerHTML = `<h4>${rep.ready ? '✓' : '✗'} ${esc(rep.headline)}</h4><ul>${(rep.checks || []).map(c => `
      <li class="is-${esc(c.state)}"><span class="vr-mark" aria-label="${esc(c.state === 'ok' ? 'Working' : c.state === 'note' ? 'Note' : 'Not working')}">${mark[c.state] || '•'}</span><b>${esc(c.label)}</b><span>${esc(sentence(c.detail))}</span>${c.state !== 'ok' && c.fix ? `<span class="vr-fix">${esc(sentence(c.fix))}</span>` : ''}</li>`).join('')}</ul>`;
    if (!rep.ready) { $('vc-fix').open = true; if (rep.next === 'repair') showCommand(); }
  }
  $('app-safety').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const r = await postJSON('/api/app/memory/snapshot', {});
      if (!r.ok) throw new Error(r.body.error);
      say('Safety copy made. Your data is safe lists it.', 'ok');
    } catch (err) { say(err.message || 'The safety copy could not be made.', 'bad'); }
    btn.disabled = false;
  };
  $('app-stop').onclick = async e => {
    if (!confirm('Stop Deja Vu1?\n\nThe dashboard closes on this computer and on your phone. Prints already running carry on. Start it again with the double-click launcher.')) return;
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const r = await postJSON('/api/app/stop', {});
      if (!r.ok) throw new Error(r.body.error);
      say('Deja Vu1 has stopped. Start it again with the double-click launcher.', 'info');
    } catch (err) { say(err.message || 'Deja Vu1 could not be stopped from here.', 'bad'); btn.disabled = false; }
  };
  // The pointer moves a soft glint along the glass strip.
  const strip = $('vc-manage');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    strip.addEventListener('pointermove', e => {
      const r = strip.getBoundingClientRect();
      strip.style.setProperty('--gx', `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`);
    });
  }

  /* ---- update with a command ------------------------------------------------ */
  function pickOS(os) {
    document.querySelectorAll('.vc-cmd [data-os]').forEach(b => { const on = b.dataset.os === os; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('.vc-cmd [data-os-block], .vc-cmd [data-start-block]').forEach(b => { b.hidden = (b.dataset.osBlock || b.dataset.startBlock) !== os; });
  }
  function showCommand() {
    $('version-card').classList.add('is-failed');
    $('vc-cmd').open = true;
  }
  pickOS(/Win/i.test(navigator.userAgent) ? 'win' : 'unix');
  document.querySelectorAll('.vc-cmd [data-os]').forEach(b => { b.onclick = () => pickOS(b.dataset.os); });
  document.querySelectorAll('.vc-cmd .vc-copy').forEach(b => {
    b.onclick = async () => {
      const text = b.parentElement.querySelector('code').textContent;
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; toast('Command copied. Paste it into a new PowerShell or Terminal window.', 'ok'); }
      catch (_) { const range = document.createRange(); range.selectNodeContents(b.parentElement.querySelector('code')); getSelection().removeAllRanges(); getSelection().addRange(range); b.textContent = 'Press Ctrl+C'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 2500);
    };
  });

  /* Reload once the new server answers, rather than after a fixed guess. The
   * page says how long it has waited; past a minute it says what to do, and
   * the offline page (if this tab reloads into it) knows an update is running. */
  function waitForRestart(version, tries = 0, started = Date.now(), before = installed()) {
    if (!tries) { try { sessionStorage.setItem('dv-updating', String(Date.now())); } catch (_) { /* private window */ } }
    setTimeout(async () => {
      const secs = Math.round((Date.now() - started) / 1000);
      try {
        const r = await fetch('/api/app/info', { cache: 'no-store' });
        const d = await r.json();
        // A new server: the version asked for, or (Restart, Repair) a new process that answers.
        const back = version ? d.version === version : (d.version && (d.version !== before || tries > 2));
        if (back || secs > 180) return location.reload();
      } catch (_) { /* still restarting */ }
      const box = $('app-update-progress');
      box.hidden = false;
      $('app-update-bar').classList.add('is-unknown');
      $('app-update-step').textContent = secs < 60
        ? `Restarting${version ? ` into version ${version}` : ''}: ${secs} s. This page reloads by itself; keep the launcher window open.`
        : `This is taking longer than usual (${secs} s). Look at the Deja Vu1 window: it says what is happening. If it shows an error or has closed, paste the Start and check command below.`;
      if (secs >= 60) { $('vc-fix').open = true; }
      waitForRestart(version, tries + 1, started, before);
    }, tries ? 1500 : 2500);
  }

  const ready = serverReady().then(async () => {
    await refresh();
    greetNewVersion();
    // An automatic check runs on the server at startup; pick up its answer, then look again now and then.
    setTimeout(refresh, 25000);
    setInterval(() => { if (!document.hidden) refresh(); }, 30 * 60 * 1000);
  });

  return { ready, refresh, tour, openCard, info: () => info, installed, history: () => history };
})();
