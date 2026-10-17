"""
StudioCore (frontend/studio.js) is plain JavaScript with no page in it, so
it can be checked outside a browser. These tests run it with Node.js when
Node is installed, and skip otherwise: the dashboard itself needs nothing
but Python.
"""

import json
import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIO = os.path.join(HERE, "..", "frontend", "studio.js")
NODE = shutil.which("node")

# A hazy grey photo (sRGB 0.2-0.7), printed in black and white.
SCRIPT = r"""
const C = require(process.argv[1]);
const W = 60, H = 40, target = new Float32Array(W * H * 3);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const grey = 0.45 + 0.25 * Math.cos(Math.hypot(i / W - 0.5, j / H - 0.5) * 9);
  target.set(C.oklab(...[grey, grey, grey].map(C.toLin)), (j * W + i) * 3);
}
const colours = [{ hex: '#1C1C1E', td: 0.8 }, { hex: '#F2F2F0', td: 3.8 }];
const plan = { layerH: 0.08, firstLayerH: 0.2, baseLayers: 4, maxLayers: 24, colours, starts: C.evenStarts(2, 24) };
const reach = C.table(plan).map(r => r.lab[0]);
const lo = Math.min(...reach), hi = Math.max(...reach);
const fitted = C.fitTones(target, lo, hi);
const heightsUsed = (t) => { const p = { ...plan, starts: C.optimiseStarts(t, plan) }; return new Set(C.solve(t, C.table(p)).heights).size; };
let fmin = 9, fmax = -9;
for (let p = 0; p < fitted.target.length; p += 3) { fmin = Math.min(fmin, fitted.target[p]); fmax = Math.max(fmax, fitted.target[p]); }
const four = { ...plan, colours: [0, 1, 2, 3].map(() => ({ hex: '#888888', td: 1 })), starts: [0, 6, 12, 18] };
console.log(JSON.stringify({
  lo, hi, fmin, fmax, to: fitted.to,
  plainHeights: heightsUsed(target), fittedHeights: heightsUsed(fitted.target),
  swapsAll: C.swapPlan(four).length, swapsTallest13: C.swapPlan(four, 13).map(s => s.toolhead),
}));
"""


@unittest.skipUnless(NODE, "Node.js isn't installed")
class TestStudioCore(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", SCRIPT, STUDIO], capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_fitting_maps_the_photo_onto_what_the_stack_can_print(self):
        self.assertEqual(self.r["to"], [self.r["lo"], self.r["hi"]])
        self.assertGreaterEqual(self.r["fmin"], self.r["lo"] - 1e-6)
        self.assertLessEqual(self.r["fmax"], self.r["hi"] + 1e-6)

    def test_a_hazy_photo_uses_more_of_the_heights_once_fitted(self):
        self.assertGreater(self.r["fittedHeights"], self.r["plainHeights"] * 1.5)

    def test_tool_changes_the_model_never_reaches_are_left_out(self):
        self.assertEqual(self.r["swapsAll"], 3)
        # Columns at most 13 colour layers tall reach the bands starting at 6
        # and 12, not the one at 18.
        self.assertEqual(self.r["swapsTallest13"], ["T1", "T2"])


if __name__ == "__main__":
    unittest.main()
