# Inspect a .blend: what objects, meshes, materials, UVs and armatures are in it.
# Run: blender <file.blend> --background --python scripts/blender/inspect-blend.py
#
# Written to answer one question before anything is built on this file: is the
# retriever in assets/3d/ a real mesh with usable topology and UVs, or is it a
# render-only artefact we would have to re-author anyway.

import bpy
import sys


def main():
    print("=" * 70)
    print("BLEND INSPECTION:", bpy.data.filepath or "(none)")
    print("=" * 70)

    print("\n-- SCENES --")
    for sc in bpy.data.scenes:
        print(f"  {sc.name}: engine={sc.render.engine} frame={sc.frame_current}")

    print("\n-- OBJECTS --")
    for ob in bpy.data.objects:
        line = f"  {ob.name:<28} type={ob.type:<10}"
        if ob.type == "MESH":
            me = ob.data
            uv = [l.name for l in me.uv_layers]
            vcol = [l.name for l in me.color_attributes]
            line += (
                f" verts={len(me.vertices):>7} polys={len(me.polygons):>7}"
                f" uv={uv} vcol={vcol}"
            )
            mods = [m.type for m in ob.modifiers]
            if mods:
                line += f" mods={mods}"
        elif ob.type == "ARMATURE":
            line += f" bones={len(ob.data.bones)}"
        print(line)

    print("\n-- MATERIALS --")
    for ma in bpy.data.materials:
        nodes = [n.type for n in ma.node_tree.nodes] if ma.use_nodes else []
        print(f"  {ma.name:<28} nodes={nodes}")

    print("\n-- ACTIONS / ANIMATION --")
    for ac in bpy.data.actions:
        print(f"  {ac.name:<28} frames={ac.frame_range[:]}")

    print("\n-- IMAGES --")
    for im in bpy.data.images:
        print(f"  {im.name:<28} size={tuple(im.size)} src={im.source}")

    # The decisive numbers for whether we can bake onto this directly.
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    total_v = sum(len(o.data.vertices) for o in meshes)
    total_p = sum(len(o.data.polygons) for o in meshes)
    with_uv = [o for o in meshes if len(o.data.uv_layers) > 0]
    print("\n" + "=" * 70)
    print(f"SUMMARY: {len(meshes)} mesh objects, {total_v} verts, {total_p} polys")
    print(f"         {len(with_uv)}/{len(meshes)} have UV layers (needed to bake)")
    print("=" * 70)


if __name__ == "__main__":
    main()
