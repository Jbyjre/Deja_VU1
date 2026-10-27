"""Conservative, independently computed contracts for an external slicing engine."""

import math
import re
from collections import Counter

import layer_planner


THICK_MODES = ('consistent', 'adaptive', 'fixed')


def thick_layer_settings(mode='fixed', tolerance=80):
    """
    How a head with a thicker preferred height combines layers where a part's
    outline changes: consistent (two heights at most, most uniform walls),
    adaptive (also intermediate multiples) or fixed (always the preferred
    height; curved edges become steps). Tolerance is how far an outline may
    drift sideways across one thick run, as a percentage of that head's nozzle.
    """
    mode = str(mode or 'fixed').strip().lower()
    if mode not in THICK_MODES:
        raise ValueError('Choose consistent, adaptive or fixed thick-layer regions')
    try:
        tolerance = float(tolerance)
    except (TypeError, ValueError):
        raise ValueError('Thick-layer tolerance must be a number from 0 to 100')
    if not math.isfinite(tolerance) or not 0 <= tolerance <= 100:
        raise ValueError('Thick-layer tolerance must be a number from 0 to 100')
    return {'thick_mode': mode, 'thick_tolerance': round(tolerance)}


def tool_layers(heads, first_height, mode='fixed', tolerance=80):
    """
    Accept exact 0.005 mm heights on a grid every fitted head can print. The
    grid is the base (object) layer: every head prints a whole number of base
    layers at once, so a 0.6 mm head at three times the base prints one thick
    layer for every three thin ones.
    """
    thick = thick_layer_settings(mode, tolerance)
    if len(heads) != 4 or [h['toolhead'] for h in heads] != ['T0', 'T1', 'T2', 'T3']:
        raise ValueError('Save all four physical heads T0 to T3 first')
    ticks = []
    for h in heads:
        height = float(h['height'])
        lo, hi = layer_planner.U1_LIMITS[h['nozzle']]
        if not math.isfinite(height) or not lo <= height <= hi:
            raise ValueError(f"{h['toolhead']}: preferred height must be {lo:g}–{hi:g} mm for this nozzle")
        tick = round(height * 200)
        if abs(tick / 200 - height) > 1e-7:
            raise ValueError('Preferred heights must be multiples of 0.005 mm')
        ticks.append(tick)
    divisor = ticks[0]
    for t in ticks[1:]:
        divisor = math.gcd(divisor, t)
    grid = divisor / 200
    minimum = max(layer_planner.U1_LIMITS[h['nozzle']][0] for h in heads)
    if grid < minimum - 1e-7:
        raise ValueError(
            f'These heights require a {grid:g} mm coordination grid, below a fitted nozzle’s minimum of {minimum:g} mm. Choose heights with a larger common step; purge and fallback paths also use that step'
        )
    first = float(first_height)
    if not math.isfinite(first) or any(
        not layer_planner.U1_LIMITS[h['nozzle']][0] <= first <= layer_planner.U1_LIMITS[h['nozzle']][1] for h in heads
    ):
        raise ValueError('The first-layer height is outside one or more nozzle limits')
    return {
        'grid': grid,
        'first_layer': first,
        'mode': 'per_tool',
        **thick,
        'heads': [dict(h, every=t // divisor, ok=True) for h, t in zip(heads, ticks)],
        'note': 'Preferred heights combine paths where geometry permits. First layers, shared surfaces, supports and purge may use finer paths. Inspect the actual output before printing.',
    }


def deposition_evidence(text):
    """Count actual XY extrusion levels per tool; exclude retraction recovery."""
    tool, absolute, extr_absolute = 0, True, True
    xyz, e, debt = [0.0, 0.0, 0.0], {}, {}
    levels, declared, samples = {}, {}, {}
    feature, height, width = '', None, None
    model_features = {
        'outer wall',
        'inner wall',
        'sparse infill',
        'internal solid infill',
        'solid infill',
        'top surface',
        'bottom surface',
        'bridge',
        'internal bridge',
        'overhang wall',
        'gap infill',
    }
    moves = {}
    object_comments = bool(re.search(r'^\s*; printing object ', text, re.M))
    object_active = False
    for raw in text.splitlines():
        comment = raw.strip()
        if comment.startswith('; printing object '):
            object_active = True
        elif comment.startswith('; stop printing object '):
            object_active = False
        if comment.startswith(';TYPE:') or comment.startswith('; FEATURE:'):
            feature = comment.split(':', 1)[1].strip().lower()
        if comment.startswith(';HEIGHT:') or comment.startswith('; HEIGHT:'):
            try:
                height = float(comment.split(':', 1)[1])
            except ValueError:
                height = None
        if comment.startswith(';WIDTH:') or comment.startswith('; WIDTH:'):
            try:
                width = float(comment.split(':', 1)[1])
            except ValueError:
                width = None
        line = raw.split(';', 1)[0].strip().upper()
        if re.fullmatch(r'T[0-3]', line):
            tool = int(line[1])
            continue
        fields = re.findall(r'([A-Z])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))', line)
        if not fields:
            continue
        command = fields[0][0] + str(int(float(fields[0][1])))
        args = {k: float(v) for k, v in fields[1:]}
        if command == 'G90':
            absolute = True
        elif command == 'G91':
            absolute = False
        elif command == 'M82':
            extr_absolute = True
        elif command == 'M83':
            extr_absolute = False
        elif command == 'G92':
            if 'E' in args:
                e[tool] = args['E']
            for i, k in enumerate('XYZ'):
                if k in args:
                    xyz[i] = args[k]
        elif command in ('G0', 'G1'):
            dest = [args.get(k, xyz[i]) if absolute else xyz[i] + args.get(k, 0.0) for i, k in enumerate('XYZ')]
            delta = args.get('E', e.get(tool, 0.0)) - e.get(tool, 0.0) if extr_absolute else args.get('E', 0.0)
            if 'E' in args:
                e[tool] = args['E'] if extr_absolute else e.get(tool, 0.0) + args['E']
            if delta < 0:
                debt[tool] = debt.get(tool, 0.0) - delta
            recovered = min(max(delta, 0.0), debt.get(tool, 0.0))
            debt[tool] = debt.get(tool, 0.0) - recovered
            if delta - recovered > 1e-7 and math.hypot(dest[0] - xyz[0], dest[1] - xyz[1]) > 1e-7:
                # Restrict this evidence to the model envelope; startup outside it is still
                # checked by the full pre-flight analyser and never granted an allowance.
                if (
                    all(0 <= v <= 270 for v in dest)
                    and feature in model_features
                    and (not object_comments or object_active)
                ):
                    levels.setdefault(tool, set()).add(round(dest[2], 5))
                    moves[tool] = moves.get(tool, 0) + 1
                    if height is not None and math.isfinite(height):
                        declared.setdefault(tool, set()).add(round(height, 5))
                    distance = math.hypot(dest[0] - xyz[0], dest[1] - xyz[1])
                    if feature == 'outer wall' and distance >= 3 and height and width and abs(dest[2] - xyz[2]) < 1e-6:
                        samples.setdefault(tool, {})
                        if height not in samples[tool] and len(samples[tool]) < 8:
                            samples[tool][height] = {
                                'z_mm': round(dest[2], 5),
                                'declared_height_mm': height,
                                'declared_width_mm': width,
                                'xy_mm': round(distance, 6),
                                'filament_mm': round(delta - recovered, 6),
                            }
            xyz = dest
    return {
        'source': 'Labelled model-feature XY extrusion coordinates; startup, purge, travel and retraction recovery excluded',
        'tools': [
            {
                'toolhead': f'T{t}',
                'extrusion_moves': moves[t],
                'deposition_levels': len(zs),
                'z_steps_mm': dict(
                    sorted(Counter(round(b - a, 5) for a, b in zip(sorted(zs), sorted(zs)[1:])).items())
                ),
                'path_heights_mm': sorted(declared.get(t, set())),
                'outer_wall_samples': list(samples.get(t, {}).values()),
            }
            for t, zs in sorted(levels.items())
        ],
        'note': 'Z steps are file-derived evidence, not a guarantee of thickness on every feature or a physical measurement. Path heights are engine declarations.',
    }
