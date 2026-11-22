/* The Preview's G-code reader (frontend/slicer-gcode-worker.js) in Node: it has no graphics, only text in and arrays out. Prints one line per
 * check ("ok ..." or "FAIL ..."); tests/test_slicer_gcode.py runs it. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.self = { postMessage() {} };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'slicer-gcode-worker.js'), 'utf8'));

let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

/* a file the way the U1's slicer writes one: a purge line in the start code, then marked layers (the first 0.25 mm, the others 0.2) */
const marked = [
  'G28', 'G1 Z0.2 F600', 'G1 X85 Y1', 'G1 X185 E15 F360', 'G92 E0', ';TYPE:Custom',
  ';LAYER_CHANGE', ';Z:0.25', ';HEIGHT:0.25', ';TYPE:Outer wall', 'G1 Z0.25', 'G1 X10 Y10 E1', 'G1 X20 Y10 E2',
  ';LAYER_CHANGE', ';Z:0.45', ';HEIGHT:0.2', 'G1 Z0.45', 'G1 X20 Y20 E3',
  ';LAYER_CHANGE', ';Z:0.65', ';HEIGHT:0.2', 'G1 Z0.65', 'G1 X10 Y20 E4',
  ';TYPE:Custom', 'G1 X0 Y0 E5', 'M104 S0'].join('\n') + '\n';
const a = parse(marked);
check(a.layers.length === 3, `a purge line before the first marker is not a layer: ${a.layers.length} layers`);
check(a.layers.map(l => l.z).join() === '0.25,0.45,0.65', `the layers carry the slicer's own heights: ${a.layers.map(l => l.z)}`);
check(a.layers[0].first < a.layers[1].first && a.layers[1].first < a.layers[2].first, 'each layer starts after the one before it');
let withinFirst = 0;
for (let i = 0; i < a.n; i++) if (a.a[i * 4 + 1] === 0) withinFirst++;
check(withinFirst >= 2, 'the purge line is kept and drawn with the first layer, not lost');

/* a file with no markers at all: a new layer starts where an extruding move reaches a new height */
const plain = ['G1 Z0.2 F600', 'G1 X10 Y10 E1', 'G1 X20 Y10 E2', 'G1 Z0.4', 'G1 X20 Y20 E3', 'G1 Z0.6', 'G1 X10 Y20 E4'].join('\n') + '\n';
const b = parse(plain);
check(b.layers.length === 3 && b.layers.map(l => l.z).join() === '0.2,0.4,0.6', `without markers a layer starts at each new height: ${b.layers.map(l => l.z)}`);

process.exit(failed ? 1 : 0);
