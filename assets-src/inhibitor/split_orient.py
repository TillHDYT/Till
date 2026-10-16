# Teilt den gebackenen Inhibitor in Sockel und Kristall und richtet ihn fuers Spiel aus.
#   python3 split_orient.py <baked.glb> <out.glb> [scale=4.0]
# - Bauteile ueber verschweisste Eckpunkte (gleiche Position = verbunden)
# - Ring = Bauteil mit der groessten Ausdehnung; Kristall = alle uebrigen Bauteile, deren Flaechenschwerpunkt in XZ
#   bei r < 0.375 liegt (Quell-Einheiten; Saeule unten r <= 0.35, Ring-Innenwand ab etwa 0.38)
# - Bauteile, die komplett im Inneren eines anderen stecken (Meshy-Restflaechen), fliegen raus
# - Skalierung k, Boden (Unterkante Ring) y = 0, XZ-Ursprung = Mitte des Ring-Grundrisses, vorne (Schutt, Ketten) bleibt +z
# - Knoten "Inhibitor" (Ring, ohne Transformation) und "Crystal" (Saeule samt Klammerkaefig, dreht sich als Ganzes):
#   nur Verschiebung auf den Drehpunkt (Mitte der Bounding-Box), Geometrie relativ dazu
import json
import struct
import sys

import numpy as np

from glbio import Glb

SRC, OUT = sys.argv[1], sys.argv[2]
K = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
R_PILLAR = 0.375

g = Glb(SRC)
prim = g.j["meshes"][0]["primitives"][0]
A = prim["attributes"]
P = g.acc(A["POSITION"]).astype(np.float64)
N = g.acc(A["NORMAL"]).astype(np.float32)
UV = g.acc(A["TEXCOORD_0"]).astype(np.float32)
I = g.acc(prim["indices"]).reshape(-1, 3).astype(np.int64)

# ------------------------------------------------------------ Bauteile (Union-Find ueber verschweisste Eckpunkte)
q = np.round(P / 1e-6).astype(np.int64)
_, inv = np.unique(q, axis=0, return_inverse=True)
W = inv.reshape(-1)[I]
lab = np.arange(W.max() + 1)
E = np.concatenate([W[:, [0, 1]], W[:, [1, 2]], W[:, [2, 0]]])
while True:
    m = np.minimum(lab[E[:, 0]], lab[E[:, 1]])
    old = lab.copy()
    np.minimum.at(lab, E[:, 0], m)
    np.minimum.at(lab, E[:, 1], m)
    while True:  # Zeiger springen lassen
        nl = lab[lab]
        if (nl == lab).all():
            break
        lab = nl
    if (lab == old).all():
        break
_, comp = np.unique(lab[W[:, 0]], return_inverse=True)
nc = comp.max() + 1
parts = []
for c in range(nc):
    f = np.nonzero(comp == c)[0]
    V = P[np.unique(I[f])]
    a, b, cc = P[I[f, 0]], P[I[f, 1]], P[I[f, 2]]
    ar = np.linalg.norm(np.cross(b - a, cc - a), axis=1) + 1e-30
    cen = ((a + b + cc) / 3 * ar[:, None]).sum(0) / ar.sum()
    parts.append({"f": f, "lo": V.min(0), "hi": V.max(0), "rmax": np.hypot(V[:, 0], V[:, 2]).max(), "rc": np.hypot(cen[0], cen[2])})
    print(f"Bauteil {c}: {len(f):6d} Dreiecke, bbox {np.round(V.min(0), 3)} .. {np.round(V.max(0), 3)},",
          f"r_max {parts[-1]['rmax']:.3f}, Schwerpunkt r {parts[-1]['rc']:.3f}")
ring = max(range(nc), key=lambda c: parts[c]["rmax"])
inner = [c for c in range(nc) if c != ring and parts[c]["rc"] < R_PILLAR]
outer = [c for c in range(nc) if c != ring and c not in inner]
pillar = max(inner, key=lambda c: len(parts[c]["f"]))


def inside(pts, tris, dirs=((0.577, 0.577, 0.577), (-0.8, 0.36, 0.48), (0.28, -0.96, 0.0))):
    """Strahltest (gerade Zahl Treffer = aussen) in drei Richtungen, Mehrheit entscheidet."""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    e1, e2 = b - a, c - a
    votes = np.zeros(len(pts), int)
    for d in dirs:
        d = np.array(d) / np.linalg.norm(d)
        h = np.cross(d, e2)
        det = (e1 * h).sum(1)
        ok = np.abs(det) > 1e-12
        idet = np.where(ok, 1 / np.where(ok, det, 1), 0)
        for s in range(0, len(pts), 64):
            o = pts[s : s + 64, None, :] - a[None]
            u = (o * h[None]).sum(2) * idet
            qq = np.cross(o, e1[None])
            v = (qq * d).sum(2) * idet
            t = (qq * e2[None]).sum(2) * idet
            hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9)
            votes[s : s + 64] += hit.sum(1) % 2
    return votes >= 2


def hidden(c, host):
    lo, hi = parts[c]["lo"], parts[c]["hi"]
    if not ((lo > parts[host]["lo"]).all() and (hi < parts[host]["hi"]).all()):
        return False
    pts = P[np.unique(I[parts[c]["f"]])]
    return bool(inside(pts, P[I[parts[host]["f"]]]).all())


drop = [c for c in inner if c != pillar and hidden(c, pillar)] + [c for c in outer if hidden(c, ring)]
for c in drop:
    print(f"Bauteil {c} steckt komplett im Inneren -> entfernt ({len(parts[c]['f'])} Dreiecke)")
ring_f = np.concatenate([parts[c]["f"] for c in [ring] + outer if c not in drop])
cry_f = np.concatenate([parts[c]["f"] for c in inner if c not in drop])

# ------------------------------------------------------------ Ausrichten
RV = P[np.unique(I[ring_f])]
y0 = RV[:, 1].min()
cx, cz = (RV[:, 0].min() + RV[:, 0].max()) / 2, (RV[:, 2].min() + RV[:, 2].max()) / 2
X = np.stack([(P[:, 0] - cx) * K, (P[:, 1] - y0) * K, (P[:, 2] - cz) * K], 1)
CV = X[np.unique(I[cry_f])]
pivot = np.round((CV.min(0) + CV.max(0)) / 2, 6)  # gerundet, damit Knoten und Geometrie exakt zusammenpassen
print(f"Massstab {K}, Boden y0 {y0:.4f}, Grundriss-Mitte ({cx:.4f}, {cz:.4f}) in Quell-Einheiten")


def sub(faces, off):
    used, li = np.unique(I[faces], return_inverse=True)
    return (X[used] - off).astype(np.float32), N[used], UV[used], li.reshape(-1, 3)


meshes = [("Inhibitor", sub(ring_f, 0), None), ("Crystal", sub(cry_f, pivot), pivot)]

# ------------------------------------------------------------ Messwerte
R_, C_ = meshes[0][1][0].astype(np.float64), meshes[1][1][0].astype(np.float64) + pivot
rr = np.hypot(R_[:, 0], R_[:, 2])
az = np.degrees(np.arctan2(R_[:, 0], R_[:, 2]))  # 0 = +z (vorne), 90 = +x
print(f"Ring: {len(meshes[0][1][3])} Dreiecke, {len(R_)} Eckpunkte, bbox {np.round(R_.min(0), 3)} .. {np.round(R_.max(0), 3)}")
print(f"Kristall: {len(meshes[1][1][3])} Dreiecke, {len(C_)} Eckpunkte, bbox {np.round(C_.min(0), 3)} .. {np.round(C_.max(0), 3)}")
print(f"Drehpunkt Kristall {np.round(pivot, 4)}, Spitze y {C_[:, 1].max():.3f}, Fuss y {C_[:, 1].min():.3f}")
print(f"Ring Oberkante: max {R_[:, 1].max():.3f}, 95%-Quantil {np.percentile(R_[:, 1], 95):.3f}")
for name, lo, hi in (("vorne", -45, 45), ("rechts (+x)", 45, 135), ("links (-x)", -135, -45), ("hinten", 135, 225)):
    a = (az - lo) % 360 < hi - lo
    print(f"  {name:12s} Radius aussen max {rr[a].max():.2f}, Oberkante max {R_[a, 1].max():.2f}")
sec = [rr[(az + 180) // 30 == s].max() for s in range(12)]
print("Ringradius je 30-Grad-Sektor ab -180 (hinten):", " ".join(f"{s:.2f}" for s in sec))
# Fuge zwischen Kristall (beliebig gedreht) und Ring-Innenwand je Hoehenband, um die Drehachse gemessen
rc = np.hypot(C_[:, 0] - pivot[0], C_[:, 2] - pivot[2])
ri = np.hypot(R_[:, 0] - pivot[0], R_[:, 2] - pivot[2])
gap, hole = [], []
for y in np.arange(0, R_[:, 1].max(), 0.04):
    mr = (R_[:, 1] >= y) & (R_[:, 1] < y + 0.04) & (ri < 2.4)
    mc = (C_[:, 1] >= y - 0.02) & (C_[:, 1] < y + 0.06)
    if mr.any() and mc.any():
        hole.append(ri[mr].min())
        gap.append(ri[mr].min() - rc[mc].max())
print(f"Kristall Radius um die Achse max {rc.max():.3f}; Ring-Innenradius um die Achse min {min(hole):.3f}, Median {np.median(hole):.3f}")
print(f"Fuge beim Drehen (Eckpunkte, je Hoehenband 0.04) min {min(gap):.3f}, Median {np.median(gap):.3f}")
hi_ = R_[R_[:, 1] > np.percentile(R_[:, 1], 98)]
print(f"Hoechste Ringteile (Schutthuegel) Richtung {np.degrees(np.arctan2(hi_[:, 0].mean(), hi_[:, 2].mean())):.0f} Grad (0 = +z)")

# ------------------------------------------------------------ GLB schreiben (Texturen und Sampler unveraendert)
buf = bytearray()
views, accs = [], []


def add(arr, ctype, typ, target=None, mm=False):
    while len(buf) % 4:
        buf.append(0)
    data = np.ascontiguousarray(arr).tobytes()
    v = {"buffer": 0, "byteOffset": len(buf), "byteLength": len(data)}
    if target:
        v["target"] = target
    views.append(v)
    buf.extend(data)
    a = {"bufferView": len(views) - 1, "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
    if mm:
        a["min"] = arr.min(0).tolist()
        a["max"] = arr.max(0).tolist()
    accs.append(a)
    return len(accs) - 1


jm, jn = [], []
for name, (pos, nrm, uv, idx), t in meshes:
    big = len(pos) > 65535
    prim_ = {
        "attributes": {
            "POSITION": add(pos, 5126, "VEC3", 34962, True),
            "NORMAL": add(nrm.astype(np.float32), 5126, "VEC3", 34962),
            "TEXCOORD_0": add(uv.astype(np.float32), 5126, "VEC2", 34962),
        },
        "indices": add(idx.reshape(-1).astype(np.uint32 if big else np.uint16), 5125 if big else 5123, "SCALAR", 34963),
        "material": 0,
    }
    jm.append({"name": name, "primitives": [prim_]})
    node = {"name": name, "mesh": len(jm) - 1}
    if t is not None:
        node["translation"] = [float(x) for x in t]
    jn.append(node)
images = []
for im in g.j["images"]:
    bv = g.j["bufferViews"][im["bufferView"]]
    while len(buf) % 4:
        buf.append(0)
    views.append({"buffer": 0, "byteOffset": len(buf), "byteLength": bv["byteLength"]})
    buf.extend(g.b[bv.get("byteOffset", 0) : bv.get("byteOffset", 0) + bv["byteLength"]])
    images.append({"bufferView": len(views) - 1, "mimeType": im["mimeType"]})
while len(buf) % 4:
    buf.append(0)
m0 = g.j["materials"][prim.get("material", 0)]["pbrMetallicRoughness"]
material = {
    "name": "Inhibitor",
    "pbrMetallicRoughness": {
        "baseColorTexture": {"index": m0["baseColorTexture"]["index"]},
        "metallicRoughnessTexture": {"index": m0["metallicRoughnessTexture"]["index"]},
        "metallicFactor": 0.0,
        "roughnessFactor": 1.0,
    },
}
j = {
    "asset": {"version": "2.0", "generator": "kluft inhibitor split_orient"},
    "scene": 0,
    "scenes": [{"nodes": list(range(len(jn)))}],
    "nodes": jn,
    "meshes": jm,
    "materials": [material],
    "textures": g.j["textures"],
    "images": images,
    "samplers": g.j["samplers"],
    "accessors": accs,
    "bufferViews": views,
    "buffers": [{"byteLength": len(buf)}],
}
js = json.dumps(j, separators=(",", ":")).encode()
while len(js) % 4:
    js += b" "
with open(OUT, "wb") as f:
    f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(buf)))
    f.write(struct.pack("<I4s", len(js), b"JSON"))
    f.write(js)
    f.write(struct.pack("<I4s", len(buf), b"BIN\x00"))
    f.write(bytes(buf))
print(f"geschrieben {OUT}: {(12 + 8 + len(js) + 8 + len(buf)) / 1e6:.2f} MB")
