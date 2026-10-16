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
`src/game/models.ts`). Bisher: Kira (Assassinin) mit `src/assets/models/Assassine.glb` und Thorne (Tank) mit
`src/assets/models/Tank.glb`. Das Modell wird auf die
Höhe der gebauten Figur skaliert (passt zu den Türmen) und dreht sich in Laufrichtung. Die Animationen
(`CHAMP_ANIMS`, alle mit demselben Skelett):

| Zustand | Datei | Quelle |
|---|---|---|
| Laufen (Schleife, Tempo folgt der Laufgeschwindigkeit) | im Modell, Clip `Run` | `assets-src/Assassine_Running.fbx` |
| Stehen (Schleife) | `Assassine_Idle.glb` | `Standing Idle.fbx` |
| Schlag (Standardangriff) | `Assassine_Attack.glb` | `Boxing.fbx` |
| Tod | `Assassine_Death.glb` | `Standing React Death Right.fbx` |
| Tank: Laufen / Stehen / Schlag / Tod | `Tank.glb`, `Tank_Idle.glb`, `Tank_Attack.glb`, `Tank_Death.glb` | `Tank Lauf/Stehend/Schlag/Todes Animation.fbx` |

Stehen und Laufen werden weich überblendet; während eines Schlags liegt die Schlaganimation darüber und blendet
danach wieder ins Stehen aus. Fehlt eine dieser Dateien, steht in der Browser-Konsole genau welche, und es wird
nichts dazuerfunden. Fehlt einem Modell die UV-Abwicklung, können die eingebetteten Texturen nicht aufgelegt
werden; dann bekommt es Farben aus dem `look` des Champions.

**Schaden zum Treffer der Schlaganimation:** Kira hat in `src/game/champions.ts` den Eintrag
`swing: { clip: 50 / 30, hit: 15.5 / 30 }` (Länge von Boxing.fbx und Zeitpunkt, an dem die rechte Faust am
weitesten vorne ist; gemessen mit `champion_anim.py --treffer`). Ablauf in `World` (`src/game/world.ts`):
`basicAttack` startet den Schlag (Ausholen, Kira bleibt stehen, noch kein Schaden), `updateSwing` löst am
Trefferzeitpunkt genau einmal die Trefferprüfung aus (Ziel noch angreifbar, höchstens `SWING_REACH` außerhalb der
Reichweite, vor Kira) und gibt den Schaden über den bisherigen Weg (`championHit` -> `damage`), danach folgt die
Erholung bis zum Ende des Clips. Die Animation bekommt den Fortschritt des Schlags (`anim.swing`, 0..1) und setzt
daraus die Zeit im Clip, darum sitzt der sichtbare Treffer auch bei höherem Angriffstempo auf dem Schaden
(Abspieltempo `swingRate`). Soll der Treffer früher oder später kommen: `hit` ändern.
Prüfen ohne Grafik: `npm run swing-test`.

Das GLB entsteht aus der Mixamo-FBX (`assets-src/Assassine_Running.fbx`). Ein Umweg über Assimp verliert die
UV-Koordinaten, deshalb der Weg über Blender. Die Vorwärtsbewegung der Hüfte wird dabei herausgerechnet
(Laufen auf der Stelle), die Texturen werden auf 1024 px verkleinert:

```bash
python assets-src/champion_fbx.py assets-src/Assassine_Running.fbx src/assets/models/Assassine.glb   # Blender (bpy)
python3 assets-src/glb_textures.py src/assets/models/Assassine.glb 1024
# weitere Animationen (gleiches Skelett) als kleines GLB nur mit Skelett und Animation:
python assets-src/champion_anim.py "Standing React Death Right.fbx" src/assets/models/Assassine_Death.glb Death
python assets-src/champion_anim.py "Standing Idle.fbx" src/assets/models/Assassine_Idle.glb Idle
python assets-src/champion_anim.py Boxing.fbx src/assets/models/Assassine_Attack.glb Attack --treffer   # misst den Treffer
# Tank genauso:
python assets-src/champion_fbx.py "Tank Lauf Animation.fbx" src/assets/models/Tank.glb && python3 assets-src/glb_textures.py src/assets/models/Tank.glb 1024
python assets-src/champion_anim.py "Tank Stehend Animation.fbx" src/assets/models/Tank_Idle.glb Idle
python assets-src/champion_anim.py "Tank Schlag Animation.fbx" src/assets/models/Tank_Attack.glb Attack --treffer
python assets-src/champion_anim.py "Tank Todes Animation.fbx" src/assets/models/Tank_Death.glb Death
```

## Wegfindung

Wände, die nur 1-3 Zellen dünn sind, öffnet `navgrid.ts` automatisch (sie wären im Gelände zu schmal für eine
sichtbare Felskante, also unsichtbare Wände). Die Startbasis sperrt die Zellen unter Ruinen, Säulen und Statue;
der Grundriss kommt aus dem Modell: `python3 assets-src/startbase/footprint.py src/assets/startbase.glb src/game/startbaseFootprint.ts`.

## 3D-Modell des Nexus

Der Nexus ist ein Tripo-Modell (roter Kristall auf verziertem Sockel). `assets-src/nexus.py` setzt den
Sockelboden auf Höhe 0, skaliert auf den bisherigen Außenradius 4,8, trennt den Kristall (die fast ganz roten
Mesh-Inseln in der Mitte) als eigenes Teil `Crystal` ab, glättet die Normalen und speichert die Textur als
2K-JPEG (690 KB). Im Spiel dreht sich der Kristall und leuchtet in Teamfarbe.

```bash
python assets-src/nexus.py nexus_tripo.glb build/nexus && cp build/nexus/nexus.glb src/assets/
```

## Kiras Modell mit Schwertern

Kira ist das Mixamo-Modell (`Assassine.glb`). Die Schwerter in ihren Händen stammen aus dem Meshy-Modell mit den
Schwertern in der Hand: dort sind sie mit den Händen verschmolzen, `assets-src/rigid_swords.py` hat Faust und Klinge
starr an den Handknochen gehängt, und alles ab der Faust (Parierstange und Klinge) wurde im Raum des Handknochens
herausgeschnitten (`src/assets/kira_swords.glb`). Im Spiel hängen sie an Kiras Handknochen (`CHAMP_PROPS`) und biegen
sich nie. Die Stiche kommen vom Meshy-Modell (gleiches Mixamo-Skelett, nur der Stich, `--von`/`--bis`), der zweite ist
derselbe Stich gespiegelt; die Finger halten die Faust aus der Boxanimation. Fremde Animationen bekommen die Hüft- und
Fußhöhe dieses Modells.

## 3D-Modell der Inhibitoren

Die Inhibitoren sind das Modell aus `Inhibitor 1.0.zip` (Meshy-Stil, handbemalt, 902.000 Dreiecke): blaue
Kristallsäule mit Schiefer-/Messingkäfig in einem offenen Steinring, vorne Geröll und Kettenklammern.
Aufbereitet (Rezept in `assets-src/inhibitor.md`) auf ca. 36.000 Dreiecke mit neu gebackener 2K-Textur
(`src/assets/inhibitor.glb`): Maßstab 4, Ringboden auf Höhe 0, vorne = +z (zeigt zur Kartenmitte). Zwei Teile:
`Inhibitor` (Ring, Radius 3,3–4,0) und `Crystal` (ganze Säule samt Käfig, Höhe bis 5,6); ein im Kristall
verstecktes Innenteil ist entfernt.

Im Spiel schwebt und dreht sich die Säule und glimmt in Teamfarbe, im Ring leuchtet ein Becken. Für das rote
Team färbt `recolorInhibitorRed` die Textur beim Laden um (Kristall rot, blaustichiger Schiefer warmgrau,
Messing und Stein bleiben). Zerstört bleibt ein erloschener Stumpf mit Splittern im Ring stehen. Der
Kollisionsradius ist 3,0, die Feuerschalen stehen weiter außen. Lädt das GLB nicht, kommt der gebaute
Ersatz-Inhibitor (`buildInhibitor`).

Alle Modelle werden ohne Netzwerkzugriff geladen (eingebettete Datei selbst dekodiert, Texturen als
data:-Bilder), damit sie auch in abgeschotteten Vorschauen wie der Claude-App erscheinen.

## Kamera und Steuerung (PC)

- **Mausrad:** stufenloser Zoom von weit draußen (1,35) bis ganz nah an den eigenen Champion (etwa 1,8 Champion-Höhen
  Abstand). Ab Zoom 0,75 wird der Blick allmählich flacher und auf Brusthöhe gerichtet; darüber bleibt die Ansicht wie
  bisher. Die Kamera bleibt über dem Gelände und schaut über Felskanten; Bäume und Gebäude zwischen Kamera und Champion
  werden in der Nahansicht gerastert ausgeblendet (`src/game/camcut.ts`, Werte in `Game.updateCamera`).
- **Rechte Maustaste halten:** der Champion folgt laufend dem Mauszeiger; nach dem Loslassen läuft er zum zuletzt
  gesetzten Ziel. Auf einen Gegner gedrückt = angreifen (wegziehen = wieder laufen).
- **Wegfindung:** Minions und Champions gehen um Türme, Inhibitoren und Nexus herum (`World.steerAround`), statt
  frontal dagegenzulaufen; kommen sie eine Sekunde kaum voran, wechseln sie die Seite bzw. planen neu (`isStuck`).
  Minions finden per Pfadsuche zurück auf die Lane und erscheinen am Rand der Nexus statt in ihrer Mitte.
