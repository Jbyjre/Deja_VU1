"""
The AI assistant (backend/ai_assistant.py, backend/ai_providers.py, backend/ai_vault.py).

No test here needs a real AI or a real key. The model is a scripted stand-in (`Script`), the two
wire formats are checked against small local servers that answer in each format's shape, the
subscription path runs stand-in `claude` and `codex` programs, and the keyrings are stand-in
`secret-tool` and `security` programs.

    python3 -m unittest tests.test_ai_assistant
"""

import json
import os
import stat
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ai_assistant        # noqa: E402
import ai_providers        # noqa: E402
import backup              # noqa: E402
import file_library        # noqa: E402
import mock_moonraker      # noqa: E402
import modules             # noqa: E402
import printer_control     # noqa: E402
import watch_only          # noqa: E402

PRINTER = "u1-workshop"


def act(tool, **args):
    return "```action\n" + json.dumps({"tool": tool, "args": args}) + "\n```"


class Script:
    """A model that says what the test tells it to, and remembers what it was shown."""

    def __init__(self, *answers):
        self.answers, self.seen, self.systems = list(answers), [], []

    def __call__(self, pid, model, system, messages):
        self.systems.append(system)
        self.seen.append([dict(m) for m in messages])
        return self.answers.pop(0) if self.answers else "Done."


class Base(unittest.TestCase):
    def setUp(self):
        ai_assistant.reset()
        mock_moonraker.reset_live_state()
        modules.reset_state()
        self.addCleanup(ai_assistant.reset)
        self.addCleanup(mock_moonraker.reset_live_state)
        self.addCleanup(modules.reset_state)
        # Test machines don't have the Claude Code program installed: stand in for it, so the plan counts as set up.
        program = patch.object(ai_providers, "_program", return_value="/usr/bin/true")
        program.start()
        self.addCleanup(program.stop)
        with patch.object(ai_providers, "ask", return_value="ready"):
            ai_assistant.test("claude-code")
        ai_assistant.select(mode="balanced")     # most tests here are about steps that wait; the default is freer
        self.tid = "thread-" + self.id().split(".")[-1][:40].replace("_", "-")

    def idle(self):
        with mock_moonraker.selection_only(PRINTER):
            if mock_moonraker.get_printer_state()["state"] in ("printing", "paused"):
                printer_control.cancel_print()

    def state(self):
        with mock_moonraker.selection_only(PRINTER):
            return mock_moonraker.get_printer_state()

    def wait(self):
        for _ in range(400):
            view = ai_assistant.view(self.tid)
            if not view["busy"]:
                return view
            time.sleep(0.01)
        self.fail("the assistant never finished")

    def say(self, text, *answers, demo=True):
        self.script = Script(*answers)
        with patch.object(ai_providers, "ask", self.script):
            ai_assistant.chat(self.tid, text, PRINTER, demo=demo)
            return self.wait()

    def decide(self, view, approve):
        with patch.object(ai_providers, "ask", self.script):
            ai_assistant.decide(self.tid, view["pending"]["n"], approve, PRINTER, demo=True)
            return self.wait()

    def steps(self, view):
        return [(m["tool"], m["status"]) for m in view["messages"] if m["role"] == "action"]


class TestConversation(Base):
    def test_a_safe_step_runs_and_the_model_hears_the_result(self):
        self.idle()
        view = self.say("home it", "Homing now. " + act("home", axes=["X", "Y"]), "Homed X and Y.")
        self.assertEqual(self.steps(view), [("home", "done")])
        self.assertEqual([m["text"] for m in view["messages"] if m["role"] == "assistant"],
                         ["Homing now.", "Homed X and Y."])
        self.assertIn("home: done", self.script.seen[1][-1]["text"])

    def test_heating_waits_for_a_yes_and_runs_only_after_it(self):
        view = self.say("warm T1", act("nozzle_temp", toolhead="T1", target=233), "Heating.")
        self.assertEqual(self.steps(view), [("nozzle_temp", "waiting")])
        self.assertEqual(view["pending"]["label"], "Set T1 to 233 °C")
        self.assertNotEqual(self.state()["toolheads"]["T1"]["target_temperature"], 233)
        view = self.decide(view, True)
        self.assertEqual(self.steps(view), [("nozzle_temp", "done")])
        self.assertEqual(self.state()["toolheads"]["T1"]["target_temperature"], 233)
        self.assertIsNone(view["pending"])

    def test_a_declined_step_sends_nothing_and_the_model_is_told(self):
        view = self.say("warm T1", act("nozzle_temp", toolhead="T1", target=233), "Left cold.")
        view = self.decide(view, False)
        self.assertEqual(self.steps(view), [("nozzle_temp", "declined")])
        self.assertNotEqual(self.state()["toolheads"]["T1"]["target_temperature"], 233)
        self.assertIn("The owner declined this step", self.script.seen[1][-1]["text"])

    def test_cooling_never_waits(self):
        view = self.say("cool", act("nozzle_temp", toolhead="T0", target=0), "Cooling.")
        self.assertEqual(self.steps(view), [("nozzle_temp", "done")])

    def test_steps_after_a_waiting_one_wait_too_and_keep_their_order(self):
        view = self.say("go", act("bed_temp", target=60) + act("fan", percent=30), "Both done.")
        self.assertEqual(self.steps(view), [("bed_temp", "waiting")])
        view = self.decide(view, True)
        self.assertEqual(self.steps(view), [("bed_temp", "done"), ("fan", "done")])

    def test_a_message_while_a_step_waits_is_refused(self):
        self.say("warm", act("bed_temp", target=60))
        with self.assertRaises(ValueError):
            ai_assistant.chat(self.tid, "another", PRINTER, demo=True)
        ai_assistant.stop(self.tid)
        self.assertIsNone(ai_assistant.view(self.tid)["pending"])

    def test_a_provider_failure_is_shown_in_words(self):
        with patch.object(ai_providers, "ask", side_effect=ai_providers.AIError("Groq refused the key (401).")):
            ai_assistant.chat(self.tid, "hi", PRINTER, demo=True)
            view = self.wait()
        self.assertEqual(view["messages"][-1]["role"], "error")
        self.assertIn("refused the key", view["messages"][-1]["text"])

    def test_a_runaway_model_is_stopped(self):
        view = self.say("loop", *[act("status")] * 20)
        self.assertLessEqual(len(self.steps(view)), ai_assistant.MAX_ROUNDS)
        self.assertEqual(view["messages"][-1]["role"], "note")

    def test_no_printer_means_no_figures_and_no_commands(self):
        view = self.say("status", act("status") + act("home"), "No printer.", demo=False)
        self.assertEqual(self.steps(view), [("status", "refused"), ("home", "refused")])
        self.assertIn("No printer is connected", self.script.systems[0])
        self.assertNotIn("The printer right now", self.script.seen[0][0]["text"])

    def test_readings_travel_with_the_message_so_the_instructions_never_change(self):
        self.idle()
        first = self.say("fan", act("fan", percent=30), "Done.")
        self.assertIsNotNone(first)
        self.assertIn("[The printer right now]", self.script.seen[0][0]["text"])
        self.assertIn("[Their message]\nfan", self.script.seen[0][0]["text"])
        systems = list(self.script.systems)
        self.say("fan again", act("fan", percent=60), "Done.")
        self.assertEqual(set(systems + self.script.systems), {systems[0]})
        self.assertNotIn('"heads"', systems[0])

    def test_the_owner_must_connect_an_ai_first(self):
        ai_assistant.reset()
        with self.assertRaises(ValueError):
            ai_assistant.chat(self.tid, "hi", PRINTER, demo=True)


class TestLimits(Base):
    def refused(self, view, tool="", n=0):
        row = [m for m in view["messages"] if m["role"] == "action"][n]
        self.assertEqual(row["status"], "refused", row)
        return row["detail"]

    def test_five_hundred_degrees_is_refused_in_every_mode(self):
        for mode in ("ask", "balanced", "free"):
            ai_assistant.select(mode=mode)
            ai_assistant.clear(self.tid)
            view = self.say("hot", act("nozzle_temp", toolhead="T0", target=500))
            if view["pending"]:
                view = self.decide(view, True)
            self.assertIn("between 0 and 300", self.refused(view), mode)
            self.assertLessEqual(self.state()["toolheads"]["T0"]["target_temperature"], 300)

    def test_the_nozzle_is_kept_off_the_bed(self):
        self.idle()
        view = self.say("down", act("home") + act("move_to", z=0.2) + act("move_by", axis="Z", distance=-250))
        self.assertIn("at least 2 mm above the bed", self.refused(view, n=1))
        self.assertIn("at least 2 mm above the bed", self.refused(view, n=2))

    def test_a_move_outside_the_printer_is_refused(self):
        self.idle()
        view = self.say("far", act("home") + act("move_to", x=900))
        self.assertIn("X must be between 0 and 270", self.refused(view, n=1))

    def test_nothing_moves_through_a_running_print(self):
        self.assertEqual(self.state()["state"], "printing")
        view = self.say("move", act("move_to", x=10) + act("home"))
        self.assertIn("waits until the print finishes", self.refused(view))

    def test_typed_gcode_is_read_only(self):
        for command in ("G1 Z0 F9000", "M104 S500", "SAVE_CONFIG", "M112", "M114\nG28", "FIRMWARE_RESTART"):
            with self.assertRaises(ai_assistant.Refused, msg=command):
                ai_assistant._gcode(command)
        with mock_moonraker.selection_only(PRINTER):
            ai_assistant._gcode("M114")

    def test_it_cannot_start_a_print_only_open_confirm_print(self):
        self.idle()
        file_library.add_samples()
        name = next(f["name"] for f in ai_assistant._files() if f["name"].endswith(".gcode"))
        view = self.say("print it", act("start_print", filename=name))
        row = [m for m in view["messages"] if m["role"] == "action"][0]
        self.assertEqual({k: row["handoff"][k] for k in ("kind", "filename", "place")},
                         {"kind": "confirm_print", "filename": name, "place": None})
        self.assertNotEqual(self.state()["state"], "printing")

    def test_cancelling_a_print_asks_even_in_the_most_hands_on_mode(self):
        ai_assistant.select(mode="free")
        view = self.say("cancel", act("cancel_print"))
        self.assertEqual(self.steps(view), [("cancel_print", "waiting")])
        self.assertEqual(self.state()["state"], "printing")

    def test_advice_only_sends_nothing_and_hides_the_tools_that_change_things(self):
        ai_assistant.select(mode="advice")
        view = self.say("fan", act("fan", percent=80) + act("status"))
        self.assertEqual(self.steps(view), [("fan", "refused"), ("status", "done")])
        self.assertNotIn("- fan:", self.script.systems[0])
        self.assertIn("- status:", self.script.systems[0])

    def test_ask_mode_asks_for_every_change(self):
        ai_assistant.select(mode="ask")
        view = self.say("fan", act("fan", percent=20))
        self.assertEqual(self.steps(view), [("fan", "waiting")])

    def test_one_request_carries_out_a_limited_number_of_steps(self):
        view = self.say("spam", "".join(act("fan", percent=10 + i) for i in range(ai_assistant.MAX_ACTIONS + 3)))
        done = [s for s in self.steps(view) if s[1] == "done"]
        self.assertEqual(len(done), ai_assistant.MAX_ACTIONS)

    def test_watch_only_holds_a_real_printer(self):
        with patch.object(mock_moonraker, "is_real", return_value=True), patch.object(watch_only, "is_on", return_value=True):
            with self.assertRaises(ai_assistant.Refused) as caught:
                ai_assistant._check_allowed("fan", {"printer": PRINTER, "live": True, "demo": False})
            self.assertIn("Watch-only", str(caught.exception))
            ai_assistant._check_allowed("emergency_stop", {"printer": PRINTER, "live": True, "demo": False})

    def test_printer_control_switched_off_stops_every_command(self):
        modules.set_enabled("printer_control", False)
        view = self.say("fan", act("fan", percent=20))
        self.assertIn("Printer control is switched off", self.refused(view))

    def test_an_unknown_tool_or_broken_block_is_a_refusal_not_a_crash(self):
        view = self.say("x", act("format_disk") + "```action\n{not json```" + act("fan", percent="lots"))
        self.assertEqual(view["messages"][-1]["role"], "assistant")
        self.assertIn("There is no tool called format_disk", self.script.seen[1][-1]["text"])
        self.assertIn("wasn't valid JSON", self.script.seen[1][-1]["text"])


class TestModels(Base):
    def setUp(self):
        super().setUp()
        file_library.reset()
        self.addCleanup(file_library.reset)

    def test_it_makes_a_shape_and_edits_a_copy_without_touching_the_original(self):
        made = ai_assistant._make_shape("box", width=20, depth=10, height=5, name="block")
        self.assertEqual(made["size_mm"], [20, 10, 5])
        before = file_library.read_bytes(made["saved_as"])
        edited = ai_assistant._edit_model(made["saved_as"], fit_mm=40, rotate_axis="Z", rotate_degrees=90, mirror="X")
        self.assertNotEqual(edited["saved_as"], made["saved_as"])
        self.assertEqual(edited["size_mm"], [20, 40, 10])
        self.assertEqual(file_library.read_bytes(made["saved_as"]), before)
        info = ai_assistant._model_info(edited["saved_as"])
        self.assertEqual(info["lowest_z"], 0)

    def test_a_cylinder_and_a_cone_are_closed_solids(self):
        for shape, faces in (("cylinder", 4 * 12), ("cone", 2 * 12)):
            made = ai_assistant._make_shape(shape, diameter=10, height=10, segments=12)
            self.assertEqual(made["triangles"], faces)

    def test_silly_sizes_are_refused(self):
        with self.assertRaises(ValueError):
            ai_assistant._make_shape("box", width=5000)
        with self.assertRaises(ValueError):
            ai_assistant._make_shape("teapot")


def serve(handler):
    server = HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"


class Recorder(BaseHTTPRequestHandler):
    seen = []
    reply = {}
    status = 200

    def _answer(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        Recorder.seen.append((self.command, self.path, dict(self.headers), body))
        reply = Recorder.reply(self.path) if callable(Recorder.reply) else Recorder.reply
        raw = json.dumps(reply).encode()
        self.send_response(Recorder.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = _answer

    def log_message(self, *args):
        pass


class TestProviders(unittest.TestCase):
    KEY = "sk-test-0123456789abcdefXYZ9"

    def setUp(self):
        ai_providers.reset()
        self.addCleanup(ai_providers.reset)
        Recorder.seen, Recorder.status = [], 200
        self.server, self.base = serve(Recorder)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def point(self, pid):
        return patch.dict(ai_providers._BY_ID[pid], {"base": self.base})

    def test_there_are_29_key_services_and_two_subscriptions(self):
        kinds = [p["kind"] for p in ai_providers.PROVIDERS]
        self.assertEqual(kinds.count("key"), 29)
        self.assertNotIn("github", ai_providers._BY_ID)                 # retired by GitHub on 30 July 2026
        self.assertEqual([p["id"] for p in ai_providers.PROVIDERS if p["kind"] == "cli"], ["claude-code", "codex"])
        self.assertEqual(len({p["id"] for p in ai_providers.PROVIDERS}), len(ai_providers.PROVIDERS))
        for p in ai_providers.PROVIDERS:
            if p["kind"] == "key":
                self.assertTrue(p["base"].startswith("https://"), p["id"])
                self.assertTrue(p["key_url"].startswith("https://"), p["id"])

    def test_the_chat_completions_format(self):
        Recorder.reply = {"choices": [{"message": {"role": "assistant", "content": "hello there"}}]}
        ai_providers.save_key("openai", self.KEY)
        with self.point("openai"):
            answer = ai_providers.ask("openai", "some-model", "SYSTEM", [
                {"role": "user", "text": "one"}, {"role": "assistant", "text": "two"},
                {"role": "user", "text": "three", "images": [("image/jpeg", "QUJD")]}])
        self.assertEqual(answer, "hello there")
        method, path, headers, body = Recorder.seen[0]
        self.assertEqual((method, path), ("POST", "/chat/completions"))
        self.assertEqual(headers["Authorization"], "Bearer " + self.KEY)
        self.assertEqual(body["model"], "some-model")
        self.assertEqual(body["messages"][0], {"role": "system", "content": "SYSTEM"})
        self.assertEqual(body["messages"][3]["content"][1]["image_url"]["url"], "data:image/jpeg;base64,QUJD")

    def test_the_anthropic_format(self):
        Recorder.reply = {"stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""},
                                                                 {"type": "text", "text": "hello"}]}
        ai_providers.save_key("anthropic", self.KEY)
        with self.point("anthropic"):
            answer = ai_providers.ask("anthropic", "", "SYSTEM", [
                {"role": "user", "text": "look", "images": [("image/jpeg", "QUJD")]}])
        self.assertEqual(answer, "hello")
        _, path, headers, body = Recorder.seen[0]
        headers = {k.lower(): v for k, v in headers.items()}
        self.assertEqual(path, "/messages")
        self.assertEqual(headers["x-api-key"], self.KEY)
        self.assertEqual(headers["anthropic-version"], "2026-10-21")
        self.assertEqual(body["model"], "claude-opus-5-5")
        self.assertEqual(body["system"], "SYSTEM")
        self.assertEqual(body["messages"][0]["content"][0]["source"], {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"})
        self.assertNotIn("temperature", body)
        self.assertNotIn("thinking", body)
        self.assertEqual(body["cache_control"], {"type": "ephemeral"})

    def test_a_declined_answer_is_said_in_words(self):
        Recorder.reply = {"stop_reason": "refusal", "content": []}
        ai_providers.save_key("anthropic", self.KEY)
        with self.point("anthropic"), self.assertRaises(ai_providers.AIError) as caught:
            ai_providers.ask("anthropic", "", "S", [{"role": "user", "text": "x"}])
        self.assertIn("declined", str(caught.exception))

    def test_errors_explain_themselves_and_never_repeat_the_key(self):
        ai_providers.save_key("groq", self.KEY)
        Recorder.reply = {"error": {"message": f"Invalid API Key {self.KEY}"}}
        for status, words in ((401, "refused the key"), (402, "no credit"), (404, "doesn't know that model"),
                              (429, "too many requests"), (503, "problem on its side")):
            Recorder.status = status
            with self.point("groq"), self.assertRaises(ai_providers.AIError) as caught:
                ai_providers.ask("groq", "m", "S", [{"role": "user", "text": "x"}])
            self.assertIn(words, str(caught.exception))
            self.assertNotIn(self.KEY, str(caught.exception))

    def test_the_model_list_comes_from_the_service_with_non_chat_models_left_out(self):
        Recorder.reply = {"data": [{"id": "gpt-9"}, {"id": "gpt-9-mini"}, {"id": "text-embedding-3"}, {"id": "whisper-2"}]}
        ai_providers.save_key("openai", self.KEY)
        with self.point("openai"):
            listed = ai_providers.list_models("openai")
        self.assertEqual(listed["models"], ["gpt-9", "gpt-9-mini"])
        self.assertIn(listed["suggested"], listed["models"])

    def test_a_key_never_reaches_the_browser_a_log_or_a_backup(self):
        ai_providers.save_key("openai", self.KEY)
        shown = json.dumps(ai_assistant.status())
        self.assertNotIn(self.KEY, shown)
        self.assertIn("\\u2026XYZ9", shown)
        with open(ai_providers._KEYS_PATH) as handle:
            saved = json.load(handle)
        omitted = []
        cleaned = backup._clean(saved, "ai_keys.json", omitted)
        self.assertEqual(cleaned["openai"]["api_key"], "")
        self.assertEqual(omitted, ["ai_keys.json: openai.api_key"])
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(os.stat(ai_providers._KEYS_PATH).st_mode), 0o600)

    def test_bad_keys_and_addresses_are_refused(self):
        for key in ("", "has space", "line\nbreak"):
            with self.assertRaises(ValueError):
                ai_providers.save_key("openai", key)
        with self.assertRaises(ValueError):
            ai_providers.save_key("custom", "", "ftp://nope")
        with self.assertRaises(ValueError):
            ai_providers.save_key("claude-code", "x")
        with self.assertRaises(ValueError):
            ai_providers.save_key("nope", "x")

    def test_a_model_on_this_computer_needs_no_key(self):
        Recorder.reply = {"choices": [{"message": {"content": "local"}}]}
        ai_providers.save_key("ollama", "", self.base)
        self.assertEqual(ai_providers.ask("ollama", "m", "S", [{"role": "user", "text": "x"}]), "local")
        self.assertNotIn("Authorization", Recorder.seen[0][2])
        ai_providers.forget("ollama")
        self.assertFalse(ai_providers.describe("ollama").get("has_key"))


FAKE_CLAUDE = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys
    args = sys.argv[1:]
    if args[:2] == ["auth", "status"]:
        print(json.dumps({"loggedIn": not os.environ.get("FAKE_AI_FAIL")})); sys.exit(0)
    if args == ["--version"]:
        print("9.9.9 (Claude Code)"); sys.exit(0)
    rules = open(args[args.index("--system-prompt-file") + 1]).read() if "--system-prompt-file" in args else ""
    json.dump({"args": args, "stdin": sys.stdin.read(), "cwd": os.listdir("."), "rules": rules}, open(os.environ["FAKE_AI_LOG"], "w"))
    if os.environ.get("FAKE_AI_FAIL"):
        print(json.dumps({"type": "result", "is_error": True, "result": "Not logged in"})); sys.exit(1)
    result = {"type": "result", "is_error": False, "result": "from the plan", "total_cost_usd": 0.0123,
              "usage": {"input_tokens": 40, "cache_read_input_tokens": 60, "output_tokens": 7},
              "modelUsage": {"claude-test-9": {}}}
    if "stream-json" in args:
        print(json.dumps({"type": "system", "subtype": "init"}))
    print(json.dumps(result))
''')
FAKE_CODEX = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys
    args = sys.argv[1:]
    if args == ["login", "status"]:
        print("Not logged in" if os.environ.get("FAKE_AI_FAIL") else "Logged in using ChatGPT")
        sys.exit(1 if os.environ.get("FAKE_AI_FAIL") else 0)
    if args == ["--version"]:
        print("codex-cli 9.9.9"); sys.exit(0)
    if args == ["debug", "models"]:
        print(json.dumps({"models": [
            {"slug": "gpt-9-work", "display_name": "GPT-9 Work", "description": "Everyday work.", "visibility": "list", "priority": 2},
            {"slug": "gpt-9-top", "display_name": "GPT-9 Top", "description": "The most demanding work.", "visibility": "list", "priority": 1},
            {"slug": "internal-review", "visibility": "hide", "priority": 0}]})); sys.exit(0)
    pictures = [os.path.getsize(args[i + 1]) for i, a in enumerate(args) if a == "-i"]
    json.dump({"args": args, "stdin": sys.stdin.read(), "pictures": pictures}, open(os.environ["FAKE_AI_LOG"], "w"))
    sys.stderr.write("progress...\\n")
    if os.environ.get("FAKE_AI_FAIL"):
        sys.stderr.write("not signed in\\n"); sys.exit(1)
    if os.environ.get("FAKE_AI_STDOUT"):
        print("from chatgpt"); sys.exit(0)
    open(args[args.index("-o") + 1], "w").write("from chatgpt")
    print("noise that is not the answer")
''')


@unittest.skipIf(os.name != "posix", "the stand-in programs are shell scripts")
class TestSubscriptions(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dv-ai-")
        for name, text in (("claude", FAKE_CLAUDE), ("codex", FAKE_CODEX)):
            path = os.path.join(self.dir, name)
            with open(path, "w") as handle:
                handle.write(text)
            os.chmod(path, 0o755)
        self.log = os.path.join(self.dir, "log.json")
        env = patch.dict(os.environ, {"PATH": self.dir + os.pathsep + os.environ["PATH"], "FAKE_AI_LOG": self.log})
        env.start()
        self.addCleanup(env.stop)
        self.messages = [{"role": "user", "text": "home it"}, {"role": "assistant", "text": "ok"},
                         {"role": "user", "text": "now cool"}]

    def read_log(self):
        with open(self.log) as handle:
            return json.load(handle)

    def test_claude_code_runs_with_its_own_tools_off_in_an_empty_folder(self):
        answer = ai_providers.ask("claude-code", "", "SYSTEM RULES", self.messages)
        self.assertEqual(answer, "from the plan")
        seen = self.read_log()
        args = seen["args"]
        self.assertEqual(args[args.index("--tools") + 1], "")
        self.assertEqual(seen["rules"], "SYSTEM RULES")
        self.assertNotIn("SYSTEM RULES", " ".join(args))
        for flag in ("-p", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"):
            self.assertIn(flag, args)
        self.assertNotIn("--model", args)
        self.assertEqual(seen["cwd"], ["instructions.txt"])
        self.assertIn("Owner: now cool", seen["stdin"])
        self.assertTrue(ai_providers.describe("claude-code")["installed"])

    def test_codex_reads_the_request_from_standard_input(self):
        answer = ai_providers.ask("codex", "", "SYSTEM RULES", self.messages)
        self.assertEqual(answer, "from chatgpt")
        seen = self.read_log()
        self.assertEqual(seen["args"][:5], ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only"])
        self.assertEqual(seen["args"][-1], "-")
        self.assertNotIn("-m", seen["args"])
        self.assertIn("SYSTEM RULES", seen["stdin"])

    def test_not_signed_in_says_what_to_do(self):
        with patch.dict(os.environ, {"FAKE_AI_FAIL": "1"}):
            for pid, words in (("claude-code", "claude auth login"), ("codex", "codex login")):
                with self.assertRaises(ai_providers.AIError) as caught:
                    ai_providers.ask(pid, "", "S", self.messages)
                self.assertIn(words, str(caught.exception))

    def test_the_plan_reports_what_it_used(self):
        answer = ai_providers.ask("claude-code", "opus", "S", self.messages)
        self.assertEqual(answer.usage, {"model": "claude-test-9", "in": 100, "out": 7, "cost_usd": 0.0123})
        self.assertEqual(self.read_log()["args"][-2:], ["--model", "opus"])

    def test_a_camera_picture_reaches_both_plans(self):
        look = self.messages + [{"role": "user", "text": "results", "images": [("image/jpeg", "QUJD")]}]
        self.assertEqual(ai_providers.ask("claude-code", "", "S", look), "from the plan")
        seen = self.read_log()
        self.assertIn("stream-json", seen["args"])
        sent = json.loads(seen["stdin"])
        self.assertEqual(sent["message"]["content"][0]["source"], {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"})
        self.assertIn("Owner: results", sent["message"]["content"][1]["text"])
        self.assertEqual(ai_providers.ask("codex", "gpt-9-top", "S", look), "from chatgpt")
        seen = self.read_log()
        self.assertEqual(seen["pictures"], [3])
        self.assertEqual(seen["args"][seen["args"].index("-m") + 1], "gpt-9-top")

    def test_codex_answers_on_standard_output_are_read_too(self):
        with patch.dict(os.environ, {"FAKE_AI_STDOUT": "1"}):
            self.assertEqual(ai_providers.ask("codex", "", "S", self.messages), "from chatgpt")

    def test_the_sign_in_check_uses_each_programs_own_status_command(self):
        for pid, version in (("claude-code", "9.9.9 (Claude Code)"), ("codex", "codex-cli 9.9.9")):
            row = ai_providers.check(pid)
            self.assertEqual((row["installed"], row["signed_in"], row["version"]), (True, True, version))
            with patch.dict(os.environ, {"FAKE_AI_FAIL": "1"}):
                self.assertIs(ai_providers.check(pid)["signed_in"], False)
        with self.assertRaises(ValueError):
            ai_providers.check("openai")

    def test_each_plan_lists_its_own_models(self):
        codex = ai_providers.list_models("codex", refresh=True)
        self.assertEqual(codex["models"], ["gpt-9-top", "gpt-9-work"])
        self.assertTrue(codex["optional"])
        claude = ai_providers.list_models("claude-code", refresh=True)
        self.assertEqual(claude["models"], ["fable", "opus", "sonnet", "haiku"])
        self.assertEqual(claude["suggested"], "")

    def test_a_program_outside_the_path_is_still_found(self):
        python = os.path.dirname(sys.executable)          # the stand-in needs python, and nothing else, on the PATH
        with patch.dict(os.environ, {"PATH": python}), patch.object(ai_providers, "_places", return_value=[self.dir]):
            self.assertTrue(ai_providers.describe("claude-code")["installed"])
            self.assertEqual(ai_providers.ask("claude-code", "", "S", self.messages), "from the plan")

    def test_a_missing_program_says_so(self):
        with patch.dict(os.environ, {"PATH": "/nonexistent"}):
            self.assertFalse(ai_providers.describe("codex")["installed"])
            with self.assertRaises(ai_providers.AIError) as caught:
                ai_providers.ask("codex", "", "S", self.messages)
        self.assertIn("isn't installed", str(caught.exception))


class TestApprovals(Base):
    """Out of the box the assistant works freely and asks only before it ends a print early."""

    def setUp(self):
        super().setUp()
        ai_assistant.select(mode=ai_assistant.DEFAULT_MODE)

    def test_the_default_lets_it_home_heat_and_move_without_asking(self):
        self.assertEqual(ai_assistant.status()["mode"], "free")
        self.idle()
        view = self.say("get ready", act("home") + act("bed_temp", target=60) + act("nozzle_temp", toolhead="T0", target=210)
                        + act("move_to", x=100, y=100, z=20), "Ready.")
        self.assertEqual(self.steps(view), [("home", "done"), ("bed_temp", "done"), ("nozzle_temp", "done"), ("move_to", "done")])
        self.assertIsNone(view["pending"])
        self.assertEqual(self.state()["toolheads"]["T0"]["target_temperature"], 210)

    def test_ending_a_print_early_is_the_one_thing_it_asks_about(self):
        for tool, args in (("cancel_print", {}), ("skip_object", {"name": "BENCHY_1"})):
            ai_assistant.clear(self.tid)
            view = self.say("stop that", act(tool, **args))
            self.assertEqual(self.steps(view), [(tool, "waiting")], tool)
            ai_assistant.stop(self.tid)
        self.assertEqual(self.state()["state"], "printing")

    def test_no_approvals_never_asks_and_the_limits_still_hold(self):
        ai_assistant.select(mode="open")
        view = self.say("cancel and overheat", act("nozzle_temp", toolhead="T0", target=500) + act("cancel_print"), "Cancelled.")
        self.assertEqual(self.steps(view), [("nozzle_temp", "refused"), ("cancel_print", "done")])
        self.assertNotEqual(self.state()["state"], "printing")

    def test_dont_ask_again_is_remembered_shown_and_can_be_taken_back(self):
        ai_assistant.select(mode="ask")
        view = self.say("fan", act("fan", percent=20))
        self.assertEqual(self.steps(view), [("fan", "waiting")])
        with patch.object(ai_providers, "ask", self.script):
            ai_assistant.decide(self.tid, view["pending"]["n"], True, PRINTER, demo=True, always=True)
            self.wait()
        self.assertEqual([row["tool"] for row in ai_assistant.status()["never_ask"]], ["fan"])
        ai_assistant.clear(self.tid)
        view = self.say("fan again", act("fan", percent=40) + act("speed", percent=90))
        self.assertEqual(self.steps(view), [("fan", "done"), ("speed", "waiting")])
        ai_assistant.stop(self.tid)
        ai_assistant.select(never_ask=[])
        self.assertEqual(ai_assistant.status()["never_ask"], [])

    def test_a_decline_with_dont_ask_again_changes_nothing(self):
        ai_assistant.select(mode="ask")
        view = self.say("fan", act("fan", percent=20))
        with patch.object(ai_providers, "ask", self.script):
            ai_assistant.decide(self.tid, view["pending"]["n"], False, PRINTER, demo=True, always=True)
            self.wait()
        self.assertEqual(ai_assistant.status()["never_ask"], [])

    def test_every_tool_has_a_level_a_label_and_a_place_in_the_rules(self):
        for name, tool in ai_assistant.TOOLS.items():
            self.assertIn(tool["level"], ("read", "safe", "ask", "handoff", "proposal"), name)
            self.assertTrue(ai_assistant._label(name, {}), name)
            self.assertFalse(ai_assistant._needs_yes(name, {}, "open"), name)
            if tool["level"] in ("read", "handoff", "proposal"):
                self.assertFalse(ai_assistant._needs_yes(name, {}, "ask"), name)
        for name in ai_assistant.HIGH_STAKES:
            self.assertTrue(ai_assistant._needs_yes(name, {}, "free"), name)


class TestConnections(Base):
    """Several AIs connected at once: a Claude plan, a ChatGPT plan and keys, with one in use."""

    def connect(self, pid):
        with patch.object(ai_providers, "ask", return_value="ready"):
            return ai_assistant.test(pid)

    def test_each_connection_stays_and_the_owner_switches_between_them(self):
        ai_providers.save_key("openai", "sk-test-0123456789abcdef")
        with patch.object(ai_providers, "_program", return_value="/usr/bin/true"):
            self.assertFalse(self.connect("codex")["first"] is False)
            status = self.connect("openai")
            self.assertEqual([c["id"] for c in status["connections"]], ["claude-code", "codex", "openai"])
            self.assertEqual(status["provider"], "openai")
            status = ai_assistant.select(provider="claude-code")
            self.assertTrue(status["ready"])
            self.assertEqual(status["provider"], "claude-code")
            status = ai_assistant.select(provider="openai", model="gpt-9")
            self.assertEqual((status["provider"], status["model"]), ("openai", "gpt-9"))
            self.assertEqual(ai_assistant.select(provider="codex", model="gpt-9-top")["models"]["codex"], "gpt-9-top")

    def test_the_first_connection_is_marked_once_for_the_welcome(self):
        ai_providers.save_key("groq", "gsk-test-0123456789abcdef")
        self.assertTrue(self.connect("groq")["first"])
        self.assertFalse(self.connect("groq")["first"])

    def test_an_untested_ai_is_not_in_use_until_its_check_passes(self):
        ai_providers.save_key("mistral", "mk-test-0123456789abcdef")
        status = ai_assistant.select(provider="mistral", model="mistral-large-9")
        self.assertEqual(status["provider"], "claude-code")
        self.assertEqual(status["models"]["mistral"], "mistral-large-9")
        self.assertTrue(status["ready"])

    def test_forgetting_the_one_in_use_falls_back_to_another(self):
        ai_providers.save_key("openai", "sk-test-0123456789abcdef")
        self.connect("openai")
        with patch.object(ai_providers, "_program", return_value="/usr/bin/true"):
            status = ai_assistant.forget("openai")
            self.assertEqual(status["provider"], "claude-code")
            self.assertTrue(status["ready"])
            status = ai_assistant.forget("claude-code")
        self.assertFalse(status["ready"])
        self.assertEqual(status["connections"], [])

    def test_a_connection_to_a_retired_service_is_dropped_quietly(self):
        ai_assistant.storage.save_json(ai_assistant._SETTINGS_PATH, {"provider": "github", "tested": {"github": 1, "claude-code": 1},
                                                                    "models": {"github": "openai/gpt-9"}})
        status = ai_assistant.status()
        self.assertEqual(status["provider"], "claude-code")
        self.assertTrue(status["ready"])
        self.assertEqual([c["id"] for c in status["connections"]], ["claude-code"])

    def test_a_saved_setup_from_the_first_version_still_works(self):
        ai_assistant.storage.save_json(ai_assistant._SETTINGS_PATH, {"provider": "claude-code", "tested": "claude-code",
                                                                    "mode": "balanced", "models": {}})
        with patch.object(ai_providers, "_program", return_value="/usr/bin/true"):
            status = ai_assistant.status()
        self.assertTrue(status["ready"])
        self.assertEqual(status["mode"], "balanced")

    def test_the_tokens_a_service_reports_are_added_up_and_nothing_is_estimated(self):
        def answer(text, tokens_in, tokens_out, cost=None):
            reply = ai_providers.Reply(text)
            reply.usage = {"model": "claude-test-9", "in": tokens_in, "out": tokens_out, "cost_usd": cost}
            return reply
        self.idle()
        view = self.say("home", answer(act("home"), 900, 30, 0.01), answer("Homed.", 1000, 12, 0.02))
        self.assertEqual(view["usage"], {"answers": 2, "in": 1900, "out": 42, "counted": 2, "cost_usd": 0.03,
                                         "model": "claude-test-9"})
        ai_assistant.clear(self.tid)
        view = self.say("hi", "Plain text with no usage.")
        self.assertEqual((view["usage"]["answers"], view["usage"]["counted"], view["usage"]["in"]), (1, 0, 0))


def closed(triangles):
    """Every edge is used once in each direction: a watertight solid with its faces outward."""
    edges = {}
    for t in triangles:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            key = (tuple(round(v, 6) for v in a), tuple(round(v, 6) for v in b))
            edges[key] = edges.get(key, 0) + 1
    return all(n == 1 and edges.get((b, a)) == 1 for (a, b), n in edges.items())


def volume(triangles):
    return sum(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
               for a, b, c in triangles) / 6


def priced(text, tokens_in, tokens_out, cost=None):
    reply = ai_providers.Reply(text)
    reply.usage = {"model": "maker/model-9", "in": tokens_in, "out": tokens_out, "cost_usd": cost}
    return reply


class TestCosts(Base):
    def use_openrouter(self, listed=True):
        ai_providers.save_key("openrouter", "sk-or-test-0123456789abcdef")
        rows = [{"id": "maker/model-9", "in_per_million": 3.0, "out_per_million": 15.0}] if listed else []
        ai_providers._models["openrouter"] = {"at": time.time(), "body": {"rows": rows}}
        ai_assistant.select(provider="openrouter", model="maker/model-9")
        with patch.object(ai_providers, "ask", return_value="ready"):
            ai_assistant.test("openrouter")

    def test_a_plan_or_a_local_ai_costs_nothing_per_message(self):
        self.assertEqual(ai_assistant.estimate(self.tid, "hello")["price"], {"charge": "plan"})
        self.assertEqual(ai_assistant._price_row("ollama", "llama9"), {"charge": "none"})

    def test_before_the_first_answer_the_text_is_counted_and_called_an_estimate(self):
        self.use_openrouter()
        guess = ai_assistant.estimate(self.tid, "x" * 400, PRINTER, demo=True)
        self.assertEqual(guess["basis"], "estimate")
        self.assertEqual(guess["price"], {"charge": "tokens", "in": 3.0, "out": 15.0, "from": "service"})
        system = len(ai_assistant._system(ai_assistant._ctx(PRINTER, True), ai_assistant._settings()["mode"]))
        self.assertEqual(guess["tokens_in"], -(-(system + 400 + ai_assistant.STATE_CHARS + 20) // 4))
        self.assertIsNone(guess["tokens_out"])                 # unknown until the service has answered once
        self.assertAlmostEqual(guess["cost_usd"], guess["tokens_in"] * 3 / 1e6)

    def test_after_an_answer_the_services_own_count_is_the_starting_point(self):
        self.use_openrouter()
        self.say("hi", priced("Hello there.", 5000, 40))
        guess = ai_assistant.estimate(self.tid, "and again", PRINTER, demo=True)
        self.assertEqual(guess["basis"], "reported")
        self.assertEqual(guess["tokens_out"], 40)
        self.assertGreater(guess["tokens_in"], 5000)
        self.assertEqual(guess["answers_per_request"], 1)
        self.assertEqual(ai_assistant.view(self.tid)["usage"]["priced_usd"], round(5000 * 3 / 1e6 + 40 * 15 / 1e6, 6))

    def test_without_a_listed_price_the_owners_own_price_is_used_and_nothing_is_guessed(self):
        self.use_openrouter(listed=False)
        guess = ai_assistant.estimate(self.tid, "hello")
        self.assertEqual((guess["price"], guess["cost_usd"]), ({"charge": "unknown"}, None))
        status = ai_assistant.budget(price_in=1.25, price_out=10)
        self.assertEqual(status["price"], {"charge": "tokens", "in": 1.25, "out": 10, "from": "yours"})
        self.assertIsNotNone(ai_assistant.estimate(self.tid, "hello")["cost_usd"])
        self.assertEqual(ai_assistant.budget(clear_price=True)["price"], {"charge": "unknown"})
        with self.assertRaises(ValueError):
            ai_assistant.budget(price_in=-1, price_out=2)

    def test_a_spending_limit_refuses_a_message_that_would_pass_it(self):
        self.use_openrouter()
        self.assertEqual(ai_assistant.budget(cap_usd=0.0001)["cap_usd"], 0.0001)
        with self.assertRaises(ValueError) as caught:
            self.say("hello", "Hi.")
        self.assertIn("more than your limit of $0.0001", str(caught.exception))
        self.assertIsNone(ai_assistant.budget(cap_usd=0)["cap_usd"])

    def test_a_spending_limit_stops_between_rounds_of_steps(self):
        self.use_openrouter()
        ai_assistant.budget(cap_usd=0.05)
        self.idle()
        view = self.say("home", priced(act("home"), 1000, 30, 0.03), priced("Homed.", 1000, 12, 0.03))
        self.assertIn("another answer would pass it", view["messages"][-1]["text"])
        self.assertEqual(view["usage"]["answers"], 1)
        self.assertEqual(self.steps(view), [("home", "done")])


class TestSlicing(Base):
    def job(self, **fields):
        base = {"id": "job12345", "model": "cube.stl", "profile": "U1 PLA", "status": "done", "step": "Sliced",
                "report": {"files": [{"name": "cube_plate_1.gcode", "layers": 50, "estimated_hours": 0.4,
                                      "filament_grams": 7.5, "preflight": "ok", "deposition": None}]}}
        base.update(fields)
        return base

    def test_it_slices_a_model_and_reports_the_slicers_own_figures(self):
        with patch.object(ai_assistant.slicer_bridge, "start_job", return_value=self.job(status="waiting")) as start, \
                patch.object(ai_assistant.slicer_bridge, "wait", return_value=self.job()):
            ok, result = ai_assistant._carry_out("slice", {"name": "cube.stl", "profile": "p1"}, ai_assistant._ctx(PRINTER, True))
        self.assertTrue(ok)
        start.assert_called_once_with("cube.stl", "p1")
        self.assertEqual(result["files"][0], {"name": "cube_plate_1.gcode", "layers": 50, "estimated_hours": 0.4,
                                              "filament_grams": 7.5, "preflight": "ok"})
        self.assertIn("start_print", result["note"])

    def test_a_long_slice_hands_back_a_job_to_check_and_a_failure_is_refused_in_words(self):
        with patch.object(ai_assistant.slicer_bridge, "start_job", return_value=self.job(status="waiting")), \
                patch.object(ai_assistant.slicer_bridge, "wait", return_value=self.job(status="running", step="Slicing")):
            ok, result = ai_assistant._carry_out("slice", {"name": "cube.stl"}, ai_assistant._ctx(PRINTER, True))
        self.assertEqual((ok, result["status"], result["job"]), (True, "still slicing", "job12345"))
        failed = self.job(status="failed", error="The engine stopped", cause={"title": "Missing filament profile"})
        with patch.object(ai_assistant.slicer_bridge, "get_job", return_value=failed):
            ok, result = ai_assistant._carry_out("slice_status", {"job": "job12345"}, ai_assistant._ctx(PRINTER, True))
        self.assertFalse(ok)
        self.assertEqual(result["refused"], "The engine stopped (Missing filament profile)")

    def test_slicing_switched_off_is_refused(self):
        modules.set_enabled("auto_print", False)
        ok, result = ai_assistant._carry_out("slice", {"name": "cube.stl"}, ai_assistant._ctx(PRINTER, True))
        self.assertFalse(ok)
        self.assertIn("Slicing is switched off", result["refused"])

    def test_the_instructions_describe_the_path_from_model_to_confirm_print(self):
        system = ai_assistant._system(ai_assistant._ctx(PRINTER, True), "free")
        for words in ("- slice:", "- slicer_profiles:", "slice it", "start_print opens Confirm Print", "make_shape outline"):
            self.assertIn(words, system)
        self.assertLess(len(system), 14000)


class FakeJpeg:
    data = b"\xff\xd8\xff" + b"0" * 64


class TestPrintWatch(Base):
    def setUp(self):
        super().setUp()
        for book in ("log", "last", "first", "pictures"):
            ai_assistant._watch[book].clear()
        self.waited = []
        self.state = {"state": "printing", "printer_name": "Workshop U1", "current_file": "bracket.gcode", "progress": 0.4}
        self.picture = (FakeJpeg.data, "image/jpeg")
        self.paused = []
        from contextlib import contextmanager

        @contextmanager
        def use(pid):
            yield None
        for target, value in ((mock_moonraker, {"real_printer_ids": lambda: ["real-1"], "use_printer": use,
                                                "get_printer_state": lambda: self.state,
                                                "camera_snapshot": lambda: self.picture,
                                                "is_real": lambda pid: pid == "real-1",
                                                "is_connected": lambda pid=None: True}),
                              (ai_assistant.printer_control, {"pause_print": lambda: self.paused.append(1) or {"ok": True}})):
            for name, fn in value.items():
                patcher = patch.object(target, name, fn)
                patcher.start()
                self.addCleanup(patcher.stop)

    def tick(self, *answers, now=1000.0, due=True):
        """One pass. `due` makes the check due now (a print's first check comes after the interval)."""
        if due:
            ai_assistant._watch["last"].setdefault("real-1", -10 ** 6)
        self.asked = Script(*answers)
        with patch.object(ai_providers, "ask", self.asked):
            return ai_assistant.watch_tick(now, wait=self.waited.append)

    def test_it_does_nothing_until_switched_on(self):
        self.assertEqual(self.tick('{"verdict": "failed", "why": "x"}'), [])
        self.assertEqual(self.asked.seen, [])
        self.assertFalse(ai_assistant.status()["watch"]["on"])

    def test_a_check_sends_one_picture_and_records_the_verdict(self):
        ai_assistant.watch_settings(on=True, minutes=10)
        made = self.tick('Looks fine. {"verdict": "ok", "why": "Clean layers."}')
        self.assertEqual([(m["verdict"], m["why"], m["paused"]) for m in made], [("ok", "Clean layers.", False)])
        sent = self.asked.seen[0][0]
        self.assertEqual(sent["images"][0][0], "image/jpeg")
        self.assertIn("Workshop U1", sent["text"])
        self.assertIn("40%", sent["text"])
        self.assertIn("failed only when the picture clearly shows a failure", self.asked.systems[0])
        self.assertEqual(self.tick('{"verdict": "ok", "why": "x"}', now=1000 + 9 * 60), [])     # not due yet
        later = self.tick('{"verdict": "ok", "why": "x"}', now=1000 + 10 * 60)
        self.assertEqual(len(later), 1)
        # the second check compares with the first picture: two pictures, earlier one first
        self.assertEqual(len(self.asked.seen[0][0]["images"]), 2)
        self.assertIn("The earlier picture is from", self.asked.seen[0][0]["text"])
        self.assertEqual(ai_assistant.status()["watch"]["usage"]["checks"], 2)

    def test_a_clear_failure_is_only_reported_unless_pausing_is_allowed(self):
        ai_assistant.watch_settings(on=True)
        made = self.tick('{"verdict": "failed", "why": "Spaghetti across the bed."}')
        self.assertEqual((made[0]["verdict"], made[0]["paused"], self.paused), ("failed", False, []))
        ai_assistant._watch["last"].clear()
        ai_assistant.watch_settings(pause=True)
        made = self.tick('{"verdict": "failed", "why": "Spaghetti across the bed."}', '{"verdict": "failed", "why": "Still."}',
                         now=5000)
        self.assertEqual((made[0]["paused"], made[0]["confirmed"], self.paused), (True, True, [1]))
        self.assertEqual(self.waited, [ai_assistant.WATCH_CONFIRM_S])
        self.assertEqual(ai_assistant.status()["watch"]["log"][0]["why"], "Spaghetti across the bed.")

    def test_watch_only_mode_stops_the_pause_and_says_so(self):
        ai_assistant.watch_settings(on=True, pause=True, confirm=False)
        with patch.object(ai_assistant.watch_only, "is_on", return_value=True):
            made = self.tick('{"verdict": "failed", "why": "Knocked loose."}')
        self.assertEqual((made[0]["paused"], self.paused), (False, []))
        self.assertIn("It was not paused", made[0]["why"])

    def test_no_picture_an_unreadable_answer_or_an_idle_printer(self):
        ai_assistant.watch_settings(on=True)
        self.picture = (b"<svg/>", "image/svg+xml")
        self.assertEqual(self.tick("{}")[0]["verdict"], "skipped")
        self.assertEqual(self.asked.seen, [])
        self.picture = (FakeJpeg.data, "image/jpeg")
        ai_assistant._watch["last"].clear()
        self.assertEqual(self.tick("I can't tell.")[0]["verdict"], "worry")
        self.state["state"] = "standby"
        self.assertEqual(self.tick('{"verdict": "ok", "why": "x"}', now=99999), [])

    def test_a_second_picture_that_disagrees_leaves_the_print_running(self):
        ai_assistant.watch_settings(on=True, pause=True)
        made = self.tick('{"verdict": "failed", "why": "Spaghetti?"}', '{"verdict": "ok", "why": "Glare."}')
        self.assertEqual((made[0]["paused"], made[0]["confirmed"], self.paused), (False, False, []))
        self.assertIn("didn't confirm it", made[0]["why"])

    def test_the_first_layers_get_their_own_early_check(self):
        ai_assistant.watch_settings(on=True, minutes=30)
        self.state.update(progress=0.01, layer=1)
        self.assertEqual(self.tick('{"verdict": "ok", "why": "x"}', due=False), [])     # counting starts now
        self.state.update(progress=0.03, layer=2)
        made = self.tick('{"verdict": "ok", "why": "First layer is down."}', now=1060, due=False)
        self.assertEqual(made[0]["reason"], "first layers")
        self.assertEqual(self.tick('{"verdict": "ok", "why": "x"}', now=1120, due=False), [])  # only once a print

    def test_what_to_look_for_sensitivity_and_notes_reach_the_ai(self):
        ai_assistant.watch_settings(on=True, looks=["warping", "stringing"], sensitivity="careful",
                                    notes="The mark on the left of the sheet is old. Ignore it.", compare=False)
        self.tick('{"verdict": "worry", "why": "A corner lifts.", "confidence": 0.7}')
        system, sent = self.asked.systems[0], self.asked.seen[0][0]
        self.assertIn("corners or edges lifting", system)
        self.assertNotIn("spaghetti", system)
        self.assertIn("first small sign", system)
        self.assertIn("The mark on the left", sent["text"])
        self.assertEqual(ai_assistant.status()["watch"]["log"][0]["confidence"], 0.7)
        with self.assertRaises(ValueError):
            ai_assistant.watch_settings(looks=["teleport"])
        with self.assertRaises(ValueError):
            ai_assistant.watch_settings(sensitivity="paranoid")

    def test_an_alert_goes_out_when_asked(self):
        sent = []
        ai_assistant.watch_settings(on=True, notify=True)
        with patch.object(ai_assistant.notifications, "notify", lambda m, p="normal": sent.append((m, p))):
            made = self.tick('{"verdict": "worry", "why": "A blob near T1."}')
        self.assertTrue(made[0]["alerted"])
        self.assertIn("A blob near T1.", sent[0][0])

    def test_check_now_and_the_picture_it_saw(self):
        with patch.object(ai_providers, "ask", Script('{"verdict": "ok", "why": "Fine."}')), \
                patch.object(mock_moonraker, "default_printer_id", lambda: "real-1"):
            seen = ai_assistant.watch_now()
        self.assertEqual(seen["verdict"], "ok")
        self.assertEqual(ai_assistant.watch_picture("real-1"), self.picture)
        with self.assertRaises(ValueError):
            ai_assistant.watch_now("u1-workshop")

    def test_an_automation_can_have_the_ai_look(self):
        import automations
        rule = automations.validate({"trigger": {"type": "layer", "value": 3}, "action": {"type": "ai_look", "pause": True}})
        self.assertEqual(rule["action"], {"type": "ai_look", "pause": True})
        self.assertIn("AI checks the camera", rule["name"])
        with patch.object(ai_providers, "ask", Script('{"verdict": "failed", "why": "Off the bed."}', '{"verdict": "failed", "why": "Yes."}')), \
                patch.object(ai_assistant.time, "sleep", lambda s: None), \
                patch.object(mock_moonraker, "printer_name", lambda pid: "Workshop U1", create=True), \
                patch.object(mock_moonraker, "has_printer", lambda pid: True, create=True):
            done = automations.run_action({**rule, "id": "r1"}, "real-1", "layer 3")
        self.assertTrue(done["ok"], done)
        self.assertIn("Paused", done["detail"])

    def test_the_camera_switched_off_stops_it(self):
        ai_assistant.watch_settings(on=True)
        modules.set_enabled("camera", False)
        self.assertEqual(self.tick('{"verdict": "ok", "why": "x"}'), [])

    def test_settings_are_checked(self):
        with self.assertRaises(ValueError):
            ai_assistant.watch_settings(minutes=1)
        self.assertEqual(ai_assistant.watch_settings(on=True, minutes=15, pause=True)["watch"]["minutes"], 15)


if __name__ == "__main__":
    unittest.main()
