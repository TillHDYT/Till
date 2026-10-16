# Neue UV-Karte für das vereinfachte Modell mit xatlas (pip install xatlas==0.0.11):
#   python3 xuv.py <vereinfacht.glb> <ausgabe.glb> [atlas_px=2048] [rand_px=2] [max_cost=2.0]
# xatlas schneidet Charts und packt sie dicht (ca. 80 % Füllung, Texeldichte fast wie im Original). Der etwas
# rechteckige Atlas wird auf das Quadrat gestreckt. Normalen sind Platzhalter, bake.py rechnet sie neu.
import sys
import time

import numpy as np
import xatlas

from glbio import Glb, write_glb

SRC, OUT = sys.argv[1], sys.argv[2]
PX = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
PAD = int(sys.argv[4]) if len(sys.argv) > 4 else 2
MC = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
P, _, I, _ = Glb(SRC).prim()
q = np.round(P / 1e-6).astype(np.int64)
_, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
V = P[first].astype(np.float32)
F = inv.reshape(-1)[I]
F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])].astype(np.uint32)
t = time.time()
at = xatlas.Atlas()
at.add_mesh(V, F)
co = xatlas.ChartOptions()
co.max_cost = MC
po = xatlas.PackOptions()
po.resolution = PX
po.padding = PAD
po.bilinear = True
po.bruteForce = True
po.rotate_charts = True
at.generate(co, po)
assert at.atlas_count == 1, "Charts passen nicht in einen Atlas"
vm, idx, uv = at[0]
print(f"{at.chart_count} Charts, Füllung {at.utilization:.0%}, Atlas {at.width}x{at.height}, {time.time() - t:.1f} s")
nrm = np.zeros((len(vm), 3), np.float32)
nrm[:, 1] = 1
write_glb(OUT, V[vm], nrm, uv.astype(np.float32), idx.astype(np.uint32), [], {"name": "m"})
