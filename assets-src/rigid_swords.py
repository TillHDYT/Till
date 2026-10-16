# Macht die mit den Händen verschmolzenen Schwerter eines Mixamo-geriggten Modells starr:
#   python rigid_swords.py -- <eingabe.fbx> <ausgabe.fbx> [--ref tpose.fbx] [--grenze 0.85]
# Mixamo verteilt beim Auto-Rig Unterarm- und Fingerknochen auf Griff und Klinge, dadurch verbiegen sie sich. In der
# T-Pose zeigen die Klingen nach außen; alles weiter außen als die Grenze (Abstand zur Mitte in x, Modell 2 hoch, das
# Handgelenk liegt bei 0.83) bekommt 100 % den Handknochen der jeweiligen Seite: Faust, Griff und Klinge bewegen sich
# dann nur noch mit der Hand. Mit --ref wird die Auswahl in einer T-Pose-Datei desselben Modells (gleiche Eckpunkte)
# getroffen, so lassen sich Dateien mit beliebiger Animation reparieren; die Animation bleibt erhalten.
import sys

import bpy  # noqa: I001

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
REF = args[args.index("--ref") + 1] if "--ref" in args else SRC
LIMIT = float(args[args.index("--grenze") + 1]) if "--grenze" in args else 0.85


def posed_x(path):
    """x-Lage aller Eckpunkte in der T-Pose (Bild 0 der Datei)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    sc = bpy.context.scene
    sc.frame_set(0)
    me = next(o for o in sc.objects if o.type == "MESH")
    dg = bpy.context.evaluated_depsgraph_get()
    X = [(me.matrix_world @ p.co).x for p in me.evaluated_get(dg).to_mesh().vertices]
    return X


X = posed_x(REF)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
sc = bpy.context.scene
me = next(o for o in sc.objects if o.type == "MESH")
assert len(me.data.vertices) == len(X), "Referenz hat andere Eckpunkte"
hands = {1: me.vertex_groups["mixamorig:LeftHand"], -1: me.vertex_groups["mixamorig:RightHand"]}
n = {1: 0, -1: 0}
for v in me.data.vertices:
    x = X[v.index]
    if abs(x) < LIMIT:
        continue
    side = 1 if x > 0 else -1
    for g in list(v.groups):
        me.vertex_groups[g.group].remove([v.index])
    hands[side].add([v.index], 1.0, "REPLACE")
    n[side] += 1
print("starr: links", n[1], "rechts", n[-1], "Eckpunkte")
anim = bool(bpy.data.actions)
if anim:
    # Länge der Animation wie im Original (sonst exportiert Blender die Standardlänge 1-250)
    f0, f1 = bpy.data.actions[0].frame_range
    sc.frame_start, sc.frame_end = int(f0), int(f1)
bpy.ops.export_scene.fbx(filepath=OUT, path_mode="COPY", embed_textures=True, add_leaf_bones=False, bake_anim=anim,
                         bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False, object_types={"ARMATURE", "MESH"})
print("FBX", OUT, "mit Animation" if anim else "ohne Animation")
