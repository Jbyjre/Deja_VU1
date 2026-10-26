"""Resolve installed presets and write private working copies, without bundling engine data."""

import hashlib
import json
import math
import re
from pathlib import Path
import uuid

import layer_planner
import process_settings
import storage
import slicing_contract

_DATA_DIR = storage.DATA_DIR
MAX_FILES = 5000
MAX_BYTES = 4 * 1024 * 1024
# The process settings and their limits live in process_settings.py (the
# same table the profile editor is drawn from).
NUMBERS = {k: (o["min"], o["max"]) for k, o in process_settings.OPTIONS.items() if "min" in o}
FILAMENT_NUMBERS = {
    'nozzle_temperature': (170, 320),
    'nozzle_temperature_initial_layer': (170, 320),
    'hot_plate_temp': (0, 110),
    'hot_plate_temp_initial_layer': (0, 110),
    'filament_flow_ratio': (0.5, 1.5),
    'filament_max_volumetric_speed': (1, 50),
    'fan_min_speed': (0, 100),
    'fan_max_speed': (0, 100),
}


def material_options(options):
    if not isinstance(options, dict):
        raise ValueError('Material settings must be a settings object')
    result = {}
    for key, value in options.items():
        if key not in FILAMENT_NUMBERS:
            raise ValueError(f'Unsupported material setting: {key}')
        try:
            number = float(value)
        except (ValueError, TypeError):
            raise ValueError(f'{key} needs a number')
        lo, hi = FILAMENT_NUMBERS[key]
        if not math.isfinite(number) or not lo <= number <= hi:
            raise ValueError(f'{key} must be between {lo} and {hi}')
        result[key] = [f'{number:g}']
    if all(k in result for k in ('fan_min_speed', 'fan_max_speed')) and float(result['fan_min_speed'][0]) > float(
        result['fan_max_speed'][0]
    ):
        raise ValueError('Minimum fan speed cannot exceed maximum fan speed')
    return result


def roots(program, preset_folder=None):
    if preset_folder:
        root = Path(preset_folder).expanduser()
        if not root.is_dir() or not (root / 'Snapmaker').is_dir():
            raise ValueError('Choose an unpacked presets folder containing a Snapmaker directory')
        return root
    p = Path(program).resolve() if program else Path('/nonexistent')
    candidates = [
        p.parent / 'resources' / 'profiles',
        p.parent.parent / 'resources' / 'profiles',
        p.parent.parent / 'Resources' / 'profiles',
    ]
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


def scan(program, preset_folder=None):
    root = roots(program, preset_folder)
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
        if d.get('type') not in ('machine', 'process', 'filament'):
            continue
        key = hashlib.sha256(str(p.relative_to(root)).encode()).hexdigest()[:16]
        entries[key] = {'path': p, 'data': d}
    return entries, root


def catalog(program, preset_folder=None):
    entries, root = scan(program, preset_folder)
    rows = []
    for key, e in entries.items():
        d = e['data']
        name = str(d.get('name') or '')
        if str(d.get('instantiation')).lower() != 'true' or 'u1' not in name.lower():
            continue
        try:
            resolved = resolve(key, entries)
        except ValueError:
            continue
        rows.append(
            {
                'id': key,
                'name': name,
                'type': d['type'],
                'compatible_printers': d.get('compatible_printers') or [],
                'nozzles': resolved.get('nozzle_diameter'),
                'layer_height': resolved.get('layer_height'),
                'options': {k: resolved[k] for k in process_settings.OPTIONS if k in resolved},
                'material_options': {k: resolved[k] for k in FILAMENT_NUMBERS if k in resolved},
                'material': (resolved.get('filament_type') or [None])[0],
            }
        )
    return {
        'presets': rows,
        'available': bool(rows),
        'problem': None
        if rows
        else 'No readable U1 presets were found. Some engine builds package presets in an opaque cache; choose an unpacked presets folder or use complete exported JSON files. Open Orca, install its Snapmaker U1 profiles, then check again. An extracted Linux AppImage can expose its resources folder; Advanced setup also accepts exported presets.',
    }


def resolve(key, entries, stack=()):
    if key in stack or len(stack) >= 12:
        raise ValueError("Preset inheritance is circular or too deep. Export a complete preset from Orca")
    if key not in entries:
        raise ValueError("That installed preset is no longer available. Scan again")
    e = entries[key]
    d = e['data']
    parent = d.get('inherits')
    out = {}
    if parent:
        matches = [
            (k, v)
            for k, v in entries.items()
            if v['data'].get('name') == parent and v['data'].get('type') == d.get('type')
        ]
        if len(matches) != 1:
            raise ValueError(f"Cannot resolve parent preset {parent!r}. Export a complete preset from Orca")
        out.update(resolve(matches[0][0], entries, stack + (key,)))
    out.update(d)
    out.pop('inherits', None)
    # CLI uses a system preset's own name for compatibility; a User preset
    # without an inherited system name is treated as an unnamed machine.
    out['from'] = 'system'
    return out


def validate_options(options):
    """Check every requested process setting against process_settings; refuse anything else."""
    if not isinstance(options, dict):
        raise ValueError("Print settings must be a settings object")
    return {key: process_settings.validate(key, value) for key, value in options.items()}


def _apply(config, values):
    """
    Write checked values into a preset copy, keeping the preset's own shape:
    newer engines store some settings as one value per extruder (a list).
    """
    for key, value in values.items():
        old = config.get(key)
        config[key] = [value] * max(1, len(old)) if isinstance(old, list) else value


def prepare(program, body, heads, capabilities=None, preset_folder=None):
    entries, root = scan(program, preset_folder)
    machine = resolve(str(body.get('machine')), entries)
    process = resolve(str(body.get('process')), entries)
    ids = body.get('filaments')
    if not isinstance(ids, list) or len(ids) != 4:
        raise ValueError("Choose one material preset for each of the four heads")
    filaments = [resolve(str(i), entries) for i in ids]
    if (
        machine.get('type') != 'machine'
        or process.get('type') != 'process'
        or any(f.get('type') != 'filament' for f in filaments)
    ):
        raise ValueError("Choose printer, print and material presets in their matching slots")
    if machine.get('printer_model') != 'Snapmaker U1':
        raise ValueError("Choose a Snapmaker U1 printer preset")
    for line in str(machine.get('machine_start_gcode') or '').replace('\\n', '\n').splitlines():
        code = line.split(';', 1)[0]
        if re.match(r'\s*G0?[01]\s', code, re.I) and re.search(r'\bE(?:[+\d.{]|-?\d)', code, re.I):
            for axis, value in re.findall(r'\b([XYZ])([-+]?\d+(?:\.\d+)?)', code, re.I):
                if not 0 <= float(value) <= 270:
                    raise ValueError(
                        f'This preset starts extrusion at {axis.upper()}{value}, outside the supported 270 mm volume. Choose a native U1 startup preset and review it in the engine. No startup instructions or safety limits were changed'
                    )
    for p in [process] + filaments:
        compatible = p.get('compatible_printers') or []
        if compatible and machine['name'] not in compatible:
            reviewed = (
                p.get('type') == 'filament'
                and body.get('allow_material_variant') is True
                and all(str(n).startswith('Snapmaker U1 (') for n in compatible)
            )
            if not reviewed:
                raise ValueError(
                    f"{p['name']} does not list {machine['name']} as compatible. Choose matching presets, or explicitly review using a U1 material preset with another nozzle variant"
                )
    if len(heads) != 4:
        raise ValueError("Save the four-head preparation choices first")
    heads = sorted(heads, key=lambda h: h['toolhead'])
    if body.get('expected_tools') is not None and body['expected_tools'] != heads:
        raise ValueError(
            'Tool preparation changed while this form was open. Find installed profiles again to review the current fitted heads'
        )
    try:
        profile_nozzles = sorted(float(n) for n in machine.get('nozzle_diameter', []))
    except (ValueError, TypeError):
        raise ValueError('The installed printer preset has unreadable nozzle sizes')
    mixed_review = (
        body.get('layer_mode') == 'per_tool'
        and (capabilities or {}).get('per_tool_heights')
        and body.get('allow_nozzle_variant') is True
        and len(profile_nozzles) == 4
    )
    if profile_nozzles != sorted(h['nozzle'] for h in heads) and not mixed_review:
        raise ValueError(
            'The printer preset nozzle sizes do not match the saved tools. Choose a matching nozzle variant or correct the fitted-tool records'
        )
    machine['nozzle_diameter'] = [str(h['nozzle']) for h in heads]
    machine['min_layer_height'] = [str(layer_planner.U1_LIMITS[h['nozzle']][0]) for h in heads]
    machine['max_layer_height'] = [str(layer_planner.U1_LIMITS[h['nozzle']][1]) for h in heads]
    machine['extruder_colour'] = [h['color_hex'] for h in heads]
    machine['printer_settings_id'] = machine['name']
    process['print_settings_id'] = process['name']
    # Some CLI builds normalize a process before merging its machine context.
    # A process with wipe-tower tool selection needs the actual nozzle count
    # at that stage. Supply the same fitted nozzles in both working copies.
    process['nozzle_diameter'] = machine['nozzle_diameter'][:]
    _apply(process, validate_options(body.get('options') or {}))
    if (capabilities or {}).get('per_tool_heights'):
        # Older preset files use flow markers that the newer CLI materializes
        # as empty vectors during merging. Translate the verified standard-flow
        # format only. Other flow variants require a current engine export.
        for config, old, new in [
            (machine, 'printer_flow_support', 'printer_extruder_variant'),
            (process, 'process_flow_support', 'print_extruder_variant'),
        ] + [(f, 'filament_flow_support', 'filament_extruder_variant') for f in filaments]:
            if old in config:
                if not config.get(new) and config[old] != ['standard']:
                    raise ValueError(
                        'This older preset uses flow variants that need a complete export from the selected engine. Standard-flow presets can be migrated here'
                    )
                config.setdefault(new, ['Direct Drive Standard'])
                config.pop(old)
    for width_key in process_settings.LINE_WIDTHS:
        if width_key not in (body.get('options') or {}) and width_key != 'line_width':
            continue
        width = process.get(width_key)
        width = width[0] if isinstance(width, list) and width else width
        if width and not str(width).endswith('%'):
            width = float(width)
            if not 0.5 * min(h['nozzle'] for h in heads) <= width <= 2 * min(h['nozzle'] for h in heads):
                raise ValueError(
                    'Line width must fit the smallest fitted nozzle (50–200% of its bore). Use the installed default or review the width'
                )
    notes = []
    if mixed_review:
        notes.append(
            'Fitted nozzles override this installed U1 variant after your explicit review. Its startup and tool-change macros are preserved. Verify each material, line width and physical head before printing'
        )
    if len(set(h['nozzle'] for h in heads)) > 1:
        # Percentage bridge widths are evaluated against the largest nozzle,
        # but engine validation caps bridges at the smallest fitted nozzle.
        process['bridge_line_width'] = str(min(h['nozzle'] for h in heads))
        notes.append(
            'Bridge line width is limited to the smallest fitted nozzle. Review the material flow limits for every head before printing'
        )
    if body.get('allow_material_variant') is True:
        notes.append(
            'You explicitly allowed U1 material presets listed for another nozzle variant. Their temperature and flow settings still need physical verification'
        )
    height = float(process.get('layer_height') or 0.2)
    mode = body.get('layer_mode', 'shared')
    if mode not in ('shared', 'per_tool'):
        raise ValueError('Choose shared or per-tool layer heights')
    if mode == 'per_tool':
        if not (capabilities or {}).get('per_tool_heights'):
            raise ValueError(
                'This engine has not demonstrated per-tool layer-height options. Check a capable local engine first; stock Orca cannot consume these settings'
            )
        plan = slicing_contract.tool_layers(
            heads,
            process.get('initial_layer_print_height') or height,
            body.get('thick_mode', 'fixed'),
            body.get('thick_tolerance', 80),
        )
        machine['extruder_layer_height'] = [f"{h['height']:g}" for h in heads]
        if (capabilities or {}).get('thick_layer_modes'):
            # Print-process options in engines that list them (read from the
            # engine's own exported schema, never assumed from a version name).
            process['extruder_layer_height_mode'] = plan['thick_mode']
            process['extruder_layer_height_tolerance'] = f"{plan['thick_tolerance']}%"
        elif plan['thick_mode'] != 'fixed' or plan['thick_tolerance'] != 80:
            notes.append(
                'This engine does not list thick-layer region options, so it combines layers its own way. The mode and tolerance you chose are kept with the profile but not sent'
            )
        # This integration accepts only exactly coordinated heights. Never allow
        # an engine to silently round the requested per-head thicknesses.
        if (capabilities or {}).get('exact_tool_heights'):
            machine['extruder_layer_height_exact'] = '1'
        process['layer_height'] = f"{plan['grid']:g}"
        notes.append(plan['note'])
    else:
        machine.pop('extruder_layer_height', None)
        machine.pop('extruder_layer_height_exact', None)
        process.pop('extruder_layer_height_mode', None)
        process.pop('extruder_layer_height_tolerance', None)
        plan = layer_planner.plan([dict(h, height=height) for h in heads])
    if not all(h['ok'] for h in plan['heads']):
        raise ValueError(
            "The layer height is outside one or more nozzle limits. Choose a shared height or use a verified mixed-height engine"
        )
    first = float(process.get('initial_layer_print_height') or height)
    if any(
        not layer_planner.U1_LIMITS[h['nozzle']][0] <= first <= layer_planner.U1_LIMITS[h['nozzle']][1] for h in heads
    ):
        raise ValueError('The first-layer height is outside one or more nozzle limits')
    overrides = body.get('material_options', [{}, {}, {}, {}])
    if not isinstance(overrides, list) or len(overrides) != 4:
        raise ValueError('Provide material settings for T0 to T3')
    for h, f, override in zip(heads, filaments, overrides):
        types = f.get('filament_type') or []
        if types and str(types[0]).upper() != h['material']:
            raise ValueError(f"{h['toolhead']}: the chosen material preset does not match its saved material")
        f['filament_colour'] = [h['color_hex']]
        f['filament_settings_id'] = [f['name']]
        f.update(material_options(override))
    work = Path(_DATA_DIR) / 'slicer-presets' / uuid.uuid4().hex
    work.mkdir(parents=True)
    paths = []
    for name, data in [('machine', machine), ('process', process)] + [
        (f'filament-{i}', f) for i, f in enumerate(filaments)
    ]:
        path = work / (name + '.json')
        storage.save_json(str(path), data)
        paths.append(str(path))
    return {
        'machine': paths[0],
        'process': paths[1],
        'filaments': paths[2:],
        'options': body.get('options') or {},
        'tool_setup': heads,
        'layer_plan': plan,
        'source': 'installed presets',
        'warnings': notes,
        'layer_mode': mode,
        'material_options': overrides,
    }
