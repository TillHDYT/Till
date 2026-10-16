# Backt Farbe und Rauheit des hochaufgeloesten Meshy-Modells auf die vereinfachte Version.
# Variante von startbase/bake.py: die UV-Karte kommt fertig aus low.glb (xuv.py), statt eigener Box-Charts;
# zusaetzlich wird die Roughness (G-Kanal der metallicRoughness-Textur) mitgebacken.
#   python3 bake.py <high.glb> <low.glb> <out.glb> [--atlas 2048] [--jpg-quality 90] [--jpg-subsampling 2]
#                   [--mr-px atlas/2] [--preview atlas.png]
# low.glb: gleiche Geometrie, stark vereinfacht, mit brauchbarer UV-Karte (Normalen werden neu berechnet).
import argparse
import io
import time

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from glbio import Glb, write_glb

ap = argparse.ArgumentParser()
ap.add_argument("high")
ap.add_argument("low")
ap.add_argument("out")
ap.add_argument("--atlas", type=int, default=2048, help="Kantenlaenge der Farbtextur")
ap.add_argument("--jpg-quality", type=int, default=90, help="JPEG-Qualitaet der Farbtextur")
ap.add_argument("--jpg-subsampling", type=int, default=2, help="0 = 4:4:4, 2 = 4:2:0")
ap.add_argument("--mr-px", type=int, default=0, help="Kantenlaenge der Roughness-Textur (0 = atlas/2)")
ap.add_argument("--preview", default="", help="Farbatlas zusaetzlich als Bild speichern")
args = ap.parse_args()
HIGH, LOW, OUT, ATLAS = args.high, args.low, args.out, args.atlas
MRPX = args.mr_px or ATLAS // 2
t0 = time.time()


def log(*a):
    print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------ Low-Poly: schweissen, UVs je Ecke
low = Glb(LOW)
P, LUV, I, _ = low.prim()
q = np.round(P / 1e-6).astype(np.int64)
_, weld, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
inv = inv.reshape(-1)
V = P[weld]
F = inv[I]
keep_idx = np.nonzero((F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2]))[0]
F = F[keep_idx]
A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
FN = np.cross(B - A, C - A)
FA = np.linalg.norm(FN, axis=1)
keep = FA > 1e-14
F, FN, FA = F[keep], FN[keep] / FA[keep, None], FA[keep]
keep_idx = keep_idx[keep]
nf = len(F)
log("low", len(V), "verts", nf, "tris")

corner_v = F.reshape(-1)
corner_f = np.repeat(np.arange(nf), 3)
cuv = LUV[I[keep_idx].reshape(-1)]
pix = (cuv * ATLAS).reshape(nf, 3, 2)
_e1 = pix[:, 1] - pix[:, 0]
_e2 = pix[:, 2] - pix[:, 0]
scale = np.sqrt(np.abs(_e1[:, 0] * _e2[:, 1] - _e1[:, 1] * _e2[:, 0]).sum() / FA.sum())
log("texel scale", round(float(scale), 1), "px/unit")

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
Q = V[F[tf, 0]] * bw[:, :1] + V[F[tf, 1]] * bw[:, 1:2] + V[F[tf, 2]] * bw[:, 2:]
QN = FN[tf]
log("texels", len(tf), f"{len(tf) / ATLAS**2:.0%} belegt")

# ------------------------------------------------------------ High-Poly abtasten
high = Glb(HIGH)
HP, HUV, HI, hp = high.prim()
mat = high.j["materials"][hp.get("material", 0)]
tex = np.asarray(high.image(mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]).convert("RGB"))
mrt = np.asarray(high.image(mat["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"]).convert("RGB"))
assert mrt.shape == tex.shape
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
rgh = np.empty((NS,), np.uint8)
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
    _ty = np.clip((u[:, 1] % 1) * TH, 0, TH - 1).astype(int)
    _tx = np.clip((u[:, 0] % 1) * TW, 0, TW - 1).astype(int)
    col[s : s + n] = tex[_ty, _tx]
    rgh[s : s + n] = mrt[_ty, _tx, 1]
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
cr = (rgh[idx].astype(np.float32) * w).sum(1) / w.sum(1)
atlas = np.zeros((ATLAS, ATLAS, 4), np.float32)
atlas[ty, tx, :3] = c
atlas[ty, tx, 3] = cr
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
A8 = np.clip(atlas, 0, 255).astype(np.uint8)
img = Image.fromarray(A8[..., :3])
# Roughness in G (glTF: R ungenutzt, B = Metall = 0)
mr = np.zeros((ATLAS, ATLAS, 3), np.uint8)
mr[..., 0] = 255
mr[..., 1] = A8[..., 3]
mrimg = Image.fromarray(mr).resize((MRPX, MRPX), Image.LANCZOS)

# ------------------------------------------------------------ Normalen mit Knickkante, Vertices aufteilen
vn = np.zeros_like(V)
np.add.at(vn, F.reshape(-1), np.repeat(FN * FA[:, None], 3, axis=0))
vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
cn = vn[corner_v]
flat = (cn * FN[corner_f]).sum(1) < np.cos(np.radians(40))
cn[flat] = FN[corner_f][flat]
cuv = pix.reshape(-1, 2) / ATLAS
uvk = np.round(cuv * 65536).astype(np.int64)
keyv = np.stack([corner_v, uvk[:, 0], uvk[:, 1], flat.astype(np.int64) * (corner_f + 1)], 1)
_, first, newidx = np.unique(keyv, axis=0, return_index=True, return_inverse=True)
outP, outN, outUV = V[corner_v[first]], cn[first], cuv[first]
outI = newidx.reshape(-1, 3)
buf = io.BytesIO()
img.save(buf, "JPEG", quality=args.jpg_quality, subsampling=args.jpg_subsampling)
buf2 = io.BytesIO()
mrimg.save(buf2, "JPEG", quality=85)
material = {
    "name": "Inhibitor",
    "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicRoughnessTexture": {"index": 1}, "metallicFactor": 0.0, "roughnessFactor": 1.0},
    "doubleSided": True,
}
write_glb(OUT, outP, outN, outUV, outI, [(buf.getvalue(), "image/jpeg"), (buf2.getvalue(), "image/jpeg")], material)
log("Roughness", MRPX, "px", buf2.tell() / 1e6, "MB")
log("fertig", OUT, len(outP), "verts", len(outI), "tris", f"Textur {buf.tell() / 1e6:.1f} MB")
if args.preview:
    img.save(args.preview)
