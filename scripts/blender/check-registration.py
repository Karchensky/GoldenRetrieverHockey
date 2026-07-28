# Is the armature registered to the mesh at all? READ-ONLY.
#
#   blender assets/3d/retriever-original.blend --background \
#     --python scripts/blender/check-registration.py
#
# WHY.
# diagnose-rig.py says ear.L owns 22% of the mesh and rear_upper.R owns another
# 22%. Those are not plausible shares for an ear and a thigh, which means the
# weights are not describing anatomy. There are only two ways that happens:
# either the weights were painted wrong on a correctly-placed armature, or the
# armature is not where the animal is and automatic weighting did the only thing
# it could. Those two have completely different fixes, so this distinguishes
# them with two measurements:
#
#   INSIDE     fraction of each bone's length that lies inside the mesh
#              surface, by parity ray-casting against a BVH of the mesh. A bone
#              floating in space outside the animal cannot be heat-bound and
#              cannot be repainted; it has to be MOVED.
#   OWNERSHIP  the centroid of the vertices each bone dominates, and how far
#              that is from the bone itself, in withers. A femur whose owned
#              vertices sit a whole body-length away is not a femur.

import math
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def log(msg):
    print(f"[reg] {msg}", flush=True)


def main():
    body = bpy.data.objects.get("RetrieverBody")
    rig = bpy.data.objects.get("RetrieverRig")
    if body is None:
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        body = max(meshes, key=lambda o: len(o.data.vertices))
    if rig is None:
        rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()

    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    floor = min(p.z for p in ws)
    top = max(p.z for p in ws)
    W = top - floor

    # ---- mesh's own yaw frame, exactly as measure-retriever.py derives it ---
    mx = sum(p.x for p in ws) / len(ws)
    my = sum(p.y for p in ws) / len(ws)
    sxx = sum((p.x - mx) ** 2 for p in ws)
    syy = sum((p.y - my) ** 2 for p in ws)
    sxy = sum((p.x - mx) * (p.y - my) for p in ws)
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    crown = max(ws, key=lambda p: p.z)
    if (crown - Vector((mx, my, 0))).dot(fwd) < 0:
        fwd = -fwd
    lat = Vector((-fwd.y, fwd.x, 0.0))

    # the rebuilt rig splits `spine` into spine.01/spine.02, so take whichever
    # of the two namings the file actually uses
    bs = rig.data.bones
    sname = next((n for n in ("spine", "spine.01", "hips") if n in bs), None)
    spine_h = rig.matrix_world @ bs[sname].head_local
    head_h = rig.matrix_world @ bs["head"].head_local
    rf = Vector((head_h.x - spine_h.x, head_h.y - spine_h.y, 0.0)).normalized()
    yaw = math.degrees(math.atan2(fwd.y, fwd.x) - math.atan2(rf.y, rf.x))
    while yaw > 180:
        yaw -= 360
    while yaw < -180:
        yaw += 360

    log("=" * 70)
    log(f"mesh bbox height (withers proxy) W = {W:.4f}")
    log(f"mesh nose-tail axis (world XY)     = "
        f"({fwd.x:+.4f}, {fwd.y:+.4f})  -> {math.degrees(math.atan2(fwd.y, fwd.x)):+.1f} deg")
    log(f"rig  spine->head axis (world XY)   = "
        f"({rf.x:+.4f}, {rf.y:+.4f})  -> {math.degrees(math.atan2(rf.y, rf.x)):+.1f} deg")
    log(f"YAW of mesh relative to rig        = {yaw:+.1f} degrees")
    log("=" * 70)

    # ---- BVH of the rest mesh -----------------------------------------------
    polys = [tuple(p.vertices) for p in body.data.polygons]
    tris = []
    for p in polys:
        for k in range(1, len(p) - 1):
            tris.append((p[0], p[k], p[k + 1]))
    bvh = BVHTree.FromPolygons([tuple(v) for v in ws], tris, all_triangles=True)

    def inside(p):
        """Parity test along a fixed direction with a couple of fallbacks."""
        hits = 0
        d = Vector((0.5773, 0.5774, 0.5773))
        o = p.copy()
        for _ in range(64):
            r = bvh.ray_cast(o + d * 1e-5, d)
            if r[0] is None:
                break
            hits += 1
            o = r[0]
        return hits % 2 == 1

    log("")
    log(f"{'bone':<18}{'inside%':>9}{'d_surf/W':>10}{'ownCentroid dist/W':>20}"
        f"{'dominant':>10}")
    log("-" * 68)

    gname = {g.index: g.name for g in body.vertex_groups}
    dom_pts = {}
    for i, v in enumerate(body.data.vertices):
        best = (-1.0, None)
        for ge in v.groups:
            nm = gname.get(ge.group)
            if nm and ge.weight > best[0]:
                best = (ge.weight, nm)
        if best[1] and best[0] > 1e-4:
            dom_pts.setdefault(best[1], []).append(ws[i])

    rows = []
    for b in rig.data.bones:
        if not b.use_deform:
            continue
        h = rig.matrix_world @ b.head_local
        t = rig.matrix_world @ b.tail_local
        NS = 11
        ins = 0
        dsum = 0.0
        for k in range(NS):
            p = h.lerp(t, k / (NS - 1.0))
            if inside(p):
                ins += 1
            loc = bvh.find_nearest(p)
            if loc[0] is not None:
                dsum += (loc[0] - p).length
        insf = 100.0 * ins / NS
        dmean = dsum / NS / W
        pts = dom_pts.get(b.name, [])
        if pts:
            c = sum(pts, Vector((0, 0, 0))) / len(pts)
            mid = h.lerp(t, 0.5)
            odist = (c - mid).length / W
        else:
            odist = float("nan")
        rows.append((b.name, insf, dmean, odist, len(pts)))
        flag = ""
        if insf < 40:
            flag = "  <== BONE IS OUTSIDE THE MESH"
        elif pts and odist > 0.35:
            flag = "  <== owns geometry far from itself"
        log(f"{b.name:<18}{insf:>8.0f}%{dmean:>10.3f}"
            f"{(f'{odist:.3f}' if pts else '   -'):>20}{len(pts):>10}{flag}")

    outside = [r[0] for r in rows if r[1] < 40]
    far = [r[0] for r in rows if r[4] and r[3] > 0.35]
    log("")
    log(f"BONES OUTSIDE THE MESH ({len(outside)}/{len(rows)}): {outside}")
    log(f"BONES OWNING DISTANT GEOMETRY ({len(far)}): {far}")

    # ---- where the animal actually is, in its own frame ---------------------
    log("")
    log("-- MESH ANATOMY IN ITS OWN FRAME (along = nose+, lat, up) --")
    a = [p.dot(fwd) for p in ws]
    l = [p.dot(lat) for p in ws]
    log(f"along range {min(a):+.3f} .. {max(a):+.3f}   (len {max(a)-min(a):.3f} = "
        f"{(max(a)-min(a))/W:.2f} W)")
    log(f"lat   range {min(l):+.3f} .. {max(l):+.3f}   (width {max(l)-min(l):.3f} = "
        f"{(max(l)-min(l))/W:.2f} W)")
    log(f"up    range {floor:+.3f} .. {top:+.3f}")
    # paw prints
    z_c = 0.10 * W
    paw = [i for i in range(len(ws)) if ws[i].z - floor < z_c]
    log(f"vertices below {z_c:.3f} above floor (paws): {len(paw)}")
    if paw:
        am = sorted(a[i] for i in paw)[len(paw) // 2]
        lm = sorted(l[i] for i in paw)[len(paw) // 2]
        for sa, na in ((1.0, "front"), (-1.0, "rear")):
            for sl, nl in ((-1.0, "L"), (1.0, "R")):
                sel = [i for i in paw if (a[i] - am) * sa > 0 and (l[i] - lm) * sl > 0]
                if len(sel) < 20:
                    log(f"  {na}.{nl}: only {len(sel)} verts")
                    continue
                ca = sum(a[i] for i in sel) / len(sel)
                cl = sum(l[i] for i in sel) / len(sel)
                p = fwd * ca + lat * cl
                log(f"  paw {na}.{nl}: along {ca:+.3f} lat {cl:+.3f} "
                    f"-> world ({p.x:+.3f}, {p.y:+.3f}) [{len(sel)} verts]")
    # nose / tail tip
    nose = max(ws, key=lambda p: p.dot(fwd))
    tailt = min(ws, key=lambda p: p.dot(fwd))
    log(f"  nose  world ({nose.x:+.3f}, {nose.y:+.3f}, {nose.z:+.3f})")
    log(f"  tail  world ({tailt.x:+.3f}, {tailt.y:+.3f}, {tailt.z:+.3f})")
    log(f"  crown world ({crown.x:+.3f}, {crown.y:+.3f}, {crown.z:+.3f})")


if __name__ == "__main__":
    main()
