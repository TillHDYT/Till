# Backen (High-Poly -> Low-Poly) und GLB-Export. Wird aus guardian.py heraus ausgeführt.
import math as _m

import bpy as _bpy

sc = _bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.render.bake.margin = 6


def lowpoly(hi, target_tris, name):
    hi_tris = sum(len(p.vertices) - 2 for p in hi.data.polygons)
    select_only(hi)
    _bpy.ops.object.duplicate()
    lo = _bpy.context.active_object
    lo.name = name
    if hi_tris > target_tris:
        d = lo.modifiers.new("dec", "DECIMATE")
        d.ratio = target_tris / hi_tris
        d.use_collapse_triangulate = True
        _bpy.ops.object.modifier_apply(modifier="dec")
    for uv in list(lo.data.uv_layers):
        lo.data.uv_layers.remove(uv)
    lo.data.uv_layers.new(name="UVBake")
    return lo


statue.name = "Statue_hi"
staff.name = "Staff_hi"
statue_lo = lowpoly(statue, 16000, "Statue")
staff_lo = lowpoly(staff, 2400, "Staff")
print("LOW TRIS", sum(len(p.vertices) - 2 for p in statue_lo.data.polygons), sum(len(p.vertices) - 2 for p in staff_lo.data.polygons))

select_only(statue_lo, staff_lo)
_bpy.ops.object.mode_set(mode="EDIT")
_bpy.ops.mesh.select_all(action="SELECT")
_bpy.ops.uv.smart_project(angle_limit=_m.radians(58), island_margin=0.003, area_weight=0.6)
_bpy.ops.object.mode_set(mode="OBJECT")


def new_img(name, size, data=False):
    img = _bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if data:
        img.colorspace_settings.name = "Non-Color"
    return img


def target_image(img):
    for m in MATS.values():
        nt = m.node_tree
        n = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.get("bake")), None)
        if n is None:
            n = nt.nodes.new("ShaderNodeTexImage")
            n["bake"] = True
        n.image = img
        nt.nodes.active = n


def bake(kind, img, mode, team="red"):
    for m in MATS.values():
        setup_nodes(m, mode, team)
    target_image(img)
    for i, (hi, lo) in enumerate(((statue, statue_lo), (staff, staff_lo))):
        select_only(lo, hi)
        _bpy.context.view_layer.objects.active = lo
        sc.render.bake.use_selected_to_active = True
        sc.render.bake.cage_extrusion = 0.06
        sc.render.bake.max_ray_distance = 0.2
        sc.render.bake.use_clear = i == 0
        if kind == "NORMAL":
            sc.render.bake.normal_space = "TANGENT"
        _bpy.ops.object.bake(type=kind)


import time as _t

imgs = {}
for key, kind, mode, team, size, data in (
    ("albedo_red", "EMIT", "albedo", "red", TEX, False),
    ("albedo_blue", "EMIT", "albedo", "blue", TEX, False),
    ("orm", "EMIT", "orm", "red", TEX // 2, True),
    ("normal", "NORMAL", "normal", "red", TEX // 2, True),
):
    t0 = _t.time()
    img = new_img("guardian_" + key, size, data)
    bake(kind, img, mode, team)
    img.filepath_raw = os.path.join(OUT, f"guardian_{key}.png")
    img.file_format = "PNG"
    img.save()
    imgs[key] = img
    print("BAKED", key, round(_t.time() - t0, 1), "s")

# Endmaterial für das Spiel
fm = _bpy.data.materials.new("GuardianMat")
fm.use_nodes = True
N = fm.node_tree.nodes
L = fm.node_tree.links
pb = N.get("Principled BSDF")
t_alb = N.new("ShaderNodeTexImage")
t_alb.image = imgs["albedo_red"]
L.new(t_alb.outputs["Color"], pb.inputs["Base Color"])
t_orm = N.new("ShaderNodeTexImage")
t_orm.image = imgs["orm"]
sepc = N.new("ShaderNodeSeparateColor")
L.new(t_orm.outputs["Color"], sepc.inputs["Color"])
L.new(sepc.outputs["Green"], pb.inputs["Roughness"])
L.new(sepc.outputs["Blue"], pb.inputs["Metallic"])
t_nrm = N.new("ShaderNodeTexImage")
t_nrm.image = imgs["normal"]
nm = N.new("ShaderNodeNormalMap")
L.new(t_nrm.outputs["Color"], nm.inputs["Color"])
L.new(nm.outputs["Normal"], pb.inputs["Normal"])
for o in (statue_lo, staff_lo):
    o.data.materials.clear()
    o.data.materials.append(fm)
    for p in o.data.polygons:
        p.use_smooth = True

cm = _bpy.data.materials.new("CrystalMat")
cm.use_nodes = True
cp = cm.node_tree.nodes.get("Principled BSDF")
cp.inputs["Base Color"].default_value = (0.9, 0.05, 0.03, 1)
cp.inputs["Roughness"].default_value = 0.12
cp.inputs["Emission Color"].default_value = (1.0, 0.08, 0.02, 1)
cp.inputs["Emission Strength"].default_value = 2.5
crystal.data.materials.clear()
crystal.data.materials.append(cm)
# Drehungen fest einrechnen, Ursprünge setzen: Statue im Weltursprung, Stab an der Hand, Kristall in seiner Mitte
crystal.parent = None
for o, origin in ((statue_lo, (0, 0, 0)), (staff_lo, tuple(HAND)), (crystal, tuple(CRYSTAL_CENTER))):
    select_only(o)
    _bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    sc.cursor.location = origin
    _bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
crystal.parent = staff_lo
crystal.matrix_parent_inverse = staff_lo.matrix_world.inverted()

_bpy.data.objects.remove(statue)
_bpy.data.objects.remove(staff)

if PREVIEW:
    render_preview(PREVIEW.replace(".png", "_baked.png"))

select_only(statue_lo, staff_lo, crystal)
_bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "guardian.glb"),
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_jpeg_quality=86,
    export_apply=True,
    export_yup=True,
)
# Die blaue Farbtextur liegt als guardian_albedo_blue.png vor (wird außerhalb zu JPEG umgewandelt).
print("EXPORTED")
