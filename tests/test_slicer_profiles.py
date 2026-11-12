import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import slicer_profiles as profiles


class SystemPresetFolders(unittest.TestCase):
    """The slicer's data folder holds a copy of the system presets, used when the program folder has none."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.program = self.root / 'Program Files/Snapmaker_Orca/snapmaker-orca.exe'
        self.program.parent.mkdir(parents=True)
        self.program.touch()
        self.data = self.root / 'AppData/Snapmaker_Orca'

    def fake_folders(self):
        return patch('orca_import.data_folders', return_value=[('Snapmaker Orca', self.data, 'Snapmaker_Orca')])

    def test_the_program_folder_wins_when_it_has_presets(self):
        (self.program.parent / 'resources/profiles/Snapmaker').mkdir(parents=True)
        (self.data / 'system/Snapmaker').mkdir(parents=True)
        with self.fake_folders():
            self.assertEqual(profiles.roots(self.program), self.program.parent / 'resources/profiles')

    def test_the_data_folder_is_used_when_the_program_folder_has_none(self):
        (self.data / 'system/Snapmaker').mkdir(parents=True)
        with self.fake_folders():
            self.assertEqual(profiles.roots(self.program), self.data / 'system')

    def test_no_presets_anywhere_is_still_none(self):
        self.data.mkdir(parents=True)
        with self.fake_folders():
            self.assertIsNone(profiles.roots(self.program))
        with patch('orca_import.data_folders', side_effect=OSError('unreadable')):
            self.assertIsNone(profiles.roots(self.program))


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


class StockU1Settings(unittest.TestCase):
    """One press: Snapmaker's own stock presets that fit the fitted heads (12 November)."""

    FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'snapmaker_u1_profiles.json'

    def rows(self):
        d = json.loads(self.FIXTURE.read_text(encoding='utf-8'))
        out = []
        for kind, key in (('machine', 'machines'), ('process', 'processes'), ('filament', 'filaments')):
            for name, v in d[key].items():
                kind_of = v.get('filament_type')
                out.append({'id': name, 'name': name, 'type': kind, 'compatible_printers': v.get('compatible_printers') or [],
                            'nozzles': v.get('nozzle_diameter'), 'layer_height': v.get('layer_height'),
                            'material': kind_of[0] if isinstance(kind_of, list) else kind_of})
        return out

    def heads(self, nozzle=0.4, materials=('PLA', 'PETG', 'TPU', 'ASA')):
        return [{'toolhead': f'T{i}', 'nozzle': nozzle, 'material': m} for i, m in enumerate(materials)]

    def test_the_stock_04_nozzle_presets_from_snapmakers_own_profiles(self):
        pick = profiles.stock_choice(self.rows(), self.heads())
        self.assertEqual(pick['names']['machine'], 'Snapmaker U1 (0.4 nozzle)')
        self.assertEqual(pick['names']['process'], '0.20mm Standard @Snapmaker U1 (0.4 nozzle)')
        self.assertEqual(pick['names']['filaments'], ['Snapmaker PLA Basic @U1', 'Generic PETG', 'Generic TPU',
                                                      'Generic ASA @U1 0.4 nozzle'])
        self.assertEqual(pick['notes'], [])

    def test_other_nozzles_and_unknown_materials(self):
        pick = profiles.stock_choice(self.rows(), self.heads(0.6, ('PLA',) * 4))
        self.assertEqual(pick['names']['machine'], 'Snapmaker U1 (0.6 nozzle)')
        self.assertTrue(all(n.endswith('@U1 0.6 nozzle') for n in pick['names']['filaments']))
        with self.assertRaises(ValueError):
            profiles.stock_choice(self.rows(), self.heads()[:3] + [{'toolhead': 'T3', 'nozzle': 0.6, 'material': 'PLA'}])
        rows = [r for r in self.rows() if not (r['type'] == 'filament' and r['material'] == 'TPU')]
        pick = profiles.stock_choice(rows, self.heads())
        self.assertIn('T2: no stock TPU preset fits', pick['notes'][0])


class StockMaterialsWithoutU1InTheirName(InstalledProfiles):
    def test_generic_materials_made_for_the_u1_are_listed(self):
        self.write('generic', {'type': 'filament', 'name': 'Generic PLA', 'instantiation': 'true', 'filament_type': ['PLA'],
                               'compatible_printers': ['Snapmaker U1 (0.4 nozzle)']})
        self.write('other', {'type': 'filament', 'name': 'Generic PLA', 'instantiation': 'true', 'filament_type': ['PLA'],
                             'compatible_printers': ['Another printer']})
        names = [r['name'] for r in profiles.catalog(str(self.program))['presets']]
        self.assertEqual(names.count('Generic PLA'), 1)


class StockProfileEndToEnd(unittest.TestCase):
    """use_stock_profile(): the heads are filled in when never set up, and the profile becomes the default."""

    def setUp(self):
        import slicer_bridge
        import tool_setup
        self.bridge, self.tools = slicer_bridge, tool_setup
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.program = root / 'bin/orca-slicer'
        self.program.parent.mkdir()
        self.program.write_text('#!/bin/sh\nexit 0\n')
        self.program.chmod(0o755)
        presets = root / 'resources/profiles/Snapmaker'
        presets.mkdir(parents=True)
        for name, d in {
            'machine': {'type': 'machine', 'name': 'Snapmaker U1 (0.4 nozzle)', 'instantiation': 'true',
                        'printer_model': 'Snapmaker U1', 'nozzle_diameter': ['0.4'] * 4},
            'process': {'type': 'process', 'name': '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', 'instantiation': 'true',
                        'layer_height': '0.2', 'compatible_printers': ['Snapmaker U1 (0.4 nozzle)']},
            'fine': {'type': 'process', 'name': '0.08mm Standard @Snapmaker U1 (0.4 nozzle)', 'instantiation': 'true',
                     'layer_height': '0.08', 'compatible_printers': ['Snapmaker U1 (0.4 nozzle)']},
            'pla': {'type': 'filament', 'name': 'Generic PLA', 'instantiation': 'true', 'filament_type': ['PLA'],
                    'compatible_printers': ['Snapmaker U1 (0.4 nozzle)']},
        }.items():
            (presets / f'{name}.json').write_text(json.dumps(d))
        slicer_bridge.save_settings({'slicer_path': str(self.program)})
        self.addCleanup(lambda: slicer_bridge.save_settings({'slicer_path': ''}))

    def test_one_press_makes_the_default_profile(self):
        with patch.object(self.tools, 'get', return_value={'heads': []}), \
                patch.object(self.tools, 'save', side_effect=lambda body: self.__dict__.setdefault('heads', body['heads'])):
            with self.assertRaises(ValueError):            # the stand-in heads are only recorded, not returned
                self.bridge.use_stock_profile()
        self.assertEqual([h['nozzle'] for h in self.heads], [0.4] * 4)
        self.assertEqual({h['material'] for h in self.heads}, {'PLA'})
        heads = [{'toolhead': f'T{i}', 'nozzle': 0.4, 'height': 0.2, 'material': 'PLA', 'color_hex': '#112233', 'spool_id': ''}
                 for i in range(4)]
        with patch.object(self.tools, 'get', return_value={'heads': heads}):
            out = self.bridge.use_stock_profile()
        self.assertEqual(out['stock']['presets']['process'], '0.20mm Standard @Snapmaker U1 (0.4 nozzle)')
        self.assertEqual(out['stock']['presets']['filaments'], ['Generic PLA'] * 4)
        self.assertFalse(out['stock']['heads_made'])
        made = next(p for p in out['profiles'] if p['name'] == out['stock']['name'])
        self.assertEqual(out['default_profile'], made['id'])
        self.assertEqual(out['stock']['name'], 'Snapmaker stock · 0.20mm Standard')
