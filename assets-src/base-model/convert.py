"""Basis-Hintergrund als 3D-Modell (SuperBasis3DHintergrund.fbx, Meshy-Export als Zip mit FBX + Textur).

Das Modell wird in Weltkoordinaten der blauen Basis gelegt (Rot ist die Punktspiegelung, siehe models.ts): gleiche Lage
wie der bisherige Basisboden (Brunnen, Treppen, Kanten), die Gebäude bleiben auf ihren LoL-Positionen. Dazu entsteht
eine Höhenkarte der Oberfläche, damit Einheiten und Gebäude auf dem Modell stehen.
Aufruf (Blender-Python): python convert.py SuperBasis3DHintergrund.fbx ../../src/assets/basemodel.glb ../../src/game/baseModelHeight.ts
"""
import base64, math, os, sys, tempfile, zipfile
import bpy, mathutils
import numpy as np

src, out_glb, out_ts = sys.argv[-3], sys.argv[-2], sys.argv[-1]
# Lage: Modellmitte und Maßstab (Modell ist 2 x 2 Einheiten groß), am alten Basisboden ausgerichtet
CX, CZ, SX, SZ = 56.5, 245.1, 50.9, 49.0
SY = 50.0
# mittlere Plattenhöhe des Modells (Median der Oberfläche) kommt auf die Bodenhöhe der Basis
FLOOR_Y = 0.12
HMAP = dict(x0=0.0, z0=188.0, size=112.0, res=2)  # Höhenkarte in Welt-Einheiten, 2 Zellen je Einheit

tmp = tempfile.mkdtemp()
with zipfile.ZipFile(src) as z:
    z.extractall(tmp)
fbx = next(os.path.join(r, f) for r, _, fs in os.walk(tmp) for f in fs if f.lower().endswith(".fbx"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)
o = next(o for o in bpy.data.objects if o.type == "MESH")
o.name = "BaseGround"
# im Export liegt die Oberseite bei -Y: aufrichten
o.rotation_euler.rotate(mathutils.Euler((math.radians(-90), 0, 0)))
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
o.select_set(True)
bpy.context.view_layer.objects.active = o
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Oberfläche abtasten (Modellkoordinaten), Median bestimmen
dg = bpy.context.evaluated_depsgraph_get()
sc = bpy.context.scene
def top(x, y):
    hit, loc, *_ = sc.ray_cast(dg, mathutils.Vector((x, y, 2)), mathutils.Vector((0, 0, -1)))
    return loc.z if hit else None
samp = [top(x, y) for x in np.linspace(-0.95, 0.95, 60) for y in np.linspace(-0.95, 0.95, 60)]
med = float(np.median([s for s in samp if s is not None]))
print("Median Oberfläche", med)

# in Weltkoordinaten (Blender: x = Welt-x, -y = Welt-z, z = Höhe)
me = o.data
for v in me.vertices:
    x, y, z = v.co
    v.co = mathutils.Vector((CX + SX * x, -(CZ - SZ * y), FLOOR_Y + SY * (z - med)))
me.update()
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()

# Höhenkarte (Welt), NaN = kein Modell; als Bytes: 0 = kein Modell, sonst Höhe = (b - 1) / 40 - 1
n = int(HMAP["size"] * HMAP["res"])
hm = np.zeros((n + 1, n + 1), np.uint8)
for j in range(n + 1):
    for i in range(n + 1):
        wx = HMAP["x0"] + i / HMAP["res"]
        wz = HMAP["z0"] + j / HMAP["res"]
        hit, loc, *_ = sc.ray_cast(dg, mathutils.Vector((wx, -wz, 50)), mathutils.Vector((0, 0, -1)))
        if hit:
            hm[j, i] = int(np.clip(round((loc.z + 1) * 40) + 1, 1, 255))
print("Höhenkarte", n + 1, "Abdeckung", float((hm > 0).mean()))
with open(out_ts, "w") as f:
    f.write("// Automatisch erzeugt von assets-src/base-model/convert.py — nicht von Hand ändern.\n")
    f.write("// Oberfläche des Basis-Modells (blaue Basis, Welt-Einheiten). Byte 0 = kein Modell, sonst Höhe = (b - 1) / 40 - 1.\n")
    f.write(f"export const BASE_MODEL_HEIGHT = {{ x0: {HMAP['x0']}, z0: {HMAP['z0']}, res: {HMAP['res']}, n: {n + 1}, data: \"{base64.b64encode(hm.tobytes()).decode()}\" }};\n")

# Textur als JPEG einbetten
for im in bpy.data.images:
    if im.size[0] > 0:
        im.file_format = "JPEG"
mat = me.materials[0]
mat.name = "BaseGround"
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_image_format="JPEG",
                          export_jpeg_quality=88, export_yup=True, export_apply=True)
print("GLB", os.path.getsize(out_glb))
