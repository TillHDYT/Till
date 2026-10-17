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
  // wie auf der Kluft (Vorlage assets-src/jungle/kluft.webp): Lanes laufen durch die Türme, die Dschungelwände
  // reichen bis an den Lane-Rand; die Ecken sind schräg abgeschnitten. Bot ist Top an der Nebendiagonale gespiegelt.
  top: [v(24, 176), v(18, 164), v(16.67, 152), v(16.67, 53.33), v(18, 37.33), v(21.33, 28), v(28, 21.33), v(37.33, 18), v(53.33, 16.67), v(152, 16.67), v(164, 18), v(176, 24)],
  mid: [v(24, 176), v(36, 164), v(46, 154), v(154, 46), v(164, 36), v(176, 24)],
  bot: [v(24, 176), v(36, 182), v(48, 183.33), v(146.67, 183.33), v(162.67, 182), v(172, 178.67), v(178.67, 172), v(182, 162.67), v(183.33, 146.67), v(183.33, 48), v(182, 36), v(176, 24)],
};

export const LANE_WIDTH: Record<LaneId, number> = { top: 20, mid: 18, bot: 20 };

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

// Gebäude an den LoL-Positionen; Inhibitoren und Inhib-Türme wie in LoL an den Treppen des Basis-Modells
// (assets-src/base-model): Turm vor der Treppe auf der Lane, Inhibitor direkt dahinter in der Basis
const BLUE_STRUCTS: StructureSpec[] = [
  { kind: "nexus", team: 0, pos: lol(1543, 1661) },
  { kind: "turret", team: 0, lane: "base", tier: "nexus", pos: lol(1724, 2242) },
  { kind: "turret", team: 0, lane: "base", tier: "nexus", pos: lol(2125, 1760) },
  { kind: "inhib", team: 0, lane: "top", pos: { x: 25, z: 207.5 } },
  { kind: "inhib", team: 0, lane: "mid", pos: { x: 81.6, z: 218.4 } },
  { kind: "inhib", team: 0, lane: "bot", pos: { x: 96.5, z: 275 } },
  { kind: "turret", team: 0, lane: "top", tier: "inhib", pos: { x: 25, z: 192.5 } },
  { kind: "turret", team: 0, lane: "mid", tier: "inhib", pos: { x: 91.4, z: 208.6 } },
  { kind: "turret", team: 0, lane: "bot", tier: "inhib", pos: { x: 111.5, z: 275 } },
  { kind: "turret", team: 0, lane: "top", tier: "inner", pos: lol(1512, 6699) },
  { kind: "turret", team: 0, lane: "mid", tier: "inner", pos: { x: 105.5, z: 194.5 } },
  { kind: "turret", team: 0, lane: "bot", tier: "inner", pos: lol(6919, 1483) },
  { kind: "turret", team: 0, lane: "top", tier: "outer", pos: lol(981, 10441) },
  { kind: "turret", team: 0, lane: "mid", tier: "outer", pos: lol(5846, 6396) },
  { kind: "turret", team: 0, lane: "bot", tier: "outer", pos: lol(10504, 1029) },
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

/** Feuerschalen (wie auf der Kluft): auf den Mauerecken an den Flussmündungen der Mid-Lane und am Ufer der Lane-Ecken, Rot gespiegelt. */
export const RIVER_BRAZIERS: V2[] = [
  { x: (149 * MAP) / 300, z: (130 * MAP) / 300 },
  { x: (131 * MAP) / 300, z: (148 * MAP) / 300 },
  // an der Westseite der langen Felswand am Baron-Flussarm
  { x: (39 * MAP) / 300, z: (58 * MAP) / 300 },
  { x: (48 * MAP) / 300, z: (72 * MAP) / 300 },
].flatMap((p) => [p, mirror(p)]);

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
  // Baron-Seite (Drache gespiegelt): Busch im Flussarm und Busch zwischen Sichelfelsen und Grube
  { p: { x: (61 * MAP) / 300, z: (61 * MAP) / 300 }, r: 2.4 },
  { p: { x: (75 * MAP) / 300, z: (47 * MAP) / 300 }, r: 3 },
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

/** Punkt auf der entzerrten LoL-Draufsicht (1024², assets-src/jungle) in 200er-Koordinaten der blauen Seite. */
const px = (x: number, y: number): V2 => ({ x: (x * 200) / 1024, z: (y * 200) / 1024 });
/** Rand der Basis zur Dschungelseite entlang der Fackelsäulen wie auf der Kluft. */
const BASE_WALL_LINE: V2[] = [px(120, 680), px(170, 685), px(215, 695), px(250, 715), px(280, 740), px(305, 770), px(322, 805), px(332, 845), px(336, 885), px(338, 930), px(338, 1000)];
const BASE_POLY: V2[] = [px(45, 1000), px(45, 680), ...BASE_WALL_LINE];
/** Mauerstücke zwischen den Fackelsäulen (Top-Ausgang, Mid-Ecke und Bot-Ausgang sind breite Treppen, also frei). */
const BASE_WALL_SEGS: V2[][] = [
  [px(124, 689), px(165, 692), px(202.5, 697), px(237, 714)],
  [px(304, 777), px(318, 812), px(333, 850), px(335.5, 891)],
];

/** Basisplattform (wie die Basis auf der Kluft). */
export function inBaseArea(team: Team, p: V2) {
  const q = toBlue(team, p);
  return pointInPolygon(q, BASE_POLY);
}

function pointInPolygon(p: V2, poly: V2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Mauer der Basis zur Dschungelseite, wie in LoL mit zwei Toren; die Lanes laufen frei hindurch.
 * Dahinter führt ein geschwungener Weg um die Basis von Top über Mid nach Bot.
 */
const BASE_WALL = 4;
const BASE_GATES: V2[][] = [
  // Lücke im Felsrand des Basis-Modells (assets-src/base-model)
  [px(198, 714), px(196, 645)],
  [px(312, 828), px(392, 828)],
];
const BASE_WALK: V2[] = [px(55, 660), px(120, 660), px(175, 664), px(225, 675), px(265, 697), px(298, 723), px(325, 757), px(343, 795), px(354, 840), px(358, 885), px(360, 965)];
export const BASE_WALK_WIDTH = 7;
function toBlue(team: Team, p: V2) {
  const m = team === 0 ? p : mirror(p);
  return { x: m.x / MAP_SCALE, z: m.z / MAP_SCALE };
}
/** Liegt der Punkt in der Basismauer (Tore ausgenommen)? */
export function inBaseWall(team: Team, p: V2) {
  if (!inBaseArea(team, p)) return false;
  const q = toBlue(team, p);
  if (BASE_WALL_SEGS.every((seg) => distToPolyline(q, seg) * MAP_SCALE > BASE_WALL)) return false;
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
