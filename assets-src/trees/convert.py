"""Bäume für den ganzen Wald aus den Meshy-Exporten (Zip mit FBX + Textur): einzelner Baum und Dreiergruppe.

Vereinfacht (Tausende Kopien im Spiel) mit eingebrannter Normalmap (../lowpoly.py), Fuß auf y = 0, Mitte des Stamms
im Ursprung, Höhe in Modell-Einheiten (Skalierung im Spiel). Zwei Stufen: Handy (wenig Dreiecke, 1024²) und PC.
Aufruf (Blender-Python): python convert.py quelle.fbx(zip) ziel.glb DREIECKE TEXTUR NORMALMAP
"""
import os, sys, tempfile, zipfile
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lowpoly import lowpoly  # noqa: E402

src, out_glb, target, tex, nrm = sys.argv[-5], sys.argv[-4], int(sys.argv[-3]), int(sys.argv[-2]), int(sys.argv[-1])
tmp = tempfile.mkdtemp()
with zipfile.ZipFile(src) as z:
    z.extractall(tmp)
fbx = next(os.path.join(r, f) for r, _, fs in os.walk(tmp) for f in fs if f.lower().endswith(".fbx"))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)
o = next(o for o in bpy.data.objects if o.type == "MESH")
o.name = "Tree"
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
o = lowpoly(o, target, tex, nrm, 0.03)
# Fuß auf 0, Mitte der Grundfläche in den Ursprung
zs = [v.co.z for v in o.data.vertices]
z0 = min(zs)
low = [v.co for v in o.data.vertices if v.co.z < z0 + 0.15 * (max(zs) - z0)]
cx = sum(c.x for c in low) / len(low)
cy = sum(c.y for c in low) / len(low)
for v in o.data.vertices:
    v.co.x -= cx
    v.co.y -= cy
    v.co.z -= z0
o.data.update()
print("Höhe", max(zs) - z0)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_image_format="JPEG",
                          export_jpeg_quality=88, export_yup=True, export_apply=True)
print("GLB", os.path.getsize(out_glb))
