# Sample the rig into a point cloud and render it the way the site does.
#
#   blender --background --python scripts/blender/render-points.py -- \
#       <in.blend|in.glb> <out_dir> <tag> [pose]
#
# WHY THIS EXISTS, AND WHY IT DOES ITS OWN RASTERISING.
#
# A rig that poses beautifully as a shaded mesh and samples into mush is not an
# improvement, because the site never draws this animal as a surface. It draws
# 30 000 points, and it draws them SMALL: DOG_H is 0.735 m, DOG_POS is 8.6 m
# from a 38-degree camera, so the retriever stands about 110 pixels tall on a
# 900-pixel frame. Every verdict about a seam at the withers has to be formed at
# that size, not on a 900-pixel closeup where the mesh fills the frame.
#
# So this reimplements apps/web/components/rink/home/dog.ts — area-weighted
# samples on the posed triangles, pulled in on a pow(rand,1.6) shell, shaded as
# a backlit animal against the same SUN_DIR / SUN_COL / uSky / uCoat / uCream —
# and rasterises them into an image with a z-buffer, so near points occlude far
# ones exactly as depthWrite ON does in the browser. Nothing here is loaded by
# the site; this is a measuring instrument.
#
# The two traps from the house rules are both live in this file:
#   - the cloud is a closed surface, so points facing AWAY are on the lit side
#     and shine through every gap. They are culled.
#   - a soft sprite fringe still writes depth and carves dark veins through the
#     mass. The fringe is discarded, not drawn, at the same 0.34 threshold the
#     shader uses.

import math
import os
import struct
import sys

import bpy
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

# ---- the site's own numbers, from home/constants.ts and home/dog.ts --------
DOG_H = 0.735
DOG_N = 30000
SUN_AZ, SUN_EL = 0.045, math.radians(3.35)
SUN_DIR = Vector((math.sin(SUN_AZ) * math.cos(SUN_EL),
                  math.sin(SUN_EL),
                  -math.cos(SUN_AZ) * math.cos(SUN_EL))).normalized()
SUN_COL = Vector((1.0, 0.6, 0.222))
SKY = Vector((0.185, 0.235, 0.335))
COAT = Vector((0.86, 0.505, 0.185))
CREAM = Vector((0.97, 0.80, 0.545))
SHELL = DOG_H * 0.052
U_SIZE = 0.0245
EXPOSURE = 1.24


def log(m):
    print(f"[pts] {m}", flush=True)


def mulberry32(seed):
    s = [seed & 0xFFFFFFFF]

    def rnd():
        s[0] = (s[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = s[0]
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return rnd


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return max(0.0, min(1.0, (x * (a * x + b)) / (x * (c * x + d) + e)))


def median_frame(ws):
    floor = min(p.z for p in ws)
    H = max(p.z for p in ws) - floor
    kd = KDTree(len(ws))
    for i, p in enumerate(ws):
        kd.insert(p, i)
    kd.balance()
    S = ws[::max(1, len(ws) // 1000)]

    def cost(th, c):
        lat = Vector((-math.sin(th), math.cos(th), 0.0))
        return sum(kd.find(p - lat * (2.0 * (p.dot(lat) - c)))[2] for p in S) / len(S)

    best = None
    for k in range(72):
        th = math.pi * k / 72.0
        lat = Vector((-math.sin(th), math.cos(th), 0.0))
        ls = sorted(p.dot(lat) for p in ws)
        v = cost(th, ls[len(ls) // 2])
        if best is None or v < best[0]:
            best = (v, th, ls[len(ls) // 2])
    _e, th, _c = best
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    lat = Vector((-math.sin(th), math.cos(th), 0.0))
    aa = [p.dot(fwd) for p in ws]
    if max(ws, key=lambda p: p.z).dot(fwd) < 0.5 * (min(aa) + max(aa)):
        fwd, lat = -fwd, -lat
    return fwd, lat


def sample(verts, tris, n, seed=1337):
    """dog.ts's sampler: area-weighted barycentric points on the posed
    triangles, pulled inward on a pow(rand,1.6) shell so the mass has a near
    and a far side."""
    area, cum, tot = [], [], 0.0
    vn = [Vector((0.0, 0.0, 0.0)) for _ in verts]
    for (a, b, c) in tris:
        u = verts[b] - verts[a]
        v = verts[c] - verts[a]
        nv = u.cross(v)
        ar = nv.length * 0.5
        area.append(ar)
        tot += ar
        cum.append(tot)
        vn[a] += nv
        vn[b] += nv
        vn[c] += nv
    for i in range(len(vn)):
        if vn[i].length > 1e-12:
            vn[i].normalize()

    def pick(u):
        lo, hi, x = 0, len(cum) - 1, u * tot
        while lo < hi:
            m = (lo + hi) // 2
            if cum[m] < x:
                lo = m + 1
            else:
                hi = m
        return lo

    rnd = mulberry32(seed)
    out = []
    for _ in range(n):
        t = pick(rnd())
        u, v = rnd(), rnd()
        if u + v > 1.0:
            u, v = 1.0 - u, 1.0 - v
        w = 1.0 - u - v
        a, b, c = tris[t]
        p = verts[a] * w + verts[b] * u + verts[c] * v
        nrm = vn[a] * w + vn[b] * u + vn[c] * v
        if nrm.length < 1e-9:
            continue
        nrm.normalize()
        shellT = math.pow(rnd(), 1.6)
        out.append((p - nrm * (shellT * SHELL), nrm, 1.0 - shellT))
    return out


def render(points, W, H, out_path, zoom=1.0):
    """Perspective camera at the site's own framing, z-buffered, back faces
    culled, sprite fringe discarded."""
    # The site's own geometry: a 38-degree camera with its eye 1.62 m up, the
    # animal 8.63 m away with his feet on the ice. That is what makes him about
    # 110 px tall on a 900 px frame, and it is the size every judgement here has
    # to be made at. `zoom` closes the distance while holding the elevation
    # angle, so a closeup is the same view, nearer.
    fov = math.radians(38.0)
    ctr = Vector((0.0, DOG_H * 0.5, 0.0))
    dist = 8.63 / zoom
    eye = Vector((0.0, ctr.y + (1.62 - ctr.y) / zoom, dist))
    zc = (eye - ctr).normalized()
    xc = Vector((0.0, 1.0, 0.0)).cross(zc).normalized()
    yc = zc.cross(xc)
    f = 1.0 / math.tan(fov * 0.5)
    aspect = W / H

    zbuf = [1e30] * (W * H)
    col = [0.0] * (W * H * 3)
    drawn = culled = 0
    cam = eye
    for (p, n, rim) in points:
        v = p - cam
        vx, vy, vz = v.dot(xc), v.dot(yc), v.dot(zc)
        if vz > -0.05:
            continue
        # BACK-FACING POINTS ARE ON THE LIT SIDE and shine through every gap in
        # the near surface. This is the confetti that plagued the retriever.
        view = (cam - p).normalized()
        if n.dot(view) <= 0.0:
            culled += 1
            continue
        sx = (vx / -vz) * f / aspect
        sy = (vy / -vz) * f
        px = (sx * 0.5 + 0.5) * W
        py = (1.0 - (sy * 0.5 + 0.5)) * H
        size = U_SIZE / max(0.4, -vz) * H
        r = max(0.6, size * 0.5)
        if px < -r or px > W + r or py < -r or py > H + r:
            continue

        # --- shading, straight out of DOG_FRAG -------------------------------
        L = SUN_DIR
        lam = max(0.0, n.dot(L))
        wrap = max(0.0, n.dot(L) * 0.5 + 0.5)
        rimv = math.pow(1.0 - abs(n.dot(view)), 2.1)
        back = math.pow(max(0.0, (-view).dot(L)), 1.6)
        under = max(0.0, min(1.0, (0.60 - p.y / DOG_H) * 2.1))
        creamv = max(0.0, min(1.0, under * (0.45 - 0.55 * n.y) * 1.35))
        coat = COAT.lerp(CREAM, creamv * 0.75)
        c = Vector((coat.x * (SKY.x * (0.30 + 0.70 * wrap) + SUN_COL.x * lam * 0.34),
                    coat.y * (SKY.y * (0.30 + 0.70 * wrap) + SUN_COL.y * lam * 0.34),
                    coat.z * (SKY.z * (0.30 + 0.70 * wrap) + SUN_COL.z * lam * 0.34)))
        k = rimv * (0.42 + 0.95 * back) * 0.92 * (0.45 + 0.55 * rim)
        c += SUN_COL * k
        c += Vector((coat.x * SUN_COL.x, coat.y * SUN_COL.y,
                     coat.z * SUN_COL.z)) * 0.20 * back

        x0, x1 = int(px - r), int(px + r) + 1
        y0, y1 = int(py - r), int(py + r) + 1
        for yy in range(max(0, y0), min(H, y1)):
            for xx in range(max(0, x0), min(W, x1)):
                dx = (xx + 0.5 - px) / (2.0 * r)
                dy = (yy + 0.5 - py) / (2.0 * r)
                r2 = dx * dx + dy * dy
                if r2 > 0.25:
                    continue
                # A soft fringe still WRITES DEPTH and carves dark veins right
                # through the mass; discard it rather than draw it.
                soft = 0.0 if r2 >= 0.25 else min(
                    1.0, max(0.0, (0.25 - r2) / (0.25 - 0.080)))
                soft = soft * soft * (3.0 - 2.0 * soft)
                if soft < 0.34:
                    continue
                i = yy * W + xx
                if -vz >= zbuf[i]:
                    continue
                zbuf[i] = -vz
                col[i * 3] = c.x
                col[i * 3 + 1] = c.y
                col[i * 3 + 2] = c.z
        drawn += 1
    log(f"  {drawn} points drawn, {culled} back-facing culled")

    img = bpy.data.images.new(os.path.basename(out_path), W, H, alpha=False)
    px_out = [0.0] * (W * H * 4)
    for i in range(W * H):
        for ch in range(3):
            px_out[i * 4 + ch] = aces(col[i * 3 + ch] * EXPOSURE)
        px_out[i * 4 + 3] = 1.0
    # blender images are bottom-up
    flipped = [0.0] * (W * H * 4)
    for y in range(H):
        src = (H - 1 - y) * W * 4
        flipped[y * W * 4:(y + 1) * W * 4] = px_out[src:src + W * 4]
    img.pixels = flipped
    img.filepath_raw = out_path
    img.file_format = "PNG"
    img.save()
    log(f"  wrote {out_path}")


POSES = {
    "rest": [],
    "look-up": [("neck", "lat", -14), ("head", "lat", -22), ("jaw", "lat", -5),
                ("ear.L", "lat", -8), ("ear.R", "lat", -8)],
    "sniff": [("chest", "lat", 6), ("neck", "lat", 26), ("head", "lat", 22),
              ("jaw", "lat", 5), ("ear.L", "lat", 12), ("ear.R", "lat", 12)],
    "sit": [("hips", "lat", -10), ("spine.01", "lat", -7),
            ("spine.02", "lat", -5), ("chest", "lat", -3),
            ("neck", "lat", 16), ("head", "lat", 9),
            ("front_upper.L", "lat", 25), ("front_upper.R", "lat", 25),
            ("rear_upper.L", "lat", -30), ("rear_upper.R", "lat", -30),
            ("rear_lower.L", "lat", 80), ("rear_lower.R", "lat", 80),
            ("rear_paw.L", "lat", -40), ("rear_paw.R", "lat", -40),
            ("tail.01", "lat", 14)],
    "stride": [("front_upper.L", "lat", -30), ("front_lower.L", "lat", 26),
               ("front_paw.L", "lat", 12),
               ("front_upper.R", "lat", 24), ("front_lower.R", "lat", -14),
               ("rear_upper.L", "lat", 22), ("rear_lower.L", "lat", -24),
               ("rear_upper.R", "lat", -24), ("rear_lower.R", "lat", 30),
               ("rear_paw.R", "lat", -16),
               ("tail.01", "lat", -12), ("tail.02", "lat", -8),
               ("neck", "lat", -5)],
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, out_dir, tag = argv[0], argv[1], argv[2]
    which = argv[3] if len(argv) > 3 else "rest"
    zoom = float(argv[4]) if len(argv) > 4 else 1.0
    npts = int(argv[5]) if len(argv) > 5 else DOG_N
    res = int(argv[6]) if len(argv) > 6 else 900
    os.makedirs(out_dir, exist_ok=True)

    if src.lower().endswith((".glb", ".gltf")):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=src)
    else:
        bpy.ops.wm.open_mainfile(filepath=src)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and len(o.data.vertices) < 200:
            bpy.data.objects.remove(o, do_unlink=True)
    body = max([o for o in bpy.data.objects if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    rig.data.pose_position = "POSE"
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()

    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    fwd, lat = median_frame(ws)
    axes = {"lat": lat, "up": Vector((0, 0, 1)), "fwd": fwd}

    applied = 0
    if which.startswith("f") and which[1:].isdigit():
        # a frame of the authored loop, rather than a hand-written pose
        bpy.context.scene.frame_set(int(which[1:]))
        bpy.context.view_layer.update()
        log(f"{tag}: loop frame {which[1:]}")
    for name, ax, deg in POSES.get(which, []):
        pb = rig.pose.bones.get(name)
        if pb is None:
            continue
        M = pb.bone.matrix_local.to_3x3()
        R = Matrix.Rotation(math.radians(deg), 3, axes[ax].normalized())
        pb.rotation_euler = (M.inverted() @ R @ M).to_euler("XYZ")
        applied += 1
    bpy.context.view_layer.update()
    log(f"{tag}/{which}: applied {applied} bone rotations")

    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    verts = [body.matrix_world @ v.co for v in me.vertices]
    tris = []
    for p in me.polygons:
        vi = list(p.vertices)
        for k in range(1, len(vi) - 1):
            tris.append((vi[0], vi[k], vi[k + 1]))
    ev.to_mesh_clear()

    # dog.ts's canonical frame: feet on y=0, centred, scaled to DOG_H, yawed.
    # Rebuilt here in the animal's own median frame so both rigs land the same
    # way up and the comparison is of the SKINNING, not of a stray yaw.
    a = [p.dot(fwd) for p in verts]
    l = [p.dot(lat) for p in verts]
    z = [p.z for p in verts]
    s = DOG_H / (max(z) - min(z))
    ca = 0.5 * (min(a) + max(a))
    cl = 0.5 * (min(l) + max(l))
    z0 = min(z)
    # site space: x right, y up, z toward the camera. Put him broadside.
    P = []
    for i, p in enumerate(verts):
        P.append(Vector(((a[i] - ca) * s, (p.z - z0) * s, (l[i] - cl) * s)))
    pts = sample(P, tris, npts)
    log(f"{tag}/{which}: {len(pts)} points from {len(tris)} triangles")
    render(pts, res, res, os.path.join(out_dir, f"{tag}-{which}.png"), zoom)


if __name__ == "__main__":
    main()
