"""
mesh_tools.py
=============

Reads the two model formats 3D printing uses - STL and 3MF - into plain
triangles, using only the standard library (struct for binary STL, zipfile
and xml.etree for 3MF). The browser has its own copy of the same parser for
the interactive 3D viewer; this one exists so the server can size a model
and draw a small preview thumbnail for the file library without a browser.

3MF is a zip. Its main part, 3D/3dmodel.model, lists objects as vertices and
triangles, and a build list of which objects to place and where. Slicers in
the Bambu Studio / Orca family (Snapmaker Orca included) store each object
in its own 3D/Objects/*.model part and reference it through a <component>,
so components are followed across parts, with their transforms.
"""

import math
import re
import struct
from array import array
from xml.parsers import expat

import safe_zip

CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD_NS = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
MAX_TRIANGLES = 2_000_000


class MeshError(ValueError):
    """The file isn't a model this reader understands."""


# ---------------------------------------------------------------------------
# STL
# ---------------------------------------------------------------------------

def _finite(v):
    return all(math.isfinite(c) for c in v)


def iter_stl(data):
    """
    Binary or ASCII STL, one triangle at a time - so a large model is never
    held whole as Python objects. Refuses what can't be printed or read:
    a cut-short file, coordinates that aren't numbers.
    """
    view = memoryview(data)
    if len(data) >= 84:
        count = struct.unpack_from("<I", data, 80)[0]
        expected = 84 + count * 50
        looks_ascii = data[:5].lower() == b"solid" and b"facet" in data[:2048]
        if not looks_ascii and expected <= len(data) <= expected + 1024:
            if count > MAX_TRIANGLES:
                raise MeshError(f"The model has {count:,} triangles - more than the {MAX_TRIANGLES:,} this "
                                "dashboard reads")

            def binary():
                for v in struct.iter_unpack("<12fH", view[84:expected]):
                    if not _finite(v[3:12]):
                        raise MeshError("The STL has a coordinate that isn't a number")
                    yield ((v[3], v[4], v[5]), (v[6], v[7], v[8]), (v[9], v[10], v[11]))
            return binary()
        if not looks_ascii and 84 < len(data) < expected and count < 50_000_000:
            raise MeshError(f"The STL is cut short: it says {count:,} triangles but holds "
                            f"{(len(data) - 84) // 50:,} - the upload may not have finished")
    head = bytes(view[:4096]).decode("ascii", errors="ignore").lower()
    if "facet" not in head and "solid" not in head:
        raise MeshError("Not a readable STL file")

    def ascii_stl():
        pending, n = [], 0
        for m in _ASCII_VERTEX.finditer(data):
            try:
                v = (float(m.group(1)), float(m.group(2)), float(m.group(3)))
            except ValueError:
                raise MeshError("The STL has a vertex that isn't three numbers")
            if not _finite(v):
                raise MeshError("The STL has a coordinate that isn't a number")
            pending.append(v)
            if len(pending) == 3:
                n += 1
                if n > MAX_TRIANGLES:
                    raise MeshError(f"The model has more than {MAX_TRIANGLES:,} triangles")
                yield tuple(pending)
                pending = []
        if pending:
            raise MeshError("STL has an incomplete triangle")
        if not n:
            raise MeshError("Not a readable STL file")
    return ascii_stl()


_ASCII_VERTEX = re.compile(rb"vertex\s+(\S+)\s+(\S+)\s+(\S+)", re.IGNORECASE)


def parse_stl(data):
    """Binary or ASCII STL -> list of triangles ((x,y,z),(x,y,z),(x,y,z))."""
    return list(iter_stl(data))


# ---------------------------------------------------------------------------
# 3MF
# ---------------------------------------------------------------------------

def _matrix(text):
    """3MF transform 'm00 m01 m02 m10 ... m32' -> 4x3 list, or identity."""
    if not text:
        return None
    try:
        values = [float(v) for v in text.split()]
    except ValueError:
        raise MeshError("A 3MF transform isn't a list of numbers")
    if len(values) != 12:
        return None
    if not _finite(values):
        raise MeshError("A 3MF transform has a value that isn't a number")
    return values


def _apply(m, p):
    if m is None:
        return p
    x, y, z = p
    return (x * m[0] + y * m[3] + z * m[6] + m[9],
            x * m[1] + y * m[4] + z * m[7] + m[10],
            x * m[2] + y * m[5] + z * m[8] + m[11])


def _compose(a, b):
    """Transform `a` then `b` (both 4x3 row-vector matrices)."""
    if a is None:
        return b
    if b is None:
        return a
    out = []
    for r in range(4):
        row = a[r * 3:r * 3 + 3]
        w = 1.0 if r == 3 else 0.0
        for c in range(3):
            out.append(row[0] * b[c] + row[1] * b[3 + c] + row[2] * b[6 + c] + w * b[9 + c])
    return out


_CORE = CORE_NS + "}"
_PROD_PATH = PROD_NS + "}path"


def _read_model_part(stream, part_name):
    """
    One 3MF model part, read with expat callbacks as it streams out of the
    archive - no document tree is built. Vertices and triangle corners go
    into compact arrays (8 and 4 bytes a number), which is what lets a
    large model be read on a Raspberry Pi. Expat also refuses XML entity
    expansion attacks by itself.
    """
    objects, build, metadata = {}, [], {}
    state = {"obj": None, "in_build": False, "meta": None, "text": [], "vertices": 0}

    def start(name, attrs):
        if not name.startswith(_CORE):
            return
        tag = name[len(_CORE):]
        obj = state["obj"]
        try:
            if tag == "vertex" and obj is not None:
                state["vertices"] += 1
                if state["vertices"] > 3 * MAX_TRIANGLES:
                    raise MeshError("The model has too many vertices")
                v = (float(attrs["x"]), float(attrs["y"]), float(attrs["z"]))
                if not _finite(v):
                    raise MeshError("The 3MF has a vertex coordinate that isn't a number")
                obj["verts"].extend(v)
            elif tag == "triangle" and obj is not None:
                obj["tris"].extend((int(attrs["v1"]), int(attrs["v2"]), int(attrs["v3"])))
            elif tag == "object":
                state["obj"] = {"verts": array("d"), "tris": array("l"), "components": []}
                objects[attrs.get("id")] = state["obj"]
            elif tag == "component" and obj is not None:
                obj["components"].append((attrs.get(_PROD_PATH), attrs.get("objectid"), attrs.get("transform")))
            elif tag == "build":
                state["in_build"] = True
            elif tag == "item" and state["in_build"]:
                build.append((attrs.get("objectid"), attrs.get("transform")))
            elif tag == "metadata":
                state["meta"], state["text"] = attrs.get("name"), []
        except (KeyError, ValueError, OverflowError) as exc:
            if isinstance(exc, MeshError):
                raise
            raise MeshError(f"A 3MF {tag} in {part_name} is missing a value or has one that isn't a number")

    def end(name):
        if not name.startswith(_CORE):
            return
        tag = name[len(_CORE):]
        if tag == "object":
            state["obj"] = None
        elif tag == "build":
            state["in_build"] = False
        elif tag == "metadata" and state["meta"] is not None:
            metadata[state["meta"]] = "".join(state["text"])[:500]
            state["meta"] = None

    def text(data):
        if state["meta"] is not None and sum(len(t) for t in state["text"]) < 500:
            state["text"].append(data)

    parser = expat.ParserCreate(namespace_separator="}")
    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = start, end, text
    try:
        parser.ParseFile(stream)
    except expat.ExpatError as exc:
        raise MeshError(f"The 3MF's {part_name} isn't valid XML ({exc})")
    return objects, build, metadata


def iter_3mf(data):
    """3MF bytes -> (triangle iterator, info), every build item placed."""
    try:
        archive = safe_zip.open_archive(data, "3MF file")
    except safe_zip.DamagedArchive as exc:
        raise MeshError(str(exc))
    names = {n.lower(): n for n in archive.namelist()}
    main = names.get("3d/3dmodel.model")
    if not main:
        raise MeshError("3MF has no 3D/3dmodel.model part")
    parts = {}

    def load(path):
        key = (path or "").lstrip("/").lower()
        if key not in parts:
            if key not in names:
                raise MeshError(f"3MF refers to a missing part: {path}")
            try:
                with safe_zip.open_part(archive, names[key], what="3MF file") as stream:
                    parts[key] = _read_model_part(stream, names[key])
            except safe_zip.DamagedArchive as exc:
                raise MeshError(str(exc))
        return parts[key]

    objects, build, metadata = load(main)
    items = build or [(oid, None) for oid in objects]
    count = [0]

    def emit(part_path, object_id, transform, depth=0):
        if depth > 8:
            raise MeshError("3MF components nest too deeply")
        obj = load(part_path)[0].get(object_id)
        if obj is None:
            raise MeshError(f"3MF object {object_id} is missing")
        verts, tris = obj["verts"], obj["tris"]
        n_verts = len(verts) // 3
        for i in range(0, len(tris) - 2, 3):
            count[0] += 1
            if count[0] > MAX_TRIANGLES:
                raise MeshError(f"The model has more than {MAX_TRIANGLES:,} triangles")
            corners = []
            for k in (tris[i], tris[i + 1], tris[i + 2]):
                if not 0 <= k < n_verts:
                    raise MeshError(f"A 3MF triangle refers to vertex {k}, which doesn't exist")
                corners.append(_apply(transform, (verts[3 * k], verts[3 * k + 1], verts[3 * k + 2])))
            yield tuple(corners)
        for path, child, child_transform in obj["components"]:
            yield from emit(path or part_path, child, _compose(_matrix(child_transform), transform), depth + 1)

    def all_triangles():
        for object_id, item_transform in items:
            yield from emit(main, object_id, _matrix(item_transform))

    info = {"application": metadata.get("Application", ""), "title": metadata.get("Title", ""),
            "objects": len(items), "parts": sorted(names.values())}
    return all_triangles(), info


def parse_3mf(data):
    """3MF bytes -> (triangles, info) with every build item placed."""
    triangles, info = iter_3mf(data)
    return list(triangles), info


def iter_model(data, filename):
    lower = filename.lower()
    if lower.endswith(".stl"):
        return iter_stl(data), {"objects": 1}
    if lower.endswith(".3mf"):
        return iter_3mf(data)
    raise MeshError("Only STL and 3MF models can be read")


def parse_model(data, filename):
    triangles, info = iter_model(data, filename)
    return list(triangles), info


def summarize(data, filename, keep=120_000):
    """
    Count, exact bounds, and an even sample of at most `keep` triangles for
    the thumbnail - in one streaming pass, so memory stays small however
    large the model is.
    """
    triangles, info = iter_model(data, filename)
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    sample, stride, n = [], 1, 0
    for tri in triangles:
        for p in tri:
            for i in range(3):
                if p[i] < lo[i]:
                    lo[i] = p[i]
                if p[i] > hi[i]:
                    hi[i] = p[i]
        if n % stride == 0:
            sample.append(tri)
            if len(sample) >= 2 * keep:
                sample = sample[::2]
                stride *= 2
        n += 1
    box = None
    if n:
        box = {"min": lo, "max": hi, "size": [round(hi[i] - lo[i], 2) for i in range(3)]}
    return {"count": n, "bounds": box, "sample": sample, "info": info}


def bounds(triangles):
    if not triangles:
        return None
    xs = [p[0] for t in triangles for p in t]
    ys = [p[1] for t in triangles for p in t]
    zs = [p[2] for t in triangles for p in t]
    return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)],
            "size": [round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2),
                     round(max(zs) - min(zs), 2)]}


def png_thumbnail(triangles, size=160, color=(255, 122, 47)):
    """
    A small isometric, flat-shaded PNG of the model, drawn by a tiny
    software rasterizer with a depth buffer: every triangle is projected,
    filled pixel by pixel, and kept only where it is nearer than what is
    already drawn. Shading is how directly each face points at a fixed
    light. Output is a standard PNG (zlib + struct), so no image library.
    """
    if not triangles:
        return None
    b = bounds(triangles)
    cx = (b["min"][0] + b["max"][0]) / 2
    cy = (b["min"][1] + b["max"][1]) / 2
    cz = (b["min"][2] + b["max"][2]) / 2
    yaw, pitch = math.radians(-35), math.radians(30)
    cyw, syw, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)

    def project(p):
        x, y, z = p[0] - cx, p[1] - cy, p[2] - cz
        x, y = x * cyw - y * syw, x * syw + y * cyw
        return x, z * cp - y * sp, y * cp + z * sp     # screen x, screen up, depth

    projected = [tuple(project(p) for p in t) for t in triangles]
    xs = [p[0] for t in projected for p in t]
    ys = [p[1] for t in projected for p in t]
    span = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
    scale = (size * 0.86) / span
    ox = size / 2 - (min(xs) + max(xs)) / 2 * scale
    oy = size / 2 + (min(ys) + max(ys)) / 2 * scale

    depth = [math.inf] * (size * size)
    pixels = bytearray(size * size * 4)          # transparent background
    light = (0.35, -0.55, 0.76)
    for tri in projected:
        (ax, ay, az), (bx, by, bz), (qx, qy, qz) = tri
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = qx - ax, qy - ay, qz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if not length:
            continue
        shade = 0.3 + 0.7 * abs((nx * light[0] + ny * light[1] + nz * light[2]) / length)
        r, g, bl = (int(ch * shade) for ch in color)
        p0 = (ox + ax * scale, oy - ay * scale, az)
        p1 = (ox + bx * scale, oy - by * scale, bz)
        p2 = (ox + qx * scale, oy - qy * scale, qz)
        area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
        if abs(area) < 1e-9:
            continue
        x0 = max(0, int(min(p0[0], p1[0], p2[0])))
        x1 = min(size - 1, int(max(p0[0], p1[0], p2[0])) + 1)
        y0 = max(0, int(min(p0[1], p1[1], p2[1])))
        y1 = min(size - 1, int(max(p0[1], p1[1], p2[1])) + 1)
        for py in range(y0, y1 + 1):
            sy = py + 0.5
            for px in range(x0, x1 + 1):
                sx = px + 0.5
                w0 = ((p1[0] - sx) * (p2[1] - sy) - (p1[1] - sy) * (p2[0] - sx)) / area
                w1 = ((p2[0] - sx) * (p0[1] - sy) - (p2[1] - sy) * (p0[0] - sx)) / area
                w2 = 1.0 - w0 - w1
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                d = w0 * p0[2] + w1 * p1[2] + w2 * p2[2]
                i = py * size + px
                if d < depth[i]:
                    depth[i] = d
                    pixels[i * 4:i * 4 + 4] = bytes((r, g, bl, 255))
    return encode_png(size, size, bytes(pixels))


def encode_png(width, height, rgba):
    """Minimal RGBA PNG encoder (signature, IHDR, one IDAT, IEND)."""
    import zlib

    def chunk(kind, body):
        return (struct.pack(">I", len(body)) + kind + body +
                struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

    rows = b"".join(b"\x00" + rgba[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def to_binary_stl(triangles, name="Deja Vu1"):
    """Encode triangles as a binary STL (used to build the sample files)."""
    header = name.encode("ascii", "ignore")[:80].ljust(80, b" ")
    body = [header, struct.pack("<I", len(triangles))]
    for t in triangles:
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = t
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        body.append(struct.pack("<12fH", nx / length, ny / length, nz / length,
                                ax, ay, az, bx, by, bz, cx, cy, cz, 0))
    return b"".join(body)
