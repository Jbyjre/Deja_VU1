"""
Which engines have been run for real (backend/engine_support.py), and that the
list written for people (docs/engine-support.md) says the same.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backend"))

import engine_support as support  # noqa: E402


class TestAssess(unittest.TestCase):
    def test_the_specialised_build_is_tested_with_per_head_heights_on_linux(self):
        result = support.assess("Snapmaker_Orca", "02.08.01.55", "Linux")
        self.assertEqual(result["level"], "tested")
        self.assertTrue(result["per_head_heights"])
        self.assertIn("Per-head layer heights are tested", result["detail"])
        self.assertIn("docs/slicer-workspace-validation.md", result["evidence"])

    def test_stock_orca_is_tested_for_shared_heights_only(self):
        result = support.assess("OrcaSlicer", "2.4.2", "Linux")
        self.assertEqual(result["level"], "tested")
        self.assertFalse(result["per_head_heights"])
        self.assertIn("Shared layer heights only", result["detail"])

    def test_the_same_build_on_another_system_is_not_tested_and_says_so(self):
        for system, word in (("Windows", "Windows"), ("Darwin", "macOS")):
            result = support.assess("Snapmaker_Orca", "02.08.01.55", system)
            self.assertEqual(result["level"], "untested")
            self.assertIn(f"{word} is next", result["title"])
            self.assertIn("recorded runs are on Linux", result["title"])
            self.assertIsNone(result["per_head_heights"])

    def test_another_version_of_a_known_engine_is_not_tested(self):
        result = support.assess("OrcaSlicer", "2.3.2", "Linux")
        self.assertEqual(result["level"], "untested")
        self.assertIn("OrcaSlicer 2.3.2", result["title"])
        self.assertIn("2.4.2", result["title"])

    def test_an_unknown_engine_is_not_tested(self):
        result = support.assess("SomethingElse", "1.0", "Linux")
        self.assertEqual(result["level"], "untested")
        self.assertIn("Ready to slice with SomethingElse", result["title"])

    def test_the_engine_name_matches_however_it_is_spelled(self):
        self.assertEqual(support.assess("snapmaker orca", "02.08.01.55", "Linux")["level"], "tested")
        self.assertEqual(support.assess("SNAPMAKER-ORCA", "02.08.01.55", "Linux")["level"], "tested")

    def test_every_untested_answer_lists_what_was_tested_and_never_blocks(self):
        result = support.assess("X", "1", "Windows")
        self.assertIn("Snapmaker_Orca 02.08.01.55 on Linux", result["detail"])
        self.assertIn("OrcaSlicer 2.4.2 on Linux", result["detail"])
        self.assertIn("If a slice fails, the report says why", result["detail"])

    def test_system_words(self):
        self.assertEqual(support.system_name("Darwin"), "macOS")
        self.assertEqual(support.system_name("Windows"), "Windows")
        self.assertEqual(support.system_name(None), "this system")


class TestTheListForPeople(unittest.TestCase):
    def test_the_document_lists_every_verified_row_and_names_its_evidence(self):
        with open(os.path.join(HERE, "..", "docs", "engine-support.md"), encoding="utf-8") as fh:
            text = fh.read()
        for row in support.VERIFIED:
            self.assertIn(row["app"], text)
            self.assertIn(row["version"], text)
            self.assertTrue(row["evidence"].strip())
        self.assertIn("Windows", text)
        self.assertIn("macOS", text)

    def test_every_row_names_a_real_file_as_evidence(self):
        for row in support.VERIFIED:
            for token in row["evidence"].replace(",", " ").replace(":", " ").split():
                if token.endswith(".md"):
                    self.assertTrue(os.path.isfile(os.path.join(HERE, "..", token)) or
                                    os.path.isfile(os.path.join(HERE, "..", "docs", os.path.basename(token))), token)


if __name__ == "__main__":
    unittest.main()
