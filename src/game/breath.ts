import * as THREE from "three";

/**
 * Blauer Feueratem (Thorne W) als 3D-Effekt, nach dem Vorbild eines Feuerkegels wie Annies W, nur durchgehend:
 * - Flammen: viele Teilchen, die aus dem Maul in den Kegel schießen, dabei wachsen, aufsteigen und von hellem
 *   Weißblau über Blau zu dunklem Indigo verglühen;
 * - Kern: ein durchgehender Strahl (Kegel mit wanderndem Rauschen), damit es ein Strom ist und keine Wolke;
 * - Funken: kleine, schnelle, helle Punkte; Glut am Boden unter dem Kegel.
 * Alles liegt im Raum (keine flache Bildfolge), sieht also aus jedem Blickwinkel räumlich aus.
 */
const CAP = 2600;
const RANGE = 7.5;
const HALF = (27 * Math.PI) / 180;

export class BreathFx {
  readonly group = new THREE.Group();
  private pos = new Float32Array(CAP * 3);
  private vel = new Float32Array(CAP * 3);
  private col = new Float32Array(CAP * 3);
  private size = new Float32Array(CAP);
  private alpha = new Float32Array(CAP);
  private age = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private s0 = new Float32Array(CAP);
  private kind = new Uint8Array(CAP);
  private rot = new Float32Array(CAP);
  private next = 0;
  private geo = new THREE.BufferGeometry();
  private streams = new Map<string | number, { cone: THREE.Mesh; glow: THREE.Mesh; mat: THREE.ShaderMaterial; gmat: THREE.ShaderMaterial; acc: number; w: number }>();
  private time = { value: 0 };

  constructor() {
    const g = this.geo;
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("rot", new THREE.BufferAttribute(this.rot, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(150, 0, 150), 400);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 }, uTex: { value: flameTexture() } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute float rot;
        attribute vec3 color;
        varying vec3 vCol;
        varying float vA;
        varying float vR;
        uniform float uScale;
        void main() {
          vCol = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = alpha * smoothstep(0.8, 2.5, -mv.z);
          vR = rot;
          gl_PointSize = min(size * uScale / -mv.z, 300.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vCol;
        varying float vA;
        varying float vR;
        void main() {
          // Flammenzunge aus der Textur, je Teilchen gedreht: ausgefranste Ränder statt runder Punkte
          vec2 d = gl_PointCoord - 0.5;
          float c = cos(vR), s = sin(vR);
          vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5;
          vec4 t = texture2D(uTex, q);
          float a = t.a;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vCol * (0.35 + t.r * 0.8), a * vA);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.group.add(pts);
  }

  setScale(px: number) {
    ((this.group.children[0] as THREE.Points).material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, kind: number) {
    const i = this.next;
    this.next = (this.next + 1) % CAP;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.s0[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.kind[i] = kind;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.geo.attributes.rot.needsUpdate = true;
  }

  /** Strahl für eine Quelle (id) in diesem Bild: Maul (Welt), Richtung (waagrecht, normiert), Stärke 0..1. */
  breathe(id: string | number, mouth: THREE.Vector3, dx: number, dz: number, power: number, dt: number) {
    let s = this.streams.get(id);
    if (!s) {
      s = this.makeStream();
      this.streams.set(id, s);
      this.group.add(s.cone, s.glow);
    }
    s.w = power;
    // Kern: Kegel vom Maul nach vorne und leicht abwärts (trifft den Boden am Ende des Kegels)
    const drop = Math.max(0.2, mouth.y - 0.3);
    const dir = new THREE.Vector3(dx, -drop / RANGE, dz).normalize();
    s.cone.position.copy(mouth);
    s.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    s.cone.visible = power > 0.01;
    s.mat.uniforms.uPower.value = power;
    s.glow.position.set(mouth.x + dx * RANGE * 0.55, mouth.y - drop + 0.06, mouth.z + dz * RANGE * 0.55);
    s.glow.rotation.set(-Math.PI / 2, 0, Math.atan2(dx, dz) + Math.PI / 2);
    s.glow.visible = power > 0.01;
    s.gmat.uniforms.uPower.value = power;
    if (power <= 0.01) return;
    // Flammen und Funken
    s.acc += dt * 420 * power;
    const side = new THREE.Vector3(-dz, 0, dx);
    while (s.acc >= 1) {
      s.acc -= 1;
      const spark = Math.random() < 0.14;
      const a = (Math.random() * 2 - 1) * HALF * (spark ? 1.1 : 0.95);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const fx = dx * ca + side.x * sa;
      const fz = dz * ca + side.z * sa;
      const sp = (spark ? 13 : 9.5) + Math.random() * 3;
      const vy = -drop / RANGE * sp + (Math.random() - 0.3) * 1.2;
      const j = 0.12;
      this.emit(mouth.x + (Math.random() - 0.5) * j, mouth.y + (Math.random() - 0.5) * j, mouth.z + (Math.random() - 0.5) * j, fx * sp, vy, fz * sp, spark ? 0.12 + Math.random() * 0.1 : 0.45 + Math.random() * 0.45, (RANGE / sp) * (0.85 + Math.random() * 0.35), spark ? 1 : 0);
    }
  }

  /** Quelle ohne Feuer in diesem Bild: Strahl blendet aus. */
  stop(id: string | number) {
    const s = this.streams.get(id);
    if (s) s.w = 0;
  }

  private makeStream() {
    // offener Kegel, Spitze im Ursprung, Öffnung entlang +y (Länge RANGE)
    const r = Math.tan(HALF) * RANGE * 0.62;
    const geo = new THREE.ConeGeometry(r, RANGE, 28, 12, true);
    geo.translate(0, -RANGE / 2, 0);
    geo.rotateX(Math.PI);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time, uPower: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uPower;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          // along: 0 am Maul, 1 am Ende des Kegels
          float along = 1.0 - vUv.y;
          vec2 q = vec2(vUv.x * 9.0, along * 5.0 - uTime * 7.0);
          float flame = n(q) * 0.6 + n(q * 2.3 + 3.1) * 0.4;
          // Zungen: nur die hellen Stellen des Rauschens, zum Ende hin immer löchriger
          flame = smoothstep(0.25 + along * 0.35, 0.85, flame);
          float edge = pow(1.0 - abs(dot(vN, vV)), 1.5);
          float a = smoothstep(0.0, 0.18, along) * smoothstep(1.0, 0.55, along);
          a *= (0.35 + flame * 0.9) * (0.45 + edge * 0.8) * uPower;
          vec3 c = mix(vec3(0.08, 0.28, 1.0), vec3(0.6, 0.9, 1.0), smoothstep(0.35, 0.0, along) * flame);
          gl_FragColor = vec4(c, a * 0.3);
        }`,
    });
    const cone = new THREE.Mesh(geo, mat);
    cone.renderOrder = 6;
    cone.frustumCulled = false;
    // Glut am Boden: länglicher, blau leuchtender Fleck unter dem Kegel
    const gmat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time, uPower: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uPower;
        varying vec2 vUv;
        void main() {
          vec2 d = (vUv - 0.5) * vec2(2.0, 2.0);
          float wide = mix(0.25, 1.0, vUv.x);
          float r = length(vec2(d.x, d.y / wide));
          float a = smoothstep(1.0, 0.2, r) * (0.75 + 0.25 * sin(uTime * 13.0 + vUv.x * 9.0)) * uPower;
          gl_FragColor = vec4(vec3(0.15, 0.4, 1.0) * a, a * 0.18);
        }`,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(RANGE * 0.95, Math.tan(HALF) * RANGE * 1.4), gmat);
    glow.renderOrder = 4;
    return { cone, glow, mat, gmat, acc: 0, w: 0 };
  }

  update(dt: number) {
    this.time.value += dt;
    for (const [id, s] of this.streams) {
      if (s.w <= 0.01) {
        s.cone.visible = false;
        s.glow.visible = false;
        if (s.w <= 0) {
          this.group.remove(s.cone, s.glow);
          s.cone.geometry.dispose();
          s.glow.geometry.dispose();
          s.mat.dispose();
          s.gmat.dispose();
          this.streams.delete(id);
        }
      }
    }
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < CAP; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      // Flammen werden langsamer, steigen etwas auf und wirbeln
      const drag = this.kind[i] ? 0.6 : 1.6;
      v[i * 3] *= 1 - drag * dt * 0.5;
      v[i * 3 + 2] *= 1 - drag * dt * 0.5;
      v[i * 3 + 1] += (this.kind[i] ? -2 : 1.8) * dt;
      p[i * 3] += v[i * 3] * dt + Math.sin(this.age[i] * 17 + i) * dt * 0.6;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt + Math.cos(this.age[i] * 15 + i) * dt * 0.6;
      if (this.kind[i]) {
        // Funke: klein, hell, verglüht
        this.size[i] = this.s0[i] * (1 - t * 0.5);
        this.col.set([0.8, 0.95, 1], i * 3);
        this.alpha[i] = 1 - t;
      } else {
        // Flamme: wächst stark, Farbe Weißblau -> Blau -> Indigo
        this.size[i] = this.s0[i] * (0.5 + 4.2 * Math.pow(t, 0.7));
        const c0 = t < 0.25 ? t / 0.25 : 1;
        const c1 = t < 0.25 ? 0 : (t - 0.25) / 0.75;
        // kurz weißblau am Maul, dann sattes Blau, zuletzt dunkles Indigo
        const r = (0.6 - 0.45 * c0) * (1 - c1) + 0.06 * c1;
        const g = (0.88 - 0.4 * c0) * (1 - c1) + 0.12 * c1;
        const b = 1.0 * (1 - c1) + 0.7 * c1;
        this.col.set([r, g, b], i * 3);
        this.alpha[i] = Math.min(1, t * 10) * Math.pow(1 - t, 1.1);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

/** Flammenzunge (64², weiß mit Alpha): länglicher Tropfen mit ausgefranstem Rand, innen heller. */
let flameTex: THREE.Texture | null = null;
function flameTexture() {
  if (flameTex) return flameTex;
  const N = 64;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const img = g.createImageData(N, N);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N - 0.5;
      const py = (y + 0.5) / N - 0.5;
      // Tropfen: unten breit, oben spitz
      const w = 0.32 * (0.55 + (py + 0.5) * 0.6);
      const r = Math.hypot(px / w, py / 0.46);
      const n = noise(x * 0.18, y * 0.18) * 0.6 + noise(x * 0.45 + 7, y * 0.45) * 0.4;
      const a = Math.max(0, Math.min(1, (1 - r) * 1.8 - (1 - n) * 0.9));
      const core = Math.max(0, 1 - r * 1.6);
      const i = (y * N + x) * 4;
      img.data[i] = Math.round(255 * Math.min(1, 0.35 + core));
      img.data[i + 1] = img.data[i];
      img.data[i + 2] = img.data[i];
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  g.putImageData(img, 0, 0);
  flameTex = new THREE.CanvasTexture(c);
  return flameTex;
}
