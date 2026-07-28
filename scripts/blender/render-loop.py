# Render the ambient loop AS THE SITE DRAWS IT — a dense point cloud, per frame.
#
#   blender --background --python scripts/blender/render-loop.py -- \
#       --src assets/3d/retriever-loop.glb --out <dir> --tag loop \
#       [--framing site|close|review] [--zoom 1.0] [--w 1600] [--h 900] \
#       [--step 1] [--start 0] [--end 360] [--npts 30000]
#
# WHY THIS EXISTS ON TOP OF render-points.py.
#
# render-points.py answers "does this rig sample cleanly in ONE pose". It cannot
# answer the only question that decides whether a loop ships, which is whether
# the cloud holds together while the animal MOVES, at the size and from the
# angle he is actually drawn. Four things had to change to ask that honestly.
#
#  1. THE POINTS ARE SAMPLED ONCE, NOT PER FRAME. Re-running the sampler each
#     frame re-rolls which triangle every point lands on, so the cloud boils
#     even when the animal is standing still — a flaw of the measuring
#     instrument, not of the rig. Here each point keeps its triangle, its
#     barycentric coordinate and its shell depth for the whole loop and rides
#     the deforming surface, which is exactly what skinning in the vertex shader
#     would do, and is the only version of this that predicts the site.
#
#  2. THE PAGE'S OWN AXES. dog.ts normalises in the glTF's own frame and then
#     turns the animal by DOG_YAW. render-points.py instead derives a mirror
#     plane and puts him broadside, which is a fine way to compare two rigs and
#     a bad way to predict the page: measured off the face bake's own UV window,
#     the retriever's nose bears 34 degrees off the camera's sight line, on the
#     far side. THE PAGE SEES THIS DOG FROM BEHIND, over his left shoulder. A
#     walk cycle judged broadside is judged on motion the page never shows.
#     (constants.ts says "mesh forward is -X". Measured, the nose bears
#     (-0.51, +0.86) in the file's own XZ, so that comment is stale — the yaw
#     was tuned by eye against the render and lands somewhere else entirely.)
#
#  3. THE PAGE'S OWN CAMERA. `--framing site` puts the eye at EYE_Y with
#     CAM_PITCH and the animal at DOG_POS, so he lands where he actually lands —
#     low and left, about 110 px tall on a 900 px frame.
#
#  4. THE BAKES. dog.ts multiplies in the AO bake and burns the eyes and nose in
#     from the face bake. Leaving them out lightens the cloud and deletes the
#     face, which is most of what makes the static dog read as a dog.
#
# The two point-cloud traps from the house rules are live here exactly as they
# are in render-points.py: back-facing points are culled, and the soft sprite
# fringe is alpha-discarded before it can write depth.
#
# Nothing here is loaded by the site. This is a measuring instrument.

import math
import os
import sys

import bpy
import numpy as np

# ---- the site's own numbers, from home/constants.ts and home/dog.ts --------
DOG_H = 0.735
DOG_N = 30000
DOG_POS = np.array([-1.98, 0.0, -8.4])
DOG_YAW = math.radians(-104.0)
EYE_Y = 1.62
CAM_FOV = 38.0
CAM_PITCH = math.radians(3.2)
SUN_AZ, SUN_EL = 0.045, math.radians(3.35)
SUN_DIR = np.array([math.sin(SUN_AZ) * math.cos(SUN_EL),
                    math.sin(SUN_EL),
                    -math.cos(SUN_AZ) * math.cos(SUN_EL)])
SUN_DIR /= np.linalg.norm(SUN_DIR)
SUN_COL = np.array([1.0, 0.6, 0.222])
SKY = np.array([0.185, 0.235, 0.335])
COAT = np.array([0.86, 0.505, 0.185])
CREAM = np.array([0.97, 0.80, 0.545])
SHELL = DOG_H * 0.052
U_SIZE = 0.0245
EXPOSURE = 1.24

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AO_PATH = os.path.join(REPO, "apps", "web", "public", "textures", "retriever-ao.webp")
FACE_PATH = os.path.join(REPO, "apps", "web", "public", "textures", "retriever-face.webp")


def log(m):
    print(f"[loopr] {m}", flush=True)


def mulberry32(seed):
    """dog.ts's own PRNG, so the point set is the site's point set."""
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
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def load_bake(path):
    """dog.ts reads these through a 2D canvas, so it sees the STORED sRGB bytes,
    not linearised values. Non-Color is what makes Blender hand back the same
    numbers."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    buf = buf.reshape(h, w, 4)          # row 0 is the BOTTOM row
    lum = (buf[:, :, 0] + buf[:, :, 1] + buf[:, :, 2]) / 3.0
    bpy.data.images.remove(img)
    log(f"  bake {os.path.basename(path)}: {w}x{h}")
    return lum, w, h


def sample_tex(lum, w, h, u, v):
    """Nearest, as dog.ts's sampleTex — indexed bottom-up, which is how Blender
    stores rows and is the same texel the canvas read gives."""
    x = np.clip(np.round(u * (w - 1)).astype(np.int32), 0, w - 1)
    y = np.clip(np.round(v * (h - 1)).astype(np.int32), 0, h - 1)
    return lum[y, x]


# ------------------------------------------------------------------ camera
class Cam:
    def __init__(self, eye, xc, yc, zc, W, H):
        self.eye = np.asarray(eye, dtype=np.float64)
        self.xc, self.yc, self.zc = (np.asarray(a, dtype=np.float64)
                                     for a in (xc, yc, zc))
        self.f = 1.0 / math.tan(math.radians(CAM_FOV) * 0.5)
        self.W, self.H = W, H


def _look(eye, target, W, H):
    zc = np.asarray(eye, dtype=np.float64) - np.asarray(target, dtype=np.float64)
    zc /= np.linalg.norm(zc)
    xc = np.cross([0.0, 1.0, 0.0], zc)
    xc /= np.linalg.norm(xc)
    return Cam(eye, xc, np.cross(zc, xc), zc, W, H)


def cam_site(W, H, _zoom=1.0):
    """The page's own camera: eye at EYE_Y, nose up CAM_PITCH, no yaw. The dog is
    not centred and is not broadside — that is the whole point."""
    cp, sp = math.cos(CAM_PITCH), math.sin(CAM_PITCH)
    return Cam([0.0, EYE_Y, 0.0], [1.0, 0.0, 0.0], [0.0, cp, sp],
               [0.0, -sp, cp], W, H)


def cam_close(W, H, zoom):
    """The page's bearing, centred and magnified: the eye walks in along the
    sight line, so it is the same view of the same side of the animal, nearer."""
    target = DOG_POS + np.array([0.0, DOG_H * 0.5, 0.0])
    eye0 = np.array([0.0, EYE_Y, 0.0])
    return _look(target + (eye0 - target) / zoom, target, W, H)


def cam_review(W, H, zoom):
    """render-points.py's framing: broadside, centred."""
    ctr = np.array([0.0, DOG_H * 0.5, 0.0])
    eye = np.array([0.0, ctr[1] + (EYE_Y - ctr[1]) / zoom, 8.63 / zoom])
    return _look(eye, ctr, W, H)


# ------------------------------------------------------------------ raster
def rasterise(P, N, rim, ao, dark, cam):
    """One frame. Vectorised, but the same rule as render-points.py:
    perspective points, back faces culled, z-buffered, fringe discarded below
    0.34."""
    W, H = cam.W, cam.H
    rel = P - cam.eye
    vx = rel @ cam.xc
    vy = rel @ cam.yc
    vz = rel @ cam.zc

    # BACK-FACING POINTS ARE ON THE LIT SIDE and shine through every gap in the
    # near surface. This is the confetti that plagued the retriever for weeks.
    vl = np.linalg.norm(rel, axis=1)
    vl[vl == 0.0] = 1.0
    view = -rel / vl[:, None]
    ndv = np.einsum("ij,ij->i", N, view)
    culled = int((ndv <= 0.0).sum())
    idx = np.nonzero((vz < -0.05) & (ndv > 0.0))[0]
    if idx.size == 0:
        return np.zeros((H, W, 3), dtype=np.float64), 0, culled

    p, n = P[idx], N[idx]
    vzi, vwi, ndvi = vz[idx], view[idx], ndv[idx]
    aspect = W / H
    px = (((vx[idx] / -vzi) * cam.f / aspect) * 0.5 + 0.5) * W
    py = (1.0 - (((vy[idx] / -vzi) * cam.f) * 0.5 + 0.5)) * H
    rad = np.maximum(0.6, (U_SIZE / np.maximum(0.4, -vzi) * H) * 0.5)

    # --- shading, straight out of DOG_FRAG ---------------------------------
    ndl = n @ SUN_DIR
    lam = np.maximum(0.0, ndl)
    wrap = np.maximum(0.0, ndl * 0.5 + 0.5)
    rimv = np.power(1.0 - np.abs(ndvi), 2.1)
    back = np.power(np.maximum(0.0, (-vwi) @ SUN_DIR), 1.6)
    under = np.clip((0.60 - p[:, 1] / DOG_H) * 2.1, 0.0, 1.0)
    creamv = np.clip(under * (0.45 - 0.55 * n[:, 1]) * 1.35, 0.0, 1.0)
    m = (creamv * 0.75)[:, None]
    coat = COAT[None, :] * (1.0 - m) + CREAM[None, :] * m
    c = coat * (SKY[None, :] * (0.30 + 0.70 * wrap)[:, None]
                + SUN_COL[None, :] * (lam * 0.34)[:, None])
    k = rimv * (0.42 + 0.95 * back) * 0.92 * (0.45 + 0.55 * rim[idx])
    c = c + SUN_COL[None, :] * k[:, None]
    c = c + coat * SUN_COL[None, :] * (0.20 * back)[:, None]
    c = c * (0.55 + 0.45 * ao[idx])[:, None]                     # baked AO
    d = dark[idx][:, None]
    c = c * (1.0 - d) + (c * 0.13) * d                           # eyes, nose

    # --- splat, then resolve the z-buffer in one sort -----------------------
    R = int(math.ceil(float(rad.max()))) + 1
    ix = np.floor(px).astype(np.int64)
    iy = np.floor(py).astype(np.int64)
    inv2r = 1.0 / (2.0 * rad)
    depth = -vzi
    flats, deps, sels = [], [], []
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            xx, yy = ix + dx, iy + dy
            ok = (xx >= 0) & (xx < W) & (yy >= 0) & (yy < H)
            if not ok.any():
                continue
            ddx = (xx + 0.5 - px) * inv2r
            ddy = (yy + 0.5 - py) * inv2r
            r2 = ddx * ddx + ddy * ddy
            # A soft fringe still WRITES DEPTH and carves dark veins right
            # through the mass; discard it rather than draw it.
            soft = np.clip((0.25 - r2) / (0.25 - 0.080), 0.0, 1.0)
            soft = soft * soft * (3.0 - 2.0 * soft)
            ok &= (r2 <= 0.25) & (soft >= 0.34)
            sel = np.nonzero(ok)[0]
            if sel.size == 0:
                continue
            flats.append(yy[sel] * W + xx[sel])
            deps.append(depth[sel])
            sels.append(sel)

    col = np.zeros((W * H, 3), dtype=np.float64)
    if flats:
        flat = np.concatenate(flats)
        dep = np.concatenate(deps)
        sel = np.concatenate(sels)
        order = np.lexsort((dep, flat))          # by pixel, then by depth
        fs = flat[order]
        first = np.empty(fs.size, dtype=bool)
        first[0] = True
        np.not_equal(fs[1:], fs[:-1], out=first[1:])
        win = order[first]
        col[flat[win]] = c[sel[win]]
    return col.reshape(H, W, 3), int(idx.size), culled


def write_png(rgb, path):
    H, W, _ = rgb.shape
    out = np.empty((H, W, 4), dtype=np.float32)
    out[:, :, :3] = aces(rgb * EXPOSURE)
    out[:, :, 3] = 1.0
    img = bpy.data.images.new(os.path.basename(path), W, H, alpha=False)
    img.pixels.foreach_set(out[::-1].ravel())     # blender images are bottom-up
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def head_patch(body):
    """Which vertices are on the head — read off the face bake's own UV window,
    the one dog.ts uses to decide where the eyes and nose may be drawn. Reading
    the animal's bearing off a bone name or an authored axis has been wrong once
    already in this asset's history; the texture atlas cannot lie about it."""
    uvl = body.data.uv_layers.active.data
    uv = np.zeros((len(body.data.vertices), 2), dtype=np.float64)
    for poly in body.data.polygons:
        for li in poly.loop_indices:
            uv[body.data.loops[li].vertex_index] = uvl[li].uv
    return (uv[:, 0] > 0.44) & (uv[:, 0] < 0.76) & \
        (uv[:, 1] > 0.28) & (uv[:, 1] < 0.44)


# ------------------------------------------------------------------ shaded
def shaded(body, out_dir, tag, W, H, frames, bearing):
    """The loop as geometry, so the motion itself can be read. Workbench, not
    EEVEE: this runs headless on a machine with no GPU context, and what is
    being judged here is limbs and timing, not light."""
    from mathutils import Matrix, Vector
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.curvature_ridge_factor = 1.0
    sh.curvature_valley_factor = 0.8
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.color = (0.035, 0.037, 0.045)
    body.color = (0.80, 0.52, 0.22, 1.0)

    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    lo = Vector((min(p.x for p in ws), min(p.y for p in ws), min(p.z for p in ws)))
    hi = Vector((max(p.x for p in ws), max(p.y for p in ws), max(p.z for p in ws)))
    ctr = (lo + hi) * 0.5
    # Fit his HEIGHT with headroom and let his length run out sideways; a 16:9
    # frame has the width for it, and fitting the bounding sphere leaves a dog
    # the size of a thumbnail in the middle of an empty plate. He grows about a
    # fifth taller when he throws his head back, hence the margin.
    span = (hi.z - lo.z) * 0.5 * 1.34

    # `bearing` swings the camera round the animal from dead ahead of his nose:
    # 0 is a face-on view, 90 is broadside, 180 is from behind, which is roughly
    # where the page stands. The eye sits at a shallow elevation like the page's.
    hp = head_patch(body)
    co = np.array([[p.x, p.y, p.z] for p in ws])
    fw = co[hp].mean(axis=0)[:2] - co.mean(axis=0)[:2]
    fw = fw / np.linalg.norm(fw)
    log(f"{tag}: nose bears ({fw[0]:+.3f}, {fw[1]:+.3f}) in the file's XY, "
        f"from {int(hp.sum())} head vertices")
    th = math.radians(bearing)
    ct, st = math.cos(th), math.sin(th)
    d = Vector((fw[0] * ct - fw[1] * st, fw[0] * st + fw[1] * ct, 0.0))
    el = math.radians(11.0)
    d = Vector((d.x * math.cos(el), d.y * math.cos(el), math.sin(el)))
    dist = span / math.tan(math.radians(CAM_FOV) * 0.5)
    cd = bpy.data.cameras.new("C")
    cd.lens_unit = "FOV"
    # AUTO fits the LARGER image dimension, so on a 16:9 frame a 38-degree
    # `angle` becomes 38 degrees horizontally and 22 vertically, and the animal's
    # head is cropped off.
    cd.sensor_fit = "VERTICAL"
    cd.angle = math.radians(CAM_FOV)
    cam = bpy.data.objects.new("C", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    zc = d
    xc = Vector((0, 0, 1)).cross(zc).normalized()
    yc = zc.cross(xc)
    cam.matrix_world = Matrix(((xc.x, yc.x, zc.x, 0.0),
                               (xc.y, yc.y, zc.y, 0.0),
                               (xc.z, yc.z, zc.z, 0.0),
                               (0.0, 0.0, 0.0, 1.0)))
    cam.matrix_world.translation = ctr + d * dist

    for f in frames:
        sc.frame_set(f)
        sc.render.filepath = os.path.join(out_dir, f"{tag}-{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        if f % 60 == 0:
            log(f"  shaded f{f:04d}")
    log(f"{tag}: {len(frames)} shaded frames -> {out_dir}")


# ------------------------------------------------------------------ scene
def load(src):
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
    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if rig is not None:
        rig.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    return body, rig


def eval_verts(body, mw):
    """World-space vertices of the posed mesh, in the glTF's own axes.
    Blender's importer turns the file Y-up into Z-up, so gltf = (bx, bz, -by);
    dog.ts works in the file's axes and so must this."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    b = co.reshape(nv, 3) @ np.asarray(mw.to_3x3()).T + np.asarray(mw.translation)
    return np.stack([b[:, 0], b[:, 2], -b[:, 1]], axis=1)


def topology(body):
    tris = []
    sizes = {}
    for poly in body.data.polygons:
        vi = list(poly.vertices)
        sizes[len(vi)] = sizes.get(len(vi), 0) + 1
        for k in range(1, len(vi) - 1):
            tris.append((vi[0], vi[k], vi[k + 1]))
    uvl = body.data.uv_layers.active.data
    uv = np.zeros((len(body.data.vertices), 2), dtype=np.float64)
    for poly in body.data.polygons:
        for li in poly.loop_indices:
            uv[body.data.loops[li].vertex_index] = uvl[li].uv
    return np.array(tris, dtype=np.int64), uv, sizes


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    def arg(name, default=None, cast=str):
        return cast(argv[argv.index(f"--{name}") + 1]) if f"--{name}" in argv \
            else default

    src = arg("src", os.path.join(REPO, "assets", "3d", "retriever-loop.glb"))
    out_dir = arg("out", os.path.join(REPO, "assets", "3d", "rig-review"))
    tag = arg("tag", "loop")
    framing = arg("framing", "site")
    zoom = arg("zoom", 1.0, float)
    W, H = arg("w", 1600, int), arg("h", 900, int)
    step, start, end = arg("step", 1, int), arg("start", 0, int), arg("end", 360, int)
    npts = arg("npts", DOG_N, int)
    mode = arg("mode", "points")
    bearing = arg("bearing", 55.0, float)
    os.makedirs(out_dir, exist_ok=True)

    body, rig = load(src)
    if mode == "shaded":
        shaded(body, out_dir, tag, W, H,
               list(range(start, end + 1, step)), bearing)
        return
    mw = body.matrix_world.copy()
    tris, uv, sizes = topology(body)
    log(f"{tag}: {len(body.data.vertices)} verts, polys by size {sizes}, "
        f"{len(tris)} triangles")

    # --- the canonical frame is fixed ONCE, from the REST pose --------------
    # dog.ts scales to DOG_H off the pose it samples. An animated version would
    # do it off the bind pose and never again; refitting per frame would make
    # the animal grow as he sits, which is a bug of the instrument.
    if rig is not None:
        rig.data.pose_position = "REST"
        bpy.context.view_layer.update()
    rest = eval_verts(body, mw)
    if rig is not None:
        rig.data.pose_position = "POSE"
        bpy.context.view_layer.update()

    s = DOG_H / (rest[:, 1].max() - rest[:, 1].min())
    cx = 0.5 * (rest[:, 0].min() + rest[:, 0].max())
    cz = 0.5 * (rest[:, 2].min() + rest[:, 2].max())
    y0 = rest[:, 1].min()
    nose_x = (rest[int(np.argmax(rest[:, 1])), 0] - cx)
    log(f"{tag}: rest height {rest[:, 1].max() - y0:.4f} -> scale {s:.4f}; "
        f"crown sits at x={nose_x:+.3f}, so the animal faces "
        f"{'-X' if nose_x < 0 else '+X'} — dog.ts assumes -X")

    ca, sa = math.cos(DOG_YAW), math.sin(DOG_YAW)

    def to_world(v):
        """dog.ts's canonical frame, then — for the page's framings — the yaw and
        the drop at DOG_POS that put him where he is drawn."""
        x = (v[:, 0] - cx) * s
        y = (v[:, 1] - y0) * s
        z = (v[:, 2] - cz) * s
        out = np.stack([x * ca + z * sa, y, -x * sa + z * ca], axis=1)
        return out + DOG_POS if framing in ("site", "close") else out

    # --- sample ONCE, exactly as dog.ts does -------------------------------
    Prest = to_world(rest)
    A = Prest[tris[:, 0]]
    area = np.linalg.norm(np.cross(Prest[tris[:, 1]] - A,
                                   Prest[tris[:, 2]] - A), axis=1) * 0.5
    cum = np.cumsum(area)
    total = float(cum[-1])
    rnd = mulberry32(1337)
    ti = np.empty(npts, dtype=np.int64)
    bu, bv, sh = np.empty(npts), np.empty(npts), np.empty(npts)
    for i in range(npts):
        ti[i] = int(np.searchsorted(cum, rnd() * total))
        u, v = rnd(), rnd()
        if u + v > 1.0:
            u, v = 1.0 - u, 1.0 - v
        bu[i], bv[i] = u, v
        sh[i] = math.pow(rnd(), 1.6)
        for _ in range(5):          # dog.ts burns five more per point on aSct
            rnd()
    ti = np.clip(ti, 0, len(tris) - 1)
    bw = 1.0 - bu - bv
    rim = 1.0 - sh
    ia, ib, ic = tris[ti, 0], tris[ti, 1], tris[ti, 2]

    aolum, aw, ah = load_bake(AO_PATH)
    fclum, fw, fh = load_bake(FACE_PATH)
    tu = uv[ia, 0] * bw + uv[ib, 0] * bu + uv[ic, 0] * bv
    tv = uv[ia, 1] * bw + uv[ib, 1] * bu + uv[ic, 1] * bv
    ao = 0.30 + 0.70 * np.power(np.clip(sample_tex(aolum, aw, ah, tu, tv), 0, 1), 0.85)
    faceV = sample_tex(fclum, fw, fh, tu, tv)
    on_face = (tu > 0.44) & (tu < 0.76) & (tv > 0.28) & (tv < 0.44)
    dark = np.where(on_face, np.clip(1.0 - faceV * 1.30, 0.0, 1.0), 0.0)
    log(f"{tag}: {npts} points; {int(on_face.sum())} in the face patch, "
        f"{int((dark > 0.5).sum())} dark enough to read as eye or nose")

    # WHICH WAY IS HE FACING — measured, not read off a comment. The face bake's
    # own UV patch marks the head, so the head centroid minus the body centroid
    # is the animal's bearing, whatever the mesh's authored axes happen to be.
    _rp = Prest[ia] * bw[:, None] + Prest[ib] * bu[:, None] + Prest[ic] * bv[:, None]
    head = _rp[on_face].mean(axis=0)
    face = np.array([head[0] - _rp[:, 0].mean(), head[2] - _rp[:, 2].mean()])
    face /= np.linalg.norm(face)
    look = np.array([DOG_POS[0], DOG_POS[2]]) if framing in ("site", "close") \
        else np.array([0.0, -1.0])
    look = look / np.linalg.norm(look)
    ang = math.degrees(math.acos(max(-1.0, min(1.0, float(face @ look)))))
    if ang < 60.0:
        read = "AWAY from the lens (rear three-quarter)"
    elif ang < 120.0:
        read = "BROADSIDE"
    else:
        read = "TOWARD the lens"
    log(f"{tag}: his nose bears {ang:.1f} deg off the camera's sight line — {read}")

    cam = {"site": cam_site, "close": cam_close}.get(framing, cam_review)(W, H, zoom)

    def frame_points(V):
        P = to_world(V)
        A = P[tris[:, 0]]
        fn = np.cross(P[tris[:, 1]] - A, P[tris[:, 2]] - A)
        vn = np.zeros_like(P)
        np.add.at(vn, tris[:, 0], fn)
        np.add.at(vn, tris[:, 1], fn)
        np.add.at(vn, tris[:, 2], fn)
        ln = np.linalg.norm(vn, axis=1)
        ln[ln == 0.0] = 1.0
        vn /= ln[:, None]
        pt = P[ia] * bw[:, None] + P[ib] * bu[:, None] + P[ic] * bv[:, None]
        nn = vn[ia] * bw[:, None] + vn[ib] * bu[:, None] + vn[ic] * bv[:, None]
        nl = np.linalg.norm(nn, axis=1)
        nl[nl == 0.0] = 1.0
        nn /= nl[:, None]
        return pt - nn * (sh * SHELL)[:, None], nn

    # `--rest 1` holds the bind pose whatever the clip says — the only way to
    # draw the REBUILT rig exactly as the site draws the shipped one, and so the
    # only fair way to ask whether the rebuild costs anything at rest.
    if "--rest" in argv and rig is not None:
        rig.data.pose_position = "REST"

    frames = list(range(start, end + 1, step))
    lows, highs, boxes = [], [], []
    for f in frames:
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        if "--rest" in argv and rig is not None:
            rig.data.pose_position = "REST"
            bpy.context.view_layer.update()
        pt, nn = frame_points(eval_verts(body, mw))
        lows.append(float(pt[:, 1].min()))
        highs.append(float(pt[:, 1].max()))
        rgb, drawn, culled = rasterise(pt, nn, rim, ao, dark, cam)
        write_png(rgb, os.path.join(out_dir, f"{tag}-{f:04d}.png"))
        lit = rgb.sum(axis=2) > 1e-6
        rows = np.nonzero(lit.any(axis=1))[0]
        cols = np.nonzero(lit.any(axis=0))[0]
        boxes.append((int(lit.sum()),
                      int(rows[-1] - rows[0] + 1) if rows.size else 0,
                      int(cols[-1] - cols[0] + 1) if cols.size else 0))
        if f == frames[0] or f % 60 == 0:
            log(f"  f{f:04d}: {drawn} drawn, {culled} culled, "
                f"{boxes[-1][0]} px lit, {boxes[-1][1]}x{boxes[-1][2]} px on screen")
    hh = [b[1] for b in boxes]
    log(f"{tag}: {len(frames)} frames -> {out_dir}")
    log(f"{tag}: on screen he is {min(hh)}..{max(hh)} px tall over the loop")
    log(f"{tag}: feet ride y={min(lows):+.4f}..{max(lows):+.4f} m "
        f"({(max(lows) - min(lows)) / DOG_H * 100:.1f}% of DOG_H below/above the "
        f"ice); crown {min(highs):.3f}..{max(highs):.3f} m")


if __name__ == "__main__":
    main()
