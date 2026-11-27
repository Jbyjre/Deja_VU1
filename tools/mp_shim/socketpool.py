"""Stand-in for CircuitPython's socketpool, on MicroPython's own sockets (same calls the firmware makes)."""
import socket as _socket


class _Socket:
    def __init__(self):
        self._s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)

    def settimeout(self, seconds):
        self._s.settimeout(seconds)

    def connect(self, address):
        self._s.connect(_socket.getaddrinfo(address[0], address[1])[0][-1])

    def sendall(self, data):
        self._s.write(data)

    def recv_into(self, buffer, nbytes):
        return self._s.readinto(buffer, nbytes)

    def close(self):
        self._s.close()


class SocketPool:
    AF_INET = _socket.AF_INET
    SOCK_STREAM = _socket.SOCK_STREAM

    def __init__(self, radio):
        pass

    def socket(self, family, kind):
        return _Socket()

    def getaddrinfo(self, host, port):
        return (_socket.AF_INET, _socket.SOCK_STREAM, 0, "", (host, port))
