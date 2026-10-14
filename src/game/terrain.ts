import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FogOfWar } from "./fog";
import { BARON_POS, BRUSHES, CAMPS, DRAGON_POS, FOUNTAIN, LANES, LANE_WIDTH, MAP, STRUCTURES, distToPolyline, type LaneId } from "./mapdata";
import { fbm, noise2, rng, type NavGrid } from "./navgrid";

export type Quality = "high" | "low";

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const C = {
  grassA: hex(0x3d6a2b),
  grassB: hex(0x5e8c34),
  grassDry: hex(0x84913f),
  jungleA: hex(0x35592a),
  jungleB: hex(0x4a6e30),
  moss: hex(0x2f5a3a),
  dirt: hex(0x8a7150),
  dirtLight: hex(0xab9168),
  dirtDark: hex(0x6b5639),
  riverBed: hex(0x3c6a5e),
  riverDeep: hex(0x23505a),
  sand: hex(0x9e9466),
  stoneBlue: hex(0x6f7d94),
  stoneRed: hex(0x8f7574),
  stoneDark: hex(0x4a505c),
  forest: hex(0x1d3319),
  cliff: hex(0x5f5847),
  cliffDark: hex(0x3f3a30),
  baron: hex(0x4b3a5e),
  dragon: hex(0x6a4a34),
};

function sampler(grid: NavGrid, arr: ArrayLike<number>) {
  const n = grid.n;
  return (x: number, z: number) => {
    const fx = Math.max(0, Math.min(n - 1.001, x - 0.5));
    const fz = Math.max(0, Math.min(n - 1.001, z - 0.5));
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * n + ix;
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + n];
    const d = arr[i + n + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

/** Malt die Bodentextur (Gras, Lanes, Fluss, Basen, Wald). */
function paintGround(grid: NavGrid, size: number): HTMLCanvasElement {
  const n = grid.n;
  const wallArr = new Float32Array(n * n);
  const blueArr = new Float32Array(n * n);
  const redArr = new Float32Array(n * n);
  const clearArr = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    wallArr[i] = grid.walk[i] ? 0 : 1;
    blueArr[i] = grid.base[i] === 0 ? 1 : 0;
    redArr[i] = grid.base[i] === 1 ? 1 : 0;
    clearArr[i] = Math.min(4, grid.walk[i] ? grid.clear[i] : 0);
  }
  const sLane = sampler(grid, grid.lane);
  const sRiver = sampler(grid, grid.river);
  const sWall = sampler(grid, wallArr);
  const sBlue = sampler(grid, blueArr);
  const sRed = sampler(grid, redArr);
  const sClear = sampler(grid, clearArr);
  const sDepth = sampler(grid, grid.wallDepth);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const k = MAP / size;

  // kleine Rauschtabelle für schnelle Details
  const NT = 256;
  const ntab = new Float32Array(NT * NT);
  for (let z = 0; z < NT; z++) for (let x = 0; x < NT; x++) ntab[z * NT + x] = noise2(x * 0.5, z * 0.5) * 0.6 + noise2(x * 1.7 + 9, z * 1.7 + 3) * 0.4;
  const fine = (x: number, z: number) => ntab[((z * 7) & (NT - 1)) * NT + ((x * 7) & (NT - 1))];

  for (let py = 0; py < size; py++) {
    const z = (py + 0.5) * k;
    for (let pxx = 0; pxx < size; pxx++) {
      const x = (pxx + 0.5) * k;
      const lane = sLane(x, z);
      const river = sRiver(x, z);
      const wall = sWall(x, z);
      const blue = sBlue(x, z);
      const red = sRed(x, z);
      const n1 = fbm(x * 0.09, z * 0.09);
      const n2 = fine(x | 0, z | 0) * 0.5 + fine((x * 3) | 0, (z * 3) | 0) * 0.5;

      // Gras / Jungleboden
      let col = mix(C.grassA, C.grassB, Math.min(1, n1 * 1.2));
      col = mix(col, C.grassDry, sstep(0.6, 0.8, fbm(x * 0.05 + 30, z * 0.05)) * 0.6);
      const jungle = 1 - Math.max(lane, blue, red);
      col = mix(col, mix(C.jungleA, C.jungleB, n2), jungle * 0.45);
      col = mix(col, C.moss, sstep(0.55, 0.75, n2) * 0.25);

      // Lane: Erde mit hellerer Mitte
      if (lane > 0.01) {
        let dirt = mix(C.dirtDark, C.dirt, sstep(0.0, 0.5, lane));
        dirt = mix(dirt, C.dirtLight, sstep(0.6, 1.0, lane) * (0.4 + n2 * 0.5));
        col = mix(col, dirt, sstep(0.05, 0.55, lane + (n2 - 0.5) * 0.25));
      }
      // Fluss
      if (river > 0.01) {
        const bed = mix(C.sand, C.riverBed, sstep(0.05, 0.4, river));
        col = mix(col, mix(bed, C.riverDeep, sstep(0.5, 1, river)), sstep(0.0, 0.25, river));
      }
      // Basen: Steinplatten
      const base = Math.max(blue, red);
      if (base > 0.01) {
        const stone = blue > red ? C.stoneBlue : C.stoneRed;
        const tx = x / 3.2;
        const tz = z / 3.2;
        const fx = tx - Math.floor(tx);
        const fz = tz - Math.floor(tz);
        const seam = fx < 0.05 || fz < 0.05 ? 0.55 : 1;
        let s = mix(C.stoneDark, stone, 0.65 + n2 * 0.35);
        s = [s[0] * seam, s[1] * seam, s[2] * seam];
        col = mix(col, s, sstep(0.3, 0.8, base));
      }
      // Wald und Felskanten
      if (wall > 0.01) {
        const depth = sDepth(x, z);
        const cliffT = sstep(0.0, 0.6, wall) * (1 - sstep(1.5, 3, depth));
        let w = mix(C.cliff, C.cliffDark, n2);
        col = mix(col, w, cliffT);
        w = mix(C.forest, C.jungleA, n2 * 0.5);
        col = mix(col, w, sstep(1.2, 2.6, depth));
      }
      // Umgebungsverdeckung am Fuß der Wände
      const clear = sClear(x, z);
      const ao = wall < 0.5 ? 0.72 + 0.28 * sstep(0, 2.5, clear) : 1;
      const shade = ao * (0.93 + n2 * 0.14);
      const o = (py * size + pxx) * 4;
      px[o] = Math.min(255, col[0] * shade);
      px[o + 1] = Math.min(255, col[1] * shade);
      px[o + 2] = Math.min(255, col[2] * shade);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const S = size / MAP;
  const rand = rng(77);
  // Grasbüschel
  ctx.lineCap = "round";
  for (let i = 0; i < size * 6; i++) {
    const x = rand() * MAP;
    const z = rand() * MAP;
    if (!grid.isOpen(x, z) || sLane(x, z) > 0.4 || sRiver(x, z) > 0.1 || sBlue(x, z) + sRed(x, z) > 0.2) continue;
    const g = 70 + rand() * 70;
    ctx.strokeStyle = `rgba(${g * 0.55},${g + 30},${g * 0.4},${0.25 + rand() * 0.3})`;
    ctx.lineWidth = S * 0.12;
    ctx.beginPath();
    ctx.moveTo(x * S, z * S);
    ctx.lineTo((x + (rand() - 0.5) * 0.5) * S, (z - 0.4 - rand() * 0.4) * S);
    ctx.stroke();
  }
  // Blumen
  const flowers = ["#f4e46a", "#ffffff", "#c88cff", "#ff8fb0"];
  for (let i = 0; i < size * 0.8; i++) {
    const x = rand() * MAP;
    const z = rand() * MAP;
    if (!grid.isOpen(x, z) || sLane(x, z) > 0.2 || sRiver(x, z) > 0.05 || sBlue(x, z) + sRed(x, z) > 0.1) continue;
    ctx.fillStyle = flowers[(rand() * flowers.length) | 0];
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(x * S, z * S, S * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Pflastersteine auf den Lanes
  for (const id of ["top", "mid", "bot"] as LaneId[]) {
    const pts = LANES[id];
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      for (let d = 0; d < len; d += 0.9) {
        for (let k2 = 0; k2 < 2; k2++) {
          const off = (rand() - 0.5) * LANE_WIDTH[id] * 0.55;
          const x = a.x + ((b.x - a.x) * d) / len + nx * off;
          const z = a.z + ((b.z - a.z) * d) / len + nz * off;
          if (rand() < 0.45) continue;
          const w = 0.5 + rand() * 0.5;
          const l = 70 + rand() * 50;
          ctx.fillStyle = `rgba(${l + 60},${l + 45},${l + 20},0.35)`;
          ctx.strokeStyle = "rgba(50,38,25,0.35)";
          ctx.lineWidth = S * 0.06;
          ctx.save();
          ctx.translate(x * S, z * S);
          ctx.rotate(rand() * Math.PI);
          ctx.beginPath();
          ctx.roundRect(-w * S * 0.5, -w * S * 0.35, w * S, w * S * 0.7, S * 0.15);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }
  // Runenkreise in den Basen
  const runes = (x: number, z: number, r: number, color: string) => {
    ctx.strokeStyle = color;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.55 - i * 0.12;
      ctx.lineWidth = S * (0.35 - i * 0.08);
      ctx.beginPath();
      ctx.arc(x * S, z * S, (r + i * 1.3) * S, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc((x + Math.cos(a) * (r + 0.65)) * S, (z + Math.sin(a) * (r + 0.65)) * S, S * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  for (const s of STRUCTURES) {
    if (s.kind === "nexus") runes(s.pos.x, s.pos.z, 5.5, s.team === 0 ? "#8fd8ff" : "#ff9a7a");
    if (s.kind === "inhib") runes(s.pos.x, s.pos.z, 3, s.team === 0 ? "#8fd8ff" : "#ff9a7a");
  }
  FOUNTAIN.forEach((f, i) => runes(f.x, f.z, 6, i === 0 ? "#bff0ff" : "#ffc0a0"));
  // Gruben von Baron und Drache
  const pit = (p: { x: number; z: number }, c: string) => {
    const g = ctx.createRadialGradient(p.x * S, p.z * S, 0, p.x * S, p.z * S, 9 * S);
    g.addColorStop(0, c);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x * S, p.z * S, 9 * S, 0, Math.PI * 2);
    ctx.fill();
  };
  pit(BARON_POS, "rgba(90,50,130,0.55)");
  pit(DRAGON_POS, "rgba(130,70,30,0.5)");
  // Camp-Lichtungen leicht erdig
  for (const c of CAMPS) {
    if (c.kind === "baron" || c.kind === "dragon" || c.kind === "scuttle") continue;
    const g = ctx.createRadialGradient(c.pos.x * S, c.pos.z * S, 0, c.pos.x * S, c.pos.z * S, 5 * S);
    g.addColorStop(0, "rgba(110,90,60,0.45)");
    g.addColorStop(1, "rgba(110,90,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.pos.x * S, c.pos.z * S, 5 * S, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function groundGeometry(grid: NavGrid) {
  const n = grid.n;
  const w = n + 1;
  const pos = new Float32Array(w * w * 3);
  const uv = new Float32Array(w * w * 2);
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      const i = z * w + x;
      pos[i * 3] = x;
      pos[i * 3 + 1] = grid.heights[i];
      pos[i * 3 + 2] = z;
      uv[i * 2] = x / n;
      uv[i * 2 + 1] = z / n;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let o = 0;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * w + x;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/** Fügt einer Geometrie eine einfarbige Vertex-Farbe hinzu. */
export function colored(geo: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute("uv");
  if (m) g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function mat4(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
}

function treeGeometry(kind: number) {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 0) {
    // runder Laubbaum
    parts.push(colored(new THREE.CylinderGeometry(0.18, 0.3, 1.6, 5), 0x5a3f28, mat4(0, 0.8, 0)));
    parts.push(colored(new THREE.IcosahedronGeometry(1.25, 0), 0x2a6036, mat4(0, 2.3, 0, 1, 0.85, 1)));
    parts.push(colored(new THREE.IcosahedronGeometry(0.95, 0), 0x357544, mat4(0.55, 2.9, 0.2, 1, 0.85, 1, 0.3, 0.5)));
    parts.push(colored(new THREE.IcosahedronGeometry(0.85, 0), 0x2a5e3a, mat4(-0.5, 2.7, -0.35, 1, 0.85, 1, 0.2, 1)));
  } else if (kind === 1) {
    // Nadelbaum
    parts.push(colored(new THREE.CylinderGeometry(0.15, 0.25, 1.2, 5), 0x4a3424, mat4(0, 0.6, 0)));
    parts.push(colored(new THREE.ConeGeometry(1.25, 2.0, 7), 0x24563a, mat4(0, 1.9, 0)));
    parts.push(colored(new THREE.ConeGeometry(0.95, 1.7, 7), 0x2c6845, mat4(0, 2.8, 0)));
    parts.push(colored(new THREE.ConeGeometry(0.6, 1.3, 7), 0x347a50, mat4(0, 3.6, 0)));
  } else {
    // große Krone für das Innere des Waldes
    parts.push(colored(new THREE.IcosahedronGeometry(1.6, 0), 0x22502c, mat4(0, 1.9, 0, 1.1, 0.8, 1.1)));
    parts.push(colored(new THREE.IcosahedronGeometry(1.2, 0), 0x2d6236, mat4(0.8, 2.5, 0.3, 1, 0.8, 1, 0.4, 0.3)));
    parts.push(colored(new THREE.IcosahedronGeometry(1.1, 0), 0x1f4a30, mat4(-0.7, 2.3, -0.4, 1, 0.8, 1, 0.1, 1.2)));
  }
  return mergeGeometries(parts)!;
}

export type Terrain = {
  group: THREE.Group;
  water: THREE.ShaderMaterial;
  brush: THREE.InstancedMesh;
  update: (t: number) => void;
};

export function buildTerrain(grid: NavGrid, quality: Quality, fog: FogOfWar): Terrain {
  const group = new THREE.Group();
  const size = quality === "high" ? 2048 : 1024;

  // Boden
  const tex = new THREE.CanvasTexture(paintGround(grid, size));
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  const groundMat = new THREE.MeshLambertMaterial({ map: tex });
  fog.patch(groundMat);
  const ground = new THREE.Mesh(groundGeometry(grid), groundMat);
  ground.receiveShadow = true;
  ground.name = "ground";
  group.add(ground);

  // Waldboden außerhalb der Karte
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x1c3018 });
  const B = 80;
  for (const [x, z, w, d] of [
    [MAP / 2, -B / 2, MAP + 2 * B, B],
    [MAP / 2, MAP + B / 2, MAP + 2 * B, B],
    [-B / 2, MAP / 2, B, MAP],
    [MAP + B / 2, MAP / 2, B, MAP],
  ]) {
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(w, d), skirtMat);
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.set(x, 2.6, z);
    group.add(skirt);
  }

  // Wasser
  const mask = new Uint8Array(grid.n * grid.n);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.min(255, grid.river[i] * 255);
  const maskTex = new THREE.DataTexture(mask, grid.n, grid.n, THREE.RedFormat, THREE.UnsignedByteType);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.needsUpdate = true;
  const water = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uMask: { value: maskTex },
      uFogTex: fog.uniforms.uFogTex,
      uFogOn: fog.uniforms.uFogOn,
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uMask;
      uniform sampler2D uFogTex;
      uniform float uFogOn;
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        float m = texture2D(uMask, vW.xz / ${MAP.toFixed(1)}).r;
        if (m < 0.04) discard;
        vec2 p = vW.xz;
        float w1 = sin(p.x * 0.9 + uTime * 1.4 + sin(p.y * 0.45 + uTime * 0.3) * 2.0);
        float w2 = sin(p.y * 1.2 - uTime * 1.1 + sin(p.x * 0.35) * 1.7);
        float w3 = sin((p.x + p.y) * 0.6 + uTime * 0.8);
        float r = (w1 + w2 + w3) / 6.0 + 0.5;
        vec3 deep = vec3(0.07, 0.30, 0.40);
        vec3 shallow = vec3(0.22, 0.58, 0.62);
        vec3 col = mix(shallow, deep, smoothstep(0.35, 1.0, m));
        col += pow(r, 7.0) * 0.45;
        float foam = smoothstep(0.12, 0.0, abs(m - 0.2)) * (0.55 + 0.45 * sin(uTime * 2.0 + p.x * 0.7 + p.y * 0.5));
        col = mix(col, vec3(0.86, 0.96, 0.95), foam * 0.4);
        float a = smoothstep(0.04, 0.35, m) * 0.86;
        float fv = texture2D(uFogTex, vW.xz / ${MAP.toFixed(1)}).r;
        vec3 fogged = col * vec3(0.38, 0.42, 0.55);
        col = mix(col, mix(fogged, col, fv), uFogOn);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP, MAP), water);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(MAP / 2, -0.32, MAP / 2);
  waterMesh.renderOrder = 2;
  group.add(waterMesh);

  // Bäume (in Kacheln, damit die Kamera unsichtbare Teile weglassen kann)
  const rand = rng(1234);
  const CH = 4;
  const chunkSize = MAP / CH;
  type Inst = { m: THREE.Matrix4; c: THREE.Color };
  const buckets: Inst[][][] = [[], [], []].map(() => Array.from({ length: CH * CH }, () => []));
  const step = quality === "high" ? 1.9 : 2.3;
  const tmpC = new THREE.Color();
  for (let gz = 0; gz < MAP; gz += step) {
    for (let gx = 0; gx < MAP; gx += step) {
      const x = gx + rand() * step;
      const z = gz + rand() * step;
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!grid.inBounds(cx, cz)) continue;
      const i = cz * grid.n + cx;
      if (grid.walk[i]) continue;
      const depth = grid.wallDepth[i];
      if (depth < 0.9) continue;
      let kind = rand() < 0.22 ? 1 : 0;
      if (depth > 6) {
        if (rand() < 0.55) continue;
        kind = 2;
      }
      const h = grid.heightAt(x, z) - 0.2;
      const s = (kind === 2 ? 1.4 : 0.85) + rand() * 0.45;
      const m = mat4(x, h, z, s, s * (0.9 + rand() * 0.3), s, 0, rand() * Math.PI * 2, 0);
      const tint = 0.78 + rand() * 0.35;
      tmpC.setRGB(tint * (0.95 + rand() * 0.1), tint, tint * (0.9 + rand() * 0.2));
      const ci = Math.min(CH - 1, Math.floor(x / chunkSize)) + Math.min(CH - 1, Math.floor(z / chunkSize)) * CH;
      buckets[kind][ci].push({ m, c: tmpC.clone() });
    }
  }
  // Waldgürtel rund um die Karte
  for (let i = 0; i < (quality === "high" ? 900 : 550); i++) {
    const side = (rand() * 4) | 0;
    const along = -20 + rand() * (MAP + 40);
    const out = rand() * 22;
    const x = side === 0 ? -out : side === 1 ? MAP + out : along;
    const z = side === 2 ? -out : side === 3 ? MAP + out : along;
    const s = 1.3 + rand() * 0.6;
    const m = mat4(x, 2.2, z, s, s * (0.9 + rand() * 0.3), s, 0, rand() * Math.PI * 2, 0);
    const tint = 0.7 + rand() * 0.3;
    tmpC.setRGB(tint, tint, tint);
    const cx = Math.max(0, Math.min(CH - 1, Math.floor(x / chunkSize)));
    const cz = Math.max(0, Math.min(CH - 1, Math.floor(z / chunkSize)));
    buckets[2][cx + cz * CH].push({ m, c: tmpC.clone() });
  }
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  fog.patch(treeMat);
  const geos = [treeGeometry(0), treeGeometry(1), treeGeometry(2)];
  for (let kind = 0; kind < 3; kind++) {
    for (const list of buckets[kind]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[kind], treeMat, list.length);
      list.forEach((inst, j) => {
        im.setMatrixAt(j, inst.m);
        im.setColorAt(j, inst.c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = quality === "high" && kind !== 2;
      im.receiveShadow = false;
      group.add(im);
    }
  }

  // Felsen an den Kanten
  const rocks: THREE.Matrix4[] = [];
  for (let i = 0; i < 2600; i++) {
    const x = rand() * MAP;
    const z = rand() * MAP;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!grid.inBounds(cx, cz)) continue;
    const ci = cz * grid.n + cx;
    if (grid.walk[ci] || grid.wallDepth[ci] > 1.6) continue;
    const s = 0.45 + rand() * 0.8;
    rocks.push(mat4(x, grid.heightAt(x, z) - 0.3 * s, z, s * (1 + rand() * 0.6), s * (0.6 + rand() * 0.6), s, rand(), rand() * 6, rand()));
  }
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x7a7262 });
  fog.patch(rockMat);
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat, rocks.length);
  rocks.forEach((m, j) => rockMesh.setMatrixAt(j, m));
  rockMesh.instanceMatrix.needsUpdate = true;
  rockMesh.computeBoundingSphere();
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // Büsche: hohes Gras
  const bladeGeo = mergeGeometries([
    colored(new THREE.ConeGeometry(0.16, 1.5, 3), 0x2c7a4a, mat4(0, 0.75, 0)),
    colored(new THREE.ConeGeometry(0.14, 1.25, 3), 0x3a9050, mat4(0.18, 0.62, 0.1, 1, 1, 1, 0.2, 0, -0.25)),
    colored(new THREE.ConeGeometry(0.13, 1.1, 3), 0x246a40, mat4(-0.15, 0.55, -0.1, 1, 1, 1, -0.2, 0, 0.3)),
  ])!;
  const blades: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  for (const b of BRUSHES) {
    const count = Math.round(b.r * b.r * 7);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * b.r;
      const x = b.p.x + Math.cos(a) * r;
      const z = b.p.z + Math.sin(a) * r;
      const s = 0.8 + rand() * 0.5;
      const tint = 0.8 + rand() * 0.35;
      blades.push({ m: mat4(x, grid.groundAt(x, z), z, s, s * (0.9 + rand() * 0.4), s, 0, rand() * 6, 0), c: new THREE.Color(tint, tint, tint) });
    }
  }
  const brushMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  fog.patch(brushMat);
  const brush = new THREE.InstancedMesh(bladeGeo, brushMat, blades.length);
  blades.forEach((b, j) => {
    brush.setMatrixAt(j, b.m);
    brush.setColorAt(j, b.c);
  });
  brush.instanceMatrix.needsUpdate = true;
  brush.computeBoundingSphere();
  group.add(brush);

  // Kleine Steinsäulen entlang der Lanes (Laternen)
  const lampGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.25, 0.35, 1.4, 6), 0x6d6a62, mat4(0, 0.7, 0)),
    colored(new THREE.CylinderGeometry(0.4, 0.3, 0.25, 6), 0x55524a, mat4(0, 1.5, 0)),
  ])!;
  const lamps: THREE.Matrix4[] = [];
  const lampGlow: THREE.Vector3[] = [];
  for (const id of ["top", "mid", "bot"] as LaneId[]) {
    const pts = LANES[id];
    for (let s = 1; s < pts.length - 2; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      for (let d = 12; d < len - 6; d += 22) {
        for (const side of [-1, 1]) {
          const off = (LANE_WIDTH[id] / 2 + 0.6) * side;
          const x = a.x + ((b.x - a.x) * d) / len + nx * off;
          const z = a.z + ((b.z - a.z) * d) / len + nz * off;
          if (!grid.isOpen(x, z) || distToPolyline({ x, z }, LANES[id]) < LANE_WIDTH[id] / 2) continue;
          lamps.push(mat4(x, grid.groundAt(x, z), z));
          lampGlow.push(new THREE.Vector3(x, grid.groundAt(x, z) + 1.85, z));
        }
      }
    }
  }
  const lampMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  fog.patch(lampMat);
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
  lamps.forEach((m, j) => lampMesh.setMatrixAt(j, m));
  lampMesh.instanceMatrix.needsUpdate = true;
  lampMesh.computeBoundingSphere();
  lampMesh.castShadow = true;
  group.add(lampMesh);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc870 });
  const glowMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.22, 0), glowMat, lampGlow.length);
  lampGlow.forEach((p, j) => glowMesh.setMatrixAt(j, mat4(p.x, p.y, p.z)));
  glowMesh.instanceMatrix.needsUpdate = true;
  glowMesh.computeBoundingSphere();
  group.add(glowMesh);

  return {
    group,
    water,
    brush,
    update: (t: number) => {
      water.uniforms.uTime.value = t;
    },
  };
}
