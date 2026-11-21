"""
Snapmaker's guides read from the wiki (backend/error_guides.py) and the routes that serve the error codes. The wiki is
a canned stand-in here (a page written for these tests); no test asks the internet.
"""

import io
import json
import os
import sys
import time
import unittest
import zipfile
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))
sys.path.insert(0, HERE)

import error_codes   # noqa: E402
import error_guides   # noqa: E402
import live_feed   # noqa: E402
import logbook   # noqa: E402
import mock_moonraker   # noqa: E402
import modules   # noqa: E402
import tester   # noqa: E402
import tester_report   # noqa: E402
from test_real_printer import RealPrinterAPI, wait_for   # noqa: E402

SLUG = "troubleshooting/printing_anomaly"
PAGE = ("<html><head><title>U1 Tangled Filament Detected | Snapmaker Wiki</title></head><body><template slot=\"contents\"><div>"
        "<h1 id=\"a\">Procedure</h1><p>Open the lid. See <a href=\"https://youtu.be/agm4H0GITqE?t=615\">U1 Video Guide: "
        "Auto Loading 10:15&mdash;11:11</a>.</p><img src=\"/u1/x.jpg\"></div></template></body></html>")


class FakeReply:
    def __init__(self, body, url):
        self._body, self._url = body, url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n=-1):
        return self._body if n < 0 else self._body[:n]

    def geturl(self):
        return self._url


class FakeWiki:
    """Stands in for the opener: serves PAGE, or whatever `behave` says, and counts the asks."""

    def __init__(self):
        self.asked = []
        self.behave = None

    def open(self, request, timeout=None):
        self.asked.append(request.full_url)
        if self.behave:
            return self.behave(request)
        return FakeReply(PAGE.encode(), request.full_url)


class GuideCase(unittest.TestCase):
    def setUp(self):
        error_guides.reset()
        self.wiki = FakeWiki()
        self.original = error_guides._opener
        error_guides._opener = self.wiki
        self.addCleanup(setattr, error_guides, "_opener", self.original)
        self.addCleanup(error_guides.reset)


class TestReadingAGuide(GuideCase):
    def test_a_guide_is_read_parsed_and_kept(self):
        got = error_guides.get(SLUG)
        self.assertTrue(got["ok"])
        self.assertEqual(got["from"], "wiki")
        guide = got["guide"]
        self.assertEqual(guide["title"], "U1 Tangled Filament Detected")
        self.assertEqual(guide["url"], "https://wiki.snapmaker.com/en/snapmaker_u1/" + SLUG)
        self.assertEqual(guide["videos"][0]["id"], "agm4H0GITqE")
        self.assertEqual(guide["videos"][0]["start"], 615)
        self.assertEqual(guide["videos"][0]["title"], "U1 Video Guide: Auto Loading")
        self.assertRegex(guide["fetched"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertEqual(self.wiki.asked, [guide["url"]])
        again = error_guides.get(SLUG)
        self.assertEqual(again["from"], "saved")
        self.assertEqual(len(self.wiki.asked), 1)                       # the second look asked nobody
        self.assertIsNotNone(error_guides.saved(SLUG))

    def test_refresh_asks_again(self):
        error_guides.get(SLUG)
        self.assertEqual(error_guides.get(SLUG, refresh=True)["from"], "wiki")
        self.assertEqual(len(self.wiki.asked), 2)

    def test_an_old_copy_is_read_again_and_still_shown_when_the_wiki_cannot_be_reached(self):
        error_guides.get(SLUG)
        saved = error_guides._read(SLUG)
        saved["fetched"] = "2020-01-01T00:00:00"
        error_guides.storage.save_json(error_guides._file(SLUG), saved)
        self.wiki.behave = lambda request: (_ for _ in ()).throw(urllib.error.URLError(OSError("offline")))
        got = error_guides.get(SLUG)
        self.assertTrue(got["ok"])
        self.assertTrue(got["stale"])
        self.assertTrue(got["note"])
        self.assertEqual(got["from"], "saved")

    def test_only_guides_in_the_table_are_asked_for(self):
        for bad in ("../../etc/passwd", "troubleshooting/not_a_guide", "", None):
            got = error_guides.get(bad)
            self.assertFalse(got["ok"])
        self.assertEqual(self.wiki.asked, [])

    def test_failures_come_back_in_words_with_the_wikis_address(self):
        def fail(code):
            def behave(request):
                raise urllib.error.HTTPError(request.full_url, code, "x", {}, io.BytesIO(b""))
            return behave
        for code, words in ((404, "no page at this address"), (403, "not showing this guide"), (429, "fewer requests")):
            error_guides.reset()
            self.wiki.behave = fail(code)
            got = error_guides.get(SLUG)
            self.assertFalse(got["ok"])
            self.assertIn(words, got["error"])
            self.assertEqual(got["url"], "https://wiki.snapmaker.com/en/snapmaker_u1/" + SLUG)

    def test_a_failed_try_is_not_repeated_straight_away(self):
        self.wiki.behave = lambda request: (_ for _ in ()).throw(urllib.error.URLError(OSError("offline")))
        error_guides.get(SLUG)
        error_guides.get(SLUG)
        self.assertEqual(len(self.wiki.asked), 1)
        error_guides._failed_at.clear()
        error_guides.get(SLUG)
        self.assertEqual(len(self.wiki.asked), 2)

    def test_a_reply_that_is_not_a_guide_is_refused(self):
        cases = ((lambda r: FakeReply(b"x" * (error_guides.MAX_BYTES + 5), r.full_url), "far larger"),
                 (lambda r: FakeReply(PAGE.encode(), "https://evil.example/u1"), "somewhere else"),
                 (lambda r: FakeReply(b"<html><body>no guide</body></html>", r.full_url), "no guide text"))
        for behave, words in cases:
            error_guides.reset()
            self.wiki.behave = behave
            got = error_guides.get(SLUG)
            self.assertFalse(got["ok"])
            self.assertIn(words, got["error"])

    def test_a_redirect_is_followed_only_within_the_wiki(self):
        handler = error_guides._SameHost()
        request = urllib.request.Request("https://wiki.snapmaker.com/i/923")
        self.assertIsNotNone(handler.redirect_request(request, io.BytesIO(b""), 302, "Found", {}, "https://wiki.snapmaker.com/en/x"))
        for away in ("https://evil.example/x", "http://wiki.snapmaker.com/x", "https://wiki.snapmaker.com.evil.example/x"):
            self.assertIsNone(handler.redirect_request(request, io.BytesIO(b""), 302, "Found", {}, away))

    def test_explain_says_whether_the_guide_is_kept(self):
        before = error_guides.explain("0002-0523-0003-0038")
        self.assertEqual(before["guide"]["slug"], SLUG)
        self.assertFalse(before["guide_saved"])
        error_guides.get(SLUG)
        self.assertTrue(error_guides.explain("0002-0523-0003-0038")["guide_saved"])
        with self.assertRaises(ValueError):
            error_guides.explain("nonsense")


class TestTheRoutes(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        error_guides.reset()
        logbook.reset()
        self.wiki = FakeWiki()
        self.original = error_guides._opener
        error_guides._opener = self.wiki
        self.addCleanup(setattr, error_guides, "_opener", self.original)
        self.addCleanup(error_guides.reset)
        self.addCleanup(logbook.reset)

    def test_reference_search_and_one_code(self):
        status, ref = self.request("/api/errors/reference")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(ref["counts"]["codes"], 400)
        self.assertEqual(ref["source"]["url"], "https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting/u1_error_codes")
        self.assertIn("0523", ref["modules"])
        status, found = self.request("/api/errors/search?q=0523-0000-0000")
        self.assertEqual(status, 200)
        self.assertTrue(found["results"])
        status, one = self.request("/api/errors/code?code=0002-0523-0000-0000")
        self.assertEqual((status, one["title"], one["effect"]), (200, "Filament Anomaly", "paused"))
        status, bad = self.request("/api/errors/code?code=hello")
        self.assertEqual(status, 400)
        self.assertIn("four groups of four digits", json.dumps(bad))

    def test_a_guide_and_a_guide_that_is_not_there(self):
        status, got = self.request("/api/errors/guide?slug=" + SLUG)
        self.assertEqual((status, got["ok"], got["guide"]["title"]), (200, True, "U1 Tangled Filament Detected"))
        status, none = self.request("/api/errors/guide?slug=troubleshooting/nothing")
        self.assertEqual((status, none["ok"]), (200, False))          # a calm answer, not a server error

    def test_the_switch_turns_every_route_off(self):
        modules.set_enabled("error_help", False)
        self.addCleanup(modules.reset_state)
        for path in ("/api/errors/reference", "/api/errors/search?q=a", "/api/errors/code?code=0002-0523-0000-0000",
                     "/api/errors/guide?slug=" + SLUG, "/api/printer/problems?printer=" + self.pid):
            self.assertEqual(self.request(path)[0], 403, path)

    def test_a_problem_raised_by_the_printer_reaches_the_screens_the_log_and_the_testers_report(self):
        modules.set_enabled("tester", True)
        tester.refresh()
        tester.delete_all()
        self.addCleanup(tester.delete_all)
        self.fake.begin_print("a.gcode")
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "printing"))
        self.fake.raise_exception(2, 523, 0, 0, "Filament runout detected in Toolhead 1")
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot().get("problem")))
        live_feed.refresh(self.pid)
        status, state = self.request("/api/printer?printer=" + self.pid)
        self.assertEqual((state["state"], state["problem"]["code"]), ("paused", "0002-0523-0000-0000"))
        self.assertEqual(state["state_message"], "Paused: Filament Anomaly (0002-0523-0000-0000)")
        status, view = self.request("/api/printer/problems?printer=" + self.pid)
        self.assertEqual(status, 200)
        self.assertEqual(view["now"][0]["code"], "0002-0523-0000-0000")
        self.assertEqual(view["incidents"][0]["incident"]["code"], "0002-0523-0000-0000")
        self.assertEqual(view["incidents"][0]["incident"]["file"], "a.gcode")
        self.assertEqual(view["messages"][0]["code"], "0002-0523-0000-0000")
        events = [e for e in tester_report.iter_events(tester.event_files()) if e["k"] == "printer" and e.get("ev") == "problem"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["code"], "0002-0523-0000-0000")
        self.assertNotIn("a.gcode", json.dumps(events))
        report = tester_report.build_report(tester.event_files(), now=time.time())
        self.assertEqual(report["printer"]["problems"][0]["code"], "0002-0523-0000-0000")
        self.assertTrue([f for f in report["findings"]["all"] if "0002-0523-0000-0000" in f["title"]]
                        if isinstance(report["findings"], dict) else
                        [f for f in report["findings"] if "0002-0523-0000-0000" in f["title"]])
        kept = zipfile.ZipFile(io.BytesIO(tester_report.build_zip()[1]))
        self.assertIn("0002-0523-0000-0000", kept.read("findings.md").decode("utf-8"))
        self.assertIn("0002-0523-0000-0000", kept.read("report.html").decode("utf-8"))
        self.fake.set("print_stats", state="printing", exception={})
        self.assertTrue(wait_for(lambda: not mock_moonraker.real_printer(self.pid).snapshot().get("problem")))
        live_feed.refresh(self.pid)
        status, view = self.request("/api/printer/problems?printer=" + self.pid)
        self.assertEqual(view["now"], [])
        self.assertTrue(view["incidents"][0]["incident"]["cleared_at"])

    def test_the_demo_shows_a_problem_too(self):
        live_feed.mark_demo_seen()
        status, view = self.request("/api/printer/problems?demo=1&printer=u1-studio")
        self.assertEqual(status, 200)
        self.assertEqual(view["now"][0]["code"], "0002-0523-0000-0038")
        self.assertEqual(view["messages"], [])


if __name__ == "__main__":
    unittest.main()
