# Wächterstatue für die Türme: Modellierung, UV, Texturen backen, GLB-Export.
# Ausführen mit Blender (oder dem bpy-Python-Modul):
#   python guardian.py <ausgabe-ordner> [vorschau.png]
# Koordinaten: Blender Z oben, die Figur schaut nach -Y (im Spiel +Z).
# Einheiten entsprechen Spiel-Einheiten.

import math
import os
import random
import sys

import bpy  # noqa: I001 (bpy muss vor bmesh importiert werden)
import bmesh
from mathutils import Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else ""
BANNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "banner_red.png")
BANNER_BLUE = BANNER.replace("banner_red", "banner_blue")
TEX = int(os.environ.get("GUARDIAN_TEX", "2048"))
SAMPLES = int(os.environ.get("GUARDIAN_SAMPLES", "16"))
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


# ---------------------------------------------------------------- Hilfen


def select_only(*objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def obj_from_bm(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o.data.materials.append(MATS[mat])
    return o


def prim(kind, mat, name="part", **kw):
    getattr(bpy.ops.mesh, f"primitive_{kind}_add")(**kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(MATS[mat])
    return o


def mod(o, kind, **props):
    m = o.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def smooth(o, level=1, bevel=0.0, seg=2):
    if bevel > 0:
        mod(o, "BEVEL", width=bevel, segments=seg, limit_method="ANGLE")
    if level > 0:
        mod(o, "SUBSURF", levels=level, render_levels=level)
    for p in o.data.polygons:
        p.use_smooth = True


def shell(name, mat, r, loc, scale=(1, 1, 1), rot=(0, 0, 0), zmin=-1.0, zmax=1.0, ymax=None, thick=0.06, seg=24, rings=12, trim=None):
    """Teil einer Kugelschale (Panzerplatte) mit optionaler Goldkante entlang der offenen Ränder."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    kill = [v for v in bm.verts if v.co.z < zmin * r - 1e-4 or v.co.z > zmax * r + 1e-4 or (ymax is not None and v.co.y > ymax * r + 1e-4)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    o = obj_from_bm(name, bm, mat)
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    if trim:
        rim_curve(o, trim)
    mod(o, "SOLIDIFY", thickness=thick, offset=-1)
    smooth(o, 1)
    return o


def rim_curve(o, mat, depth=0.045):
    """Goldkante: offene Ränder des Netzes als Rohr."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    edges = [e for e in bm.edges if e.is_boundary]
    if not edges:
        bm.free()
        return None
    nb = bmesh.new()
    vmap = {}
    for e in edges:
        for v in e.verts:
            if v.index not in vmap:
                vmap[v.index] = nb.verts.new(v.co)
        nb.edges.new((vmap[e.verts[0].index], vmap[e.verts[1].index]))
    bm.free()
    c = obj_from_bm(o.name + "_rim", nb, mat)
    c.location = o.location
    c.scale = o.scale
    c.rotation_euler = o.rotation_euler
    select_only(c)
    bpy.ops.object.convert(target="CURVE")
    c.data.bevel_depth = depth / max(o.scale)
    c.data.bevel_resolution = 2
    c.data.use_fill_caps = True
    c.data.materials.clear()
    c.data.materials.append(MATS[mat])
    return c


def tube(name, mat, a, b, r1, r2, seg=12, cap=True):
    """Kegelstumpf von Punkt a nach b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r1, radius2=r2, depth=d.length, end_fill_type="NGON" if cap else "NOTHING")
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(MATS[mat])
    o.location = (a + b) / 2
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return o


def ring(name, mat, loc, major, minor, scale=(1, 1, 1), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=32, minor_segments=8, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    o.data.materials.append(MATS[mat])
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def profile_extrude(name, mat, pts, depth, loc, rot, bevel=0.03):
    """Flache Form (Punkte in XZ) nach Y extrudiert."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    f = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=(0, depth, 0))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -depth / 2, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    o.location = loc
    o.rotation_euler = rot
    mod(o, "BEVEL", width=bevel, segments=2, limit_method="ANGLE")
    return o


def gem_mesh(name, mat, r, top, bottom, sides, loc, jitter=0.12, rot=(0, 0, 0)):
    bm = bmesh.new()
    ring_v = []
    for i in range(sides):
        a = i / sides * math.tau
        rr = r * (1 + random.uniform(-jitter, jitter))
        ring_v.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, random.uniform(-0.08, 0.08) * r)))
    ring2 = []
    for i in range(sides):
        a = (i + 0.5) / sides * math.tau
        rr = r * 0.72 * (1 + random.uniform(-jitter, jitter))
        ring2.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, top * 0.45)))
    vt = bm.verts.new((random.uniform(-0.05, 0.05) * r, 0, top))
    vb = bm.verts.new((0, 0, -bottom))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring_v[i], ring_v[j], ring2[i]))
        bm.faces.new((ring2[i], ring_v[j], ring2[j]))
        bm.faces.new((ring2[i], ring2[j], vt))
        bm.faces.new((ring_v[j], ring_v[i], vb))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    o.location = loc
    o.rotation_euler = rot
    return o


# ---------------------------------------------------------------- Materialien

TEAM = {"red": ((0.42, 0.025, 0.03), (0.95, 0.08, 0.04)), "blue": ((0.03, 0.09, 0.36), (0.1, 0.45, 1.0))}


def build_material(name, kind):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    m["kind"] = kind
    return m


MAT_KINDS = ["steel", "gold", "cloth", "tabard", "stone", "dark", "leather", "inlay", "gem"]
MATS = {k: build_material(k, k) for k in MAT_KINDS}


def setup_nodes(m, mode, team="red"):
    """mode: 'preview' (Principled), 'albedo', 'orm' (Emission für Backen), 'normal' (Principled mit Relief)."""
    kind = m["kind"]
    nt = m.node_tree
    keep = [n for n in nt.nodes if n.type == "TEX_IMAGE" and n.get("bake")]
    for n in list(nt.nodes):
        if n not in keep:
            nt.nodes.remove(n)
    N = nt.nodes
    L = nt.links
    out = N.new("ShaderNodeOutputMaterial")

    def mix(fac, a, b):
        n = N.new("ShaderNodeMix")
        n.data_type = "RGBA"
        if isinstance(fac, (int, float)):
            n.inputs[0].default_value = fac
        else:
            L.new(fac, n.inputs[0])
        for idx, v in ((6, a), (7, b)):
            if isinstance(v, tuple):
                n.inputs[idx].default_value = (*v, 1)
            else:
                L.new(v, n.inputs[idx])
        return n.outputs[2]

    def math_(op, a, b=0.0, clamp=True):
        n = N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for idx, v in ((0, a), (1, b)):
            if isinstance(v, (int, float)):
                n.inputs[idx].default_value = v
            else:
                L.new(v, n.inputs[idx])
        return n.outputs[0]

    def ramp(fac, a, b):
        n = N.new("ShaderNodeMapRange")
        L.new(fac, n.inputs[0])
        n.inputs[1].default_value = a
        n.inputs[2].default_value = b
        n.clamp = True
        return n.outputs[0]

    geo = N.new("ShaderNodeNewGeometry")
    tc = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 6.0
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    fine = N.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 38.0
    fine.inputs["Detail"].default_value = 3.0
    L.new(tc.outputs["Object"], fine.inputs["Vector"])
    # Kantenmaske über den Bevel-Knoten (abgerundete Normalen gegen echte Normalen)
    bev = N.new("ShaderNodeBevel")
    bev.inputs["Radius"].default_value = 0.035
    bev.samples = 8
    dot = N.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L.new(bev.outputs["Normal"], dot.inputs[0])
    L.new(geo.outputs["Normal"], dot.inputs[1])
    edge = ramp(math_("SUBTRACT", 1.0, dot.outputs["Value"]), 0.01, 0.12)
    ao = N.new("ShaderNodeAmbientOcclusion")
    ao.samples = 12
    ao.inputs["Distance"].default_value = 0.6
    occl = ramp(ao.outputs["AO"], 0.15, 1.0)
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sep.inputs[0])
    up = ramp(sep.outputs["Z"], -0.6, 0.9)

    cloth_col, gem_col = TEAM[team]
    rough, metal, bump_strength = 0.6, 0.0, 0.15
    if kind == "steel":
        base = mix(noise.outputs["Fac"], (0.085, 0.09, 0.105), (0.15, 0.16, 0.18))
        base = mix(ramp(fine.outputs["Fac"], 0.62, 0.72), base, (0.2, 0.21, 0.23))
        col = mix(edge, base, (0.62, 0.64, 0.68))
        rough, metal, bump_strength = 0.42, 0.75, 0.12
    elif kind == "gold":
        base = mix(noise.outputs["Fac"], (0.62, 0.38, 0.1), (0.86, 0.6, 0.22))
        col = mix(edge, base, (1.0, 0.9, 0.55))
        rough, metal, bump_strength = 0.3, 1.0, 0.08
    elif kind == "cloth":
        base = mix(noise.outputs["Fac"], tuple(c * 0.7 for c in cloth_col), cloth_col)
        col = mix(edge, base, tuple(min(1, c * 1.9 + 0.05) for c in cloth_col))
        rough, metal, bump_strength = 0.85, 0.0, 0.05
    elif kind == "tabard":
        img = N.new("ShaderNodeTexImage")
        img.image = BANNER_IMG if team == "red" else BANNER_BLUE_IMG
        uvn = N.new("ShaderNodeUVMap")
        uvn.uv_map = "UVOrig"
        L.new(uvn.outputs["UV"], img.inputs["Vector"])
        col = img.outputs["Color"]
        rough, metal, bump_strength = 0.85, 0.0, 0.05
    elif kind == "stone":
        vor = N.new("ShaderNodeTexVoronoi")
        vor.feature = "DISTANCE_TO_EDGE"
        vor.inputs["Scale"].default_value = 3.5
        L.new(tc.outputs["Object"], vor.inputs["Vector"])
        crack = ramp(vor.outputs["Distance"], 0.0, 0.04)
        base = mix(noise.outputs["Fac"], (0.07, 0.072, 0.08), (0.17, 0.17, 0.18))
        base = mix(crack, (0.03, 0.03, 0.035), base)
        moss_mask = math_("MULTIPLY", ramp(sep.outputs["Z"], 0.55, 0.9), ramp(noise.outputs["Fac"], 0.5, 0.62))
        base = mix(moss_mask, base, (0.12, 0.2, 0.05))
        col = mix(edge, base, (0.36, 0.36, 0.38))
        rough, metal, bump_strength = 0.92, 0.0, 0.35
    elif kind == "dark":
        col = mix(noise.outputs["Fac"], (0.03, 0.03, 0.035), (0.07, 0.07, 0.08))
        rough, metal = 0.8, 0.2
    elif kind == "leather":
        col = mix(noise.outputs["Fac"], (0.12, 0.06, 0.03), (0.25, 0.13, 0.06))
        col = mix(edge, col, (0.45, 0.28, 0.14))
        rough, metal = 0.75, 0.0
    elif kind == "inlay":
        col = mix(edge, gem_col, (1.0, 0.7, 0.6))
        rough, metal = 0.2, 0.0
    else:  # gem
        col = mix(edge, gem_col, (1.0, 0.85, 0.8))
        rough, metal = 0.1, 0.0

    # gemalte Beleuchtung im Stil handgemalter Texturen: oben heller, Ritzen dunkler
    painted = mix(0.0, col, col)
    if kind not in ("gem", "inlay"):
        shade = N.new("ShaderNodeMix")
        shade.data_type = "RGBA"
        shade.blend_type = "MULTIPLY"
        shade.inputs[0].default_value = 1.0
        L.new(col, shade.inputs[6])
        lightv = N.new("ShaderNodeCombineColor")
        lv = math_("MULTIPLY", math_("ADD", 0.55, math_("MULTIPLY", up, 0.6), clamp=False), math_("ADD", 0.35, math_("MULTIPLY", occl, 0.75), clamp=False), clamp=False)
        for ch in ("Red", "Green", "Blue"):
            L.new(lv, lightv.inputs[ch])
        L.new(lightv.outputs["Color"], shade.inputs[7])
        painted = shade.outputs[2]

    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.02
    L.new(fine.outputs["Fac"], bump.inputs["Height"])

    if mode == "albedo":
        em = N.new("ShaderNodeEmission")
        L.new(painted, em.inputs["Color"])
        L.new(em.outputs[0], out.inputs["Surface"])
    elif mode == "orm":
        cc = N.new("ShaderNodeCombineColor")
        cc.inputs["Red"].default_value = 1.0
        rv = math_("ADD", rough, math_("MULTIPLY", math_("SUBTRACT", fine.outputs["Fac"], 0.5, clamp=False), 0.2, clamp=False))
        L.new(rv, cc.inputs["Green"])
        cc.inputs["Blue"].default_value = metal
        em = N.new("ShaderNodeEmission")
        L.new(cc.outputs["Color"], em.inputs["Color"])
        L.new(em.outputs[0], out.inputs["Surface"])
    else:
        p = N.new("ShaderNodeBsdfPrincipled")
        L.new(painted if mode == "preview" else col, p.inputs["Base Color"])
        p.inputs["Roughness"].default_value = rough
        p.inputs["Metallic"].default_value = metal
        L.new(bump.outputs["Normal"], p.inputs["Normal"])
        if kind in ("gem", "inlay"):
            L.new(col, p.inputs["Emission Color"])
            p.inputs["Emission Strength"].default_value = 2.0
        L.new(p.outputs[0], out.inputs["Surface"])


BANNER_IMG = bpy.data.images.load(BANNER)
BANNER_BLUE_IMG = bpy.data.images.load(BANNER_BLUE)


# ---------------------------------------------------------------- Sockel

stat_parts = []


def keep(o):
    stat_parts.append(o)
    return o


keep(prim("cylinder", "stone", "slab", vertices=40, radius=2.9, depth=0.42, location=(0, 0, 0.21)))
smooth(stat_parts[-1], 0, bevel=0.05)
clouds = bpy.data.textures.new("clouds", "CLOUDS")
clouds.noise_scale = 0.35
for i in range(14):
    a = i / 14 * math.tau + random.uniform(-0.03, 0.03)
    o = keep(prim("cube", "stone", f"blk{i}", size=1))
    o.scale = (1.05 * random.uniform(0.92, 1.05), 0.62, 0.66 * random.uniform(0.9, 1.08))
    o.location = (math.sin(a) * 2.42, -math.cos(a) * 2.42, 0.42 + o.scale.z / 2)
    o.rotation_euler = (random.uniform(-0.04, 0.04), random.uniform(-0.05, 0.05), a)
    mod(o, "BEVEL", width=0.07, segments=1)
    mod(o, "SUBSURF", levels=1)
    mod(o, "DISPLACE", texture=clouds, strength=0.07, mid_level=0.5)
for i in range(12):
    a = i / 12 * math.tau + 0.13
    o = keep(prim("cube", "stone", f"blk2_{i}", size=1))
    o.scale = (0.95 * random.uniform(0.92, 1.05), 0.55, 0.48)
    o.location = (math.sin(a) * 1.92, -math.cos(a) * 1.92, 1.0 + o.scale.z / 2)
    o.rotation_euler = (0, 0, a + random.uniform(-0.05, 0.05))
    mod(o, "BEVEL", width=0.06, segments=1)
    mod(o, "SUBSURF", levels=1)
    mod(o, "DISPLACE", texture=clouds, strength=0.06, mid_level=0.5)
keep(prim("cylinder", "stone", "topdisc", vertices=40, radius=1.82, depth=0.2, location=(0, 0, 1.5)))
smooth(stat_parts[-1], 0, bevel=0.04)

# goldene Runenplatten an den unteren Blöcken, vorne ein Wappenschild
for i in range(14):
    if i in (0,):
        continue
    if i % 2:
        continue
    a = i / 14 * math.tau
    o = keep(prim("cube", "gold", f"rune{i}", size=1))
    o.scale = (0.5, 0.06, 0.4)
    o.location = (math.sin(a) * 2.76, -math.cos(a) * 2.76, 0.74)
    o.rotation_euler = (0, 0, a)
    mod(o, "BEVEL", width=0.03, segments=2)
    mod(o, "SIMPLE_DEFORM", deform_method="BEND", angle=0.35, deform_axis="Z")
shield_pts = [(-0.42, 0.5), (0.42, 0.5), (0.4, 0.05), (0.22, -0.32), (0, -0.52), (-0.22, -0.32), (-0.4, 0.05)]
keep(profile_extrude("shield", "gold", shield_pts, 0.14, (0, -2.78, 0.82), (0, 0, 0), bevel=0.035))
keep(profile_extrude("shieldin", "stone", [(x * 0.78, z * 0.78) for x, z in shield_pts], 0.1, (0, -2.83, 0.82), (0, 0, 0), bevel=0.02))
keep(gem_mesh("shieldgem", "inlay", 0.13, 0.26, 0.24, 6, (0, -2.9, 0.86), jitter=0.05, rot=(math.pi / 2, 0, 0)))

# ---------------------------------------------------------------- Körper (Skin-Modifier)

S = {
    "pelvis": ((0, 0, 4.15), 0.5),
    "waist": ((0, 0, 4.62), 0.44),
    "chest": ((0, 0.02, 5.45), 0.68),
    "neck": ((0, 0.04, 6.35), 0.26),
    "head": ((0, 0.02, 6.9), 0.38),
}
for sd, nm in ((1, "L"), (-1, "R")):
    S["hip" + nm] = ((0.4 * sd, 0, 4.05), 0.32)
    S["knee" + nm] = ((0.48 * sd, -0.06, 3.0), 0.24)
    S["ankle" + nm] = ((0.5 * sd, 0.02, 1.98), 0.18)
    S["toe" + nm] = ((0.52 * sd, -0.42, 1.78), 0.13)
    S["sho" + nm] = ((0.98 * sd, 0.02, 5.98), 0.28)
S["elbL"] = ((1.36, 0.08, 5.0), 0.21)
S["wriL"] = ((1.48, -0.06, 4.15), 0.17)
S["hanL"] = ((1.5, -0.1, 3.85), 0.2)
S["elbR"] = ((-1.45, 0.02, 5.25), 0.21)
S["wriR"] = ((-1.72, -0.38, 4.98), 0.17)
S["hanR"] = ((-1.75, -0.55, 4.88), 0.21)
chains = [
    ["pelvis", "waist", "chest", "neck", "head"],
    ["pelvis", "hipL", "kneeL", "ankleL", "toeL"],
    ["pelvis", "hipR", "kneeR", "ankleR", "toeR"],
    ["chest", "shoL", "elbL", "wriL", "hanL"],
    ["chest", "shoR", "elbR", "wriR", "hanR"],
]
bm = bmesh.new()
vidx = {}
for k, (p, r) in S.items():
    vidx[k] = bm.verts.new(p)
bm.verts.index_update()
for ch in chains:
    for a, b in zip(ch, ch[1:]):
        bm.edges.new((vidx[a], vidx[b]))
vidx = {k: v.index for k, v in vidx.items()}
body = obj_from_bm("body", bm, "dark")
sk = mod(body, "SKIN")
body.data.skin_vertices[0].data[vidx["pelvis"]].use_root = True
for k, (p, r) in S.items():
    body.data.skin_vertices[0].data[vidx[k]].radius = (r, r)
mod(body, "SUBSURF", levels=1)
for p in body.data.polygons:
    p.use_smooth = True
keep(body)

# ---------------------------------------------------------------- Rüstung

# Brustpanzer
keep(shell("chest", "steel", 1.0, (0, -0.02, 5.46), scale=(0.98, 0.76, 1.0), seg=16, rings=10, zmin=-0.72, zmax=0.82, thick=0.07, trim="gold"))
# Brustgrat und goldener Stern mit Kristall
star = []
for i in range(16):
    a = i / 16 * math.tau + math.pi / 2
    rr = 0.46 if i % 2 == 0 else 0.2
    if i % 4 == 0:
        rr = 0.58
    star.append((math.cos(a) * rr, math.sin(a) * rr))
keep(profile_extrude("star", "gold", star, 0.1, (0, -0.8, 5.56), (0, 0, 0), bevel=0.025))
keep(gem_mesh("chestgem", "inlay", 0.12, 0.2, 0.18, 6, (0, -0.86, 5.56), jitter=0.05, rot=(math.pi / 2, 0, 0)))
# Bauchschienen
for i, (z, r) in enumerate(((4.95, 0.66), (4.75, 0.63), (4.55, 0.61))):
    o = keep(shell(f"ab{i}", "steel", r, (0, 0, z), scale=(1, 0.8, 1), zmin=-0.32, zmax=0.32, thick=0.05, trim="gold" if i == 2 else None))
# Gürtel mit Schnalle
keep(ring("belt", "leather", (0, 0, 4.33), 0.6, 0.085, scale=(1, 0.82, 1.3)))
keep(profile_extrude("buckle", "gold", [(-0.26, 0.17), (0.26, 0.17), (0.3, 0), (0.16, -0.2), (-0.16, -0.2), (-0.3, 0)], 0.1, (0, -0.55, 4.33), (0, 0, 0)))
keep(gem_mesh("bucklegem", "inlay", 0.07, 0.11, 0.1, 6, (0, -0.62, 4.31), rot=(math.pi / 2, 0, 0)))
# Beintaschen (Tassets)
for sd in (1, -1):
    for j, ang in enumerate((0.42, 1.25)):
        a = ang * sd
        o = keep(prim("cube", "steel", f"tasset{sd}{j}", size=1))
        o.scale = (0.48, 0.07, 0.62)
        o.location = (math.sin(a) * 0.62, -math.cos(a) * 0.55, 3.92)
        o.rotation_euler = (0.18, 0, a)
        mod(o, "SIMPLE_DEFORM", deform_method="BEND", angle=0.5, deform_axis="Z")
        smooth(o, 1, bevel=0.03)
# Wappenrock vorne (Bannerstoff mit Gold-Emblem)
bpy.ops.mesh.primitive_grid_add(x_subdivisions=6, y_subdivisions=14, size=1)
tab = bpy.context.active_object
tab.name = "tabard"
tab.data.uv_layers[0].name = "UVOrig"
for v in tab.data.vertices:
    x, y = v.co.x, v.co.y  # -0.5..0.5
    v.co = Vector((x * 0.66, -0.66 - 0.04 * math.sin(x * 9) - 0.06 * (0.5 - y) * (0.5 - y), 3.4 + y * 1.75))
tab.data.materials.append(MATS["tabard"])
mod(tab, "SOLIDIFY", thickness=0.03)
smooth(tab, 1)
keep(tab)

# Schulterpanzer: drei kantige Lagen je Seite, Goldkanten, Grat und Dornen
for sd in (1, -1):
    for k, (r, dx, dz, tilt) in enumerate(((0.62, 1.1, 6.2, 0.35), (0.56, 1.32, 5.92, 0.6), (0.5, 1.46, 5.66, 0.85))):
        keep(shell(f"pauld{sd}{k}", "steel", r, (dx * sd, 0.02, dz), scale=(1.15, 1.12, 0.62), rot=(0, -tilt * sd, 0), zmin=-0.05, zmax=1, thick=0.07, seg=10, rings=6, trim="gold"))
    fin = [(-0.45, 0.0), (-0.2, 0.22), (0.25, 0.3), (0.5, 0.05)]
    keep(profile_extrude(f"pfin{sd}", "gold", fin, 0.08, (1.12 * sd, 0.02, 6.55), (0, -0.35 * sd, math.pi / 2), bevel=0.02))
    for k, (dx, dz, ln, rr) in enumerate(((1.45, 6.32, 0.55, 0.1), (1.7, 6.0, 0.42, 0.08))):
        c = keep(prim("cone", "gold", f"spike{sd}{k}", vertices=8, radius1=rr, radius2=0.0, depth=ln))
        c.location = (dx * sd, 0.05, dz + ln / 2 - 0.05)
        c.rotation_euler = (0, -0.75 * sd, 0)
        smooth(c, 1)
    keep(gem_mesh(f"pgem{sd}", "inlay", 0.09, 0.15, 0.13, 6, (1.18 * sd, -0.66, 6.18), rot=(math.pi / 2 - 0.3, 0, 0.35 * sd)))

# Halsberge und Helm mit Sehschlitz, Goldkamm
keep(shell("gorget", "steel", 0.45, (0, 0.03, 6.38), scale=(1, 0.95, 1), zmin=-0.45, zmax=0.35, thick=0.05, trim="gold"))
helm = prim("uv_sphere", "steel", "helm", segments=32, ring_count=16, radius=0.5, location=(0, 0.02, 6.95))
helm.scale = (0.98, 1.08, 1.12)
cutter = prim("cube", "dark", "slit", size=1)
cutter.scale = (0.5, 0.4, 0.08)
cutter.location = (0, -0.5, 6.95)
cutter2 = prim("cube", "dark", "slit2", size=1)
cutter2.scale = (0.1, 0.4, 0.42)
cutter2.location = (0, -0.5, 6.78)
for ct in (cutter, cutter2):
    b = mod(helm, "BOOLEAN", operation="DIFFERENCE", object=ct, solver="EXACT")
    ct.hide_render = True
    ct.hide_viewport = True
mod(helm, "SOLIDIFY", thickness=0.05, offset=-1)
smooth(helm, 1)
keep(helm)
keep(prim("uv_sphere", "dark", "face", segments=16, ring_count=8, radius=0.4, location=(0, 0.05, 6.93)))
keep(ring("brow", "gold", (0, 0.02, 7.05), 0.5, 0.045, scale=(0.98, 1.08, 1), rot=(0.12, 0, 0)))
crest = [(-0.55, 0.0), (-0.4, 0.42), (0.0, 0.85), (0.42, 0.58), (0.66, 0.15), (0.5, 0.0)]
keep(profile_extrude("crest", "gold", crest, 0.09, (0, 0.06, 7.45), (0, 0, math.pi / 2), bevel=0.02))
for sd in (1, -1):
    w = keep(prim("cone", "gold", f"wing{sd}", vertices=8, radius1=0.09, radius2=0.0, depth=0.5))
    w.location = (0.5 * sd, 0.08, 7.23)
    w.rotation_euler = (0.3, -0.9 * sd, 0)
    smooth(w, 1)

# Arme: Oberarm, Ellbogen, Unterarmschienen mit Goldrändern, Fäuste
for nm, sd in (("L", 1), ("R", -1)):
    sho, elb, wri, han = S["sho" + nm][0], S["elb" + nm][0], S["wri" + nm][0], S["han" + nm][0]
    o = keep(tube(f"upper{nm}", "steel", sho, elb, 0.27, 0.23))
    smooth(o, 1, bevel=0.02)
    o = keep(tube(f"vamb{nm}", "steel", elb, wri, 0.26, 0.21))
    smooth(o, 1, bevel=0.02)
    for p, rr in ((elb, 0.27), (wri, 0.22)):
        d = (Vector(wri) - Vector(elb)).normalized()
        r = keep(ring(f"cuff{nm}{rr}", "gold", p, rr, 0.04))
        r.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    keep(shell(f"elbow{nm}", "steel", 0.24, Vector(elb) + Vector((0.06 * sd, 0.12, 0)), zmin=-0.6, zmax=1, thick=0.04))
    f = keep(prim("cube", "steel", f"fist{nm}", size=1))
    f.scale = (0.3, 0.3, 0.32)
    f.location = han
    smooth(f, 2, bevel=0.06)

# Beine: Oberschenkel, Kniekacheln mit Dorn, Beinschienen, Schuhe
for nm, sd in (("L", 1), ("R", -1)):
    hip, knee, ank, toe = S["hip" + nm][0], S["knee" + nm][0], S["ankle" + nm][0], S["toe" + nm][0]
    o = keep(tube(f"cuisse{nm}", "steel", hip, knee, 0.37, 0.3))
    smooth(o, 1, bevel=0.02)
    o = keep(tube(f"greave{nm}", "steel", knee, ank, 0.3, 0.23))
    o.scale.y *= 1.2
    smooth(o, 1, bevel=0.02)
    keep(ring(f"gknee{nm}", "gold", Vector(knee) + Vector((0, 0, -0.18)), 0.25, 0.035))
    keep(shell(f"kneecop{nm}", "steel", 0.27, Vector(knee) + Vector((0, -0.16, 0.02)), scale=(1, 0.8, 1.1), zmin=-0.8, zmax=1, ymax=0.2, thick=0.05, trim="gold"))
    sp = keep(prim("cone", "gold", f"kspike{nm}", vertices=8, radius1=0.08, radius2=0, depth=0.3))
    sp.location = Vector(knee) + Vector((0, -0.4, 0.05))
    sp.rotation_euler = (math.pi / 2 + 0.3, 0, 0)
    s = keep(prim("cube", "steel", f"boot{nm}", size=1))
    s.scale = (0.36, 0.7, 0.3)
    s.location = Vector(ank) + Vector((0, -0.22, -0.2))
    smooth(s, 2, bevel=0.08)
    tc = keep(prim("cone", "gold", f"toecap{nm}", vertices=10, radius1=0.16, radius2=0.02, depth=0.3))
    tc.location = Vector(toe) + Vector((0, -0.12, -0.03))
    tc.rotation_euler = (math.pi / 2, 0, 0)
    tc.scale = (1.1, 0.7, 1)
    smooth(tc, 1)

# Umhang: von den Schultern bis zum Sockel, mit Falten, Goldsaum unten
bpy.ops.mesh.primitive_grid_add(x_subdivisions=16, y_subdivisions=22, size=1)
cape = bpy.context.active_object
cape.name = "cape"
for v in cape.data.vertices:
    x, y = v.co.x, v.co.y  # x quer, y längs (oben +0.5)
    t = 0.5 - y  # 0 oben, 1 unten
    w = 1.0 + 0.55 * t
    X = x * 2.0 * w
    Y = 0.5 + 0.75 * t + 0.13 * math.sin(x * 11 + 0.6) * (0.3 + t) - 0.35 * (abs(x) * 2) ** 2 * (1 - t * 0.6)
    Z = 6.15 - t * 4.4 + 0.05 * math.sin(x * 23) * t
    v.co = Vector((X, Y, Z))
cape.data.materials.append(MATS["cloth"])
mod(cape, "SOLIDIFY", thickness=0.04)
smooth(cape, 1)
keep(cape)

# ---------------------------------------------------------------- Stab und Kristall

staff_parts = []
HAND = Vector((-1.75, -0.55, 4.88))
pole = tube("pole", "dark", (HAND.x, HAND.y, 1.78), (HAND.x, HAND.y, 8.1), 0.085, 0.075)
smooth(pole, 1)
staff_parts.append(pole)
for z in (2.05, 3.7, 5.9, 7.3):
    staff_parts.append(ring(f"sring{z}", "gold", (HAND.x, HAND.y, z), 0.11, 0.035))
grip = tube("grip", "leather", (HAND.x, HAND.y, 4.45), (HAND.x, HAND.y, 5.35), 0.1, 0.1)
smooth(grip, 1)
staff_parts.append(grip)
cup = tube("cup", "gold", (HAND.x, HAND.y, 7.75), (HAND.x, HAND.y, 8.4), 0.1, 0.34, seg=16)
smooth(cup, 1, bevel=0.02)
staff_parts.append(cup)
staff_parts.append(ring("cuprim", "gold", (HAND.x, HAND.y, 8.4), 0.34, 0.05))
for i in range(4):
    a = i / 4 * math.tau + math.pi / 4
    pr = prim("cone", "gold", f"prong{i}", vertices=8, radius1=0.08, radius2=0.0, depth=1.05)
    pr.location = (HAND.x + math.cos(a) * 0.36, HAND.y + math.sin(a) * 0.36, 8.85)
    pr.rotation_euler = (-math.sin(a) * 0.32, math.cos(a) * 0.32, 0)
    smooth(pr, 1)
    staff_parts.append(pr)
staff_parts.append(gem_mesh("cupgem", "inlay", 0.09, 0.14, 0.12, 6, (HAND.x, HAND.y - 0.3, 8.1), rot=(math.pi / 2, 0, 0)))

CRYSTAL_CENTER = Vector((HAND.x, HAND.y, 9.15))
crystal = gem_mesh("Crystal", "gem", 0.36, 1.05, 0.62, 7, CRYSTAL_CENTER, jitter=0.14)
for i, off in enumerate(((0.45, -0.15, 0.55), (-0.42, 0.1, -0.2), (0.25, 0.3, 1.0))):
    sh = gem_mesh(f"shard{i}", "gem", 0.06, 0.14, 0.1, 5, CRYSTAL_CENTER + Vector(off))
    select_only(crystal, sh)
    bpy.ops.object.join()


# ---------------------------------------------------------------- Zusammenfügen


def finalize(objs, name):
    select_only(*objs)
    bpy.ops.object.convert(target="MESH")
    select_only(*objs)
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


rims = [o for o in bpy.data.objects if o.name.endswith("_rim")]
statue = finalize(stat_parts + rims, "Statue")
staff = finalize(staff_parts, "Staff")
for o in list(bpy.data.objects):
    if o.name in ("slit", "slit2"):
        bpy.data.objects.remove(o)

# Ursprung des Stabs an die Hand (Drehpunkt für den Rückstoß)
select_only(staff)
scene.cursor.location = HAND
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
select_only(crystal)
scene.cursor.location = CRYSTAL_CENTER
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
crystal.parent = staff
crystal.matrix_parent_inverse = staff.matrix_world.inverted()
for p in crystal.data.polygons:
    p.use_smooth = False

tris = sum(len(p.vertices) - 2 for o in (statue, staff, crystal) for p in o.data.polygons)
print("TRIS", tris, "statue", sum(len(p.vertices) - 2 for p in statue.data.polygons))

with open(os.path.join(OUT, "guardian_info.txt"), "w") as fh:
    fh.write(f"tris {tris}\n")

if os.environ.get("GUARDIAN_STOP") == "model":
    for m in MATS.values():
        setup_nodes(m, "preview")
    # Vorschau-Render
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "guardian_preview.py")).read())
    sys.exit(0)

_prev_target = PREVIEW
PREVIEW = ""
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "guardian_preview.py")).read())
PREVIEW = _prev_target
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "guardian_bake.py")).read())
