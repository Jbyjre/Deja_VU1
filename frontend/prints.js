/* Deja Vu1 - Prints: a record of every print (FLOW.4).
 *
 * Printer › Prints. Running and queued prints first, then every ended print day by day, searchable. A print opens
 * to its end picture, real against estimated time, filament per head and the spools, the cost, a note, and
 * Reprint, Open in Slicer and Time-lapse. The record lives on this computer (backend/print_record.py) and is kept
 * for the time chosen here; the printer's own history fills in prints Deja Vu1 was not running for.
 */
'use strict';
(() => {
  const card = $('prints-card');
  if (!card) return;
  const body = $('prints-body'), search = $('prints-q'), keep = $('prints-keep');
  const PAGE = 60;
  const WORD = { running: 'Printing', finished: 'Finished', failed: 'Failed', cancelled: 'Stopped', unknown: 'Ended', queued: 'Queued', held: 'Waiting for a clear bed' };
  let data = null, shown = PAGE, open = null, seq = 0, timer = 0;

  const stamp = iso => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d; };
  const clock = iso => { const d = stamp(iso); return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };
  const hours = h => (window.Workshop ? Workshop.fmtHours(h) : `${h} h`);
  const grams = g => (g == null || !isFinite(g) ? null : g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`);
  const dayOf = iso => {
    const d = stamp(iso);
    if (!d) return 'Date not known';
    const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((start(new Date()) - start(d)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  const apiWith = path => (demoOn ? `${path}${path.includes('?') ? '&' : '?'}demo=1` : path);

  /* The line under the file name: where, how long against the estimate, how much filament. */
  function subLine(p) {
    const bits = [p.printer_name || p.printer || ''];
    if (p.status === 'running') bits.push(p.estimated_hours ? `about ${hours(p.estimated_hours)} in all` : 'printing now');
    else if (p.real_hours != null) bits.push(p.estimated_hours ? `${hours(p.real_hours)} of ${hours(p.estimated_hours)} estimated` : hours(p.real_hours));
    const g = grams(p.grams != null ? p.grams : p.heads && p.heads.reduce((t, h) => t + (h.grams_in_file || 0), 0) || null);
    if (g) bits.push(`${p.grams_estimated || p.grams == null ? 'about ' : ''}${g}${p.material ? ` ${p.material}` : ''}`);
    return bits.filter(Boolean).join(' · ');
  }

  function row(p) {
    const isOpen = open === p.id;
    return `<li class="pr-item${isOpen ? ' is-open' : ''}" data-status="${esc(p.status)}">
      <button class="pr-row" type="button" data-open="${esc(p.id)}" aria-expanded="${isOpen}" aria-controls="pr-d-${esc(p.id)}">
        <span class="pr-dot" aria-hidden="true"></span>
        ${p.picture ? `<img class="pr-thumb" src="/api/prints/picture?id=${encodeURIComponent(p.id)}" alt="" loading="lazy">` : '<span class="pr-thumb is-none" aria-hidden="true"></span>'}
        <span class="pr-main"><b class="pr-file">${esc(p.file || 'Unnamed print')}</b><small class="pr-sub">${esc(subLine(p))}</small></span>
        <span class="pr-when"><span class="pr-state">${esc(WORD[p.status] || p.status)}</span><span class="pr-time">${esc(clock(p.started_at || p.ended_at))}</span></span>
      </button>
      ${isOpen ? detail(p) : ''}</li>`;
  }

  /* One print, opened: what it took, what it cost and what to do with it next. */
  function detail(p) {
    const diff = p.real_hours != null && p.estimated_hours ? Math.round((p.real_hours - p.estimated_hours) * 60) : null;
    const vs = diff == null ? '' : Math.abs(diff) < 2 ? 'On the estimate' : diff > 0 ? `${hours(diff / 60)} longer than the estimate` : `${hours(-diff / 60)} quicker than the estimate`;
    const pic = p.picture ? `<img class="pr-pic" src="/api/prints/picture?id=${encodeURIComponent(p.id)}" alt="The bed when ${esc(p.file || 'the print')} ended">`
      : `<p class="pr-pic is-none">${p.status === 'running' ? 'A picture of the bed is taken when the print ends.'
        : p.from_printer ? 'From the printer’s own history. Deja Vu1 was not running then, so there is no picture, cost or note.'
        : 'No picture: the camera was off or did not answer when the print ended.'}</p>`;
    const heads = (p.heads || []).map(h => `<li><span class="pr-swatch" style="--c:${/^#[0-9a-f]{6}$/i.test(h.colour || '') ? h.colour : 'transparent'}" aria-hidden="true"></span>
        <b>${esc(String(h.toolhead || '').replace(/^T(\d)$/, (_, n) => `Head ${+n + 1}`))}</b>
        <span>${esc([h.colour_name, h.material].filter(Boolean).join(' ') || 'Filament not known')}${h.grams_in_file ? ` · ${esc(grams(h.grams_in_file))} in the file` : ''}${h.spool ? ` · spool ${esc(h.spool)}` : ''}</span></li>`).join('');
    const ro = (label, value) => `<div class="ro"><span>${label}</span><b>${value}</b></div>`;
    const g = grams(p.grams);
    return `<div class="pr-detail" id="pr-d-${esc(p.id)}">
      <div class="pr-look">${pic}</div>
      <div class="pr-facts">
        <div class="readouts">
          ${ro('Took', p.real_hours != null ? esc(hours(p.real_hours)) : p.status === 'running' ? 'Printing' : '—')}
          ${ro('Estimated', p.estimated_hours ? esc(hours(p.estimated_hours)) : '—')}
          ${ro('Filament', g ? `${p.grams_estimated ? 'about ' : ''}${esc(g)}` : p.grams_in_file ? `${esc(grams(p.grams_in_file))} planned` : '—')}
          ${ro('Cost', p.cost != null ? esc(money(p.cost)) : '—')}
        </div>
        ${vs ? `<p class="pr-vs">${esc(vs)}.</p>` : ''}
        ${p.ended_because ? `<p class="pr-why">Why it ended: ${esc(p.ended_because)}</p>` : ''}
        <p class="pr-span">${stamp(p.started_at) ? `Started ${esc(stamp(p.started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}` : 'Start time not recorded'}${p.ended_at ? `, ended ${esc(clock(p.ended_at))}` : ''}${p.joined_late ? (p.status === 'running' ? ' (it was already printing when Deja Vu1 started watching)' : ' (Deja Vu1 saw only the end)') : ''}.</p>
        ${heads ? `<ul class="pr-heads" aria-label="Filament per head">${heads}</ul>` : ''}
        ${p.from_printer ? '' : `<label class="pr-note"><span>Note</span><textarea rows="2" maxlength="1000" data-note="${esc(p.id)}" placeholder="What you changed, what worked, what to try next">${esc(p.note || '')}</textarea></label>`}
        <div class="pr-acts">
          <button class="btn small primary" type="button" data-reprint="${esc(p.file || '')}"${p.in_library && p.status !== 'running' ? '' : ' disabled'}>Reprint</button>
          ${p.model ? `<button class="btn small" type="button" data-slicer="${esc(p.model)}">Open in Slicer</button>` : ''}
          ${p.timelapse ? `<button class="btn small" type="button" data-tl="${esc(p.timelapse)}" data-tl-printer="${esc(p.printer || '')}" data-tl-name="${esc(p.file || '')}">Time-lapse</button>` : ''}
          ${p.from_printer || p.status === 'running' ? '' : `<button class="btn small ghost" type="button" data-forget="${esc(p.id)}">Remove</button>`}
        </div>
        ${!p.in_library && p.status !== 'running' ? `<p class="pr-hint">${p.from_printer ? 'This file is on the printer, not in Files. Add it to Files to reprint it from here.' : 'Reprint needs the file in Files. Add it there again to print it from here.'}</p>` : ''}
      </div></div>`;
  }

  function draw() {
    if (!data) return;
    const q = search.value.trim();
    const now = (data.prints || []).filter(p => p.status === 'running');
    const ended = (data.prints || []).filter(p => p.status !== 'running');
    const queued = q ? [] : (data.queued || []);
    if (!now.length && !ended.length && !queued.length) {
      paint(body, `<p class="log-empty">${q ? `Nothing in the record matches “${esc(q)}”.`
        : 'No prints yet. Every print from now on is kept here from start to end, with a picture of the bed when it ends.'}</p>`);
      return;
    }
    let html = '';
    if (now.length || queued.length) {
      html += `<h3 class="pr-day">Now</h3><ul class="pr-list">${now.map(row).join('')}${queued.map(j => `<li class="pr-item" data-status="${esc(j.status)}">
        <div class="pr-row is-static"><span class="pr-dot" aria-hidden="true"></span><span class="pr-thumb is-none" aria-hidden="true"></span>
        <span class="pr-main"><b class="pr-file">${esc(j.file || 'Queued print')}</b><small class="pr-sub">${esc(j.note || 'In the queue. It starts only after you confirm the bed is clear.')}</small></span>
        <span class="pr-when"><span class="pr-state">${esc(WORD[j.status] || j.status)}</span></span></div></li>`).join('')}</ul>`;
    }
    let day = null;
    const page = ended.slice(0, shown);
    page.forEach((p, i) => {
      const d = dayOf(p.started_at || p.ended_at);
      if (d !== day) { html += `${i ? '</ul>' : ''}<h3 class="pr-day">${esc(d)}</h3><ul class="pr-list">`; day = d; }
      html += row(p);
    });
    if (page.length) html += '</ul>';
    if (ended.length > shown) html += `<button class="btn small pr-more" type="button" data-more>Show ${Math.min(PAGE, ended.length - shown)} more of ${ended.length - shown}</button>`;
    paint(body, html);
  }

  async function load() {
    const mine = ++seq;
    const q = search.value.trim();
    const res = await getJSON(apiWith(`/api/prints${q ? `?q=${encodeURIComponent(q)}` : ''}`)).catch(() => null);
    if (mine !== seq) return;
    if (!res || !Array.isArray(res.prints)) {
      if (!data) paint(body, `<p class="log-empty">${esc((res && res.error) || 'The record of prints belongs to the copy of Deja Vu1 running on your computer.')}</p>`);
      return;
    }
    data = res;
    if (keep && res.settings && document.activeElement !== keep) keep.value = String(res.settings.keep_days);
    $('prints-sub').textContent = demoOn
      ? 'Simulated prints (demo data). With a real U1 every print is kept here from start to end, on this computer.'
      : 'Every print, day by day, with its end picture, time and filament. Kept on this computer.';
    draw();
  }

  search.addEventListener('input', () => { clearTimeout(timer); shown = PAGE; timer = setTimeout(load, 220); });
  if (keep) keep.addEventListener('change', async () => {
    const days = +keep.value;
    if (days && data && days < data.settings.keep_days
        && !confirm(`Keep prints for ${days} days? Prints older than that are removed from this computer now.`)) { keep.value = String(data.settings.keep_days); return; }
    const r = await postJSON('/api/prints/settings', { keep_days: days }).catch(() => null);
    if (!r || !r.ok) { toast((r && r.body && r.body.error) || 'The setting was not changed', 'bad'); return; }
    toast(r.body.removed ? `Kept for ${days ? `${days} days` : 'always'}. ${r.body.removed} older prints removed.` : `Prints are kept ${days ? `for ${days} days` : 'always'}.`, 'ok');
    load();
  });

  body.addEventListener('click', async e => {
    const hit = s => e.target.closest(s);
    let b;
    if ((b = hit('[data-more]'))) { shown += PAGE; draw(); return; }
    if ((b = hit('[data-open]'))) {
      open = open === b.dataset.open ? null : b.dataset.open;
      draw();
      const again = body.querySelector(`[data-open="${CSS.escape(b.dataset.open)}"]`);
      if (again) again.focus();
      return;
    }
    if ((b = hit('[data-reprint]'))) { if (window.Workshop) Workshop.openConfirm(b.dataset.reprint, b); return; }
    if ((b = hit('[data-slicer]'))) { if (window.Slicer) Slicer.open(b.dataset.slicer); return; }
    if ((b = hit('[data-tl]'))) {
      if (window.Player) Player.frames(b.dataset.tl, { printer: b.dataset.tlPrinter, title: b.dataset.tlName });
      return;
    }
    if ((b = hit('[data-forget]'))) {
      if (!confirm('Remove this print from the record? Its picture and note are deleted from this computer.')) return;
      const r = await postJSON('/api/prints/forget', { id: b.dataset.forget }).catch(() => null);
      if (r && r.ok) { open = null; toast('Removed from the record', 'ok'); load(); } else toast((r && r.body && r.body.error) || 'Nothing was removed', 'bad');
    }
  });
  /* A note is saved when you leave the box, so there is no Save button to forget. */
  body.addEventListener('change', async e => {
    const t = e.target.closest('[data-note]');
    if (!t) return;
    const r = await postJSON('/api/prints/note', { id: t.dataset.note, note: t.value }).catch(() => null);
    if (r && r.ok) {
      const p = data && data.prints.find(x => x.id === t.dataset.note);
      if (p) p.note = r.body.note;
      toast('Note saved', 'ok');
    } else toast((r && r.body && r.body.error) || 'The note was not saved', 'bad');
  });

  window.addEventListener('dv-tab', e => { if (e.detail === 'control') load(); });
  window.addEventListener('dv-refresh', () => { if (!$('tab-control').hidden) load(); });
  window.addEventListener('dv-live-event', e => {
    if (e.detail && e.detail.type === 'print_event' && ['started', 'finished', 'failed', 'cancelled'].includes(e.detail.event)) setTimeout(load, 400);
  });
  setTimeout(load, 700);
  window.Prints = { load, open: id => { open = id; draw(); } };
})();
