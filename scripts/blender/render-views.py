# Orthographic views of a retriever asset, in the MESH's own frame. READ-ONLY.
#
#   blender --background --python scripts/blender/render-views.py -- \
#       <in.glb|in.blend> <out_dir> [tag] [action] [frame]
#
# WHY IN THE MESH'S OWN FRAME.
# The bind mesh sits 50 degrees off the armature's axes, so a render down world
# -Y is a three-quarter view of the animal and every judgement about a leg being
# in the right place is made on a foreshortened picture. These cameras are built
# from the mesh's own nose-tail axis, so "side" is a true side.

import math
import os
import sys

import bpy
from mathutils import Vector


def log(m):
    print(f"[view] {m}", flush=True)


def body_frame(body):
    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    mx = sum(p.x for p in ws) / len(ws)
    my = sum(p.y for p in ws) / len(ws)
    sxx = sum((p.x - mx) ** 2 for p in ws)
    syy = sum((p.y - my) ** 2 for p in ws)
    sxy = sum((p.x - mx) * (p.y - my) for p in ws)
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    fwd = Vector((math.cos(th), math.sin(th), 0.0))
    crown = max(ws, key=lambda p: p.z)
    if (crown - Vector((mx, my, 0.0))).dot(fwd) < 0:
        fwd = -fwd
    return ws, fwd, Vector((-fwd.y, fwd.x, 0.0))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, out_dir = argv[0], argv[1]
    tag = argv[2] if len(argv) > 2 else "view"
    action = argv[3] if len(argv) > 3 and argv[3] != "-" else None
    frame = float(argv[4]) if len(argv) > 4 else 1.0
    os.makedirs(out_dir, exist_ok=True)

    if src.lower().endswith(".glb") or src.lower().endswith(".gltf"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=src)
    else:
        bpy.ops.wm.open_mainfile(filepath=src)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"
              and len(o.data.vertices) > 100]
    body = max(meshes, key=lambda o: len(o.data.vertices))
    rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    rig = rigs[0] if rigs else None

    # hide everything that is not the animal
    for o in bpy.data.objects:
        if o.type == "MESH" and o is not body:
            o.hide_render = True

    if rig is not None:
        if action:
            act = bpy.data.actions.get(action)
            if act is None:
                log(f"no action named {action}; rendering rest")
            else:
                rig.animation_data_create()
                try:
                    rig.animation_data.action = act
                    for sl in getattr(act, "slots", []):
                        rig.animation_data.action_slot = sl
                        break
                except Exception as e:
                    log(f"could not assign action: {e}")
                rig.data.pose_position = "POSE"
                bpy.context.scene.frame_set(int(frame))
        else:
            rig.data.pose_position = "REST"
        rig.hide_render = True
    bpy.context.view_layer.update()

    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    ws = [body.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    _u, fwd, lat = body_frame(body)
    up = Vector((0.0, 0.0, 1.0))

    a = [p.dot(fwd) for p in ws]
    l = [p.dot(lat) for p in ws]
    z = [p.z for p in ws]
    ctr = fwd * ((min(a) + max(a)) / 2) + lat * ((min(l) + max(l)) / 2) \
        + up * ((min(z) + max(z)) / 2)
    span = max(max(a) - min(a), max(l) - min(l), max(z) - min(z)) * 1.12

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = 900
    sc.render.resolution_y = 900
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "SINGLE"
    sh.single_color = (0.85, 0.62, 0.30)
    sh.show_cavity = True
    sh.show_object_outline = False
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.color = (0.02, 0.02, 0.025)

    cam_data = bpy.data.cameras.new("OrthoCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span
    cam = bpy.data.objects.new("OrthoCam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def shoot(name, dirv, upv):
        d = dirv.normalized()
        cam.location = ctr - d * span * 3.0
        # build rotation from -Z look direction
        zc = -d
        xc = upv.cross(zc).normalized()
        yc = zc.cross(xc)
        m = [[xc.x, yc.x, zc.x, 0.0],
             [xc.y, yc.y, zc.y, 0.0],
             [xc.z, yc.z, zc.z, 0.0],
             [0.0, 0.0, 0.0, 1.0]]
        from mathutils import Matrix
        cam.matrix_world = Matrix(m).transposed().transposed()
        cam.matrix_world.translation = ctr - d * span * 3.0
        p = os.path.join(out_dir, f"{tag}-{name}.png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        log(f"wrote {p}")

    shoot("side", -lat, up)          # true side: looking across the animal
    shoot("side2", lat, up)
    shoot("top", -up, fwd)           # from above
    shoot("front", fwd, up)          # nose-on
    shoot("three-quarter", (-lat * 0.80 + fwd * 0.55 - up * 0.25), up)


if __name__ == "__main__":
    main()
