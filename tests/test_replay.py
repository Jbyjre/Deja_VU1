"""Tests for RECALL.2, replaying an ended print: the light trace kept while a print runs (backend/print_track.py), what a
replay plays back (recall.replay) and the routes. A print without a trace replays its layers alone; nothing is filled in."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import file_library         # noqa: E402
import live_feed            # noqa: E402
import mock_moonraker       # noqa: E402
import print_record         # noqa: E402
import print_track          # noqa: E402
import recall               # noqa: E402
import sample_files         # noqa: E402
from test_api import APITestCase  # noqa: E402

SAMPLE = "3dbenchy_pla.gcode"


def state(name, layer=None, how="printing", temps=(215.0, 30.0, 30.0, 30.0), bed=60.0, progress=0.1):
    return {"state": how, "current_file": name, "active_toolhead": "T0", "progress": progress, "bed_temperature": bed,
            "layer": {"current": layer, "total": 100},
            "toolheads": {h: {"temperature": t, "filament_material": "PLA", "filament_color_name": "Red",
                              "filament_color_hex": "#ff0000"} for h, t in zip(print_track.HEADS, temps)}}


def job(name):
    return {"filename": name, "total_hours": 1.0, "filament_grams": 10.0, "material": "PLA",
            "required_filament": [{"toolhead": "T0", "expected_material": "PLA", "expected_color_name": "Red",
                                   "expected_color_hex": "#ff0000", "grams": 10.0}]}


class ReplayCase(unittest.TestCase):
    def setUp(self):
        print_record.reset()
        recall.reset()
        self.addCleanup(print_record.reset)
        self.made = []

    def tearDown(self):
        for name in self.made:
            if file_library.exists(name):
                file_library.delete(name)

    def add(self, name):
        file_library.save(name, sample_files.build(SAMPLE))
        self.made.append(name)

    def start(self, name, printer="p1"):
        entry = print_record.started(printer, "Bench", state(name), job(name), demo=False)
        print_track.begin(printer, entry["id"], 1000.0)
        return entry["id"]


class TestTrace(ReplayCase):
    def test_a_point_per_layer_and_every_half_minute_and_the_trace_is_written_at_the_end(self):
        eid = self.start("trace.gcode")
        self.assertTrue(print_track.sample("p1", state("trace.gcode", 1), 1000.0, frames=0))
        self.assertFalse(print_track.sample("p1", state("trace.gcode", 1), 1005.0))       # nothing new: no point
        self.assertTrue(print_track.sample("p1", state("trace.gcode", 2), 1006.0))        # a new layer
        self.assertTrue(print_track.sample("p1", state("trace.gcode", 2), 1036.0))        # half a minute on
        self.assertTrue(print_track.sample("p1", state("trace.gcode", 3, how="paused"), 1040.0, frames=4))
        self.assertFalse(print_track.sample("p1", {**state("trace.gcode", 4), "state": "standby"}, 1100.0))
        self.assertEqual(print_track.end("p1", state("trace.gcode", 5, how="cancelled"), 1200.0, 6), eid)
        kept = print_track.load(eid)
        self.assertTrue(kept["ended"])
        self.assertEqual([p[1] for p in kept["points"]], [1, 2, 2, 3, 5])
        first = kept["points"][0]
        self.assertEqual(first[:4], [0, 1, 0.1, 60.0])
        self.assertEqual((first[4], first[5], first[6], first[7]), ([215.0, 30.0, 30.0, 30.0], 0, 0, 0))
        self.assertEqual((kept["points"][3][6], kept["points"][3][7]), (4, 1))
        self.assertIsNone(print_track.tracking("p1"))

    def test_a_long_print_keeps_its_whole_length_at_a_coarser_grain(self):
        eid = self.start("long.gcode")
        for n in range(print_track.MAX_POINTS + 10):
            print_track.sample("p1", state("long.gcode", n + 1), 1000.0 + n)
        print_track.end("p1")
        points = print_track.load(eid)["points"]
        self.assertLessEqual(len(points), print_track.MAX_POINTS)
        self.assertEqual(points[0][1], 1)
        self.assertGreater(points[-1][1], print_track.MAX_POINTS)

    def test_forgetting_a_print_removes_its_trace(self):
        eid = self.start("gone.gcode")
        print_track.sample("p1", state("gone.gcode", 1), 1000.0)
        print_record.ended("p1", "finished", state("gone.gcode", 1))
        print_track.end("p1")
        self.assertIsNotNone(print_track.load(eid))
        print_record.forget(eid)
        self.assertIsNone(print_track.load(eid))

    def test_a_restart_carries_on_with_the_running_prints_trace(self):
        eid = self.start("again.gcode")
        print_track.sample("p1", state("again.gcode", 1), 1000.0)
        print_track._write(eid, print_track.load(eid)["points"])
        print_track.reset()                                     # Deja Vu1 restarted
        self.assertFalse(print_track.resume("p1", "other.gcode"))
        self.assertTrue(print_track.resume("p1", "again.gcode"))
        self.assertEqual(print_track.tracking("p1"), eid)
        self.assertEqual(len(print_track.load(eid)["points"]), 1)

    def test_the_live_feed_starts_and_ends_the_trace(self):
        pid = mock_moonraker.selected_printer_id()
        with mock_moonraker.use_printer(pid):
            eid = live_feed._record_print(pid, "started", state("feed.gcode", 1), None, {}, True)
        self.assertEqual(print_track.tracking(pid), eid)
        print_track.sample(pid, state("feed.gcode", 1), 2e9)
        with mock_moonraker.use_printer(pid):
            live_feed._record_print(pid, "failed", state("feed.gcode", 2, how="error"), None, {}, True)
        self.assertIsNone(print_track.tracking(pid))
        self.assertTrue(print_track.load(eid)["ended"])


class TestReplay(ReplayCase):
    def test_a_failed_print_replays_with_its_trace_notes_pause_and_end(self):
        self.add("replay_a.gcode")
        eid = self.start("replay_a.gcode")
        print_track.sample("p1", state("replay_a.gcode", 1), 1000.0)
        print_track.sample("p1", state("replay_a.gcode", 2, how="paused"), 1060.0)
        print_track.sample("p1", state("replay_a.gcode", 3), 1120.0)
        print_record.add_watch_note("p1", "The first layer is lifting at one corner", "worry", {"current": 2, "total": 100})
        print_record.ended("p1", "failed", {**state("replay_a.gcode", 3), "state_message": "Nozzle clogged"})
        print_track.end("p1")
        r = recall.replay(eid)
        self.assertEqual((r["file"], r["layers"], r["stop_layer"], r["total_layers"]), ("replay_a.gcode", "library", 3, 100))
        self.assertEqual(len(r["track"]["points"]), 3)
        kinds = [(e["kind"], e["layer"]) for e in r["events"]]
        self.assertEqual(kinds, [("watch", 2), ("pause", 2), ("end", 3)])
        self.assertEqual(r["events"][-1]["text"], "Nozzle clogged")
        layers = recall.replay_layers(eid)
        self.assertTrue(layers["layers"])
        self.assertIn("timeline", layers)

    def test_a_print_with_no_trace_and_no_file_says_so(self):
        eid = self.start("not_here.gcode")
        print_track.reset()                                   # it ran before Deja Vu1 kept traces
        print_record.ended("p1", "finished", state("not_here.gcode", 100))
        r = recall.replay(eid)
        self.assertIsNone(r["track"])
        self.assertIsNone(r["layers"])
        self.assertEqual(r["events"], [])
        self.assertEqual(r["stop_layer"], 100)
        self.assertIn("isn't in Files", recall.replay_layers(eid)["reason"])

    def test_a_running_print_is_watched_live_not_replayed(self):
        eid = self.start("live.gcode")
        with self.assertRaises(ValueError):
            recall.replay(eid)
        with self.assertRaises(ValueError):
            recall.replay("ffffffffffff")


class TestRoutes(APITestCase):
    def setUp(self):
        super().setUp()
        print_record.reset()
        self.addCleanup(print_record.reset)

    def test_replay_and_its_layers(self):
        file_library.save("replay_route.gcode", sample_files.build(SAMPLE))
        self.addCleanup(file_library.delete, "replay_route.gcode")
        entry = print_record.started("p1", "Bench", state("replay_route.gcode"), job("replay_route.gcode"), demo=False)
        print_record.ended("p1", "finished", state("replay_route.gcode", 10))
        status, body = self.get(f"/api/prints/replay?id={entry['id']}")
        self.assertEqual((status, body["layers"], body["track"]), (200, "library", None))
        status, body = self.get(f"/api/prints/replay/layers?id={entry['id']}")
        self.assertEqual(status, 200)
        self.assertTrue(body["layers"])
        self.assertEqual(self.get("/api/prints/replay?id=nothing")[0], 400)

    def test_the_demo_replays_a_sample_from_the_simulated_history(self):
        status, body = self.get("/api/prints?demo=1")
        rows = [p for p in body["prints"] if p.get("file") in sample_files.SAMPLES and p.get("status") != "running"]
        if not rows:
            self.skipTest("the simulated history is random and holds no sample this time")
        status, body = self.get(f"/api/prints/replay?id={rows[0]['id']}&demo=1")
        self.assertEqual((status, body["layers"]), (200, "sample"))


if __name__ == "__main__":
    unittest.main()
