"""Select one documented 3MF plate without merging its neighbours or editing its source."""
import io
import json
import math
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET

import converter_3mf
import file_library
import plate_project
import safe_zip

MODEL = '3D/3dmodel.model'
SETTINGS = 'Metadata/model_settings.config'


def _tree(data):
    if len(data) > 16*1024*1024:
        raise ValueError('This plate document is too large to separate here. Export a single plate from the source slicer')
    plate_project._xml(data)  # reject declarations in every XML encoding before building a tree
    try: return ET.fromstring(data)
    except ET.ParseError: raise ValueError('The project plate settings are damaged')


def _parts(archive):
    if SETTINGS not in archive.namelist(): return [], None
    root = _tree(safe_zip.read(archive, SETTINGS, limit=16*1024*1024))
    plates = []
    for index, node in enumerate(root.findall('plate')):
        meta = {m.get('key'): m.get('value') for m in node.findall('metadata')}
        instances = []
        for instance in node.findall('model_instance'):
            fields = {m.get('key'):m.get('value') for m in instance.findall('metadata')}
            try: key = (str(fields['object_id']), int(fields['instance_id']))
            except (KeyError, ValueError, TypeError): raise ValueError('A plate has an invalid object instance')
            if key in instances: raise ValueError('A plate repeats an object instance')
            instances.append(key)
        if instances:
            plates.append({'id': str(index+1), 'name': meta.get('plater_name') or f'Plate {index+1}',
                           'objects': len(instances), 'instances': instances, 'node':node, 'index':index})
    return plates, root


def describe_data(data):
    with safe_zip.open_archive(data) as archive:
        plates, _ = _parts(archive)
    return {'count':len(plates), 'plates':[{k:p[k] for k in ('id','name','objects')} for p in plates],
            'note':'Choose one plate to prepare or slice. A new file retains the original project for recovery.'}


def describe(name):
    if file_library.kind_of(name or '') != '3mf': return {'plates': [], 'count': 0}
    return describe_data(file_library.read_bytes(name))


def extract(data, plate_id):
    with safe_zip.open_archive(data) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise ValueError('The project repeats archive part names. Re-save it in its source slicer')
        plates, settings = _parts(archive)
        plate = next((p for p in plates if p['id'] == str(plate_id)), None)
        if not plate: raise ValueError('Choose an available plate')
        membership = [i for p in plates for i in p['instances']]
        if len(membership) != len(set(membership)):
            raise ValueError('An object instance belongs to more than one plate. Re-save the project in its source slicer')
        model_data = safe_zip.read(archive, MODEL, limit=16*1024*1024)
        model = _tree(model_data)
        build = model.find('{'+plate_project.CORE+'}build')
        if build is None: raise ValueError('The project has no build list')
        seen, selected = {}, []
        for item in list(build):
            oid = item.get('objectid'); occurrence = seen.get(oid, 0); seen[oid] = occurrence+1
            if (oid, occurrence) in plate['instances']: selected.append(item)
        if len(selected) != len(plate['instances']):
            raise ValueError('A selected plate refers to missing objects. Re-save it in its source slicer')
        config = {}
        if 'Metadata/project_settings.config' in archive.namelist():
            try: config = json.loads(safe_zip.read(archive, 'Metadata/project_settings.config', limit=4*1024*1024))
            except (ValueError, UnicodeError): raise ValueError('The project settings are damaged')
        bed = converter_3mf._bed(config.get('printable_area')) if isinstance(config, dict) else None
        if len(plates)>1 and bed is None:
            raise ValueError('The project has no readable original bed size. Export a single plate in its source slicer')
        columns = math.ceil(math.sqrt(max(p['index'] for p in plates)+1))
        dx = (plate['index'] % columns) * bed['width'] * 1.2 if bed else 0
        dy = -(plate['index'] // columns) * bed['depth'] * 1.2 if bed else 0
        transforms = []
        for item in selected:
            try: matrix = [float(v) for v in item.get('transform','1 0 0 0 1 0 0 0 1 0 0 0').split()]
            except ValueError: raise ValueError('An object has an unreadable transform')
            if len(matrix)!=12 or not all(math.isfinite(v) for v in matrix): raise ValueError('An object has an invalid transform')
            matrix[9]-=dx; matrix[10]-=dy
            transforms.append(' '.join(f'{v:.9g}' for v in matrix))
        # Preserve model XML and all namespace/extension spelling verbatim. Only
        # replace the build list; ET reserialization can break requiredextensions.
        build_match = re.search(br'(<(?:[\w.-]+:)?build\b[^>]*>)(.*?)(</(?:[\w.-]+:)?build\s*>)',model_data,re.S)
        if not build_match: raise ValueError('This build-list encoding cannot be separated safely. Re-save as UTF-8 in its source slicer')
        raw_items = re.findall(br'<(?:[\w.-]+:)?item\b[^>]*?/\s*>',build_match.group(2))
        if len(raw_items) != len(list(build)):
            raise ValueError('This build-list syntax cannot be separated safely. Re-save in its source slicer')
        listing=[]
        for item, raw in zip(list(build), raw_items):
            if item not in selected: continue
            transform=transforms[len(listing)].encode()
            if re.search(br'\btransform\s*=',raw):
                raw=re.sub(br'''\btransform\s*=\s*(["']).*?\1''',b'transform="'+transform+b'"',raw)
            else: raw=re.sub(br'/\s*>$',b' transform="'+transform+b'"/>',raw)
            listing.append(raw)
        model_data=model_data[:build_match.start()]+build_match.group(1)+b''.join(listing)+build_match.group(3)+model_data[build_match.end():]
        keep_ids={oid for oid,_ in plate['instances']}
        for node in list(settings):
            if node.tag=='plate' or (node.tag=='object' and node.get('id') not in keep_ids): settings.remove(node)
        chosen=plate['node']
        for m in chosen.findall('metadata'):
            if m.get('key')=='plater_id':m.set('value','1')
        # Instance indices are now counted only inside the selected build list.
        seen={}
        for instance in chosen.findall('model_instance'):
            meta={m.get('key'):m for m in instance.findall('metadata')};oid=meta['object_id'].get('value')
            meta['instance_id'].set('value',str(seen.get(oid,0)));seen[oid]=seen.get(oid,0)+1
        settings.append(chosen)
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as target:
            for info in archive.infolist():
                name=plate_project._name(info.filename)
                if info.is_dir() or name in (MODEL,SETTINGS) or name.startswith('DejaVu/Original/') or re.match(r'Metadata/(?:plate_\d+\.(?:gcode|png)|slice_info\.config)',name):continue
                target.writestr(name,safe_zip.read(archive,name,limit=file_library.MAX_BYTES))
            target.writestr(MODEL,model_data);target.writestr(SETTINGS,ET.tostring(settings,encoding='utf-8'))
            target.writestr('DejaVu/Original/project.3mf',data)
        result=out.getvalue()
        if len(result)>file_library.MAX_BYTES:raise ValueError('The separated plate and recovery source exceed the file limit')
        return result


def save(body):
    name=file_library.clean_name(body.get('name'))
    if file_library.kind_of(name)!='3mf':raise ValueError('Choose a 3MF project')
    data=extract(file_library.read_bytes(name),body.get('plate'))
    return file_library.save('selected-plate-'+uuid.uuid4().hex[:10]+'.3mf',data,origin='prepared',note='Single plate; original project retained for recovery')


def engine_input(data, filaments):
    """Align source preset identity slots with the explicitly selected CLI materials."""
    part='Metadata/project_settings.config'
    with safe_zip.open_archive(data) as archive:
        if part not in archive.namelist():return data,[]
        if len(archive.namelist())!=len(set(archive.namelist())):raise ValueError('The source project repeats archive part names. Re-save it in its source slicer')
        try:config=json.loads(safe_zip.read(archive,part,limit=4*1024*1024))
        except (ValueError,UnicodeError):raise ValueError('The source project settings are damaged')
        if not isinstance(config,dict):raise ValueError('The source project settings must be an object')
        source=config.get('filament_settings_id')
        if not isinstance(source,list):return data,[]
        if len(source)>len(filaments):raise ValueError('The source project has more material slots than the selected physical-head profile. Review its mapping in the engine')
        source_count=len(source)
        for key in ('inherits_group','different_settings_to_system'):
            if key not in config:continue
            group=config[key]
            if not isinstance(group,list) or len(group)!=source_count+2:
                raise ValueError('The source preset identity slots are inconsistent. Re-save this project in its source slicer')
            config[key]=group[:-1]+['']*(len(filaments)-source_count)+group[-1:]
        if len(source)==len(filaments):return data,[]
        config['filament_settings_id']=[f.get('name','') for f in filaments]
        for key in ('filament_colour','filament_type','filament_diameter'):
            if all(isinstance(f.get(key),list) and f[key] for f in filaments):config[key]=[f[key][0] for f in filaments]
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as target:
            for info in archive.infolist():
                name=plate_project._name(info.filename)
                if info.is_dir():continue
                target.writestr(name,json.dumps(config).encode() if name==part else safe_zip.read(archive,name,limit=file_library.MAX_BYTES))
        return out.getvalue(),['Source preset identity slots were aligned to the selected physical-head material profile in a temporary input. Geometry, paint, per-part settings and the library source are unchanged.']
