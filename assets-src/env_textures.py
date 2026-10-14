# Gemalte Umgebungstexturen für die Karte (kachelbar bzw. mit Alpha):
#   python3 assets-src/env_textures.py src/assets
# rock.jpg (Felswände), dirt.jpg (Wege), pine.png (Nadelzweige), leaves.png (Laubkrone), tallgrass.png (Büsche)
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "."


def pnoise(n, size, seed):
    """Kachelbares, weiches Rauschen 0..1 mit Strukturgröße ~size Pixel."""
    r = np.random.default_rng(seed)
    w = r.standard_normal((n, n))
    f2 = np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * np.exp(-f2 * (size**2) * 6)))
    return (out - out.min()) / (out.max() - out.min())


def fbm(n, seed, sizes=(96, 48, 24, 12, 6), gain=0.55):
    acc = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for i, s in enumerate(sizes):
        acc += pnoise(n, s, seed + i) * amp
        tot += amp
        amp *= gain
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min())


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    a, b = np.array(a, float), np.array(b, float)
    return a + (b - a) * t[..., None]


def bleed(a):
    """Farbe in transparente Bereiche ausdehnen, damit beim Verkleinern (Mipmaps) keine dunklen Ränder entstehen."""
    rgb = a[..., :3].astype(float)
    al = (a[..., 3] > 0).astype(float)
    acc, w = rgb * al[..., None], al.copy()
    out = rgb.copy()
    filled = al > 0
    for _ in range(24):
        acc2 = acc.copy()
        w2 = w.copy()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc2 += np.roll(acc, (dy, dx), (0, 1))
            w2 += np.roll(w, (dy, dx), (0, 1))
        acc, w = acc2, w2
        newf = (w > 0) & ~filled
        out[newf] = acc[newf] / w[newf][..., None]
        filled |= newf
    a = a.copy()
    a[..., :3] = np.where(al[..., None] > 0, rgb, out).astype(np.uint8)
    return a


def save_rgb(arr, name, q=88):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q)


# ---------------------------------------------------------------- Fels: kantige Facetten mit Rissen, leicht geschichtet

def rock(n=512, cells=34, seed=3):
    r = np.random.default_rng(seed)
    pts = r.random((cells, 2)) * n
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    f1 = np.full((n, n), 1e9)
    f2 = np.full((n, n), 1e9)
    idx = np.zeros((n, n), int)
    vx = np.zeros((n, n))
    vy = np.zeros((n, n))
    for i, (cx, cy) in enumerate(pts):
        dx = (xx - cx + n / 2) % n - n / 2
        dy = ((yy - cy + n / 2) % n - n / 2) * 1.7  # breiter als hoch -> Schichtung
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        f1 = np.where(closer, d, f1)
        idx = np.where(closer, i, idx)
        vx = np.where(closer, dx, vx)
        vy = np.where(closer, dy, vy)
    pal = np.array([(116, 108, 96), (100, 97, 94), (128, 117, 101), (92, 88, 86), (110, 104, 92)], float)
    base = pal[r.integers(0, len(pal), cells)] * (0.85 + 0.3 * r.random((cells, 1)))
    g = r.normal(size=(cells, 2))
    g[:, 1] = -np.abs(g[:, 1]) - 0.6  # Licht eher von oben
    g /= np.linalg.norm(g, axis=1, keepdims=True)
    rad = n / math.sqrt(cells) * 0.7
    facet = 0.88 + 0.2 * np.clip((g[idx, 0] * vx + g[idx, 1] * vy) / rad, -1, 1) * -1
    col = base[idx] * facet[..., None]
    crack = sstep(0.0, 5.0, f2 - f1)
    col *= (0.35 + 0.65 * crack)[..., None]
    col *= (0.86 + 0.28 * fbm(n, seed + 10, (24, 8, 3)))[..., None]
    # helle Kante oben an jeder Facette
    rim = (1 - sstep(4.0, 10.0, f2 - f1)) * crack * (vy < 0)
    col += rim[..., None] * 26
    save_rgb(col, "rock.jpg")


# ---------------------------------------------------------------- Weg: festgetretene Erde mit Kieseln

def dirt(n=512, seed=21):
    base = fbm(n, seed)
    col = lerp((124, 98, 68), (172, 142, 100), sstep(0.15, 0.9, base))
    col = col * (0.9 + 0.2 * fbm(n, seed + 5, (10, 4, 2)))[..., None]
    worn = sstep(0.55, 0.8, fbm(n, seed + 9, (64, 32)))
    col = col * (1 - worn[..., None] * 0.1) + worn[..., None] * np.array([20, 16, 10])
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).convert("RGBA")
    S = 2
    layer = Image.new("RGBA", (n * S, n * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = np.random.default_rng(seed)
    for _ in range(150):
        cx, cy = r.random() * n * S, r.random() * n * S
        rw = (2.0 + r.random() ** 2.5 * 7) * S
        rh = rw * (0.55 + r.random() * 0.35)
        tone = 105 + r.random() * 45
        c = (int(tone), int(tone * 0.92), int(tone * 0.8))
        for ox in (-n * S, 0, n * S):
            for oy in (-n * S, 0, n * S):
                x, y = cx + ox, cy + oy
                if x + rw < 0 or y + rh < 0 or x - rw > n * S or y - rh > n * S:
                    continue
                d.ellipse((x - rw + S, y - rh + 1.6 * S, x + rw + S, y + rh + 1.6 * S), fill=(40, 30, 20, 110))
                d.ellipse((x - rw, y - rh, x + rw, y + rh), fill=c + (255,))
                d.ellipse((x - rw * 0.6, y - rh * 0.75, x + rw * 0.3, y - rh * 0.05), fill=(min(255, int(tone * 1.15)), min(255, int(tone * 1.08)), min(255, int(tone * 0.95)), 120))
    layer = layer.resize((n, n), Image.LANCZOS)
    img = Image.alpha_composite(img, layer)
    save_rgb(np.asarray(img.convert("RGB"), float), "dirt.jpg")


# ---------------------------------------------------------------- Nadelzweige: u läuft um den Baum, v von innen (oben) zur Spitze (unten)

def pine(w=512, h=256, seed=5):
    S = 2
    W, H = w * S, h * S
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, int(H * 0.5)), fill=(30, 66, 50, 255))
    r = np.random.default_rng(seed)
    for k in range(2600):
        t = r.random()
        y0 = (t ** 1.4) * H * 0.62
        x0 = r.random() * W
        ln = (26 + r.random() * 64) * S * (0.6 + 0.6 * t)
        ang = math.pi / 2 + (r.random() - 0.5) * 0.9
        x1, y1 = x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln
        if y1 > H * 0.98:
            continue
        depth = min(1.0, y1 / H)
        lit = 0.25 + 0.75 * depth ** 1.3 + (r.random() - 0.5) * 0.25
        c = (int(28 + 104 * lit), int(64 + 122 * lit), int(46 + 54 * lit), 255)
        wdt = max(1, int((2.0 + r.random() * 2.5) * S))
        for ox in (-W, 0, W):
            d.line((x0 + ox, y0, x1 + ox, y1), fill=c, width=wdt)
    img = img.resize((w, h), Image.LANCZOS)
    a = np.asarray(img).copy()
    a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    Image.fromarray(bleed(a)).save(os.path.join(OUT, "pine.png"), optimize=True)


# ---------------------------------------------------------------- Laub: runder Blätterbüschel, oben links beleuchtet

def leaves(n=256, seed=8):
    S = 2
    N = n * S
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(seed)
    c0 = N / 2
    R = N * 0.44
    items = []
    for _ in range(420):
        a = r.random() * math.tau
        rr = math.sqrt(r.random()) * R
        x, y = c0 + math.cos(a) * rr, c0 + math.sin(a) * rr
        items.append((y, x, a))
    items.sort()
    for y, x, a in items:
        lx = ((c0 - x) * 0.7 + (c0 - y) * 0.7) / R  # Licht von oben links
        edge = math.hypot(x - c0, y - c0) / R
        lit = 0.5 + 0.28 * lx + 0.18 * edge + (r.random() - 0.5) * 0.18
        lit = max(0.05, min(1.1, lit))
        col = (int(34 + 96 * lit), int(76 + 104 * lit), int(40 + 46 * lit), 255)
        L = (9 + r.random() * 9) * S
        Wd = L * 0.45
        ang = r.random() * math.tau
        pts = []
        for k in range(10):
            t = k / 9 * math.pi
            px = math.cos(t) * L
            py = math.sin(t) * Wd * math.sin(t)
            pts.append((px, py))
        pts += [(p[0], -p[1]) for p in reversed(pts)]
        ca, sa = math.cos(ang), math.sin(ang)
        poly = [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in pts]
        d.polygon(poly, fill=col, outline=(int(col[0] * 0.8), int(col[1] * 0.8), int(col[2] * 0.8), 255))
    img = img.resize((n, n), Image.LANCZOS)
    a = np.asarray(img).copy()
    a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    Image.fromarray(bleed(a)).save(os.path.join(OUT, "leaves.png"), optimize=True)


# ---------------------------------------------------------------- Hohes Gras für Büsche

def tallgrass(n=256, seed=13):
    S = 2
    N = n * S
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(seed)
    blades = []
    for _ in range(110):
        x0 = N * (0.18 + 0.64 * r.random())
        hgt = N * (0.45 + 0.5 * r.random())
        bend = (r.random() - 0.5) * N * 0.5 + (x0 - N / 2) * 0.6
        wdt = (5 + r.random() * 6) * S
        blades.append((hgt, x0, bend, wdt))
    blades.sort(reverse=True)
    for hgt, x0, bend, wdt in blades:
        steps = 16
        left, right = [], []
        for k in range(steps + 1):
            t = k / steps
            x = x0 + bend * t * t
            y = N - 1 - hgt * t
            w = wdt * (1 - t) ** 0.8
            left.append((x - w / 2, y))
            right.append((x + w / 2, y))
        tone = r.random()
        for k in range(steps):
            t = k / steps
            lit = 0.3 + 0.7 * t ** 1.1 + (tone - 0.5) * 0.3
            col = (int(30 + 100 * lit), int(78 + 120 * lit), int(42 + 54 * lit), 255)
            d.polygon([left[k], right[k], right[k + 1], left[k + 1]], fill=col)
    img = img.resize((n, n), Image.LANCZOS)
    a = np.asarray(img).copy()
    a[..., 3] = np.where(a[..., 3] > 100, 255, 0)
    Image.fromarray(bleed(a)).save(os.path.join(OUT, "tallgrass.png"), optimize=True)


# ---------------------------------------------------------------- Rasen: dichte, weiche Halme in sattem Grün, ohne Blumen

def grass(n=512, seed=31):
    base = fbm(n, seed, (128, 64, 32, 16))
    col = lerp((50, 88, 40), (76, 122, 50), sstep(0.2, 0.85, base))
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).convert("RGBA")
    S = 2
    N = n * S
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = np.random.default_rng(seed)
    clump = fbm(n, seed + 3, (40, 20))
    pal = [(38, 74, 34), (54, 96, 40), (70, 116, 48), (88, 136, 56), (104, 150, 62)]
    for _ in range(16000):
        x, y = r.random() * N, r.random() * N
        cl = clump[int(y / S) % n, int(x / S) % n]
        tone = min(4, max(0, int(r.random() * 3 + cl * 2.4)))
        c = pal[tone] + (int(150 + r.random() * 105),)
        ln = (5 + r.random() * 9) * S
        ang = -math.pi / 2 + (r.random() - 0.5) * 1.3
        x1, y1 = x + math.cos(ang) * ln, y + math.sin(ang) * ln
        wdt = int((1.2 + r.random() * 1.6) * S)
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                if -20 < x + ox < N + 20 and -40 < y + oy < N + 40:
                    d.line((x + ox, y + oy, x1 + ox, y1 + oy), fill=c, width=wdt)
    layer = layer.resize((n, n), Image.LANCZOS)
    img = Image.alpha_composite(img, layer)
    save_rgb(np.asarray(img.convert("RGB"), float), "grass_field.jpg")


rock()
dirt()
grass()
pine()
leaves()
tallgrass()
print("ok")
