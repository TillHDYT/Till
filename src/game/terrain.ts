import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { addCutUniforms } from "./camcut";
import type { FogOfWar } from "./fog";
import { BARON_POS, BRUSHES, CAMPS, CAMP_PIT, DRAGON_POS, FOUNTAIN, LANES, LANE_WIDTH, MAP, STRUCTURES, distToPolyline, type LaneId } from "./mapdata";
import { campDist, campShape, fbm, noise2, rng, type NavGrid } from "./navgrid";
import grassUrl from "../assets/grass.jpg";
import leavesUrl from "../assets/leaves.png";
import pathUrl from "../assets/path.jpg";
import baseFloorUrl from "../assets/base_floor.jpg";
import pineUrl from "../assets/pine.png";
import rockUrl from "../assets/rock.jpg";
import stoneUrl from "../assets/stone.jpg";
import tallgrassUrl from "../assets/tallgrass.png";
import waterAtlasUrl from "../assets/water_atlas.jpg";

export type Quality = "high" | "low";
/** Höhe der Wasseroberfläche im Fluss: knapp über dem Flussbett (Höhe 0), sonst verdeckt der Boden das Wasser. */
export const WATER_Y = 0.05;

/** Bäume nahe der Kamera und zwischen Kamera und Champion in der Nahansicht ausblenden (siehe camcut.ts). */
const cutPatch = (shader: THREE.WebGLProgramParametersWithUniforms) => addCutUniforms(shader, "vFogW");

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
  const blueArr = new Float32Array(n * n);
  const redArr = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    blueArr[i] = grid.base[i] === 0 ? 1 : 0;
    redArr[i] = grid.base[i] === 1 ? 1 : 0;
  }
  const sLane = sampler(grid, grid.lane);
  const sRiver = sampler(grid, grid.river);
  const sBlue = sampler(grid, blueArr);
  const sRed = sampler(grid, redArr);
  const sSd = sampler(grid, grid.sdf);

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
      const sd = sSd(x, z) + (fine((x * 0.7) | 0, (z * 0.7) | 0) - 0.5) * 0.6;
      const wall = sstep(0.3, -0.4, sd);
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
        const depth = Math.max(0, -sd);
        const cliffT = wall * (1 - sstep(1.2, 2.4, depth));
        let w = mix(C.cliff, C.cliffDark, n2);
        col = mix(col, w, cliffT);
        w = mix(C.forest, C.jungleA, n2 * 0.5);
        col = mix(col, w, sstep(1.2, 2.4, depth));
      }
      // Umgebungsverdeckung am Fuß der Wände
      const ao = 0.72 + 0.28 * sstep(0, 2.5, sd);
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
  // Böden der Camps: erdiger Fleck mit unregelmäßigem Rand (siehe CAMP_PIT, campShape)
  for (const c of CAMPS) {
    const r = CAMP_PIT[c.kind];
    if (!r) continue;
    const R = r + 0.9;
    const g = ctx.createRadialGradient(c.pos.x * S, c.pos.z * S, 0, c.pos.x * S, c.pos.z * S, R * 1.3 * S);
    g.addColorStop(0, "rgba(92,72,48,0.62)");
    g.addColorStop(0.55, "rgba(104,82,54,0.5)");
    g.addColorStop(1, "rgba(110,90,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const rr = R * campShape(c.pos, c.pos.x + Math.cos(a), c.pos.z + Math.sin(a));
      const px = (c.pos.x + Math.cos(a) * rr) * S;
      const pz = (c.pos.z + Math.sin(a) * rr) * S;
      if (k) ctx.lineTo(px, pz);
      else ctx.moveTo(px, pz);
    }
    ctx.fill();
  }
  return canvas;
}

/** Maske für die Grastextur: R = Grasanteil, G = Helligkeit, B = grobes Rauschen. */
function groundMask(grid: NavGrid, res: number) {
  const n = grid.n;
  const baseArr = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) baseArr[i] = grid.base[i] >= 0 ? 1 : 0;
  const sLane = sampler(grid, grid.lane);
  const sRiver = sampler(grid, grid.river);
  const sBase = sampler(grid, baseArr);
  const data = new Uint8Array(res * res * 4);
  const k = MAP / res;
  for (let py = 0; py < res; py++) {
    const z = (py + 0.5) * k;
    for (let px = 0; px < res; px++) {
      const x = (px + 0.5) * k;
      const jit = (fbm(x * 0.35, z * 0.35) - 0.5) * 0.35;
      const lane = sLane(x, z);
      const river = sRiver(x, z);
      const base = sBase(x, z);
      const sd = grid.sdAt(x, z);
      const wall = sstep(0.2, -0.6, sd);
      const grass = (1 - sstep(0.12, 0.55, lane + jit)) * (1 - sstep(0.0, 0.3, river + jit * 0.5)) * (1 - sstep(0.1, 0.5, base));
      // Fuß der Wände: weicher, breiter Schatten (wie auf der Kluft), oben auf dem Wald dunkler Waldboden
      let shade = 0.6 + 0.4 * sstep(0, 4.5, sd + jit * 2);
      shade = shade * (1 - wall) + 0.5 * wall;
      shade *= 0.9 + fbm(x * 0.06 + 11, z * 0.06) * 0.2;
      // Böden der Camps: Erdboden (Wegtextur) mit unregelmäßigem Rand, etwas dunkler zur Mitte
      let pitFloor = 0;
      for (const c of CAMPS) {
        const r = CAMP_PIT[c.kind];
        if (!r || Math.hypot(x - c.pos.x, z - c.pos.z) > r * 1.4) continue;
        const d = campDist(c.pos, x, z) + jit * 1.6;
        pitFloor = Math.max(pitFloor, 1 - sstep(r * 0.7, r * 0.95, d));
        shade *= 0.82 + 0.18 * sstep(0, r, d);
      }
      // Dschungelwege: Erde mit Steinplatten in der Mitte der Gänge, läuft von den Lanes in den Dschungel hinein;
      // zu den Mauern hin wieder Gras (wie auf der Kluft statt Gras bis an die Kante)
      const trail = sstep(2.4, 4.6, sd + (fbm(x * 0.09 + 7, z * 0.09 + 3) - 0.5) * 3.2 + jit * 2);
      const dirt = trail * (1 - sstep(0.05, 0.35, river)) * (1 - sstep(0.1, 0.5, base)) * (1 - wall) * 0.9;
      const o = (py * res + px) * 4;
      data[o] = Math.round(Math.max(0, Math.min(1, grass * (1 - pitFloor) * (1 - dirt))) * 255);
      data[o + 1] = Math.round(Math.max(0, Math.min(1, shade)) * 255);
      // B: Weg (Lane), A: Steinboden der Basis
      const laneW = sstep(0.2, 0.6, lane + jit * 0.8) * (1 - sstep(0.1, 0.5, base)) * (1 - sstep(0.15, 0.5, river));
      data[o + 2] = Math.round(Math.max(laneW * (1 - wall), pitFloor, dirt) * 255);
      data[o + 3] = Math.round(sstep(0.15, 0.75, base + jit * 0.9) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Länge einer Kachel der Wegtextur entlang der Lane und Breite, über die sie quer reicht (Einheiten). */
const PATH_TILE = 15;

/** Bereich quer zur Lane (±halb, Einheiten), den die Lane-Koordinaten abdecken; weiter außen zählt die Lane nicht. */
const LANE_ACROSS = 40;

/** Ecken abrunden (Chaikin), damit die Wegtextur in den Lane-Kurven nicht springt. */
function smoothLine(pts: { x: number; z: number }[], iter = 3) {
  let p = pts;
  for (let k = 0; k < iter; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/**
 * Lane-Koordinaten für die Wegtextur: R/G = Lage entlang der Lane als Winkel (cos/sin, damit das Wiederholen beim
 * Filtern keine Naht gibt), B = Lage quer zur Lane (0..1 über PATH_TILE, Mitte 0.5).
 */
function laneCoords(grid: NavGrid, res: number) {
  const lines = (["top", "mid", "bot"] as LaneId[]).map((id) => {
    const pts = smoothLine(LANES[id]);
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return { pts, acc };
  });
  const sLane = sampler(grid, grid.lane);
  const data = new Uint8Array(res * res * 4);
  const k = MAP / res;
  for (let py = 0; py < res; py++) {
    const z = (py + 0.5) * k;
    for (let px = 0; px < res; px++) {
      const x = (px + 0.5) * k;
      const o = (py * res + px) * 4;
      const lw = sLane(x, z);
      if (lw < 0.005) continue;
      let best = Infinity;
      let along = 0;
      let across = 0;
      for (const { pts, acc } of lines) {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const dx = pts[i + 1].x - a.x;
          const dz = pts[i + 1].z - a.z;
          const len = acc[i + 1] - acc[i];
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (len * len)));
          const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
          if (d < best) {
            best = d;
            along = acc[i] + t * len;
            across = ((x - a.x) * dz - (z - a.z) * dx) / len;
          }
        }
      }
      const ang = (along / PATH_TILE) * Math.PI * 2;
      data[o] = Math.round((Math.cos(ang) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((Math.sin(ang) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(Math.max(0, Math.min(1, 0.5 + across / LANE_ACROSS)) * 255);
      // A: wie stark die Lane-Ausrichtung gilt (weich auslaufend, außen Welt-Ausrichtung, keine Naht)
      data[o + 3] = Math.round(Math.min(1, (lw - 0.005) / 0.3) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Kantenlänge des Basisbodens (Einheiten), er liegt in der Ecke x 0.., z ..MAP (siehe assets-src/base-floor). */
const BASE_FLOOR_SIZE = (128 * MAP) / 300;

function loadBaseFloor(): THREE.Texture {
  const t = new THREE.TextureLoader().load(baseFloorUrl);
  t.flipY = false;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function mirroredT(t: THREE.Texture) {
  t.wrapT = THREE.MirroredRepeatWrapping;
  return t;
}

/** Läd die gemalte Grastextur (kachelbar). */
export function loadGrass(url: string = grassUrl): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Boden in Kacheln, damit die Kamera nicht sichtbare Teile weglassen kann. Normalen aus dem Höhenfeld, damit keine Nähte entstehen. */
function groundTiles(grid: NavGrid, tiles: number) {
  const R = grid.hres;
  const n = grid.n * R;
  const w = n + 1;
  const H = grid.heights;
  const hAt = (x: number, z: number) => H[Math.max(0, Math.min(n, z)) * w + Math.max(0, Math.min(n, x))];
  const per = n / tiles;
  const out: THREE.BufferGeometry[] = [];
  for (let tz = 0; tz < tiles; tz++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x0 = tx * per;
      const z0 = tz * per;
      const vw = per + 1;
      const pos = new Float32Array(vw * vw * 3);
      const nor = new Float32Array(vw * vw * 3);
      const uv = new Float32Array(vw * vw * 2);
      for (let j = 0; j < vw; j++) {
        for (let i = 0; i < vw; i++) {
          const gx = x0 + i;
          const gz = z0 + j;
          const k = j * vw + i;
          pos[k * 3] = gx / R;
          pos[k * 3 + 1] = hAt(gx, gz);
          pos[k * 3 + 2] = gz / R;
          const nx = (hAt(gx - 1, gz) - hAt(gx + 1, gz)) * R * 0.5;
          const nz = (hAt(gx, gz - 1) - hAt(gx, gz + 1)) * R * 0.5;
          const l = Math.hypot(nx, 1, nz);
          nor[k * 3] = nx / l;
          nor[k * 3 + 1] = 1 / l;
          nor[k * 3 + 2] = nz / l;
          uv[k * 2] = gx / n;
          uv[k * 2 + 1] = gz / n;
        }
      }
      const idx = new Uint32Array(per * per * 6);
      let o = 0;
      for (let j = 0; j < per; j++) {
        for (let i = 0; i < per; i++) {
          const p = j * vw + i;
          idx[o++] = p;
          idx[o++] = p + vw;
          idx[o++] = p + 1;
          idx[o++] = p + 1;
          idx[o++] = p + vw;
          idx[o++] = p + vw + 1;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      out.push(g);
    }
  }
  return out;
}

/** Fügt einer Geometrie eine einfarbige Vertex-Farbe hinzu. */
export function colored(geo: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
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

function texture(url: string, repeat: boolean) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

type GeoArrays = { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] };

function toGeometry(a: GeoArrays) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(a.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(a.col, 3));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  return g;
}

/** Nadelbaum: hängende Zweigkränze übereinander, Kanten aus der Nadeltextur (Alpha). */
function pineFoliage(tiers: number, seg: number) {
  const a: GeoArrays = { pos: [], nor: [], uv: [], col: [], idx: [] };
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const y0 = 1.5 + t * 0.95;
    const R = 2.0 * (1 - k) + 0.55;
    const drop = 0.95 + 0.3 * (1 - k);
    const rings = [
      { r: 0.08, y: y0 + 0.6, v: 1.0, c: 0.55 },
      { r: R * 0.55, y: y0 - drop * 0.18, v: 0.5, c: 0.8 },
      { r: R, y: y0 - drop, v: 0.02, c: 1.0 },
    ];
    const base = a.pos.length / 3;
    const rot = t * 0.9;
    rings.forEach((ring, ri) => {
      for (let j = 0; j <= seg; j++) {
        const ang = (j / seg) * Math.PI * 2 + rot;
        const wob = ri === 2 ? 1 + 0.13 * Math.sin(ang * 5 + t * 2) : 1;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        a.pos.push(ca * ring.r * wob, ring.y + (ri === 2 ? 0.12 * Math.sin(ang * 3 + t) : 0), sa * ring.r * wob);
        a.nor.push(ca * 0.72, 0.7, sa * 0.72);
        a.uv.push((j / seg) * 3, ring.v);
        a.col.push(ring.c, ring.c, ring.c);
      }
    });
    for (let ri = 0; ri < 2; ri++) {
      for (let j = 0; j < seg; j++) {
        const p = base + ri * (seg + 1) + j;
        const q = p + seg + 1;
        a.idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
  }
  return toGeometry(a);
}

/** Laubbaum: Krone aus vielen Blattbüschel-Flächen, Normalen kugelförmig für weiche Schattierung. */
function broadFoliage(seed: number) {
  const rand = rng(seed);
  const a: GeoArrays = { pos: [], nor: [], uv: [], col: [], idx: [] };
  const blobs = [
    { c: new THREE.Vector3(0, 3.3, 0), r: 1.75 },
    { c: new THREE.Vector3(0.95, 4.0, 0.35), r: 1.3 },
    { c: new THREE.Vector3(-0.85, 3.9, -0.45), r: 1.25 },
    { c: new THREE.Vector3(0.1, 4.75, -0.1), r: 1.05 },
  ];
  const dir = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (const b of blobs) {
    const count = Math.round(b.r * 10);
    for (let i = 0; i < count; i++) {
      dir.set(rand() * 2 - 1, rand() * 1.6 - 0.45, rand() * 2 - 1).normalize();
      const p = b.c.clone().addScaledVector(dir, b.r * (0.5 + rand() * 0.42));
      t1.set(0, 1, 0).cross(dir);
      if (t1.lengthSq() < 0.01) t1.set(1, 0, 0);
      t1.normalize();
      t2.copy(dir).cross(t1).normalize();
      const rot = rand() * Math.PI * 2;
      const e1 = t1.clone().multiplyScalar(Math.cos(rot)).addScaledVector(t2, Math.sin(rot));
      const e2 = dir.clone().cross(e1).normalize();
      const sz = b.r * (0.95 + rand() * 0.45);
      const base = a.pos.length / 3;
      const corners = [
        [-1, -1, 0, 0],
        [1, -1, 1, 0],
        [1, 1, 1, 1],
        [-1, 1, 0, 1],
      ];
      for (const [cx, cy, u, w] of corners) {
        v.copy(p).addScaledVector(e1, (cx * sz) / 2).addScaledVector(e2, (cy * sz) / 2);
        a.pos.push(v.x, v.y, v.z);
        nrm.copy(v).sub(b.c).normalize();
        a.nor.push(nrm.x, nrm.y, nrm.z);
        a.uv.push(u, w);
        const sh = 0.55 + 0.45 * Math.max(0, Math.min(1, (v.y - b.c.y) / b.r * 0.6 + 0.55));
        a.col.push(sh, sh, sh);
      }
      a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return toGeometry(a);
}

/** Abgerundeter Felsbrocken mit Moos oben. */
function boulderGeometry(seed: number) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = noise2(x * 1.6 + seed, z * 1.6 + y) * 0.6 + noise2(y * 2.3 + seed * 3, x * 2.3) * 0.4;
    let f = 0.78 + n * 0.44;
    let ny = y * f;
    if (ny < -0.25) ny = -0.25 + (ny + 0.25) * 0.3;
    f *= 1.0;
    p.setXYZ(i, x * f * 1.15, ny * 0.8, z * f);
  }
  g.computeVertexNormals();
  const nr = g.getAttribute("normal") as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const moss = Math.max(0, Math.min(1, (nr.getY(i) - 0.55) / 0.3));
    col[i * 3] = 1.25 + (0.6 - 1.25) * moss;
    col[i * 3 + 1] = 1.18 + (0.95 - 1.18) * moss;
    col[i * 3 + 2] = 1.08 + (0.4 - 1.08) * moss;
    uv[i * 2] = (p.getX(i) + p.getZ(i)) * 0.45;
    uv[i * 2 + 1] = p.getY(i) * 0.6;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Hohes Gras: drei gekreuzte Flächen mit gemalten Halmen. */
function grassClumpGeometry() {
  const a: GeoArrays = { pos: [], nor: [], uv: [], col: [], idx: [] };
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI;
    const dx = Math.cos(ang) * 0.85;
    const dz = Math.sin(ang) * 0.85;
    const base = a.pos.length / 3;
    const verts = [
      [-dx, 0, -dz, 0, 0, 0.5],
      [dx, 0, dz, 1, 0, 0.5],
      [dx, 1.55, dz, 1, 1, 1.05],
      [-dx, 1.55, -dz, 0, 1, 1.05],
    ];
    for (const [x, y, z, u, w, c] of verts) {
      a.pos.push(x, y, z);
      a.nor.push(0, 1, 0);
      a.uv.push(u, w);
      a.col.push(c, c, c);
    }
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return toGeometry(a);
}

export type Terrain = {
  group: THREE.Group;
  water: THREE.ShaderMaterial;
  brush: THREE.InstancedMesh;
  update: (t: number) => void;
};

export function buildTerrain(grid: NavGrid, quality: Quality, fog: FogOfWar): Terrain {
  const group = new THREE.Group();
  const high = quality === "high";
  const size = high ? 2048 : 1024;
  const timeU = { value: 0 };

  // Boden
  const tex = new THREE.CanvasTexture(paintGround(grid, size));
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  const groundMat = new THREE.MeshLambertMaterial({ map: tex });
  const grassUniforms = {
    uGrass: { value: loadGrass() },
    uPath: { value: mirroredT(loadGrass(pathUrl)) },
    uStone: { value: loadGrass(stoneUrl) },
    uRock: { value: loadGrass(rockUrl) },
    uGMask: { value: groundMask(grid, high ? 512 : 320) },
    uLane: { value: laneCoords(grid, high ? 1024 : 640) },
    uBaseFloor: { value: loadBaseFloor() },
    uGrassScale: { value: 1 / 7.5 },
    uGrassTint: { value: new THREE.Vector3(1.95, 2.15, 2.4) },
  };
  fog.patch(
    groundMat,
    (shader) => {
      Object.assign(shader.uniforms, grassUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWN;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWN = objectNormal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vWN;\nuniform sampler2D uGrass;\nuniform sampler2D uPath;\nuniform sampler2D uStone;\nuniform sampler2D uRock;\nuniform sampler2D uGMask;\nuniform sampler2D uLane;\nuniform sampler2D uBaseFloor;\nuniform float uGrassScale;\nuniform vec3 uGrassTint;",
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          vec4 gMask = texture2D(uGMask, vFogW.xz / ${MAP.toFixed(1)});
          vec2 gp = vFogW.xz * uGrassScale;
          vec3 g1 = texture2D(uGrass, gp).rgb;
          vec2 rp = mat2(0.8, -0.6, 0.6, 0.8) * gp * 0.63 + vec2(0.37, 0.71);
          vec3 g2 = texture2D(uGrass, rp).rgb;
          float macro = texture2D(uGrass, vFogW.xz * 0.011).g * 8.0;
          vec3 grassCol = mix(g1, g2, smoothstep(0.35, 0.65, fract(macro))) * uGrassTint * gMask.g;
          // Weg: Lane-Textur als Streifen entlang der Lane (Steinplatten in der Mitte, Erde und Gras zum Rand),
          // in den Camps einfach über die Welt gekachelt
          if (gMask.b > 0.004) {
            vec4 lc = texture2D(uLane, vFogW.xz / ${MAP.toFixed(1)});
            vec2 wp = vFogW.xz / ${PATH_TILE.toFixed(1)};
            vec3 worldCol = texture2D(uPath, wp).rgb;
            vec3 laneCol = worldCol;
            if (lc.a > 0.004) {
              // quer zur Lane gespiegelt fortgesetzt (sonst endet die Textur am Rand in einer langen Linie)
              vec2 pp = vec2(atan(lc.g * 2.0 - 1.0, lc.r * 2.0 - 1.0) / 6.2831853, (lc.b - 0.5) * ${(LANE_ACROSS / PATH_TILE).toFixed(3)} + 0.5);
              // Ableitungen ohne den Sprung beim Umlauf, sonst wählt die Mipmap an der Naht die kleinste Stufe
              vec2 ddx = dFdx(pp);
              vec2 ddy = dFdy(pp);
              ddx.x -= floor(ddx.x + 0.5);
              ddy.x -= floor(ddy.x + 0.5);
              laneCol = textureGrad(uPath, pp, ddx, ddy).rgb;
            }
            vec3 pathCol = mix(worldCol, laneCol, smoothstep(0.0, 1.0, lc.a)) * vec3(1.3, 1.3, 1.35) * mix(0.85, 1.0, gMask.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, pathCol, gMask.b);
          }
          // Basis: Boden wie auf der Kluft (assets-src/base-floor), Rot gespiegelt. Damit er nicht wie ein eingefügtes
          // Bild wirkt: nachgeschärft, feine Steinstruktur, Relief aus der Helligkeit (Licht von der Sonne) und Gras
          // im Bild an das Gras des Geländes angeglichen
          if (gMask.a > 0.004) {
            bool redSide = vFogW.x > vFogW.z;
            vec2 bp = redSide ? vec2(${MAP.toFixed(1)}) - vFogW.xz : vFogW.xz;
            vec2 buv = (bp - vec2(0.0, ${(MAP - BASE_FLOOR_SIZE).toFixed(1)})) / ${BASE_FLOOR_SIZE.toFixed(1)};
            vec3 bc = texture2D(uBaseFloor, buv).rgb;
            // Unschärfe der Vorlage ausgleichen (unscharfe Maske über eine gröbere Mip-Stufe)
            vec3 bl = texture2D(uBaseFloor, buv, 2.5).rgb;
            bc = max(bc + (bc - bl) * 0.85, 0.0);
            // Relief: Fugen und Kanten der Platten fangen Licht von oben links
            float e = 1.0 / 1536.0;
            float lc = dot(bl, vec3(0.333));
            float lx = dot(texture2D(uBaseFloor, buv + vec2(e * 2.0, 0.0), 1.0).rgb, vec3(0.333));
            float lz = dot(texture2D(uBaseFloor, buv + vec2(0.0, e * 2.0), 1.0).rgb, vec3(0.333));
            float relief = clamp(((lc - lx) * (redSide ? -1.0 : 1.0) + (lc - lz) * (redSide ? -1.0 : 1.0)) * 5.0, -0.25, 0.25);
            // feine Steinkörnung (nur die Abweichung vom Mittel, damit sich die Farbe nicht verschiebt)
            float d1 = dot(texture2D(uStone, vFogW.xz / 3.1).rgb, vec3(0.333));
            float d2 = dot(texture2D(uStone, vFogW.xz / 3.1, 4.0).rgb, vec3(0.333));
            float grain = (d1 - d2) * 1.4;
            // Gras im Bild: Farbe und Struktur vom Gelände, Helligkeit vom Bild
            float green = smoothstep(0.015, 0.09, bc.g - max(bc.r, bc.b) * 0.92);
            float bLum = dot(bc, vec3(0.3, 0.59, 0.11));
            float gLum = max(dot(grassCol, vec3(0.3, 0.59, 0.11)), 0.02);
            vec3 grassMatch = grassCol * clamp(bLum / gLum * 1.25, 0.55, 1.6);
            vec3 tint = redSide ? vec3(1.42, 1.28, 1.22) : vec3(1.3, 1.32, 1.38);
            vec3 stone = bc * tint * (1.0 + relief + grain * (1.0 - green));
            bc = mix(stone, grassMatch, green * 0.65);
            diffuseColor.rgb = mix(diffuseColor.rgb, bc, gMask.a);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, grassCol, gMask.r);
          // Felswände: an steilen Stellen Fels (dreiseitig projiziert), oben Moos
          vec3 wn = normalize(vWN);
          float steep = smoothstep(0.86, 0.55, wn.y);
          if (steep > 0.004) {
            // seitliche Projektion je nach Hangrichtung, oben flach projiziert
            vec2 side = abs(wn.x) > abs(wn.z) ? vFogW.zy : vFogW.xy;
            vec3 rockCol = mix(texture2D(uRock, side * 0.2).rgb, texture2D(uRock, vFogW.xz * 0.2).rgb, smoothstep(0.35, 0.75, wn.y)) * 1.12;
            rockCol = mix(rockCol, rockCol * vec3(0.6, 0.85, 0.45), smoothstep(0.55, 0.75, wn.y) * 0.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, steep);
          }`,
        );
    },
    "ground",
  );
  for (const geo of groundTiles(grid, 10)) {
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    ground.name = "ground";
    group.add(ground);
  }

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

  // Wasser: türkis, durchscheinend, ruhige Wellen
  const mask = new Uint8Array(grid.n * grid.n);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.min(255, grid.river[i] * 255);
  const maskTex = new THREE.DataTexture(mask, grid.n, grid.n, THREE.RedFormat, THREE.UnsignedByteType);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.needsUpdate = true;
  // Wasser-Animation (assets-src/wasser.gif): 16 Einzelbilder in einer 4x4-Tafel, siehe assets-src/water_atlas.py
  const waterTex = new THREE.TextureLoader().load(waterAtlasUrl);
  waterTex.colorSpace = THREE.SRGBColorSpace;
  waterTex.generateMipmaps = false;
  waterTex.minFilter = THREE.LinearFilter;
  const water = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: timeU,
      uWaterTex: { value: waterTex },
      uMask: { value: maskTex },
      uFogTex: fog.uniforms.uFogTex,
      uFogOn: fog.uniforms.uFogOn,
    },
    vertexShader: `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uWaterTex;
      uniform sampler2D uMask;
      // Einzelbild f der Wasser-Animation, gespiegelt gekachelt (keine Nähte zwischen den Kacheln)
      vec3 waterFrame(vec2 uv, float f) {
        vec2 m = abs(mod(uv, 2.0) - 1.0);
        m = mix(vec2(0.004), vec2(0.996), m);
        float i = mod(f, 16.0);
        vec2 cell = vec2(mod(i, 4.0), floor(i / 4.0));
        return texture2D(uWaterTex, vec2((cell.x + m.x) / 4.0, 1.0 - (cell.y + m.y) / 4.0)).rgb;
      }
      uniform sampler2D uFogTex;
      uniform float uFogOn;
      varying vec3 vW;
      void main() {
        float m = texture2D(uMask, vW.xz / ${MAP.toFixed(1)}).r;
        if (m < 0.04) discard;
        vec2 p = vW.xz;
        float w1 = sin(p.x * 1.1 + uTime * 1.2 + sin(p.y * 0.5 + uTime * 0.3) * 2.0);
        float w2 = sin(p.y * 1.4 - uTime * 0.9 + sin(p.x * 0.4) * 1.7);
        float w3 = sin((p.x - p.y) * 0.8 + uTime * 0.7);
        float r = (w1 + w2 + w3) / 6.0 + 0.5;
        vec3 deep = vec3(0.08, 0.27, 0.32);
        vec3 shallow = vec3(0.24, 0.47, 0.44);
        vec3 col = mix(shallow, deep, smoothstep(0.3, 1.0, m));
        // bewegtes Wasser aus der Animation: eine Kachel ~ 11 x 6 Einheiten, 16 Bilder in 2,24 s, weich überblendet
        float fr = uTime * (16.0 / 2.24);
        float f0 = floor(fr);
        float fk = fract(fr);
        // zwei gegeneinander gedrehte Kachelungen überlagert: keine sichtbaren Spiegelmuster
        vec2 wuv = p / vec2(11.0, 6.2) + vec2(uTime * 0.012, uTime * 0.006);
        vec2 wuv2 = mat2(0.8, -0.6, 0.6, 0.8) * p / vec2(8.3, 4.7) + vec2(0.37, 0.61) - vec2(uTime * 0.009, uTime * 0.011);
        vec3 anim = 0.5 * (mix(waterFrame(wuv, f0), waterFrame(wuv, f0 + 1.0), fk) + mix(waterFrame(wuv2, f0 + 7.0), waterFrame(wuv2, f0 + 8.0), fk));
        // Farben direkt aus der Animation (Mittelwert der Tafel ~ (0,002; 0,071; 0,085)), Kontrast der Lichtlinien etwas betont
        vec3 mean = vec3(0.002, 0.071, 0.085);
        vec3 gifCol = max(mean + (anim - mean) * 1.6, 0.0) * 1.25;
        col = mix(col, gifCol, 0.85);
        col += smoothstep(0.72, 0.95, r) * 0.08;
        float foam = smoothstep(0.1, 0.0, abs(m - 0.16)) * (0.6 + 0.4 * sin(uTime * 1.6 + p.x * 0.8 + p.y * 0.6));
        col = mix(col, vec3(0.78, 0.9, 0.86), foam * 0.35);
        float a = smoothstep(0.04, 0.4, m) * 0.9;
        float fv = texture2D(uFogTex, vW.xz / ${MAP.toFixed(1)}).r;
        vec3 fogged = col * vec3(0.38, 0.42, 0.55);
        col = mix(col, mix(fogged, col, fv), uFogOn);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP, MAP), water);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(MAP / 2, WATER_Y, MAP / 2);
  waterMesh.renderOrder = 2;
  group.add(waterMesh);

  // Laub wiegt sich leicht im Wind
  const sway = (amount: string) => (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = timeU;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 swP = instanceMatrix[3].xyz;
      #else
        vec3 swP = vec3(0.0);
      #endif
      float swA = sin(uTime * 1.3 + swP.x * 0.35 + swP.z * 0.27) * ${amount};
      transformed.x += swA;
      transformed.z += swA * 0.6;`,
    );
  };
  const foliageMat = (map: THREE.Texture, key: string, amount: string) => {
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const swayPatch = sway(amount);
    fog.patch(
      m,
      (shader) => {
        swayPatch(shader);
        cutPatch(shader);
        // Rückseiten von Blättern und Halmen wie die Vorderseite beleuchten (sonst schwarz)
        shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
      },
      key,
    );
    return m;
  };

  // Bäume (in Kacheln, damit die Kamera unsichtbare Teile weglassen kann)
  const rand = rng(1234);
  const CH = 4;
  const chunkSize = MAP / CH;
  const chunkOf = (x: number, z: number) => Math.max(0, Math.min(CH - 1, Math.floor(x / chunkSize))) + Math.max(0, Math.min(CH - 1, Math.floor(z / chunkSize))) * CH;
  type Inst = { m: THREE.Matrix4; c: THREE.Color };
  const TREE_KINDS = 2;
  const buckets: Inst[][][] = Array.from({ length: TREE_KINDS }, () => Array.from({ length: CH * CH }, () => []));
  const step = high ? 2.3 : 3.1;
  const addTree = (x: number, z: number, y: number, kind: number, s: number) => {
    const m = mat4(x, y, z, s, s * (0.9 + rand() * 0.25), s, 0, rand() * Math.PI * 2, 0);
    const c = new THREE.Color();
    const v = 0.85 + rand() * 0.3;
    if (kind === 0) c.setRGB(v * (0.36 + rand() * 0.1), v * (0.5 + rand() * 0.08), v * (0.5 + rand() * 0.1));
    else c.setRGB(v * (0.55 + rand() * 0.25), v * (0.72 + rand() * 0.15), v * (0.62 + rand() * 0.2));
    // keine Baumkronen über den Kuhlen der Camps (Monster sollen frei darin stehen)
    if (CAMPS.some((cp) => CAMP_PIT[cp.kind] && Math.hypot(cp.pos.x - x, cp.pos.z - z) < CAMP_PIT[cp.kind]! + 0.6 + 2.8 * s)) return;
    buckets[kind][chunkOf(x, z)].push({ m, c });
  };
  for (let gz = 0; gz < MAP; gz += step) {
    for (let gx = 0; gx < MAP; gx += step) {
      const x = gx + rand() * step;
      const z = gz + rand() * step;
      const sd = grid.sdAt(x, z);
      if (sd > -1.1) continue;
      if (FOUNTAIN.some((f) => Math.hypot(f.x - x, f.z - z) < 13)) continue;
      // Basismauer: nur Stein, keine Bäume
      if (grid.base[Math.min(grid.n - 1, Math.floor(z)) * grid.n + Math.min(grid.n - 1, Math.floor(x))] >= 0) continue;
      const depth = -sd;
      if (depth > 7 && rand() < 0.45) continue;
      const kind = rand() < 0.5 ? 0 : 1;
      const s = (depth > 4 ? 0.95 : 0.75) + rand() * 0.3;
      addTree(x, z, grid.heightAt(x, z) - 0.15, kind, s);
    }
  }
  // Waldgürtel rund um die Karte
  for (let i = 0; i < (high ? 800 : 380); i++) {
    const side = (rand() * 4) | 0;
    const along = -20 + rand() * (MAP + 40);
    const out = 1 + rand() * 22;
    const x = side === 0 ? -out : side === 1 ? MAP + out : along;
    const z = side === 2 ? -out : side === 3 ? MAP + out : along;
    addTree(x, z, 2.4, rand() < 0.5 ? 0 : 1, 1.1 + rand() * 0.4);
  }
  const foliage = [
    { geo: pineFoliage(5, high ? 14 : 10), mat: foliageMat(texture(pineUrl, true), "pine", "0.035 * max(0.0, position.y - 1.0)") },
    { geo: broadFoliage(7), mat: foliageMat(texture(leavesUrl, false), "leaf", "0.03 * max(0.0, position.y - 1.5)") },
  ];
  const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  fog.patch(trunkMat, cutPatch, "trunk");
  const trunks = [colored(new THREE.CylinderGeometry(0.13, 0.28, 2.2, 6), 0x4a3424, mat4(0, 1.0, 0)), colored(new THREE.CylinderGeometry(0.2, 0.36, 3.0, 7), 0x5a3f2a, mat4(0, 1.4, 0))];
  for (let kind = 0; kind < TREE_KINDS; kind++) {
    for (const list of buckets[kind]) {
      if (!list.length) continue;
      for (const part of ["leaf", "trunk"] as const) {
        const im = new THREE.InstancedMesh(part === "leaf" ? foliage[kind].geo : trunks[kind], part === "leaf" ? foliage[kind].mat : trunkMat, list.length);
        list.forEach((inst, j) => {
          im.setMatrixAt(j, inst.m);
          if (part === "leaf") im.setColorAt(j, inst.c);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = high && part === "leaf";
        group.add(im);
      }
    }
  }

  // Felsbrocken an den Felswänden und im Wald
  const rockMat = new THREE.MeshLambertMaterial({ map: texture(rockUrl, true), vertexColors: true });
  fog.patch(rockMat);
  const boulders = [boulderGeometry(1), boulderGeometry(5)];
  const rockBuckets: THREE.Matrix4[][][] = boulders.map(() => Array.from({ length: CH * CH }, () => []));
  for (let i = 0; i < (high ? 2200 : 1200); i++) {
    const x = rand() * MAP;
    const z = rand() * MAP;
    const sd = grid.sdAt(x, z);
    if (sd > 0.2 || sd < -2.2) continue;
    if (rand() < 0.35) continue;
    const s = 0.4 + rand() ** 2 * 1.3;
    const m = mat4(x, grid.heightAt(x, z) - 0.2 * s, z, s * (0.9 + rand() * 0.5), s * (0.7 + rand() * 0.5), s, (rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4);
    rockBuckets[i % 2][chunkOf(x, z)].push(m);
  }
  boulders.forEach((geo, k) => {
    for (const list of rockBuckets[k]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, rockMat, list.length);
      list.forEach((m, j) => im.setMatrixAt(j, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = high;
      im.receiveShadow = true;
      group.add(im);
    }
  });

  // Büsche: dichte Büschel aus hohem Gras
  const blades: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  for (const b of BRUSHES) {
    const count = Math.round(b.r * b.r * 3.4 + 4);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * b.r;
      const x = b.p.x + Math.cos(a) * r;
      const z = b.p.z + Math.sin(a) * r;
      const s = 0.85 + rand() * 0.45;
      const tint = 0.72 + rand() * 0.22;
      blades.push({ m: mat4(x, grid.groundAt(x, z) - 0.05, z, s, s * (0.85 + rand() * 0.4), s, 0, rand() * 6, 0), c: new THREE.Color(tint, tint * (0.95 + rand() * 0.1), tint * 0.9) });
    }
  }
  const brushMat = foliageMat(texture(tallgrassUrl, false), "grass", "0.1 * uv.y");
  const brush = new THREE.InstancedMesh(grassClumpGeometry(), brushMat, blades.length);
  blades.forEach((b, j) => {
    brush.setMatrixAt(j, b.m);
    brush.setColorAt(j, b.c);
  });
  brush.instanceMatrix.needsUpdate = true;
  if (brush.instanceColor) brush.instanceColor.needsUpdate = true;
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
          if (grid.river[Math.floor(z) * grid.n + Math.floor(x)] > 0.05) continue;
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
      timeU.value = t;
    },
  };
}
