# Basisboden (src/assets/base_floor.jpg)

Aus demselben LoL-Kartenbild wie die Dschungel-Wände (nicht im Repo), mit der Homographie aus `assets-src/jungle/rectify.py`:

```bash
python3 floor.py karte.webp H.npy 300 ../../src/assets/base_floor.jpg
```

Ausschnitt: Spielkoordinaten x 0..128, z 172..300 (MAP 300), 1024². Eingemalte Türme, Inhibitoren, Nexus,
Fackelsäulen und Statuen sind herausretuschiert (dort stehen die 3D-Modelle bzw. die Basismauer). Die rote Basis
nutzt dasselbe Bild gespiegelt (`terrain.ts`). Die Gebäude in `mapdata.ts` stehen an den LoL-Koordinaten, passend dazu.
