/* errorhelp.js: what a printer's error code means, in Snapmaker's own words.
 *
 * One window (a dialog) explains a code: the four groups of its number as a readout, the title and details Snapmaker's wiki gives it
 * (quoted, with the page they came from and the day they were read), a video where Snapmaker has one, and the wiki's troubleshooting guide
 * on request. The guide is read by the server (backend/error_guides.py) and arrives as plain blocks, never as the wiki's own HTML, so
 * everything here goes through esc(). Videos wait behind a button: nothing from YouTube loads until it is pressed, and Snapmaker's own clips
 * (preload none) do not download until played.
 *
 * Anything with data-errhelp="0002-0523-0000-0000" opens the window, wherever it is drawn (the Printer screen, Overview, the Care logbook,
 * a notification, the assistant's chat). ErrorHelp.strip(problem) draws the one-line version those screens share. The Care tab also gets a
 * small lookup card, so a code read off the printer's screen can be searched without a printer connected.
 */
'use strict';
window.ErrorHelp = (() => {
  const SUPPORT = 'https://snapmaker.formcrafts.com/u1-troubleshooting-request';
  const LEVEL = { 1: ['Notice', 'notice'], 2: ['Warning', 'warning'], 3: ['Error', 'error'] };
  const EFFECT = { paused: 'The print is paused', stopped: 'The print was stopped', continues: 'The print carries on' };
  const NOTE_KINDS = ['info', 'warning', 'danger', 'success'];
  let dlg = null, ref = null, seq = 0, nowProblem = null, shown = new Set();

  const $ = id => document.getElementById(id);
  const safeUrl = u => (/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : '');
  const wikiMedia = u => (/^https:\/\/wiki\.snapmaker\.com\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : '');
  const ytId = v => (/^[A-Za-z0-9_-]{11}$/.test(String(v || '')) ? String(v) : '');
  const secs = n => (Number.isFinite(Number(n)) && Number(n) > 0 && Number(n) < 86400 ? Math.floor(Number(n)) : 0);
  const mmss = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const day = iso => {
    const d = new Date(String(iso || '').length === 10 ? `${iso}T12:00:00` : iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const levelOf = p => LEVEL[p && p.level] || [(p && p.level_name) || 'Code', 'notice'];

  /* ---- the pieces ------------------------------------------------------------------------------------------------ */

  function strip(p, printerId) {
    if (!p || !p.code) return '';
    const [word, kind] = levelOf(p);
    // The U1 paused a print by itself with the words "detected dirty bed" (22 November 2026); say what to do about it.
    const hint = p.message && /dirty bed/i.test(p.message) ? '<span class="eh-hint">Take what is on the bed off, then press Resume.</span>' : '';
    return `<div class="eh-strip is-${kind}"><span class="eh-level is-${kind}">${esc(word)}</span>
      <span class="eh-strip-text"><b>${esc(p.title || (p.message && String(p.message).length < 80 ? p.message : '') || 'Printer error')}</b><code>${esc(p.code)}</code>${hint}</span>
      <button class="btn small" type="button" data-errhelp="${esc(p.code)}"${printerId ? ` data-printer="${esc(printerId)}"` : ''}>What does this mean?</button></div>`;
  }

  function segments(d) {
    const [level, module, sub, issue] = d.code.split('-');
    const seg = (cls, value, caption) => `<span class="eh-seg ${cls}"><b>${esc(value)}</b><i>${esc(caption)}</i></span>`;
    return `<div class="eh-code is-${levelOf(d)[1]}" role="group" aria-label="Error code ${esc(d.code)}">
      ${seg('is-level', level, d.level_name ? `Level · ${d.level_name}` : 'Level')}
      ${seg('is-module', module, d.module_name ? `Module · ${d.module_name}` : 'Module')}
      ${seg('is-sub', sub, 'Sub-module')}${seg('is-issue', issue, 'Issue')}</div>`;
  }

  function video(id, title, start) {
    id = ytId(id);
    if (!id) return '';
    start = secs(start);
    const name = title || 'Snapmaker video';
    return `<div class="eh-video" data-yt="${id}" data-start="${start}" data-title="${esc(name)}">
      <button type="button" class="eh-play"><span class="eh-play-icon" aria-hidden="true"></span>
        <span class="eh-play-text"><b>${esc(name)}</b><small>${start ? `Starts at ${mmss(start)} · ` : ''}Snapmaker on YouTube · press to play</small></span></button>
      <p class="eh-video-note">Playing loads YouTube's player and tells YouTube the address of this page.
        <a href="https://www.youtube.com/watch?v=${id}${start ? `&amp;t=${start}s` : ''}" target="_blank" rel="noopener noreferrer">Open it on YouTube instead</a></p></div>`;
  }

  function play(box) {
    const id = ytId(box.dataset.yt);
    if (!id) return;
    const f = document.createElement('iframe');
    const start = secs(box.dataset.start);
    f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ''}`;
    f.title = box.dataset.title || 'Snapmaker video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    box.querySelector('.eh-play').replaceWith(f);
    box.classList.add('is-playing');
  }

  function runs(list) {
    return (list || []).map(r => {
      let t = esc(r.x || '').replace(/\n/g, '<br>');
      if (r.b) t = `<b>${t}</b>`;
      if (ytId(r.yt)) return `<button type="button" class="eh-link eh-ytlink" data-play="${esc(r.yt)}" data-start="${secs(r.start)}" data-title="${esc(r.x || '')}">${t}</button>`;
      if (safeUrl(r.u)) return `<a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
      return t;
    }).join('');
  }

  function block(b) {
    if (b.t === 'h') return `<${b.l === 1 ? 'h4' : 'h5'} class="eh-h eh-h${esc(b.l)}">${esc(b.x)}</${b.l === 1 ? 'h4' : 'h5'}>`;
    if (b.t === 'p') return `<p>${runs(b.r)}</p>`;
    if (b.t === 'list') {
      return `<${b.o ? 'ol' : 'ul'} class="eh-list">${(b.i || []).map(i => `<li class="eh-d${Math.min(3, Number(i.d) || 0)}">${runs(i.r)}</li>`).join('')}</${b.o ? 'ol' : 'ul'}>`;
    }
    if (b.t === 'note') {
      const kind = NOTE_KINDS.includes(b.k) ? b.k : 'info';
      return `<aside class="eh-note is-${kind}">${(b.p || []).map(p => `<p>${runs(p)}</p>`).join('')}</aside>`;
    }
    if (b.t === 'img' && wikiMedia(b.src)) {
      return `<figure class="eh-fig"><a href="${esc(b.src)}" target="_blank" rel="noopener noreferrer"><img src="${esc(b.src)}" alt="${esc(b.alt || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a></figure>`;
    }
    if (b.t === 'video' && wikiMedia(b.src)) {
      return `<figure class="eh-fig"><video controls preload="none" playsinline src="${esc(b.src)}">Your browser cannot play this clip. <a href="${esc(b.src)}" target="_blank" rel="noopener noreferrer">Open it</a></video></figure>`;
    }
    if (b.t === 'table') {
      const rows = (b.rows || []).map((row, i) => `<tr>${row.map(c => `<${i === 0 && b.rows.length > 1 ? 'th scope="col"' : 'td'}>${runs(c)}</${i === 0 && b.rows.length > 1 ? 'th' : 'td'}>`).join('')}</tr>`);
      return `<div class="eh-tablewrap"><table>${rows.join('')}</table></div>`;
    }
    if (b.t === 'code') return `<pre class="eh-pre">${esc(b.x)}</pre>`;
    return '';
  }

  function guideHtml(got) {
    const g = got.guide;
    const stale = got.stale ? `<p class="eh-warn">Snapmaker's wiki could not be reached just now${got.note ? ` (${esc(got.note)})` : ''}. This is the copy saved on this computer.</p>` : '';
    const clips = (g.videos || []).filter(v => !shown.has(v.id)).slice(0, 6).map(v => video(v.id, v.title, v.start)).join('');
    return `<header class="eh-guide-head"><h4>Snapmaker's guide: ${esc(g.title)}</h4>
        <p class="eh-source">From the Snapmaker Wiki, read ${esc(day(g.fetched))}${got.from === 'saved' ? ' and kept on this computer' : ''}.
          <a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">Open it on the wiki</a>
          <button class="eh-link" type="button" data-refresh="${esc(g.slug)}">Read it again</button></p></header>${stale}
      ${clips ? `<div class="eh-clips"><h5 class="eh-h eh-h2">Videos for this guide</h5>${clips}</div>` : ''}
      <div class="eh-article">${(g.blocks || []).map(block).join('')}</div>`;
  }

  /* ---- the window ------------------------------------------------------------------------------------------------ */

  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'glass-dialog eh-dialog';
    dlg.setAttribute('aria-labelledby', 'eh-title');
    dlg.innerHTML = `<div class="dialog-panel liquid-glass deep eh-panel" data-tint>
        <div class="eh-bar"><form class="eh-search" id="eh-form" role="search">
            <label class="sr-only" for="eh-q">Look up an error code</label>
            <input id="eh-q" type="search" placeholder="Search by code or words" autocomplete="off" maxlength="80">
          </form><button class="btn small" type="button" id="eh-close" aria-label="Close">Close</button></div>
        <div class="eh-body" id="eh-body" tabindex="-1"></div></div>`;
    document.body.appendChild(dlg);
    $('eh-close').onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    let timer = 0;
    $('eh-q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => look($('eh-q').value), 220); };
    $('eh-form').onsubmit = e => { e.preventDefault(); clearTimeout(timer); look($('eh-q').value, true); };
    $('eh-body').addEventListener('click', onBodyClick);
    return dlg;
  }

  function show() {
    ensure();
    if (!dlg.open) { try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); } }
  }

  function say(html) { $('eh-body').innerHTML = html; }

  function failure(r, what) {
    // The online demo holds only the lookups it recorded; say so rather than show a server-sounding error.
    const miss = r && /online demo/i.test(r.error || '');
    return `<div class="eh-empty"><h3>${esc(miss ? 'The online demo has only a few lookups' : what)}</h3>
      <p>${esc(miss ? 'Try “filament runout”, “tangled” or “0523”. The app itself looks up every code Snapmaker lists.' : ((r && r.error) || 'Something went wrong.'))}</p></div>`;
  }

  async function open(code, printerId) {
    show();
    if (code && /^\d{4}-\d{4}-\d{4}-\d{4}$/.test(String(code))) { $('eh-q').value = ''; await showCode(code); }
    else { $('eh-q').value = String(code || ''); await look($('eh-q').value); $('eh-q').focus(); }
  }

  async function showCode(code) {
    const mine = ++seq;
    say('<p class="eh-wait" role="status">Looking this code up…</p>');
    const d = await getJSON(`/api/errors/code?code=${encodeURIComponent(code)}`).catch(() => null);
    if (mine !== seq) return;
    if (!d || d.error || !d.code) { say(failure(d, 'That code could not be looked up')); return; }
    say(detail(d));
    $('eh-body').focus({ preventScroll: true });
    $('eh-body').scrollTop = 0;
  }

  function detail(d) {
    const [word, kind] = levelOf(d);
    const src = d.source || {};
    const read = day(src.retrieved);
    const said = d.message && d.details && d.message.trim().toLowerCase() !== d.details.trim().toLowerCase() && !d.message.trim().startsWith('{');
    const clips = [d.video, ...((d.guide && d.guide.videos) || [])].filter((c, i, all) => c && all.findIndex(o => o && o.id === c.id) === i).slice(0, 4);
    shown = new Set(clips.map(c => c.id));
    const guideNote = d.guide && d.guide.match === 'title' ? 'A guide with the same name as this error. It does not name this exact code.' : '';
    const unknown = `<p class="eh-unknown">Snapmaker's error table${read ? ` (read ${esc(read)})` : ''} does not list this code, so there are no official words for it here.
        Its groups still say: level ${esc(d.code.slice(0, 4))} is ${d.level_name ? `a ${esc(d.level_name.toLowerCase())}` : 'not a level in the table'}${d.effect ? ` (${esc(EFFECT[d.effect].toLowerCase())})` : ''},
        and module ${esc(d.code.slice(5, 9))} ${d.module_name ? `is ${esc(d.module_name.toLowerCase())}` : 'is not in the table'}.
        ${d.guide ? 'Snapmaker does have a guide that names it, below.' : 'If it keeps coming back, record the code and tell Snapmaker support.'}</p>`;
    return `<div class="eh-detail">
      <div class="eh-top"><span class="eh-level is-${kind}">${esc(word)}</span>${EFFECT[d.effect] ? `<span class="eh-effect">${esc(EFFECT[d.effect])}</span>` : ''}</div>
      ${segments(d)}
      <h3 class="eh-title" id="eh-title">${esc(d.title || (d.known ? 'Printer error' : 'Not in Snapmaker\'s table'))}</h3>
      ${d.known ? `<figure class="eh-said"><blockquote><p>${esc(d.details)}</p></blockquote>
        <figcaption>Snapmaker's words, from the <a href="${esc(safeUrl(src.url))}" target="_blank" rel="noopener noreferrer">U1 error code reference table</a>${read ? `, read ${esc(read)}` : ''}.</figcaption></figure>` : unknown}
      ${said ? `<p class="eh-printer">The printer also said: <q>${esc(d.message)}</q></p>` : ''}
      ${clips.length ? `<div class="eh-clips"><h5 class="eh-h eh-h2">${clips.length > 1 ? 'Snapmaker\'s videos for this' : 'Snapmaker\'s video for this'}</h5>${clips.map(c => video(c.id, c.title, c.start)).join('')}</div>` : ''}
      ${d.guide ? `<section class="eh-guide" id="eh-guide" aria-live="polite">
        <button class="btn primary" type="button" data-guide="${esc(d.guide.slug)}">Show Snapmaker's guide here</button>
        <p class="eh-hint">${esc(d.guide.title)}.${guideNote ? ` ${esc(guideNote)}` : ''}${d.guide_saved ? ' Already saved on this computer, so it opens without the internet.' : ' It is read from the wiki when you press the button, then kept on this computer.'}</p></section>` : ''}
      <p class="eh-help">If it keeps happening, Snapmaker asks you to record the code and
        <a href="${SUPPORT}" target="_blank" rel="noopener noreferrer">contact their support</a>.${d.guide ? ` <a href="${esc(d.guide.url)}" target="_blank" rel="noopener noreferrer">Open the guide on the wiki</a>.` : ''}</p>
      <details class="eh-how" id="eh-how"><summary>How to read a code</summary><div id="eh-how-body"><p class="eh-wait">Loading…</p></div></details>
    </div>`;
  }

  async function how() {
    const host = $('eh-how-body');
    if (!host || host.dataset.done) return;
    if (!ref) ref = await getJSON('/api/errors/reference').catch(() => null);
    if (!ref || ref.error) { host.innerHTML = '<p class="eh-warn">The list of how codes work could not be loaded.</p>'; return; }
    host.dataset.done = '1';
    const levels = Object.keys(ref.levels || {}).filter(k => Number(k) > 0).map(k => {
      const l = ref.levels[k];
      return `<tr><th scope="row">000${esc(k)} ${esc(l.name)}</th><td>${esc(l.print_effect)}</td><td>${esc(l.safety_risk)}</td><td>${esc(l.user_action)}</td></tr>`;
    }).join('');
    const mods = Object.keys(ref.modules || {}).map(k => `<li><code>${esc(k)}</code> ${esc(ref.modules[k])}</li>`).join('');
    host.innerHTML = `<p>A code is four groups of four digits: the level, the module, the sub-module and the issue.
        ${(ref.structure || []).filter(s => s.text).map(s => `<br><b>${esc(s.name)}:</b> ${esc(s.text)}`).join('')}</p>
      <div class="eh-tablewrap"><table><thead><tr><th scope="col">Level</th><th scope="col">What happens to the print</th><th scope="col">Risk to the printer</th><th scope="col">Do you need to act?</th></tr></thead><tbody>${levels}</tbody></table></div>
      <h5 class="eh-h eh-h2">Modules</h5><ul class="eh-mods">${mods}</ul>
      ${(ref.notes || []).map(n => `<p class="eh-fine">${esc(n)}</p>`).join('')}
      <p class="eh-source">All from the Snapmaker Wiki's <a href="${esc(safeUrl((ref.source || {}).url))}" target="_blank" rel="noopener noreferrer">U1 error code reference table</a>,
        read ${esc(day((ref.source || {}).retrieved))}: ${esc(ref.counts.codes)} codes, ${esc(ref.counts.guides)} with a guide, ${esc(ref.counts.videos)} with a video.</p>`;
  }

  async function look(q, force) {
    q = String(q || '').trim();
    const mine = ++seq;
    if (/^\d{4}-\d{4}-\d{4}-\d{4}$/.test(q) && force) { await showCode(q); return; }
    if (!q) {
      say(`<div class="eh-empty"><h3 id="eh-title">Error codes</h3><p>Type a code from the printer's screen, or a few words. Snapmaker lists
        every U1 code with what it means and what to try.</p><details class="eh-how" id="eh-how"><summary>How to read a code</summary><div id="eh-how-body"><p class="eh-wait">Loading…</p></div></details></div>`);
      return;
    }
    const r = await getJSON(`/api/errors/search?q=${encodeURIComponent(q)}`).catch(() => null);
    if (mine !== seq) return;
    if (!r || r.error) { say(failure(r, 'The search did not work')); return; }
    if (!r.results.length) { say(`<div class="eh-empty"><h3 id="eh-title">Nothing matches “${esc(q)}”</h3><p>Try the whole code from the printer's screen, part of it (0523-0001), or other words.</p></div>`); return; }
    say(`<h3 class="eh-count" id="eh-title" role="status">${esc(r.total)} ${r.total === 1 ? 'code matches' : 'codes match'}${r.total > r.results.length ? `, the first ${esc(r.results.length)} shown` : ''}</h3>
      <ul class="eh-results">${r.results.map(c => {
        const kind = (LEVEL[c.level] || [0, 'notice'])[1];
        return `<li><button type="button" class="eh-row" data-code="${esc(c.code)}"><span class="eh-level is-${kind}">${esc(c.level_name || '')}</span>
          <code>${esc(c.code)}</code><b>${esc(c.title)}</b><span class="eh-row-d">${esc(c.details)}</span>${c.guide || c.video ? `<small>${c.guide ? 'Guide' : ''}${c.guide && c.video ? ' · ' : ''}${c.video ? 'Video' : ''}</small>` : ''}</button></li>`;
      }).join('')}</ul>`);
  }

  async function loadGuide(slug, refresh, button) {
    const host = $('eh-guide');
    if (!host) return;
    if (button) { button.disabled = true; button.textContent = 'Reading the wiki…'; }
    const got = await getJSON(`/api/errors/guide?slug=${encodeURIComponent(slug)}${refresh ? '&refresh=1' : ''}`).catch(() => null);
    if (!host.isConnected) return;
    if (!got || got.error || !got.ok) {
      const url = got && safeUrl(got.url);
      host.innerHTML = `<p class="eh-warn">${esc((got && (got.error || (got.module_disabled && 'The error codes feature is switched off.'))) || 'The guide could not be read.')}</p>
        ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open the guide on the wiki</a></p>` : ''}
        <button class="btn" type="button" data-guide="${esc(slug)}">Try again</button>`;
      return;
    }
    host.innerHTML = guideHtml(got);
    host.focus({ preventScroll: true });
  }

  function onBodyClick(e) {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.code) showCode(t.dataset.code);
    else if (t.dataset.guide) loadGuide(t.dataset.guide, false, t);
    else if (t.dataset.refresh) loadGuide(t.dataset.refresh, true, t);
    else if (t.dataset.play) {
      const holder = document.createElement('div');
      holder.innerHTML = video(t.dataset.play, t.dataset.title, t.dataset.start);
      const box = holder.firstElementChild;
      if (box) { t.closest('p, li, td, th, aside').after(box); play(box); }
    }
  }

  /* ---- the Care tab's lookup card and the places that open the window ------------------------------------------ */

  function lookupCard() {
    const tab = $('tab-maintenance');
    if (!tab || $('error-codes')) return;
    const card = document.createElement('section');
    card.className = 'card liquid-glass eh-lookup';
    card.id = 'error-codes';
    card.setAttribute('aria-labelledby', 'eh-card-title');
    card.innerHTML = `<div class="card-head"><div><h2 id="eh-card-title">Error codes</h2>
        <p class="card-sub">What a Snapmaker U1 error code means, in Snapmaker's own words, with their guides and videos.</p></div></div>
      <div class="eh-now" id="eh-card-now" hidden></div>
      <form class="eh-card-form" id="eh-card-form" role="search"><label class="sr-only" for="eh-card-q">Look up an error code</label>
        <input id="eh-card-q" type="search" placeholder="0002-0523-0000-0000, or words like filament runout" autocomplete="off" maxlength="80">
        <button class="btn primary" type="submit">Look up</button></form>
      <div class="eh-said-list" id="eh-card-said" hidden></div>`;
    const log = $('logbook');
    if (log) log.before(card);
    else tab.appendChild(card);
    $('eh-card-form').onsubmit = e => {
      e.preventDefault();
      const q = $('eh-card-q').value.trim();
      show();
      $('eh-q').value = q;
      if (/^\d{4}-\d{4}-\d{4}-\d{4}$/.test(q)) showCode(q); else look(q).then(() => $('eh-q').focus());
    };
  }

  // What the printer itself said that matters (backend/moonraker_client.py `messages`): problems with their codes, error replies, shutdown reasons.
  async function loadSaid() {
    const host = $('eh-card-said');
    if (!host) return;
    const d = await getJSON(api('/api/printer/problems')).catch(() => null);
    const rows = d && Array.isArray(d.messages) ? d.messages.slice(0, 8) : [];
    host.hidden = !rows.length;
    if (!rows.length) { host.innerHTML = ''; return; }
    const kinds = { problem: 'Problem', response: 'Error reply', shutdown: 'Shutdown' };
    host.innerHTML = `<h3 class="eh-said-h">What the printer said lately</h3><ul class="eh-msgs">${rows.map(m => `<li><time>${esc(String(m.time || '').slice(11, 16))}</time>
      <span class="eh-msg-kind">${esc(kinds[m.kind] || 'Message')}</span>${m.code ? `<button type="button" class="eh-link" data-errhelp="${esc(m.code)}">${esc(m.code)}</button>` : ''}
      <span class="eh-msg-text">${esc(m.detail || '')}</span></li>`).join('')}</ul>`;
  }

  function paintNow() {
    const host = $('eh-card-now');
    if (!host) return;
    host.hidden = !nowProblem;
    host.innerHTML = nowProblem ? `<p class="eh-now-label">The printer is reporting this now</p>${strip(nowProblem, nowProblem.printer)}` : '';
  }

  // A video's play button works wherever it is drawn (the window, the assistant's chat).
  document.addEventListener('click', e => {
    const b = e.target.closest('.eh-play');
    if (b && b.closest('.eh-video')) play(b.closest('.eh-video'));
  });
  // Capture phase, and the press goes no further: a strip inside the print tile must not also open the tile's own sheet.
  // The tile repaints every time the printer reports a new figure, and a repaint between pressing the mouse and letting go replaces the
  // button: the browser then sends the click to the tile around it (its own sheet opened, seen on a real U1 on 22 November 2026) or sends
  // none. So a press that began on an explain button and ended in the same place opens the explanation as the button comes up, and the
  // click that may follow is dropped. A key press on the button still arrives as a click.
  let pressed = null, handled = null;
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest('[data-errhelp]');
    pressed = b ? { code: b.dataset.errhelp, printer: b.dataset.printer, x: e.clientX, y: e.clientY, at: Date.now() } : null;
  }, true);
  document.addEventListener('pointercancel', () => { pressed = null; }, true);
  document.addEventListener('pointerup', e => {
    const from = pressed;
    pressed = null;
    if (!from || Date.now() - from.at > 1500 || Math.abs(e.clientX - from.x) > 8 || Math.abs(e.clientY - from.y) > 8) return;
    handled = { at: Date.now(), x: e.clientX, y: e.clientY };
    open(from.code, from.printer);
  }, true);
  document.addEventListener('click', e => {
    // Only the click that belongs to the press just handled is dropped: one click, at the same place, within 700 ms. A later press
    // on something else (the window's own buttons) always arrives.
    const h = handled;
    handled = null;
    if (h && Date.now() - h.at < 700 && Math.abs(e.clientX - h.x) <= 8 && Math.abs(e.clientY - h.y) <= 8) { e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target.closest('[data-errhelp]');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    open(t.dataset.errhelp, t.dataset.printer);
  }, true);
  window.addEventListener('dv-state', e => {
    const s = e.detail;
    const p = s && s.problem && s.problem.code ? Object.assign({ printer: s.printer_id }, s.problem) : null;
    if ((p && p.code) !== (nowProblem && nowProblem.code)) { nowProblem = p; paintNow(); }
  });
  window.addEventListener('dv-tab', e => { if (e.detail === 'maintenance') { lookupCard(); loadSaid(); } });
  window.addEventListener('dv-live-event', e => { if (e.detail && e.detail.type === 'printer_problem' && $('eh-card-said') && $('eh-card-said').offsetParent) loadSaid(); });
  window.addEventListener('dv-refresh', () => { if ($('eh-card-said') && $('eh-card-said').closest('.tab-panel:not([hidden])')) loadSaid(); });
  lookupCard();
  document.addEventListener('DOMContentLoaded', lookupCard);
  dlgToggleHook();

  function dlgToggleHook() {
    document.addEventListener('toggle', e => { if (e.target && e.target.id === 'eh-how' && e.target.open) how(); }, true);
  }

  return { open, strip, video, look: q => open(q) };
})();
