import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'backend'))
import converter_3mf as converter
import mock_moonraker as mock
import sample_files
import tool_setup


class NativeCompatibility(unittest.TestCase):
    def source(self,**changes):
        config={'printer_model':'Bambu Lab P1S','filament_type':['PLA'],'filament_colour':['#000000'],'nozzle_diameter':['.4'],'layer_height':'.2'}
        config.update(changes);return sample_files._project_3mf('BambuStudio-01.10',config)

    def test_unknown_material_is_not_replaced_with_pla(self):
        with self.assertRaisesRegex(converter.ConversionError,'not be silently replaced'):
            converter.convert(self.source(filament_type=['SPECIAL_UNKNOWN']))

    def test_unsupported_nozzle_is_not_replaced_with_point_four(self):
        with self.assertRaisesRegex(converter.ConversionError,'no 0.3 mm'):
            converter.convert(self.source(nozzle_diameter=['.3']))

    def test_nonfinite_layer_height_is_refused(self):
        with self.assertRaisesRegex(converter.ConversionError,'invalid layer height'):
            converter.convert(self.source(layer_height='NaN'))

    def test_mixed_nozzles_are_kept_and_explained(self):
        data,report=converter.convert(self.source(nozzle_diameter=['.4','.6','.4','.6']))
        self.assertTrue(any('Different source nozzle' in w for w in report['warnings']))

    def test_selection_for_offline_settings_does_not_construct_printer(self):
        before=mock.selected_printer_id()
        with patch.object(mock,'_get',side_effect=AssertionError('Must not connect')):
            with mock.selection_only('offline-printer'):
                self.assertEqual(mock.selected_printer_id(),'offline-printer')
        self.assertEqual(mock.selected_printer_id(),before)

    def test_simulated_cancel_records_history_and_docks_head(self):
        mock.reset_all();self.addCleanup(mock.reset_all)
        with mock.use_printer('u1-workshop'):
            before=len(mock.get_print_history());state=mock.cancel_print()
            history=mock.get_print_history()
            self.assertEqual(len(history),before+1)
            self.assertEqual(history[-1]['status'],'cancelled')
            self.assertIsNone(state['active_toolhead'])
            self.assertTrue(all(h['target_temperature']==0 for h in state['toolheads'].values()))
