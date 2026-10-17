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
holes += [(x, y, 32) for x, y in [(172, 310), (446, 363), (475, 652)]]  # Inhibitoren
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

# Runde Steinsockel genau unter Türmen und Inhibitoren (statt verwaschener Flecken): Platten in zwei Ringen mit
# Fugen, dunkler Rand mit hellem Innenrand. Radius in Spieleinheiten, etwas größer als der Fuß des Modells.
PX_PER_UNIT = N / W
stone = hi[(hi.max(2) - hi.min(2) < 18) & (hi.mean(2) > 70) & (hi.mean(2) < 150)]
base_col = np.median(stone, 0) if len(stone) else np.array([110.0, 118.0, 122.0])


def hsh(a, b):
    return (np.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1.0


def platform(u0, v0, r_units):
    k = np.argmin((u - u0) ** 2 + (v - v0) ** 2)
    cy, cx = divmod(int(k), N)
    R = r_units * PX_PER_UNIT
    dx, dy = i - cx, j - cy
    rr = np.hypot(dx, dy) / R
    ang = (np.degrees(np.arctan2(dy, dx)) + 360) % 360
    inside = rr < 1.0
    ring = np.where(rr < 0.42, 0, np.where(rr < 0.78, 1, 2))
    seg = np.where(ring == 0, 0, np.where(ring == 1, np.floor((ang + 15) / 60), np.floor(ang / 30)))
    shade = 0.9 + 0.2 * hsh(ring, seg)
    col = base_col[None, None, :] * shade[..., None]
    # Fugen: Ringgrenzen und Plattenkanten
    jr = np.minimum(np.abs(rr - 0.42), np.abs(rr - 0.78)) * R
    ja1 = np.abs(((ang + 15) % 60) - 30) - 30
    ja2 = np.abs((ang % 30) - 15) - 15
    jt = np.where(ring == 1, np.abs(ja1), np.where(ring == 2, np.abs(ja2), 99)) * np.pi / 180 * rr * R
    joint = (np.minimum(jr, jt) < 1.4) & (rr > 0.05)
    col = np.where(joint[..., None], col * 0.55, col)
    # Rand
    col = np.where(((rr > 0.93) & (rr < 1.0))[..., None], col * 0.5, col)
    col = np.where(((rr > 0.88) & (rr < 0.93))[..., None], np.minimum(255, col * 1.25), col)
    # feine Körnung aus der Umgebung
    col = col + grain * 0.5
    a = np.clip((1.0 - rr) * R / 2.5, 0, 1)[..., None] * inside[..., None]
    return col, a


for (pu, pv), r_u in [((x, y), 4.0) for x, y in [(230, 505), (282, 575), (172, 215), (502, 300), (580, 655)]] + [((x, y), 4.5) for x, y in [(172, 310), (446, 363), (475, 652)]]:
    col, a = platform(pu, pv, r_u)
    hi = hi * (1 - a) + col * a

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

