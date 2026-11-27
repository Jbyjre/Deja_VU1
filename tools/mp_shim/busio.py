"""Stand-in I2C bus: one device at 0x39."""


class I2C:
    def __init__(self, scl, sda):
        pass

    def try_lock(self):
        return True

    def unlock(self):
        pass

    def scan(self):
        return [0x39]
