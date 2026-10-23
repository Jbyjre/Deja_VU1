/* Farm desk (Printers tab): the planning tools a busy farm needs.
 *
 *  - Dispatch: every printer's running job and queue on one 24-hour
 *    timeline, with your hours shaded and finishes that wait for you marked.
 *  - Best printer: rank the printers for a file by what is loaded (material
 *    first, colour second), the nozzles and when each is free, with reasons.
 *  - Print right now: library files an idle printer can start as loaded.
 *  - Filament outlook: grams the running and queued jobs still need, per
 *    material and colour, against the spools you track.
 *  - Worth printing: filament and electricity cost of a file, per piece, and
 *    what it earns per printer hour at the price you sell it for.
 *
 * Everything is worked out from readings the dashboard already has; nothing
 * is guessed. Unknown figures are shown as unknown. Your hours and prices
 * are remembered in this browser only.
 */
'use strict';
window.FarmDesk = (() => {
  const fleetTab = document.getElementById('tab-fleet');
  if (!fleetTab) return null;
  const STORE = 'dv-desk';
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (_) { return {}; } })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) { /* private window */ } };
  prefs.from = prefs.from ?? 8; prefs.to = prefs.to ?? 22; prefs.prices = prefs.prices || {};
  let data = null, busy = false, timer = null;
  /* An address for one printer (api() would name the selected printer). */
  const at = (path, params) => path + '?' + new URLSearchParams({ ...(demoOn ? { demo: 1 } : {}), ...params });

  const host = document.createElement('section');
  host.className = 'tab-sub desk';
  host.id = 'tab-desk';
  host.setAttribute('aria-labelledby', 'desk-title');
  host.innerHTML = `
    <div class="tab-sub-head"><h2 class="tab-sub-title" id="desk-title">Farm desk</h2>
      <p>Plan the day across every printer: what runs where, when plates need clearing, and what to print next</p></div>
    <section class="card liquid-glass desk-card" aria-labelledby="dk-dispatch-h">
      <div class="card-head"><div><h2 id="dk-dispatch-h">Dispatch</h2><p class="card-sub">Running jobs and each printer's queue on a 24-hour line. Finishes outside your hours wait for you to clear the plate.</p></div>
        <div class="dk-hours" role="group" aria-label="Your hours"><label>Around from <select id="dk-from">${hours(prefs.from)}</select></label><label>to <select id="dk-to">${hours(prefs.to)}</select></label></div></div>
      <div id="dk-timeline" class="dk-timeline" aria-live="polite"></div>
    </section>
    <div class="desk-grid">
      <section class="card liquid-glass desk-card" aria-labelledby="dk-best-h">
        <div class="card-head"><div><h2 id="dk-best-h">Best printer for a file</h2><p class="card-sub">Material first, colour second, then nozzles and when each printer is free.</p></div></div>
        <label class="dk-pick">File <select id="dk-best-file"></select></label>
        <div id="dk-best" class="dk-out"></div>
      </section>
      <section class="card liquid-glass desk-card" aria-labelledby="dk-now-h">
        <div class="card-head"><div><h2 id="dk-now-h">Print right now</h2><p class="card-sub">Files an idle printer can start with exactly what it has loaded.</p></div></div>
        <div id="dk-now" class="dk-out"></div>
      </section>
      <section class="card liquid-glass desk-card" aria-labelledby="dk-fil-h">
        <div class="card-head"><div><h2 id="dk-fil-h">Filament outlook</h2><p class="card-sub">What running and queued jobs still need, against the spools you track.</p></div></div>
        <div id="dk-fil" class="dk-out"></div>
      </section>
      <section class="card liquid-glass desk-card" aria-labelledby="dk-worth-h">
        <div class="card-head"><div><h2 id="dk-worth-h">Worth printing?</h2><p class="card-sub">Cost per piece and earnings per printer hour. A name ending “x24” means 24 pieces on the plate.</p></div></div>
        <div class="dk-worth-form"><label class="dk-pick">File <select id="dk-worth-file"></select></label>
          <label>Pieces <input id="dk-pieces" type="number" min="1" max="999" step="1" inputmode="numeric"></label>
          <label>Sells for, each <input id="dk-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label></div>
        <div id="dk-worth" class="dk-out"></div>
      </section>
    </div>`;
  const anchor = [...fleetTab.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Farm history');
  const before = anchor ? anchor.closest('.card') : null;
  if (before) before.before(host); else fleetTab.append(host);

  function hours(sel) { return Array.from({ length: 25 }, (_, h) => `<option value="${h}"${h === sel ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join(''); }
  const fmtH = h => h == null ? 'unknown' : h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${String(Math.round(h % 1 * 60)).padStart(2, '0')} min`;
  const clock = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const money = n => n == null || !isFinite(n) ? '—' : (Math.round(n * 100) / 100).toFixed(2);

  /* Colour difference in CIE Lab (dE 1976): under 12 reads as the same colour, under 30 as close. */
  function lab(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
    const x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047, y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  function dE(a, b) { const p = lab(a), q = lab(b); return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : null; }

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const [fleet, files, queues, fil, cost] = await Promise.all(['/api/fleet', '/api/files', '/api/fleet/queues', '/api/filament', '/api/cost/settings']
        .map(p => getJSON(api(p)).catch(() => null)));
      const printers = (fleet && fleet.printers) || [];
      const states = await Promise.all(printers.map(p => getJSON(at('/api/printer', { printer: p.id })).catch(() => null)));
      const gcode = ((files && files.files) || []).filter(f => f.kind === 'gcode' && f.summary);
      data = { printers: printers.map((p, i) => ({ ...p, detail: states[i] || {} })), files: gcode,
        queues: (queues && queues.queues) || {}, spools: (fil && fil.spools) || null, cost: cost && cost.filament_price_per_kg ? cost : null };
      const needed = new Set();
      Object.values(data.queues).forEach(q => (q.items || []).forEach(it => needed.add(it.filename)));
      const worth = prefs.worth && gcode.some(f => f.name === prefs.worth) ? prefs.worth : gcode[0] && gcode[0].name;
      if (worth) needed.add(worth);
      const analyses = {};
      await Promise.all([...needed].map(async n => {
        const a = await getJSON(api(at('/api/files/analysis', { name: n }))).catch(() => null);
        if (a && !a.error) analyses[n] = a;
      }));
      data.analyses = analyses;
      render();
    } finally { busy = false; }
  }

  function heads(p) {
    return ['T0', 'T1', 'T2', 'T3'].map(th => {
      const d = (p.detail.toolheads || {})[th] || {}, dock = (p.docks || {})[th] || {};
      return { th, color: d.filament_color_hex || dock.color || null, material: d.filament_material || null,
        loaded: d.filament_loaded !== false && dock.status !== 'error', nozzle: d.nozzle_diameter || null, error: dock.status === 'error' };
    });
  }
  /* For each tool a file uses: the best loaded head, material first then colour. */
  function fit(p, f) {
    const s = f.summary, hs = heads(p), out = [];
    const tools = s.tools_used && s.tools_used.length ? s.tools_used : ['T0'];
    let worst = 'match';
    tools.forEach((t, i) => {
      const want = { color: (s.colours || [])[+t.slice(1)] || (s.colours || [])[i] || null, material: (s.materials || [])[+t.slice(1)] || (s.materials || [])[i] || null };
      const same = hs.find(h => h.th === t);
      const candidates = hs.filter(h => h.loaded && !h.error);
      const score = h => (want.material && h.material && h.material !== want.material ? 1000 : 0) + (dE(want.color, h.color) ?? 60);
      const best = same && same.loaded && !same.error ? same : null;
      const h = best || null;
      const diff = h ? dE(want.color, h.color) : null;
      let verdict = !h ? 'missing' : (want.material && h.material && h.material !== want.material) ? 'material' : diff == null ? 'unknown' : diff < 12 ? 'match' : diff < 30 ? 'close' : 'colour';
      const alt = verdict !== 'match' ? candidates.filter(c => c.th !== t).sort((a, b) => score(a) - score(b))[0] : null;
      out.push({ tool: t, want, head: h, verdict, diff, alt: alt && score(alt) < 12 ? alt.th : null });
      const rank = { match: 0, unknown: 1, close: 2, colour: 3, material: 4, missing: 5 };
      if (rank[verdict] > rank[worst]) worst = verdict;
    });
    return { tools: out, worst };
  }
  function freeIn(p) {
    if (p.state === 'printing' || p.state === 'paused') return p.remaining_hours;
    if (p.state === 'ready' || p.state === 'complete' || p.state === 'standby' || p.state === 'cancelled') return 0;
    return null;
  }

  function render() {
    if (!data) return;
    renderTimeline(); renderBest(); renderNow(); renderFilament(); renderWorth();
  }

  /* ---- Dispatch timeline ---- */
  function renderTimeline() {
    const now = new Date(), span = 24, from = prefs.from, to = prefs.to;
    const hourW = 100 / span;
    const ticks = Array.from({ length: span + 1 }, (_, i) => { const t = new Date(now.getTime() + i * 3600000); return { i, h: t.getHours(), t }; });
    const awake = h => from <= to ? h >= from && h < to : h >= from || h < to;
    const shade = ticks.slice(0, span).filter(t => !awake(t.h)).map(t => `<span class="dk-night" style="left:${t.i * hourW}%;width:${hourW}%"></span>`).join('');
    const nextAwake = t => { const d = new Date(t); for (let k = 0; k < 48 && !awake(d.getHours()); k++) { d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); } return d; };
    const lanes = data.printers.map(p => {
      const bars = [];
      let cursor = now.getTime();
      const push = (label, hours, colors, kind) => {
        if (hours == null) { bars.push(`<span class="dk-bar is-unknown" style="left:${((cursor - now) / 36e5) * hourW}%;width:${hourW * 1.5}%"><b>${esc(label)}</b><i>time unknown</i></span>`); cursor += 1.5 * 36e5; return; }
        const start = cursor, end = cursor + hours * 36e5;
        const left = ((start - now) / 36e5) * hourW, width = Math.max(0.6, hours * hourW);
        const late = !awake(new Date(end).getHours());
        const strip = (colors || []).slice(0, 4).map(c => `<em style="background:${esc(c)}"></em>`).join('');
        bars.push(`<span class="dk-bar is-${kind}${late ? ' is-late' : ''}" style="left:${left}%;width:${width}%" title="${esc(label)} · ${fmtH(hours)} · ends ${clock(new Date(end))}${late ? ' · waits for you' : ''}"><span class="dk-strip">${strip}</span><b>${esc(label)}</b><i>ends ${clock(new Date(end))}</i></span>`);
        cursor = end;
        if (late) {
          const clear = nextAwake(end).getTime() + 5 * 60000;
          bars.push(`<span class="dk-wait" style="left:${((end - now) / 36e5) * hourW}%;width:${Math.max(0.4, ((clear - end) / 36e5) * hourW)}%" title="Plate waits until ${clock(new Date(clear))}"></span>`);
          cursor = clear;
        } else cursor += 5 * 60000;          // five minutes to clear the plate
      };
      if (p.state === 'printing' || p.state === 'paused') {
        // Without a reported remaining time, estimate it from progress and time spent so far.
        const d = p.detail, est = p.remaining_hours ?? (d.progress > 0.02 && d.print_duration_hours ? d.print_duration_hours * (1 - d.progress) / d.progress : null);
        push((p.current_file || 'Current print') + (p.remaining_hours == null && est != null ? ' (estimated from progress)' : ''), est, [p.active_color], p.state === 'paused' ? 'paused' : 'run');
      }
      const q = (data.queues[p.id] || {}).items || [];
      q.filter(it => !it.status || it.status === 'waiting' || it.status === 'queued').forEach(it => {
        const f = data.files.find(x => x.name === it.filename), a = data.analyses[it.filename];
        push(it.filename, (a && a.estimated_hours) ?? (f && f.summary.estimated_hours) ?? null, f && f.summary.colours, 'queued');
      });
      const status = p.state === 'printing' ? `${Math.round((p.progress || 0) * 100)}% · ${fmtH(p.remaining_hours)} left` : p.state_message || p.state;
      return `<div class="dk-lane"><div class="dk-name"><b>${esc(p.name)}</b><small class="is-${esc(p.state)}">${esc(status)}</small></div>
        <div class="dk-track">${shade}${bars.join('') || '<span class="dk-idle">Idle · queue empty</span>'}</div></div>`;
    }).join('');
    const ruler = ticks.filter(t => t.i % 3 === 0).map(t => `<span style="left:${t.i * hourW}%">${String(t.h).padStart(2, '0')}:00</span>`).join('');
    $('dk-timeline').innerHTML = data.printers.length ? `<div class="dk-scroll"><div class="dk-grid">
        <div class="dk-lane dk-ruler-row"><div class="dk-name"><small>${clock(now)} now</small></div><div class="dk-track dk-ruler">${ruler}<span class="dk-now" aria-hidden="true"></span></div></div>
        ${lanes}</div></div>
      <p class="dk-key"><span class="dk-k is-run"></span>printing <span class="dk-k is-paused"></span>paused <span class="dk-k is-queued"></span>queued <span class="dk-k is-wait"></span>waits for you <span class="dk-k is-night"></span>outside your hours · Times are the slicer's estimates; real prints run longer or shorter.</p>`
      : `<p class="log-empty">No printers yet. Add one below, or turn on Demo data to see the simulated farm.</p>`;
  }

  /* ---- Best printer ---- */
  function fileOptions(sel, current) {
    sel.innerHTML = data.files.length ? data.files.map(f => `<option value="${esc(f.name)}"${f.name === current ? ' selected' : ''}>${esc(f.name)}</option>`).join('') : '<option value="">No G-code files yet</option>';
  }
  function renderBest() {
    const sel = $('dk-best-file');
    fileOptions(sel, prefs.best);
    const f = data.files.find(x => x.name === sel.value);
    if (!f || !data.printers.length) { $('dk-best').innerHTML = `<p class="log-empty">${data.files.length ? 'No printers to compare.' : 'Add G-code files (or the sample files) to compare printers.'}</p>`; return; }
    const rank = { match: 0, unknown: 1, close: 2, colour: 3, material: 4, missing: 5 };
    const rows = data.printers.map(p => ({ p, fit: fit(p, f), free: freeIn(p) }))
      .sort((a, b) => rank[a.fit.worst] - rank[b.fit.worst] || (a.free ?? 99) - (b.free ?? 99));
    const word = { match: 'Loaded as sliced', close: 'Close colours', colour: 'Different colour', material: 'Different material', missing: 'Head missing or faulted', unknown: 'Colour unknown' };
    $('dk-best').innerHTML = `<table class="dk-table"><thead><tr><th scope="col">Printer</th><th scope="col">Heads the file uses</th><th scope="col">Free in</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i === 0 && rank[r.fit.worst] <= 2 ? 'is-best' : ''}"><th scope="row">${esc(r.p.name)}${i === 0 && rank[r.fit.worst] <= 2 ? '<span class="dk-pill">best</span>' : ''}<small>${esc(word[r.fit.worst])}</small></th>
        <td><span class="dk-heads">${r.fit.tools.map(t => `<span class="dk-head is-${t.verdict}" title="${esc(t.tool)}: file wants ${esc(t.want.material || '')} ${esc(t.want.color || '')}; loaded ${esc(t.head ? (t.head.material || '') + ' ' + (t.head.color || '') : 'nothing')}${t.diff != null ? ` (difference ${Math.round(t.diff)})` : ''}${t.alt ? `; ${t.alt} has a better match` : ''}"><i style="background:${esc(t.want.color || '#ccc')}"></i><i style="background:${esc(t.head && t.head.color || 'transparent')}"></i>${esc(t.tool)}</span>`).join('')}</span></td>
        <td class="dk-num">${r.free == null ? 'unknown' : r.free === 0 ? 'now' : fmtH(r.free)}</td>
        <td><button class="btn small" type="button" data-route="${esc(r.p.id)}"${rank[r.fit.worst] >= 4 ? ' disabled title="Fix the loaded filament first"' : ''}>Queue here</button></td></tr>`).join('')}
      </tbody></table><p class="dk-note">Each pair of dots is what the file was sliced for, then what that head has loaded. Confirm Print checks everything again before a print starts.</p>`;
    $('dk-best').querySelectorAll('[data-route]').forEach(b => b.onclick = async () => {
      const r = await postJSON(api('/api/fleet/route'), { filename: f.name, to: b.dataset.route });
      toast(r.ok ? `Queued ${f.name} on ${data.printers.find(p => p.id === b.dataset.route).name}` : (r.body.error || 'Could not queue it'), r.ok ? 'ok' : 'bad', 6000);
      if (r.ok) load();
    });
  }

  /* ---- Print right now ---- */
  function renderNow() {
    const idle = data.printers.filter(p => freeIn(p) === 0);
    if (!idle.length) { $('dk-now').innerHTML = `<p class="log-empty">${data.printers.length ? 'Every printer is busy. The timeline shows when each is free.' : 'No printers yet.'}</p>`; return; }
    $('dk-now').innerHTML = idle.map(p => {
      const ok = data.files.map(f => ({ f, fit: fit(p, f) })).filter(x => x.fit.worst === 'match' && x.f.summary.preflight !== 'blocked')
        .sort((a, b) => (a.f.summary.estimated_hours || 0) - (b.f.summary.estimated_hours || 0));
      return `<div class="dk-now-p"><h3>${esc(p.name)} <small>${heads(p).map(h => `<i class="dk-dot" style="background:${esc(h.color || 'transparent')}" title="${esc(h.th)}${h.error ? ' · fault' : ''}"></i>`).join('')}</small></h3>
        ${ok.length ? `<ul class="dk-list">${ok.slice(0, 6).map(x => `<li><button class="link-btn" type="button" data-open="${esc(x.f.name)}">${esc(x.f.name)}</button><span>${fmtH(x.f.summary.estimated_hours)} · ${x.f.summary.filament_grams ?? '?'} g</span></li>`).join('')}</ul>`
          : '<p class="log-empty">No library file matches what is loaded.</p>'}</div>`;
    }).join('');
    $('dk-now').querySelectorAll('[data-open]').forEach(b => b.onclick = () => { showTab('files'); if (window.Workshop) Workshop.openFile(b.dataset.open); });
  }

  /* ---- Filament outlook ---- */
  function renderFilament() {
    const need = {};
    const add = (material, color, grams) => {
      if (!grams) return;
      const key = `${material || '?'}|${(color || '?').toLowerCase()}`;
      need[key] = need[key] || { material: material || 'Unknown material', color: color || null, grams: 0 };
      need[key].grams += grams;
    };
    let unknown = 0;
    data.printers.forEach(p => {
      ((data.queues[p.id] || {}).items || []).filter(it => !it.status || it.status === 'waiting' || it.status === 'queued').forEach(it => {
        const a = data.analyses[it.filename], f = data.files.find(x => x.name === it.filename);
        if (a && a.filament_grams_by_tool) Object.entries(a.filament_grams_by_tool).forEach(([t, g]) => add((f && f.summary.materials || [])[+t.slice(1)], (f && f.summary.colours || [])[+t.slice(1)], g));
        else unknown++;
      });
    });
    const rows = Object.values(need).sort((a, b) => b.grams - a.grams);
    if (!rows.length) { $('dk-fil').innerHTML = `<p class="log-empty">Nothing queued${unknown ? ` with known filament use (${unknown} queued file${unknown > 1 ? 's' : ''} without per-head figures)` : ''}. Queue files to see what they will use.</p>`; return; }
    const spools = data.spools;
    $('dk-fil').innerHTML = `<table class="dk-table"><thead><tr><th scope="col">Filament</th><th scope="col" class="dk-num">Queued needs</th><th scope="col" class="dk-num">On spools</th><th scope="col">Outlook</th></tr></thead><tbody>
      ${rows.map(r => {
        const have = spools && spools.length ? spools.filter(s => s.material === r.material && (dE(s.color_hex, r.color) ?? 99) < 12).reduce((t, s) => t + (s.grams_remaining || 0), 0) : null;
        const short = have != null ? r.grams - have : null;
        return `<tr><th scope="row"><i class="dk-dot" style="background:${esc(r.color || 'transparent')}"></i>${esc(r.material)}<small>${esc(r.color || '')}</small></th>
          <td class="dk-num">${Math.round(r.grams)} g</td><td class="dk-num">${have == null ? '—' : Math.round(have) + ' g'}</td>
          <td>${have == null ? '<span class="dk-tag">no spools tracked</span>' : short > 0 ? `<span class="dk-tag is-bad">short ${Math.round(short)} g</span>` : `<span class="dk-tag is-ok">covered</span>`}</td></tr>`;
      }).join('')}</tbody></table>
      <p class="dk-note">From the slicer's per-head figures for each queued file${unknown ? `; ${unknown} file${unknown > 1 ? 's' : ''} had none and ${unknown > 1 ? 'are' : 'is'} left out` : ''}. Spools are matched by material and a close colour. Track spools in Care → Filament inventory.</p>`;
  }

  /* ---- Worth printing ---- */
  function piecesFrom(name) { const m = /(?:^|[\s_\-([])(?:x\s?|×)(\d{1,3})(?=$|[\s_\-)\].])|(?:^|[\s_\-([])(\d{1,3})x(?=$|[\s_\-)\].])/i.exec(name.replace(/\.gcode$/i, '')); return m ? +(m[1] || m[2]) : 1; }
  function renderWorth() {
    const sel = $('dk-worth-file');
    fileOptions(sel, prefs.worth);
    const f = data.files.find(x => x.name === sel.value);
    if (!f) { $('dk-worth').innerHTML = '<p class="log-empty">Add G-code files to price them.</p>'; return; }
    const saved = prefs.prices[f.name] || {};
    if (document.activeElement !== $('dk-pieces')) $('dk-pieces').value = saved.pieces || piecesFrom(f.name);
    if (document.activeElement !== $('dk-price')) $('dk-price').value = saved.price ?? '';
    const pieces = Math.max(1, +$('dk-pieces').value || 1), price = $('dk-price').value === '' ? null : +$('dk-price').value;
    const s = f.summary, a = data.analyses[f.name];
    const byTool = a && a.filament_grams_by_tool;
    const cost = data.cost;
    let filament = null, note = '';
    if (cost && byTool) {
      filament = Object.entries(byTool).reduce((t, [tool, g]) => { const m = (s.materials || [])[+tool.slice(1)] || 'PLA'; return t + g / 1000 * (cost.filament_price_per_kg[m] ?? cost.filament_price_per_kg.PLA ?? 0); }, 0);
    } else if (cost && s.filament_grams != null) {
      const m = (s.materials || [])[0] || 'PLA';
      filament = s.filament_grams / 1000 * (cost.filament_price_per_kg[m] ?? 0);
      note = 'Priced at the first material’s rate (no per-head figures for this file). ';
    }
    const power = cost && s.estimated_hours != null ? s.estimated_hours * (cost.printer_watts / 1000) * cost.electricity_rate_per_kwh : null;
    const total = filament != null && power != null ? filament + power : null;
    const each = total != null ? total / pieces : null;
    const revenue = price != null ? price * pieces : null;
    const perHour = revenue != null && total != null && s.estimated_hours ? (revenue - total) / s.estimated_hours : null;
    $('dk-worth').innerHTML = cost ? `<dl class="dk-facts">
        <div><dt>Filament</dt><dd>${money(filament)}</dd></div><div><dt>Electricity</dt><dd>${money(power)}</dd></div>
        <div><dt>Cost per piece</dt><dd>${money(each)}</dd></div><div><dt>Print time</dt><dd>${fmtH(s.estimated_hours)}</dd></div>
        <div><dt>Plate brings in</dt><dd>${money(revenue)}</dd></div><div><dt>Margin</dt><dd>${revenue != null && total != null ? money(revenue - total) + (revenue ? ` · ${Math.round((revenue - total) / revenue * 100)}%` : '') : '—'}</dd></div>
        <div class="is-key"><dt>Per printer hour</dt><dd>${money(perHour)}</dd></div></dl>
        <p class="dk-note">${note}Rates from Settings → Print cost pricing. Labour, wear and failed prints are not included. Prices are kept in this browser.</p>`
      : '<p class="log-empty">Turn on the Print cost module in Settings → Modules to price files.</p>';
  }

  function wire() {
    $('dk-from').onchange = () => { prefs.from = +$('dk-from').value; save(); renderTimeline(); };
    $('dk-to').onchange = () => { prefs.to = +$('dk-to').value; save(); renderTimeline(); };
    $('dk-best-file').onchange = () => { prefs.best = $('dk-best-file').value; save(); renderBest(); };
    $('dk-worth-file').onchange = async () => {
      prefs.worth = $('dk-worth-file').value; save();
      if (!data.analyses[prefs.worth]) {
        const a = await getJSON(api(at('/api/files/analysis', { name: prefs.worth }))).catch(() => null);
        if (a && !a.error) data.analyses[prefs.worth] = a;
      }
      renderWorth();
    };
    const keep = () => { const f = $('dk-worth-file').value; if (!f) return; prefs.prices[f] = { pieces: +$('dk-pieces').value || 1, price: $('dk-price').value === '' ? null : +$('dk-price').value }; save(); renderWorth(); };
    $('dk-pieces').oninput = keep; $('dk-price').oninput = keep;
    window.addEventListener('dv-tab', e => { if (e.detail === 'fleet') { load(); clearInterval(timer); timer = setInterval(() => { if (!fleetTab.hidden && !document.hidden) load(); }, 30000); } else clearInterval(timer); });
    window.addEventListener('dv-refresh', () => { if (!fleetTab.hidden) load(); });
  }
  wire();
  if (!fleetTab.hidden) load();
  return { load, fit, dE, piecesFrom };
})();
