"""'Check it yourself' (backend/selfcheck.py): every check passes on a working copy."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import memory      # noqa: E402
import selfcheck   # noqa: E402
import storage     # noqa: E402


class TestSelfCheck(unittest.TestCase):
    def test_every_check_passes_and_leaves_nothing_behind(self):
        memory.snapshot("automatic")
        before = set(os.listdir(storage.DATA_DIR))
        repairs = len(storage.repairs())
        out = selfcheck.run()
        failed = [r for r in out["results"] if not r["passed"]]
        self.assertEqual(failed, [])
        self.assertEqual(out["passed"], out["total"])
        self.assertEqual(set(os.listdir(storage.DATA_DIR)), before)     # its scratch record is gone
        self.assertEqual(len(storage.repairs()), repairs)               # and isn't listed as a repair of your data

    def test_a_crashing_check_fails_in_words(self):
        r = selfcheck._check("x", "y", lambda: 1 / 0)
        self.assertFalse(r["passed"])
        self.assertIn("ZeroDivisionError", r["detail"])


if __name__ == "__main__":
    unittest.main()
