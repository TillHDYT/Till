import * as THREE from "three";

// Partikel als ein einziges Points-Objekt mit additiver Mischung.
export class Particles {
  readonly points: THREE.Points;
  private cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private geo: THREE.BufferGeometry;

  constructor(cap = 3000) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(100, 0, 100), 400);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vCol;
        varying float vA;
        uniform float uScale;
        void main() {
          vCol = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // dicht vor der Kamera (Nahansicht) ausblenden statt bildfüllend aufzublähen
          vA = alpha * smoothstep(0.8, 2.5, -mv.z);
          gl_PointSize = min(size * uScale / -mv.z, 256.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vCol * (0.6 + a), a * vA);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(px: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grav = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.size0[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.grav[i] = grav;
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed: number, size: number, life: number, grav = -4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const r = Math.sqrt(1 - u * u);
      this.emit(x, y, z, Math.cos(a) * r * s, Math.abs(u) * s + speed * 0.3, Math.sin(a) * r * s, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), grav);
    }
  }

  ring(x: number, y: number, z: number, radius: number, color: number, count: number, size: number, life: number, outward = 2) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      this.emit(x + cx * radius, y, z + cz * radius, cx * outward, 0.6 + Math.random(), cz * outward, c, size, life);
    }
  }

  update(dt: number) {
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      v[i * 3 + 1] += this.grav[i] * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, t * 2);
      this.size[i] = this.size0[i] * (0.4 + t * 0.6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

type RingFx = { mesh: THREE.Mesh; t: number; dur: number; r0: number; r1: number; opacity: number; follow?: { x: number; z: number } };

/** Ausdehnende Bodenringe und Scheiben. */
export class GroundFx {
  readonly group = new THREE.Group();
  private rings: RingFx[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private discGeo = new THREE.CircleGeometry(1, 40);
  private pool: THREE.Mesh[] = [];

  private take(disc: boolean, color: number) {
    let m = this.pool.find((x) => !x.visible && (x.geometry === this.discGeo) === disc);
    if (!m) {
      m = new THREE.Mesh(disc ? this.discGeo : this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 4;
      this.pool.push(m);
      this.group.add(m);
    }
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
    return m;
  }

  ring(x: number, y: number, z: number, r0: number, r1: number, color: number, dur: number, opacity = 0.9, disc = false) {
    const mesh = this.take(disc, color);
    mesh.position.set(x, y + 0.12, z);
    this.rings.push({ mesh, t: 0, dur, r0, r1, opacity });
  }

  update(dt: number) {
    for (const r of this.rings) {
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const e = 1 - (1 - k) * (1 - k);
      const s = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = r.opacity * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
    this.rings = this.rings.filter((r) => r.mesh.visible);
  }
}

/** Zielanzeigen auf dem Boden (Reichweite, Richtung, Fläche). */
export class Indicators {
  readonly group = new THREE.Group();
  readonly range: THREE.Mesh;
  readonly area: THREE.Mesh;
  readonly arrow: THREE.Mesh;
  readonly turretRange: THREE.Mesh;

  constructor() {
    const mk = (geo: THREE.BufferGeometry, color: number, opacity: number) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 6;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.range = mk(new THREE.RingGeometry(0.97, 1, 64), 0x9fe0ff, 0.6);
    this.area = mk(new THREE.CircleGeometry(1, 40), 0x7fd0ff, 0.28);
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.5, 0.86);
    shape.lineTo(1.0, 0.86);
    shape.lineTo(0, 1);
    shape.lineTo(-1.0, 0.86);
    shape.lineTo(-0.5, 0.86);
    shape.closePath();
    const ag = new THREE.ShapeGeometry(shape);
    this.arrow = mk(ag, 0x7fd0ff, 0.35);
    this.turretRange = mk(new THREE.RingGeometry(0.975, 1, 72), 0xff4030, 0.7);
  }

  hide() {
    this.range.visible = false;
    this.area.visible = false;
    this.arrow.visible = false;
  }

  showRange(x: number, z: number, r: number, y: number) {
    this.range.visible = true;
    this.range.position.set(x, y + 0.15, z);
    this.range.scale.set(r, r, r);
  }

  showArea(x: number, z: number, r: number, y: number, color = 0x7fd0ff) {
    this.area.visible = true;
    this.area.position.set(x, y + 0.16, z);
    this.area.scale.set(r, r, r);
    (this.area.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  showArrow(x: number, z: number, dx: number, dz: number, len: number, width: number, y: number) {
    this.arrow.visible = true;
    this.arrow.position.set(x, y + 0.16, z);
    // Die Form zeigt lokal entlang +y; mit der Kippung um X ergibt das Welt-Richtung (dx, dz).
    this.arrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-dx, -dz));
    this.arrow.scale.set(width / 2, len, 1);
  }
}
