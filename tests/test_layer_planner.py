"""Mixed-nozzle layer planning and Confirm Print's nozzle check."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import layer_planner as lp   # noqa: E402


class TestSharedGrid(unittest.TestCase):

    def test_the_winning_projects_own_example(self):
        # LixNix's example: 0.2 mm nozzle at 0.08, 0.8 mm nozzle at 0.56 -> N = 7.
        p = lp.plan([{"toolhead": "T0", "nozzle": 0.2, "height": 0.08},
                     {"toolhead": "T1", "nozzle": 0.8, "height": 0.56}], part_height=30)
        self.assertEqual(p["grid"], 0.08)
        t0, t1 = p["heads"]
        self.assertEqual((t1["every"], t1["height"]), (7, 0.56))
        self.assertEqual((t0["layers"], t1["layers"]), (375, 54))
        # The 0.08 mm grid is thinner than the 0.8 mm nozzle's 0.16 mm minimum.
        self.assertTrue(any("prime-tower" in n for n in p["notes"]))

    def test_coarsest_grid_within_a_hundredth(self):
        g = lp.shared_grid([0.13, 0.37])
        for h in (0.13, 0.37):
            self.assertLessEqual(abs(h - round(h / g) * g), 0.0100001)
        self.assertGreaterEqual(g, 0.13 / 4)

    def test_exact_heights_use_the_common_divisor(self):
        self.assertEqual(lp.shared_grid([0.13, 0.37], exact=True), 0.01)
        self.assertEqual(lp.shared_grid([0.1, 0.3], exact=True), 0.1)

    def test_limits_come_from_snapmakers_u1_profiles(self):
        self.assertEqual(lp.U1_LIMITS[0.4], (0.08, 0.32))
        p = lp.plan([{"toolhead": "T0", "nozzle": 0.4, "height": 0.4}])
        self.assertFalse(p["heads"][0]["ok"])
        self.assertTrue(any("0.32 mm maximum" in n for n in p["notes"]))

    def test_refusals_in_words(self):
        for heads, word in (([], "at least one"), ([{"toolhead": "T5", "nozzle": 0.4, "height": 0.2}], "T0 to T3"),
                            ([{"toolhead": "T0", "nozzle": 0.5, "height": 0.2}], "no 0.5 mm"),
                            ([{"toolhead": "T0", "nozzle": 0.4, "height": "x"}], "isn't a layer height"),
                            ([{"toolhead": "T0", "nozzle": 0.4}], "layer height")):
            with self.subTest(heads=heads), self.assertRaises(ValueError) as e:
                lp.plan(heads)
            self.assertIn(word, str(e.exception))


class TestNozzleCheck(unittest.TestCase):
    HEADS = {"T0": {"nozzle_diameter": 0.4}, "T1": {"nozzle_diameter": 0.4},
             "T2": {"nozzle_diameter": 0.4}, "T3": {"nozzle_diameter": 0.2}}

    def test_a_file_for_another_nozzle_is_refused(self):
        meta = {"nozzle_diameter": "0.4,0.4,0.4,0.4"}
        blocking, info, rows = lp.check_nozzles(meta, {"T0", "T3"}, self.HEADS)
        self.assertEqual(len(blocking), 1)
        self.assertIn("T3", blocking[0])
        self.assertIn("0.2 mm nozzle fitted", blocking[0])

    def test_matching_nozzles_pass_and_mixed_heights_are_named(self):
        meta = {"nozzle_diameter": "0.4,0.4,0.4,0.2", "extruder_layer_height": "0.2,0,0,0.08"}
        blocking, info, rows = lp.check_nozzles(meta, {"T0", "T3"}, self.HEADS)
        self.assertEqual(blocking, [])
        self.assertTrue(any("Mixed layer heights" in i for i in info))
        self.assertEqual({r["toolhead"]: r["layer_height"] for r in rows}, {"T0": 0.2, "T3": 0.08})

    def test_a_printer_that_doesnt_report_nozzles_isnt_guessed(self):
        meta = {"nozzle_diameter": "0.8"}
        blocking, info, _ = lp.check_nozzles(meta, {"T1"}, {"T1": {"nozzle_diameter": None}})
        self.assertEqual(blocking, [])
        self.assertTrue(any("doesn't report" in i for i in info))

    def test_no_nozzle_in_the_file_means_no_check(self):
        self.assertEqual(lp.check_nozzles({}, {"T0"}, self.HEADS), ([], [], []))


if __name__ == "__main__":
    unittest.main()
