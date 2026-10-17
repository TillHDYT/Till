"""Schneidet den lila Kometen mit goldenem Schein (Elaras Q-Flug; Splitter und Punkte bleiben kurz liegen) Bild für
Bild aus dem Vorlage-GIF aus, wie cut.py: Licht- und Schattenschicht je Bild in einer Bildtafel.

Raum: Ursprung am Abwurfpunkt, u-Achse zum Punkt, an dem der Komet das Bild verlässt (entzerrt wie bei der Q,
Höhe/Breite 0,9). Bilder 16-45; der Kopf erreicht das Ende der Bahn in Bild 31 (Index 15).
Aufruf: python3 cut_support.py vorlage.gif <ausgabe-ordner>
"""
import json
import sys

import numpy as np
from PIL import Image, ImageSequence

src, out = sys.argv[1], sys.argv[2]
fr = np.stack([np.asarray(f.convert("RGB")) for f in ImageSequence.Iterator(Image.open(src))]).astype(np.float32)
H, W = fr.shape[1:3]
bg = np.median(np.concatenate([fr[0:15], fr[48:58]]), axis=0)
E = 0.9
S = np.array([32.0, 222.0])
END = np.array([325.0, 19.0])
d = np.array([END[0] - S[0], (END[1] - S[1]) / E])
L = float(np.linalg.norm(d))
U = d / L
V = np.array([-U[1], U[0]])
mask_ui = np.zeros((H, W), bool)
mask_ui[226:, 300:] = True  # Bedienelement unten rechts im GIF


def layers(i):
    c = fr[i]
    A = np.clip(c - bg - 5, 0, 255)
    A[A.sum(2) < 18] = 0
    M = np.clip((c + 1) / (bg + 1), 0, 1)
    M[M.min(2) > 0.93] = 1
    A[mask_ui] = 0
    M[mask_ui] = 1
    return A, M


def sample(img, x, y, fill):
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    ok = (x0 >= 0) & (y0 >= 0) & (x0 < W - 1) & (y0 < H - 1)
    x0c, y0c = np.clip(x0, 0, W - 2), np.clip(y0, 0, H - 2)
    v = img[y0c, x0c] * (1 - fx) * (1 - fy) + img[y0c, x0c + 1] * fx * (1 - fy) + img[y0c + 1, x0c] * (1 - fx) * fy + img[y0c + 1, x0c + 1] * fx * fy
    v[~ok] = fill
    return v


frames = list(range(16, 46))
u0, u1, v0, v1 = -50.0, L + 6, -55.0, 55.0
w, h = 384, 96
uu, vv = np.meshgrid(np.linspace(u0, u1, w), np.linspace(v1, v0, h))
p = uu[..., None] * U + vv[..., None] * V
x, y = S[0] + p[..., 0], S[1] + p[..., 1] * E
edge = np.minimum.reduce([np.arange(w)[None, :].repeat(h, 0), (w - 1 - np.arange(w))[None, :].repeat(h, 0),
                          np.arange(h)[:, None].repeat(w, 1), (h - 1 - np.arange(h))[:, None].repeat(w, 1)])
k = np.clip(edge / 8, 0, 1)[..., None]
As, Ms = [], []
ARRIVE = 15
for n, i in enumerate(frames):
    A, M = layers(i)
    kk = k.copy()
    if n > ARRIVE:
        # nach dem Aufprall: der Kopf am Ziel verlischt schnell (im GIF fliegt er aus dem Bild)
        head = np.clip((uu - (L - 60)) / 40, 0, 1)[..., None]
        kk = kk * (1 - head * min(1, (n - ARRIVE) / 3))
    a = sample(A, x, y, 0) * kk
    m = 1 - (1 - sample(M, x, y, 1)) * kk
    As.append(a)
    Ms.append(m)
cols = 3
rows = (len(frames) + cols - 1) // cols
ia = np.zeros((rows * h, cols * w, 3), np.float32)
im_ = np.ones((rows * h, cols * w, 3), np.float32)
for n, (a, m) in enumerate(zip(As, Ms)):
    r, c = divmod(n, cols)
    ia[r * h:(r + 1) * h, c * w:(c + 1) * w] = a
    im_[r * h:(r + 1) * h, c * w:(c + 1) * w] = m
Image.fromarray(ia.astype(np.uint8)).save(f"{out}/elara_comet_add.jpg", quality=90)
Image.fromarray((im_ * 255).astype(np.uint8)).save(f"{out}/elara_comet_mul.jpg", quality=90)
meta = {"frames": len(frames), "cols": cols, "rows": rows, "u0": u0, "u1": u1, "v0": v0, "v1": v1, "L": L, "arrive": ARRIVE}
json.dump(meta, open(f"{out}/elara_comet_meta.json", "w"))
print(json.dumps(meta))
