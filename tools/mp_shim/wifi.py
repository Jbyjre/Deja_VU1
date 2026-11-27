"""Stand-in Wi-Fi radio: always joined, so the firmware talks to the real server over a real socket."""


class _Ap:
    rssi = -60


class _Radio:
    connected = True
    enabled = True
    ipv4_address = "127.0.0.1"
    ap_info = _Ap()

    def connect(self, ssid, password=b"", timeout=None):
        pass


radio = _Radio()
