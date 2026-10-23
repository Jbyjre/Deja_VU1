/* Layer stack: mixed layer heights made visible.
 *
 * One fine base layer (the object layer). Every head prints a whole number
 * of base layers at once: x1 prints every layer, x3 prints one thick layer
 * for every three thin ones. The rules match backend/slicing_contract.py
 * (tool_layers): heights on a 0.005 mm step, each inside its nozzle's range
 * from Snapmaker's U1 profiles, and a base every fitted head can also print,
 * because first layers, purge and fallback paths use it.
 *
 * LayerStack.mount(host, options) -> { get(), set(partial), destroy() }
 *   options: heads [{toolhead, nozzle, color, k}], base, mode, tolerance,
 *            editNozzles (planner), showMode (profile), readOnly, part,
 *            onChange(state)
 */
'use strict';
window.LayerStack = (() => {
  const LIMITS = { 0.2: [0.04, 0.14], 0.4: [0.08, 0.32], 0.6: [0.12, 0.42], 0.8: [0.16, 0.56] };
  const NOZZLES = [0.2, 0.4, 0.6, 0.8];
  const MODES = [
    ['consistent', 'Consistent', 'At most two heights per part: the thick height where whole runs fit, the base everywhere else. The most even walls.'],
    ['adaptive', 'Adaptive', 'Also uses in-between multiples, so more of the part prints thick. Curved sides can show bands of different heights.'],
    ['fixed', 'Fixed', 'Always the head’s thick height, even where the shape changes. Fastest; curves become steps and fine detail is lost.'],
  ];
  const tick = v => Math.round(v * 200);                 // 0.005 mm steps, like the server
  const mm = v => { const t = (Math.round(v * 1000) / 1000).toFixed(3); return t.endsWith('0') ? t.slice(0, -1) : t; };
  const limits = n => LIMITS[n] || LIMITS[0.4];

  /* The bases every head can share: at least the largest minimum, at most the smallest maximum. */
  function baseRange(heads) {
    const lo = Math.max(...heads.map(h => limits(h.nozzle)[0]));
    const hi = Math.min(...heads.map(h => limits(h.nozzle)[1]));
    return { lo, hi, ok: lo <= hi + 1e-9 };
  }
  function multiples(base, nozzle) {
    const [lo, hi] = limits(nozzle), out = [];
    for (let k = 1; k <= 8; k++) {
      const h = base * k;
      out.push({ k, h, ok: h >= lo - 1e-9 && h <= hi + 1e-9, why: h > hi + 1e-9 ? `thicker than the ${nozzle} mm nozzle’s ${hi} mm maximum` : h < lo - 1e-9 ? `thinner than the ${nozzle} mm nozzle’s ${lo} mm minimum` : '' });
    }
    return out;
  }
  function candidateBases(range) {
    const out = [];
    for (let t = Math.ceil(tick(range.lo)); t <= Math.floor(tick(range.hi) + 1e-6); t++) out.push(t / 200);
    return out;
  }
  /* The same refusals the server gives, in the same order, before anything is saved. */
  function check(state) {
    const problems = [], range = baseRange(state.heads);
    if (!range.ok) {
      const fine = state.heads.reduce((a, h) => limits(h.nozzle)[1] < limits(a.nozzle)[1] ? h : a);
      const coarse = state.heads.reduce((a, h) => limits(h.nozzle)[0] > limits(a.nozzle)[0] ? h : a);
      problems.push(`${fine.toolhead}’s ${fine.nozzle} mm nozzle can’t print thicker than ${limits(fine.nozzle)[1]} mm and ${coarse.toolhead}’s ${coarse.nozzle} mm nozzle can’t print thinner than ${limits(coarse.nozzle)[0]} mm, so they can’t share a base layer. Fit a 0.4 or 0.6 mm nozzle on one of them.`);
      return { ok: false, problems, range };
    }
    if (Math.abs(tick(state.base) - state.base * 200) > 1e-6) problems.push('The base layer must be a multiple of 0.005 mm.');
    if (state.base < range.lo - 1e-9) problems.push(`The base must be at least ${mm(range.lo)} mm: every fitted head prints first layers, purge and fallback paths at the base.`);
    if (state.base > range.hi + 1e-9) problems.push(`The base can be at most ${mm(range.hi)} mm, the thickest layer every fitted nozzle can print.`);
    state.heads.forEach(h => {
      const m = multiples(state.base, h.nozzle)[h.k - 1];
      if (!m || !m.ok) problems.push(`${h.toolhead}: ${mm(state.base * h.k)} mm is ${m ? m.why : 'outside the allowed range'}.`);
    });
    return { ok: !problems.length, problems, range };
  }
  /* Smart suggestions. target is a fraction of each nozzle (0.5 balanced, 0.75 fast). */
  function suggest(heads, target) {
    const range = baseRange(heads);
    if (!range.ok) return null;
    let best = null;
    for (const base of candidateBases(range)) {
      let cost = 0;
      const ks = heads.map(h => {
        const opts = multiples(base, h.nozzle).filter(m => m.ok);
        const want = Math.min(h.nozzle * target, limits(h.nozzle)[1]);
        const pick = opts.reduce((a, m) => Math.abs(m.h - want) < Math.abs(a.h - want) ? m : a, opts[0]);
        cost += Math.abs(pick.h - want) / h.nozzle;
        return pick.k;
      });
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && base > best.base)) best = { base, ks, cost };
    }
    return best;
  }

  function mount(host, options = {}) {
    const state = {
      heads: (options.heads || []).map(h => ({ toolhead: h.toolhead, nozzle: NOZZLES.includes(+h.nozzle) ? +h.nozzle : 0.4, color: h.color || '#8e8e93', k: Math.max(1, Math.round(h.k || 1)) })),
      base: options.base || 0.2, mode: options.mode || 'fixed', tolerance: options.tolerance ?? 80, part: options.part ?? 30,
    };
    const id = 'ls' + Math.random().toString(36).slice(2, 8);
    const lockStack = !!(options.readOnly || options.lockHeads), lockMode = !!options.readOnly;
    host.classList.add('ls');
    function emit() { if (options.onChange) options.onChange(api.get()); }
    function render() {
      const verdict = check(state), range = verdict.range;
      const width = range.hi - range.lo, step = width > 0.12 ? 8 : width > 0.04 ? 4 : 1;
      const bases = range.ok ? [...new Set([...candidateBases(range).filter(b => tick(b) % step === 0), range.lo, range.hi, state.base]
        .filter(b => b >= range.lo - 1e-9 && b <= range.hi + 1e-9).map(b => Math.round(b * 200) / 200))].sort((a, b) => a - b) : [];
      const coarse = Math.max(...state.heads.map(h => h.k));
      host.innerHTML = `
        <div class="ls-top">
          <div class="ls-base" role="group" aria-labelledby="${id}-base">
            <span class="ls-label" id="${id}-base">Base layer · object</span>
            <div class="ls-base-row">
              ${range.ok ? `<div class="ls-chips" role="radiogroup" aria-label="Base layer height">${bases.map(b => `<button type="button" role="radio" class="ls-chip" data-base="${b}" aria-checked="${Math.abs(b - state.base) < 1e-9}"${lockStack ? ' disabled' : ''}>${mm(b)}</button>`).join('')}</div>` : ''}
              <label class="ls-custom">custom <input type="number" min="0.04" max="0.56" step="0.005" value="${mm(state.base)}" data-base-input aria-label="Base layer, millimetres"${lockStack ? ' readonly' : ''}> mm</label>
            </div>
            <small>${range.ok ? `Allowed with these nozzles: ${mm(range.lo)} to ${mm(range.hi)} mm` : 'No base layer fits these nozzles'}</small>
          </div>
          ${lockStack ? '' : `<div class="ls-smart" role="group" aria-label="Smart suggestions">
            <span class="ls-label">Smart set-up</span>
            <div class="ls-smart-row">
              <button type="button" class="btn small" data-smart="balanced" title="Each head near half its nozzle size: the usual quality sweet spot">Balanced</button>
              <button type="button" class="btn small" data-smart="fast" title="Each head near three quarters of its nozzle: thick, quick layers">Fastest</button>
              <button type="button" class="btn small" data-smart="fine" title="Every head on the finest shared base layer">Finest detail</button>
              <button type="button" class="btn small" data-smart="same" title="One layer height on every head, like an ordinary print">Same on all</button>
            </div>
          </div>`}
        </div>
        <div class="ls-body">
          <div class="ls-heads">
            <div class="ls-row ls-row-head" aria-hidden="true"><span>Head</span><span>Nozzle</span><span>Prints every</span><span>Layer</span></div>
            ${state.heads.map((h, i) => {
              const ms = multiples(state.base, h.nozzle), cur = ms[h.k - 1], pct = Math.round(state.base * h.k / h.nozzle * 100);
              const band = pct < 35 ? 'fine' : pct <= 62 ? 'balanced' : pct <= 80 ? 'fast' : 'over';
              return `<div class="ls-row${cur && cur.ok ? '' : ' is-bad'}" role="group" aria-label="${esc(h.toolhead)}">
                <b class="ls-th"><i style="background:${esc(h.color)}"></i>${esc(h.toolhead)}</b>
                ${options.editNozzles ? `<select data-nozzle="${i}" aria-label="${esc(h.toolhead)} nozzle">${NOZZLES.map(n => `<option value="${n}"${n === h.nozzle ? ' selected' : ''}>${n} mm</option>`).join('')}</select>` : `<span class="ls-noz">${h.nozzle} mm</span>`}
                <div class="ls-k" role="radiogroup" aria-label="${esc(h.toolhead)}: how many base layers per pass">
                  ${ms.slice(0, 6).map(m => `<button type="button" role="radio" class="ls-kb" data-head="${i}" data-k="${m.k}" aria-checked="${m.k === h.k}" ${m.ok && !lockStack ? '' : 'disabled'} title="${m.ok ? `${mm(m.h)} mm` : esc(m.why)}">×${m.k}</button>`).join('')}
                </div>
                <span class="ls-h"><b>${mm(state.base * h.k)}</b> mm<small class="ls-band is-${band}">${pct}% of nozzle · ${band === 'over' ? 'too thick' : band}</small></span>
              </div>`;
            }).join('')}
          </div>
          <figure class="ls-fig">${section(state, coarse)}<figcaption>Section through ${Math.max(6, coarse * 3)} base layers. Each block is one pass of that head.</figcaption></figure>
        </div>
        ${options.showMode ? `<div class="ls-mode">
          <span class="ls-label" id="${id}-mode">Thick layer regions</span>
          <div class="seg ls-seg" role="radiogroup" aria-labelledby="${id}-mode">${MODES.map(([v, label]) => `<button type="button" role="radio" data-mode="${v}" aria-checked="${state.mode === v}"${lockMode ? ' disabled' : ''}>${label}</button>`).join('')}</div>
          <p class="ls-mode-why">${esc(MODES.find(m => m[0] === state.mode)[2])}</p>
          <label class="ls-tol">Edge tolerance <input type="range" min="0" max="100" step="5" value="${state.tolerance}" data-tol${lockMode ? ' disabled' : ''} aria-describedby="${id}-tol"> <output>${state.tolerance}%</output></label>
          <small id="${id}-tol">How far a part’s outline may drift sideways across one thick pass and still be combined: up to ${mm(state.tolerance / 100 * Math.max(...state.heads.map(h => h.nozzle)))} mm on the largest nozzle. Higher combines more, with rougher curved walls.</small>
        </div>` : ''}
        <div class="ls-facts" role="status" aria-live="polite">${facts(state, verdict)}</div>`;
      bind();
    }
    function facts(s, verdict) {
      if (!verdict.ok) return `<ul class="ls-problems">${verdict.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
      const part = +s.part > 0 ? +s.part : 0;
      const baseLayers = part ? Math.ceil(part / s.base - 1e-6) : 0;
      return `<dl>
        <div><dt>Base · object layer</dt><dd>${mm(s.base)} mm${part ? ` · ${baseLayers} layers for ${mm(part)} mm` : ''}</dd></div>
        ${s.heads.map(h => `<div><dt>${esc(h.toolhead)} · ${h.nozzle} mm</dt><dd>${mm(s.base * h.k)} mm${h.k > 1 ? `, every ${h.k} base layers` : ', every layer'}${part ? ` · ${Math.ceil(part / (s.base * h.k) - 1e-6)} passes` : ''}</dd></div>`).join('')}
      </dl>
      <p class="ls-note">${s.heads.some(h => h.k > 1) ? 'Parts on a thick head need fewer passes; ×3 means a third as many layers for that head’s parts. ' : 'Every head prints every layer: an ordinary single-height print. '}First layers, shared surfaces, supports and purge can still use the base. Check the sliced preview before printing.</p>`;
    }
    function section(s, coarse) {
      const n = Math.max(6, coarse * 3), span = n * s.base;
      const cols = s.heads.length, W = 70 + cols * 64, H = 210, top = 24, bottom = H - 30, k = (bottom - top) / span;
      const y = z => bottom - z * k;
      let g = '';
      for (let i = 0; i <= n; i++) g += `<path class="ls-grid${i % 5 === 0 ? ' is-major' : ''}" d="M52 ${y(i * s.base).toFixed(1)}H${W - 8}"/>`;
      const blocks = s.heads.map((h, i) => {
        const x = 62 + i * 64, step = s.base * h.k;
        let r = '';
        for (let z = 0, j = 0; z < span - 1e-9; z += step, j++) {
          const t = Math.min(step, span - z);
          r += `<rect class="ls-block" x="${x}" y="${(y(z + t) + 1).toFixed(1)}" width="46" height="${Math.max(1, t * k - 2).toFixed(1)}" rx="2" style="--c:${esc(h.color)};opacity:${j % 2 ? .78 : 1}"/>`;
        }
        return r + `<text class="ls-t" x="${x + 23}" y="${H - 12}" text-anchor="middle">${esc(h.toolhead)}</text>`;
      }).join('');
      const dim = `<path class="ls-dim" d="M30 ${y(0)}H50M30 ${y(s.base)}H50"/><text class="ls-dt" x="26" y="${((y(0) + y(s.base)) / 2 + 3).toFixed(1)}" text-anchor="end">${mm(s.base)}</text>`;
      return `<svg class="ls-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Layer section: base ${mm(s.base)} mm; ${s.heads.map(h => `${h.toolhead} ${mm(s.base * h.k)} mm`).join(', ')}">
        <text class="ls-title" x="8" y="14">SECTION · Z mm</text>${g}${blocks}${dim}</svg>`;
    }
    function bind() {
      host.querySelectorAll('[data-base]').forEach(b => b.onclick = () => { state.base = +b.dataset.base; refit(); });
      const custom = host.querySelector('[data-base-input]');
      if (custom) custom.onchange = () => { const v = +custom.value; if (v > 0) { state.base = Math.round(v * 200) / 200; refit(); } };
      host.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { state.heads[+b.dataset.head].k = +b.dataset.k; render(); emit(); });
      host.querySelectorAll('[data-nozzle]').forEach(sel => sel.onchange = () => { state.heads[+sel.dataset.nozzle].nozzle = +sel.value; refit(); });
      host.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; render(); emit(); });
      const tol = host.querySelector('[data-tol]');
      if (tol) tol.oninput = () => { state.tolerance = +tol.value; tol.nextElementSibling.textContent = tol.value + '%'; emit(); };
      if (tol) tol.onchange = () => render();
      host.querySelectorAll('[data-smart]').forEach(b => b.onclick = () => smart(b.dataset.smart));
      host.querySelectorAll('.ls-chips, .ls-k, .ls-seg').forEach(group => group.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const items = [...group.querySelectorAll('button:not([disabled])')], at = items.indexOf(document.activeElement);
        if (at < 0) return;
        e.preventDefault();
        const next = items[(at + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
        next.click();
        const again = host.querySelector(`[data-${next.dataset.base ? 'base' : next.dataset.mode ? 'mode' : 'k'}="${next.dataset.base || next.dataset.mode || next.dataset.k}"]${next.dataset.head ? `[data-head="${next.dataset.head}"]` : ''}`);
        if (again) again.focus();
      });
    }
    /* After a base or nozzle change keep each head on its nearest allowed multiple. */
    function refit() {
      state.heads.forEach(h => {
        const opts = multiples(state.base, h.nozzle).filter(m => m.ok);
        if (opts.length && !opts.some(m => m.k === h.k)) {
          const want = state.base * h.k;
          h.k = opts.reduce((a, m) => Math.abs(m.h - want) < Math.abs(a.h - want) ? m : a, opts[0]).k;
        }
      });
      render(); emit();
    }
    function smart(kind) {
      const range = baseRange(state.heads);
      if (!range.ok) { render(); return; }
      if (kind === 'fine') { state.base = range.lo; state.heads.forEach(h => { h.k = 1; }); }
      else if (kind === 'same') {
        const want = Math.min(range.hi, Math.max(range.lo, 0.2));
        state.base = Math.round(want * 200) / 200; state.heads.forEach(h => { h.k = 1; });
      } else {
        const best = suggest(state.heads, kind === 'fast' ? 0.75 : 0.5);
        if (best) { state.base = best.base; best.ks.forEach((k, i) => { state.heads[i].k = k; }); }
      }
      render(); emit();
    }
    const api = {
      get: () => ({ base: state.base, mode: state.mode, tolerance: state.tolerance, ok: check(state).ok, problems: check(state).problems,
        heads: state.heads.map(h => ({ toolhead: h.toolhead, nozzle: h.nozzle, k: h.k, height: Math.round(state.base * h.k * 1000) / 1000 })) }),
      set(partial) {
        if (partial.heads) partial.heads.forEach((p, i) => { const h = state.heads[i]; if (!h) return; if (p.nozzle) h.nozzle = +p.nozzle; if (p.color) h.color = p.color; if (p.k) h.k = p.k; });
        ['base', 'mode', 'tolerance', 'part'].forEach(k => { if (partial[k] !== undefined) state[k] = partial[k]; });
        render();
      },
      destroy() { host.replaceChildren(); host.classList.remove('ls'); },
    };
    render();
    return api;
  }

  /* From saved per-head heights: the shared base is their largest common 0.005 mm step. */
  function fromHeights(heads) {
    const ticks = heads.map(h => Math.max(1, tick(+h.height || 0.2)));
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    const g = ticks.reduce((a, t) => gcd(a, t));
    const base = g / 200;
    return { base, heads: heads.map((h, i) => ({ ...h, k: Math.max(1, Math.round(ticks[i] / g)) })) };
  }

  return { mount, check, suggest, fromHeights, LIMITS };
})();
