"""
Tests for the robustness and security hardening:

  - settings files are saved atomically and a damaged one is set aside
    instead of breaking its module;
  - tokens and webhook addresses are never sent back out, and saving the
    masked stand-in keeps the real value;
  - settings that become outgoing addresses are checked;
  - pairing codes are single-use, unguessable and limited to a few tries;
  - the server refuses bad request sizes, bad JSON and unknown Host names
    (DNS rebinding), sends protective headers, and hides crash details.
"""

import http.client
import importlib
import json
import math
import os
import shutil
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import HTTPServer
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import app as dv_app              # noqa: E402
import backup                     # noqa: E402
import filament_inventory         # noqa: E402
import home_assistant_bridge      # noqa: E402
import modules                    # noqa: E402
import notifications              # noqa: E402
import pairing                    # noqa: E402
import storage                    # noqa: E402
import wled_bridge                # noqa: E402

DISCORD = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL"
TELEGRAM = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"


class Storage(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "sub", "x.json")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_round_trip_creates_folder_and_leaves_no_temp_files(self):
        storage.save_json(self.path, {"a": 1})
        self.assertEqual(storage.load_json(self.path, None), {"a": 1})
        self.assertEqual(os.listdir(os.path.dirname(self.path)), ["x.json"])

    def test_missing_file_gives_default(self):
        self.assertEqual(storage.load_json(self.path, []), [])

    def test_tests_never_touch_the_real_data_folder(self):
        # The tests replace printers, prices and spools on purpose; pointed
        # at backend/data they wiped the real setup of whoever ran them.
        real = os.path.join(os.path.dirname(os.path.abspath(storage.__file__)), "data")
        self.assertNotEqual(os.path.abspath(storage.DATA_DIR), os.path.abspath(real))
        # Every backend module that keeps files, not a hand-kept list: a
        # module added later with its own path would slip past a list.
        backend = os.path.dirname(os.path.abspath(storage.__file__))
        checked = []
        for name in sorted(f[:-3] for f in os.listdir(backend) if f.endswith(".py")):
            if name == "app":
                continue
            module = importlib.import_module(name)
            if hasattr(module, "_DATA_DIR"):
                checked.append(name)
                self.assertEqual(module._DATA_DIR, storage.DATA_DIR, name)
        self.assertIn("spoolman_bridge", checked)
        self.assertIn("fleet", checked)

    def test_the_dashboard_uses_backend_data_unless_told_otherwise(self):
        backend = os.path.dirname(os.path.abspath(storage.__file__))
        script = ("import os, sys; os.environ.pop('DEJAVU_DATA_DIR', None); "
                  f"sys.path.insert(0, {backend!r}); import storage; print(storage.DATA_DIR)")
        import subprocess
        out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip(), os.path.join(backend, "data"))
        out = subprocess.run([sys.executable, "-c", script.replace(
            "os.environ.pop('DEJAVU_DATA_DIR', None)", f"os.environ['DEJAVU_DATA_DIR'] = {self.dir!r}")],
            capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip(), self.dir)

    def test_damaged_file_is_set_aside_and_default_returned(self):
        os.makedirs(os.path.dirname(self.path))
        with open(self.path, "w") as fh:
            fh.write('{"half": ')                 # a save cut off by a power cut
        self.assertEqual(storage.load_json(self.path, {"fresh": True}), {"fresh": True})
        names = os.listdir(os.path.dirname(self.path))
        self.assertFalse(os.path.exists(self.path))
        self.assertTrue(any(n.startswith("x.json.corrupt-") for n in names), names)

    def test_failed_write_keeps_the_old_file(self):
        storage.save_json(self.path, {"old": True})
        with self.assertRaises(TypeError):
            storage.save_json(self.path, {"bad": object()})   # not JSON-able
        self.assertEqual(storage.load_json(self.path, None), {"old": True})
        self.assertEqual(os.listdir(os.path.dirname(self.path)), ["x.json"])

    def test_concurrent_saves_never_produce_a_damaged_file(self):
        def writer(n):
            for _ in range(30):
                storage.save_json(self.path, {"n": n, "pad": "x" * 5000})
        threads = [threading.Thread(target=writer, args=(i,)) for i in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertIn(storage.load_json(self.path, None)["n"], range(6))

    def test_mask(self):
        self.assertEqual(storage.mask_secret(""), "")
        self.assertTrue(storage.is_masked(storage.mask_secret("short")))
        self.assertTrue(storage.mask_secret(TELEGRAM).endswith(TELEGRAM[-4:]))
        self.assertNotIn(TELEGRAM[:10], storage.mask_secret(TELEGRAM))


class DamagedModuleFiles(unittest.TestCase):

    def test_damaged_pairing_file_does_not_break_pairing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "paired_devices.json")
            with open(path, "w") as fh:
                fh.write("[{")
            with mock.patch.object(pairing, "_DEVICES_PATH", path):
                self.assertEqual(pairing.list_devices(), [])

    def test_damaged_inventory_is_preserved_without_inventing_owned_spools(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "filament_inventory.json")
            with open(path, "w") as fh:
                fh.write("not json")
            with mock.patch.object(filament_inventory, "_INVENTORY_PATH", path):
                self.assertEqual(filament_inventory.get_inventory(), [])
                self.assertTrue(any(n.startswith('filament_inventory.json.corrupt-') for n in os.listdir(tmp)))


class SettingsValidation(unittest.TestCase):

    def tearDown(self):
        notifications.reset()
        wled_bridge.reset()
        home_assistant_bridge.reset()
        filament_inventory.reset()

    def test_notification_addresses_are_checked(self):
        for bad in ({"discord_webhook_url": "http://192.168.1.1/admin"},
                    {"ntfy_topic": "topic/../../x"},
                    {"telegram_bot_token": "not a token"},
                    {"telegram_chat_id": "abc"},
                    {"quiet_hours_start": 25},
                    {"quiet_hours_end": "soon"}):
            with self.assertRaises(ValueError, msg=bad):
                notifications.save_settings(bad)
        saved = notifications.save_settings({"discord_webhook_url": DISCORD, "telegram_bot_token": TELEGRAM,
                                             "telegram_chat_id": "-1001234", "quiet_hours_start": "21"})
        self.assertEqual(saved["discord_webhook_url"], DISCORD)
        self.assertEqual(saved["quiet_hours_start"], 21)

    def test_masked_secret_saved_back_keeps_the_real_one(self):
        notifications.save_settings({"telegram_bot_token": TELEGRAM, "discord_webhook_url": DISCORD})
        public = notifications.public_settings()
        self.assertNotIn(TELEGRAM, json.dumps(public))
        self.assertNotIn(DISCORD, json.dumps(public))
        notifications.save_settings(public)
        self.assertEqual(notifications.get_settings()["telegram_bot_token"], TELEGRAM)
        notifications.save_settings({"telegram_bot_token": ""})
        self.assertEqual(notifications.get_settings()["telegram_bot_token"], "")

    def test_old_bad_quiet_hours_do_not_crash(self):
        self.assertFalse(notifications.is_quiet_hours(settings={"quiet_hours_start": "x",
                                                                 "quiet_hours_end": 7}))

    def test_quiet_hours_queue_is_capped(self):
        settings = {**notifications.get_settings(), "quiet_hours_start": 0, "quiet_hours_end": 0}
        with mock.patch.object(notifications, "is_quiet_hours", return_value=True):
            for i in range(notifications.MAX_QUEUED + 20):
                notifications.notify(f"m{i}", settings=settings)
        queue = notifications.get_queue()
        self.assertEqual(len(queue), notifications.MAX_QUEUED)
        self.assertEqual(queue[-1]["message"], f"m{notifications.MAX_QUEUED + 19}")

    def test_wled_host_is_just_a_host(self):
        for bad in ("evil.com/steal?", "a b", "http://x"):
            with self.assertRaises(ValueError):
                wled_bridge.save_settings({"host": bad})
        with self.assertRaises(ValueError):
            wled_bridge.save_settings({"leds_per_segment": 0})
        self.assertEqual(wled_bridge.save_settings({"host": "wled.local:80"})["host"], "wled.local:80")

    def test_home_assistant_settings_are_checked_and_token_masked(self):
        with self.assertRaises(ValueError):
            home_assistant_bridge.save_settings({"base_url": "file:///etc/passwd"})
        with self.assertRaises(ValueError):
            home_assistant_bridge.save_settings({"entity_prefix": "sensor.x/../y"})
        home_assistant_bridge.save_settings({"base_url": "http://ha.local:8123", "token": "a" * 40})
        public = home_assistant_bridge.public_settings()
        self.assertTrue(public["token_set"])
        self.assertNotEqual(public["token"], "a" * 40)
        home_assistant_bridge.save_settings({"token": public["token"]})
        self.assertEqual(home_assistant_bridge.get_settings()["token"], "a" * 40)

    def test_spools_need_real_values(self):
        for grams in ("nan", "inf", -5, "heavy"):
            with self.assertRaises(ValueError):
                filament_inventory.add_spool("PLA", "Red", "#ff0000", grams)
        with self.assertRaises(ValueError):
            filament_inventory.add_spool("PLA", "Red", "red;background:url(x)", 100)
        spool = filament_inventory.add_spool(None, None, "#FF0000", "250")
        self.assertEqual((spool["material"], spool["color_name"], spool["color_hex"]),
                         ("PLA", "Unnamed", "#ff0000"))
        self.assertTrue(math.isfinite(spool["grams_remaining"]))
        with self.assertRaises(ValueError):
            filament_inventory.update_grams(spool["id"], float("nan"))

    def test_backup_leaves_secrets_out(self):
        notifications.save_settings({"telegram_bot_token": TELEGRAM, "ntfy_topic": "mytopic"})
        _, data = backup.create_backup()
        with zipfile.ZipFile(__import__("io").BytesIO(data)) as zf:
            saved = json.loads(zf.read("notification_settings.json"))
            manifest = json.loads(zf.read("manifest.json"))
        self.assertEqual(saved["telegram_bot_token"], "")
        self.assertEqual(saved["ntfy_topic"], "mytopic")
        self.assertIn("notification_settings.json: telegram_bot_token", manifest["secrets_left_out"])


class Pairing(unittest.TestCase):

    def setUp(self):
        pairing.reset()

    def tearDown(self):
        pairing.reset()

    def test_code_works_once(self):
        code = pairing.generate_code()["code"]
        pairing.redeem_code(code, "Phone")
        with self.assertRaises(ValueError):
            pairing.redeem_code(code, "Someone else")

    def test_too_many_wrong_guesses_cancel_the_code(self):
        code = pairing.generate_code()["code"]
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(pairing.MAX_ATTEMPTS):
            with self.assertRaises(ValueError):
                pairing.redeem_code(wrong, "x")
        with self.assertRaises(ValueError):
            pairing.redeem_code(code, "x")          # even the right code is now refused

    def test_numeric_code_and_long_names(self):
        code = pairing.generate_code()["code"]
        device = pairing.redeem_code(int(code) if not code.startswith("0") else code, "N" * 500)
        self.assertEqual(len(device["name"]), 40)


class HostCheck(unittest.TestCase):

    def test_local_names(self):
        for host in ("localhost:8000", "127.0.0.1:8000", "192.168.1.20", "[::1]:8000",
                     "raspberrypi:8000", "printer.local", "u1.lan:8000", "box.home.arpa"):
            self.assertTrue(dv_app.host_is_local(host), host)
        for host in ("evil.example.com", "attacker.com:8000", "", "192.168.1.20.evil.com"):
            self.assertFalse(dv_app.host_is_local(host), host)

    def test_extra_hosts(self):
        with mock.patch.object(dv_app, "EXTRA_HOSTS", {"printer.example.com"}):
            self.assertTrue(dv_app.host_is_local("printer.example.com"))


class ServerHardening(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def tearDown(self):
        home_assistant_bridge.reset()
        notifications.reset()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest(method, path, skip_host="Host" in (headers or {}))
            for key, value in (headers or {}).items():
                conn.putheader(key, value)
            if body is not None and "Content-Length" not in (headers or {}):
                conn.putheader("Content-Length", str(len(body)))
            conn.endheaders(body)
            resp = conn.getresponse()
            data = resp.read()
            return resp.status, dict(resp.getheaders()), data
        finally:
            conn.close()

    def test_negative_content_length_is_refused_quickly(self):
        status, _, _ = self.request("POST", "/api/pairing/redeem", b"",
                                    {"Content-Length": "-1"})
        self.assertEqual(status, 400)

    def test_invalid_json_is_refused(self):
        status, _, data = self.request("POST", "/api/modules/camera/toggle", b"{not json")
        self.assertEqual(status, 400)
        self.assertIn("valid JSON", json.loads(data)["error"])

    def test_unknown_host_is_refused(self):
        for path in ("/", "/api/modules"):
            status, _, data = self.request("GET", path, headers={"Host": "attacker.example.com"})
            self.assertEqual(status, 421, path)
            self.assertIn("DEJAVU_ALLOWED_HOSTS", json.loads(data)["error"])
        status, _, _ = self.request("POST", "/api/printer/control/cancel", b"{}",
                                    {"Host": "attacker.example.com",
                                     "Origin": "http://attacker.example.com"})
        self.assertEqual(status, 421)

    def test_a_forwarding_header_does_not_bypass_the_host_check(self):
        # A page doing DNS rebinding from this same computer can add
        # Cf-Connecting-Ip itself, so the header alone must not be trusted.
        status, _, _ = self.request("GET", "/api/modules", headers={
            "Host": "printer.example.com", "Cf-Connecting-Ip": "203.0.113.9"})
        self.assertEqual(status, 421)

    def test_cloudflare_tunnel_name_listed_in_allowed_hosts(self):
        with mock.patch.object(dv_app, "EXTRA_HOSTS", {"printer.example.com"}):
            status, _, _ = self.request("GET", "/api/modules", headers={
                "Host": "printer.example.com", "Cf-Connecting-Ip": "203.0.113.9"})
        self.assertEqual(status, 200)

    def test_protective_headers_on_pages_and_api(self):
        for path in ("/", "/api/modules"):
            status, headers, _ = self.request("GET", path)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(headers["X-Frame-Options"], "SAMEORIGIN")
            self.assertIn("frame-ancestors 'self'", headers["Content-Security-Policy"])

    def test_page_files_are_rechecked_and_api_is_never_cached(self):
        # The page's own files must be re-checked on every load, so an update
        # can't leave a browser running old scripts against a new page; an
        # unchanged file then costs only a 304. API answers stay uncached.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            for path, rule in (("/app.js", "no-cache"), ("/style.css", "no-cache"),
                               ("/", "no-cache"), ("/api/modules", "no-store")):
                conn.request("GET", path)
                resp = conn.getresponse()
                resp.read()
                rules = [v for k, v in resp.getheaders() if k.lower() == "cache-control"]
                self.assertEqual(rules, [rule], path)
                conn.close()
        finally:
            conn.close()
        status, headers, _ = self.request("GET", "/app.js")
        status, _, data = self.request("GET", "/app.js",
                                       headers={"If-Modified-Since": headers["Last-Modified"]})
        self.assertEqual(status, 304)
        self.assertEqual(data, b"")

    def test_secrets_never_leave_through_the_api(self):
        was_on = modules.is_enabled("home_assistant_bridge")
        modules.set_enabled("home_assistant_bridge", True)
        self.addCleanup(modules.set_enabled, "home_assistant_bridge", was_on)
        body = json.dumps({"base_url": "http://ha.local:8123", "token": "t" * 40}).encode()
        status, _, data = self.request("POST", "/api/homeassistant/settings", body)
        self.assertEqual(status, 200)
        self.assertNotIn("t" * 40, data.decode())
        status, _, data = self.request("GET", "/api/homeassistant/settings")
        self.assertNotIn("t" * 40, data.decode())
        self.assertTrue(json.loads(data)["token_set"])

    def test_odd_inputs_are_refused_in_words_not_crashes(self):
        # Each of these used to answer 500 ("Something went wrong") - a
        # missing file name or a list where a word belonged reached code
        # that called .lower() or looked the value up in a set.
        cases = [
            ("/api/queue/add?demo=1", {}, "Choose a G-code file"),
            ("/api/queue/add?demo=1", {"filename": ["x.gcode"]}, "Choose a G-code file"),
            ("/api/files/edit", {"name": {"a": 1}, "edits": []}, None),
            ("/api/demo/fail-next?demo=1", {"action": []}, "Unknown action"),
            ("/api/demo/time-scale?demo=1", {"scale": None}, "must be a number"),
            ("/api/maintenance/done?demo=1", {"task_id": [1]}, "Unknown maintenance task"),
            ("/api/sandbox/fire?demo=1", {"event": {}}, "Unknown event"),
            ("/api/sandbox/scenario?demo=1", {"steps": [{"event": []}]}, "Unknown event"),
        ]
        for path, body, words in cases:
            status, _, data = self.request("POST", path, json.dumps(body).encode())
            self.assertIn(status, (400, 403, 404), f"{path} {body}: {status} {data[:120]}")
            if words and status == 400:
                self.assertIn(words, json.loads(data)["error"], path)

    def test_crash_details_stay_in_the_terminal(self):
        with mock.patch.object(dv_app.pairing, "list_devices", side_effect=KeyError("secret-path")), \
                mock.patch("traceback.print_exc"):
            status, _, data = self.request("GET", "/api/pairing/devices")
        self.assertEqual(status, 500)
        self.assertNotIn("secret-path", data.decode())


if __name__ == "__main__":
    unittest.main()
