"""Tests for backend/timelapse.py - frames per print, capped and pruned."""

import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import mock_moonraker  # noqa: E402
import storage        # noqa: E402
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


class TestFramesByTimeAsWellAsByLayer(unittest.TestCase):
    """A 34-minute two-colour print kept one frame (22 November 2026): the layers stopped counting, the clock must not."""

    PID = "u1-workshop"

    def setUp(self):
        timelapse.reset()
        self.pictures = [b"\xff\xd8picture-1", b"\xff\xd8picture-2", b"\xff\xd8picture-3"]
        patches = [mock.patch.object(mock_moonraker, "camera_snapshot", self.snapshot),
                   mock.patch.object(mock_moonraker, "use_printer", mock.MagicMock())]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.session = timelapse.begin(self.PID, "cube.gcode", "camera")

    def tearDown(self):
        timelapse.reset()

    def snapshot(self):
        picture = self.pictures[0] if len(self.pictures) == 1 else self.pictures.pop(0)
        return picture, "image/jpeg"

    def settle(self):
        deadline = time.monotonic() + 5
        while self.PID in timelapse._capturing and time.monotonic() < deadline:
            time.sleep(0.02)

    def due_by_time(self):
        timelapse._active[self.PID]["last_at"] -= timelapse.GAP_SECONDS + 1

    def frames(self):
        return len(timelapse.frames(self.PID, self.session))

    def test_a_printer_that_does_not_say_its_layer_gets_a_frame_once_the_gap_has_passed(self):
        self.assertFalse(timelapse.request_camera(self.PID, None))            # too soon
        self.due_by_time()
        self.assertTrue(timelapse.request_camera(self.PID, None))
        self.settle()
        self.assertEqual(self.frames(), 1)
        self.assertFalse(timelapse.request_camera(self.PID, None))            # and the clock starts again

    def test_a_layer_that_jumped_ahead_does_not_stop_the_frames(self):
        # The lift at a tool change read as layer 26; the real layers 3, 4, 5 never count as new against it.
        timelapse.maybe_capture(self.PID, 26, b"first", "jpg")
        self.assertFalse(timelapse.request_camera(self.PID, 5))
        self.due_by_time()
        self.assertTrue(timelapse.request_camera(self.PID, 5))
        self.settle()
        self.assertEqual(self.frames(), 2)
        meta = storage.load_json(timelapse._meta_path(self.PID, self.session), {})
        self.assertEqual(meta["last_layer"], 5)                                # the frame by time puts the mark back on the real layer
        self.assertTrue(timelapse.request_camera(self.PID, 7))                 # so the layers count again from there
        self.settle()
        self.assertEqual(self.frames(), 3)

    def test_a_layer_still_makes_a_frame_due_before_the_gap(self):
        self.assertTrue(timelapse.request_camera(self.PID, 2))
        self.settle()
        self.assertEqual(self.frames(), 1)

    def test_a_camera_that_keeps_sending_one_picture_is_said(self):
        self.pictures = [b"\xff\xd8same"]
        for _ in range(timelapse.SAME_PICTURE_WARNING + 2):
            self.due_by_time()
            timelapse._active[self.PID].pop("retry_at", None)
            timelapse.request_camera(self.PID, None)
            self.settle()
        self.assertEqual(self.frames(), 1)
        meta = storage.load_json(timelapse._meta_path(self.PID, self.session), {})
        self.assertIn("same picture", meta["last_error"])


if __name__ == "__main__":
    unittest.main()
