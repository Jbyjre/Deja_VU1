/* Telemetry (Overview): the selected printer's live readings in one dense,
 * instrument-style panel. Every head's temperature against its target with
 * a short trace, filament, nozzle and dock counters; bed, chamber, position,
 * layer and timing. Readings come straight from the live state (dv-state);
 * the only derived figure is the remaining time from progress when the
 * printer reports none, and it says so. Traces are kept in memory only.
 */
'use strict';
window.Telemetry = (() => {
  const attention = document.getElementById('attention');
  if (!attention) return null;
  const card = document.createElement('section');
  card.className = 'card liquid-glass telemetry';
  card.id = 'telemetry';
  card.setAttribute('aria-labelledby', 'tm-title');
  card.hidden = true;
  card.innerHTML = `<div class="card-head"><div><h2 id="tm-title">Telemetry</h2><p class="card-sub" id="tm-sub">Live readings from the selected printer</p></div>
    <span class="tm-rate" id="tm-rate" aria-hidden="true"></span></div><div id="tm-body"></div>`;
  attention.after(card);
  const HISTORY = 90;
  const traces = {};
  let last = 0, printer = null, samples = 0, firstAt = 0;

  const num = (v, d = 1) => v == null || !isFinite(v) ? '—' : Number(v).toFixed(d);
  const dur = h => { if (h == null || !isFinite(h)) return '—'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  function trace(key, value) {
    const t = traces[key] || (traces[key] = []);
    if (value != null && isFinite(value)) t.push(value);
    if (t.length > HISTORY) t.shift();
    return t;
  }
  function spark(values, target) {
    if (values.length < 2) return '<svg class="tm-spark" viewBox="0 0 90 22" aria-hidden="true"></svg>';
    const lo = Math.min(...values, target || Infinity) - 2, hi = Math.max(...values, target || 0) + 2, span = hi - lo || 1;
    const x = i => (i / (HISTORY - 1)) * 90, y = v => 21 - ((v - lo) / span) * 20;
    const off = HISTORY - values.length;
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i + off).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    const t = target ? `<path class="tm-target" d="M0 ${y(target).toFixed(1)}H90"/>` : '';
    return `<svg class="tm-spark" viewBox="0 0 90 22" aria-hidden="true">${t}<path class="tm-line" d="${d}"/></svg>`;
  }
  function bar(actual, target, max) {
    const a = Math.max(0, Math.min(1, (actual || 0) / max)), t = target ? Math.max(0, Math.min(1, target / max)) : null;
    return `<span class="tm-bar" aria-hidden="true"><i style="width:${(a * 100).toFixed(1)}%"></i>${t != null ? `<b style="left:${(t * 100).toFixed(1)}%"></b>` : ''}</span>`;
  }

  function render(st) {
    if (st.printer_id !== printer) { printer = st.printer_id; Object.keys(traces).forEach(k => delete traces[k]); samples = 0; firstAt = Date.now(); }
    samples++;
    const heads = st.toolheads || {};
    Object.entries(heads).forEach(([th, h]) => trace(th, h.temperature));
    trace('bed', st.bed_temperature); trace('chamber', st.chamber_temperature);
    const now = Date.now();
    if (now - last < 1000) return;          // the panel redraws once a second; traces keep every reading
    last = now;
    card.hidden = false;
    const p = st.progress || 0, printing = st.state === 'printing' || st.state === 'paused';
    const reported = st.remaining_hours ?? null;
    const est = reported ?? (printing && p > 0.02 && st.print_duration_hours ? st.print_duration_hours * (1 - p) / p : null);
    const eta = est != null ? new Date(now + est * 3600000) : null;
    const pos = st.toolhead_position || [];
    const layer = st.layer || {};
    $('tm-sub').textContent = `${st.printer_name || 'Printer'} · ${st.state_message || st.state}`;
    $('tm-rate').textContent = `${samples} readings · ${Math.round((now - firstAt) / 1000)} s`;
    const kv = [
      ['State', esc(st.state || '—')], ['File', esc(st.current_file || '—')],
      ['Layer', layer.total ? `${layer.current} / ${layer.total}` : '—'], ['Z', pos[2] != null ? `${num(pos[2], 2)} mm` : '—'],
      ['Progress', printing ? `${num(p * 100, 1)} %` : '—'], ['Elapsed', printing ? dur(st.print_duration_hours) : '—'],
      [reported == null && est != null ? 'Remaining (est.)' : 'Remaining', printing ? dur(est) : '—'], ['Done at', eta ? eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'],
      ['Active head', esc(st.active_toolhead || '—')], ['Position X / Y', pos.length ? `${num(pos[0], 1)} / ${num(pos[1], 1)}` : '—'],
    ];
    const rows = Object.entries(heads).map(([th, h]) => `<tr class="${th === st.active_toolhead ? 'is-active' : ''}">
        <th scope="row"><span class="tm-th">${esc(th)}</span></th>
        <td><span class="tm-status is-${esc(h.status || 'unknown')}">${esc(h.status || '—')}</span></td>
        <td class="tm-temp"><b>${num(h.temperature)}</b><small>/ ${h.target_temperature ? num(h.target_temperature, 0) : 'off'} °C</small>${bar(h.temperature, h.target_temperature, 320)}</td>
        <td>${spark(traces[th] || [], h.target_temperature)}</td>
        <td><span class="tm-fil"><i style="background:${esc(h.filament_color_hex || 'transparent')}"></i>${esc(h.filament_material || '')} ${esc(h.filament_color_name || (h.filament_loaded === false ? 'empty' : ''))}</span></td>
        <td class="tm-num">${h.nozzle_diameter != null ? num(h.nozzle_diameter, 1) + ' mm' : '—'}</td>
        <td class="tm-num">${h.swaps ?? '—'}<small> · ${h.swap_retries ?? 0} retry · ${h.swap_errors ?? 0} err</small></td></tr>`).join('');
    const env = [['Bed', st.bed_temperature, st.bed_target, 'bed', 120], ['Chamber', st.chamber_temperature, null, 'chamber', 70]].map(([label, a, t, key, max]) => `
      <div class="tm-env"><span>${label}</span><b>${num(a)}</b><small>${t ? `/ ${num(t, 0)} °C` : '°C'}</small>${bar(a, t, max)}${spark(traces[key] || [], t)}</div>`).join('');
    paint($('tm-body'), `<dl class="tm-kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="tm-envs">${env}</div>
      <div class="tm-scroll"><table class="tm-table"><thead><tr><th scope="col">Head</th><th scope="col">Dock</th><th scope="col">Nozzle °C</th><th scope="col">Last ${HISTORY} readings</th><th scope="col">Filament</th><th scope="col">Nozzle</th><th scope="col">Swaps</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${reported == null && est != null ? '<p class="tm-note">Remaining time is estimated from progress and time spent so far; the printer did not report one.</p>' : ''}`);
  }
  window.addEventListener('dv-state', e => { if (e.detail) render(e.detail); });
  window.addEventListener('dv-refresh', () => { if (!demoOn && !lastPrinterState) card.hidden = true; });
  return { render };
})();
