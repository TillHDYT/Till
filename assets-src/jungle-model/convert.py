"""Camp-Modell für alle Dschungel-Camps (JglCamps🔴.fbx, Meshy-Export als Zip mit FBX + Textur).

Erdboden der Mulde (flach, nach Süden = Modell -y offen) mit Felsring und Bäumen. Mitte des Bodens = Ursprung,
Boden = Höhe 0, Modell-Einheiten (Maßstab und Drehung pro Camp im Spiel, siehe navgrid.ts). Dazu eine Höhenkarte der
Oberseite (Felsen über dem Boden), damit das Spiel die Lage so wählt, dass keine Wege unter den Felsen verschwinden.
Aufruf (Blender-Python): python convert.py "JglCamps🔴.fbx" ../../src/assets/jgcamp.glb ../../src/game/jgCampHeight.ts
"""
import base64, math, os, sys, tempfile, zipfile
import bpy, mathutils
import numpy as np

src, out_glb, out_ts = sys.argv[-3], sys.argv[-2], sys.argv[-1]
CX, CY = 0.03, -0.05   # Mitte des hinteren, runden Bodenteils (dort stehen die Monster)
FLOOR = -0.29          # Höhe des Erdbodens
R = 1.0                # Höhenkarte über ±R um die Mitte
HN = 64

tmp = tempfile.mkdtemp()
with zipfile.ZipFile(src) as z:
    z.extractall(tmp)
fbx = next(os.path.join(r, f) for r, _, fs in os.walk(tmp) for f in fs if f.lower().endswith(".fbx"))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)
o = next(o for o in bpy.data.objects if o.type == "MESH")
o.name = "JungleCamp"
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
for v in o.data.vertices:
    v.co.x -= CX
    v.co.y -= CY
    v.co.z -= FLOOR
    # vorne (zum Eingang) taucht der Erdboden sanft unter das Gelände, statt als Platte über den Weg zu laufen
    if v.co.z < 0.06:
        v.co.z -= sstep(-0.32, -0.62, v.co.y) * 0.12
o.data.update()
# 12 Kopien auf der Karte: auf ein Drittel vereinfachen
n0 = len(o.data.polygons)
mod = o.modifiers.new("dec", "DECIMATE")
mod.ratio = 0.33
bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.shade_smooth()
print("Dreiecke", n0, "->", len(o.data.polygons))

dg = bpy.context.evaluated_depsgraph_get()
sc = bpy.context.scene
hm = np.zeros((HN + 1, HN + 1), np.uint8)
for j in range(HN + 1):
    for i in range(HN + 1):
        x = -R + 2 * R * i / HN
        y = R - 2 * R * j / HN  # Zeile j: Welt-z wächst (Modell -y)
        hit, loc, *_ = sc.ray_cast(dg, mathutils.Vector((x, y, 3)), mathutils.Vector((0, 0, -1)))
        if hit:
            hm[j, i] = int(np.clip(round(loc.z * 200) + 21, 1, 255))
with open(out_ts, "w") as f:
    f.write("// Automatisch erzeugt von assets-src/jungle-model/convert.py — nicht von Hand ändern.\n")
    f.write("// Oberseite des Camp-Modells in Modell-Einheiten (x nach Osten, z nach Süden, Bodenmitte 0, Boden = Höhe 0).\n")
    f.write("// Byte 0 = kein Modell, sonst Höhe = (b - 21) / 200.\n")
    f.write(f"export const JG_CAMP_HEIGHT = {{ r: {R}, n: {HN + 1}, data: \"{base64.b64encode(hm.tobytes()).decode()}\" }};\n")

for im in bpy.data.images:
    if im.size[0] > 1024:
        im.scale(1024, 1024)
mat = o.data.materials[0]
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_image_format="JPEG",
                          export_jpeg_quality=85, export_yup=True, export_apply=True)
print("GLB", os.path.getsize(out_glb))
