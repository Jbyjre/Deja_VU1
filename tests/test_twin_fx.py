"""
What the 3D twin's filament, spools, belts and lights do with the printer's readings (frontend/twin3d.js,
Twin3D.fx). The functions are pure, so they run here in Node: a feed is begun by the filament sensor changing,
the working head's speed is the printer's own reading, and the chamber light is the LED the printer reports.
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
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + '\n;this.Fx = Twin3D.fx;', ctx);
const F = ctx.Fx, out = {};
out.events = [F.feedEvent(false, true), F.feedEvent(true, false), F.feedEvent(true, true), F.feedEvent(undefined, true),
  F.feedEvent(null, false), F.feedEvent(false, null)];
const len = F.feedLength('load');
out.loadShape = [0, len / 4, len / 2, 3 * len / 4, len, len + 1, -1].map(t => +F.feedSpeed('load', t).toFixed(2));
out.unloadMid = +F.feedSpeed('unload', F.feedLength('unload') / 2).toFixed(2);
out.nan = F.feedSpeed('load', NaN);
out.active = [F.activeSpeed({ extruder_velocity: 3.4 }, false), F.activeSpeed({ extruder_velocity: -6 }, true),
  F.activeSpeed({ extruder_velocity: 0 }, true), F.activeSpeed({}, true), F.activeSpeed({}, false)];
out.alpha = [0, 0.04, 2.2, -2.2, 40].map(v => +F.flowAlpha(v).toFixed(3));
out.spool = +F.spoolTurn(65 * Math.PI, 1).toFixed(4);       // pi radians when 65 mm per second runs for a second
out.belts = [F.beltRun(100, 40), F.beltRun(0, 0), F.beltRun(10, 30)];
out.lamp = [F.lampOf({ tuning: { leds: [{ id: 'cavity_led', color: [0, 0, 0, 1] }] } }),
  F.lampOf({ tuning: { leds: [{ id: 'cavity_led', color: [0, 0, 0, 0] }] } }),
  F.lampOf({ tuning: { leds: [{ id: 'status_led', color: [1, 0, 0, 0] }, { id: 'cavity_led', color: [0, 0, 0, 0.5] }] } }),
  F.lampOf({ tuning: { leds: [{ id: 'x', color: null }] } }), F.lampOf({}), F.lampOf(null)];
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "Node is optional for browser checks")
class TwinFilamentAndLights(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(["node", "-e", RUNNER, str(ROOT / "frontend/twin3d.js")], capture_output=True, text=True,
                                timeout=60, check=True)
        cls.out = json.loads(result.stdout)

    def test_a_sensor_change_begins_a_feed(self):
        load, unload, same, first, from_null, to_null = self.out["events"]
        self.assertEqual((load, unload), ("load", "unload"))
        self.assertIsNone(same)
        self.assertIsNone(first)          # the first reading of a page is no event
        self.assertIsNone(from_null)
        self.assertIsNone(to_null)

    def test_a_feed_eases_in_runs_and_eases_out(self):
        start, quarter, mid, three, end, after, before = self.out["loadShape"]
        self.assertEqual((start, end, after, before), (0, 0, 0, 0))
        self.assertGreater(quarter, 0)
        self.assertGreaterEqual(mid, quarter)
        self.assertAlmostEqual(quarter, three, places=1)
        self.assertLessEqual(mid, 25)
        self.assertLess(self.out["unloadMid"], 0)       # an unload draws the filament back
        self.assertEqual(self.out["nan"], 0)

    def test_the_working_heads_speed_is_the_printers_own_reading(self):
        reading, retract, stopped, guess, idle = self.out["active"]
        self.assertEqual(reading, 3.4)
        self.assertEqual(retract, -6)         # a retraction runs the filament backwards
        self.assertEqual(stopped, 0)          # a reading of zero beats the guess
        self.assertEqual(guess, 2)            # no reading: a typical rate while a print lays plastic
        self.assertEqual(idle, 0)

    def test_dashes_show_only_while_filament_moves(self):
        none, tiny, slow, back, fast = self.out["alpha"]
        self.assertEqual((none, tiny), (0, 0))
        self.assertGreater(slow, 0.3)
        self.assertEqual(slow, back)          # the same whichever way it runs
        self.assertLessEqual(fast, 0.92)

    def test_a_spool_turns_by_the_filament_length_over_its_radius(self):
        self.assertAlmostEqual(self.out["spool"], 3.1416, places=3)

    def test_the_belts_run_as_the_two_corexy_motors_do(self):
        self.assertEqual(self.out["belts"], [{"a": 140, "b": 60}, {"a": 0, "b": 0}, {"a": 40, "b": -20}])

    def test_the_chamber_light_is_the_leds_own_colour(self):
        full, off, picks_cavity, no_colour, none, nothing = self.out["lamp"]
        self.assertEqual(full["k"], 1)
        self.assertGreater(full["rgb"][0], full["rgb"][2])        # a warm white
        self.assertIsNone(off)
        self.assertEqual(picks_cavity["k"], 0.5)                  # the cavity LED, not the red status one
        self.assertIsNone(no_colour)
        self.assertIsNone(none)
        self.assertIsNone(nothing)


if __name__ == "__main__":
    unittest.main()
