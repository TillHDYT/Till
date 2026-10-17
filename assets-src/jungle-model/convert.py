"""Camp aus dem Dschungel-Modell (Jgl camps und texture .fbx, Meshy-Export als Zip mit FBX + Textur).

Ausgeschnitten wird die obere Camp-Mulde mit ihrem Felsring (offen nach Süden, Modell -y), Boden ringsum bis zum Rand
abgesenkt, damit der Schnitt unter dem Gelände verschwindet. Mitte = Ursprung, Boden ringsum = Höhe 0, Modell-Einheiten
(Skalierung pro Camp im Spiel). Dazu eine Höhenkarte, damit Monster und Champions auf dem Boden der Mulde stehen.
Aufruf (Blender-Python): python convert.py "Jgl camps und texture .fbx" ../../src/assets/jgcamp.glb ../../src/game/jgCampHeight.ts
"""
import base64, math, os, sys, tempfile, zipfile
import bpy, bmesh, mathutils
import numpy as np

src, out_glb, out_ts = sys.argv[-3], sys.argv[-2], sys.argv[-1]
CX, CY = 0.057, 0.285  # Mitte der Mulde (Modell, Draufsicht)
GROUND = -0.155        # Boden ringsum
R_CUT, R_FADE = 0.62, 0.38
HN = 64                # Höhenkarte HN+1 Punkte über ±R_CUT

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

bm = bmesh.new()
bm.from_mesh(o.data)
far = [f for f in bm.faces if any(math.hypot(v.co.x - CX, v.co.y - CY) > R_CUT for v in f.verts)]
bmesh.ops.delete(bm, geom=far, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
for v in bm.verts:
    r = math.hypot(v.co.x - CX, v.co.y - CY)
    t = min(1, max(0, (r - R_FADE) / (R_CUT - R_FADE)))
    v.co.x -= CX
    v.co.y -= CY
    v.co.z -= GROUND + t * t * (3 - 2 * t) * 0.09
bm.to_mesh(o.data)
bm.free()
o.data.update()
print("Dreiecke", len(o.data.polygons))

dg = bpy.context.evaluated_depsgraph_get()
sc = bpy.context.scene
hm = np.zeros((HN + 1, HN + 1), np.uint8)
for j in range(HN + 1):
    for i in range(HN + 1):
        x = -R_CUT + 2 * R_CUT * i / HN
        y = R_CUT - 2 * R_CUT * j / HN  # Zeile j = Welt-z wächst (Modell -y)
        hit, loc, *_ = sc.ray_cast(dg, mathutils.Vector((x, y, 2)), mathutils.Vector((0, 0, -1)))
        if hit:
            hm[j, i] = int(np.clip(round((loc.z + 0.2) * 400) + 1, 1, 255))
with open(out_ts, "w") as f:
    f.write("// Automatisch erzeugt von assets-src/jungle-model/convert.py — nicht von Hand ändern.\n")
    f.write("// Oberfläche des Camp-Modells in Modell-Einheiten (x nach Osten, z nach Süden, Mitte 0).\n")
    f.write("// Byte 0 = kein Modell, sonst Höhe = (b - 1) / 400 - 0.2.\n")
    f.write(f"export const JG_CAMP_HEIGHT = {{ r: {R_CUT}, n: {HN + 1}, data: \"{base64.b64encode(hm.tobytes()).decode()}\" }};\n")

# Textur halbieren (Ladezeit); die Mulde braucht nur einen Teil des Atlas
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
