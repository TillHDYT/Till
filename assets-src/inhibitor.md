# Inhibitor (src/assets/inhibitor.glb)

Quelle: `Inhibitor 1.0.zip` im Wurzelverzeichnis (Meshy-Modell `Inhibitor 1.0.glb`, 33 MB, 902 000 Dreiecke,
handbemalte 2K-Textur; Normal-Map praktisch flach, kein Metall). Blaue Kristallsäule mit Schiefer-/Messingkäfig in
einem offenen Steinring, vorne Geröllhügel und Kettenklammern.

Für das Spiel auf 35 600 Dreiecke und 2,7 MB gebracht. Die Schritte ergeben genau die Datei im Repo:

```bash
cd assets-src/inhibitor
unzip ../../"Inhibitor 1.0.zip" "Inhibitor 1.0.glb"
# 1. Eckpunkte nach Position verschweißen, nur Positionen behalten (keine UV-Nähte, die das Vereinfachen bremsen)
python3 weld.py "Inhibitor 1.0.glb" welded.glb
# 2. Geometrie vereinfachen (gltfpack aus github.com/zeux/meshoptimizer v0.22, z. B. npm install gltfpack@0.22.0)
gltfpack -i welded.glb -o low.glb -si 0.04 -noq                  # -> 36 052 Dreiecke
# 3. neue UV-Karte mit xatlas (1416 Charts, 81 % Füllung, fast die Texeldichte des Originals)
python3 xuv.py low.glb low_uv.glb 2048
# 4. Farbe und Rauheit vom Original auf das vereinfachte Modell backen (Normalen: 40-Grad-Kanten)
python3 bake.py "Inhibitor 1.0.glb" low_uv.glb baked.glb --atlas 2048 --jpg-quality 92 --jpg-subsampling 0 --mr-px 1024
# 5. in Ring und Kristall teilen, verstecktes Innenteil entfernen, Maßstab 4, Boden y = 0, vorne = +z
python3 split_orient.py baked.glb ../../src/assets/inhibitor.glb 4.0
```

Abhängigkeiten: Python 3 mit `numpy`, `Pillow`, `scipy` (bake.py) und `xatlas==0.0.11` (xuv.py).
`bake.py` ist eine Variante von `startbase/bake.py`, die die UV-Karte aus `low_uv.glb` übernimmt und zusätzlich die
Rauheit (G-Kanal der metallicRoughness-Textur) mitbackt. Nicht quantisiert und nicht komprimiert, weil das Spiel
die Meshes aus den nackten Geometrien baut.

Ergebnis (Spieleinheiten):

| | |
|---|---|
| `Inhibitor` (Ring) | 20 300 Dreiecke, Radius außen 3,3–4,0 (vorne bis 4,0, seitlich 3,8), Oberkante vorne 3,17, seitlich 2,8, hinten 2,25 |
| `Crystal` (Säule samt Käfig) | 15 282 Dreiecke, Drehpunkt (−0,05; 2,72; −0,06), Spitze 5,57, Radius bis 1,67 |
| Ring innen | Radius 1,37–1,56 (Median), Säule dreht sich frei darin |
| Texturen | Farbe 2048² JPEG (1 MB), Rauheit 1024² JPEG (0,13 MB) |

Im Spiel (`models.ts`, `loadInhibitor`): Für das rote Team färbt `recolorInhibitorRed` die Textur beim Laden um
(Kristall rot, blaustichiger Schiefer warmgrau, Messing und Stein bleiben). Die Säule dreht sich und glimmt über die
Textur in Teamfarbe. Zerstört bleibt ein dunkler Stumpf mit Splittern stehen. Klappt das Laden nicht, bleibt der
gebaute Ersatz-Inhibitor.
