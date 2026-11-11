"""
The AI assistant (backend/ai_assistant.py, backend/ai_providers.py).

No test here needs a real AI or a real key. The model is a scripted stand-in (`Script`), the two
wire formats are checked against small local servers that answer in each format's shape, and the
subscription path runs stand-in `claude` and `codex` programs.

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
from test_api import APITestCase      # noqa: E402

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
        with patch.object(ai_providers, "ask", return_value="ready"):
            ai_assistant.test("claude-code")
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
        self.assertNotIn("The printer right now", self.script.systems[0])

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
        self.assertEqual(row["handoff"], {"kind": "confirm_print", "filename": name})
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

    def test_there_are_at_least_thirty_key_services_and_two_subscriptions(self):
        kinds = [p["kind"] for p in ai_providers.PROVIDERS]
        self.assertGreaterEqual(kinds.count("key"), 30)
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
    json.dump({"args": sys.argv[1:], "stdin": sys.stdin.read(), "cwd": os.listdir(".")}, open(os.environ["FAKE_AI_LOG"], "w"))
    if os.environ.get("FAKE_AI_FAIL"):
        print(json.dumps({"type": "result", "is_error": True, "result": "Not logged in"})); sys.exit(1)
    print(json.dumps({"type": "result", "is_error": False, "result": "from the plan"}))
''')
FAKE_CODEX = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys
    json.dump({"args": sys.argv[1:], "stdin": sys.stdin.read()}, open(os.environ["FAKE_AI_LOG"], "w"))
    sys.stderr.write("progress...\\n")
    if os.environ.get("FAKE_AI_FAIL"):
        sys.stderr.write("not signed in\\n"); sys.exit(1)
    print("from chatgpt")
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
        self.assertEqual(args[args.index("--system-prompt") + 1], "SYSTEM RULES")
        for flag in ("-p", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"):
            self.assertIn(flag, args)
        self.assertNotIn("--model", args)
        self.assertEqual(seen["cwd"], [])
        self.assertIn("Owner: now cool", seen["stdin"])
        self.assertTrue(ai_providers.describe("claude-code")["installed"])

    def test_codex_reads_the_request_from_standard_input(self):
        answer = ai_providers.ask("codex", "", "SYSTEM RULES", self.messages)
        self.assertEqual(answer, "from chatgpt")
        seen = self.read_log()
        self.assertEqual(seen["args"], ["exec", "--skip-git-repo-check", "--ephemeral", "-"])
        self.assertIn("SYSTEM RULES", seen["stdin"])

    def test_not_signed_in_says_what_to_do(self):
        with patch.dict(os.environ, {"FAKE_AI_FAIL": "1"}):
            for pid, words in (("claude-code", "/login"), ("codex", "codex login")):
                with self.assertRaises(ai_providers.AIError) as caught:
                    ai_providers.ask(pid, "", "S", self.messages)
                self.assertIn(words, str(caught.exception))

    def test_a_missing_program_says_so(self):
        with patch.dict(os.environ, {"PATH": "/nonexistent"}):
            self.assertFalse(ai_providers.describe("codex")["installed"])
            with self.assertRaises(ai_providers.AIError) as caught:
                ai_providers.ask("codex", "", "S", self.messages)
        self.assertIn("isn't installed", str(caught.exception))


class TestRoutes(APITestCase):
    def setUp(self):
        super().setUp()
        ai_assistant.reset()
        modules.reset_state()
        mock_moonraker.reset_live_state()
        self.addCleanup(ai_assistant.reset)
        self.addCleanup(modules.reset_state)

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
        self.assertEqual(self.post("/api/assistant/clear", {"thread": "thread-1"})[1], {"cleared": True})

    def test_a_provider_error_is_a_502_with_words(self):
        with patch.object(ai_providers, "ask", side_effect=ai_providers.AIError("No credit left")):
            status, body = self.post("/api/assistant/test", {"provider": "claude-code"})
        self.assertEqual((status, body), (502, {"error": "No credit left"}))

    def test_switched_off_means_every_route_refuses(self):
        modules.set_enabled("ai_assistant", False)
        self.assertEqual(self.get("/api/assistant")[0], 403)
        self.assertEqual(self.post("/api/assistant/chat", {"thread": "thread-1", "text": "hi"})[0], 403)
        self.assertEqual(self.post("/api/assistant/key", {"provider": "openai", "api_key": "k" * 20})[0], 403)

    def test_saving_a_key_answers_without_it(self):
        status, body = self.post("/api/assistant/key", {"provider": "mistral", "api_key": "mk-0123456789abcdef"})
        self.assertEqual(status, 200)
        self.assertNotIn("mk-0123456789abcdef", json.dumps(body))
        row = next(p for p in body["providers"] if p["id"] == "mistral")
        self.assertTrue(row["has_key"])


if __name__ == "__main__":
    unittest.main()
