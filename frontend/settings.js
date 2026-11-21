/* settings.js: Settings as one place, with a left list of groups and a search that finds any setting.
 *
 * Settings and Preferences were two screens; Preferences' cards move into the Settings screen (their ids and listeners come
 * with them) and app.js SECTIONS.modules sorts every card into one of the groups: Printers & connection, Look & layout, Phone &
 * away, Alerts & smart home, Tester mode, Updates, Advanced and Help. The left list shows one group at a time; typing in the
 * search shows every card that mentions the words, from every group, and clearing it goes back to the group you were in.
 * This file also adds the two small cards that belong to the SHELL frame: Look & layout (your experience, the sidebar, Reset
 * layout) and Halt (Ask before Halt). Demo data lives in Advanced, still labelled in the strip whenever it is on.
 */
(() => {
  const $ = id => document.getElementById(id);
  const ASK_KEY = 'dejavu1.pref.haltAsk';
  const panel = $('tab-modules');
  if (!panel || typeof SECTIONS === 'undefined' || !SECTIONS.modules) return;
  let group = null;                  // the group shown before a search started
  let searching = false;

  const seg = (label, name, options, current) => `<div class="pill-toggle" role="group" aria-label="${label}" data-seg="${name}">${
    options.map(([v, text]) => `<button type="button" data-v="${v}" aria-pressed="${v === current}"${v === current ? ' class="active"' : ''}>${text}</button>`).join('')}</div>`;

  function cards() {
    const layout = document.createElement('section');
    layout.className = 'card liquid-glass';
    layout.id = 'layout-card';
    layout.setAttribute('aria-labelledby', 'layout-title');
    const exp = window.DVTheme ? DVTheme.experience() : 'know';
    layout.innerHTML = `<div class="card-head"><div><h2 id="layout-title">Words and layout</h2></div></div>
      <div class="set-row"><div class="set-t"><b>Your experience</b><span class="field-hint keep">Hints for your first few visits, or none.</span></div>
        ${seg('Your experience', 'exp', [['new', 'New to 3D printing'], ['know', 'I know my way around']], exp)}</div>
      <div class="set-row"><div class="set-t"><b>Sidebar</b><span class="field-hint keep">Icons only, opening over the page when you point at it or at the window's left edge, and closing by itself once you move away. Or keep it open.</span></div>
        ${seg('Sidebar', 'rail', [['auto', 'Opens on hover'], ['wide', 'Always open']], window.Rail && Rail.mode() === 'wide' ? 'wide' : 'auto')}</div>
      <div class="set-row"><div class="set-t"><b>Opening scene</b><span class="field-hint keep">The 3D printer fills the screen for three seconds when Deja Vu1 starts, then settles into place.</span></div>
        ${seg('Opening scene', 'intro', [['on', 'Play it'], ['off', 'Skip it']], window.DVIntro && !DVIntro.on() ? 'off' : 'on')}</div>
      <div class="set-row"><div class="set-t"><b>Panes</b><span class="field-hint keep">The sizes you dragged are kept in this browser.</span></div>
        <div class="set-reset" id="layout-reset-box"><button type="button" class="btn" id="layout-reset">Reset layout</button></div></div>`;
    const halt = document.createElement('section');
    halt.className = 'card liquid-glass';
    halt.id = 'halt-card';
    halt.setAttribute('aria-labelledby', 'halt-title');
    halt.innerHTML = `<div class="card-head"><div><h2 id="halt-title">Halt</h2></div>
        <label class="switch" for="halt-ask"><span class="switch-label">Ask before Halt</span>
          <input type="checkbox" id="halt-ask"><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></label></div>
      <p class="field-hint keep">Halt stops the selected printer with one press, from every place (shortcut H H). Turn this on to press twice.</p>`;
    const practice = document.createElement('section');
    practice.className = 'card liquid-glass';
    practice.id = 'practice-card';
    practice.setAttribute('aria-labelledby', 'practice-title');
    practice.innerHTML = `<div class="card-head"><div><h2 id="practice-title">Practice printers</h2></div>
        <label class="switch" for="practice-show"><span class="switch-label">Show Practice printers</span>
          <input type="checkbox" id="practice-show"><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></label></div>
      <p class="field-hint keep">Simulated printers and scripted problems, for trying Deja Vu1 out without touching a real printer. They add a part to the Printer screen while this is on.</p>`;
    return [layout, practice, halt];
  }

  function build() {
    const prefs = $('tab-prefs');
    const grid = document.createElement('div');
    grid.className = 'panes set-panes';
    const nav = document.createElement('div');
    nav.className = 'pane set-nav';
    nav.innerHTML = `<div class="set-search"><label class="sr-only" for="set-search">Search settings</label>
      <input type="search" id="set-search" placeholder="Search settings" autocomplete="off" spellcheck="false"></div>
      <nav aria-label="Settings groups"><ul class="set-groups">${SECTIONS.modules.map(([k, label]) =>
        `<li><button type="button" data-group="${k}" aria-current="false">${esc(label)}</button></li>`).join('')}</ul></nav>
      <p class="set-count" id="set-count" role="status" aria-live="polite"></p>`;
    const body = document.createElement('div');
    body.className = 'pane set-body';
    body.id = 'set-body';
    grid.append(nav, body);
    [...panel.children].forEach(c => { if (c !== grid) body.append(c); });
    if (prefs) [...prefs.children].forEach(c => body.append(c));
    cards().forEach(c => body.append(c));
    panel.append(grid);
    wire(nav, body);
    // The cards just moved in are sorted now, not whenever the section engine next notices them.
    Sections.choose('modules', Sections.current('modules') || SECTIONS.modules[0][0], false);
    sync();
  }

  function sync() {
    const now = Sections.current('modules');
    document.querySelectorAll('.set-groups button').forEach(b => b.setAttribute('aria-current', String(!searching && b.dataset.group === now)));
  }

  function wire(nav, body) {
    nav.addEventListener('click', e => {
      const b = e.target.closest('[data-group]');
      if (!b) return;
      $('set-search').value = '';
      endSearch();
      Sections.choose('modules', b.dataset.group);
      body.scrollTop = 0;
    });
    $('set-search').addEventListener('input', e => search(e.target.value.trim().toLowerCase()));
    window.addEventListener('dv-section', ev => { if (ev.detail && ev.detail.tab === 'modules' && !searching) sync(); });
    body.addEventListener('click', e => {
      const seg = e.target.closest('[data-seg] [data-v]');
      if (seg) {
        const name = seg.parentElement.dataset.seg, v = seg.dataset.v;
        seg.parentElement.querySelectorAll('button').forEach(b => { const on = b === seg; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
        if (name === 'exp' && window.DVTheme) DVTheme.setExperience(v);
        if (name === 'rail' && window.Rail) Rail.setMode(v);
        if (name === 'intro' && window.DVIntro) DVIntro.set(v === 'on');
        return;
      }
      if (e.target.closest('#layout-reset')) confirmReset();
    });
    const ask = $('halt-ask');
    ask.checked = store.get(ASK_KEY) === 'on';
    ask.addEventListener('change', () => store.set(ASK_KEY, ask.checked ? 'on' : 'off'));
    const practice = $('practice-show');
    practice.checked = !!window.Rail && Rail.practice();
    practice.addEventListener('change', () => { if (window.Rail) Rail.setPractice(practice.checked); });
  }

  /* Reset layout asks in place, with the two choices written out. */
  function confirmReset() {
    const box = $('layout-reset-box');
    box.innerHTML = `<span class="field-hint keep">Put every pane and the sidebar back?</span>
      <button type="button" class="btn danger" id="layout-yes">Reset layout</button><button type="button" class="btn" id="layout-no">Keep it</button>`;
    $('layout-yes').focus();
    const done = () => { box.innerHTML = '<button type="button" class="btn" id="layout-reset">Reset layout</button>'; $('layout-reset').focus(); };
    $('layout-no').onclick = done;
    $('layout-yes').onclick = () => {
      if (window.Panes) Panes.reset();
      if (window.Rail) Rail.setMode('auto');
      document.querySelectorAll('[data-seg="rail"] button').forEach(b => { const on = b.dataset.v === 'auto'; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
      done();
      toast('Layout reset: every pane and the sidebar are back to their defaults', 'ok');
    };
  }

  /* ---- search: every card that mentions the words, whatever group it is in ---- */
  const unitsOf = () => [...$('set-body').querySelectorAll(':scope > section.card, :scope > section.stats, :scope > .tab-sub')];
  function search(q) {
    if (!q) { endSearch(); return; }
    if (!searching) { group = Sections.current('modules'); searching = true; }
    Sections.choose('modules', 'all', false);
    let hits = 0;
    unitsOf().forEach(u => {
      const hit = u.textContent.toLowerCase().includes(q) || [...u.querySelectorAll('input, select, textarea')].some(i => (i.placeholder || '').toLowerCase().includes(q));
      u.classList.toggle('set-miss', !hit);
      if (hit) hits += 1;
    });
    $('set-count').textContent = hits ? `${hits} ${hits === 1 ? 'section matches' : 'sections match'}` : 'Nothing matches. Try another word.';
    sync();
  }
  function endSearch() {
    if (!searching) return;
    searching = false;
    unitsOf().forEach(u => u.classList.remove('set-miss'));
    $('set-count').textContent = '';
    Sections.choose('modules', group || SECTIONS.modules[0][0], false);
    sync();
  }

  window.Settings = { search: q => { $('set-search').value = q; search(q.toLowerCase()); }, endSearch };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
