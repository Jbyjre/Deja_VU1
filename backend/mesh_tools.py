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

import io
import math
import re
import struct
import zipfile
import xml.etree.ElementTree as ET

CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD_NS = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
MAX_TRIANGLES = 2_000_000


class MeshError(ValueError):
    """The file isn't a model this reader understands."""


# ---------------------------------------------------------------------------
# STL
# ---------------------------------------------------------------------------

def parse_stl(data):
    """Binary or ASCII STL -> list of triangles ((x,y,z),(x,y,z),(x,y,z))."""
    if len(data) >= 84:
        count = struct.unpack_from("<I", data, 80)[0]
        if 84 + count * 50 == len(data):
            if count > MAX_TRIANGLES:
                raise MeshError("Model has too many triangles to preview")
            tris = []
            for i in range(count):
                v = struct.unpack_from("<12f", data, 84 + i * 50)
                tris.append(((v[3], v[4], v[5]), (v[6], v[7], v[8]), (v[9], v[10], v[11])))
            return tris
    text = data.decode("ascii", errors="ignore")
    if "facet" not in text:
        raise MeshError("Not a readable STL file")
    nums = re.findall(r"vertex\s+(\S+)\s+(\S+)\s+(\S+)", text)
    verts = [(float(a), float(b), float(c)) for a, b, c in nums]
    if len(verts) % 3 or not verts:
        raise MeshError("STL has an incomplete triangle")
    return [tuple(verts[i:i + 3]) for i in range(0, len(verts), 3)]


# ---------------------------------------------------------------------------
# 3MF
# ---------------------------------------------------------------------------

def _matrix(text):
    """3MF transform 'm00 m01 m02 m10 ... m32' -> 4x3 list, or identity."""
    if not text:
        return None
    values = [float(v) for v in text.split()]
    if len(values) != 12:
        return None
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


def parse_3mf(data):
    """3MF bytes -> (triangles, info) with every build item placed."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise MeshError("Not a 3MF file (it isn't a zip archive)")
    names = {n.lower(): n for n in archive.namelist()}
    main = names.get("3d/3dmodel.model")
    if not main:
        raise MeshError("3MF has no 3D/3dmodel.model part")

    parts = {}

    def load(path):
        key = path.lstrip("/").lower()
        if key not in parts:
            if key not in names:
                raise MeshError(f"3MF refers to a missing part: {path}")
            parts[key] = ET.fromstring(archive.read(names[key]))
        return parts[key]

    def objects_in(root):
        res = root.find(f"{{{CORE_NS}}}resources")
        return {o.get("id"): o for o in (res if res is not None else [])
                if o.tag == f"{{{CORE_NS}}}object"}

    triangles = []
    count = [0]

    def emit(part_path, object_id, transform, depth=0):
        if depth > 8:
            raise MeshError("3MF components nest too deeply")
        obj = objects_in(load(part_path)).get(object_id)
        if obj is None:
            raise MeshError(f"3MF object {object_id} is missing")
        mesh = obj.find(f"{{{CORE_NS}}}mesh")
        if mesh is not None:
            verts = [(float(v.get("x")), float(v.get("y")), float(v.get("z")))
                     for v in mesh.find(f"{{{CORE_NS}}}vertices")]
            for t in mesh.find(f"{{{CORE_NS}}}triangles"):
                count[0] += 1
                if count[0] > MAX_TRIANGLES:
                    raise MeshError("Model has too many triangles to preview")
                triangles.append(tuple(_apply(transform, verts[int(t.get(k))])
                                       for k in ("v1", "v2", "v3")))
        comps = obj.find(f"{{{CORE_NS}}}components")
        if comps is not None:
            for c in comps:
                path = c.get(f"{{{PROD_NS}}}path") or part_path
                emit(path, c.get("objectid"),
                     _compose(_matrix(c.get("transform")), transform), depth + 1)

    root = load(main)
    metadata = {m.get("name"): (m.text or "") for m in root.findall(f"{{{CORE_NS}}}metadata")}
    build = root.find(f"{{{CORE_NS}}}build")
    items = list(build) if build is not None else []
    if not items:
        items = [ET.Element("item", objectid=oid) for oid in objects_in(root)]
    for item in items:
        emit(main, item.get("objectid"), _matrix(item.get("transform")))
    info = {"application": metadata.get("Application", ""), "title": metadata.get("Title", ""),
            "objects": len(items), "parts": sorted(names.values())}
    return triangles, info


def parse_model(data, filename):
    lower = filename.lower()
    if lower.endswith(".stl"):
        return parse_stl(data), {"objects": 1}
    if lower.endswith(".3mf"):
        return parse_3mf(data)
    raise MeshError("Only STL and 3MF models can be read")


# ---------------------------------------------------------------------------
# Size and a preview thumbnail
# ---------------------------------------------------------------------------

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
