"""CircuitPython's time functions on MicroPython's clock: sleep, monotonic and monotonic_ns."""
import utime


def sleep(seconds):
    utime.sleep(seconds)


def monotonic_ns():
    return utime.time_ns()


def monotonic():
    return utime.time_ns() / 1e9
