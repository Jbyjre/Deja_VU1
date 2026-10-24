/* Layer stack: mixed layer heights made visible.
 *
 * Laid out around a person's goal: pick what matters (finest detail,
 * balanced, fastest, one height), read in plain words what each head will
 * do, nudge any head thinner or thicker; the shared fine layer, where thick
 * layers go and curve smoothing wait under "Fine-tune".
 *
 * Underneath: one shared fine layer. Every head prints a whole number of
 * fine layers at once: 1 prints every layer, 3 prints one thick layer for
 * every three thin ones. The rules match backend/slicing_contract.py
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
  // The stored values are the slicing contract's (consistent, adaptive, fixed); the words are ours.
  const MODES = [
    ['consistent', 'Even walls', 'Two heights at most in each part: thick wherever whole runs fit, the fine layer everywhere else. The smoothest-looking walls.'],
    ['adaptive', 'Mostly thick', 'Also uses in-between thicknesses, so more of the part prints thick. Curved sides can show bands where the thickness changes.'],
    ['fixed', 'Always thick', 'The head’s thick layer everywhere, even where the shape changes. Fastest, but curves turn into steps and fine detail is lost.'],
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

  /* The four goals, in the words a person would use. Each is a smart
   * set-up worked out from the fitted nozzles (see smart below). */
  const GOALS = [
    ['fine', 'Finest detail', 'Every head on the thinnest layer they can all print.'],
    ['balanced', 'Balanced', 'Each head near half its nozzle: the usual sweet spot.'],
    ['fast', 'Fastest', 'Each head near three quarters of its nozzle: fewest passes.'],
    ['same', 'One height', 'An ordinary print: every head on the same layer.'],
  ];
  const BAND_WORD = { fine: 'Detail', balanced: 'Balanced', fast: 'Fast', over: 'Too thick' };
  /* "a third", "a quarter": how many passes the thick heads need, in words. */
  function share(thick) {
    const ks = [...new Set(thick.map(h => h.k))];
    if (ks.length > 1) return 'fewer passes';
    return `${{ 2: 'half', 3: 'a third', 4: 'a quarter', 5: 'a fifth', 6: 'a sixth', 7: 'a seventh', 8: 'an eighth' }[ks[0]] || `1/${ks[0]}`} of the passes`;
  }

  function mount(host, options = {}) {
    const state = {
      heads: (options.heads || []).map(h => ({ toolhead: h.toolhead, nozzle: NOZZLES.includes(+h.nozzle) ? +h.nozzle : 0.4, color: h.color || '#8e8e93', k: Math.max(1, Math.round(h.k || 1)) })),
      base: options.base || 0.2, mode: options.mode || 'fixed', tolerance: options.tolerance ?? 80, part: options.part ?? 30,
    };
    const id = 'ls' + Math.random().toString(36).slice(2, 8);
    const lockStack = !!(options.readOnly || options.lockHeads), lockMode = !!options.readOnly;
    let fineOpen = !!options.showMode && lockStack;
    host.classList.add('ls');
    function emit() { if (options.onChange) options.onChange(api.get()); }
    /* What a goal would set, without setting it (for the cards' previews). */
    function preview(kind) {
      const range = baseRange(state.heads);
      if (!range.ok) return null;
      if (kind === 'fine') return { base: range.lo, ks: state.heads.map(() => 1) };
      if (kind === 'same') return { base: Math.round(Math.min(range.hi, Math.max(range.lo, 0.2)) * 200) / 200, ks: state.heads.map(() => 1) };
      return suggest(state.heads, kind === 'fast' ? 0.75 : 0.5);
    }
    const same = (a, b) => a && Math.abs(a.base - state.base) < 1e-9 && a.ks.every((k, i) => k === state.heads[i].k);
    function render() {
      const verdict = check(state), range = verdict.range;
      const width = range.hi - range.lo, step = width > 0.12 ? 8 : width > 0.04 ? 4 : 1;
      const bases = range.ok ? [...new Set([...candidateBases(range).filter(b => tick(b) % step === 0), range.lo, range.hi, state.base]
        .filter(b => b >= range.lo - 1e-9 && b <= range.hi + 1e-9).map(b => Math.round(b * 200) / 200))].sort((a, b) => a - b) : [];
      const coarse = Math.max(...state.heads.map(h => h.k));
      const goals = GOALS.map(([v, label, why]) => ({ v, label, why, p: preview(v) }));
      const chosen = goals.find(g => same(g.p));
      const allSame = state.heads.every(h => h.nozzle === state.heads[0].nozzle);
      host.innerHTML = `
        ${lockStack ? '' : `<div class="ls-goal">
          <span class="ls-q" id="${id}-goal">What matters most for this print?</span>
          <div class="ls-goals" role="radiogroup" aria-labelledby="${id}-goal">${goals.map(g => `<button type="button" role="radio" class="ls-gc" data-smart="${g.v}" aria-checked="${chosen === g}"${g.p ? '' : ' disabled'}>
            <b>${g.label}</b><span>${g.why}</span>
            <small>${g.p ? state.heads.map((h, i) => `${esc(h.toolhead)} ${mm(g.p.base * g.p.ks[i])}`).join(' · ') : 'Not possible with these nozzles'}</small></button>`).join('')}</div>
          ${chosen ? '' : '<p class="ls-custom-note">Your own mix: adjusted by hand below.</p>'}
          ${allSame ? `<p class="ls-tip">Every head has a ${state.heads[0].nozzle} mm nozzle, so all four can only go as thick as each other. Mixed heights pay off when one head has a bigger nozzle for fast, thick layers (or a smaller one for detail): choose its nozzle below.</p>` : ''}
        </div>`}
        <div class="ls-body">
          <div class="ls-heads">
            ${state.heads.map((h, i) => {
              const ms = multiples(state.base, h.nozzle), cur = ms[h.k - 1], pct = Math.round(state.base * h.k / h.nozzle * 100);
              const band = pct < 35 ? 'fine' : pct <= 62 ? 'balanced' : pct <= 80 ? 'fast' : 'over';
              const ok = ms.filter(m => m.ok).map(m => m.k), down = ok.filter(k => k < h.k).pop(), up = ok.find(k => k > h.k);
              const say = h.k > 1 ? `<b>${mm(state.base * h.k)} mm</b> layers: one pass for every ${h.k} fine layers` : `<b>${mm(state.base)} mm</b> layers: every fine layer`;
              return `<div class="ls-row${cur && cur.ok ? '' : ' is-bad'}" role="group" aria-label="${esc(h.toolhead)}">
                <b class="ls-th"><i style="background:${esc(h.color)}"></i>${esc(h.toolhead)}</b>
                ${options.editNozzles ? `<label class="ls-noz-pick"><span class="sr-only">${esc(h.toolhead)} nozzle</span><select data-nozzle="${i}">${NOZZLES.map(n => `<option value="${n}"${n === h.nozzle ? ' selected' : ''}>${n} mm</option>`).join('')}</select></label>` : `<span class="ls-noz">${h.nozzle} mm nozzle</span>`}
                <p class="ls-say">${say}${cur && cur.ok ? '' : ` <em>${esc(cur ? cur.why : 'outside the allowed range')}</em>`}</p>
                <span class="ls-band is-${band}" title="${pct}% of the nozzle's width">${BAND_WORD[band]} · ${pct}%</span>
                ${lockStack ? '' : `<span class="ls-step" role="group" aria-label="${esc(h.toolhead)} layer thickness">
                  <button type="button" class="ls-sb" data-head="${i}" data-k="${down || ''}"${down ? '' : ' disabled'} aria-label="${esc(h.toolhead)} thinner${down ? `: ${mm(state.base * down)} mm` : ''}">Thinner</button>
                  <button type="button" class="ls-sb" data-head="${i}" data-k="${up || ''}"${up ? '' : ' disabled'} aria-label="${esc(h.toolhead)} thicker${up ? `: ${mm(state.base * up)} mm` : ''}">Thicker</button></span>`}
              </div>`;
            }).join('')}
          </div>
          <figure class="ls-fig">${section(state, coarse)}<figcaption>How the layers meet: a side cut through ${Math.max(6, coarse * 3)} fine layers. Each block is one pass of that head; they line up every ${coarse > 1 ? coarse + ' fine layers' : 'layer'}.</figcaption></figure>
        </div>
        <details class="ls-fine" id="${id}-fine"${fineOpen || !range.ok ? ' open' : ''}>
          <summary>Fine-tune</summary>
          <div class="ls-base" role="group" aria-labelledby="${id}-base">
            <span class="ls-label" id="${id}-base">Shared fine layer</span>
            <div class="ls-base-row">
              ${range.ok ? `<div class="ls-chips" role="radiogroup" aria-label="Shared fine layer height">${bases.map(b => `<button type="button" role="radio" class="ls-chip" data-base="${b}" aria-checked="${Math.abs(b - state.base) < 1e-9}"${lockStack ? ' disabled' : ''}>${mm(b)}</button>`).join('')}</div>` : ''}
              <label class="ls-custom">other <input type="number" min="0.04" max="0.56" step="0.005" value="${mm(state.base)}" data-base-input aria-label="Shared fine layer, millimetres"${lockStack ? ' readonly' : ''}> mm</label>
            </div>
            <small>${range.ok ? `The step every head's layers are built from; first layers and purge use it too. These nozzles allow ${mm(range.lo)} to ${mm(range.hi)} mm.` : 'No fine layer suits all these nozzles'}</small>
          </div>
          ${options.showMode ? `<div class="ls-mode">
            <span class="ls-label" id="${id}-mode">Where the thick layers go</span>
            <div class="seg ls-seg" role="radiogroup" aria-labelledby="${id}-mode">${MODES.map(([v, label]) => `<button type="button" role="radio" data-mode="${v}" aria-checked="${state.mode === v}"${lockMode ? ' disabled' : ''}>${label}</button>`).join('')}</div>
            <p class="ls-mode-why">${esc(MODES.find(m => m[0] === state.mode)[2])}</p>
            <label class="ls-tol">Curve smoothing <input type="range" min="0" max="100" step="5" value="${state.tolerance}" data-tol${lockMode ? ' disabled' : ''} aria-describedby="${id}-tol"> <output>${state.tolerance}%</output></label>
            <small id="${id}-tol">How much a sloping or curved wall may shift across one thick pass and still print thick: up to ${mm(state.tolerance / 100 * Math.max(...state.heads.map(h => h.nozzle)))} mm on the largest nozzle. Higher is faster, with rougher curves.</small>
          </div>` : ''}
        </details>
        <div class="ls-facts" role="status" aria-live="polite">${facts(state, verdict)}</div>`;
      bind();
    }
    function facts(s, verdict) {
      if (!verdict.ok) return `<ul class="ls-problems">${verdict.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
      const part = +s.part > 0 ? +s.part : 0;
      const baseLayers = part ? Math.ceil(part / s.base - 1e-6) : 0;
      const thick = s.heads.filter(h => h.k > 1);
      return `<dl>
        <div><dt>Shared fine layer</dt><dd>${mm(s.base)} mm${part ? ` · ${baseLayers} layers for ${mm(part)} mm` : ''}</dd></div>
        ${s.heads.map(h => `<div><dt>${esc(h.toolhead)} · ${h.nozzle} mm</dt><dd>${mm(s.base * h.k)} mm${part ? ` · ${Math.ceil(part / (s.base * h.k) - 1e-6)} passes` : ''}</dd></div>`).join('')}
      </dl>
      <p class="ls-note">${thick.length ? `${thick.map(h => esc(h.toolhead)).join(' and ')} build${thick.length === 1 ? 's' : ''} ${thick.length === 1 ? 'its' : 'their'} parts in ${share(thick)}. ` : 'Every head prints every layer: an ordinary single-height print. '}First layers, shared surfaces, supports and purge can still use the fine layer. Check the sliced preview before printing.</p>`;
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
      host.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        if (!+b.dataset.k) return;
        const head = b.dataset.head, word = b.textContent.trim();
        state.heads[+head].k = +b.dataset.k; render(); emit();
        // Keep the keyboard where it was: the same button on the same head, or its partner if that end is reached.
        const pair = [...host.querySelectorAll(`.ls-sb[data-head="${head}"]`)];
        (pair.find(x => x.textContent.trim() === word && !x.disabled) || pair.find(x => !x.disabled))?.focus();
      });
      const fine = host.querySelector('.ls-fine');
      if (fine) fine.ontoggle = () => { fineOpen = fine.open; };
      host.querySelectorAll('[data-nozzle]').forEach(sel => sel.onchange = () => { state.heads[+sel.dataset.nozzle].nozzle = +sel.value; refit(); });
      host.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; render(); emit(); });
      const tol = host.querySelector('[data-tol]');
      if (tol) tol.oninput = () => { state.tolerance = +tol.value; tol.nextElementSibling.textContent = tol.value + '%'; emit(); };
      if (tol) tol.onchange = () => render();
      host.querySelectorAll('[data-smart]').forEach(b => b.onclick = () => smart(b.dataset.smart));
      host.querySelectorAll('.ls-chips, .ls-seg, .ls-goals').forEach(group => group.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const items = [...group.querySelectorAll('button:not([disabled])')], at = items.indexOf(document.activeElement);
        if (at < 0) return;
        e.preventDefault();
        const next = items[(at + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
        next.click();
        const key = next.dataset.base ? 'base' : next.dataset.mode ? 'mode' : 'smart';
        const again = host.querySelector(`[data-${key}="${next.dataset[key]}"]`);
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
