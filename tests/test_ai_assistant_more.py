"""The AI assistant's abilities, the third round, key storage and safety, model lists and routes.

Split out of test_ai_assistant.py on 19 November 2026 so a session reads only the part it needs; the shared helpers
(Base, act, the fake servers) stay there and are imported from it.
"""

import base64
import json
import os
import stat
import sys
import tempfile
import textwrap
import time
import unittest
from http.server import BaseHTTPRequestHandler
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ai_assistant  # noqa: E402
import ai_providers  # noqa: E402
import ai_vault  # noqa: E402
import file_library  # noqa: E402
import mock_moonraker  # noqa: E402
import modules  # noqa: E402
from test_api import APITestCase  # noqa: E402
from test_ai_assistant import (  # noqa: E402
    Base, PRINTER, Recorder, Script, act, closed, serve, volume,
)


class TestAbilities(Base):
    def setUp(self):
        super().setUp()
        file_library.reset()
        self.addCleanup(file_library.reset)

    def test_every_shape_is_a_closed_solid_with_its_faces_outward(self):
        import math
        expected = {"box": 20 * 20 * 20, "cylinder": math.pi * 100 * 20, "cone": math.pi * 100 * 20 / 3,
                    "sphere": 4 / 3 * math.pi * 1000, "tube": math.pi * (100 - 36) * 20, "prism": None}
        for shape, wanted in expected.items():
            triangles = ai_assistant._shape(shape, diameter=20, inner_diameter=12, height=20, segments=96, sides=6)
            self.assertTrue(closed(triangles), shape)
            self.assertGreater(volume(triangles), 0, shape)
            if wanted:
                self.assertAlmostEqual(volume(triangles) / wanted, 1, delta=0.01, msg=shape)

    def test_a_tube_needs_a_hole_smaller_than_itself(self):
        with self.assertRaises(ValueError):
            ai_assistant._shape("tube", diameter=10, inner_diameter=12, height=5)

    def test_it_builds_one_model_from_placed_parts(self):
        made = ai_assistant._build_model([{"shape": "box", "width": 40, "depth": 20, "height": 4},
                                          {"shape": "cylinder", "diameter": 8, "height": 30, "at": [20, 10, 4]},
                                          {"shape": "box", "width": 10, "depth": 10, "height": 2, "rotate": [0, 0, 90], "at": [50, 0, 0]}],
                                         name="peg stand")
        self.assertEqual(made["size_mm"], [50, 20, 34])
        self.assertTrue(made["saved_as"].startswith("peg-stand"))
        self.assertEqual(ai_assistant._model_info(made["saved_as"])["lowest_z"], 0)
        with self.assertRaises(ValueError):
            ai_assistant._build_model([])
        with self.assertRaises(ai_assistant.Refused):
            ai_assistant._build_model([{"shape": "box"}] * 61)

    def test_a_ramp_and_a_ring_are_closed_solids_too(self):
        import math
        ramp = ai_assistant._shape("wedge", width=30, depth=10, height=6)
        self.assertTrue(closed(ramp))
        self.assertAlmostEqual(volume(ramp), 30 * 10 * 6 / 2, places=6)
        ring = ai_assistant._shape("torus", diameter=40, thickness=8, segments=96)
        self.assertTrue(closed(ring))
        self.assertAlmostEqual(volume(ring) / (2 * math.pi ** 2 * 16 * 16), 1, delta=0.01)

    def test_it_cuts_a_hole_through_a_part_it_builds(self):
        import math
        made = ai_assistant._build_model([{"shape": "box", "width": 40, "depth": 30, "height": 10},
                                          {"shape": "cylinder", "diameter": 8, "height": 30, "at": [20, 15, -10], "op": "cut"}],
                                         name="plate with hole")
        self.assertEqual(made["size_mm"], [40, 30, 10])
        self.assertEqual(made["accuracy_mm"], 0.4)
        self.assertIn("0.4 mm grid", made["note"])
        _, triangles = ai_assistant._triangles(made["saved_as"])
        self.assertTrue(closed(triangles))
        self.assertAlmostEqual(volume(triangles) / (40 * 30 * 10 - math.pi * 16 * 10), 1, delta=0.005)
        with self.assertRaises(ValueError):
            ai_assistant._build_model([{"shape": "box", "op": "melt"}])
        with self.assertRaises(ai_assistant.Refused):         # nothing to cut from yet
            ai_assistant._build_model([{"shape": "box", "op": "cut"}, {"shape": "box"}])

    def test_it_drills_holes_into_a_model_from_the_library(self):
        import math
        plate = ai_assistant._make_shape("box", width=50, depth=20, height=5, name="bar")["saved_as"]
        made = ai_assistant._cut_holes(plate, [{"x": 10, "y": 10, "diameter": 4}, {"x": 40, "y": 10, "diameter": 4},
                                               {"x": 25, "y": 10, "diameter": 6, "depth": 2}])
        self.assertEqual((made["holes"], made["size_mm"]), (3, [50, 20, 5]))
        self.assertTrue(made["saved_as"].startswith("bar-shape-holes"))
        _, triangles = ai_assistant._triangles(made["saved_as"])
        self.assertTrue(closed(triangles))
        wanted = 50 * 20 * 5 - 2 * math.pi * 4 * 5 - math.pi * 9 * 2
        self.assertAlmostEqual(volume(triangles) / wanted, 1, delta=0.005)
        with self.assertRaises(ValueError):
            ai_assistant._cut_holes(plate, [])

    def test_free_form_shapes_come_out_as_closed_files(self):
        import math
        plate = ai_assistant._make_shape("outline", points=[[0, 0], [50, 0], [50, 20], [0, 20]], height=4,
                                         holes=[[[10, 10], [14, 6], [18, 10], [14, 14]]], corner_radius=3, name="bracket")
        self.assertEqual(plate["size_mm"][2], 4)
        cup = ai_assistant._make_shape("revolve", profile=[[0, 0], [20, 0], [20, 40], [18, 40], [18, 2], [0, 2]], name="cup")
        self.assertEqual([round(v, 3) for v in cup["size_mm"]][2], 40)
        gear = ai_assistant._make_shape("gear", teeth=24, module=1.5, height=5, bore=5, name="gear")
        self.assertAlmostEqual(max(gear["size_mm"][:2]), 39, delta=0.05)
        box = ai_assistant._make_shape("box", width=30, depth=20, height=10, corner_radius=4, name="rounded")
        for made in (plate, cup, gear, box):
            _, triangles = ai_assistant._triangles(made["saved_as"])
            self.assertTrue(closed(triangles), made["saved_as"])
        _, triangles = ai_assistant._triangles(box["saved_as"])
        self.assertAlmostEqual(volume(triangles) / ((30 * 20 - (4 - math.pi) * 16) * 10), 1, delta=0.003)
        ok, result = ai_assistant._carry_out("make_shape", {"shape": "outline", "points": [[0, 0], [9, 9], [9, 0], [0, 9]],
                                                            "height": 2}, ai_assistant._ctx(PRINTER, True))
        self.assertFalse(ok)
        self.assertIn("crosses itself", result["refused"])

    def test_an_outline_part_can_be_cut_like_any_other(self):
        made = ai_assistant._build_model([{"shape": "outline", "points": [[0, 0], [40, 0], [40, 10], [0, 10]], "height": 10},
                                          {"shape": "gear", "teeth": 10, "module": 1, "height": 20, "at": [20, 5, -5],
                                           "op": "cut"}], name="socket")
        self.assertEqual(made["size_mm"], [40, 10, 10])
        self.assertEqual(made["accuracy_mm"], 0.4)

    def test_a_library_model_can_be_a_part_and_keep_leaves_the_overlap(self):
        ball = ai_assistant._make_shape("sphere", diameter=20, segments=64, name="ball")["saved_as"]
        made = ai_assistant._build_model([{"model": ball}, {"shape": "box", "width": 30, "depth": 30, "height": 10,
                                                            "at": [-5, -5, 0], "op": "keep"}], name="dome")
        self.assertAlmostEqual(made["size_mm"][2], 10, delta=made["accuracy_mm"])   # the ball's tip is rounded by the grid
        _, triangles = ai_assistant._triangles(made["saved_as"])
        import math
        self.assertAlmostEqual(volume(triangles) / (2 / 3 * math.pi * 1000), 1, delta=0.01)

    def test_settings_come_as_a_checked_list_to_apply_never_as_a_change(self):
        view = self.say("stronger", act("suggest_settings", changes={"layer_height": 0.2, "sparse_infill_density": 25},
                                         why="Thicker layers and more infill for a stronger part."), "Here you go.")
        row = [m for m in view["messages"] if m["role"] == "action"][0]
        self.assertEqual(row["status"], "done")
        self.assertEqual([(c["key"], c["value"]) for c in row["proposal"]["changes"]],
                         [("layer_height", "0.2"), ("sparse_infill_density", "25%")])
        self.assertEqual(row["proposal"]["changes"][0]["label"], "Layer height")
        self.assertIn("stronger part", row["proposal"]["why"])
        ai_assistant.clear(self.tid)
        view = self.say("silly", act("suggest_settings", changes={"layer_height": 9}) + act("suggest_settings", changes={"start_gcode": "G1"}))
        self.assertEqual([s[1] for s in self.steps(view)], ["refused", "refused"])

    def test_the_settings_list_is_searchable_and_never_floods_the_model(self):
        self.assertIn("note", ai_assistant._print_settings())
        found = ai_assistant._print_settings("infill")["settings"]
        self.assertTrue(found and all("infill" in (r["key"] + r["label"]).lower() for r in found[:3]))
        self.assertLess(len(json.dumps(ai_assistant._print_settings("wall"))), ai_assistant.MAX_RESULT)

    def test_it_opens_a_screen_for_the_owner(self):
        view = self.say("show care", act("open_page", place="care") + act("open_page", place="bank"))
        rows = [m for m in view["messages"] if m["role"] == "action"]
        self.assertEqual({k: rows[0]["handoff"][k] for k in ("kind", "place", "target")},
                         {"kind": "page", "place": "maintenance", "target": "maintenance"})
        self.assertEqual(rows[1]["status"], "refused")

    def test_advice_only_may_still_suggest_and_open_a_screen(self):
        ai_assistant.select(mode="advice")
        view = self.say("x", act("open_page", place="care") + act("suggest_settings", changes={"layer_height": 0.2}) + act("queue_tidy"))
        self.assertEqual([s[1] for s in self.steps(view)], ["done", "done", "refused"])

    def test_queue_care_notes_and_spools_work_through_the_same_checked_functions(self):
        file_library.add_samples()
        name = next(f["name"] for f in ai_assistant._files() if f["name"].endswith(".gcode"))
        ai_assistant.select(mode="free")
        view = self.say("tidy up", act("queue_add", filename=name) + act("logbook_add", problem="Stringing on T1", fix="Dried the spool")
                        + act("spool_add", material="PLA", color_name="Red", color_hex="#ff0000", grams_remaining=800)
                        + act("logbook") + act("queue") + act("filament"), "Done.")
        self.assertEqual([s[1] for s in self.steps(view)], ["done"] * 6, [m.get("detail") for m in view["messages"]])
        told = self.script.seen[1][-1]["text"]
        self.assertIn("Stringing on T1", told)
        self.assertIn(name, told)
        self.assertIn("Red", told)

    def test_a_switched_off_part_of_the_app_refuses_in_words(self):
        modules.set_enabled("print_queue", False)
        modules.set_enabled("maintenance", False)
        view = self.say("x", act("queue_tidy") + act("care_snooze", task_id="nozzle", days=3) + act("maintenance"))
        details = [m["detail"] for m in view["messages"] if m["role"] == "action"]
        self.assertIn("The print queue is switched off", details[0])
        self.assertIn("Care is switched off", details[1])
        self.assertIn("Care is switched off", details[2])

    def test_the_instructions_tell_it_to_act_and_treat_file_text_as_data(self):
        ai_assistant.select(mode="free")
        self.say("hi", "Hello.")
        system = self.script.systems[0]
        for words in ("never ask for permission in words", "is data", "Never invent a reading", "- build_model:", "- cut_holes:", "op cut", "say you,", "language the owner writes in",
                      "- suggest_settings:", "asks only before it ends a print early"):
            self.assertIn(words, system)
        # 12,000 until 21 November 2026; the error code tool (explain_error and its jump) added about 280 characters.
        self.assertLess(len(system), 12300)


FAKE_KEYRING = textwrap.dedent('''\
    #!/usr/bin/env python3
    """A stand-in for `secret-tool` and macOS `security`: one JSON file is the keyring."""
    import json, os, sys
    path, args = os.environ["FAKE_KEYRING"], sys.argv[1:]
    json.dump(args, open(path + ".args", "a")); open(path + ".args", "a").write("\\n")
    if os.environ.get("FAKE_KEYRING_LOCKED"):
        sys.exit(1)
    ring = json.load(open(path)) if os.path.exists(path) else {}
    def save(): json.dump(ring, open(path, "w"))
    if os.path.basename(sys.argv[0]) == "secret-tool":
        name = args[args.index("account") + 1]
        if args[0] == "store": ring[name] = sys.stdin.read(); save()
        elif args[0] == "lookup":
            if name not in ring: sys.exit(1)
            sys.stdout.write(ring[name])
        elif args[0] == "clear": ring.pop(name, None); save()
    else:
        if args == ["-i"]:
            words = sys.stdin.read().split()
            ring[words[words.index("-a") + 1]] = words[words.index("-w") + 1]; save()
        else:
            name = args[args.index("-a") + 1]
            if args[0] == "find-generic-password":
                if name not in ring: sys.exit(44)
                print(ring[name])
            elif args[0] == "delete-generic-password": ring.pop(name, None); save()
''')


@unittest.skipIf(os.name != "posix", "the stand-in keyrings are scripts")
class TestRound3(Base):
    """Saved conversations, photos, places, cards and the new steps (12 November, round 3)."""

    def setUp(self):
        super().setUp()
        file_library.reset()
        self.addCleanup(file_library.reset)

    def test_a_conversation_is_saved_and_opens_again_after_a_restart(self):
        self.say("Home it please", act("home") + "Homing.", "Homed.")
        listed = ai_assistant.chats()["chats"]
        self.assertEqual([c["title"] for c in listed], ["Home it please"])
        self.assertEqual(listed[0]["last"], "Homed.")
        ai_assistant._threads.clear()                              # as if Deja Vu1 had restarted
        again = ai_assistant.view(self.tid)
        self.assertEqual([m["role"] for m in again["messages"]][:2], ["user", "assistant"])
        self.assertEqual(again["title"], "Home it please")
        self.assertFalse(again["busy"])
        self.assertEqual(ai_assistant.clear(self.tid)["chats"], [])
        self.assertEqual(ai_assistant.chats()["chats"], [])

    def test_start_over_stays_started_over_when_an_answer_ends_at_the_same_moment(self):
        # The answer is on disk before the conversation reads as finished, so Start over never races its save.
        busy_at_save = []
        import ai_assistant_part3              # the part that runs a turn holds its own name for the save
        save = ai_assistant_part3._save_chat

        def watched(thread):
            busy_at_save.append(thread["busy"])
            save(thread)
        with patch.object(ai_assistant_part3, "_save_chat", watched):
            self.say("hello", "Hi there.")
        self.assertIs(busy_at_save[-1], True, busy_at_save)     # the save at the end of the answer
        # An answer still arriving for a cleared conversation does not write it back.
        old = ai_assistant._thread(self.tid)
        ai_assistant.clear(self.tid)
        ai_assistant._save_chat(old)
        self.assertFalse(os.path.exists(ai_assistant._chat_path(self.tid)))
        self.assertEqual(ai_assistant.view(self.tid)["messages"], [])

    def test_a_photo_goes_with_the_message_and_is_never_saved(self):
        picture = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8 a small jpeg").decode()
        self.script = Script("I see a spool.")
        with patch.object(ai_providers, "ask", self.script):
            ai_assistant.chat(self.tid, "", PRINTER, demo=True, picture=picture)
            view = self.wait()
        sent = self.script.seen[0][-1]
        self.assertEqual(sent["images"][0][0], "image/jpeg")
        self.assertTrue(view["messages"][0]["picture"])
        self.assertEqual(view["messages"][0]["text"], "What do you see in this photo?")
        with open(ai_assistant._chat_path(self.tid), encoding="utf-8") as fh:
            record = fh.read()
        self.assertNotIn("small jpeg", record)
        for bad in ("data:image/gif;base64,R0lG", "data:image/png;base64,!!!", "https://example.com/x.png"):
            with self.assertRaises(ValueError):
                ai_assistant._picture(bad)

    def test_the_twin_and_other_places_open_the_right_card(self):
        for words, place, spot in (("twin", "printer", "#twin-card"), ("digital twin", "printer", "#twin-card"),
                                   ("camera", "printer", "#pp-camera-card"), ("library", "files", ""),
                                   ("prepare", "slice", "#tab-autoprint"), ("care", "maintenance", "")):
            out = ai_assistant._open_page(to=words)
            self.assertEqual((out["place"], out["spot"]), (place, spot), words)
        front = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
        with open(os.path.join(front, "rail.js"), encoding="utf-8") as fh:
            rail = fh.read()
        with open(os.path.join(front, "index.html"), encoding="utf-8") as fh:
            index = fh.read()
        for key, (place, spot, _what) in ai_assistant.JUMPS.items():
            self.assertIn(f"['{place}', '", rail, f"{key}: no place {place} in the sidebar")
            if spot and spot != "#sec-modules":
                self.assertTrue(f'id="{spot[1:]}"' in index or spot[1:] in rail or spot in ("#telemetry", "#logbook", "#error-codes"), spot)
        self.assertIn("Show you the 3D digital twin", ai_assistant._label("open_page", {"to": "twin"}))

    def test_a_file_named_without_its_extension_is_still_found(self):
        made = ai_assistant._make_shape("box", name="phone stand", width=30, depth=20, height=10)
        stem = made["saved_as"].rsplit(".", 1)[0]
        self.assertEqual(ai_assistant._lib_name(stem), made["saved_as"])
        self.assertEqual(ai_assistant._lib_name(stem.upper() + ".STL"), made["saved_as"])
        self.assertEqual(ai_assistant._model_info(stem)["name"], made["saved_as"])
        with self.assertRaises(ValueError):
            ai_assistant._lib_name("nothing-like-it")

    def test_results_come_back_as_cards(self):
        view = self.say("How hot?", act("status") + act("make_shape", shape="box", width=10, depth=10, height=5), "Done.")
        cards = {m["tool"]: m.get("card") for m in view["messages"] if m["role"] == "action"}
        self.assertEqual(cards["status"]["kind"], "printer")
        self.assertEqual(len(cards["status"]["heads"]), 4)
        self.assertEqual(cards["make_shape"]["kind"], "model")
        self.assertEqual(cards["make_shape"]["size"], [10, 10, 5])

    def test_it_reads_rules_and_print_watch_and_switches_the_look(self):
        view = self.say("x", act("automation_add", rule={"trigger": {"type": "layer", "value": 3},
                                                        "action": {"type": "ai_look", "pause": True}})
                        + act("print_watch", on=True, minutes=5, looks=["warping"])
                        + act("set_look", theme="dark") + act("show_tour", screen="ai") + act("printers"), "Done.")
        rows = {m["tool"]: m for m in view["messages"] if m["role"] == "action"}
        self.assertEqual(rows["automation_add"]["card"]["kind"], "rule")
        self.assertIn("AI checks the camera", rows["automation_add"]["card"]["name"])
        self.assertEqual(ai_assistant.status()["watch"]["looks"], ["warping"])
        self.assertEqual(rows["set_look"]["handoff"]["action"], "theme")
        self.assertEqual(rows["set_look"]["handoff"]["value"], "dark")
        self.assertEqual(rows["show_tour"]["handoff"]["kind"], "ui")
        self.assertEqual(rows["printers"]["status"], "done")
        import automations
        automations.reset()

    def test_deleting_a_file_asks_first(self):
        ai_assistant.select(mode="balanced")
        made = ai_assistant._make_shape("box", name="spare")
        view = self.say("Delete it", act("file_delete", name=made["saved_as"]), "Deleted.")
        self.assertEqual(view["pending"]["tool"], "file_delete")
        view = self.decide(view, True)
        self.assertFalse(file_library.exists(made["saved_as"]))

    def test_the_instructions_stop_the_idle_report_and_offer_another_way(self):
        system = ai_assistant._system({"live": True, "demo": True, "printer": PRINTER}, "free")
        self.assertIn("Don't open an answer with the printer's state", system)
        self.assertIn("offer the closest thing you can", system)
        self.assertIn("digital twin: twin", system)


class TestKeyStorage(unittest.TestCase):
    KEY = "sk-test-0123456789abcdefXYZ9"

    def setUp(self):
        ai_providers.reset()
        self.addCleanup(ai_providers.reset)
        self.dir = tempfile.mkdtemp(prefix="dv-ring-")
        for name in ("secret-tool", "security"):
            path = os.path.join(self.dir, name)
            with open(path, "w") as handle:
                handle.write(FAKE_KEYRING)
            os.chmod(path, 0o755)
        self.ring = os.path.join(self.dir, "ring.json")

    def use(self, store, **extra):
        env = patch.dict(os.environ, {"DEJAVU_KEY_STORE": store, "FAKE_KEYRING": self.ring,
                                      "PATH": self.dir + os.pathsep + os.environ["PATH"], **extra})
        env.start()
        self.addCleanup(env.stop)
        program = patch.object(ai_vault, "SECURITY", os.path.join(self.dir, "security"))
        program.start()
        self.addCleanup(program.stop)

    def on_disk(self):
        with open(ai_providers._KEYS_PATH) as handle:
            return handle.read()

    def test_with_a_keyring_the_key_is_not_in_any_deja_vu1_file(self):
        for store in ("secret-service", "keychain"):
            self.use(store)
            row = ai_providers.save_key("openai", self.KEY)
            self.assertEqual((row["has_key"], row["key_hint"], row["key_store"]), (True, "…XYZ9", store))
            self.assertNotIn(self.KEY, self.on_disk())
            ai_vault.forget_cache()
            self.assertEqual(ai_providers._key("openai"), self.KEY)
            self.assertTrue(ai_providers.security()["encrypted"])
            self.assertEqual(ai_providers.security()["problem"], "")
            with open(self.ring + ".args") as handle:
                self.assertNotIn(self.KEY, handle.read(), "a key must never travel in a command line")
            ai_providers.forget("openai")
            with open(self.ring) as handle:
                self.assertEqual(json.load(handle), {})
            self.assertFalse(ai_providers.describe("openai")["has_key"])

    def test_a_locked_keyring_never_loses_a_key_and_says_where_it_went(self):
        self.use("secret-service", FAKE_KEYRING_LOCKED="1")
        row = ai_providers.save_key("openai", self.KEY)
        self.assertEqual(row["key_store"], "file")
        ai_vault.forget_cache()
        self.assertEqual(ai_providers._key("openai"), self.KEY)
        self.assertIn("private file instead", ai_providers.security()["problem"])
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(os.stat(ai_providers._KEYS_PATH).st_mode), 0o600)

    def test_windows_protection_falls_back_cleanly_where_it_does_not_exist(self):
        self.use("dpapi")
        self.assertEqual(ai_providers.save_key("openai", self.KEY)["key_store"], "file")
        ai_vault.forget_cache()
        self.assertEqual(ai_providers._key("openai"), self.KEY)

    def test_the_plain_file_says_it_is_not_encrypted(self):
        self.use("file")
        ai_providers.save_key("openai", self.KEY)
        told = ai_providers.security()
        self.assertFalse(told["encrypted"])
        self.assertIn("not encrypted", told["how"])
        self.assertIn(self.KEY, self.on_disk())

    def test_keys_saved_before_the_keyring_move_into_it(self):
        self.use("file")
        ai_providers.save_key("openai", self.KEY)
        ai_providers.save_key("custom", "local-key-0123456789", "http://192.168.1.20:8080/v1")
        os.environ["DEJAVU_KEY_STORE"] = "secret-service"
        ai_vault.forget_cache()
        self.assertEqual(ai_providers.protect_saved_keys(), 2)
        self.assertNotIn(self.KEY, self.on_disk())
        with open(ai_providers.storage.prev_path(ai_providers._KEYS_PATH)) as handle:
            self.assertNotIn(self.KEY, handle.read())
        ai_vault.forget_cache()
        self.assertEqual(ai_providers._key("openai"), self.KEY)
        self.assertEqual(ai_providers.describe("custom")["base_url"], "http://192.168.1.20:8080/v1")
        self.assertEqual(ai_providers.protect_saved_keys(), 0)

    def test_a_key_the_keychain_command_cannot_carry_goes_to_the_file(self):
        self.use("keychain")
        odd = 'sk-"quoted"-0123456789'
        self.assertEqual(ai_providers.save_key("openai", odd)["key_store"], "file")
        ai_vault.forget_cache()
        self.assertEqual(ai_providers._key("openai"), odd)

    def test_a_key_in_the_environment_is_used_and_nothing_is_stored(self):
        self.use("file", GROQ_API_KEY="gsk-from-environment-0123")
        row = ai_providers.describe("groq")
        self.assertEqual((row["has_key"], row["from_environment"], row["key_store"], row["key_hint"]),
                         (True, True, "environment", ""))
        self.assertEqual(ai_providers._key("groq"), "gsk-from-environment-0123")
        self.assertFalse(os.path.exists(ai_providers._KEYS_PATH) and "gsk-from" in self.on_disk())


class Bouncer(BaseHTTPRequestHandler):
    """Answers every request with a redirect to another address."""
    target = ""

    def _answer(self):
        self.send_response(302)
        self.send_header("Location", Bouncer.target + self.path)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = do_POST = _answer

    def log_message(self, *args):
        pass


class TestKeySafety(unittest.TestCase):
    KEY = "sk-test-0123456789abcdefXYZ9"

    def setUp(self):
        ai_providers.reset()
        self.addCleanup(ai_providers.reset)
        Recorder.seen, Recorder.status = [], 200
        Recorder.reply = {"choices": [{"message": {"content": "stolen"}}]}
        self.server, self.base = serve(Recorder)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_a_redirect_is_never_followed_so_a_key_cannot_be_carried_elsewhere(self):
        Bouncer.target = self.base
        bouncer, address = serve(Bouncer)
        self.addCleanup(bouncer.server_close)
        self.addCleanup(bouncer.shutdown)
        ai_providers.save_key("groq", self.KEY)
        with patch.dict(ai_providers._BY_ID["groq"], {"base": address}), self.assertRaises(ai_providers.AIError) as caught:
            ai_providers.ask("groq", "m", "S", [{"role": "user", "text": "x"}])
        self.assertIn("didn't follow", str(caught.exception))
        self.assertEqual(Recorder.seen, [])

    def test_a_key_never_travels_unencrypted_to_the_internet(self):
        with self.assertRaises(ValueError) as caught:
            ai_providers.save_key("custom", self.KEY, "http://example.com/v1")
        self.assertIn("only sent over https", str(caught.exception))
        ai_providers.save_key("custom", self.KEY, "https://example.com/v1")
        with self.assertRaises(ai_providers.AIError):
            ai_providers._http("custom", "http://example.com/v1/models", headers={"Authorization": "Bearer " + self.KEY})
        for home in ("http://localhost:8080/v1", "http://192.168.1.20:1234/v1", "http://printer-pc.local:8080/v1",
                     "http://10.0.0.7/v1", "http://mybox:11434/v1"):
            ai_providers.save_key("custom", self.KEY, home)
        for public in ("8.8.8.8", "example.com", "evil.local.example.com"):
            self.assertFalse(ai_providers._local_host(public), public)

    def test_what_the_page_is_told_about_safety_holds_no_key(self):
        ai_providers.save_key("openai", self.KEY)
        shown = json.dumps(ai_assistant.status())
        self.assertNotIn(self.KEY, shown)
        self.assertNotIn(self.KEY[:12], shown)
        told = ai_assistant.status()["security"]
        self.assertEqual(len(told["rules"]), 3)
        self.assertIn(told["store"], ai_vault.STORES)


class TestModelLists(unittest.TestCase):
    KEY = "sk-test-0123456789abcdefXYZ9"

    def setUp(self):
        ai_providers.reset()
        self.addCleanup(ai_providers.reset)
        Recorder.seen, Recorder.status = [], 200
        self.server, self.base = serve(Recorder)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def listed(self, pid, reply, models="models"):
        Recorder.reply = reply
        ai_providers.save_key(pid, self.KEY)
        target = self.base + "/" + models
        with patch.dict(ai_providers._BY_ID[pid], {"base": self.base, "models": target}):
            return ai_providers.list_models(pid, refresh=True)

    def test_the_newest_model_comes_first_and_is_the_starting_choice(self):
        rows = [{"id": "gpt-7", "created": 1700000000 + 86400 * i} for i in range(1)]
        rows += [{"id": "gpt-8", "created": 1800000000}, {"id": "gpt-9", "created": 1900000000},
                 {"id": "gpt-9-mini", "created": 1900000500}, {"id": "gpt-9-preview", "created": 1900000900},
                 {"id": "text-embedding-9", "created": 1900001000}, {"id": "gpt-8.5", "created": 1850000000}]
        listed = self.listed("openai", {"data": rows})
        self.assertEqual(listed["models"], ["gpt-9-preview", "gpt-9-mini", "gpt-9", "gpt-8.5", "gpt-8", "gpt-7"])
        self.assertEqual(listed["suggested"], "gpt-9")

    def test_anthropic_dates_and_names_are_read(self):
        listed = self.listed("anthropic", {"data": [
            {"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "created_at": "2026-09-01T00:00:00Z", "type": "model"},
            {"id": "claude-new-9", "display_name": "Claude New 9", "created_at": "2027-02-01T00:00:00Z", "type": "model"},
            {"id": "claude-old-1", "display_name": "Claude Old", "created_at": "2024-02-01T00:00:00Z", "type": "model"},
            {"id": "claude-mid-3", "display_name": "Claude Mid", "created_at": "2025-02-01T00:00:00Z", "type": "model"},
            {"id": "claude-mid-4", "display_name": "Claude Mid 4", "created_at": "2025-08-01T00:00:00Z", "type": "model"}]})
        self.assertEqual(listed["models"][0], "claude-new-9")
        self.assertEqual(listed["rows"][0]["label"], "Claude New 9")
        self.assertEqual(listed["suggested"], "claude-opus-5-5")

    def test_googles_own_list_is_read_with_its_own_header(self):
        listed = self.listed("google", {"models": [
            {"name": "models/gemini-9.5-pro", "displayName": "Gemini 9.5 Pro", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-9.5-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-10-pro-preview", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/text-embedding-9", "supportedGenerationMethods": ["embedContent"]},
            {"name": "models/aqa", "supportedGenerationMethods": ["generateAnswer"]}]})
        self.assertEqual(listed["models"], ["gemini-10-pro-preview", "gemini-9.5-flash", "gemini-9.5-pro"])
        self.assertEqual(listed["suggested"], "gemini-9.5-pro")
        headers = {k.lower(): v for k, v in Recorder.seen[0][2].items()}
        self.assertEqual(headers["x-goog-api-key"], self.KEY)
        self.assertNotIn("authorization", headers)

    def test_prices_are_shown_only_where_the_service_reports_them(self):
        rows = [{"id": "anthropic/claude-opus-9", "created": 1900000000 + i, "pricing": {"prompt": "0.000004", "completion": "0.00002"}}
                for i in range(1)] + [{"id": f"maker/model-{i}", "created": 1800000000 + i * 99999} for i in range(6)]
        listed = self.listed("openrouter", {"data": rows})
        top = listed["rows"][0]
        self.assertEqual((top["id"], top["in_per_million"], top["out_per_million"]), ("anthropic/claude-opus-9", 4.0, 20.0))
        self.assertEqual(listed["suggested"], "anthropic/claude-opus-9")
        rows[0]["id"] = "gpt-9"
        self.assertNotIn("in_per_million", self.listed("openai", {"data": rows})["rows"][0])

    def test_a_host_of_many_makers_models_suggests_nothing(self):
        listed = self.listed("groq", {"data": [{"id": "maker-a/big-70b"}, {"id": "maker-b/small-8b"}]})
        self.assertEqual(listed["suggested"], "")
        self.assertEqual(len(listed["models"]), 2)

    def test_a_list_is_kept_for_a_while_and_read_again_when_asked(self):
        self.listed("openai", {"data": [{"id": "gpt-9"}]})
        Recorder.reply = {"data": [{"id": "gpt-10"}]}
        with patch.dict(ai_providers._BY_ID["openai"], {"base": self.base}):
            self.assertEqual(ai_providers.list_models("openai")["models"], ["gpt-9"])
            self.assertEqual(ai_providers.list_models("openai", refresh=True)["models"], ["gpt-10"])

    def test_no_model_name_is_written_into_the_connections_file(self):
        with open(ai_providers.__file__) as handle:
            source = handle.read()
        import re
        body = source[source.index("PROVIDERS = ["):source.index("_BY_ID = ")]
        self.assertEqual(re.findall(r"(?:gpt|gemini|grok|llama|mistral|qwen)-\\d[\\w.-]*\\d", body), [])

    def test_every_address_is_https_and_distinct(self):
        bases = [p["base"] for p in ai_providers.PROVIDERS if p["kind"] == "key"]
        self.assertEqual(len(bases), len(set(bases)))
        self.assertNotIn("hyperbolic.xyz", " ".join(bases))


class TestRoutes(APITestCase):
    def setUp(self):
        super().setUp()
        ai_assistant.reset()
        modules.reset_state()
        mock_moonraker.reset_live_state()
        self.addCleanup(ai_assistant.reset)
        self.addCleanup(modules.reset_state)
        program = patch.object(ai_providers, "_program", return_value="/usr/bin/true")
        program.start()
        self.addCleanup(program.stop)

    def test_cost_before_sending_and_the_owners_limit_through_the_server(self):
        with patch.object(ai_providers, "ask", return_value="ready"):
            self.post("/api/assistant/test", {"provider": "claude-code"})
        status, body = self.post("/api/assistant/estimate?demo=1", {"thread": "thread-9", "text": "hi"})
        self.assertEqual((status, body["price"]), (200, {"charge": "plan"}))
        status, body = self.post("/api/assistant/budget", {"cap_usd": 2})
        self.assertEqual((status, body["cap_usd"]), (200, 2))
        status, body = self.post("/api/assistant/budget", {"price_in": -5, "price_out": 1})
        self.assertEqual(status, 400)

    def test_the_whole_path_through_the_server(self):
        status, body = self.get("/api/assistant")
        self.assertEqual(status, 200)
        self.assertFalse(body["ready"])
        self.assertEqual(self.post("/api/assistant/chat?demo=1", {"thread": "thread-1", "text": "hi"})[0], 400)
        with patch.object(ai_providers, "ask", return_value="ready"):
            status, body = self.post("/api/assistant/test", {"provider": "claude-code"})
        self.assertTrue(body["ready"])
        script = Script("On it. " + act("fan", percent=35), "The fan is at 35%.")
        with patch.object(ai_providers, "ask", script):
            status, body = self.post("/api/assistant/chat?demo=1&printer=u1-workshop", {"thread": "thread-1", "text": "fan 35"})
            self.assertEqual(status, 200)
            for _ in range(300):
                status, view = self.get("/api/assistant/thread?id=thread-1")
                if not view["busy"]:
                    break
                time.sleep(0.01)
        self.assertEqual([m["role"] for m in view["messages"]], ["user", "assistant", "action", "assistant"])
        with mock_moonraker.selection_only("u1-workshop"):
            self.assertEqual(mock_moonraker.get_printer_state()["tuning"]["part_fan"], 0.35)
        self.assertEqual(self.post("/api/assistant/clear", {"thread": "thread-1"})[1], {"cleared": True, "chats": []})

    def test_a_provider_error_is_a_502_with_words(self):
        with patch.object(ai_providers, "ask", side_effect=ai_providers.AIError("No credit left")):
            status, body = self.post("/api/assistant/test", {"provider": "claude-code"})
        self.assertEqual((status, body), (502, {"error": "No credit left"}))

    def test_switched_off_means_every_route_refuses(self):
        modules.set_enabled("ai_assistant", False)
        self.assertEqual(self.get("/api/assistant")[0], 403)
        self.assertEqual(self.post("/api/assistant/chat", {"thread": "thread-1", "text": "hi"})[0], 403)
        self.assertEqual(self.post("/api/assistant/key", {"provider": "openai", "api_key": "k" * 20})[0], 403)

    def test_dont_ask_again_and_taking_it_back_through_the_server(self):
        with patch.object(ai_providers, "ask", return_value="ready"):
            self.post("/api/assistant/test", {"provider": "claude-code"})
        self.assertEqual(self.post("/api/assistant/select", {"mode": "ask"})[1]["mode"], "ask")
        script = Script(act("fan", percent=35), "Done.")
        with patch.object(ai_providers, "ask", script):
            self.post("/api/assistant/chat?demo=1&printer=u1-workshop", {"thread": "thread-2", "text": "fan 35"})
            for _ in range(300):
                view = self.get("/api/assistant/thread?id=thread-2")[1]
                if not view["busy"]:
                    break
                time.sleep(0.01)
            status, _ = self.post("/api/assistant/decide?demo=1&printer=u1-workshop",
                                  {"thread": "thread-2", "n": view["pending"]["n"], "approve": True, "always": True})
            self.assertEqual(status, 200)
            for _ in range(300):
                if not self.get("/api/assistant/thread?id=thread-2")[1]["busy"]:
                    break
                time.sleep(0.01)
        self.assertEqual([r["tool"] for r in self.get("/api/assistant")[1]["never_ask"]], ["fan"])
        self.assertEqual(self.post("/api/assistant/select", {"never_ask": []})[1]["never_ask"], [])

    def test_the_status_says_how_keys_are_kept_and_which_mode_is_the_default(self):
        body = self.get("/api/assistant")[1]
        self.assertEqual(body["default_mode"], "free")
        self.assertEqual(sorted(body["modes"]), ["advice", "ask", "balanced", "free", "open"])
        self.assertIn("how", body["security"])
        self.assertEqual(body["connections"], [])
        self.assertEqual(self.post("/api/assistant/check", {"provider": "openai"})[0], 400)

    def test_saving_a_key_answers_without_it(self):
        status, body = self.post("/api/assistant/key", {"provider": "mistral", "api_key": "mk-0123456789abcdef"})
        self.assertEqual(status, 200)
        self.assertNotIn("mk-0123456789abcdef", json.dumps(body))
        row = next(p for p in body["providers"] if p["id"] == "mistral")
        self.assertTrue(row["has_key"])


class TestWhatTheScreenSaysWhileAStepWaits(Base):
    """The model once wrote "The bed is now set" over a step that still waited for a yes (22 November 2026, Ask mode)."""

    def notes(self, view):
        return [m["text"] for m in view["messages"] if m["role"] == "note"]

    def test_a_step_that_waits_is_followed_by_a_line_saying_nothing_is_done(self):
        view = self.say("warm T1", "The bed is now set. " + act("nozzle_temp", toolhead="T1", target=233), "Heating.")
        self.assertEqual(self.steps(view), [("nozzle_temp", "waiting")])
        self.assertTrue(any("Nothing is done until you approve the step below" in n for n in self.notes(view)), self.notes(view))
        order = [m["role"] for m in view["messages"] if m["role"] in ("assistant", "note", "action")]
        self.assertEqual(order[:3], ["assistant", "note", "action"])          # the line sits between the claim and the step

    def test_a_step_that_runs_by_itself_gets_no_such_line(self):
        self.idle()
        view = self.say("home it", "Homing now. " + act("home", axes=["X", "Y"]), "Homed.")
        self.assertFalse([n for n in self.notes(view) if "Nothing is done until" in n])

    def test_a_step_the_owner_released_from_asking_gets_none_either(self):
        ai_assistant.select(never_ask=["nozzle_temp"])
        view = self.say("warm T1", "Heating. " + act("nozzle_temp", toolhead="T1", target=233), "Heating.")
        self.assertFalse([n for n in self.notes(view) if "Nothing is done until" in n])


class TestAnotherAIAfterAnError(Base):
    """The saved AI answered "503 high demand" and nothing offered the Claude plan that was ready (22 November 2026)."""

    OTHER = {"id": "codex", "name": "Codex", "kind": "subscription", "model": "m1"}

    def connections(self, active="claude-code"):
        return {**self.real, "provider": active, "connections": [
            {"id": "claude-code", "name": "Claude Code", "kind": "subscription", "model": "m"}, self.OTHER]}

    def setUp(self):
        super().setUp()
        self.real = ai_assistant.status()

    def failing(self):
        def ask(pid, model, system, messages):
            raise ai_providers.AIError("The service says: 503 high demand. Try again soon")
        return ask

    def test_the_error_names_the_other_ready_ais(self):
        with patch("ai_assistant_part3.status", return_value=self.connections()), patch.object(ai_providers, "ask", self.failing()):
            ai_assistant.chat(self.tid, "what is connected?", PRINTER, demo=True)
            view = self.wait()
        error = [m for m in view["messages"] if m["role"] == "error"][0]
        self.assertIn("503 high demand", error["text"])
        self.assertEqual([a["id"] for a in error["alternatives"]], ["codex"])      # not the one that just failed

    def test_asking_again_with_another_ai_answers_the_same_question(self):
        with patch("ai_assistant_part3.status", return_value=self.connections()), patch.object(ai_providers, "ask", self.failing()):
            ai_assistant.chat(self.tid, "what is connected?", PRINTER, demo=True)
            self.wait()
        chosen = []
        script = Script("Four heads.")
        with patch("ai_assistant_part3.status", return_value=self.connections()), \
                patch("ai_assistant_part3.select", side_effect=lambda p, *a, **k: chosen.append(p) or self.connections(p)), \
                patch.object(ai_providers, "ask", script):
            ai_assistant.retry(self.tid, "codex", PRINTER, demo=True)
            view = self.wait()
        self.assertEqual(chosen, ["codex"])
        self.assertEqual([m["text"] for m in view["messages"] if m["role"] == "assistant"], ["Four heads."])
        self.assertIn("what is connected?", script.seen[0][-1]["text"])         # the same question, not a new one
        self.assertTrue([m for m in view["messages"] if m["role"] == "note" and "Asking again with" in m["text"]])

    def test_an_ai_that_is_not_connected_cannot_be_asked(self):
        with patch("ai_assistant_part3.status", return_value=self.connections()):
            with self.assertRaises(ValueError):
                ai_assistant.retry(self.tid, "nobody", PRINTER, demo=True)

    def test_there_is_nothing_to_ask_again_before_a_question(self):
        with patch("ai_assistant_part3.status", return_value=self.connections()):
            with self.assertRaises(ValueError):
                ai_assistant.retry(self.tid, "codex", PRINTER, demo=True)


if __name__ == "__main__":
    unittest.main()
