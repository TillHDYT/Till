# Setzt die Sichel (Blender-Datei) in die rechte Hand des Mixamo-Magiers und exportiert ein FBX mit Skelett,
# Texturen und der Animation aus der Eingabe:
#   python mage_scythe.py -- <figur.fbx> <sichel.blend> <ausgabe.fbx> [vorschau.glb]
# - Der Schaft läuft quer durch die Handfläche (wie man einen Stab wirklich greift), schräg nach vorn oben,
#   die Klinge oben und nach vorn.
# - Die Sichel ist starr an den Handknochen gebunden (Gewicht 1 auf RightHand): sie folgt jeder Bewegung der Hand.
# - Die Finger der rechten Hand werden in allen Bildern der Animation um den Schaft geschlossen.
# Nach Mixamo: rigid_weapon.py bindet die Sichel wieder starr an die Hand (Mixamo verteilt sie sonst auf
# mehrere Knochen, dann verbiegt sie sich).
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[-4:]
FIG, WEAPON, OUT = args[0], args[1], args[2]
PREVIEW = args[3] if len(args) > 3 else None
LENGTH = 2.0  # Länge der Sichel in Metern
GRIP = 0.4  # Griffstelle: Anteil der Schaftlänge vom unteren Ende (Klinge am anderen Ende)
TILT = 1.3  # Neigung: wie stark der Schaft nach oben zeigt (0 = waagerecht quer durch die Hand)
HAND = "mixamorig:RightHand"
FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"]

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
    metal = m.name == "metal"
    col = (0.62, 0.64, 0.7, 1.0) if metal else (0.28, 0.16, 0.08, 1.0)
    m.diffuse_color = col
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Metallic"].default_value = 0.8 if metal else 0.0
    bsdf.inputs["Roughness"].default_value = 0.35 if metal else 0.7
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    m.name = "Sichel_" + ("Metall" if metal else "Holz")

# Sichel-Geometrie in Modellkoordinaten, Kantenteilung anwenden
bpy.context.view_layer.objects.active = weapon
for mod in list(weapon.modifiers):
    bpy.ops.object.modifier_apply(modifier=mod.name)
weapon.matrix_world = Matrix.Identity(4)
wco = np.array([v.co[:] for v in weapon.data.vertices])
x_len = wco[:, 0].max() - wco[:, 0].min()
k = LENGTH / x_len
GRIP_X = wco[:, 0].max() - GRIP * x_len
near = np.argsort(np.abs(wco[:, 0] - GRIP_X))[:12]
grip_local = Vector((GRIP_X, float(wco[near, 1].mean()), float(wco[near, 2].mean())))
shaft_r = float(np.percentile(np.abs(wco[near, 2] - grip_local.z), 90)) * k

sc.frame_set(int(sc.frame_start))
bpy.context.view_layer.update()
W = arm.matrix_world
pb = arm.pose.bones


def head(n):
    return W @ pb[n].head


def tip(f):
    return head(f"mixamorig:RightHand{f}4")


hand_h = head(HAND)
mid1 = head("mixamorig:RightHandMiddle1")
finger_dir = (mid1 - hand_h).normalized()
knuckle = head("mixamorig:RightHandIndex1") - head("mixamorig:RightHandPinky1")
knuckle = (knuckle - finger_dir * knuckle.dot(finger_dir)).normalized()  # quer durch die Hand, zum Zeigefinger
# Handfläche: zur Seite, auf der der Daumen liegt
t = head("mixamorig:RightHandThumb2") - hand_h
palm = (t - finger_dir * t.dot(finger_dir) - knuckle * t.dot(knuckle)).normalized()
grip_world = hand_h.lerp(mid1, 0.75) + palm * (shaft_r + 0.022)

# Schaftrichtung: quer durch die Hand, zur Daumenseite (Zeigefinger) und nach oben geneigt
up = (knuckle + Vector((0, 0, TILT))).normalized()
fwd = Vector((0.0, -1.0, 0.0))  # Figur schaut nach -Y
fwd = (fwd - up * fwd.dot(up)).normalized()
side = up.cross(fwd)
# Modellachsen der Sichel: -X = Schaft zur Klinge, -Y = Klingenrichtung, Z = Seite
R = Matrix(((-up.x, -fwd.x, side.x), (-up.y, -fwd.y, side.y), (-up.z, -fwd.z, side.z))).to_4x4()
posed = Matrix.Translation(grip_world) @ R @ Matrix.Diagonal((k, k, k, 1.0)) @ Matrix.Translation(-grip_local)


def dist_to_shaft(p):
    v = p - grip_world
    return (v - up * v.dot(up)).length


# Finger um den Schaft schließen: je Finger Achse und Winkel suchen, bei dem die Fingerkuppe am Schaft anliegt
curl = {}
AXES = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 0, -1)), Vector((0, 1, 0)), Vector((0, -1, 0))]
for f in FINGERS:
    bones = [f"mixamorig:RightHand{f}{i}" for i in (1, 2, 3)]
    base = {b: pb[b].rotation_quaternion.copy() for b in bones}
    best = (dist_to_shaft(tip(f)), None, 0.0)
    for ax in AXES[:4] if f != "Thumb" else AXES:
        for deg in range(5, 101, 5):
            a = math.radians(deg)
            for i, b in enumerate(bones):
                share = 0.6 if (f == "Thumb" and i == 0) else 1.0
                pb[b].rotation_quaternion = base[b] @ Quaternion(ax, a * share)
            bpy.context.view_layer.update()
            d = abs(dist_to_shaft(tip(f)) - (shaft_r + 0.012))
            # mittlere Glieder dürfen nicht durch den Schaft gehen
            inside = min(dist_to_shaft(head(b)) for b in bones[1:]) < shaft_r
            if not inside and d < best[0]:
                best = (d, ax, a)
    for b in bones:
        pb[b].rotation_quaternion = base[b]
    curl[f] = best
    print("Finger", f, "Achse", tuple(best[1]) if best[1] else None, "Winkel", round(math.degrees(best[2])), "Abstand", round(best[0], 3))
bpy.context.view_layer.update()

# Sichel in die Ruhepose zurückrechnen (relativ zur Hand gleich) und an die Hand binden
hand_pose = W @ pb[HAND].matrix
hand_rest = W @ arm.data.bones[HAND].matrix_local
rest = hand_rest @ hand_pose.inverted() @ posed
weapon.data.transform(body.matrix_world.inverted() @ rest)
weapon.matrix_world = body.matrix_world.copy()
vg = weapon.vertex_groups.new(name=HAND)
vg.add(list(range(len(weapon.data.vertices))), 1.0, "REPLACE")
bpy.ops.object.select_all(action="DESELECT")
weapon.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()

# Fingerkrümmung in alle Bilder der Animation schreiben
act = arm.animation_data.action
f0, f1 = (int(v) for v in act.frame_range)
for fr in range(f0, f1 + 1):
    sc.frame_set(fr)
    for f, (_d, ax, a) in curl.items():
        if ax is None:
            continue
        for i in (1, 2, 3):
            b = pb[f"mixamorig:RightHand{f}{i}"]
            share = 0.6 if (f == "Thumb" and i == 1) else 1.0
            b.rotation_quaternion = b.rotation_quaternion @ Quaternion(ax, a * share)
            b.keyframe_insert("rotation_quaternion", frame=fr)
sc.frame_set(f0)
print("Sichel eingesetzt: Maßstab", round(k, 3), "Schaftradius", round(shaft_r, 3), "Bilder", f0, "-", f1)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.fbx(
    filepath=OUT, use_selection=True, add_leaf_bones=False, bake_anim=True,
    path_mode="COPY", embed_textures=True, mesh_smooth_type="FACE",
)
if PREVIEW:
    bpy.ops.export_scene.gltf(filepath=PREVIEW, export_format="GLB", export_animations=True, export_image_format="JPEG")
