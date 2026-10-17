"""Scharfer Basisboden aus einer Draufsicht der blauen Basis (LoL), außerhalb davon der Boden aus floor.py.

Aufruf: python3 floor_hi.py basis.png Mbase.npy grob.jpg MAP out.jpg
Mbase.npy: affine Abbildung LoL-Koordinaten -> Bildpixel, aus den Gebäuden im Bild gefittet (fit in README).
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, Mf, coarse, MAP, out = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
M = np.load(Mf)
L = 14870
X0, Z0, W, N = 0.0, MAP - 128.0 * MAP / 300, 128.0 * MAP / 300, 1536

im = np.asarray(Image.open(src).convert("RGB")).astype(float)
Hh, Ww = im.shape[:2]
j, i = np.mgrid[0:N, 0:N]
gx = X0 + (i + 0.5) / N * W
gz = Z0 + (j + 0.5) / N * W
X = gx / MAP * L
Y = (1 - gz / MAP) * L
u = M[0, 0] * X + M[0, 1] * Y + M[0, 2]
v = M[1, 0] * X + M[1, 1] * Y + M[1, 2]


def sample(img, u, v):  # bikubisch wäre schöner, bilinear reicht bei ~1:1
    u0 = np.clip(np.floor(u).astype(int), 0, img.shape[1] - 2)
    v0 = np.clip(np.floor(v).astype(int), 0, img.shape[0] - 2)
    fu = np.clip(u - u0, 0, 1)[..., None]
    fv = np.clip(v - v0, 0, 1)[..., None]
    return img[v0, u0] * (1 - fu) * (1 - fv) + img[v0, u0 + 1] * fu * (1 - fv) + img[v0 + 1, u0] * (1 - fu) * fv + img[v0 + 1, u0 + 1] * fu * fv


hi = sample(im, u, v)

# Gebäude-Symbole, Fackelsäulen, Statuen und Markierungen im Bild (Pixel, Radius) herausretuschieren
holes = [(195, 580, 47)]  # Nexus
holes += [(x, y, 29) for x, y in [(230, 505), (282, 575), (172, 215), (502, 300), (580, 655)]]  # Türme
holes += [(x, y - 8, 30) for x, y in [(172, 310), (446, 363), (475, 652)]]  # Inhibitoren (Wappen oben auf dem Sockel)
holes += [(x, y, 20) for x, y in [(265, 130), (420, 148), (485, 183), (617, 317), (667, 470), (667, 555), (113, 15), (104, 118)]]
holes += [(345, 250, 24), (552, 485, 24), (420, 105, 20), (690, 378, 20)]
mask = np.zeros((N, N), bool)
for x, y, r in holes:
    mask |= (u - x) ** 2 + (v - y) ** 2 < r * r


def box(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge"), 0), 1)
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


def gblur(a, r):
    for _ in range(3):
        a = box(a, max(1, r // 2))
    return a


known = (~mask).astype(float)
num = np.stack([gblur(hi[..., c] * known, 60) for c in range(3)], -1)
den = gblur(known, 60)[..., None]
hp = hi - np.stack([gblur(hi[..., c], 6) for c in range(3)], -1)
grain = np.roll(np.roll(hp, 61, 0), 97, 1)
hi[mask] = (num / np.maximum(den, 1e-3))[mask] + grain[mask] * 0.8

# Übergang zum groben Boden am Bildrand (Feder 6 Pixel)
inside = np.minimum.reduce([u, v, Ww - 1 - u, Hh - 1 - v])
wgt = np.clip(inside / 6.0, 0, 1)[..., None]
lo = np.asarray(Image.open(coarse).convert("RGB").resize((N, N), Image.BICUBIC)).astype(float)
res = hi * wgt + lo * (1 - wgt)
Image.fromarray(np.clip(res, 0, 255).astype(np.uint8)).save(out, quality=88)

# Gebäudepositionen aus dem Bild zurück in LoL-Koordinaten (für mapdata.ts)
A = np.vstack([M, [0, 0, 1]])
Ai = np.linalg.inv(A)
for name, (x, y) in {"nexus": (195, 580), "nexusT1": (230, 505), "nexusT2": (282, 575), "inhTop": (172, 310), "inhMid": (446, 363), "inhBot": (475, 652), "turTop": (172, 215), "turMid": (502, 300), "turBot": (580, 655)}.items():
    p = Ai @ [x, y, 1]
    print(name, round(p[0]), round(p[1]))

# Silberne Sternspitzen um den Nexus, die über den Ring des 3D-Modells (Radius 10.5) hinausragen, mit der
# Umgebung (Gras) übermalen. Die Nexus-Türme bleiben ausgespart.
from collections import deque

res = np.asarray(Image.open(out).convert("RGB")).astype(float)
def gpx(x, z):
    return (x - X0) / W * N, (z - Z0) / W * N
def lolg(X, Y):
    return X / L * MAP, (1 - Y / L) * MAP
ncx, ncz = gpx(*lolg(1543, 1661))
ppu = N / W
rr = np.hypot(i - ncx, j - ncz) / ppu
mxc = res.max(2); mnc = res.min(2)
satc = (mxc - mnc) / np.maximum(mxc, 1)
grey = (satc < 0.24) & (mxc > 60)
keep = np.zeros((N, N), bool)
for X, Y in [(1724, 2242), (2125, 1760)]:
    tx, tz = gpx(*lolg(X, Y))
    keep |= np.hypot(i - tx, j - tz) / ppu < 3.4
area = grey & (rr > 8.8) & (rr < 16) & ~keep
star = np.zeros((N, N), bool)
q = deque()
for a in np.linspace(0, 2 * np.pi, 720, endpoint=False):
    y_ = int(ncz + np.sin(a) * 9.2 * ppu); x_ = int(ncx + np.cos(a) * 9.2 * ppu)
    if 0 <= y_ < N and 0 <= x_ < N and area[y_, x_]:
        star[y_, x_] = True; q.append((y_, x_))
while q:
    y_, x_ = q.popleft()
    for oy, ox in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a_, b_ = y_ + oy, x_ + ox
        if 0 <= a_ < N and 0 <= b_ < N and area[a_, b_] and not star[a_, b_]:
            star[a_, b_] = True; q.append((a_, b_))
# Ränder mitnehmen und kleine Lücken schließen
star = box(star.astype(float), 4) > 0.15
star &= (rr > 8.6) & ~keep
# Füllung: echtes Gras aus der Nähe (südlich des Nexus), gespiegelt gekachelt, damit keine Nähte entstehen
gx0, gz0 = int(ncx + 2.8 * ppu), int(ncz + 11.0 * ppu)
patch = res[gz0:gz0 + int(4.6 * ppu), gx0:gx0 + int(6.0 * ppu)]
ph, pw = patch.shape[:2]
tile = np.concatenate([np.concatenate([patch, patch[:, ::-1]], 1), np.concatenate([patch[::-1], patch[::-1, ::-1]], 1)], 0)
fillc = tile[j % (2 * ph), i % (2 * pw)]
soft = np.clip(gblur(star.astype(float), 4) * 1.5, 0, 1)[..., None]
res = res * (1 - soft) + fillc * soft
Image.fromarray(np.clip(res, 0, 255).astype(np.uint8)).save(out, quality=88)
print("Sternspitzen übermalt:", int(star.sum()), "Pixel")
