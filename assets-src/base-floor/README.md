# Basisboden (src/assets/base_floor.jpg)

Aus demselben LoL-Kartenbild wie die Dschungel-Wände (nicht im Repo), mit der Homographie aus `assets-src/jungle/rectify.py`:

```bash
python3 floor.py karte.webp H.npy 300 ../../src/assets/base_floor.jpg
```

Ausschnitt: Spielkoordinaten x 0..128, z 172..300 (MAP 300), 1024². Eingemalte Türme, Inhibitoren, Nexus,
Fackelsäulen und Statuen sind herausretuschiert (dort stehen die 3D-Modelle bzw. die Basismauer). Die rote Basis
nutzt dasselbe Bild gespiegelt (`terrain.ts`). Die Gebäude in `mapdata.ts` stehen an den LoL-Koordinaten, passend dazu.

## Scharfe Fassung

Aus einer senkrechten Draufsicht der blauen Basis (853×800, nicht im Repo). `fitbase.py` fittet aus den neun
Gebäuden im Bild eine affine Abbildung LoL-Koordinaten -> Bildpixel (`Mbase.npy`), dann:

```bash
python3 floor_hi.py basis.png Mbase.npy base_floor_grob.jpg 300 ../../src/assets/base_floor.jpg
```

Wo die Draufsicht nicht reicht, bleibt der grobe Boden aus `floor.py`. Das Skript gibt die Gebäudepositionen aus
dem Bild als LoL-Koordinaten aus; so stehen sie in `mapdata.ts`.
