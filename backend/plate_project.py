"""Save-as plate projects with independent source parts and recoverable original files."""

import io
import json
import math
import re
import shutil
import tempfile
import uuid
import zipfile
import xml.etree.ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape, quoteattr

import file_library
import mesh_tools
import safe_zip
import slicer_profiles
import tool_setup

CORE = mesh_tools.CORE_NS
PROD = mesh_tools.PROD_NS
MAX_SOURCE_BYTES = 128 * 1024 * 1024
IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]


def _xml(data):
    if re.search(rb'<!DOCTYPE|<!ENTITY', data, re.I):
        raise ValueError("Model XML with document declarations is not supported")
    # Only the build list is needed. Do not construct millions of vertex nodes.
    root = ET.Element('{' + CORE + '}model')
    build = ET.SubElement(root, '{' + CORE + '}build')
    parser = expat.ParserCreate(namespace_separator='}')
    in_build = [False]

    def reject_declaration(*args):
        raise ValueError('Model XML with document declarations is not supported')

    parser.StartDoctypeDeclHandler = reject_declaration
    parser.EntityDeclHandler = reject_declaration

    def start(tag, attrs):
        if tag == CORE + '}model':
            root.attrib.update(attrs)
        elif tag == CORE + '}build':
            in_build[0] = True
        elif tag == CORE + '}item' and in_build[0]:
            ET.SubElement(build, '{' + CORE + '}item', attrs)

    def end(tag):
        if tag == CORE + '}build':
            in_build[0] = False

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    try:
        parser.Parse(data, True)
    except expat.ExpatError:
        raise ValueError("The model XML is damaged")
    return root


def _name(path):
    if '\\' in path or '..' in path.split('/') or path.startswith('/'):
        raise ValueError("The project contains an unsafe part name")
    return path


def _write_mesh(target, path, data, name):
    colour_ids = []
    colours = ['#808080']
    lookup = {'#808080': 0}
    current = []

    def vertex(fields):
        values = []
        if len(fields) == 7:
            try:
                values = [float(x) for x in fields[4:7]]
            except ValueError:
                pass
        if len(values) == 3 and all(math.isfinite(v) and 0 <= v <= 1 for v in values):
            colour = '#' + ''.join(f'{round(v * 255):02x}' for v in values)
            if colour not in lookup:
                if len(colours) >= 4096:
                    raise ValueError(
                        'This OBJ has more than 4,096 vertex colours. Save it as a 3MF in its source program to retain them'
                    )
                lookup[colour] = len(colours)
                colours.append(colour)
            colour_ids.append(lookup[colour])
        else:
            colour_ids.append(None)

    def face(indices):
        current[:] = [colour_ids[i] for i in indices]

    with target.open(path, 'w') as stream:

        def write(text):
            stream.write(text.encode())

        write(
            f'<model unit="millimeter" xmlns="{CORE}" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><resources><object id="1" type="model"><mesh><vertices>'
        )
        triangles = (
            mesh_tools.iter_obj(data, vertex, face)
            if name.lower().endswith('.obj')
            else mesh_tools.iter_model(data, name)[0]
        )
        with tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024) as faces:
            count = 0
            # Corners that print the same number are one vertex. A 3MF that gives every triangle its own three corners
            # reads as a surface in loose pieces: the engine finds "empty layers" in it and refuses to slice a real model
            # (the 3DBenchy, a gear, a vase), while a 20-triangle part with whole-number corners happened to pass.
            shared = {}
            for tri in triangles:
                ids = []
                for v in tri:
                    x, y, z = ('%.9g' % (c + 0.0) for c in v)   # + 0.0 turns -0 into 0
                    index = shared.get((x, y, z))
                    if index is None:
                        index = shared[(x, y, z)] = len(shared)
                        write(f'<vertex x="{x}" y="{y}" z="{z}"/>')
                    ids.append(index)
                attrs = (
                    (' pid="2" ' + ' '.join(f'p{i + 1}="{c or 0}"' for i, c in enumerate(current)))
                    if any(c is not None for c in current)
                    else ''
                )
                faces.write(f'<triangle v1="{ids[0]}" v2="{ids[1]}" v3="{ids[2]}"{attrs}/>'.encode())
                count += 1
            if not count:
                raise ValueError("The model has no triangles")
            write('</vertices><triangles>')
            faces.seek(0)
            shutil.copyfileobj(faces, stream, 1024 * 1024)
        write('</triangles></mesh></object>')
        if any(c is not None for c in colour_ids):
            write('<m:colorgroup id="2">' + ''.join(f'<m:color color="{c}"/>' for c in colours) + '</m:colorgroup>')
        write('</resources><build><item objectid="1"/></build></model>')
    return f'<model unit="millimeter" xmlns="{CORE}"><build><item objectid="1"/></build></model>'.encode()


def _relocate_xml(data, prefix):
    """Relocate package-absolute model/texture links; original property data stays in place."""
    _xml(data)

    # Preserve namespace declarations and vendor extension payloads verbatim.
    # Re-serialising XML can rename prefixes referenced by requiredextensions.
    def replace(match):
        path = _name(match.group(3).decode().lstrip('/')).encode()
        return match.group(1) + match.group(2) + b'/' + prefix.encode() + path + match.group(2)

    return re.sub(rb'''(\b(?:[\w.-]+:)?(?:path|Target)\s*=\s*)(["'])(/[^"']*)\2''', replace, data)


_NS = rb'(?:[\w.-]+:)?'
_VERTEX_TAG = re.compile(rb'<' + _NS + rb'vertex\b[^>]*>')
_TRIANGLE_TAG = re.compile(rb'<' + _NS + rb'triangle\b[^>]*>')
_CORNER = re.compile(rb'''(?<=\s)(v[123]\s*=\s*)(["'])(\d+)\2''')


def _block(data, name, start, end):
    """The span between <name ...> and </name> (a prefix is allowed) inside data[start:end], or None."""
    opening = re.compile(rb'<' + _NS + name + rb'\b[^>]*>').search(data, start, end)
    if not opening or opening.group(0).endswith(b'/>'):
        return None
    closing = re.compile(rb'</' + _NS + name + rb'\s*>').search(data, opening.end(), end)
    return (opening.end(), closing.start()) if closing else None


def _compact_mesh(data, start, end):
    """
    The mesh at data[start:end] without the points no triangle uses, as (the new text between <mesh> and </mesh>, how many
    points went), or None when nothing needs to go or the mesh has a shape this does not fully understand (then it stays as it is).
    """
    vertices, triangles = _block(data, b'vertices', start, end), _block(data, b'triangles', start, end)
    if not vertices or not triangles:
        return None
    vertex_text, triangle_text = data[vertices[0]:vertices[1]], data[triangles[0]:triangles[1]]
    count = 0
    for tag in _VERTEX_TAG.finditer(vertex_text):
        if vertex_text[tag.end() - 2:tag.end()] != b'/>':
            return None
        count += 1
    if not count:
        return None
    used, seen = bytearray(count), 0
    for corner in _CORNER.finditer(triangle_text):
        index = int(corner.group(3))
        if index >= count:
            return None
        used[index] = 1
        seen += 1
    if not seen or seen != 3 * sum(1 for _ in _TRIANGLE_TAG.finditer(triangle_text)) or all(used):
        return None
    if _VERTEX_TAG.sub(b'', vertex_text).strip():
        return None
    remap, kept = [], []
    for i, tag in enumerate(_VERTEX_TAG.finditer(vertex_text)):
        remap.append(len(kept) if used[i] else -1)
        if used[i]:
            kept.append(tag.group(0))
    renumbered = _CORNER.sub(
        lambda c: c.group(1) + c.group(2) + str(remap[int(c.group(3))]).encode() + c.group(2), triangle_text
    )
    pieces, at = [], start
    for (a, b), text in sorted([(vertices, b''.join(kept)), (triangles, renumbered)]):
        pieces += [data[at:a], text]
        at = b
    pieces.append(data[at:end])
    return b''.join(pieces), count - len(kept)


def compact_vertices(data):
    """
    A model part (the XML of a 3MF) without the points that no triangle uses, as (bytes, points removed). The engine measures every stored
    point, used or not, when it decides whether an object is inside the plate: one stray point left in a model file by the program that
    saved it, even a single one far from the model, makes it refuse a whole plate with "Nothing to slice". The screen measures only
    the surface, so it shows such a model well inside the plate. Only meshes that have unused points are rewritten (triangles keep their
    order and are renumbered); everything else, namespaces and vendor data included, stays byte for byte.
    """
    removed, pieces, copied, search = 0, [], 0, 0
    while True:
        mesh = _block(data, b'mesh', search, len(data))
        if not mesh:
            break
        search = mesh[1]
        done = _compact_mesh(data, mesh[0], mesh[1])
        if done:
            pieces += [data[copied:mesh[0]], done[0]]
            copied = mesh[1]
            removed += done[1]
    pieces.append(data[copied:])
    return (b''.join(pieces), removed) if removed else (data, 0)


_OBJECT_OPEN = re.compile(rb'<' + _NS + rb'object\b[^>]*>')
_OBJECT_CLOSE = re.compile(rb'</' + _NS + rb'object\s*>')
_COMPONENT_TAG = re.compile(rb'<' + _NS + rb'component\b[^>]*>')
MAX_NESTING = 8


def _attribute(tag, name):
    found = re.search(rb'''(?<![\w.:-])(?:[\w.-]+:)?''' + name + rb'''\s*=\s*(["'])(.*?)\1''', tag)
    return found.group(2).decode('utf-8', 'replace') if found else None


def _shapes(data):
    """
    {object id: (kind, components)} for one model part, read without building the meshes. kind is "mesh" (the object holds a mesh),
    "group" (it holds only components: [(part path or None, object id, transform text)]) or "mixed" (both, which is not flattened).
    """
    shapes, at = {}, 0
    while True:
        opening = _OBJECT_OPEN.search(data, at)
        if not opening:
            return shapes
        tag = opening.group(0)
        object_id = _attribute(tag, b'id')
        if tag.endswith(b'/>'):
            shapes[object_id], at = ('group', []), opening.end()
            continue
        closing = _OBJECT_CLOSE.search(data, opening.end())
        end = closing.start() if closing else len(data)
        mesh = _block(data, b'mesh', opening.end(), end)
        found = [
            (_attribute(c.group(0), b'path'), _attribute(c.group(0), b'objectid'), _attribute(c.group(0), b'transform'))
            for c in _COMPONENT_TAG.finditer(data, mesh[1] if mesh else opening.end(), end)
        ]
        shapes[object_id] = ('mixed' if mesh and found else 'mesh' if mesh else 'group', found)
        at = closing.end() if closing else len(data)


def _flatten(archive, root):
    """
    For each printable build item of a source 3MF, the mesh objects it is made of as [(part name in the archive, object id, transform)],
    with the transforms of every level between the item and the mesh combined, or None for an item whose structure is not understood.
    Slicers that save a project with several parts (Bambu Studio, Orca) make a build item point at an object that only lists components,
    and those point at the mesh objects in other parts. This app's reader follows that to any depth, but the slicing engine does not:
    it loads an object whose components are themselves containers as empty, and then reports that no object is inside the plate.
    """
    names = {n.lower(): n for n in archive.namelist()}
    cache = {}

    def shapes_of(part):
        key = part.lstrip('/').lower()
        if key not in names:
            raise ValueError('a part is missing')
        if key not in cache:
            cache[key] = _shapes(safe_zip.read(archive, names[key], limit=MAX_SOURCE_BYTES))
        return names[key]

    def leaves(part, object_id, transform, depth=0):
        if depth > MAX_NESTING:
            raise ValueError('nested too deeply')
        member = shapes_of(part)
        kind, components = cache[member.lower()].get(object_id) or (None, [])
        if kind in (None, 'mixed'):
            raise ValueError('not understood')
        if kind == 'mesh' or not components:
            return [(member, object_id, transform)]
        out = []
        for path, child, text in components:
            out += leaves(path or member, child, mesh_tools._compose(mesh_tools._matrix(text), transform), depth + 1)
        return out

    result = []
    for item in root.findall('{' + CORE + '}build/{' + CORE + '}item'):
        if item.get('printable', '1') == '0':
            continue
        try:
            result.append((item, leaves('3D/3dmodel.model', item.get('objectid', ''), mesh_tools._matrix(item.get('transform')))))
        except ValueError:                      # includes MeshError: the item is referenced the way it always was
            result.append((item, None))
    return result


def build(body):
    rows = body.get('objects')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 32:
        raise ValueError("A plate needs between 1 and 32 model objects")
    output = io.BytesIO()
    objects = []
    settings = []
    source_bytes = 0
    model_parts = []
    unpacked_total = 0
    generation = None
    setup = tool_setup.get()['heads']
    palette = [next((h['color_hex'] for h in setup if h['toolhead'] == 'T' + str(i)), '#808080') for i in range(4)]
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError("Each plate object needs its own settings")
            name = file_library.clean_name(row.get('name'))
            if file_library.kind_of(name) not in ('stl', 'obj', '3mf'):
                raise ValueError("Add STL, OBJ or 3MF models to a plate")
            data = file_library.read_bytes(name)
            source_bytes += len(data)
            if source_bytes > MAX_SOURCE_BYTES:
                raise ValueError("This plate's source files are too large; use fewer objects")
            transform = row.get('transform', IDENTITY)
            if (
                not isinstance(transform, list)
                or len(transform) != 12
                or any(not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > 100000 for x in transform)
            ):
                raise ValueError("The object has an invalid position, rotation or scale")
            tool = row.get('tool', 0)
            if not isinstance(tool, int) or tool not in range(4):
                raise ValueError("Assign objects to physical tools T0 to T3")
            options = slicer_profiles.validate_options(row.get('settings') or {})
            prefix = f'3D/sources/{index}/'
            main = prefix + '3D/3dmodel.model'
            root = flat = None
            if name.lower().endswith('.3mf'):
                archive = safe_zip.open_archive(data)
                try:
                    if 'DejaVu/generation.json' in archive.namelist():
                        try:
                            contract = json.loads(safe_zip.read(archive, 'DejaVu/generation.json', limit=4096))
                        except (ValueError, UnicodeError):
                            raise ValueError('This image project has damaged layer settings')
                        if not isinstance(contract, dict):
                            raise ValueError('This image project has damaged layer settings')
                        if generation is not None and generation != contract:
                            raise ValueError(
                                'Use image projects made for the same printer, tools and layer thickness on one plate'
                            )
                        if any(abs(transform[i] - v) > 1e-7 for i, v in [(2, 0), (5, 0), (8, 1), (11, 0)]):
                            raise ValueError(
                                'Keep generated colour layers upright, at their original thickness and on the plate. Move or rotate around Z; regenerate for a different thickness'
                            )
                        generation = contract
                    if len(archive.infolist()) > 2000:
                        raise ValueError("This project has too many parts to combine")
                    total = 0
                    for info in archive.infolist():
                        if info.is_dir():
                            continue
                        part = _name(info.filename)
                        total += info.file_size
                        unpacked_total += info.file_size
                        if unpacked_total > MAX_SOURCE_BYTES:
                            raise ValueError("This project expands beyond the plate editor's memory limit")
                        content = safe_zip.read(archive, part, limit=MAX_SOURCE_BYTES)
                        if part.lower().endswith(('.model', '.rels')):
                            content = _relocate_xml(content, prefix)
                        target.writestr(prefix + part, content)
                        if part.lower().endswith('.model'):
                            model_parts.append(prefix + part)
                    original = safe_zip.read(archive, '3D/3dmodel.model', limit=MAX_SOURCE_BYTES)
                    root = _xml(original)
                    flat = dict((id(item), leaves) for item, leaves in _flatten(archive, root))
                finally:
                    archive.close()
            else:
                original = _write_mesh(target, main, data, name)
                model_parts.append(main)
            if root is None:
                root = _xml(original)
            if root.get('unit', 'millimeter') != 'millimeter':
                raise ValueError("Convert this model to millimetres before combining it")
            items = root.findall('{' + CORE + '}build/{' + CORE + '}item')
            if not items:
                raise ValueError("The source project has no printable build items")
            oid = index + 1
            comps = []
            for item in items:
                if item.get('printable', '1') == '0':
                    continue
                leaves = (flat or {}).get(id(item))
                if leaves:
                    for member, leaf, transform in leaves:
                        attrs = ' objectid=' + quoteattr(leaf) + ' p:path=' + quoteattr('/' + prefix + member)
                        if transform:
                            attrs += ' transform=' + quoteattr(' '.join(format(v, '.9g') for v in transform))
                        comps.append('<component' + attrs + '/>')
                    continue
                attrs = ' objectid=' + quoteattr(item.get('objectid', '')) + ' p:path=' + quoteattr('/' + main)
                if item.get('transform'):
                    attrs += ' transform=' + quoteattr(item.get('transform'))
                comps.append('<component' + attrs + '/>')
            objects.append(
                f'<object id="{oid}" type="model" name={quoteattr(name)}><components>'
                + ''.join(comps)
                + '</components></object>'
            )
            settings.append(
                f'<object id="{oid}"><metadata key="name" value={quoteattr(name)}/><metadata key="extruder" value="{tool + 1}"/>'
                + ''.join(f'<metadata key={quoteattr(k)} value={quoteattr(v)}/>' for k, v in options.items())
                + '</object>'
            )
            # Recovery copies are never modified or interpreted as executable code.
            target.writestr(f'DejaVu/Sources/{index}/{name}', data)
        model = (
            f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="{CORE}" xmlns:p="{PROD}" requiredextensions="p"><metadata name="Application">Deja Vu1</metadata><resources>'
            + ''.join(objects)
            + '</resources><build>'
            + ''.join(
                f'<item objectid="{i + 1}" transform="'
                + ' '.join(format(v, '.9g') for v in row.get('transform', IDENTITY))
                + '"/>'
                for i, row in enumerate(rows)
            )
            + '</build></model>'
        )
        target.writestr('3D/3dmodel.model', model)
        target.writestr(
            '_rels/.rels',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        )
        target.writestr(
            '3D/_rels/3dmodel.model.rels',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(
                f'<Relationship Target="/{escape(path)}" Id="source{i}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
                for i, path in enumerate(model_parts)
            )
            + '</Relationships>',
        )
        target.writestr(
            '[Content_Types].xml',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/></Types>',
        )
        instances = ''.join(
            f'<model_instance><metadata key="object_id" value="{i + 1}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="{i + 1}"/></model_instance>'
            for i in range(len(rows))
        )
        target.writestr(
            'Metadata/model_settings.config',
            '<config>'
            + ''.join(settings)
            + '<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Deja Vu1 plate"/>'
            + instances
            + '</plate></config>',
        )
        target.writestr(
            'Metadata/project_settings.config',
            json.dumps(
                {
                    'filament_colour': palette,
                    'filament_type': [
                        next((h['material'] for h in setup if h['toolhead'] == 'T' + str(i)), '') for i in range(4)
                    ],
                    'printer_model': 'Snapmaker U1',
                    'printer_settings_id': 'Snapmaker U1 (0.4 nozzle)',
                }
            ),
        )
        target.writestr('DejaVu/plate.json', json.dumps({'version': 1, 'objects': rows}))
        if generation is not None:
            target.writestr('DejaVu/generation.json', json.dumps(generation))
    result = output.getvalue()
    if len(result) > file_library.MAX_BYTES:
        raise ValueError("The saved plate would exceed the library's 64 MB file limit")
    return result


def save(body):
    data = build(body)
    name = 'plate-' + uuid.uuid4().hex[:10] + '.3mf'
    return file_library.save(
        name, data, origin='prepared', note='Plate project; original source files included for recovery'
    )


def native(parts, palette, note='Generated model'):
    """Independent mesh objects and physical-tool assignments in one native project."""
    output = io.BytesIO()
    settings = []
    objects = []
    for i, part in enumerate(parts):
        if not part['triangles']:
            continue
        tool = part['tool']
        oid = len(objects) + 1
        vertices = ''.join('<vertex x="%.7g" y="%.7g" z="%.7g"/>' % tuple(v) for v in part['vertices'])
        paint = ('4', '8', '0C', '1C')[tool]
        triangles = ''.join(
            f'<triangle v1="{a}" v2="{b}" v3="{c}" paint_color="{paint}"/>' for a, b, c in part['triangles']
        )
        objects.append(
            f'<object id="{oid}" type="model" pid="100" pindex="{tool}"><mesh><vertices>{vertices}</vertices><triangles>{triangles}</triangles></mesh></object>'
        )
        settings.append(
            f'<part id="{oid}" subtype="normal_part"><metadata key="name" value="T{tool} geometry"/><metadata key="extruder" value="{tool + 1}"/></part>'
        )
    if not objects:
        raise ValueError('The generated model has no geometry')
    materials = (
        '<basematerials id="100">'
        + ''.join(f'<base name="T{i}" displaycolor="{h["color_hex"]}"/>' for i, h in enumerate(palette))
        + '</basematerials>'
    )
    assembly = (
        '<object id="1000" type="model"><components>'
        + ''.join(f'<component objectid="{i + 1}"/>' for i in range(len(objects)))
        + '</components></object>'
    )
    model = (
        f'<model unit="millimeter" xmlns="{CORE}"><metadata name="Application">Deja Vu1</metadata><metadata name="Description">{escape(note)}</metadata><resources>'
        + materials
        + ''.join(objects)
        + assembly
        + '</resources><build><item objectid="1000"/></build></model>'
    )
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('3D/3dmodel.model', model)
        z.writestr(
            '_rels/.rels',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        )
        z.writestr(
            '[Content_Types].xml',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
        )
        z.writestr(
            'Metadata/model_settings.config',
            '<config><object id="1000"><metadata key="name" value="Four-tool model"/>'
            + ''.join(settings)
            + '</object></config>',
        )
        z.writestr(
            'Metadata/project_settings.config',
            json.dumps(
                {
                    'filament_colour': [h['color_hex'] for h in palette],
                    'filament_type': [h['material'] for h in palette],
                    'printer_model': 'Snapmaker U1',
                }
            ),
        )
    return output.getvalue()
