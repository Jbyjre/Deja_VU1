"""
Tests for the web API, especially the rule that matters most:

    with no printer connected, the dashboard is served no figures at all
    unless demo data is explicitly requested.

These start the real server on a spare port and talk to it over HTTP, so they
test what a browser would actually receive.

    python3 -m unittest discover tests
"""

import json
import os
import sys
import threading
import unittest
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import app as dv_app         # noqa: E402
import cost_calculator       # noqa: E402
import home_assistant_bridge  # noqa: E402
import maintenance           # noqa: E402
import mock_moonraker        # noqa: E402
import modules               # noqa: E402
import notifications         # noqa: E402
import pairing                # noqa: E402
import wled_bridge            # noqa: E402


class APITestCase(unittest.TestCase):
    """Shared setup: one background server for the whole test class."""

    @classmethod
    def setUpClass(cls):
        # Port 0 asks the operating system for any free port, so these tests
        # never collide with a dashboard the user already has running.
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        maintenance.reset_log()

    def tearDown(self):
        maintenance.reset_log()

    def get(self, path):
        try:
            with urlopen(self.base + path, timeout=10) as response:
                return response.status, json.loads(response.read())
        except HTTPError as err:
            return err.code, json.loads(err.read())

    def post(self, path, payload):
        request = Request(
            self.base + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except HTTPError as err:
            return err.code, json.loads(err.read())


class TestNoPrinterNoFigures(APITestCase):
    """The core promise: no printer means no numbers."""

    DATA_ROUTES = [
        "/api/maintenance",
        "/api/maintenance/history",
        "/api/leds",
        "/api/colorcheck",
        "/api/printer",
    ]

    def test_connection_reports_disconnected(self):
        status, body = self.get("/api/connection")
        self.assertEqual(status, 200)
        self.assertFalse(body["connected"])
        self.assertTrue(body["demo_available"])

    def test_data_routes_return_no_figures(self):
        for route in self.DATA_ROUTES:
            with self.subTest(route=route):
                status, body = self.get(route)
                self.assertEqual(status, 200)
                self.assertFalse(body["connected"])
                self.assertFalse(body["demo"])
                # The response must carry nothing but those two flags. If a
                # payload key ever leaks through here, the dashboard would be
                # showing invented numbers as though they were real.
                self.assertEqual(set(body.keys()), {"connected", "demo"})

    def test_marking_a_task_done_is_refused(self):
        status, body = self.post("/api/maintenance/done",
                                 {"task_id": "nozzle_check"})
        self.assertEqual(status, 409)
        self.assertFalse(body["connected"])

    def test_refused_write_did_not_touch_the_log(self):
        self.post("/api/maintenance/done", {"task_id": "nozzle_check"})
        self.assertEqual(maintenance.get_history(), [])


class TestDemoMode(APITestCase):
    """?demo=1 opts in to simulated data, clearly labelled."""

    def test_maintenance_returns_data_and_is_flagged_demo(self):
        status, body = self.get("/api/maintenance?demo=1")
        self.assertEqual(status, 200)
        self.assertFalse(body["connected"])
        self.assertTrue(body["demo"])
        self.assertEqual(len(body["tasks"]), len(maintenance.TASKS))
        self.assertIn("totals", body)

    def test_leds_and_colorcheck_return_data(self):
        for route in ("/api/leds?demo=1", "/api/colorcheck?demo=1"):
            with self.subTest(route=route):
                status, body = self.get(route)
                self.assertEqual(status, 200)
                self.assertTrue(body["demo"])
                self.assertTrue(body["simulated"])

    def test_marking_a_task_done_works_in_demo(self):
        status, body = self.post("/api/maintenance/done?demo=1",
                                 {"task_id": "nozzle_check"})
        self.assertEqual(status, 200)
        self.assertTrue(body["demo"])

        task = next(t for t in body["tasks"] if t["id"] == "nozzle_check")
        self.assertEqual(task["status"], "ok")
        self.assertEqual(len(maintenance.get_history()), 1)

    def test_only_explicit_values_enable_demo(self):
        # A stray or malformed demo parameter must not open the gate.
        for query in ("?demo=0", "?demo=", "?demo=maybe", "?demonstrate=1"):
            with self.subTest(query=query):
                _, body = self.get("/api/maintenance" + query)
                self.assertFalse(body["demo"])
                self.assertNotIn("tasks", body)


class TestRoutingAndErrors(APITestCase):

    def test_unknown_endpoint_is_404(self):
        status, _ = self.get("/api/nope")
        self.assertEqual(status, 404)

    def test_unknown_task_is_rejected(self):
        status, body = self.post("/api/maintenance/done?demo=1",
                                 {"task_id": "not_a_real_task"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_missing_task_id_is_rejected(self):
        status, _ = self.post("/api/maintenance/done?demo=1", {})
        self.assertEqual(status, 400)

    def test_frontend_files_are_served(self):
        for path in ("/", "/style.css", "/app.js"):
            with self.subTest(path=path):
                with urlopen(self.base + path, timeout=10) as response:
                    self.assertEqual(response.status, 200)
                    self.assertTrue(len(response.read()) > 0)


class TestModuleGating(APITestCase):
    """Disabling a module should make its routes refuse, not error out."""

    def setUp(self):
        super().setUp()
        modules.reset_state()
        mock_moonraker.reset_live_state()

    def tearDown(self):
        super().tearDown()
        modules.reset_state()
        mock_moonraker.reset_live_state()

    def test_modules_list_is_always_available(self):
        status, body = self.get("/api/modules")
        self.assertEqual(status, 200)
        self.assertGreater(len(body["modules"]), 0)

    def test_disabling_a_module_blocks_its_routes(self):
        self.post("/api/modules/printer_control/toggle", {"enabled": False})
        status, body = self.get("/api/printer/control/capabilities?demo=1")
        self.assertEqual(status, 403)
        self.assertTrue(body["module_disabled"])

    def test_re_enabling_restores_access(self):
        self.post("/api/modules/printer_control/toggle", {"enabled": False})
        self.post("/api/modules/printer_control/toggle", {"enabled": True})
        status, _ = self.get("/api/printer/control/capabilities?demo=1")
        self.assertEqual(status, 200)

    def test_unknown_module_toggle_is_rejected(self):
        status, body = self.post("/api/modules/not_real/toggle", {"enabled": True})
        self.assertEqual(status, 400)
        self.assertIn("error", body)


class TestPrinterControlRoutes(APITestCase):

    def setUp(self):
        super().setUp()
        mock_moonraker.reset_live_state()

    def tearDown(self):
        super().tearDown()
        mock_moonraker.reset_live_state()

    def test_control_actions_require_connection_or_demo(self):
        status, body = self.post("/api/printer/control/pause", {})
        self.assertEqual(status, 409)
        self.assertFalse(body["connected"])

    def test_pause_and_resume_in_demo(self):
        status, body = self.post("/api/printer/control/pause?demo=1", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["state"], "paused")

        status, body = self.post("/api/printer/control/resume?demo=1", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["state"], "printing")

    def test_set_temperature_validates_range(self):
        status, body = self.post(
            "/api/printer/control/temperature?demo=1",
            {"toolhead": "T0", "target": 1000})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_gcode_console_reflects_sent_commands(self):
        self.post("/api/printer/control/gcode?demo=1", {"command": "G28"})
        status, body = self.get("/api/printer/control/console?demo=1")
        self.assertEqual(status, 200)
        self.assertTrue(any(entry["detail"] == "G28" for entry in body["log"]))


class TestPairingRoutes(APITestCase):

    def setUp(self):
        super().setUp()
        pairing.reset()

    def tearDown(self):
        super().tearDown()
        pairing.reset()

    def test_full_pairing_flow(self):
        status, body = self.post("/api/pairing/code", {})
        self.assertEqual(status, 200)
        code = body["code"]

        status, body = self.post(
            "/api/pairing/redeem", {"code": code, "device_name": "My Phone"})
        self.assertEqual(status, 200)
        device_id = body["id"]

        status, body = self.get("/api/pairing/devices")
        self.assertEqual(status, 200)
        self.assertIn(device_id, [d["id"] for d in body["devices"]])

    def test_wrong_code_is_rejected(self):
        self.post("/api/pairing/code", {})
        status, body = self.post(
            "/api/pairing/redeem", {"code": "000000", "device_name": "X"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_pairing_works_without_a_printer_connected(self):
        # Pairing is dashboard-level, not printer data, so it is never
        # gated behind connected/demo the way /api/maintenance is.
        status, _ = self.post("/api/pairing/code", {})
        self.assertEqual(status, 200)


class TestAppLevelRoutesIgnoreConnectionState(APITestCase):
    """Settings and inventory routes work with no printer connected at all."""

    def setUp(self):
        super().setUp()
        notifications.reset()
        modules.set_enabled("filament_inventory", True)

    def tearDown(self):
        super().tearDown()
        notifications.reset()
        modules.reset_state()

    def test_notification_settings_readable_without_a_printer(self):
        status, body = self.get("/api/notifications/settings")
        self.assertEqual(status, 200)
        self.assertIn("quiet_hours_start", body)

    def test_notification_settings_writable_without_a_printer(self):
        status, body = self.post(
            "/api/notifications/settings", {"ntfy_topic": "my-topic"})
        self.assertEqual(status, 200)
        self.assertEqual(body["ntfy_topic"], "my-topic")

    def test_filament_inventory_readable_without_a_printer(self):
        status, body = self.get("/api/filament")
        self.assertEqual(status, 200)
        self.assertIn("spools", body)


class TestCostCalculatorRoutes(APITestCase):

    def setUp(self):
        super().setUp()
        cost_calculator.reset()
        mock_moonraker.reset_live_state()

    def tearDown(self):
        super().tearDown()
        cost_calculator.reset()
        mock_moonraker.reset_live_state()

    def test_settings_readable_and_writable_without_a_printer(self):
        status, body = self.get("/api/cost/settings")
        self.assertEqual(status, 200)
        self.assertIn("printer_watts", body)

        status, body = self.post("/api/cost/settings", {"printer_watts": 300})
        self.assertEqual(status, 200)
        self.assertEqual(body["printer_watts"], 300)

    def test_history_requires_connection_or_demo(self):
        status, body = self.get("/api/cost/history")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"connected": False, "demo": False})

    def test_history_in_demo_mode(self):
        status, body = self.get("/api/cost/history?demo=1")
        self.assertEqual(status, 200)
        self.assertIn("jobs", body)
        self.assertGreater(len(body["jobs"]), 0)

    def test_current_job_estimate_in_demo_mode(self):
        status, body = self.get("/api/cost/current?demo=1")
        self.assertEqual(status, 200)
        self.assertIn("total_cost", body)


class TestBridgeRoutes(APITestCase):

    def setUp(self):
        super().setUp()
        wled_bridge.reset()
        home_assistant_bridge.reset()
        modules.set_enabled("wled_bridge", True)
        modules.set_enabled("home_assistant_bridge", True)

    def tearDown(self):
        super().tearDown()
        wled_bridge.reset()
        home_assistant_bridge.reset()
        modules.reset_state()

    def test_wled_settings_roundtrip(self):
        status, body = self.post("/api/wled/settings", {"host": "192.0.2.9"})
        self.assertEqual(status, 200)
        self.assertEqual(body["host"], "192.0.2.9")

        status, body = self.get("/api/wled/settings")
        self.assertEqual(status, 200)
        self.assertEqual(body["host"], "192.0.2.9")

    def test_wled_push_without_host_fails_cleanly(self):
        status, body = self.post("/api/wled/push", {})
        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])

    def test_wled_routes_respect_module_gating(self):
        self.post("/api/modules/wled_bridge/toggle", {"enabled": False})
        status, body = self.get("/api/wled/settings")
        self.assertEqual(status, 403)
        self.assertTrue(body["module_disabled"])
        self.post("/api/modules/wled_bridge/toggle", {"enabled": True})

    def test_home_assistant_settings_roundtrip(self):
        status, body = self.post(
            "/api/homeassistant/settings",
            {"base_url": "http://ha.local:8123", "token": "abc"})
        self.assertEqual(status, 200)
        self.assertEqual(body["base_url"], "http://ha.local:8123")

    def test_home_assistant_push_without_config_fails_cleanly(self):
        status, body = self.post("/api/homeassistant/push", {})
        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])


class TestBackupDownload(APITestCase):

    def test_backup_returns_a_zip_file(self):
        request = Request(self.base + "/api/backup")
        with urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "application/zip")
            self.assertGreater(len(response.read()), 0)


if __name__ == "__main__":
    unittest.main()
