# Measure the retriever's anatomical landmarks. Read-only; writes nothing.
#
#   blender assets/3d/retriever-original.blend --background \
#     --python scripts/blender/measure-retriever.py
#
# WHY THIS EXISTS AS ITS OWN FILE.
# The last proportion pass caught that the bone everybody called the withers was
# the glenohumeral joint at 0.63x the real landmark, and every number derived
# from it was wrong by that factor. So the landmarks are defined here ONCE,
# explicitly, each one naming the vertex or the bone it is taken from, and every
# other script in this folder imports these functions rather than re-deriving
# them. A ratio nobody can point at a vertex for is not a measurement.
#
# The definitions, and what a real golden retriever male measures:
#
#   withers   top of the shoulder blade — the topline directly over the point of
#             shoulder. NOT the topline maximum: this animal's neck crest climbs
#             continuously from the withers to the skull, so "highest point
#             behind the head" returns the neck.
#   elbow     the humerus/radius joint, i.e. the tail of the upper-arm bone.
#             A real golden stands with the elbow at 0.52-0.55 x withers; the
#             leg below the elbow is very close to half the dog.
#   brisket   the chest FLOOR — the lowest point of the sternum, taken behind the
#             point of shoulder and forward of the loin. Real: 0.48-0.52 x
#             withers, i.e. the chest reaches down to about the elbow.
#   length    point of shoulder (foremost point of the chest at shoulder height)
#             to point of buttock (rearmost point of the hindquarter). A golden
#             is very slightly OFF square: 1.00-1.05 x withers.
#   crown     highest point on the skull. 1.20-1.25 x withers standing.

import math
import os
import sys

import bpy
from mathutils import Vector

BODY = "RetrieverBody"
RIG = "RetrieverRig"

# The runtime measures this bone and calls the result the withers, so it has to
# BE the withers. See reproportion-retriever.py.
MARKER_BONE = "front_upper.L"

TARGET = {
    "elbow": (0.52, 0.55),
    "brisket": (0.48, 0.52),
    "length": (1.00, 1.05),
    "crown": (1.20, 1.25),
}


def log(msg):
    print(f"[measure] {msg}", flush=True)


def body_frame(body, rig):
    """The mesh's own frame. It is NOT the rig's — the bind mesh is yawed ~50
    degrees from the armature, so every geometric decision is made against the
    mesh's principal axis and never against a bone direction."""
    if rig is not None:
        rig.data.pose_position = "REST"
    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    floor = min(p.z for p in ws)
    mx = sum(p.x for p in ws) / len(ws)
    my = sum(p.y for p in ws) / len(ws)
    sxx = sum((p.x - mx) ** 2 for p in ws)
    syy = sum((p.y - my) ** 2 for p in ws)
    sxy = sum((p.x - mx) * (p.y - my) for p in ws)
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    crown = max(ws, key=lambda p: p.z)
    if crown.dot(fwd) < 0:
        fwd = -fwd
    return ws, floor, fwd, crown


def rig_yaw(rig, fwd):
    """Rotation that takes a rig-space point into the mesh's own yaw frame."""
    spine = rig.matrix_world @ rig.data.bones["spine"].head_local
    headb = rig.matrix_world @ rig.data.bones["head"].head_local
    rf = Vector((headb.x - spine.x, headb.y - spine.y, 0.0)).normalized()
    return math.atan2(fwd.y, fwd.x) - math.atan2(rf.y, rf.x)


def along(p, phi, fwd):
    c, s = math.cos(phi), math.sin(phi)
    return Vector((p.x * c - p.y * s, p.x * s + p.y * c, 0.0)).dot(fwd)


def bone_point(rig, name, end="head"):
    b = rig.data.bones.get(name)
    if b is None:
        return None
    return rig.matrix_world @ (b.head_local if end == "head" else b.tail_local)


# --------------------------------------------------------------------- NOTE
# DO NOT SEGMENT THIS MESH BY VERTEX GROUP. The skinning is not anatomical:
#
#   tail.01 / tail.02 / tail.03   0 vertices, 0 total weight — the tail is not
#                                 bound to the tail bones at all
#   head                          0 weight; the skull is carried by `ear.L`
#   rear_upper.R                  11 873 vertices — the WHOLE hindquarter,
#                                 including the tail and both hind legs
#   rear_lower.L, rear_paw.L,
#   ear.R, root                   0 weight; the left hind leg is driven by the
#                                 .R groups
#
# Dumped with a 25-degree test rotation per bone against the evaluated mesh, so
# this is what actually deforms and not what the names promise. Every landmark
# below is therefore geometric, in the mesh's own frame, and each one says which
# feature of the shape it keys off.


def withers_height(ws, floor, fwd, phi, a_sh):
    """Topline over the point of shoulder. The slab is narrow on purpose:
    forward of the shoulder the neck crest climbs 1.64 -> 1.86 in a tenth of a
    unit, so a generous slab reads the neck and inflates the withers."""
    slab = [p.z for p in ws if abs(along(p, 0.0, fwd) - a_sh) < 0.05]
    return max(slab) - floor


def smoothstep(a, b, x):
    if b == a:
        return 0.0 if x < a else 1.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def leg_columns(ws, floor, fwd, lat, z_c, quiet=False):
    """The four legs, found from the paw prints.

    Below the carpus there is nothing on this animal but feet — the chest floor
    is 0.38 u above it — so the vertices under that line ARE the four paws, and
    splitting them about their own medians fore/aft and left/right separates
    them without a single hand-placed number. Returns (along, lateral, radius,
    count) per leg, in the mesh's own ground plane.

    Used for two different jobs, and it is the same four circles in both: the
    brisket must not be allowed to return a toe, and the forearm must be allowed
    to stretch while the chest floor beside it rides up whole.
    """
    a = [p.dot(fwd) for p in ws]
    l = [p.dot(lat) for p in ws]
    paw = [i for i in range(len(ws)) if ws[i].z - floor < z_c + 0.02]
    if len(paw) < 200:
        log(f"FATAL: only {len(paw)} vertices below the carpus — legs unfindable")
        sys.exit(1)
    am = sorted(a[i] for i in paw)[len(paw) // 2]
    lm = sorted(l[i] for i in paw)[len(paw) // 2]
    cols = []
    for sa in (-1.0, 1.0):
        for sl in (-1.0, 1.0):
            sel = [i for i in paw if (a[i] - am) * sa > 0 and (l[i] - lm) * sl > 0]
            if len(sel) < 40:
                continue
            ca = sum(a[i] for i in sel) / len(sel)
            cl = sum(l[i] for i in sel) / len(sel)
            rad = sum(math.hypot(a[i] - ca, l[i] - cl) for i in sel) / len(sel)
            cols.append((ca, cl, rad, len(sel)))
    if not quiet:
        for ca, cl, rad, n in cols:
            log(f"  leg column at (along {ca:+.3f}, lat {cl:+.3f}) r~{rad:.3f} ({n} verts)")
    if len(cols) != 4:
        log(f"WARNING: found {len(cols)} leg columns, expected 4")
    return cols


def leg_spines(ws, floor, fwd, lat, z_c, z_e, cols, steps=7, reach=1.0):
    """Walk each leg up from its paw print and record where its centre goes.

    A leg is not a vertical cylinder — this rig's shank leans 15 degrees — so a
    mask built on the paw's (along, lateral) centre alone loses the top of the
    leg and catches the belly instead, and a stretch applied straight up the z
    axis STRAIGHTENS the leg it is lengthening. Both want the same thing: the
    line the leg actually follows. Tracked rather than fitted, because the leg
    merges into the body at the top and a least-squares line through everything
    inside a fixed radius is a line through the ribcage.

    The track is only trustworthy where the leg is separable from the body. It
    is, for the whole shank — the tracked lean of the two hind legs comes back
    at 15.5 and 16.3 degrees against the 15.0 the rig's own shank bone measures.
    It is NOT for the forelegs, which disappear into the chest below the elbow
    and come back at 29-31 degrees against a bone that leans 5. The caller is
    expected to know which is which; see the front/rear split in resculpt().

    Returns [(z, along, lateral), ...] per column, bottom first, extrapolated to
    z_e on the tracked lean.
    """
    a = [p.dot(fwd) for p in ws]
    l = [p.dot(lat) for p in ws]
    out = []
    top = z_c + reach * (z_e - z_c)
    for ca, cl, rad, _n in cols:
        pts = [(z_c, ca, cl)]
        cur_a, cur_l = ca, cl
        band = 0.5 * (top - z_c) / steps
        for k in range(1, steps + 1):
            z0 = z_c + (top - z_c) * (k - 0.5) / steps
            sel = [i for i in range(len(ws))
                   if abs((ws[i].z - floor) - z0) < band
                   and math.hypot(a[i] - cur_a, l[i] - cur_l) < 2.0 * rad]
            if len(sel) < 20:
                break
            cur_a = sum(a[i] for i in sel) / len(sel)
            cur_l = sum(l[i] for i in sel) / len(sel)
            pts.append((z0, cur_a, cur_l))
        dz = pts[-1][0] - pts[0][0]
        if dz > 1e-6 and pts[-1][0] < z_e:
            f = (z_e - pts[-1][0]) / dz
            pts.append((z_e,
                        pts[-1][1] + (pts[-1][1] - pts[0][1]) * f,
                        pts[-1][2] + (pts[-1][2] - pts[0][2]) * f))
        out.append(pts)
    return out


def spine_at(pts, z):
    """Linear interpolation along a tracked leg, clamped at both ends."""
    if z <= pts[0][0]:
        return pts[0][1], pts[0][2]
    if z >= pts[-1][0]:
        return pts[-1][1], pts[-1][2]
    for k in range(1, len(pts)):
        if z <= pts[k][0]:
            z0, a0, l0 = pts[k - 1]
            z1, a1, l1 = pts[k]
            u = (z - z0) / max(1e-9, z1 - z0)
            return a0 + (a1 - a0) * u, l0 + (l1 - l0) * u
    return pts[-1][1], pts[-1][2]


def measure(body, rig, label="", ref=None):
    """Measure the landmarks. `ref` is a previous result: pass it and the three
    surface landmarks are taken as the SAME VERTICES rather than re-detected.

    That is the difference between a before/after and two unrelated readings.
    Re-detection on the sculpted mesh moved the point of shoulder onto an EAR
    (the head is carried over the front feet, and once it is scaled up the ear
    falls into the shoulder height band) and the point of buttock onto the tail.
    A vertex index is a material point on an animal that has not changed
    topology; follow it, exactly as you would follow a chalk mark on a real dog.
    The detection rule still has to be right ONCE, which is what
    --elevation checks by drawing it.
    """
    ws, floor, fwd, crown = body_frame(body, rig)
    phi = rig_yaw(rig, fwd)

    j = bone_point(rig, MARKER_BONE)
    if j is None:
        log(f"FATAL: bone {MARKER_BONE} missing")
        sys.exit(1)
    a_sh = along(j, phi, fwd)
    wither = withers_height(ws, floor, fwd, phi, a_sh)

    # ELBOW. The tail of the upper-arm bone is the humerus/radius joint by
    # construction of the rig. Named explicitly so a rename cannot silently
    # substitute a different joint.
    arm = None
    for cand in ("front_arm.L", "front_upper.L"):
        b = rig.data.bones.get(cand)
        if b is not None and b.use_deform:
            arm = cand
            break
    el = bone_point(rig, arm, "tail")
    elbow = el.z - floor

    lat = Vector((-fwd.y, fwd.x, 0.0))
    a_of = [along(p, 0.0, fwd) for p in ws]
    l_of = [p.dot(lat) for p in ws]
    a_j = along(j, phi, fwd)

    # THE MEDIAN PLANE IS TAKEN OFF THE FOUR PAW PRINTS, not off the lateral
    # extremes. This animal's head is turned ~40 degrees in the rest mesh and
    # his tail is carried to one side, so mid(min, max) sits several hundredths
    # off the true midline — enough that a "median band" narrow enough to
    # exclude a forepaw excludes the sternum too. Four feet on the ice are
    # symmetric whatever the head is doing.
    z_c = (rig.matrix_world @ rig.data.bones["front_lower.L"].tail_local).z - floor
    cols = leg_columns(ws, floor, fwd, lat, z_c, quiet=True)
    l_mid = sum(c[1] for c in cols) / len(cols)
    hip = bone_point(rig, "rear_upper.L")
    a_hip = along(hip, phi, fwd)

    # BRISKET, the chest FLOOR: the lowest point on the median plane forward of
    # the loin AND clear of all four leg columns. Both gates are needed — the
    # forepaws stand only 0.16 x withers off the midline and they splay, so the
    # median band alone catches a toe and the column exclusion alone catches the
    # feathering that hangs off the back of a pastern.
    def off_leg(i):
        return all(math.hypot(a_of[i] - c[0], l_of[i] - c[1]) > 1.6 * c[2] for c in cols)
    if ref:
        bi = ref["_brisket_v"]
    else:
        chest = [i for i in range(len(ws))
                 if abs(l_of[i] - l_mid) < 0.07 * wither
                 and a_of[i] > a_j - 0.30 * wither and off_leg(i)]
        bi = min(chest, key=lambda i: ws[i].z)
    brisket = ws[bi].z - floor

    # BODY LENGTH, point of shoulder to point of buttock — the standard "is he
    # square?" measurement. Both are bony points at roughly joint height, so both
    # are taken in a band around the joint they belong to AND off the midline.
    #
    # SEPARATING THE BUTTOCK FROM THE TAIL IS THE WHOLE TRICK, and two earlier
    # versions of this got it wrong in two different ways. The rearmost thing on
    # this animal is the tail: carried low, heavily feathered, reaching 0.33 x
    # withers further back than the rump, and it returned a body length of 1.36
    # for a dog whose body is 1.15. It cannot be excluded by weight —
    # tail.01/02/03 carry NO vertices at all on this rig — nor by height,
    # because it hangs straight through the hip band, nor by distance from the
    # median plane, because it is carried to one side.
    #
    # What is always true is that a rump is WIDE and a tail is not. Binned along
    # the body at hip height this rig measures 0.40-0.48 x withers across the
    # hindquarter and 0.13-0.27 down the tail, so the point of buttock is the
    # rearmost station still carrying 60% of the widest bin.
    #
    # The front needs none of that; what it needs is to not measure the JAW,
    # since the head is carried over the front feet. The jaw is narrow, the
    # chest at shoulder height is not.
    if ref:
        fi, ri = ref["_front_v"], ref["_rear_v"]
    else:
        fband = [i for i in range(len(ws))
                 if abs(ws[i].z - j.z) < 0.12 * wither
                 and abs(l_of[i] - l_mid) > 0.13 * wither]
        fi = max(fband, key=lambda i: a_of[i])

        rband = [i for i in range(len(ws)) if abs(ws[i].z - hip.z) < 0.16 * wither]
        step = 0.04 * wither
        bins = {}
        for i in rband:
            bins.setdefault(int(math.floor(a_of[i] / step)), []).append(i)
        wid = {k: max(l_of[i] for i in v) - min(l_of[i] for i in v)
               for k, v in bins.items() if len(v) > 12}
        wmax = max(wid.values())
        solid = [k for k, w in wid.items() if w >= 0.60 * wmax]
        ri = min(bins[min(solid)], key=lambda i: a_of[i])
    length = a_of[fi] - a_of[ri]
    trunk = [i for i in range(len(ws)) if a_of[ri] <= a_of[i] <= a_of[fi]]

    crown_h = crown.z - floor

    r = {
        "withers": wither,
        "elbow": elbow / wither,
        "brisket": brisket / wither,
        "length": length / wither,
        "crown": crown_h / wither,
        "_elbow_u": elbow, "_brisket_u": brisket, "_length_u": length,
        "_crown_u": crown_h, "_floor": floor, "_arm": arm,
        "_brisket_v": bi, "_front_v": fi, "_rear_v": ri,
        "_a_sh": a_sh, "_fwd": fwd, "_phi": phi, "_l_mid": l_mid, "_cols": cols,
    }
    for nm, i in (("brisket", bi), ("pt-shoulder", fi), ("pt-buttock", ri)):
        log(f"  landmark {nm:<12} #{i:<6} along {a_of[i]:+.4f}  "
            f"z {(ws[i].z - floor) / wither:.3f}w  "
            f"off-midline {abs(l_of[i] - l_mid) / wither:.3f}w")
    if "--profile" in sys.argv:
        hip = bone_point(rig, "rear_upper.L")
        a_hip = along(hip, phi, fwd)
        log(f"  shoulder joint along {a_sh:+.4f} z {(j.z-floor)/wither:.3f}w ; "
            f"hip joint along {a_hip:+.4f} z {(hip.z-floor)/wither:.3f}w ; "
            f"joint-to-joint {abs(a_sh-a_hip)/wither:.3f}w")
        log("  TRUNK PROFILE (along, normalised to withers; 0 = shoulder joint, "
            "+ = forward):")
        lo_a, hi_a = min(a_tr), max(a_tr)
        for k in range(14):
            a0 = lo_a + (hi_a - lo_a) * k / 14.0
            a1 = lo_a + (hi_a - lo_a) * (k + 1) / 14.0
            sl = [ws[i] for i in trunk if a0 <= a_of[i] < a1]
            if not sl:
                continue
            top = (max(p.z for p in sl) - floor) / wither
            bot = (min(p.z for p in sl) - floor) / wither
            wid = (max(p.dot(Vector((-fwd.y, fwd.x, 0.0))) for p in sl)
                   - min(p.dot(Vector((-fwd.y, fwd.x, 0.0))) for p in sl)) / wither
            log(f"    along {(0.5*(a0+a1)-a_sh)/wither:+.3f}w  "
                f"top {top:.3f}  bottom {bot:.3f}  width {wid:.3f}  ({len(sl)} v)")
    if label:
        report(r, label)
    return r


def report(r, label):
    log("=" * 62)
    log(f"{label}")
    log("=" * 62)
    log(f"  withers (topline over the shoulder joint)  {r['withers']:.4f} u  = 1.000")
    for k, name in (("elbow", f"elbow  (tail of {r['_arm']})       "),
                    ("brisket", "brisket (lowest sternum vert)       "),
                    ("length", "length  (pt shoulder -> pt buttock)  "),
                    ("crown", "crown   (highest skull vert)         ")):
        lo, hi = TARGET[k]
        flag = "OK " if lo <= r[k] <= hi else "OUT"
        log(f"  {name} {r['_' + k + '_u']:.4f} u  = {r[k]:.4f} x withers"
            f"   target {lo:.2f}-{hi:.2f}  [{flag}]")
    log(f"  at CAST.dogHeight 0.58 m: elbow {0.58*r['elbow']*100:.1f} cm, "
        f"brisket {0.58*r['brisket']*100:.1f} cm, body {0.58*r['length']*100:.1f} cm, "
        f"crown {0.58*r['crown']*100:.1f} cm")


# --------------------------------------------------------------- elevation
def elevation(body, rig, r, out_dir, tag):
    """Orthographic side + front elevations with the landmark heights drawn on.

    The numbers above are only trustworthy if somebody can look at where they
    landed. This renders the animal flat-on against a neutral card with a line
    at the withers, the elbow and the brisket, and two verticals at the point of
    shoulder and the point of buttock — so a wrong landmark shows up as a line
    through the wrong part of the dog rather than as a plausible ratio.
    """
    sc = bpy.context.scene
    fwd, floor, w = r["_fwd"], r["_floor"], r["withers"]
    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    lat = Vector((-fwd.y, fwd.x, 0.0))
    a_of = [along(p, 0.0, fwd) for p in ws]
    ctr_lat = sum(p.dot(lat) for p in ws) / len(ws)
    a_mid = 0.5 * (max(a_of) + min(a_of))

    marks = bpy.data.collections.new("__marks")
    sc.collection.children.link(marks)

    def bar(z, a0, a1, colour, thick=0.012):
        me = bpy.data.meshes.new("bar")
        c = (a0 + a1) * 0.5
        vs = []
        for da, dz in ((a0 - c, -thick), (a1 - c, -thick), (a1 - c, thick), (a0 - c, thick)):
            p = fwd * (c + da) + lat * ctr_lat + Vector((0, 0, z + dz))
            vs.append(p)
        me.from_pydata(vs, [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new("bar", me)
        m = bpy.data.materials.new("barmat")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = (*colour, 1)
        em.inputs[1].default_value = 3.0
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], o.inputs["Surface"])
        me.materials.append(m)
        marks.objects.link(ob)
        return ob

    a_lo, a_hi = min(a_of) - 0.1, max(a_of) + 0.1
    bar(floor + w, a_lo, a_hi, (0.20, 0.85, 1.00))            # withers, cyan
    bar(floor + r["_elbow_u"], a_lo, a_hi, (1.00, 0.35, 0.20))  # elbow, orange
    bar(floor + r["_brisket_u"], a_lo, a_hi, (0.35, 1.00, 0.35))  # brisket, green
    bar(floor, a_lo, a_hi, (0.6, 0.6, 0.6))                    # ice
    for i, col in ((r["_front_v"], (1.0, 0.9, 0.2)), (r["_rear_v"], (1.0, 0.9, 0.2))):
        a = a_of[i]
        me = bpy.data.meshes.new("v")
        vs = [fwd * a + lat * ctr_lat + Vector((0, 0, floor - 0.05)) + lat * dx
              + Vector((0, 0, dz)) for dx, dz in
              ((0, 0), (0, w * 1.35), (0, w * 1.35), (0, 0))]
        vs[0] = fwd * (a - 0.010) + lat * ctr_lat + Vector((0, 0, floor - 0.05))
        vs[1] = fwd * (a - 0.010) + lat * ctr_lat + Vector((0, 0, floor + w * 1.35))
        vs[2] = fwd * (a + 0.010) + lat * ctr_lat + Vector((0, 0, floor + w * 1.35))
        vs[3] = fwd * (a + 0.010) + lat * ctr_lat + Vector((0, 0, floor - 0.05))
        me.from_pydata(vs, [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new("v", me)
        m = bpy.data.materials.new("vm")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = (*col, 1)
        em.inputs[1].default_value = 2.0
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], o.inputs["Surface"])
        me.materials.append(m)
        marks.objects.link(ob)

    # A flat matte coat: this render is about SHAPE, so nothing may flatter it.
    flat = bpy.data.materials.new("Elev")
    flat.use_nodes = True
    nt = flat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    d.inputs[0].default_value = (0.42, 0.30, 0.16, 1)
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(d.outputs[0], o.inputs["Surface"])
    saved = [s.material for s in body.material_slots]
    body.data.materials.clear()
    body.data.materials.append(flat)
    for ob in bpy.data.objects:
        if ob.type == "LIGHT":
            ob.hide_render = True
    fl = bpy.data.objects.get("PreviewFloor")
    if fl:
        fl.hide_render = True

    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1100
    sc.render.resolution_y = 900
    sc.render.film_transparent = False
    wd = sc.world
    wd.use_nodes = True
    bg = wd.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.14, 0.15, 0.17, 1)
        bg.inputs[1].default_value = 1.0

    cd = bpy.data.cameras.new("Elev")
    cd.type = "ORTHO"
    cd.ortho_scale = (max(a_of) - min(a_of)) * 1.30
    cam = bpy.data.objects.new("Elev", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    aim = fwd * a_mid + lat * ctr_lat + Vector((0, 0, floor + w * 0.62))
    for name, d3 in (("side", lat), ("front", fwd)):
        cam.location = aim + d3.normalized() * 12.0
        cam.rotation_euler = (aim - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        sc.render.filepath = os.path.join(out_dir, f"elev-{tag}-{name}.png")
        bpy.ops.render.render(write_still=True)
        log(f"elevation -> {sc.render.filepath}")
    body.data.materials.clear()
    for m in saved:
        body.data.materials.append(m)
    for ob in list(marks.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    sc.collection.children.unlink(marks)
    bpy.data.cameras.remove(cd)


def main():
    body = bpy.data.objects.get(BODY)
    rig = bpy.data.objects.get(RIG)
    if body is None or rig is None:
        log("FATAL: RetrieverBody / RetrieverRig not in this file")
        sys.exit(1)
    log(f"bones ({len(rig.data.bones)}): {[b.name for b in rig.data.bones]}")
    log(f"deform bones: {[b.name for b in rig.data.bones if b.use_deform]}")
    log(f"vertex groups: {[g.name for g in body.vertex_groups]}")
    log(f"actions: {[(a.name, tuple(a.frame_range)) for a in bpy.data.actions]}")
    r = measure(body, rig, os.path.basename(bpy.data.filepath) or "(current file)")
    if "--elevation" in sys.argv:
        i = sys.argv.index("--elevation")
        out_dir = sys.argv[i + 1] if len(sys.argv) > i + 1 else "."
        tag = sys.argv[i + 2] if len(sys.argv) > i + 2 else "before"
        os.makedirs(out_dir, exist_ok=True)
        elevation(body, rig, r, out_dir, tag)


if __name__ == "__main__":
    main()
