# Backt die Textur eines hochaufgeloesten Meshy-Modells auf eine vereinfachte Version mit neuer UV-Karte.
#   python3 bake.py <high.glb> <low.glb> <out.glb> [atlas_px] [preview.png]
# low.glb: gleiche Geometrie, stark vereinfacht (z. B. gltfpack -sa), UVs unbrauchbar.
import io
import sys
import time

import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from glbio import Glb, write_glb

HIGH, LOW, OUT = sys.argv[1:4]
ATLAS = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
PAD = 2
t0 = time.time()


def log(*a):
    print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------ Low-Poly: schweissen, Charts
low = Glb(LOW)
P, _, I, _ = low.prim()
q = np.round(P / 1e-6).astype(np.int64)
_, weld, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
inv = inv.reshape(-1)
V = P[weld]
F = inv[I]
F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
FN = np.cross(B - A, C - A)
FA = np.linalg.norm(FN, axis=1)
keep = FA > 1e-14
F, FN, FA = F[keep], FN[keep] / FA[keep, None], FA[keep]
nf = len(F)
log("low", len(V), "verts", nf, "tris")

# Klasse = dominante Achse der Flaechennormale (Box-Projektion)
ax = np.argmax(np.abs(FN), axis=1)
cls = ax * 2 + (FN[np.arange(nf), ax] < 0)
AXES = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], float)
allowed = (FN @ AXES.T) > 0.12

# Nachbarflaechen ueber gemeinsame Kanten, nur gleiche Klasse
E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
fid = np.tile(np.arange(nf), 3)
E.sort(axis=1)
key = E[:, 0] * (len(V) + 1) + E[:, 1]
o = np.argsort(key, kind="stable")
ks, fs = key[o], fid[o]
same = ks[1:] == ks[:-1]
a, b = fs[:-1][same], fs[1:][same]
# Klassen glaetten (Mehrheitsentscheid der Nachbarn), damit weniger Mini-Charts entstehen
for _ in range(int(__import__("os").environ.get("SMOOTH", "12"))):
    votes = np.zeros((nf, 6))
    votes[np.arange(nf), cls] += 1.0
    np.add.at(votes, (a, cls[b]), 1.0)
    np.add.at(votes, (b, cls[a]), 1.0)
    votes[~allowed] = -1
    cls = np.argmax(votes, axis=1)
ok = cls[a] == cls[b]
a, b = a[ok], b[ok]
g = coo_matrix((np.ones(len(a)), (a, b)), shape=(nf, nf))
nch, chart = connected_components(g, directed=False)
log("charts", nch)

# Projektion je Flaeche: die beiden anderen Achsen
other = np.array([[2, 1], [1, 2], [0, 2], [2, 0], [0, 1], [1, 0]])  # pro Klasse, Spiegelung egal
corner_v = F.reshape(-1)
corner_f = np.repeat(np.arange(nf), 3)
uv2 = np.stack([V[corner_v, other[cls[corner_f], 0]], V[corner_v, other[cls[corner_f], 1]]], 1)

# Chart-Bounding-Boxes (Modell-Einheiten)
cc = chart[corner_f]
mn = np.full((nch, 2), np.inf)
mx = np.full((nch, 2), -np.inf)
np.minimum.at(mn, cc, uv2)
np.maximum.at(mx, cc, uv2)
size = mx - mn


def pack(scale):
    w = np.ceil(size[:, 0] * scale).astype(int) + 2 * PAD + 1
    h = np.ceil(size[:, 1] * scale).astype(int) + 2 * PAD + 1
    order = np.argsort(-h, kind="stable")
    pos = np.zeros((nch, 2), int)
    x = y = rowh = 0
    for c in order:
        if x + w[c] > ATLAS:
            x, y, rowh = 0, y + rowh, 0
        if w[c] > ATLAS:
            return None
        pos[c] = (x, y)
        x += w[c]
        rowh = max(rowh, h[c])
    return pos if y + rowh <= ATLAS else None


lo, hi = 1.0, 1e6
for _ in range(40):
    mid = (lo * hi) ** 0.5
    if pack(mid) is None:
        hi = mid
    else:
        lo = mid
scale = lo
pos = pack(scale)
log("texel scale", round(scale, 1), "px/unit, texel size", 1 / scale)

# Atlas-Koordinaten (Pixel) je Ecke
pix = (uv2 - mn[cc]) * scale + pos[cc] + PAD + 0.5
pix = pix.reshape(nf, 3, 2)

# ------------------------------------------------------------ Rasterisieren: Texel -> 3D-Punkt
tri_of = np.full((ATLAS, ATLAS), -1, np.int64)
bary = np.zeros((ATLAS, ATLAS, 3), np.float32)
for f in range(nf):
    p = pix[f]
    x0, y0 = np.floor(p.min(0) - 1).astype(int)
    x1, y1 = np.ceil(p.max(0) + 1).astype(int)
    xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, ATLAS)), np.arange(max(y0, 0), min(y1, ATLAS)))
    cx, cy = xs + 0.5, ys + 0.5
    (ax_, ay), (bx, by), (cx_, cy_) = p
    den = (by - cy_) * (ax_ - cx_) + (cx_ - bx) * (ay - cy_)
    if abs(den) < 1e-12:
        continue
    l0 = ((by - cy_) * (cx - cx_) + (cx_ - bx) * (cy - cy_)) / den
    l1 = ((cy_ - ay) * (cx - cx_) + (ax_ - cx_) * (cy - cy_)) / den
    l2 = 1 - l0 - l1
    # konservativ: halber Pixel Toleranz, damit Kanten keine Luecken haben
    eps = 0.7 / max(np.sqrt(abs(den)), 1e-6)
    m = (l0 >= -eps) & (l1 >= -eps) & (l2 >= -eps)
    free = tri_of[ys[m], xs[m]] < 0
    yy, xx = ys[m][free], xs[m][free]
    tri_of[yy, xx] = f
    lb = np.clip(np.stack([l0[m][free], l1[m][free], l2[m][free]], 1), 0, 1)
    bary[yy, xx] = lb / lb.sum(1, keepdims=True)
    if f % 30000 == 0:
        log("raster", f)
filled = tri_of >= 0
ty, tx = np.nonzero(filled)
tf = tri_of[ty, tx]
bw = bary[ty, tx].astype(np.float64)
Q = (V[F[tf, 0]] * bw[:, :1] + V[F[tf, 1]] * bw[:, 1:2] + V[F[tf, 2]] * bw[:, 2:])
QN = FN[tf]
log("texels", len(tf), f"{len(tf) / ATLAS**2:.0%} belegt")

# ------------------------------------------------------------ High-Poly abtasten
high = Glb(HIGH)
HP, HUV, HI, hp = high.prim()
mat = high.j["materials"][hp.get("material", 0)]
tex = np.asarray(high.image(mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]).convert("RGB"))
TH, TW = tex.shape[:2]
ha, hb, hc = HP[HI[:, 0]], HP[HI[:, 1]], HP[HI[:, 2]]
hn = np.cross(hb - ha, hc - ha)
harea = np.linalg.norm(hn, axis=1)
hn = (hn / np.maximum(harea[:, None], 1e-15)).astype(np.float32)
area_total = harea.sum() / 2
NS = int(min(26e6, area_total * (scale * 3.0) ** 2))
log("high", len(HI), "tris, samples", NS)
rng = np.random.default_rng(7)
cdf = np.cumsum(harea)
cdf /= cdf[-1]
pts = np.empty((NS, 3), np.float32)
col = np.empty((NS, 3), np.uint8)
nrm = np.empty((NS, 3), np.float16)
CH = 4_000_000
for s in range(0, NS, CH):
    n = min(CH, NS - s)
    f = np.searchsorted(cdf, rng.random(n))
    r1 = np.sqrt(rng.random(n))
    r2 = rng.random(n)
    w0, w1, w2 = 1 - r1, r1 * (1 - r2), r1 * r2
    pts[s : s + n] = ha[f] * w0[:, None] + hb[f] * w1[:, None] + hc[f] * w2[:, None]
    u = HUV[HI[f, 0]] * w0[:, None] + HUV[HI[f, 1]] * w1[:, None] + HUV[HI[f, 2]] * w2[:, None]
    col[s : s + n] = tex[np.clip((u[:, 1] % 1) * TH, 0, TH - 1).astype(int), np.clip((u[:, 0] % 1) * TW, 0, TW - 1).astype(int)]
    nrm[s : s + n] = hn[f]
del ha, hb, hc, HP, HUV, HI, cdf
log("tree build")
tree = cKDTree(pts, leafsize=32, balanced_tree=False, compact_nodes=False)
log("query")
K = 8
dist, idx = tree.query(Q.astype(np.float32), k=K, workers=-1)
nd = (nrm[idx].astype(np.float32) * QN[:, None, :].astype(np.float32)).sum(2)
good = nd > 0.15
# gewichtetes Mittel der passenden Nachbarn (glaettet Abtastrauschen), sonst naechster
w = np.where(good, 1.0 / (dist + 1e-5), 0.0)
none = w.sum(1) == 0
w[none, 0] = 1.0
c = (col[idx].astype(np.float32) * w[:, :, None]).sum(1) / w.sum(1, keepdims=True)
atlas = np.zeros((ATLAS, ATLAS, 3), np.float32)
atlas[ty, tx] = c
log("ohne passende Normale:", int(none.sum()))

# ------------------------------------------------------------ Raender auffuellen (Dilatation)
mask = filled.copy()
for _ in range(12):
    acc = np.zeros_like(atlas)
    cnt = np.zeros((ATLAS, ATLAS), np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        sh = np.roll(np.roll(atlas * mask[..., None], dy, 0), dx, 1)
        sm = np.roll(np.roll(mask, dy, 0), dx, 1)
        acc += sh
        cnt += sm
    new = (~mask) & (cnt > 0)
    atlas[new] = acc[new] / cnt[new, None]
    mask |= new
img = Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8))

# ------------------------------------------------------------ Normalen mit Knickkante, Vertices aufteilen
vn = np.zeros_like(V)
np.add.at(vn, F.reshape(-1), np.repeat(FN * FA[:, None], 3, axis=0))
vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
cn = vn[corner_v]
flat = (cn * FN[corner_f]).sum(1) < np.cos(np.radians(40))
cn[flat] = FN[corner_f][flat]
cuv = pix.reshape(-1, 2) / ATLAS
keyv = np.stack([corner_v, cc, flat.astype(np.int64) * (corner_f + 1)], 1)
_, first, newidx = np.unique(keyv, axis=0, return_index=True, return_inverse=True)
outP, outN, outUV = V[corner_v[first]], cn[first], cuv[first]
outI = newidx.reshape(-1, 3)
buf = io.BytesIO()
img.save(buf, "JPEG", quality=90)
material = {
    "name": "Base",
    "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 0.95},
    "doubleSided": True,
}
write_glb(OUT, outP, outN, outUV, outI, [(buf.getvalue(), "image/jpeg")], material)
log("fertig", OUT, len(outP), "verts", len(outI), "tris", f"Textur {buf.tell() / 1e6:.1f} MB")
if len(sys.argv) > 5:
    img.save(sys.argv[5])
