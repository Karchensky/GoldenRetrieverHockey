# Render the armature ON the mesh, in the mesh's own median-plane frame.
#
#   blender --background --python scripts/blender/render-rig.py -- \
#       <in.blend|in.glb> <out_dir> [tag]
#
# WHY.
# Bone placement was being judged from printed numbers, and a number cannot tell
# you that the animal's head is turned. Armatures do not appear in a background
# render, so each deform bone is built as a solid tapered box and drawn through
# an x-ray pass over the body. What you see is where the bone actually is.

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree


def log(m):
    print(f"[rrig] {m}", flush=True)


def median_frame(ws):
    """Same derivation as rebuild-rig.py: the mirror that best maps the mesh
    onto itself."""
    floor = min(p.z for p in ws)
    H = max(p.z for p in ws) - floor
    kd = KDTree(len(ws))
    for i, p in enumerate(ws):
        kd.insert(p, i)
    kd.balance()
    S = ws[::max(1, len(ws) // 1200)]

    def cost(th, c):
        lat = Vector((-math.sin(th), math.cos(th), 0.0))
        t = 0.0
        for p in S:
            q = p - lat * (2.0 * (p.dot(lat) - c))
            t += kd.find(q)[2]
        return t / len(S)

    best = None
    for k in range(72):
        th = math.pi * k / 72.0
        lat = Vector((-math.sin(th), math.cos(th), 0.0))
        ls = sorted(p.dot(lat) for p in ws)
        v = cost(th, ls[len(ls) // 2])
        if best is None or v < best[0]:
            best = (v, th, ls[len(ls) // 2])
    for scale in (0.02, 0.004):
        v0, th0, c0 = best
        for i in range(9):
            for j in range(9):
                th, c = th0 + (i - 4) * scale, c0 + (j - 4) * scale * H
                v = cost(th, c)
                if v < best[0]:
                    best = (v, th, c)
    _e, th, c = best
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    lat = Vector((-math.sin(th), math.cos(th), 0.0))
    aa = [p.dot(fwd) for p in ws]
    crown = max(ws, key=lambda p: p.z)
    if crown.dot(fwd) < 0.5 * (min(aa) + max(aa)):
        fwd, lat = -fwd, -lat
    return fwd, lat


def bone_solid(name, head, tail, r):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    d = tail - head
    L = max(1e-6, d.length)
    z = d / L
    x = (Vector((0, 0, 1)).cross(z))
    if x.length < 1e-6:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    ring = []
    for k in range(6):
        an = 2 * math.pi * k / 6
        ring.append(x * math.cos(an) * r + y * math.sin(an) * r)
    v0 = bm.verts.new(head)
    v1 = bm.verts.new(tail)
    mid = [bm.verts.new(head + z * (L * 0.22) + o) for o in ring]
    for k in range(6):
        a, b = mid[k], mid[(k + 1) % 6]
        bm.faces.new((v0, b, a))
        bm.faces.new((v1, a, b))
    bm.to_mesh(me)
    bm.free()
    return bpy.data.objects.new(name, me)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, out_dir = argv[0], argv[1]
    tag = argv[2] if len(argv) > 2 else "rig"
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
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()

    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    fwd, lat = median_frame(ws)
    up = Vector((0, 0, 1))
    floor = min(p.z for p in ws)
    H = max(p.z for p in ws) - floor

    sc = bpy.context.scene
    body.color = (0.62, 0.46, 0.26, 1.0)
    palette = [(1.0, 0.25, 0.20), (0.25, 0.85, 1.0), (0.45, 1.0, 0.35),
               (1.0, 0.85, 0.15), (1.0, 0.40, 0.95), (0.55, 0.55, 1.0)]
    made = []
    for n, b in enumerate(rig.data.bones):
        if not b.use_deform:
            continue
        h = rig.matrix_world @ b.head_local
        t = rig.matrix_world @ b.tail_local
        ob = bone_solid(f"B_{b.name}", h, t, 0.016 * H)
        ob.color = palette[n % len(palette)] + (1.0,)
        sc.collection.objects.link(ob)
        made.append(ob)
    log(f"drew {len(made)} deform bones")

    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = 1100
    sc.render.resolution_y = 800
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_cavity = False
    sh.show_xray = True
    sh.xray_alpha = 0.28
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.color = (0.03, 0.03, 0.04)

    a = [p.dot(fwd) for p in ws]
    l = [p.dot(lat) for p in ws]
    ctr = fwd * ((min(a) + max(a)) / 2) + lat * ((min(l) + max(l)) / 2) \
        + up * (floor + H / 2)
    # ortho_scale spans the LARGER image dimension, so the vertical extent has
    # to be scaled up by the aspect or the animal's head is cropped off
    aspect = sc.render.resolution_x / sc.render.resolution_y
    span = max(max(a) - min(a), max(l) - min(l), H * aspect) * 1.08

    cd = bpy.data.cameras.new("C")
    cd.type = "ORTHO"
    cd.ortho_scale = span
    cam = bpy.data.objects.new("C", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def shoot(name, dirv, upv):
        d = dirv.normalized()
        zc = -d
        xc = upv.cross(zc).normalized()
        yc = zc.cross(xc)
        m = Matrix(((xc.x, yc.x, zc.x, 0.0),
                    (xc.y, yc.y, zc.y, 0.0),
                    (xc.z, yc.z, zc.z, 0.0),
                    (0.0, 0.0, 0.0, 1.0)))
        cam.matrix_world = m
        cam.matrix_world.translation = ctr - d * span * 3.0
        sc.render.filepath = os.path.join(out_dir, f"{tag}-{name}.png")
        bpy.ops.render.render(write_still=True)
        log(f"wrote {sc.render.filepath}")

    shoot("side", -lat, up)
    shoot("top", -up, fwd)
    shoot("front", fwd, up)


if __name__ == "__main__":
    main()
