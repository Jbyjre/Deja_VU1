"""
The online demo: the recording the public Cloudflare link plays when there's
no server (frontend/demo/, made by tools/online-demo/record.py).
"""

import json
import os
import runpy
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DEMO = os.path.join(ROOT, "frontend", "demo")
RECORDER = runpy.run_path(os.path.join(ROOT, "tools", "online-demo", "record.py"), run_name="recorder")


class TestRecording(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(DEMO, "recording.json"), encoding="utf-8") as f:
            cls.rec = json.load(f)

    def test_it_holds_every_get_route_the_server_has(self):
        # A new route means the recording is out of date: re-run the recorder.
        self.assertEqual(self.rec["routes"], RECORDER["get_routes"](),
                         "Routes changed: run python3 tools/online-demo/record.py")
        skip = RECORDER["TIMELINE"] | RECORDER["NOT_RECORDED"]
        recorded = {k.split("?")[0] for k in self.rec["get"]}
        for path in self.rec["routes"]:
            if path not in skip:
                self.assertIn(path, recorded)

    def test_only_simulated_printers(self):
        self.assertEqual(self.rec["printers"], ["u1-workshop", "u1-studio", "u1-garage"])
        for frame in self.rec["frames"]:
            self.assertTrue(all(p["demo"] for p in frame["fleet"]))
        for entry in self.rec["bodies"]:
            body = entry["body"]
            if isinstance(body, dict) and body.get("connected"):
                self.assertTrue(body.get("demo"), body)

    def test_the_live_feed_loops_and_the_jam_is_in_it(self):
        self.assertGreaterEqual(len(self.rec["frames"]), 60)
        self.assertTrue(any(e["event"].get("event") == "failed" for e in self.rec["events"]))
        for frame in self.rec["frames"]:
            self.assertEqual(set(frame["state"]), set(self.rec["printers"]))

    def test_every_answer_points_at_a_body_and_every_file_is_there(self):
        for key, i in self.rec["get"].items():
            self.assertLess(i, len(self.rec["bodies"]), key)
        for name in self.rec["files"]:
            self.assertTrue(os.path.isfile(os.path.join(DEMO, "files", name)), name)
        for entry in self.rec["bodies"]:
            body = entry["body"]
            if isinstance(body, dict) and "__file__" in body:
                self.assertTrue(os.path.isfile(os.path.join(DEMO, body["__file__"])), body)
        for name in self.rec["thumbs"]:
            self.assertTrue(os.path.isfile(os.path.join(DEMO, "thumbs", name + ".png")), name)

    def test_keys_ignore_what_doesnt_change_the_answer(self):
        key = RECORDER["key_for"]
        self.assertEqual(key("/api/x", {"demo": 1, "printer": "a", "since": 4, "b": 2}), "/api/x?b=2&printer=a")
        self.assertEqual(key("/api/x", {}), "/api/x")


if __name__ == "__main__":
    unittest.main()
