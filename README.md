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
Alpha-Texturen und wiegen sich leicht im Wind. Jungleboden (`grass.jpg`) und Lanes (`path.jpg`) nutzen die
vorgegebenen Texturen, die übrigen erzeugt ein Skript:

```bash
python3 assets-src/env_textures.py src/assets   # rock.jpg, pine.png, leaves.png, tallgrass.png
```

## 3D-Modell der Türme

Die Türme sind das Modell „Crimson Sentinel Statue“ (Meshy AI, GitHub-Release `turm-modell`, 43 MB,
1,25 Mio. Dreiecke). `assets-src/sentinel.py` bereitet es für das Spiel auf: Sockelboden auf Höhe 0,
Sockelradius 2,9 wie zuvor, roter Kristall als eigenes Teil (`Staff` → `Crystal`, leuchtet im Spiel in
Teamfarbe), Statue auf ca. 36.000 Dreiecke reduziert, Texturen auf 2K/1K verkleinert (Ergebnis 1,9 MB).
`assets-src/sentinel_blue.py` erzeugt daraus die blaue Team-Textur.

```bash
python assets-src/sentinel.py Crimson.Sentinel.Statue.glb build/turm     # Blender als Python-Modul (bpy)
cp build/turm/guardian.glb src/assets/
python3 assets-src/sentinel_blue.py src/assets/guardian.glb src/assets/guardian_blue.jpg
```

Das frühere, per Skript gebaute Wächtermodell (`assets-src/guardian.py`) bleibt als Quelle erhalten.

## Champion-Modelle (Skelett + Animation)

Champions können statt der gebauten Figur ein Mixamo-Modell mit Skelett bekommen (`CHAMP_MODELS` in
`src/game/models.ts`). Bisher: Kira (Assassinin) mit `src/assets/models/Assassine.glb`. Das Modell wird auf die
Höhe der gebauten Figur skaliert (passt zu den Türmen), dreht sich in Laufrichtung und spielt beim Laufen die
Animation `Run` in der Schleife (Tempo folgt der Laufgeschwindigkeit). Beim Anhalten gleitet die Animation in die
nächste ruhige Haltung (Füße beieinander) und bleibt stehen. Fehlt einem Modell die UV-Abwicklung, können die
eingebetteten Texturen nicht aufgelegt werden; dann bekommt es Farben aus dem `look` des Champions.

Das GLB entsteht aus der Mixamo-FBX (`assets-src/Assassine_Running.fbx`). Ein Umweg über Assimp verliert die
UV-Koordinaten, deshalb der Weg über Blender. Die Vorwärtsbewegung der Hüfte wird dabei herausgerechnet
(Laufen auf der Stelle), die Texturen werden auf 1024 px verkleinert:

```bash
python assets-src/champion_fbx.py assets-src/Assassine_Running.fbx src/assets/models/Assassine.glb   # Blender (bpy)
python3 assets-src/glb_textures.py src/assets/models/Assassine.glb 1024
```

## 3D-Modell des Nexus

Der Nexus ist ein Tripo-Modell (roter Kristall auf verziertem Sockel). `assets-src/nexus.py` setzt den
Sockelboden auf Höhe 0, skaliert auf den bisherigen Außenradius 4,8, trennt den Kristall (die fast ganz roten
Mesh-Inseln in der Mitte) als eigenes Teil `Crystal` ab, glättet die Normalen und speichert die Textur als
2K-JPEG (690 KB). Im Spiel dreht sich der Kristall und leuchtet in Teamfarbe.

```bash
python assets-src/nexus.py nexus_tripo.glb build/nexus && cp build/nexus/nexus.glb src/assets/
```

Beide Modelle werden ohne Netzwerkzugriff geladen (eingebettete Datei selbst dekodiert, Texturen als
data:-Bilder), damit sie auch in abgeschotteten Vorschauen wie der Claude-App erscheinen.
