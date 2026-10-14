# Bereitet das Meshy-Modell "Crimson Sentinel Statue" als Turm für das Spiel auf:
#   python sentinel.py <eingabe.glb> <ausgabe-ordner>
# Quelle: GitHub-Release "turm-modell" (43 MB, 1,25 Mio. Dreiecke).
# - Sockelboden auf y=0, Sockelradius wie beim bisherigen Turm (2.9 Einheiten)
# - roter Kristall als eigenes Teil "Crystal" unter "Staff" (leuchtet im Spiel in Teamfarbe)
# - Statue auf ca. 36.000 Dreiecke reduziert, Texturen verkleinert
# Ausgabe: guardian.glb und info.json; die blaue Variante erzeugt sentinel_blue.py aus der Farbtextur im GLB.
import json
import math
import os
import sys

import bpy  # noqa: I001
import bmesh
import numpy as np
from mathutils import Vector

SRC, OUT = sys.argv[-2], sys.argv[-1]
PEDESTAL_R = 2.9
TARGET_TRIS = int(os.environ.get("SENTINEL_TRIS", "36000"))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
statue = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
statue.select_set(True)
bpy.context.view_layer.objects.active = statue
statue.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = statue.data
co = np.empty(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)

# Maßstab und Lage über den Sockelboden
zmin = co[:, 2].min()
bottom = co[co[:, 2] < zmin + 0.03]
cx, cy = (bottom[:, 0].min() + bottom[:, 0].max()) / 2, (bottom[:, 1].min() + bottom[:, 1].max()) / 2
r_bottom = np.max(np.hypot(bottom[:, 0] - cx, bottom[:, 1] - cy))
k = PEDESTAL_R / r_bottom
co = (co - np.array([cx, cy, zmin], np.float32)) * k
me.vertices.foreach_set("co", co.ravel())
me.update()
print("scale", round(k, 4), "height", round(float(co[:, 2].max()), 3))

# Farbe je Vertex aus der Grundfarbtextur, um den roten Kristall zu finden
mat = me.materials[0]
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
base_img = bsdf.inputs["Base Color"].links[0].from_node.image
W, H = base_img.size
px = np.empty(W * H * 4, np.float32)
base_img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
uv = np.empty(len(me.loops) * 2, np.float32)
me.uv_layers.active.data.foreach_get("uv", uv)
uv = uv.reshape(-1, 2)
lv = np.empty(len(me.loops), np.int32)
me.loops.foreach_get("vertex_index", lv)
ui = np.clip((uv[:, 0] % 1) * W, 0, W - 1).astype(int)
vi = np.clip((uv[:, 1] % 1) * H, 0, H - 1).astype(int)
vcol = np.zeros((len(me.vertices), 3), np.float32)
vcol[lv] = px[vi, ui, :3]

# Kristall: oberstes Stück der Stabspitze, kräftig rot
top = co[np.argmax(co[:, 2])]
horiz = np.hypot(co[:, 0] - top[0], co[:, 1] - top[1])
red = (vcol[:, 0] > 0.25) & (vcol[:, 0] > vcol[:, 1] * 2.2) & (vcol[:, 0] > vcol[:, 2] * 2.2)
column = (horiz < 0.6) & (co[:, 2] > top[2] - 1.6)
cand = red & column
zc = co[cand, 2]
print("crystal candidates", int(cand.sum()), "z", round(float(zc.min()), 2), "-", round(float(zc.max()), 2))

bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
sel = [f for f in bm.faces if all(cand[v.index] for v in f.verts)]
for f in bm.faces:
    f.select = False
for f in sel:
    f.select = True
bm.to_mesh(me)
bm.free()
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
crystal = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o is not statue)
crystal.name = "Crystal"
statue.name = "Statue"
cc = np.empty(len(crystal.data.vertices) * 3, np.float32)
crystal.data.vertices.foreach_get("co", cc)
cc = cc.reshape(-1, 3)
center = (cc.min(0) + cc.max(0)) / 2
print("crystal verts", len(cc), "center", center.round(3), "size", (cc.max(0) - cc.min(0)).round(3))

# Statue reduzieren
tris = sum(len(p.vertices) - 2 for p in statue.data.polygons)
bpy.ops.object.select_all(action="DESELECT")
statue.select_set(True)
bpy.context.view_layer.objects.active = statue
d = statue.modifiers.new("dec", "DECIMATE")
d.ratio = TARGET_TRIS / tris
d.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.select_all(action="DESELECT")
crystal.select_set(True)
bpy.context.view_layer.objects.active = crystal
ctris = sum(len(p.vertices) - 2 for p in crystal.data.polygons)
if ctris > 600:
    d = crystal.modifiers.new("dec", "DECIMATE")
    d.ratio = 600 / ctris
    bpy.ops.object.modifier_apply(modifier="dec")
print("tris statue", sum(len(p.vertices) - 2 for p in statue.data.polygons), "crystal", sum(len(p.vertices) - 2 for p in crystal.data.polygons))

# Stab-Knoten am Kristall (Drehpunkt für den Rückstoß), Kristall-Ursprung in seiner Mitte
bpy.context.scene.cursor.location = Vector(center)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
staff = bpy.data.objects.new("Staff", None)
bpy.context.scene.collection.objects.link(staff)
staff.location = Vector(center)
crystal.parent = staff
crystal.location = (0, 0, 0)
for p in statue.data.polygons:
    p.use_smooth = True

# Texturen verkleinern
for n in nodes:
    if n.type == "TEX_IMAGE" and n.image:
        img = n.image
        size = 2048 if img == base_img else 1024
        # immer neu skalieren: so wird das Bild beim Export neu (kleiner) als JPEG gespeichert
        img.scale(min(size, img.size[0]), min(size, img.size[1]))

# übrige Objekte (Kameras, leere Knoten aus dem Import) entfernen
for o in list(bpy.context.scene.objects):
    if o not in (statue, crystal, staff):
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action="DESELECT")
for o in (statue, crystal, staff):
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "guardian.glb"),
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_jpeg_quality=86,
    export_apply=True,
    export_yup=True,
)
# Mitte des Kristalls in Spielkoordinaten (y oben, z = -y in Blender)
info = {"crystal": [float(center[0]), float(center[2]), float(-center[1])], "height": float(co[:, 2].max()), "scale": float(k)}
json.dump(info, open(os.path.join(OUT, "info.json"), "w"))
print("INFO", json.dumps(info))
