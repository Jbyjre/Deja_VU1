/* Open the dashboard on a phone.
   One sheet shows a QR code of this computer's address with a fresh one-time
   pairing code in it. The phone's camera opens the link, the page pairs the
   phone by itself (?pair=, handled below) and this sheet says so. Typing
   stays possible, with the one thing that goes wrong spelled out: a dot in
   place of the colon, or no "http://", turns the address into a web search.
   Opened from Overview ("Connect your phone"), Settings → Paired devices and
   setup's phone step. Window.Phone so other scripts can open it. */
'use strict';
window.Phone = (() => {
  let dialog = null, poll = 0, tick = 0, known = null, until = 0, link = null;

  function qrSvg(rows) {
    const n = rows.length, q = 4;
    let d = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < n; x++) if (row[x] === '1') d += `M${x + q} ${y + q}h1v1h-1z`;
    });
    return `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="QR code that opens this dashboard on your phone" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b1020"/></svg>`;
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'phone-dialog';
    dialog.setAttribute('aria-labelledby', 'phone-title');
    dialog.innerHTML = `
      <div class="phone-sheet">
        <header class="phone-head">
          <div><p class="eyebrow">Your phone</p><h2 id="phone-title">Point your phone’s camera here.</h2></div>
          <button type="button" class="guide-x" data-phone="close" aria-label="Close">×</button>
        </header>
        <div class="phone-body" id="phone-body"></div>
      </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', stop);
    dialog.addEventListener('cancel', stop);
  }

  function onClick(e) {
    if (e.target === dialog) return close();
    const b = e.target.closest('[data-phone]');
    if (!b) return;
    const act = b.dataset.phone;
    if (act === 'close') close();
    else if (act === 'again') load();
    else if (act === 'copy' && link) {
      const text = link.origin.replace(/^https?:\/\//, '');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => toast('Address copied', 'ok'), () => toast(`Address: ${text}`, 'info', 8000));
    }
  }

  function close() { if (dialog && dialog.open) dialog.close(); stop(); }
  function stop() { clearInterval(poll); clearInterval(tick); poll = tick = 0; }

  // "10.0.0.10:8000" with the colon picked out, because the colon is what
  // gets typed as a dot.
  function addressHtml(origin) {
    const bare = origin.replace(/^https?:\/\//, '');
    const at = bare.lastIndexOf(':');
    return at > 0 && !bare.endsWith(']')
      ? `${esc(bare.slice(0, at))}<b class="phone-colon" title="a colon, not a dot">:</b>${esc(bare.slice(at + 1))}`
      : esc(bare);
  }

  function render(data) {
    const body = $('phone-body');
    if (!data.origin) {
      body.innerHTML = `<div class="phone-empty">
        <p><strong>This computer isn’t on a home network right now.</strong> A phone can only reach the dashboard when both are on the same Wi-Fi.</p>
        <p>Connect this computer to your home Wi-Fi or router, then press <b>Try again</b>.</p>
        <button type="button" class="btn primary" data-phone="again">Try again</button></div>`;
      return;
    }
    link = data;
    const others = (data.others || []).slice(0, 4);
    body.innerHTML = `
      <div class="phone-grid">
        <figure class="phone-qr">${qrSvg(data.qr)}<figcaption id="phone-timer" aria-live="off"></figcaption></figure>
        <div class="phone-steps">
          <ol class="phone-list">
            <li><b>Join the same Wi-Fi</b> as this computer on your phone.</li>
            <li><b>Open the Camera</b> and point it at the code. Tap the link that pops up.</li>
            <li><b>That’s it.</b> The dashboard opens and your phone pairs itself.</li>
          </ol>
          <p class="phone-status" id="phone-status" role="status"><span class="phone-pulse" aria-hidden="true"></span>Waiting for your phone…</p>
          <div class="phone-type">
            <p class="phone-label">No camera? Type this into Safari or Chrome’s address bar</p>
            <div class="phone-address"><code>${addressHtml(data.origin)}</code>
              <button type="button" class="btn small" data-phone="copy">Copy</button></div>
            <p class="field-hint">Use a <b>colon</b> before ${esc(String(data.port))}, not a dot. If your phone shows search results, type <code>http://</code> in front.
              Pairing code, if asked: <b class="phone-code">${esc(String(data.code).replace(/(\d{3})(\d{3})/, '$1 $2'))}</b></p>
          </div>
        </div>
      </div>
      <details class="phone-help">
        <summary>The phone won’t open it?</summary>
        <ul>
          <li><b>Same Wi-Fi, not a guest network.</b> Guest networks keep devices apart on purpose. Mobile data won’t reach your home either.</li>
          <li><b>Allow Python through the firewall.</b> When Windows asks about Python, tick <i>Private networks</i> and press Allow. Missed it? Search Windows for “Allow an app through Windows Firewall” and tick Python’s Private box. On a Mac, allow incoming connections for Python. Don’t turn the firewall off.</li>
          <li><b>Keep the launcher window open</b> and the computer awake. Closing it stops the dashboard.</li>
          <li><b>VPN on either device?</b> Pause it and try again.</li>
          ${others.length ? `<li><b>This computer has more than one address.</b> If the code doesn’t open, try typing ${others.map(o => `<code>${addressHtml(o)}</code>`).join(' or ')}.</li>` : ''}
        </ul>
      </details>
      <div class="phone-foot">
        <button type="button" class="btn" data-phone="again">New code</button>
        <button type="button" class="btn primary" data-phone="close">Done</button>
      </div>`;
    until = Date.now() + 10 * 60 * 1000;   // pairing.py CODE_TTL_MINUTES, counted here
    countdown();
    tick = setInterval(countdown, 1000);
    watch();
  }

  function countdown() {
    const el = $('phone-timer');
    if (!el) return;
    const left = Math.max(0, until - Date.now()), m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el.textContent = left ? `Code works for ${m}:${String(s).padStart(2, '0')}` : 'This code has run out';
    if (!left) {
      clearInterval(tick); clearInterval(poll);
      dialog.querySelector('.phone-qr')?.classList.add('is-spent');
      const st = $('phone-status');
      if (st) st.innerHTML = 'The code ran out. Press <b>New code</b> to make another.';
    }
  }

  async function watch() {
    clearInterval(poll);
    known = await getJSON('/api/pairing/devices').then(d => new Set((d.devices || []).map(x => x.id))).catch(() => null);
    poll = setInterval(async () => {
      if (!known) return;
      const data = await getJSON('/api/pairing/devices').catch(() => null);
      const added = ((data && data.devices) || []).filter(d => !known.has(d.id));
      if (!added.length) return;
      stop();
      const names = added.map(d => d.name).join(', ');
      const st = $('phone-status');
      if (st) { st.classList.add('is-done'); st.innerHTML = `<span class="phone-tick" aria-hidden="true">✓</span><span><b>${esc(names)}</b> is connected and paired.</span>`; }
      dialog.querySelector('.phone-qr')?.classList.add('is-done');
      toast(`${names} paired`, 'ok');
      if (typeof loadDevices === 'function') loadDevices();
    }, 2000);
  }

  async function load() {
    stop();
    $('phone-body').innerHTML = '<p class="phone-loading">Making a code…</p>';
    const { ok, body } = await postJSON('/api/pairing/link', { base: location.origin });
    if (!ok) {
      $('phone-body').innerHTML = `<p class="phone-empty">${esc(body.error || 'Couldn’t make a code. Is the launcher window still open?')}</p>`;
      return;
    }
    render(body);
  }

  async function open() {
    if (!dialog) build();
    if (!dialog.open) dialog.showModal();
    $('phone-body').innerHTML = '<p class="phone-loading">Making a code…</p>';
    const here = await serverReady();
    if (tourOn() || !here) {
      $('phone-body').innerHTML = `<div class="phone-empty">
        <p><strong>${tourOn() ? 'This is the online demo, so there’s no computer to connect to.' : 'The dashboard’s server isn’t running.'}</strong></p>
        <p>Run Deja Vu1 on your computer (double-click <b>start</b>), then open this from there. You’ll get a code to scan with your phone’s camera.</p>
        <button type="button" class="btn primary" data-phone="close">OK</button></div>`;
      return;
    }
    load();
  }

  /* The phone's side: the QR link carries ?pair=123456. Redeem it once, take it
     out of the address (so a reload or bookmark doesn't try it again), and say so. */
  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    return /Mobile/.test(ua) ? 'Phone' : 'Browser';
  }
  async function redeemFromLink() {
    const params = new URLSearchParams(location.search);
    const code = params.get('pair');
    if (code === null) return;
    params.delete('pair');
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (!/^\d{6}$/.test(code)) return;
    try {
      const r = await fetch('/api/pairing/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, device_name: deviceName() }) });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        toast(`Paired. This ${deviceName() === 'Browser' ? 'device' : 'phone'} is on the list now. Tip: add it to your Home Screen for one-tap access.`, 'ok', 9000);
        // A pairing-code prompt may have opened (device lock) before the key arrived.
        const reloadIfAsked = () => { if (document.querySelector('#pair-gate[open]')) location.reload(); };
        reloadIfAsked(); setTimeout(reloadIfAsked, 1500);
      } else {
        toast(`Opened, but not paired: ${body.error || 'the code didn’t work'}. That’s fine unless the device lock is on.`, 'info', 9000);
      }
    } catch { /* no server: nothing to pair with */ }
  }

  document.addEventListener('DOMContentLoaded', redeemFromLink);
  return { open, close };
})();
