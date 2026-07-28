# Prepare the retriever for the web: unwrap, bake orientation-independent
# surface data, decimate for shell fur, export rigged + animated as Draco glTF.
#
#   blender assets/3d/retriever-original.blend --background \
#     --python scripts/blender/bake-retriever.py
#
# ---------------------------------------------------------------------------
# THIS IS NOT THE PIPELINE ANY MORE. It exports the PRISTINE animal: no sculpt,
# no anchor at the withers, no face, no bound tail. Running it replaces
# retriever.glb with a dog whose elbow sits at 0.38 x withers and whose tail
# deforms nothing, and nothing downstream will complain.
#
# The pipeline is scripts/blender/reproportion-retriever.py, which does
# everything this file does plus all of that, with the same unwrap, curvature,
# decimate and export settings. Keep the two in step or the AO stops lining up.
# This file is kept because its AO bake is the reference the other one copies.
# ---------------------------------------------------------------------------
#
# WHY ONLY AO AND CURVATURE, AND NOT LIGHT.
# The static world (drifts, mountains, the pond) gets a full GI bake, because it
# never moves and baked light is the only way to get near-black with real bounce.
# The dog is the opposite case: he runs into frame, turns, and sits. Light baked
# into his texture would be welded to whatever orientation he had at bake time,
# and would read as painted-on the moment he turns. So he carries only what is
# true regardless of where he is standing — self-occlusion and surface curvature
# — and takes his key, rim and fill live from the scene.
#
# The mesh arrives with no UV layer at all, so the unwrap here is not a tidy-up
# step; nothing can be baked until it exists.

import math
import os
import sys

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_MODELS = os.path.join(REPO, "apps", "web", "public", "models")
OUT_TEX = os.path.join(REPO, "apps", "web", "public", "textures")

BODY = "RetrieverBody"
RIG = "RetrieverRig"

BAKE_RES = 2048
AO_SAMPLES = 128

# 18 shells are drawn from this one skinned mesh, so its triangle count is
# multiplied by 18 on screen. ~9k tris keeps the fur pass around 160k tris,
# which is affordable, and the silhouette survives the decimation because the
# shells thicken it anyway.
SHELL_TRI_TARGET = 9000


def log(msg):
    print(f"[bake-retriever] {msg}", flush=True)


def require(obj, name):
    if obj is None:
        log(f"FATAL: expected object '{name}' not found in the blend.")
        sys.exit(1)
    return obj


def only_select(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def ensure_uvs(ob):
    """Unwrap if there is no UV layer. Baking is impossible without one."""
    if len(ob.data.uv_layers) > 0:
        log(f"UV layer already present: {[l.name for l in ob.data.uv_layers]}")
        return

    log("no UV layer — running Smart UV Project")
    only_select(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # A generous island margin: the shells sample this atlas at an offset, so
    # tight islands bleed across seams and show up as dark seams in the fur.
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"unwrapped -> {[l.name for l in ob.data.uv_layers]}")


def make_bake_image(name):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, width=BAKE_RES, height=BAKE_RES, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    return img


def set_bake_target(ob, img):
    """Point every material on the object at `img` as the active bake target."""
    for slot in ob.material_slots:
        mat = slot.material
        if mat is None:
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        node = nt.nodes.get("__baketarget")
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.name = "__baketarget"
            node.location = (-800, 400)
        node.image = img
        nt.nodes.active = node
        node.select = True


def strip_bake_targets(ob):
    for slot in ob.material_slots:
        mat = slot.material
        if mat is None or not mat.use_nodes:
            continue
        node = mat.node_tree.nodes.get("__baketarget")
        if node:
            mat.node_tree.nodes.remove(node)


def bake_ao(ob):
    # The AO bake is by far the slowest step, and it only depends on the mesh.
    # Iterating on the export flags below should not cost another one.
    path = os.path.join(OUT_TEX, "retriever-ao.webp")
    if "--force-bake" not in sys.argv and os.path.exists(path):
        log(f"AO already baked at {path} — skipping (pass --force-bake to redo)")
        return path

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = AO_SAMPLES
    scene.cycles.use_denoising = True
    try:
        scene.cycles.device = "CPU"  # headless box, no guaranteed GPU compute
    except Exception:
        pass

    img = make_bake_image("retriever_ao")
    set_bake_target(ob, img)
    only_select(ob)

    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 16

    log(f"baking AO at {BAKE_RES}x{BAKE_RES}, {AO_SAMPLES} samples (this is the slow part)")
    bpy.ops.object.bake(type="AO")

    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    log(f"wrote {path}")
    strip_bake_targets(ob)
    return path


def bake_curvature_to_vcol(ob):
    """Pointiness -> vertex colour.

    Curvature is what makes a coat read as having depth rather than one flat
    gold: it darkens the troughs between fur clumps and catches the ridges. It
    travels as a vertex attribute rather than a texture because it is cheap,
    needs no second UV sample in the shell shader, and survives decimation.
    """
    me = ob.data
    attr_name = "curvature"
    existing = me.color_attributes.get(attr_name)
    if existing:
        me.color_attributes.remove(existing)
    me.color_attributes.new(name=attr_name, type="FLOAT_COLOR", domain="POINT")

    # Approximate pointiness directly: compare each vertex against the mean of
    # its linked neighbours along the normal. Concave -> dark, convex -> light.
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
        d = (v.co - avg).dot(v.normal)
        vals.append(d)

    lo = min(vals)
    hi = max(vals)
    rng = (hi - lo) or 1.0
    for i, raw in enumerate(vals):
        c = (raw - lo) / rng
        layer.data[i].color = (c, c, c, 1.0)

    log(f"baked curvature to vertex colour '{attr_name}' (range {lo:.4f}..{hi:.4f})")


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
    # Applied before export so the armature weights come with it.
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    log(f"decimated to {after} tris")


def export_glb(body, rig, path):
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
        export_apply=False,          # keep the armature modifier live
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
    size = os.path.getsize(path)
    log(f"wrote {path} ({size/1024:.0f} KB)")


def main():
    log("=" * 72)
    log("WARNING: this script exports the PRISTINE animal — no sculpt, no")
    log("         withers anchor, no face, no bound tail. The shipping pipeline")
    log("         is scripts/blender/reproportion-retriever.py. Pass")
    log("         --unsculpted to confirm you meant this one.")
    log("=" * 72)
    if "--unsculpted" not in sys.argv:
        log("refusing to overwrite retriever.glb; nothing written.")
        return
    os.makedirs(OUT_MODELS, exist_ok=True)
    os.makedirs(OUT_TEX, exist_ok=True)

    body = require(bpy.data.objects.get(BODY), BODY)
    rig = require(bpy.data.objects.get(RIG), RIG)

    acts = [a.name for a in bpy.data.actions]
    log(f"actions in file: {acts}")

    ensure_uvs(body)
    bake_ao(body)
    bake_curvature_to_vcol(body)
    decimate_for_shells(body)

    export_glb(body, rig, os.path.join(OUT_MODELS, "retriever.glb"))

    log("DONE")


if __name__ == "__main__":
    main()
