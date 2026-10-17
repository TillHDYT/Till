"""Mauerstück für alle Dschungelwände (Jgl.Wand.mauer.Texture.fbx, Meshy-Export als Zip mit FBX + Texturen).

Felsblöcke mit Wurzeln und Bäumen, gerade. Im Spiel wird es entlang jeder Wandkante gebogen (walls.ts), daher hier:
vereinfachen mit eingebrannter Normalmap (../lowpoly.py), Länge entlang x (Mitte 0), Tiefe entlang z (Vorderseite bei
z = 0, Rückseite bei -Tiefe), Fuß auf y = 0. Zwei Stufen: Handy und PC.
Aufruf (Blender-Python): python convert.py wand.fbx(zip) ../../src/assets/wall.glb DREIECKE TEXTUR NORMALMAP
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
o.name = "Wall"
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
o = lowpoly(o, target, tex, nrm, 0.03)
co = [v.co.copy() for v in o.data.vertices]
x0, x1 = min(c.x for c in co), max(c.x for c in co)
y0, y1 = min(c.y for c in co), max(c.y for c in co)
z0, z1 = min(c.z for c in co), max(c.z for c in co)
# Blender: x = Länge, -y = Vorderseite, z = oben. Nach glTF: x bleibt, Blender y -> -z (vorne = 0)
for v in o.data.vertices:
    v.co.x -= (x0 + x1) / 2
    v.co.y -= y0
    v.co.z -= z0
o.data.update()
print("Länge", round(x1 - x0, 3), "Tiefe", round(y1 - y0, 3), "Höhe", round(z1 - z0, 3))
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_image_format="JPEG",
                          export_jpeg_quality=88, export_yup=True, export_apply=True)
print("GLB", os.path.getsize(out_glb))
