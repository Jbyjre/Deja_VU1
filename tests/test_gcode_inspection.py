import os
import sys
import unittest
sys.path.insert(0,os.path.join(os.path.dirname(os.path.dirname(__file__)),'backend'))
import gcode_tools


class GcodeInspection(unittest.TestCase):
    def test_speed_feature_retraction_and_tool_markers(self):
        text='PRINT_START\nM83\nT0\n;TYPE:Outer wall\nG1 X10 Y10 Z.2 F600\nG1 X20 E2 F1200\nG1 E-1\nG1 E1\nT1\n; FEATURE: Sparse infill\nG1 Y20 E3 F1800'
        a=gcode_tools.analyze(text)
        self.assertEqual(a['filament_mm'],{'T0':2.0,'T1':3.0})
        self.assertIn('Outer wall',a['toolpath']['feature_names'])
        self.assertEqual(a['toolpath']['segments'][-1][8],30)
        self.assertEqual(a['toolpath']['markers'][1]['kind'],'retraction')
        self.assertEqual(a['layer_heights'],[.2])

    def test_nominal_motion_is_computed_from_distance_and_feed(self):
        a=gcode_tools.analyze('PRINT_START\nM83\nG1 X60 F600\nG1 X120 E1 F1200')
        self.assertEqual(a['nominal_motion_seconds'],9)
        self.assertIn('excludes acceleration',a['nominal_motion_note'])

    def test_g92_does_not_count_recovery_as_new_filament(self):
        a=gcode_tools.analyze('PRINT_START\nM82\nG1 X10 E5\nG1 E4\nG92 E0\nG1 E1\nG1 X20 E2')
        self.assertEqual(a['filament_mm']['T0'],6)
