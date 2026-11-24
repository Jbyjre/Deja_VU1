/* activity.js: one tray in the top bar for the long jobs (FLOW.1).
 *
 * Slicing, the slicing engine's install, uploads, a print starting and a printer's time-lapse being copied here all
 * take a while, and each used to be visible only on its own screen. The tray lists them in words while they run and
 * for a while after they end, each with one button to the place it belongs to. It shows only once there is something
 * in it.
 *
 * Two kinds of source: jobs the server runs (slicing, the engine install, time-lapse copies), which the tray asks about
 * itself so it also sees a slice started from another screen or another device, and jobs that run in this page
 * (uploads, a print starting), which their own code reports with Activity.add(). Nothing here starts, stops or
 * changes a job: the tray only says where things stand.
 */
'use strict';
window.Activity = (() => {
  const KEEP_ENDED = 10;                         // ended jobs kept in the list
  const items = new Map();                       // key -> { key, text, state: running|done|failed, pct, go, label, at }
  let btn = null, panel = null, timer = 0, seenServer = new Set();

  function mount() {
    const right = document.querySelector('#topbar .topbar-right');
    if (!right || $('act-btn')) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'act-btn';
    btn.className = 'act-btn';
    btn.hidden = true;
    btn.setAttribute('popovertarget', 'act-panel');
    btn.setAttribute('aria-haspopup', 'dialog');
    right.insertBefore(btn, right.firstChild);
    panel = document.createElement('div');
    panel.id = 'act-panel';
    panel.className = 'act-panel liquid-glass deep';
    panel.setAttribute('popover', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Activity');
    document.body.append(panel);
    if (!panel.showPopover) {                    // no Popover API: the button toggles the panel itself
      btn.addEventListener('click', () => { panel.classList.toggle('is-open'); draw(); });
    }
    panel.addEventListener('toggle', e => { if (e.newState === 'open') { place(); draw(); } });
    panel.addEventListener('click', e => {
      const b = e.target.closest('[data-act-go]');
      if (!b) return;
      const it = items.get(b.dataset.actGo);
      if (panel.hidePopover) panel.hidePopover(); else panel.classList.remove('is-open');
      if (it && typeof it.go === 'function') it.go();
      else if (it && it.go && window.Rail) Rail.goDest(it.go);
    });
    window.addEventListener('resize', () => { if (panel.matches(':popover-open')) place(); });
  }

  function place() {
    const r = btn.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  }

  /* ---- the list ---- */
  function upsert(key, fields) {
    const was = items.get(key) || { key, at: Date.now() };
    const it = { ...was, ...fields };
    if (it.state !== 'running' && was.state === 'running') it.at = Date.now();
    items.set(key, it);
    const ended = [...items.values()].filter(i => i.state !== 'running').sort((a, b) => b.at - a.at);
    ended.slice(KEEP_ENDED).forEach(i => items.delete(i.key));
    draw();
    return it;
  }
  function draw() {
    if (!btn) return;
    const all = [...items.values()];
    const running = all.filter(i => i.state === 'running').length;
    const failed = all.some(i => i.state === 'failed');
    btn.hidden = !all.length;
    btn.dataset.state = running ? 'running' : failed ? 'failed' : 'done';
    btn.innerHTML = `<span class="act-dot" aria-hidden="true"></span><span>${running ? `${running} running` : 'Activity'}</span>`;
    btn.setAttribute('aria-label', running ? `Activity: ${running} running` : 'Activity: nothing running');
    if (!panel) return;
    const rows = all.sort((a, b) => (a.state === 'running') - (b.state === 'running') || b.at - a.at).reverse();
    paint(panel, `<p class="act-h">Activity</p>${rows.length ? `<ul class="act-list">${rows.map(i => `
      <li class="act-row" data-state="${esc(i.state)}">
        <span class="act-dot" aria-hidden="true"></span>
        <span class="act-text">${esc(i.text)}${i.pct != null && i.state === 'running' ? `<span class="act-bar" aria-hidden="true"><i style="width:${Math.max(2, Math.min(100, Math.round(i.pct)))}%"></i></span>` : ''}</span>
        ${i.go ? `<button class="btn small" type="button" data-act-go="${esc(i.key)}">${esc(i.label || 'Go there')}</button>` : ''}
      </li>`).join('')}</ul>` : '<p class="act-empty">Nothing is running.</p>'}
      <p class="act-note">Long jobs started on any screen show here while they run.</p>`);
  }

  /* ---- jobs the server runs ---- */
  const SLICE_RUNNING = new Set(['waiting', 'running']);
  async function poll() {
    clearTimeout(timer);
    let busy = false;
    try {
      const [slices, engine, copies] = await Promise.all([
        getJSON('/api/slicer/jobs').catch(() => null),
        getJSON('/api/slicer/engine').catch(() => null),
        typeof api === 'function' ? getJSON(api('/api/timelapse/jobs')).catch(() => null) : null
      ]);
      ((slices && slices.jobs) || []).forEach(j => {
        const key = `slice-${j.id}`, running = SLICE_RUNNING.has(j.status);
        if (!running && !seenServer.has(key)) return;               // an old job, ended before this page looked
        seenServer.add(key);
        busy = busy || running;
        const words = running ? `Slicing ${j.model}: ${j.step || 'working'}`
          : j.status === 'failed' ? `Slicing ${j.model} failed${j.error ? `: ${j.error}` : ''}`
            : j.status === 'cancelled' ? `Slicing ${j.model} was stopped` : `Sliced ${j.model}`;
        upsert(key, { text: words, state: running ? 'running' : j.status === 'failed' ? 'failed' : 'done', go: 'slice', label: 'Open the Slicer' });
      });
      const job = engine && engine.job;
      if (job && (job.state === 'running' || seenServer.has('engine'))) {
        seenServer.add('engine');
        const running = job.state === 'running';
        busy = busy || running;
        upsert('engine', {
          text: running ? `Installing the slicing engine${job.stage ? ` (${job.stage})` : ''}` : job.state === 'done' ? 'The slicing engine is installed' : 'The slicing engine install stopped',
          state: running ? 'running' : job.state === 'done' ? 'done' : 'failed',
          pct: running && job.progress != null ? job.progress * 100 : null,
          go: 'slice',
          label: 'Open the Slicer'
        });
      }
      ((copies && copies.jobs) || []).forEach(j => {
        const key = `copy-${j.name || j.path}`, running = j.state === 'running' || j.state === 'copying';
        if (!running && !seenServer.has(key)) return;
        seenServer.add(key);
        busy = busy || running;
        upsert(key, {
          text: running ? `Copying the time-lapse ${j.name} from the printer` : j.state === 'failed' ? `Not copied: ${j.name}${j.error ? `. ${j.error}` : ''}` : `Kept the time-lapse ${j.name} on this computer`,
          state: running ? 'running' : j.state === 'failed' ? 'failed' : 'done',
          pct: running && j.total ? (j.bytes / j.total) * 100 : null,
          go: 'camera', label: 'Open time-lapses'
        });
      });
    } finally {
      const local = [...items.values()].some(i => i.state === 'running' && !i.key.startsWith('slice-') && i.key !== 'engine' && !i.key.startsWith('copy-'));
      timer = setTimeout(poll, busy || local ? 1500 : document.hidden ? 20000 : 6000);
    }
  }

  /* ---- jobs that run in this page ---- */
  let n = 0;
  function add({ text, go, label }) {
    const key = `local-${++n}`;
    upsert(key, { text, state: 'running', go, label, pct: null });
    return {
      set: (words, pct) => upsert(key, { text: words || items.get(key).text, pct: pct == null ? null : pct }),
      done: words => upsert(key, { text: words || items.get(key).text, state: 'done', pct: null }),
      fail: words => upsert(key, { text: words || items.get(key).text, state: 'failed', pct: null })
    };
  }

  function start() {
    mount();
    draw();
    poll();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { add, refresh: poll };
})();
