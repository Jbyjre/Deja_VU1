"""
Tests for plugins.py and its routes: the rules a plugin must follow, its permissions, the practice
printer, safe start, its Confirm Print checks and its actions in automations.

    python3 -m unittest tests.test_plugins
"""

import json
import os
import sys
import threading
import unittest
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as dv_app      # noqa: E402
import automations        # noqa: E402
import mock_moonraker     # noqa: E402
import modules            # noqa: E402
import plugins            # noqa: E402
from frontend_parts import read_frontend  # noqa: E402

EXAMPLE = os.path.join(ROOT, "docs", "plugins", "house-rules")


def example_files():
    files = {}
    for name in os.listdir(EXAMPLE):
        with open(os.path.join(EXAMPLE, name), encoding="utf-8") as f:
            files[name] = f.read()
    return files


def manifest(**changes):
    base = {"id": "my-plugin", "name": "Mine", "version": "1.0.0", "description": "A test.", "author": "Me",
            "permissions": []}
    base.update(changes)
    return base


class PluginCase(unittest.TestCase):

    def setUp(self):
        plugins.reset()
        modules.reset_state()

    def tearDown(self):
        plugins.reset()
        modules.reset_state()

    def row(self, pid):
        return next(p for p in plugins.listing()["plugins"] if p["id"] == pid)

    def install_example(self, grants=("printer.read", "printer.command")):
        plugins.install(example_files())
        for perm in grants:
            plugins.set_grant("house-rules", perm, True)
        plugins.set_on("house-rules", True)


class TestRules(PluginCase):

    def test_the_example_follows_the_rules(self):
        with open(os.path.join(EXAMPLE, "plugin.json"), encoding="utf-8") as f:
            checked = plugins.validate(json.load(f))
        self.assertEqual(checked["id"], "house-rules")

    def test_bad_plugins_are_refused_in_words(self):
        for bad, words in ((manifest(id="Bad Id"), "id"),
                           (manifest(permissions=["everything"]), "Permissions can only be"),
                           (manifest(actions=[{"id": "a", "name": "A", "gcode": ["G28"]}]), "printer.command"),
                           (manifest(checks=[{"id": "c", "level": "stop", "say": "x", "when": {"material": "PLA"}}]),
                            "refuse")):
            with self.assertRaises(ValueError) as caught:
                plugins.validate(bad)
            self.assertIn(words, str(caught.exception))

    def test_install_refuses_files_a_plugin_cannot_hold(self):
        files = example_files()
        files["run.py"] = "print('hi')"
        with self.assertRaises(ValueError):
            plugins.install(files)
        files.pop("run.py")
        files["pane.js"] = "x" * (plugins.MAX_FILE + 1)
        with self.assertRaises(ValueError):
            plugins.install(files)

    def test_a_user_plugin_starts_off_with_nothing_granted(self):
        plugins.install(example_files())
        row = self.row("house-rules")
        self.assertFalse(row["on"])
        self.assertFalse(any(p["granted"] for p in row["permissions"]))

    def test_a_built_in_id_cannot_be_taken(self):
        files = example_files()
        files["plugin.json"] = json.dumps(dict(json.loads(files["plugin.json"]), id="cost-calculator"))
        with self.assertRaises(ValueError):
            plugins.install(files)


class TestPermissions(PluginCase):

    def test_granted_calls_work_and_others_are_refused(self):
        self.install_example()
        state = plugins.call("house-rules", "printer.state")
        self.assertIn("heads", state)
        self.assertNotIn("address", json.dumps(state))
        with self.assertRaises(PermissionError):
            plugins.call("house-rules", "files.list")

    def test_an_off_plugin_can_do_nothing(self):
        self.install_example()
        plugins.set_on("house-rules", False)
        with self.assertRaises(PermissionError):
            plugins.call("house-rules", "storage.get", {"key": "x"})

    def test_storage_is_its_own(self):
        self.install_example()
        plugins.call("house-rules", "storage.set", {"key": "seen", "value": 3})
        self.assertEqual(plugins.call("house-rules", "storage.get", {"key": "seen"})["value"], 3)

    def test_the_practice_printer_until_the_real_one_is_allowed(self):
        self.install_example()
        done = plugins.run_action("house-rules", "say-hello")
        self.assertTrue(done["practice"])
        self.assertFalse(mock_moonraker.is_real(mock_moonraker.DEFAULT_PRINTER_ID))
        self.assertEqual(len(self.row("house-rules")["trial"]), 1)
        plugins.approve_real("house-rules")
        self.assertFalse(plugins.run_action("house-rules", "say-hello")["practice"])

    def test_changing_the_plugin_sends_it_back_to_practice(self):
        self.install_example()
        plugins.approve_real("house-rules")
        files = example_files()
        files["pane.js"] += "\n// changed\n"
        plugins.install(files)
        plugins.set_on("house-rules", True)
        self.assertTrue(plugins.run_action("house-rules", "say-hello")["practice"])

    def test_an_error_switches_it_off(self):
        self.install_example()
        plugins.report_error("house-rules", "Uncaught TypeError")
        row = self.row("house-rules")
        self.assertFalse(row["on"])
        self.assertEqual(row["errors"][-1]["text"], "Uncaught TypeError")


class TestSafeStartAndBuiltIn(PluginCase):

    def test_safe_start_turns_every_plugin_off_built_ins_too(self):
        self.install_example()
        self.assertTrue(modules.is_enabled("cost_calculator"))
        plugins.set_safe_start(True)
        self.assertFalse(self.row("house-rules")["on"])
        self.assertFalse(modules.is_enabled("cost_calculator"))
        plugins.set_safe_start(False)
        self.assertTrue(modules.is_enabled("cost_calculator"))
        self.assertTrue(self.row("house-rules")["on"])

    def test_the_cost_plugin_switch_is_the_module_switch(self):
        plugins.set_on("cost-calculator", False)
        self.assertFalse(modules.is_enabled("cost_calculator"))
        plugins.set_on("cost-calculator", True)
        self.assertTrue(modules.is_enabled("cost_calculator"))


class TestConfirmPrintChecks(PluginCase):

    def test_house_rules_refuse_and_warn(self):
        self.install_example()
        refuse, warn = plugins.gate_checks({"materials": ["PETG"], "bed_type": "Textured PEI / Smooth PEI Plate",
                                            "hours": 2, "grams": 30, "cost": None, "heads": 1})
        self.assertEqual(len(refuse), 1)
        self.assertTrue(refuse[0].startswith("House rules: "))
        self.assertEqual(warn, [])
        refuse, warn = plugins.gate_checks({"materials": ["PLA"], "bed_type": None, "hours": 13, "grams": 300,
                                            "cost": None, "heads": 1})
        self.assertEqual((len(refuse), len(warn)), (0, 1))

    def test_the_plate_type_is_read_from_the_slicer_settings(self):
        import gcode_tools
        text = "G28\n; CONFIG_BLOCK_START\n; curr_bed_type = Smooth PEI Plate\n; CONFIG_BLOCK_END\n"
        self.assertEqual(gcode_tools.parse_metadata(text).get("bed_type"), "Smooth PEI Plate")

    def test_off_plugins_check_nothing(self):
        self.install_example()
        plugins.set_on("house-rules", False)
        self.assertEqual(plugins.gate_checks({"materials": ["PETG"], "bed_type": "smooth", "hours": 20,
                                              "grams": 0, "cost": None, "heads": 1}), ([], []))


class TestAutomation(PluginCase):

    def test_a_rule_can_run_a_plugin_action(self):
        self.install_example()
        rule = automations.validate({"name": "Hello", "trigger": {"type": "state", "event": "finished"},
                                     "action": {"type": "plugin", "plugin": "house-rules", "action": "say-hello"},
                                     "condition": "always", "printer": "any", "cooldown_s": 60})
        self.assertEqual(rule["action"]["label"], "House rules: Say hello on the printer's screen")
        with self.assertRaises(ValueError):
            automations.validate({"name": "x", "trigger": {"type": "state", "event": "finished"},
                                  "action": {"type": "plugin", "plugin": "house-rules", "action": "nope"}})


class TestRoutes(PluginCase):

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def send(self, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(self.base + path, data=data, headers={"Content-Type": "application/json"},
                          method="GET" if payload is None else "POST")
        try:
            with urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except HTTPError as err:
            return err.code, json.loads(err.read())

    def test_install_grant_and_call_through_the_routes(self):
        status, body = self.send("/api/plugins", {"action": "install", "files": example_files()})
        self.assertEqual(status, 200)
        self.assertIn("house-rules", [p["id"] for p in body["plugins"]])
        self.send("/api/plugins", {"action": "grant", "id": "house-rules", "permission": "printer.read", "allow": True})
        self.send("/api/plugins", {"action": "on", "id": "house-rules", "on": True})
        status, body = self.send("/api/plugins/call", {"id": "house-rules", "method": "printer.state"})
        self.assertEqual(status, 200)
        status, body = self.send("/api/plugins/call", {"id": "house-rules", "method": "files.list"})
        self.assertEqual(status, 403)
        self.assertTrue(body["not_allowed"])
        status, body = self.send("/api/plugins/action", {"id": "house-rules", "action": "say-hello"})
        self.assertEqual(status, 403)
        status, body = self.send("/api/plugins/pane?id=house-rules")
        self.assertEqual(status, 200)
        self.assertIn("dejavu.call", body["script"])

    def test_the_cost_routes_follow_the_cost_plugin_grant(self):
        self.assertEqual(self.send("/api/cost/history?demo=1")[0], 200)
        plugins.set_grant("cost-calculator", "printer.read", False)
        self.assertEqual(self.send("/api/cost/history?demo=1")[0], 403)

    def test_the_slicer_hand_off_sends_a_file_and_never_fails_the_export(self):
        import importlib.util
        import tempfile
        spec = importlib.util.spec_from_file_location("handoff", os.path.join(ROOT, "slicer-handoff",
                                                                              "send_to_dejavu1.py"))
        handoff = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(handoff)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "export.gcode")
            with open(path, "w") as f:
                f.write("G28\n")
            ok, words = handoff.send(self.base, path)
            self.assertTrue(ok, words)
            status, body = self.send("/api/files")
            self.assertIn("export.gcode", [f["name"] for f in body["files"]])
            self.assertEqual(handoff.main(["--to", "http://127.0.0.1:9", path]), 0)
            with open(path) as f:
                self.assertEqual(f.read(), "G28\n")
        self.send("/api/files/delete", {"name": "export.gcode"})

    def test_safe_start_route(self):
        status, body = self.send("/api/plugins", {"action": "safe_start", "on": True})
        self.assertEqual(status, 200)
        self.assertTrue(body["safe_start"])


class TestPage(unittest.TestCase):

    def test_the_pane_is_sandboxed_without_same_origin(self):
        js = read_frontend("plugins.js")
        self.assertIn("el.setAttribute('sandbox', 'allow-scripts')", js)
        self.assertEqual(js.count("setAttribute('sandbox'"), 1)
        self.assertIn("connect-src", js)
        self.assertIn("e.source", js)


if __name__ == "__main__":
    unittest.main()
