# Rebuild the retriever's armature IN THE MESH'S OWN FRAME, and bind it.
#
#   blender --background --python scripts/blender/rebuild-rig.py -- \
#       [--src <in.glb>] [--out <out.blend>]
#
# WHY THIS IS A REBUILD AND NOT A REBIND.
#
# The handoff calls this "rebind the skinning", on the reading that some vertex
# groups are empty and one is too heavy. check-registration.py says otherwise,
# and it is not close:
#
#     16 of 23 deform bones lie ENTIRELY OUTSIDE THE MESH
#     the mesh is yawed +50.5 degrees from the armature
#     the mesh's own four paw prints sit at world XY
#         (-0.80,-0.06) (-0.40,-0.39) (-0.01,+0.95) (+0.59,+0.58)
#     while the armature's four legs sit at y = +/-0.25, x in [-0.6, +0.5]
#
# The armature is a generic dog rig that was never placed on this animal.
# Automatic weighting was then asked to bind it and did the only thing it could:
# it gave each vertex to whichever bone happened to be nearest in a frame where
# nothing lines up. That is why `ear.L` owns 22% of the mesh and `rear_upper.R`
# owns another 15% — those bones happen to be buried in the torso. You cannot
# repaint your way out of it, because there is no bone in the left hind leg to
# paint TO.
#
# So the mesh is ground truth — it carries the UVs and both bakes — and the
# armature is rebuilt against it. Every bone is placed from a measurement.
#
# THE FRAME IS NOT THE MESH'S PCA AXIS.
# measure-retriever.py takes the nose-tail axis from the XY covariance of every
# vertex. On this animal that is 16 degrees off, because the tail plume is heavy
# and swings to one side and drags the axis with it. A frame that is 16 degrees
# out puts the midline through one shoulder, which is how the first attempt
# found an "ear" out on the muzzle. So the frame here is the animal's MEDIAN
# PLANE, found by searching yaw and offset for the mirror that best maps the
# mesh onto itself. That is a real anatomical feature and it is what left and
# right mean.
#
# THE WEIGHTS ARE NOT bpy.ops HEAT.
# ARMATURE_AUTO returns success in background mode and assigns nothing — all
# 8427 vertices came back with zero total weight. Rather than fight an operator
# that cannot report, the weighting is done here: inverse-power falloff to the
# nearest bones, gated by whether the bone can be SEEN from the vertex through
# the interior, then Laplacian-smoothed over the mesh graph. The visibility gate
# is what stops the left leg from being driven by the right femur.

import math
import os
import sys

import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEF_SRC = os.path.join(REPO, "apps", "web", "public", "models", "retriever.glb")
DEF_OUT = os.path.join(REPO, "assets", "3d", "retriever-rebound.blend")

MAX_INF = 4          # glTF's four influences per vertex
# Inverse-power falloff. 4.0 concentrates almost all of a vertex on its nearest
# bone, which is what shredded the withers when the head turned: the boundary
# between the head group and the chest group was one edge wide, so the two sides
# of that edge went 30 degrees apart. 2.6 leaves a real blend zone.
FALLOFF = 2.6
OCCLUDED = 0.10     # weight multiplier for a bone the vertex cannot see
SMOOTH_ITERS = 34
SMOOTH_LAMBDA = 0.55
PROBE = False


def log(m):
    print(f"[rig] {m}", flush=True)


def seg_dist(p, a, b):
    ab = b - a
    L2 = ab.dot(ab)
    if L2 < 1e-12:
        return (p - a).length, a.copy()
    t = max(0.0, min(1.0, (p - a).dot(ab) / L2))
    q = a + ab * t
    return (p - q).length, q


# ------------------------------------------------------------------- frame
class Frame:
    """The animal's own coordinate system: along (nose +), lat, up.

    The yaw and the midline come from the MEDIAN PLANE, found by mirroring the
    mesh about a candidate plane and measuring how well it lands back on itself.
    """

    def __init__(self, body):
        ws = [body.matrix_world @ v.co for v in body.data.vertices]
        self.ws = ws
        self.floor = min(p.z for p in ws)
        self.top = max(p.z for p in ws)
        self.H = self.top - self.floor

        kd = KDTree(len(ws))
        for i, p in enumerate(ws):
            kd.insert(p, i)
        kd.balance()

        # sample for the search; every vertex for the final refine
        step = max(1, len(ws) // 1400)
        S = ws[::step]

        def cost(theta, c):
            lat = Vector((-math.sin(theta), math.cos(theta), 0.0))
            tot = 0.0
            for p in S:
                d = p.dot(lat) - c
                q = p - lat * (2.0 * d)
                _co, _i, dist = kd.find(q)
                tot += dist
            return tot / len(S)

        best = None
        for k in range(72):                       # 2.5-degree sweep, 180 deg
            th = math.pi * k / 72.0
            lat = Vector((-math.sin(th), math.cos(th), 0.0))
            ls = sorted(p.dot(lat) for p in ws)
            c0 = ls[len(ls) // 2]
            for dc in (-0.05, 0.0, 0.05):
                c = c0 + dc * self.H
                v = cost(th, c)
                if best is None or v < best[0]:
                    best = (v, th, c)
        # refine
        for scale, n in ((0.02, 9), (0.004, 9), (0.0008, 9)):
            v0, th0, c0 = best
            for i in range(n):
                th = th0 + (i - n // 2) * scale
                for j in range(n):
                    c = c0 + (j - n // 2) * scale * self.H
                    v = cost(th, c)
                    if v < best[0]:
                        best = (v, th, c)
        err, th, c = best
        lat = Vector((-math.sin(th), math.cos(th), 0.0))
        fwd = Vector((math.cos(th), math.sin(th), 0.0))
        # Orient by the CROWN. On a standing dog the highest point of the whole
        # animal is the top of the skull, so whichever end of the long axis the
        # crown sits on is the head. Vertex counts do not decide this — the
        # feathered plume carries as many vertices as the skull, which is what
        # flipped the first attempt and sent the buttock search into the face.
        aa = [p.dot(fwd) for p in ws]
        ctr_a = 0.5 * (min(aa) + max(aa))
        crown = max(ws, key=lambda p: p.z)
        flip = crown.dot(fwd) < ctr_a
        if flip:
            fwd, lat = -fwd, -lat
        self.fwd, self.lat = fwd, lat
        self.mid_l = -c if flip else c
        self.up = Vector((0.0, 0.0, 1.0))
        self.a = [p.dot(fwd) for p in ws]
        self.l = [p.dot(lat) for p in ws]
        self.z = [p.z - self.floor for p in ws]
        self.sym_err = err
        log(f"median plane: yaw {math.degrees(math.atan2(fwd.y, fwd.x)):+.2f} deg, "
            f"midline lat {self.mid_l:+.4f}, mirror residual "
            f"{err / self.H * 100:.2f}% of H")

    def world(self, a, l, z):
        return self.fwd * a + self.lat * l + Vector((0.0, 0.0, self.floor + z))


def width_profile(F, n=80, z_lo=0.30, z_hi=0.95):
    """Lateral width per along-station, over the body only.

    Width is what separates the tail from the rump: the plume is feathered and
    as DEEP as a thigh, so a cross-section radius cannot tell them apart, but
    the tail is a fifth of the body's width and the rump is all of it.
    """
    a0, a1 = min(F.a), max(F.a)
    out = []
    for k in range(n):
        lo = a0 + (a1 - a0) * k / n
        hi = a0 + (a1 - a0) * (k + 1) / n
        sel = [i for i in range(len(F.ws))
               if lo <= F.a[i] < hi and z_lo * F.H < F.z[i] < z_hi * F.H]
        if len(sel) < 8:
            out.append((0.5 * (lo + hi), 0.0, 0))
            continue
        w = max(F.l[i] for i in sel) - min(F.l[i] for i in sel)
        out.append((0.5 * (lo + hi), w, len(sel)))
    return out


def depth_profile(F, n=80, half=0.10, z_lo=0.25):
    """Depth of the MEDIAN-PLANE silhouette per along-station: topline to
    underline, measured in a thin slice down the middle of the animal.

    This is the measurement that finds the neck, and width is not. A golden's
    neck carries a heavy ruff, so laterally it is as wide as the chest and the
    width profile has no minimum there at all — that put the neck base at
    +0.748, forward of the skull's own back, and the head chain started inside
    the skull.

    The slice has to be thin. Measuring depth over the whole cross-section put
    it at +0.231, back in the chest, because the tops of the front legs sit at
    the same height as the throat and fill in the gap under the neck. The legs
    are out at 0.25-0.30 laterally; the throat and the sternum are on the
    midline. So: chest 0.35 H deep, head 0.34 H, neck 0.17 H.
    """
    a0, a1 = min(F.a), max(F.a)
    out = []
    for k in range(n):
        lo = a0 + (a1 - a0) * k / n
        hi = a0 + (a1 - a0) * (k + 1) / n
        sel = [i for i in range(len(F.ws))
               if lo <= F.a[i] < hi and F.z[i] > z_lo * F.H
               and abs(F.l[i] - F.mid_l) < half * F.H]
        if len(sel) < 8:
            out.append((0.5 * (lo + hi), 0.0, 0))
            continue
        d = max(F.z[i] for i in sel) - min(F.z[i] for i in sel)
        out.append((0.5 * (lo + hi), d, len(sel)))
    return out


def find_buttock(F, prof):
    """The rump face is the biggest STEP in width, walking forward from the tip.

    A threshold on width does not survive here. The plume is feathered and
    reaches 0.21 H across at its base against a body maximum of 0.40 H, so any
    threshold low enough to clear the plume also clears half the hindquarter —
    a 0.52 cut put the buttock at -1.19, which is 0.18 units from the tail TIP
    and left the tail three bones long over nothing. The step from 0.159 to
    0.297 across two stations, on the other hand, is twice any other change
    anywhere on the animal.
    """
    lo, hi = min(F.a), max(F.a)
    lim = lo + 0.45 * (hi - lo)
    best = None
    for k in range(len(prof) - 2):
        if prof[k][0] > lim:
            break
        if prof[k][2] < 8 or prof[k + 2][2] < 8:
            continue
        step = prof[k + 2][1] - prof[k][1]
        if best is None or step > best[0]:
            best = (step, prof[k + 1][0])
    return best[1] if best else lo + 0.20 * (hi - lo)


def leg_columns(F, z_c):
    """Four paw prints. Below the carpus there is nothing on this animal but
    feet, so the vertices under that line ARE the four paws; splitting them
    about the measured midline and their own fore/aft median separates them."""
    paw = [i for i in range(len(F.ws)) if F.z[i] < z_c]
    if len(paw) < 200:
        log(f"FATAL: only {len(paw)} verts below the carpus")
        sys.exit(1)
    am = sorted(F.a[i] for i in paw)[len(paw) // 2]
    cols = {}
    for sa, na in ((1.0, "front"), (-1.0, "rear")):
        # lat = up x fwd, which points to the animal's LEFT, so l ABOVE the
        # midline is his left side. The first pass had these two backwards.
        for sl, nl in ((1.0, "L"), (-1.0, "R")):
            sel = [i for i in paw
                   if (F.a[i] - am) * sa > 0 and (F.l[i] - F.mid_l) * sl > 0]
            if len(sel) < 25:
                log(f"FATAL: leg {na}.{nl} has only {len(sel)} verts")
                sys.exit(1)
            ca = sum(F.a[i] for i in sel) / len(sel)
            cl = sum(F.l[i] for i in sel) / len(sel)
            rad = sum(math.hypot(F.a[i] - ca, F.l[i] - cl)
                      for i in sel) / len(sel)
            toe = max(sel, key=lambda i: F.a[i] * sa)
            cols[f"{na}.{nl}"] = dict(a=ca, l=cl, r=rad, n=len(sel),
                                      toe_a=F.a[toe])
    return cols


def track_leg(F, col, z_c, z_top, steps=9):
    """Walk a leg upward from its paw print, re-centring at each step.

    A leg is not a vertical cylinder — the shank leans ~14 degrees — so a mask
    built on the paw's centre alone loses the top of the leg and catches the
    belly instead. Tracked rather than fitted, because the leg merges into the
    body at the top and a line fitted through everything inside a fixed radius
    is a line through the ribcage.
    """
    pts = [(z_c * 0.5, col["a"], col["l"])]
    ca, cl = col["a"], col["l"]
    band = 0.6 * (z_top - z_c) / steps
    for k in range(1, steps + 1):
        z0 = z_c + (z_top - z_c) * (k - 0.5) / steps
        sel = [i for i in range(len(F.ws))
               if abs(F.z[i] - z0) < band
               and math.hypot(F.a[i] - ca, F.l[i] - cl) < 2.1 * col["r"]]
        if len(sel) < 12:
            break
        ca = sum(F.a[i] for i in sel) / len(sel)
        cl = sum(F.l[i] for i in sel) / len(sel)
        pts.append((z0, ca, cl))
    return pts


def leg_at(pts, z):
    if z <= pts[0][0]:
        return pts[0][1], pts[0][2]
    if z >= pts[-1][0]:
        z0, a0, l0 = pts[max(0, len(pts) - 3)]
        z1, a1, l1 = pts[-1]
        if z1 - z0 > 1e-6:
            f = (z - z1) / (z1 - z0)
            return a1 + (a1 - a0) * f, l1 + (l1 - l0) * f
        return pts[-1][1], pts[-1][2]
    for k in range(1, len(pts)):
        if z <= pts[k][0]:
            z0, a0, l0 = pts[k - 1]
            z1, a1, l1 = pts[k]
            u = (z - z0) / max(1e-9, z1 - z0)
            return a0 + (a1 - a0) * u, l0 + (l1 - l0) * u
    return pts[-1][1], pts[-1][2]


def trunk_line(F, a_lo, a_hi, z_floor_frac, n=20):
    """Centroid of each along-slab above the brisket, back to front. The legs
    and the tail hang below the cut, so they do not drag the line down."""
    out = []
    for k in range(n):
        lo = a_lo + (a_hi - a_lo) * k / n
        hi = a_lo + (a_hi - a_lo) * (k + 1) / n
        sel = [i for i in range(len(F.ws))
               if lo <= F.a[i] < hi and F.z[i] > z_floor_frac * F.H]
        if len(sel) < 12:
            continue
        out.append((sum(F.a[i] for i in sel) / len(sel),
                    sum(F.l[i] for i in sel) / len(sel),
                    sum(F.z[i] for i in sel) / len(sel)))
    return out


def trunk_at(line, a):
    if a <= line[0][0]:
        return line[0][1], line[0][2]
    if a >= line[-1][0]:
        return line[-1][1], line[-1][2]
    for k in range(1, len(line)):
        if a <= line[k][0]:
            a0, l0, z0 = line[k - 1]
            a1, l1, z1 = line[k]
            u = (a - a0) / max(1e-9, a1 - a0)
            return l0 + (l1 - l0) * u, z0 + (z1 - z0) * u
    return line[-1][1], line[-1][2]


def trace_tail(F, a_butt):
    """Everything behind the point of buttock, on its own principal axis."""
    T = [i for i in range(len(F.ws)) if F.a[i] < a_butt]
    if len(T) < 100:
        return None
    ctr = sum((F.ws[i] for i in T), Vector((0, 0, 0))) / len(T)
    axis = (-F.fwd).copy()
    for _ in range(30):
        acc = Vector((0, 0, 0))
        for i in T:
            d = F.ws[i] - ctr
            acc += d * d.dot(axis)
        if acc.length < 1e-9:
            break
        axis = acc.normalized()
    if axis.dot(-F.fwd) < 0:
        axis = -axis
    proj = [(F.ws[i] - ctr).dot(axis) for i in T]
    p0, p1 = min(proj), max(proj)
    NS = 10
    spine = []
    for k in range(NS):
        lo = p0 + (p1 - p0) * k / NS
        hi = p0 + (p1 - p0) * (k + 1) / NS
        sel = [T[j] for j in range(len(T)) if lo <= proj[j] < hi]
        if len(sel) < 8:
            continue
        spine.append(sum((F.ws[i] for i in sel), Vector((0, 0, 0))) / len(sel))
    if len(spine) < 4:
        return None
    keep = spine[:max(4, int(round(len(spine) * 0.88)))]
    return keep, len(T)


def resample(pts, n):
    seg = [(pts[k + 1] - pts[k]).length for k in range(len(pts) - 1)]
    total = sum(seg)
    out = [pts[0]]
    for k in range(1, n + 1):
        want = total * k / n
        acc = 0.0
        for j, s in enumerate(seg):
            if acc + s >= want - 1e-12:
                u = (want - acc) / max(1e-9, s)
                out.append(pts[j].lerp(pts[j + 1], min(1.0, u)))
                break
            acc += s
        else:
            out.append(pts[-1])
    return out


# ------------------------------------------------------------------- build
def build(F, body):
    H = F.H
    log(f"mesh height H = {H:.4f}  floor z = {F.floor:.4f}")

    wprof = width_profile(F)
    if PROBE:
        log("  along      width/H   n     upper-width/H  n")
        up = width_profile(F, z_lo=0.62, z_hi=1.0)
        for k in range(len(wprof)):
            log(f"  {wprof[k][0]:+7.3f}  {wprof[k][1] / H:7.3f} {wprof[k][2]:>5}"
                f"      {up[k][1] / H:7.3f} {up[k][2]:>5}")
    a_butt = find_buttock(F, wprof)
    a_nose = max(F.a)
    log(f"along: tail tip {min(F.a):+.3f} | buttock {a_butt:+.3f} | "
        f"nose {a_nose:+.3f}   (body width max "
        f"{max(p[1] for p in wprof) / H:.2f} H)")

    z_c = 0.115 * H
    cols = leg_columns(F, z_c)
    for k in ("front.L", "front.R", "rear.L", "rear.R"):
        c = cols[k]
        log(f"  paw {k:<8} along {c['a']:+.3f} lat {c['l'] - F.mid_l:+.3f} "
            f"r {c['r']:.3f} ({c['n']} verts)")

    tracks = {k: track_leg(F, c, z_c, 0.62 * H) for k, c in cols.items()}
    for k in ("front.L", "front.R", "rear.L", "rear.R"):
        t = tracks[k]
        lean = math.degrees(math.atan2(
            math.hypot(t[-1][1] - t[0][1], t[-1][2] - t[0][2]),
            max(1e-6, t[-1][0] - t[0][0])))
        log(f"  leg {k:<8} tracked to z/H {t[-1][0] / H:.2f} "
            f"({len(t)} stations, lean {lean:.1f} deg)")

    line = trunk_line(F, a_butt, a_nose, 0.56)
    tail = trace_tail(F, a_butt)
    if tail is None:
        log("FATAL: tail not resolvable")
        sys.exit(1)
    tail_pts, tail_n = tail
    log(f"  tail: {tail_n} verts behind the buttock, {len(tail_pts)} stations, "
        f"{(tail_pts[-1] - tail_pts[0]).length / H:.2f} H long")

    a_sh = 0.5 * (cols["front.L"]["a"] + cols["front.R"]["a"])
    crown_i = max(range(len(F.ws)), key=lambda i: F.z[i])
    nose_i = max(range(len(F.ws)), key=lambda i: F.a[i])
    crown_a, crown_z = F.a[crown_i], F.z[crown_i]
    log(f"  shoulder along {a_sh:+.3f}; crown along {crown_a:+.3f} z/H "
        f"{crown_z / H:.2f}; nose along {F.a[nose_i]:+.3f} z/H "
        f"{F.z[nose_i] / H:.2f}")

    # The neck cannot be found from an along-profile on this animal, by width or
    # by depth, and both were tried. He carries his head FORWARD rather than up,
    # so the neck lies directly over the chest: one along-station cuts the neck
    # crest, the throat, the sternum and the brisket together, and every profile
    # just descends from the chest to the loin with no minimum anywhere near the
    # skull. Width said +0.748, depth said +0.231; the skull's back is at +0.63.
    #
    # So the head is placed from the two landmarks on this animal that cannot be
    # mistaken for anything else — the CROWN, the highest vertex, which on a
    # drop-eared dog is the top of the skull, and the NOSE, the furthest forward.
    # The occiput sits behind the crown by as much as the crown sits in front of
    # the nose. That reflection reads +0.602 against +0.627 measured off the
    # render, and it works through the head's turn because it is done in 3D.
    a_neck = a_sh
    crown_p = max(F.ws, key=lambda p: p.z)
    nose_p = max(F.ws, key=lambda p: p.dot(F.fwd))
    atlas = Vector((2.0 * crown_p.x - nose_p.x,
                    2.0 * crown_p.y - nose_p.y,
                    crown_p.z - 0.22 * H))
    log(f"  atlas along {atlas.dot(F.fwd):+.3f} z/H "
        f"{(atlas.z - F.floor) / H:.2f}; spine ends at shoulder {a_sh:+.3f}")

    # ================================================================ ARMATURE
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(body.modifiers):
        if m.type == "ARMATURE":
            body.modifiers.remove(m)
    while body.vertex_groups:
        body.vertex_groups.remove(body.vertex_groups[0])
    body.parent = None

    arm = bpy.data.armatures.new("RetrieverRig")
    rig = bpy.data.objects.new("RetrieverRig", arm)
    bpy.context.scene.collection.objects.link(rig)
    rig.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None, deform=True, connect=False):
        b = eb.new(name)
        b.head = head
        b.tail = tail
        b.use_deform = deform
        b.use_connect = connect
        if parent:
            b.parent = eb[parent]
        return b

    W = F.world
    M = F.mid_l

    a_root = 0.5 * (a_butt + a_sh)
    bone("root", W(a_root, M, 0.0), W(a_root, M, 0.22 * H), None, deform=False)

    # The spine chain stops SHORT of the shoulder. Running it all the way to
    # a_sh left `neck` 0.05 H long — a stub buried in the shoulder mass owning a
    # blob with a one-edge boundary, and the sniff pose tore the withers open
    # along it. He carries his head over his front feet, so the neck is steep
    # and short, but it still has to be a bone rather than a point.
    a_spine_end = a_sh - 0.15 * H
    spine_a = [a_butt + (a_spine_end - a_butt) * k / 4.0 for k in range(5)]
    spine_p = []
    for a in spine_a:
        l, z = trunk_at(line, a)
        spine_p.append(W(a, l, z))
    names = ["hips", "spine.01", "spine.02", "chest"]
    for k, nm in enumerate(names):
        bone(nm, spine_p[k], spine_p[k + 1],
             "root" if k == 0 else names[k - 1], connect=(k > 0))

    # ---- head chain, on the HEAD's own axis --------------------------------
    # This animal's head is turned. Laying the skull, muzzle and ears on the
    # BODY's midline puts the muzzle bone outside the muzzle and hands one ear
    # a piece of the cheek — the first attempt found "ear.R" 0.60 out from a
    # midline the head is only 0.41 wide about, because it was measuring the
    # turned head against the straight body. So the head gets its own frame:
    # the axis is atlas-to-nose, and left and right are taken across THAT.
    bone("neck", spine_p[-1], atlas, "chest", connect=True)

    hax = (nose_p - atlas)
    hlen = hax.length
    hax = hax / hlen
    sk = [i for i in range(len(F.ws))
          if (F.ws[i] - atlas).dot(hax) > 0.04 * hlen and F.z[i] > 0.55 * H]
    hlat = Vector((-hax.y, hax.x, 0.0))
    if hlat.length < 1e-6:
        hlat = F.lat.copy()
    hlat.normalize()
    hmid = sum((F.ws[i].dot(hlat) for i in sk)) / len(sk)
    log(f"  head axis {tuple(round(v, 3) for v in hax)}, length "
        f"{hlen / H:.2f} H, head midline offset from body "
        f"{(hmid - F.mid_l * F.lat.dot(hlat)):+.3f}")

    bone("head", atlas, atlas + hax * (hlen * 0.52), "neck", connect=True)
    bone("muzzle", atlas + hax * (hlen * 0.52), atlas + hax * (hlen * 0.94),
         "head", connect=True)
    bone("jaw", atlas + hax * (hlen * 0.40) - Vector((0, 0, 0.045 * H)),
         atlas + hax * (hlen * 0.88) - Vector((0, 0, 0.075 * H)), "head")

    # ears: the head's lateral lobes, over its back half
    ha = [(F.ws[i] - atlas).dot(hax) / hlen for i in sk]
    for sl, nl in ((1.0, "L"), (-1.0, "R")):
        side = [j for j, i in enumerate(sk)
                if 0.02 < ha[j] < 0.62
                and (F.ws[i].dot(hlat) - hmid) * sl > 0]
        side.sort(key=lambda j: -abs(F.ws[sk[j]].dot(hlat) - hmid))
        tip = [sk[j] for j in side[:max(10, len(side) // 4)]]
        c = sum((F.ws[i] for i in tip), Vector((0, 0, 0))) / len(tip)
        off = (c.dot(hlat) - hmid)
        h = atlas + hax * (hlen * 0.36) + hlat * (off * 0.34) \
            + Vector((0, 0, 0.05 * H))
        bone(f"ear.{nl}", h, c - Vector((0, 0, 0.04 * H)), "head")
        log(f"  ear.{nl}: head-lat offset {off:+.3f}, "
            f"head-along {(c - atlas).dot(hax) / hlen:.2f}, "
            f"z/H {(c.z - F.floor) / H:.2f} ({len(tip)} of {len(side)} verts)")

    tp = resample(tail_pts, 3)
    for k, nm in enumerate(("tail.01", "tail.02", "tail.03")):
        bone(nm, tp[k], tp[k + 1], "hips" if k == 0 else f"tail.0{k}",
             connect=(k > 0))

    # Joint heights, as fractions of the animal's CROWN height. The along and
    # lateral of each joint comes off the TRACKED leg, which is where the
    # measurement is trustworthy; only the heights are anatomy.
    #
    # Quoted against the withers, which on this animal measures 0.77 of the
    # crown: shoulder 0.72 Wt, elbow 0.53 Wt, carpus 0.20 Wt; hip 0.68 Wt,
    # stifle 0.42 Wt, hock 0.25 Wt. The first pass put both upper bones at 0.78
    # of crown height — i.e. AT the topline, so the femur ran from the spine
    # rather than from the hip, and any sit dragged the whole rump down with it.
    Wt = 0.77
    JOINTS = {"front": (0.72 * Wt, 0.53 * Wt, 0.20 * Wt),
              "rear": (0.68 * Wt, 0.42 * Wt, 0.25 * Wt)}
    for which in ("front", "rear"):
        z_top, z_mid, z_low = (f * H for f in JOINTS[which])
        for nl in ("L", "R"):
            key = f"{which}.{nl}"
            tr, col = tracks[key], cols[key]
            a_mid, l_mid = leg_at(tr, z_mid)
            a_low, l_low = leg_at(tr, z_low)
            a_hi, l_hi = leg_at(tr, z_top)
            l_trunk, _z = trunk_at(line, a_hi)
            l_hi = l_trunk + (l_hi - l_trunk) * 0.42
            up_n, lo_n, pw_n = (f"{which}_upper.{nl}", f"{which}_lower.{nl}",
                                f"{which}_paw.{nl}")
            parent = "chest" if which == "front" else "hips"
            bone(up_n, W(a_hi, l_hi, z_top), W(a_mid, l_mid, z_mid), parent)
            bone(lo_n, W(a_mid, l_mid, z_mid), W(a_low, l_low, z_low), up_n,
                 connect=True)
            bone(pw_n, W(a_low, l_low, z_low),
                 W(col["toe_a"], col["l"], 0.03 * H), lo_n, connect=True)

    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"built {len(arm.bones)} bones "
        f"({sum(1 for b in arm.bones if b.use_deform)} deforming)")
    return rig


# ----------------------------------------------------------------- weighting
def weight(body, rig):
    """Inverse-power falloff to the nearest bones, gated on whether the bone can
    be SEEN from the vertex through the interior, then smoothed over the mesh.

    The visibility gate is the part that matters. Distance alone binds the left
    hind leg to the right femur — they are 0.3 units apart and the femur is a
    long segment — and no amount of smoothing recovers from that. A ray from a
    vertex on the left leg toward the right femur leaves the left leg and
    re-enters the right, so it crosses the surface and the bone is rejected.
    """
    me = body.data
    ws = [body.matrix_world @ v.co for v in me.vertices]
    V = len(ws)
    H = max(p.z for p in ws) - min(p.z for p in ws)

    tris = []
    for p in me.polygons:
        vi = list(p.vertices)
        for k in range(1, len(vi) - 1):
            tris.append((vi[0], vi[k], vi[k + 1]))
    bvh = BVHTree.FromPolygons([tuple(p) for p in ws], tris, all_triangles=True)

    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    vn = [Vector(n) for n in
          ([v.normal for v in me.vertices] if not hasattr(me, "vertex_normals")
           else [n.vector for n in me.vertex_normals])]

    bones = [b for b in rig.data.bones if b.use_deform]
    segs = [(rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local)
            for b in bones]
    B = len(bones)
    eps = 0.012 * H
    nudge = 0.006 * H

    W = [dict() for _ in range(V)]
    rejected = 0
    for i in range(V):
        p = ws[i]
        cand = []
        for k in range(B):
            d, q = seg_dist(p, segs[k][0], segs[k][1])
            cand.append((d, k, q))
        cand.sort(key=lambda t: t[0])
        cand = cand[:8]
        # Occlusion is a PENALTY, not a veto. A hard reject is a binary test on
        # a continuous quantity, and in the concave places — the throat, the
        # armpit, the stifle — the ray from one vertex clears the surface and
        # the ray from its neighbour grazes it, so two adjacent vertices get
        # disjoint bone sets and the pose opens them like a seam. That is
        # exactly where the withers was shredding. Softening it to 0.10 keeps
        # the left leg off the right femur (a factor of ten swamps any
        # distance advantage across the body) while letting the weight vary
        # smoothly across a fold.
        scored = []
        origin = p - vn[i] * nudge
        for d, k, q in cand:
            dv = q - origin
            L = dv.length
            pen = 1.0
            if L > 1e-6:
                if bvh.ray_cast(origin, dv / L, L * 0.985)[0] is not None:
                    pen = OCCLUDED
                    rejected += 1
            scored.append(((1.0 / max(d, eps)) ** FALLOFF * pen, k))
        scored.sort(key=lambda t: -t[0])
        scored = scored[:MAX_INF]
        tot = sum(w for w, _k in scored) or 1.0
        for w, k in scored:
            W[i][k] = w / tot

    log(f"seeded weights: {rejected} bone candidates rejected as occluded")

    # ---- Laplacian smoothing over the mesh graph ---------------------------
    adj = [set() for _ in range(V)]
    for p in me.polygons:
        vi = list(p.vertices)
        for k in range(len(vi)):
            a, b = vi[k], vi[(k + 1) % len(vi)]
            adj[a].add(b)
            adj[b].add(a)
    adj = [list(s) for s in adj]

    for _it in range(SMOOTH_ITERS):
        new = []
        for i in range(V):
            acc = dict(W[i])
            for k in acc:
                acc[k] *= (1.0 - SMOOTH_LAMBDA)
            nb = adj[i]
            if nb:
                f = SMOOTH_LAMBDA / len(nb)
                for j in nb:
                    for k, w in W[j].items():
                        acc[k] = acc.get(k, 0.0) + w * f
            new.append(acc)
        W = new

    # ---- prune to four influences and normalise ----------------------------
    groups = []
    for b in bones:
        groups.append(body.vertex_groups.new(name=b.name))
    for i in range(V):
        items = sorted(W[i].items(), key=lambda kv: -kv[1])[:MAX_INF]
        tot = sum(w for _k, w in items)
        if tot <= 1e-9:
            continue
        for k, w in items:
            wn = w / tot
            if wn > 1e-4:
                groups[k].add([i], wn, "REPLACE")

    md = body.modifiers.new("Armature", "ARMATURE")
    md.object = rig
    md.use_vertex_groups = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()
    log("weights written and armature modifier attached")


def report(body, rig):
    me = body.data
    V = len(me.vertices)
    gname = {g.index: g.name for g in body.vertex_groups}
    owned = {g.name: 0.0 for g in body.vertex_groups}
    touched = {g.name: 0 for g in body.vertex_groups}
    dominant = {g.name: 0 for g in body.vertex_groups}
    zero = 0
    for v in me.vertices:
        tot = sum(e.weight for e in v.groups if e.weight > 1e-4)
        if tot <= 1e-6:
            zero += 1
            continue
        best = (-1.0, None)
        for e in v.groups:
            if e.weight <= 1e-4:
                continue
            nm = gname[e.group]
            owned[nm] += e.weight / tot
            touched[nm] += 1
            if e.weight > best[0]:
                best = (e.weight, nm)
        if best[1]:
            dominant[best[1]] += 1
    log("")
    log(f"{'bone':<18}{'owned%':>9}{'touched':>9}{'dominant':>10}")
    log("-" * 46)
    dead = []
    for b in rig.data.bones:
        if not b.use_deform:
            continue
        nm = b.name
        f = ""
        if touched.get(nm, 0) == 0:
            f = "  <== DEAD"
            dead.append(nm)
        elif dominant.get(nm, 0) == 0:
            f = "  <== never dominant"
        log(f"{nm:<18}{100.0 * owned.get(nm, 0) / V:>8.2f}%"
            f"{touched.get(nm, 0):>9}{dominant.get(nm, 0):>10}{f}")
    log(f"vertices with no weight: {zero}")
    log(f"DEAD: {dead}")
    top = sorted(owned.items(), key=lambda kv: -kv[1])[:5]
    log("HEAVIEST: " + ", ".join(f"{k}={100.0 * v / V:.1f}%" for k, v in top))
    return dead


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    src, out = DEF_SRC, DEF_OUT
    if "--src" in argv:
        src = argv[argv.index("--src") + 1]
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    global PROBE
    PROBE = "--probe" in argv

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    log(f"imported {src}")
    for o in list(bpy.data.objects):
        if o.type == "MESH" and len(o.data.vertices) < 200:
            log(f"removed stray object {o.name}")
            bpy.data.objects.remove(o, do_unlink=True)
    body = max([o for o in bpy.data.objects if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    body.name = "RetrieverBody"
    log(f"body: {len(body.data.vertices)} verts, {len(body.data.polygons)} polys, "
        f"uv={[l.name for l in body.data.uv_layers]}")

    F = Frame(body)
    rig = build(F, body)
    weight(body, rig)
    report(body, rig)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    log(f"saved {out}")


if __name__ == "__main__":
    main()
