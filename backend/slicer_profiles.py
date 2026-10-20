"""Resolve installed presets and write private working copies, without bundling engine data."""
import hashlib
import json
import math
import os
from pathlib import Path
import uuid

import layer_planner
import storage

_DATA_DIR = storage.DATA_DIR
MAX_FILES = 5000
MAX_BYTES = 4 * 1024 * 1024
NUMBERS = {"layer_height": (.04, .56), "initial_layer_print_height": (.04,.56), "wall_loops": (1, 20),
           "top_shell_layers": (0, 30), "bottom_shell_layers": (0, 30),
           "outer_wall_speed": (5, 500), "inner_wall_speed": (5, 500),
           "sparse_infill_speed": (5, 500), "travel_speed": (10, 700)}


def roots(program):
    p = Path(program).resolve() if program else Path('/nonexistent')
    candidates = [p.parent / 'resources' / 'profiles', p.parent.parent / 'resources' / 'profiles',
                  p.parent.parent / 'Resources' / 'profiles']
    return next((r for r in candidates if (r / 'Snapmaker').is_dir()), None)


def _read(path):
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("This preset is too large to read")
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
    except (ValueError, UnicodeError):
        raise ValueError(f"{path.name} is not a readable settings file")
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} does not contain settings")
    return data


def scan(program):
    root = roots(program)
    if root is None:
        return {}, None
    files = sorted((root / 'Snapmaker').rglob('*.json'))
    if len(files) > MAX_FILES:
        raise ValueError("Too many installed presets. Use exported presets in Advanced setup")
    entries = {}
    for p in files:
        try:
            d = _read(p)
        except (OSError, ValueError):
            continue
        if d.get('type') not in ('machine','process','filament'):
            continue
        key = hashlib.sha256(str(p.relative_to(root)).encode()).hexdigest()[:16]
        entries[key] = {'path': p, 'data': d}
    return entries, root


def catalog(program):
    entries, root = scan(program)
    rows = []
    for key, e in entries.items():
        d = e['data']; name = str(d.get('name') or '')
        if str(d.get('instantiation')).lower() != 'true' or 'u1' not in name.lower():
            continue
        try:resolved=resolve(key,entries)
        except ValueError:continue
        rows.append({'id': key, 'name': name, 'type': d['type'],
                     'compatible_printers': d.get('compatible_printers') or [],
                     'nozzles': resolved.get('nozzle_diameter'),
                     'layer_height': resolved.get('layer_height'),
                     'material': (resolved.get('filament_type') or [None])[0]})
    return {'presets': rows, 'available': bool(rows),
            'problem': None if rows else 'No installed U1 presets were found beside OrcaSlicer. Open Orca, install its Snapmaker U1 profiles, then check again. An extracted Linux AppImage can expose its resources folder; Advanced setup also accepts exported presets.'}


def resolve(key, entries, stack=()):
    if key in stack or len(stack) >= 12:
        raise ValueError("Preset inheritance is circular or too deep. Export a complete preset from Orca")
    if key not in entries:
        raise ValueError("That installed preset is no longer available. Scan again")
    e = entries[key]; d = e['data']; parent = d.get('inherits')
    out = {}
    if parent:
        matches = [(k,v) for k,v in entries.items() if v['data'].get('name') == parent and v['data'].get('type') == d.get('type')]
        if len(matches) != 1:
            raise ValueError(f"Cannot resolve parent preset {parent!r}. Export a complete preset from Orca")
        out.update(resolve(matches[0][0], entries, stack+(key,)))
    out.update(d)
    out.pop('inherits',None)
    # CLI uses a system preset's own name for compatibility; a User preset
    # without an inherited system name is treated as an unnamed machine.
    out['from'] = 'system'
    return out


def validate_options(options):
    if not isinstance(options,dict):
        raise ValueError("Print settings must be a settings object")
    out = {}
    for key,value in options.items():
        if key in NUMBERS:
            try:n=float(value)
            except (TypeError,ValueError):raise ValueError(f"{key} needs a number")
            lo,hi=NUMBERS[key]
            if not math.isfinite(n) or not lo <= n <= hi:
                raise ValueError(f"{key} must be between {lo} and {hi}")
            if key in ('wall_loops','top_shell_layers','bottom_shell_layers') and not n.is_integer():
                raise ValueError("Wall and shell counts must be whole numbers")
            out[key]=str(int(n) if n.is_integer() else n)
        elif key == 'sparse_infill_density':
            try:n=float(str(value).rstrip('%'))
            except (TypeError,ValueError):raise ValueError("Infill must be a percentage")
            if not math.isfinite(n) or not 0 <= n <= 100:raise ValueError("Infill must be between 0 and 100%")
            out[key]=f'{n:g}%'
        elif key == 'enable_support' and isinstance(value,bool):out[key]='1' if value else '0'
        elif key == 'sparse_infill_pattern' and value in ('grid','gyroid','rectilinear','honeycomb'):out[key]=value
        elif key == 'support_type' and value in ('normal(auto)','tree(auto)'):out[key]=value
        else:raise ValueError(f"Unsupported print setting: {key}")
    return out


def prepare(program, body, heads):
    entries, root=scan(program)
    machine=resolve(str(body.get('machine')),entries)
    process=resolve(str(body.get('process')),entries)
    ids=body.get('filaments')
    if not isinstance(ids,list) or len(ids) != 4:raise ValueError("Choose one material preset for each of the four heads")
    filaments=[resolve(str(i),entries) for i in ids]
    if machine.get('type')!='machine' or process.get('type')!='process' or any(f.get('type')!='filament' for f in filaments):
        raise ValueError("Choose printer, print and material presets in their matching slots")
    if machine.get('printer_model') != 'Snapmaker U1':raise ValueError("Choose a Snapmaker U1 printer preset")
    for p in [process]+filaments:
        compatible=p.get('compatible_printers') or []
        if compatible and machine['name'] not in compatible:
            reviewed=(p.get('type')=='filament' and body.get('allow_material_variant') is True
                      and all(str(n).startswith('Snapmaker U1 (') for n in compatible))
            if not reviewed:
                raise ValueError(f"{p['name']} does not list {machine['name']} as compatible. Choose matching presets, or explicitly review using a U1 material preset with another nozzle variant")
    if len(heads)!=4:raise ValueError("Save the four-head preparation choices first")
    heads=sorted(heads,key=lambda h:h['toolhead'])
    try:profile_nozzles=sorted(float(n) for n in machine.get('nozzle_diameter',[]))
    except (ValueError,TypeError):raise ValueError('The installed printer preset has unreadable nozzle sizes')
    if profile_nozzles!=sorted(h['nozzle'] for h in heads):
        raise ValueError('The printer preset nozzle sizes do not match the saved tools. Choose a matching nozzle variant or correct the fitted-tool records')
    machine['nozzle_diameter']=[str(h['nozzle']) for h in heads]
    machine['min_layer_height']=[str(layer_planner.U1_LIMITS[h['nozzle']][0]) for h in heads]
    machine['max_layer_height']=[str(layer_planner.U1_LIMITS[h['nozzle']][1]) for h in heads]
    machine['extruder_colour']=[h['color_hex'] for h in heads]
    machine['printer_settings_id']=machine['name']
    process['print_settings_id']=process['name']
    process.update(validate_options(body.get('options') or {}))
    notes=[]
    if len(set(h['nozzle'] for h in heads))>1:
        # Percentage bridge widths are evaluated against the largest nozzle,
        # but engine validation caps bridges at the smallest fitted nozzle.
        process['bridge_line_width']=str(min(h['nozzle'] for h in heads))
        notes.append('Bridge line width is limited to the smallest fitted nozzle. Review the material flow limits for every head before printing')
    if body.get('allow_material_variant') is True:
        notes.append('You explicitly allowed U1 material presets listed for another nozzle variant. Their temperature and flow settings still need physical verification')
    height=float(process.get('layer_height') or .2)
    # Stock Orca does not advertise per-head preferred heights. A common layer
    # height still passes through the same nozzle planner before reaching it.
    plan=layer_planner.plan([dict(h,height=height) for h in heads])
    if not all(h['ok'] for h in plan['heads']):
        raise ValueError("The layer height is outside one or more nozzle limits. Choose a shared height or use a verified mixed-height engine")
    first=float(process.get('initial_layer_print_height') or height)
    if any(not layer_planner.U1_LIMITS[h['nozzle']][0]<=first<=layer_planner.U1_LIMITS[h['nozzle']][1] for h in heads):
        raise ValueError('The first-layer height is outside one or more nozzle limits')
    for h,f in zip(heads,filaments):
        types=f.get('filament_type') or []
        if types and str(types[0]).upper()!=h['material']:
            raise ValueError(f"{h['toolhead']}: the chosen material preset does not match its saved material")
        f['filament_colour']=[h['color_hex']]
        f['filament_settings_id']=[f['name']]
    work=Path(_DATA_DIR)/'slicer-presets'/uuid.uuid4().hex
    work.mkdir(parents=True)
    paths=[]
    for name,data in [('machine',machine),('process',process)]+[(f'filament-{i}',f) for i,f in enumerate(filaments)]:
        path=work/(name+'.json');storage.save_json(str(path),data);paths.append(str(path))
    return {'machine':paths[0],'process':paths[1],'filaments':paths[2:],'options':body.get('options') or {},
            'tool_setup':heads,'layer_plan':plan,'source':'installed presets','warnings':notes}
