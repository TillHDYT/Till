# Grundriss der Startbasis für die Wegfindung: wo das Modell hohe Teile hat (Ruinen, Säulen, Statue,
# Feuerschalen), darf niemand durchlaufen. Plattform und Stufen bleiben begehbar.
#   python3 footprint.py ../../src/assets/startbase.glb ../../src/game/startbaseFootprint.ts
# Ausgabe in Modellkoordinaten (vorne = +z, wie in buildFountainModel), Raster 0.5.
import json
import struct
import sys

import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
RES = 0.5
HALF = 10.5  # Raster von -HALF bis +HALF
SOLID_Y = 2.0  # Modellhöhe; Plattform liegt bei 1.35-1.5, alles darüber ist ein Hindernis

d = open(SRC, "rb").read()
jl = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20 : 20 + jl])
off = 20 + jl + 8
pr = j["meshes"][0]["primitives"][0]


def acc(i, n):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    ct = {5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5122: np.int16, 5126: np.float32}[a["componentType"]]
    stride = bv.get("byteStride", np.dtype(ct).itemsize * n)
    raw = d[off + bv.get("byteOffset", 0) + a.get("byteOffset", 0) :]
    return np.ndarray((a["count"], n), dtype=ct, buffer=raw, strides=(stride, np.dtype(ct).itemsize)).astype(np.float64)


P = acc(pr["attributes"]["POSITION"], 3)
node = next(n for n in j["nodes"] if n.get("mesh") == 0)
P = P * np.array(node.get("scale", [1, 1, 1])) + np.array(node.get("translation", [0, 0, 0]))
I = acc(pr["indices"], 1).astype(np.int64).reshape(-1, 3)
# zusätzlich Punkte auf den Dreiecken, damit auch große Wandflächen ohne viele Eckpunkte erfasst werden
A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
pts = [P]
for u, v in ((1 / 3, 1 / 3), (0.6, 0.2), (0.2, 0.6), (0.2, 0.2)):
    pts.append(A + (B - A) * u + (C - A) * v)
Q = np.concatenate(pts)

N = int(round(2 * HALF / RES))
hmax = np.full((N, N), -1.0)
ix = np.floor((Q[:, 0] + HALF) / RES).astype(int)
iz = np.floor((Q[:, 2] + HALF) / RES).astype(int)
ok = (ix >= 0) & (iz >= 0) & (ix < N) & (iz < N)
np.maximum.at(hmax, (iz[ok], ix[ok]), Q[ok, 1])
solid = hmax > SOLID_Y

rows = ["".join("1" if solid[z, x] else "0" for x in range(N)) for z in range(N)]
with open(OUT, "w") as fh:
    fh.write("// Automatisch erzeugt von assets-src/startbase/footprint.py — nicht von Hand ändern.\n")
    fh.write("// Hindernisse der Startbasis (Ruinen, Säulen, Statue) in Modellkoordinaten, vorne = +z.\n")
    fh.write(f"export const START_BASE_FOOTPRINT = {{\n  res: {RES},\n  half: {HALF},\n  rows: [\n")
    for r in rows:
        fh.write(f'    "{r}",\n')
    fh.write("  ],\n};\n")
print(f"{N}x{N} Raster, {solid.sum()} von {N * N} Zellen sind Hindernis ({solid.sum() * RES * RES:.1f} m²)")
for z in range(0, N, 1):
    print("".join("#" if solid[z, x] else ("." if hmax[z, x] > 0 else " ") for x in range(N)))
