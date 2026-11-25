/* plugins.js: Settings, Plugins (backend/plugins.py) and the sealed frame a plugin's pane runs in.
 *
 * A pane runs in an iframe with sandbox="allow-scripts" and no allow-same-origin, so it has no origin of its own: it
 * can't read this page, its storage or its cookies, and a content policy in the frame forbids network access unless
 * the plugin was granted "network". The only way out is dejavu.call(), which posts a message here; this page checks
 * the frame it came from and forwards it to the server, which checks the permission again. A pane that throws or
 * stops answering is closed and switched off. Safe start (every plugin off) is always in this card, and is offered by
 * itself when a pane was open as the page last went away without closing it (a frozen or crashed page).
 */
const Plugins = (() => {
  const $ = id => document.getElementById(id);
  const OPEN_KEY = 'dejavu1.plugin-open';
  let data = null;
  let frame = null;               // the open pane: { id, el, win, timer, missed, calls }

  async function load() {
    const host = $('plugins-list');
    if (!host) return;
    const body = await getJSON('/api/plugins');
    if (!body || !Array.isArray(body.plugins)) return;
    data = body;
    draw();
  }

  async function act(payload, button) {
    if (button) button.disabled = true;
    const r = await postJSON('/api/plugins', payload);
    if (button) button.disabled = false;
    if (r.ok) { data = r.body; draw(); } else toast(r.body.error || 'That didn’t work', 'bad');
    return r;
  }

  function permRow(p, perm) {
    return `<label class="plg-perm"><input type="checkbox" data-grant="${esc(p.id)}" data-perm="${esc(perm.id)}"${perm.granted ? ' checked' : ''}${p.broken ? ' disabled' : ''}>
      <span>${esc(perm.words)}</span></label>`;
  }

  function checksText(p) {
    return p.checks.map(c => `<li><b>${c.level === 'refuse' ? 'Refuses the print' : 'Warns'}:</b> ${esc(c.say)}</li>`).join('');
  }

  function trialText(p) {
    if (p.builtin || p.real_printer) return '';
    const did = p.trial.length ? `<ul class="plg-trial">${p.trial.slice(-5).map(t => `<li>${esc(t.did)}</li>`).join('')}</ul>` : '';
    return `<div class="plg-practice"><p>It works on the practice printer until you allow the real one.</p>${did}
      <button type="button" class="btn" data-approve="${esc(p.id)}">Allow the real printer</button></div>`;
  }

  function card(p) {
    const errs = p.errors.length && !p.on ? `<p class="plg-err" role="status">Switched off after a problem: ${esc(p.errors[p.errors.length - 1].text)}</p>` : '';
    const broken = p.broken ? `<p class="plg-err" role="status">This plugin can’t load: ${esc(p.broken)}</p>` : '';
    const acts = p.actions.map(a => `<button type="button" class="btn" data-run="${esc(p.id)}" data-action="${esc(a.id)}"${p.on ? '' : ' disabled'} title="${esc(a.gcode.join('; '))}">${esc(a.name)}</button>`).join('');
    return `<article class="plg well${p.on ? ' is-on' : ''}" data-plugin="${esc(p.id)}">
      <div class="plg-head">
        <div class="plg-text"><div class="mod-name">${esc(p.name)} <span class="plg-meta">${esc(p.version)} · ${esc(p.source)}</span></div>
          <div class="mod-desc">${esc(p.description)}</div>${p.lives ? `<div class="mod-desc">${esc(p.lives)}</div>` : ''}</div>
        <label class="switch" style="gap:0;"><input type="checkbox" data-on="${esc(p.id)}"${p.on ? ' checked' : ''}${p.broken || data.safe_start ? ' disabled' : ''} aria-label="${esc(p.name)}">
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></label>
      </div>
      ${broken}${errs}
      ${p.permissions.length ? `<fieldset class="plg-perms"><legend>What it may do</legend>${p.permissions.map(perm => permRow(p, perm)).join('')}</fieldset>` : ''}
      ${p.checks.length ? `<div class="plg-checks"><span class="stat-key">Its checks in Confirm Print</span><ul>${checksText(p)}</ul></div>` : ''}
      ${trialText(p)}
      <div class="plg-tools">${p.pane ? `<button type="button" class="btn primary" data-pane="${esc(p.id)}"${p.on ? '' : ' disabled'}>Open ${esc(p.pane.title)}</button>` : ''}${acts}
        ${p.builtin ? '' : `<button type="button" class="btn danger" data-remove="${esc(p.id)}">Remove</button>`}</div>
    </article>`;
  }

  function draw() {
    const host = $('plugins-list');
    if (!host || !data) return;
    const safe = $('plugins-safe');
    if (safe) {
      safe.innerHTML = data.safe_start
        ? `<p class="plg-safe-on" role="status"><b>Safe start is on: every plugin is off.</b></p><button type="button" class="btn primary" data-safe="0">End safe start</button>`
        : `<button type="button" class="btn" data-safe="1">Start with every plugin off</button>`;
    }
    host.innerHTML = data.plugins.length ? data.plugins.map(card).join('') : `<p class="log-empty">No plugins yet.</p>`;
  }

  // -- the sealed frame ------------------------------------------------------------------------------------------

  const BRIDGE = `(() => {
    const waiting = new Map(); let n = 0;
    window.dejavu = { call(method, args) { return new Promise((ok, fail) => { const id = ++n; waiting.set(id, { ok, fail });
      parent.postMessage({ dv: 'call', id, method, args: args || {} }, '*'); }); } };
    addEventListener('message', e => {
      if (e.source !== parent) return;
      const m = e.data || {};
      if (m.dv === 'ping') parent.postMessage({ dv: 'pong' }, '*');
      if (m.dv === 'result' && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.ok ? w.ok(m.value) : w.fail(new Error(m.error)); }
    });
    addEventListener('error', e => parent.postMessage({ dv: 'error', message: String(e.message || 'error') }, '*'));
  })();`;

  function tokens() {
    const css = getComputedStyle(document.documentElement);
    return ['--text', '--text-dim', '--accent', '--ok', '--warn', '--bad', '--font-sans', '--font-mono']
      .map(k => `${k}:${css.getPropertyValue(k).replace(/[<>;{}]/g, '')}`).join(';');
  }

  function srcdoc(pane) {
    const none = "'none'", inline = "'unsafe-inline'";
    const csp = [['default-src', none], ['script-src', inline], ['style-src', inline], ['img-src', 'data:', 'blob:'],
      ['font-src', 'data:'], ['connect-src', pane.network ? 'https:' : none], ['form-action', none], ['base-uri', none]]
      .map(rule => rule.join(' ')).join('; ');
    const code = String(pane.script).replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>:root{${tokens()}}body{margin:0;padding:12px;font:14px/1.5 var(--font-sans);color:var(--text);background:transparent}</style>
<script>${BRIDGE}</script></head><body><div id="root"></div><script>${code}</script></body></html>`;
  }

  function closePane(reason) {
    if (!frame) return;
    clearInterval(frame.timer);
    const dlg = $('plugin-pane');
    if (dlg && dlg.open) dlg.close();
    if (frame.el) frame.el.remove();
    const id = frame.id;
    frame = null;
    try { localStorage.removeItem(OPEN_KEY); } catch (_) {}
    if (reason) {
      postJSON('/api/plugins', { action: 'error', id, message: reason }).then(r => { if (r.ok) { data = r.body; draw(); } });
      toast(`The plugin was closed and switched off: ${reason}`, 'bad', 8000);
    }
  }

  async function forward(m) {
    const now = Date.now();
    frame.calls = frame.calls.filter(t => now - t < 1000);
    if (frame.calls.length >= 20) return { ok: false, error: 'Too many asks at once: slow down' };
    frame.calls.push(now);
    const r = await postJSON('/api/plugins/call', { id: frame.id, method: String(m.method || ''), args: m.args, printer: currentPrinter || null });
    return r.ok ? { ok: true, value: r.body } : { ok: false, error: r.body.error || 'Refused' };
  }

  function onMessage(e) {
    if (!frame || e.source !== frame.win) return;           // only the open pane's own frame
    const m = e.data || {};
    if (m.dv === 'pong') { frame.missed = 0; return; }
    if (m.dv === 'error') { closePane(String(m.message || '').slice(0, 300)); return; }
    if (m.dv === 'call') {
      const win = frame.win;
      forward(m).then(res => { if (frame && frame.win === win) win.postMessage({ dv: 'result', id: m.id, ...res }, '*'); });
    }
  }

  async function openPane(id) {
    closePane();
    const r = await getJSON('/api/plugins/pane?id=' + encodeURIComponent(id));
    if (!r || r.error) { toast(r && r.error || 'The pane didn’t open', 'bad'); return; }
    const dlg = $('plugin-pane');
    $('plugin-pane-title').textContent = r.title;
    $('plugin-pane-note').textContent = r.practice ? 'Trying it on the practice printer: nothing it does reaches your real printer yet.' : '';
    const el = document.createElement('iframe');
    el.setAttribute('sandbox', 'allow-scripts');
    el.setAttribute('referrerpolicy', 'no-referrer');
    el.title = r.title;
    el.className = 'plugin-frame';
    el.srcdoc = srcdoc(r);
    $('plugin-pane-body').replaceChildren(el);
    frame = { id, el, win: el.contentWindow, missed: 0, calls: [] };
    // Asked every 3 seconds; a pane that misses three answers in a row has stopped and is closed.
    frame.timer = setInterval(() => {
      if (!frame) return;
      if (++frame.missed > 3) { closePane('it stopped answering'); return; }
      frame.win.postMessage({ dv: 'ping' }, '*');
    }, 3000);
    try { localStorage.setItem(OPEN_KEY, id); } catch (_) {}
    if (!dlg.open) dlg.showModal();
  }

  // -- installing your own ---------------------------------------------------------------------------------------

  async function install(input) {
    const files = {};
    for (const f of input.files) {
      const name = f.name;
      if (!/\.(json|js|css|md|txt)$/i.test(name)) continue;
      if (f.size > 200000) { toast(`A plugin file can be 200 KB at most: ${name}`, 'bad'); input.value = ''; return; }
      files[name] = await f.text();
    }
    input.value = '';
    const r = await act({ action: 'install', files });
    if (r.ok) toast('Plugin added. It starts off: look at what it asks for, then switch it on.', 'ok', 6000);
  }

  function wire() {
    const card = $('plugins-card');
    if (!card || card.dataset.wired) return;
    card.dataset.wired = '1';
    card.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.on) act({ action: 'on', id: t.dataset.on, on: t.checked }, t);
      else if (t.dataset.grant) act({ action: 'grant', id: t.dataset.grant, permission: t.dataset.perm, allow: t.checked }, t);
      else if (t.id === 'plugins-add') install(t);
    });
    card.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.safe) act({ action: 'safe_start', on: b.dataset.safe === '1' }, b);
      else if (b.dataset.approve) act({ action: 'approve_real', id: b.dataset.approve }, b);
      else if (b.dataset.remove) { if (confirm('Remove this plugin and its files?')) act({ action: 'remove', id: b.dataset.remove }, b); }
      else if (b.dataset.pane) openPane(b.dataset.pane);
      else if (b.dataset.run) {
        const r = await runCommand(b, '/api/plugins/action', { id: b.dataset.run, action: b.dataset.action, printer: currentPrinter || null },
          { sending: 'Sending…', done: 'Sent', failed: 'Not sent' });
        if (r.ok && r.body.practice) toast('Sent to the practice printer: this plugin isn’t allowed the real one yet.', 'info', 6000);
        load();
      }
    });
    const dlg = $('plugin-pane');
    if (dlg) {
      $('plugin-pane-close').addEventListener('click', () => closePane());
      dlg.addEventListener('close', () => closePane());
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', () => { try { localStorage.removeItem(OPEN_KEY); } catch (_) {} });
  }

  // A pane was open as the page last went away without closing it: offer safe start once.
  async function offerSafeStart() {
    let stuck = null;
    try { stuck = localStorage.getItem(OPEN_KEY); localStorage.removeItem(OPEN_KEY); } catch (_) {}
    if (new URLSearchParams(location.search).get('safe') === '1') { await postJSON('/api/plugins', { action: 'safe_start', on: true }); return; }
    if (!stuck) return;
    toast('Deja Vu1 didn’t close a plugin’s pane last time. You can start with every plugin off.', 'warn', 12000,
      { action: { label: 'Start with every plugin off', run: () => act({ action: 'safe_start', on: true }) } });
  }

  document.addEventListener('DOMContentLoaded', () => { wire(); load(); offerSafeStart(); });
  return { load, openPane, closePane };
})();
