# Kluft der Legenden

Ein spielbares 5-gegen-5-MOBA im Stil von League of Legends / Wild Rift, direkt im Browser (Handy und PC).
Gebaut mit TypeScript, Vite und three.js.

## Starten

```bash
npm install
npm run dev      # Entwicklung, http://localhost:5173
npm run build    # fertige Dateien in dist/
npm run preview  # dist/ lokal ansehen
```

Am Handy quer halten. Über „Zum Home-Bildschirm“ läuft es im Vollbild.

## Spiel

- **Karte** nach dem Vorbild von Summoner's Rift: Top-, Mid- und Bot-Lane, diagonaler Fluss,
  Jungle mit Pfaden und Lichtungen, Baron- und Drachengrube, blaue Basis unten links, rote oben rechts.
- **Gebäude** je Team: 3 Türme pro Lane (außen, innen, Inhibitor-Turm), 3 Inhibitoren,
  2 Nexus-Türme und der Nexus. Gebäude sind geschützt, bis die davor liegenden fallen.
- **Minions** kommen alle 26 Sekunden auf jeder Lane (Nahkampf, Fernkampf, Belagerung,
  Super-Minions nach zerstörtem Inhibitor).
- **Jungle**: Blauer und Roter Wächter (Buffs), Kröte, Wölfe, Raptoren, Golems, Flusskrabben,
  Drache (Team-Schaden) und Baron (Hand des Barons).
- **5 Champions**: Varok (Kämpfer), Lyra (Schützin), Ignis (Magier), Kira (Assassinin), Thorne (Tank),
  je 4 Fähigkeiten, Stufen 1 bis 15, Gold, Items, Rückruf, Blitz, Heilen/Zerschmettern.
- **Bots** spielen deine 4 Mitspieler und das gegnerische Team (Leicht / Normal / Schwer).
- **Nebel des Krieges** und Büsche, in denen man unsichtbar ist.

## Steuerung

**Handy (wie Wild Rift):** links ziehen zum Laufen, rechts der große Knopf greift an
(kleine Knöpfe: Minion bzw. Turm). Fähigkeit antippen = automatisch zielen, ziehen = selbst zielen,
zum ✕ ziehen = abbrechen. „+“ verbessert eine Fähigkeit.

**PC:** Rechtsklick laufen/angreifen, Q W E R zaubern (Richtung Maus), Strg+Q/W/E/R verbessern,
D Blitz, F Heilen, B Rückruf, P Laden, Pfeiltasten laufen, Mausrad zoomen, Esc Pause.

## Code

- `src/game/mapdata.ts` – Layout: Lanes, Gebäude, Camps, Pfade, Büsche
- `src/game/navgrid.ts` – Begehbarkeit, Höhen, Wegfindung (A*)
- `src/game/world.ts` – Spiellogik: Kampf, Minions, Türme, Jungle, Gold, XP, Sieg
- `src/game/champions.ts`, `items.ts` – Champions mit Fähigkeiten, Items
- `src/game/ai.ts` – Bot-Verhalten (Lane, Jungle, Ziele, Rückzug)
- `src/game/terrain.ts`, `models.ts`, `view.ts`, `fx.ts`, `fog.ts` – 3D-Darstellung
- `src/game/hud.ts`, `input.ts` – Oberfläche und Steuerung

Testhilfen: `npm run sim` simuliert ein ganzes Bot-Match ohne Grafik,
`npm run map` zeichnet das Kartenraster als PNG. Im Browser: `?quick=1` startet sofort,
`?autoplay=1` lässt einen Bot deinen Champion spielen, `?warp=300` spult 5 Minuten vor, `?top=1` zeigt die Karte von oben.

## Umgebung

Der Boden ist ein glattes Höhenfeld (zwei Punkte pro Einheit). Die Waldkanten folgen einem geglätteten
Abstandsfeld statt dem Zellraster der Wegfindung, dadurch gibt es keine Treppenstufen an Felswänden und
Flussufern. Steile Hänge bekommen automatisch eine Felstextur, oben auf den Wänden wächst Moos.
Bäume (Nadel- und Laubbäume), Büsche aus hohem Gras und Felsbrocken sind Instanzen mit gemalten
Alpha-Texturen und wiegen sich leicht im Wind. Die Texturen erzeugt ein Skript:

```bash
python3 assets-src/env_textures.py src/assets   # rock.jpg, dirt.jpg, grass_field.jpg, pine.png, leaves.png, tallgrass.png
```

## 3D-Modell der Türme

Die Wächterstatue der Türme ist ein echtes 3D-Modell (`src/assets/guardian.glb`, ca. 23.000 Dreiecke,
mit Farb-, Normal- und Rauheit/Metall-Textur). Vorlage für Form und Farben ist das Konzeptbild
`assets-src/guardian_reference.jpg`; das Bild selbst wird im Spiel nicht verwendet. Die Statue wird mit Blender erzeugt:

```bash
pip install bpy            # Blender als Python-Modul (Python 3.13)
python assets-src/guardian.py src/assets
python3 -c "from PIL import Image; Image.open('src/assets/guardian_albedo_blue.png').convert('RGB').save('src/assets/guardian_blue.jpg', quality=86)"
```

Das Skript baut den Körper aus Gelenkketten (Skin-Modifier) in Standpose, legt die Rüstungsplatten
eng an die Körperform an (Brustpanzer, Schulterlamellen, Plattenrock, Bein- und Armschienen, Topfhelm mit
T-Visier), drapiert den Umhang per Stoffsimulation über Körper und Sockel und setzt den Stab mit Klauenkrone
und Kristall in die rechte Hand. Danach reduziert es das High-Poly-Modell,
wickelt die UVs ab und backt die Materialien vom High-Poly- auf das Low-Poly-Modell.
