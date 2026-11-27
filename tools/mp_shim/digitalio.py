"""Stand-in for the board's LED pin."""


class Direction:
    OUTPUT = 1


class DigitalInOut:
    def __init__(self, pin):
        self.direction = None
        self.value = False
