# Bereitet Kiras Dolche (Meshy-Modell aus "Schwerter 3D Modell.fbx", eigentlich ein ZIP mit FBX und Texturen) fürs Spiel auf:
#   unzip "Schwerter 3D Modell.fbx" -d dolche
#   python daggers.py -- dolche/<...>/Meshy_AI_twin_daggers_light_..._texture.fbx src/assets/daggers.glb
#   python3 glb_textures.py src/assets/daggers.glb 1024
# - das Modell enthält beide Dolche in einem Mesh: Aufteilen nach losen Teilen, links (-x) und rechts (+x)
# - Drehpunkt jedes Dolchs = Mitte des Griffs (zwischen Ringknauf und Parierstange), Klinge zeigt nach +y
# - Knoten "DaggerL" und "DaggerR", gemeinsames Material
import sys

import bpy  # noqa: I001
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
SRC, OUT = args[-2], args[-1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
o = next(x for x in bpy.context.scene.objects if x.type == "MESH")
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
parts = sorted((x for x in bpy.context.scene.objects if x.type == "MESH"), key=lambda p: -len(p.data.vertices))[:2]
for extra in [x for x in bpy.context.scene.objects if x.type == "MESH" and x not in parts]:
    bpy.data.objects.remove(extra)

for p in parts:
    vs = [v.co for v in p.data.vertices]
    zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
    h = zmax - zmin
    # Parierstange = breitester Querschnitt in der oberen Hälfte, Griff liegt zwischen ihr und dem Ringknauf
    bands = []
    for k in range(40):
        z0 = zmin + h * (0.5 + 0.5 * k / 40)
        z1 = z0 + h * 0.5 / 40
        b = [v.x for v in vs if z0 <= v.z <= z1]
        bands.append((max(b) - min(b) if b else 0, (z0 + z1) / 2))
    guard_z = max(bands)[1]
    grip_z = guard_z + (zmax - guard_z) * 0.42
    cx = sum(v.x for v in vs) / len(vs)
    cy = sum(v.y for v in vs) / len(vs)
    # Drehpunkt auf den Griff, dann Klinge nach oben drehen (Blender +z = glTF +y)
    p.data.transform(Matrix.Translation(Vector((-cx, -cy, -grip_z))))
    p.data.transform(Matrix.Rotation(3.14159265, 4, "X"))
    p.name = "DaggerL" if cx < 0 else "DaggerR"
    p.location = (cx, 0, 0)
    print(p.name, "Länge", round(h, 3), "Parierstange z", round(guard_z, 3), "Griff z", round(grip_z, 3))
    for m in p.data.materials:
        if m and m.node_tree:
            bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                # Normal-Map gibt es nicht; Metall und Rauheit aus den Meshy-Texturen bleiben
                pass

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_animations=False)
print("EXPORTED", OUT)
