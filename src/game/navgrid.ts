import {
  BRUSHES,
  CAMPS,
  FOUNTAIN,
  FOUNTAIN_RADIUS,
  LANES,
  LANE_WIDTH,
  MAP,
  RIVER,
  RIVER_WIDTH,
  CORRIDORS,
  inBaseArea,
  distToPolyline,
  type LaneId,
  type V2,
} from "./mapdata";

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

const CLEARING: Record<string, number> = {
  gromp: 6.5,
  wolves: 6.5,
  raptors: 6.5,
  krugs: 6.5,
  baron: 9,
  dragon: 9,
  blue: 8,
  red: 8,
  scuttle: 5,
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
  /** Höhen an den (n+1)² Gitterecken. */
  readonly heights: Float32Array;

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

        const rw = RIVER_WIDTH / 2 + (fbm(p.x * 0.07, p.z * 0.07) - 0.5) * 3;
        const rd = distToPolyline(p, RIVER);
        const riverT = 1 - smooth(rw - 3, rw, rd);
        this.river[i] = riverT;

        let inBase = -1;
        for (const t of [0, 1] as const) if (inBaseArea(t, p)) inBase = t;
        this.base[i] = inBase;

        // Grundzustand: Wald. Pfade schneiden den Jungle frei.
        let open = false;
        if (pointInPoly(p, ring)) {
          const wob = (fbm(p.x * 0.16, p.z * 0.16) - 0.5) * 2.4;
          for (const c of CORRIDORS) {
            if (distToPolyline(p, c.pts) < c.w / 2 + wob) {
              open = true;
              break;
            }
          }
        }
        // Freischneiden
        if (laneT > 0.25) open = true;
        if (rd < rw) open = true;
        if (inBase >= 0) open = true;
        for (const f of FOUNTAIN) {
          if (Math.hypot(p.x - f.x, p.z - f.z) < FOUNTAIN_RADIUS + 1) open = true;
        }
        for (const c of CAMPS) {
          const r = (CLEARING[c.kind] ?? 6) + (fbm(p.x * 0.3, p.z * 0.3) - 0.5) * 2;
          if (Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < r) open = true;
        }
        for (const b of BRUSHES) {
          if (Math.hypot(p.x - b.p.x, p.z - b.p.z) < b.r + 1.2) open = true;
        }
        this.walk[i] = open ? 1 : 0;
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
    this.clear = edt(wallSeed, n);
    this.wallDepth = edt(openSeed, n);

    // Höhen an den Ecken
    const h = new Float32Array((n + 1) * (n + 1));
    for (let z = 0; z <= n; z++) {
      for (let x = 0; x <= n; x++) {
        let sum = 0;
        let cnt = 0;
        for (let dz = -1; dz <= 0; dz++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = x + dx;
            const cz = z + dz;
            if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
            sum += this.cellHeight(cz * n + cx, cx, cz);
            cnt++;
          }
        }
        h[z * (n + 1) + x] = cnt ? sum / cnt : 0;
      }
    }
    this.heights = h;
  }

  private cellHeight(i: number, x: number, z: number) {
    if (!this.walk[i]) {
      const d = this.wallDepth[i];
      return 1.1 + Math.min(d, 4) * 0.85 + fbm(x * 0.3, z * 0.3) * 1.1;
    }
    const r = this.river[i];
    const b = this.base[i] >= 0 ? 0.12 : 0;
    const bump = (fbm(x * 0.12 + 50, z * 0.12) - 0.5) * 0.25 * (1 - this.lane[i]);
    return b + bump - r * 1.15;
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

  heightAt(x: number, z: number) {
    const n = this.n;
    const fx = Math.max(0, Math.min(n - 0.001, x));
    const fz = Math.max(0, Math.min(n - 0.001, z));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const w = n + 1;
    const h = this.heights;
    const a = h[iz * w + ix];
    const b = h[iz * w + ix + 1];
    const c = h[(iz + 1) * w + ix];
    const d = h[(iz + 1) * w + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Bodenhöhe für Einheiten: im Fluss nicht unter die Wasseroberfläche sinken lassen. */
  groundAt(x: number, z: number) {
    return Math.max(-0.55, Math.min(0.4, this.heightAt(x, z)));
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

function smooth(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
