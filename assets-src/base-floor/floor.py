"""Boden der Basis aus dem LoL-Kartenbild (Draufsicht, entzerrt), eingemalte Gebäude herausretuschiert.

Aufruf: python3 floor.py karte.webp H.npy MAP out.jpg
H.npy: Homographie LoL-Koordinaten -> Bildpixel (aus assets-src/jungle/rectify.py).
Ausgabe: Quadrat über die blaue Basis, Spielkoordinaten x X0..X0+W, z Z0..Z0+W (siehe BASE_FLOOR in mapdata.ts).
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, Hf, MAP, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
H = np.load(Hf)
L = 14870
X0, Z0, W, N = 0.0, MAP - 128.0 * MAP / 300, 128.0 * MAP / 300, 1024
SHIFT = 5 * L / 1024  # Bildmerkmale liegen gut 5 Pixel (Draufsicht) unter der echten Bodenposition

im = Image.open(src).convert("RGB")
# vorher vergrößern, damit das bikubische Abtasten weicher ist
UP = 4
big = np.asarray(im.resize((im.width * UP, im.height * UP), Image.BICUBIC)).astype(float)
j, i = np.mgrid[0:N, 0:N]
gx = X0 + (i + 0.5) / N * W
gz = Z0 + (j + 0.5) / N * W
X = gx / MAP * L
Y = (1 - gz / MAP) * L - SHIFT
den = H[2, 0] * X + H[2, 1] * Y + H[2, 2]
u = (H[0, 0] * X + H[0, 1] * Y + H[0, 2]) / den * UP
v = (H[1, 0] * X + H[1, 1] * Y + H[1, 2]) / den * UP
u0 = np.clip(np.floor(u).astype(int), 0, big.shape[1] - 2)
v0 = np.clip(np.floor(v).astype(int), 0, big.shape[0] - 2)
fu = (u - u0)[..., None]
fv = (v - v0)[..., None]
img = big[v0, u0] * (1 - fu) * (1 - fv) + big[v0, u0 + 1] * fu * (1 - fv) + big[v0 + 1, u0] * (1 - fu) * fv + big[v0 + 1, u0 + 1] * fu * fv

# Gebäude, Fackelsäulen und Statuen (Draufsicht-Pixel 1024², Bodenpunkt) -> Ellipsen, nach oben verlängert (Bild schräg von Süden)
def lolpx(x, y):  # 1024er Draufsicht -> Ausgabepixel
    g_x = x / 1024 * MAP
    g_z = (y - 5) / 1024 * MAP  # gleiche Verschiebung wie beim Abtasten
    return (g_x - X0) / W * N, (g_z - Z0) / W * N

K = N / W * MAP / 1024  # Ausgabepixel je Draufsicht-Pixel
holes = []
turrets = [(82, 737), (252, 780), (295, 942), (120, 873), (150, 903)]
inhibs = [(80, 783), (220, 807), (238, 943)]
pillars = [(128, 682), (168, 683), (240, 707), (308, 773), (325, 810), (333, 847), (335, 885), (43, 680), (43, 630)]
statues = [(167, 750), (278, 863)]
for x, y in turrets:
    holes.append((x, y - 19, 16, 33))
for x, y in inhibs:
    holes.append((x, y - 8, 14, 19))
holes.append((110, 909, 30, 32))  # Nexus
for x, y in pillars:
    holes.append((x, y - 9, 11, 15))
for x, y in statues:
    holes.append((x, y - 6, 10, 13))
mask = np.zeros((N, N), bool)
for x, y, rx, ry in holes:
    cx, cy = lolpx(x, y)
    mask |= ((i - cx) / (rx * K)) ** 2 + ((j - cy) / (ry * K)) ** 2 < 1

# Retusche: weiches Mittel der Umgebung (normierte Faltung), damit dunkle Sprite-Ränder nicht hineinlaufen
def box(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge"), 0), 1)
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


def gblur(a, r):  # dreimal Kastenfilter ~ Gauß
    for _ in range(3):
        a = box(a, r // 2)
    return a

known = (~mask).astype(np.float32)
fill = img.copy()
num = np.stack([gblur((img[..., c] * known).astype(np.float32), 44) for c in range(3)], -1)
den = gblur(known, 44)[..., None]
fill[mask] = (num / np.maximum(den, 1e-3))[mask]
# Körnung aus einem versetzten Ausschnitt dazu, damit die Flecken nicht glatt aussehen
hp = img - np.asarray(Image.fromarray(img.astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))).astype(float)
grain = np.roll(np.roll(hp, 37, 0), 53, 1)
fill[mask] += grain[mask]
Image.fromarray(np.clip(fill, 0, 255).astype(np.uint8)).save(out, quality=90)
print("Ausschnitt x", X0, "..", X0 + W, " z", Z0, "..", Z0 + W)
