import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'backend'))
import model_maker as maker
import mesh_tools
import plate_project


class ModelMaker(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.heads=[{'toolhead':'T'+str(i),'material':'PLA','color_hex':c,'nozzle':.4,'height':.2,'spool_id':str(i)} for i,c in enumerate(['#000000','#ffffff','#ff0000','#0000ff'])]
        self.saved={}
        for p in [patch('tool_setup.get',side_effect=lambda:{'heads':self.heads}),patch.object(maker,'_PATH',os.path.join(self.tmp.name,'cal.json')),patch('file_library.save',side_effect=self.save)]:
            p.start();self.addCleanup(p.stop)

    def save(self,name,data,**kwargs):self.saved[name]=data;return {'name':name}

    def body(self,mode='mosaic'):
        return {'mode':mode,'pixels_w':2,'pixels_h':2,'pixels':[0,0,0,255,255,255,255,0,0,0,0,255],'width':40,'layer_height':.2}

    def test_mosaic_contains_all_four_physical_assignments(self):
        result=maker.build(self.body());data=self.saved[result['file']['name']]
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            settings=z.read('Metadata/model_settings.config')
            for i in range(1,5):self.assertIn(f'key="extruder" value="{i}"'.encode(),settings)
            root=ET.fromstring(z.read('3D/3dmodel.model'));ns={'c':plate_project.CORE}
            self.assertEqual(len(root.findall('c:build/c:item',ns)),1)
            self.assertEqual(len(root.findall('.//c:components/c:component',ns)),4)
        self.assertEqual(result['preview']['indices'],[0,1,2,3])
        self.assertGreater(mesh_tools.summarize(data,'image.3mf')['count'],0)

    def test_dithering_is_deterministic_and_uses_only_palette_entries(self):
        pixels=[128,128,128]*64
        a=maker.quantize(pixels,8,8,['#000000','#ffffff'],True)
        self.assertEqual(a,maker.quantize(pixels,8,8,['#000000','#ffffff'],True))
        self.assertEqual(set(a),{0,1})

    def test_layered_mode_requires_actual_user_calibration(self):
        with self.assertRaisesRegex(ValueError,'swatches'):maker.build(self.body('layered'))

    def test_calibration_requires_measurement_confirmation(self):
        with self.assertRaisesRegex(ValueError,'Confirm'):maker.save_calibration({'colours':['#123456']*16})

    def test_layered_mode_accepts_saved_measurements(self):
        maker.save_calibration({'colours':['#123456']*16,'measured':True})
        result=maker.build(self.body('layered'))
        self.assertEqual(result['preview']['source'],'measured swatches')

    def test_spool_and_layer_changes_invalidate_calibration(self):
        maker.save_calibration({'colours':['#123456']*16,'measured':True})
        self.assertIsNotNone(maker.settings()['calibration'])
        self.assertIsNone(maker.settings(.16)['calibration'])
        self.heads[0]['spool_id']='new spool'
        self.assertIsNone(maker.settings()['calibration'])

    def test_calibration_sheet_has_sixteen_recipe_tiles(self):
        self.assertEqual(len(maker.recipes()),16)
        self.assertEqual(len(maker.settings()['recipes']),16)
        result=maker.build({'mode':'calibration'})
        self.assertIsNone(result['preview'])
        self.assertGreater(len(self.saved[result['file']['name']]),0)

    def test_image_slice_requires_matching_first_and_later_layers(self):
        result=maker.build(self.body());data=self.saved[result['file']['name']]
        maker.check_slice_contract(data,{'layer_height':'.2','initial_layer_print_height':'.2'})
        with self.assertRaisesRegex(ValueError,'first-layer height'):
            maker.check_slice_contract(data,{'layer_height':'.2','initial_layer_print_height':'.25'})
        self.heads[1]['nozzle']=.6
        with self.assertRaisesRegex(ValueError,'tools changed'):
            maker.check_slice_contract(data,{'layer_height':'.2','initial_layer_print_height':'.2'})

    def test_calibration_is_scoped_to_printer(self):
        with patch('mock_moonraker.selected_printer_id',return_value='one'):
            maker.save_calibration({'colours':['#123456']*16,'measured':True})
        with patch('mock_moonraker.selected_printer_id',return_value='two'):
            self.assertIsNone(maker.settings()['calibration'])

    def test_plate_roundtrip_keeps_colour_paint_and_layer_contract(self):
        result=maker.build(self.body());name=result['file']['name']
        with patch('file_library.read_bytes',side_effect=lambda n:self.saved[n]):
            data=plate_project.build({'objects':[{'name':name,'tool':0}]})
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                self.assertIn('DejaVu/generation.json',z.namelist())
                part=z.read('3D/sources/0/3D/3dmodel.model')
                for paint in ('4','8','0C','1C'):self.assertIn(f'paint_color="{paint}"'.encode(),part)
            transform=list(plate_project.IDENTITY);transform[8]=-1
            with self.assertRaisesRegex(ValueError,'upright'):
                plate_project.build({'objects':[{'name':name,'tool':0,'transform':transform}]})

    def test_terrain_mesh_is_closed_with_every_edge_used_twice(self):
        part=maker.terrain(self.body()['pixels'],2,2,40,40,10,.8)
        counts=Counter(tuple(sorted(edge)) for a,b,c in part['triangles'] for edge in [(a,b),(b,c),(c,a)])
        self.assertEqual(set(counts.values()),{2})
        self.assertTrue(all(z>=0 for x,y,z in part['vertices']))
        maker.build(self.body('terrain'))

    def test_invalid_pixels_and_oversize_grid_refused(self):
        for changes in [{'pixels_w':97},{'pixels':[0]},{'width':float('nan')},{'pixels':[-1]*12}]:
            with self.assertRaises(ValueError):maker.build(dict(self.body(),**changes))

    def test_pixel_features_must_be_wide_enough_for_nozzles(self):
        b=self.body();b.update(pixels_w=96,pixels_h=2,pixels=[128]*(96*2*3),width=5)
        with self.assertRaisesRegex(ValueError,'nozzle widths'):maker.build(b)

    def test_missing_saved_tools_does_not_invent_filaments(self):
        self.heads.clear()
        with self.assertRaisesRegex(ValueError,'Save all four'):maker.build(self.body())
