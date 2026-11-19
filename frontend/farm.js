/* Deja Vu1 - running the farm: fleet command center, fleet history, the
 * farm sandbox and the auto-print pipeline.
 *
 * Loaded after workshop.js and uses app.js's helpers ($, esc, api,
 * getJSON, postJSON, toast, EMPTY, isModuleDisabled, moduleDisabledEmpty,
 * showTab) and Workshop's (openFile, openDiff, printerName...). Plain
 * JavaScript, nothing fetched from anywhere but this dashboard's server.
 *
 * Contents
 *   1. fleet command center: select printers, one action for all of them,
 *      each printer's own result; files and queue items dragged between
 *      printers
 *   2. fleet history: prints and material over time, per printer and farm
 *   3. farm sandbox: build a farm, script a scenario, run the clock
 *   4. auto-print pipeline: the OrcaSlicer bridge
 */
'use strict';

const Farm = (() => {
  /* The rest of this closure lives in farm-part1.js, farm-part2.js (loaded before this file). */
  const { ap, bindCause, broadcast, causeHtml, cmd, hist, loadHistory, loadSandbox, sb } = FarmPart1;
  const { init, loadAutoPrint } = FarmPart2;

init();
return { loadHistory, loadSandbox, loadAutoPrint, broadcast, causeHtml, bindCause, state: { cmd, hist, sb, ap } };
})();

window.Farm = Farm;

/* ---- Mixed layer heights (Files tab) ----------------------------------------
 * The Layer stack (layer-stack.js) with editable nozzles: a base layer, each
 * head's multiple, smart set-ups and a section view. Purely a planner; the
 * same rules are enforced by the server when a profile is saved. */
const LayerPlanner = (() => {
  if (typeof document === 'undefined' || !document.getElementById('lp-stack') || !window.LayerStack) return null;
  const HEADS = ['T0', 'T1', 'T2', 'T3'];
  const COLORS = ['#f26a1b', '#1c1c1e', '#2f9e44', '#2e7dd7'];
  let stack = null;

  function fitted() {
    const st = typeof lastPrinterState !== 'undefined' ? lastPrinterState : null;
    return HEADS.map((th, i) => {
      const d = st && st.toolheads && st.toolheads[th] || {};
      return { toolhead: th, nozzle: [0.2, 0.4, 0.6, 0.8].includes(d.nozzle_diameter) ? d.nozzle_diameter : 0.4,
        color: /^#[0-9a-f]{6}$/i.test(d.filament_color_hex || '') ? d.filament_color_hex : COLORS[i], k: 1 };
    });
  }
  function init() {
    stack = LayerStack.mount($('lp-stack'), { heads: fitted(), base: 0.2, editNozzles: true, showMode: true, part: +$('lp-part').value });
    $('lp-part').addEventListener('input', () => stack.set({ part: +$('lp-part').value }));
    $('lp-form').addEventListener('submit', e => e.preventDefault());
    $('lp-fitted').addEventListener('click', () => { stack.set({ heads: fitted() }); });
    $('lp-example').addEventListener('click', () => {
      // A 0.4 mm detail head on the base and a 0.6 mm head printing thick passes.
      stack.set({ heads: [{ nozzle: 0.4, k: 1 }, { nozzle: 0.4, k: 1 }, { nozzle: 0.6, k: 3 }, { nozzle: 0.6, k: 3 }], base: 0.12 });
    });
  }
  init();
  return { get: () => stack && stack.get() };
})();

/* ---- the planner's maths, in the browser ------------------------------------
 * The same rule as backend/layer_planner.plan(), line for line, for the
 * online demo (app.js, "the online demo"), where there's no server to ask.
 * tests/test_layer_planner.py runs both on the same inputs and checks the
 * answers match, words included, so change both together. */
function planLayers(body) {
  const LIMITS = { 0.2: [0.04, 0.14], 0.4: [0.08, 0.32], 0.6: [0.12, 0.42], 0.8: [0.16, 0.56] };
  const TOL = 0.01;
  // Python's round(): halves that are exact go to the even neighbour.
  const pyRound = (x, d = 0) => {
    const s = Math.abs(x).toFixed(Math.min(100, d + 30)), dot = s.indexOf('.');
    if (/^50*$/.test(s.slice(dot + 1 + d))) {
      const kept = s.slice(0, d ? dot + 1 + d : dot), last = +kept[kept.length - 1];
      const t = Number(kept) + (last % 2 ? 10 ** -d : 0);
      return Number((Math.sign(x) * t).toFixed(d));
    }
    return Number(x.toFixed(d));
  };
  const g6 = x => String(Number(x.toPrecision(6)));                   // Python {:g}
  const g3 = x => String(Number(x.toPrecision(3)));                   // Python {:.3g}
  const py = x => Number.isInteger(x) ? `${x}.0` : String(x);         // Python str(float)
  const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN;
  const nozzleOf = v => {
    const n = num(v);
    if (Number.isNaN(n)) throw new Error(`'${v}' isn't a nozzle size`);
    const r = pyRound(n, 2);
    if (!LIMITS[r]) throw new Error(`The U1 has no ${py(r)} mm nozzle profile (0.2, 0.4, 0.6 and 0.8 mm exist)`);
    return r;
  };
  const heightOf = v => {
    const h = num(v);
    if (Number.isNaN(h) && !(typeof v === 'string' && v.trim().toLowerCase() === 'nan')) throw new Error(`'${v}' isn't a layer height`);
    if (!(h >= 0.01 && h <= 1.0)) throw new Error('Layer heights must be between 0.01 and 1 mm');
    return h;
  };
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const sharedGrid = (heights, exact) => {
    const hs = heights.map(h => pyRound(h, 2));
    if (exact) return hs.reduce((g, h) => gcd(g, pyRound(h * 100)), 0) / 100;
    const finest = Math.min(...hs), steps = pyRound(finest * 1000);
    for (let k = steps; k >= Math.ceil(steps / 4); k--) {
      const g = k / 1000;
      if (hs.every(h => Math.abs(h - Math.max(1, pyRound(h / g)) * g) <= TOL + 1e-9)) return g;
    }
    return pyRound(finest / 4, 3);
  };

  const heads = body.heads || [];
  if (!heads.length) throw new Error('Add at least one toolhead');
  const rows = heads.map(h => {
    const th = String(h.toolhead || '').trim().toUpperCase();
    if (!(th.length === 2 && th[0] === 'T' && '0123'.includes(th[1]))) throw new Error(`'${h.toolhead}' isn't a U1 toolhead (T0 to T3)`);
    const nozzle = nozzleOf(h.nozzle);
    const height = h.height === null || h.height === undefined || h.height === '' ? null : heightOf(h.height);
    return { toolhead: th, nozzle, preferred: height };
  });
  if (new Set(rows.map(r => r.toolhead)).size !== rows.length) throw new Error('Each toolhead can appear once');
  const preferred = rows.map(r => r.preferred).filter(Boolean);
  if (!preferred.length) throw new Error('Give at least one toolhead a layer height');
  const grid = sharedGrid(preferred, !!body.exact);
  const notes = [];
  let tall = null;
  if (body.part_height !== null && body.part_height !== undefined && body.part_height !== '') {
    tall = num(body.part_height);
    if (Number.isNaN(tall)) throw new Error(`could not convert string to float: '${body.part_height}'`);
    if (!(tall > 0 && tall <= 270)) throw new Error('Part height must be between 0 and 270 mm');
  }
  rows.forEach(r => {
    const k = !r.preferred ? 1 : Math.max(1, pyRound(r.preferred / grid));
    r.every = k;
    r.height = pyRound(k * grid, 3);
    const [lo, hi] = LIMITS[r.nozzle];
    r.limits = [lo, hi];
    r.ok = lo - 1e-9 <= r.height && r.height <= hi + 1e-9;
    if (r.height > hi + 1e-9) {
      notes.push(`${r.toolhead}: ${g3(r.height)} mm layers are thicker than the ${py(r.nozzle)} mm nozzle's ${py(hi)} mm maximum in Snapmaker's U1 profile`);
    } else if (r.height < lo - 1e-9) {
      notes.push(`${r.toolhead}: ${g3(r.height)} mm layers are thinner than the ${py(r.nozzle)} mm nozzle's ${py(lo)} mm minimum in Snapmaker's U1 profile`);
    }
    if (r.preferred && Math.abs(r.height - r.preferred) > 1e-6) {
      notes.push(`${r.toolhead}: ${g6(r.preferred)} mm prints as ${g3(r.height)} mm, ${k} grid layer${k > 1 ? 's' : ''} of ${g6(grid)} mm`);
    }
    r.layers = tall ? Math.ceil(pyRound(tall / r.height, 6)) : null;
  });
  const thin = rows.filter(r => grid < r.limits[0] - 1e-9);
  if (thin.length) {
    notes.push(`The shared grid (${g6(grid)} mm) is below the minimum of `
      + thin.map(r => `${r.toolhead}'s ${py(r.nozzle)} mm nozzle (${py(r.limits[0])} mm)`).join(', ')
      + '; its prime-tower slabs print that thin, and the slicer reports it');
  }
  return { grid, exact: !!body.exact, heads: rows, notes, part_height: tall, grid_layers: tall ? Math.ceil(pyRound(tall / grid, 6)) : null };
}
