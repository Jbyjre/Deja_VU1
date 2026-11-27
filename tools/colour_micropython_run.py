"""Run the colour checker's real firmware file under MicroPython, an interpreter close to the Pico's CircuitPython.

    micropython tools/colour_micropython_run.py [steps]

CircuitPython is built on MicroPython, and ordinary Python accepts things the Pico's interpreter does not. This runs
hardware/colour-checker/code.py with the stand-in modules in tools/mp_shim/ (the sensor, the radio, the memory and the
sockets are stand-ins; the Wi-Fi settings come from the environment as the real board reads them from settings.toml)
and a fixed script of commands. It prints what the firmware prints and a last line, "MP-DONE", with the count of
unexpected failures and the Wi-Fi state. tests/test_colour_micropython.py drives it against the real server.

Not the same as CircuitPython: MicroPython has no ConnectionError (so a wrong Wi-Fi password is not tried here), its
floats are double precision, and its `time` is replaced here by tools/mp_shim/time.py. It has not run on a real Pico W.
"""
import sys

here = sys.argv[0].rsplit("/", 1)[0] if "/" in sys.argv[0] else "."
root = here.rsplit("/", 1)[0] if "/" in here else ".."
sys.path.insert(0, here + "/mp_shim")
sys.path.insert(1, root + "/hardware/colour-checker")

import code as fw  # noqa: E402

fw.PERIOD_S = 1.1  # readings are stamped in whole seconds and may not repeat, so they cannot come faster than that
steps = int(sys.argv[1]) if len(sys.argv) > 1 else 10
server = fw.getenv("DV1_SERVER") or ""

SCRIPT = {
    1: ['DV1 {"cmd": "hello"}'],
    2: ['DV1 {"cmd": "set", "gain": 8, "led_ma": 12}'],
    3: ['DV1 {"cmd": "autogain"}'],
    4: ['DV1 {"cmd": "nonsense"}', "this is only console chatter", 'DV1 {broken', 'DV1 {"cmd": "set", "gain": 3}'],
    5: ['DV1 {"cmd": "net"}',
        'DV1 {"cmd": "wifi_set", "ssid": "MPNet", "password": "12345678", "server": "%s", "printer": "%s"}' % (
            server, fw.getenv("DV1_PRINTER") or "p1")],
    6: ['DV1 {"cmd": "wifi_test"}'],
}
AFTER = ['DV1 {"cmd": "new_sensor"}']  # a new sensor id would make the app refuse the readings after it

checker = fw.Checker()
checker.hello()
for number in range(1, steps + 1):
    for line in SCRIPT.get(number, ()):
        checker.run_line(line)
    checker.safe_step()
for line in AFTER:
    checker.run_line(line)
print("MP-DONE failures=%d link=%s" % (checker.failures, checker.link.state))
