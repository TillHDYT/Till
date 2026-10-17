# Bindet eine Waffe nach Mixamo wieder starr an einen Handknochen:
#   python rigid_weapon.py -- <eingabe.fbx> <ausgabe.fbx> [--hand mixamorig:RightHand] [--material Sichel]
# Mixamo verteilt beim Auto-Rig auch die Waffe auf Unterarm- und Fingerknochen, dann verbiegt sie sich. Alle Flächen
# mit einem Material, dessen Name mit --material beginnt (Standard „Sichel“), bekommen 100 % den Handknochen;
# die Animation bleibt erhalten.
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
HAND = args[args.index("--hand") + 1] if "--hand" in args else "mixamorig:RightHand"
PREFIX = args[args.index("--material") + 1] if "--material" in args else "Sichel"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
n = 0
for me in [o for o in bpy.data.objects if o.type == "MESH"]:
    mats = {i for i, m in enumerate(me.data.materials) if m and m.name.startswith(PREFIX)}
    if not mats:
        continue
    verts = {v for p in me.data.polygons if p.material_index in mats for v in p.vertices}
    hand = me.vertex_groups.get(HAND) or me.vertex_groups.new(name=HAND)
    for vg in me.vertex_groups:
        if vg != hand:
            vg.remove(list(verts))
    hand.add(list(verts), 1.0, "REPLACE")
    n += len(verts)
print("Waffe starr an", HAND, ":", n, "Eckpunkte")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.fbx(filepath=OUT, use_selection=True, add_leaf_bones=False, bake_anim=True, path_mode="COPY", embed_textures=True)
