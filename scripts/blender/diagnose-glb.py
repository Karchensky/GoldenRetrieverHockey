# Diagnose a GLB's skinning with the same measures as diagnose-rig.py.
# READ-ONLY: imports into an empty scene, writes nothing.
#
#   blender --background --python scripts/blender/diagnose-glb.py -- <file.glb>
#
# WHY SEPARATELY FROM THE .blend.
# The shipped rig is not the source rig. reproportion-retriever.py resculpts,
# rebinds the tail, renames front_upper.* to front_arm.* and plants NON-
# DEFORMING marker bones under the old names before export. So a claim about
# "the rig" is ambiguous until you say which file, and the two disagree on the
# exact bones the handoff calls out.

import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import importlib.util

spec = importlib.util.spec_from_file_location(
    "diagnose_rig", os.path.join(HERE, "diagnose-rig.py"))
diagnose_rig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnose_rig)


def main():
    argv = sys.argv
    path = argv[argv.index("--") + 1] if "--" in argv else None
    if not path:
        print("usage: ... --python diagnose-glb.py -- <file.glb>")
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    print(f"[diag] IMPORTED {path}", flush=True)
    diagnose_rig.main()


if __name__ == "__main__":
    main()
