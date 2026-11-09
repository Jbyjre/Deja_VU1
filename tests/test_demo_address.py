"""
The online demo's web address is spelled the same way in every file (README, docs, the product page and
its social-card tags, the picture card). tools/demo-address.py reads and changes them together.
"""

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("demo_address", ROOT / "tools" / "demo-address.py")
demo_address = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo_address)


class TestDemoAddress(unittest.TestCase):
    def test_every_file_names_the_same_address(self):
        seen = demo_address.found()
        self.assertEqual(len(seen), 1, seen)
        host = next(iter(seen))
        self.assertTrue(demo_address.VALID.match(host), host)
        # The README, the product page and the social-card tags are among them.
        names = {n for paths in seen.values() for n in paths}
        self.assertIn("README.md", names)
        self.assertIn("frontend/welcome.html", names)

    def test_one_command_changes_every_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "README.md").write_text("[demo](https://old.name.workers.dev/?demo)\n", encoding="utf-8")
            (root / "docs" / "a.md").write_text("see https://old.name.workers.dev and http://other.x.workers.dev/img\n",
                                                encoding="utf-8")
            (root / "CHANGELOG.md").write_text("https://old.name.workers.dev\n", encoding="utf-8")
            changed = demo_address.rewrite("deja-vu1.new-name.workers.dev", root)
            self.assertEqual(sorted(changed), ["README.md", "docs/a.md"])
            self.assertEqual(list(demo_address.found(root)), ["deja-vu1.new-name.workers.dev"])
            self.assertIn("old.name", (root / "CHANGELOG.md").read_text(encoding="utf-8"))   # history stays
            self.assertIn("https://deja-vu1.new-name.workers.dev/?demo", (root / "README.md").read_text(encoding="utf-8"))

    def test_a_half_address_is_refused(self):
        for bad in ("", "just-a-name", "https://x.workers.dev", "a b.workers.dev", "x.example.com"):
            with self.assertRaises(ValueError, msg=bad):
                demo_address.rewrite(bad, ROOT / "nonexistent")


if __name__ == "__main__":
    unittest.main()
