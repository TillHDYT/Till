"""Schneidet Malgors Q (Blutkugel) Bild für Bild aus dem Vorlage-GIF aus (rot umgefärbte Fassung) und legt
Bildtafeln (Atlanten) für das Spiel an.

Je Bild wird der leere Boden abgezogen und der Effekt in zwei Schichten zerlegt:
  Licht  A = max(Bild - Boden, 0)          -> im Spiel additiv auf den Boden
  Schatten M = min(Bild / Boden, 1)        -> im Spiel multipliziert (dunkelt den Boden ab)
Boden * M + A ergibt wieder genau das Bild aus dem GIF.

Koordinaten: Die Scheibe ist im GIF wegen der schrägen Kamera eine Ellipse (Höhe/Breite 0,895); entzerrt wird in einem
Raum mit Ursprung in der Mitte der Scheibe und u-Achse in Flugrichtung (vom Werfer zur Scheibe).
  Flug:   Bilder 6-37, u von -L-40 bis +60, v ±90 Pixel  (L = Abstand Werfer-Scheibe)
  Scheibe: Bilder 37-80, u, v ±1,25 R (R = Außenradius der Scheibe, 103 Pixel)
Aufruf: python3 cut.py Q_rot.gif <ausgabe-ordner>
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageSequence

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src)
fr = np.stack([np.asarray(f.convert("RGB")) for f in ImageSequence.Iterator(im)]).astype(np.float32)
H, W = fr.shape[1:3]
bg = np.median(fr[81:92], axis=0)  # ruhige Bilder ohne Effekt

CX, CY, E, R = 160.0, 282.0, 0.895, 103.0
START = np.array([350.0, 30.0])  # Hand des Werfers im GIF
d = np.array([CX - START[0], (CY - START[1]) / E])
L = float(np.linalg.norm(d))
U = d / L  # Flugrichtung im entzerrten Raum
V = np.array([-U[1], U[0]])

# Masken (GIF-Pixel): Figur in der Scheibe (Körper und Schwert) und Werferin oben rechts
mask_fig = Image.new("L", (W, H), 0)
g = ImageDraw.Draw(mask_fig)
# großzügig: die Figur schwingt ihr Schwert, die Stelle wird aus der gegenüberliegenden Seite der Scheibe gefüllt
g.polygon([(20, 280), (95, 280), (150, 315), (150, 345), (100, 400), (20, 400)], fill=255)
from PIL import ImageFilter

mask_fig = np.asarray(mask_fig.filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255  # weiche Kante
mask_caster = np.zeros((H, W), bool)
mask_caster[:100, 318:] = True


def redder(A, M):
    """Auf unserem blaugrauen Boden wirkt die Scheibe sonst lila: Licht von Rosa/Magenta zu Rot schieben und die
    dunkle Schicht Blau und Grün stärker abdunkeln lassen als Rot (rote Tönung)."""
    r, g, b = A[..., 0], A[..., 1], A[..., 2]
    magenta = np.clip((b - g) / (r + 1), 0, 1)  # Anteil Blau über Grün
    A = A.copy()
    A[..., 2] = b - (b - g) * np.clip(magenta * 1.6, 0, 0.85)
    M = M.copy()
    # im GIF lag die Scheibe auf grünem Boden, dort dunkelt sie vor allem Grün ab; Blau genauso stark abdunkeln,
    # sonst bleibt auf unserem blaugrauen Boden Blau übrig und es wird lila
    M[..., 1] = np.minimum(M[..., 1], M[..., 0])
    M[..., 2] = np.minimum(M[..., 2], M[..., 1] * 1.04)
    return A, M


def layers(i):
    c, b = fr[i], bg
    A = np.clip(c - b - 5, 0, 255)
    A[A.sum(2) < 18] = 0
    M = np.clip((c + 1) / (b + 1), 0, 1)
    M[M.min(2) > 0.93] = 1
    return redder(A, M)


def sample(img, x, y, fill):
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    ok = (x0 >= 0) & (y0 >= 0) & (x0 < W - 1) & (y0 < H - 1)
    x0c = np.clip(x0, 0, W - 2)
    y0c = np.clip(y0, 0, H - 2)
    v = img[y0c, x0c] * (1 - fx) * (1 - fy) + img[y0c, x0c + 1] * fx * (1 - fy) + img[y0c + 1, x0c] * (1 - fx) * fy + img[y0c + 1, x0c + 1] * fx * fy
    v[~ok] = fill
    return v


def to_gif(u, v):
    p = u[..., None] * U + v[..., None] * V
    return CX + p[..., 0], CY + p[..., 1] * E


def render(frames, u0, u1, v0, v1, w, h, fill_mask):
    us = np.linspace(u0, u1, w)
    vs = np.linspace(v1, v0, h)
    uu, vv = np.meshgrid(us, vs)
    x, y = to_gif(uu, vv)
    xr, yr = to_gif(-uu, -vv)  # gegenüberliegender Punkt der Scheibe (Füllung für die verdeckte Stelle)
    mfig = sample(mask_fig[..., None], x, y, 0)  # 0..1
    mcast = sample(mask_caster[..., None].astype(np.float32), x, y, 0)[..., 0] > 0.3
    outA, outM = [], []
    for i in frames:
        A, M = layers(i)
        a = sample(A, x, y, 0)
        m = sample(M, x, y, 1)
        if fill_mask:
            a = a * (1 - mfig) + sample(A, xr, yr, 0) * mfig
            m = m * (1 - mfig) + sample(M, xr, yr, 1) * mfig
        a[mcast] = 0
        m[mcast] = 1
        # Rand weich ausblenden
        edge = np.minimum.reduce([np.linspace(0, 1, w)[None, :].repeat(h, 0) * w, np.linspace(1, 0, w)[None, :].repeat(h, 0) * w,
                                  np.linspace(0, 1, h)[:, None].repeat(w, 1) * h, np.linspace(1, 0, h)[:, None].repeat(w, 1) * h])
        k = np.clip(edge / 10, 0, 1)[..., None]
        a *= k
        m = 1 - (1 - m) * k
        outA.append(a)
        outM.append(m)
    return outA, outM


def atlas(tiles, cols, fill):
    h, w = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    img = np.full((rows * h, cols * w, 3), fill, np.float32)
    for k, t in enumerate(tiles):
        r, c = divmod(k, cols)
        img[r * h:(r + 1) * h, c * w:(c + 1) * w] = t
    return img, rows


meta = {"fps": 1000 / 30, "discRadiusPx": R}
# Flug
fl = list(range(6, 38))
u0, u1, v0, v1 = -L - 40, 60, -90, 90
fw, fh = 320, 112
A, M = render(fl, u0, u1, v0, v1, fw, fh, False)
ia, rows = atlas(A, 4, 0)
im_ = atlas(M, 4, 255)[0]
Image.fromarray(ia.astype(np.uint8)).save(f"{out}/q_flight_add.jpg", quality=90)
Image.fromarray((im_ * 255).astype(np.uint8)).save(f"{out}/q_flight_mul.jpg", quality=90)
meta["flight"] = {"frames": len(fl), "cols": 4, "rows": rows, "u0": u0, "u1": u1, "v0": v0, "v1": v1, "L": L}
# Scheibe
dl = list(range(37, 76))  # danach spielt die Figur im GIF einen eigenen Effekt
s = 1.25 * R
dw = 224
A, M = render(dl, -s, s, -s, s, dw, dw, True)
ia, rows = atlas(A, 7, 0)
im_ = atlas(M, 7, 255)[0]
Image.fromarray(ia.astype(np.uint8)).save(f"{out}/q_disc_add.jpg", quality=90)
Image.fromarray((im_ * 255).astype(np.uint8)).save(f"{out}/q_disc_mul.jpg", quality=90)
meta["disc"] = {"frames": len(dl), "cols": 7, "rows": rows, "half": s}
json.dump(meta, open(f"{out}/q_meta.json", "w"), indent=1)
print(json.dumps(meta))
