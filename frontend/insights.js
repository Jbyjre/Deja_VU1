/* Deja Vu1 - memory, history and proof.
 *
 * Small panels that help the dashboard remember, pick up where you are and
 * show its work:
 *   - Overview, "What your history says": findings from the printer's own
 *     print history (backend/insights.py), each with what it is based on.
 *   - Settings, "Your data is safe": the safety copies backend/memory.py
 *     keeps, with any repairs it made, a copy-now button and restore.
 *   - Files, "Pick up where you left off": presets and recent projects
 *     found in Snapmaker Orca or OrcaSlicer on this computer
 *     (backend/orca_import.py), brought in with a click.
 *   - Settings, "About Deja Vu1": what it adds, credits, and "Check it
 *     yourself" (backend/selfcheck.py), real checks run in this copy.
 */
'use strict';
(() => {
  const when = iso => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  const ago = iso => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
    if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  };

  /* ---- Overview: what your history says ---------------------------------- */
  const card = $('insights-card');
  let seq = 0;
  async function loadInsights() {
    if (!card) return;
    const mine = ++seq;
    const data = await getJSON(api('/api/insights')).catch(() => null);
    if (mine !== seq) return;
    const body = $('insights-body');
    if (!data || data.error || (!data.connected && !data.demo)) {
      paint(body, `<p class="log-empty">${esc((data && data.error) || 'Connect a printer (or turn on demo data) and its history is read here: success rate, what fails and why, filament use.')}</p>`);
      return;
    }
    const s = data.summary;
    if (!data.history_loaded) { paint(body, '<p class="log-empty">Reading the printer’s print history…</p>'); return; }
    if (!s) { paint(body, '<p class="log-empty">No prints in this printer’s history yet. Findings appear once there are a few.</p>'); return; }
    const kg = s.grams >= 1000 ? `${(s.grams / 1000).toFixed(1)} kg` : `${Math.round(s.grams)} g`;
    $('insights-sub').textContent = data.demo
      ? 'Simulated history (demo data). With a real U1 these come from its own print history.'
      : `From this printer’s own history${s.since ? `, since ${new Date(s.since).toLocaleDateString([], { dateStyle: 'medium' })}` : ''}. A finding only appears with enough prints behind it.`;
    const list = data.findings || [];
    paint(body, `<p class="ins-so-far"><b>${s.prints}</b> prints · <b>${s.hours}</b> hours · <b>${kg}</b> of filament${s.failed ? ` · ${s.failed} failed` : ''}${s.cancelled ? ` · ${s.cancelled} stopped early` : ''}</p>
      ${list.length ? `<ul class="ins-list">${list.map(f => `<li class="ins is-${esc(f.tone)}"><span class="ins-dot" aria-hidden="true"></span>
        <div><b>${esc(f.title)}</b><p>${esc(f.detail)}</p><small>From ${esc(f.evidence)}</small></div></li>`).join('')}</ul>`
        : `<p class="log-empty">Not enough prints yet to say anything with confidence (at least ${data.minimum || 5}).</p>`}`);
  }
  if (card) {
    window.addEventListener('dv-tab', e => { if (e.detail === 'overview') loadInsights(); });
    window.addEventListener('dv-refresh', () => { if (!$('tab-overview').hidden) loadInsights(); });
    window.addEventListener('dv-live-event', e => { if (e.detail && e.detail.type === 'print_event' && ['finished', 'failed', 'cancelled'].includes(e.detail.event)) loadInsights(); });
    setTimeout(loadInsights, 600);
  }

  /* ---- Settings: your data is safe ---------------------------------------- */
  const mem = $('memory-card');
  async function loadMemory() {
    if (!mem) return;
    const data = await getJSON('/api/app/memory').catch(() => null);
    if (!data || data.error || !Array.isArray(data.copies)) {
      $('mem-status').textContent = (data && data.error) || 'Safety copies belong to the copy of Deja Vu1 running on your computer.';
      $('mem-now').disabled = true; paint($('mem-list'), ''); return;
    }
    $('mem-now').disabled = false;
    const repairs = (data.repairs || []).slice().reverse();
    $('mem-status').innerHTML = (data.newest ? `Newest safety copy ${esc(ago(data.newest))} · ${data.copies.length} kept (up to ${data.keep}) · ${data.records} records looked after.`
      : 'No safety copy yet: the first is made within minutes of starting.')
      + (repairs.length ? ` <span class="mem-repair">Repaired by itself: ${repairs.map(r => `${esc(r.file)} (from ${esc(r.from)})`).join('; ')}.</span>` : '');
    paint($('mem-list'), data.copies.map((c, i) => `<li><div><b>${esc(when(c.created_at))}</b><span>${esc({ automatic: 'Automatic', manual: 'Made by you', 'before-update': 'Before an update', 'before-restore': 'Before a restore' }[c.reason] || c.reason)} · ${c.files} records · ${Math.max(1, Math.round(c.bytes / 1024))} KB</span></div>
      <button class="btn small" type="button" data-restore="${esc(c.id)}"${i === 0 && c.reason !== 'before-restore' ? ' title="The newest copy"' : ''}>Restore…</button></li>`).join(''));
  }
  if (mem) {
    $('mem-now').onclick = async e => {
      const b = e.currentTarget; b.disabled = true;
      const r = await postJSON('/api/app/memory/snapshot', {}).catch(() => null);
      b.disabled = false;
      if (r && r.ok) { toast(`Safety copy made: ${r.body.files} records`, 'ok'); loadMemory(); }
      else toast((r && r.body && r.body.error) || 'Could not make a safety copy', 'bad');
    };
    $('mem-list').addEventListener('click', async e => {
      const b = e.target.closest('[data-restore]');
      if (!b) return;
      const row = b.closest('li').querySelector('b').textContent;
      if (!confirm(`Put everything back as it was on ${row}?\n\nA safety copy of how things are now is made first, so you can undo this. The dashboard restarts afterwards.`)) return;
      b.disabled = true;
      const r = await postJSON('/api/app/memory/restore', { id: b.dataset.restore }).catch(() => null);
      if (!r || !r.ok) { b.disabled = false; toast((r && r.body && r.body.error) || 'Nothing was restored', 'bad'); return; }
      if (r.body.restarting) { $('mem-status').textContent = `Restored ${r.body.restored} records. Restarting…`; waitForRestart(); }
      else $('mem-status').textContent = `Restored ${r.body.restored} records. Close and reopen Deja Vu1 to finish.`;
    });
    window.addEventListener('dv-tab', e => { if (e.detail === 'modules') loadMemory(); });
    loadMemory();
  }

  /* ---- Settings: about, and check it yourself ------------------------------ */
  const about = $('about-card');
  if (about) {
    getJSON('/api/app/info').then(info => {
      if (info && info.version) $('about-version').textContent = `Version ${info.version}${info.build && info.build.commit ? ` · build ${info.build.commit.slice(0, 7)}` : ''} · MIT licence · a dashboard and print-preparation workspace for the Snapmaker U1.`;
    }).catch(() => {});
    $('selfcheck-run').onclick = async e => {
      const b = e.currentTarget, list = $('selfcheck-list');
      b.disabled = true; list.hidden = false;
      paint(list, '<li class="sc-wait">Running the checks…</li>');
      const r = await postJSON('/api/app/selfcheck', {}).catch(() => null);
      b.disabled = false;
      if (!r || !r.ok) { paint(list, `<li class="sc-wait">${esc((r && r.body && r.body.error) || 'The checks run in the copy of Deja Vu1 on your computer.')}</li>`); return; }
      const d = r.body;
      paint(list, d.results.map(x => `<li class="sc ${x.passed ? 'is-pass' : 'is-fail'}"><span class="sc-mark" aria-hidden="true">${x.passed ? '✓' : '✗'}</span>
          <div><b>${esc(x.name)}</b> <span class="sr-only">${x.passed ? 'passed' : 'failed'}</span><p>${esc(x.what)}. ${esc(x.detail)}.</p></div></li>`).join('')
        + `<li class="sc-sum">${d.passed} of ${d.total} passed in ${(d.ms / 1000).toFixed(1)} s on version ${esc(d.version)}. ${esc(d.full_suite)}.</li>`);
    };
  }

  /* After an update or restore the server restarts: wait for the new one, then reload. */
  async function waitForRestart(statusEl) {
    let before = null;
    try { before = (await (await fetch('/api/app/info', { cache: 'no-store' })).json()).server_pid; } catch (_) { /* already stopping */ }
    const started = Date.now();
    const poll = async () => {
      try {
        const info = await (await fetch('/api/app/info', { cache: 'no-store' })).json();
        if (info.server_pid && info.server_pid !== before) { location.reload(); return; }
      } catch (_) { /* not back yet */ }
      if (Date.now() - started < 120000) setTimeout(poll, 1000);
      else if (statusEl) statusEl.textContent = 'The dashboard has not come back yet. Check the launcher window, then reload this page.';
    };
    setTimeout(poll, 1500);
  }
  window.DVWaitForRestart = waitForRestart;

  /* ---- Files: pick up where you left off ---------------------------------- */
  const files = $('tab-files');
  if (files && !$('orca-import')) {
    const box = document.createElement('section');
    box.className = 'card liquid-glass orca-import';
    box.id = 'orca-import';
    box.setAttribute('aria-labelledby', 'oi-title');
    box.innerHTML = `<div class="card-head"><div><h2 id="oi-title">Pick up where you left off</h2>
        <p class="card-sub">Already using Snapmaker Orca or OrcaSlicer? Bring your recent projects into Files and turn your own printer, process and filament presets into a slicing profile here. Nothing in the slicer is changed.</p></div>
        <button class="btn" type="button" id="oi-look">Look on this computer</button></div>
      <div id="oi-body" hidden></div>`;
    const anchor = $('convert-card');
    (anchor || files.firstElementChild).before(box);
    let found = null;
    const opts = (list, keep) => list.filter(keep || (() => true)).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.account ? ` (${esc(p.account)})` : ''}${p.usable ? '' : ' · not usable'}</option>`).join('');
    async function look() {
      const out = $('oi-body'); out.hidden = false;
      paint(out, '<p class="log-empty">Looking for Snapmaker Orca and OrcaSlicer…</p>');
      const data = await getJSON('/api/import/orca').catch(() => null);
      if (!data || data.error || !Array.isArray(data.apps)) {
        paint(out, `<p class="log-empty">${esc((data && data.error) || 'This works in the copy of Deja Vu1 on the computer where your slicer is installed.')}</p>`); return;
      }
      found = data;
      if (!data.found) { paint(out, '<p class="log-empty">Neither Snapmaker Orca nor OrcaSlicer has a settings folder on this computer. If your slicer is on another computer, run Deja Vu1 there, or add projects with Files → Upload.</p>'); return; }
      paint(out, data.apps.map((a, ai) => {
        const p = a.presets, u1 = x => x.u1;
        return `<div class="oi-app"><h3>${esc(a.app)}</h3>
          <div class="oi-cols">
            <div><h4>Recent projects <small>${a.projects.length}</small></h4>
              ${a.projects.length ? `<ul class="oi-projects">${a.projects.map(j => `<li><label><input type="checkbox" value="${esc(j.id)}" data-app="${ai}"${j.in_library ? '' : ' checked'}> <span>${esc(j.name)}</span> <small>${Math.max(1, Math.round(j.bytes / 1024))} KB${j.in_library ? ' · already in Files' : ''}</small></label></li>`).join('')}</ul>
                <button class="btn small primary" type="button" data-bring="${ai}">Copy into Files</button>` : '<p class="log-empty">No recent projects listed.</p>'}</div>
            <div><h4>Your presets <small>${p.machine.length + p.process.length + p.filament.length}</small></h4>
              ${p.machine.length && p.process.length && p.filament.length ? `<form class="oi-profile" data-app="${ai}">
                <label>Printer<select name="machine">${opts(p.machine.filter(u1).concat(p.machine.filter(x => !x.u1)))}</select></label>
                <label>Process<select name="process">${opts(p.process)}</select></label>
                <label>Filament<select name="filament">${opts(p.filament)}</select></label>
                <label>Profile name<input name="name" maxlength="60" placeholder="My Orca settings"></label>
                <button class="btn small primary" type="submit">Make a slicing profile</button>
                <p class="field-hint">Uses your preset files where they are, so later edits in the slicer carry over. Slicing needs to be on (Files › Slicing).</p></form>`
              : `<p class="log-empty">${p.machine.length + p.process.length + p.filament.length ? 'A profile needs one printer, one process and one filament preset of your own.' : 'No presets of your own yet: the slicer’s built-in Snapmaker presets are used through Profiles & tools.'}</p>`}</div>
          </div></div>`;
      }).join('') + `<p class="field-hint">${esc(data.note)}</p>`);
    }
    $('oi-look').onclick = look;
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-bring]');
      if (!b) return;
      const ids = [...box.querySelectorAll(`input[type=checkbox][data-app="${b.dataset.bring}"]:checked`)].map(i => i.value);
      if (!ids.length) { toast('Tick the projects to copy', 'bad'); return; }
      b.disabled = true;
      const r = await postJSON('/api/import/orca/projects', { ids }).catch(() => null);
      b.disabled = false;
      if (r && r.ok) { toast(`Copied ${r.body.added.length} project${r.body.added.length === 1 ? '' : 's'} into Files`, 'ok'); if (window.Workshop && Workshop.loadFiles) Workshop.loadFiles(); look(); }
      else toast((r && r.body && r.body.error) || 'Nothing was copied', 'bad');
    });
    box.addEventListener('submit', async e => {
      const f = e.target.closest('.oi-profile');
      if (!f) return;
      e.preventDefault();
      const fd = new FormData(f);
      const r = await postJSON('/api/import/orca/profile', { name: fd.get('name'), machine: fd.get('machine'), process: fd.get('process'), filaments: [fd.get('filament')] }).catch(() => null);
      if (r && r.ok) { toast('Slicing profile made from your presets', 'ok'); window.dispatchEvent(new CustomEvent('dv-refresh')); }
      else toast((r && r.body && r.body.error) || 'The profile was not made', 'bad');
    });
  }
})();
