# Macht die mit den Händen verschmolzenen Schwerter eines Mixamo-geriggten Modells starr:
#   python rigid_swords.py -- <mixamo_tpose.fbx> <ausgabe.fbx> [grenze=0.9]
# Mixamo verteilt beim Auto-Rig Arm- und Fingerknochen auf die Klingen, dadurch verbiegen sie sich. In der T-Pose
# zeigen die Klingen nach außen; alles weiter außen als die Grenze (Abstand zur Mitte in x, Modell 2 hoch) bekommt
# 100 % den Handknochen der jeweiligen Seite. Die Faust bleibt dabei geschlossen und hält das Schwert fest.
import sys

import bpy  # noqa: I001

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
LIMIT = float(args[2]) if len(args) > 2 else 0.9

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
sc.frame_set(0)
for me in [o for o in sc.objects if o.type == "MESH"]:
    groups = {g.name: g for g in me.vertex_groups}
    hands = {1: groups["mixamorig:LeftHand"], -1: groups["mixamorig:RightHand"]}
    n = {1: 0, -1: 0}
    # Lage in der T-Pose (das Netz selbst liegt oft noch in der Ausgangshaltung, die Pose kommt vom Skelett)
    dg = bpy.context.evaluated_depsgraph_get()
    posed = me.evaluated_get(dg).to_mesh()
    X = [(me.matrix_world @ p.co).x for p in posed.vertices]
    me.evaluated_get(dg).to_mesh_clear()
    for v in me.data.vertices:
        x = X[v.index]
        if abs(x) < LIMIT:
            continue
        side = 1 if x > 0 else -1
        for g in v.groups:
            me.vertex_groups[g.group].remove([v.index])
        hands[side].add([v.index], 1.0, "REPLACE")
        n[side] += 1
    print("starr", me.name, "links", n[1], "rechts", n[-1], "Eckpunkte")
bpy.ops.export_scene.fbx(filepath=OUT, path_mode="COPY", embed_textures=True, add_leaf_bones=False, bake_anim=False, object_types={"ARMATURE", "MESH"})
print("FBX", OUT)
