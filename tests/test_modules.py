"""
Tests for the two placeholder modules (LED rings and color checker).

These modules have no hardware yet, so the tests cover the parts that are
real today: the decision logic, the color comparison maths, and the promise
that the simulation always reports itself as simulated.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import color_check          # noqa: E402
import led_status           # noqa: E402
import mock_moonraker       # noqa: E402


class TestLedStatus(unittest.TestCase):

    def setUp(self):
        self.data = led_status.get_all_ring_states()

    def test_one_ring_per_toolhead(self):
        self.assertEqual(len(self.data["rings"]), len(mock_moonraker.TOOLHEADS))

    def test_output_is_flagged_as_simulated(self):
        # The dashboard relies on this to show its "Simulation" badge. If it
        # ever silently claims to be real hardware, that is a bug.
        self.assertTrue(self.data["simulated"])
        self.assertFalse(self.data["hardware_connected"])

    def test_every_ring_has_a_valid_color_and_effect(self):
        for ring in self.data["rings"]:
            self.assertRegex(ring["color_hex"], r"^#[0-9a-f]{6}$")
            self.assertIn(ring["effect"], {"solid", "pulse", "blink"})
            self.assertIn(ring["state"], led_status.STATE_COLORS)

    def test_progress_arc_stays_within_the_ring(self):
        for ring in self.data["rings"]:
            self.assertGreaterEqual(ring["leds_lit"], 0)
            self.assertLessEqual(ring["leds_lit"], ring["leds_total"])

    def test_only_the_active_toolhead_shows_progress(self):
        for ring in self.data["rings"]:
            if ring["state"] != "active":
                self.assertEqual(ring["progress"], 0.0)

    def test_a_hot_active_toolhead_reads_as_printing(self):
        state = mock_moonraker.get_printer_state()
        ring = led_status.decide_ring_state(
            "T0", {"status": "active", "temperature": 215.0}, state)
        self.assertEqual(ring["state"], "active")

    def test_a_cold_active_toolhead_reads_as_heating(self):
        # Still warming up, so the ring should be amber, not green.
        state = mock_moonraker.get_printer_state()
        ring = led_status.decide_ring_state(
            "T0", {"status": "active", "temperature": 45.0}, state)
        self.assertEqual(ring["state"], "heating")

    def test_hardware_is_not_connected_and_driver_refuses_to_run(self):
        self.assertFalse(led_status.connect_hardware())
        with self.assertRaises(NotImplementedError):
            led_status._write_to_hardware([])

    def test_push_update_falls_back_to_simulation(self):
        # With no hardware present this must not raise — it should simulate.
        self.assertTrue(led_status.push_update()["simulated"])


class TestColorDistance(unittest.TestCase):
    """The comparison maths, which is real and works today."""

    def test_identical_colors_have_zero_distance(self):
        self.assertEqual(color_check.color_distance("#f26a1b", "#f26a1b"), 0)

    def test_black_and_white_are_maximally_far_apart(self):
        distance = color_check.color_distance("#000000", "#ffffff")
        self.assertAlmostEqual(distance, 441.7, places=0)

    def test_distance_ignores_argument_order(self):
        self.assertEqual(
            color_check.color_distance("#f26a1b", "#1c1c1e"),
            color_check.color_distance("#1c1c1e", "#f26a1b"),
        )

    def test_hex_parsing_handles_a_missing_hash(self):
        self.assertEqual(color_check.color_distance("f26a1b", "#f26a1b"), 0)


class TestColorVerdicts(unittest.TestCase):

    def test_a_tiny_difference_counts_as_a_match(self):
        result = color_check.compare("#f26a1b", "#f36c1d")
        self.assertEqual(result["verdict"], "match")

    def test_a_wildly_different_color_is_a_mismatch(self):
        result = color_check.compare("#f26a1b", "#1c1c1e")
        self.assertEqual(result["verdict"], "mismatch")

    def test_a_borderline_difference_is_flagged_as_close(self):
        # Distance here is about 78, between the two tolerance thresholds.
        result = color_check.compare("#000000", "#2d2d2d")
        self.assertEqual(result["verdict"], "close")

    def test_verdict_thresholds_line_up_with_the_constants(self):
        self.assertLess(color_check.MATCH_TOLERANCE, color_check.WARN_TOLERANCE)


class TestColorCheckJob(unittest.TestCase):

    def setUp(self):
        self.data = color_check.check_current_job()

    def test_output_is_flagged_as_simulated(self):
        self.assertTrue(self.data["simulated"])
        self.assertFalse(self.data["hardware_connected"])

    def test_one_check_per_required_toolhead(self):
        expected = mock_moonraker.get_current_job_requirements()["required_filament"]
        self.assertEqual(len(self.data["checks"]), len(expected))

    def test_the_demo_shows_both_a_match_and_a_mismatch(self):
        # A demo where everything passes never shows the warning UI, which is
        # the whole point of the module.
        verdicts = {c["verdict"] for c in self.data["checks"]}
        self.assertIn("match", verdicts)
        self.assertIn("mismatch", verdicts)

    def test_overall_verdict_reflects_the_worst_check(self):
        verdicts = [c["verdict"] for c in self.data["checks"]]
        if "mismatch" in verdicts:
            self.assertEqual(self.data["overall"], "mismatch")
        elif "close" in verdicts:
            self.assertEqual(self.data["overall"], "close")
        else:
            self.assertEqual(self.data["overall"], "match")

    def test_sensor_is_not_connected_and_calibration_refuses_to_run(self):
        self.assertFalse(color_check.connect_sensor("T0"))
        with self.assertRaises(NotImplementedError):
            color_check.calibrate("T0")


if __name__ == "__main__":
    unittest.main()
