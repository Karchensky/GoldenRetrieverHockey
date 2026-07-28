# The ambient loop: walk, stop, sniff, sit, look up, rise, repeat.
#
#   blender --background --python scripts/blender/make-loop.py -- \
#       [--src assets/3d/retriever-rebound.blend] [--out assets/3d/retriever-rebound.glb]
#
# Fifteen seconds at 24 fps, and frame 360 is frame 0 so it loops without a cut.
#
# WHY IT IS AUTHORED IN PLACE.
# The loop has to close. A dog that walks four strides forward and then sits
# cannot return to where it started without walking backwards, so the walk here
# cycles the legs, bobs and sways the body, and does not translate. He is drawn
# 110 pixels tall at 8.6 m; a few centimetres of foot slide at that size is not
# a thing anyone can see, and a visible seam every fifteen seconds is.
#
# WHAT THE SITE WOULD HAVE TO DO WITH THIS.
# apps/web/components/rink/home/dog.ts samples ONE pose, at load, into a static
# buffer — it calls applyBoneTransform per vertex once and never touches the
# skeleton again. So this clip cannot play as things stand, and this file does
# not try to make it: it is not loaded by anything. To use it, the sampler would
# have to carry each POINT's four joint indices and weights (barycentric off the
# triangle it was sampled on, exactly as uv already is) and skin in the vertex
# shader from the bone matrices. That is app-side work in territory this pass
# does not own.

import math
import os
import sys

import bpy
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEF_SRC = os.path.join(REPO, "assets", "3d", "retriever-rebound.blend")
DEF_OUT = os.path.join(REPO, "assets", "3d", "retriever-loop.glb")

FPS = 24
SECONDS = 15
NFRAMES = FPS * SECONDS          # 360


def log(m):
    print(f"[loop] {m}", flush=True)


def ss(a, b, x):
    if b == a:
        return 0.0 if x < a else 1.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def median_frame(ws):
    kd = KDTree(len(ws))
    for i, p in enumerate(ws):
        kd.insert(p, i)
    kd.balance()
    H = max(p.z for p in ws) - min(p.z for p in ws)
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
    for scale in (0.02, 0.004):
        v0, th0, c0 = best
        for i in range(9):
            for j in range(9):
                th, c = th0 + (i - 4) * scale, c0 + (j - 4) * scale * H
                v = cost(th, c)
                if v < best[0]:
                    best = (v, th, c)
    _e, th, _c = best
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    lat = Vector((-math.sin(th), math.cos(th), 0.0))
    aa = [p.dot(fwd) for p in ws]
    if max(ws, key=lambda p: p.z).dot(fwd) < 0.5 * (min(aa) + max(aa)):
        fwd, lat = -fwd, -lat
    return fwd, lat


# --------------------------------------------------------------- the poses
def walk_pose(phi):
    """One stride, phi in 0..1. Lateral sequence: left hind, left fore, right
    hind, right fore, which is what a dog does at a walk."""
    rot_lat, rot_up = {}, {}
    legs = {"rear_upper.L": 0.00, "front_upper.L": 0.25,
            "rear_upper.R": 0.50, "front_upper.R": 0.75}
    for up_name, ph in legs.items():
        base = up_name.rsplit("_", 1)[0].replace("_upper", "")
        which, side = up_name.split("_")[0], up_name.split(".")[1]
        t = 2.0 * math.pi * (phi - ph)
        amp = 20.0 if which == "front" else 18.0
        rot_lat[up_name] = amp * math.cos(t)
        rot_lat[f"{which}_lower.{side}"] = (
            14.0 * math.sin(t + 1.25) - (4.0 if which == "front" else -6.0))
        rot_lat[f"{which}_paw.{side}"] = 9.0 * math.sin(t + 2.1)
    w = 2.0 * math.pi * phi
    rot_up["spine.01"] = 2.4 * math.sin(w)
    rot_up["spine.02"] = 2.0 * math.sin(w + 0.4)
    rot_up["chest"] = 1.6 * math.sin(w + 0.8)
    rot_up["tail.01"] = 6.0 * math.sin(w + 0.6)
    rot_up["tail.02"] = 7.0 * math.sin(w + 0.9)
    rot_lat["head"] = 2.6 * math.sin(2.0 * w)
    rot_lat["neck"] = -3.0
    return rot_lat, rot_up


SNIFF_LAT = {"chest": 6, "neck": 26, "head": 22, "jaw": 5,
             "ear.L": 12, "ear.R": 12}
SIT_LAT = {"hips": -10, "spine.01": -7, "spine.02": -5, "chest": -3,
           "neck": 16, "head": 9,
           "front_upper.L": 25, "front_upper.R": 25,
           "rear_upper.L": -30, "rear_upper.R": -30,
           "rear_lower.L": 80, "rear_lower.R": 80,
           "rear_paw.L": -40, "rear_paw.R": -40,
           "tail.01": 14}
LOOKUP_LAT = {"neck": -20, "head": -26, "jaw": -4, "ear.L": -8, "ear.R": -8}


def add(dst, src, w):
    if w == 0.0:
        return
    for k, v in src.items():
        dst[k] = dst.get(k, 0.0) + v * w


def pose_at(f, H):
    """The whole loop, as (rot about lat, rot about up, root offset in world).

    Frame 360 must equal frame 0 or the ambient loop ticks. The walk cycle is
    one second and the loop is fifteen, so the stride phase closes on its own;
    every other phase is ramped back to nothing before the end.
    """
    phi = (f / float(FPS)) % 1.0
    # The walk must be at FULL weight at frame 0, because frame 0 is also the
    # frame after frame 360. Ramping it in from zero at the start gave a loop
    # whose two ends were a standing dog and a walking dog — a jump of 28% of
    # body height, every fifteen seconds.
    w_walk = max(1.0 - ss(96, 132, f), ss(338, 360, f))
    w_sniff = ss(150, 178, f) * (1.0 - ss(206, 228, f))
    w_sit = ss(228, 272, f) * (1.0 - ss(318, 348, f))
    w_look = ss(276, 296, f) * (1.0 - ss(306, 322, f))

    rot_lat, rot_up = {}, {}
    wl, wu = walk_pose(phi)
    add(rot_lat, wl, w_walk)
    add(rot_up, wu, w_walk)
    add(rot_lat, SNIFF_LAT, w_sniff)
    add(rot_lat, SIT_LAT, w_sit)
    add(rot_lat, LOOKUP_LAT, w_look)

    # casting about for the scent, and the tail once he is down
    t = f / float(FPS)
    add(rot_up, {"head": 11.0 * math.sin(2.0 * math.pi * t / 2.6),
                 "neck": 5.0 * math.sin(2.0 * math.pi * t / 2.6)}, w_sniff)
    wag = math.sin(2.0 * math.pi * t / 0.55)
    add(rot_up, {"tail.01": 13.0 * wag, "tail.02": 17.0 * wag,
                 "tail.03": 21.0 * wag}, max(w_sit, w_look))

    # root: the bob of a walk, and the drop into the sit
    bob = -0.013 * H * math.cos(4.0 * math.pi * phi) * w_walk
    sway = 0.005 * H * math.sin(2.0 * math.pi * phi) * w_walk
    drop = -0.075 * H * w_sit
    return rot_lat, rot_up, Vector((0.0, 0.0, bob + drop)), sway


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    src = argv[argv.index("--src") + 1] if "--src" in argv else DEF_SRC
    out = argv[argv.index("--out") + 1] if "--out" in argv else DEF_OUT

    bpy.ops.wm.open_mainfile(filepath=src)
    body = max([o for o in bpy.data.objects if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    rig.data.pose_position = "POSE"
    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    H = max(p.z for p in ws) - min(p.z for p in ws)
    fwd, lat = median_frame(ws)
    up = Vector((0.0, 0.0, 1.0))
    log(f"lat = {tuple(round(v, 4) for v in lat)}, H = {H:.4f}")

    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start = 0
    sc.frame_end = NFRAMES

    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)

    # Do NOT pre-create the action and slot. Blender 5.x actions are slotted,
    # and an action created by hand with a slot created by hand ends up with the
    # keyframes in a channelbag that is not the one the bound slot reads: the
    # file then reports 78 fcurves and 'Ambient' assigned, and the mesh does not
    # move by a thousandth of a millimetre at any frame. Letting the first
    # keyframe_insert build the action, the slot and the binding together is the
    # only arrangement that actually evaluates.
    rig.animation_data_clear()

    names = [b.name for b in rig.data.bones]
    rest_rot = {n: rig.pose.bones[n].bone.matrix_local.to_3x3() for n in names}

    def apply(f):
        rot_lat, rot_up, root_off, sway = pose_at(f, H)
        for pb in rig.pose.bones:
            pb.rotation_euler = (0.0, 0.0, 0.0)
            pb.location = (0.0, 0.0, 0.0)
        touched = set(rot_lat) | set(rot_up)
        for n in touched:
            pb = rig.pose.bones.get(n)
            if pb is None:
                continue
            M = rest_rot[n]
            R = Matrix.Identity(3)
            if n in rot_lat and abs(rot_lat[n]) > 1e-9:
                R = Matrix.Rotation(math.radians(rot_lat[n]), 3, lat) @ R
            if n in rot_up and abs(rot_up[n]) > 1e-9:
                R = Matrix.Rotation(math.radians(rot_up[n]), 3, up) @ R
            pb.rotation_euler = (M.inverted() @ R @ M).to_euler("XYZ")
        rpb = rig.pose.bones.get("root")
        if rpb is not None:
            world = root_off + lat * sway
            rpb.location = rest_rot["root"].inverted() @ world
        return touched

    keyed = set()
    for f in range(NFRAMES + 1):
        # frame_set FIRST. It re-evaluates the action onto the pose, so calling
        # it after apply() throws the pose away and keyframes whatever the
        # (initially empty) action said — which is identity, on every frame, for
        # every bone. The file then has 361 frames of perfectly valid keys and
        # the animal never moves.
        bpy.context.scene.frame_set(f)
        t = apply(f)
        keyed |= t
        for n in sorted(t | {"root"}):
            pb = rig.pose.bones.get(n)
            if pb is None:
                continue
            pb.keyframe_insert("rotation_euler", frame=f)
            if n == "root":
                pb.keyframe_insert("location", frame=f)
    if rig.animation_data and rig.animation_data.action:
        rig.animation_data.action.name = "Ambient"
        rig.animation_data.action.use_fake_user = True
    log(f"keyed {len(keyed) + 1} bones over {NFRAMES + 1} frames "
        f"into action {rig.animation_data.action.name!r}")

    # Prove it evaluates. An action that is assigned, has fcurves, and moves
    # nothing is the exact failure this file was written around.
    def probe(f):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        m = ev.to_mesh()
        o = [v.co.copy() for v in m.vertices]
        ev.to_mesh_clear()
        return o
    p0 = probe(0)
    spread = 0.0
    for f in (60, 190, 250, 300):
        pf = probe(f)
        spread = max(spread,
                     max((p0[i] - pf[i]).length for i in range(len(p0))) / H)
    log(f"animation range of motion: {spread * 100:.1f}% of H "
        f"({'MOVES' if spread > 0.02 else 'DEAD — action is not evaluating'})")
    if spread <= 0.02:
        sys.exit(1)

    # ---- verify the loop closes -------------------------------------------
    def sample_at(f):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        m = ev.to_mesh()
        o = [v.co.copy() for v in m.vertices]
        ev.to_mesh_clear()
        return o

    a, b = sample_at(0), sample_at(NFRAMES)
    d = max((a[i] - b[i]).length for i in range(len(a))) / H
    log(f"loop seam: worst vertex moves {d * 100:.3f}% of H between "
        f"frame {NFRAMES} and frame 0  "
        f"({'SEAMLESS' if d < 0.002 else 'VISIBLE STEP'})")

    # ---- the loop's own tearing -------------------------------------------
    rest = None
    for pb in rig.pose.bones:
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    rest = sample_at(0)
    rig.data.pose_position = "POSE"
    edges = [tuple(e.vertices) for e in body.data.edges]
    rl = [max(1e-9, (rest[x] - rest[y]).length) for x, y in edges]
    worst = 0.0
    worst_f = 0
    for f in range(0, NFRAMES + 1, 4):
        cur = sample_at(f)
        g = max((cur[x] - cur[y]).length - rl[k]
                for k, (x, y) in enumerate(edges)) / H
        if g > worst:
            worst, worst_f = g, f
    log(f"worst edge gap over the whole loop: {worst:.4f} H at frame {worst_f}")

    bpy.context.scene.frame_set(0)
    blend_out = os.path.splitext(out)[0] + ".blend"
    bpy.ops.wm.save_as_mainfile(filepath=blend_out)
    log(f"saved {blend_out}")

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=False,
        export_skins=True,
        export_morph=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )
    log(f"wrote {out} ({os.path.getsize(out) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
