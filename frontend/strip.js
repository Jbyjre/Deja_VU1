/* strip.js: Halt, and the floating dock.
 *
 * There is no bar along the bottom any more. The dock (#strip) floats at the corner and holds the notification orb (orb.js), the Ask button
 * (assistant.js), the "continue on this computer" offer and a word about the link only when something is off (demo data, watch-only, no answer).
 * The printers are chosen in the sidebar, Find is in the toolbar, and Halt sits on the Printer screen (cockpit.js builds its button): it is
 * on screen while you are looking at the printer and nowhere else.
 *
 * Halt stops the selected printer with one press (M112: every motor and heater stops at once). The two-key shortcut H H works from every
 * place, because an emergency stop should never depend on which screen is open; it is simply not drawn anywhere but the Printer screen.
 * Afterwards the Printer screen says in one line what happened and offers Restart firmware, which calls the same route the Printer screen's
 * own restart does and is refused in words unless the printer reports an error. Settings › Advanced "Ask before Halt" turns on a second
 * press (the button asks "Press again to halt" for four seconds). A refusal from the printer, the server or watch-only mode is shown as a
 * refusal, never as a stop.
 */
(() => {
  const $ = id => document.getElementById(id);
  const ASK_KEY = 'dejavu1.pref.haltAsk';
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', error: 'Error', complete: 'Finished', ready: 'Ready' };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  let fleet = [];
  let halted = null;          // { id, name, line, failed } while the Printer screen is saying what Halt did
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
      const cockpit = $('cockpit');
      if (cockpit) cockpit.classList.toggle('is-halted', !!halted);
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
    paintHalt();
  }

  async function restart() {
    const btn = $('strip-restart');
    if (btn) btn.disabled = true;
    let r = { ok: false, result: { body: { error: 'Could not run the command' } } };
    try {
      r = await runCommand(null, '/api/printer/control/restart', {}, { sending: 'Restarting…', done: 'Firmware restarted', failed: 'Restart refused' });
    } catch (err) { /* said by the toast */ }
    if (r.ok) { halted = null; paintHalt(); return; }
    if (btn) btn.disabled = false;
    const why = r.result && r.result.body && r.result.body.error;
    if (halted) { halted.line = `${halted.name} halted. Restart was refused: ${why || 'the printer did not answer'}`; paintHalt(); }
  }

  /* ---- wiring ---- */
  function init() {
    const haltKey = document.querySelector('#strip-halt .halt-key');
    if (haltKey) haltKey.dataset.keys = 'H H';
    // Halt and its follow-ups live on the Printer screen, which builds them after this file is parsed: one listener on the page.
    document.addEventListener('click', e => {
      if (e.target.closest('#strip-halt')) { halt(); return; }
      if (e.target.closest('#strip-restart')) { restart(); return; }
      if (e.target.closest('#strip-halted-x')) { halted = null; paintHalt(); }
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
      paintHalt();
    });
    window.addEventListener('dv-printer', () => paintHalt());
    // The assistant's Ask button is built later by assistant.js; it belongs in the strip too.
    const adopt = () => {
      const ask = $('ai-launch');
      const end = document.querySelector('#strip .strip-end');
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
    paintHalt();
  }

  window.Strip = { halt, restart, selected, armedNow: () => !!armed };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
