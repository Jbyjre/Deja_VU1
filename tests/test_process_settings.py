import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import process_settings as ps
import slicer_profiles


class ProcessSettings(unittest.TestCase):
    def test_every_setting_has_a_tab_section_and_a_valid_example(self):
        self.assertGreaterEqual(len(ps.OPTIONS), 100)
        for key, o in ps.OPTIONS.items():
            self.assertIn(o['tab'], ps.TABS, key)
            self.assertTrue(o['section'] and o['label'], key)
            example = {'bool': True, 'enum': (o.get('choices') or [None])[0]}.get(o['type'], o.get('min', 1))
            self.assertIsInstance(ps.validate(key, example), str, key)

    def test_values_are_written_the_way_presets_store_them(self):
        self.assertEqual(ps.validate('enable_support', True), '1')
        self.assertEqual(ps.validate('ironing_flow', 15), '15%')
        self.assertEqual(ps.validate('sparse_infill_density', '22%'), '22%')
        self.assertEqual(ps.validate('small_perimeter_speed', '50%'), '50%')
        self.assertEqual(ps.validate('small_perimeter_speed', 40), '40')
        self.assertEqual(ps.validate('wall_loops', 3.0), '3')
        self.assertEqual(ps.validate('sparse_infill_pattern', 'gyroid'), 'gyroid')

    def test_out_of_range_unknown_and_wrong_types_are_refused(self):
        for key, value in [('outer_wall_speed', 900), ('wall_loops', 2.5), ('raft_layers', 1.5), ('spiral_mode', 'yes'),
                           ('sparse_infill_pattern', 'spaghetti'), ('post_process', 'rm -rf'), ('layer_height', float('nan')),
                           ('small_perimeter_speed', '5000%'), ('ironing_flow', 101)]:
            with self.assertRaises(ValueError, msg=key):
                ps.validate(key, value)

    def test_list_shaped_preset_values_stay_lists(self):
        config = {'outer_wall_speed': ['200'], 'wall_loops': '2'}
        slicer_profiles._apply(config, {'outer_wall_speed': '150', 'wall_loops': '3'})
        self.assertEqual(config, {'outer_wall_speed': ['150'], 'wall_loops': '3'})

    def test_schema_is_in_tab_order(self):
        tabs = [o['tab'] for o in ps.schema()['options']]
        self.assertEqual(sorted(set(tabs), key=ps.TABS.index), ps.TABS)
        self.assertEqual(tabs, sorted(tabs, key=ps.TABS.index))


if __name__ == '__main__':
    unittest.main()
