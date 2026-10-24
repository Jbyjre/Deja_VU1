"""
The dashboard never forgets: a damaged record is repaired from its last
good copy or a safety copy, and safety copies can be listed and restored.
"""

import json
import os
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import memory      # noqa: E402
import storage     # noqa: E402


class MemoryCase(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(storage.DATA_DIR, "memory-test.json")
        self.addCleanup(self._tidy)

    def _tidy(self):
        for p in (self.path, storage.prev_path(self.path)):
            if os.path.exists(p):
                os.remove(p)
        for name in os.listdir(storage.DATA_DIR):
            if name.startswith("memory-test.json.corrupt-"):
                os.remove(os.path.join(storage.DATA_DIR, name))
        if os.path.isdir(memory.SNAP_DIR):
            for name in os.listdir(memory.SNAP_DIR):
                os.remove(os.path.join(memory.SNAP_DIR, name))


class TestRepair(MemoryCase):
    def test_every_save_keeps_the_last_good_copy(self):
        storage.save_json(self.path, {"n": 1})
        storage.save_json(self.path, {"n": 2})
        with open(storage.prev_path(self.path)) as fh:
            self.assertEqual(json.load(fh), {"n": 1})

    def test_a_damaged_record_is_repaired_from_its_last_good_copy(self):
        storage.save_json(self.path, {"printers": ["a"]})
        storage.save_json(self.path, {"printers": ["a", "b"]})
        with open(self.path, "w") as fh:
            fh.write('{"printers": ["a", "b"')            # cut short, as by a power cut
        self.assertEqual(storage.load_json(self.path, {}), {"printers": ["a"]})
        self.assertEqual(storage.load_json(self.path, {}), {"printers": ["a"]})   # repaired on disk too
        self.assertEqual(storage.repairs()[-1]["file"], "memory-test.json")
        self.assertTrue(any(n.startswith("memory-test.json.corrupt-") for n in os.listdir(storage.DATA_DIR)))

    def test_a_damaged_file_never_overwrites_a_good_previous_copy(self):
        storage.save_json(self.path, {"good": True})
        storage.save_json(self.path, {"good": "still"})
        with open(self.path, "w") as fh:
            fh.write("not json")
        storage.save_json(self.path, {"new": 1})        # the damaged file is not kept as "previous"
        with open(storage.prev_path(self.path)) as fh:
            self.assertEqual(json.load(fh), {"good": True})

    def test_a_safety_copy_repairs_what_has_no_previous_copy(self):
        storage.save_json(self.path, {"spools": 3})
        memory.snapshot("automatic")
        os.remove(storage.prev_path(self.path)) if os.path.exists(storage.prev_path(self.path)) else None
        with open(self.path, "w") as fh:
            fh.write("{oops")
        self.assertEqual(storage.load_json(self.path, {}), {"spools": 3})
        self.assertIn("safety copy", storage.repairs()[-1]["from"])

    def test_nothing_to_recover_falls_back_to_defaults(self):
        with open(self.path, "w") as fh:
            fh.write("{oops")
        self.assertEqual(storage.load_json(self.path, {"fresh": True}), {"fresh": True})


class TestSafetyCopies(MemoryCase):
    def test_copy_list_restore_and_undo(self):
        storage.save_json(self.path, {"version": "old"})
        first = memory.snapshot("manual")
        self.assertGreaterEqual(first["files"], 1)
        storage.save_json(self.path, {"version": "new"})
        listed = memory.status()["copies"]
        self.assertEqual(listed[0]["id"], first["id"])
        result = memory.restore(first["id"], "memory-test.json")
        self.assertEqual(result["restored"], 1)
        self.assertEqual(storage.load_json(self.path, {}), {"version": "old"})
        # The restore itself can be undone: a copy of how things were was taken first.
        memory.restore(result["undo"], "memory-test.json")
        self.assertEqual(storage.load_json(self.path, {}), {"version": "new"})

    def test_only_listed_copies_can_be_restored(self):
        for bad in ("../fleet.json", "safety-2026.zip", None, "safety-20260101-000000-manual.zip"):
            with self.assertRaises(ValueError):
                memory.restore(bad)

    def test_a_tampered_copy_restores_nothing(self):
        import zipfile
        storage.save_json(self.path, {"a": 1})
        made = memory.snapshot("manual")
        path = os.path.join(memory.SNAP_DIR, made["id"])
        with zipfile.ZipFile(path) as z:
            items = {n: z.read(n) for n in z.namelist()}
        items["memory-test.json"] = b'{"a": 2}'
        with zipfile.ZipFile(path, "w") as z:
            for n, data in items.items():
                z.writestr(n, data)
        storage.save_json(self.path, {"a": 3})
        with self.assertRaisesRegex(ValueError, "damaged"):
            memory.restore(made["id"])
        self.assertEqual(storage.load_json(self.path, {}), {"a": 3})

    def test_only_the_newest_are_kept_and_due_after_six_hours(self):
        with patch.object(memory, "KEEP", 3):
            for _ in range(4):
                memory.snapshot("automatic")
            self.assertEqual(len(memory.list_copies()), 3)
        self.assertFalse(memory.due())
        self.assertTrue(memory.due(now=time.time() + memory.EVERY + 5))

    def test_copies_stay_out_of_full_backups(self):
        import backup
        memory.snapshot("manual")
        storage.save_json(self.path, {"x": 1})
        storage.save_json(self.path, {"x": 2})
        names = [n for n, _ in backup._files()]
        self.assertFalse(any(n.startswith("snapshots/") for n in names))
        self.assertFalse(any(os.path.basename(n).startswith(".") for n in names))


if __name__ == "__main__":
    unittest.main()
