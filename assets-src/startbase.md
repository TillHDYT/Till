# Startbasis (src/assets/startbase.glb)

Quelle: Meshy-Modell `Start.Basis.1.0.glb` (282 MB, 7,6 Mio. Dreiecke, liegt als Anhang im Release-Entwurf auf GitHub).
Für das Spiel auf 59 000 Dreiecke und 3,8 MB gebracht (muss unter 4 MB bleiben, sonst bettet `npm run single` sie nicht ein):

```bash
# 1. Geometrie vereinfachen (gltfpack aus github.com/zeux/meshoptimizer, Release v0.22)
gltfpack -i Start.Basis.1.0.glb -o low60.glb -si 0.008 -sa -noq
# 2. Neue UV-Karte und Textur vom Original auf das vereinfachte Modell backen (2048er Atlas)
python3 startbase/bake.py Start.Basis.1.0.glb low60.glb sb60.glb 2048
# 3. Ausrichten: Boden y=0, Mitte im Ursprung, offene Seite mit Treppe nach +z, Radius 9.6
python3 startbase/orient.py sb60.glb sb60_o.glb 9.6
# 4. Vertexdaten quantisieren (KHR_mesh_quantization, lädt three.js ohne Zusatz)
gltfpack -i sb60_o.glb -o startbase.glb -kn -km
```

Im Spiel (`models.ts`, `loadStartBase`) wird das Modell um 0.96 abgesenkt, damit die runde Plattform
(Oberkante im Modell im Mittel bei y = 1.38) so hoch liegt wie die frühere gebaute Basis. Das rote Team bekommt eine
umgefärbte Textur (blaue Banner, Runen, Kristalle und der Stern in der Mitte werden rot). Klappt das Laden nicht, bleibt die gebaute Ersatz-Basis.
