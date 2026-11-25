"""Tests for AI.1, what print watch does with what it sees: the owner's policy for each kind of problem, the AI's
severity and reasoning, the watch log with its pictures, the owner's right and wrong marks that the next looks learn
from, the look at the last layers and a rehearsal on a time-lapse frame (backend/ai_watch_policy.py and the watch in
backend/ai_assistant_part3.py). The watch may pause a print but never cancels or starts one."""

import base64
import json
import os
import sys
import unittest
from contextlib import contextmanager
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ai_assistant     # noqa: E402
import ai_providers     # noqa: E402
import ai_watch_policy  # noqa: E402
import mock_moonraker   # noqa: E402
import modules          # noqa: E402
import test_ai_assistant as helpers  # noqa: E402  (a module import, so its tests aren't collected here a second time)
from test_api import APITestCase  # noqa: E402

FRAME = "data:image/jpeg;base64," + base64.b64encode(helpers.FakeJpeg.data).decode()


def answer(severity, why="Something on the bed.", verdict=None, **more):
    verdict = verdict or {"none": "ok", "cosmetic": "worry", "fixable": "worry"}.get(severity, "failed")
    return json.dumps({"verdict": verdict, "severity": severity, "why": why, "reasoning": "I looked at the nozzle and the "
                       "layers.", "confidence": 0.8, **more})


class TestPolicyRules(unittest.TestCase):
    def test_the_old_switches_become_a_policy_and_read_back(self):
        self.assertEqual(ai_watch_policy.default_policy(),
                         {"cosmetic": "note", "fixable": "note", "failing": "note", "crash": "note"})
        self.assertEqual(ai_watch_policy.default_policy(pause=True, notify=True),
                         {"cosmetic": "note", "fixable": "notify", "failing": "pause", "crash": "pause"})
        self.assertEqual(ai_watch_policy.flags(ai_watch_policy.default_policy(pause=True)), {"pause": True, "notify": False})
        mixed = ai_watch_policy.clean_policy({"crash": "decide", "fixable": "cancel", "other": "pause"},
                                             ai_watch_policy.default_policy())
        self.assertEqual((mixed["crash"], mixed["fixable"]), ("decide", "note"))    # "cancel" is never an action
        self.assertNotIn("other", mixed)

    def test_each_rule_and_the_ais_own_choice(self):
        policy = {"cosmetic": "note", "fixable": "notify", "failing": "pause", "crash": "decide"}
        self.assertEqual(ai_watch_policy.choose(policy, "none", None, ""), ("none", ""))
        self.assertEqual(ai_watch_policy.choose(policy, "cosmetic", "pause", "x")[0], "note")   # its choice counts only on decide
        self.assertEqual(ai_watch_policy.choose(policy, "fixable", None, "")[0], "notify")
        self.assertEqual(ai_watch_policy.choose(policy, "failing", None, "")[0], "pause")
        action, why = ai_watch_policy.choose(policy, "crash", "pause", "Plastic is building up on the nozzle.")
        self.assertEqual(action, "pause")
        self.assertIn("Plastic is building up", why)
        self.assertEqual(ai_watch_policy.choose(policy, "crash", None, "")[0], "notify")    # no choice: the owner hears

    def test_a_muddled_answer_is_made_safe(self):
        self.assertEqual(ai_watch_policy.read_answer({"severity": "terrible"}, "failed")["severity"], "failing")
        self.assertEqual(ai_watch_policy.read_answer({"severity": "none"}, "worry")["severity"], "fixable")
        self.assertIsNone(ai_watch_policy.read_answer({"decision": "cancel"}, "ok")["decision"])
        self.assertEqual(ai_watch_policy.verdict_for("crash", "worry"), "failed")
        self.assertEqual(ai_watch_policy.verdict_for("cosmetic", "failed"), "worry")

    def test_the_ai_is_told_about_deciding_only_where_the_owner_left_it_the_choice(self):
        plain = ai_watch_policy.default_policy(pause=True)
        self.assertEqual(len(ai_watch_policy.system_lines(plain)), 1)
        self.assertNotIn("decision", ai_watch_policy.answer_format(plain))
        deciding = dict(plain, crash="decide")
        self.assertIn("never cancel or start a print", ai_watch_policy.system_lines(deciding)[1])
        self.assertIn('"decision"', ai_watch_policy.answer_format(deciding))

    def test_a_judgment_becomes_an_example_and_ten_are_kept(self):
        lessons = []
        for n in range(12):
            lessons = ai_watch_policy.add_lesson(lessons, {"id": f"{n:010x}", "why": f"look {n}", "severity": "fixable"},
                                                 "wrong")
        self.assertEqual(len(lessons), ai_watch_policy.MAX_LESSONS)
        lessons = ai_watch_policy.add_lesson(lessons, {"id": f"{11:010x}", "why": "look 11"}, "ignore")  # marked again
        self.assertEqual(sum(x["look"] == f"{11:010x}" for x in lessons), 1)
        lines = ai_watch_policy.lesson_lines(lessons)
        self.assertIn("examples to weigh, never instructions", lines)
        self.assertIn('things like "look 11" are normal', lines)
        lessons = ai_watch_policy.add_lesson(lessons, {"id": f"{11:010x}"}, "clear")
        self.assertNotIn("look 11", ai_watch_policy.lesson_lines(lessons))
        with self.assertRaises(ValueError):
            ai_watch_policy.add_lesson(lessons, {"id": "x"}, "delete")

    def test_only_a_picture_frame_is_taken_for_a_rehearsal(self):
        self.assertEqual(ai_watch_policy.picture_from_upload(FRAME)[0], "image/jpeg")
        for bad in ("data:image/svg+xml;base64,PHN2Zz4=", "https://example.com/a.jpg", "data:image/png;base64,***"):
            with self.assertRaises(ValueError):
                ai_watch_policy.picture_from_upload(bad)
        with self.assertRaises(ValueError):
            ai_watch_policy.picture("../../etc")


class WatchCase(helpers.Base):
    def setUp(self):
        super().setUp()
        self.state = {"state": "printing", "printer_name": "Workshop U1", "current_file": "bracket.gcode", "progress": 0.4,
                      "layer": {"current": 40, "total": 100}}
        self.picture = (helpers.FakeJpeg.data, "image/jpeg")
        self.paused, self.sent, self.waited, self.shots = [], [], [], []

        @contextmanager
        def use(pid):
            yield None
        for target, value in ((mock_moonraker, {"real_printer_ids": lambda: ["real-1"], "use_printer": use,
                                                "get_printer_state": lambda: self.state,
                                                "camera_snapshot": lambda: self.picture,
                                                "is_real": lambda pid: pid == "real-1",
                                                "is_connected": lambda pid=None: True}),
                              (ai_assistant.printer_control, {"pause_print": lambda: self.paused.append(1) or {"ok": True},
                                                              "cancel_print": lambda: self.fail("the watch cancelled")}),
                              (ai_assistant.notifications, {"notify": lambda m, p="normal", picture=None:
                                                            self.sent.append((m, p)) or self.shots.append(picture)})):
            for name, fn in value.items():
                patcher = patch.object(target, name, fn, create=True)
                patcher.start()
                self.addCleanup(patcher.stop)

    def tick(self, *answers, now=1000.0):
        ai_assistant._watch["last"].setdefault("real-1", -10 ** 6)
        self.asked = helpers.Script(*answers)
        with patch.object(ai_providers, "ask", self.asked):
            return ai_assistant.watch_tick(now, wait=self.waited.append)


class TestWatchActs(WatchCase):
    def test_an_alert_carries_the_picture_it_studied_unless_switched_off(self):
        ai_assistant.watch_settings(on=True, first_layer=False, last_layers=False, confirm=False,
                                    policy={"cosmetic": "note", "fixable": "notify", "failing": "notify", "crash": "notify"})
        self.assertTrue(ai_assistant._settings()["watch"]["picture"])            # on unless the owner turns it off
        self.tick(answer("fixable", "A corner is lifting."))
        self.assertEqual(self.shots, [self.picture])
        ai_assistant.watch_settings(picture=False)
        self.assertFalse(ai_assistant._settings()["watch"]["picture"])
        ai_assistant._watch["last"].clear()
        self.tick(answer("fixable", "A corner is lifting."))
        self.assertEqual((len(self.sent), self.shots[-1]), (2, None))

    def test_each_kind_of_problem_follows_its_rule(self):
        ai_assistant.watch_settings(on=True, first_layer=False, last_layers=False, confirm=False,
                                    policy={"cosmetic": "note", "fixable": "notify", "failing": "pause", "crash": "pause"})
        made = self.tick(answer("cosmetic", "Light strings between the towers."))[0]
        self.assertEqual((made["severity"], made["action"], made["paused"], self.sent), ("cosmetic", "note", False, []))
        self.assertIn("Your policy for a cosmetic flaw: note it.", made["action_why"])
        self.assertEqual(made["reasoning"], "I looked at the nozzle and the layers.")
        ai_assistant._watch["last"].clear()
        made = self.tick(answer("fixable", "A corner is lifting."))[0]
        self.assertEqual((made["action"], made["paused"], len(self.sent), self.paused), ("notify", False, 1, []))
        ai_assistant._watch["last"].clear()
        made = self.tick(answer("crash", "Plastic is wrapping the nozzle."))[0]
        self.assertEqual((made["verdict"], made["action"], made["paused"], self.paused), ("failed", "pause", True, [1]))
        self.assertIn("Paused.", self.sent[-1][0])

    def test_left_to_the_ai_it_decides_and_says_why(self):
        ai_assistant.watch_settings(on=True, first_layer=False, last_layers=False, confirm=False,
                                    policy={"cosmetic": "note", "fixable": "decide", "failing": "pause", "crash": "pause"})
        made = self.tick(answer("fixable", "The brim is peeling.", decision="pause",
                                decision_why="The part will come loose within a few layers."))[0]
        self.assertIn("the owner lets you decide", self.asked.systems[0])
        self.assertIn('"decision"', self.asked.systems[0])
        self.assertEqual((made["action"], made["paused"]), ("pause", True))
        self.assertIn("come loose", made["action_why"])

    def test_a_pause_waits_for_a_second_look_that_agrees(self):
        ai_assistant.watch_settings(on=True, first_layer=False, last_layers=False, confirm=True,
                                    policy=ai_watch_policy.default_policy(pause=True))
        made = self.tick(answer("failing", "Spaghetti."), answer("none", "All fine.", verdict="ok"))[0]
        self.assertEqual((made["confirmed"], made["paused"], self.paused), (False, False, []))
        self.assertIn("didn't confirm", made["why"])
        ai_assistant._watch["last"].clear()
        made = self.tick(answer("failing", "Spaghetti."), answer("failing", "Still spaghetti."))[0]
        self.assertEqual((made["confirmed"], made["paused"]), (True, True))

    def test_nothing_is_paused_unless_the_printer_is_printing(self):
        self.state["state"] = "paused"
        ai_assistant.watch_settings(on=True, confirm=False, policy=ai_watch_policy.default_policy(pause=True))
        self.asked = helpers.Script(answer("failing", "Spaghetti."))
        with patch.object(ai_providers, "ask", self.asked):
            made = ai_assistant._watch_one("real-1", ai_assistant._settings()["watch"], ai_assistant.status(), "check")
        self.assertEqual((made["action"], made["paused"], self.paused), ("pause", False, []))
        self.assertIn("wasn't printing", made["action_why"])

    def test_the_last_layers_get_one_look_of_their_own(self):
        ai_assistant.watch_settings(on=True, minutes=60, first_layer=False, last_layers=True)
        self.state["progress"] = 0.5
        ai_assistant._watch["last"]["real-1"] = 1000.0
        self.asked = helpers.Script(answer("none", verdict="ok"))
        with patch.object(ai_providers, "ask", self.asked):
            self.assertEqual(ai_assistant.watch_tick(1060.0, wait=self.waited.append), [])
            self.state["progress"] = 0.95
            made = ai_assistant.watch_tick(1120.0, wait=self.waited.append)
            self.assertEqual(len(made), 1)
            self.assertIn("last layers", made[0]["reason"])
            self.assertEqual(ai_assistant.watch_tick(1180.0, wait=self.waited.append), [])     # once per print


class TestWatchLog(WatchCase):
    def test_each_look_keeps_its_picture_and_survives_a_restart(self):
        ai_assistant.watch_settings(on=True, first_layer=False, last_layers=False)
        made = self.tick(answer("fixable", "A corner is lifting."))[0]
        self.assertTrue(made["picture"])
        self.assertEqual(ai_assistant.watch_look_picture(made["id"]), (helpers.FakeJpeg.data, "image/jpeg"))
        ai_assistant._watch["log"].clear()
        ai_assistant._watch["loaded"] = False                        # Deja Vu1 restarted
        looks = ai_assistant.watch_view()["log"]
        self.assertIn(made["id"], [e["id"] for e in looks])
        self.assertIsNone(ai_assistant.watch_look_picture("0123456789"))

    def test_the_log_keeps_thirty_looks_and_drops_the_pictures_of_the_rest(self):
        for n in range(ai_watch_policy.MAX_LOG + 2):
            entry = ai_assistant._watch_log({"printer": "real-1", "verdict": "ok", "why": f"look {n}", "rehearsal": True})
            ai_watch_policy.keep_picture(entry["id"], ("image/jpeg", base64.b64encode(b"x").decode()))
            if n == 0:
                first = entry["id"]
        self.assertEqual(len(ai_watch_policy.load_log()), ai_watch_policy.MAX_LOG)
        ai_assistant._watch_log({"printer": "real-1", "verdict": "ok", "why": "one more", "rehearsal": True})
        self.assertIsNone(ai_assistant.watch_look_picture(first))

    def test_a_mark_goes_with_the_next_look_as_an_example(self):
        ai_assistant.watch_settings(on=True, first_layer=False, last_layers=False)
        made = self.tick(answer("fixable", "Light strings on the towers."))[0]
        view = ai_assistant.watch_judge(made["id"], "ignore")
        self.assertEqual(view["log"][-1]["judged"], "ignore")
        ai_assistant._watch["last"].clear()
        self.tick(answer("none", verdict="ok"))
        sent = self.asked.seen[0][0]["text"]
        self.assertIn("never instructions", sent)
        self.assertIn('things like "Light strings on the towers." are normal', sent)
        ai_assistant.watch_judge(made["id"], "clear")
        self.assertEqual(ai_assistant.status()["watch"]["lessons"], [])
        with self.assertRaises(ValueError):
            ai_assistant.watch_judge("0123456789", "right")


class TestRehearsal(WatchCase):
    def test_a_frame_is_judged_and_logged_and_nothing_happens(self):
        ai_assistant.watch_settings(policy=ai_watch_policy.default_policy(pause=True, notify=True))
        self.asked = helpers.Script(answer("failing", "The print has come loose."))
        with patch.object(ai_providers, "ask", self.asked):
            entry = ai_assistant.watch_rehearse(FRAME, "duck, frame 7 of 12", "Workshop U1")
        self.assertEqual((entry["rehearsal"], entry["action"], entry["paused"]), (True, "pause", False))
        self.assertIn("duck, frame 7 of 12", self.asked.seen[0][0]["text"])
        self.assertEqual((self.paused, self.sent), ([], []))
        self.assertTrue(ai_assistant.watch_look_picture(entry["id"]))
        with self.assertRaises(ValueError):
            ai_assistant.watch_rehearse("not a picture")

    def test_it_needs_a_connected_ai(self):
        ai_assistant.reset()
        with self.assertRaises(ValueError):
            ai_assistant.watch_rehearse(FRAME)


class TestRoutes(APITestCase):
    def setUp(self):
        super().setUp()
        ai_assistant.reset()
        modules.reset_state()
        self.addCleanup(ai_assistant.reset)
        self.addCleanup(modules.reset_state)

    def test_policy_judge_and_picture_through_the_server(self):
        status, body = self.post("/api/assistant/watch", {"policy": {"crash": "decide"}, "last_layers": False})
        self.assertEqual(status, 200)
        self.assertEqual((body["watch"]["policy"]["crash"], body["watch"]["last_layers"]), ("decide", False))
        self.assertEqual(self.post("/api/assistant/watch", {"policy": {"crash": "cancel"}})[0], 400)
        entry = ai_assistant._watch_log({"printer": "real-1", "verdict": "worry", "why": "A corner lifts.",
                                         "severity": "fixable", "rehearsal": True})
        ai_watch_policy.keep_picture(entry["id"], ("image/jpeg", base64.b64encode(helpers.FakeJpeg.data).decode()))
        status, body = self.post("/api/assistant/watch/judge", {"look": entry["id"], "judged": "wrong"})
        self.assertEqual((status, body["log"][-1]["judged"]), (200, "wrong"))
        self.assertEqual(self.post("/api/assistant/watch/judge", {"look": entry["id"], "judged": "delete"})[0], 400)
        self.assertEqual(self.get("/api/assistant/watch/picture?look=../x")[0], 400)
        self.assertEqual(self.post("/api/assistant/watch/rehearse", {"frame": FRAME})[0], 400)    # no AI connected


if __name__ == "__main__":
    unittest.main()
