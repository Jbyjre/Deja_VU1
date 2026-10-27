import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import slicer_profiles as profiles


class InstalledProfiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.program = self.root / 'bin/orca-slicer'
        self.program.parent.mkdir()
        self.program.touch()
        self.presets = self.root / 'resources/profiles/Snapmaker'
        self.presets.mkdir(parents=True)
        self.write(
            'base',
            {
                'type': 'machine',
                'name': 'base',
                'from': 'system',
                'instantiation': 'false',
                'printer_settings_id': 'wrong inherited name',
                'printer_model': 'Snapmaker U1',
            },
        )
        self.machine = self.write(
            'printer',
            {
                'type': 'machine',
                'name': 'Snapmaker U1 (0.4 nozzle)',
                'inherits': 'base',
                'instantiation': 'true',
                'nozzle_diameter': ['0.4'] * 4,
            },
        )
        self.process = self.write(
            'process',
            {
                'type': 'process',
                'name': '0.20 Standard U1',
                'instantiation': 'true',
                'layer_height': '.2',
                'compatible_printers': ['Snapmaker U1 (0.4 nozzle)'],
            },
        )
        self.filament = self.write(
            'filament', {'type': 'filament', 'name': 'PLA U1', 'instantiation': 'true', 'filament_type': ['PLA']}
        )
        p = patch.object(profiles, '_DATA_DIR', str(self.root / 'data'))
        p.start()
        self.addCleanup(p.stop)

    def write(self, name, data):
        p = self.presets / (name + '.json')
        p.write_text(json.dumps(data))
        return p

    def ids(self):
        entries, _ = profiles.scan(str(self.program))
        return {v['path'].stem: k for k, v in entries.items()}

    def body(self):
        ids = self.ids()
        return {
            'machine': ids['printer'],
            'process': ids['process'],
            'filaments': [ids['filament']] * 4,
            'options': {'wall_loops': 3, 'sparse_infill_density': 22, 'enable_support': True},
        }

    def heads(self):
        return [
            {'toolhead': 'T' + str(i), 'nozzle': 0.4, 'height': 0.2, 'material': 'PLA', 'color_hex': '#123456'}
            for i in range(4)
        ]

    def test_catalog_has_names_not_filesystem_paths(self):
        result = profiles.catalog(str(self.program))
        self.assertTrue(result['available'])
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertEqual(len(result['presets']), 3)

    def test_resolve_keeps_parent_values_and_original_files(self):
        before = self.machine.read_bytes()
        result = profiles.prepare(str(self.program), self.body(), self.heads())
        machine = json.loads(Path(result['machine']).read_text())
        process = json.loads(Path(result['process']).read_text())
        self.assertEqual(machine['printer_settings_id'], 'Snapmaker U1 (0.4 nozzle)')
        self.assertNotIn('inherits', machine)
        self.assertEqual(machine['from'], 'system')
        self.assertEqual(process['wall_loops'], '3')
        self.assertEqual(process['sparse_infill_density'], '22%')
        self.assertEqual(machine['nozzle_diameter'], ['0.4'] * 4)
        self.assertEqual(before, self.machine.read_bytes())

    def test_incompatible_process_is_refused(self):
        d = json.loads(self.process.read_text())
        d['compatible_printers'] = ['Other printer']
        self.process.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError, 'compatible'):
            profiles.prepare(str(self.program), self.body(), self.heads())

    def test_missing_parent_is_refused(self):
        self.write('printer', {'type': 'machine', 'name': 'Snapmaker U1 (0.4 nozzle)', 'inherits': 'missing'})
        with self.assertRaisesRegex(ValueError, 'parent'):
            profiles.prepare(str(self.program), self.body(), self.heads())

    def test_cycle_is_refused(self):
        self.write('base', {'type': 'machine', 'name': 'base', 'inherits': 'Snapmaker U1 (0.4 nozzle)'})
        with self.assertRaisesRegex(ValueError, 'circular'):
            profiles.prepare(str(self.program), self.body(), self.heads())

    def test_nozzle_planner_rejects_too_thick_layers(self):
        body = self.body()
        body['options']['layer_height'] = 0.4
        with self.assertRaisesRegex(ValueError, 'nozzle limits'):
            profiles.prepare(str(self.program), body, self.heads())

    def test_injection_nan_and_fractional_walls_refused(self):
        for options in (
            {'post_process': 'shell script'},
            {'wall_loops': 1.5},
            {'layer_height': float('nan')},
            {'sparse_infill_density': 101},
        ):
            with self.assertRaises(ValueError):
                profiles.validate_options(options)

    def test_missing_install_is_plain_empty_state(self):
        self.assertFalse(profiles.catalog('/not-installed/orca')['available'])

    def test_material_mismatch_refused(self):
        heads = self.heads()
        heads[0]['material'] = 'ABS'
        with self.assertRaisesRegex(ValueError, 'material'):
            profiles.prepare(str(self.program), self.body(), heads)

    def test_machine_nozzles_must_match_saved_physical_tools(self):
        heads = self.heads()
        heads[0]['nozzle'] = 0.6
        with self.assertRaisesRegex(ValueError, 'nozzle sizes do not match'):
            profiles.prepare(str(self.program), self.body(), heads)

    def test_mixed_nozzles_limit_bridge_width_to_smallest_head(self):
        d = json.loads(self.machine.read_text())
        d['nozzle_diameter'] = ['.4', '.4', '.6', '.6']
        self.machine.write_text(json.dumps(d))
        heads = self.heads()
        heads[2]['nozzle'] = heads[3]['nozzle'] = 0.6
        result = profiles.prepare(str(self.program), self.body(), heads)
        process = json.loads(Path(result['process']).read_text())
        self.assertEqual(process['bridge_line_width'], '0.4')
        self.assertTrue(result['warnings'])

    def test_material_variant_requires_explicit_review_and_stays_u1_only(self):
        d = json.loads(self.filament.read_text())
        d['compatible_printers'] = ['Snapmaker U1 (0.6 nozzle)']
        self.filament.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError, 'compatible'):
            profiles.prepare(str(self.program), self.body(), self.heads())
        body = self.body()
        body['allow_material_variant'] = True
        self.assertTrue(profiles.prepare(str(self.program), body, self.heads())['warnings'])
        d['compatible_printers'] = ['Another printer']
        self.filament.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError, 'compatible'):
            profiles.prepare(str(self.program), body, self.heads())

    def test_per_tool_heights_are_not_silently_accepted_by_stock_engine(self):
        body = self.body()
        body['layer_mode'] = 'per_tool'
        with self.assertRaisesRegex(ValueError, 'capable local engine'):
            profiles.prepare(str(self.program), body, self.heads())

    def test_per_tool_heights_reach_machine_settings_and_grid(self):
        body = self.body()
        body['layer_mode'] = 'per_tool'
        body['options']['initial_layer_print_height'] = 0.14
        heads = self.heads()
        for h in heads:
            h['height'] = 0.14
        heads[1]['height'] = 0.28
        result = profiles.prepare(
            str(self.program), body, heads, {'per_tool_heights': True, 'exact_tool_heights': True}
        )
        machine = json.loads(Path(result['machine']).read_text())
        process = json.loads(Path(result['process']).read_text())
        self.assertEqual(machine['extruder_layer_height'], ['0.14', '0.28', '0.14', '0.14'])
        self.assertEqual(machine['extruder_layer_height_exact'], '1')
        self.assertEqual(process['layer_height'], '0.14')

    def test_thick_layer_mode_reaches_engines_that_list_it(self):
        body = self.body()
        body['layer_mode'] = 'per_tool'
        body['options']['initial_layer_print_height'] = 0.14
        body['thick_mode'] = 'consistent'
        body['thick_tolerance'] = 50
        heads = self.heads()
        for h in heads:
            h['height'] = 0.14
        heads[1]['height'] = 0.28
        result = profiles.prepare(str(self.program), body, heads, {'per_tool_heights': True, 'thick_layer_modes': True})
        process = json.loads(Path(result['process']).read_text())
        self.assertEqual(process['extruder_layer_height_mode'], 'consistent')
        self.assertEqual(process['extruder_layer_height_tolerance'], '50%')
        result = profiles.prepare(str(self.program), body, heads, {'per_tool_heights': True})
        process = json.loads(Path(result['process']).read_text())
        self.assertNotIn('extruder_layer_height_mode', process)
        self.assertTrue(any('thick-layer region options' in w for w in result['warnings']))

    def test_material_override_limits_and_originals(self):
        body = self.body()
        body['material_options'] = [{'nozzle_temperature': 220, 'filament_flow_ratio': 0.98}, {}, {}, {}]
        result = profiles.prepare(str(self.program), body, self.heads())
        material = json.loads(Path(result['filaments'][0]).read_text())
        self.assertEqual(material['nozzle_temperature'], ['220'])
        self.assertEqual(material['filament_flow_ratio'], ['0.98'])
        self.assertNotIn('nozzle_temperature', json.loads(self.filament.read_text()))
        for opts in [
            {'nozzle_temperature': 999},
            {'filament_flow_ratio': float('nan')},
            {'post_process': 'run'},
            {'fan_min_speed': 80, 'fan_max_speed': 20},
        ]:
            with self.assertRaises(ValueError):
                profiles.material_options(opts)

    def test_generic_out_of_volume_startup_is_refused_before_engine(self):
        data = json.loads(self.machine.read_text())
        data['machine_start_gcode'] = 'G90\nG0 X300 Y0\nG0 X290 E30 Z0.2'
        self.machine.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'X290'):
            profiles.prepare(str(self.program), self.body(), self.heads())

    def test_older_standard_flow_migrates_to_explicit_variant(self):
        data = json.loads(self.filament.read_text())
        data['filament_flow_support'] = ['standard']
        self.filament.write_text(json.dumps(data))
        result = profiles.prepare(str(self.program), self.body(), self.heads(), {'per_tool_heights': True})
        material = json.loads(Path(result['filaments'][0]).read_text())
        self.assertEqual(material['filament_extruder_variant'], ['Direct Drive Standard'])
        self.assertNotIn('filament_flow_support', material)
        self.assertEqual(json.loads(Path(result['process']).read_text())['nozzle_diameter'], ['0.4'] * 4)
