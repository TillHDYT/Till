import * as THREE from "three";
import boltAddUrl from "../assets/fx/elara_aa_add.jpg";
import boltMulUrl from "../assets/fx/elara_aa_mul.jpg";
import cometAddUrl from "../assets/fx/elara_comet_add.jpg";
import cometMulUrl from "../assets/fx/elara_comet_mul.jpg";
import orbAddUrl from "../assets/fx/elara_e_add.jpg";
import orbMulUrl from "../assets/fx/elara_e_mul.jpg";
import orbBurstAddUrl from "../assets/fx/elara_eburst_add.jpg";
import orbBurstMulUrl from "../assets/fx/elara_eburst_mul.jpg";
import zoneAddUrl from "../assets/fx/elara_zone_add.jpg";
import zoneMulUrl from "../assets/fx/elara_zone_mul.jpg";
import qDiscAddUrl from "../assets/fx/q_disc_add.jpg";
import qDiscMulUrl from "../assets/fx/q_disc_mul.jpg";
import qFlightAddUrl from "../assets/fx/q_flight_add.jpg";
import qFlightMulUrl from "../assets/fx/q_flight_mul.jpg";

// Effekte als Daumenkino: Bild für Bild aus dem Vorlage-GIF ausgeschnitten (assets-src/qeffect/cut.py).
// Jedes Bild hat zwei Schichten: Schatten (wird mit dem Boden multipliziert) und Licht (wird addiert).
// Boden * Schatten + Licht ergibt das Bild aus dem GIF, nur auf unserem Boden (beide Schichten etwas verstärkt,
// damit der Effekt im Spiel kräftiger wirkt).

const FPS = 1000 / 30;
// Maße aus cut.py (Pixel im entzerrten GIF; die Scheibe hat dort den Außenradius 103)
const DISC_R_PX = 103;
const FLIGHT = { frames: 31, cols: 4, rows: 8, u0: -379.674, u1: 60, v0: -90, v1: 90, L: 339.674 };
const DISC = { frames: 39, cols: 7, rows: 6, half: 128.75 };
/**
 * Geschoss als Band vom Werfer zum Ziel (Pixel im entzerrten GIF): der Kopf erreicht das Ende der Bahn in Bild arrive,
 * danach laufen die liegenbleibenden Reste aus. len = so lang (Welt-Einheiten) ist die Bahn bei ungestreckter Darstellung.
 */
type ShotSpec = { add: string; mul: string; frames: number; cols: number; rows: number; u0: number; u1: number; v0: number; v1: number; L: number; arrive: number; len: number; fps: number; y: number };
// Elaras Q-Flug: lila Komet (assets-src/qeffect/cut_support.py)
export const COMET: ShotSpec = { add: cometAddUrl, mul: cometMulUrl, frames: 30, cols: 3, rows: 10, u0: -50, u1: 375.76, v0: -55, v1: 55, L: 369.76, arrive: 15, len: 11, fps: FPS, y: 1.1 };
// Elaras Grundangriff: grüner Blitz aus „Neeko Auto Attack“ (assets-src/qeffect/cut_elara2.py), 25 Bilder je Sekunde
export const BOLT: ShotSpec = { add: boltAddUrl, mul: boltMulUrl, frames: 19, cols: 3, rows: 7, u0: -20, u1: 377.118, v0: -75, v1: 75, L: 302.118, arrive: 8, len: 11, fps: 25, y: 1.1 };
// Elaras E: blaue Kugel mit Spur (cut_elara2.py); den Sternplatzer am Ende zeigt orbBurst
export const ORB: ShotSpec = { add: orbAddUrl, mul: orbMulUrl, frames: 15, cols: 4, rows: 4, u0: -10, u1: 370.451, v0: -60, v1: 60, L: 350.451, arrive: 15, len: 12, fps: FPS, y: 1.0 };
const ORB_BURST = { frames: 16, cols: 4, rows: 4, half: 95, r: 60 };
// Heilkreis der Q: grüner Wirbelring mit goldenen Funken (cut_elara2.py); Ringradius 52 Pixel, nach dem Aufblitzen
// (Bilder 0-6) bleibt Bild 6 langsam drehend liegen, am Ende verglimmt er (Bilder 6-24)
const ZONE = { frames: 25, cols: 5, rows: 5, half: 80, ring: 52, hold: 6 };
/** In der Scheibe läuft diese Bildfolge in Schleife, wenn sie länger liegen bleiben soll als im GIF. */
const DISC_LOOP: [number, number] = [12, 33];

const loader = new THREE.TextureLoader();
const tex = new Map<string, THREE.Texture>();
function load(url: string) {
  let t = tex.get(url);
  if (!t) {
    t = loader.load(url);
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    tex.set(url, t);
  }
  return t;
}

function flipMaterial(url: string, cols: number, rows: number, mode: "mul" | "add") {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: load(url) }, uFrame: { value: 0 }, uFade: { value: 1 }, uGrid: { value: new THREE.Vector2(cols, rows) } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uFrame;
      uniform float uFade;
      uniform vec2 uGrid;
      varying vec2 vUv;
      void main() {
        float col = mod(uFrame, uGrid.x);
        float row = floor(uFrame / uGrid.x);
        vec2 cell = vec2((vUv.x + col) / uGrid.x, (vUv.y + uGrid.y - 1.0 - row) / uGrid.y);
        vec3 c = texture2D(uMap, cell).rgb;
        ${mode === "mul" ? "gl_FragColor = vec4(mix(vec3(1.0), pow(c, vec3(1.3)), uFade), 1.0);" : "gl_FragColor = vec4(c * uFade * 1.5, 1.0);"}
      }`,
  });
  if (mode === "mul") {
    // Ergebnis = Bildschirmfarbe * Schatten
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.DstColorFactor;
    mat.blendDst = THREE.ZeroFactor;
  } else {
    mat.blending = THREE.AdditiveBlending;
  }
  return mat;
}

/** Viereck flach auf dem Boden: Mitte T, Achsen U (Länge u0..u1) und V (v0..v1), in Welt-Einheiten. */
function quad(T: THREE.Vector3, U: THREE.Vector3, V: THREE.Vector3, u0: number, u1: number, v0: number, v1: number) {
  const p = (u: number, v: number) => T.clone().addScaledVector(U, u).addScaledVector(V, v);
  const pts = [p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((q) => [q.x, q.y, q.z]), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

type Flip = { meshes: THREE.Mesh[]; mats: THREE.ShaderMaterial[]; t: number; dur: number; frame: (t: number) => number; fade: (t: number) => number; held?: boolean };

export class FlipFx {
  readonly group = new THREE.Group();
  private items: Flip[] = [];

  constructor() {
    // Bildtafeln gleich laden, damit der erste Wurf nicht stockt
    for (const u of [qDiscAddUrl, qDiscMulUrl, qFlightAddUrl, qFlightMulUrl, boltAddUrl, boltMulUrl, cometAddUrl, cometMulUrl, orbAddUrl, orbMulUrl, orbBurstAddUrl, orbBurstMulUrl, zoneAddUrl, zoneMulUrl]) load(u);
  }

  private add(geo: THREE.BufferGeometry, mul: THREE.ShaderMaterial, addM: THREE.ShaderMaterial, order: number, depthTest: boolean, dur: number, frame: (t: number) => number, fade: (t: number) => number): Flip {
    const meshes = [new THREE.Mesh(geo, mul), new THREE.Mesh(geo, addM)];
    meshes.forEach((m, i) => {
      m.renderOrder = order + i;
      m.frustumCulled = false;
      (m.material as THREE.ShaderMaterial).depthTest = depthTest;
      this.group.add(m);
    });
    const it: Flip = { meshes, mats: [mul, addM], t: 0, dur, frame, fade };
    this.items.push(it);
    return it;
  }

  /**
   * Geschoss-Band von from nach to (spec: COMET, BOLT oder ORB). Solange es fliegt, setzt der Aufrufer den Fortschritt
   * (0..1); danach (release) laufen die liegenbleibenden Reste in Originalgeschwindigkeit aus. Mit auto läuft der
   * Fortschritt von selbst in so vielen Sekunden ab.
   */
  shot(spec: ShotSpec, from: THREE.Vector3, to: THREE.Vector3, auto = 0) {
    const U = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    const dist = U.length();
    if (dist < 1e-3) U.set(0, 0, 1);
    U.normalize();
    const V = new THREE.Vector3(-U.z, 0, U.x);
    const s = spec.len / spec.L;
    const k = dist / spec.len;
    const T = new THREE.Vector3(from.x, from.y + spec.y, from.z);
    const geo = quad(T, U, V, spec.u0 * s * k, spec.u1 * s * k, spec.v0 * s, spec.v1 * s);
    const st = { progress: 0, released: -1 };
    const last = spec.frames - 1;
    const tail = Math.max(0.3, (spec.frames - spec.arrive) / spec.fps);
    const it = this.add(
      geo,
      flipMaterial(spec.mul, spec.cols, spec.rows, "mul"),
      flipMaterial(spec.add, spec.cols, spec.rows, "add"),
      8,
      false,
      99,
      (t) => {
        if (auto > 0 && st.released < 0) {
          st.progress = Math.min(1, t / auto);
          if (t >= auto) release();
        }
        return st.released < 0 ? Math.min(spec.arrive, last, Math.floor(st.progress * spec.arrive)) : Math.min(last, Math.max(Math.floor(st.progress * spec.arrive), spec.arrive) + Math.floor((t - st.released) * spec.fps));
      },
      (t) => (st.released < 0 ? 1 : Math.min(1, (tail - (t - st.released)) * 4)),
    );
    const release = () => {
      if (st.released >= 0) return;
      st.released = it.t;
      it.dur = it.t + tail;
    };
    return {
      progress: (p: number) => (st.progress = Math.max(st.progress, Math.min(1, p))),
      release,
    };
  }

  /** Sternplatzer am Ende von Elaras E (Radius des hellen Kerns in Welt-Einheiten). */
  orbBurst(at: THREE.Vector3, radius: number) {
    const s = radius / ORB_BURST.r;
    const h = ORB_BURST.half * s;
    const T = new THREE.Vector3(at.x, at.y + 1.0, at.z);
    const geo = quad(T, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), -h, h, -h, h);
    const dur = ORB_BURST.frames / FPS;
    this.add(
      geo,
      flipMaterial(orbBurstMulUrl, ORB_BURST.cols, ORB_BURST.rows, "mul"),
      flipMaterial(orbBurstAddUrl, ORB_BURST.cols, ORB_BURST.rows, "add"),
      8,
      false,
      dur,
      (t) => Math.min(ORB_BURST.frames - 1, Math.floor(t * FPS)),
      () => 1,
    );
  }

  /** Heilkreis von Elaras Q: blitzt auf, bleibt dur Sekunden langsam drehend liegen und verglimmt dann. */
  zone(at: THREE.Vector3, radius: number, dur: number) {
    const s = radius / ZONE.ring;
    const h = ZONE.half * s;
    const geo = quad(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), -h, h, -h, h);
    const fps = 25;
    const intro = ZONE.hold / fps;
    const outro = (ZONE.frames - 1 - ZONE.hold) / fps;
    const total = dur + outro;
    const it = this.add(
      geo,
      flipMaterial(zoneMulUrl, ZONE.cols, ZONE.rows, "mul"),
      flipMaterial(zoneAddUrl, ZONE.cols, ZONE.rows, "add"),
      4,
      true,
      total,
      (t) => {
        for (const m of it.meshes) m.rotation.y = -t * 0.6;
        if (t < intro) return Math.floor(t * fps);
        if (t < dur) return ZONE.hold;
        return Math.min(ZONE.frames - 1, ZONE.hold + Math.floor((t - dur) * fps));
      },
      (t) => (t < intro || t >= dur ? 1 : 1 + 0.15 * Math.sin(t * 4)),
    );
    for (const m of it.meshes) m.position.set(at.x, at.y + 0.12, at.z);
  }

  /**
   * Flug der Blutkugel vom Werfer (from) zur Zielstelle (to), Dauer dur Sekunden; radius = Radius der Scheibe in
   * Welt-Einheiten (legt den Maßstab fest). Die Spur wird in Flugrichtung gestreckt, damit sie beim Werfer beginnt.
   */
  qFlight(from: THREE.Vector3, to: THREE.Vector3, radius: number, dur: number) {
    const s = radius / DISC_R_PX;
    const U = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    const dist = U.length();
    if (dist < 1e-3) U.set(0, 0, 1);
    U.normalize();
    const V = new THREE.Vector3(-U.z, 0, U.x);
    const k = Math.max(0.3, Math.min(1.15, dist / (FLIGHT.L * s)));
    const T = new THREE.Vector3(to.x, to.y + 0.3, to.z);
    const geo = quad(T, U, V, FLIGHT.u0 * s * k, FLIGHT.u1 * s, FLIGHT.v0 * s, FLIGHT.v1 * s);
    const n = FLIGHT.frames;
    this.add(
      geo,
      flipMaterial(qFlightMulUrl, FLIGHT.cols, FLIGHT.rows, "mul"),
      flipMaterial(qFlightAddUrl, FLIGHT.cols, FLIGHT.rows, "add"),
      8,
      false,
      dur,
      (t) => Math.min(n - 1, Math.floor((t / dur) * n)),
      () => 1,
    );
  }

  /** Scheibe am Aufschlag (Radius in Welt-Einheiten); dur länger als im GIF: der Mittelteil läuft in Schleife. */
  qDisc(at: THREE.Vector3, radius: number, dur = DISC.frames / FPS) {
    const s = radius / DISC_R_PX;
    const h = DISC.half * s;
    const T = new THREE.Vector3(at.x, at.y + 0.12, at.z);
    const geo = quad(T, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), -h, h, -h, h);
    const natural = DISC.frames / FPS;
    const tail = (DISC.frames - DISC_LOOP[1]) / FPS;
    const frame = (t: number) => {
      const f = t * FPS;
      if (dur <= natural || t < DISC_LOOP[1] / FPS) return Math.min(DISC.frames - 1, Math.floor(f));
      if (t > dur - tail) return Math.min(DISC.frames - 1, DISC_LOOP[1] + Math.floor((t - (dur - tail)) * FPS));
      const len = DISC_LOOP[1] - DISC_LOOP[0];
      return DISC_LOOP[0] + (Math.floor(f - DISC_LOOP[0]) % len);
    };
    this.add(
      geo,
      flipMaterial(qDiscMulUrl, DISC.cols, DISC.rows, "mul"),
      flipMaterial(qDiscAddUrl, DISC.cols, DISC.rows, "add"),
      4,
      true,
      dur,
      frame,
      (t) => Math.min(1, (dur - t) / 0.15),
    );
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t >= it.dur) {
        for (const m of it.meshes) this.group.remove(m);
        it.meshes[0].geometry.dispose();
        for (const m of it.mats) m.dispose();
        this.items.splice(i, 1);
        continue;
      }
      const f = it.frame(it.t);
      const fade = Math.max(0, it.fade(it.t));
      for (const m of it.mats) {
        m.uniforms.uFrame.value = f;
        m.uniforms.uFade.value = fade;
      }
    }
  }
}
