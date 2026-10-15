# Verkleinert PNG-Texturen mit Transparenz in einem GLB auf eine 256-Farben-Palette (JPEG-Bilder bleiben unberührt):
#   python3 glb_png_palette.py <datei.glb>
# Nötig, damit das Spiel als eine Datei unter 16 MB bleibt (Kiras Stoff-Textur war 1,2 MB groß).
import io
import json
import struct
import sys

from PIL import Image

path = sys.argv[1]
d = open(path, "rb").read()
jlen = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20 : 20 + jlen])
b0 = 20 + jlen
blen = struct.unpack("<I", d[b0 : b0 + 4])[0]
binc = d[b0 + 8 : b0 + 8 + blen]
views = [bytes(binc[v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]]) for v in j["bufferViews"]]
for img in j.get("images", []):
    if img.get("mimeType") != "image/png" or "bufferView" not in img:
        continue
    im = Image.open(io.BytesIO(views[img["bufferView"]])).convert("RGBA")
    buf = io.BytesIO()
    im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(buf, "PNG", optimize=True)
    print(f"{img.get('name')}: {len(views[img['bufferView']])} -> {buf.tell()} bytes")
    views[img["bufferView"]] = buf.getvalue()
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
open(path, "wb").write(struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(out), 0x004E4942) + bytes(out))
print("written", path, total, "bytes")
