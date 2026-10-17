"""Schneidet Elaras neue Effekte Bild für Bild aus den Vorlage-GIFs aus (wie cut.py: Licht- und Schattenschicht je
Bild in einer Bildtafel).

- Grundangriff (Neeko Auto Attack, grüner Blitz): Band vom Abwurf bis zum Einschlag, Bilder 14-32, Einschlag in Bild 22
- Heilkreis der Q (gleiches GIF, grüner Wirbelring mit goldenen Funken): Quadrat um den Einschlag, Bilder 22-46
- E (blaue Kugel mit Spur): Band entlang der Flugbahn, Bilder 26-40, Sternplatzer am Ende (Bilder 41, 0-14) als Quadrat

Aufruf: python3 cut_elara2.py neeko.gif kugel.gif <ausgabe-ordner>
"""
import json
import sys

import numpy as np
from PIL import Image, ImageSequence

E = 0.9  # Kamera im GIF: senkrecht etwas gestaucht


def load(path):
    return np.stack([np.asarray(f.convert("RGB")) for f in ImageSequence.Iterator(Image.open(path))]).astype(np.float32)


def layers(c, bg, keep):
    A = np.clip(c - bg - 6, 0, 255)
    A[A.sum(2) < 24] = 0
    M = np.clip((c + 1) / (bg + 1), 0, 1)
    M[M.min(2) > 0.92] = 1
    A *= keep[..., None]
    M = 1 - (1 - M) * keep[..., None]
    return A, M


def sample(img, x, y, fill):
    H, W = img.shape[:2]
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    ok = (x0 >= 0) & (y0 >= 0) & (x0 < W - 1) & (y0 < H - 1)
    x0c, y0c = np.clip(x0, 0, W - 2), np.clip(y0, 0, H - 2)
    v = img[y0c, x0c] * (1 - fx) * (1 - fy) + img[y0c, x0c + 1] * fx * (1 - fy) + img[y0c + 1, x0c] * (1 - fx) * fy + img[y0c + 1, x0c + 1] * fx * fy
    v[~ok] = fill
    return v


def edge_fade(w, h, px):
    e = np.minimum.reduce([np.arange(w)[None, :].repeat(h, 0), (w - 1 - np.arange(w))[None, :].repeat(h, 0),
                           np.arange(h)[:, None].repeat(w, 1), (h - 1 - np.arange(h))[:, None].repeat(w, 1)])
    return np.clip(e / px, 0, 1)


def band(fr, bg, keep, frames, S, END, u0, u1, vh, w, h):
    """Bildfolge entlang der Linie S->END (u: entlang, v: quer, beide entzerrt)."""
    d = np.array([END[0] - S[0], (END[1] - S[1]) / E])
    L = float(np.linalg.norm(d))
    U = d / L
    V = np.array([-U[1], U[0]])
    uu, vv = np.meshgrid(np.linspace(u0, u1(L), w), np.linspace(vh, -vh, h))
    p = uu[..., None] * U + vv[..., None] * V
    x, y = S[0] + p[..., 0], S[1] + p[..., 1] * E
    k = edge_fade(w, h, 8)[..., None]
    out = []
    for i in frames:
        A, M = layers(fr[i], bg, keep)
        out.append((sample(A, x, y, 0) * k, 1 - (1 - sample(M, x, y, 1)) * k))
    return out, {"u0": u0, "u1": u1(L), "v0": -vh, "v1": vh, "L": L}


def square(fr, bg, keep, frames, C, half, r_fade, n):
    """Bildfolge im Quadrat um C (entzerrt), außen rund ausgeblendet."""
    uu, vv = np.meshgrid(np.linspace(-half, half, n), np.linspace(half, -half, n))
    x, y = C[0] + uu, C[1] - vv * E
    r = np.hypot(uu, vv)
    k = np.clip((half - r) / (half - r_fade), 0, 1)[..., None]
    out = []
    for i in frames:
        A, M = layers(fr[i], bg, keep)
        out.append((sample(A, x, y, 0) * k, 1 - (1 - sample(M, x, y, 1)) * k))
    return out, {"half": half}


def save(cells, cols, out, name, meta):
    h, w = cells[0][0].shape[:2]
    rows = (len(cells) + cols - 1) // cols
    ia = np.zeros((rows * h, cols * w, 3), np.float32)
    im_ = np.ones((rows * h, cols * w, 3), np.float32)
    for n, (a, m) in enumerate(cells):
        r, c = divmod(n, cols)
        ia[r * h:(r + 1) * h, c * w:(c + 1) * w] = a
        im_[r * h:(r + 1) * h, c * w:(c + 1) * w] = m
    Image.fromarray(np.clip(ia, 0, 255).astype(np.uint8)).save(f"{out}/{name}_add.jpg", quality=90)
    Image.fromarray((np.clip(im_, 0, 1) * 255).astype(np.uint8)).save(f"{out}/{name}_mul.jpg", quality=90)
    meta = {"frames": len(cells), "cols": cols, "rows": rows, **meta}
    print(name, json.dumps(meta))


neeko, kugel, out = sys.argv[1], sys.argv[2], sys.argv[3]

# --- Neeko: grüner Blitz und Heilkreis ---
fr = load(neeko)
H, W = fr.shape[1:3]
bg = np.median(fr, axis=0)
keep = np.ones((H, W), np.float32)
keep[448:] = 0  # Schriftband unten
keep *= np.clip((np.arange(W)[None, :] - 240) / 20, 0, 1)  # Neeko selbst (links)
keep[195:, :275] = 0  # ihr Schatten
S, HIT = np.array([250.0, 168.0]), np.array([520.0, 290.0])
cells, m = band(fr, bg, keep, range(14, 33), S, HIT, -20.0, lambda L: L + 75, 75.0, 320, 120)
save(cells, 3, out, "elara_aa", {**m, "arrive": 22 - 14})
cells, m = square(fr, bg, keep, range(22, 47), HIT, 80.0, 66.0, 160)
save(cells, 5, out, "elara_zone", {**m, "ring": 52})

# --- blaue Kugel ---
fr = load(kugel)
H, W = fr.shape[1:3]
bg = np.median(fr, axis=0)
keep = np.clip((np.arange(W)[None, :] - 150) / 25, 0, 1).repeat(H, 0).astype(np.float32)  # Figur links
S, END = np.array([155.0, 152.0]), np.array([505.0, 136.0])
cells, m = band(fr, bg, keep, range(26, 41), S, END, -10.0, lambda L: L + 20, 60.0, 300, 104)
save(cells, 4, out, "elara_e", {**m, "arrive": 15})
cells, m = square(fr, bg, keep, [41] + list(range(0, 15)), END, 95.0, 78.0, 160)
save(cells, 4, out, "elara_eburst", m)
