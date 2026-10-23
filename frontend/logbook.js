/* Logbook (Care tab): what went wrong on this printer, what fixed it, and the
 * print hours at the time. Pauses and failures the printer reports arrive by
 * themselves (backend/logbook.py), waiting for their fix. Search finds past
 * fixes: type "clog" before you start taking the hotend apart. */
'use strict';
window.Logbook = (() => {
  const tab = document.getElementById('tab-maintenance');
  if (!tab) return null;
  const card = document.createElement('section');
  card.className = 'card liquid-glass logbook';
  card.id = 'logbook';
  card.setAttribute('aria-labelledby', 'lb-title');
  card.innerHTML = `<div class="card-head"><div><h2 id="lb-title">Logbook</h2><p class="card-sub">Problems, what fixed them and the print hours at the time. Reported pauses and failures are added by themselves.</p></div>
      <span class="lb-open" id="lb-open" aria-live="polite"></span></div>
    <form class="lb-add" id="lb-add"><label><span>What happened</span><input id="lb-problem" maxlength="600" placeholder="e.g. T2 under-extruding after a PETG print" required></label>
      <label><span>What fixed it <small>(optional, add it later)</small></span><input id="lb-fix" maxlength="600" placeholder="e.g. cold pull, then re-ran flow calibration"></label>
      <button class="btn primary" type="submit">Add to logbook</button></form>
    <label class="lb-search"><span class="sr-only">Search the logbook</span><input type="search" id="lb-q" placeholder="Search past problems and fixes: clog, warp, dock…" autocomplete="off"></label>
    <ol class="lb-list" id="lb-list"></ol>`;
  const anchor = [...tab.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Maintenance');
  (anchor ? anchor.closest('.card') : tab.firstElementChild).after(card);
  let timer = null, seq = 0;

  async function load() {
    const mine = ++seq, q = $('lb-q').value.trim();
    const data = await getJSON(api('/api/logbook') + (q ? (api('/api/logbook').includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(q) : '')).catch(() => null);
    if (mine !== seq) return;
    if (!data || data.error || !Array.isArray(data.entries)) {
      card.hidden = !!(data && data.module_disabled);
      $('lb-list').innerHTML = `<li class="log-empty">${esc((data && data.error) || 'The logbook is not available.')}</li>`;
      return;
    }
    card.hidden = false;
    $('lb-open').textContent = data.open ? `${data.open} without a fix` : '';
    paint($('lb-list'), data.entries.length ? data.entries.map(e => `<li class="lb-item${e.fix ? '' : ' is-open'}">
        <div class="lb-meta"><time datetime="${esc(e.at)}">${esc(e.at.replace('T', ' ').slice(0, 16))}</time><span>${e.print_hours != null ? `${Number(e.print_hours).toFixed(1)} print h` : 'hours unknown'}</span>${e.auto ? '<span class="lb-tag">reported by printer</span>' : ''}${e.demo ? '<span class="lb-tag">demo</span>' : ''}</div>
        <p class="lb-problem">${esc(e.problem)}</p>
        ${e.fix ? `<p class="lb-fix"><b>Fix:</b> ${esc(e.fix)}</p>` : `<form class="lb-fixform" data-id="${esc(e.id)}"><label class="sr-only" for="lb-f-${esc(e.id)}">What fixed it</label><input id="lb-f-${esc(e.id)}" maxlength="600" placeholder="What fixed it?"><button class="btn small" type="submit">Save fix</button></form>`}
        <button class="lb-del" type="button" data-del="${esc(e.id)}" aria-label="Delete this entry" title="Delete">×</button></li>`).join('')
      : `<li class="log-empty">${q ? `Nothing in the logbook mentions “${esc(q)}”.` : 'Nothing logged yet. When something goes wrong, note it here with what fixed it.'}</li>`);
    $('lb-list').querySelectorAll('.lb-fixform').forEach(f => f.onsubmit = async ev => {
      ev.preventDefault();
      const fix = f.querySelector('input').value.trim();
      if (!fix) return;
      const r = await postJSON(api(`/api/logbook/${encodeURIComponent(f.dataset.id)}/fix`), { fix });
      toast(r.ok ? 'Fix saved' : (r.body.error || 'Could not save'), r.ok ? 'ok' : 'bad');
      load();
    });
    $('lb-list').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const r = await postJSON(api(`/api/logbook/${encodeURIComponent(b.dataset.del)}/delete`), {});
      if (!r.ok) toast(r.body.error || 'Could not delete', 'bad');
      load();
    });
  }
  $('lb-add').onsubmit = async e => {
    e.preventDefault();
    const r = await postJSON(api('/api/logbook/add'), { problem: $('lb-problem').value, fix: $('lb-fix').value });
    if (r.ok) { $('lb-problem').value = ''; $('lb-fix').value = ''; toast('Added to the logbook', 'ok'); } else toast(r.body.error || 'Could not add it', 'bad');
    load();
  };
  $('lb-q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 200); };
  window.addEventListener('dv-tab', e => { if (e.detail === 'maintenance') load(); });
  window.addEventListener('dv-live-event', e => { if (e.detail && e.detail.type === 'print_event' && ['paused', 'failed'].includes(e.detail.event) && !tab.hidden) load(); });
  window.addEventListener('dv-refresh', () => { if (!tab.hidden) load(); });
  return { load };
})();
