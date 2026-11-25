/* replay.js: replay an ended print on the 3D twin (RECALL.2).
 *
 * Printer › Prints and the history line in Files open a print here. The twin draws the print from its own G-code up to
 * the layer you pick, with the head where it was at the end of that layer. Beside it: the time-lapse frame taken nearest
 * that layer, the temperatures the print ran at, and what happened along the way (the AI watch's notes, pauses, how it
 * ended), all on one scrub bar by layer. "Jump to where it went wrong" goes to the first of those.
 *
 * Everything comes from the record (backend/print_track.py keeps a light trace while a print runs). A print that ran
 * before Deja Vu1 kept traces, or one from the printer's own history, replays its layers alone and says so: no
 * temperature or time is made up for it. The twin is one instance for the page, made the first time a replay opens.
 */
'use strict';
window.Replay = (() => {
  const HEADS = ['T0', 'T1', 'T2', 'T3'];
  const st = { id: null, info: null, layers: null, twin: null, n: 0, total: 0, at: 1, timer: null, rows: null, frames: [] };
  let dialog = null;

  const headName = h => String(h || '').replace(/^T(\d)$/, (_, n) => `Head ${+n + 1}`);
  const temp = c => (typeof c === 'number' ? `${Math.round(c)} °C` : '—');
  function dur(sec) {
    const s = Math.max(0, Math.round(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${s} s`;
  }
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function build() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'glass-dialog';
    dialog.id = 'replay-dialog';
    dialog.setAttribute('aria-labelledby', 'replay-title');
    dialog.innerHTML = `<div class="dialog-panel liquid-glass deep wide replay-panel">
      <div class="card-head">
        <div><h2 id="replay-title">Replay</h2><p class="card-sub" id="replay-sub"></p></div>
        <button class="btn small" data-close type="button">Close</button>
      </div>
      <div class="replay-stage">
        <div class="replay-twin" id="replay-twin"><p class="replay-empty" id="replay-twin-note" hidden></p>
          <div class="replay-views" id="replay-views" role="group" aria-label="What the twin shows" hidden>
            <button class="btn small" type="button" data-rview="print" aria-pressed="true">The print</button>
            <button class="btn small" type="button" data-rview="iso" aria-pressed="false">The whole printer</button>
          </div></div>
        <figure class="replay-frame" id="replay-frame" hidden>
          <img id="replay-img" alt="">
          <figcaption id="replay-frame-cap"></figcaption>
        </figure>
      </div>
      <div class="readouts replay-read" id="replay-read" aria-live="polite"></div>
      <div class="replay-chart-wrap" id="replay-chart-wrap" hidden>
        <svg class="replay-chart" id="replay-chart" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-labelledby="replay-chart-h"></svg>
        <p class="replay-legend" id="replay-chart-h"></p>
      </div>
      <div class="flip-controls">
        <button class="btn small" id="replay-play" type="button" aria-pressed="false">Play</button>
        <label class="sr-only" for="replay-scrub">Layer</label>
        <input type="range" id="replay-scrub" min="1" max="1" value="1" step="1">
        <span class="flip-count" id="replay-count"></span>
      </div>
      <div class="replay-events" id="replay-events"></div>
      <p class="replay-note" id="replay-note"></p>
    </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('close', stopped);
    dialog.addEventListener('cancel', () => stopped());
    $('replay-scrub').addEventListener('input', e => { pause(); go(+e.target.value); });
    $('replay-play').addEventListener('click', () => (st.timer ? pause() : play()));
    $('replay-views').addEventListener('click', e => {
      const b = e.target.closest('[data-rview]');
      if (b) view(b.dataset.rview);
    });
    $('replay-events').addEventListener('click', e => {
      const b = e.target.closest('[data-layer]');
      if (b) { pause(); go(+b.dataset.layer); }
    });
    return dialog;
  }

  /* The G-code's timeline as rows [byte, seconds, z] (print_preview.py sends it as steps from the row before). */
  function timelineRows(data) {
    const tl = data && data.timeline, flat = tl && tl.track, k = data.unit_mm || 0.01;
    if (!Array.isArray(flat)) return null;
    const rows = [];
    let b = 0, t = 0, z = 0;
    for (let i = 0; i + 4 < flat.length; i += 5) {
      b += flat[i]; t += flat[i + 1]; z += flat[i + 4];
      rows.push([b, t / 1000, z * k]);
    }
    return rows.length ? rows : null;
  }

  /* The last timeline row at or below layer n's height: where the file is when that layer is done. */
  function rowAtLayer(n) {
    const L = st.layers && st.layers.layers, rows = st.rows;
    if (!L || !rows || !L[n - 1]) return null;
    const z = L[n - 1].z + 1e-3;
    let lo = 0, hi = rows.length - 1, hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid][2] <= z) { hit = rows[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return hit;
  }

  /* The trace point for layer n: the last one taken at or before that layer. */
  function pointAt(n) {
    const pts = (st.info.track && st.info.track.points) || [];
    let hit = null;
    for (const p of pts) {
      if (typeof p[1] === 'number' && p[1] > n) break;
      if (typeof p[1] === 'number') hit = p;
    }
    return hit;
  }

  function twinState(n, point) {
    const p = st.info.print || {}, heads = {};
    const byHead = Object.fromEntries((p.heads || []).map(h => [h.toolhead, h]));
    const active = point && point[5] >= 0 ? HEADS[point[5]] : (p.heads && p.heads[0] && p.heads[0].toolhead) || 'T0';
    HEADS.forEach((h, i) => {
      const known = byHead[h] || {};
      const c = /^#[0-9a-f]{6}$/i.test(known.colour || '') ? known.colour : null;
      heads[h] = { status: h === active ? 'active' : 'docked', temperature: point && point[4] ? point[4][i] : null,
        target_temperature: null, filament_loaded: !!c, filament_color_hex: c, filament_color_name: known.colour_name || null,
        filament_material: known.material || null };
    });
    const row = rowAtLayer(n), bytes = st.layers && st.layers.timeline && st.layers.timeline.bytes;
    return { printer_id: `replay-${st.id}`, printer_name: p.printer_name || p.printer || '', state: 'paused', current_file: st.info.file,
      progress: row && bytes ? Math.min(1, row[0] / bytes) : n / Math.max(1, st.total), layer: { current: n, total: st.total },
      active_toolhead: active, toolheads: heads, bed_temperature: point ? point[3] : null };
  }

  function frameAt(n, point) {
    const frames = st.frames;
    if (!frames.length) return -1;
    if (point && typeof point[6] === 'number' && point[6] > 0) return Math.min(frames.length, point[6]) - 1;
    if (st.info.track && st.info.track.points && st.info.track.points.some(q => typeof q[6] === 'number')) return -1;
    return Math.round(((n - 1) / Math.max(1, st.n - 1)) * (frames.length - 1));
  }

  function go(n) {
    n = Math.max(1, Math.min(st.n, Math.round(n) || 1));
    st.at = n;
    const point = pointAt(n);
    $('replay-scrub').value = String(n);
    $('replay-count').textContent = `${n} / ${st.total}`;
    if (st.twin) st.twin.update(twinState(n, point));
    const ro = (label, value) => `<div class="ro"><span>${label}</span><b>${value}</b></div>`;
    const row = rowAtLayer(n);
    const used = (point && point[4] ? point[4].map((c, i) => [HEADS[i], c]) : []).filter(([, c]) => typeof c === 'number' && c > 50);
    $('replay-read').innerHTML = [
      ro('Layer', esc(`${n} of ${st.total}`)),
      point ? ro('Time in', esc(dur(point[0]))) : row ? ro('In the file’s plan', esc(dur(row[1]))) : '',
      point ? ro('Bed', esc(temp(point[3]))) : '',
      ...used.map(([h, c]) => ro(esc(headName(h)), esc(temp(c))))
    ].join('');
    const i = frameAt(n, point), fig = $('replay-frame');
    fig.hidden = i < 0;
    if (i >= 0) {
      const img = $('replay-img'), src = st.frames[i];
      if (img.dataset.src !== src) { img.src = src; img.dataset.src = src; }
      img.alt = `Time-lapse frame ${i + 1} of ${st.frames.length}`;
      $('replay-frame-cap').textContent = `Frame ${i + 1} of ${st.frames.length}`;
    }
    const cursor = $('replay-chart').querySelector('.rp-cursor');
    if (cursor) { const x = xOf(n); cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); }
    dialog.querySelectorAll('#replay-events [data-layer]').forEach(b => b.classList.toggle('is-here', +b.dataset.layer === n));
  }

  const xOf = n => (st.n > 1 ? ((n - 1) / (st.n - 1)) * 600 : 0);

  /* The temperatures the print ran at, by layer, with a mark at each event. Nothing when no trace was kept. */
  function chart() {
    const pts = ((st.info.track && st.info.track.points) || []).filter(p => typeof p[1] === 'number' && p[1] >= 1 && p[1] <= st.n);
    const svg = $('replay-chart'), wrap = $('replay-chart-wrap');
    const series = [['bed', 'Bed', p => p[3]], ...HEADS.map((h, i) => [h.toLowerCase(), headName(h), p => (p[4] || [])[i]])]
      .map(([k, label, get]) => ({ k, label, pts: pts.map(p => [p[1], get(p)]).filter(([, v]) => typeof v === 'number') }))
      .filter(s => s.pts.length > 1 && s.pts.some(([, v]) => v > 50));
    wrap.hidden = !series.length;
    if (!series.length) { svg.innerHTML = ''; return; }
    const all = series.flatMap(s => s.pts.map(([, v]) => v));
    const lo = Math.floor(Math.min(...all) / 10) * 10, hi = Math.ceil(Math.max(...all) / 10) * 10 || 10;
    const y = v => 112 - ((v - lo) / Math.max(1, hi - lo)) * 104;
    const marks = (st.info.events || []).filter(e => e.layer).map(e =>
      `<line class="rp-ev rp-ev-${esc(e.kind)}" x1="${xOf(e.layer)}" x2="${xOf(e.layer)}" y1="0" y2="120"></line>`).join('');
    svg.innerHTML = `${marks}${series.map(s => `<polyline class="rp-line rp-${s.k}" vector-effect="non-scaling-stroke" points="${s.pts.map(([n, v]) => `${xOf(n).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"></polyline>`).join('')}
      <line class="rp-cursor" vector-effect="non-scaling-stroke" x1="0" x2="0" y1="0" y2="120"></line>`;
    $('replay-chart-h').innerHTML = `${series.map(s => `<span class="rp-key rp-${s.k}">${esc(s.label)}</span>`).join('')}
      <span class="rp-range">${esc(`${lo} to ${hi} °C`)}</span>`;
  }

  /* How the print ended, when and where, as one sentence for the dialog's subtitle. */
  function subline(p) {
    const d = p.ended_at || p.started_at ? new Date(p.ended_at || p.started_at) : null;
    const when = d && !isNaN(d) ? d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const where = p.printer_name || p.printer || '';
    if (!when || !where) return '';
    if (p.status === 'finished') return `Finished on ${when} on ${where}.`;
    if (p.status === 'failed') return `Failed on ${when} on ${where}.`;
    if (p.status === 'cancelled') return `Stopped on ${when} on ${where}.`;
    return `Ended on ${when} on ${where}.`;
  }

  function eventSentence(e) {
    if (e.kind === 'watch') return e.layer ? `Layer ${e.layer}: the AI watch noted “${e.text}”` : `The AI watch noted “${e.text}”`;
    if (e.kind === 'pause') return e.layer ? `Layer ${e.layer}: the print paused.` : 'The print paused.';
    if (e.kind === 'end') {
      const said = e.text ? ` The printer said “${e.text}”` : '';
      if (e.status === 'failed') return e.layer ? `Layer ${e.layer}: it failed.${said}` : `It failed.${said}`;
      return e.layer ? `Layer ${e.layer}: it was stopped.${said}` : `It was stopped.${said}`;
    }
    return '';
  }

  function events() {
    const list = (st.info.events || []).filter(e => eventSentence(e));
    const jumpable = list.filter(e => e.layer && e.layer <= st.n).sort((a, b) => a.layer - b.layer);
    // A finished print can still carry a note or a pause; only a failed or stopped one "went wrong".
    const wrong = ['failed', 'cancelled', 'stopped', 'error'].includes((st.info.print || {}).status);
    const jumpWord = wrong ? 'Jump to where it went wrong' : 'Jump to the first note';
    $('replay-events').innerHTML = `${jumpable.length ? `<button class="btn small primary" type="button" data-layer="${jumpable[0].layer}">${jumpWord}</button>` : ''}
      ${list.length ? `<ul>${list.map(e => `<li>${e.layer && e.layer <= st.n
        ? `<button class="replay-ev" type="button" data-layer="${e.layer}">${esc(eventSentence(e))}</button>` : `<span>${esc(eventSentence(e))}</span>`}</li>`).join('')}</ul>` : ''}`;
  }

  function note() {
    const out = [];
    if (!st.info.track) out.push('Deja Vu1 kept no readings while this print ran, so the replay shows its layers alone, with no temperatures or times.');
    else out.push('The temperatures and times are the readings Deja Vu1 kept while this print ran.');
    if (st.frames.length && !(st.info.track && st.info.track.points.some(q => typeof q[6] === 'number'))) out.push('The time-lapse frames are spread evenly over the layers.');
    if (st.n < st.total) out.push(`It stopped at layer ${st.n}, so the replay ends there.`);
    $('replay-note').textContent = out.join(' ');
  }

  function play() {
    if (st.timer || !st.n) return;
    if (st.at >= st.n) go(1);
    const step = Math.max(1, Math.round(st.n / 300));
    $('replay-play').textContent = 'Pause';
    $('replay-play').setAttribute('aria-pressed', 'true');
    st.timer = setInterval(() => {
      if (st.at >= st.n) { pause(); return; }
      go(st.at + step);
    }, 50);
  }

  function pause() {
    clearInterval(st.timer);
    st.timer = null;
    if (!dialog) return;
    $('replay-play').textContent = 'Play';
    $('replay-play').setAttribute('aria-pressed', 'false');
  }

  function stopped() {
    pause();
    if (st.twin) st.twin.setPrint(null);
  }

  function close() {
    if (window.Workshop && Workshop.closeDialog) Workshop.closeDialog(dialog); else dialog.close();
  }

  /* Open the replay of one ended print by its id in the record. */
  async function open(id, fromEl) {
    build();
    pause();
    const [info, layers] = await Promise.all([
      getJSON(api(`/api/prints/replay?id=${encodeURIComponent(id)}`)).catch(e => ({ error: e.message })),
      getJSON(api(`/api/prints/replay/layers?id=${encodeURIComponent(id)}`)).catch(() => null)
    ]);
    if (!info || info.error) { toast((info && info.error) || 'That print could not be opened', 'warn'); return; }
    st.id = id; st.info = info;
    st.layers = layers && Array.isArray(layers.layers) && layers.layers.length ? layers : null;
    st.rows = st.layers ? timelineRows(st.layers) : null;
    const traced = ((info.track && info.track.points) || []).map(p => p[1]).filter(n => typeof n === 'number');
    st.total = info.total_layers || (st.layers ? st.layers.layers.length : 0) || (traced.length ? Math.max(...traced) : 0);
    st.n = Math.max(0, Math.min(st.total, info.stop_layer || st.total));
    const tl = info.timelapse;
    st.frames = tl ? tl.frames.map(n => withPrinter(`/api/timelapse/frame?session=${encodeURIComponent(tl.session)}&name=${encodeURIComponent(n)}`, tl.printer)) : [];
    const p = info.print || {};
    $('replay-title').textContent = `Replay: ${info.file || 'a print'}`;
    $('replay-sub').textContent = subline(p);
    const host = $('replay-twin'), twinNote = $('replay-twin-note');
    if (st.layers && !st.twin && typeof Twin3D !== 'undefined') {
      st.twin = Twin3D.create(host);
      if (st.twin) {
        st.twin.setOptions({ print: true, rest: true, tags: false });
        if (st.twin.onViewChange) st.twin.onViewChange(pressed);
      }
    }
    twinNote.hidden = !!(st.layers && st.twin);
    twinNote.textContent = !st.layers ? ((layers && layers.reason) || 'The file’s layers can’t be drawn.')
      : 'This browser can’t draw the 3D twin (it needs WebGL 2). The readings and frames still play.';
    host.classList.toggle('is-empty', !twinNote.hidden);
    if (st.twin) { st.twin.el.hidden = !st.layers; st.twin.setPrint(st.layers); }
    $('replay-views').hidden = !(st.layers && st.twin);
    const scrub = $('replay-scrub');
    scrub.max = String(Math.max(1, st.n));
    scrub.disabled = st.n < 2;
    $('replay-play').disabled = st.n < 2;
    chart();
    events();
    note();
    if (window.Workshop && Workshop.openDialog) Workshop.openDialog(dialog, fromEl); else dialog.showModal();
    if (st.n) go(st.n);
    else $('replay-read').innerHTML = '';
    // The panel grows out of the button that opened it, so the twin's first picture is sized to the shrunk panel: draw
    // it again once the panel has its own size.
    const panel = dialog.querySelector('.dialog-panel');
    const moving = panel && panel.getAnimations ? panel.getAnimations() : [];
    const settled = () => { if (dialog.open && st.n) go(st.at); if (dialog.open && st.layers && st.twin) view('print'); };
    if (moving.length) Promise.all(moving.map(a => a.finished)).catch(() => {}).then(settled);
    else settled();
  }

  /* A replay opens close on the print; the whole printer is a press away (a double-click on the twin does the same). */
  function view(name) {
    if (!st.twin || !st.twin.setView) return;
    st.twin.setView(name);
    pressed(name);
  }
  function pressed(name) {
    for (const b of document.querySelectorAll('#replay-views [data-rview]')) b.setAttribute('aria-pressed', String(b.dataset.rview === name));
  }

  /* A frame of another printer's time-lapse is asked for by that printer's id (player.js does the same). */
  function withPrinter(url, printer) {
    const u = printer ? `${url}&printer=${encodeURIComponent(printer)}` : url;
    return typeof demoOn !== 'undefined' && demoOn ? `${u}&demo=1` : u;
  }

  return { open, _state: st };
})();
