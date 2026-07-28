# Does a NEW pose tear this animal? Objective, then rendered.
#
#   blender --background --python scripts/blender/pose-test.py -- \
#       <in.blend|in.glb> <out_dir> [tag]
#
# WHY EDGE STRETCH.
# "It opened in Blender" and "the clips play" are not evidence. The shipped
# clips key `head` and `tail.*`, which in the source file deform zero vertices
# between them, so they play cleanly by moving nothing. The question is what a
# pose the rig has never seen does to the mesh, and the measurement for that is
# what happens to the EDGES: skinning failures show up as edges stretched many
# times their rest length, because two ends of one edge got handed to bones that
# went different ways.
#
# Two tests:
#   SWEEP     every deform bone rotated 25 degrees in turn, alone. Reports how
#             many vertices actually move and the worst edge stretch. A bone
#             that moves nothing is dead; a bone that moves things and tears is
#             mis-weighted. Both are failures, and they are different failures.
#   POSES     the ambient loop's real extremes — sit, look up, sniff the ground,
#             mid-stride — applied as whole-body poses and rendered.
#
# Rotations are specified in WORLD axes (the animal's own lateral / vertical),
# not bone-local, because bone roll is arbitrary here and "bend the stifle" has
# to mean the same thing on every rig this is pointed at.

import math
import os
import sys

import bpy
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree


def log(m):
    print(f"[pose] {m}", flush=True)


def median_frame(ws):
    floor = min(p.z for p in ws)
    H = max(p.z for p in ws) - floor
    kd = KDTree(len(ws))
    for i, p in enumerate(ws):
        kd.insert(p, i)
    kd.balance()
    S = ws[::max(1, len(ws) // 1200)]

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
    _e, th, c = best
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    lat = Vector((-math.sin(th), math.cos(th), 0.0))
    aa = [p.dot(fwd) for p in ws]
    if max(ws, key=lambda p: p.z).dot(fwd) < 0.5 * (min(aa) + max(aa)):
        fwd, lat = -fwd, -lat
    return fwd, lat


class Rig:
    def __init__(self, body, rig):
        self.body, self.rig = body, rig
        self.me = body.data
        rig.data.pose_position = "POSE"
        for pb in rig.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        self.edges = [tuple(e.vertices) for e in self.me.edges]
        self.rest = self.evaluate()
        self.rest_len = [max(1e-9, (self.rest[a] - self.rest[b]).length)
                         for a, b in self.edges]
        srt = sorted(self.rest_len)
        self.med_rest = srt[len(srt) // 2]
        zz = [v.z for v in self.rest]
        self.H = max(zz) - min(zz)
        log(f"rest edges: {len(srt)}, median {self.med_rest / self.H:.5f} H, "
            f"shortest {srt[0] / self.H:.6f} H, longest {srt[-1] / self.H:.4f} H")

    def evaluate(self):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg)
        m = ev.to_mesh()
        out = [v.co.copy() for v in m.vertices]
        ev.to_mesh_clear()
        return out

    def clear(self):
        for pb in self.rig.pose.bones:
            pb.rotation_euler = (0.0, 0.0, 0.0)
        self.rig.location = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()

    def set_world(self, name, axis, deg):
        """Rotate a bone by `deg` about a WORLD axis.

        pose_bone.rotation_euler is applied in the bone's own rest frame, so the
        world rotation R has to be conjugated into it: R_local = M^-1 R M, with
        M the bone's rest orientation in armature space.
        """
        pb = self.rig.pose.bones.get(name)
        if pb is None:
            return False
        M = pb.bone.matrix_local.to_3x3()
        R = Matrix.Rotation(math.radians(deg), 3, axis.normalized())
        loc = M.inverted() @ R @ M
        pb.rotation_euler = loc.to_euler("XYZ")
        return True

    def stretch(self):
        """Edge stretch against rest, as a ratio AND as an absolute gap.

        The ratio alone is not trustworthy on this mesh. It is decimated, so it
        carries slivers — the shortest edges are a thousandth of the longest —
        and an edge that starts at 0.0004 units and ends at 0.004 reports 10x
        while moving four thousandths of a body. What you can SEE is the
        absolute opening, so `gap` is the honest number: the largest increase in
        any edge's length, in units of the animal's height. Anything under about
        0.01 H is invisible at the size he is drawn on the ice.
        """
        cur = self.evaluate()
        s, gaps = [], []
        for k, (a, b) in enumerate(self.edges):
            L = (cur[a] - cur[b]).length
            s.append(L / self.rest_len[k])
            gaps.append((L - self.rest_len[k]) / self.H)
        order = sorted(range(len(s)), key=lambda k: -s[k])
        worst = order[0]
        s_sorted = sorted(s)
        gaps.sort()
        n = len(s)
        moved = sum(1 for i in range(len(cur))
                    if (cur[i] - self.rest[i]).length > 1e-4)
        return dict(max=s_sorted[-1], p999=s_sorted[int(n * 0.999)],
                    p99=s_sorted[int(n * 0.99)], moved=moved, n=n,
                    gap=gaps[-1], gap999=gaps[int(n * 0.999)],
                    worst_rest=self.rest_len[worst] / self.med_rest)


def sweep(R, deform, lat):
    log("")
    log(f"{'bone':<18}{'moved':>8}{'max stretch':>13}{'p99.9':>9}{'gap/H':>10}")
    log("-" * 58)
    dead, torn = [], []
    for b in deform:
        R.clear()
        R.set_world(b, lat, 25.0)
        bpy.context.view_layer.update()
        st = R.stretch()
        f = ""
        if st["moved"] == 0:
            f = "  <== DEAD"
            dead.append(b)
        elif st["max"] > 2.0:
            f = "  <== TEARS"
            torn.append((b, st["max"]))
        log(f"{b:<18}{st['moved']:>8}{st['max']:>13.2f}{st['p999']:>9.2f}"
            f"{st['gap']:>10.4f}{f}")
    R.clear()
    log(f"DEAD BONES ({len(dead)}): {dead}")
    log(f"TEARING BONES ({len(torn)}): {[f'{b}={m:.1f}x' for b, m in torn]}")
    return dead, torn


def poses(lat, up, fwd):
    """The ambient loop's extremes. Angles are world-axis degrees; +lat pitches
    the nose DOWN, because (fwd, lat, up) is right-handed with lat pointing to
    the animal's left.

    ROTATIONS DOWN A CHAIN ADD UP. The first sit spec asked for -22 at the hips
    and another -14, -10, -8, -10, -8 forward of it, and the head came out 72
    degrees up — the animal was rearing. Every chain here is written so the
    ACCUMULATED angle is the one intended: the sit pitches the torso 25 degrees
    and then spends +25 back through the neck and head to leave the skull level,
    which is what a sitting dog does.
    """
    return {
        # the control: no rotation at all. The fur feathering on the belly and
        # the throat is OPEN GEOMETRY in the sculpt — it is serrated at rest,
        # before any bone touches it — so a posed render has to be read against
        # this or the mesh's own coat gets charged to the skinning.
        "rest": [],
        "look-up": [("neck", lat, -14), ("head", lat, -22), ("jaw", lat, -5),
                    ("ear.L", lat, -8), ("ear.R", lat, -8)],
        "sniff": [("chest", lat, 6), ("neck", lat, 26), ("head", lat, 22),
                  ("jaw", lat, 5), ("ear.L", lat, 12), ("ear.R", lat, 12)],
        # torso up 25 at the chest, head levelled back to 0, hocks to the floor
        "sit": [("hips", lat, -10), ("spine.01", lat, -7),
                ("spine.02", lat, -5), ("chest", lat, -3),
                ("neck", lat, 16), ("head", lat, 9),
                ("front_upper.L", lat, 25), ("front_upper.R", lat, 25),
                ("rear_upper.L", lat, -30), ("rear_upper.R", lat, -30),
                ("rear_lower.L", lat, 80), ("rear_lower.R", lat, 80),
                ("rear_paw.L", lat, -40), ("rear_paw.R", lat, -40),
                ("tail.01", lat, 14)],
        "stride": [("front_upper.L", lat, -30), ("front_lower.L", lat, 26),
                   ("front_paw.L", lat, 12),
                   ("front_upper.R", lat, 24), ("front_lower.R", lat, -14),
                   ("rear_upper.L", lat, 22), ("rear_lower.L", lat, -24),
                   ("rear_upper.R", lat, -24), ("rear_lower.R", lat, 30),
                   ("rear_paw.R", lat, -16),
                   ("tail.01", lat, -12), ("tail.02", lat, -8),
                   ("neck", lat, -5)],
        "head-turn": [("neck", up, 16), ("head", up, 30), ("ear.L", up, 10),
                      ("ear.R", up, 10)],
        "wag": [("tail.01", up, 20), ("tail.02", up, 26), ("tail.03", up, 30)],
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, out_dir = argv[0], argv[1]
    tag = argv[2] if len(argv) > 2 else "pose"
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
    log(f"{src}: {len(body.data.vertices)} verts, "
        f"{sum(1 for b in rig.data.bones if b.use_deform)} deform bones")

    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    fwd, lat = median_frame(ws)
    up = Vector((0, 0, 1))
    floor = min(p.z for p in ws)
    H = max(p.z for p in ws) - floor

    R = Rig(body, rig)
    deform = [b.name for b in rig.data.bones if b.use_deform]
    sweep(R, deform, lat)

    # ---- whole-body poses --------------------------------------------------
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = 760
    sc.render.resolution_y = 560
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "SINGLE"
    sh.single_color = (0.85, 0.62, 0.30)
    sh.show_cavity = True
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.color = (0.03, 0.03, 0.04)
    rig.hide_render = True

    cd = bpy.data.cameras.new("C")
    cd.type = "ORTHO"
    cam = bpy.data.objects.new("C", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    d = (-lat).normalized()
    zc = -d
    xc = up.cross(zc).normalized()
    yc = zc.cross(xc)
    cam.matrix_world = Matrix(((xc.x, yc.x, zc.x, 0.0), (xc.y, yc.y, zc.y, 0.0),
                               (xc.z, yc.z, zc.z, 0.0), (0.0, 0.0, 0.0, 1.0)))

    def settle():
        """Drop the animal back onto the floor. Nothing in these poses moves the
        root, so a sit ends up hovering where the standing feet used to be; that
        reads as a rigging failure and is only a missing translation."""
        rig.location.z = 0.0
        bpy.context.view_layer.update()
        cur = [body.matrix_world @ p for p in R.evaluate()]
        rig.location.z = floor - min(p.z for p in cur)
        bpy.context.view_layer.update()

    def frame_posed():
        """Frame the POSED mesh. Framing off the rest bbox sent the sit pose
        half out of shot, which reads as a catastrophe and is only a camera."""
        cur = [body.matrix_world @ p for p in R.evaluate()]
        aa = [p.dot(fwd) for p in cur]
        ll = [p.dot(lat) for p in cur]
        zz = [p.z for p in cur]
        c = fwd * ((min(aa) + max(aa)) / 2) + lat * ((min(ll) + max(ll)) / 2) \
            + up * ((min(zz) + max(zz)) / 2)
        sp = max(max(aa) - min(aa),
                 (max(zz) - min(zz)) * sc.render.resolution_x
                 / sc.render.resolution_y) * 1.14
        cd.ortho_scale = sp
        cam.matrix_world.translation = c - d * sp * 3.0

    log("")
    log(f"{'pose':<14}{'applied':>9}{'moved':>8}{'max stretch':>13}"
        f"{'p99.9':>9}{'p99':>8}{'gap/H':>10}{'gap999':>9}{'wrst_e':>8}")
    log("-" * 89)
    worst = 0.0
    for name, spec in poses(lat, up, fwd).items():
        R.clear()
        n = sum(1 for b, ax, dg in spec if R.set_world(b, ax, dg))
        bpy.context.view_layer.update()
        st = R.stretch()
        worst = max(worst, st["max"])
        flag = "  <== TEARS" if st["gap"] > 0.010 else ""
        log(f"{name:<14}{n:>4}/{len(spec):<4}{st['moved']:>8}{st['max']:>13.2f}"
            f"{st['p999']:>9.2f}{st['p99']:>8.2f}{st['gap']:>10.4f}"
            f"{st['gap999']:>9.4f}{st['worst_rest']:>8.3f}{flag}")
        settle()
        frame_posed()
        sc.render.filepath = os.path.join(out_dir, f"{tag}-{name}.png")
        bpy.ops.render.render(write_still=True)
    R.clear()
    log(f"WORST STRETCH ACROSS ALL POSES: {worst:.2f}x")


if __name__ == "__main__":
    main()
