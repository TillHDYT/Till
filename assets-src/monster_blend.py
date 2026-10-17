# Dschungelmonster aus einer Blender-Datei (Mesh mit Skelett und mehreren Aktionen) als GLB für das Spiel:
#   python monster_blend.py <eingabe.blend> <ausgabe.glb> <Material=Textur.jpg|png> [...] [--yaw Grad] [--keep Objekt,...]
# - Die alten Blender-Render-Materialien verlieren beim Öffnen ihre Bilder: Basisfarbe wird neu verdrahtet.
# - Nur das Skelett und die daran hängenden Meshes (oder --keep) werden exportiert, alle Aktionen als Animationen.
# - --yaw dreht das Modell um die Hochachse, damit es im Spiel nach vorn (+Z) schaut.
import math
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[-6:]
SRC, OUT = args[0], args[1]
tex = {}
yaw = 0.0
keep = None
i = 2
while i < len(args):
    a = args[i]
    if a == "--yaw":
        yaw = float(args[i + 1]); i += 2; continue
    if a == "--keep":
        keep = set(args[i + 1].split(",")); i += 2; continue
    name, path = a.split("=", 1)
    tex[name] = path
    i += 1

bpy.ops.wm.open_mainfile(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm and o.data.uv_layers and (keep is None or o.name in keep)]
print("Meshes:", [m.name for m in meshes])

for m in {mat for o in meshes for mat in o.data.materials if mat}:
    path = tex.get(m.name)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    if path:
        img = bpy.data.images.load(path)
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
        if path.lower().endswith(".png"):
            nt.links.new(tn.outputs["Alpha"], bsdf.inputs["Alpha"])
            m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
            m.surface_render_method = "DITHERED"
    print("Material", m.name, "->", path)

# nur das Skelett mit seinen Meshes behalten
for o in list(bpy.data.objects):
    if o is not arm and o not in meshes:
        bpy.data.objects.remove(o, do_unlink=True)
if yaw:
    arm.rotation_mode = "XYZ"
    arm.rotation_euler.z += math.radians(yaw)

# alle Aktionen exportieren (in Blender 5 braucht jede Aktion einen Slot fürs Skelett)
if not arm.animation_data:
    arm.animation_data_create()
acts = [a for a in bpy.data.actions]
print("Aktionen:", [(a.name, tuple(a.frame_range)) for a in acts])
for a in acts:
    a.use_fake_user = True
for o in [arm, *meshes]:
    o.hide_set(False)
    o.hide_viewport = False
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_animations=True,
    export_animation_mode="ACTIONS", export_image_format="AUTO", export_apply=False,
    export_yup=True, export_skins=True, export_force_sampling=True,
)
