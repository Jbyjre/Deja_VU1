"""A small model of the AS7341 library's surface that the firmware uses (the same names as the real library).

Counts follow gain and the board's light linearly and clip at the chip's 16 bits, with a deterministic wobble.
The numbers are synthetic: this only lets the firmware run.
"""

_GAINS = (0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512)
_LED_SHAPE = (364, 3358, 3096, 3085, 3390, 3601, 2748, 1241)
_FULL = 65535


class Gain:
    pass


for _code, _name in enumerate(("0_5", "1", "2", "4", "8", "16", "32", "64", "128", "256", "512")):
    setattr(Gain, "GAIN_%sX" % _name, _code)


class AS7341:
    def __init__(self, i2c):
        self.atime = 100
        self.astep = 999
        self.gain = 5
        self.led_current = 4
        self.led = False
        self._n = 0
        self._last = (0,) * 7

    def _read(self, low):
        self._n += 1
        scale = (_GAINS[self.gain] / 16.0) * (self.led_current / 10.0 if self.led else 0.05) * 2.0
        bands = [v * scale for v in _LED_SHAPE]
        part = bands[0:4] if low else bands[4:8]
        values = [int(min(_FULL, max(0, v + (self._n * 7) % 5))) for v in part]
        values += [int(min(_FULL, 11453 * scale)), int(min(_FULL, 443 * scale))]
        status = 0x80 if any(v >= _FULL for v in values) else 0
        self._last = (status,) + tuple(values)

    def _configure_f1_f4(self):
        self._read(True)

    def _configure_f5_f8(self):
        self._read(False)

    @property
    def _all_channels(self):
        return self._last
