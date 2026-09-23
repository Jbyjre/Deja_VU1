"""Tests for backend/timelapse.py - frames per print, capped and pruned."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import timelapse  # noqa: E402


class TestTimelapse(unittest.TestCase):
    def setUp(self):
        timelapse.reset()

    def tearDown(self):
        timelapse.reset()

    def test_frames_every_n_layers(self):
        session = timelapse.begin("u1-workshop", "cube.gcode", "simulated")
        stored = [timelapse.maybe_capture("u1-workshop", layer, b"<svg/>", "svg") for layer in range(1, 11)]
        self.assertEqual(sum(stored), 5)
        timelapse.finish("u1-workshop")
        self.assertEqual(len(timelapse.frames("u1-workshop", session)), 5)
        data, kind = timelapse.frame("u1-workshop", session, "00001.svg")
        self.assertEqual((data, kind), (b"<svg/>", "image/svg+xml"))
        self.assertTrue(timelapse.sessions("u1-workshop")[0]["finished"])

    def test_names_cannot_escape_the_folder(self):
        with self.assertRaises(ValueError):
            timelapse.frames("u1-workshop", "../../etc")

    def test_simulated_frames_say_so(self):
        state = {"layer": {"current": 5, "total": 50}, "toolheads": {}, "toolhead_position": [135, 135, 1]}
        self.assertIn(b"SIMULATED FRAME", timelapse.simulated_frame(state, {}))

    def test_old_sessions_are_pruned(self):
        import time
        for i in range(timelapse.KEEP_SESSIONS + 2):
            timelapse.begin("u1-workshop", f"f{i}.gcode", "simulated")
            timelapse.finish("u1-workshop")
            time.sleep(1.01) if i == 0 else None
        self.assertLessEqual(len(timelapse.sessions("u1-workshop")), timelapse.KEEP_SESSIONS + 1)


if __name__ == "__main__":
    unittest.main()
