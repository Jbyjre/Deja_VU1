"""Tests for backend/print_eta.py - the one estimate of how long a print has left."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import print_eta  # noqa: E402


def old_guess(progress, elapsed):
    """What every screen computed before: time spent divided by the share of the file read."""
    return elapsed / progress - elapsed


class TestEstimate(unittest.TestCase):
    def test_a_7_hour_file_early_in_a_slow_start_is_not_called_16_hours(self):
        # A colour-changing print spends its first minutes on purges and heating, which read little of the file:
        # 30 minutes in, 3% of the bytes are done. The old formula said 15.8 hours left on a 7 hour file.
        self.assertGreater(old_guess(0.03, 0.5), 15)
        eta = print_eta.estimate(0.03, 0.5, slicer_hours=7.0)
        self.assertLess(eta["remaining_hours"], 10.0)
        self.assertGreater(eta["remaining_hours"], 6.0)
        self.assertEqual(eta["basis"], "file_and_pace")
        self.assertFalse(eta["settled"])

    def test_a_print_that_runs_to_the_files_pace_stays_on_the_files_figure(self):
        eta = print_eta.estimate(0.4, 2.8, slicer_hours=7.0)
        self.assertAlmostEqual(eta["remaining_hours"], 4.2, places=2)
        self.assertEqual(eta["pace"], 1.0)
        self.assertTrue(eta["settled"])

    def test_a_print_that_really_is_slow_is_believed_more_and_more(self):
        # The file says 7 hours; the print takes 14. The estimate starts near the file and walks to the truth.
        left = []
        for share in (0.05, 0.25, 0.5, 0.75, 0.95):
            left.append(print_eta.estimate(share, 14 * share, slicer_hours=7.0)["remaining_hours"])
        truth = [14 * (1 - s) for s in (0.05, 0.25, 0.5, 0.75, 0.95)]
        errors = [abs(a - b) / b for a, b in zip(left, truth)]
        self.assertLess(errors[0], 0.5)           # early, the file's figure still leads
        self.assertLess(errors[2], 0.2)           # halfway, the print's own pace has taken over
        self.assertLess(errors[4], 0.1)           # near the end it is close
        self.assertLess(errors[2], errors[0])

    def test_the_end_of_a_print_never_swings(self):
        # Near 100% the answer is small whatever the file said.
        eta = print_eta.estimate(0.99, 7.0, slicer_hours=3.0)
        self.assertLess(eta["remaining_hours"], 0.15)

    def test_no_file_estimate_and_too_little_print_is_no_answer(self):
        self.assertIsNone(print_eta.estimate(0.005, 0.02))
        self.assertIsNone(print_eta.estimate(0.01, 0.2))
        self.assertIsNone(print_eta.estimate(0.5, 0.0))
        eta = print_eta.estimate(0.25, 1.0)
        self.assertEqual(eta["basis"], "pace")
        self.assertAlmostEqual(eta["remaining_hours"], 3.0, places=2)

    def test_the_file_leads_before_the_print_has_measured_anything(self):
        eta = print_eta.estimate(0.0, 0.0, slicer_hours=7.0)
        self.assertEqual(eta["basis"], "file")
        self.assertEqual(eta["remaining_hours"], 7.0)
        self.assertIsNone(eta["pace"])

    def test_nothing_is_made_up_for_a_print_that_is_not_running(self):
        for bad in (None, -0.1, 1.0, 1.5, "x"):
            self.assertIsNone(print_eta.estimate(bad, 1.0, slicer_hours=2.0))

    def test_a_truer_share_than_bytes_corrects_a_file_that_reads_slowly(self):
        # 10% of the bytes but 20% of the time: the print is on the file's pace (7 h), not twice as slow.
        by_bytes = print_eta.estimate(0.10, 1.4, slicer_hours=7.0)
        by_time = print_eta.estimate(0.10, 1.4, slicer_hours=7.0, shaped=0.20, shaped_by="file")
        self.assertEqual(by_time["weighted_by"], "file")
        self.assertAlmostEqual(by_time["remaining_hours"], 5.6, places=2)
        self.assertGreater(by_bytes["remaining_hours"], by_time["remaining_hours"] + 2)

    def test_the_pace_is_bounded(self):
        eta = print_eta.estimate(0.5, 500.0, slicer_hours=7.0)
        self.assertEqual(eta["pace"], print_eta.PACE_HIGH)

    def test_the_words_say_where_the_figure_comes_from(self):
        self.assertIn("file's own estimate", print_eta.words(print_eta.estimate(0.0, 0.0, slicer_hours=7.0)))
        self.assertIn("file carries no estimate", print_eta.words(print_eta.estimate(0.25, 1.0)))
        self.assertIn("% of the file's pace", print_eta.words(print_eta.estimate(0.3, 4.2, slicer_hours=7.0)))
        self.assertEqual(print_eta.words(None), "")


class TestTrack(unittest.TestCase):
    def setUp(self):
        # Every 1000 bytes take 1 second for the first 4000 bytes, then 4 seconds each for the last 4000:
        # half the bytes, one fifth of the time.
        step = [1000, 1000, 0, 0, 0]
        slow = [1000, 4000, 0, 0, 0]
        flat = step * 4 + slow * 4
        self.preview = {"timeline": {"track": flat, "bytes": 8000, "seconds": 20.0}}
        print_eta.forget("p1")
        print_eta.remember("p1", "a.gcode", self.preview)

    def tearDown(self):
        print_eta.forget("p1")

    def test_a_byte_is_placed_on_the_files_own_time(self):
        share = print_eta.file_time_share("p1", "a.gcode", 4000, 8000)
        self.assertAlmostEqual(share, 0.2, places=3)
        self.assertAlmostEqual(print_eta.file_time_share("p1", "a.gcode", 2000, 8000), 0.1, places=3)
        self.assertEqual(print_eta.file_time_share("p1", "a.gcode", 99999, 8000), 1.0)

    def test_another_file_or_another_size_has_no_track(self):
        self.assertIsNone(print_eta.file_time_share("p1", "other.gcode", 4000, 8000))
        self.assertIsNone(print_eta.file_time_share("p1", "a.gcode", 4000, 9000))
        self.assertIsNone(print_eta.file_time_share("p2", "a.gcode", 4000, 8000))

    def test_attach_uses_the_track_the_printers_own_progress_and_the_file(self):
        state = {"state": "printing", "progress": 0.5, "print_duration_hours": 1.0, "current_file": "a.gcode",
                 "sync": {"file_position": 4000, "file_size": 8000}}
        print_eta.attach(state, "p1", 5.0)
        self.assertEqual(state["eta"]["weighted_by"], "file")
        # 20% of the print's time is done after 1 hour on a 5 hour file: exactly on pace, 4 hours left.
        self.assertAlmostEqual(state["eta"]["remaining_hours"], 4.0, places=2)
        self.assertIn("file's estimate", state["eta"]["words"])

    def test_the_slicers_own_progress_wins_where_it_differs_from_bytes(self):
        state = {"state": "printing", "progress": 0.5, "display_progress": 0.2, "print_duration_hours": 1.0,
                 "current_file": "a.gcode", "sync": {"file_position": 4000, "file_size": 8000}}
        print_eta.attach(state, "p1", 5.0)
        self.assertEqual(state["eta"]["weighted_by"], "slicer")
        # The same value as the bytes (no M73 yet) adds nothing: the track is used instead.
        state = {"state": "printing", "progress": 0.5, "display_progress": 0.5, "print_duration_hours": 1.0,
                 "current_file": "a.gcode", "sync": {"file_position": 4000, "file_size": 8000}}
        print_eta.attach(state, "p1", 5.0)
        self.assertEqual(state["eta"]["weighted_by"], "file")

    def test_idle_and_finished_printers_get_no_estimate(self):
        for name in ("ready", "complete", "error"):
            state = {"state": name, "progress": 0.5, "print_duration_hours": 1.0, "eta": {"stale": True}}
            print_eta.attach(state, "p1", 5.0)
            self.assertNotIn("eta", state)

    def test_the_remaining_hours_helper_only_answers_while_printing(self):
        state = {"state": "printing", "progress": 0.4, "print_duration_hours": 2.8}
        print_eta.attach(state, "p9", 7.0)
        self.assertAlmostEqual(print_eta.remaining_hours(state), 4.2, places=2)
        state["state"] = "paused"
        self.assertIsNone(print_eta.remaining_hours(state))


if __name__ == "__main__":
    unittest.main()
