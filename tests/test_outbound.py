"""
Tests for the outbound integrations - WLED, Home Assistant, ntfy, Discord,
Telegram - against small stand-in servers that follow each service's real
rules, taken from its own source:

  WLED (wled/WLED 961961f, wled00/json.cpp deserializeState /
    deserializeSegment; wled00/wled_server.cpp): a "seg" list entry with an
    id the strip doesn't have is ignored unless it gives a stop; an entry
    with no id means segment index 0; a change is answered {"success":true}.
  Home Assistant (home-assistant/core dev, components/api/__init__.py,
    const.py): POST /api/states/<id> needs an administrator's token (401
    otherwise); a state over 255 characters is a 400 "Invalid state
    specified."; 201 for a new entity, 200 for an update.
  Telegram (tdlib/telegram-bot-api Query.cpp): errors are
    {"ok": false, "error_code", "description"}.
  Discord (discord-api-docs, Execute Webhook): without wait=true an unsaved
    message returns no error; content up to 2000 characters.
  ntfy (binwiederhier/ntfy server/config.go): 4096-byte message limit.

And every one fails in words, never with a traceback or a hang.
"""

import json
import os
import socket
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import home_assistant_bridge   # noqa: E402
import led_status              # noqa: E402
import mock_moonraker          # noqa: E402
import notifications           # noqa: E402
import outbound                # noqa: E402
import wled_bridge             # noqa: E402


class StandIn:
    """A tiny HTTP server whose handler is a function(method, path, query, body) -> (status, bytes|obj)."""

    def __init__(self, handle):
        stand_in = self
        self.calls = []

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _go(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                parsed = urlparse(self.path)
                stand_in.calls.append((self.command, parsed.path, parse_qs(parsed.query), body, dict(self.headers)))
                status, reply = handle(self.command, parsed.path, parse_qs(parsed.query), body, self.headers)
                data = reply if isinstance(reply, bytes) else json.dumps(reply).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = _go

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class FakeWled:
    """WLED's segment rules, from wled00/json.cpp."""

    def __init__(self, leds=60):
        self.leds = leds
        self.segments = [{"start": 0, "stop": leds, "col": [[255, 160, 0]], "fx": 0, "on": True}]
        self.server = StandIn(self.handle)
        self.host = f"127.0.0.1:{self.server.port}"

    def handle(self, method, path, query, body, headers):
        if path == "/json/info":
            return 200, {"ver": "0.15.1", "name": "Dock rings", "leds": {"count": self.leds}}
        if path == "/json/state" and method == "POST":
            state = json.loads(body)
            seg = state.get("seg")
            entries = [seg] if isinstance(seg, dict) else (seg or [])
            for it, elem in enumerate(entries):
                sid = elem.get("id", it)
                stop = elem.get("stop", -1)
                if sid >= len(self.segments):
                    if stop <= 0:
                        continue                      # "ignore empty/inactive segments"
                    self.segments.append({"start": 0, "stop": self.leds, "col": [[255, 160, 0]], "fx": 0,
                                          "on": True})
                    sid = len(self.segments) - 1
                target = self.segments[sid]
                for k in ("start", "stop", "col", "fx", "on"):
                    if k in elem:
                        target[k] = elem[k]
            return 200, {"success": True}
        return 404, b"Not Found"


class TestWled(unittest.TestCase):
    def setUp(self):
        wled_bridge.reset()
        mock_moonraker.reset_all()
        self.wled = FakeWled()
        self.addCleanup(self.wled.server.close)
        wled_bridge.save_settings({"host": self.wled.host, "leds_per_segment": 12})

    def tearDown(self):
        wled_bridge.reset()

    def test_every_ring_lights_on_a_fresh_strip(self):
        result = wled_bridge.push_ring_states()
        self.assertTrue(result["ok"], result)
        self.assertEqual(len(self.wled.segments), 4)     # before: only segment 0 ever changed
        self.assertEqual([(s["start"], s["stop"]) for s in self.wled.segments], [(0, 12), (12, 24), (24, 36), (36, 48)])
        rings = led_status.get_all_ring_states()["rings"]
        for seg, ring in zip(self.wled.segments, rings):
            self.assertEqual(seg["col"], [list(ring["color_rgb"])])

    def test_one_colour_reaches_every_ring(self):
        wled_bridge.push_ring_states()
        self.assertTrue(wled_bridge.push_color("#ffaa00")["ok"])
        self.assertTrue(all(s["col"] == [[255, 170, 0]] for s in self.wled.segments))   # before: only T0's ring

    def test_the_connection_check_says_what_it_found(self):
        result = wled_bridge.test_connection()
        self.assertTrue(result["ok"])
        self.assertIn("WLED 0.15.1", result["message"])
        wled_bridge.save_settings({"leds_per_segment": 20})
        self.assertIn("need 80", wled_bridge.test_connection()["warning"])

    def test_something_that_isnt_wled(self):
        other = StandIn(lambda *a: (200, {"hello": "router"}))
        self.addCleanup(other.close)
        wled_bridge.save_settings({"host": f"127.0.0.1:{other.port}"})
        self.assertIn("doesn't look like WLED", wled_bridge.test_connection()["error"])
        self.assertIn("not the way WLED confirms", wled_bridge.push_ring_states()["error"])


class FakeHomeAssistant:
    def __init__(self, admin_token="admin-token"):
        self.states = {}
        self.admin_token = admin_token
        self.server = StandIn(self.handle)
        self.url = f"http://127.0.0.1:{self.server.port}"

    def handle(self, method, path, query, body, headers):
        if headers.get("Authorization") != f"Bearer {self.admin_token}":
            return 401, b"401: Unauthorized"
        entity = path[len("/api/states/"):]
        data = json.loads(body)
        if data.get("state") is None:
            return 400, {"message": "No state specified."}
        if len(str(data["state"])) > 255:
            return 400, {"message": "Invalid state specified."}
        new = entity not in self.states
        self.states[entity] = data
        return (201 if new else 200), {"entity_id": entity, "state": str(data["state"])}


class TestHomeAssistant(unittest.TestCase):
    def setUp(self):
        home_assistant_bridge.reset()
        mock_moonraker.reset_all()
        self.ha = FakeHomeAssistant()
        self.addCleanup(self.ha.server.close)
        home_assistant_bridge.save_settings({"base_url": self.ha.url, "token": "admin-token"})

    def tearDown(self):
        home_assistant_bridge.reset()
        mock_moonraker.reset_all()

    def test_a_long_klipper_message_still_publishes(self):
        with mock_moonraker.use_printer("u1-workshop") as printer:
            printer.live["state_message"] = "MCU 'mcu' shutdown: " + "Timer too close. " * 40
        result = home_assistant_bridge.push_sensors()
        self.assertTrue(result["ok"], [r for r in result["results"].values() if not r["ok"]])
        self.assertLessEqual(len(self.ha.states["sensor.dejavu1_state_message"]["state"]), 255)

    def test_a_non_admin_token_is_explained_once(self):
        home_assistant_bridge.save_settings({"token": "someone-elses"})
        result = home_assistant_bridge.push_sensors()
        self.assertFalse(result["ok"])
        first = next(iter(result["results"].values()))
        self.assertIn("administrator", first["error"])
        self.assertEqual(len(self.ha.server.calls), 1)                 # not once per entity


class TestNotifications(unittest.TestCase):
    def setUp(self):
        notifications.reset()
        self.sent = []

    def tearDown(self):
        notifications.reset()

    def fake_send(self, reply_for):
        real = outbound.send

        def send(url, what, **kw):
            self.sent.append((url, what, kw))
            return reply_for(url, what, kw)
        outbound.send = send
        self.addCleanup(lambda: setattr(outbound, "send", real))

    def test_discord_is_asked_to_confirm_and_long_messages_fit(self):
        self.fake_send(lambda url, what, kw: {"ok": True, "status": 200, "body": {"id": "1"}})
        notifications._send_now("x" * 5000, {"discord_webhook_url": "https://discord.com/api/webhooks/1/abc",
                                              "ntfy_topic": "dv"})
        discord = next(s for s in self.sent if s[1] == "Discord")
        self.assertTrue(discord[0].endswith("?wait=true"))
        self.assertLessEqual(len(discord[2]["payload"]["content"]), 2000)
        ntfy = next(s for s in self.sent if s[1] == "ntfy.sh")
        self.assertLessEqual(len(ntfy[2]["raw"]), 4096)

    def test_telegrams_own_reason_is_kept_and_the_token_hidden(self):
        token = "123456:" + "A" * 30
        self.fake_send(lambda url, what, kw: {"ok": False, "status": 400,
                                              "error": f"Telegram answered 400: Bad Request: chat not found ({url})"})
        result = notifications._send_now("hi", {"telegram_bot_token": token, "telegram_chat_id": "42"})
        self.assertIn("chat not found", result["telegram"]["error"])
        self.assertNotIn(token, result["telegram"]["error"])

    def test_held_notifications_go_out_after_quiet_hours_and_failures_stay_queued(self):
        hour = __import__("datetime").datetime.now().hour
        notifications.save_settings({"quiet_hours_start": hour, "quiet_hours_end": (hour + 1) % 24,
                                     "ntfy_topic": "dv"})
        notifications.notify("finished", priority="normal")
        self.assertEqual(len(notifications.get_queue()), 1)
        self.assertIsNone(notifications.flush_if_due())               # still quiet: nothing sent
        notifications.save_settings({"quiet_hours_start": hour, "quiet_hours_end": hour})   # never quiet
        self.fake_send(lambda url, what, kw: {"ok": False, "status": None, "error": "No answer"})
        self.assertEqual(notifications.flush_if_due()["still_queued"], 1)   # offline: kept, not dropped
        self.fake_send(lambda url, what, kw: {"ok": True, "status": 200, "body": {}})
        self.assertEqual(notifications.flush_if_due()["flushed"], 1)
        self.assertEqual(notifications.get_queue(), [])


class TestFailuresInWords(unittest.TestCase):
    def free_port(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    def test_nothing_listening(self):
        r = outbound.send(f"http://127.0.0.1:{self.free_port()}/json/info", "The WLED device")
        self.assertFalse(r["ok"])
        self.assertIn("refused the connection", r["error"])

    def test_unknown_name(self):
        r = outbound.send("http://no-such-device.invalid/json/info", "The WLED device")
        self.assertIn("Can't find", r["error"])

    def test_too_slow(self):
        slow = StandIn(lambda *a: (time.sleep(1.5), (200, {}))[1])
        self.addCleanup(slow.close)
        began = time.monotonic()
        r = outbound.send(f"http://127.0.0.1:{slow.port}/", "Home Assistant", timeout=0.5)
        self.assertLess(time.monotonic() - began, 1.4)
        self.assertIn("No answer", r["error"])

    def test_error_status_keeps_the_services_reason(self):
        svc = StandIn(lambda *a: (400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"}))
        self.addCleanup(svc.close)
        r = outbound.send(f"http://127.0.0.1:{svc.port}/", "Telegram", payload={})
        self.assertEqual(r["error"], "Telegram answered 400: Bad Request: chat not found")

    def test_a_web_page_instead_of_json(self):
        svc = StandIn(lambda *a: (200, b"<html>login</html>"))
        self.addCleanup(svc.close)
        self.assertIn("not with JSON", outbound.send(f"http://127.0.0.1:{svc.port}/", "The WLED device")["error"])


if __name__ == "__main__":
    unittest.main()
