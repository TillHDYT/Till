import * as THREE from "three";
import elaraAddUrl from "../assets/fx/elara_aa_add.jpg";
import elaraMulUrl from "../assets/fx/elara_aa_mul.jpg";
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
// Elaras Grundangriff (assets-src/qeffect/cut_support.py): Ursprung am Abwurf, Kopf erreicht das Ende in Bild 15
const ELARA = { frames: 30, cols: 3, rows: 10, u0: -50, u1: 375.76, v0: -55, v1: 55, L: 369.76, arrive: 15 };
/** Elaras Komet: so lang (Welt-Einheiten) ist die Bahn aus dem GIF bei ungestreckter Darstellung. */
const ELARA_LEN = 11;
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
    for (const u of [qDiscAddUrl, qDiscMulUrl, qFlightAddUrl, qFlightMulUrl, elaraAddUrl, elaraMulUrl]) load(u);
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
   * Elaras Grundangriff: Komet von from nach to, an ein Geschoss gebunden. Solange es fliegt, setzt der Aufrufer den
   * Fortschritt (0..1); danach (release) laufen die liegenbleibenden Splitter in Originalgeschwindigkeit aus.
   */
  elaraShot(from: THREE.Vector3, to: THREE.Vector3) {
    const U = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    const dist = U.length();
    if (dist < 1e-3) U.set(0, 0, 1);
    U.normalize();
    const V = new THREE.Vector3(-U.z, 0, U.x);
    const s = ELARA_LEN / ELARA.L;
    const k = dist / ELARA_LEN;
    const T = new THREE.Vector3(from.x, from.y + 1.1, from.z);
    const geo = quad(T, U, V, ELARA.u0 * s * k, ELARA.u1 * s * k, ELARA.v0 * s, ELARA.v1 * s);
    const st = { progress: 0, released: -1 };
    const it = this.add(
      geo,
      flipMaterial(elaraMulUrl, ELARA.cols, ELARA.rows, "mul"),
      flipMaterial(elaraAddUrl, ELARA.cols, ELARA.rows, "add"),
      8,
      false,
      99,
      (t) => (st.released < 0 ? Math.min(ELARA.arrive, Math.floor(st.progress * ELARA.arrive)) : Math.min(ELARA.frames - 1, ELARA.arrive + Math.floor((t - st.released) * FPS))),
      (t) => (st.released < 0 ? 1 : Math.min(1, (ELARA.frames - ELARA.arrive) / FPS - (t - st.released)) * 4),
    );
    return {
      progress: (p: number) => (st.progress = Math.max(st.progress, Math.min(1, p))),
      release: () => {
        if (st.released >= 0) return;
        st.released = it.t;
        it.dur = it.t + (ELARA.frames - ELARA.arrive) / FPS;
      },
    };
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
