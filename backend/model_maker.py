"""Four-tool image tiles, measured layer recipes and closed heightmap reliefs."""

import hashlib
import io
import json
import math
import os
import re
import threading
import uuid
import zipfile

import file_library
import layer_planner
import mock_moonraker
import plate_project
import storage
import tool_setup

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, 'colour_calibration.json')
_lock = threading.RLock()


def number(value, label, lo, hi):
    try:
        n = float(value)
    except (ValueError, TypeError):
        raise ValueError(f'{label} needs a number')
    if not math.isfinite(n) or not lo <= n <= hi:
        raise ValueError(f'{label} must be between {lo} and {hi}')
    return n


def palette():
    heads = tool_setup.get()['heads']
    if len(heads) != 4:
        raise ValueError('Save all four heads in Auto-print → Tools & filaments first')
    return sorted(heads, key=lambda h: h['toolhead'])


def recipes():
    result = [[i] * 4 for i in range(4)]
    for a in range(4):
        for b in range(a + 1, 4):
            result.extend([[a, a, a, b], [a, b, b, b]])
    return result


def signature(heads, height):
    fields = [{k: h.get(k) for k in ('material', 'color_hex', 'spool_id', 'nozzle')} for h in heads]
    return hashlib.sha256(
        json.dumps([mock_moonraker.selected_printer_id(), fields, height], sort_keys=True).encode()
    ).hexdigest()


def process_signature(process, materials):
    ignored = {
        'name',
        'from',
        'type',
        'print_settings_id',
        'filament_settings_id',
        'setting_id',
        'version',
        'description',
        'notes',
    }
    normalized = [{k: v for k, v in config.items() if k not in ignored} for config in [process] + materials]
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def profile_process(profile_id):
    if not profile_id:
        return None
    import slicer_bridge

    profile = next((p for p in slicer_bridge.get_settings()['profiles'] if p['id'] == profile_id), None)
    if not profile:
        raise ValueError('Choose an available slicing profile for colour calibration')
    if profile.get('printer_id') not in (None, mock_moonraker.selected_printer_id()):
        raise ValueError('This calibration profile belongs to another printer')
    if profile.get('tool_setup') and profile['tool_setup'] != palette():
        raise ValueError('Tool preparation changed. Use a profile for the current calibration tools')
    configs = []
    for path in [profile['process']] + profile['filaments']:
        if os.path.getsize(path) > 4 * 1024 * 1024:
            raise ValueError('The calibration preset is too large')
        with open(path, encoding='utf-8') as f:
            configs.append(json.load(f))
    return process_signature(configs[0], configs[1:])


def settings(height=0.2, profile_id=None):
    h = number(height, 'Layer thickness', 0.04, 0.56)
    heads = palette()
    key = signature(heads, h)
    with _lock:
        calibration = storage.load_json(_PATH, {}).get(key)
    state = 'missing'
    if calibration:
        state = 'process_untracked'
        if calibration.get('process_signature'):
            try:
                current = profile_process(profile_id or calibration.get('profile_id'))
            except (ValueError, OSError):
                current = None
            state = 'valid' if current == calibration['process_signature'] else 'process_changed'
            if state != 'valid':
                calibration = None
    return {
        'palette': heads,
        'recipes': [
            {'id': i, 'row': i // 4 + 1, 'column': i % 4 + 1, 'layers': ['T' + str(t) for t in row]}
            for i, row in enumerate(recipes())
        ],
        'layer_height': h,
        'calibration': calibration,
        'calibration_state': state,
        'note': 'Measured recipes apply only to this printer, saved spools, colours, nozzles and layer thickness. Use identical print and material settings for the swatches and image, including temperature and first layer. A screen preview cannot predict a physical print.',
    }


def save_calibration(body):
    h = number(body.get('layer_height', 0.2), 'Layer thickness', 0.04, 0.56)
    heads = palette()
    colours = body.get('colours')
    if (
        not isinstance(colours, list)
        or len(colours) != 16
        or any(not isinstance(c, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', c) for c in colours)
    ):
        raise ValueError('Enter the sixteen measured swatch colours, in row order')
    if body.get('measured') is not True:
        raise ValueError('Confirm these colours came from your printed swatches')
    backing = math.ceil(number(body.get('base', 0.8), 'Backing thickness', 0.4, 5) / h - 1e-9) * h
    process = profile_process(body.get('profile'))
    with _lock:
        data = storage.load_json(_PATH, {})
        if len(data) >= 100 and signature(heads, h) not in data:
            raise ValueError('The calibration library is full')
        data[signature(heads, h)] = {
            'colours': [c.lower() for c in colours],
            'source': 'user-measured',
            'process_signature': process,
            'profile_id': body.get('profile'),
            'backing_mm': backing,
            'layer_order': recipes(),
        }
        storage.save_json(_PATH, data)
    return settings(h)


def linear(rgb):
    return [v / 255 / 12.92 if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4 for v in rgb]


def rgb(hex_colour):
    return [int(hex_colour[k : k + 2], 16) for k in (1, 3, 5)]


def quantize(pixels, w, h, colours, dither=False):
    palette_rgb = [linear(rgb(c)) for c in colours]
    values = [linear(pixels[i : i + 3]) for i in range(0, len(pixels), 3)]
    out = [0] * (w * h)
    weights = [0.2126, 0.7152, 0.0722]
    for y in range(h):
        direction = 1 if y % 2 == 0 else -1
        for x in range(w) if direction == 1 else range(w - 1, -1, -1):
            index = y * w + x
            v = [max(0, min(1, c)) for c in values[index]]
            chosen = min(
                range(len(colours)), key=lambda j: sum(weights[k] * (v[k] - palette_rgb[j][k]) ** 2 for k in range(3))
            )
            out[index] = chosen
            if dither:
                error = [v[k] - palette_rgb[chosen][k] for k in range(3)]
                for dx, dy, weight in [
                    (direction, 0, 7 / 16),
                    (-direction, 1, 3 / 16),
                    (0, 1, 5 / 16),
                    (direction, 1, 1 / 16),
                ]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and ny < h:
                        for k in range(3):
                            values[ny * w + nx][k] += error[k] * weight
    return out


def box(part, x, y, z, w, d, h):
    v = part['vertices']
    n = len(v)
    v.extend(
        [
            (x, y, z),
            (x + w, y, z),
            (x + w, y + d, z),
            (x, y + d, z),
            (x, y, z + h),
            (x + w, y, z + h),
            (x + w, y + d, z + h),
            (x, y + d, z + h),
        ]
    )
    faces = [
        (0, 2, 1),
        (0, 3, 2),
        (4, 5, 6),
        (4, 6, 7),
        (0, 1, 5),
        (0, 5, 4),
        (1, 2, 6),
        (1, 6, 5),
        (2, 3, 7),
        (2, 7, 6),
        (3, 0, 4),
        (3, 4, 7),
    ]
    part['triangles'].extend(tuple(n + i for i in f) for f in faces)


def terrain(pixels, w, h, width, depth, rise, base):
    top = []
    for y in range(h):
        for x in range(w):
            p = linear(pixels[(y * w + x) * 3 : (y * w + x) * 3 + 3])
            lum = sum(a * b for a, b in zip(p, (0.2126, 0.7152, 0.0722)))
            top.append((x * width / (w - 1), y * depth / (h - 1), base + lum * rise))
    n = len(top)
    v = top + [(x, y, 0) for x, y, z in top]
    faces = []
    for y in range(h - 1):
        for x in range(w - 1):
            a = y * w + x
            b = a + 1
            c = a + w
            d = c + 1
            faces.extend([(a, b, d), (a, d, c), (a + n, d + n, b + n), (a + n, c + n, d + n)])
    perimeter = (
        list(range(w))
        + [y * w + w - 1 for y in range(1, h)]
        + [h * w - 1 - x for x in range(1, w)]
        + [y * w for y in range(h - 2, 0, -1)]
    )
    for i, a in enumerate(perimeter):
        b = perimeter[(i + 1) % len(perimeter)]
        faces.extend([(a, a + n, b + n), (a, b + n, b)])
    return {'tool': 0, 'vertices': v, 'triangles': faces}


def build(body):
    mode = body.get('mode', 'mosaic')
    heads = palette()
    height = number(body.get('layer_height', 0.2), 'Layer thickness', 0.04, 0.56)
    for head in heads:
        lo, hi = layer_planner.U1_LIMITS[head['nozzle']]
        if not lo <= height <= hi:
            raise ValueError(f"{head['toolhead']}: choose a layer thickness between {lo} and {hi} mm")
    base = number(body.get('base', 0.8), 'Backing thickness', 0.4, 5)
    base = math.ceil(base / height - 1e-9) * height
    parts = [{'tool': i, 'vertices': [], 'triangles': []} for i in range(4)]
    plan = recipes()
    if mode == 'calibration':
        size, gap = 10, 2
        span = 4 * size + 3 * gap
        box(parts[0], 0, 0, 0, span, span, base)
        for i, layers in enumerate(plan):
            for z, t in enumerate(layers):
                box(
                    parts[t], (i % 4) * (size + gap), (3 - i // 4) * (size + gap), base + z * height, size, size, height
                )
        preview = None
    else:
        w = body.get('pixels_w')
        h = body.get('pixels_h')
        pixels = body.get('pixels')
        if not isinstance(w, int) or not isinstance(h, int) or not 2 <= w <= 96 or not 2 <= h <= 96:
            raise ValueError('Use an image grid between 2 and 96 pixels in each direction')
        if (
            not isinstance(pixels, list)
            or len(pixels) != w * h * 3
            or any(not isinstance(n, int) or not 0 <= n <= 255 for n in pixels)
        ):
            raise ValueError('The image pixels are incomplete or invalid')
        width = number(body.get('width', 80), 'Print width', 5, 240)
        depth = width * h / w
        if depth > 240:
            raise ValueError('The image is too tall for this width. Reduce its print width')
        if mode == 'terrain':
            rise = number(body.get('rise', 15), 'Relief height', 0.2, 80)
            parts = [terrain(pixels, w, h, width, depth, rise, base)]
            preview = None
        elif mode in ('mosaic', 'layered'):
            cell = width / w
            if cell < max(h['nozzle'] for h in heads) * 2:
                raise ValueError(
                    'Image cells are narrower than two nozzle widths. Reduce image detail or increase print width'
                )
            colours = [h['color_hex'] for h in heads]
            if mode == 'layered':
                cal = settings(height, body.get('profile'))['calibration']
                if cal and (abs(cal.get('backing_mm', base) - base) > 1e-6 or cal.get('layer_order', plan) != plan):
                    raise ValueError(
                        'The backing thickness or recipe order changed. Print and measure new calibration swatches'
                    )
                if not cal:
                    raise ValueError(
                        'Print and measure the sixteen swatches first. Layered colours need a calibration for these exact tools and layer thickness'
                    )
                colours = cal['colours']
            indices = quantize(pixels, w, h, colours, body.get('dither') is True)
            box(parts[0], 0, 0, 0, width, depth, base)
            # Adjacent cells with the same recipe merge into one closed strip.
            for y in range(h):
                x = 0
                while x < w:
                    choice = indices[y * w + x]
                    end = x + 1
                    while end < w and indices[y * w + end] == choice:
                        end += 1
                    layers = plan[choice] if mode == 'layered' else [choice, choice]
                    z = 0
                    while z < len(layers):
                        t = layers[z]
                        last = z + 1
                        while last < len(layers) and layers[last] == t:
                            last += 1
                        box(
                            parts[t],
                            x * cell,
                            (h - 1 - y) * cell,
                            base + z * height,
                            (end - x) * cell,
                            cell,
                            (last - z) * height,
                        )
                        z = last
                    x = end
            preview = {
                'width': w,
                'height': h,
                'colours': colours,
                'indices': indices,
                'source': 'measured swatches'
                if mode == 'layered'
                else 'saved filament colours; appearance is not calibrated',
            }
        else:
            raise ValueError('Choose mosaic, layered image, calibration swatches or terrain relief')
    data = plate_project.native(parts, heads, 'Image/heightmap geometry; slice before printing')
    if mode in ('calibration', 'layered', 'mosaic'):
        archive = io.BytesIO(data)
        with zipfile.ZipFile(archive, 'a', zipfile.ZIP_DEFLATED) as z:
            z.writestr(
                'DejaVu/generation.json',
                json.dumps(
                    {
                        'version': 1,
                        'layer_height': height,
                        'initial_layer_print_height': height,
                        'tool_signature': signature(heads, height),
                        'process_signature': cal.get('process_signature')
                        if mode == 'layered'
                        else profile_process(body.get('profile'))
                        if mode == 'calibration'
                        else None,
                    }
                ),
            )
        data = archive.getvalue()
    name = mode + '-' + uuid.uuid4().hex[:10] + '.3mf'
    entry = file_library.save(
        name, data, origin='generated', note='Generated ' + mode + ' model; inspect and slice before printing'
    )
    return {
        'file': entry,
        'preview': preview,
        'note': 'This is model geometry, not G-code. Slice it to obtain real time and filament figures. Colours depend on your filaments: a printed swatch sheet shows the real result.',
    }


def check_slice_contract(data, process, materials=None, preferred_heights=None):
    """Refuse layer boundaries that would change a generated colour recipe."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if 'DejaVu/generation.json' not in z.namelist():
                return
            entry = z.getinfo('DejaVu/generation.json')
            if entry.file_size > 4096:
                raise ValueError('The generated image settings are too large')
            contract = json.loads(z.read(entry))
    except zipfile.BadZipFile:
        return  # Ordinary STL input has no project settings.
    except (TypeError, UnicodeError, json.JSONDecodeError):
        raise ValueError('The generated image settings are damaged')
    if not isinstance(contract, dict):
        raise ValueError('The generated image settings are damaged')
    if (
        contract.get('process_signature')
        and process_signature(process, materials or []) != contract['process_signature']
    ):
        raise ValueError(
            'The print process or material temperatures, flow or cooling changed. Use the calibration profile or print and measure new swatches'
        )
    height = number(contract.get('layer_height'), 'Generated layer thickness', 0.04, 0.56)
    if preferred_heights and any(abs(float(h) - height) > 1e-6 for h in preferred_heights):
        raise ValueError(
            'This generated colour project needs the same layer thickness on every tool. Use a shared-height profile matching its calibration'
        )
    if contract.get('tool_signature') != signature(palette(), height):
        raise ValueError(
            'The printer or saved tools changed since this image was made. Generate it again with the current tools'
        )
    for key in ('layer_height', 'initial_layer_print_height'):
        try:
            match = abs(float(process.get(key)) - height) < 1e-6
        except (TypeError, ValueError):
            match = False
        if not match:
            raise ValueError(
                f'This image needs both layer height and first-layer height set to {height:g} mm. Save a matching slicing profile; use the same print and material settings as its calibration swatches'
            )
