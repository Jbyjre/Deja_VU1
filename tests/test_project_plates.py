import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'backend'))
import converter_3mf
import mesh_tools
import project_plates
import sample_files


class PlateSeparation(unittest.TestCase):
    def setUp(self):
        self.original=sample_files.bambu_multiplate_project()
        self.converted=converter_3mf.convert(self.original)[0]

    def test_every_converted_plate_is_local_and_keeps_its_original(self):
        self.assertEqual(project_plates.describe_data(self.converted)['count'],3)
        benchy,gear,vase=len(sample_files.benchy_triangles()),len(sample_files.gear_triangles()),len(sample_files.vase_triangles(0.8))
        # Plate 1: a 3DBenchy and a gear; plate 2: a vase; plate 3: another Benchy.
        for index,count in [('1',benchy+gear),('2',vase),('3',benchy)]:
            selected=project_plates.extract(self.converted,index)
            summary=mesh_tools.summarize(selected,'selected.3mf')
            self.assertEqual(summary['count'],count)
            self.assertEqual(project_plates.describe_data(selected)['count'],1)
            triangles,_=mesh_tools.iter_model(selected,'selected.3mf')
            coords=[v for t in triangles for v in t]
            self.assertTrue(all(0<=v[0]<=270 and 0<=v[1]<=270 for v in coords))
            with zipfile.ZipFile(io.BytesIO(selected)) as z:
                self.assertEqual(z.read('DejaVu/Original/project.3mf'),self.converted)
                self.assertFalse(any(n.endswith('.gcode') for n in z.namelist()))

    def test_source_bed_coordinates_and_repeated_extraction(self):
        selected=project_plates.extract(self.original,'3')
        self.assertEqual(mesh_tools.summarize(selected,'plate.3mf')['count'],len(sample_files.benchy_triangles()))
        again=project_plates.extract(selected,'1')
        self.assertEqual(mesh_tools.summarize(again,'plate.3mf')['bounds'],mesh_tools.summarize(selected,'plate.3mf')['bounds'])

    def test_unknown_plate_and_malformed_project_are_refused(self):
        for data,index in [(b'broken','1'),(self.converted,'9')]:
            with self.assertRaises(ValueError):project_plates.extract(data,index)

    def test_xml_declarations_and_nonfinite_transforms_are_refused(self):
        for replacement in [b'<!DOCTYPE model><config/>',b'<config><plate><model_instance><metadata key="object_id" value="999"/><metadata key="instance_id" value="0"/></model_instance></plate></config>']:
            out=io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(self.converted)) as src,zipfile.ZipFile(out,'w') as dest:
                for n in src.namelist():dest.writestr(n,replacement if n=='Metadata/model_settings.config' else src.read(n))
            with self.assertRaises(ValueError):project_plates.extract(out.getvalue(),'1')


class EnginePresetSlots(unittest.TestCase):
    def test_two_slot_source_is_aligned_without_changing_geometry(self):
        source=converter_3mf.convert(sample_files.bambu_multiplate_project())[0]
        selected=project_plates.extract(source,'2')
        filaments=[{'name':'T'+str(i),'filament_colour':['#123456'],'filament_type':['PLA'],'filament_diameter':['1.75']} for i in range(4)]
        result,notes=project_plates.engine_input(selected,filaments)
        self.assertTrue(notes)
        with zipfile.ZipFile(io.BytesIO(selected)) as before,zipfile.ZipFile(io.BytesIO(result)) as after:
            self.assertEqual(before.read('3D/3dmodel.model'),after.read('3D/3dmodel.model'))
            self.assertEqual(before.read('Metadata/model_settings.config'),after.read('Metadata/model_settings.config'))
            config=json.loads(after.read('Metadata/project_settings.config'))
            self.assertEqual(len(config['inherits_group']),6)
            self.assertEqual(len(config['different_settings_to_system']),6)
            self.assertEqual(config['filament_settings_id'],['T0','T1','T2','T3'])
