import copy
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backend'))
sys.path.insert(0, os.path.dirname(__file__))
import mock_moonraker as mock
import moonraker_client as mc
import tool_setup
from fake_moonraker import FakeMoonraker


def heads():
    return [{'toolhead': 'T'+str(i), 'color_hex': '#123456', 'material': 'PLA',
             'nozzle': .4, 'height': .2} for i in range(4)]


class ToolSetup(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        p = patch.object(tool_setup, '_PATH', os.path.join(folder.name, 'tools.json'))
        p.start(); self.addCleanup(p.stop)

    def test_no_invented_saved_choices(self):
        self.assertEqual(tool_setup.get()['heads'], [])

    def test_four_heads_persist_independently_per_printer(self):
        with mock.use_printer('u1-workshop'):
            tool_setup.save({'heads': heads()})
            self.assertEqual(len(tool_setup.get()['heads']), 4)
        with mock.use_printer('u1-studio'):
            self.assertEqual(tool_setup.get()['heads'], [])

    def test_duplicate_or_virtual_heads_refused(self):
        for th in ('T4', 'T0'):
            rows = heads(); rows[3]['toolhead'] = th
            with self.assertRaises(ValueError):tool_setup.save({'heads': rows})

    def test_bad_height_colour_and_material_refused(self):
        for k,v in [('height',float('nan')),('color_hex','red" onclick="x'),('material','PLA\nM112')]:
            rows = heads(); rows[0][k] = v
            with self.assertRaises(ValueError):tool_setup.save({'heads': rows})

    def test_simulated_write_changes_readings_and_gate_source(self):
        with mock.use_printer('u1-garage'):
            printer = mock._sim()
            original = copy.deepcopy(printer.live)
            self.addCleanup(lambda:setattr(printer, 'live', original))
            printer.live['state'] = 'ready'
            result = mock.set_filament(heads()[0])
            self.assertTrue(result['verified'])
            self.assertEqual(mock.get_printer_state()['toolheads']['T0']['filament_color_hex'], '#123456')

    def test_simulated_busy_refuses(self):
        with mock.use_printer('u1-workshop'):
            with patch.dict(mock._sim().live, {'state':'printing'}):
                with self.assertRaisesRegex(ValueError,'idle'):mock.set_filament(heads()[0])


class RealFilament(unittest.TestCase):
    def setUp(self):
        self.fake = FakeMoonraker()
        self.addCleanup(self.fake.close)
        self.printer = mc.MoonrakerPrinter('tools-test','Bench',self.fake.url)
        self.printer.start()
        self.addCleanup(self.printer.stop)
        deadline=time.monotonic()+5
        while not self.printer.is_connected() and time.monotonic()<deadline:time.sleep(.02)
        self.assertTrue(self.printer.is_connected())

    def test_colour_material_written_and_read_back_on_physical_head(self):
        self.fake.set('print_task_config',extruder_map_table=[3,2,1,0])
        self.assertTrue(self.printer.set_filament('T0','#123456','PETG')['verified'])
        self.assertEqual(self.fake.status['print_task_config']['filament_type'][0],'PETG')
        self.assertIn('CONFIG_EXTRUDER=0',self.fake.scripts[-1])
        self.assertNotIn('FORCE',self.fake.scripts[-1])

    def test_refused_write_is_reported(self):
        self.fake.gcode_errors['SET_PRINT_FILAMENT_CONFIG']='official filament, not configurable'
        with self.assertRaisesRegex(mc.PrinterRefused,'official filament'):
            self.printer.set_filament('T0','#123456','PLA')

    def test_unloaded_head_refused_before_command(self):
        with self.assertRaisesRegex(ValueError,'Load filament'):
            self.printer.set_filament('T2','#123456','PLA')
        self.assertEqual(self.fake.scripts,[])
