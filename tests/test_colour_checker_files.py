"""The files that make up the colour checker's hardware side stay in step."""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


class TestPublishedFirmware(unittest.TestCase):
    def test_the_copy_the_setup_window_offers_is_the_firmware(self):
        self.assertEqual(read("hardware", "colour-checker", "code.py"), read("frontend", "colour-checker", "code.py"),
                         "Copy hardware/colour-checker/code.py to frontend/colour-checker/code.py")

    def test_the_page_loads_the_setup_files_in_order(self):
        page = read("frontend", "index.html")
        self.assertIn('href="colour-setup.css"', page)
        order = [page.index(name) for name in ("app-modules.js", "printer-extras.js", "colour-bridge.js", "colour-setup.js", "rail.js")]
        self.assertEqual(order, sorted(order))

    def test_the_firmware_never_holds_a_unix_time_as_a_float(self):
        code = read("hardware", "colour-checker", "code.py")
        self.assertNotIn("time.time()", code)  # CircuitPython floats are single precision: a Unix time would be off by minutes
        self.assertIn("monotonic_ns", code)

    def test_the_led_table_in_the_firmware_and_in_the_window_say_the_same_things(self):
        code = read("hardware", "colour-checker", "code.py")
        window = read("frontend", "colour-setup.js")
        for blinks in ("1 blink", "2 blinks", "3 blinks", "4 blinks"):
            self.assertIn('"%s"' % blinks, code)
            self.assertRegex(window, re.escape(blinks))

    def test_the_firmware_has_no_password_in_any_message_it_builds(self):
        code = read("hardware", "colour-checker", "code.py")
        public = code[code.index("    def public(self):"):code.index("    def rssi(self):")]
        self.assertNotIn('net["password"]', public)
        self.assertNotIn('net["token"]', public.replace('bool(net["token"])', ""))


if __name__ == "__main__":
    unittest.main()
