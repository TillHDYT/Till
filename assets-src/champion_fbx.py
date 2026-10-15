# Wandelt einen Mixamo-Champion (FBX mit Skin und Laufanimation) in ein GLB für das Spiel um:
#   python champion_fbx.py <eingabe.fbx> <ausgabe.glb>
#   python3 glb_textures.py <ausgabe.glb>        (Texturen verkleinern, Alpha-Material richtig setzen)
# - UV-Koordinaten und Texturen bleiben erhalten (beim Weg über Assimp gingen die UVs verloren)
# - die Animation heißt danach "Run"
# - Laufen auf der Stelle: die Vorwärtsbewegung der Hüfte wird herausgerechnet, das Wippen bleibt
import os
import sys

import bpy  # noqa: I001

SRC, OUT = sys.argv[-2], sys.argv[-1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
act = arm.animation_data.action
act.name = "Run"


def fcurves_of(action):
    """F-Kurven einer Aktion (Blender 4.4+ mit Ebenen/Slots oder ältere Form)."""
    if hasattr(action, "layers") and action.layers:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out
    return list(action.fcurves)


hips = [fc for fc in fcurves_of(act) if fc.data_path == 'pose.bones["mixamorig:Hips"].location']
moved = []
for fc in hips:
    kps = fc.keyframe_points
    if len(kps) < 2:
        continue
    f0, f1 = kps[0].co.x, kps[-1].co.x
    v0, v1 = kps[0].co.y, kps[-1].co.y
    drift = v1 - v0
    span = max(abs(k.co.y - v0) for k in kps)
    # nur Kanäle mit deutlicher Fortbewegung (Start und Ende weit auseinander) gerade ziehen
    if abs(drift) > 0.5 * max(span, 1e-6) and abs(drift) > 5:
        for k in kps:
            t = (k.co.x - f0) / (f1 - f0)
            k.co.y -= drift * t
            k.handle_left.y -= drift * t
            k.handle_right.y -= drift * t
        fc.update()
        moved.append((fc.array_index, round(drift, 2)))
print("in place: removed drift on hips channels", moved)

# Kontrolle in Weltkoordinaten
sc = bpy.context.scene
sc.frame_start, sc.frame_end = int(act.frame_range[0]), int(act.frame_range[1])
hb = arm.pose.bones["mixamorig:Hips"]
pts = []
for f in range(sc.frame_start, sc.frame_end + 1):
    sc.frame_set(f)
    pts.append(arm.matrix_world @ hb.head)
print("hips travel after fix", [round(v, 3) for v in (pts[-1] - pts[0])], "max horiz", round(max(((p.x - pts[0].x) ** 2 + (p.y - pts[0].y) ** 2) ** 0.5 for p in pts), 3))

# Specular-Textur weglassen (kaum sichtbar, spart Platz); doppelte Bilder zusammenlegen
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    for n in list(m.node_tree.nodes):
        if n.type == "TEX_IMAGE" and n.image and "specular" in os.path.basename(n.image.filepath).lower():
            for link in list(n.outputs["Color"].links):
                m.node_tree.links.remove(link)
            m.node_tree.nodes.remove(n)
seen = {}
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            key = os.path.basename(n.image.filepath)
            n.image = seen.setdefault(key, n.image)
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)

bpy.ops.object.select_all(action="DESELECT")
for o in bpy.context.scene.objects:
    if o.type in ("ARMATURE", "MESH"):
        o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_image_format="AUTO",
    export_yup=True,
    export_skins=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_apply=False,
)
print("EXPORTED", OUT, os.path.getsize(OUT))
