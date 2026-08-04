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

import app as dv_app        # noqa: E402
import maintenance          # noqa: E402


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
        with urlopen(self.base + path, timeout=10) as response:
            return response.status, json.loads(response.read())

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
        try:
            self.get("/api/nope")
            self.fail("expected a 404")
        except HTTPError as err:
            self.assertEqual(err.code, 404)

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


if __name__ == "__main__":
    unittest.main()
