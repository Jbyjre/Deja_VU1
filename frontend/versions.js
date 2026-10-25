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

  async function refresh() {
    await loaded;
    if (!offline()) {
      try { info = await getJSON('/api/app/info'); if (!info || info.error || !info.version) info = null; } catch (_) { info = null; }
    } else info = null;
    renderCard();
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
  $('app-update-install').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true; $('app-update-status').textContent = 'Downloading and checking the update…';
    try {
      const r = await postJSON('/api/app/updates/install', {});
      if (!r.ok) throw new Error(r.body.error);
      $('app-update-status').textContent = 'Restarting. Keep the launcher window open; this page reloads by itself.';
      toast('Installing the update. The dashboard restarts in a moment.', 'info', 9000);
      waitForRestart(r.body.version);
    } catch (err) {
      $('app-update-status').textContent = `${err.message || 'The update could not be installed.'} Nothing was changed. You can also update with the command below.`;
      btn.disabled = false; showCommand();
    }
  };

  /* ---- look after this copy ------------------------------------------------ */
  const launcherOnly = 'Start Deja Vu1 with its double-click launcher to use this.';
  function manageState() {
    const demo = offline(), launcher = !!(info && info.launcher), git = !!(info && info.install_kind === 'git');
    $('app-restart').disabled = demo || !launcher;
    $('app-repair').disabled = demo || !launcher || git;
    $('app-safety').disabled = demo;
    $('app-stop').disabled = demo || !info;
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
    restartWith('/api/app/repair', e.currentTarget, 'Downloading and checking the files…', 'Repaired. Restarting; this page reloads by itself.');
  };
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
    document.querySelectorAll('#vc-cmd [data-os]').forEach(b => { const on = b.dataset.os === os; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#vc-cmd [data-os-block]').forEach(b => { b.hidden = b.dataset.osBlock !== os; });
  }
  function showCommand() {
    $('version-card').classList.add('is-failed');
    $('vc-cmd').open = true;
  }
  pickOS(/Win/i.test(navigator.userAgent) ? 'win' : 'unix');
  document.querySelectorAll('#vc-cmd [data-os]').forEach(b => { b.onclick = () => pickOS(b.dataset.os); });
  document.querySelectorAll('#vc-cmd .vc-copy').forEach(b => {
    b.onclick = async () => {
      const text = b.parentElement.querySelector('code').textContent;
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; toast('Update command copied. Paste it into a new window.', 'ok'); }
      catch (_) { const range = document.createRange(); range.selectNodeContents(b.parentElement.querySelector('code')); getSelection().removeAllRanges(); getSelection().addRange(range); b.textContent = 'Press Ctrl+C'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 2500);
    };
  });

  // Reload once the new server answers, rather than after a fixed guess.
  function waitForRestart(version, tries = 0) {
    setTimeout(async () => {
      try {
        const r = await fetch('/api/app/info', { cache: 'no-store' });
        const d = await r.json();
        if (d.version === version || tries > 40) return location.reload();
      } catch (_) { /* still restarting */ }
      waitForRestart(version, tries + 1);
    }, tries ? 1500 : 4000);
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
