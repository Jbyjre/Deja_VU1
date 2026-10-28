/* The notification orb: a glass orb in the bottom-right corner. Each message
   rises out of it as a bubble, stays a few seconds (longer while you point at
   it), then sinks back in. The orb keeps the last 30, plus the app's own
   version and update news, in a panel it opens on click.

   Only transform and opacity animate, so a message costs no layout or blur
   work per frame. The bubbles share one live region (the old #toasts), so a
   screen reader hears what a sighted user sees. */
'use strict';
window.Orb = (() => {
  const dock = $('orb-dock'), orb = $('orb'), stack = $('toasts'), panel = $('orb-panel');
  const list = $('orb-list'), count = $('orb-count'), app = $('orb-app');
  const MAX_SHOWN = 3, KEEP = 30;
  const history = [];
  let unread = 0, appStatus = null;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KIND = { ok: 'Done', warn: 'Heads up', bad: 'Problem', info: 'Note' };

  function setUnread(n) {
    unread = n;
    count.hidden = !n;
    count.textContent = n > 9 ? '9+' : String(n);
    orb.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
    orb.classList.toggle('has-unread', !!n);
  }

  // The orb takes in a message: a short squeeze, and the whole sphere takes the message's colour.
  function gulp(kind) {
    orb.dataset.kind = kind;
    if (still()) return;
    orb.classList.remove('is-gulp');
    void orb.offsetWidth; // restart the animation
    orb.classList.add('is-gulp');
  }

  function remove(item, early) {
    if (item.gone) return;
    item.gone = true;
    clearTimeout(item.timer);
    item.wrap.classList.remove('is-in');
    item.wrap.classList.add('is-out');
    if (!panel.hidden) renderList(); else if (!early) setUnread(unread + 1);
    gulp(item.kind);
    setTimeout(() => item.wrap.remove(), still() ? 0 : 520);
  }

  /* A bubble's life: `left` ms to go, paused while pointed at, focused, or
   * while the tab is hidden (a message that arrives while you are away waits
   * for you). The thin line along its bottom shows the time left. */
  function arm(item, left = item.ms) {
    clearTimeout(item.timer);
    item.left = left;
    item.started = performance.now();
    item.wrap.style.setProperty('--life', `${left}ms`);
    item.wrap.style.setProperty('--from', (left / item.ms).toFixed(3));
    if (item.life) { item.life.style.animation = 'none'; void item.life.offsetWidth; item.life.style.animation = ''; }
    item.wrap.classList.remove('is-held');
    if (document.hidden) { hold(item); return; }
    item.timer = setTimeout(() => remove(item), left);
  }
  function hold(item) {
    if (item.gone) return;
    clearTimeout(item.timer);
    if (!item.wrap.classList.contains('is-held')) item.left = Math.max(1200, item.left - (performance.now() - item.started));
    item.wrap.classList.add('is-held');
  }
  const live = () => [...stack.querySelectorAll('.orb-bubble-wrap:not(.is-out)')].map(w => w._item).filter(Boolean);
  document.addEventListener('visibilitychange', () => live().forEach(item => (document.hidden ? hold(item) : arm(item, item.left))));

  // Time to read it: about a quarter of a second a word, longer for a problem.
  function readingTime(message, kind, ms, action) {
    const words = message.split(/\s+/).length;
    let t = Math.max(ms, 2600 + words * 250);
    if (kind === 'bad') t = Math.max(t, 9000);
    if (action) t += 3000;
    return Math.min(t, 16000);
  }

  function notify(message, kind = 'info', ms = 4200, options = {}) {
    kind = KIND[kind] ? kind : 'info';
    message = String(message);
    // The same message again while it is still showing: count it, don't stack it.
    const twin = live().find(item => item.message === message && item.kind === kind && !item.entry.action && !options.action);
    if (twin) {
      twin.entry.count = (twin.entry.count || 1) + 1;
      twin.entry.at = Date.now();
      twin.badge.textContent = `×${twin.entry.count}`;
      twin.badge.hidden = false;
      twin.wrap.classList.remove('is-bump'); void twin.wrap.offsetWidth; twin.wrap.classList.add('is-bump');
      arm(twin);
      save();
      if (!panel.hidden) renderList();
      return twin;
    }
    const entry = { message, kind, at: Date.now(), action: options.action || null, count: 1 };
    history.unshift(entry);
    history.length = Math.min(history.length, KEEP);
    save();

    const wrap = document.createElement('div');
    wrap.className = `orb-bubble-wrap is-${kind}`;
    const bubble = document.createElement('div');
    bubble.className = 'orb-bubble';
    bubble.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    bubble.innerHTML = `<span class="ob-kind">${esc(KIND[kind])}<b class="ob-count" hidden></b></span><span class="ob-text"></span><span class="ob-life" aria-hidden="true"></span>`;
    bubble.querySelector('.ob-text').textContent = entry.message;
    if (entry.action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn small primary ob-action'; b.textContent = entry.action.label;
      b.onclick = () => { remove(item, true); entry.action.run(); };
      bubble.append(b);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'ob-close'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '×';
    close.onclick = () => remove(item, true);
    bubble.append(close);
    wrap.append(bubble);
    stack.append(wrap);
    const item = { wrap, kind, message, entry, badge: bubble.querySelector('.ob-count'), life: bubble.querySelector('.ob-life'),
                   ms: readingTime(message, kind, ms, entry.action), timer: 0, gone: false, left: 0, started: 0 };
    // Pointing at a message, or tabbing into it, holds it until you move away.
    wrap.addEventListener('pointerenter', () => hold(item));
    wrap.addEventListener('pointerleave', () => arm(item, item.left));
    wrap.addEventListener('focusin', () => hold(item));
    wrap.addEventListener('focusout', () => arm(item, item.left));
    swipeAway(bubble, item);
    wrap._item = item;
    const shown = live();
    shown.slice(0, Math.max(0, shown.length - MAX_SHOWN)).forEach(old => remove(old, false));
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('is-in')));
    orb.dataset.kind = kind;
    arm(item);
    if (!panel.hidden) renderList();
    return item;
  }

  // On a touch screen a bubble can be flicked sideways to dismiss it.
  function swipeAway(bubble, item) {
    let x0 = null, dx = 0;
    bubble.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      x0 = e.clientX; dx = 0; bubble.setPointerCapture(e.pointerId); bubble.classList.add('is-drag');
    });
    bubble.addEventListener('pointermove', e => {
      if (x0 == null) return;
      dx = Math.max(-40, e.clientX - x0);
      bubble.style.transform = `translateX(${dx}px)`;
      bubble.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220));
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null; bubble.classList.remove('is-drag'); bubble.style.transform = ''; bubble.style.opacity = '';
      if (dx > 90) remove(item, true);
    };
    bubble.addEventListener('pointerup', end);
    bubble.addEventListener('pointercancel', end);
  }

  // The list survives a page reload in this tab (not the buttons: they belonged to the old page).
  function save() {
    try { sessionStorage.setItem('dv-orb', JSON.stringify(history.map(({ message, kind, at, count }) => ({ message, kind, at, count })))); } catch (e) { /* private mode */ }
  }
  try {
    const kept = JSON.parse(sessionStorage.getItem('dv-orb') || '[]');
    if (Array.isArray(kept)) kept.slice(0, KEEP).forEach(h => h && typeof h.message === 'string' && KIND[h.kind] && history.push({ ...h, action: null }));
  } catch (e) { /* nothing kept */ }

  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderList() {
    list.replaceChildren(...history.map(h => {
      const li = document.createElement('li');
      li.className = `is-${h.kind}`;
      li.innerHTML = `<span class="ol-kind">${esc(KIND[h.kind])}${h.count > 1 ? ` <b class="ob-count">×${h.count}</b>` : ''}</span><time class="ol-time" datetime="${new Date(h.at).toISOString()}">${esc(ago(h.at))}</time><span class="ol-text"></span>`;
      li.querySelector('.ol-text').textContent = h.message;
      if (h.action) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn small'; b.textContent = h.action.label;
        b.onclick = () => { close(); h.action.run(); };
        li.append(b);
      }
      return li;
    }));
    $('orb-empty').hidden = history.length > 0;
    renderApp();
  }

  function renderApp() {
    if (!appStatus) { app.hidden = true; return; }
    app.hidden = false;
    app.innerHTML = `<div class="oa-row"><span class="oa-ver">${esc(appStatus.version)}</span><span class="oa-text"></span></div>`;
    app.querySelector('.oa-text').textContent = appStatus.text;
    (appStatus.actions || []).forEach(a => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `btn small${a.primary ? ' primary' : ''}`; b.textContent = a.label;
      b.onclick = () => { close(); a.run(); };
      app.append(b);
    });
  }

  function open() {
    renderList();
    panel.hidden = false;
    orb.setAttribute('aria-expanded', 'true');
    dock.classList.add('is-open');
    setUnread(0);
    delete orb.dataset.kind; // everything read: back to its resting colour
    requestAnimationFrame(() => panel.classList.add('is-in'));
    $('orb-panel-title').tabIndex = -1;
    $('orb-panel-title').focus({ preventScroll: true });
  }
  function close() {
    if (panel.hidden) return;
    panel.classList.remove('is-in');
    orb.setAttribute('aria-expanded', 'false');
    dock.classList.remove('is-open');
    setTimeout(() => { if (!panel.classList.contains('is-in')) panel.hidden = true; }, still() ? 0 : 260);
  }
  orb.addEventListener('click', () => (panel.hidden ? open() : close()));
  $('orb-clear').onclick = () => { history.length = 0; save(); renderList(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { close(); orb.focus(); } });
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !dock.contains(e.target)) close(); });

  // The orb's highlight follows the pointer when it is near, like the other glass.
  orb.addEventListener('pointermove', e => {
    const r = orb.getBoundingClientRect();
    orb.style.setProperty('--ox', `${((e.clientX - r.left) / r.width) * 100}%`);
    orb.style.setProperty('--oy', `${((e.clientY - r.top) / r.height) * 100}%`);
  });

  /* Version and update news, shown at the top of the panel and as a dot on the orb. */
  function setApp(status) {
    appStatus = status;
    orb.classList.toggle('has-update', !!(status && status.update));
    if (!panel.hidden) renderApp();
  }

  return { notify, open, close, setApp, history };
})();
