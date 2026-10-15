# Richtet die gebackene Basis fuers Spiel aus: Boden y=0, Mitte im Ursprung, offene Seite nach +z, Radius R.
#   python3 orient.py in.glb out.glb [radius]
import sys, json, struct, math
import numpy as np
from glbio import Glb
src, dst = sys.argv[1], sys.argv[2]
R = float(sys.argv[3]) if len(sys.argv) > 3 else 9.6
g = Glb(src); j = g.j; b = bytearray(g.b)
p = j['meshes'][0]['primitives'][0]
ia, ina = p['attributes']['POSITION'], p['attributes']['NORMAL']
P = g.acc(ia).astype(np.float64); N = g.acc(ina).astype(np.float64)
y0 = P[:, 1].min(); H = P[:, 1].max() - y0
low = P[P[:, 1] < y0 + 0.15 * H]
cx, cz = (low[:, 0].min() + low[:, 0].max()) / 2, (low[:, 2].min() + low[:, 2].max()) / 2
r0 = np.hypot(low[:, 0] - cx, low[:, 2] - cz).max()
tall = P[P[:, 1] > y0 + 0.45 * H]
bx, bz = tall[:, 0].mean() - cx, tall[:, 2].mean() - cz
ang = math.atan2(bx, bz)          # Richtung der Ruinen (hinten)
rot = math.pi - ang               # hinten soll nach -z zeigen
c, s = math.cos(rot), math.sin(rot)
k = R / r0
X = (P[:, 0] - cx) * k; Z = (P[:, 2] - cz) * k
out = np.stack([X * c + Z * s, (P[:, 1] - y0) * k, -X * s + Z * c], 1)
NO = np.stack([N[:, 0] * c + N[:, 2] * s, N[:, 1], -N[:, 0] * s + N[:, 2] * c], 1)
for ai, arr in ((ia, out), (ina, NO)):
    a = j['accessors'][ai]; bv = j['bufferViews'][a['bufferView']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    b[o:o + arr.size * 4] = arr.astype(np.float32).tobytes()
    if 'min' in a: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
with open(dst, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(b))); f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
    f.write(struct.pack('<I4s', len(b), b'BIN\x00')); f.write(bytes(b))
print(f"radius {r0:.3f} -> {R}, scale {k:.2f}, hoehe {H*k:.2f}, ruinen-richtung {math.degrees(ang):.0f} grad -> -z")
