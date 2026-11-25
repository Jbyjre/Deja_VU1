/* models.js: the Models place (find a model on the sites you use) and Bring it in (backend/model_inbox.py).
 *
 * Search opens a new tab: Printables' own search when it is the only starred site, otherwise one web search limited to
 * the starred sites, because those are the addresses that could be checked. Starred sites and recent searches stay in
 * this browser only. With Watch my Downloads on, the page asks the server every two seconds, while it is visible,
 * what model files are new in the watched folder, and offers each one at the bottom of any screen.
 */
const Models = (() => {
  const $ = id => document.getElementById(id);
  const STAR_KEY = 'dejavu1.models.starred';
  const RECENT_KEY = 'dejavu1.models.recent';
  const SITES = [
    { id: 'makerworld', name: 'MakerWorld', domain: 'makerworld.com', home: 'https://makerworld.com/' },
    { id: 'printables', name: 'Printables', domain: 'printables.com', home: 'https://www.printables.com/',
      search: q => 'https://www.printables.com/search/models?q=' + encodeURIComponent(q) },
    { id: 'thingiverse', name: 'Thingiverse', domain: 'thingiverse.com', home: 'https://www.thingiverse.com/' },
    { id: 'cults', name: 'Cults', domain: 'cults3d.com', home: 'https://cults3d.com/' },
    { id: 'myminifactory', name: 'MyMiniFactory', domain: 'myminifactory.com', home: 'https://www.myminifactory.com/' },
    { id: 'thangs', name: 'Thangs', domain: 'thangs.com', home: 'https://thangs.com/' },
    { id: 'yeggi', name: 'Yeggi', domain: 'yeggi.com', home: 'https://www.yeggi.com/' },
    { id: 'grabcad', name: 'GrabCAD', domain: 'grabcad.com', home: 'https://grabcad.com/library' }
  ];
  const SNAPMAKER = [
    { name: 'Snapmaker Wiki', home: 'https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting', note: 'wiki.snapmaker.com' },
    { name: 'Snapmaker Forum', home: 'https://forum.snapmaker.com/', note: 'forum.snapmaker.com' },
    { name: 'Snapmaker Store', home: 'https://www.snapmaker.com/', note: 'snapmaker.com' }
  ];
  const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
  let inbox = null, timer = null, busy = false;

  const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };
  const starred = () => new Set(read(STAR_KEY, ['makerworld', 'printables', 'thingiverse']));

  function searchUrl(query, sites) {
    if (sites.length === 1 && sites[0].search) return sites[0].search(query);
    const where = sites.map(s => 'site:' + s.domain).join(' OR ');
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(`${query} (${where})`);
  }

  /* ---- Find a model ---- */
  function drawSites() {
    const list = $('models-site-list');
    if (!list) return;
    const stars = starred(), query = ($('models-q').value || '').trim();
    const order = SITES.filter(s => stars.has(s.id)).concat(SITES.filter(s => !stars.has(s.id)));
    list.innerHTML = order.map(s => {
      const on = stars.has(s.id);
      const href = query ? searchUrl(query, [s]) : s.home;
      const sub = query ? `Search for “${esc(query)}”` : esc(s.domain);
      return `<li class="site-tile${on ? ' is-starred' : ''}"><a class="site-row" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-site="${esc(s.id)}"><b>${esc(s.name)}</b><span>${sub}</span>${ARROW}<span class="sr-only">(opens in a new tab)</span></a>`
        + `<button type="button" class="site-star" data-star="${esc(s.id)}" aria-pressed="${on}" aria-label="${on ? `Remove the star from ${esc(s.name)}` : `Star ${esc(s.name)}`}" title="${on ? 'Starred: searched by default' : 'Star to search it by default'}">${on ? '★' : '☆'}</button></li>`;
    }).join('');
    const names = SITES.filter(s => stars.has(s.id)).map(s => s.name);
    $('models-search-hint').textContent = names.length
      ? `Searches ${names.join(', ')}. Press a site to search only that one.`
      : 'Star a site to search it. Press a site to search only that one.';
    const snap = $('models-snapmaker');
    if (snap && !snap.children.length) {
      snap.innerHTML = SNAPMAKER.map(s => `<li><a class="site-row" href="${esc(s.home)}" target="_blank" rel="noopener noreferrer"><b>${esc(s.name)}</b><span>${esc(s.note)}</span>${ARROW}<span class="sr-only">(opens in a new tab)</span></a></li>`).join('');
    }
  }

  function drawRecent() {
    const host = $('models-recent');
    if (!host) return;
    const recent = read(RECENT_KEY, []);
    host.hidden = !recent.length;
    host.innerHTML = recent.length
      ? `<span class="field-hint keep">Recent:</span> ${recent.map(q => `<button type="button" class="chip" data-recent="${esc(q)}">${esc(q)}</button>`).join(' ')} <button type="button" class="btn small" data-recent-clear>Clear</button>`
      : '';
  }

  function search(query) {
    query = String(query || '').trim();
    if (!query) { $('models-q').focus(); return; }
    const stars = starred(), sites = SITES.filter(s => stars.has(s.id));
    window.open(searchUrl(query, sites.length ? sites : SITES), '_blank', 'noopener');
    write(RECENT_KEY, [query].concat(read(RECENT_KEY, []).filter(q => q !== query)).slice(0, 6));
    drawRecent();
  }

  /* ---- Bring it in ---- */
  function sourceLine(src) {
    if (!src) return '';
    const parts = [];
    if (src.site) parts.push(`From ${src.site}.`);
    else if (src.how === 'Link') parts.push('From a pasted link.');
    else if (src.how === 'Downloads') parts.push('From your Downloads folder.');
    if (src.designer) parts.push(`Designer: ${src.designer}.`);
    if (src.licence) parts.push(`Licence: ${src.licence}.`);
    if (src.archive) parts.push(`Unpacked from ${src.archive}.`);
    return parts.join(' ');
  }

  function sourceHtml(src) {
    const line = esc(sourceLine(src));
    if (!line) return '';
    const page = src && /^https?:\/\//i.test(src.page || '') ? src.page : '';
    return page ? `${line} <a href="${esc(page)}" target="_blank" rel="noopener noreferrer">Open its page</a>` : line;
  }

  async function drawImports() {
    const host = $('models-imports');
    if (!host) return;
    const body = await getJSON('/api/files');
    const files = (body && Array.isArray(body.files) ? body.files : []).filter(f => f.source).slice(0, 6);
    if (!files.length) return;
    host.innerHTML = files.map(f => `<li><button type="button" class="link-btn" data-open-file="${esc(f.name)}">${esc(f.name)}</button><span class="field-hint keep">${sourceHtml(f.source)}</span></li>`).join('');
  }

  function offerHtml(o, compact) {
    const big = o.too_big ? `<p class="field-hint keep">It's over ${inbox.max_mb} MB, more than Files takes.</p>` : '';
    return `<div class="model-offer liquid-glass${compact ? ' is-compact' : ''}" data-offer="${esc(o.name)}">
      <p class="model-offer-name">${esc(o.name)} arrived</p>${big}
      <div class="model-offer-acts">${o.too_big ? '' : `<button type="button" class="btn primary small" data-take="slicer">Open in Slicer</button><button type="button" class="btn small" data-take="files">Keep in Files</button>`}<button type="button" class="btn small" data-take="no">Not this one</button></div></div>`;
  }

  function drawInbox() {
    if (!inbox) return;
    const box = $('models-watch'), where = $('models-watch-where');
    if (box) {
      box.checked = !!inbox.watch;
      box.disabled = inbox.here === false;
      const choose = document.querySelector('#models-inbox .models-folder');
      if (choose) choose.hidden = inbox.here === false;
      where.textContent = inbox.here === false
        ? `Watch my Downloads works on the computer running Deja Vu1, where the files arrive.`
        : inbox.folder
        ? (inbox.watch ? `Watching ${inbox.folder}. Only new model files (${inbox.extensions.join(', ')}) are offered, and the folder is only read.` : `It would watch ${inbox.folder}, and only read it.`)
        : 'No Downloads folder was found on this computer. Choose a folder to watch.';
      if ($('models-folder') && !$('models-folder').value && inbox.folder) $('models-folder').value = inbox.folder;
    }
    const offers = inbox.offers || [];
    const list = $('models-offers');
    if (list) list.innerHTML = offers.map(o => offerHtml(o, false)).join('');
    let float = $('models-arrivals');
    if (!float) {
      float = document.createElement('div');
      float.id = 'models-arrivals';
      float.className = 'models-arrivals';
      float.setAttribute('aria-live', 'polite');
      float.addEventListener('click', onOfferClick);
      document.body.appendChild(float);
    }
    const onModels = !!($('tab-models') && !$('tab-models').hidden);
    float.innerHTML = onModels ? '' : offers.slice(0, 2).map(o => offerHtml(o, true)).join('');
  }

  async function loadInbox() {
    const body = await getJSON('/api/models/inbox');
    if (!body || body.error || body.module_disabled || typeof body.watch !== 'boolean') return;
    inbox = body;
    drawInbox();
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (inbox && inbox.watch && inbox.here !== false && !document.hidden) timer = setTimeout(loadInbox, 2000);
  }

  async function send(payload, button) {
    if (button) button.disabled = true;
    const r = await postJSON('/api/models/inbox', payload);
    if (button) button.disabled = false;
    if (!r.ok) { toast(r.body.error || 'That didn’t work', 'bad'); return null; }
    return r.body;
  }

  async function onOfferClick(e) {
    const btn = e.target.closest('[data-take]');
    if (!btn || busy) return;
    const name = btn.closest('[data-offer]').dataset.offer, how = btn.dataset.take;
    busy = true;
    const body = await send({ action: how === 'no' ? 'dismiss' : 'take', name }, btn);
    busy = false;
    if (!body) return;
    inbox = how === 'no' ? body : body.status;
    drawInbox();
    if (how === 'no') return;
    const added = body.added || [];
    if (how === 'slicer' && window.Slicer && added.length) {
      Slicer.open(added[0]);
      toast(added.length > 1 ? `Opened ${added[0]} in the Slicer. The other ${added.length - 1} are in Files.` : `Opened ${added[0]} in the Slicer.`, 'good');
    } else toast(added.length > 1 ? `Added ${added.length} models to Files.` : `Added ${added[0]} to Files.`, 'good');
    drawImports();
  }

  function wire() {
    if (!$('models-search')) return;
    $('models-search').addEventListener('submit', e => { e.preventDefault(); search($('models-q').value); });
    $('models-q').addEventListener('input', drawSites);
    $('models-site-list').addEventListener('click', e => {
      const star = e.target.closest('[data-star]');
      if (!star) return;
      const stars = starred();
      if (stars.has(star.dataset.star)) stars.delete(star.dataset.star); else stars.add(star.dataset.star);
      write(STAR_KEY, Array.from(stars));
      drawSites();
      const again = document.querySelector(`[data-star="${star.dataset.star}"]`);
      if (again) again.focus();
    });
    $('models-site-list').addEventListener('click', e => {
      const link = e.target.closest('a[data-site]');
      const query = ($('models-q').value || '').trim();
      if (link && query) write(RECENT_KEY, [query].concat(read(RECENT_KEY, []).filter(q => q !== query)).slice(0, 6));
    });
    $('models-recent').addEventListener('click', e => {
      if (e.target.closest('[data-recent-clear]')) { write(RECENT_KEY, []); drawRecent(); return; }
      const chip = e.target.closest('[data-recent]');
      if (chip) { $('models-q').value = chip.dataset.recent; drawSites(); search(chip.dataset.recent); }
    });
    $('models-watch').addEventListener('change', async e => {
      const body = await send({ action: 'watch', on: e.target.checked });
      if (body) { inbox = body; drawInbox(); schedule(); } else e.target.checked = !e.target.checked;
    });
    $('models-folder-form').addEventListener('submit', async e => {
      e.preventDefault();
      const body = await send({ action: 'watch', on: !!(inbox && inbox.watch), folder: $('models-folder').value }, e.submitter);
      if (body) { inbox = body; drawInbox(); toast(`Deja Vu1 will watch ${body.folder}.`, 'good'); }
    });
    $('models-link-form').addEventListener('submit', async e => {
      e.preventDefault();
      const url = $('models-link').value.trim();
      if (!url) { $('models-link').focus(); return; }
      const btn = e.submitter, label = btn ? btn.textContent : '';
      if (btn) btn.textContent = 'Downloading…';
      const body = await send({ action: 'link', url }, btn);
      if (btn) btn.textContent = label;
      if (!body) return;
      $('models-link').value = '';
      toast(body.added.length > 1 ? `Added ${body.added.length} models to Files.` : `Added ${body.added[0]} to Files.`, 'good');
      drawImports();
    });
    $('models-offers').addEventListener('click', onOfferClick);
    $('models-imports').addEventListener('click', e => {
      const b = e.target.closest('[data-open-file]');
      if (b && window.Workshop) Workshop.openFile(b.dataset.openFile);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && inbox && inbox.watch) loadInbox(); else schedule(); });
    window.addEventListener('dv-tab', e => { drawInbox(); if (e.detail && e.detail.tab === 'models') drawImports(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wire(); drawSites(); drawRecent(); loadInbox();
    if ($('tab-models') && !$('tab-models').hidden) drawImports();
  });
  return { sourceLine, sourceHtml, reload: loadInbox };
})();
