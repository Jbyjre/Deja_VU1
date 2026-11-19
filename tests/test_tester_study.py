"""
Tester mode, the 22 questions (backend/tester_study.py, backend/tester_questions.py) and the always-on build.

What these prove:
  - the tester build records from the first start, has no switch, no length to choose and no end date, and can still be kept
    out of a run by a developer;
  - the 22 questions are complete, in order, in the nine sections of the tester questions sheet and, when that sheet is next to
    this repository, in its exact words;
  - a tester's answers are kept, masked and removed with "Delete tester data"; answers saved by the 52-question build are set
    aside, never shown under the new numbers;
  - the routes behind them answer 403 when Tester mode is off for the run, refuse another site, and keep answers out of
    nothing but the saved report;
  - the saved zip holds the answers next to what the app recorded.
"""

import io
import json
import os
import sys
import threading
import time
import unittest
import zipfile
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import app as dv_app                 # noqa: E402
import modules                       # noqa: E402
import tester                        # noqa: E402
import tester_questions              # noqa: E402
import tester_report                 # noqa: E402
import tester_study                  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS = ["192.168.1.77", "sk-LIVEKEYabcdefghij123456", "/Users/jane.doe/", "GarageWifi5G"]


class AlwaysOnBase(unittest.TestCase):
    """The tester build as shipped: always on, nothing toggled by the test."""

    def setUp(self):
        self._always, self._env = modules.TESTER_ALWAYS_ON, os.environ.pop("DEJAVU_TESTER", None)
        modules.TESTER_ALWAYS_ON = True
        tester.refresh()
        tester.delete_all()

    def tearDown(self):
        tester.delete_all()
        modules.TESTER_ALWAYS_ON = self._always
        os.environ.pop("DEJAVU_TESTER", None)
        if self._env is not None:
            os.environ["DEJAVU_TESTER"] = self._env
        tester.refresh()


class TestAlwaysOn(AlwaysOnBase):
    def test_it_is_part_of_the_app_with_no_switch(self):
        module = next(m for m in modules.get_all() if m["id"] == "tester")
        self.assertEqual((module["kind"], module["enabled"]), ("core", True))
        self.assertTrue(modules.is_enabled("tester"))
        self.assertTrue(tester.enabled())

    def test_a_saved_off_does_not_turn_it_off(self):
        modules.TESTER_ALWAYS_ON = False
        modules.set_enabled("tester", False)                  # an older copy that had it off
        modules.TESTER_ALWAYS_ON = True
        self.assertTrue(modules.is_enabled("tester"))

    def test_the_server_refuses_to_switch_it_off(self):
        with self.assertRaises(ValueError) as caught:
            modules.set_enabled("tester", False)
        self.assertIn("always on", str(caught.exception))
        modules.set_enabled("tester", True)                   # asking for on is harmless

    def test_it_records_with_nothing_switched_on(self):
        self.assertTrue(tester.record("note", text="first words"))
        self.assertEqual(tester.ingest({"events": [{"k": "click", "ctl": "#a", "paint": 5}]})["accepted"], 1)
        self.assertEqual(sum(1 for _ in tester_report.iter_events(tester.event_files())), 2)

    def test_a_developer_can_keep_one_run_out_of_the_record(self):
        os.environ["DEJAVU_TESTER"] = "0"
        tester.refresh()
        self.assertFalse(modules.is_enabled("tester"))
        self.assertFalse(tester.record("note", text="never written"))
        self.assertEqual(tester.event_files(), [])
        self.assertEqual(tester.ingest({"events": [{"k": "click", "ctl": "#a"}]})["accepted"], 0)

    def test_the_flag_gives_back_an_optional_switch_that_starts_off(self):
        modules.TESTER_ALWAYS_ON = False
        modules.set_enabled("tester", False)
        module = next(m for m in modules.get_all() if m["id"] == "tester")
        self.assertEqual((module["kind"], module["enabled"]), ("setting", False))


class TestTheQuestions(unittest.TestCase):
    def test_there_are_22_in_order_in_nine_sections(self):
        numbers = [q["n"] for q in tester_questions.QUESTIONS]
        self.assertEqual(numbers, list(range(1, 23)))
        self.assertEqual(tester_questions.COUNT, 22)
        self.assertEqual([s["id"] for s in tester_questions.SECTIONS], list(range(1, 10)))
        self.assertEqual([q["id"] for q in tester_questions.QUESTIONS], ["q%d" % n for n in range(1, 23)])
        self.assertEqual([len(s["questions"]) for s in tester_questions.SECTIONS], [2, 2, 1, 3, 4, 2, 1, 2, 5])

    def test_only_the_phone_and_ai_questions_are_optional_and_they_have_a_one_press_didnt_try_it(self):
        self.assertEqual([q["n"] for q in tester_questions.QUESTIONS if q["optional"]], [16, 17])
        self.assertTrue(tester_questions.SECTIONS[7]["optional"])
        self.assertEqual(tester_questions.CHOICES, {"didnt_try": "Didn't try it"})
        sections = {s["id"]: s for s in tester_questions.public()}
        self.assertEqual([q["optional"] for q in sections[8]["questions"]], [True, True])

    def test_every_question_has_words_and_no_em_dash(self):
        for q in tester_questions.QUESTIONS:
            self.assertTrue(q["text"].strip(), q["id"])
            self.assertNotIn("\u2014", q["text"] + (q["help"] or ""))

    def test_the_words_are_the_questions_sheets_when_the_sheet_is_next_to_this_repository(self):
        sheet = os.path.join(os.path.dirname(HERE), "..", "Deja-VU1-Studio", "outreach", "tester-feedback-questions.md")
        if not os.path.isfile(sheet):
            self.skipTest("the private repository with the questions sheet is not here (CI)")
        import re
        names, questions, section = {}, {}, None
        for line in open(sheet, encoding="utf-8").read().split("---")[1].splitlines():
            heading = re.match(r"^#### (\d+)\. (.*?)(?: \(optional\))?$", line)
            number = re.match(r"^(\d+)\. (.+)$", line)
            if heading:
                section = int(heading.group(1))
                names[section] = heading.group(2)
            elif number and section:
                questions[int(number.group(1))] = number.group(2).strip()
        self.assertEqual(len(questions), 22)
        self.assertEqual({s["id"]: s["name"] for s in tester_questions.SECTIONS}, names)
        for q in tester_questions.QUESTIONS:
            self.assertEqual(q["text"], questions[q["n"]], q["id"])

    def test_the_free_answers_that_go_to_the_findings_list(self):
        flagged = [q["n"] for q in tester_questions.QUESTIONS if q["finding"]]
        self.assertEqual(flagged, [19, 20])
        for n in flagged:
            self.assertEqual(tester_questions.BY_ID["q%d" % n]["sev"], "medium")

    def test_the_browser_gets_only_what_it_needs(self):
        sections = tester_questions.public()
        self.assertEqual(len(sections), 9)
        for q in sections[0]["questions"]:
            self.assertEqual(sorted(q), ["auto", "help", "id", "n", "optional", "text"])
        self.assertNotIn("finding", json.dumps(sections))

    def test_every_saw_hint_points_at_a_real_feature_or_fact(self):
        features = {f[0] for f in tester_report.FEATURES}
        facts = {"connects", "slow", "gate", "confirmed", "prints", "slices"}
        for q in tester_questions.QUESTIONS:
            for token in q["saw"]:
                kind, _, name = token.partition(":")
                self.assertIn(kind, ("feature", "screen", "fact"), token)
                if kind == "feature":
                    self.assertIn(name, features, token)
                if kind == "fact":
                    self.assertIn(name, facts, token)

    def test_every_report_feature_points_at_a_real_section_or_none(self):
        sections = {s["id"]: s["name"] for s in tester_questions.SECTIONS}
        for fid, name, number, section_name, _rules in tester_report.FEATURES:
            if number is None:
                self.assertIsNone(section_name, fid)
            else:
                self.assertEqual(sections.get(number), section_name, fid)


class TestAnswersAndNoRound(AlwaysOnBase):
    def test_there_is_no_length_to_choose_and_no_end_date(self):
        progress = tester_study.describe()
        self.assertEqual((progress["answered"], progress["total"], progress["optional_unanswered"]), (0, 22, 2))
        for gone in ("length_days", "lengths", "ends", "ends_ms", "status", "day", "hours_left", "welcomed", "finished_at"):
            self.assertNotIn(gone, progress)
        for gone in ("set_length", "mark_welcomed", "finish", "LENGTHS", "DAY_MS"):
            self.assertFalse(hasattr(tester_study, gone), gone)
        self.assertTrue(os.path.exists(os.path.join(tester.folder(), "study.json")))

    def test_answers_are_kept_cleared_and_counted(self):
        progress = tester_study.save_answers({"q1": {"c": None, "t": "Windows 11"}, "q19": {"c": None, "t": "The twin lagged"},
                                              "q16": {"c": "didnt_try", "t": ""}})
        self.assertEqual((progress["answered"], progress["optional_unanswered"]), (3, 1))
        view = tester_study.answers_view()
        self.assertEqual(view["q16"]["c"], "didnt_try")
        self.assertEqual(view["q1"]["t"], "Windows 11")
        progress = tester_study.save_answers({"q1": {"c": None, "t": "   "}})          # nothing left: cleared
        self.assertEqual(progress["answered"], 2)
        self.assertNotIn("q1", tester_study.answers_view())

    def test_unknown_questions_and_choices_and_shapes_are_ignored(self):
        progress = tester_study.save_answers({"q999": {"c": "didnt_try", "t": "x"}, "q2": {"c": "yes", "t": ""}, "q3": "text", "nope": {},
                                              "q4": {"c": "no", "t": ""}, "q17": {"c": "didnt_try", "t": 5}})
        self.assertEqual(progress["answered"], 1)                                      # only q17's valid choice
        self.assertEqual(tester_study.answers_view()["q17"]["c"], "didnt_try")
        self.assertEqual(tester_study.answers_view()["q17"]["t"], "")
        with self.assertRaises(ValueError):
            tester_study.save_answers(["not", "a", "dict"])

    def test_a_call_holds_at_most_sixty_answers_and_each_is_capped(self):
        batch = {"q%d" % n: {"c": None, "t": "x" * 4000} for n in range(1, 23)}
        batch.update({"q%d" % n: {"c": None, "t": ""} for n in range(1, 10)})
        tester_study.save_answers(batch)
        for qid, a in tester_study.answers_view().items():
            self.assertLessEqual(len(a["t"]), tester_study.MAX_ANSWER, qid)

    def test_what_they_type_is_masked_before_it_is_kept(self):
        tester_study.save_answers({"q4": {"c": None, "t": "The printer is at 192.168.1.77 on GarageWifi5G, key sk-LIVEKEYabcdefghij123456, files in /Users/jane.doe/Documents"},
                                   "q19": {"c": None, "t": "Contact me at jane@example.org"}})
        on_disk = open(os.path.join(tester.folder(), "study.json"), encoding="utf-8").read()
        for secret in ("192.168.1.77", "sk-LIVEKEYabcdefghij123456", "jane.doe", "jane@example.org"):
            self.assertNotIn(secret, on_disk)
        self.assertIn("<ip>", on_disk)

    def test_an_export_is_noted_and_delete_removes_everything(self):
        tester_study.save_answers({"q1": {"c": None, "t": "x"}})
        tester_study.note_export(1234)
        progress = tester_study.describe()
        self.assertEqual((progress["exports"], progress["answered"]), (1, 1))
        first = progress["started_ms"]
        time.sleep(0.01)
        tester.delete_all()
        self.assertFalse(os.path.exists(os.path.join(tester.folder(), "study.json")))
        fresh = tester_study.describe()
        self.assertEqual((fresh["answered"], fresh["exports"]), (0, 0))
        self.assertGreaterEqual(fresh["started_ms"], first)

    def test_answers_saved_by_the_52_question_build_are_set_aside_never_shown_under_the_new_numbers(self):
        old = {"v": 1, "length_days": 2, "started": 1760000000000, "welcomed": True, "finished_at": None, "length_changes": 1,
               "exports": [{"at": 1760000500000, "bytes": 99}],
               "answers": {"q7": {"c": "yes", "t": "Find printers found it", "at": 1}, "q47": {"c": None, "t": "Slow", "at": 2}}}
        os.makedirs(tester.folder(), exist_ok=True)
        with open(os.path.join(tester.folder(), "study.json"), "w", encoding="utf-8") as fh:
            json.dump(old, fh)
        progress = tester_study.describe()
        self.assertEqual((progress["answered"], progress["started_ms"], progress["exports"]), (0, 1760000000000, 1))
        self.assertEqual(tester_study.answers_view(), {})
        self.assertEqual(tester_study.for_report()["answered"], 0)
        on_disk = json.load(open(os.path.join(tester.folder(), "study.json"), encoding="utf-8"))
        self.assertEqual((on_disk["v"], on_disk["answers"]), (2, {}))
        self.assertEqual(on_disk["earlier_answers"]["q7"]["t"], "Find printers found it")      # kept for the tester, not exported
        self.assertNotIn("length_days", on_disk)
        tester_study.save_answers({"q7": {"c": None, "t": "New q7"}})
        self.assertEqual(tester_study.answers_view()["q7"]["t"], "New q7")

    def test_the_view_has_every_question_in_order_with_its_answer(self):
        tester_study.save_answers({"q19": {"c": None, "t": "twin lagged"}, "q16": {"c": "didnt_try", "t": ""}})
        study = tester_study.for_report()
        self.assertEqual([a["n"] for a in study["answers"]], list(range(1, 23)))
        self.assertEqual((study["answered"], study["didnt_try"], study["with_words"]), (2, 1, 1))
        row = study["answers"][18]
        self.assertEqual((row["answer"], row["section_name"]), ("twin lagged", "Overall"))
        self.assertEqual(study["sections"][7]["didnt_try"], 1)
        self.assertEqual(len(study["sections"]), 9)
        self.assertNotIn("plan", study)

    def test_the_hints_say_what_the_app_saw_and_what_it_recorded(self):
        tester.ingest({"events": [{"k": "setup", "browser": "Chrome", "bver": "131", "ua_os": "Windows", "s": "abc123"},
                                  {"k": "click", "ctl": "#twin-view", "screen": "printer", "paint": 10, "s": "abc123"},
                                  {"k": "screen", "screen": "overview", "ms": 1000, "s": "abc123"}]})
        tester.record("printer", ev="connect", printer="printer 1")
        tester.record("feature", name="camera")
        hints = tester_study.hints(tester_report.build_report(server_setup=tester_report.setup_facts()))
        self.assertIn("Chrome 131", hints["auto"]["q2"])
        self.assertIn("Camera was used", hints["saw"]["q8"])
        self.assertIn("the Overview screen was opened 1 time", hints["saw"]["q6"])
        self.assertIn("the Printers screen was not opened", hints["saw"]["q3"])
        self.assertIn("the printer connected 1 time", hints["saw"]["q3"])
        self.assertNotIn("Time-lapses was used", json.dumps(hints))


class TestTheStudyRoutes(AlwaysOnBase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def call(self, method, path, payload=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else (b"{}" if method == "POST" else None)
        request = Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urlopen(request, timeout=30) as response:
                return response.status, response.read(), response.headers
        except HTTPError as err:
            return err.code, err.read(), err.headers

    def test_the_progress_the_questions_and_the_answers_travel_through_the_routes(self):
        status, body, _ = self.call("GET", "/api/tester/study")
        self.assertEqual(status, 200)
        self.assertEqual((json.loads(body)["answered"], json.loads(body)["total"]), (0, 22))
        status, body, _ = self.call("POST", "/api/tester/answers", {"answers": {"q19": {"c": None, "t": "refused at 192.168.1.77"}}})
        self.assertEqual((status, json.loads(body)["answered"]), (200, 1))
        status, body, _ = self.call("GET", "/api/tester/study?questions=1")
        data = json.loads(body)
        self.assertEqual((len(data["sections"]), data["choices"], data["answers"]["q19"]["t"]), (9, {"didnt_try": "Didn't try it"}, "refused at <ip>"))
        self.assertNotIn("192.168.1.77", json.dumps(data))
        self.assertIn("auto", data["hints"])

    def test_there_is_no_route_left_to_choose_a_length_or_finish_a_round(self):
        for payload in ({"length_days": 2}, {"welcomed": True}, {"finish": True}):
            status, _, _ = self.call("POST", "/api/tester/study", payload)
            self.assertEqual(status, 404, payload)

    def test_the_saved_zip_holds_the_answers_next_to_what_was_recorded(self):
        self.call("POST", "/api/tester/events", {"events": [{"k": "click", "s": "abc123", "ctl": "#pause", "screen": "printer", "paint": 30}]})
        self.call("POST", "/api/tester/answers", {"answers": {"q19": {"c": None, "t": "The camera never showed"}, "q17": {"c": "didnt_try", "t": ""}}})
        status, body, headers = self.call("GET", "/api/tester/report.zip")
        self.assertEqual(status, 200)
        z = zipfile.ZipFile(io.BytesIO(body))
        self.assertEqual(sorted(z.namelist()), ["README.txt", "events.jsonl", "findings.md", "report.html", "report.json"])
        report = json.loads(z.read("report.json"))
        self.assertEqual(report["study"]["answered"], 2)
        titles = " | ".join(f["title"] for f in report["findings"])
        self.assertIn("Question 19: The camera never showed", titles)
        self.assertIn("The camera never showed", z.read("findings.md").decode())
        self.assertIn("The camera never showed", z.read("report.html").decode())
        self.assertIn("22", z.read("README.txt").decode())
        self.assertEqual(tester_study.describe()["exports"], 1)                    # the save was noted

    def test_every_study_route_answers_403_when_a_run_keeps_tester_mode_off(self):
        os.environ["DEJAVU_TESTER"] = "0"
        tester.refresh()
        for method, path in (("GET", "/api/tester/study"), ("POST", "/api/tester/answers")):
            status, body, _ = self.call(method, path, {"answers": {}} if method == "POST" else None)
            self.assertEqual(status, 403, path)
            self.assertTrue(json.loads(body).get("module_disabled"), path)
        self.assertFalse(os.path.exists(os.path.join(tester.folder(), "study.json")))

    def test_another_site_cannot_write_answers(self):
        status, _, _ = self.call("POST", "/api/tester/answers", {"answers": {"q1": {"c": None, "t": "x"}}}, headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(tester_study.describe()["answered"], 0)

    def test_the_demo_recorder_leaves_the_study_route_out_of_the_recording(self):
        import runpy
        recorder = runpy.run_path(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "online-demo", "record.py"),
                                  run_name="recorder")
        self.assertIn("/api/tester/study", recorder["NOT_RECORDED"])


if __name__ == "__main__":
    unittest.main()
