# Diagnose the retriever's skinning. READ-ONLY: writes nothing, saves nothing.
#
#   blender assets/3d/retriever-original.blend --background \
#     --python scripts/blender/diagnose-rig.py
#
# WHY THIS EXISTS.
# The handoff states four specific failures of this rig, all inherited from an
# earlier session's notes: that rear_upper.L / rear_lower.L / rear_paw.L and
# front_upper.L/R deform ZERO vertices, that ear.L carries 31% of the mesh, and
# that the mesh's long axis sits ~50 degrees off the armature's. Numbers that
# came from a session nobody can re-run are not measurements. This re-derives
# every one of them from the file, so the fix is aimed at what is actually
# broken rather than at what was written down.
#
# Definitions used, so the numbers mean something:
#   owned     sum over vertices of (this bone's normalised weight). A bone that
#             "owns 31% of the mesh" owns 0.31 * len(verts) by this measure.
#             Counting vertices with any influence double-counts blends.
#   touched   vertices with weight > 1e-4 for this bone. This is the number the
#             handoff quotes as "deforms zero vertices".
#   dominant  vertices where this bone carries the LARGEST weight. A bone with
#             touched > 0 but dominant == 0 still cannot lead a pose.

import math
import sys

import bpy
from mathutils import Vector


def log(msg):
    print(f"[diag] {msg}", flush=True)


def principal_axis(coords):
    """Longest axis of the point set, by covariance. Pure python power-iteration
    so this needs no numpy build assumptions."""
    n = len(coords)
    c = Vector((0.0, 0.0, 0.0))
    for p in coords:
        c += p
    c /= n
    # 3x3 covariance
    m = [[0.0] * 3 for _ in range(3)]
    for p in coords:
        d = p - c
        for i in range(3):
            for j in range(3):
                m[i][j] += d[i] * d[j]
    for i in range(3):
        for j in range(3):
            m[i][j] /= n
    v = Vector((1.0, 0.3, 0.2)).normalized()
    for _ in range(200):
        nv = Vector((
            m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
            m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
            m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
        ))
        if nv.length < 1e-12:
            break
        nv.normalize()
        if (nv - v).length < 1e-12:
            v = nv
            break
        v = nv
    return c, v


def main():
    log("=" * 74)
    log(f"FILE: {bpy.data.filepath or '(none)'}")
    log("=" * 74)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    log(f"{len(meshes)} mesh object(s), {len(rigs)} armature(s)")
    for o in meshes:
        log(f"  MESH {o.name}: {len(o.data.vertices)} verts, "
            f"{len(o.data.polygons)} polys, {len(o.vertex_groups)} vgroups, "
            f"mods={[m.type for m in o.modifiers]}")
    for o in rigs:
        log(f"  RIG  {o.name}: {len(o.data.bones)} bones")

    if not meshes or not rigs:
        log("nothing to diagnose")
        return

    body = max(meshes, key=lambda o: len(o.data.vertices))
    rig = rigs[0]
    me = body.data
    V = len(me.vertices)

    # ---- deform bones, and the vertex groups that should feed them ----------
    deform = [b for b in rig.data.bones if b.use_deform]
    log("")
    log(f"-- DEFORM BONES: {len(deform)} of {len(rig.data.bones)} --")

    gname = {g.index: g.name for g in body.vertex_groups}
    owned = {g.name: 0.0 for g in body.vertex_groups}
    touched = {g.name: 0 for g in body.vertex_groups}
    dominant = {g.name: 0 for g in body.vertex_groups}
    unweighted = 0
    raw_sum_hist = []

    for v in me.vertices:
        tot = 0.0
        best = (-1.0, None)
        for ge in v.groups:
            nm = gname.get(ge.group)
            if nm is None:
                continue
            w = ge.weight
            if w > 1e-4:
                tot += w
        if tot <= 1e-6:
            unweighted += 1
            continue
        raw_sum_hist.append(tot)
        for ge in v.groups:
            nm = gname.get(ge.group)
            if nm is None:
                continue
            w = ge.weight
            if w <= 1e-4:
                continue
            owned[nm] += w / tot
            touched[nm] += 1
            if w > best[0]:
                best = (w, nm)
        if best[1]:
            dominant[best[1]] += 1

    log(f"vertices with NO weight at all: {unweighted} / {V} "
        f"({100.0 * unweighted / V:.1f}%)")
    if raw_sum_hist:
        rs = sorted(raw_sum_hist)
        log(f"raw weight-sum per vertex: min={rs[0]:.3f} "
            f"med={rs[len(rs)//2]:.3f} max={rs[-1]:.3f} "
            f"(1.000 == already normalised)")

    log("")
    log(f"{'bone':<20}{'deform':>7}{'owned':>10}{'owned%':>9}"
        f"{'touched':>9}{'dominant':>10}")
    log("-" * 66)
    names = [b.name for b in deform]
    for g in body.vertex_groups:
        if g.name not in names:
            names.append(g.name)
    dead = []
    for nm in names:
        isdef = any(b.name == nm and b.use_deform for b in rig.data.bones)
        exists = nm in owned
        ow = owned.get(nm, 0.0)
        tc = touched.get(nm, 0)
        dm = dominant.get(nm, 0)
        flag = ""
        if isdef and tc == 0:
            flag = "  <== DEFORMS NOTHING"
            dead.append(nm)
        elif isdef and dm == 0:
            flag = "  <== never dominant"
        log(f"{nm:<20}{('yes' if isdef else '-'):>7}{ow:>10.1f}"
            f"{100.0 * ow / V:>8.2f}%{tc:>9}{dm:>10}"
            f"{'' if exists else '   (no vgroup)'}{flag}")

    log("")
    log(f"DEAD DEFORM BONES ({len(dead)}): {dead}")
    top = sorted(owned.items(), key=lambda kv: -kv[1])[:6]
    log("HEAVIEST: " + ", ".join(
        f"{k}={100.0 * v / V:.1f}%" for k, v in top))

    # ---- the axis claim ----------------------------------------------------
    log("")
    log("-- AXES --")
    mw = body.matrix_world
    co = [mw @ v.co for v in me.vertices]
    c, ax = principal_axis(co)
    if ax.x < 0:
        ax = -ax
    log(f"mesh centroid (world)        : {tuple(round(x, 4) for x in c)}")
    log(f"mesh principal axis (world)  : {tuple(round(x, 4) for x in ax)}")

    # The armature's own long axis: spine root -> head, in world space.
    def bone_world(b):
        return (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local)

    bones = {b.name: b for b in rig.data.bones}
    spine_names = [n for n in bones if "spine" in n.lower() or "chest" in n.lower()
                   or "neck" in n.lower() or "head" in n.lower()]
    log(f"spine-ish bones: {spine_names}")
    # take the longest chain span we can: min head to max tail along the set
    if spine_names:
        pts = []
        for n in spine_names:
            h, t = bone_world(bones[n])
            pts += [h, t]
        rc, rax = principal_axis(pts)
        if rax.x < 0:
            rax = -rax
        log(f"armature spine axis (world)  : {tuple(round(x, 4) for x in rax)}")
        dot = max(-1.0, min(1.0, ax.dot(rax)))
        ang = math.degrees(math.acos(abs(dot)))
        log(f"ANGLE mesh-axis vs spine-axis: {ang:.1f} degrees")

    # Object-level transforms, which is where a 50-degree discrepancy usually
    # actually lives.
    for o in (body, rig):
        e = o.matrix_world.to_euler()
        s = o.matrix_world.to_scale()
        t = o.matrix_world.to_translation()
        log(f"{o.name:<18} loc={tuple(round(x, 3) for x in t)} "
            f"rot_deg={tuple(round(math.degrees(x), 2) for x in e)} "
            f"scale={tuple(round(x, 4) for x in s)}")

    # bind matrices: armature-deform modifiers store the mesh's bind at parenting
    for m in body.modifiers:
        if m.type == "ARMATURE":
            log(f"armature modifier: object={m.object.name if m.object else None} "
                f"vgroups={m.use_vertex_groups} envelopes={m.use_bone_envelopes}")
    log(f"body.parent = {body.parent.name if body.parent else None} "
        f"(type {body.parent_type if body.parent else '-'})")
    if body.parent:
        pi = body.matrix_parent_inverse
        e = pi.to_euler()
        log(f"matrix_parent_inverse rot_deg="
            f"{tuple(round(math.degrees(x), 2) for x in e)}")

    # ---- bone geometry, so we know what a sane bind would even look like ---
    log("")
    log("-- DEFORM BONE GEOMETRY (world) --")
    for b in deform:
        h, t = bone_world(b)
        log(f"  {b.name:<20} head={tuple(round(x, 3) for x in h)} "
            f"tail={tuple(round(x, 3) for x in t)} len={ (t-h).length:.4f} "
            f"parent={b.parent.name if b.parent else '-'}")

    # ---- animation ---------------------------------------------------------
    log("")
    log("-- ACTIONS --")
    for ac in bpy.data.actions:
        chans = set()
        for fc in ac.fcurves:
            dp = fc.data_path
            if 'pose.bones["' in dp:
                chans.add(dp.split('"')[1])
        log(f"  {ac.name:<16} range={tuple(ac.frame_range)} "
            f"fcurves={len(ac.fcurves)} bones={sorted(chans)}")


if __name__ == "__main__":
    main()
