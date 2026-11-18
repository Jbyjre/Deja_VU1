"""
Pressing Home must not throw the 3D twin's bed or head across the machine (frontend/twin3d.js, Twin3D.homing).

At the start of a homing move Klipper declares the axis homed at a position it makes up past the far end of the
axis (the endstop plus or minus 1.5 times the travel), counts the real motion from there, and sets the endstop
position when the endstop triggers. Drawn as read, the twin's bed dropped to the bottom the moment Home was
pressed while the real bed had not moved. These tests replay that sequence of readings, 4 a second as the live
feed sends them, through the pure function in Node.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RUNNER = r"""
const fs = require('fs'), vm = require('vm');
const ctx = { window: {}, console, Math, Float64Array, Float32Array, Uint32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + '\n;this.H = Twin3D.homing;', ctx);
const H = ctx.H, lo = [0, 0, 0], hi = [270, 270, 270], out = {};
// Z homes towards 0 at 10 mm/s from a bed parked at Z 200 (the head stays put at X 100, Y 120).
function homeZ(start, retract) {
  const h = H.newHoming(), rows = [];
  let t = 0, drawn = [100, 120, start];
  const step = (z) => { const r = H.followHoming(h, [100, 120, z], lo, hi, drawn, t); drawn = r.pos.slice(); rows.push([t, z, r.pos[2], r.homing[2]]); t += 250; };
  step(start);                                  // homed, at rest
  const forced = 0 + 1.5 * (hi[2] - 0);         // Klipper's made-up start for a min endstop
  for (let moved = 0; moved < start; moved += 2.5) step(forced - moved);   // the real bed rises 2.5 mm per reading
  step(0);                                      // endstop: Klipper sets the endstop position
  if (retract) { step(5); step(10); for (let z = 10; z > 0; z -= 1) step(z); step(0); }
  for (let i = 0; i < 12; i++) step(0);        // then still
  return rows;
}
out.longRun = homeZ(200, true);
out.shortRun = homeZ(12, false);
// A homing that never jumps back (a macro that sets its own position): it lets go 2 s after the axis stops.
const h = H.newHoming();
out.still = [];
let drawn = [10, 10, 50];
[[50, 0], [405, 250], [400, 500], [395, 750], [395, 1000], [395, 2000], [395, 2800], [150, 3000], [150, 5200]].forEach(([z, t]) => {
  const r = H.followHoming(h, [10, 10, z], lo, hi, drawn, t); drawn = r.pos.slice(); out.still.push([z, r.pos[2], r.homing[2]]);
});
// Ordinary fast moves inside the machine are never mistaken for homing.
const g = H.newHoming();
out.fast = [[0, 0, 5], [260, 250, 5], [5, 10, 5], [250, 260, 5]].map((p, i) => H.followHoming(g, p, lo, hi, null, i * 250));
// Missing readings stay missing.
out.nan = H.followHoming(H.newHoming(), [NaN, 1, 2], lo, hi, null, 0);
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "Node is optional for browser checks")
class TwinFollowsHoming(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(["node", "-e", RUNNER, str(ROOT / "frontend/twin3d.js")], capture_output=True, text=True,
                                timeout=60, check=True)
        cls.out = json.loads(result.stdout)

    def test_the_bed_does_not_jump_when_home_is_pressed(self):
        rows = self.out["longRun"]
        t0, z0, drawn0, homing0 = rows[0]
        self.assertEqual((drawn0, homing0), (200, False))
        first = rows[1]
        self.assertEqual(first[1], 405)               # Klipper's made-up number
        self.assertAlmostEqual(first[2], 200, places=6)  # drawn where the bed really is
        self.assertTrue(first[3])

    def test_the_bed_rises_at_the_rate_the_printer_reports(self):
        rows = self.out["longRun"]
        moving = [r for r in rows[1:] if r[3]]
        self.assertGreater(len(moving), 60)
        for prev, cur in zip(moving, moving[1:]):
            self.assertAlmostEqual(prev[2] - cur[2], prev[1] - cur[1], places=6)   # same motion, real place
        self.assertLess(moving[-1][2], 5)              # it arrives at the endstop with the real bed

    def test_the_real_position_takes_over_when_the_endstop_triggers(self):
        rows = self.out["longRun"]
        after = [r for r in rows if r[1] == 0 and not r[3]]
        self.assertTrue(after)
        self.assertEqual(after[0][2], 0)
        self.assertFalse(rows[-1][3])
        for r in rows:
            self.assertGreaterEqual(r[2], 0)
            self.assertLessEqual(r[2], 270)            # never drawn outside the machine

    def test_a_short_homing_from_near_the_endstop(self):
        rows = self.out["shortRun"]
        self.assertAlmostEqual(rows[1][2], 12, places=6)
        self.assertFalse(rows[-1][3])
        self.assertEqual(rows[-1][2], 0)

    def test_a_homing_with_no_jump_back_lets_go_once_the_axis_is_still(self):
        rows = self.out["still"]
        self.assertEqual(rows[1][1], 50)               # drawn where it was, not at 405 or the bottom
        self.assertTrue(rows[1][2])
        self.assertAlmostEqual(rows[3][1], 40, places=6)  # 10 mm of reported motion, from 50
        self.assertTrue(rows[6][2])                    # still outside the axis: keeps following
        self.assertFalse(rows[-1][2])                  # inside and still for 2 s: the printer's number again
        self.assertEqual(rows[-1][1], 150)

    def test_fast_moves_inside_the_machine_are_not_homing(self):
        for r in self.out["fast"]:
            self.assertEqual(r["homing"], [False, False, False])
        self.assertEqual(self.out["fast"][1]["pos"], [260, 250, 5])

    def test_a_missing_reading_stays_missing(self):
        self.assertEqual(self.out["nan"]["pos"], [None, 1, 2])
        self.assertEqual(self.out["nan"]["homing"], [False, False, False])


if __name__ == "__main__":
    unittest.main()
