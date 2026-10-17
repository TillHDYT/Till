"""Mauerstück für alle Dschungelwände (Jgl.Wand.mauer.Texture.fbx, Meshy-Export als Zip mit FBX + Texturen).

Felsblöcke mit Wurzeln und Bäumen, gerade. Im Spiel wird es entlang jeder Wandkante gebogen (terrain.ts), daher hier
nur: vereinfachen, Länge entlang x (Mitte 0), Tiefe entlang z (Vorderseite bei z = 0, Rückseite bei +Tiefe), Fuß auf
y = 0, Textur 1024², Metall/Rauheit fest.
Aufruf (Blender-Python): python convert.py wand.fbx(zip) ../../src/assets/wall.glb DREIECKE
"""
import os, sys, tempfile, zipfile
import bpy

src, out_glb, target = sys.argv[-3], sys.argv[-2], int(sys.argv[-1])
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
n0 = len(o.data.polygons)
mod = o.modifiers.new("dec", "DECIMATE")
mod.ratio = min(1.0, target / n0)
bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.shade_smooth()
co = [v.co.copy() for v in o.data.vertices]
x0, x1 = min(c.x for c in co), max(c.x for c in co)
y0, y1 = min(c.y for c in co), max(c.y for c in co)
z0, z1 = min(c.z for c in co), max(c.z for c in co)
# Blender: x = Länge, -y = Vorderseite (wie gerendert), z = oben. Nach glTF: x bleibt, Blender -y -> +z (vorne = 0)
for v in o.data.vertices:
    v.co.x -= (x0 + x1) / 2
    v.co.y -= y0          # Vorderseite y = 0 .. Rückseite y = Tiefe (glTF -z); im Spiel wird z gespiegelt
    v.co.z -= z0
o.data.update()
print("Dreiecke", n0, "->", len(o.data.polygons), "Länge", round(x1 - x0, 3), "Tiefe", round(y1 - y0, 3), "Höhe", round(z1 - z0, 3))
mat = o.data.materials[0]
nt = mat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
for n in list(nt.nodes):
    if n.type == "TEX_IMAGE" and n.image and ("metallic" in n.image.name or "roughness" in n.image.name):
        nt.nodes.remove(n)
bsdf.inputs["Roughness"].default_value = 0.9
bsdf.inputs["Metallic"].default_value = 0.0
for im in bpy.data.images:
    if im.size[0] > 1024:
        im.scale(1024, 1024)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_image_format="JPEG",
                          export_jpeg_quality=85, export_yup=True, export_apply=True)
print("GLB", os.path.getsize(out_glb))
