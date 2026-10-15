# Holt eine einzelne Mixamo-Animation (FBX) als kleines GLB nur mit Skelett und Animation heraus:
#   python champion_anim.py <animation.fbx> <ausgabe.glb> <Name>
# Das Skelett muss dasselbe sein wie beim Champion-Modell (gleiche Knochennamen), dann spielt das
# Spiel die Animation direkt auf dem Modell ab (siehe loadChampionModels in models.ts).
import os
import sys

import bpy  # noqa: I001

SRC, OUT, NAME = sys.argv[-3], sys.argv[-2], sys.argv[-1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
act = arm.animation_data.action
act.name = NAME
# nur Skelett und Animation exportieren, Mesh und Texturen bringt schon das Champion-Modell mit
for o in list(bpy.context.scene.objects):
    if o.type == "MESH":
        bpy.data.objects.remove(o)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = int(act.frame_range[0]), int(act.frame_range[1])
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_yup=True,
)
print("EXPORTED", NAME, act.frame_range[:], os.path.getsize(OUT))
