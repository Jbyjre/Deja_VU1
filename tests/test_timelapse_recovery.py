"""The printer's own time-lapse videos: listing them, keeping a copy, and the flipbooks staying separate."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import moonraker_client     # noqa: E402
import timelapse            # noqa: E402


class FakeHTTP:
    """Answers Moonraker's file routes the way the U1's stock firmware is reported to: a read-only camera root."""

    def __init__(self, roots):
        self.roots, self.asked = roots, []

    def request(self, method, path, query=None, raw=False, **kw):
        self.asked.append((method, path, query))
        if path == "/server/files/roots":
            return [{"name": n, "permissions": "r"} for n in self.roots]
        if path == "/server/files/list":
            return [{"path": "benchy_20261110T101500Z.mp4", "size": 2048, "modified": 200.0},
                    {"path": "benchy_20261110T101500Z.jpg", "size": 10, "modified": 200.0},
                    {"path": "older.mp4", "size": 1024, "modified": 100.0}]
        if path.startswith("/server/files/camera/"):
            return b"\x00\x00\x00\x18ftypmp42 video"
        raise AssertionError(path)


class PrinterVideos(unittest.TestCase):
    def printer(self, roots):
        p = moonraker_client.MoonrakerPrinter.__new__(moonraker_client.MoonrakerPrinter)
        p.http = FakeHTTP(roots)
        return p

    def test_only_videos_newest_first_from_the_video_roots(self):
        p = self.printer(["config", "gcodes", "camera"])
        out = p.printer_videos()
        self.assertEqual(out["roots"], ["camera"])
        self.assertEqual([v["path"] for v in out["videos"]], ["benchy_20261110T101500Z.mp4", "older.mp4"])
        self.assertEqual(self.printer(["config", "gcodes"]).printer_videos(), {"videos": [], "roots": []})

    def test_a_video_is_fetched_only_from_a_video_root(self):
        p = self.printer(["camera"])
        self.assertTrue(p.fetch_video("camera", "older.mp4", 10 ** 6).startswith(b"\x00\x00"))
        for root, path in (("config", "printer.cfg"), ("camera", "../secrets.mp4"), ("camera", "notes.txt")):
            with self.assertRaises(ValueError):
                p.fetch_video(root, path, 10 ** 6)


class KeptCopies(unittest.TestCase):
    def setUp(self):
        timelapse.reset()
        self.addCleanup(timelapse.reset)

    def test_keep_list_play_and_remove(self):
        out = timelapse.keep_printer_video("u1-real", "camera", "sub/benchy run.mp4", b"video bytes")
        self.assertEqual(out["saved"], "benchy run.mp4")
        self.assertEqual([v["name"] for v in timelapse.saved_videos("u1-real")], ["benchy run.mp4"])
        self.assertEqual(timelapse.saved_video("u1-real", "benchy run.mp4"), (b"video bytes", "video/mp4"))
        self.assertEqual(timelapse.remove_saved_video("u1-real", "benchy run.mp4")["videos"], [])
        for bad in ("../x.mp4", "x.exe"):
            with self.assertRaises(ValueError):
                timelapse.saved_video("u1-real", bad)

    def test_the_kept_copies_survive_old_flipbooks_being_pruned(self):
        timelapse.keep_printer_video("u1-real", "camera", "keep.mp4", b"v")
        with patch.object(timelapse, "KEEP_SESSIONS", 1):
            for i in range(3):
                timelapse.begin("u1-real", f"print{i}.gcode", "camera")
                timelapse.finish("u1-real")
                timelapse._prune("u1-real")
        self.assertEqual(len(timelapse.sessions("u1-real")), 1)
        self.assertEqual([v["name"] for v in timelapse.saved_videos("u1-real")], ["keep.mp4"])


if __name__ == "__main__":
    unittest.main()
