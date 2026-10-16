"""Wandkarte des Dschungels aus der entzerrten Draufsicht (rect.png, 1024², LoL-Koordinaten 0..14870).

Wände sind die Baum- und Felsinseln: dort ist das Bild stark strukturiert, die Wege sind glatt.
Die blaue Hälfte (unterhalb des Flusses) wird erkannt, Rot ist die Punktspiegelung davon.
Aufruf: python3 mask.py rect.png MAP out.ts [vorschau.png]
"""
import sys
import numpy as np
from PIL import Image

src, MAP, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
prev = sys.argv[4] if len(sys.argv) > 4 else None
L_LOL = 14870
TH = 0.0345

im = np.asarray(Image.open(src).convert("RGB")).astype(float) / 255
N = im.shape[0]


def box(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge"), 0), 1)
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


L = im.mean(2)
m = box(L, 3)
tex = np.sqrt(np.maximum(box(L * L, 3) - m * m, 0))
score = box(tex, 9)
wallHi = (score > TH).astype(float)
# auf das Spielraster (Zelle = 1 Einheit)
wall = np.asarray(Image.fromarray((wallHi * 255).astype(np.uint8)).resize((MAP, MAP), Image.BOX)) > 127

def lol(X, Y):
    return X / L_LOL * MAP, (1 - Y / L_LOL) * MAP

# Camp-Nischen: Boden um das Camp frei, Wände drumherum bleiben (Eingang ergibt sich aus dem Bild)
CAMPS = {  # LoL-Koordinaten, Radius des freien Bodens in Spieleinheiten
    "blue": ((3821, 8101), 6.5), "gromp": ((2288, 8448), 5.5), "wolves": ((3780, 6443), 6.0),
    "raptors": ((6943, 5422), 6.0), "red": ((7765, 4020), 6.5), "krugs": ((8394, 2641), 6.0),
    "dragon": ((9866, 4414), 10.0),
}
zz, xx = np.mgrid[0:MAP, 0:MAP] + 0.5
for (X, Y), r in CAMPS.values():
    cx, cz = lol(X, Y)
    wall[np.hypot(xx - cx, zz - cz) < r] = False

# Camps ohne Zugang (im Bild ganz von Wand umschlossen) bekommen einen Eingang zum nächsten Weg
def flood_any(open_, seeds):
    from collections import deque
    seen = np.zeros_like(open_)
    q = deque()
    for s_ in seeds:
        if open_[s_]:
            seen[s_] = True
            q.append(s_)
    while q:
        z, x = q.popleft()
        for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = z + dz, x + dx
            if 0 <= a < MAP and 0 <= b < MAP and open_[a, b] and not seen[a, b]:
                seen[a, b] = True
                q.append((a, b))
    return seen

mainOpen = flood_any(~wall, [(MAP // 2, MAP // 2)])
for (X, Y), r in CAMPS.values():
    cx, cz = lol(X, Y)
    if mainOpen[int(cz), int(cx)]:
        continue
    d = np.hypot(xx - cx, zz - cz)
    d[~mainOpen] = 1e9
    k = np.unravel_index(np.argmin(d), d.shape)
    tz, tx = k[0] + 0.5, k[1] + 0.5
    for t in np.linspace(0, 1, 200):
        px, pz = cx + (tx - cx) * t, cz + (tz - cz) * t
        wall[np.hypot(xx - px, zz - pz) < 2.8] = False
    print("Eingang geschnitten bei", (round(cx), round(cz)), "->", (round(tx), round(tz)))

# blaue Hälfte spiegeln (z > x ist Blau)
blue = zz > xx
mir = wall[::-1, ::-1]
full = np.where(blue, wall, mir)
diag = np.abs(zz - xx) < 0.6
full[diag] = wall[diag] | mir[diag]

def flood(open_, seeds):
    from collections import deque
    seen = np.zeros_like(open_)
    q = deque()
    for s in seeds:
        if open_[s]:
            seen[s] = True
            q.append(s)
    while q:
        z, x = q.popleft()
        for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = z + dz, x + dx
            if 0 <= a < MAP and 0 <= b < MAP and open_[a, b] and not seen[a, b]:
                seen[a, b] = True
                q.append((a, b))
    return seen

# kleine Wandkrümel entfernen, eingeschlossene Löcher füllen
def components(mask):
    lab = np.zeros(mask.shape, int)
    k = 0
    sizes = [0]
    for z in range(MAP):
        for x in range(MAP):
            if mask[z, x] and not lab[z, x]:
                k += 1
                seen = flood(mask & (lab == 0), [(z, x)])
                lab[seen] = k
                sizes.append(int(seen.sum()))
    return lab, sizes

lab, sizes = components(full)
for k, s in enumerate(sizes):
    if k and s < 12:
        full[lab == k] = False
openMain = flood(~full, [(MAP // 2, MAP // 2)])
full[~full & ~openMain] = True

# Flussbecken (Wasser um Baron- und Drachengrube): blaue Pixel, größte Fläche der blauen Hälfte, gespiegelt
r_, g_, b_ = im[..., 0] * 255, im[..., 1] * 255, im[..., 2] * 255
wHi = box(((b_ > g_ + 4) & (b_ > r_ + 12)).astype(float), 8) > 0.5
water = np.asarray(Image.fromarray((wHi * 255).astype(np.uint8)).resize((MAP, MAP), Image.BOX)) > 127
water &= blue & ~full
wl, ws = components(water)
big = int(np.argmax(ws))
water = wl == big
water = np.where(blue, water, water[::-1, ::-1]) & ~full
# ganzes Flussbett füllen: vom Becken aus über freie Zellen, aber nur in einem Band um die Diagonale
# (sonst liefe das Wasser in die Dschungelwege); Grube und Flussarme gehören dazu
BAND = float(sys.argv[5]) if len(sys.argv) > 5 else 15.0
along = (xx + zz) / np.sqrt(2)
wob = np.sin(along * 0.09) * 2.5 + np.sin(along * 0.23 + 1.0) * 1.5
band = np.abs(zz - xx) / np.sqrt(2) < BAND + wob
# Drachen- und Baron-Grube stehen unter Wasser (wie die Drachengrube in LoL)
(dX, dY), dR = CAMPS["dragon"]
for cx, cz in (lol(dX, dY), (MAP - lol(dX, dY)[0], MAP - lol(dX, dY)[1])):
    band |= np.hypot(xx - cx, zz - cz) < dR + 1
water = flood_any(~full & band, list(zip(*np.nonzero(water)))) | water


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


rows = rle(full)
pool = rle(water)
with open(out, "w") as f:
    f.write("// Automatisch erzeugt von assets-src/jungle/mask.py — nicht von Hand ändern.\n")
    f.write("// Wände des Dschungels (Baum- und Felsinseln wie auf der Kluft), je Zeile Lauflängen: frei, Wand, frei, …\n")
    f.write(f"export const JUNGLE_MASK = {{\n  n: {MAP},\n  rows: [\n")
    for r in rows:
        f.write(f'    "{r}",\n')
    f.write("  ],\n  /** Wasser der Flussbecken (gleiches Format). */\n  pool: [\n")
    for r in pool:
        f.write(f'    "{r}",\n')
    f.write("  ],\n};\n")
if prev:
    big = np.asarray(Image.open(src).convert("RGB").resize((MAP * 3, MAP * 3))).copy()
    w3 = np.kron(full, np.ones((3, 3), bool))
    big[w3] = (big[w3] * 0.45 + np.array([255, 0, 0]) * 0.55).astype(np.uint8)
    p3 = np.kron(water, np.ones((3, 3), bool))
    big[p3] = (big[p3] * 0.45 + np.array([0, 255, 255]) * 0.55).astype(np.uint8)
    Image.fromarray(big).save(prev)
print("Wandanteil", full.mean())
