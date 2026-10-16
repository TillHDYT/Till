# Bereitet das Meshy-Modell „crystal fountain“ (Stein, Gold, blaue Kristalle) als Nexus für das Spiel auf:
#   python nexus.py <eingabe.fbx|glb> <ausgabe-ordner>
# - Sockelboden auf y=0, Außenradius 6.5: füllt den runden Sockel des Nexus im Basisboden (assets-src/base-floor)
# - großer blauer Mittelkristall als eigenes Teil "Crystal" (leuchtet im Spiel in Teamfarbe und dreht sich)
# - weiche Normalen (das Original hat keine), Material ohne Metall (Licht ist in die Textur gemalt)
# - Textur als JPEG (2K)
# Ausgabe: nexus.glb und info.json
import json
import math
import os
import sys

import bpy  # noqa: I001
import bmesh
import numpy as np
from mathutils import Vector

SRC, OUT = sys.argv[-2], sys.argv[-1]
BASE_R = 6.5
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
if SRC.lower().endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=SRC)
else:
    bpy.ops.import_scene.gltf(filepath=SRC)
base = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
base.select_set(True)
bpy.context.view_layer.objects.active = base
mw = base.matrix_world.copy()
base.parent = None
base.matrix_world = mw
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = base.data
co = np.empty(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)

# Boden auf 0, Mitte über dem Sockel, Außenradius wie bisher
zmin = co[:, 2].min()
low = co[co[:, 2] < zmin + (co[:, 2].max() - zmin) * 0.35]
cx, cy = (low[:, 0].min() + low[:, 0].max()) / 2, (low[:, 1].min() + low[:, 1].max()) / 2
r_out = np.max(np.hypot(co[:, 0] - cx, co[:, 1] - cy))
k = BASE_R / r_out
co = (co - np.array([cx, cy, zmin], np.float32)) * k
me.vertices.foreach_set("co", co.ravel())
me.update()
print("scale", round(float(k), 3), "height", round(float(co[:, 2].max()), 3))

# Kristall finden: das Modell besteht aus vielen getrennten Teilen (Inseln); die Teile des Mittelkristalls sind
# fast vollständig blau, liegen in der Mitte und reichen weit nach oben. Farbe je Fläche aus der Textur in der Flächenmitte.
mat = me.materials[0]
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
img = bsdf.inputs["Base Color"].links[0].from_node.image
W, H = img.size
px = np.empty(W * H * 4, np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
uvl = bm.loops.layers.uv.active
parent = list(range(len(bm.verts)))


def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for e in bm.edges:
    ra, rb = find(e.verts[0].index), find(e.verts[1].index)
    if ra != rb:
        parent[ra] = rb
islands = {}
for f in bm.faces:
    islands.setdefault(find(f.verts[0].index), []).append(f)
crystal_faces = set()
# Mittelteil = Insel mit dem kleinsten Radius; darin die blauen Flächen ab 60 % der Höhe
height = co[:, 2].max()
best = None
for faces in islands.values():
    pts = np.array([v.co[:] for f in faces for v in f.verts])
    rmax = float(np.max(np.hypot(pts[:, 0], pts[:, 1])))
    if best is None or rmax < best[0]:
        best = (rmax, faces)
for f in best[1]:
    u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops)
    v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
    r, g, b_ = px[min(H - 1, int((v % 1) * H)), min(W - 1, int((u % 1) * W)), :3]
    if b_ > r * 1.5 and b_ > g * 1.05 and f.calc_center_median().z > height * 0.6:
        crystal_faces.add(f.index)
print("crystal faces", len(crystal_faces), "of", len(bm.faces))
for f in bm.faces:
    f.select = f.index in crystal_faces
bm.to_mesh(me)
bm.free()
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
crystal = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o is not base)
crystal.name = "Crystal"
base.name = "Nexus"
cc = np.empty(len(crystal.data.vertices) * 3, np.float32)
crystal.data.vertices.foreach_get("co", cc)
cc = cc.reshape(-1, 3)
cmin, cmax = cc.min(0), cc.max(0)
# Drehachse senkrecht durch die Kristallmitte
center = Vector(((cmin[0] + cmax[0]) / 2, (cmin[1] + cmax[1]) / 2, (cmin[2] + cmax[2]) / 2))
print("crystal verts", len(cc), "center", [round(c, 3) for c in center], "size", (cmax - cmin).round(3))

# weiche Normalen, harte Kanten bleiben hart
for o in (base, crystal):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
bpy.ops.object.select_all(action="DESELECT")
crystal.select_set(True)
bpy.context.view_layer.objects.active = crystal
bpy.context.scene.cursor.location = center
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

# Material: kein Metall (Licht und Glanz sind in die Textur gemalt)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.8
img.scale(min(2048, W), min(2048, H))

for o in list(bpy.context.scene.objects):
    if o not in (base, crystal):
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action="DESELECT")
for o in (base, crystal):
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "nexus.glb"),
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_jpeg_quality=86,
    export_apply=True,
    export_yup=True,
)
info = {
    "crystal": [float(center.x), float(center.z), float(-center.y)],
    "crystalSize": [float(v) for v in (cmax - cmin)],
    "height": float(co[:, 2].max()),
    "scale": float(k),
    "tris": sum(len(p.vertices) - 2 for p in base.data.polygons),
}
json.dump(info, open(os.path.join(OUT, "info.json"), "w"))
print("INFO", json.dumps(info))
