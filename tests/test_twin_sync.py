"""
The 3D twin follows the running print's own G-code (frontend/twin3d.js
Twin3D.sync, fed by backend/print_preview.py's timeline). These tests run the
browser code in Node against the timeline of a real sample file and a
printer simulated from that same file: reading ahead of the nozzle as Klipper
does, running slower than the file's nominal speeds, pausing, and leaving the
path for a tool change.
"""

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import print_preview  # noqa: E402
import sample_files  # noqa: E402

RUNNER = r"""
const fs = require('fs'), vm = require('vm');
const ctx = { window: {}, console, Math, Float64Array, Float32Array, Uint32Array };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + '\n;this.Sync = Twin3D.sync;', ctx);
const S = ctx.Sync, data = JSON.parse(fs.readFileSync(0, 'utf8')), k = data.unit_mm;
const tr = S.buildTrack(data.timeline, [], k);
const file = 'f.gcode', out = {};
// The printer, simulated from the file: at real time w it is at file time w * pace,
// has read the file `lead` seconds further on, and reports its live position.
const byteAt = t => { const i = Math.min(tr.T.length - 1, tr.T.findIndex(x => x >= t)); return tr.B[i < 0 ? tr.T.length - 1 : i]; };
const reading = (t, lead, extra = {}) => ({ state: 'printing', current_file: file, real: true, progress: 0,
  sync: { file_position: byteAt(t + lead), file_size: tr.bytes, live: S.posAt(tr, t) }, ...extra });
// 1. One reading pins the moment down, whatever the read-ahead.
let f = S.newFollow(); f.track = tr;
const t1 = tr.seconds * 0.4;
S.syncFrom(f, reading(t1, 1.2), file, 0);
out.pinned = Math.abs(f.play - t1);
// 2. Readings four times a second while the printer runs at 0.8x the file's speeds:
//    between readings the playhead should stay close to the printer.
f = S.newFollow(); f.track = tr;
const pace = 0.8, start = tr.seconds * 0.5;
let worst = 0;
for (let ms = 0; ms <= 20000; ms += 1000 / 60) {
  if (Math.round(ms) % 250 < 17) S.syncFrom(f, reading(start + pace * ms / 1000, 1.0), file, ms);
  S.advance(f, ms);
  if (ms > 3000) worst = Math.max(worst, Math.abs(f.play - (start + pace * ms / 1000)));
}
out.rate = f.rate; out.worst = worst;
// 3. Paused: the playhead stays put.
const before = f.play;
S.syncFrom(f, { ...reading(f.play, 0), state: 'paused' }, file, 30000);
for (let ms = 30000; ms < 32000; ms += 16) S.advance(f, ms);
out.pausedMoved = Math.abs(f.play - before);
// 4. A tool change: the nozzle goes to the docks, far from the path; the twin shows it there.
f = S.newFollow(); f.track = tr;
S.syncFrom(f, reading(t1, 1.0), file, 0);
const dock = [60, 330, 5];
S.syncFrom(f, { ...reading(t1, 1.0), sync: { file_position: byteAt(t1 + 1), file_size: tr.bytes, live: dock } }, file, 250);
for (let ms = 250; ms < 1500; ms += 16) S.advance(f, ms);
out.offPath = f.off; out.dockGap = Math.hypot(f.pos[0] - dock[0], f.pos[1] - dock[1]);
// 5. No live position (the simulated printer): progress alone places it.
f = S.newFollow(); f.track = tr;
S.syncFrom(f, { state: 'printing', current_file: file, progress: 0.5, sync: {} }, file, 0);
out.fromProgress = f.play; out.atHalf = S.timeAtByte(tr, tr.bytes / 2);
// 6. Another file than the one drawn: nothing is followed.
f = S.newFollow(); f.track = tr;
S.syncFrom(f, { ...reading(t1, 1), current_file: 'other.gcode' }, file, 0);
out.otherFile = f.on;
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "Node is optional for browser checks")
class TwinFollowsTheGcode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        text = sample_files.build("two_benchies_two_colours.gcode").decode("utf-8")
        cls.preview = print_preview.build(text)
        result = subprocess.run(["node", "-e", RUNNER, str(ROOT / "frontend/twin3d.js")], input=json.dumps(cls.preview),
                                capture_output=True, text=True, timeout=60, check=True)
        cls.out = json.loads(result.stdout)

    def test_the_timeline_covers_the_whole_file(self):
        tl = self.preview["timeline"]
        text = sample_files.build("two_benchies_two_colours.gcode")
        self.assertEqual(tl["bytes"], len(text))
        self.assertGreater(tl["seconds"], 60)
        self.assertGreater(tl["keyframes"], 1000)
        self.assertTrue(tl["tools"], "the two-colour file changes tools")
        self.assertTrue(all("walls_t" in t for t in self.preview["tools"].values()))

    def test_one_reading_finds_the_exact_moment(self):
        self.assertLess(self.out["pinned"], 0.05)

    def test_between_readings_it_keeps_in_step(self):
        self.assertAlmostEqual(self.out["rate"], 0.8, delta=0.08)
        self.assertLess(self.out["worst"], 0.25)

    def test_a_pause_stops_it(self):
        self.assertLess(self.out["pausedMoved"], 0.01)

    def test_a_move_outside_the_file_shows_the_live_position(self):
        self.assertTrue(self.out["offPath"])
        self.assertLess(self.out["dockGap"], 1.0)

    def test_progress_alone_places_it_on_the_simulated_printer(self):
        self.assertAlmostEqual(self.out["fromProgress"], self.out["atHalf"], delta=0.01)

    def test_another_file_is_not_followed(self):
        self.assertFalse(self.out["otherFile"])


class TimelineFromOtherSlicers(unittest.TestCase):
    def test_cura_walls_and_skin_are_drawn(self):
        text = "\n".join([";FLAVOR:Marlin", "G90", "M82", "G1 Z0.2 F600", ";TYPE:WALL-OUTER",
                          "G1 X10 Y10 F3000", "G1 X20 Y10 E1", "G1 X20 Y20 E2", ";TYPE:SKIN", "G1 X10 Y20 E3",
                          ";TYPE:FILL", "G1 X15 Y15 E4"])
        out = print_preview.build(text)
        self.assertEqual(len(out["tools"]["T0"]["walls"]), 1)
        self.assertEqual(len(out["tools"]["T0"]["fill"]), 1)
        # 10 mm at 50 mm/s per side: 0.2 s, 0.2 s, then the skin's 0.2 s.
        times = out["tools"]["T0"]["walls_t"][0]
        self.assertEqual(sum(times[1:]), 400)

    def test_byte_offsets_count_bytes_not_letters(self):
        text = "; café\nG1 X10 Y0 F6000\n; naïve\nG1 X20 Y0\n"
        out = print_preview.build(text)
        self.assertEqual(out["timeline"]["bytes"], len(text.encode("utf-8")))


if __name__ == "__main__":
    unittest.main()
