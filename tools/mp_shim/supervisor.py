"""Stand-in supervisor: no typed bytes (the driver hands commands to the firmware itself), and reload() is counted."""


class _Runtime:
    serial_bytes_available = 0


runtime = _Runtime()
reloads = 0


def reload():
    global reloads
    reloads += 1
