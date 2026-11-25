# Deja Vu1 colour checker, firmware 1.0.0, for a Waveshare AS7341 on a Raspberry Pi Pico W.
# CircuitPython 10.x. Copy this file to the CIRCUITPY drive as code.py, with adafruit_as7341.mpy and the
# adafruit_bus_device and adafruit_register folders in CIRCUITPY/lib (docs/colour-checker.md has the steps).
#
# Wiring: VCC (red) -> pin 36 3V3(OUT), GND (black) -> pin 38, SDA (blue) -> pin 6 GP4,
# SCL (yellow) -> pin 7 GP5. INT (orange) and GPIO (green) stay unconnected. Power the Pico from its own
# micro-USB socket with a USB wall charger. Never from the printer.
#
# What it does: reads the sensor over and over with the board's two white LEDs on, and sends each
# reading to Deja Vu1 in one or both of two ways:
#   Wi-Fi: it posts the reading to Deja Vu1 on your computer (settings.toml or the app's setup screen
#          holds your Wi-Fi name and password and the computer's address; docs/colour-checker.md).
#   USB:   it prints one line per reading that starts with "DV1 " and holds one JSON object, and the
#          Deja Vu1 page reads those lines in Chrome or Edge (Web Serial). It reads commands the same way:
#          a line that starts with "DV1 " and holds a JSON object, for example DV1 {"cmd": "hello"}.
#          Never send Ctrl-C: CircuitPython stops the program on it.
# It also prints a plain line for people watching the console. The protocol is described in
# docs/colour-sensor-api.md. The board's own LED says what the Wi-Fi is doing (see LED_HELP below).
#
# Raw counts only: this file never turns counts into a colour. Deja Vu1 does that from a white and a
# dark reference you record, and it ties each reference to the settings in "settings" below.
#
# CircuitPython floats are single precision, so this file never holds a Unix time as a float: it counts
# whole seconds as integers.
import json
import os
import sys
import time

import board
import busio
import microcontroller
import supervisor

try:  # a Pico without Wi-Fi (not a Pico W) still works over USB
    import socketpool
    import wifi
except ImportError:
    socketpool = None
    wifi = None
try:
    import digitalio
except ImportError:
    digitalio = None

FIRMWARE = "1.0.0"
PROTOCOL = 1

# -- Settings you may edit ------------------------------------------------------------------------------
SDA_PIN = board.GP4  # physical pin 6
SCL_PIN = board.GP5  # physical pin 7
CHANNEL_ID = "inlet-0"  # names this sensor's place; change it only when more than one sensor shares a Pico
DEFAULT_GAIN = 16  # used until a gain is saved: 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256 or 512
DEFAULT_LED_MA = 10  # the board's two LEDs, in milliamps; Waveshare's own demo uses 10
MAX_LED_MA = 20  # refused above this: Waveshare does not publish the LEDs' limit, so stay low
ATIME = 100  # the library's defaults: (ATIME + 1) x (ASTEP + 1) x 2.78 microseconds = 280 ms per read
ASTEP = 999
AVERAGE = 3  # readings averaged into each line
LOW_LIGHT = 100  # the brightest of the eight bands below this: too dark to judge a colour
UNSTABLE_PERCENT = 10  # "unstable" means a band moved more than this share between the averaged readings...
UNSTABLE_COUNTS = 25  # ...and by more than this many counts (ordinary noise on a dim band is not instability)
AUTOGAIN_TARGET = 0.5  # auto gain aims the brightest channel at this share of the ADC's full scale
PERIOD_S = 2.0  # a new reading at most this often
HTTP_TIMEOUT_S = 6  # how long to wait for the app before trying its next address
WIFI_TIMEOUT_S = 15  # how long one try at joining the Wi-Fi may take
WIFI_RETRY_S = 20  # wait this long between tries at joining the Wi-Fi
CLOCK_REFRESH_S = 600  # ask the app for the time again this often
DEFAULT_APP_PORT = 8000
# The board's own LED (Pico W) says what the Wi-Fi is doing. Counted in blinks, repeated after each reading:
LED_HELP = {"steady on": "readings are reaching Deja Vu1 (or Wi-Fi is not set up and USB is in use)",
            "1 blink": "not on the Wi-Fi: wrong name or password, out of range, or a 5 GHz-only network",
            "2 blinks": "on the Wi-Fi but cannot reach Deja Vu1: is it running, is the address right, "
                        "is the firewall open",
            "3 blinks": "Deja Vu1 answered but refused: not assigned to a head yet, the module is off, "
                        "or the lock is on",
            "4 blinks": "the sensor is not answering: check its four wires"}
HUMAN_LINES = True  # also print a plain line per reading, for the serial console
# --------------------------------------------------------------------------------------------------------

GAINS = (0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512)  # the chip's register value is the index
NAMES = ("f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8")
BANDS = ("415", "445", "480", "515", "555", "590", "630", "680")
MAGIC = b"DV1"
NVM_LENGTH = 8
NET_OFFSET = 16  # the network block starts here in non-volatile memory, after the 8 bytes of settings
NET_MAGIC = b"DV1N"
NET_MAX = 1000
NET_KEYS = ("ssid", "password", "server", "printer", "code", "token")
SENSOR_ADDRESS = 0x39
USER_AGENT = "DejaVu1-sensor/" + FIRMWARE


def device_id():
    return "pico-" + "".join("%02x" % b for b in microcontroller.cpu.uid)


def full_scale(atime, astep):
    """The count at which the ADC is full (datasheet equation 2, capped at 16 bits)."""
    return min(65535, (atime + 1) * (astep + 1))


def load_settings():
    """Gain, LED current and sensor number from non-volatile memory, or the defaults."""
    settings = {"gain": DEFAULT_GAIN, "led_ma": DEFAULT_LED_MA, "generation": 1}
    nvm = microcontroller.nvm
    if nvm is None or len(nvm) < NVM_LENGTH:
        return settings
    data = bytes(nvm[0:NVM_LENGTH])
    if data[0:3] != MAGIC or data[3] != 1 or (sum(data[0:7]) & 0xFF) != data[7]:
        return settings
    gain_code, led_code, generation = data[4], data[5], data[6]
    led_ma = 4 + 2 * led_code
    if gain_code < len(GAINS) and 4 <= led_ma <= MAX_LED_MA and generation >= 1:
        settings.update(gain=GAINS[gain_code], led_ma=led_ma, generation=generation)
    return settings


def save_settings(settings):
    nvm = microcontroller.nvm
    if nvm is None or len(nvm) < NVM_LENGTH:
        return False
    body = MAGIC + bytes([1, GAINS.index(settings["gain"]), (settings["led_ma"] - 4) // 2,
                          settings["generation"] & 0xFF])
    data = body + bytes([sum(body) & 0xFF])
    if bytes(nvm[0:NVM_LENGTH]) != data:  # flash wears: write only a change
        nvm[0:NVM_LENGTH] = data
    return True


def emit(message):
    print("DV1 " + json.dumps(message))


def spread_too_big(spread, mean):
    """Is a spread in counts larger than noise explains: both a percentage of the level and a few counts?"""
    return spread > max(UNSTABLE_COUNTS, UNSTABLE_PERCENT / 100.0 * mean)


def mono_seconds():
    """Whole seconds from a clock that never goes back (monotonic_ns keeps its precision; monotonic does not)."""
    try:
        return time.monotonic_ns() // 1000000000
    except AttributeError:
        return int(time.monotonic())


def getenv(name):
    try:
        return os.getenv(name)
    except (AttributeError, OSError):
        return None


def clean_servers(value):
    """'192.168.1.23:8000, mylaptop.local' -> [('192.168.1.23', 8000), ('mylaptop.local', 8000)]"""
    if isinstance(value, str):
        value = value.split(",")
    found = []
    for item in value or []:
        item = str(item).strip()
        for scheme in ("http://", "https://"):
            if item.lower().startswith(scheme):
                item = item[len(scheme):]
        item = item.split("/")[0]
        host, _, port = item.partition(":")
        if not host or not all(32 < ord(c) < 127 for c in host):
            continue
        if port and not (port.isdigit() and 0 < int(port) < 65536):
            continue
        found.append((host, int(port) if port else DEFAULT_APP_PORT))
    return found[:4]


def load_net_block():
    """What the app saved over USB: a JSON object in non-volatile memory, or {}."""
    nvm = microcontroller.nvm
    if nvm is None or len(nvm) < NET_OFFSET + 8:
        return {}
    head = bytes(nvm[NET_OFFSET:NET_OFFSET + 6])
    if head[0:4] != NET_MAGIC:
        return {}
    size = head[4] * 256 + head[5]
    if size == 0 or size > NET_MAX or NET_OFFSET + 6 + size + 1 > len(nvm):
        return {}
    body = bytes(nvm[NET_OFFSET + 6:NET_OFFSET + 6 + size])
    if (sum(body) & 0xFF) != nvm[NET_OFFSET + 6 + size]:
        return {}
    try:
        data = json.loads(body.decode())
    except (ValueError, UnicodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_net_block(data):
    """Keep the app's network settings across a USB unplug. An empty dict erases them. False when there is no room."""
    nvm = microcontroller.nvm
    if nvm is None or len(nvm) < NET_OFFSET + 8:
        return False
    if not data:
        nvm[NET_OFFSET:NET_OFFSET + 4] = b"\xff\xff\xff\xff"
        return True
    body = json.dumps(data).encode()
    if len(body) > NET_MAX or NET_OFFSET + 6 + len(body) + 1 > len(nvm):
        return False
    block = NET_MAGIC + bytes([len(body) // 256, len(body) % 256]) + body + bytes([sum(body) & 0xFF])
    if bytes(nvm[NET_OFFSET:NET_OFFSET + len(block)]) != block:  # flash wears: write only a change
        nvm[NET_OFFSET:NET_OFFSET + len(block)] = block
    return True


def load_net():
    """Wi-Fi and app settings: the app's saved block wins over settings.toml, key by key. The password stays here."""
    net = {"ssid": getenv("CIRCUITPY_WIFI_SSID") or "", "password": getenv("CIRCUITPY_WIFI_PASSWORD") or "",
           "server": clean_servers(getenv("DV1_SERVER")), "printer": getenv("DV1_PRINTER") or "",
           "code": str(getenv("DV1_PAIR_CODE") or ""), "token": ""}
    source = "file" if net["ssid"] else "none"
    saved = load_net_block()
    for key in NET_KEYS:
        if key in saved:
            net[key] = clean_servers(saved[key]) if key == "server" else str(saved[key])
    if saved.get("ssid"):
        source = "usb"
    net["source"] = source
    return net


class Link:
    """The Wi-Fi side: join the network, find the app, stamp readings with its clock and post them."""

    def __init__(self):
        self.net = load_net()
        self.pool = None
        self.state = "off" if not self.net["ssid"] or wifi is None else "no_wifi"
        self.message = ""
        self.offset = None  # the app's Unix time minus this board's monotonic seconds
        self.synced_at = 0
        self.last_stamp = 0
        self.attempt_at = -1000
        self.server = 0  # which of the app's addresses worked last
        self.reported = None

    # -- facts ------------------------------------------------------------------------------------------
    def public(self):
        """What may be shown or sent about the network settings. Never the password or the pairing key."""
        net = self.net
        joined = bool(wifi is not None and wifi.radio.connected)
        info = {"wifi": wifi is not None, "ssid": net["ssid"], "source": net["source"], "joined": joined,
                "server": ["%s:%d" % pair for pair in net["server"]], "printer": net["printer"],
                "paired": bool(net["token"]), "state": self.state, "message": self.message}
        if joined:
            info["ip"] = str(wifi.radio.ipv4_address)
            info["rssi"] = self.rssi()
        return info

    def rssi(self):
        try:
            return int(wifi.radio.ap_info.rssi)
        except (AttributeError, TypeError, ValueError):
            return None

    def reload(self):
        """Take new settings (after the app saved some, or cleared them)."""
        self.net = load_net()
        self.state = "off" if not self.net["ssid"] or wifi is None else "no_wifi"
        self.message = ""
        self.offset = None
        self.attempt_at = -1000
        if wifi is not None and self.state == "off" and wifi.radio.connected:
            wifi.radio.enabled = False
            wifi.radio.enabled = True

    def set(self, state, words):
        self.state, self.message = state, words

    # -- joining the Wi-Fi ------------------------------------------------------------------------------
    def join(self):
        """True when the board is on the Wi-Fi. Tries again every WIFI_RETRY_S seconds, never faster."""
        if self.state == "off":
            return False
        if wifi.radio.connected:
            if self.pool is None:
                self.pool = socketpool.SocketPool(wifi.radio)
            return True
        if self.state != "no_wifi":  # it was working: say so at once, not after the next try
            self.set("no_wifi", "The Wi-Fi \"%s\" dropped. Trying to join again." % self.net["ssid"])
        now = mono_seconds()
        if now - self.attempt_at < WIFI_RETRY_S:
            return False
        self.attempt_at = now
        self.pool = None
        try:
            wifi.radio.connect(self.net["ssid"], self.net["password"], timeout=WIFI_TIMEOUT_S)
        except (ConnectionError, OSError, ValueError) as error:
            self.set("no_wifi", "Could not join the Wi-Fi \"%s\" (%s). Check the name and password. The Pico W "
                     "cannot use a 5 GHz-only network." % (self.net["ssid"], error))
            return False
        self.pool = socketpool.SocketPool(wifi.radio)
        return True

    # -- talking to the app -----------------------------------------------------------------------------
    def request(self, method, path, body=None, cookie=True):
        """One HTTP call to the app, trying its addresses in turn. Returns (status, headers, data) or raises OSError."""
        servers = self.net["server"]
        if not servers:
            raise OSError("No address for Deja Vu1 is set (DV1_SERVER).")
        failure = None
        for turn in range(len(servers)):
            index = (self.server + turn) % len(servers)
            host, port = servers[index]
            try:
                answer = self._call(host, port, method, path, body, cookie)
            except OSError as error:
                failure = "%s:%d (%s)" % (host, port, error)
                continue
            self.server = index
            return answer
        raise OSError("No answer from " + failure)

    def _call(self, host, port, method, path, body, cookie):
        address = host
        if not all(c.isdigit() or c == "." for c in host):
            address = self.pool.getaddrinfo(host, port)[4][0]
        payload = json.dumps(body).encode() if body is not None else b""
        head = ["%s %s HTTP/1.1" % (method, path), "Host: %s:%d" % (host, port), "User-Agent: " + USER_AGENT,
                "Connection: close", "Accept: application/json"]
        if body is not None:
            head += ["Content-Type: application/json", "Content-Length: %d" % len(payload)]
        if cookie and self.net["token"]:
            head.append("Cookie: dv_device=" + self.net["token"])
        sock = self.pool.socket(self.pool.AF_INET, self.pool.SOCK_STREAM)
        try:
            sock.settimeout(HTTP_TIMEOUT_S)
            sock.connect((address, port))
            sock.sendall(("\r\n".join(head) + "\r\n\r\n").encode() + payload)
            data = bytearray()
            chunk = bytearray(1024)
            while len(data) < 40000:
                count = sock.recv_into(chunk, 1024)
                if not count:
                    break
                data.extend(chunk[:count])
                split = bytes(data).find(b"\r\n\r\n")
                if split >= 0:
                    wanted = self._length(bytes(data[:split]))
                    if wanted is not None and len(data) - split - 4 >= wanted:
                        break
        finally:
            sock.close()
        text = bytes(data)
        split = text.find(b"\r\n\r\n")
        if split < 0 or not text.startswith(b"HTTP/"):
            raise OSError("not an answer from Deja Vu1")
        lines = text[:split].decode().split("\r\n")
        headers = {}
        for line in lines[1:]:
            name, _, value = line.partition(":")
            headers.setdefault(name.strip().lower(), value.strip())
        status = int(lines[0].split(" ")[1])
        try:
            parsed = json.loads(text[split + 4:].decode()) if text[split + 4:] else {}
        except (ValueError, UnicodeError):
            parsed = {}
        return status, headers, parsed

    @staticmethod
    def _length(head):
        for line in head.decode().split("\r\n")[1:]:
            name, _, value = line.partition(":")
            if name.strip().lower() == "content-length":
                return int(value.strip())
        return None

    def stamp(self):
        """A capture time in whole seconds that is never in the future and never repeats."""
        moment = self.offset + mono_seconds()
        moment = max(moment, self.last_stamp + 1)
        self.last_stamp = moment
        return moment

    def learn_time(self, server_time):
        if isinstance(server_time, int) and server_time > 1000000000:
            self.offset = server_time - mono_seconds()
            self.synced_at = mono_seconds()

    def sync(self):
        """Ask the app for its time, and check that the printer, the module and the address are right."""
        status, _, data = self.request("GET", "/api/colorcheck/sensors?printer=" + self.net["printer"])
        if status == 200:
            self.learn_time(data.get("server_time"))
            return self.offset is not None
        self.refused(status, data)
        return False

    def refused(self, status, data):
        words = str(data.get("error") or "") if isinstance(data, dict) else ""
        if status == 401 and isinstance(data, dict) and data.get("pairing_required"):
            self.set("refused", "Deja Vu1's device lock is on and this sensor is not paired. " + (
                "The pairing code was not accepted. " if self.net["code"] else "") +
                "Show a pairing code (Settings, Pair a phone) and send it from the setup screen.")
        elif status == 403:
            self.set("refused", words or "Deja Vu1 refused this message. Switch Right colour loaded? on in Settings.")
        elif status == 404 or "printer" in words.lower():
            self.set("refused", words or "Deja Vu1 does not know this printer id. Check DV1_PRINTER.")
        elif status == 421:
            self.set("refused", words or "Deja Vu1 does not answer to that address.")
        else:
            self.set("refused", words or "Deja Vu1 answered with status %d." % status)

    def pair(self):
        """Use the pairing code once and keep the key it returns, when the app's device lock is on."""
        code = self.net["code"]
        if not code or self.net.get("code_used") == code:
            return False
        self.net["code_used"] = code
        status, headers, _ = self.request("POST", "/api/pairing/redeem", {
            "code": code, "device_name": ("Colour checker " + device_id())[:40]}, cookie=False)
        cookie = headers.get("set-cookie", "")
        if status == 200 and cookie.startswith("dv_device="):
            token = cookie[len("dv_device="):].split(";")[0]
            self.net["token"] = token
            saved = load_net_block()
            saved["token"] = token
            save_net_block(saved)
            return True
        return False

    def send(self, message, result=None):
        """Post one reading. Returns the commands the app sent back (a list), or None when it did not go through."""
        try:
            if not self.join():
                return None
            if not self.net["printer"]:
                self.set("refused", "No printer id is set (DV1_PRINTER). Use the setup screen to make settings.toml.")
                return None
            if self.offset is None or mono_seconds() - self.synced_at > CLOCK_REFRESH_S:
                if not self.sync():
                    return None
            body = {"version": 1, "simulated": False, "captured_at": self.stamp(), "calibrated": None}
            for key in ("device_id", "channel_id", "sensor_id", "sensor_model", "raw", "quality_flags", "settings"):
                body[key] = message[key]
            body["info"] = {"firmware": FIRMWARE, "transport": "wifi", "rssi": self.rssi() or 0}
            if result:
                body["command_result"] = result
            path = "/api/colorcheck/readings?printer=" + self.net["printer"]
            status, _, data = self.request("POST", path, body)
            if status == 401 and self.pair():
                status, _, data = self.request("POST", path, body)
            return self.answer(status, data)
        except OSError as error:
            where = ", ".join("%s:%d" % pair for pair in self.net["server"])
            self.set("unreachable", "Could not reach Deja Vu1 at %s (%s). Is it running on the computer, on the same "
                     "Wi-Fi, with Python allowed through the firewall?" % (where, error))
            return None

    def answer(self, status, data):
        if status == 200:
            self.learn_time(data.get("server_time"))
            self.set("ok", "Readings are reaching Deja Vu1.")
            return data.get("commands") or []
        words = str(data.get("error") or "") if isinstance(data, dict) else ""
        if status == 400 and "repeated or older" in words:
            self.last_stamp += 2  # a reading with the same second: skip it, the next one is later
            return []
        if status == 400 and "not assigned" in words:
            self.set("refused", "Deja Vu1 sees this sensor but it is not assigned to a head yet. Open Right colour "
                     "loaded? in Deja Vu1 and press Assign.")
        elif status == 400 and "clock" in words:
            self.offset = None  # ask for the time again next time
            self.set("refused", words)
        else:
            self.refused(status, data)
        return None


class Checker:
    def __init__(self):
        self.i2c = None
        self.sensor = None
        self.gain_type = None
        self.settings = load_settings()
        self.led_on = True
        self.settled = False
        self.count = 0
        self.problem = None
        self.problem_at = 0.0
        self.line = ""
        self.link = Link()
        self.pending_result = None  # the answer to the last command that came by Wi-Fi, sent with the next reading
        self.reported_state = None
        self.led = None
        if digitalio is not None:
            try:
                self.led = digitalio.DigitalInOut(board.LED)
                self.led.direction = digitalio.Direction.OUTPUT
            except (AttributeError, ValueError, RuntimeError):
                self.led = None

    # -- the sensor -------------------------------------------------------------------------------------
    def connect(self):
        """Open the sensor. Returns None when it works, else a (code, words) pair."""
        if self.i2c is None:
            try:
                self.i2c = busio.I2C(SCL_PIN, SDA_PIN)
            except RuntimeError as error:  # CircuitPython: "No pull up found on SDA or SCL"
                return ("wiring", "The sensor wires are not reaching the Pico (%s). Unplug the USB and check blue on "
                        "pin 6 (GP4) and yellow on pin 7 (GP5)." % error)
        while not self.i2c.try_lock():
            pass
        try:
            found = self.i2c.scan()
        finally:
            self.i2c.unlock()
        if SENSOR_ADDRESS not in found:
            return ("no_sensor", "No AS7341 answered at 0x39. Unplug the USB, then check red on pin 36, black on "
                    "pin 38, blue on pin 6 (GP4) and yellow on pin 7 (GP5). Blue and yellow swapped is the usual "
                    "mistake.")
        try:
            from adafruit_as7341 import AS7341, Gain
        except ImportError as error:
            return ("library", "A library is missing (%s). Copy adafruit_as7341.mpy and the adafruit_bus_device and "
                    "adafruit_register folders into CIRCUITPY/lib." % error)
        try:
            sensor = AS7341(self.i2c)
        except (RuntimeError, ValueError, OSError) as error:
            return ("no_sensor", "The chip at 0x39 is not an AS7341 (%s)." % error)
        sensor.atime = ATIME
        sensor.astep = ASTEP
        self.sensor = sensor
        self.gain_type = Gain
        self.apply()
        return None

    def apply(self):
        """Write the settings to the chip. The next reading after a change is thrown away."""
        index = GAINS.index(self.settings["gain"])
        self.sensor.gain = getattr(self.gain_type, ("GAIN_%sX" % GAINS[index]).replace(".", "_"))
        self.sensor.led_current = self.settings["led_ma"]
        self.sensor.led = self.led_on
        self.settled = False

    def describe(self):
        return {"gain": self.settings["gain"], "led_ma": self.settings["led_ma"], "led": self.led_on,
                "atime": ATIME, "astep": ASTEP, "average": AVERAGE, "full_scale": full_scale(ATIME, ASTEP)}

    def identity(self):
        return {"device_id": device_id(), "channel_id": CHANNEL_ID,
                "sensor_id": "as7341-%d" % self.settings["generation"], "sensor_model": "AS7341"}

    def read_cycle(self):
        """One pass over both banks of channels: (eight bands, clear, NIR, saturated). Each bank is a fresh read.

        The chip reads six channels at a time. The library's private helpers give the chip's own saturation
        bit (ASTATUS, bit 7) and the clear and NIR counts of each bank; when they are missing in a newer
        library, the public reads stand in and only the count threshold can say "saturated".
        """
        sensor = self.sensor
        try:
            low_status, low, low_clear, low_nir = self._bank(sensor._configure_f1_f4, sensor)
            high_status, high, high_clear, high_nir = self._bank(sensor._configure_f5_f8, sensor)
        except AttributeError:
            bands = tuple(sensor.all_channels)
            clear = sensor.channel_clear
            nir = sensor.channel_nir
            return bands, clear, nir, max(bands + (clear, nir)) >= full_scale(ATIME, ASTEP), 0
        saturated = bool((low_status | high_status) & 0x80)
        drift = abs(low_clear - high_clear)
        return (low + high, (low_clear + high_clear) / 2.0, (low_nir + high_nir) / 2.0, saturated, drift)

    @staticmethod
    def _bank(configure, sensor):
        configure()
        status, a, b, c, d, clear, nir = sensor._all_channels
        return status, (a, b, c, d), clear, nir

    def measure(self, samples=None):
        """Average several cycles. Returns the raw counts and the quality flags."""
        samples = samples or AVERAGE
        if not self.settled:
            self.read_cycle()  # the first read after a change mixes old and new settings
            self.settled = True
        rows, clears, nirs, saturated, drifts = [], [], [], False, []
        for _ in range(samples):
            bands, clear, nir, sat, drift = self.read_cycle()
            rows.append(bands)
            clears.append(clear)
            nirs.append(nir)
            saturated = saturated or sat
            drifts.append((drift, clear))
            self.read_commands()
        means = [sum(row[i] for row in rows) / len(rows) for i in range(8)]
        scale = full_scale(ATIME, ASTEP)
        flags = []
        if saturated or max(means + [max(clears)]) >= scale:
            flags.append("saturated")
        if max(means) < LOW_LIGHT:
            flags.append("low_light")
        moved = len(rows) > 1 and any(
            spread_too_big(max(row[i] for row in rows) - min(row[i] for row in rows), means[i]) for i in range(8))
        if moved or any(spread_too_big(drift, clear) for drift, clear in drifts):
            flags.append("unstable")
        raw = dict(zip(NAMES, [int(round(v)) for v in means]))
        raw["clear"] = int(round(sum(clears) / len(clears)))
        raw["nir"] = int(round(sum(nirs) / len(nirs)))
        return raw, flags

    # -- commands from the app --------------------------------------------------------------------------
    def read_commands(self):
        """Take whatever the host has typed, one line at a time, without waiting for more."""
        while supervisor.runtime.serial_bytes_available:
            char = sys.stdin.read(1)
            if char == "\n":
                text, self.line = self.line, ""
                self.run_line(text)
            elif char != "\r" and len(self.line) < 240:
                self.line += char

    def run_line(self, text):
        text = text.strip()
        if not text.startswith("DV1 "):
            return
        try:
            command = json.loads(text[4:])
            name = command["cmd"]
        except (ValueError, KeyError, TypeError):
            emit({"t": "ack", "cmd": None, "ok": False, "message": "That is not a command Deja Vu1 sends."})
            return
        if name == "hello":
            self.hello()
            return
        message = {"t": "autogain" if name == "autogain" else "ack", "cmd": name}
        message.update(self.execute(name, command, True))
        emit(message)

    def execute(self, name, command, usb):
        """Run one command from the app. Returns a dict with ok and a sentence; never raises."""
        try:
            return self._execute(name, command, usb)
        except Exception as error:  # a bad command must never stop the readings
            return {"ok": False, "message": "That command failed: %s" % error}

    def _execute(self, name, command, usb):
        if name in ("wifi_set", "wifi_clear", "wifi_test", "net"):
            if not usb:
                return {"ok": False, "message": "Wi-Fi settings only change over USB."}
            return self.net_command(name, command)
        if self.sensor is None:
            return {"ok": False, "message": "The sensor is not answering yet."}
        if name == "set":
            return self.set_values(command)
        if name == "autogain":
            return self.autogain()
        if name == "new_sensor":
            self.settings["generation"] = min(255, self.settings["generation"] + 1)
            self.persist()
            result = {"ok": True, "message": "This sensor now counts as a new one."}
            result.update(self.identity())
            return result
        return {"ok": False, "message": "Unknown command."}

    def set_values(self, command):
        wanted = dict(self.settings)
        led = self.led_on
        if "gain" in command:
            if command["gain"] not in GAINS:
                return {"ok": False, "message": "gain must be one of %s." % (GAINS,)}
            wanted["gain"] = command["gain"]
        if "led_ma" in command:
            value = command["led_ma"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 4 <= value <= MAX_LED_MA:
                return {"ok": False, "message": "led_ma must be between 4 and %d." % MAX_LED_MA}
            wanted["led_ma"] = 4 + 2 * int((value - 4) // 2)  # the chip steps in twos
        if "led" in command:
            led = bool(command["led"])
        self.settings, self.led_on = wanted, led
        self.apply()
        self.persist()
        return {"ok": True, "message": "Settings changed.", "settings": self.describe(), "gain": wanted["gain"]}

    def persist(self):
        save_settings(self.settings)

    def autogain(self):
        """Pick the highest gain that keeps the brightest channel under the target, with the white target in place."""
        if not self.led_on:
            return {"ok": False, "code": "led_off", "message": "Turn the light on first."}
        scale = full_scale(ATIME, ASTEP)
        before = self.settings["gain"]
        gain = 1
        peak = 0
        for _ in range(6):
            self.settings["gain"] = gain
            self.apply()
            raw, flags = self.measure(1)
            peak = max(raw.values())
            if "saturated" in flags:
                if gain == GAINS[0]:
                    self.restore_gain(before)
                    return {"ok": False, "code": "too_bright",
                            "message": "Too bright even at the lowest gain. Lower the light or move the target away."}
                gain = GAINS[GAINS.index(gain) - 1]
                continue
            ideal = gain * AUTOGAIN_TARGET * scale / max(peak, 1)
            choice = max([g for g in GAINS if g <= ideal] or [GAINS[0]])
            if choice == gain:
                break
            gain = choice
        else:
            self.restore_gain(before)
            return {"ok": False, "code": "unsettled",
                    "message": "The light level kept changing. Hold the target still and try again."}
        if peak < LOW_LIGHT:
            self.restore_gain(before)
            return {"ok": False, "code": "too_dark", "peak": peak,
                    "message": "Very little light even at the highest gain. Put the white target in place."}
        self.persist()
        percent = round(100.0 * peak / scale, 1)
        return {"ok": True, "gain": gain, "peak": peak, "full_scale": scale, "peak_percent": percent,
                "message": "Gain %s keeps the brightest channel at %s %% of full scale." % (gain, percent),
                "settings": self.describe()}

    def restore_gain(self, gain):
        self.settings["gain"] = gain
        self.apply()

    # -- Wi-Fi settings, over USB -----------------------------------------------------------------------
    def net_command(self, name, command):
        link = self.link
        if name == "net":
            return {"ok": True, "message": link.message or "Wi-Fi status.", "net": link.public()}
        if name == "wifi_clear":
            save_net_block({})
            link.reload()
            return {"ok": True, "message": "The Wi-Fi settings the app saved are erased. settings.toml still applies.",
                    "net": link.public()}
        if name == "wifi_test":
            link.attempt_at = -1000
            if not link.join():
                return {"ok": False, "message": link.message or "Wi-Fi is not set up.", "net": link.public()}
            try:
                ok = link.sync()
            except OSError as error:
                link.set("unreachable", "Joined the Wi-Fi but could not reach Deja Vu1 (%s)." % error)
                ok = False
            if ok:
                link.set("ok", "Reached Deja Vu1.")
            return {"ok": ok, "message": link.message, "net": link.public()}
        saved = load_net_block()
        ssid = command.get("ssid")
        if ssid is not None:
            if not isinstance(ssid, str) or not 1 <= len(ssid) <= 32:
                return {"ok": False, "message": "The Wi-Fi name must be 1 to 32 characters."}
            saved["ssid"] = ssid
        password = command.get("password")
        if password is not None:
            if not isinstance(password, str) or not (password == "" or 8 <= len(password) <= 63 or len(password) == 64):
                return {"ok": False,
                        "message": "A Wi-Fi password is 8 to 63 characters (or empty for an open network)."}
            saved["password"] = password
        if "server" in command:
            servers = clean_servers(command["server"])
            if not servers:
                return {"ok": False, "message": "Give the computer's address as 192.168.1.23 or 192.168.1.23:8000."}
            saved["server"] = ["%s:%d" % pair for pair in servers]
            saved.pop("token", None)  # a key for another address is no use
        printer = command.get("printer")
        if printer is not None:
            if not isinstance(printer, str) or not 1 <= len(printer) <= 64 or not all(
                    c.isalpha() or c.isdigit() or c in "_.:-" for c in printer):
                return {"ok": False, "message": "That printer id is not one Deja Vu1 makes."}
            saved["printer"] = printer
        code = command.get("code")
        if code is not None:
            if not isinstance(code, str) or not code.isdigit() or len(code) > 12:
                return {"ok": False, "message": "A pairing code is digits only."}
            saved["code"] = code
            saved.pop("token", None)
        if not save_net_block(saved):
            return {"ok": False, "message": "There is no room to keep the Wi-Fi settings on this board."}
        link.reload()
        return {"ok": True, "message": "Saved on the Pico. It never shows the password again.", "net": link.public()}

    # -- the board's LED ------------------------------------------------------------------------------------
    def blinks(self):
        if self.sensor is None:
            return 4
        return {"no_wifi": 1, "unreachable": 2, "refused": 3}.get(self.link.state, 0)

    def show(self):
        if self.led is None:
            return
        count = self.blinks()
        if count == 0:
            self.led.value = True
            return
        for _ in range(count):
            self.led.value = True
            time.sleep(0.12)
            self.led.value = False
            time.sleep(0.18)
        time.sleep(0.3)

    # -- output -----------------------------------------------------------------------------------------
    def hello(self):
        message = {"t": "hello", "protocol": PROTOCOL, "firmware": FIRMWARE, "sensor_ready": self.sensor is not None,
                   "settings": self.describe(), "net": self.link.public()}
        message.update(self.identity())
        emit(message)

    def trouble(self, code, words):
        """Say what is wrong, once and then every ten seconds, so a late page still hears it."""
        now = time.monotonic()
        if code != self.problem or now - self.problem_at > 10:
            self.problem, self.problem_at = code, now
            emit({"t": "error", "code": code, "message": words})
            print(words)

    @staticmethod
    def plain(result, identifier):
        """A command's result as the app takes it back by Wi-Fi: a short list of plain facts."""
        out = {"id": identifier}
        for key in ("ok", "message", "gain", "peak", "peak_percent", "code"):
            value = result.get(key)
            if isinstance(value, (bool, int, float)):
                out[key] = value
            elif isinstance(value, str):
                out[key] = "".join(c for c in value[:190] if 32 <= ord(c) < 127)
        return out

    def net_step(self, message):
        """Send this reading by Wi-Fi, run what the app asked for in the reply, and say if the Wi-Fi state changed."""
        link = self.link
        commands = link.send(message, self.pending_result)
        if commands is not None:
            self.pending_result = None
            for command in commands:
                outcome = self.execute(command.get("cmd"), command, False)
                self.pending_result = self.plain(outcome, command.get("id"))
        if link.state != self.reported_state and link.state != "off":
            self.reported_state = link.state
            print("Wi-Fi: " + link.message)
            net = {"t": "net"}
            net.update(link.public())
            emit(net)

    def step(self):
        """One pass of the main loop: reach the sensor, take commands, then a reading (or say what is wrong)."""
        if self.sensor is None:
            problem = self.connect()
            if problem:
                self.read_commands()  # a hello still gets its answer with no sensor
                self.trouble(*problem)
                self.show()
                time.sleep(1)
                return
            self.problem = None
            self.hello()
            print("AS7341 found. LEDs on at %d mA, gain %sx." % (self.settings["led_ma"], self.settings["gain"]))
        self.read_commands()
        started = time.monotonic()
        try:
            raw, flags = self.measure()
        except (OSError, RuntimeError) as error:  # the sensor wire came loose, or the chip stopped answering
            self.sensor = None
            self.trouble("sensor_lost", "The sensor stopped answering (%s). Unplug the USB and check its four wires." %
                         error)
            self.show()
            return
        self.count += 1
        message = {"t": "reading", "seq": self.count, "raw": raw, "quality_flags": flags, "settings": self.describe()}
        message.update(self.identity())
        emit(message)
        if HUMAN_LINES:
            bands = "  ".join(b + ":" + str(raw[n]) for b, n in zip(BANDS, NAMES))
            note = "  << " + ", ".join(flags) if flags else ""
            print("#%d nm %s  clear:%d  nir:%d%s" % (self.count, bands, raw["clear"], raw["nir"], note))
        self.net_step(message)
        self.show()
        while time.monotonic() - started < PERIOD_S:
            self.read_commands()
            time.sleep(0.05)


def main():
    print()
    print("Deja Vu1 colour checker firmware %s (protocol %d)" % (FIRMWARE, PROTOCOL))
    checker = Checker()
    checker.hello()
    net = checker.link.public()
    if net["state"] == "off":
        print("Wi-Fi is not set up: readings go over USB only. docs/colour-checker.md shows how to set it up.")
    else:
        print("Wi-Fi \"%s\" (from %s), app at %s" %
              (net["ssid"], net["source"], ", ".join(net["server"]) or "nothing yet"))
    while True:
        checker.step()


if __name__ == "__main__":
    main()
