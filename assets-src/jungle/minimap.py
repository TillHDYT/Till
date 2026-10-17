"""Wände und Fluss des Dschungels aus der LoL-Minikarte (minimap.webp, genau von oben).

Schwarz = Wand, beige = Weg, blau = Fluss, hellblau = Basis. Die Karte wird über die Gebäude-Symbole (Nexus,
Inhibitoren, Türme) auf LoL-Koordinaten gelegt; Symbole und Markierungen werden aus der Umgebung aufgefüllt.
Ausgewertet wird die blaue Hälfte, Rot ist die Punktspiegelung (die Kluft ist punktsymmetrisch).
Aufruf: python3 minimap.py minimap.webp 300 ../../src/game/jungleMask.ts [vorschau.png]
"""
import sys
from collections import deque
import numpy as np
from PIL import Image

src, MAP, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
prev = sys.argv[4] if len(sys.argv) > 4 else None
L = 14870
im = np.asarray(Image.open(src).convert("RGB")).astype(float)
H, W = im.shape[:2]

# Passpunkte: Minikarten-Pixel der Symbole (blaue Seite) und LoL-Koordinaten der Gebäude
BLUE = [
    ((84, 502.5), (1543, 1661)),                                                  # Nexus
    ((70, 435), (1171, 3571)), ((144, 448.5), (3203, 3208)), ((153, 520), (3452, 1236)),  # Inhibitoren
    ((70, 406), (1169, 4287)), ((161, 430), (3651, 3696)), ((182.5, 520), (4281, 1253)),  # Inhib-Türme
    ((90, 482.5), (1748, 2270)), ((106.5, 497.5), (2177, 1807)),                  # Nexus-Türme
    ((81, 321), (1512, 6699)), ((210, 390), (5048, 4812)), ((277.5, 512.5), (6919, 1483)),  # innere Türme
]
RED = [  # dieselben Gebäude der roten Seite (Punktspiegelung der LoL-Koordinaten)
    ((507.5, 85), (1543, 1661)),
    ((521, 156), (1171, 3571)), ((449, 142.5), (3203, 3208)), ((436.5, 69), (3452, 1236)),
    ((521, 182.5), (1169, 4287)), ((431, 159), (3651, 3696)), ((407.5, 70), (4281, 1253)),
    ((500, 110), (1748, 2270)), ((485, 90), (2177, 1807)),
    ((510, 265), (1512, 6699)), ((381, 197.5), (5048, 4812)), ((314, 77.5), (6919, 1483)),
]
P = [(p, q) for p, q in BLUE] + [(p, (L - q[0], L - q[1])) for p, q in RED]
# px = ax + s * X, py = ay - s * Y (Minikarte ist achsparallel und unverzerrt)
A, b = [], []
for (px, py), (X, Y) in P:
    A.append([1, 0, X]); b.append(px)
    A.append([0, 1, -Y]); b.append(py)
(ax, ay, s), *_ = np.linalg.lstsq(np.array(A, float), np.array(b, float), rcond=None)
res = [np.hypot(ax + s * X - px, ay - s * Y - py) for (px, py), (X, Y) in P]
print("Maßstab %.3f px je 1000 LoL, Restfehler mittel %.1f px, max %.1f px" % (s * 1000, np.mean(res), np.max(res)))

# Farbklassen
REF = {"wall": (5, 15, 25), "path": (142, 155, 112), "river": (3, 126, 160), "base": (103, 151, 158)}
names = list(REF)
ref = np.array([REF[k] for k in names], float)
d = np.linalg.norm(im[:, :, None, :] - ref[None, None], axis=-1)
cls = np.argmin(d, -1)
cls[np.min(d, -1) > 55] = -1
# Symbole ausblenden (Gebäude, Stufen-Marken, Ecken): Kreis um jedes Symbol
icons = [(p, 21) for p, _ in BLUE + RED] + [(p, 18) for p in ((62, 185), (237, 327), (405, 520), (182, 58), (350, 252), (528, 395), (38, 523), (528, 38))]
yy, xx = np.mgrid[0:H, 0:W]
for (px, py), r in icons:
    # Symbole sind höher als breit (Turm mit Sockel): Ellipse
    cls[np.hypot((xx - px) / 0.8, yy - py) < r] = -1
# Lücken aus der Umgebung füllen (Breitensuche von bekannten Pixeln)
q = deque(zip(*np.nonzero(cls >= 0)))
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, c = y + dy, x + dx
        if 0 <= a < H and 0 <= c < W and cls[a, c] < 0:
            cls[a, c] = cls[y, x]
            q.append((a, c))

# auf das Spielraster: Klassenanteile bilinear abtasten, größter Anteil gewinnt
onehot = np.stack([(cls == k).astype(float) for k in range(len(names))], -1)
zz, xxw = np.mgrid[0:MAP, 0:MAP] + 0.5
X = xxw / MAP * L
Y = (1 - zz / MAP) * L
fx = np.clip(ax + s * X - 0.5, 0, W - 1.001)
fy = np.clip(ay - s * Y - 0.5, 0, H - 1.001)
ix, iy = fx.astype(int), fy.astype(int)
tx, ty = (fx - ix)[..., None], (fy - iy)[..., None]
prob = (onehot[iy, ix] * (1 - tx) * (1 - ty) + onehot[iy, ix + 1] * tx * (1 - ty)
        + onehot[iy + 1, ix] * (1 - tx) * ty + onehot[iy + 1, ix + 1] * tx * ty)
grid = np.argmax(prob, -1)
wall = grid == names.index("wall")
water = grid == names.index("river")
# blaue Hälfte (unterhalb der Flussdiagonale) gilt, Rot gespiegelt
blue = zz > xxw
wall = np.where(blue, wall, wall[::-1, ::-1])
water = np.where(blue, water, water[::-1, ::-1])
diag = np.abs(zz - xxw) < 0.6
wall[diag] = wall[diag] & wall[::-1, ::-1][diag]
water &= ~wall


def components(mask):
    lab = np.zeros(mask.shape, int)
    sizes = [0]
    for z0, x0 in zip(*np.nonzero(mask)):
        if lab[z0, x0]:
            continue
        k = len(sizes)
        lab[z0, x0] = k
        q = deque([(z0, x0)])
        n = 0
        while q:
            z, x = q.popleft()
            n += 1
            for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, c = z + dz, x + dx
                if 0 <= a < MAP and 0 <= c < MAP and mask[a, c] and not lab[a, c]:
                    lab[a, c] = k
                    q.append((a, c))
        sizes.append(n)
    return lab, sizes


# Reste von Symbolen: kleines Wasser abseits des Flusses und Wandkrümel entfernen
lab, sizes = components(water)
for k, n in enumerate(sizes):
    if k and n < 150:
        water[lab == k] = False
lab, sizes = components(wall)
for k, n in enumerate(sizes):
    if k and n < 5:
        wall[lab == k] = False


def rle(mask):
    out = []
    for z in range(MAP):
        runs, cur, n = [], False, 0
        for v in mask[z]:
            if bool(v) == cur:
                n += 1
            else:
                runs.append(n)
                cur, n = bool(v), 1
        runs.append(n)
        out.append(",".join(map(str, runs)))
    return out


with open(out, "w") as f:
    f.write("// Automatisch erzeugt von assets-src/jungle/minimap.py — nicht von Hand ändern.\n")
    f.write("// Wände des Dschungels aus der LoL-Minikarte, je Zeile Lauflängen: frei, Wand, frei, …\n")
    f.write(f"export const JUNGLE_MASK = {{\n  n: {MAP},\n  rows: [\n")
    for r in rle(wall):
        f.write(f'    "{r}",\n')
    f.write("  ],\n  /** Wasser des Flusses (gleiches Format). */\n  pool: [\n")
    for r in rle(water):
        f.write(f'    "{r}",\n')
    f.write("  ],\n};\n")
if prev:
    big = np.zeros((MAP, MAP, 3), np.uint8) + np.array([142, 155, 112], np.uint8)
    big[wall] = (5, 15, 25)
    big[water] = (3, 126, 160)
    Image.fromarray(big).resize((MAP * 2, MAP * 2), Image.NEAREST).save(prev)
print("Wandanteil", round(float(wall.mean()), 3), "Wasser", round(float(water.mean()), 3))
