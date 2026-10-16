# Dschungel-Wände (src/game/jungleMask.ts)

Vorlage ist ein Übersichtsbild der Kluft (leicht schräg aufgenommen, nicht im Repo). Daraus entsteht:

```bash
# 1. Bild entzerren: Homographie aus 18 Turmpositionen (LoL-Koordinaten -> Bildpixel), Ausgabe 1024² Draufsicht
python3 rectify.py karte.webp rect.png
# 2. Wandinseln erkennen (starke Bildstruktur = Bäume/Felsen), Camp-Nischen freischneiden, Flussbecken,
#    blaue Hälfte auf Rot spiegeln; 300 = MAP (200 * MAP_SCALE)
python3 mask.py rect.png 300 ../../src/game/jungleMask.ts vorschau.png
```

Die Camp-Koordinaten in `mask.py` (LoL-Koordinaten) müssen zu `BLUE_CAMPS` in `mapdata.ts` passen.
Ändert sich `MAP_SCALE`, die Maske mit dem neuen `MAP` neu erzeugen.
