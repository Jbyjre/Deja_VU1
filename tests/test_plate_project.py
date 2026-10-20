import io
import json
import os
import sys
import unittest
import zipfile
from unittest.mock import patch
sys.path.insert(0,os.path.join(os.path.dirname(os.path.dirname(__file__)),'backend'))
import mesh_tools
import plate_project as plate
import sample_files


class PlateProjects(unittest.TestCase):
    def setUp(self):
        self.sources={'bracket.stl':sample_files.dock_bracket_stl(),'original.3mf':sample_files.bambu_style_project()}
        p=patch('file_library.read_bytes',side_effect=lambda n:self.sources[n]);p.start();self.addCleanup(p.stop)

    def rows(self):
        return [{'name':'bracket.stl','tool':i,'transform':[1,0,0,0,1,0,0,0,1,i*60,20,0]} for i in range(2)]

    def test_multi_object_geometry_and_tool_settings(self):
        data=plate.build({'objects':self.rows()});mesh=mesh_tools.summarize(data,'plate.3mf')
        self.assertEqual(mesh['count'],40)
        z=zipfile.ZipFile(io.BytesIO(data));settings=z.read('Metadata/model_settings.config')
        self.assertIn(b'key="extruder" value="2"',settings)
        self.assertEqual(z.read('DejaVu/Sources/0/bracket.stl'),self.sources['bracket.stl'])

    def test_source_3mf_colours_and_metadata_kept(self):
        data=plate.build({'objects':[{'name':'original.3mf','tool':1}]})
        z=zipfile.ZipFile(io.BytesIO(data));original=zipfile.ZipFile(io.BytesIO(self.sources['original.3mf']))
        self.assertEqual(z.read('3D/sources/0/Metadata/project_settings.config'),original.read('Metadata/project_settings.config'))
        self.assertEqual(z.read('DejaVu/Sources/0/original.3mf'),self.sources['original.3mf'])
        self.assertGreater(mesh_tools.summarize(data,'plate.3mf')['count'],0)

    def test_unsafe_transforms_and_virtual_tools_refused(self):
        for extra in [{'transform':[float('nan')]*12},{'transform':[1,2]},{'tool':4},{'settings':{'post_process':'run anything'}}]:
            with self.assertRaises(ValueError):plate.build({'objects':[dict(name='bracket.stl',**extra)]})

    def test_no_object_and_too_many_objects_refused(self):
        for rows in [[],self.rows()*17]:
            with self.assertRaises(ValueError):plate.build({'objects':rows})

    def test_source_paths_relocated_without_losing_extension_prefixes(self):
        original=b'<model xmlns="'+plate.CORE.encode()+b'" xmlns:p="'+plate.PROD.encode()+b'" requiredextensions="p"><component p:path="/3D/a.model" objectid="2"/></model>'
        rewritten=plate._relocate_xml(original,'3D/sources/0/')
        self.assertIn(b'requiredextensions="p"',rewritten);self.assertIn(b'p:path="/3D/sources/0/3D/a.model"',rewritten)

    def test_unsafe_archive_names_refused(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('../bad.model','x')
        self.sources['bad.3mf']=out.getvalue()
        with self.assertRaisesRegex(ValueError,'unsafe'):plate.build({'objects':[{'name':'bad.3mf'}]})

    def test_document_entities_refused(self):
        with self.assertRaisesRegex(ValueError,'declarations'):plate._xml(b'<!DOCTYPE m [<!ENTITY x "bad">]><m/>')

    def test_obj_vertex_colours_survive_preparation(self):
        self.sources['colours.obj']=b'v 0 0 0 1 0 0\nv 10 0 0 0 1 0\nv 0 10 0 0 0 1\nf 1 2 3\n'
        data=plate.build({'objects':[{'name':'colours.obj'}]})
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            model=z.read('3D/sources/0/3D/3dmodel.model')
            for colour in (b'#ff0000',b'#00ff00',b'#0000ff'):self.assertIn(colour,model)
            self.assertIn(b'pid="2" p1="1" p2="2" p3="3"',model)
