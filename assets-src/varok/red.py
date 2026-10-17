"""Varok: alles Gelbe/Goldene der Textur rot färben (Schwarz-Rot-Kontrast), Haut und dunkle Rüstung bleiben.

Liest das Modell, färbt die Farbtextur (maria_diffuse) im HSV-Raum um und schreibt das GLB neu (Puffer neu gepackt).
Aufruf: python3 red.py ../../src/assets/models/Varok.glb [vorschau.png]
Das Original liegt als Varok_gold.glb daneben, damit das Skript wiederholbar bleibt.
"""
import io, json, os, shutil, struct, sys
import numpy as np
from PIL import Image

path = sys.argv[1]
prev = sys.argv[2] if len(sys.argv) > 2 else None
orig = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Varok_gold.glb")
if not os.path.exists(orig):
    shutil.copy(path, orig)
raw = open(orig, "rb").read()
jlen = struct.unpack("<I", raw[12:16])[0]
gj = json.loads(raw[20:20 + jlen])
bstart = 20 + jlen
blen = struct.unpack("<I", raw[bstart:bstart + 4])[0]
bin_ = raw[bstart + 8:bstart + 8 + blen]
views = [bin_[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]] for v in gj["bufferViews"]]

img_i = next(i for i, im in enumerate(gj["images"]) if "diffuse" in im.get("name", ""))
bv = gj["images"][img_i]["bufferView"]
im = Image.open(io.BytesIO(views[bv])).convert("RGB")
hsv = np.asarray(im.convert("HSV")).astype(float)
h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# Gold/Gelb: Farbton 32–68°, kräftig gesättigt (Haut liegt bei ~20–30° und ist blass)
w = sstep(28, 36, h) * (1 - sstep(64, 72, h)) * sstep(0.38, 0.5, s) * sstep(0.1, 0.2, v)
# blasse, helle Glanzlichter im Gold und in den Haaren
w = np.maximum(w, sstep(34, 40, h) * (1 - sstep(66, 74, h)) * sstep(0.14, 0.24, s) * sstep(0.62, 0.75, v))
# kräftiges Orange (Tuch, dunkle Goldränder); die Haut ist dafür zu blass
w = np.maximum(w, sstep(6, 12, h) * (1 - sstep(34, 40, h)) * sstep(0.58, 0.68, s) * sstep(0.12, 0.22, v))
rgb = np.asarray(im).astype(float) / 255
lum = rgb @ np.array([0.3, 0.55, 0.15])
# tiefes Rot mit der Helligkeitsstruktur des Goldes (Glanzlichter bleiben heller)
red = np.stack([np.clip(lum * 1.55, 0, 1), lum * 0.12, lum * 0.14], -1)
out = rgb * (1 - w[..., None]) + red * w[..., None]
res = Image.fromarray((out * 255).round().astype(np.uint8))
buf = io.BytesIO()
res.save(buf, "JPEG", quality=92)
views[bv] = buf.getvalue()
if prev:
    res.resize((600, 600)).save(prev)

# Puffer neu packen (4-Byte-Ausrichtung)
data = b""
for i, d in enumerate(views):
    while len(data) % 4:
        data += b"\0"
    gj["bufferViews"][i]["byteOffset"] = len(data)
    gj["bufferViews"][i]["byteLength"] = len(d)
    data += d
while len(data) % 4:
    data += b"\0"
gj["buffers"][0]["byteLength"] = len(data)
js = json.dumps(gj, separators=(",", ":")).encode()
while len(js) % 4:
    js += b" "
total = 12 + 8 + len(js) + 8 + len(data)
with open(path, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
    f.write(struct.pack("<II", len(data), 0x004E4942) + data)
print("umgefärbt:", round(float((w > 0.5).mean()) * 100, 1), "% der Textur")
