import io
import os
import re
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
        p = patch('file_library.read_bytes', side_effect=lambda n: self.sources[n])
        p.start()
        self.addCleanup(p.stop)

    def rows(self):
        return [{'name':'bracket.stl','tool':i,'transform':[1,0,0,0,1,0,0,0,1,i*60,20,0]} for i in range(2)]

    def test_multi_object_geometry_and_tool_settings(self):
        data = plate.build({'objects': self.rows()})
        mesh = mesh_tools.summarize(data, 'plate.3mf')
        self.assertEqual(mesh['count'],40)
        z = zipfile.ZipFile(io.BytesIO(data))
        settings = z.read('Metadata/model_settings.config')
        self.assertIn(b'key="extruder" value="2"',settings)
        self.assertEqual(z.read('DejaVu/Sources/0/bracket.stl'),self.sources['bracket.stl'])

    def test_touching_triangles_share_their_corners(self):
        # Every triangle with three private corners reads to the engine as a surface in loose pieces ("empty layer
        # between 0 and 2.05" on a gear, a vase and the 3DBenchy, found by the first real engine run on 22 November).
        self.sources['gear.stl'] = sample_files.gear_stl()
        data = plate.build({'objects': [{'name': 'gear.stl', 'tool': 0}]})
        z = zipfile.ZipFile(io.BytesIO(data))
        source = next(n for n in z.namelist() if n.startswith('3D/sources/') and n.endswith('3dmodel.model'))
        xml = z.read(source).decode()
        vertices = xml.count('<vertex ')
        triangles = xml.count('<triangle ')
        self.assertEqual(triangles, 3840)
        self.assertLess(vertices, triangles)               # a closed surface has about half as many corners as triangles
        for index in re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', xml)[:50]:
            self.assertTrue(all(int(i) < vertices for i in index))
        self.assertNotIn('"-0"', xml)

    def test_source_3mf_colours_and_metadata_kept(self):
        data=plate.build({'objects':[{'name':'original.3mf','tool':1}]})
        z = zipfile.ZipFile(io.BytesIO(data))
        original = zipfile.ZipFile(io.BytesIO(self.sources['original.3mf']))
        self.assertEqual(z.read('3D/sources/0/Metadata/project_settings.config'),original.read('Metadata/project_settings.config'))
        self.assertEqual(z.read('DejaVu/Sources/0/original.3mf'),self.sources['original.3mf'])
        self.assertGreater(mesh_tools.summarize(data,'plate.3mf')['count'],0)

    def test_unsafe_transforms_and_virtual_tools_refused(self):
        for extra in [{'transform':[float('nan')]*12},{'transform':[1,2]},{'tool':4},{'settings':{'post_process':'run anything'}}]:
            with self.assertRaises(ValueError):
                plate.build({'objects': [dict(name='bracket.stl', **extra)]})

    def test_no_object_and_too_many_objects_refused(self):
        for rows in [[],self.rows()*17]:
            with self.assertRaises(ValueError):
                plate.build({'objects': rows})

    def test_source_paths_relocated_without_losing_extension_prefixes(self):
        original=b'<model xmlns="'+plate.CORE.encode()+b'" xmlns:p="'+plate.PROD.encode()+b'" requiredextensions="p"><component p:path="/3D/a.model" objectid="2"/></model>'
        rewritten=plate._relocate_xml(original,'3D/sources/0/')
        self.assertIn(b'requiredextensions="p"', rewritten)
        self.assertIn(b'p:path="/3D/sources/0/3D/a.model"', rewritten)

    def test_unsafe_archive_names_refused(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr('../bad.model', 'x')
        self.sources['bad.3mf']=out.getvalue()
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            plate.build({'objects': [{'name': 'bad.3mf'}]})

    def test_document_entities_refused(self):
        xml='<!DOCTYPE m [<!ENTITY x "bad">]><m/>'
        for encoding in ('utf-8','utf-16','utf-16-le','utf-16-be'):
            with self.subTest(encoding),self.assertRaisesRegex(ValueError,'declarations'):
                plate._xml(xml.encode(encoding))

    def test_obj_vertex_colours_survive_preparation(self):
        self.sources['colours.obj']=b'v 0 0 0 1 0 0\nv 10 0 0 0 1 0\nv 0 10 0 0 0 1\nf 1 2 3\n'
        data=plate.build({'objects':[{'name':'colours.obj'}]})
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            model=z.read('3D/sources/0/3D/3dmodel.model')
            for colour in (b'#ff0000', b'#00ff00', b'#0000ff'):
                self.assertIn(colour, model)
            self.assertIn(b'pid="2" p1="1" p2="2" p3="3"',model)

    def test_non_millimetre_size_is_displayed_in_real_millimetres(self):
        xml=f'<model xmlns="{plate.CORE}" unit="inch"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
        data=io.BytesIO()
        with zipfile.ZipFile(data, 'w') as z:
            z.writestr('3D/3dmodel.model', xml)
        summary=mesh_tools.summarize(data.getvalue(),'inches.3mf')
        self.assertEqual(summary['bounds']['size'],[25.4,25.4,0])
        self.sources['inches.3mf']=data.getvalue()
        with self.assertRaisesRegex(ValueError, 'millimetres'):
            plate.build({'objects': [{'name': 'inches.3mf'}]})


# --- what a source 3MF holds, and what the slicing engine is given -------------------------------------------------------
# Each of these was a real refusal on the real engine (Snapmaker Orca v2.4.1, 22 November 2026): "no object is fully inside the plate"
# for a model that sits well inside it.
import project_plates  # noqa: E402

PROD = mesh_tools.PROD_NS
CUBE = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0), (0, 0, 10), (10, 0, 10), (10, 10, 10), (0, 10, 10)]
FACES = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
MACHINE = {'printable_area': ['0.5x1', '270.5x1', '270.5x271', '0.5x271'], 'printable_height': '270.05'}
IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]


def _mesh(points, faces=FACES):
    return ('<mesh><vertices>' + ''.join('<vertex x="%g" y="%g" z="%g"/>' % p for p in points) + '</vertices><triangles>'
            + ''.join('<triangle v1="%d" v2="%d" v3="%d"/>' % f for f in faces) + '</triangles></mesh>')


def _model(resources, build=''):
    return (f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="{plate.CORE}" xmlns:p="{PROD}">'
            f'<resources>{resources}</resources><build>{build}</build></model>')


def _project(parts):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for name, text in parts.items():
            z.writestr(name, text)
    return out.getvalue()


def flat_project(extra=()):
    """One mesh object, moved to (100, 100) by its build item."""
    return _project({'3D/3dmodel.model': _model('<object id="1" type="model">' + _mesh(CUBE + list(extra)) + '</object>',
                                                '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/>')})


def nested_project():
    """Bambu Studio's and Orca's layout: the build item names an object that only lists components, and the mesh is in another part."""
    return _project({
        '3D/3dmodel.model': _model('<object id="2" type="model"><components><component p:path="/3D/Objects/part.model" objectid="1" '
                                   'transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>',
                                   '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 100 0"/>'),
        '3D/Objects/part.model': _model('<object id="1" type="model">' + _mesh(CUBE) + '</object>')})


def bounds(data):
    triangles, _ = mesh_tools.iter_model(data, 'x.3mf')
    points = [p for t in triangles for p in t]
    return [min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]


class SourceModelShapes(unittest.TestCase):
    def setUp(self):
        self.sources = {}
        p = patch('file_library.read_bytes', side_effect=lambda n: self.sources[n])
        p.start()
        self.addCleanup(p.stop)

    def plate(self, name, move=(0, 0, 0)):
        return plate.build({'objects': [{'name': name, 'tool': 0, 'transform': IDENTITY + list(move)}]})

    def main_model(self, data):
        return zipfile.ZipFile(io.BytesIO(data)).read('3D/3dmodel.model').decode()

    def test_a_container_object_is_replaced_by_the_mesh_parts_it_lists(self):
        # The engine loads an object whose components are themselves containers as empty and then finds nothing inside the plate.
        self.sources['nested.3mf'] = nested_project()
        data = self.plate('nested.3mf', (10, 0, 0))
        main = self.main_model(data)
        self.assertIn('p:path="/3D/sources/0/3D/Objects/part.model"', main)
        self.assertIn('transform="1 0 0 0 1 0 0 0 1 105 100 0"', main)          # the part's 5, the item's 100, in one transform
        self.assertNotIn('/3D/sources/0/3D/3dmodel.model"', main)                 # no container left between the plate and the mesh
        self.assertEqual(bounds(data), ([115, 100, 0], [125, 110, 10]))          # where the app's own reader puts it as well

    def test_containers_inside_containers_are_followed_to_the_mesh(self):
        main = _model('<object id="3" type="model"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 7 0"/>'
                      '</components></object><object id="2" type="model"><components><component p:path="/3D/Objects/part.model" '
                      'objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>',
                      '<item objectid="3" transform="1 0 0 0 1 0 0 0 1 100 100 0"/>')
        self.sources['deep.3mf'] = _project({'3D/3dmodel.model': main, '3D/Objects/part.model': _model('<object id="1">' + _mesh(CUBE) + '</object>')})
        data = self.plate('deep.3mf')
        self.assertIn('transform="1 0 0 0 1 0 0 0 1 105 107 0"', self.main_model(data))
        self.assertEqual(bounds(data), ([105, 107, 0], [115, 117, 10]))

    def test_a_plain_mesh_object_is_referenced_as_it_always_was(self):
        self.sources['flat.3mf'] = flat_project()
        main = self.main_model(self.plate('flat.3mf'))
        self.assertIn('objectid="1" p:path="/3D/sources/0/3D/3dmodel.model" transform="1 0 0 0 1 0 0 0 1 100 100 0"', main)

    def test_an_object_with_a_mesh_and_components_is_left_unflattened(self):
        resources = ('<object id="1" type="model">' + _mesh(CUBE) + '<components><component objectid="2"/></components></object>'
                     '<object id="2" type="model">' + _mesh(CUBE) + '</object>')
        self.sources['mixed.3mf'] = _project({'3D/3dmodel.model': _model(resources, '<item objectid="1"/>')})
        self.assertIn('objectid="1" p:path="/3D/sources/0/3D/3dmodel.model"', self.main_model(self.plate('mixed.3mf')))

    def test_a_missing_part_does_not_stop_the_plate_from_being_built(self):
        self.sources['gone.3mf'] = _project({'3D/3dmodel.model': _model(
            '<object id="2"><components><component p:path="/3D/Objects/missing.model" objectid="1"/></components></object>',
            '<item objectid="2"/>')})
        self.assertIn('objectid="2" p:path="/3D/sources/0/3D/3dmodel.model"', self.main_model(self.plate('gone.3mf')))


class UnusedPoints(unittest.TestCase):
    NS = b'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'

    def model(self, points, faces, ns=b''):
        v = b''.join(b'<%svertex x="%d" y="%d" z="%d"/>' % (ns, *p) for p in points)
        t = b''.join(b'<%striangle v1="%d" v2="%d" v3="%d" p1="7"/>' % (ns, *f) for f in faces)
        return (b'<model %s><resources><object id="1"><mesh><%svertices>%s</%svertices><%striangles>%s</%striangles></mesh></object>'
                b'</resources></model>' % (self.NS, ns, v, ns, ns, t, ns))

    def test_points_no_triangle_uses_go_and_the_triangles_are_renumbered(self):
        out, removed = plate.compact_vertices(self.model([(0, 0, 0), (-300, -300, -300), (1, 0, 0), (0, 1, 0), (9, 9, 9)], [(0, 2, 3)]))
        self.assertEqual(removed, 2)
        self.assertEqual(out.count(b'<vertex '), 3)
        self.assertIn(b'v1="0" v2="1" v3="2" p1="7"', out)            # other attributes stay

    def test_triangle_order_and_orientation_survive(self):
        out, removed = plate.compact_vertices(self.model([(5, 5, 5), (0, 0, 0), (1, 0, 0), (0, 1, 0)], [(1, 2, 3), (3, 2, 1)]))
        self.assertEqual(removed, 1)
        self.assertLess(out.index(b'v1="0" v2="1" v3="2"'), out.index(b'v1="2" v2="1" v3="0"'))

    def test_a_mesh_with_nothing_unused_is_returned_untouched(self):
        data = self.model([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [(0, 1, 2)])
        self.assertEqual(plate.compact_vertices(data), (data, 0))

    def test_only_the_mesh_that_has_a_stray_point_changes(self):
        clean = b'<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>'
        stray = b'<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="3" y="3" z="3"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="2" v3="3"/></triangles></mesh>'
        data = b'<model %s><resources><object id="1">%s</object><object id="2">%s</object></resources></model>' % (self.NS, clean, stray)
        out, removed = plate.compact_vertices(data)
        self.assertEqual(removed, 1)
        self.assertTrue(out.startswith(data[:data.index(b'<object id="2">')]))

    def test_prefixed_element_names_are_understood(self):
        out, removed = plate.compact_vertices(self.model([(0, 0, 0), (8, 8, 8), (1, 0, 0), (0, 1, 0)], [(0, 2, 3)], ns=b'm:'))
        self.assertEqual((removed, out.count(b'<m:vertex ')), (1, 3))

    def test_shapes_it_does_not_fully_understand_are_left_alone(self):
        for data in (
            b'<model><mesh><vertices><vertex x="0" y="0" z="0"><x/></vertex><vertex x="1" y="1" z="1"/></vertices>'
            b'<triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></model>',                    # a vertex with children
            self.model([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [(0, 1, 9)]),                                  # a corner past the end
            b'<model><mesh><vertices/><triangles/></mesh></model>',
        ):
            self.assertEqual(plate.compact_vertices(data), (data, 0))


class WhatTheEngineIsGiven(unittest.TestCase):
    def setUp(self):
        self.sources = {}
        p = patch('file_library.read_bytes', side_effect=lambda n: self.sources[n])
        p.start()
        self.addCleanup(p.stop)

    def plate(self, name, move=(0, 0, 0)):
        return plate.build({'objects': [{'name': name, 'tool': 0, 'transform': IDENTITY + list(move)}]})

    def test_a_stray_point_in_a_source_never_reaches_the_engine(self):
        self.sources['stray.3mf'] = flat_project(extra=[(-300, -300, -300)])
        built = self.plate('stray.3mf')
        sent, notes = project_plates.engine_input(built, [])
        self.assertEqual(len(notes), 1)
        self.assertIn('1 stored point that no triangle uses was left out', notes[0])
        self.assertEqual(bounds(sent), bounds(built))                                        # the same surface
        vertices = lambda data: zipfile.ZipFile(io.BytesIO(data)).read('3D/sources/0/3D/3dmodel.model').decode().count('<vertex ')  # noqa: E731
        self.assertEqual((vertices(built), vertices(sent)), (9, 8))                          # the saved plate keeps the library's copy

    def test_nothing_is_rewritten_when_every_point_is_used(self):
        self.sources['clean.3mf'] = flat_project()
        built = self.plate('clean.3mf')
        self.assertEqual(project_plates.engine_input(built, []), (built, []))

    def test_the_volume_check_says_which_side_an_object_reaches_past(self):
        self.sources['model.3mf'] = flat_project()
        self.assertEqual(project_plates.volume_check(self.plate('model.3mf'), MACHINE), [])
        left = project_plates.volume_check(self.plate('model.3mf', (-150, 0, 0)), MACHINE)
        self.assertEqual(left, ['model.3mf reaches 50.5 mm past the left edge of the plate.'])
        right = project_plates.volume_check(self.plate('model.3mf', (200, 0, 0)), MACHINE)
        self.assertEqual(right, ['model.3mf reaches 39.5 mm past the right edge of the plate.'])

    def test_the_volume_check_knows_height_and_a_plate_that_is_too_small(self):
        self.sources['model.3mf'] = flat_project()
        tall = project_plates.volume_check(self.plate('model.3mf', (0, 0, 270)), MACHINE)
        self.assertEqual(tall, ['model.3mf is 280.0 mm tall and this printer prints up to 270.05 mm.'])
        below = project_plates.volume_check(self.plate('model.3mf', (0, 0, -50)), MACHINE)
        self.assertEqual(below, ['model.3mf lies completely below the plate.'])
        self.sources['big.3mf'] = flat_project(extra=[(300, 0, 0)])
        wide = project_plates.volume_check(self.plate('big.3mf'), MACHINE)
        self.assertTrue(wide and 'counting every point its file stores' in wide[0], wide)

    def test_a_stray_point_below_the_bed_still_counts_when_it_is_outside_the_plate(self):
        # Measured on the real engine: far outside the plate's width or depth fails with -50 at any height, even under the bed.
        self.sources['below.3mf'] = flat_project(extra=[(-250, 0, -50)])
        found = project_plates.volume_check(self.plate('below.3mf'), MACHINE)
        self.assertTrue(found and 'past the left edge' in found[0], found)

    def test_the_volume_check_never_raises(self):
        self.assertEqual(project_plates.volume_check(b'not a 3mf', MACHINE), [])
        self.sources['model.3mf'] = flat_project()
        self.assertEqual(project_plates.volume_check(self.plate('model.3mf'), None), [])
        self.assertEqual(project_plates.volume_check(self.plate('model.3mf'), {'printable_area': 'nonsense'}), [])
