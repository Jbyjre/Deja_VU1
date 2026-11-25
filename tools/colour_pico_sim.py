"""A stand-in Pico for the colour checker: runs hardware/colour-checker/code.py on an ordinary computer.

It replaces the CircuitPython modules the firmware imports (board, busio, microcontroller, supervisor and
adafruit_as7341) with Python objects, and gives the firmware a model of an AS7341 looking at a spool. The tests use
it (tests/test_colour_firmware.py) and so does the browser check (tools/colour-bridge-check.js, through the command
line below). It never touches real hardware and its numbers are synthetic.

What the model is built from: the shape of the board's own white LEDs comes from a real reading on 25 November 2026
(415 to 680 nm at gain 16, 10 mA: 364, 3358, 3096, 3085, 3390, 3601, 2748, 1241; clear 11453, NIR 443). Everything
else is an assumption: the spools' spectra, the housing's brightness, the stray light and the noise. A colour that
comes out of a run through the app says the chain works. It says nothing about how close a real sensor gets.

Command line: reads lines from standard input and writes the firmware's lines to standard output.
    SIM {"spool": "white"}      put a synthetic spool in front of the sensor (see SPOOLS; "none" is an empty housing)
    SIM {"unplug": true}        the sensor stops answering, as when its wire comes loose
    DV1 {...}                   goes to the firmware as a command
"""

import importlib.util
import json
import os
import random
import sys
import threading
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIRMWARE_PATH = os.path.join(ROOT, "hardware", "colour-checker", "code.py")

LED_SHAPE = (364, 3358, 3096, 3085, 3390, 3601, 2748, 1241)  # the real reading's eight bands
LED_CLEAR = 11453
LED_NIR = 443
HOUSING = 4.0  # an assumption: how much brighter the target is in the holder than in the hand-held reading
STRAY = 0.02  # an assumption: the share of the white level the sensor sees with nothing in front of it
OFFSET = 3.0  # an assumption: counts the sensor reads in the dark

# Reflectance of each synthetic spool at 415, 445, 480, 515, 555, 590, 630 and 680 nm, then NIR.
SPOOLS = {
    "none": ((0.0,) * 8, 0.0),
    "white": ((1.0,) * 8, 1.0),
    "grey": ((0.4,) * 8, 0.4),
    "black": ((0.03,) * 8, 0.05),
    "red": ((0.04, 0.04, 0.04, 0.05, 0.12, 0.45, 0.75, 0.80), 0.8),
    "orange": ((0.04, 0.04, 0.05, 0.08, 0.25, 0.70, 0.85, 0.85), 0.8),
    "yellow": ((0.05, 0.06, 0.10, 0.40, 0.80, 0.85, 0.80, 0.80), 0.8),
    "green": ((0.04, 0.06, 0.15, 0.45, 0.35, 0.15, 0.06, 0.05), 0.6),
    "blue": ((0.30, 0.55, 0.50, 0.20, 0.08, 0.05, 0.05, 0.10), 0.6),
}


class Clock:
    """Time that moves only when the firmware sleeps or the sensor integrates, so tests do not wait."""

    def __init__(self, scale=0.0):
        self.now = 1000.0
        self.scale = scale  # command-line mode sleeps a fraction of every second so a browser sees readings

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        if self.scale:
            time.sleep(seconds * self.scale)


class SimSensor:
    """The AS7341 as the library shows it, looking at a synthetic spool."""

    private_names = True  # False imitates a newer library that has dropped the helpers the firmware prefers

    def __init__(self, i2c, address=0x39, rig=None):
        self.rig = rig
        self.atime = 100
        self.astep = 999
        self.gain = 8
        self.led_current = 4
        self.led = False
        self._bank = None
        self._last = (0,) * 6
        self._rng = random.Random(7)

    def __getattribute__(self, name):
        if name in ("_configure_f1_f4", "_configure_f5_f8", "_all_channels") and \
                not type(self).private_names:
            raise AttributeError(name)
        return object.__getattribute__(self, name)

    # -- what the chip does ---------------------------------------------------------------------------------
    def _full_scale(self):
        return min(65535, (self.atime + 1) * (self.astep + 1))

    def _counts(self):
        """The eight bands, clear and NIR for the spool in front, at the chip's present settings."""
        rig = self.rig
        reflect, nir_reflect = SPOOLS[rig.spool]
        gain = (0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512)[self.gain]
        scale = HOUSING * (gain / 16.0) * (self.led_current / 10.0 if self.led else 0.0)
        scale *= (self.atime + 1) * (self.astep + 1) / 101000.0
        bands = [LED_SHAPE[i] * scale * (reflect[i] + STRAY) + OFFSET for i in range(8)]
        clear = LED_CLEAR * scale * (sum(reflect) / 8.0 + STRAY) + OFFSET
        nir = LED_NIR * scale * (nir_reflect + STRAY) + OFFSET
        if rig.drift:
            factor = 1.0 + rig.drift * self._rng.uniform(-1, 1)
            bands, clear, nir = [v * factor for v in bands], clear * factor, nir * factor
        return bands, clear, nir

    def _noisy(self, value):
        return value + self._rng.gauss(0, 0.7 * max(value, 0) ** 0.5 + 1.5)

    def _read(self, low):
        rig = self.rig
        if rig.unplugged:
            raise OSError(19, "No such device")
        rig.clock.now += (self.atime + 1) * (self.astep + 1) * 2.78e-6 + 0.03
        bands, clear, nir = self._counts()
        part = bands[0:4] if low else bands[4:8]
        scale = self._full_scale()
        values = [int(min(scale, max(0, round(self._noisy(v))))) for v in list(part) + [clear, nir]]
        status = 0x80 if any(v >= scale for v in values) else 0
        self._last = (status,) + tuple(values)

    def _configure_f1_f4(self):
        self._read(True)

    def _configure_f5_f8(self):
        self._read(False)

    @property
    def _all_channels(self):
        return self._last

    @property
    def all_channels(self):
        self._read(True)
        low = self._last[1:5]
        self._read(False)
        return tuple(low) + tuple(self._last[1:5])

    @property
    def channel_clear(self):
        self._read(True)
        return self._last[5]

    @property
    def channel_nir(self):
        return self._last[6]


class Rig:
    """The firmware loaded against stand-in modules, plus the things a test or the command line changes."""

    def __init__(self, scale=0.0, spool="white", sensor_present=True, wiring_ok=True, private_names=True,
                 nvm=True, uid=bytes.fromhex("deadbeef00000001")):
        self.clock = Clock(scale)
        self.spool = spool
        self.drift = 0.0
        self.unplugged = False
        self.sensor_present = sensor_present
        self.wiring_ok = wiring_ok
        self.typed = []  # characters the firmware has yet to read
        self.nvm = nvm if isinstance(nvm, bytearray) else (bytearray(b"\xff" * 4096) if nvm else None)
        self.uid = uid
        self.sensor = None
        rig = self

        class I2C:
            def __init__(self, scl, sda):
                if not rig.wiring_ok:
                    raise RuntimeError("No pull up found on SDA or SCL; check your wiring")

            def try_lock(self):
                return True

            def unlock(self):
                pass

            def scan(self):
                return [0x39] if rig.sensor_present and not rig.unplugged else []

        class Sensor(SimSensor):
            pass

        Sensor.private_names = private_names

        def make_sensor(i2c, address=0x39):
            rig.sensor = Sensor(i2c, address, rig)
            return rig.sensor

        class Gain:
            pass

        for code, name in enumerate(("0_5", "1", "2", "4", "8", "16", "32", "64", "128", "256", "512")):
            setattr(Gain, "GAIN_%sX" % name, code)

        class Stdin:
            def read(self, count):
                taken, rig.typed = rig.typed[:count], rig.typed[count:]
                return "".join(taken)

        class Runtime:
            @property
            def serial_bytes_available(self):
                return len(rig.typed)

        modules = {
            "board": types.SimpleNamespace(GP4="GP4", GP5="GP5"),
            "busio": types.SimpleNamespace(I2C=I2C),
            "microcontroller": types.SimpleNamespace(cpu=types.SimpleNamespace(uid=self.uid), nvm=self.nvm),
            "supervisor": types.SimpleNamespace(runtime=Runtime()),
            "adafruit_as7341": types.SimpleNamespace(AS7341=make_sensor, Gain=Gain),
        }
        self._saved = {name: sys.modules.get(name) for name in modules}
        sys.modules.update(modules)
        self._stdin = sys.stdin
        sys.stdin = Stdin()
        spec = importlib.util.spec_from_file_location("dv1_firmware", FIRMWARE_PATH)
        self.firmware = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.firmware)
        self.firmware.time = self.clock  # the firmware's sleeps and timestamps follow the stand-in clock
        self.checker = self.firmware.Checker()

    def close(self):
        sys.stdin = self._stdin
        for name, old in self._saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old

    def type(self, text):
        """What a host would send down the serial line."""
        self.typed.extend(text if text.endswith("\n") else text + "\n")

    def command(self, **body):
        self.type("DV1 " + json.dumps(body))


def command_line():
    rig = Rig(scale=0.25, spool="none")
    lock = threading.Lock()

    def feed():
        for raw in sys.stdin_real:
            raw = raw.rstrip("\r\n")
            with lock:
                if raw.startswith("SIM "):
                    body = json.loads(raw[4:])
                    if "spool" in body and body["spool"] in SPOOLS:
                        rig.spool = body["spool"]
                    if "unplug" in body:
                        rig.unplugged = bool(body["unplug"])
                    if "drift" in body:
                        rig.drift = float(body["drift"])
                elif raw.startswith("DV1 "):
                    rig.type(raw)

    sys.stdin_real = rig._stdin
    threading.Thread(target=feed, daemon=True).start()
    rig.firmware.print = lambda *args: (sys.stdout.write(" ".join(str(a) for a in args) + "\n"), sys.stdout.flush())
    print("Deja Vu1 colour checker firmware %s (protocol %d)" % (rig.firmware.FIRMWARE, rig.firmware.PROTOCOL))
    rig.checker.hello()
    while True:
        rig.checker.step()


if __name__ == "__main__":
    command_line()
