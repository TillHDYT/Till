import * as THREE from "three";
import { FOUNTAIN, MAP } from "./mapdata";
import { cellSample, type NavGrid } from "./navgrid";

/**
 * Dschungelwände aus dem Mauerstück (assets-src/wall): entlang jeder Wandkante der Karte (Rand jeder Insel und jeder
 * langen Wand, wie sie die LoL-Karte vorgibt) werden Mauerstücke aneinandergereiht und der Kante nach gebogen. Um
 * Inseln entsteht so ein geschlossener Ring. Die Vorderseite sitzt an der Wegkante, die Mauer reicht in die Wand
 * hinein; bei dünnen Wänden wird sie schmaler, damit sie nie auf der anderen Seite in einen Weg ragt.
 */
export type WallAsset = { geo: THREE.BufferGeometry; map: THREE.Texture | null; length: number; depth: number; height: number };

/** Maßstab des Mauerstücks (Modell-Einheiten -> Welt): Länge ~7.5, Tiefe ~2.8, Höhe ~2.6. */
const WALL_SCALE = 4;
/** So tief sitzt der Fuß der Mauer unter dem Boden. */
const WALL_SINK = 0.35;

type Line = { pts: THREE.Vector2[]; closed: boolean };

/** Kanten des Wandfelds (sdf = 0) als zusammenhängende Linienzüge (Marching Squares über die Zellecken). */
function contours(grid: NavGrid): Line[] {
  const n = grid.n;
  const f = (x: number, z: number) => cellSample(grid.sdf, n, x, z);
  const val = new Float32Array((n + 1) * (n + 1));
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) val[z * (n + 1) + x] = f(x, z);
  const V = (x: number, z: number) => val[z * (n + 1) + x];
  // Kanten-ID: waagrecht (x..x+1 bei z) = 2*(z*(n+1)+x), senkrecht (z..z+1 bei x) = 2*(...)+1
  const hId = (x: number, z: number) => 2 * (z * (n + 1) + x);
  const vId = (x: number, z: number) => 2 * (z * (n + 1) + x) + 1;
  const point = new Map<number, THREE.Vector2>();
  const edgePt = (id: number) => {
    let p = point.get(id);
    if (p) return p;
    const k = id >> 1;
    const x = k % (n + 1);
    const z = (k / (n + 1)) | 0;
    if (id & 1) {
      const a = V(x, z);
      const b = V(x, z + 1);
      p = new THREE.Vector2(x, z + a / (a - b));
    } else {
      const a = V(x, z);
      const b = V(x + 1, z);
      p = new THREE.Vector2(x + a / (a - b), z);
    }
    point.set(id, p);
    return p;
  };
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = V(x, z) < 0 ? 1 : 0;
      const b = V(x + 1, z) < 0 ? 2 : 0;
      const c = V(x + 1, z + 1) < 0 ? 4 : 0;
      const d = V(x, z + 1) < 0 ? 8 : 0;
      const k = a | b | c | d;
      if (k === 0 || k === 15) continue;
      const top = hId(x, z);
      const right = vId(x + 1, z);
      const bottom = hId(x, z + 1);
      const left = vId(x, z);
      const segs: [number, number][] = {
        1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]], 5: [[left, top], [right, bottom]],
        6: [[top, bottom]], 7: [[left, bottom]], 8: [[bottom, left]], 9: [[top, bottom]], 10: [[top, right], [bottom, left]],
        11: [[right, bottom]], 12: [[right, left]], 13: [[top, right]], 14: [[left, top]],
      }[k] as [number, number][];
      for (const [p, q] of segs) link(p, q);
    }
  }
  const used = new Set<number>();
  const lines: Line[] = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    // bei offenen Linien vom Ende aus laufen
    let s = start;
    {
      let prev = -1;
      let cur = start;
      const seen = new Set<number>([cur]);
      for (;;) {
        const nb = (adj.get(cur) ?? []).filter((q) => q !== prev && !seen.has(q));
        if (adj.get(cur)!.length < 2 || !nb.length) break;
        prev = cur;
        cur = nb[0];
        seen.add(cur);
      }
      if (adj.get(cur)!.length < 2) s = cur;
    }
    const ids = [s];
    used.add(s);
    let cur = s;
    for (;;) {
      const nb = (adj.get(cur) ?? []).find((q) => !used.has(q));
      if (nb === undefined) break;
      used.add(nb);
      ids.push(nb);
      cur = nb;
    }
    const closed = ids.length > 2 && (adj.get(cur) ?? []).includes(s);
    if (ids.length > 3) lines.push({ pts: ids.map(edgePt), closed });
  }
  return lines;
}

/** Glätten (Chaikin) und gleichmäßig neu abtasten. */
function resample(l: Line, step: number): Line {
  let p = l.pts;
  for (let it = 0; it < 2; it++) {
    const q: THREE.Vector2[] = [];
    const m = l.closed ? p.length : p.length - 1;
    if (!l.closed) q.push(p[0]);
    for (let i = 0; i < m; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      q.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75));
    }
    if (!l.closed) q.push(p[p.length - 1]);
    p = q;
  }
  const out: THREE.Vector2[] = [p[0].clone()];
  let acc = 0;
  const m = l.closed ? p.length : p.length - 1;
  for (let i = 0; i < m; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const d = a.distanceTo(b);
    let t = step - acc;
    while (t <= d) {
      out.push(a.clone().lerp(b, t / d));
      t += step;
    }
    acc = d - (t - step);
  }
  if (l.closed && out.length > 1 && out[out.length - 1].distanceTo(out[0]) < step * 0.5) out.pop();
  return { pts: out, closed: l.closed };
}

/** Baut die gebogenen Mauern; skip(x, z) = an dieser Kante keine Mauer (Basis, Camp-Modelle, …). */
export function buildWallGeometry(grid: NavGrid, asset: WallAsset, skip: (x: number, z: number) => boolean) {
  const n = grid.n;
  const sd = (x: number, z: number) => cellSample(grid.sdf, n, x, z);
  const L = asset.length * WALL_SCALE;
  const D = asset.depth * WALL_SCALE;
  const src = asset.geo;
  const sp = src.attributes.position;
  const sn = src.attributes.normal;
  const su = src.attributes.uv;
  const sidx = src.index ? (Array.from(src.index.array as ArrayLike<number>) as number[]) : Array.from({ length: sp.count }, (_, i) => i);
  // in Kacheln, damit die Kamera unsichtbare Teile weglassen kann
  const CH = 6;
  const tiles = Array.from({ length: CH * CH }, () => ({ pos: [] as number[], nor: [] as number[], uv: [] as number[], idx: [] as number[] }));
  const STEP = 0.5;
  let pieces = 0;
  let total = 0;
  for (const raw of contours(grid)) {
    const line = resample(raw, STEP);
    const P = line.pts;
    if (P.length < 4) continue;
    // Normale zur Wand hin, Dicke der Wand und Ausschluss je Punkt
    const N: THREE.Vector2[] = [];
    const depth: number[] = [];
    const ok: boolean[] = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[line.closed ? (i - 1 + P.length) % P.length : Math.max(0, i - 1)];
      const b = P[line.closed ? (i + 1) % P.length : Math.min(P.length - 1, i + 1)];
      const t = b.clone().sub(a).normalize();
      let nn = new THREE.Vector2(-t.y, t.x);
      if (sd(P[i].x + nn.x * 0.6, P[i].y + nn.y * 0.6) > sd(P[i].x - nn.x * 0.6, P[i].y - nn.y * 0.6)) nn = nn.negate();
      N.push(nn);
      // bis zur Mitte der Wand (dort steigt das Feld wieder), höchstens Mauertiefe
      let dEff = D;
      let prev = sd(P[i].x, P[i].y);
      for (let s = 0.4; s <= D; s += 0.4) {
        const v = sd(P[i].x + nn.x * s, P[i].y + nn.y * s);
        if (v > prev + 0.02) {
          dEff = Math.max(0.5, s - 0.2);
          break;
        }
        prev = v;
      }
      depth.push(dEff);
      const x = P[i].x;
      const z = P[i].y;
      ok.push(x > 1 && z > 1 && x < MAP - 1 && z < MAP - 1 && !skip(x, z) && !FOUNTAIN.some((f) => Math.hypot(f.x - x, f.z - z) < 14));
    }
    // zusammenhängende Abschnitte mit Mauer
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i < P.length; i++) {
      if (ok[i]) cur.push(i);
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) {
      if (line.closed && runs.length && runs[0][0] === 0) runs[0] = [...cur, ...runs[0]];
      else runs.push(cur);
    }
    const whole = line.closed && runs.length === 1 && runs[0].length === P.length;
    for (const run of runs) {
      const cnt = whole ? run.length : run.length - 1;
      const len = cnt * STEP;
      if (len < 2) continue;
      total += len;
      const k = Math.max(1, Math.round(len / L));
      const seg = len / k;
      // Laufrichtung gegenüber der Kantenrichtung (Normale um 90° gedreht): sonst wäre das Stück gespiegelt
      const mid = run[Math.floor(run.length / 2)];
      const nxt = P[run[Math.min(run.length - 1, Math.floor(run.length / 2) + 1)]];
      const flip = (nxt.x - P[mid].x) * -N[mid].y + (nxt.y - P[mid].y) * N[mid].x < 0;
      // Punkt, Normale und Tiefe an Bogenlänge s (s läuft entlang run)
      const at = (s: number) => {
        const f = Math.max(0, Math.min(cnt - 1e-4, s / STEP));
        const i = Math.floor(f);
        const t = f - i;
        const ia = run[i];
        const ib = run[(i + 1) % run.length];
        return {
          p: P[ia].clone().lerp(P[ib], t),
          nn: N[ia].clone().lerp(N[ib], t).normalize(),
          d: depth[ia] * (1 - t) + depth[ib] * t,
        };
      };
      for (let j = 0; j < k; j++) {
        const c0 = at((j + 0.5) * seg).p;
        const tile = tiles[Math.min(CH - 1, Math.max(0, Math.floor((c0.x / MAP) * CH))) + Math.min(CH - 1, Math.max(0, Math.floor((c0.y / MAP) * CH))) * CH];
        const { pos, nor, uv, idx } = tile;
        const base = pos.length / 3;
        for (let v = 0; v < sp.count; v++) {
          const mx = sp.getX(v);
          const my = sp.getY(v);
          const mz = sp.getZ(v);
          const u0 = mx / asset.length + 0.5;
          const u = flip ? 1 - u0 : u0;
          const s = (j + u) * seg;
          const q = at(s);
          const dd = (-mz / asset.depth) * q.d;
          const tx = -q.nn.y;
          const tz = q.nn.x;
          pos.push(q.p.x + q.nn.x * dd, my * WALL_SCALE - WALL_SINK, q.p.y + q.nn.y * dd);
          // Normale: Modell x -> Kante, Modell -z -> in die Wand, y -> oben (Biegung vernachlässigt)
          const nx = sn.getX(v);
          const ny = sn.getY(v);
          const nz = sn.getZ(v);
          const wx = tx * nx - q.nn.x * nz;
          const wz = tz * nx - q.nn.y * nz;
          const l = Math.hypot(wx, ny, wz) || 1;
          nor.push(wx / l, ny / l, wz / l);
          uv.push(su.getX(v), su.getY(v));
        }
        for (const i of sidx) idx.push(base + i);
        pieces++;
      }
    }
  }
  const geos = tiles
    .filter((t) => t.idx.length)
    .map((t) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(t.nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(t.uv, 2));
      geo.setIndex(t.idx);
      geo.computeBoundingSphere();
      return geo;
    });
  return { geos, pieces, length: Math.round(total) };
}
