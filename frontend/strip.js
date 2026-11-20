/* strip.js: the instrument strip along the bottom of every place.
 *
 * One instrument per printer (a layer-stack meter that fills as the print grows, its name, its progress or state and
 * its temperatures); a click selects that printer. After them: the connection pill (#conn, which says "Simulated"
 * while demo data is on), the Find button for the command bar (finder.js, Ctrl or Cmd K), the notification orb
 * (orb.js, moved in by index.html) and Halt.
 *
 * Halt stops the selected printer with one press (M112: every motor and heater stops at once), from every place, with
 * the two-key shortcut H H. Afterwards the strip says in one line what happened and offers Restart firmware, which
 * calls the same route the Printer screen's own restart does and is refused in words unless the printer reports an
 * error. Settings › Advanced "Ask before Halt" turns on a second press (the button asks "Press again to halt" for four
 * seconds). A refusal from the printer, the server or watch-only mode is shown as a refusal, never as a stop.
 * On a phone only the selected printer shows and Halt sits at the right, within the thumb's reach.
 */
(() => {
  const $ = id => document.getElementById(id);
  const ASK_KEY = 'dejavu1.pref.haltAsk';
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', error: 'Error', complete: 'Finished', ready: 'Ready' };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  let fleet = [];
  let paintedFor = '';
  let halted = null;          // { id, name, line, failed } while the strip is saying what Halt did
  let armed = 0;
  let sending = false;

  const selected = () => {
    const id = typeof currentPrinter !== 'undefined' && currentPrinter;
    return fleet.find(p => p.id === id) || fleet[0] || null;
  };
  const stateOf = p => (p.link_lost ? 'lost' : (STATE_WORD[p.state] ? p.state : 'ready'));
  const pct = p => Math.round((p.progress || 0) * 100);
  const temp = v => (v == null ? '' : (typeof formatTemp === 'function' ? formatTemp(v) : `${Math.round(v)}°`));
  function words(p) {
    if (p.link_lost) return 'Not answering';
    if (p.state === 'printing') return `Printing ${pct(p)}%`;
    return STATE_WORD[p.state] || (p.state ? p.state[0].toUpperCase() + p.state.slice(1) : 'Ready');
  }

  /* ---- the instruments ---- */
  function instrument(p, here) {
    const st = stateOf(p);
    const printing = p.state === 'printing' && !p.link_lost;
    const done = printing && p.remaining_hours != null && typeof doneAt === 'function' ? doneAt(p.remaining_hours) : '';
    const noz = temp(p.nozzle_temperature), bed = temp(p.bed_temperature);
    // No aria-label: the button's name is its own visible text (WCAG 2.5.3), with one hidden word for what the figure is.
    const read = printing
      ? `<b>${pct(p)}%</b><span class="sr-only"> printing</span>${done ? `<span class="rd-extra"> done ${esc(done)}</span>` : ''}`
      : `<b>${esc(words(p))}</b>`;
    return `<button type="button" class="inst" data-printer="${esc(p.id)}" data-state="${st}" aria-pressed="${here}" data-full="${esc(p.name)}">
      <span class="stack" aria-hidden="true" style="--p:${printing ? pct(p) : st === 'complete' ? 100 : 0}%"><i></i></span>
      <span class="inst-name" title="${esc(p.name)}">${esc(p.name)}</span>
      <span class="inst-rd"> ${read}</span>
      ${noz || bed ? ` <span class="inst-temps rd-extra">${noz ? `<span>T ${esc(noz)}</span>` : ''} ${bed ? `<span>Bed ${esc(bed)}</span>` : ''}</span>` : ''}
    </button>`;
  }

  function paint(force) {
    const box = $('strip-insts');
    if (!box) return;
    const here = selected();
    const sig = JSON.stringify([fleet.map(p => [p.id, p.name, p.state, p.link_lost, pct(p), Math.round(p.nozzle_temperature || 0),
      Math.round(p.bed_temperature || 0), p.remaining_hours != null ? Math.round(p.remaining_hours * 60) : null]), here && here.id, halted && halted.line]);
    if (!force && sig === paintedFor) return;
    paintedFor = sig;
    box.dataset.count = String(fleet.length);
    box.innerHTML = fleet.length
      ? fleet.map(p => instrument(p, !!here && here.id === p.id)).join('')
      : '<span class="strip-empty">No printer yet</span>';
    paintHalt(here);
  }

  /* ---- Halt ---- */
  function paintHalt(here) {
    const btn = $('strip-halt');
    if (!btn) return;
    const p = here || selected();
    const can = !!p && !p.link_lost && !sending;
    btn.disabled = !can;
    const name = p ? p.name : '';
    btn.setAttribute('aria-label', armed
      ? `Press again to halt ${name}`
      : `Halt${name ? ` ${name}` : ''}: stops every motor and heater at once`);
    btn.querySelector('.halt-word').textContent = armed ? 'Press again' : sending ? 'Halting…' : 'Halt';
    btn.classList.toggle('is-armed', !!armed);
    const note = $('strip-halted');
    if (note) {
      note.hidden = !halted;
      $('strip').classList.toggle('is-halted', !!halted);
      if (halted) {
        note.innerHTML = `<span class="halted-dot" aria-hidden="true"></span><span class="halted-text">${esc(halted.line)}</span>${
          halted.failed ? '' : '<button type="button" class="btn small" id="strip-restart">Restart firmware</button>'}
          <button type="button" class="btn small quiet" id="strip-halted-x" aria-label="Dismiss this message">Dismiss</button>`;
      }
    }
  }
  function disarm() { clearTimeout(armed); armed = 0; paintHalt(); }

  async function halt() {
    const p = selected();
    if (!p || p.link_lost || sending) return;
    if (store.get(ASK_KEY) === 'on' && !armed) {
      armed = setTimeout(disarm, 4000);
      paintHalt(p);
      return;
    }
    if (armed) { clearTimeout(armed); armed = 0; }
    sending = true;
    paintHalt(p);
    let r = { ok: false, result: { body: { error: 'Could not run the command' } } };
    try {
      r = await runCommand(null, '/api/printer/control/estop', {}, { sending: 'Halting…', done: 'Halt sent', failed: 'Halt refused' });
    } catch (err) { /* the toast from runCommand already said why */ }
    sending = false;
    const why = r.result && r.result.body && r.result.body.error;
    halted = r.ok
      ? { id: p.id, name: p.name, line: `${p.name} halted: motors and heaters off` }
      : { id: p.id, name: p.name, failed: true, line: `${p.name}: Halt was refused. ${why || 'The printer did not stop.'}` };
    paint(true);
  }

  async function restart() {
    const btn = $('strip-restart');
    if (btn) btn.disabled = true;
    let r = { ok: false, result: { body: { error: 'Could not run the command' } } };
    try {
      r = await runCommand(null, '/api/printer/control/restart', {}, { sending: 'Restarting…', done: 'Firmware restarted', failed: 'Restart refused' });
    } catch (err) { /* said by the toast */ }
    if (r.ok) { halted = null; paint(true); return; }
    if (btn) btn.disabled = false;
    const why = r.result && r.result.body && r.result.body.error;
    if (halted) { halted.line = `${halted.name} halted. Restart was refused: ${why || 'the printer did not answer'}`; paint(true); }
  }

  /* ---- wiring ---- */
  function init() {
    const strip = $('strip');
    if (!strip) return;
    const cmdKey = $('strip-cmd-key');
    if (cmdKey) cmdKey.dataset.keys = mac ? '⌘K' : 'Ctrl K';      // drawn by CSS, so a button's visible text is only its label
    const haltKey = strip.querySelector('.halt-key');
    if (haltKey) haltKey.dataset.keys = 'H H';
    strip.addEventListener('click', e => {
      const inst = e.target.closest('[data-printer]');
      if (inst) {
        if (window.Workshop && inst.dataset.printer !== (typeof currentPrinter !== 'undefined' && currentPrinter)) Workshop.selectPrinter(inst.dataset.printer, null, true);
        return;
      }
      if (e.target.closest('#strip-halt')) { halt(); return; }
      if (e.target.closest('#strip-restart')) { restart(); return; }
      if (e.target.closest('#strip-halted-x')) { halted = null; paint(true); return; }
      if (e.target.closest('#strip-cmd')) { const i = $('feature-search'); if (i) { i.focus(); i.select(); } }
    });
    // H then H, within a second and a half, when nothing is being typed: Halt.
    let last = 0;
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || (e.key !== 'h' && e.key !== 'H')) return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName)
        || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color)$/i.test(el.type || '')))) return;
      if (document.querySelector('.guide:not([hidden])')) return;
      const now = Date.now();
      if (now - last < 1500) { last = 0; e.preventDefault(); halt(); } else last = now;
    });
    window.addEventListener('dv-fleet', e => {
      fleet = Array.isArray(e.detail) ? e.detail : [];
      // The note goes by itself once the printer is out of its error.
      if (halted && !halted.failed) {
        const p = fleet.find(f => f.id === halted.id);
        if (p && p.state !== 'error' && !sending && Date.now() - (halted.at || 0) > 0 && halted.seen) halted = null;
        if (p && p.state === 'error') halted.seen = true;
      }
      paint(false);
    });
    window.addEventListener('dv-printer', () => paint(true));
    // The assistant's Ask button is built later by assistant.js; it belongs in the strip too.
    const adopt = () => {
      const ask = $('ai-launch');
      const end = strip.querySelector('.strip-end');
      if (ask && end && ask.parentElement !== end) end.insertBefore(ask, $('orb-dock'));
      return !!ask;
    };
    if (!adopt()) {
      const watcher = new MutationObserver(() => { if (adopt()) watcher.disconnect(); });
      watcher.observe(document.body, { childList: true });
    }
    // The orb's colour follows the connection: ok, warning or trouble.
    const conn = $('conn');
    const tint = () => {
      const orb = $('orb');
      if (!orb || !conn) return;
      const bad = conn.classList.contains('is-offline') || conn.classList.contains('is-lost');
      orb.dataset.link = bad ? 'bad' : (conn.classList.contains('is-live') || conn.classList.contains('is-demo') ? 'ok' : 'wait');
    };
    if (conn) { new MutationObserver(tint).observe(conn, { attributes: true, attributeFilter: ['class'] }); tint(); }
    paint(true);
  }

  window.Strip = { halt, restart, selected, armedNow: () => !!armed };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
