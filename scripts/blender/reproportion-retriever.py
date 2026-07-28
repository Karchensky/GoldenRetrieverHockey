# Re-proportion the retriever, paint his face, re-export.
#
#   blender assets/3d/retriever-original.blend --background \
#     --python scripts/blender/reproportion-retriever.py
#
# This is bake-retriever.py's sibling. It shares that script's unwrap, curvature,
# decimate and Draco export settings EXACTLY — the two must stay in step or the
# AO map stops lining up — and adds the two things that script does not do.
#
# ---------------------------------------------------------------- WHY, PART 1
# THE ANCHOR IS ON THE WRONG LANDMARK.
#
# retriever.ts scales the animal so that the bone `front_upper.L` sits at
# CAST.dogHeight = 0.58 m, with the comment "0.58 m from the ice to the withers,
# measured on the rig's own shoulder joint". Those are two different points.
# `front_upper.L` is the glenohumeral joint — the ball of the shoulder, inside
# the chest — and on this rig it measures 1.0300 units above the paws while the
# actual withers (the top of the shoulder blade, which is what "58 cm at the
# withers" means) measures 1.6418. The joint is 0.627 x the withers, which is
# anatomically correct for a dog and completely wrong as a stand-in for it.
#
# So the shipped animal stood 0.925 m at the withers and 1.181 m at the crown:
# a dog whose back is at a skater's waist. That, not the skull, is what "the
# crown lands too high" was measuring.
#
# The fix has to live in the GLB, because retriever.ts is owned elsewhere and
# looks up `front_upper.L` by name. So: the deforming upper-arm bones are
# renamed `front_arm.L/R` (vertex groups and animation channels retargeted with
# them, so deformation is bit-identical), and two new NON-DEFORMING marker bones
# called `front_upper.L/R` are planted at the top of the shoulder blade. Nothing
# is weighted to them and nothing animates them; they exist to be measured.
# retriever.ts then finds a bone at the real withers and 0.58 m means 0.58 m.
#
# ---------------------------------------------------------------- WHY, PART 2
# THE ANIMAL IS THE WRONG SHAPE UNDERNEATH, AND IT IS ONE DEFECT, NOT THREE.
#
# Measured on the pristine blend by scripts/blender/measure-retriever.py, which
# names the vertex or bone behind every number:
#
#     withers  1.6361 u                       (topline over the shoulder joint)
#     elbow    0.6200 u = 0.379 x withers     real golden 0.52-0.55
#     brisket  0.5568 u = 0.340 x withers     real golden 0.48-0.52
#     length   1.9402 u = 1.186 x withers     real golden 1.00-1.05
#     crown    2.0975 u = 1.282 x withers     real golden 1.20-1.25
#
# Every one of those is the SAME fault seen from a different side: the trunk is
# the trunk of a 58 cm dog and the legs belong to a much smaller one. Raise the
# body on longer forearms and the withers rises with it, so the chest depth, the
# body length and the crown all fall as ratios without a single vertex of the
# ribcage or the skull being touched for its own sake.
#
# That is not the whole fix, because raising the withers also SHRINKS the head
# as a fraction of it, and the head is the one part the last pass measured and
# found correct — eye separation 0.107 x withers against a real 0.103. So the
# head is scaled by exactly the factor the withers grew, which leaves every head
# ratio the last pass validated bit-for-bit where it was, and is then dropped to
# put crown:withers back on 1.22.
#
# The sculpt is therefore three numbers, solved rather than dialled (resculpt()):
#
#   dZ  lengthen the forearm and the shank so the elbow lands at 0.53 x withers.
#       The paw does not move and is not scaled; the stretch is linear between
#       the carpus and the elbow, which is what "a longer forearm" means. The
#       chest floor is NOT in that stretch — it rides up whole on the body — so
#       the legs are separated from the brisket by their own columns rather than
#       by a plane through space, the same lesson the head drop paid for.
#   m   compress the body ABOVE the elbow to 0.870, which is the depth a 0.47
#       chest wants once the withers has moved. This is what stops him reading
#       as a barrel on stilts.
#   h   scale the head by 1.149 = the factor the withers grew, about the
#       neck/skull junction, so nothing about the head changes relative to the
#       animal. D then drops it 0.13 u to land crown:withers on 1.22.
#
# WHAT MAY AND MAY NOT DEPEND ON WHICH AXIS.
# The mesh's own long axis is 50 degrees in yaw from the armature's (the rig is
# laid out along X; the animal is not, and both objects sit at the identity
# matrix, so this is real and not a parenting artefact). z is the ONE axis the
# two frames share. Every field above is therefore a function of z alone, which
# is the only kind of field that can be applied to a vertex and to a bone and
# mean the same thing. The two exceptions are handled in each frame's own terms:
# the leg columns are found in the mesh's frame and the leg BONES are named
# explicitly; the head pivot is the neck/skull junction in the mesh and the tail
# of the `neck` bone in the rig.
#
# ---------------------------------------------------------------- WHY, PART 3
# THE FACE IS BAKED, NOT SOLVED AT RUNTIME.
#
# Four attempts to place eyes analytically in the fur shader failed (see
# docs/opener/OPEN-ITEMS.md section 1). The eyes are MODELLED in this mesh —
# there are real sockets, found here by rendering a short-distance ambient
# occlusion pass over the skull and ray-casting the two dark spots back onto the
# surface. Those positions are hard-coded below because they were verified by
# looking at a render, which is the only reason to trust any of them.
#
# The marks are painted as an object-space node network and baked to the mesh's
# own UV layout, so they land where the geometry is rather than where an
# analytic guess puts them. Output: retriever-face.webp, RGB = a tint the
# consumer MULTIPLIES into the coat, A = a wet-specular mask. See
# apps/web/components/rink/world/FACE-BAKE-NOTES.md.
#
# ORDER MATTERS. The unwrap runs on the PRISTINE mesh, before the head moves,
# because retriever-ao.webp was baked against that layout and UVs are stored per
# loop — moving a vertex does not move its UV, but re-projecting a moved vertex
# does. Everything downstream rides the same islands.

import importlib.util
import math
import os
import sys

import bpy
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# The landmark definitions live in ONE place. The last pass shipped a dog that
# was 60% too tall because a bone everybody called the withers was the shoulder
# joint; the answer to that is not a comment, it is a single measure() that
# names the vertex behind every number and is imported by everything that needs
# one. The filename has a hyphen in it, so it cannot be `import`ed by name.
_spec = importlib.util.spec_from_file_location(
    "measure_retriever", os.path.join(HERE, "measure-retriever.py"))
M = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(M)
OUT_MODELS = os.path.join(REPO, "apps", "web", "public", "models")
OUT_TEX = os.path.join(REPO, "apps", "web", "public", "textures")

BODY = "RetrieverBody"
RIG = "RetrieverRig"

SHELL_TRI_TARGET = 9000          # identical to bake-retriever.py
FACE_RES = 1024
FACE_WEBP_QUALITY = 88
AO_RES = 2048                    # identical to bake-retriever.py
AO_SAMPLES = 128

# Where a standing golden retriever male lands, as fractions of the withers.
# Each sits in the middle of its band rather than on an edge, because the sculpt
# is solved from them and a target on a bar leaves nothing for the measurement's
# own slop. Bands: elbow 0.52-0.55, length 1.00-1.05, crown 1.20-1.25.
TARGET_ELBOW = 0.53
TARGET_LENGTH = 1.03
TARGET_CROWN_RATIO = 1.22

# The two eye sockets, in mesh space, read off a cavity render and ray-cast back
# onto the surface (scratchpad pz-orb-a270.png -> pz-mark-side.png confirms the
# marker sits inside the socket). NOT canonical constants, NOT bone arithmetic:
# both of those failed here already.
EYE_A = Vector((-0.6170, -0.8261, 1.9333))
EYE_B = Vector((-0.4425, -0.8175, 1.9577))

# Which bone the runtime measures, and the groups that describe the head.
SHOULDER_BONE = "front_upper.L"
# `ear.L` carries the whole skull on this rig — the auto-weighting gave it the
# cranium and left `head` with nothing over 0.5. Verified by dumping the groups;
# do not "fix" this list to look tidier without re-checking that dump.
HEAD_GROUPS = {"head", "jaw", "ear.L", "ear.R"}


def log(msg):
    print(f"[reproportion] {msg}", flush=True)


def require(obj, name):
    if obj is None:
        log(f"FATAL: expected object '{name}' not found in the blend.")
        sys.exit(1)
    return obj


def only_select(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


# --------------------------------------------------------------------- unwrap
def ensure_uvs(ob):
    """Byte-for-byte the same unwrap bake-retriever.py does, on the same mesh.

    Runs FIRST, before anything moves, so the island layout retriever-ao.webp
    was baked against is reproduced exactly.
    """
    if len(ob.data.uv_layers) > 0:
        log(f"UV layer already present: {[l.name for l in ob.data.uv_layers]}")
        return
    log("no UV layer — running Smart UV Project (pristine mesh, matches the AO bake)")
    only_select(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"unwrapped -> {[l.name for l in ob.data.uv_layers]}")


# The landmarks used to be re-derived here. They are not any more: every one of
# them lives in measure-retriever.py, imported above as M, because this file
# having its own idea of where the withers is is precisely how the last version
# shipped an animal 60% too tall.
#
# -------------------------------------------------------------------- sculpt
smoothstep = M.smoothstep


def resculpt(body, rig, r, target_elbow, target_len, target_crown):
    """Lengthen the legs, take the depth out of the chest, keep the head.

    Returns the transform as a callable so the verified eye constants can be
    pushed through exactly the same map the geometry went through — an eye that
    is placed against the OLD mesh is the failure mode this whole file exists to
    stop.
    """
    floor, fwd, W0 = r["_floor"], r["_fwd"], r["withers"]
    lat = Vector((-fwd.y, fwd.x, 0.0))
    crown0, len0 = r["_crown_u"], r["_length_u"]

    # The two joints the stretch lives between, taken off the rig rather than
    # guessed: the elbow is the head of the forearm bone and the carpus is its
    # tail. z is the axis the mesh and the rig agree on, so these transfer.
    z_e = (rig.matrix_world @ rig.data.bones["front_lower.L"].head_local).z - floor
    z_c = (rig.matrix_world @ rig.data.bones["front_lower.L"].tail_local).z - floor

    # ---- solve. The withers is an OUTPUT of this sculpt, not an input, and the
    # thing that pins it is the body length: it is the one ratio that cannot be
    # bought with the lift, because the trunk is not being scaled along its own
    # axis at all.
    Wn = len0 / target_len
    dZ = target_elbow * Wn - z_e
    m = (1.0 - target_elbow) * Wn / (W0 - z_e)
    h = Wn / W0
    log(f"solve: withers {W0:.4f} -> {Wn:.4f} u   lift dZ {dZ:+.4f}   "
        f"body depth x{m:.4f}   head x{h:.4f}")
    if not (0.60 < m < 1.05) or dZ < 0.0 or not (0.85 < h < 1.35):
        log("FATAL: solved parameters are outside anything sane; refusing to sculpt")
        sys.exit(1)

    def core_z(z):
        """Everything that is not a leg below the elbow: lift, then compress."""
        return z + dZ if z <= z_e else z_e + dZ + m * (z - z_e)

    def leg_z(z):
        """A leg: the paw is untouched, the forearm stretches LINEARLY between
        the carpus and the elbow. Linear and not eased — an eased ramp puts a
        bulge in the middle of a bone."""
        if z <= z_c:
            return z
        if z >= z_e:
            return core_z(z)
        return z + dZ * (z - z_c) / (z_e - z_c)

    # ---- head region. Defined off two MEASURED points — the top of the withers
    # and the verified eye midpoint — so the plane that separates the head from
    # the neck is the neck's own axis and survives a re-measure.
    wsv = [body.matrix_world @ v.co for v in body.data.vertices]
    cols = M.leg_columns(wsv, floor, fwd, lat, z_c)
    spines = M.leg_spines(wsv, floor, fwd, lat, z_c, z_e, cols)
    # PER COLUMN, and tight. A generous mask reaches across to the sternum on
    # the median plane — which is the one vertex that must NOT be treated as a
    # leg, because a chest floor that only gets 86% of the lift comes back as a
    # brisket below its band while every other number reads correct.
    radii = [(1.35 * c[2], 1.95 * 1.35 * c[2]) for c in cols]
    # How far each leg travels sideways per unit of height. The stretch follows
    # it instead of going straight up, so a shank that leaned 15 degrees still
    # leans 15 degrees when it is longer — lengthen a hind limb along z alone
    # and the hock straightens into a post, which is exactly how a leggier dog
    # stops looking like a dog.
    #
    # ONLY THE HIND LEGS. A foreleg below the elbow is vertical on a real dog
    # and near-vertical on this rig (5 degrees at the bone), and it is also the
    # one leg the tracker cannot measure, because it vanishes into the chest and
    # returns 30 degrees of ribcage. Nothing is lost by leaving it upright and a
    # 25-degree error in where the front feet land would be very visible.
    #
    # The forelegs' tracked SPINE is discarded with their lean, not just their
    # stretch. Left in, it walks 0.20 u backwards and inwards into the chest and
    # parks the mask right on the sternum — which then gets the forearm's ramp
    # instead of the body's lift and comes back 0.03 x withers shy of its band
    # while every other number reads correct.
    a_med = sorted(c[0] for c in cols)[len(cols) // 2]
    leans = []
    for k, (c, pts) in enumerate(zip(cols, spines)):
        dz = pts[-1][0] - pts[0][0]
        if c[0] >= a_med or dz <= 1e-6:
            leans.append((0.0, 0.0))       # foreleg: vertical, and known to be
            spines[k] = [(z_c, c[0], c[1]), (z_e, c[0], c[1])]
        else:
            leans.append(((pts[-1][1] - pts[0][1]) / dz,
                          (pts[-1][2] - pts[0][2]) / dz))
    for (ca, cl, rad, _n), (la, ll), (q0, q1) in zip(cols, leans, radii):
        log(f"  leg at (along {ca:+.3f}, lat {cl:+.3f}) r~{rad:.3f} "
            f"leans {math.degrees(math.atan(math.hypot(la, ll))):.1f} deg off vertical; "
            f"mask {q0:.3f}..{q1:.3f}")

    eye = (EYE_A + EYE_B) * 0.5
    a_eye, z_eye, l_eye = eye.dot(fwd), eye.z - floor, eye.dot(lat)
    a_sh = r["_a_sh"]
    nvec = Vector((a_eye - a_sh, z_eye - W0))
    span = nvec.length
    nvec = nvec / span
    ref = Vector((a_sh, W0)) + nvec * (0.62 * span)
    u_lo, u_hi = -0.26 * span, 0.13 * span
    log(f"  head plane: normal ({nvec.x:+.3f},{nvec.y:+.3f}) through "
        f"(along {ref.x:+.3f}, z {ref.y:+.3f}), band {u_lo:+.3f}..{u_hi:+.3f}")

    # The head pivots on the neck, so the scale is taken about the neck/skull
    # junction and not about the skull's centre — scaling about the centre pulls
    # the head off the neck and leaves a step in the throat.
    P = fwd * ref.x + lat * l_eye + Vector((0.0, 0.0, floor + ref.y))
    Pp = Vector((P.x, P.y, floor + core_z(ref.y)))

    # D lands the crown. Solved rather than iterated: the crown vertex is carried
    # by the head map and nothing else touches it.
    Cz = floor + crown0
    D = target_crown * Wn - ((Pp.z - floor) + h * (Cz - P.z))
    log(f"  head pivot {tuple(round(v,4) for v in P)} -> {tuple(round(v,4) for v in Pp)}; "
        f"crown offset D {D:+.4f}")

    def head_mask(p):
        u = nvec.x * (p.dot(fwd) - ref.x) + nvec.y * ((p.z - floor) - ref.y)
        return smoothstep(u_lo, u_hi, u)

    def nearest_leg(p):
        """(mask, index) — which leg this point is standing in, and how much."""
        z = p.z - floor
        if z >= z_e:
            return 0.0, -1
        pa, pl = p.dot(fwd), p.dot(lat)
        best, bi = 0.0, -1
        for k, pts in enumerate(spines):
            sa, sl = M.spine_at(pts, z)
            q0, q1 = radii[k]
            w = 1.0 - smoothstep(q0, q1, math.hypot(pa - sa, pl - sl))
            if w > best:
                best, bi = w, k
        return best, bi

    def xform(p):
        """The whole sculpt, as one function of a world-space point."""
        z = p.z - floor
        k, li = nearest_leg(p)
        zc = core_z(z) * (1.0 - k) + leg_z(z) * k
        core = Vector((p.x, p.y, floor + zc))
        if k > 1e-4:
            # Stretch ALONG the leg, not up the z axis: the elbow keeps its
            # place under the shoulder and the foot slides, which is the only
            # way round that does not either straighten the limb or pull it off
            # the body.
            t = min(1.0, max(0.0, (z - z_c) / (z_e - z_c)))
            la, ll = leans[li]
            s = dZ * (t - 1.0) * k
            core = core + fwd * (la * s) + lat * (ll * s)
        hm = head_mask(p)
        if hm <= 1e-4:
            return core
        head = Pp + (p - P) * h + Vector((0.0, 0.0, D))
        return core + (head - core) * hm

    # ---- geometry
    nlift = nhead = 0
    for v in body.data.vertices:
        p = body.matrix_world @ v.co
        q = xform(p)
        if (q - p).length > 1e-6:
            nlift += 1
        if head_mask(p) > 0.5:
            nhead += 1
        v.co = body.matrix_world.inverted() @ q
    log(f"  moved {nlift} vertices; {nhead} of them are head (mask > 0.5)")

    # ---- bones. Same numbers, each in its own frame. Nothing here is picked by
    # position: the rig is yawed away from the mesh, so a bone must be found by
    # the name of the thing it drives.
    LIMB = [(f"{pre}_lower.{s}", f"{pre}_paw.{s}")
            for pre in ("front", "rear") for s in ("L", "R")]
    LEG = {n for pair in LIMB for n in pair}
    HEADB = {"head", "jaw", "ear.L", "ear.R"}
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = rig.data.edit_bones
    neck = ebs["neck"]
    Prig = (rig.matrix_world @ neck.tail).copy()
    Prigp = Vector((Prig.x, Prig.y, floor + core_z(Prig.z - floor)))
    inv = rig.matrix_world.inverted()
    for eb in ebs:
        if eb.name in LEG:
            continue                       # handled as whole limbs below
        for end in ("head", "tail"):
            pt = rig.matrix_world @ getattr(eb, end).copy()
            if eb.name in HEADB:
                q = Prigp + (pt - Prig) * h + Vector((0.0, 0.0, D))
            else:
                q = Vector((pt.x, pt.y, floor + core_z(pt.z - floor)))
            setattr(eb, end, inv @ q)
    # The forearm and the shank lengthen ALONG THEMSELVES. Scaling their z span
    # and leaving x and y alone would rotate them upright, and a pose rotation
    # keyed against the old rest direction would then be a different motion.
    for lower_n, paw_n in LIMB:
        lo, pw = ebs.get(lower_n), ebs.get(paw_n)
        if lo is None:
            continue
        h0 = rig.matrix_world @ lo.head.copy()
        t0 = rig.matrix_world @ lo.tail.copy()
        span = h0.z - t0.z
        if span <= 1e-4:
            log(f"WARNING: {lower_n} has no vertical span; left alone")
            continue
        nh = h0 + Vector((0.0, 0.0, dZ))
        nt = nh + (t0 - h0) * ((span + dZ) / span)
        shift = nt - t0                    # the foot slides; its height does not
        lo.head, lo.tail = inv @ nh, inv @ nt
        if pw is not None:
            pw.head = inv @ ((rig.matrix_world @ pw.head.copy()) + shift)
            pw.tail = inv @ ((rig.matrix_world @ pw.tail.copy()) + shift)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"  bones: {sorted(HEADB)} scaled about the neck tail; the four limbs "
        f"stretched along their own axes; the rest lifted and compressed")
    return xform


# ---------------------------------------------------------------- tail rebind
def rebind_tail(body, rig, r):
    """Bind the tail geometry to the tail bones. IT WAS NOT BOUND TO ANYTHING.

    Measured, by rotating every bone 25 degrees in turn against the evaluated
    mesh and counting what moved: `tail.01`, `tail.02` and `tail.03` move ZERO
    vertices. Their vertex groups carry zero total weight. The plume is skinned
    to `rear_upper.R`, along with the entire hindquarter.

    That is not a cosmetic finding. Three of the four shipped clips key tail
    rotations — Affection, Attention and Idle all animate tail.01/02/03 — and
    `retriever.ts` runs a wag at amplitude 0.68 with a comment calling the tail
    "the largest thing on a retriever that can move independently of his mass,
    so it is what actually changes the silhouette between two pointer
    positions". All of it drives bones that deform nothing. The tail on screen
    has never moved.

    So: find the tail in the MESH (it is the narrow midline mass behind the
    point of buttock — the same feature the length measurement uses to know
    where the buttock ends), lay the three bones down its own centreline, and
    paint weights along it with a smooth root so the rump does not come with it.
    The authored rotations then have something to rotate.
    """
    floor, fwd, W = r["_floor"], r["_fwd"], r["withers"]
    lat = Vector((-fwd.y, fwd.x, 0.0))
    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    a_of = [p.dot(fwd) for p in ws]
    l_of = [p.dot(lat) for p in ws]
    ri = r["_rear_v"]
    a_root = a_of[ri]

    # Trace the plume backwards from the root, one slab at a time, following its
    # own centroid. Same technique as the leg spines and for the same reason: a
    # straight fit through everything behind the rump is a fit through the
    # thighs.
    # WHAT THE TAIL IS, geometrically: everything behind the point of buttock.
    # Nothing else on the animal is back there — the hind leg columns sit 0.10
    # and 0.15 x withers FORWARD of it — so no mask is needed, and the plume's
    # own principal axis then gives the centreline in one shot. A step-and-
    # re-centre walk was tried first and doubled back on itself: the plume drops
    # steeply and is only a fifth of a withers thick, so a search radius wide
    # enough to hold it is also wide enough to reach the rump.
    T = [i for i in range(len(ws)) if a_of[i] < a_root - 0.01 * W]
    if len(T) < 300:
        log(f"WARNING: only {len(T)} vertices behind the buttock; tail left unbound")
        return
    ctr = sum((ws[i] for i in T), Vector((0.0, 0.0, 0.0))) / len(T)
    axis = (-fwd).copy()                       # seed the power iteration
    for _it in range(24):
        acc = Vector((0.0, 0.0, 0.0))
        for i in T:
            d = ws[i] - ctr
            acc += d * d.dot(axis)
        if acc.length < 1e-9:
            break
        axis = acc.normalized()
    if axis.dot(-fwd) < 0:
        axis = -axis                            # point it down the tail
    proj = [(ws[i] - ctr).dot(axis) for i in T]
    p0, p1 = min(proj), max(proj)
    NS = 7
    spine = []
    for k in range(NS):
        lo = p0 + (p1 - p0) * k / NS
        hi = p0 + (p1 - p0) * (k + 1) / NS
        sel = [T[j] for j in range(len(T)) if lo <= proj[j] < hi]
        if len(sel) < 12:
            continue
        spine.append(sum((ws[i] for i in sel), Vector((0.0, 0.0, 0.0))) / len(sel))
    if len(spine) < 4:
        log(f"WARNING: tail resolved only {len(spine)} stations; left unbound")
        return
    log(f"  tail: {len(T)} verts behind the buttock, axis "
        f"{tuple(round(v,3) for v in axis)}, {len(spine)} stations, root "
        f"{tuple(round(v,3) for v in spine[0])} -> tip {tuple(round(v,3) for v in spine[-1])}, "
        f"{sum((spine[k+1]-spine[k]).length for k in range(len(spine)-1)) / W:.2f} x withers long")

    def at(u):
        """Point on the traced tail, u in 0..1 from root to tip, in world."""
        s = u * (len(spine) - 1)
        k = min(len(spine) - 2, int(s))
        f = s - k
        return spine[k] * (1.0 - f) + spine[k + 1] * f

    # Three bones, equal thirds of the traced line.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    inv = rig.matrix_world.inverted()
    ends = [at(k / 3.0) for k in range(4)]
    for k, name in enumerate(("tail.01", "tail.02", "tail.03")):
        eb = rig.data.edit_bones.get(name)
        if eb is None:
            continue
        eb.head, eb.tail = inv @ ends[k], inv @ ends[k + 1]
        eb.roll = 0.0
        eb.use_connect = False
        eb.use_deform = True
        eb.parent = rig.data.edit_bones.get("spine")
        if k > 0:
            eb.parent = rig.data.edit_bones.get(f"tail.0{k}")
    bpy.ops.object.mode_set(mode="OBJECT")

    # Weights. Radius grows a little toward the tip because the feathering does.
    names = ("tail.01", "tail.02", "tail.03")
    groups = []
    for n in names:
        g = body.vertex_groups.get(n) or body.vertex_groups.new(name=n)
        groups.append(g)
    tail_idx = {g.index for g in groups}
    painted = 0
    for i in T:
        p = ws[i]
        # nearest point on the centreline, by sampling — 48 samples over a plume
        # this size is well under a vertex spacing.
        best, bu = 1e9, 0.0
        for s in range(49):
            u = s / 48.0
            d = (p - at(u)).length
            if d < best:
                best, bu = d, u
        rad = (0.16 + 0.10 * bu) * W
        if best > rad:
            continue
        # Zero at the root, full a quarter of the way down. The rump must not
        # wag: a tail bound hard at its own base drags the pelvis with it, which
        # is the single most obvious way a wag reads as a rigging error.
        w = smoothstep(0.0, 0.25, bu) * (1.0 - smoothstep(0.60 * rad, rad, best))
        if w <= 1e-3:
            continue
        seg = min(2.999, bu * 3.0)
        k = int(seg)
        f = seg - k
        share = [0.0, 0.0, 0.0]
        share[k] = 1.0 - f
        if k < 2:
            share[k + 1] = f
        else:
            share[2] = 1.0
        # Take the weight OUT of whatever held these vertices before, or the
        # armature normalises it back down and the tail moves a fraction of what
        # it was told to. VertexGroup.add has no MULTIPLY mode; the weights are
        # writable in place, so scale them there.
        for e in body.data.vertices[i].groups:
            if e.group not in tail_idx:
                e.weight *= (1.0 - w)
        for g, sh in zip(groups, share):
            if sh > 1e-4:
                g.add([i], w * sh, "REPLACE")
        painted += 1
    log(f"  tail bound: {painted} of {len(T)} vertices painted onto {list(names)}")


def prove_deform(rig, body, expect):
    """Rotate each named bone and count what actually MOVES.

    A vertex group's existence proves nothing; a name proves less. This is the
    check that found the dead tail — every other signal said the tail was rigged
    (three bones, three groups, keyframes in three of the four clips) and the
    only thing that disagreed was the mesh.
    """
    rig.data.pose_position = "POSE"
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()

    def evaluated():
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        out = [v.co.copy() for v in me.vertices]
        ev.to_mesh_clear()
        return out

    base = evaluated()
    ok = True
    for name, want in expect.items():
        pb = rig.pose.bones.get(name)
        if pb is None:
            log(f"FATAL: bone {name} missing")
            sys.exit(1)
        pb.rotation_euler = (0.0, 0.0, math.radians(25.0))
        bpy.context.view_layer.update()
        cur = evaluated()
        moved = sum(1 for i in range(len(base)) if (cur[i] - base[i]).length > 1e-3)
        far = max((cur[i] - base[i]).length for i in range(len(base)))
        pb.rotation_euler = (0.0, 0.0, 0.0)
        flag = "OK " if moved >= want else "DEAD"
        if moved < want:
            ok = False
        log(f"  deform check {name:<10} {moved:>6} verts move, max {far:.4f} u  [{flag}]")
    bpy.context.view_layer.update()
    rig.data.pose_position = "REST"
    if not ok:
        log("FATAL: a bone that is supposed to deform the mesh deforms nothing")
        sys.exit(1)


# -------------------------------------------------------------- anchor rework
def fcurves_of(action):
    """Blender 5.x actions are slotted; 4.x and earlier expose .fcurves."""
    try:
        return list(action.fcurves)
    except AttributeError:
        out = []
        for lay in action.layers:
            for st in lay.strips:
                for cb in st.channelbags:
                    out.extend(cb.fcurves)
        return out


def move_anchor(body, rig, withers):
    """Rename the deforming upper arms and plant marker bones at the withers.

    retriever.ts measures `front_upper.L` and calls the result the withers. It
    is not, so the name is given to a bone that IS. The deforming bone keeps
    every weight and every keyframe under a new name, so the animal deforms
    exactly as before.
    """
    for side in ("L", "R"):
        old, new = f"front_upper.{side}", f"front_arm.{side}"
        b = rig.data.bones.get(old)
        if b is None:
            log(f"FATAL: bone {old} missing")
            sys.exit(1)
        b.name = new                                     # children follow
        vg = body.vertex_groups.get(old)
        if vg is not None:
            vg.name = new
        log(f"renamed bone+group {old} -> {new}")

    # Renaming only rewrites the data paths of actions currently assigned, so
    # sweep every action explicitly. Idempotent.
    fixed = 0
    for act in bpy.data.actions:
        for fc in fcurves_of(act):
            for side in ("L", "R"):
                a, b = f'pose.bones["front_upper.{side}"]', f'pose.bones["front_arm.{side}"]'
                if a in fc.data_path:
                    fc.data_path = fc.data_path.replace(a, b)
                    fixed += 1
    log(f"retargeted {fixed} animation channels onto front_arm.*")

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for side, y in (("L", -0.25), ("R", 0.25)):
        arm = rig.data.edit_bones.get(f"front_arm.{side}")
        eb = rig.data.edit_bones.new(f"front_upper.{side}")
        # Only the HEIGHT is ever read, but it is placed over the shoulder blade
        # so a human opening the rig sees a withers marker, not a floating stub.
        eb.head = Vector((arm.head.x, y, withers))
        eb.tail = Vector((arm.head.x, y, withers + 0.12))
        eb.parent = rig.data.edit_bones.get("chest")
        eb.use_connect = False
        eb.use_deform = False
        log(f"planted marker bone front_upper.{side} at z={withers:.4f} (non-deforming)")
    bpy.ops.object.mode_set(mode="OBJECT")
    # No vertex group => no influence, even if an exporter decides to list it.
    for side in ("L", "R"):
        if body.vertex_groups.get(f"front_upper.{side}"):
            body.vertex_groups.remove(body.vertex_groups[f"front_upper.{side}"])


# ------------------------------------------------------------------ face bake
def head_axes(eye_a, eye_b, ws):
    """A face frame from the two verified eye points.

    lat: eye to eye, horizontalised (a dog's median plane is vertical).
    fwd: horizontal, perpendicular to lat, pointing off the front of the skull.
    up:  the remaining axis.
    """
    mid = (eye_a + eye_b) * 0.5
    lat = Vector((eye_b.x - eye_a.x, eye_b.y - eye_a.y, 0.0)).normalized()
    fwd = Vector((-lat.y, lat.x, 0.0))
    body_c = sum(ws, Vector((0, 0, 0))) / len(ws)
    if (mid - body_c).dot(fwd) < 0:
        fwd = -fwd
    up = lat.cross(fwd).normalized()
    if up.z < 0:
        up = -up
        lat = -lat
    return mid, lat, fwd, up


def find_nose(ws, mid, lat, fwd):
    """Furthest point forward along the median plane, at muzzle height."""
    band = [p for p in ws
            if abs((p - mid).dot(lat)) < 0.030
            and mid.z - 0.40 < p.z < mid.z + 0.06]
    tip = max(band, key=lambda p: (p - mid).dot(fwd))
    # snap it onto the median plane; the mesh is not perfectly symmetric
    tip = tip - lat * (tip - mid).dot(lat)
    return tip


def mark_node(nt, coord, centre, radius, rot, r0, r1):
    """One soft ellipsoidal mask in object space.

    Mapping in TEXTURE mode is the inverse transform, i.e. it takes a world
    point into the mark's own frame — which is exactly the ellipsoid test.
    """
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.vector_type = "TEXTURE"
    mp.inputs["Location"].default_value = centre
    mp.inputs["Rotation"].default_value = rot
    mp.inputs["Scale"].default_value = radius
    nt.links.new(coord, mp.inputs["Vector"])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(mp.outputs["Vector"], ln.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.interpolation_type = "SMOOTHSTEP"
    mr.clamp = True
    mr.inputs["From Min"].default_value = r0
    mr.inputs["From Max"].default_value = r1
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    nt.links.new(ln.outputs["Value"], mr.inputs["Value"])
    return mr.outputs["Result"]


def mix_over(nt, base, colour, mask, base_colour=(1, 1, 1)):
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MIX"
    nt.links.new(mask, mix.inputs["Factor"])
    if base is None:
        mix.inputs[6].default_value = (*base_colour, 1.0)
    else:
        nt.links.new(base, mix.inputs[6])
    mix.inputs[7].default_value = (*colour, 1.0)
    return mix.outputs[2]


def build_face_material(body, eye_a, eye_b, ws, channel):
    """`channel` is "tint" (RGB multiplier) or "spec" (wet mask)."""
    mid, lat, fwd, up = head_axes(eye_a, eye_b, ws)
    nose = find_nose(ws, mid, lat, fwd)
    sep = (eye_b - eye_a).length
    log(f"face frame: mid {tuple(round(v,4) for v in mid)} sep {sep:.4f}")
    log(f"            lat {tuple(round(v,4) for v in lat)} fwd {tuple(round(v,4) for v in fwd)}")
    log(f"            nose {tuple(round(v,4) for v in nose)} "
        f"({(nose-mid).dot(fwd):.4f} forward, {mid.z-nose.z:.4f} below the eyes)")

    R = Matrix(((lat.x, fwd.x, up.x), (lat.y, fwd.y, up.y), (lat.z, fwd.z, up.z)))
    rot = R.to_euler("XYZ")

    mat = bpy.data.materials.new(f"FaceBake_{channel}")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    coord = tc.outputs["Object"]

    # A golden's eye is an almond lying across the skull: wide, shallow, and
    # only a little tall. Everything is scaled off the MEASURED eye separation
    # rather than off absolute units, so the marks cannot drift out of scale if
    # the head is ever re-measured. Real proportions: eye ~2.4 cm across on a
    # 5.5 cm separation, nose leather ~3.5 cm wide.
    er = (sep * 0.27, sep * 0.20, sep * 0.23)
    rim = (sep * 0.44, sep * 0.33, sep * 0.37)
    nr = (sep * 0.31, sep * 0.27, sep * 0.27)
    glr = (sep * 0.070, sep * 0.070, sep * 0.070)

    def glint(eye):
        return eye + up * (sep * 0.085) + fwd * (sep * 0.050) + lat * (sep * 0.050)

    out = None
    if channel == "tint":
        # Order matters: the paler marks go down first so the dark ones sit on
        # top of them rather than being washed out.
        for eye in (eye_a, eye_b):
            brow = eye + up * (sep * 0.52) - fwd * (sep * 0.10)
            m = mark_node(nt, coord, tuple(brow), (sep*0.40, sep*0.34, sep*0.30), rot, 0.50, 1.0)
            out = mix_over(nt, out, (1.00, 0.95, 0.85), m)
        # the darker lip line back along the muzzle from the mouth corner
        lipc = nose - fwd * (sep * 0.30) - up * (sep * 0.52)
        m = mark_node(nt, coord, tuple(lipc), (sep*0.32, sep*0.90, sep*0.15), rot, 0.50, 1.0)
        out = mix_over(nt, out, (0.32, 0.24, 0.19), m)
        for eye in (eye_a, eye_b):
            m = mark_node(nt, coord, tuple(eye), rim, rot, 0.42, 1.0)
            out = mix_over(nt, out, (0.20, 0.13, 0.09), m)
        # nose leather, then the two nostrils split by the philtrum
        m = mark_node(nt, coord, tuple(nose), nr, rot, 0.68, 1.0)
        out = mix_over(nt, out, (0.055, 0.045, 0.045), m)
        for s in (-1.0, 1.0):
            nc = nose + lat * (sep * 0.125 * s) - fwd * (sep * 0.02) - up * (sep * 0.04)
            m = mark_node(nt, coord, tuple(nc), (sep*0.070, sep*0.13, sep*0.095), rot, 0.40, 1.0)
            out = mix_over(nt, out, (0.010, 0.008, 0.008), m)
        for eye in (eye_a, eye_b):
            m = mark_node(nt, coord, tuple(eye), er, rot, 0.70, 1.0)
            out = mix_over(nt, out, (0.028, 0.020, 0.016), m)
        # The catchlight is left near white so the coat's own gold shows through
        # it — the source blend lit its glint warm (1.0,0.77,0.31), not blue.
        for eye in (eye_a, eye_b):
            m = mark_node(nt, coord, tuple(glint(eye)), glr, rot, 0.35, 1.0)
            out = mix_over(nt, out, (0.97, 0.92, 0.78), m)
    # There is deliberately no second "wetness" channel. It was built, and the
    # two-image merge through Image.pixels corrupted the buffer; more to the
    # point it was redundant — the leather and the eyes are the ONLY near-black
    # texels on this map, so a consumer recovers the same mask from luminance
    # in one line. One channel cannot drift out of step with itself.

    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(out, em.inputs["Color"])
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], o.inputs["Surface"])
    return mat


def bake_channel(body, mat, name, background):
    """EMIT bake onto the existing UV layout. No light, no rays — the network
    is evaluated per texel, so the marks are full resolution regardless of how
    coarse the mesh is under them.

    `background` fills everything the bake does not touch. For the tint channel
    that has to be WHITE: it is a multiplier, the atlas is only ~55% covered,
    and a black gutter bleeding across a seam would punch a hole in the coat.
    """
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, width=FACE_RES, height=FACE_RES, alpha=False)
    img.colorspace_settings.name = "sRGB"
    # generated_color does NOT reliably re-fill an already-allocated buffer, so
    # write the gutter explicitly. foreach_set, not a Python list: assigning
    # 4M floats through `pixels = [...]` corrupted the buffer into horizontal
    # bands the first time round.
    import numpy as np
    buf = np.empty(FACE_RES * FACE_RES * 4, dtype=np.float32)
    buf[0::4] = background[0]
    buf[1::4] = background[1]
    buf[2::4] = background[2]
    buf[3::4] = 1.0
    img.pixels.foreach_set(buf)

    saved = [s.material for s in body.material_slots]
    body.data.materials.clear()
    body.data.materials.append(mat)
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    tex.select = True

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    try:
        sc.cycles.device = "CPU"
    except Exception:
        pass
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = 24          # generous bleed; the shells sample at an offset
    sc.render.bake.use_clear = False    # keep the white gutter written above
    only_select(body)
    log(f"baking {name} at {FACE_RES}x{FACE_RES} (EMIT)")
    bpy.ops.object.bake(type="EMIT")

    body.data.materials.clear()
    for m in saved:
        body.data.materials.append(m)
    return img


def bake_face(body, ws):
    tint = build_face_material(body, EYE_A, EYE_B, ws, "tint")
    img = bake_channel(body, tint, "retriever_face", (1.0, 1.0, 1.0))

    path = os.path.join(OUT_TEX, "retriever-face.webp")
    # Image.save() writes the buffer VERBATIM. save_render() would push it
    # through the scene's view transform instead, which on this build turns a
    # white texel into 220 — a multiplier map that quietly darkens the whole
    # coat by 14% — and re-encodes every mark on top of the sRGB the bake
    # already applied. This is a data texture; nothing may grade it.
    bpy.context.scene.render.image_settings.quality = FACE_WEBP_QUALITY
    img.filepath_raw = path
    img.file_format = "WEBP"
    img.save()
    log(f"wrote {path} ({os.path.getsize(path)/1024:.0f} KB)")
    return path


def preview_face(body, path, out_dir):
    """Put the baked map back ON the model and render the head.

    The only honest check available inside Blender: the map is consumed by a
    shader this script does not own, so "the bake succeeded" proves nothing
    about WHERE the marks landed. Four previous attempts at this face all
    "succeeded" and put an eye on the skull.
    """
    for o in bpy.data.objects:
        if o.type == "LIGHT":
            o.hide_render = True
    fl = bpy.data.objects.get("PreviewFloor")
    if fl:
        fl.hide_render = True

    img = bpy.data.images.load(path, check_existing=True)
    mat = bpy.data.materials.new("FacePreview")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"        # show the texels, do not flatter them
    coat = nt.nodes.new("ShaderNodeMix")
    coat.data_type = "RGBA"
    coat.blend_type = "MULTIPLY"
    coat.inputs["Factor"].default_value = 1.0
    coat.inputs[6].default_value = (0.62, 0.36, 0.13, 1)     # a golden's coat
    nt.links.new(tex.outputs["Color"], coat.inputs[7])
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    nt.links.new(coat.outputs[2], d.inputs["Color"])
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(d.outputs[0], o.inputs["Surface"])
    saved = [s.material for s in body.material_slots]
    body.data.materials.clear()
    body.data.materials.append(mat)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1000
    sc.render.resolution_y = 1000
    w = sc.world
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.55, 0.58, 0.62, 1)
        bg.inputs[1].default_value = 1.0

    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    mid, lat, fwd, up = head_axes(EYE_A, EYE_B, ws)
    aim = mid + fwd * 0.08
    cd = bpy.data.cameras.new("FP")
    cd.lens = 75
    cam = bpy.data.objects.new("FP", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    for name, d3 in (("face", fwd + Vector((0, 0, 0.16))),
                     ("q34", fwd * 0.72 + lat * 0.66 + Vector((0, 0, 0.20))),
                     ("side", lat * 0.97 + fwd * 0.12)):
        for tag, dist in (("", 1.45), ("-tight", 0.80)):
            cam.location = aim + d3.normalized() * dist
            cam.rotation_euler = (aim - cam.location).to_track_quat("-Z", "Y").to_euler()
            bpy.context.view_layer.update()
            sc.render.filepath = os.path.join(out_dir, f"pz-facecheck-{name}{tag}.png")
            bpy.ops.render.render(write_still=True)
            log(f"preview -> {sc.render.filepath}")
    body.data.materials.clear()
    for m in saved:
        body.data.materials.append(m)


# ------------------------------------------- curvature / decimate / export
def bake_curvature_to_vcol(ob):
    """Identical to bake-retriever.py; see the note there."""
    me = ob.data
    attr_name = "curvature"
    existing = me.color_attributes.get(attr_name)
    if existing:
        me.color_attributes.remove(existing)
    me.color_attributes.new(name=attr_name, type="FLOAT_COLOR", domain="POINT")
    import mathutils
    neighbours = [[] for _ in range(len(me.vertices))]
    for e in me.edges:
        a, b = e.vertices
        neighbours[a].append(b)
        neighbours[b].append(a)
    layer = me.color_attributes[attr_name]
    vals = []
    for i, v in enumerate(me.vertices):
        nb = neighbours[i]
        if not nb:
            vals.append(0.5)
            continue
        avg = mathutils.Vector((0.0, 0.0, 0.0))
        for j in nb:
            avg += me.vertices[j].co
        avg /= len(nb)
        vals.append((v.co - avg).dot(v.normal))
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1.0
    for i, raw in enumerate(vals):
        c = (raw - lo) / rng
        layer.data[i].color = (c, c, c, 1.0)
    log(f"baked curvature to vertex colour (range {lo:.4f}..{hi:.4f})")


def decimate_for_shells(ob):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris <= SHELL_TRI_TARGET:
        log(f"{tris} tris already under shell target; no decimation")
        return
    ratio = SHELL_TRI_TARGET / float(tris)
    log(f"decimating {tris} -> ~{SHELL_TRI_TARGET} tris (ratio {ratio:.4f})")
    only_select(ob)
    mod = ob.modifiers.new(name="__shell_decimate", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"decimated to {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris")


def export_glb(body, rig, path):
    """Flag-for-flag identical to bake-retriever.py's exporter."""
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    log(f"exporting {path}")
    bpy.ops.export_scene.gltf(
        filepath=path,
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
    log(f"wrote {path} ({os.path.getsize(path)/1024:.0f} KB)")


# -------------------------------------------------------------------- AO bake
def bake_ao(body):
    """Re-bake self-occlusion onto the SAME UV layout, on the MOVED geometry.

    This is not optional after the sculpt. UVs are stored per loop, so moving a
    vertex does not move its texel — the map still lines up — but what it
    RECORDS stops being true: retriever-ao.webp was baked against a dog whose
    elbow sat 8 cm off the ice, and the dark it painted into the armpit, under
    the brisket and between the forelegs is the occlusion of a gap that is now
    nearly twice as deep. The unwrap upstream runs on the pristine mesh, so the
    islands are identical and this overwrites in place.

    Written as PNG; scripts/compress-bakes.mjs turns it into the greyscale WebP
    the site actually loads.
    """
    path = os.path.join(OUT_TEX, "retriever-ao.png")
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = AO_SAMPLES
    sc.cycles.use_denoising = True
    try:
        sc.cycles.device = "CPU"
    except Exception:
        pass
    img = bpy.data.images.get("retriever_ao")
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new("retriever_ao", width=AO_RES, height=AO_RES, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    for slot in body.material_slots:
        mat = slot.material
        if mat is None:
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        node = nt.nodes.get("__baketarget") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "__baketarget"
        node.image = img
        nt.nodes.active = node
        node.select = True
    only_select(body)
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = 16
    sc.render.bake.use_clear = True
    log(f"baking AO at {AO_RES}x{AO_RES}, {AO_SAMPLES} samples (this is the slow part)")
    bpy.ops.object.bake(type="AO")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    log(f"wrote {path} — run `node scripts/compress-bakes.mjs` to make the WebP")
    for slot in body.material_slots:
        mat = slot.material
        if mat is None or not mat.use_nodes:
            continue
        n = mat.node_tree.nodes.get("__baketarget")
        if n:
            mat.node_tree.nodes.remove(n)


def main():
    os.makedirs(OUT_MODELS, exist_ok=True)
    os.makedirs(OUT_TEX, exist_ok=True)
    body = require(bpy.data.objects.get(BODY), BODY)
    rig = require(bpy.data.objects.get(RIG), RIG)
    log(f"actions in file: {[a.name for a in bpy.data.actions]}")

    ensure_uvs(body)

    # 1. measure, by the shared landmark definitions. Nothing in this file may
    #    invent its own withers again.
    before = M.measure(body, rig, "BEFORE — pristine blend")

    # 2. the sculpt: legs, chest depth, head scale, head drop.
    xform = resculpt(body, rig, before, TARGET_ELBOW, TARGET_LENGTH, TARGET_CROWN_RATIO)
    after = M.measure(body, rig, "AFTER — sculpted", ref=before)
    for key, (lo, hi) in M.TARGET.items():
        if not (lo <= after[key] <= hi):
            log(f"WARNING: {key} landed at {after[key]:.4f}, outside {lo:.2f}-{hi:.2f}")

    # 3. the tail, which was bound to nothing at all
    if "--no-tail" not in sys.argv:
        rebind_tail(body, rig, after)
        prove_deform(rig, body, {"tail.01": 200, "tail.02": 150, "tail.03": 100})

    # 4. plant the anchor at the new withers
    ws2 = [body.matrix_world @ v.co for v in body.data.vertices]
    floor2 = min(p.z for p in ws2)
    move_anchor(body, rig, floor2 + after["withers"])
    log(f"  at 0.58 m on the new anchor: elbow {0.58*after['elbow']:.3f} m, "
        f"brisket {0.58*after['brisket']:.3f} m, crown {0.58*after['crown']:.3f} m")

    # 5. PROVE the rename did not hand the animation to the marker bone. A
    #    silent miss here would rotate a weightless stub while the real foreleg
    #    stood still, and nothing downstream would complain.
    for act in bpy.data.actions:
        bones = sorted({fc.data_path.split('"')[1]
                        for fc in fcurves_of(act) if '"' in fc.data_path})
        log(f"  action {act.name}: {bones}")
        for b in bones:
            if b.startswith("front_upper."):
                log(f"FATAL: {act.name} still animates the marker bone {b}")
                sys.exit(1)

    # 6. the face, on the moved geometry — the eyes went through the sculpt
    #    exactly as the vertices around them did, which is the only reason the
    #    marks still land in the sockets.
    ea, eb = xform(EYE_A), xform(EYE_B)
    log(f"  eyes {tuple(round(v,4) for v in EYE_A)} -> {tuple(round(v,4) for v in ea)}")
    globals()["EYE_A"] = ea
    globals()["EYE_B"] = eb
    face_path = bake_face(body, ws2)
    if "--preview" in sys.argv:
        i = sys.argv.index("--preview")
        out_dir = sys.argv[i + 1] if len(sys.argv) > i + 1 else REPO
        preview_face(body, face_path, out_dir)
    if "--elevation" in sys.argv:
        i = sys.argv.index("--elevation")
        out_dir = sys.argv[i + 1] if len(sys.argv) > i + 1 else REPO
        os.makedirs(out_dir, exist_ok=True)
        M.elevation(body, rig, M.measure(body, rig, ref=before), out_dir,
                    sys.argv[i + 2] if len(sys.argv) > i + 2 else "after")

    if "--rebake-ao" in sys.argv:
        bake_ao(body)

    bake_curvature_to_vcol(body)
    decimate_for_shells(body)
    export_glb(body, rig, os.path.join(OUT_MODELS, "retriever.glb"))
    log("DONE")


if __name__ == "__main__":
    main()
