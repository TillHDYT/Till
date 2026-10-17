# Setzt die Sichel (Blender-Datei) in die rechte Hand des Mixamo-Magiers und exportiert ein FBX mit Skelett,
# Texturen und der Animation aus der Eingabe. Die Sichel ist starr am Handknochen (Gewicht 1 auf RightHand).
#   python mage_scythe.py <figur.fbx> <sichel.blend> <ausgabe.fbx> [vorschau.glb]
import sys
import bpy
import numpy as np
from mathutils import Matrix, Vector

FIG, WEAPON, OUT = sys.argv[-4], sys.argv[-3], sys.argv[-2]
PREVIEW = sys.argv[-1] if sys.argv[-1].endswith(".glb") else None
if PREVIEW is None:
    FIG, WEAPON, OUT = sys.argv[-3], sys.argv[-2], sys.argv[-1]
LENGTH = 2.0  # Länge der Sichel in Metern
GRIP = 0.47  # Griffstelle: Anteil der Schaftlänge vom unteren Ende (Klinge am anderen Ende, bei -X)
HAND = "mixamorig:RightHand"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=FIG)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = next(o for o in bpy.data.objects if o.type == "MESH")
with bpy.data.libraries.load(WEAPON) as (src, dst):
    dst.objects = ["scythe"]
sc = bpy.context.scene
weapon = dst.objects[0]
sc.collection.objects.link(weapon)

# Farben (die Textur der Sichel fehlt in der Datei): dunkles Silber und braunes Holz
for m in weapon.data.materials:
    col = (0.62, 0.64, 0.7, 1.0) if m.name == "metal" else (0.28, 0.16, 0.08, 1.0)
    m.diffuse_color = col
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Metallic"].default_value = 0.8 if m.name == "metal" else 0.0
    bsdf.inputs["Roughness"].default_value = 0.35 if m.name == "metal" else 0.7
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    m.name = "Sichel_" + ("Metall" if m.name == "metal" else "Holz")

# Sichel-Geometrie in Modellkoordinaten (ohne Objekttransformation), Kantenteilung anwenden
bpy.context.view_layer.objects.active = weapon
for mod in list(weapon.modifiers):
    bpy.ops.object.modifier_apply(modifier=mod.name)
weapon.matrix_world = Matrix.Identity(4)
wco = np.array([v.co[:] for v in weapon.data.vertices])
x_len = wco[:, 0].max() - wco[:, 0].min()
k = LENGTH / x_len
GRIP_X = wco[:, 0].max() - GRIP * x_len
sl = np.argsort(np.abs(wco[:, 0] - GRIP_X))[:12]  # nächste Schaftpunkte
grip_local = Vector((GRIP_X, float(wco[sl, 1].mean()), float(wco[sl, 2].mean())))

# Haltung im ersten Bild der Animation: Schaft fast senkrecht (leicht nach vorn und außen), Klinge oben nach vorn
sc.frame_set(1)
hand = arm.pose.bones[HAND]
mid = arm.pose.bones["mixamorig:RightHandMiddle1"]
hw = arm.matrix_world @ hand.head
mw = arm.matrix_world @ mid.head
grip_world = hw.lerp(mw, 0.7)
up = Vector((-0.06, -0.12, 1.0)).normalized()  # Schaftrichtung zur Klinge (Figur schaut nach -Y, rechts = -X)
fwd = Vector((0.0, -1.0, 0.0))
fwd = (fwd - up * fwd.dot(up)).normalized()
side = up.cross(fwd)
# Modellachsen: -X = Schaft zur Klinge, -Y = Klingenrichtung, Z = Seite
R = Matrix((
    (-up.x, -fwd.x, side.x),
    (-up.y, -fwd.y, side.y),
    (-up.z, -fwd.z, side.z),
)).to_4x4()
S = Matrix.Diagonal((k, k, k, 1.0))
posed = Matrix.Translation(grip_world) @ R @ S @ Matrix.Translation(-grip_local)

# in die Ruhepose zurückrechnen: relativ zur Hand bleibt die Sichel gleich
hand_pose = arm.matrix_world @ hand.matrix
hand_rest = arm.matrix_world @ arm.data.bones[HAND].matrix_local
rest = hand_rest @ hand_pose.inverted() @ posed
# Weltkoordinaten -> Koordinaten des Körpermeshes
to_body = body.matrix_world.inverted() @ rest
weapon.data.transform(to_body)
weapon.matrix_world = body.matrix_world.copy()

# fest an die Hand binden und mit dem Körper vereinen
vg = weapon.vertex_groups.new(name=HAND)
vg.add(list(range(len(weapon.data.vertices))), 1.0, "REPLACE")
bpy.ops.object.select_all(action="DESELECT")
weapon.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("Sichel eingesetzt, Maßstab", round(k, 3), "Griff", tuple(round(v, 3) for v in grip_world))

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.fbx(
    filepath=OUT, use_selection=True, add_leaf_bones=False, bake_anim=True,
    path_mode="COPY", embed_textures=True, mesh_smooth_type="FACE",
)
if PREVIEW:
    bpy.ops.export_scene.gltf(filepath=PREVIEW, export_format="GLB", export_animations=True, export_image_format="JPEG")
