import {
  BRUSHES,
  CAMPS,
  CAMP_PIT,
  FOUNTAIN,
  FOUNTAIN_RADIUS,
  LANES,
  LANE_WIDTH,
  MAP,
  inBaseArea,
  inBaseWall,
  STRUCTURES,
  onBaseWalk,
  distToPolyline,
  type LaneId,
  type V2,
} from "./mapdata";
import { JUNGLE_MASK } from "./jungleMask";
import { START_BASE_FOOTPRINT } from "./startbaseFootprint";
import { BASE_MODEL_HEIGHT } from "./baseModelHeight";
import { JG_CAMP_HEIGHT } from "./jgCampHeight";

const JG_H = Uint8Array.from(atob(JG_CAMP_HEIGHT.data), (c) => c.charCodeAt(0));

/** Oberfläche des Basis-Modells (assets-src/base-model): [Höhe, Abdeckung 0..1]; Rot ist die Punktspiegelung. */
const BASE_H = Uint8Array.from(atob(BASE_MODEL_HEIGHT.data), (c) => c.charCodeAt(0));
function baseModelAt(x: number, z: number): [number, number] {
  if (x > z) {
    x = MAP - x;
    z = MAP - z;
  }
  const M = BASE_MODEL_HEIGHT;
  const fx = (x - M.x0) * M.res;
  const fz = (z - M.z0) * M.res;
  if (fx < 0 || fz < 0 || fx >= M.n - 1 || fz >= M.n - 1) return [0, 0];
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  let h = 0;
  let w = 0;
  for (const [dx, dz, k] of [[0, 0, (1 - fx + ix) * (1 - fz + iz)], [1, 0, (fx - ix) * (1 - fz + iz)], [0, 1, (1 - fx + ix) * (fz - iz)], [1, 1, (fx - ix) * (fz - iz)]]) {
    const b = BASE_H[(iz + dz) * M.n + ix + dx];
    if (!b) continue;
    h += ((b - 1) / 40 - 1) * k;
    w += k;
  }
  return w > 0 ? [h / w, w] : [0, 0];
}

// Deterministischer Zufall, damit die Karte bei jedem Start gleich aussieht.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Glattes Wertrauschen 0..1. */
export function noise2(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number) {
  return noise2(x, z) * 0.55 + noise2(x * 2.1 + 17, z * 2.1 + 5) * 0.3 + noise2(x * 4.3 + 3, z * 4.3 + 41) * 0.15;
}

function pointInPoly(p: V2, poly: V2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Unregelmäßiger Umriss der Camp-Böden (kein runder Kreis): Faktor auf den Radius je Richtung. */
export function campShape(c: V2, x: number, z: number) {
  const a = Math.atan2(z - c.z, x - c.x);
  return 0.72 + 0.56 * fbm(c.x * 0.13 + Math.cos(a) * 1.1, c.z * 0.13 + Math.sin(a) * 1.1);
}
/** Abstand zum Camp, bezogen auf den unregelmäßigen Umriss (vergleichbar mit CAMP_PIT). */
export function campDist(c: V2, x: number, z: number) {
  return Math.hypot(x - c.x, z - c.z) / campShape(c, x, z);
}

/** Lauflängen-Maske (frei, gesetzt, frei, …) aus jungleMask.ts entpacken. */
function unpackMask(rows: string[], n: number) {
  const out = new Uint8Array(n * n);
  rows.forEach((row, z) => {
    let x = 0;
    row.split(",").forEach((len, k) => {
      const l = Number(len);
      if (k % 2) out.fill(1, z * n + x, z * n + x + l);
      x += l;
    });
  });
  return out;
}
const JUNGLE_WALL = unpackMask(JUNGLE_MASK.rows, JUNGLE_MASK.n);
const RIVER_POOL = unpackMask(JUNGLE_MASK.pool, JUNGLE_MASK.n);
/** Wert der Masken an einer Kartenposition. */
const maskAt = (m: Uint8Array, x: number, z: number) => {
  const n = JUNGLE_MASK.n;
  const mx = Math.min(n - 1, Math.max(0, Math.floor((x / MAP) * n)));
  const mz = Math.min(n - 1, Math.max(0, Math.floor((z / MAP) * n)));
  return m[mz * n + mx];
};

function edt(seed: Uint8Array, n: number): Float32Array {
  // Chamfer-Abstand (1, √2) zu den Zellen mit seed=1.
  const INF = 1e9;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = seed[i] ? 0 : INF;
  const D = Math.SQRT2;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (z > 0) {
        v = Math.min(v, d[i - n] + 1);
        if (x > 0) v = Math.min(v, d[i - n - 1] + D);
        if (x < n - 1) v = Math.min(v, d[i - n + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let z = n - 1; z >= 0; z--) {
    for (let x = n - 1; x >= 0; x--) {
      const i = z * n + x;
      let v = d[i];
      if (x < n - 1) v = Math.min(v, d[i + 1] + 1);
      if (z < n - 1) {
        v = Math.min(v, d[i + n] + 1);
        if (x < n - 1) v = Math.min(v, d[i + n + 1] + D);
        if (x > 0) v = Math.min(v, d[i + n - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

class Heap {
  ids: number[] = [];
  keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** Bilineares Abtasten eines Zellfelds (Zellmitte bei +0.5). */
export function cellSample(arr: ArrayLike<number>, n: number, x: number, z: number) {
  const fx = Math.max(0, Math.min(n - 1.001, x - 0.5));
  const fz = Math.max(0, Math.min(n - 1.001, z - 0.5));
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * n + ix;
  return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - tz) + (arr[i + n] * (1 - tx) + arr[i + n + 1] * tx) * tz;
}

/** 3×3-Weichzeichner (Rand wird geklemmt). */
function blur(src: Float32Array, n: number) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      tmp[i] = (src[z * n + Math.max(0, x - 1)] + src[i] * 2 + src[z * n + Math.min(n - 1, x + 1)]) / 4;
    }
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      out[i] = (tmp[Math.max(0, z - 1) * n + x] + tmp[i] * 2 + tmp[Math.min(n - 1, z + 1) * n + x]) / 4;
    }
  return out;
}

export class NavGrid {
  readonly n = MAP;
  /** 1 = begehbar. */
  readonly walk: Uint8Array;
  /** Abstand begehbarer Zellen zur nächsten Wand. */
  readonly clear: Float32Array;
  /** Abstand von Wandzellen zur nächsten offenen Zelle. */
  readonly wallDepth: Float32Array;
  /** 0..1 Anteil Lane, Fluss je Zelle. */
  readonly lane: Float32Array;
  readonly river: Float32Array;
  /** -1 keine Basis, sonst Team. */
  readonly base: Int8Array;
  /** -1 kein Busch, sonst Busch-Index. */
  readonly brush: Int16Array;
  /** Zellen, die durch Gebäude-Hindernisse (Startbasis) gesperrt sind. */
  readonly obstacleCells: number;
  /** Geglätteter Abstand zur Waldkante (> 0 offen, < 0 Wald), gegen Treppenstufen an den Kanten. */
  readonly sdf: Float32Array;
  /** Höhenpunkte pro Einheit. */
  readonly hres = 2;
  /** Höhen an den (n·hres+1)² Gitterpunkten, nur für die Optik. */
  readonly heights: Float32Array;
  /** So weit liegt der Geländeboden unter dem Basis-Modell tiefer (gleiche Auflösung wie heights), damit er nicht durchscheint. */
  readonly groundSink: Float32Array;
  /** Camp-Modelle (Mulde mit Felsring): Lage, Drehung um y, Maßstab waagrecht und senkrecht. */
  campProps: { x: number; z: number; rot: number; hs: number; vs: number; r: number; niche: number }[] = [];
  /** Passung der Camp-Modelle: begehbare Zellen unter Felsen, Wandzellen unter dem Boden (beides soll 0 sein). */
  campFit: { id: string; rock: number; floor: number; turn: number; hs: number }[] = [];

  private gScore: Float32Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closedStamp: Uint32Array;
  private searchId = 0;

  constructor() {
    const n = this.n;
    this.walk = new Uint8Array(n * n);
    this.lane = new Float32Array(n * n);
    this.river = new Float32Array(n * n);
    this.base = new Int8Array(n * n).fill(-1);
    this.brush = new Int16Array(n * n).fill(-1);
    this.gScore = new Float32Array(n * n);
    this.came = new Int32Array(n * n);
    this.stamp = new Uint32Array(n * n);
    this.closedStamp = new Uint32Array(n * n);

    const ring: V2[] = [...LANES.top, ...[...LANES.bot].reverse()];
    const laneIds: LaneId[] = ["top", "mid", "bot"];

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        const p = { x: x + 0.5, z: z + 0.5 };

        let laneT = 0;
        for (const id of laneIds) {
          const half = LANE_WIDTH[id] / 2;
          const d = distToPolyline(p, LANES[id]);
          laneT = Math.max(laneT, 1 - smooth(half - 2.5, half + 0.5, d));
        }
        this.lane[i] = laneT;

        // Fluss: ganzes Flussbett samt Becken und Gruben aus der Karte (Ufer wird unten geglättet)
        this.river[i] = maskAt(RIVER_POOL, p.x, p.z);

        let inBase = -1;
        for (const t of [0, 1] as const) if (inBaseArea(t, p)) inBase = t;
        this.base[i] = inBase;

        // Außerhalb der Lanes Wald, innen frei bis auf die Wandinseln des Jungles
        let open = pointInPoly(p, ring) && !maskAt(JUNGLE_WALL, p.x, p.z);
        // Freischneiden
        if (inBase >= 0) open = true;
        for (const t of [0, 1] as const) {
          if (onBaseWalk(t, p)) open = true;
          if (inBaseWall(t, p)) open = false;
        }
        if (laneT > 0.25) open = true;
        for (const f of FOUNTAIN) {
          if (Math.hypot(p.x - f.x, p.z - f.z) < FOUNTAIN_RADIUS + 1) open = true;
        }
        // Gebäude stehen wie in LoL am Lane-Rand: drumherum frei
        for (const st of STRUCTURES) {
          if (Math.hypot(p.x - st.pos.x, p.z - st.pos.z) < 5) open = true;
        }
        // Standplatz der Monster immer frei (die Nischen selbst kommen aus der Maske)
        for (const c of CAMPS) {
          if (Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < 3) open = true;
        }
        this.walk[i] = open ? 1 : 0;
      }
    }

    // Dünne Wände (bis 3 Zellen) entfernen: sie sind im Gelände zu schmal für eine sichtbare Felskante und
    // wären unsichtbare Wände. Morphologisches Schließen der offenen Fläche (erweitern, dann wieder schrumpfen).
    {
      const seed = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) seed[i] = this.walk[i];
      const toOpen = edt(seed, n);
      const grown = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) grown[i] = toOpen[i] <= THIN_WALL ? 0 : 1;
      const toWall = edt(grown, n);
      for (let i = 0; i < n * n; i++) if (!this.walk[i] && toWall[i] > THIN_WALL) this.walk[i] = 1;
    }

    // weiches Ufer; kein Wasser unter den Wandinseln und auf den Lanes (Mid quert trocken)
    this.river.set(blur(blur(blur(this.river, n), n), n));
    for (let i = 0; i < n * n; i++) {
      if (!this.walk[i]) this.river[i] = 0;
      this.river[i] *= 1 - smooth(0.15, 0.6, this.lane[i]);
      // wie auf der Kluft: an der Mid-Lane läuft der Fluss flach aus (trockenes Flussbett statt Wasserwand)
      const mx = (i % n) + 0.5;
      const mz = Math.floor(i / n) + 0.5;
      const dm = distToPolyline({ x: mx, z: mz }, LANES.mid) + (fbm(mx * 0.08 + 21, mz * 0.08) - 0.5) * 9;
      this.river[i] *= smooth(LANE_WIDTH.mid / 2 + 6, LANE_WIDTH.mid / 2 + 30, dm);
      // an Top- und Bot-Lane ebenso, nur kürzer (dort beginnt der Fluss ohnehin erst vor den Gruben)
      for (const id of ["top", "bot"] as const) {
        const dl = distToPolyline({ x: mx, z: mz }, LANES[id]) + (fbm(mx * 0.08 + 5, mz * 0.08 + 9) - 0.5) * 6;
        this.river[i] *= smooth(LANE_WIDTH[id] / 2 + 3, LANE_WIDTH[id] / 2 + 14, dl);
      }
    }

    // Büsche: begehbar, merken pro Zelle.
    BRUSHES.forEach((b, bi) => {
      const r = Math.ceil(b.r + 1);
      for (let z = Math.floor(b.p.z - r); z <= b.p.z + r; z++) {
        for (let x = Math.floor(b.p.x - r); x <= b.p.x + r; x++) {
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const i = z * n + x;
          if (!this.walk[i]) continue;
          if (Math.hypot(x + 0.5 - b.p.x, z + 0.5 - b.p.z) <= b.r) this.brush[i] = bi;
        }
      }
    });

    const wallSeed = new Uint8Array(n * n);
    const openSeed = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      wallSeed[i] = this.walk[i] ? 0 : 1;
      openSeed[i] = this.walk[i] ? 1 : 0;
    }
    // Gelände (Felsen, Wald) bestimmt die Optik; Hindernisse wie die Ruinen der Startbasis kommen danach dazu
    const terrainClear = edt(wallSeed, n);
    this.wallDepth = edt(openSeed, n);

    const sd = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) sd[i] = this.walk[i] ? terrainClear[i] - 0.5 : 0.5 - this.wallDepth[i];
    this.sdf = blur(blur(sd, n), n);

    // Startbasis: Ruinen, Säulen und Statue sind fest, Plattform und offene Vorderseite bleiben frei
    const fp = START_BASE_FOOTPRINT;
    const fpN = fp.rows.length;
    const solidAt = (mx: number, mz: number) => {
      const c = Math.floor((mx + fp.half) / fp.res);
      const r = Math.floor((mz + fp.half) / fp.res);
      return r >= 0 && c >= 0 && r < fpN && c < fpN && fp.rows[r].charCodeAt(c) === 49;
    };
    let blocked = 0;
    for (const f of FOUNTAIN) {
      // gleiche Drehung wie das Modell in der Szene (vorne zur Kartenmitte)
      const rot = Math.atan2(MAP / 2 - f.x, MAP / 2 - f.z);
      const co = Math.cos(rot);
      const si = Math.sin(rot);
      const R = Math.ceil(fp.half) + 1;
      for (let z = Math.floor(f.z) - R; z <= Math.floor(f.z) + R; z++) {
        for (let x = Math.floor(f.x) - R; x <= Math.floor(f.x) + R; x++) {
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const i = z * n + x;
          if (!this.walk[i]) continue;
          let hits = 0;
          for (const [ox, oz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
            const dx = x + ox - f.x;
            const dz = z + oz - f.z;
            if (solidAt(dx * co - dz * si, dx * si + dz * co)) hits++;
          }
          if (hits >= 2) {
            this.walk[i] = 0;
            wallSeed[i] = 1;
            blocked++;
          }
        }
      }
    }
    this.obstacleCells = blocked;
    this.clear = blocked ? edt(wallSeed, n) : terrainClear;

    // Höhen: weiche Felskanten statt Zellstufen
    const R = this.hres;
    const N = n * R;
    const h = new Float32Array((N + 1) * (N + 1));
    const baseArr = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) baseArr[i] = this.base[i] >= 0 ? 1 : 0;
    for (let z = 0; z <= N; z++) {
      for (let x = 0; x <= N; x++) {
        const px = x / R;
        const pz = z / R;
        const s = this.sdAt(px, pz);
        const lane = cellSample(this.lane, n, px, pz);
        let open = cellSample(baseArr, n, px, pz) * 0.12 - cellSample(this.river, n, px, pz) * 1.15;
        open += (fbm(px * 0.12 + 50, pz * 0.12) - 0.5) * 0.25 * (1 - lane);
        for (const f of FOUNTAIN) open = Math.max(open, 0.42 * smooth(7.9, 7.0, Math.hypot(px - f.x, pz - f.z)));
        const d = Math.max(0, -(s - CLIFF_SHIFT));
        const k = smooth(0, 1.5, d);
        // Wandinseln flach: die Mauern (walls.ts) bilden den Rand, oben steht Wald
        const wall = 0.75 + fbm(px * 0.3, pz * 0.3) * 0.2;
        h[z * (N + 1) + x] = open + (wall - open) * k;
      }
    }
    // Basis: Boden ist das 3D-Modell, Einheiten und Gebäude stehen auf seiner Oberfläche
    const sink = new Float32Array((N + 1) * (N + 1));
    for (let z = 0; z <= N; z++) {
      for (let x = 0; x <= N; x++) {
        const px = x / R;
        const pz = z / R;
        const inB = cellSample(baseArr, n, px, pz);
        if (inB <= 0) continue;
        const [mh, cover] = baseModelAt(px, pz);
        if (cover <= 0) continue;
        // auf dem Brunnen steht das Brunnenmodell (eigene Höhe, siehe oben)
        if (FOUNTAIN.some((f) => Math.hypot(px - f.x, pz - f.z) < FOUNTAIN_RADIUS)) continue;
        const i = z * (N + 1) + x;
        h[i] += (mh - h[i]) * cover * inB;
        sink[i] = 0.35 * cover;
      }
    }
    this.groundSink = sink;
    // Camps: Modell mit Erdboden und Felsring (assets-src/jungle-model), offen zum Eingang des Camps. Drehung und
    // Größe werden je Camp so gewählt, dass die Felsen keine begehbaren Zellen überdecken und der Boden nicht über
    // Wand liegt (sonst sähe es offen aus, wäre aber Wand). Unter dem Modell wird das Gelände abgesenkt.
    const JG = JG_CAMP_HEIGHT;
    const jgTop = (u: number, w: number) => {
      const fi = Math.round(((u + JG.r) / (2 * JG.r)) * (JG.n - 1));
      const fj = Math.round(((w + JG.r) / (2 * JG.r)) * (JG.n - 1));
      if (fi < 0 || fj < 0 || fi >= JG.n || fj >= JG.n) return -9;
      const b = JG_H[fj * JG.n + fi];
      return b ? (b - 21) / 200 : -9;
    };
    this.campProps = [];
    this.campFit = [];
    for (const c of CAMPS) {
      const r = CAMP_PIT[c.kind];
      if (!r) continue;
      // Eingang: Mittel der Richtungen zu freien Zellen knapp außerhalb der Nische
      let ex = 0;
      let ez = 0;
      for (let dz = -Math.ceil(r + 6); dz <= r + 6; dz++) {
        for (let dx = -Math.ceil(r + 6); dx <= r + 6; dx++) {
          const d = Math.hypot(dx, dz);
          if (d < r + 1 || d > r + 6 || !this.isOpen(c.pos.x + dx, c.pos.z + dz)) continue;
          ex += dx / d;
          ez += dz / d;
        }
      }
      const rot0 = Math.atan2(ex, ez);
      const hs0 = r / 0.36;
      const score = (rot: number, hs: number) => {
        const co = Math.cos(rot);
        const si = Math.sin(rot);
        let rock = 0;
        let floor = 0;
        const ext = Math.ceil(hs * JG.r);
        for (let dz = -ext; dz <= ext; dz++) {
          for (let dx = -ext; dx <= ext; dx++) {
            const wx = dx + 0.5;
            const wz = dz + 0.5;
            const t = jgTop((wx * co - wz * si) / hs, (wx * si + wz * co) / hs);
            if (t < -1) continue;
            const open = this.isOpen(c.pos.x + wx, c.pos.z + wz);
            if (t > 0.08 && open) rock++;
            else if (t <= 0.08 && !open) floor++;
          }
        }
        return { rock, floor };
      };
      let best = { rot: rot0, hs: hs0, rock: 0, floor: 0, cost: Infinity };
      for (let da = -60; da <= 60; da += 10) {
        for (const k of [0.75, 0.85, 0.95, 1.05]) {
          const rot = rot0 + (da * Math.PI) / 180;
          const { rock, floor } = score(rot, hs0 * k);
          const cost = rock * 3 + floor * 2 + Math.abs(da) * 0.3 + Math.abs(k - 0.95) * 40;
          if (cost < best.cost) best = { rot, hs: hs0 * k, rock, floor, cost };
        }
      }
      const { rot, hs } = best;
      const vs = hs * 0.6;
      this.campProps.push({ x: c.pos.x, z: c.pos.z, rot, hs, vs, r: hs * 0.95, niche: r + 0.5 });
      this.campFit.push({ id: c.id, rock: best.rock, floor: best.floor, turn: Math.round(((rot - rot0) * 180) / Math.PI), hs: +hs.toFixed(1) });
      const co = Math.cos(rot);
      const si = Math.sin(rot);
      const ext = Math.ceil(JG.r * hs * R);
      const cx = Math.round(c.pos.x * R);
      const cz = Math.round(c.pos.z * R);
      for (let z = Math.max(0, cz - ext); z <= Math.min(N, cz + ext); z++) {
        for (let x = Math.max(0, cx - ext); x <= Math.min(N, cx + ext); x++) {
          const wx = x / R - c.pos.x;
          const wz = z / R - c.pos.z;
          const t = jgTop((wx * co - wz * si) / hs, (wx * si + wz * co) / hs);
          if (t < -1) continue;
          const i = z * (N + 1) + x;
          const open = this.isOpen(x / R, z / R);
          // über Wegen ist das Modell herausgeschnitten (models.ts): Felsen überall, der Erdboden außerhalb der
          // Nische des Camps. Dort bleibt das Gelände, wie es ist (Weg glatt, keine Kante)
          if (open && (t > 0.08 || Math.hypot(wx, wz) > r + 0.5)) continue;
          // vorne taucht der Erdboden des Modells unter das Gelände: dort bleibt das Gelände oben
          if (t < -0.02) continue;
          sink[i] = Math.max(sink[i], 0.35);
          // Wand unter den Felsen absenken: die Felsen des Modells sind hier die Wand. Unter dem Erdboden bleibt die
          // Wand stehen (sonst sähe es offen aus, wäre aber Wand)
          if (!open && t > 0.08) h[i] = Math.min(h[i], -0.2);
        }
      }
    }
    this.heights = h;
  }

  /** Abstand zur Waldkante mit leichtem Rauschen (für Höhen und Bodenbemalung). */
  sdAt(x: number, z: number) {
    return cellSample(this.sdf, this.n, x, z) + (fbm(x * 0.21 + 7, z * 0.21 + 3) - 0.5) * 0.9;
  }

  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.n && z < this.n;
  }

  isOpen(x: number, z: number) {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!this.inBounds(cx, cz)) return false;
    return this.walk[cz * this.n + cx] === 1;
  }

  brushAt(x: number, z: number) {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!this.inBounds(cx, cz)) return -1;
    return this.brush[cz * this.n + cx];
  }

  /** Liegt der Punkt im Dschungel (nicht auf einer Lane, im Fluss oder in einer Basis)? */
  inJungle(x: number, z: number) {
    if (!this.inBounds(x, z)) return false;
    const i = Math.floor(z) * this.n + Math.floor(x);
    return this.lane[i] < 0.3 && this.river[i] < 0.3 && this.base[i] < 0;
  }

  heightAt(x: number, z: number) {
    const R = this.hres;
    const N = this.n * R;
    const fx = Math.max(0, Math.min(N - 0.001, x * R));
    const fz = Math.max(0, Math.min(N - 0.001, z * R));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const w = N + 1;
    const h = this.heights;
    const a = h[iz * w + ix];
    const b = h[iz * w + ix + 1];
    const c = h[(iz + 1) * w + ix];
    const d = h[(iz + 1) * w + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Bodenhöhe für Einheiten: im Fluss nicht unter die Wasseroberfläche sinken lassen. */
  groundAt(x: number, z: number) {
    return Math.max(-0.55, Math.min(0.5, this.heightAt(x, z)));
  }

  /** Sichtlinie / freie Strecke zwischen zwei Punkten (mit Mindestabstand zur Wand). */
  los(a: V2, b: V2, minClear = 0.6) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.5);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!this.inBounds(cx, cz)) return false;
      const i = cz * this.n + cx;
      if (!this.walk[i] || this.clear[i] < minClear) return false;
    }
    return true;
  }

  nearestOpen(p: V2, minClear = 1.2): V2 {
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    const n = this.n;
    if (this.inBounds(cx, cz) && this.walk[cz * n + cx] && this.clear[cz * n + cx] >= minClear) return p;
    for (let r = 1; r < 30; r++) {
      let best: V2 | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (!this.inBounds(x, z)) continue;
          const i = z * n + x;
          if (!this.walk[i] || this.clear[i] < minClear) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = { x: x + 0.5, z: z + 0.5 };
          }
        }
      }
      if (best) return best;
    }
    return p;
  }

  /** A* auf dem Zellgitter, danach geglättet. Gibt Wegpunkte ohne Start zurück. */
  findPath(from: V2, to: V2): V2[] {
    const n = this.n;
    const goal = this.nearestOpen(to, 1.0);
    if (this.los(from, goal, 0.8)) return [goal];
    const start = this.nearestOpen(from, 0.5);
    const sx = Math.floor(start.x);
    const sz = Math.floor(start.z);
    const gx = Math.floor(goal.x);
    const gz = Math.floor(goal.z);
    const si = sz * n + sx;
    const gi = gz * n + gx;
    this.searchId++;
    const id = this.searchId;
    const g = this.gScore;
    const came = this.came;
    const stamp = this.stamp;
    const closed = this.closedStamp;
    const heap = new Heap();
    stamp[si] = id;
    g[si] = 0;
    came[si] = -1;
    heap.push(si, Math.hypot(gx - sx, gz - sz));
    const DIRS = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [-1, -1, Math.SQRT2],
    ];
    let found = false;
    let iter = 0;
    while (heap.size > 0 && iter++ < 60000) {
      const cur = heap.pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === gi) {
        found = true;
        break;
      }
      const cx = cur % n;
      const cz = (cur - cx) / n;
      for (const [dx, dz, cost] of DIRS) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const ni = z * n + x;
        if (!this.walk[ni] || closed[ni] === id) continue;
        if (dx !== 0 && dz !== 0 && (!this.walk[cz * n + x] || !this.walk[z * n + cx])) continue;
        const c = this.clear[ni];
        const pen = c < 1.5 ? 2.5 : c < 2.5 ? 0.6 : 0;
        const ng = g[cur] + cost + pen;
        if (stamp[ni] !== id || ng < g[ni]) {
          stamp[ni] = id;
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + Math.hypot(gx - x, gz - z));
        }
      }
    }
    if (!found) return [goal];
    const cells: V2[] = [];
    for (let c = gi; c !== -1; c = came[c]) {
      const x = c % n;
      cells.push({ x: x + 0.5, z: (c - x) / n + 0.5 });
    }
    cells.reverse();
    cells[cells.length - 1] = goal;
    // Glätten: so weit springen, wie Sichtlinie besteht.
    const out: V2[] = [];
    let anchor: V2 = from;
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.los(anchor, cells[j], 0.8)) j--;
      out.push(cells[j]);
      anchor = cells[j];
      i = j;
    }
    if (out.length === 0) out.push(goal);
    return out;
  }
}

/** Wände bis zu dieser halben Breite (in Zellen) gelten als zu dünn und werden geöffnet. */
const THIN_WALL = 1.5;
/** Felskante so weit nach außen schieben, dass sie dort ansteigt, wo die begehbare Fläche endet (keine unsichtbaren Wände). */
const CLIFF_SHIFT = 0.45;

function smooth(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
