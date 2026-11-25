# Deja Vu1 colour checker, firmware 1.0.0, for a Waveshare AS7341 on a Raspberry Pi Pico W.
# CircuitPython 10.x. Copy this file to the CIRCUITPY drive as code.py, with adafruit_as7341.mpy and the
# adafruit_bus_device and adafruit_register folders in CIRCUITPY/lib (docs/colour-checker.md has the steps).
#
# Wiring: VCC (red) -> pin 36 3V3(OUT), GND (black) -> pin 38, SDA (blue) -> pin 6 GP4,
# SCL (yellow) -> pin 7 GP5. INT (orange) and GPIO (green) stay unconnected.
#
# What it does: reads the sensor over and over with the board's two white LEDs on, and prints one
# line per reading that starts with "DV1 " and holds one JSON object. Deja Vu1 reads those lines in the
# browser (Chrome or Edge, Web Serial) and posts them to the app. It also prints a plain line for
# people watching the console. It reads commands the same way: a line that starts with "DV1 " and
# holds a JSON object, for example DV1 {"cmd": "hello"}. Never send Ctrl-C: CircuitPython stops the
# program on it. The protocol is described in docs/colour-sensor-api.md ("Pico serial protocol").
#
# Raw counts only: this file never turns counts into a colour. Deja Vu1 does that from a white and a
# dark reference you record, and it ties each reference to the settings in "settings" below.
import json
import sys
import time

import board
import busio
import microcontroller
import supervisor

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
PERIOD_S = 2.0  # a new line at most this often
HUMAN_LINES = True  # also print a plain line per reading, for the serial console
# --------------------------------------------------------------------------------------------------------

GAINS = (0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512)  # the chip's register value is the index
NAMES = ("f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8")
BANDS = ("415", "445", "480", "515", "555", "590", "630", "680")
MAGIC = b"DV1"
NVM_LENGTH = 8
SENSOR_ADDRESS = 0x39


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
        self.last_reading = 0.0

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
        try:
            self.run_command(name, command)
        except Exception as error:  # a bad command must never stop the readings
            emit({"t": "ack", "cmd": name, "ok": False, "message": "That command failed: %s" % error})

    def run_command(self, name, command):
        if name == "hello":
            self.hello()
            return
        if self.sensor is None:
            emit({"t": "ack", "cmd": name, "ok": False, "message": "The sensor is not answering yet."})
            return
        if name == "set":
            self.set_values(command)
        elif name == "autogain":
            self.autogain()
        elif name == "new_sensor":
            self.settings["generation"] = min(255, self.settings["generation"] + 1)
            self.persist()
            message = {"t": "ack", "cmd": name, "ok": True, "message": "This sensor now counts as a new one."}
            message.update(self.identity())
            emit(message)
        else:
            emit({"t": "ack", "cmd": name, "ok": False, "message": "Unknown command."})

    def set_values(self, command):
        wanted = dict(self.settings)
        led = self.led_on
        if "gain" in command:
            if command["gain"] not in GAINS:
                emit({"t": "ack", "cmd": "set", "ok": False, "message": "gain must be one of %s." % (GAINS,)})
                return
            wanted["gain"] = command["gain"]
        if "led_ma" in command:
            value = command["led_ma"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 4 <= value <= MAX_LED_MA:
                emit({"t": "ack", "cmd": "set", "ok": False,
                      "message": "led_ma must be between 4 and %d." % MAX_LED_MA})
                return
            wanted["led_ma"] = 4 + 2 * int((value - 4) // 2)  # the chip steps in twos
        if "led" in command:
            led = bool(command["led"])
        self.settings, self.led_on = wanted, led
        self.apply()
        self.persist()
        emit({"t": "ack", "cmd": "set", "ok": True, "settings": self.describe()})

    def persist(self):
        save_settings(self.settings)

    def autogain(self):
        """Pick the highest gain that keeps the brightest channel under the target, with the white target in place."""
        if not self.led_on:
            emit({"t": "autogain", "ok": False, "code": "led_off", "message": "Turn the light on first."})
            return
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
                    emit({"t": "autogain", "ok": False, "code": "too_bright",
                          "message": "Too bright even at the lowest gain. Lower led_ma or move the target away."})
                    return
                gain = GAINS[GAINS.index(gain) - 1]
                continue
            ideal = gain * AUTOGAIN_TARGET * scale / max(peak, 1)
            choice = max([g for g in GAINS if g <= ideal] or [GAINS[0]])
            if choice == gain:
                break
            gain = choice
        else:
            self.restore_gain(before)
            emit({"t": "autogain", "ok": False, "code": "unsettled", "message": "The light level kept changing. "
                  "Hold the target still and try again."})
            return
        if peak < LOW_LIGHT:
            self.restore_gain(before)
            emit({"t": "autogain", "ok": False, "code": "too_dark", "peak": peak,
                  "message": "Very little light even at the highest gain. Put the white target in place."})
            return
        self.persist()
        emit({"t": "autogain", "ok": True, "gain": gain, "peak": peak, "full_scale": scale,
              "peak_percent": round(100.0 * peak / scale, 1), "settings": self.describe()})

    def restore_gain(self, gain):
        self.settings["gain"] = gain
        self.apply()

    # -- output -----------------------------------------------------------------------------------------
    def hello(self):
        message = {"t": "hello", "protocol": PROTOCOL, "firmware": FIRMWARE, "sensor_ready": self.sensor is not None,
                   "settings": self.describe()}
        message.update(self.identity())
        emit(message)

    def trouble(self, code, words):
        """Say what is wrong, once and then every ten seconds, so a late page still hears it."""
        now = time.monotonic()
        if code != self.problem or now - self.problem_at > 10:
            self.problem, self.problem_at = code, now
            emit({"t": "error", "code": code, "message": words})
            print(words)

    def step(self):
        """One pass of the main loop: reach the sensor, take commands, then a reading (or say what is wrong)."""
        if self.sensor is None:
            problem = self.connect()
            if problem:
                self.read_commands()  # a hello still gets its answer with no sensor
                self.trouble(*problem)
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
            return
        self.count += 1
        message = {"t": "reading", "seq": self.count, "raw": raw, "quality_flags": flags, "settings": self.describe()}
        message.update(self.identity())
        emit(message)
        if HUMAN_LINES:
            bands = "  ".join(b + ":" + str(raw[n]) for b, n in zip(BANDS, NAMES))
            note = "  << " + ", ".join(flags) if flags else ""
            print("#%d nm %s  clear:%d  nir:%d%s" % (self.count, bands, raw["clear"], raw["nir"], note))
        while time.monotonic() - started < PERIOD_S:
            self.read_commands()
            time.sleep(0.05)


def main():
    print()
    print("Deja Vu1 colour checker firmware %s (protocol %d)" % (FIRMWARE, PROTOCOL))
    checker = Checker()
    checker.hello()
    while True:
        checker.step()


if __name__ == "__main__":
    main()
