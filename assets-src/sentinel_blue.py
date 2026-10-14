# Blaue Team-Textur aus der Farbtextur im GLB: rote Flächen (Umhang, Wappenrock) werden blau.
#   python3 sentinel_blue.py <guardian.glb> <guardian_blue.jpg>
# Gleiche Regel wie das Umfärben im Spiel (models.ts, recolorRedToBlue).
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
d = open(src, "rb").read()
n = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20 : 20 + n])
bin_off = 20 + n + 8
tex = j["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
img = j["images"][j["textures"][tex]["source"]]
bv = j["bufferViews"][img["bufferView"]]
data = d[bin_off + bv.get("byteOffset", 0) : bin_off + bv.get("byteOffset", 0) + bv["byteLength"]]
a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
k = np.clip((r - np.maximum(g, b) * 1.3) / (r * 0.3 + 1), 0, 1)[..., None]
blue = np.stack([b, np.minimum(255, g * 1.9), r * 0.93], -1)
o = a + (blue - a) * k
Image.fromarray(np.clip(o, 0, 255).astype(np.uint8)).save(out, quality=86)
print("ok", a.shape)
