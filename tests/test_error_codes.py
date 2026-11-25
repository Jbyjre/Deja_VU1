"""
The U1's error codes: Snapmaker's reference table (backend/reference/u1_error_codes.json), the reader of codes
(error_codes.py), the safe parser for the wiki's pages (wiki_page.py), the one shape for a printer's problems
(printer_problems.py), and the whole path from a stand-in printer that raises problems the way the U1's firmware
does (fake_moonraker.py) to the state the dashboard shows.
"""

import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import error_codes   # noqa: E402
import moonraker_client_part2 as part2   # noqa: E402
import printer_problems   # noqa: E402
import wiki_page   # noqa: E402
from test_moonraker_client import WireTest, wait_for   # noqa: E402

TABLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "reference",
                     "u1_error_codes.json")


def runs_text(block):
    return wiki_page.plain(block["r"])


class TestTheReferenceTable(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(TABLE, encoding="utf-8") as handle:
            cls.data = json.load(handle)

    def test_it_says_where_it_came_from_and_when(self):
        source = self.data["source"]
        self.assertEqual(source["url"], "https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting/u1_error_codes")
        self.assertRegex(source["retrieved"], r"^\d{4}-\d{2}-\d{2}$")

    def test_every_code_is_well_formed_and_agrees_with_the_levels_and_modules(self):
        self.assertGreaterEqual(len(self.data["codes"]), 400)
        for code, entry in self.data["codes"].items():
            self.assertRegex(code, r"^\d{4}-\d{4}-\d{4}-\d{4}$")
            self.assertIn(str(int(code[:4])), self.data["levels"], code)
            self.assertIn(code[5:9], self.data["modules"], code)
            self.assertTrue(entry["title"].strip() and entry["details"].strip(), code)

    def test_every_guide_and_video_a_code_points_to_is_in_the_table(self):
        for code, entry in self.data["codes"].items():
            if entry.get("article"):
                self.assertIn(entry["article"], self.data["articles"], code)
            if entry.get("video"):
                self.assertIn(entry["video"], self.data["videos"], code)
            if entry.get("match"):
                self.assertEqual(entry["match"], "title")

    def test_guide_slugs_are_plain_paths_and_videos_are_real_ids(self):
        for slug in self.data["articles"]:
            self.assertRegex(slug, r"^[A-Za-z0-9_./&-]+$")
            self.assertNotIn("..", slug)
            self.assertFalse(slug.startswith("/"))
        for vid in self.data["videos"]:
            self.assertRegex(vid, r"^[A-Za-z0-9_-]{11}$")

    def test_the_severity_levels_say_what_happens_to_the_print(self):
        self.assertEqual(error_codes._effect(1), "continues")
        self.assertEqual(error_codes._effect(2), "paused")
        self.assertEqual(error_codes._effect(3), "stopped")

    def test_the_wiki_words_are_kept_exactly(self):
        entry = self.data["codes"]["0002-0523-0000-0000"]
        self.assertEqual(entry["title"], "Filament Anomaly")
        self.assertTrue(entry["details"].startswith("Filament runout detected in Toolhead 1."))
        self.assertEqual(self.data["codes"]["0003-0526-0000-0000"]["title"], "Heated Bed Temperature Exceeded")


class TestReadingCodes(unittest.TestCase):
    def test_parse_and_find(self):
        self.assertEqual(error_codes.parse("0002-0523-0000-0000")["module"], "0523")
        self.assertIsNone(error_codes.parse("2-523-0-0"))
        self.assertIsNone(error_codes.parse(None))
        text = '!! {"coded": "0003-0523-0000-0006", "msg": "x"} then 0002-0523-0000-0000, 0002-0523-0000-0000 again'
        self.assertEqual(error_codes.find_codes(text), ["0003-0523-0000-0006", "0002-0523-0000-0000"])
        self.assertEqual(error_codes.find_codes("12340002-0523-0000-0000"), [])      # part of a longer number
        self.assertEqual(error_codes.find_codes(None), [])

    def test_the_printers_numbers_make_the_code_on_its_screen(self):
        self.assertEqual(error_codes.code_from_numbers(2, 523, 0, 0), "0002-0523-0000-0000")
        self.assertEqual(error_codes.code_from_numbers("3", "522", "2", "6"), "0003-0522-0002-0006")
        for bad in ((2, 523, "x", 0), (2, 12345, 0, 0), (-1, 523, 0, 0), (None, 1, 1, 1)):
            self.assertIsNone(error_codes.code_from_numbers(*bad))

    def test_a_listed_code_is_explained_in_the_wikis_words_with_its_guide(self):
        got = error_codes.describe("0002-0523-0003-0038", "tangled")
        self.assertTrue(got["known"])
        self.assertEqual((got["level_name"], got["effect"], got["module_name"]), ("Warning", "paused", "Toolhead"))
        self.assertEqual(got["title"], "Printing Anomaly")
        self.assertIn("tangled on the spool", got["details"])
        self.assertEqual(got["guide"]["slug"], "troubleshooting/printing_anomaly")
        self.assertTrue(got["guide"]["url"].startswith("https://wiki.snapmaker.com/en/snapmaker_u1/"))
        self.assertEqual(got["message"], "tangled")
        self.assertIn("retrieved", got["source"])

    def test_a_listed_code_can_carry_a_video_the_table_points_to(self):
        got = error_codes.describe("0002-0523-0001-0021")
        self.assertEqual(got["video"]["id"], "M00cjpjvqvE")
        self.assertTrue(got["video"]["title"])

    def test_a_code_the_table_does_not_list_is_said_so_not_made_up(self):
        got = error_codes.describe("0003-0999-0000-0001")
        self.assertFalse(got["known"])
        self.assertIsNone(got["title"])
        self.assertIsNone(got["details"])
        self.assertEqual(got["level_name"], "Error")
        self.assertEqual(got["effect"], "stopped")
        self.assertIsNone(got["module_name"])
        self.assertIsNone(error_codes.describe("not a code"))

    def test_a_code_only_a_guide_names_still_finds_that_guide(self):
        covered = {c for a in error_codes._table()["articles"].values() for c in a["codes"]}
        unlisted = sorted(c for c in covered if c not in error_codes._table()["codes"])
        for code in unlisted:
            got = error_codes.describe(code)
            self.assertFalse(got["known"])
            self.assertIsNotNone(got["guide"], code)

    def test_only_guides_in_the_table_are_ever_asked_for(self):
        self.assertTrue(error_codes.valid_slug("troubleshooting/printing_anomaly"))
        for bad in ("../../etc/passwd", "troubleshooting/nothing_here", "", None, 5):
            self.assertFalse(error_codes.valid_slug(bad))

    def test_search_by_code_part_of_a_code_or_words(self):
        whole = error_codes.search("0003-0523-0000-0006")
        self.assertEqual([r["code"] for r in whole["results"]], ["0003-0523-0000-0006"])
        part = error_codes.search("0523-0001", limit=5)
        self.assertEqual(len(part["results"]), 5)
        self.assertGreater(part["total"], 5)
        self.assertTrue(all("0523-0001" in r["code"] for r in part["results"]))
        words = error_codes.search("filament runout")
        self.assertTrue(words["results"])
        self.assertTrue(all("runout" in (r["title"] + r["details"]).lower() for r in words["results"]))
        self.assertEqual(error_codes.search("  ")["results"], [])
        self.assertEqual(error_codes.search("zzzzqqqq")["total"], 0)

    def test_a_missing_table_gives_an_empty_answer_not_an_error(self):
        original = error_codes._FILE
        try:
            error_codes._FILE = os.path.join(os.path.dirname(original), "nothing.json")
            error_codes.reload()
            got = error_codes.describe("0002-0523-0000-0000")
            self.assertFalse(got["known"])
            self.assertEqual(error_codes.search("filament")["total"], 0)
        finally:
            error_codes._FILE = original
            error_codes.reload()


PAGE = """<html><head><title>U1 test guide 0002-0523-0000-0000 | Snapmaker Wiki</title></head><body>
<nav>menu words that are not part of the guide</nav>
<template slot="contents"><div>
<h1 id="proc" class="toc-header"><a class="toc-anchor" href="#proc">&para;</a> Procedure</h1>
<p>Turn it <strong>off</strong> and watch <a href="https://www.youtube.com/watch?v=GgDL4Bqjk_Y&amp;t=65">U1 Video Guide: Side Panels 1:05&mdash;2:00</a>.<br>
<img src="/u1/a.jpg" alt="a picture"><video src="/u1/a.mp4"></video></p>
<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>
<blockquote class="is-warning"><p>Careful now</p></blockquote>
<p><a href="javascript:alert(1)">bad link</a> <img src="https://evil.example/x.png"> <img src="//evil.example/y.png">
<script>alert('script text')</script><iframe src="https://evil.example"><p>frame words</p></iframe></p>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<p>Code 0003-0523-0000-0006 is covered elsewhere.</p>
</div></template><p>after the guide</p></body></html>"""


class TestTheWikiPageReader(unittest.TestCase):
    def setUp(self):
        self.page = wiki_page.parse(PAGE)
        self.blocks = self.page["blocks"]

    def test_title_and_codes(self):
        self.assertEqual(self.page["title"], "U1 test guide 0002-0523-0000-0000")
        self.assertEqual(self.page["codes"], ["0002-0523-0000-0000"])
        self.assertIn("0003-0523-0000-0006", self.page["mentions"])

    def test_only_the_guide_is_read_not_the_menus_around_it(self):
        everything = json.dumps(self.page)
        for left_out in ("menu words", "after the guide", "script text", "frame words", "alert"):
            self.assertNotIn(left_out, everything)

    def test_headings_text_lists_notes_and_tables(self):
        kinds = [b["t"] for b in self.blocks]
        self.assertEqual(kinds[0], "h")
        self.assertEqual(self.blocks[0]["x"], "Procedure")
        listing = next(b for b in self.blocks if b["t"] == "list")
        self.assertEqual([(i["d"], wiki_page.plain(i["r"])) for i in listing["i"]],
                         [(0, "one"), (1, "nested"), (0, "two")])
        note = next(b for b in self.blocks if b["t"] == "note")
        self.assertEqual((note["k"], wiki_page.plain(note["p"][0])), ("warning", "Careful now"))
        table = next(b for b in self.blocks if b["t"] == "table")
        self.assertEqual([[wiki_page.plain(c) for c in row] for row in table["rows"]], [["A", "B"], ["1", "2"]])

    def test_bold_and_a_video_link_with_its_start_time(self):
        para = next(b for b in self.blocks if b["t"] == "p" and "Turn it" in runs_text(b))
        self.assertTrue(any(r.get("b") and r["x"] == "off" for r in para["r"]))
        link = next(r for r in para["r"] if r.get("yt"))
        self.assertEqual((link["yt"], link["start"]), ("GgDL4Bqjk_Y", 65))
        self.assertEqual(self.page["videos"], [{"id": "GgDL4Bqjk_Y", "title": "U1 Video Guide: Side Panels", "start": 65}])

    def test_pictures_and_clips_only_from_the_wikis_own_host(self):
        media = [(b["t"], b["src"]) for b in self.blocks if b["t"] in ("img", "video")]
        self.assertEqual(media, [("img", "https://wiki.snapmaker.com/u1/a.jpg"),
                                 ("video", "https://wiki.snapmaker.com/u1/a.mp4")])

    def test_a_link_that_is_not_https_is_dropped_but_its_words_stay(self):
        para = next(b for b in self.blocks if b["t"] == "p" and "bad link" in runs_text(b))
        run = next(r for r in para["r"] if "bad link" in r["x"])
        self.assertNotIn("u", run)

    def test_addresses(self):
        self.assertEqual(wiki_page.youtube_in("https://youtu.be/agm4H0GITqE?t=615"), ("agm4H0GITqE", 615))
        self.assertEqual(wiki_page.youtube_in("https://www.youtube.com/watch?v=agm4H0GITqE&t=1m5s"), ("agm4H0GITqE", 65))
        self.assertEqual(wiki_page.youtube_in("https://www.youtube.com/embed/agm4H0GITqE?start=30"), ("agm4H0GITqE", 30))
        self.assertEqual(wiki_page.youtube_in("https://www.youtube.com/watch?v=agm4H0GITqE"), ("agm4H0GITqE", 0))
        for no in ("https://example.com/watch?v=agm4H0GITqE", "https://www.youtube.com/watch?v=short", "", None):
            self.assertIsNone(wiki_page.youtube_in(no))
        self.assertIsNone(wiki_page.safe_link("http://example.com"))
        self.assertIsNone(wiki_page.safe_link("javascript:alert(1)"))
        self.assertIsNone(wiki_page.safe_link("https://user:pw@example.com/"))
        self.assertEqual(wiki_page.safe_link("/en/snapmaker_u1/x"), "https://wiki.snapmaker.com/en/snapmaker_u1/x")
        self.assertIsNone(wiki_page.media_source("https://wiki.snapmaker.com.evil.example/a.jpg", "image"))
        self.assertIsNone(wiki_page.media_source("/u1/a.exe", "image"))
        self.assertIsNone(wiki_page.media_source("/u1/a.jpg", "video"))

    def test_odd_input_never_raises_and_the_size_is_capped(self):
        for odd in (None, "", "<<<<>>>", "<template slot='contents'><p>unclosed", "<template slot='contents'></p></li></ul>"):
            self.assertIsInstance(wiki_page.parse(odd)["blocks"], list)
        many = "<template slot='contents'>" + "<p>x</p>" * (wiki_page.MAX_BLOCKS + 50) + "</template>"
        self.assertEqual(len(wiki_page.parse(many)["blocks"]), wiki_page.MAX_BLOCKS)
        long = wiki_page.parse("<template slot='contents'><p>" + "y" * 20000 + "</p></template>")
        self.assertLessEqual(len(runs_text(long["blocks"][0])), wiki_page.MAX_TEXT)


FIRMWARE_PAUSE = {"id": 523, "index": 0, "code": 0, "level": 2, "message": "Filament runout detected"}


class TestOneShapeForProblems(unittest.TestCase):
    def test_the_prints_own_exception_counts_only_while_paused_or_stopped(self):
        for state, expected in (("paused", 1), ("error", 1), ("printing", 0), ("ready", 0), ("complete", 0)):
            got = printer_problems.collect(state, FIRMWARE_PAUSE)
            self.assertEqual(len(got), expected, state)
        self.assertEqual(printer_problems.collect("paused", FIRMWARE_PAUSE)[0]["code"], "0002-0523-0000-0000")

    def test_problems_that_stay_show_in_any_state_worst_first_after_the_prints_own(self):
        standing = [{"id": 522, "index": 2, "code": 6, "level": 3, "message": "MCU"},
                    {"id": 531, "index": 0, "code": 1, "level": 1, "message": "note"}]
        got = printer_problems.collect("printing", FIRMWARE_PAUSE, standing)
        self.assertEqual([p["level"] for p in got], [3, 1])
        got = printer_problems.collect("paused", FIRMWARE_PAUSE, standing)
        self.assertEqual([p["source"] for p in got], ["print", "standing", "standing"])

    def test_a_code_written_in_a_message_counts_only_while_stopped_and_only_once(self):
        text = '{"coded": "0003-0523-0000-0006", "msg": "x"} 0003-0523-0000-0006'
        self.assertEqual([p["code"] for p in printer_problems.collect("error", None, None, None, [text])],
                         ["0003-0523-0000-0006"])
        self.assertEqual(printer_problems.collect("printing", None, None, None, [text]), [])

    def test_a_notification_supplies_the_time_it_was_raised(self):
        note = dict(FIRMWARE_PAUSE, timestamp=1_780_000_000.0)
        got = printer_problems.collect("paused", FIRMWARE_PAUSE, None, [note])
        self.assertRegex(got[0]["raised_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

    def test_junk_reports_are_ignored(self):
        junk = [None, {}, {"id": "x"}, {"id": 1, "index": 2, "code": 3, "level": 99999}, "text", 5]
        self.assertEqual(printer_problems.collect("paused", junk[1], junk), [])
        self.assertEqual(printer_problems.collect("paused", "text", [5]), [])

    def test_public_adds_the_wikis_words_and_never_raises(self):
        shown = printer_problems.public(printer_problems.collect("paused", FIRMWARE_PAUSE)[0])
        self.assertEqual((shown["title"], shown["effect"], shown["origin"]), ("Filament Anomaly", "paused", "print"))
        self.assertNotIn("source", shown)
        self.assertEqual(printer_problems.words(shown), "Filament Anomaly (0002-0523-0000-0000)")
        unlisted = printer_problems.public({"code": "0003-0999-0000-0001", "level": 3, "source": "print"})
        self.assertEqual(printer_problems.words(unlisted), "Printer error 0003-0999-0000-0001")

    def test_the_state_the_dashboard_gets(self):
        ctx = {"printer_id": "p", "name": "P", "extruders": {"T0": "extruder"}, "chamber": None, "job": {}, "extras": {},
               "klippy_state": None, "klippy_message": None, "machine": None}

        def state(ps, extra=None):
            status = {"webhooks": {"state": "ready"}, "print_stats": dict({"filename": "a.gcode"}, **ps)}
            status.update(extra or {})
            return part2.translate_state(status, ctx)

        paused = state({"state": "paused", "message": "", "exception": FIRMWARE_PAUSE})
        self.assertEqual(paused["state_message"], "Paused: Filament Anomaly (0002-0523-0000-0000)")
        self.assertEqual(paused["problem"]["code"], "0002-0523-0000-0000")
        plain = state({"state": "paused", "message": "", "exception": {}})
        self.assertEqual(plain["state_message"], "Paused")
        self.assertNotIn("problem", plain)
        said = state({"state": "paused", "message": "Toolhead lost", "exception": {}})
        self.assertEqual(said["state_message"], "Paused: Toolhead lost")
        stopped = state({"state": "error", "message": "", "exception": dict(FIRMWARE_PAUSE, level=3, code=6)})
        self.assertEqual(stopped["state_message"], "Nozzle Temperature Anomaly (0003-0523-0000-0006)")
        stale = state({"state": "printing", "exception": FIRMWARE_PAUSE})
        self.assertNotIn("problem", stale)
        standing = state({"state": "printing"}, {"exception_manager": {"exceptions": [
            {"id": 522, "index": 2, "code": 6, "level": 3, "message": "MCU"}]}})
        self.assertEqual(standing["state_message"], "Printing a.gcode")
        self.assertEqual(standing["problem"]["code"], "0003-0522-0002-0006")


class TestFromAStandInPrinter(WireTest):
    def stateful(self, check):
        return wait_for(lambda: check(self.printer.snapshot()))

    def test_a_pause_the_printer_raises_arrives_with_its_code_and_clears_on_resume(self):
        self.wait_connected()
        self.fake.begin_print("a.gcode")
        self.assertTrue(self.stateful(lambda s: s["state"] == "printing"))
        self.fake.raise_exception(2, 523, 0, 0, "Filament runout detected in Toolhead 1")
        # The printer sets the paused state first and sends the notification that carries the time just after, so
        # the time can be a tick behind the problem itself.
        self.assertTrue(self.stateful(lambda s: s["state"] == "paused" and (s.get("problem") or {}).get("raised_at")))
        state = self.printer.snapshot()
        self.assertEqual(state["problem"]["code"], "0002-0523-0000-0000")
        self.assertEqual(state["problem"]["effect"], "paused")
        self.assertRegex(state["problem"]["raised_at"], r"^\d{4}-")
        self.assertEqual(state["state_message"], "Paused: Filament Anomaly (0002-0523-0000-0000)")
        kept = [m for m in self.printer.messages if m["kind"] == "problem"]
        self.assertEqual((kept[-1]["code"], kept[-1]["level"]), ("0002-0523-0000-0000", 2))
        self.fake.set("print_stats", state="printing", exception={})
        self.assertTrue(self.stateful(lambda s: s["state"] == "printing" and "problem" not in s))

    def test_a_print_the_printer_stops_shows_the_code_too(self):
        self.wait_connected()
        self.fake.begin_print("a.gcode")
        self.assertTrue(self.stateful(lambda s: s["state"] == "printing"))
        self.fake.raise_exception(3, 523, 0, 6, "The G-code file may have set a toolhead unrecognized by printer")
        self.assertTrue(self.stateful(lambda s: s["state"] == "error" and s.get("problem")))
        self.assertEqual(self.printer.snapshot()["problem"]["code"], "0003-0523-0000-0006")

    def test_a_problem_that_stays_is_listed_until_the_printer_clears_it(self):
        self.wait_connected()
        self.fake.raise_exception(3, 522, 2, 6, "Toolhead 3 MCU connection failed", oneshot=False)
        self.assertTrue(self.stateful(lambda s: s.get("problem")))
        self.assertEqual(self.printer.snapshot()["problem"]["code"], "0003-0522-0002-0006")
        self.fake.clear_exception(522, 2, 6)
        self.assertTrue(self.stateful(lambda s: not s.get("problem")))

    def test_an_error_reply_carrying_a_code_is_kept_and_a_plain_reply_is_not(self):
        self.wait_connected()
        self.fake.notify("notify_gcode_response", ["ok T:21.0 /0.0"])
        self.fake.notify("notify_gcode_response", ['!! {"coded": "0003-0529-0000-0000", "msg": "missing parameter"}'])
        self.assertTrue(wait_for(lambda: any(m.get("code") for m in self.printer.messages)))
        kept = list(self.printer.messages)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["code"], "0003-0529-0000-0000")
        self.assertIn("missing parameter", kept[0]["detail"])


class TestStandingProblemsAcrossAConnection(WireTest):
    def test_a_problem_only_moonrakers_own_list_holds_is_found_on_connect(self):
        self.printer.stop()
        self.fake.system_exceptions = [{"id": 522, "index": 2, "code": 6, "level": 3, "message": "Toolhead 3 MCU connection failed",
                                        "timestamp": 1_780_000_000.0}]
        again = self.connect()
        self.wait_connected(again)
        self.assertTrue(wait_for(lambda: again.snapshot().get("problem")))
        self.assertEqual(again.snapshot()["problem"]["code"], "0003-0522-0002-0006")

    def test_a_problem_cleared_while_the_link_was_down_is_not_remembered(self):
        self.wait_connected()
        self.fake.raise_exception(3, 522, 2, 6, "Toolhead 3 MCU connection failed", oneshot=False)
        self.assertTrue(wait_for(lambda: self.printer.snapshot().get("problem")))
        with self.fake.lock:
            self.fake.status["exception_manager"]["exceptions"] = []            # cleared with nobody listening
        self.fake.drop_websockets()
        self.assertTrue(wait_for(lambda: not self.printer.snapshot().get("problem"), 8.0))

    def test_watch_only_mode_allows_that_read(self):
        import watch_only
        self.assertIn("server.exception.query", watch_only.READ_CALLS)


class TestAnotherKindOfPrinter(WireTest):
    fake_kwargs = {"u1": False}

    def test_a_klipper_without_the_u1_fields_works_as_before(self):
        self.wait_connected()
        self.fake.begin_print("a.gcode")
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "printing"))
        self.fake.set("print_stats", state="paused")
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "paused"))
        state = self.printer.snapshot()
        self.assertEqual(state["state_message"], "Paused")
        self.assertNotIn("problem", state)


if __name__ == "__main__":
    unittest.main()
