"""Bench readings of known spools: the recording, the sums and the rules that stop a report from claiming more than the data shows.

All data here is invented, in the tests and in the tool's synthetic mode. Nothing says how a real sensor does.
"""

import csv
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import colour_bench as bench  # noqa: E402
import companion_sensor as sensor  # noqa: E402
import mock_moonraker  # noqa: E402
import modules  # noqa: E402
import sensor_calibration as cal  # noqa: E402
from tests.test_real_printer import RealPrinterAPI  # noqa: E402

_spec = importlib.util.spec_from_file_location("colour_bench_tool", os.path.join(ROOT, "tools", "colour-bench.py"))
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)


def hexof(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def make(name, label, measured, count=4, blind=False, flags=None, synthetic=False):
    """`count` readings of one spool; `measured` is a list of RGB tuples cycled through them."""
    out = []
    for i in range(count):
        colour = measured[i % len(measured)]
        out.append({"id": f"{name}-{i}", "spool": {"brand": "Test", "material": "PLA", "name": name, "hex": hexof(label)},
                    "blind": blind, "insertion": i // 2 + 1, "mode": "strand", "quality_flags": list(flags or []),
                    "measured_hex": hexof(colour), "captured_at": i, "synthetic": synthetic})
    return out


PALETTE = [(200, 30, 30), (230, 120, 20), (240, 220, 40), (30, 160, 50), (20, 170, 160), (30, 80, 200), (20, 20, 120),
           (130, 50, 160), (240, 120, 180), (128, 128, 128), (20, 20, 20), (240, 240, 240)]


def spools(count, noise=3, blind_from=None):
    samples = []
    for number, colour in enumerate(PALETTE[:count]):
        shifted = [tuple(min(255, max(0, c + d)) for c in colour) for d in (-noise, 0, noise, 0)]
        samples += make("S%d" % number, colour, shifted, blind=blind_from is not None and number >= blind_from)
    return samples


class TheSums(unittest.TestCase):
    def test_distance_to_the_label_and_the_verdict_use_the_apps_own_tolerances(self):
        result = bench.analyse(make("Red", (200, 30, 30), [(210, 30, 30)]) + make("Far", (200, 30, 30), [(90, 30, 30)], count=4)
                               [:0] + make("Close", (0, 0, 0), [(60, 0, 0)]) + make("Wrong", (0, 0, 0), [(120, 0, 0)]))
        by = {r["name"]: r for r in result["spools"]}
        self.assertEqual((by["Red"]["distance"], by["Red"]["verdict"]), (10.0, "match"))
        self.assertEqual((by["Close"]["distance"], by["Close"]["verdict"]), (60.0, "close"))
        self.assertEqual((by["Wrong"]["distance"], by["Wrong"]["verdict"]), (120.0, "mismatch"))
        self.assertEqual(by["Red"]["delta_e"], round(bench.delta_e((210, 30, 30), (200, 30, 30)), 1))

    def test_delta_e_of_known_pairs(self):
        self.assertAlmostEqual(bench.delta_e((255, 255, 255), (0, 0, 0)), 100.0, places=0)
        self.assertEqual(bench.delta_e((10, 20, 30), (10, 20, 30)), 0)

    def test_steadiness_and_re_insertion_spread_come_from_the_readings(self):
        steady = make("Steady", (100, 100, 100), [(100, 100, 100)], count=6)
        moving = make("Moving", (100, 100, 100), [(100, 100, 100), (100, 100, 100), (140, 100, 100), (140, 100, 100)], count=4)
        by = {r["name"]: r for r in bench.analyse(steady + moving)["spools"]}
        self.assertEqual((by["Steady"]["repeat_p95"], by["Steady"]["reinsert_spread"]), (0.0, 0.0))
        self.assertEqual(by["Moving"]["reinsert_spread"], 40.0)
        self.assertGreater(by["Moving"]["repeat_p95"], 15)

    def test_a_reading_the_sensor_flagged_is_counted_as_unreadable_and_never_as_a_colour(self):
        flagged = make("Flagged", (50, 50, 50), [(50, 50, 50)], count=4, flags=["saturated"])
        result = bench.analyse(flagged + spools(1))
        row = next(r for r in result["spools"] if r["name"] == "Flagged")
        self.assertEqual((row["readable"], row["samples"], row["measured"], row["enough"]), (0, 4, None, False))
        self.assertEqual(result["flags"], {"saturated": 4})

    def test_the_confusion_table_names_the_label_each_reading_was_nearest_to(self):
        # two near shades measured badly enough that one is taken for the other
        a = make("A", (100, 100, 100), [(100, 100, 100)], count=4)
        b = make("B", (110, 110, 110), [(101, 101, 101)], count=4)
        result = bench.analyse(a + b, min_spools=2)
        matrix = result["confusion"]["matrix"]
        self.assertEqual(matrix[hexof((110, 110, 110))].get(hexof((100, 100, 100))), 4)
        self.assertEqual(matrix[hexof((100, 100, 100))].get(hexof((100, 100, 100))), 4)
        self.assertEqual(result["nearest_label"]["tune"]["hits"], 1)  # one of the two spools is right
        pair = result["near_pairs"][0]
        self.assertFalse(pair["told_apart"] and pair["measured_apart"] <= 1.0)

    def test_the_blind_spools_are_counted_apart_from_the_ones_used_to_tune(self):
        result = bench.analyse(spools(12, blind_from=9))
        self.assertEqual(result["match_label"]["blind"]["of"], 3)
        self.assertEqual(result["match_label"]["tune"]["of"], 9)
        self.assertTrue(all(r["blind"] for r in result["spools"] if r["name"] in ("S9", "S10", "S11")))


class WhatItWillNotClaim(unittest.TestCase):
    def test_no_rate_is_quoted_from_fewer_than_ten_spools_but_the_counts_and_range_always_are(self):
        result = bench.analyse(spools(9))
        self.assertFalse(result["enough"])
        self.assertIsNone(result["match_label"]["tune"]["rate"])
        text = bench.render(result)
        self.assertIn("Not enough data to quote a rate", text)
        self.assertIn("9 of 9 spools", text)
        self.assertIn("Too few to quote a rate", text)
        self.assertNotRegex(text, r"\b100 %,")

    def test_a_rate_appears_at_ten_spools_with_its_range(self):
        result = bench.analyse(spools(12))
        self.assertTrue(result["enough"])
        share = result["match_label"]["tune"]
        self.assertEqual((share["hits"], share["of"], share["rate"]), (12, 12, 1.0))
        self.assertLess(share["low"], 1.0)  # even a perfect score of 12 is not certain
        self.assertIn("100 %", bench.render(result))

    def test_a_spool_with_too_few_readable_readings_does_not_count(self):
        thin = spools(11) + make("Thin", (10, 10, 10), [(10, 10, 10)], count=2)
        result = bench.analyse(thin)
        self.assertEqual(result["usable_spools"], 11)
        self.assertFalse(next(r for r in result["spools"] if r["name"] == "Thin")["enough"])

    def test_the_blind_rate_counts_spools_not_readings(self):
        # 3 blind spools with 4 readings each is 12 readings but only 3 spools: no rate
        result = bench.analyse(spools(12, blind_from=9))
        blind = result["nearest_label"]["blind"]
        self.assertEqual((blind["of"], blind["readings"][1]), (3, 12))
        self.assertIsNone(blind["rate"])

    def test_synthetic_readings_put_a_banner_on_the_report(self):
        data = make("Fake", (10, 10, 10), [(10, 10, 10)], synthetic=True)
        self.assertIn("SYNTHETIC DATA", bench.render(bench.analyse(data)))
        self.assertNotIn("SYNTHETIC", bench.render(bench.analyse(make("Real", (10, 10, 10), [(10, 10, 10)]))))

    def test_nothing_recorded_gives_a_report_that_says_what_is_missing(self):
        text = bench.render(bench.analyse([]))
        self.assertIn("Not enough data", text)
        self.assertIn("What this does not show", text)

    def test_the_report_never_calls_the_distance_to_a_label_accuracy(self):
        text = bench.render(bench.analyse(spools(12))).lower()
        self.assertIn("not its accuracy", text)
        self.assertIn("label colours are the maker's or seller's", text)

    def test_wilson_range(self):
        low, high = bench.wilson(5, 10)
        self.assertAlmostEqual(low, 0.2366, places=3)
        self.assertAlmostEqual(high, 0.7634, places=3)
        self.assertEqual(bench.wilson(0, 0), (0.0, 1.0))


class Recording(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(cal, "_PATH", os.path.join(folder.name, "calibrations.json")),
                      mock.patch.object(bench, "_PATH", os.path.join(folder.name, "bench.json")),
                      mock.patch.object(sensor, "_readings", {}),
                      mock.patch.object(sensor, "_unassigned", {}),
                      mock.patch.object(sensor, "_commands", {})):
            patch.start()
            self.addCleanup(patch.stop)
        modules.set_enabled("color_check", True)
        self.route = "?printer=" + self.pid
        self.request("/api/colorcheck/sensors" + self.route, {"version": 1, "simulated": False, "bindings": [
            {"toolhead": "T0", "device_id": "pico-1", "channel_id": "inlet-0", "sensor_id": "as7341-1", "sensor_model": "AS7341"}]})
        self.tick = int(time.time()) - 4  # successive capture times that all still count as fresh

    def reading(self, ratio=1.0, flags=None):
        self.tick += 1
        raw = {name: 1000 * ratio for name, _ in cal.AS7341_BANDS}
        return self.request("/api/colorcheck/readings" + self.route, {
            "version": 1, "simulated": False, "device_id": "pico-1", "channel_id": "inlet-0", "sensor_id": "as7341-1",
            "sensor_model": "AS7341", "captured_at": self.tick, "raw": raw, "quality_flags": flags or [],
            "calibrated": None, "settings": {"gain": 16}})

    def spool(self, **extra):
        body = {"toolhead": "T0", "spool": {"brand": "Acme", "material": "PLA", "name": "Signal red", "hex": "#c8281e"}, "insertion": 1}
        body.update(extra)
        return body

    def test_a_reading_is_kept_with_its_counts_its_references_and_the_spool_it_was_of(self):
        self.reading(1.0)
        self.request("/api/colorcheck/calibration" + self.route, {"toolhead": "T0", "step": "white"})
        time.sleep(1.1)
        self.reading(0.5)
        status, body = self.request("/api/colorcheck/bench" + self.route, self.spool(blind=True, notes="first try"))
        self.assertEqual(status, 200, body)
        _, full = self.request("/api/colorcheck/bench" + self.route + "&full=1")
        sample = full["samples"][0]
        self.assertEqual(sample["spool"]["hex"], "#c8281e")
        self.assertTrue(sample["blind"])
        self.assertEqual(sample["raw"]["f1"], 500)
        self.assertEqual(sample["reference"]["white"]["f1"], 1000)
        self.assertEqual(sample["settings"], {"gain": 16})
        self.assertEqual(sample["measured_hex"], body["samples"][0]["measured_hex"])
        self.assertNotIn("raw", body["samples"][0])  # the short listing leaves the counts out

    def test_the_same_reading_cannot_be_recorded_twice(self):
        self.reading()
        self.assertEqual(self.request("/api/colorcheck/bench" + self.route, self.spool())[0], 200)
        status, body = self.request("/api/colorcheck/bench" + self.route, self.spool())
        self.assertEqual(status, 400)
        self.assertIn("already recorded", body["error"])

    def test_a_flagged_reading_is_recorded_as_flagged_so_the_report_can_count_it(self):
        self.reading(flags=["low_light"])
        self.assertEqual(self.request("/api/colorcheck/bench" + self.route, self.spool())[0], 200)
        _, listing = self.request("/api/colorcheck/bench" + self.route)
        self.assertEqual(listing["samples"][0]["quality_flags"], ["low_light"])
        self.assertEqual(listing["spools"][0]["readable"], 0)

    def test_what_is_refused_is_refused_in_words(self):
        self.reading()
        for body, words in (({"toolhead": "T9"}, "Choose a head"), (self.spool(spool="x"), "Say which spool"),
                            (self.spool(spool={"brand": "A", "material": "PLA", "name": "N", "hex": "red"}), "six hex digits"),
                            (self.spool(mode="sideways"), "strand"), (self.spool(insertion=0), "insertion"),
                            (self.spool(toolhead="T2"), "No colour sensor")):
            status, answer = self.request("/api/colorcheck/bench" + self.route, dict(self.spool(), **body) if "spool" not in body else body)
            self.assertEqual(status, 400, body)
            self.assertIn(words, answer["error"], body)

    def test_it_needs_a_fresh_reading(self):
        status, body = self.request("/api/colorcheck/bench" + self.route, self.spool())
        self.assertEqual(status, 400)
        self.assertIn("Wait for a new reading", body["error"])

    def test_the_module_switch_and_demo_printers_are_respected(self):
        modules.set_enabled("color_check", False)
        self.assertEqual(self.request("/api/colorcheck/bench" + self.route, self.spool())[0], 403)
        self.assertEqual(self.request("/api/colorcheck/bench" + self.route)[0], 403)
        modules.set_enabled("color_check", True)
        status, body = self.request("/api/colorcheck/bench?demo=1&printer=u1-workshop", self.spool())
        self.assertEqual(status, 400)

    def test_a_sample_or_a_whole_spool_can_be_removed(self):
        for _ in range(3):
            self.reading()
            self.request("/api/colorcheck/bench" + self.route, self.spool())
        _, listing = self.request("/api/colorcheck/bench" + self.route)
        self.assertEqual(listing["count"], 3)
        one = listing["samples"][0]["id"]
        self.assertEqual(self.request("/api/colorcheck/bench/delete" + self.route, {"id": one})[1]["count"], 2)
        key = listing["spools"][0]["key"]
        self.assertEqual(self.request("/api/colorcheck/bench/delete" + self.route, {"spool": key})[1]["count"], 0)
        self.assertEqual(self.request("/api/colorcheck/bench/delete" + self.route, {"id": "nope"})[0], 400)


class TheTool(unittest.TestCase):
    def test_synthetic_data_makes_a_report_with_the_banner_and_a_csv(self):
        with tempfile.TemporaryDirectory() as folder:
            data = os.path.join(folder, "syn.json")
            self.assertEqual(tool.main(["synthetic", "--out", data, "--spools", "12", "--repeats", "6"]), 0)
            report, table = os.path.join(folder, "r.md"), os.path.join(folder, "s.csv")
            self.assertEqual(tool.main(["report", data, "--out", report, "--csv", table]), 0)
            with open(report, encoding="utf-8") as handle:
                text = handle.read()
            self.assertIn("SYNTHETIC DATA", text)
            self.assertIn("Blind spools: 3 of 3 spools", text)
            with open(table, newline="", encoding="utf-8") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(rows[0][0:3], ["id", "brand", "material"])
            self.assertEqual(len(rows), 1 + 12 * 6)

    def test_the_tool_reads_the_apps_file_and_an_export(self):
        samples = spools(10)
        with tempfile.TemporaryDirectory() as folder:
            for name, body in (("file.json", {"samples": samples}), ("export.json", samples)):
                path = os.path.join(folder, name)
                with open(path, "w", encoding="utf-8") as handle:
                    json.dump(body, handle)
                self.assertEqual(len(tool.load(path)), len(samples))


if __name__ == "__main__":
    unittest.main()
