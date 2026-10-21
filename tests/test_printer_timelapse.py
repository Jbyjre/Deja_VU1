import os
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backend'))
import timelapse
import mock_moonraker


class PrinterTimelapse(unittest.TestCase):
    def setUp(self):
        timelapse.reset()
        self.addCleanup(timelapse.reset)
        self.enabled=patch('modules.is_enabled',return_value=True)
        self.enabled.start();self.addCleanup(self.enabled.stop)

    def capture(self,pid,session,data=b'\xff\xd8picture\xff\xd9'):
        with patch.object(mock_moonraker,'camera_snapshot',return_value=(data,'image/jpeg')):
            timelapse._capture_camera(pid,4,session)

    def test_each_printer_keeps_its_own_picture(self):
        a=timelapse.begin('u1-workshop','one.gcode','camera')
        b=timelapse.begin('u1-studio','two.gcode','camera')
        self.capture('u1-workshop',a,b'\xff\xd8one\xff\xd9')
        self.capture('u1-studio',b,b'\xff\xd8two\xff\xd9')
        self.assertIn(b'one',timelapse.frame('u1-workshop',a,'00001.jpg')[0])
        self.assertIn(b'two',timelapse.frame('u1-studio',b,'00001.jpg')[0])

    def test_late_picture_does_not_enter_next_print(self):
        old=timelapse.begin('u1-workshop','same.gcode','camera')
        new=timelapse.begin('u1-workshop','same.gcode','camera')
        self.assertNotEqual(old,new)
        self.capture('u1-workshop',old)
        self.assertEqual(timelapse.frames('u1-workshop',new),[])

    def test_refusal_is_visible_and_retry_is_delayed(self):
        session=timelapse.begin('u1-workshop','one.gcode','camera')
        with patch.object(mock_moonraker,'camera_snapshot',side_effect=ValueError('Camera refused')):
            timelapse._capture_camera('u1-workshop',4,session)
        self.assertIn('Camera refused',timelapse.sessions('u1-workshop')[0]['last_error'])
        self.assertFalse(timelapse.request_camera('u1-workshop',4))

    def test_disabled_module_never_captures(self):
        session=timelapse.begin('u1-workshop','one.gcode','camera')
        with patch('modules.is_enabled',return_value=False),patch.object(mock_moonraker,'camera_snapshot') as camera:
            timelapse._capture_camera('u1-workshop',4,session)
            camera.assert_not_called()

    def test_parent_path_is_refused(self):
        with self.assertRaises(ValueError):timelapse.frames('..','..')
