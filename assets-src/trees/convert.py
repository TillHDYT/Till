"""Bäume für den ganzen Wald aus den Meshy-Exporten (Zip mit FBX + Textur): einzelner Baum und Dreiergruppe.

Stark vereinfacht (Tausende Kopien im Spiel), Fuß auf y = 0, Mitte des Stamms im Ursprung, Höhe in Modell-Einheiten
(Skalierung im Spiel), Textur 1024².
Aufruf (Blender-Python): python convert.py quelle.fbx(zip) ziel.glb DREIECKE
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
o.name = "Tree"
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
n0 = len(o.data.polygons)
mod = o.modifiers.new("dec", "DECIMATE")
mod.ratio = min(1.0, target / n0)
bpy.ops.object.modifier_apply(modifier="dec")
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
bpy.ops.object.shade_smooth()
print("Dreiecke", n0, "->", len(o.data.polygons), "Höhe", max(zs) - z0)
for im in bpy.data.images:
    if im.size[0] > 1024:
        im.scale(1024, 1024)
mat = o.data.materials[0]
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_image_format="JPEG",
                          export_jpeg_quality=85, export_yup=True, export_apply=True, export_normals=True)
print("GLB", os.path.getsize(out_glb))
