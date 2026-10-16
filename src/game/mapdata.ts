// Layout der Kluft. Koordinaten in Welt-Einheiten, x nach Osten, z nach Süden.
// Blau sitzt unten links, Rot oben rechts. Rot ist die Punktspiegelung von Blau.

/** Vergrößerung der Karte: alle Positionen unten sind auf 200 x 200 angegeben und werden damit gestreckt
 *  (Breiten von Lanes, Fluss und Wegen und die Größe der Figuren bleiben gleich). */
export const MAP_SCALE = 1.5;
export const MAP = 200 * MAP_SCALE;

export type V2 = { x: number; z: number };
export type Team = 0 | 1;
export type LaneId = "top" | "mid" | "bot";

export const v = (x: number, z: number): V2 => ({ x: x * MAP_SCALE, z: z * MAP_SCALE });
/** Position aus LoL-Koordinaten der Kluft (0..14870, y nach oben, Blau unten links). */
export const lol = (X: number, Y: number): V2 => ({ x: (X / 14870) * MAP, z: (1 - Y / 14870) * MAP });
/** Punktspiegelung auf die rote Seite. */
export const mirror = (p: V2): V2 => ({ x: MAP - p.x, z: MAP - p.z });

// Lane-Mittellinien von der blauen Nexus bis zur roten Nexus.
export const LANES: Record<LaneId, V2[]> = {
  top: [v(24, 176), v(16, 160), v(14, 146), v(14, 36), v(17, 23), v(23, 17), v(36, 14), v(146, 14), v(160, 16), v(176, 24)],
  mid: [v(24, 176), v(36, 164), v(46, 154), v(154, 46), v(164, 36), v(176, 24)],
  bot: [v(24, 176), v(40, 184), v(54, 186), v(164, 186), v(177, 183), v(183, 177), v(186, 164), v(186, 54), v(184, 40), v(176, 24)],
};

export const LANE_WIDTH: Record<LaneId, number> = { top: 13, mid: 12, bot: 13 };

/** Wegpunkte einer Lane aus Sicht eines Teams (Start an der eigenen Nexus). */
export function lanePath(team: Team, lane: LaneId): V2[] {
  const pts = LANES[lane];
  return team === 0 ? pts : [...pts].reverse();
}

export type TurretTier = "outer" | "inner" | "inhib" | "nexus";
export type StructureSpec =
  | { kind: "turret"; team: Team; lane: LaneId | "base"; tier: TurretTier; pos: V2 }
  | { kind: "inhib"; team: Team; lane: LaneId; pos: V2 }
  | { kind: "nexus"; team: Team; pos: V2 };

const BLUE_STRUCTS: StructureSpec[] = [
  { kind: "nexus", team: 0, pos: v(24, 176) },
  { kind: "turret", team: 0, lane: "base", tier: "nexus", pos: v(27, 166) },
  { kind: "turret", team: 0, lane: "base", tier: "nexus", pos: v(34, 173) },
  { kind: "inhib", team: 0, lane: "top", pos: v(14, 149) },
  { kind: "inhib", team: 0, lane: "mid", pos: v(43, 157) },
  { kind: "inhib", team: 0, lane: "bot", pos: v(51, 186) },
  { kind: "turret", team: 0, lane: "top", tier: "inhib", pos: v(14, 137) },
  { kind: "turret", team: 0, lane: "mid", tier: "inhib", pos: v(51, 149) },
  { kind: "turret", team: 0, lane: "bot", tier: "inhib", pos: v(63, 186) },
  { kind: "turret", team: 0, lane: "top", tier: "inner", pos: v(14, 100) },
  { kind: "turret", team: 0, lane: "mid", tier: "inner", pos: v(66, 134) },
  { kind: "turret", team: 0, lane: "bot", tier: "inner", pos: v(100, 186) },
  { kind: "turret", team: 0, lane: "top", tier: "outer", pos: v(14, 58) },
  { kind: "turret", team: 0, lane: "mid", tier: "outer", pos: v(82, 118) },
  { kind: "turret", team: 0, lane: "bot", tier: "outer", pos: v(142, 186) },
];

const SWAP_LANE: Record<LaneId, LaneId> = { top: "bot", mid: "mid", bot: "top" };

export const STRUCTURES: StructureSpec[] = [
  ...BLUE_STRUCTS,
  ...BLUE_STRUCTS.map((s): StructureSpec => {
    const pos = mirror(s.pos);
    if (s.kind === "nexus") return { kind: "nexus", team: 1, pos };
    if (s.kind === "inhib") return { kind: "inhib", team: 1, lane: SWAP_LANE[s.lane], pos };
    return { kind: "turret", team: 1, lane: s.lane === "base" ? "base" : SWAP_LANE[s.lane], tier: s.tier, pos };
  }),
];

export const FOUNTAIN: [V2, V2] = [v(9, 191), mirror(v(9, 191))];
export const FOUNTAIN_RADIUS = 8;
export const SPAWN: [V2, V2] = [v(13, 187), mirror(v(13, 187))];

export type CampKind = "blue" | "red" | "gromp" | "wolves" | "raptors" | "krugs" | "dragon" | "baron" | "scuttle";
export type CampSpec = { id: string; kind: CampKind; pos: V2; side: Team | -1 };

// Camp-Positionen wie in LoL (LoL-Koordinaten; dieselben nutzt assets-src/jungle/mask.py für die Nischen)
const BLUE_CAMPS: { kind: CampKind; pos: V2 }[] = [
  { kind: "blue", pos: lol(3821, 8101) },
  { kind: "gromp", pos: lol(2288, 8448) },
  { kind: "wolves", pos: lol(3780, 6443) },
  { kind: "raptors", pos: lol(6943, 5422) },
  { kind: "red", pos: lol(7765, 4020) },
  { kind: "krugs", pos: lol(8394, 2641) },
];

/** Kuhle (Mulde im Boden) jedes Dschungel-Camps: Radius, in dem die Monster stehen; frei von Baumkronen. */
export const CAMP_PIT: Partial<Record<CampKind, number>> = { blue: 6, red: 6, gromp: 5.3, wolves: 5.7, raptors: 5.8, krugs: 5.5 };
/** Tiefe der Kuhlen. */
export const CAMP_PIT_DEPTH = 0.45;

/** Größe der Champions gegenüber der Karte (Modell, Lebensleiste). */
export const CHAMP_SIZE = 1.4;
/** Größe der Dschungelmonster gegenüber ihren Grundmaßen (Modell, Lebensleiste). */
export const MONSTER_SIZE = 2;
/** Trefferzone (Radius) der Dschungelmonster wächst mit, damit niemand im Modell steht. */
export const MONSTER_RADIUS = 1.5;

export const DRAGON_POS = lol(9866, 4414);
export const BARON_POS = mirror(DRAGON_POS);
const SCUTTLE_POS = lol(10500, 5170);

export const CAMPS: CampSpec[] = [
  ...BLUE_CAMPS.map((c, i) => ({ id: `b${i}`, kind: c.kind, pos: c.pos, side: 0 as const })),
  ...BLUE_CAMPS.map((c, i) => ({ id: `r${i}`, kind: c.kind, pos: mirror(c.pos), side: 1 as const })),
  { id: "baron", kind: "baron", pos: BARON_POS, side: -1 },
  { id: "dragon", kind: "dragon", pos: DRAGON_POS, side: -1 },
  { id: "scuttleT", kind: "scuttle", pos: mirror(SCUTTLE_POS), side: -1 },
  { id: "scuttleB", kind: "scuttle", pos: SCUTTLE_POS, side: -1 },
];

// Wände im Jungle: Baum- und Felsinseln wie auf der Kluft, siehe jungleMask.ts (assets-src/jungle/mask.py).

// Büsche (Gras zum Verstecken), Kreise.
const BLUE_BRUSH: { p: V2; r: number }[] = [
  { p: lol(1626, 9860), r: 3 },
  { p: lol(4356, 7290), r: 2.8 },
  { p: lol(2541, 7609), r: 2.6 },
  { p: lol(6172, 7537), r: 2.8 },
  { p: lol(5257, 5576), r: 2.6 },
  { p: lol(6215, 5983), r: 2.6 },
  { p: lol(6825, 3834), r: 2.8 },
  { p: lol(9032, 2701), r: 2.6 },
  { p: lol(8568, 5983), r: 2.8 },
  { p: lol(12198, 3514), r: 3 },
  { p: lol(10165, 2352), r: 2.6 },
];

export const BRUSHES: { p: V2; r: number }[] = [
  ...BLUE_BRUSH,
  ...BLUE_BRUSH.map((b) => ({ p: mirror(b.p), r: b.r })),
];

// Fluss: Diagonale von oben links nach unten rechts.
export const RIVER: V2[] = [v(18, 18), v(38, 44), v(60, 64), v(84, 82), v(100, 100), v(116, 118), v(140, 136), v(162, 156), v(182, 182)];
export const RIVER_WIDTH = 15;

/** Basisplattform: Quadrat in der Ecke, Innenecke zur Kartenmitte abgeschrägt. */
export function inBaseArea(team: Team, p: V2) {
  const m = team === 0 ? p : mirror(p);
  const q = { x: m.x / MAP_SCALE, z: m.z / MAP_SCALE };
  if (q.x < 5 || q.x > 57 || q.z < 143 || q.z > 195) return false;
  // abgeschrägte Innenecke (oben rechts aus blauer Sicht)
  if (q.x - q.z > 57 - 143 - 18) return false;
  // leicht gerundete Außenecken
  if (q.x < 13 && q.z < 151 && Math.hypot(q.x - 13, q.z - 151) > 8) return false;
  if (q.x > 49 && q.z > 187 && Math.hypot(q.x - 49, q.z - 187) > 8) return false;
  return true;
}

/**
 * Mauer der Basis zur Dschungelseite (oben, abgeschrägte Ecke, rechts aus blauer Sicht), wie in LoL mit zwei Toren;
 * die Lanes laufen frei hindurch. Dahinter führt ein geschwungener Weg um die Basis von Top über Mid nach Bot.
 */
const BASE_WALL = 4;
const BASE_GATES: V2[][] = [
  [{ x: 28, z: 148 }, { x: 28, z: 136 }],
  [{ x: 52, z: 172 }, { x: 64, z: 172 }],
];
const BASE_WALK: V2[] = [
  { x: 14, z: 139 },
  { x: 37, z: 138.5 },
  { x: 47, z: 145 },
  { x: 55, z: 153 },
  { x: 61.5, z: 163 },
  { x: 62, z: 186 },
];
export const BASE_WALK_WIDTH = 7;
const toBlue = (team: Team, p: V2) => {
  const m = team === 0 ? p : mirror(p);
  return { x: m.x / MAP_SCALE, z: m.z / MAP_SCALE };
};
/** Liegt der Punkt in der Basismauer (Tore ausgenommen)? */
export function inBaseWall(team: Team, p: V2) {
  if (!inBaseArea(team, p)) return false;
  const q = toBlue(team, p);
  const edge = Math.min(q.z - 143, (q.z - q.x - 104) / Math.SQRT2, 57 - q.x) * MAP_SCALE;
  if (edge > BASE_WALL) return false;
  return !BASE_GATES.some((g) => distToPolyline(q, g) * MAP_SCALE < 3.2);
}
/** Liegt der Punkt auf dem Weg um die Basis oder in einem ihrer Tore? */
export function onBaseWalk(team: Team, p: V2) {
  const q = toBlue(team, p);
  if (distToPolyline(q, BASE_WALK) * MAP_SCALE < BASE_WALK_WIDTH / 2) return true;
  return BASE_GATES.some((g) => distToPolyline(q, g) * MAP_SCALE < 3.2);
}

export function distToSegment(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + dx * t - p.x;
  const qz = a.z + dz * t - p.z;
  return Math.sqrt(qx * qx + qz * qz);
}

export function distToPolyline(p: V2, pts: V2[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  return best;
}
