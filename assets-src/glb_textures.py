# Verkleinert die Texturen in einem GLB und setzt Materialien mit Alpha-Textur auf "Ausschneiden":
#   python3 glb_textures.py <datei.glb> [max_kante] [namensteil] [jpeg_qualität]
# Mit namensteil werden nur Bilder bearbeitet, deren Name ihn enthält (z. B. "normal"), die anderen bleiben unverändert.
# Bilder ohne nutzbaren Alpha-Kanal werden JPEG, Bilder mit Alpha bleiben PNG (verkleinert).
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

path = sys.argv[1]
MAX = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
ONLY = sys.argv[3] if len(sys.argv) > 3 else ""
QUALITY = int(sys.argv[4]) if len(sys.argv) > 4 else 88
d = open(path, "rb").read()
jlen = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20 : 20 + jlen])
b0 = 20 + jlen
blen = struct.unpack("<I", d[b0 : b0 + 4])[0]
binc = d[b0 + 8 : b0 + 8 + blen]

views = [bytes(binc[v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]]) for v in j["bufferViews"]]
alpha_images = set()
for i, img in enumerate(j.get("images", [])):
    if "bufferView" not in img or ONLY not in (img.get("name") or ""):
        continue
    im = Image.open(io.BytesIO(views[img["bufferView"]]))
    has_alpha = im.mode in ("RGBA", "LA") and np.asarray(im.convert("RGBA"))[..., 3].min() < 250
    if max(im.size) > MAX:
        im = im.resize((MAX, MAX * im.size[1] // im.size[0]), Image.LANCZOS)
    buf = io.BytesIO()
    if has_alpha:
        im.convert("RGBA").save(buf, "PNG", optimize=True)
        img["mimeType"] = "image/png"
        alpha_images.add(i)
    else:
        im.convert("RGB").save(buf, "JPEG", quality=QUALITY)
        img["mimeType"] = "image/jpeg"
    print(f"image {i} {img.get('name')}: {'PNG+alpha' if has_alpha else 'JPEG'} {im.size} {len(views[img['bufferView']])} -> {buf.tell()} bytes")
    views[img["bufferView"]] = buf.getvalue()

for m in j.get("materials", []):
    tex = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
    if tex is not None and j["textures"][tex["index"]]["source"] in alpha_images:
        m["alphaMode"] = "MASK"
        m["alphaCutoff"] = 0.5
        m["doubleSided"] = True
        print("material", m.get("name"), "-> alphaMode MASK")

out = bytearray()
for i, v in enumerate(views):
    while len(out) % 4:
        out.append(0)
    j["bufferViews"][i]["byteOffset"] = len(out)
    j["bufferViews"][i]["byteLength"] = len(v)
    out += v
while len(out) % 4:
    out.append(0)
j["buffers"][0]["byteLength"] = len(out)
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(out)
glb = struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(out), 0x004E4942) + bytes(out)
open(path, "wb").write(glb)
print("written", path, total, "bytes")
