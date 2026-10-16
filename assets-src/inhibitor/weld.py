# Verschweißt die Eckpunkte des Original-Modells nach Position und behält nur die Positionen:
#   python3 weld.py <eingabe.glb> <ausgabe.glb>
# Ohne UV- und Normalen-Nähte darf der Vereinfacher (gltfpack -si) die Form frei reduzieren; die Textur wird danach
# ohnehin neu gebacken (bake.py).
import json
import struct
import sys

import numpy as np

from glbio import Glb

g = Glb(sys.argv[1])
P, _, I, _ = g.prim()
P = P.astype(np.float32)
q = np.round(P / 1e-6).astype(np.int64)
_, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
V = P[first]
F = inv.reshape(-1)[I]
F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])].astype(np.uint32)
print("verschweißt", len(P), "->", len(V), "Eckpunkte,", len(F), "Dreiecke")
pb, ib = V.tobytes(), F.tobytes()
buf = pb + ib
J = {
    "asset": {"version": "2.0"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": len(V), "type": "VEC3", "min": V.min(0).tolist(), "max": V.max(0).tolist()},
        {"bufferView": 1, "componentType": 5125, "count": F.size, "type": "SCALAR"},
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pb), "target": 34962},
        {"buffer": 0, "byteOffset": len(pb), "byteLength": len(ib), "target": 34963},
    ],
    "buffers": [{"byteLength": len(buf)}],
}
js = json.dumps(J).encode()
js += b" " * ((4 - len(js) % 4) % 4)
with open(sys.argv[2], "wb") as f:
    f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(buf)))
    f.write(struct.pack("<I4s", len(js), b"JSON") + js)
    f.write(struct.pack("<I4s", len(buf), b"BIN\x00") + buf)
