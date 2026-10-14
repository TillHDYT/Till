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
from mathutils import Matrix, Vector

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


def shell(name, mat, r, loc, scale=(1, 1, 1), rot=(0, 0, 0), zmin=-1.0, zmax=1.0, ymax=None, thick=0.06, seg=24, rings=12, trim=None, trim_depth=0.045):
    """Teil einer Kugelschale (Panzerplatte) mit optionaler Goldkante entlang der offenen Ränder."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    kill = [v for v in bm.verts if v.co.z < zmin * r - 1e-4 or v.co.z > zmax * r + 1e-4 or (ymax is not None and v.co.y > ymax * r + 1e-4)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    o = obj_from_bm(name, bm, mat)
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    # erst glätten, dann die Goldkante an den geglätteten Rand legen, damit sie anliegt
    mod(o, "SUBSURF", levels=1, render_levels=1)
    select_only(o)
    bpy.ops.object.modifier_apply(modifier="subsurf")
    if trim:
        rim_curve(o, trim, trim_depth)
    mod(o, "SOLIDIFY", thickness=thick, offset=-1)
    for p in o.data.polygons:
        p.use_smooth = True
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
    # feine Risse wie bei einer verwitterten Statue, nur stellenweise
    vcr = N.new("ShaderNodeTexVoronoi")
    vcr.feature = "DISTANCE_TO_EDGE"
    vcr.inputs["Scale"].default_value = 2.8
    L.new(tc.outputs["Object"], vcr.inputs["Vector"])
    cmask = N.new("ShaderNodeTexNoise")
    cmask.inputs["Scale"].default_value = 2.2
    L.new(tc.outputs["Object"], cmask.inputs["Vector"])
    cracks = math_("MULTIPLY", math_("SUBTRACT", 1.0, ramp(vcr.outputs["Distance"], 0.0, 0.014)), ramp(cmask.outputs["Fac"], 0.5, 0.6))
    height = fine.outputs["Fac"]
    if kind == "steel":
        base = mix(noise.outputs["Fac"], (0.05, 0.053, 0.062), (0.108, 0.113, 0.126))
        base = mix(ramp(fine.outputs["Fac"], 0.62, 0.72), base, (0.15, 0.156, 0.17))
        base = mix(cracks, base, (0.02, 0.02, 0.024))
        col = mix(edge, base, (0.52, 0.54, 0.58))
        rough, metal, bump_strength = 0.5, 0.6, 0.14
        height = math_("SUBTRACT", math_("MULTIPLY", fine.outputs["Fac"], 0.4), math_("MULTIPLY", cracks, 0.6), clamp=False)
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
        base = mix(noise.outputs["Fac"], (0.035, 0.038, 0.046), (0.095, 0.099, 0.11))
        base = mix(crack, (0.018, 0.018, 0.022), base)
        moss_mask = math_("MULTIPLY", ramp(sep.outputs["Z"], 0.55, 0.9), ramp(noise.outputs["Fac"], 0.57, 0.68))
        base = mix(moss_mask, base, (0.08, 0.14, 0.04))
        col = mix(edge, base, (0.3, 0.3, 0.33))
        height = math_("SUBTRACT", fine.outputs["Fac"], math_("SUBTRACT", 1.0, crack), clamp=False)
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
    L.new(height, bump.inputs["Height"])

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


# ---------------------------------------------------------------- weitere Hilfen


def lathe(name, mat, prof, loc=(0, 0, 0), seg=32, scale=(1, 1, 1)):
    """Drehkörper aus einem Profil [(radius, z), ...]; Lage und Skalierung stecken direkt im Netz."""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    es = [bm.edges.new((a, b)) for a, b in zip(vs, vs[1:])]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=seg, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def curve_tube(name, mat, pts, radius, radii=None, res=3):
    """Rohr entlang einer Punktfolge, optional mit verjüngendem Radius (Klauen, Finger, Ornamente)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1)
        sp.points[i].radius = radii[i] if radii else 1.0
    cu.bevel_depth = radius
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    o = bpy.data.objects.new(name, cu)
    coll.objects.link(o)
    cu.materials.append(MATS[mat])
    return o


def skin_body(name, pts, radii, yscale=1.0, levels=2):
    """Glatter Körperteil aus einer Gelenkkette (Skin-Modifier, danach als Netz übernommen)."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    o = obj_from_bm(name, bm, "dark")
    mod(o, "SKIN")
    sv = o.data.skin_vertices[0].data
    sv[0].use_root = True
    for i, r in enumerate(radii):
        sv[i].radius = (r, r)
    mod(o, "SUBSURF", levels=levels, render_levels=levels)
    select_only(o)
    bpy.ops.object.convert(target="MESH")
    if yscale != 1.0:
        cy = sum(p[1] for p in pts) / len(pts)
        for v in o.data.vertices:
            v.co.y = cy + (v.co.y - cy) * yscale
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def band(name, src, a, b, t0, t1, off, thick=0.06, mat="steel", trim="gold", rmax=9.0, cuts=(), flare=0.0, shape=None, trim_depth=0.045):
    """Rüstungsplatte, die der Körperform folgt: Abschnitt t0..t1 entlang a->b mit sauberen Schnittkanten, nach außen versetzt."""
    A, B = Vector(a), Vector(b)
    L = (B - A).length
    d = (B - A).normalized()
    bm = bmesh.new()
    bm.from_mesh(src.data)
    planes = [(A + d * (L * t0), d), (A + d * (L * t1), -d)] + [(Vector(p), Vector(n).normalized()) for p, n in cuts]
    for p, n in planes:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=p, plane_no=n)

    def inside(co):
        if any((co - p).dot(n) < -1e-5 for p, n in planes):
            return False
        s = (co - A).dot(d)
        return (co - (A + d * s)).length <= rmax

    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not inside(f.calc_center_median())], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    moves = []
    for v in bm.verts:
        s = ((v.co - A).dot(d) / L - t0) / max(1e-6, t1 - t0)
        extra = shape(v.co, v.normal) if shape else 0.0
        moves.append((v, v.normal * (off + flare * s + extra)))
    for v, m in moves:
        v.co += m
    o = obj_from_bm(name, bm, mat)
    if trim:
        rim_curve(o, trim, trim_depth)
    mod(o, "SOLIDIFY", thickness=thick, offset=-1)
    smooth(o, 1)
    return o


def hit(obj, origin, direction):
    """Auftreffpunkt und Normale eines Strahls auf dem fertigen (modifizierten) Objekt."""
    dg = bpy.context.evaluated_depsgraph_get()
    ok, loc, nor, _ = obj.ray_cast(Vector(origin), Vector(direction).normalized(), depsgraph=dg)
    return (loc, nor) if ok else (None, None)


def filigree(name, obj, origin, direction, size, turns=1.6, flip=1):
    """Goldene Ranke (Doppelspirale) auf eine Oberfläche projiziert."""
    p, n = hit(obj, origin, direction)
    if p is None:
        return None
    t1 = n.cross(Vector((0, 0, 1)))
    if t1.length < 0.1:
        t1 = n.cross(Vector((1, 0, 0)))
    t1.normalize()
    t2 = n.cross(t1).normalized()
    pts2 = []
    for side in (-1, 1):
        seq = []
        for i in range(28):
            k = i / 27
            ang = k * turns * math.tau
            rr = size * 0.5 * (1 - 0.8 * k)
            seq.append((side * (size * 0.5 - math.cos(ang) * rr), math.sin(ang) * rr * flip * side))
        pts2 += (seq[::-1] if side < 0 else seq)
    pts3, radii = [], []
    for i, (u, v) in enumerate(pts2):
        q0 = p + t1 * u + t2 * v + n * 0.4
        q, qn = hit(obj, q0, -n)
        if q is None:
            continue
        pts3.append(q + qn * 0.012)
        k = abs(i - len(pts2) / 2) / (len(pts2) / 2)
        radii.append(1.0 - 0.6 * k)
    if len(pts3) < 4:
        return None
    return curve_tube(name, "gold", pts3, size * 0.045, radii, res=2)


def rbox(name, mat, size, loc, rot=(0, 0, 0), bevel=0.06, level=2):
    o = prim("cube", mat, name, size=1)
    o.scale = size
    o.location = loc
    o.rotation_euler = rot
    smooth(o, level, bevel=bevel)
    return o


# ---------------------------------------------------------------- Sockel (Maße wie bisher, damit die Spielposition gleich bleibt)

stat_parts = []


def keep(o):
    if o is not None:
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

# goldene Runenkappen auf jedem zweiten unteren Block, vorne ein großes Wappenschild mit Kristall
for i in range(2, 14, 2):
    a = i / 14 * math.tau
    o = keep(prim("cube", "gold", f"rune{i}", size=1))
    o.scale = (0.62, 0.07, 0.42)
    o.location = (math.sin(a) * 2.76, -math.cos(a) * 2.76, 0.84)
    o.rotation_euler = (0.12, 0, a)
    mod(o, "BEVEL", width=0.035, segments=2)
    mod(o, "SIMPLE_DEFORM", deform_method="BEND", angle=0.4, deform_axis="Z")
    # eingeritzte Rune
    rn = keep(prim("cube", "dark", f"runeline{i}", size=1))
    rn.scale = (0.06, 0.04, 0.24)
    rn.location = (math.sin(a) * 2.815, -math.cos(a) * 2.815, 0.84)
    rn.rotation_euler = (0.12, 0, a + 0.0)
shield_pts = [(-0.55, 0.62), (0.55, 0.62), (0.52, 0.05), (0.3, -0.4), (0, -0.68), (-0.3, -0.4), (-0.52, 0.05)]
shield_pts = [(x * 1.25, z * 1.25) for x, z in shield_pts]
keep(profile_extrude("shield", "gold", shield_pts, 0.16, (0, -2.84, 0.98), (0.1, 0, 0), bevel=0.04))
keep(profile_extrude("shieldin", "stone", [(x * 0.8, z * 0.8) for x, z in shield_pts], 0.12, (0, -2.9, 0.99), (0.1, 0, 0), bevel=0.02))
keep(profile_extrude("shieldspine", "gold", [(-0.06, 0.52), (0.06, 0.52), (0.06, -0.52), (0, -0.62), (-0.06, -0.52)], 0.1, (0, -2.97, 0.97), (0.1, 0, 0), bevel=0.015))
keep(gem_mesh("shieldgem", "inlay", 0.2, 0.36, 0.34, 6, (0, -3.04, 1.12), jitter=0.05, rot=(math.pi / 2 + 0.1, 0, 0)))

# ---------------------------------------------------------------- Körper: Gelenkketten in Standpose (Gewicht links, rechte Hand am Stab)

HAND = Vector((-1.75, -0.55, 5.5))
TA, TB = (0, 0.02, 4.0), (0, 0.02, 6.6)


def tz(z):
    return (z - TA[2]) / (TB[2] - TA[2])


torso = keep(skin_body("torso", [(0, 0.02, 4.05), (0, 0.02, 4.5), (0, 0.0, 5.0), (0, 0.0, 5.5), (0, 0.04, 5.95), (0, 0.06, 6.3), (0, 0.04, 6.76)], [0.54, 0.44, 0.66, 0.88, 0.86, 0.28, 0.34], yscale=0.78))
LEG = {1: [(0.44, 0.0, 4.1), (0.76, -0.48, 3.1), (0.86, -0.58, 2.05)], -1: [(-0.44, 0.04, 4.1), (-0.64, 0.14, 3.02), (-0.76, 0.3, 2.03)]}
ARM = {1: [(1.1, 0.05, 6.0), (1.5, 0.2, 5.0), (1.66, -0.02, 4.15)], -1: [(-1.1, 0.05, 6.0), (-1.55, 0.26, 5.1), (-1.68, -0.24, 5.4)]}
legs = {sd: keep(skin_body(f"leg{sd}", LEG[sd], [0.42, 0.32, 0.25])) for sd in (1, -1)}
arms = {sd: keep(skin_body(f"arm{sd}", ARM[sd], [0.36, 0.3, 0.25])) for sd in (1, -1)}

# ---------------------------------------------------------------- Rüstung, die den Körper umschließt


def keel(co, n):
    """Mittelgrat und Brustwölbung vorne auf dem Brustpanzer."""
    front = max(0.0, -n.y)
    ridge = 0.09 * math.exp(-((co.x / 0.13) ** 2))
    pecs = 0.09 * math.exp(-(((abs(co.x) - 0.4) / 0.28) ** 2) - ((co.z - 5.62) / 0.32) ** 2)
    return (ridge + pecs) * front


def shin_ridge(A, B):
    """Grat vorne auf Bein- und Armschienen."""
    A, B = Vector(A), Vector(B)

    def f(co, n):
        s = max(0.0, min(1.0, (co - A).dot(B - A) / (B - A).length_squared))
        cx = A.x + (B.x - A.x) * s
        return 0.05 * math.exp(-(((co.x - cx) / 0.1) ** 2)) * max(0.0, -n.y)

    return f


colliders = []
breast = keep(band("breast", torso, TA, TB, tz(4.9), tz(6.22), 0.08, thick=0.08, shape=keel, trim_depth=0.065))
colliders.append(breast)
for i, (z0, z1, off) in enumerate(((4.3, 4.52, 0.05), (4.47, 4.7, 0.065), (4.64, 4.92, 0.075))):
    colliders.append(keep(band(f"lame{i}", torso, TA, TB, tz(z0), tz(z1), off, thick=0.05, trim="gold" if i == 0 else None, trim_depth=0.028)))
colliders.append(keep(band("belt", torso, TA, TB, tz(4.06), tz(4.34), 0.13, thick=0.08, mat="gold", trim="leather", trim_depth=0.03)))
keep(band("gorget", torso, TA, TB, tz(6.08), tz(6.32), 0.09, thick=0.06, flare=0.03, trim_depth=0.035))

# Beintaschen: Plattenrock unter dem Gürtel, vorne offen für den Wappenrock
def skirt_plate(name, a0, a1, mat="steel"):
    prof = [(0.66, 4.2), (0.74, 4.0), (0.84, 3.75), (0.95, 3.45)]
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    es = [bm.edges.new((p, q)) for p, q in zip(vs, vs[1:])]
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(a0, 3, "Z"))
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=a1 - a0, steps=10)
    bmesh.ops.scale(bm, vec=(1.0, 0.84, 1.0), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, mat)
    if sum(p.normal.x * p.center.x + p.normal.y * p.center.y for p in o.data.polygons) < 0:
        o.data.flip_normals()
    rim_curve(o, "gold", 0.06)
    mod(o, "SOLIDIFY", thickness=0.06, offset=-1)
    smooth(o, 1)
    return o


for sd in (1, -1):
    for k, (a0, a1) in enumerate(((-1.12, -0.42), (-0.5, 0.25))):
        if sd < 0:
            a0, a1 = math.pi - a1, math.pi - a0
        colliders.append(keep(skirt_plate(f"tasset{sd}{k}", a0, a1)))

# Brust-Emblem: goldene Sonne mit Kristall, auf die Panzerfront gesetzt
p, n = hit(breast, (0, -3, 5.72), (0, 1, 0))
star = []
for i in range(20):
    a = i / 20 * math.tau + math.pi / 2
    rr = (0.52 if i % 4 == 0 else 0.34) if i % 2 == 0 else 0.17
    star.append((math.cos(a) * rr, math.sin(a) * rr * 0.9))
keep(profile_extrude("star", "gold", star, 0.1, p + Vector((0, -0.03, 0)), (0, 0, 0), bevel=0.025))
keep(gem_mesh("chestgem", "inlay", 0.13, 0.22, 0.2, 6, p + Vector((0, -0.1, 0)), jitter=0.05, rot=(math.pi / 2, 0, 0)))
for sd in (1, -1):
    keep(filigree(f"chestfil{sd}", breast, (0.36 * sd, -3, 5.25), (0, 1, 0), 0.42, flip=sd))

# Gürtelschnalle (Goldplatte in V-Form) mit Kristall
keep(profile_extrude("buckle", "gold", [(-0.36, 0.17), (0.36, 0.17), (0.3, -0.05), (0, -0.3), (-0.3, -0.05)], 0.1, (0, -0.58, 4.22), (0, 0, 0), bevel=0.025))
keep(gem_mesh("bucklegem", "inlay", 0.08, 0.13, 0.12, 6, (0, -0.65, 4.2), rot=(math.pi / 2, 0, 0)))


def bend_dir(a, j, b, fallback=(0, -1, 0)):
    """Richtung der Außenseite eines Gelenks (Knie vorne, Ellbogen hinten)."""
    a, j, b = Vector(a), Vector(j), Vector(b)
    v = -((a - j).normalized() + (b - j).normalized())
    if v.length < 0.25:
        return Vector(fallback)
    return (v.normalized() + Vector(fallback) * 0.4).normalized()


# Arme: Oberarmschiene, Ellbogenkachel, Unterarmschiene mit goldener Stulpe
for sd in (1, -1):
    sho, elb, wri = map(Vector, ARM[sd])
    colliders.append(keep(band(f"rere{sd}", arms[sd], sho, elb, 0.3, 0.9, 0.05, rmax=0.5, trim_depth=0.05)))
    ed = bend_dir(sho, elb, wri, (0, 1, 0))
    keep(shell(f"couter{sd}", "steel", 0.27, elb + ed * 0.05, rot=ed.to_track_quat("Z", "Y").to_euler(), zmin=-0.25, zmax=1, thick=0.05, seg=14, rings=8, trim="gold"))
    colliders.append(keep(band(f"vamb{sd}", arms[sd], elb, wri, 0.12, 0.74, 0.05, rmax=0.45, flare=0.03, trim_depth=0.05)))
    keep(band(f"cuff{sd}", arms[sd], elb, wri, 0.7, 1.0, 0.075, rmax=0.45, flare=0.1, mat="gold", trim="gold", trim_depth=0.035))

# Beine: Beintaschen, Oberschenkelschiene, goldene Kniekacheln, Beinschienen, Schuhe
for sd in (1, -1):
    hip, knee, ank = map(Vector, LEG[sd])
    colliders.append(keep(band(f"cuisse{sd}", legs[sd], hip, knee, 0.38, 0.86, 0.06, rmax=0.6, shape=shin_ridge(hip, knee), trim_depth=0.05)))
    kd = bend_dir(hip, knee, ank, (0, -1, 0))
    keep(shell(f"poleyn{sd}", "steel", 0.3, knee + kd * 0.1, scale=(1.0, 0.8, 1.3), rot=kd.to_track_quat("Z", "Y").to_euler(), zmin=0.0, zmax=1, thick=0.05, seg=10, rings=6, trim="gold"))
    keep(profile_extrude(f"kplate{sd}", "gold", [(0, 0.34), (0.16, 0.08), (0.12, -0.16), (0, -0.3), (-0.12, -0.16), (-0.16, 0.08)], 0.06, knee + kd * 0.4, (0, 0, math.atan2(kd.x, -kd.y)), bevel=0.02))
    sp = keep(prim("cone", "gold", f"kspike{sd}", vertices=8, radius1=0.09, radius2=0, depth=0.32))
    sp.location = knee + kd * 0.48
    sp.rotation_euler = kd.to_track_quat("Z", "Y").to_euler()
    smooth(sp, 1)
    colliders.append(keep(band(f"greave{sd}", legs[sd], knee, ank, 0.14, 0.97, 0.065, rmax=0.5, flare=0.06, shape=shin_ridge(knee, ank), trim_depth=0.05)))
    foot = ank + Vector((0.02 * sd, -0.3, -0.24))
    keep(rbox(f"sabaton{sd}", "steel", (0.56, 1.05, 0.4), foot, rot=(0, 0, -0.06 * sd), bevel=0.12))
    for k in range(3):
        keep(ring(f"slame{sd}{k}", "steel", foot + Vector((0, -0.1 - k * 0.16, 0.12 - k * 0.04)), 0.2, 0.035, scale=(1.15, 0.6, 1), rot=(math.pi / 2 - 0.5, 0, 0)))
    tc = keep(prim("cone", "gold", f"toecap{sd}", vertices=12, radius1=0.25, radius2=0.1, depth=0.26))
    tc.location = foot + Vector((0, -0.52, -0.05))
    tc.rotation_euler = (math.pi / 2, 0, 0)
    tc.scale = (1.1, 0.6, 1)
    smooth(tc, 1)
    keep(ring(f"ankle{sd}", "gold", ank + Vector((0, 0, -0.04)), 0.33, 0.045, scale=(1, 1.1, 1)))

# Schulterpanzer: drei Lagen, Goldkanten, goldene Ranken, hochgezogene Halskante
for sd in (1, -1):
    sho = Vector(ARM[sd][0])
    c = sho + Vector((0.04 * sd, 0.02, 0.2))
    pa = keep(shell(f"pauldA{sd}", "steel", 0.56, c, scale=(1.05, 1.05, 0.88), rot=(0, -0.4 * sd, 0), zmin=-0.05, zmax=1, thick=0.08, seg=8, rings=5, trim="gold", trim_depth=0.075))
    # Schulterlamellen: folgen dem Oberarm, nur außen, die obere überdeckt die untere
    elb = Vector(ARM[sd][1])
    for k, (t0, t1, off) in enumerate(((0.0, 0.3, 0.26), (0.2, 0.46, 0.22), (0.36, 0.6, 0.18))):
        keep(band(f"pauld{sd}{k}", arms[sd], sho, elb, t0, t1, off, thick=0.06, rmax=0.75, flare=0.05, cuts=[(sho + Vector((-0.12 * sd, 0, 0)), (sd, 0, 0.25))], trim_depth=0.055))
    keep(shell(f"haute{sd}", "steel", 0.36, sho + Vector((-0.24 * sd, 0.14, 0.4)), scale=(0.2, 1.1, 0.9), rot=(0, 0.3 * sd, 0), zmin=0, zmax=1, thick=0.05, seg=16, rings=8, trim="gold"))
    keep(filigree(f"pfil{sd}", pa, c + Vector((1.6 * sd, -1.2, 1.4)), Vector((-1.6 * sd, 1.2, -1.4)), 0.42, flip=sd))
    gp, gn = hit(pa, c + Vector((0.22 * sd, -3, 0.12)), (0, 1, 0))
    if gp is not None:
        keep(gem_mesh(f"pgem{sd}", "inlay", 0.09, 0.15, 0.13, 6, gp + gn * 0.03, rot=(-gn).to_track_quat("Z", "Y").to_euler()))

# Topfhelm mit Mittelgrat, T-Visier, goldenem Kamm
HEAD = Vector((0, 0.04, 6.8))
helm = lathe("helm", "steel", [(0.0, -0.46), (0.37, -0.46), (0.41, -0.3), (0.43, -0.04), (0.42, 0.18), (0.38, 0.33), (0.29, 0.44), (0.15, 0.51), (0.0, 0.53)], HEAD, seg=32, scale=(0.94, 1.04, 1.0))
for v in helm.data.vertices:
    if v.co.y < HEAD.y:
        lz = v.co.z - HEAD.z
        v.co.y -= 0.08 * math.exp(-((v.co.x / 0.1) ** 2)) * max(0.0, min(1.0, (0.5 - abs(lz - 0.05)) * 3))
cut_h = prim("cube", "dark", "slit", size=1)
cut_h.scale = (0.56, 0.5, 0.065)
cut_h.location = HEAD + Vector((0, -0.45, 0.04))
cut_v = prim("cube", "dark", "slit2", size=1)
cut_v.scale = (0.075, 0.5, 0.32)
cut_v.location = HEAD + Vector((0, -0.45, -0.17))
for ct in (cut_h, cut_v):
    mod(helm, "BOOLEAN", operation="DIFFERENCE", object=ct, solver="EXACT")
    ct.hide_render = True
    ct.hide_viewport = True
smooth(helm, 1)
keep(helm)
keep(prim("uv_sphere", "dark", "face", segments=16, ring_count=8, radius=0.36, location=HEAD + Vector((0, 0.03, 0))))
HA, HB = HEAD + Vector((0, 0, -0.5)), HEAD + Vector((0, 0, 0.56))
keep(band("helmbrow", helm, HA, HB, 0.55, 0.62, 0.015, thick=0.03, mat="gold", trim=None))
keep(band("helmrim", helm, HA, HB, 0.03, 0.1, 0.015, thick=0.03, mat="gold", trim=None))
keep(band("helmcrest", helm, HA, HB, 0.55, 1.0, 0.02, thick=0.035, mat="gold", trim=None, cuts=[((-0.07, 0, 0), (1, 0, 0)), ((0.07, 0, 0), (-1, 0, 0)), (HEAD + Vector((0, 0.32, 0)), (0, -1, 0))]))
for sd in (1, -1):
    keep(band(f"helmside{sd}", helm, HA, HB, 0.1, 0.55, 0.012, thick=0.03, mat="gold", trim=None, cuts=[((0.3 * sd, 0, 0), (sd, 0, 0)), (HEAD + Vector((0, -0.05, 0)), (0, -1, 0)), (HEAD + Vector((0, -0.32, 0)), (0, 1, 0))]))
crown = [(-0.3, 0.0), (-0.22, 0.2), (-0.1, 0.12), (0.0, 0.5), (0.1, 0.12), (0.22, 0.2), (0.3, 0.0)]
keep(profile_extrude("helmcrown", "gold", crown, 0.1, HEAD + Vector((0, -0.02, 0.48)), (0, 0, 0), bevel=0.02))

# Fäuste: rechte umgreift den Stab, linke hängt geballt
for k, dz in enumerate((0.17, 0.055, -0.06, -0.175)):
    pts = []
    for i in range(14):
        ang = math.radians(60 + i / 13 * 280)
        pts.append(HAND + Vector((math.cos(ang) * 0.19, math.sin(ang) * 0.19, dz * 1.15 - 0.01 * i / 13)))
    keep(curve_tube(f"fingerR{k}", "steel", pts, 0.08, [1.0] * 13 + [0.8], res=2))
wd = (Vector(ARM[-1][2]) - HAND).normalized()
keep(rbox("handR", "steel", (0.36, 0.3, 0.54), HAND + wd * 0.24, rot=wd.to_track_quat("Y", "Z").to_euler(), bevel=0.08))
keep(curve_tube("thumbR", "steel", [HAND + Vector((0.1, 0.1, 0.26)), HAND + Vector((0.02, -0.12, 0.28)), HAND + Vector((-0.12, -0.14, 0.24))], 0.07, [1, 0.95, 0.8]))
lw, le = Vector(ARM[1][2]), Vector(ARM[1][1])
ld = (lw - le).normalized()
LH = lw + ld * 0.3
keep(rbox("handL", "steel", (0.38, 0.4, 0.46), LH, rot=ld.to_track_quat("Z", "Y").to_euler(), bevel=0.1))
for k in range(4):
    q = LH + ld * (0.09 - k * 0.1) + Vector((0.0, -0.21, 0))
    keep(rbox(f"knuckle{k}", "steel", (0.16, 0.14, 0.11), q, rot=ld.to_track_quat("Z", "Y").to_euler(), bevel=0.035, level=1))
keep(curve_tube("thumbL", "steel", [LH + Vector((-0.12, -0.05, 0.12)), LH + Vector((-0.16, -0.17, 0.0)), LH + Vector((-0.1, -0.2, -0.1))], 0.065, [1, 0.95, 0.8]))

# Wappenrock vorne: langer roter Stoff mit Emblem und Goldborte
bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=20, size=1)
tab = bpy.context.active_object
tab.name = "tabard"
tab.data.uv_layers[0].name = "UVOrig"
for v in tab.data.vertices:
    x, y = v.co.x, v.co.y  # -0.5..0.5
    t = 0.5 - y
    v.co = Vector((x * (0.66 + 0.12 * t), -0.6 - 0.07 * t - 0.035 * math.sin(x * 13 + 0.6) * t - 0.03 * math.cos(x * 5) * t, 4.2 - t * 1.95))
tab.data.materials.append(MATS["tabard"])
rim_curve(tab, "gold", 0.03)
mod(tab, "SOLIDIFY", thickness=0.035)
smooth(tab, 1)
keep(tab)

# ---------------------------------------------------------------- Umhang: Stoffsimulation über Körper und Rüstung

bpy.ops.mesh.primitive_grid_add(x_subdivisions=26, y_subdivisions=34, size=1)
cape = bpy.context.active_object
cape.name = "cape"
pin_idx = []
rest_co = []
for v in cape.data.vertices:
    x, y = v.co.x, v.co.y
    t = 0.5 - y
    # Ruhelage: flaches, breites Tuch. Startlage: oben an den Schultern zusammengerafft -> Falten entstehen beim Fallen
    pleat = (0.04 + 0.2 * t) * math.sin(x * math.tau * 4.5 + 0.7) + (0.02 + 0.07 * t) * math.sin(x * math.tau * 9.3 + 2.1)
    side = max(0.0, x) * 2
    co = Vector((x * (2.0 + 1.5 * t) + 0.25 * t * t + 0.5 * side * t * t, 0.82 - 0.3 * (2 * x) ** 2 + 0.42 * t + pleat, 6.15 - t * 4.35))
    rest_co.append(co.copy())
    v.co = co
    if t < 0.03:
        pin_idx.append(v.index)
cape.shape_key_add(name="Basis")
rk = cape.shape_key_add(name="Rest")
for i, co in enumerate(rest_co):
    rk.data[i].co = co
rk.value = 0.0
init_co = [v.co.copy() for v in cape.data.vertices]
vg = cape.vertex_groups.new(name="pin")
vg.add(pin_idx, 1.0, "REPLACE")
cape.data.materials.append(MATS["cloth"])
for p in cape.data.polygons:
    p.use_smooth = True

cloth = cape.modifiers.new("Cloth", "CLOTH")
cs = cloth.settings
cs.quality = 8
cs.mass = 0.5
cs.tension_stiffness = 25
cs.compression_stiffness = 25
cs.shear_stiffness = 12
cs.bending_stiffness = 1.2
cs.air_damping = 2.0
cs.vertex_group_mass = "pin"
cs.rest_shape_key = rk
cc = cloth.collision_settings
cc.use_collision = True
cc.distance_min = 0.025
cc.collision_quality = 4
cc.use_self_collision = True
cc.self_distance_min = 0.012
CAPE_FRAMES = int(os.environ.get("GUARDIAN_CAPE_FRAMES", "70"))
cloth.point_cache.frame_start = 1
cloth.point_cache.frame_end = CAPE_FRAMES
coll_objs = colliders + [torso, legs[1], legs[-1]] + [o for o in stat_parts if o.name.startswith(("blk2_", "topdisc"))]
for o in coll_objs:
    o.modifiers.new("Collision", "COLLISION")
    o.collision.thickness_outer = 0.03
    o.collision.cloth_friction = 8
wind_dir = Vector((1.0, 0.45, 0.1)).normalized()
bpy.ops.object.effector_add(type="WIND", location=(-2, -1, 4.5), rotation=wind_dir.to_track_quat("Z", "Y").to_euler())
wind = bpy.context.active_object
wind.field.strength = float(os.environ.get("GUARDIAN_WIND", "2.5"))
scene.frame_start = 1
scene.frame_end = CAPE_FRAMES
for f in range(1, CAPE_FRAMES + 1):
    scene.frame_set(f)
dg = bpy.context.evaluated_depsgraph_get()
draped = bpy.data.meshes.new_from_object(cape.evaluated_get(dg))
cape.modifiers.clear()
cape.shape_key_clear()
cape.data = draped
print("CAPE moved max", round(max((v.co - init_co[i]).length for i, v in enumerate(draped.vertices)), 3))
for o in coll_objs:
    for m in [m for m in o.modifiers if m.type == "COLLISION"]:
        o.modifiers.remove(m)
bpy.data.objects.remove(wind)
scene.frame_set(1)
mod(cape, "SOLIDIFY", thickness=0.045)
smooth(cape, 1)
keep(cape)

# ---------------------------------------------------------------- Stab: Goldbeschläge, Krone aus Klauen, Kristall

staff_parts = []
SX, SY = HAND.x, HAND.y
pole = tube("pole", "dark", (SX, SY, 1.72), (SX, SY, 8.3), 0.1, 0.09)
smooth(pole, 1)
staff_parts.append(pole)
staff_parts.append(lathe("ferrule", "gold", [(0.0, 1.62), (0.08, 1.75), (0.15, 2.0), (0.13, 2.1), (0.16, 2.18), (0.12, 2.28), (0.0, 2.3)], (SX, SY, 0), seg=16))
for z in (3.1, 4.3, 6.15, 6.85):
    staff_parts.append(lathe(f"sring{z}", "gold", [(0.0, -0.09), (0.12, -0.09), (0.135, -0.06), (0.135, 0.06), (0.12, 0.09), (0.0, 0.09)], (SX, SY, z), seg=16))
grip = tube("grip", "leather", (SX, SY, 5.1), (SX, SY, 5.95), 0.115, 0.115)
smooth(grip, 1)
staff_parts.append(grip)
# Schmuckhals unter der Krone
staff_parts.append(lathe("neck", "gold", [(0.0, 7.2), (0.12, 7.2), (0.2, 7.35), (0.13, 7.5), (0.15, 7.62), (0.26, 7.78), (0.18, 7.95), (0.14, 8.1), (0.24, 8.3), (0.36, 8.45), (0.3, 8.55), (0.0, 8.52)], (SX, SY, 0), seg=20))
dia = [(0.0, 0.34), (0.22, 0.0), (0.0, -0.3), (-0.22, 0.0)]
staff_parts.append(profile_extrude("diamond", "gold", dia, 0.12, (SX, SY - 0.2, 7.78), (0, 0, 0), bevel=0.02))
staff_parts.append(gem_mesh("diagem", "inlay", 0.08, 0.14, 0.12, 6, (SX, SY - 0.28, 7.8), rot=(math.pi / 2, 0, 0)))
# Klauen um den Kristall
for i in range(4):
    a = i / 4 * math.tau + math.pi / 4
    ca, sa = math.cos(a), math.sin(a)
    pts, radii = [], []
    for j in range(12):
        k = j / 11
        r = 0.3 + 0.32 * math.sin(k * math.pi * 0.85) - 0.05 * k
        z = 8.45 + k * 1.05
        pts.append(Vector((SX + ca * r, SY + sa * r, z)))
        radii.append(1.0 - 0.85 * k)
    staff_parts.append(curve_tube(f"claw{i}", "gold", pts, 0.11, radii))
    # kurzer Seitendorn
    base = Vector((SX + ca * 0.45, SY + sa * 0.45, 8.65))
    staff_parts.append(curve_tube(f"clawspur{i}", "gold", [base, base + Vector((ca * 0.22, sa * 0.22, 0.12)), base + Vector((ca * 0.3, sa * 0.3, 0.32))], 0.05, [1, 0.6, 0.15]))

CRYSTAL_CENTER = Vector((SX, SY, 9.15))
crystal = gem_mesh("Crystal", "gem", 0.4, 1.12, 0.66, 7, CRYSTAL_CENTER, jitter=0.12)
for i, off in enumerate(((0.5, -0.15, 0.55), (-0.46, 0.1, -0.15), (0.28, 0.32, 1.05))):
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
