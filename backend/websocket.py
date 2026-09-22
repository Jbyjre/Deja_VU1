"""
websocket.py
============

A small, dependency-free WebSocket server side (RFC 6455), so the dashboard
can push live printer updates to the browser the instant they happen instead
of the browser asking "anything new?" over and over.

Python's standard library has no WebSocket server, so this implements the
two pieces the protocol needs by hand:

  1. The opening handshake. The browser sends an ordinary HTTP GET with
     `Upgrade: websocket` and a random `Sec-WebSocket-Key`. The server proves
     it understood by answering 101 with
     base64(sha1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")).
  2. Framing. Every message after that travels in small binary frames: a
     FIN bit and an opcode, a length (7 bits, or 16 or 64 bits for longer
     payloads), and - for frames from the browser only - a 4-byte mask the
     payload is XOR-ed with.

What is supported: text and binary messages, fragmented messages from the
client, ping/pong, and a clean close handshake. What is deliberately not:
compression extensions (none are offered, so the browser won't use them)
and subprotocols. Neither is needed to push small JSON messages.
"""

import base64
import hashlib
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONTINUATION = 0x0
OP_TEXT = 0x1
OP_BINARY = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

# Anything the browser sends us is tiny (a ping, a "select printer" note).
# Refuse anything larger instead of buffering it.
MAX_INCOMING_BYTES = 64 * 1024


class ProtocolError(Exception):
    """The other side broke the WebSocket rules; the connection must close."""


class ConnectionClosed(Exception):
    """The other side closed the connection (cleanly or not)."""


def accept_key(client_key):
    """The Sec-WebSocket-Accept value for a client's Sec-WebSocket-Key."""
    digest = hashlib.sha1((client_key.strip() + GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def is_upgrade_request(headers):
    """Does this HTTP request ask to become a WebSocket?"""
    upgrade = (headers.get("Upgrade") or "").lower()
    connection = (headers.get("Connection") or "").lower()
    return upgrade == "websocket" and "upgrade" in connection


def handshake_response(headers):
    """
    Build the 101 Switching Protocols response for a valid upgrade request,
    or raise ProtocolError explaining what is wrong with it.
    """
    key = headers.get("Sec-WebSocket-Key")
    if not key:
        raise ProtocolError("Missing Sec-WebSocket-Key")
    try:
        if len(base64.b64decode(key, validate=True)) != 16:
            raise ProtocolError("Sec-WebSocket-Key must be 16 bytes")
    except (ValueError, base64.binascii.Error):
        raise ProtocolError("Sec-WebSocket-Key is not valid base64")
    if headers.get("Sec-WebSocket-Version") != "13":
        raise ProtocolError("Only WebSocket version 13 is supported")
    return (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept_key(key)}\r\n"
        "\r\n"
    ).encode("ascii")


def encode_frame(payload, opcode=OP_TEXT, mask_key=None):
    """
    One complete (FIN) frame. Servers send unmasked frames; pass `mask_key`
    (4 bytes) only when acting as a client, as the tests do.
    """
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    header = bytearray([0x80 | opcode])
    mask_bit = 0x80 if mask_key else 0
    length = len(payload)
    if length < 126:
        header.append(mask_bit | length)
    elif length < 65536:
        header.append(mask_bit | 126)
        header += struct.pack("!H", length)
    else:
        header.append(mask_bit | 127)
        header += struct.pack("!Q", length)
    if mask_key:
        header += mask_key
        payload = _apply_mask(payload, mask_key)
    return bytes(header) + payload


def _apply_mask(data, mask_key):
    return bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))


def _read_exact(reader, count):
    data = b""
    while len(data) < count:
        chunk = reader(count - len(data))
        if not chunk:
            raise ConnectionClosed("Connection dropped mid-frame")
        data += chunk
    return data


def read_frame(reader, require_mask=True):
    """
    Read one frame using `reader(n)` (for example a socket file's .read).
    Returns (fin, opcode, payload). Enforces the rules a server must:
    client frames are masked, control frames are short and unfragmented,
    reserved bits are zero.
    """
    b1, b2 = _read_exact(reader, 2)
    fin = bool(b1 & 0x80)
    if b1 & 0x70:
        raise ProtocolError("Reserved bits set without a negotiated extension")
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", _read_exact(reader, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", _read_exact(reader, 8))[0]

    if opcode >= 0x8:
        if not fin or length > 125:
            raise ProtocolError("Control frames must be whole and 125 bytes or less")
    elif opcode not in (OP_CONTINUATION, OP_TEXT, OP_BINARY):
        raise ProtocolError(f"Unknown opcode {opcode}")
    if length > MAX_INCOMING_BYTES:
        raise ProtocolError("Frame too large")
    if require_mask and not masked:
        raise ProtocolError("Client frames must be masked")

    mask_key = _read_exact(reader, 4) if masked else None
    payload = _read_exact(reader, length) if length else b""
    if mask_key:
        payload = _apply_mask(payload, mask_key)
    return fin, opcode, payload


class WebSocketConnection:
    """
    One open WebSocket on an already-upgraded socket.

    `send_text` may be called from any thread (writes are serialized);
    `receive` should be called from a single reader thread.
    """

    def __init__(self, rfile, wfile, lock):
        self._rfile = rfile
        self._wfile = wfile
        self._lock = lock
        self.closed = False

    def _write(self, data):
        with self._lock:
            if self.closed:
                raise ConnectionClosed("Already closed")
            try:
                self._wfile.write(data)
                self._wfile.flush()
            except OSError as exc:
                self.closed = True
                raise ConnectionClosed(str(exc))

    def send_text(self, text):
        self._write(encode_frame(text, OP_TEXT))

    def ping(self, data=b""):
        self._write(encode_frame(data, OP_PING))

    def close(self, code=1000, reason=""):
        if self.closed:
            return
        try:
            self._write(encode_frame(struct.pack("!H", code) + reason.encode("utf-8")[:120], OP_CLOSE))
        except ConnectionClosed:
            pass
        self.closed = True

    def receive(self):
        """
        Block until one whole message arrives; returns (opcode, payload).
        Answers pings and close frames itself. Raises ConnectionClosed when
        the conversation is over.
        """
        message_opcode, parts = None, []
        while True:
            fin, opcode, payload = read_frame(self._rfile.read)
            if opcode == OP_PING:
                self._write(encode_frame(payload, OP_PONG))
                continue
            if opcode == OP_PONG:
                continue
            if opcode == OP_CLOSE:
                code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 1000
                self.close(code)
                raise ConnectionClosed(f"Closed by peer ({code})")
            if opcode == OP_CONTINUATION:
                if message_opcode is None:
                    raise ProtocolError("Continuation without a message to continue")
            else:
                if message_opcode is not None:
                    raise ProtocolError("New message before the last one finished")
                message_opcode = opcode
            parts.append(payload)
            if sum(len(p) for p in parts) > MAX_INCOMING_BYTES:
                raise ProtocolError("Message too large")
            if fin:
                data = b"".join(parts)
                if message_opcode == OP_TEXT:
                    try:
                        data = data.decode("utf-8")
                    except UnicodeDecodeError:
                        raise ProtocolError("Text message is not valid UTF-8")
                return message_opcode, data
