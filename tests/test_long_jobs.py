"""
Long jobs never hold up the rest of the app (the tester fix release, from a tester report).

A tester's report showed 14 different requests each waiting about 27 s at the same moments, while keeping a time-lapse took 28 s
to 187 s and playing a printer video took up to 219 s. The server answers other requests while a copy runs (checked below), so
the wait came from the page: a browser keeps at most six connections to one address, and each long request held one for its whole
length. These tests keep that from coming back:

  - pressing Keep a copy returns a job at once; the copy streams to disk and its progress can be read while it runs;
  - pressing it again on a video that is still copying is the same job, not a second copy that holds another connection;
  - a printer video starts playing before the printer has finished sending it, and a scrub is answered with a Range reply;
  - a copy that fails ends in words, and leaves no half-written file.

The printer is the Moonraker stand-in (tests/fake_moonraker.py), not a real U1.
"""

import os
import sys
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))
sys.path.insert(0, HERE)

import modules                   # noqa: E402
import timelapse                 # noqa: E402
from test_real_printer import RealPrinterAPI, wait_for   # noqa: E402

VIDEO = b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 4096          # about 1 MB


class TestLongJobs(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        timelapse.reset()
        self.addCleanup(timelapse.reset)
        self.addCleanup(self.clean_saved)
        modules.set_enabled("timelapse", True)
        self.fake.videos[("camera", "run.mp4")] = VIDEO

    def clean_saved(self):
        folder = timelapse._saved_dir(self.pid)
        for name in os.listdir(folder) if os.path.isdir(folder) else []:
            os.remove(os.path.join(folder, name))

    def keep(self, path="run.mp4", root="camera"):
        return self.request("/api/timelapse/keep", {"root": root, "path": path})

    def jobs(self):
        return self.request("/api/timelapse/jobs")[1]

    def test_keep_returns_at_once_and_the_copy_runs_in_the_background(self):
        self.fake.video_chunk_delay = 0.05           # 16 pieces of 64 KB: about 0.8 s
        started = time.time()
        status, body = self.keep()
        self.assertEqual(status, 202, body)
        self.assertLess(time.time() - started, 0.6, "the press must not wait for the copy")
        self.assertEqual(body["job"]["state"], "running")
        self.assertEqual(body["job"]["name"], "run.mp4")
        self.assertTrue(wait_for(lambda: self.jobs()["jobs"] and self.jobs()["jobs"][0]["state"] == "done", seconds=15))
        job = self.jobs()["jobs"][0]
        self.assertEqual(job["bytes"], len(VIDEO))
        self.assertEqual([v["name"] for v in self.jobs()["saved"]], ["run.mp4"])
        with open(os.path.join(timelapse._saved_dir(self.pid), "run.mp4"), "rb") as f:
            self.assertEqual(f.read(), VIDEO)

    def test_progress_can_be_read_while_it_copies_and_other_routes_answer_at_once(self):
        self.fake.video_chunk_delay = 0.2            # about 3 s in all
        self.keep()
        self.assertTrue(wait_for(lambda: self.jobs()["jobs"][0]["bytes"] > 0, seconds=10))
        job = self.jobs()["jobs"][0]
        self.assertEqual(job["state"], "running")
        self.assertEqual(job["total"], len(VIDEO))
        self.assertLess(job["bytes"], len(VIDEO))
        for route in ("/api/connection", "/api/leds", "/api/health", "/api/app/alive"):
            began = time.time()
            status, _ = self.request(route)
            self.assertEqual(status, 200, route)
            self.assertLess(time.time() - began, 1.0, "%s waited while a copy ran" % route)
        self.assertTrue(wait_for(lambda: self.jobs()["jobs"][0]["state"] == "done", seconds=15))

    def test_pressing_keep_again_while_it_copies_is_the_same_job(self):
        self.fake.video_chunk_delay = 0.1
        first = self.keep()[1]["job"]
        second = self.keep()[1]["job"]
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.jobs()["jobs"]), 1)
        self.assertTrue(wait_for(lambda: self.jobs()["jobs"][0]["state"] == "done", seconds=15))
        # Once it has finished, a new press starts a new copy.
        again = self.keep()[1]["job"]
        self.assertNotEqual(first["id"], again["id"])

    def test_a_copy_that_fails_ends_in_words_and_leaves_no_half_file(self):
        status, body = self.keep("missing.mp4")
        self.assertEqual(status, 202, body)
        self.assertTrue(wait_for(lambda: self.jobs()["jobs"][0]["state"] == "failed", seconds=10))
        job = self.jobs()["jobs"][0]
        self.assertIn("no /server/files/camera/missing.mp4", job["error"])
        self.assertEqual(self.jobs()["saved"], [])
        folder = timelapse._saved_dir(self.pid)
        self.assertEqual([n for n in os.listdir(folder) if n.endswith(".part")] if os.path.isdir(folder) else [], [])

    def test_a_wrong_press_is_refused_at_once(self):
        for root, path in (("config", "printer.cfg"), ("camera", "../x.mp4"), ("camera", "notes.txt")):
            status, body = self.keep(path, root)
            self.assertEqual(status, 400, (root, path, body))
        self.assertEqual(self.jobs()["jobs"], [])

    def test_a_copy_is_dropped_if_time_lapses_are_switched_off_while_it_runs(self):
        self.fake.video_chunk_delay = 0.1            # about 1.6 s in all
        self.keep()
        modules.set_enabled("timelapse", False)
        time.sleep(2.5)                              # the copy ends while the module is off
        modules.set_enabled("timelapse", True)
        job = self.jobs()["jobs"][0]
        self.assertEqual(job["state"], "failed")
        self.assertIn("switched off", job["error"])
        self.assertEqual(self.jobs()["saved"], [])

    def test_a_printer_video_starts_before_the_printer_has_finished_sending_it(self):
        self.fake.video_chunk_delay = 0.2            # about 3.2 s for the whole file
        began = time.time()
        req = Request(self.base + "/api/timelapse/printer-video?root=camera&path=run.mp4")
        with urlopen(req, timeout=20) as resp:
            first = resp.read(1024)
            first_byte_after = time.time() - began
            rest = resp.read()
            total_after = time.time() - began
        self.assertEqual(resp.status, 200)
        self.assertEqual(first + rest, VIDEO)
        self.assertLess(first_byte_after, 1.5, "playback must start before the whole file has crossed the printer's Wi-Fi")
        self.assertGreater(total_after, 2.5)

    def test_a_scrub_is_a_range_request_the_printer_answers(self):
        req = Request(self.base + "/api/timelapse/printer-video?root=camera&path=run.mp4", headers={"Range": "bytes=100-199"})
        try:
            with urlopen(req, timeout=20) as resp:
                status, body, got = resp.status, resp.read(), resp.headers
        except HTTPError as err:                      # pragma: no cover - the failure shows in the message
            self.fail("the printer video route answered %s" % err.code)
        self.assertEqual(status, 206)
        self.assertEqual(body, VIDEO[100:200])
        self.assertEqual(got["Content-Range"], "bytes 100-199/%d" % len(VIDEO))

    def test_a_kept_copy_is_sent_from_disk_with_range_support(self):
        self.keep()
        self.assertTrue(wait_for(lambda: self.jobs()["jobs"] and self.jobs()["jobs"][0]["state"] == "done", seconds=15))
        with urlopen(self.base + "/api/timelapse/video?name=run.mp4", timeout=10) as resp:
            self.assertEqual(resp.read(), VIDEO)
            self.assertEqual(resp.headers["Accept-Ranges"], "bytes")
        req = Request(self.base + "/api/timelapse/video?name=run.mp4", headers={"Range": "bytes=-16"})
        with urlopen(req, timeout=10) as resp:
            self.assertEqual(resp.status, 206)
            self.assertEqual(resp.read(), VIDEO[-16:])


if __name__ == "__main__":
    unittest.main()
