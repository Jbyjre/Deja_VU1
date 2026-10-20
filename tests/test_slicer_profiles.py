import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'backend'))
import slicer_profiles as profiles


class InstalledProfiles(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.program=self.root/'bin/orca-slicer';self.program.parent.mkdir();self.program.touch()
        self.presets=self.root/'resources/profiles/Snapmaker';self.presets.mkdir(parents=True)
        self.write('base',{'type':'machine','name':'base','from':'system','instantiation':'false','printer_settings_id':'wrong inherited name','printer_model':'Snapmaker U1'})
        self.machine=self.write('printer',{'type':'machine','name':'Snapmaker U1 (0.4 nozzle)','inherits':'base','instantiation':'true','nozzle_diameter':['0.4']*4})
        self.process=self.write('process',{'type':'process','name':'0.20 Standard U1','instantiation':'true','layer_height':'.2','compatible_printers':['Snapmaker U1 (0.4 nozzle)']})
        self.filament=self.write('filament',{'type':'filament','name':'PLA U1','instantiation':'true','filament_type':['PLA']})
        p=patch.object(profiles,'_DATA_DIR',str(self.root/'data'));p.start();self.addCleanup(p.stop)

    def write(self,name,data):
        p=self.presets/(name+'.json');p.write_text(json.dumps(data));return p

    def ids(self):
        entries,_=profiles.scan(str(self.program));return {v['path'].stem:k for k,v in entries.items()}

    def body(self):
        ids=self.ids();return {'machine':ids['printer'],'process':ids['process'],'filaments':[ids['filament']]*4,'options':{'wall_loops':3,'sparse_infill_density':22,'enable_support':True}}

    def heads(self):
        return [{'toolhead':'T'+str(i),'nozzle':.4,'height':.2,'material':'PLA','color_hex':'#123456'} for i in range(4)]

    def test_catalog_has_names_not_filesystem_paths(self):
        result=profiles.catalog(str(self.program));self.assertTrue(result['available'])
        self.assertNotIn(str(self.root),json.dumps(result));self.assertEqual(len(result['presets']),3)

    def test_resolve_keeps_parent_values_and_original_files(self):
        before=self.machine.read_bytes();result=profiles.prepare(str(self.program),self.body(),self.heads())
        machine=json.loads(Path(result['machine']).read_text());process=json.loads(Path(result['process']).read_text())
        self.assertEqual(machine['printer_settings_id'],'Snapmaker U1 (0.4 nozzle)')
        self.assertNotIn('inherits',machine);self.assertEqual(machine['from'],'system')
        self.assertEqual(process['wall_loops'],'3');self.assertEqual(process['sparse_infill_density'],'22%')
        self.assertEqual(machine['nozzle_diameter'],['0.4']*4);self.assertEqual(before,self.machine.read_bytes())

    def test_incompatible_process_is_refused(self):
        d=json.loads(self.process.read_text());d['compatible_printers']=['Other printer'];self.process.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'compatible'):profiles.prepare(str(self.program),self.body(),self.heads())

    def test_missing_parent_is_refused(self):
        self.write('printer',{'type':'machine','name':'Snapmaker U1 (0.4 nozzle)','inherits':'missing'})
        with self.assertRaisesRegex(ValueError,'parent'):profiles.prepare(str(self.program),self.body(),self.heads())

    def test_cycle_is_refused(self):
        self.write('base',{'type':'machine','name':'base','inherits':'Snapmaker U1 (0.4 nozzle)'})
        with self.assertRaisesRegex(ValueError,'circular'):profiles.prepare(str(self.program),self.body(),self.heads())

    def test_nozzle_planner_rejects_too_thick_layers(self):
        body=self.body();body['options']['layer_height']=.4
        with self.assertRaisesRegex(ValueError,'nozzle limits'):profiles.prepare(str(self.program),body,self.heads())

    def test_injection_nan_and_fractional_walls_refused(self):
        for options in ({'post_process':'shell script'},{'wall_loops':1.5},{'layer_height':float('nan')},{'sparse_infill_density':101}):
            with self.assertRaises(ValueError):profiles.validate_options(options)

    def test_missing_install_is_plain_empty_state(self):
        self.assertFalse(profiles.catalog('/not-installed/orca')['available'])

    def test_material_mismatch_refused(self):
        heads=self.heads();heads[0]['material']='ABS'
        with self.assertRaisesRegex(ValueError,'material'):profiles.prepare(str(self.program),self.body(),heads)
