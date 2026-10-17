"""Gemeinsamer Schritt für die Meshy-Modelle (Blender-Python): vereinfachen, neu abwickeln und Farbe sowie Details des
Originals in eine saubere Textur einbrennen.

Die Meshy-Texturen sind in Hunderte winzige Schnipsel zerstückelt; verkleinert wirkt das pixelig. Die vereinfachte
Kopie bekommt deshalb eine neue Abwicklung (große, zusammenhängende Flächen) und die Farbe wird aus der vollen
Auflösung des Originals hineingebacken, dazu eine Normalmap mit der Felsstruktur. So bleibt die Form glatt und die
Oberfläche scharf, obwohl das Spiel nur wenige Dreiecke zeichnet (Tausende Kopien von Bäumen und Mauerstücken).
"""
import bpy


def _bake(kind, img, hi, lo, extrusion, **kw):
    sc = bpy.context.scene
    nt = lo.data.materials[0].node_tree
    tn = nt.nodes["bake_target"]
    tn.image = img
    for n in nt.nodes:
        n.select = False
    tn.select = True
    nt.nodes.active = tn
    bpy.ops.object.select_all(action="DESELECT")
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=extrusion * 3, **kw)
    img.pack()


def lowpoly(hi, target, tex_size, normal_size, extrusion):
    """Vereinfachte Kopie von hi mit neuer Abwicklung, eingebrannter Farbe und Normalmap; hi wird danach gelöscht."""
    sc = bpy.context.scene
    lo = hi.copy()
    lo.data = hi.data.copy()
    sc.collection.objects.link(lo)
    lo.name = hi.name
    hi.name = hi.name + "_hi"
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    n0 = len(lo.data.polygons)
    mod = lo.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, target / n0)
    bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.shade_smooth()
    print("Dreiecke", n0, "->", len(lo.data.polygons))
    # stark vereinfachte Formen weichen weiter vom Original ab: Strahlen weiter suchen lassen (sonst schwarze Flecken)
    if target / n0 < 0.08:
        extrusion = max(extrusion, 0.07)

    # neue Abwicklung
    for uv in list(lo.data.uv_layers):
        lo.data.uv_layers.remove(uv)
    lo.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Zielmaterial: nur Farbe und Normalmap
    mat = bpy.data.materials.new(hi.data.materials[0].name + "_lo")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    tgt = nt.nodes.new("ShaderNodeTexImage")
    tgt.name = "bake_target"
    lo.data.materials.clear()
    lo.data.materials.append(mat)

    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    sc.render.bake.margin = 6
    col = bpy.data.images.new("color", tex_size, tex_size)
    _bake("DIFFUSE", col, hi, lo, extrusion, pass_filter={"COLOR"})
    nrm = bpy.data.images.new("normal", normal_size, normal_size)
    nrm.colorspace_settings.name = "Non-Color"
    _bake("NORMAL", nrm, hi, lo, extrusion, normal_space="TANGENT")

    nt.nodes.remove(tgt)
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = col
    nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    tnm = nt.nodes.new("ShaderNodeTexImage")
    tnm.image = nrm
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tnm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    bpy.data.objects.remove(hi, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    return lo
