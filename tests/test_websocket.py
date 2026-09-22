"""
Tests for backend/websocket.py (the hand-written RFC 6455 server side) and
for the live /api/live endpoint built on it, using a real socket client -
the same bytes a browser would send.
"""

import base64
import json
import os
import socket
import struct
import sys
import threading
import time
import unittest
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import app as dv_app       # noqa: E402
import live_feed           # noqa: E402
import mock_moonraker      # noqa: E402
import websocket           # noqa: E402


class _Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def read(self, n):
        chunk = self.data[self.pos:self.pos + n]
        self.pos += n
        return chunk


class TestHandshake(unittest.TestCase):
    def test_accept_key_matches_the_rfc_example(self):
        # RFC 6455 section 1.3 gives this exact pair.
        self.assertEqual(websocket.accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
                         "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_upgrade_request_detection(self):
        self.assertTrue(websocket.is_upgrade_request(
            {"Upgrade": "websocket", "Connection": "keep-alive, Upgrade"}))
        self.assertFalse(websocket.is_upgrade_request({"Connection": "keep-alive"}))

    def test_handshake_rejects_missing_or_bad_key(self):
        with self.assertRaises(websocket.ProtocolError):
            websocket.handshake_response({"Sec-WebSocket-Version": "13"})
        with self.assertRaises(websocket.ProtocolError):
            websocket.handshake_response({"Sec-WebSocket-Key": "short", "Sec-WebSocket-Version": "13"})
        with self.assertRaises(websocket.ProtocolError):
            websocket.handshake_response({"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                                          "Sec-WebSocket-Version": "8"})

    def test_handshake_response_is_a_101(self):
        out = websocket.handshake_response({"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                                            "Sec-WebSocket-Version": "13"}).decode()
        self.assertTrue(out.startswith("HTTP/1.1 101"))
        self.assertIn("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", out)


class TestFrames(unittest.TestCase):
    def test_round_trip_short_medium_and_long(self):
        for size in (5, 300, 70000):
            payload = ("x" * size).encode()
            frame = websocket.encode_frame(payload, websocket.OP_TEXT, mask_key=b"\x01\x02\x03\x04")
            if size > websocket.MAX_INCOMING_BYTES:
                with self.assertRaises(websocket.ProtocolError):
                    websocket.read_frame(_Reader(frame).read)
                continue
            fin, opcode, data = websocket.read_frame(_Reader(frame).read)
            self.assertTrue(fin)
            self.assertEqual(opcode, websocket.OP_TEXT)
            self.assertEqual(data, payload)

    def test_length_encodings(self):
        self.assertEqual(websocket.encode_frame(b"a" * 125)[1], 125)
        self.assertEqual(websocket.encode_frame(b"a" * 126)[1], 126)
        self.assertEqual(struct.unpack("!H", websocket.encode_frame(b"a" * 126)[2:4])[0], 126)
        self.assertEqual(websocket.encode_frame(b"a" * 70000)[1], 127)

    def test_server_rejects_unmasked_client_frames(self):
        with self.assertRaises(websocket.ProtocolError):
            websocket.read_frame(_Reader(websocket.encode_frame(b"hi")).read)

    def test_control_frames_must_be_short(self):
        frame = websocket.encode_frame(b"p" * 126, websocket.OP_PING, mask_key=b"abcd")
        with self.assertRaises(websocket.ProtocolError):
            websocket.read_frame(_Reader(frame).read)

    def test_reserved_bits_are_rejected(self):
        frame = bytearray(websocket.encode_frame(b"hi", mask_key=b"abcd"))
        frame[0] |= 0x40
        with self.assertRaises(websocket.ProtocolError):
            websocket.read_frame(_Reader(bytes(frame)).read)

    def test_fragmented_message_is_reassembled_and_pings_answered(self):
        mask = b"wxyz"
        first = bytearray(websocket.encode_frame(b"hel", websocket.OP_TEXT, mask))
        first[0] &= 0x7F                              # not the final fragment
        ping = websocket.encode_frame(b"!", websocket.OP_PING, mask)
        last = websocket.encode_frame(b"lo", websocket.OP_CONTINUATION, mask)
        written = []

        class W:
            def write(self, b):
                written.append(b)

            def flush(self):
                pass

        conn = websocket.WebSocketConnection(_Reader(bytes(first) + ping + last), W(), threading.Lock())
        opcode, text = conn.receive()
        self.assertEqual((opcode, text), (websocket.OP_TEXT, "hello"))
        self.assertEqual(written[0], websocket.encode_frame(b"!", websocket.OP_PONG))

    def test_close_frame_ends_the_conversation(self):
        frame = websocket.encode_frame(struct.pack("!H", 1000), websocket.OP_CLOSE, b"abcd")

        class W:
            def write(self, b):
                pass

            def flush(self):
                pass

        conn = websocket.WebSocketConnection(_Reader(frame), W(), threading.Lock())
        with self.assertRaises(websocket.ConnectionClosed):
            conn.receive()


# ---------------------------------------------------------------------------
# The live endpoint, over a real socket
# ---------------------------------------------------------------------------

class LiveClient:
    """A minimal WebSocket client: enough to talk to /api/live like a browser."""

    def __init__(self, port, path):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                           "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        self.file = self.sock.makefile("rb")
        self.status = self.file.readline().decode()
        while self.file.readline() not in (b"\r\n", b""):
            pass
        self.expected_accept = websocket.accept_key(key)

    def recv(self):
        fin, opcode, data = websocket.read_frame(self.file.read, require_mask=False)
        if opcode == websocket.OP_CLOSE:
            return None
        return json.loads(data)

    def recv_until(self, predicate, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            msg = self.recv()
            if msg is None:
                return None
            if predicate(msg):
                return msg
        return None

    def send(self, obj):
        self.sock.sendall(websocket.encode_frame(json.dumps(obj), websocket.OP_TEXT, os.urandom(4)))

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class TestLiveEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        mock_moonraker.reset_all()
        live_feed.reset()
        cls.server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        live_feed.start()

    @classmethod
    def tearDownClass(cls):
        live_feed.stop()
        cls.server.shutdown()
        cls.server.server_close()
        mock_moonraker.reset_all()

    def test_without_demo_it_sends_only_the_no_printer_answer(self):
        client = LiveClient(self.port, "/api/live")
        try:
            self.assertIn("101", client.status)
            self.assertEqual(client.recv(), {"connected": False, "demo": False})
            self.assertIsNone(client.recv())          # then it closes
        finally:
            client.close()

    def test_demo_streams_hello_then_state(self):
        client = LiveClient(self.port, "/api/live?demo=1&printer=u1-studio")
        try:
            hello = client.recv()
            self.assertEqual(hello["type"], "hello")
            self.assertEqual(hello["tick_ms"], 250)
            state = client.recv_until(lambda m: m.get("type") == "state")
            self.assertEqual(state["printer"], "u1-studio")
            self.assertTrue(state["demo"])
            self.assertEqual(state["state"]["state"], "paused")
        finally:
            client.close()

    def test_updates_arrive_about_every_250ms(self):
        client = LiveClient(self.port, "/api/live?demo=1")
        try:
            client.recv()
            seqs, start = [], time.time()
            while time.time() - start < 1.6:
                msg = client.recv()
                if msg and msg.get("type") == "state":
                    seqs.append(time.time())
            # ~1.6 s at 250 ms per printer tick: expect several distinct updates.
            self.assertGreaterEqual(len(seqs), 5)
        finally:
            client.close()

    def test_subscribe_switches_printer_without_reconnecting(self):
        client = LiveClient(self.port, "/api/live?demo=1")
        try:
            client.recv()
            client.send({"type": "subscribe", "printer": "u1-garage", "fleet": True})
            msg = client.recv_until(lambda m: m.get("type") == "state" and m["printer"] == "u1-garage")
            self.assertIsNotNone(msg)
            fleet = client.recv_until(lambda m: m.get("type") == "fleet", timeout=3)
            self.assertEqual(len(fleet["printers"]), 3)
        finally:
            client.close()

    def test_a_control_action_is_pushed_immediately(self):
        mock_moonraker.reset_all()
        client = LiveClient(self.port, "/api/live?demo=1&printer=u1-workshop")
        try:
            client.recv()
            client.recv_until(lambda m: m.get("type") == "state")
            sent = time.time()
            req = Request(f"http://127.0.0.1:{self.port}/api/printer/control/pause?demo=1",
                          data=b"{}", method="POST", headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=5) as resp:
                body = json.loads(resp.read())
            self.assertEqual(body["confirmed_state"]["state"], "paused")
            # The event and the new state can arrive in either order.
            seen = {}
            end = time.time() + 3
            while time.time() < end and len(seen) < 2:
                msg = client.recv()
                if msg.get("type") == "state" and msg["state"]["state"] == "paused":
                    seen.setdefault("state", time.time())
                if msg.get("type") == "event" and msg["event"].get("event") == "paused":
                    seen.setdefault("event", time.time())
            self.assertIn("state", seen)
            self.assertIn("event", seen)
            self.assertLess(seen["state"] - sent, 0.5)
        finally:
            client.close()
            mock_moonraker.reset_all()

    def test_bad_handshake_gets_a_400(self):
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        try:
            sock.sendall(b"GET /api/live HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                         b"Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n\r\n")
            self.assertIn(b"400", sock.recv(64))
        finally:
            sock.close()


if __name__ == "__main__":
    unittest.main()
