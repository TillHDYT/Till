import * as THREE from "three";

// Effekte von Malgors Blutkugel (Q) und Seelenernte (R), nach dem Vorbild aus dem Spiel-GIF:
// - Kugel: weißer Kern, rote glänzende Hülle, roter Schein
// - Schweif: roter Kometenstreif am Kopf, der in breiten grau-weißen Dunst übergeht, dazu funkelnde Sterne
// - Aufschlag: heller Blitz, dann eine dunkle Scheibe mit leuchtend rotem Rand und Ornamentring, in der Sterne
//   funkeln und rosa Schmetterlinge aufsteigen; nach einer Weile blendet sie aus.

const texCache: Record<string, THREE.Texture> = {};

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache[key] = t;
  return t;
}

const glowTex = () =>
  canvasTex("glow", 64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.3, "rgba(255,255,255,0.55)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });

/** Glänzende Hülle der Kugel: heller Rand, darin rötlich, oben links ein Glanzlicht. */
const shellTex = () =>
  canvasTex("shell", 128, (g, s) => {
    const c = s / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.28, "rgba(255,235,240,1)");
    gr.addColorStop(0.45, "rgba(255,90,110,0.85)");
    gr.addColorStop(0.72, "rgba(255,60,80,0.75)");
    gr.addColorStop(0.84, "rgba(255,190,200,0.95)");
    gr.addColorStop(0.92, "rgba(255,120,140,0.5)");
    gr.addColorStop(1, "rgba(255,60,80,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    const hl = g.createRadialGradient(c * 0.7, c * 0.62, 0, c * 0.7, c * 0.62, c * 0.3);
    hl.addColorStop(0, "rgba(255,255,255,0.9)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl;
    g.fillRect(0, 0, s, s);
  });

/** Vierzackiger Funkelstern. */
const starTex = () =>
  canvasTex("star", 64, (g, s) => {
    const c = s / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c * 0.35);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(255,255,255,0.95)";
    for (const [w, h] of [[0.07, 0.5], [0.5, 0.07]]) {
      g.beginPath();
      g.moveTo(c, c - h * s);
      g.quadraticCurveTo(c + w * s * 0.3, c, c, c + h * s);
      g.quadraticCurveTo(c - w * s * 0.3, c, c, c - h * s);
      g.moveTo(c - w * s, c);
      g.quadraticCurveTo(c, c - h * s * 0.3, c + w * s, c);
      g.quadraticCurveTo(c, c + h * s * 0.3, c - w * s, c);
      g.fill();
    }
  });

/** Schmetterling (von oben), Flügel in Rosa mit hellem Rand. */
const butterflyTex = () =>
  canvasTex("butterfly", 64, (g, s) => {
    const c = s / 2;
    g.lineWidth = 2;
    for (const side of [-1, 1]) {
      g.fillStyle = "rgba(255,150,175,0.85)";
      g.strokeStyle = "rgba(255,230,235,0.95)";
      g.beginPath();
      g.ellipse(c + side * s * 0.2, c - s * 0.1, s * 0.18, s * 0.22, side * 0.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(c + side * s * 0.15, c + s * 0.17, s * 0.12, s * 0.14, -side * 0.4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = "rgba(255,240,245,1)";
    g.fillRect(c - 1.5, c - s * 0.25, 3, s * 0.5);
  });

/** Dunkle Füllung der Blutlache (normal gemischt: dunkelt den Boden ab). */
const poolDarkTex = () =>
  canvasTex("poolDark", 256, (g, s) => {
    const c = s / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, "rgba(40,0,12,0.6)");
    gr.addColorStop(0.75, "rgba(70,2,20,0.68)");
    gr.addColorStop(0.95, "rgba(120,8,30,0.78)");
    gr.addColorStop(1, "rgba(80,4,20,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });

/** Leuchtender Rand der Blutlache mit Ornamentring (additiv). */
const poolGlowTex = () =>
  canvasTex("poolGlow", 512, (g, s) => {
    const c = s / 2;
    const R = c * 0.94;
    // roter Schimmer nach innen
    const gr = g.createRadialGradient(c, c, R * 0.55, c, c, R);
    gr.addColorStop(0, "rgba(255,30,50,0)");
    gr.addColorStop(1, "rgba(255,30,50,0.22)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    // äußerer Rand, weich leuchtend
    g.shadowColor = "rgba(255,40,60,1)";
    g.shadowBlur = 18;
    g.strokeStyle = "rgba(255,70,90,1)";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,200,210,0.9)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.stroke();
    // innerer Ornamentring: Bögen mit kleinen Zacken
    g.strokeStyle = "rgba(255,90,110,0.85)";
    g.lineWidth = 3;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + 0.08;
      const a1 = ((i + 1) / n) * Math.PI * 2 - 0.08;
      g.beginPath();
      g.arc(c, c, R * 0.9, a0, a1);
      g.stroke();
      const am = (a0 + a1) / 2;
      g.beginPath();
      g.moveTo(c + Math.cos(am - 0.05) * R * 0.9, c + Math.sin(am - 0.05) * R * 0.9);
      g.lineTo(c + Math.cos(am) * R * 0.97, c + Math.sin(am) * R * 0.97);
      g.lineTo(c + Math.cos(am + 0.05) * R * 0.9, c + Math.sin(am + 0.05) * R * 0.9);
      g.stroke();
    }
  });

/** Band aus Vierecken entlang einer Spur, flach auf dem Boden; Farbe und Deckkraft je Punkt. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor(
    private n: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 4);
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aCol", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute vec4 aCol;
        attribute float aSide;
        varying vec4 vCol;
        varying float vSide;
        void main() {
          vCol = aCol;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec4 vCol;
        varying float vSide;
        void main() {
          float edge = 1.0 - vSide * vSide;
          gl_FragColor = vec4(vCol.rgb, vCol.a * edge);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** pts: Kopf zuerst; style(a) mit a = 0 (Kopf) .. 1 (Ende) liefert Breite, Farbe, Deckkraft. */
  set(pts: { x: number; y: number; z: number; a: number }[], style: (a: number) => [number, THREE.Color, number]) {
    const n = Math.min(this.n, pts.length);
    for (let i = 0; i < this.n; i++) {
      const p = pts[Math.min(i, n - 1)];
      const q = pts[Math.min(i + 1, n - 1)] ?? p;
      const r = pts[Math.min(Math.max(i - 1, 0), n - 1)];
      let dx = r.x - q.x;
      let dz = r.z - q.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const [w, c, al] = style(p.a);
      const alpha = i < n ? al : 0;
      for (const s of [0, 1]) {
        const k = (i * 2 + s) * 3;
        const sgn = s ? 1 : -1;
        this.pos[k] = p.x - dz * w * 0.5 * sgn;
        this.pos[k + 1] = p.y;
        this.pos[k + 2] = p.z + dx * w * 0.5 * sgn;
        const m = (i * 2 + s) * 4;
        this.col[m] = c.r;
        this.col[m + 1] = c.g;
        this.col[m + 2] = c.b;
        this.col[m + 3] = alpha;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
  }
}

type Trail = { pts: { x: number; y: number; z: number; t: number }[]; smoke: Ribbon; streak: Ribbon; alive: boolean; color: THREE.Color };
type Star = { s: THREE.Sprite; t: number; life: number; size: number; vy: number };
type Fly = { s: THREE.Sprite; t: number; vx: number; vz: number; vy: number; size: number; phase: number };
type Pool = { g: THREE.Group; dark: THREE.Mesh; glow: THREE.Mesh; t: number; dur: number; r: number; x: number; y: number; z: number; flies: Fly[]; flash: THREE.Sprite };

const TRAIL_AGE = 0.95;
const SMOKE_A = new THREE.Color(1.0, 0.45, 0.55);
const SMOKE_B = new THREE.Color(0.86, 0.84, 0.9);
const STREAK = new THREE.Color(1.0, 0.18, 0.25);
const tmpC = new THREE.Color();

export class BloodFx {
  readonly group = new THREE.Group();
  private time = 0;
  private trails = new Map<number, Trail>();
  private stars: Star[] = [];
  private pools: Pool[] = [];

  /** Kugel für ein Geschoss mit visual "orb". */
  makeOrb(color: number) {
    const g = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(3.4);
    const shell = new THREE.Sprite(new THREE.SpriteMaterial({ map: shellTex(), transparent: true, depthWrite: false }));
    shell.scale.setScalar(1.7);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(1.0);
    g.add(glow, shell, core);
    g.renderOrder = 6;
    return g;
  }

  /** Kugel ist an x, y, z: Spur fortschreiben, Funken und Sterne ausstreuen. */
  tickOrb(id: number, x: number, y: number, z: number, color: number, visible: boolean) {
    let tr = this.trails.get(id);
    if (!tr) {
      tr = { pts: [], smoke: new Ribbon(64, false), streak: new Ribbon(32, true), alive: true, color: new THREE.Color(color) };
      this.group.add(tr.smoke.mesh, tr.streak.mesh);
      this.trails.set(id, tr);
    }
    tr.smoke.mesh.visible = tr.streak.mesh.visible = visible;
    const last = tr.pts[0];
    if (!last || Math.hypot(last.x - x, last.z - z) > 0.12) tr.pts.unshift({ x, y, z, t: this.time });
    if (visible && Math.random() < 0.55) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.9;
      this.star(x + Math.cos(a) * r, y + (Math.random() - 0.3) * 0.6, z + Math.sin(a) * r, 0.25 + Math.random() * 0.3, 0.35 + Math.random() * 0.35, Math.random() < 0.5 ? 0xffe6b0 : 0xffffff);
    }
  }

  /** Kugel ist verschwunden: Spur blendet aus, kleiner Aufschlag-Funken. */
  endOrb(id: number) {
    const tr = this.trails.get(id);
    if (tr) tr.alive = false;
  }

  private star(x: number, y: number, z: number, size: number, life: number, color: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z);
    s.renderOrder = 7;
    this.group.add(s);
    this.stars.push({ s, t: 0, life, size, vy: 0.2 });
  }

  /** Blutlache am Aufschlagpunkt (Radius r, Dauer dur in Sekunden). */
  pool(x: number, y: number, z: number, r: number, dur: number) {
    const g = new THREE.Group();
    g.position.set(x, y + 0.18, z);
    const plane = new THREE.PlaneGeometry(2, 2);
    const dark = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: poolDarkTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    const glow = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: poolGlowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5 }));
    for (const m of [dark, glow]) {
      m.rotation.x = -Math.PI / 2;
      m.scale.setScalar(r);
      m.renderOrder = 4;
      g.add(m);
    }
    glow.position.y = 0.02;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff0f0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.y = 0.6;
    flash.renderOrder = 7;
    g.add(flash);
    this.group.add(g);
    const flies: Fly[] = [];
    const nf = Math.round(r * 1.8);
    for (let i = 0; i < nf; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: butterflyTex(), transparent: true, depthWrite: false, opacity: 0 }));
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.75;
      s.position.set(Math.cos(a) * d, 0.3 + Math.random() * 0.5, Math.sin(a) * d);
      s.renderOrder = 7;
      g.add(s);
      flies.push({ s, t: -Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, vy: 0.5 + Math.random() * 0.5, size: 0.45 + Math.random() * 0.25, phase: Math.random() * 6 });
    }
    this.pools.push({ g, dark, glow, t: 0, dur, r, x, y, z, flies, flash });
  }

  update(dt: number) {
    this.time += dt;
    // Spuren
    for (const [id, tr] of this.trails) {
      while (tr.pts.length && this.time - tr.pts[tr.pts.length - 1].t > TRAIL_AGE) tr.pts.pop();
      if (!tr.pts.length && !tr.alive) {
        this.group.remove(tr.smoke.mesh, tr.streak.mesh);
        tr.smoke.mesh.geometry.dispose();
        tr.streak.mesh.geometry.dispose();
        this.trails.delete(id);
        continue;
      }
      if (!tr.pts.length) continue;
      const pts = tr.pts.map((p) => ({ x: p.x, y: p.y - 0.05, z: p.z, a: Math.min(1, (this.time - p.t) / TRAIL_AGE) }));
      // Dunst: am Kopf schmal und rosa, nach hinten breit, grau-weiß und durchsichtig
      tr.smoke.set(pts, (a) => [0.7 + 2.3 * Math.pow(a, 0.6), tmpC.copy(SMOKE_A).lerp(SMOKE_B, Math.min(1, a * 2.5)), 0.62 * (1 - a) * Math.min(1, a / 0.04)]);
      // Kometenstreif: rot, schmal, nur das vordere Stück
      tr.streak.set(pts, (a) => [0.85 * (1 - a * 0.5), STREAK, Math.max(0, 1 - a * 1.9) * 0.95]);
    }
    // Sterne funkeln
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const st = this.stars[i];
      st.t += dt;
      const k = st.t / st.life;
      if (k >= 1) {
        this.group.remove(st.s);
        st.s.material.dispose();
        this.stars.splice(i, 1);
        continue;
      }
      const tw = Math.sin(Math.PI * k) * (0.75 + 0.25 * Math.sin(st.t * 40));
      st.s.scale.setScalar(st.size * tw);
      st.s.material.rotation = k * 0.6;
      st.s.position.y += st.vy * dt;
    }
    // Blutlachen
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t += dt;
      const t = p.t;
      if (t >= p.dur) {
        this.group.remove(p.g);
        for (const f of p.flies) f.s.material.dispose();
        (p.dark.material as THREE.Material).dispose();
        (p.glow.material as THREE.Material).dispose();
        p.flash.material.dispose();
        this.pools.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, t / 0.14);
      const scale = p.r * (0.7 + 0.3 * (1 - (1 - grow) * (1 - grow)));
      const fadeOut = Math.min(1, (p.dur - t) / 0.35);
      p.dark.scale.setScalar(scale);
      p.glow.scale.setScalar(scale);
      (p.dark.material as THREE.MeshBasicMaterial).opacity = Math.min(1, t / 0.1) * fadeOut;
      // Rand leuchtet beim Aufschlag hell auf und pulsiert dann leicht
      (p.glow.material as THREE.MeshBasicMaterial).opacity = (0.75 + 0.6 * Math.max(0, 1 - t / 0.25) + 0.1 * Math.sin(t * 9)) * fadeOut;
      p.glow.rotation.z = t * 0.25;
      const fk = Math.min(1, t / 0.25);
      p.flash.scale.setScalar(p.r * (0.6 + 1.4 * fk));
      p.flash.material.opacity = Math.max(0, 1 - fk) * 0.95;
      // Sterne in der Fläche
      if (Math.random() < dt * p.r * 9 * fadeOut) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * p.r * 0.92;
        this.star(p.x + Math.cos(a) * d, p.y + 0.25 + Math.random() * 0.6, p.z + Math.sin(a) * d, 0.22 + Math.random() * 0.25, 0.4 + Math.random() * 0.4, Math.random() < 0.3 ? 0xffd0d8 : 0xffffff);
      }
      // Schmetterlinge steigen flatternd auf
      for (const f of p.flies) {
        f.t += dt;
        if (f.t < 0) continue;
        f.s.position.x += f.vx * dt;
        f.s.position.z += f.vz * dt;
        f.s.position.y += f.vy * dt;
        const flap = 0.35 + 0.65 * Math.abs(Math.cos(f.t * 14 + f.phase));
        f.s.scale.set(f.size * flap, f.size, 1);
        f.s.material.opacity = Math.min(1, f.t / 0.15) * fadeOut * 0.95;
      }
    }
  }
}
