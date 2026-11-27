"""The colour checker as it will really reach the app: over this computer's network address, not loopback.

Every other Wi-Fi test reaches the server at 127.0.0.1. A real Pico W reaches it at the computer's home-network
address, and the device lock treats a caller from that address differently: it always lets this computer in, so a
Pico is the one device that meets the lock. These tests run the real firmware file (stand-in radio, LED and sensor,
real sockets) against the real server on a non-loopback address, with the lock off and on, including a restart of the
Pico after it paired. They skip on a computer with no address besides loopback. Nothing here ran on a real Pico W.
"""

import os
import socket
import sys
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import colour_pico_sim as sim  # noqa: E402
import pairing  # noqa: E402
from tests.test_colour_wifi import DEVICE, WifiCase  # noqa: E402
from tests.test_real_printer import dv_app  # noqa: E402


def lan_address():
    """The address this computer uses to reach another network, or None when it only has loopback."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 9))  # a documentation address: nothing is sent by a UDP connect
        address = probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()
    return None if address.startswith("127.") or address == "0.0.0.0" else address


class LanCase(WifiCase):
    @classmethod
    def setUpClass(cls):
        cls.lan = lan_address()
        if not cls.lan:
            raise unittest.SkipTest("this computer has no network address besides loopback")
        cls.server = dv_app.DejaVuServer(("0.0.0.0", 0), dv_app.DejaVuHandler)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_port  # the test itself is this computer
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    def setUp(self):
        super().setUp()
        self.addCleanup(pairing.reset)
        self.address = "%s:%d" % (self.lan, self.server.server_port)

    def pico_on_lan(self, code=None, **options):
        env = {"DV1_SERVER": self.address}
        if code is not None:
            env["DV1_PAIR_CODE"] = code
        return self.pico(env=env, **options)


class WithTheLockOff(LanCase):
    def test_a_reading_from_the_network_address_is_accepted(self):
        rig = self.pico_on_lan()
        self.assign()
        self.step(2)
        head = self.server_view()["sensors"][0]
        self.assertEqual(rig.checker.link.state, "ok")
        self.assertEqual(self.blinks(), 0)
        self.assertEqual(head["reading"]["info"]["transport"], "wifi")


class WithTheLockOn(LanCase):
    def setUp(self):
        super().setUp()
        pairing.set_lock(True)  # from this computer, which the lock always lets in

    def test_the_lock_really_refuses_a_caller_that_is_not_this_computer(self):
        # Guards the other tests: if the address used here were treated as this computer, they would prove nothing.
        rig = self.pico_on_lan()
        self.assign()
        self.step()
        link = rig.checker.link
        self.assertEqual(link.state, "refused")
        self.assertIn("device lock", link.message)
        self.assertEqual(self.blinks(), 3)

    def test_a_pairing_code_in_settings_pairs_the_pico_and_its_readings_are_accepted(self):
        code = pairing.generate_code()["code"]
        rig = self.pico_on_lan(code=code)
        self.assign()
        self.step(2)
        link = rig.checker.link
        self.assertEqual(link.state, "ok", link.message)
        self.assertEqual(self.blinks(), 0)
        self.assertTrue(link.net["token"])
        devices = pairing.list_devices()
        self.assertEqual(len(devices), 1)
        self.assertTrue(devices[0]["name"].startswith("Colour checker pico-"))
        self.assertEqual(self.server_view()["sensors"][0]["reading"]["info"]["transport"], "wifi")

    def test_the_key_survives_an_unplug_and_the_used_up_code_is_not_tried_again(self):
        code = pairing.generate_code()["code"]
        first = self.pico_on_lan(code=code)
        self.assign()
        self.step(2)
        self.assertEqual(first.checker.link.state, "ok")
        memory = first.nvm
        first.close()
        # The Pico is unplugged and plugged in again: same non-volatile memory, same settings.toml (code still in it).
        second = self.pico_on_lan(code=code, nvm=memory)
        self.step(2)
        link = second.checker.link
        self.assertEqual(link.state, "ok", link.message)
        self.assertEqual(len(pairing.list_devices()), 1)  # it did not pair a second time

    def test_a_code_that_is_wrong_is_refused_in_words_and_nothing_is_recorded(self):
        pairing.generate_code()
        rig = self.pico_on_lan(code="000000")
        self.assign()
        self.step()
        link = rig.checker.link
        self.assertEqual(link.state, "refused")
        self.assertIn("pairing code was not accepted", link.message)
        self.assertEqual(self.blinks(), 3)
        self.assertEqual(pairing.list_devices(), [])
        self.assertIsNone(self.server_view()["sensors"][0].get("reading"))

    def test_a_new_pico_can_pair_after_the_first_one_was_unpaired(self):
        code = pairing.generate_code()["code"]
        self.pico_on_lan(code=code)
        self.assign()
        self.step(2)
        pairing.unpair(pairing.list_devices()[0]["id"])
        self.step(1)  # its key no longer works
        self.assertEqual(self.rig.checker.link.state, "refused")
        again = pairing.generate_code()["code"]
        self.rig.checker.link.net["code"] = again  # the app wrote a new code with the setup window
        self.step(2)
        self.assertEqual(self.rig.checker.link.state, "ok", self.rig.checker.link.message)


if __name__ == "__main__":
    unittest.main()
