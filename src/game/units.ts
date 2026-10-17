import type { ChampDef, Role } from "./champions";
import { ITEM_BY_ID, type StatMods } from "./items";
import { CHAMP_SIZE, MONSTER_RADIUS, MONSTER_SIZE, type CampKind, type LaneId, type V2 } from "./mapdata";

export type Kind = "champion" | "minion" | "turret" | "inhib" | "nexus" | "monster";
export type Side = 0 | 1 | 2;
export type DmgType = "phys" | "magic" | "true";

export type Stats = {
  maxHp: number;
  hpReg: number;
  maxMana: number;
  manaReg: number;
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  as: number;
  range: number;
  ms: number;
  crit: number;
  ls: number;
  haste: number;
};

export type Buff = { id: string; until: number; mods?: StatMods; tag?: string };

export type DashOpts = {
  hitRadius?: number;
  onHit?: (u: Unit) => void;
  onArrive?: () => void;
  untargetable?: boolean;
  leap?: boolean;
  /** geht durch Wände (landet hinter der Wand, wenn die Reichweite genügt) */
  passWalls?: boolean;
  forced?: boolean;
};

export type Dash = DashOpts & {
  tx: number;
  tz: number;
  sx: number;
  sz: number;
  speed: number;
  hit: Set<number>;
  total: number;
};

let NEXT_ID = 1;

export function emptyStats(): Stats {
  return { maxHp: 1, hpReg: 0, maxMana: 0, manaReg: 0, ad: 0, ap: 0, armor: 0, mr: 0, as: 0.6, range: 2, ms: 5, crit: 0, ls: 0, haste: 0 };
}

export class Unit {
  readonly id = NEXT_ID++;
  kind: Kind;
  team: Side;
  x: number;
  z: number;
  radius: number;
  facing = 0;
  hp = 1;
  mana = 0;
  base: Stats;
  stats: Stats;
  alive = true;
  diedAt = 0;
  target: Unit | null = null;
  atkCd = 0;
  lockT = 0;
  stunUntil = 0;
  knockUntil = 0;
  slowPct = 0;
  slowUntil = 0;
  shield = 0;
  shieldUntil = 0;
  buffs: Buff[] = [];
  lastDamagedAt = -99;
  lastDamagedByChampAt = -99;
  damagedBy = new Map<Champion, number>();
  height = 2.2;
  invulnerable = false;
  dash: Dash | null = null;
  vis: [boolean, boolean] = [true, true];
  revealUntil = 0;
  /** Bewegung: gemerkte Ausweichseite an Gebäuden, Umweg per Pfadsuche und Fortschrittskontrolle gegen Festhängen. */
  steer = { id: -1, side: 0 };
  nav = { path: [] as V2[], gx: 0, gz: 0, at: -99, px: 0, pz: 0, pt: 0, stuck: 0 };
  /** Für die Darstellung. swing: Fortschritt 0..1 des laufenden Schlags (Schlaganimation), -1 = keiner. */
  anim = { atk: 0, cast: 0, hit: 0, moving: false, speed: 0, walk: 0, swing: -1 };
  vx = 0;
  vz = 0;

  constructor(kind: Kind, team: Side, x: number, z: number, radius: number, base: Stats) {
    this.kind = kind;
    this.team = team;
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.base = base;
    this.stats = { ...base };
    this.hp = base.maxHp;
    this.mana = base.maxMana;
  }

  get untargetable() {
    return !!this.dash?.untargetable;
  }

  stunned(t: number) {
    return t < this.stunUntil || t < this.knockUntil;
  }

  hasBuff(id: string) {
    return this.buffs.some((b) => b.id === id);
  }

  extraMods(): StatMods[] {
    return [];
  }

  recalc() {
    const mods: StatMods[] = [...this.extraMods(), ...this.buffs.map((b) => b.mods ?? {})];
    const s = { ...this.base };
    let asPct = 0;
    let msPct = 0;
    for (const m of mods) {
      s.maxHp += m.hp ?? 0;
      s.maxMana += m.mana ?? 0;
      s.ad += m.ad ?? 0;
      s.ap += m.ap ?? 0;
      s.armor += m.armor ?? 0;
      s.mr += m.mr ?? 0;
      s.crit += m.crit ?? 0;
      s.ls += m.ls ?? 0;
      s.haste += m.haste ?? 0;
      s.hpReg += m.hpReg ?? 0;
      s.manaReg += m.manaReg ?? 0;
      asPct += m.as ?? 0;
      msPct += m.ms ?? 0;
    }
    s.as = Math.min(2.5, s.as * (1 + asPct / 100));
    s.ms = s.ms * (1 + msPct / 100);
    s.crit = Math.min(100, s.crit);
    const oldMax = this.stats.maxHp;
    this.stats = s;
    if (s.maxHp > oldMax && this.alive) this.hp += s.maxHp - oldMax;
    this.hp = Math.min(this.hp, s.maxHp);
    this.mana = Math.min(this.mana, s.maxMana);
  }

  moveSpeed(t: number) {
    let ms = this.stats.ms;
    if (t < this.slowUntil) ms *= 1 - this.slowPct;
    return ms;
  }
}

export type Order = { type: "none" } | { type: "move"; x: number; z: number } | { type: "attack"; target: Unit };

export type Empower = { until: number; dmg: number; type: DmgType };

/** Laufender Schlag mit Schlaganimation (Zeiten in Spielzeit): Ausholen bis hitAt, dann Treffer, dann Erholung bis end. */
export type Swing = { target: Unit; start: number; hitAt: number; end: number; hit: boolean };

export class Champion extends Unit {
  def: ChampDef;
  level = 1;
  xp = 0;
  gold = 500;
  items: string[] = [];
  ranks = [0, 0, 0, 0];
  cds = [0, 0, 0, 0];
  points = 1;
  flashCd = 0;
  spell2: "heal" | "smite";
  spell2Cd = 0;
  kills = 0;
  deaths = 0;
  assists = 0;
  cs = 0;
  streak = 0;
  respawnAt = 0;
  role: Role;
  lane: LaneId;
  isPlayer = false;
  recallUntil = 0;
  /**
   * Feueratem (Thorne W): Startzeit, Ende, Richtung, Zeitfenster des Strahls (Sekunden ab Start) und Schaden je
   * Treffer-Takt. Klicken oder Laufen bricht ab.
   */
  breath: { t0: number; until: number; dx: number; dz: number; from: number; to: number; next: number; dmg: number } | null = null;
  recallStart = 0;
  moveVec: V2 | null = null;
  path: V2[] = [];
  order: Order = { type: "none" };
  empower: Empower | null = null;
  swing: Swing | null = null;
  /** Vom Spieler anvisierter Gegner (Rechtsklick oder Antippen): Fähigkeiten zielen automatisch darauf. */
  lockTarget: Unit | null = null;
  /** zuletzt eingesetzte Fähigkeit (Zähler steigt bei jedem Zauber), damit die Ansicht ihre Animation startet */
  lastCast = { slot: -1, n: 0 };
  lastAttackChampAt = -99;
  name: string;
  redBuff = false;
  blueBuff = false;

  constructor(def: ChampDef, team: 0 | 1, x: number, z: number, role: Role, name: string) {
    super("champion", team, x, z, 0.85, emptyStats());
    this.def = def;
    this.role = role;
    this.lane = role === "top" ? "top" : role === "mid" ? "mid" : role === "jungle" ? "mid" : "bot";
    this.spell2 = role === "jungle" ? "smite" : "heal";
    this.name = name;
    this.height = 2.6 * def.look.bulk * CHAMP_SIZE;
    this.applyLevel();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  applyLevel() {
    const d = this.def;
    const l = this.level - 1;
    this.base = {
      maxHp: d.base.hp + d.growth.hp * l,
      hpReg: d.base.hpReg + 0.12 * l,
      maxMana: d.base.mana + d.growth.mana * l,
      manaReg: d.base.manaReg + 0.1 * l,
      ad: d.base.ad + d.growth.ad * l,
      ap: 0,
      armor: d.base.armor + d.growth.armor * l,
      mr: d.base.mr + d.growth.mr * l,
      as: d.base.as * (1 + (d.growth.as * l) / 100),
      range: d.base.range,
      ms: d.base.ms,
      crit: 0,
      ls: 0,
      haste: 0,
    };
    this.recalc();
  }

  override extraMods(): StatMods[] {
    return this.items.map((id) => ITEM_BY_ID[id]?.stats ?? {});
  }

  xpToNext() {
    return 170 + this.level * 85;
  }

  canRank(slot: number) {
    if (this.points <= 0) return false;
    const r = this.ranks[slot];
    if (slot === 3) {
      const need = [5, 9, 13];
      return r < 3 && this.level >= need[r];
    }
    return r < 4 && r < Math.ceil(this.level / 2);
  }

  cdFor(slot: number) {
    const ab = this.def.abilities[slot];
    const r = Math.max(1, this.ranks[slot]);
    const base = ab.cd[Math.min(ab.cd.length - 1, r - 1)];
    return base * (100 / (100 + this.stats.haste));
  }

  manaFor(slot: number) {
    const ab = this.def.abilities[slot];
    const r = Math.max(1, this.ranks[slot]);
    return ab.mana[Math.min(ab.mana.length - 1, r - 1)];
  }
}

export type MinionType = "melee" | "caster" | "siege" | "super";

export class Minion extends Unit {
  mtype: MinionType;
  lane: LaneId;
  path: V2[];
  wp = 1;
  forcedUntil = 0;
  gold: number;
  xp: number;
  baronUntil = 0;

  constructor(team: 0 | 1, mtype: MinionType, lane: LaneId, path: V2[], scale: number) {
    const p = path[0];
    const base = emptyStats();
    let r = 0.6;
    let gold = 20;
    let xp = 55;
    if (mtype === "melee") {
      Object.assign(base, { maxHp: 470 * scale, ad: 14 * scale, as: 1.2, range: 1.6, ms: 5.6, armor: 5 });
      gold = 21;
      xp = 60;
    } else if (mtype === "caster") {
      Object.assign(base, { maxHp: 290 * scale, ad: 23 * scale, as: 0.7, range: 7, ms: 5.6 });
      r = 0.55;
      gold = 15;
      xp = 32;
    } else if (mtype === "siege") {
      Object.assign(base, { maxHp: 880 * scale, ad: 40 * scale, as: 0.9, range: 8, ms: 5.6, armor: 30, mr: 30 });
      r = 0.95;
      gold = 60;
      xp = 92;
    } else {
      Object.assign(base, { maxHp: 1600 * scale, ad: 95 * scale, as: 0.85, range: 2.0, ms: 5.8, armor: 40, mr: 30 });
      r = 1.1;
      gold = 40;
      xp = 97;
    }
    super("minion", team, p.x, p.z, r, base);
    this.mtype = mtype;
    this.lane = lane;
    this.path = path;
    this.gold = gold;
    this.xp = xp;
    this.height = mtype === "siege" ? 1.8 : mtype === "super" ? 2.6 : 1.5;
  }

  get ranged() {
    return this.mtype === "caster" || this.mtype === "siege";
  }
}

/** Lokale Lage des Turmkristalls relativ zum Turm (Blickrichtung +z). */
/** Mitte des Turmkristalls im 3D-Modell (assets-src/guardian.py: CRYSTAL_CENTER). */
export const TURRET_MUZZLE = { x: -1.36, y: 7.58, z: 0.34 };

export type TurretTier = "outer" | "inner" | "inhib" | "nexus";

export class Structure extends Unit {
  lane: LaneId | "base";
  tier: TurretTier | null;
  heat = 0;
  heatTarget: Unit | null = null;
  respawnAt = 0;

  constructor(kind: "turret" | "inhib" | "nexus", team: 0 | 1, pos: V2, lane: LaneId | "base", tier: TurretTier | null) {
    const base = emptyStats();
    let r = 1.7;
    if (kind === "turret") {
      const hp = tier === "outer" ? 3000 : tier === "inner" ? 2900 : tier === "inhib" ? 2800 : 2400;
      // Reichweite knapp über der der Fernkämpfer (12), damit sie Türme nicht ungestraft beschießen
      Object.assign(base, { maxHp: hp, ad: 165, as: 0.85, range: 13, armor: 45, mr: 45 });
    } else if (kind === "inhib") {
      Object.assign(base, { maxHp: 2600, armor: 20, mr: 20 });
      // Steinring des 3D-Modells hat Radius 3.2-3.6; jeder Inhibitor hat mindestens 7.25 Platz bis zur nächsten Wand, die Wege bleiben frei
      r = 3.0;
    } else {
      Object.assign(base, { maxHp: 4600, armor: 20, mr: 20, hpReg: 4 });
      // Sockel des Modells hat Radius 10.5 (bedeckt die silberne Sternfläche im Basisboden)
      r = 7.8;
    }
    super(kind, team, pos.x, pos.z, r, base);
    this.lane = lane;
    this.tier = tier;
    // Inhibitor: Kristallspitze bei 5.6, schwebt bis 0.2 höher; die Lebensleiste sitzt darüber
    this.height = kind === "turret" ? 10.4 : kind === "inhib" ? 6.2 : 7.5;
  }
}

export class Monster extends Unit {
  camp: string;
  mkind: CampKind;
  big: boolean;
  home: V2;
  resetting = false;
  gold: number;
  xp: number;
  label: string;

  constructor(camp: string, mkind: CampKind, big: boolean, pos: V2, scale: number) {
    const base = emptyStats();
    let r = 1.0;
    let gold = 30;
    let xp = 50;
    let label = "";
    const s = scale;
    switch (mkind) {
      case "blue":
        Object.assign(base, { maxHp: 1900 * s, ad: 72 * s, as: 0.5, range: 2.6, ms: 5, armor: 20, mr: 10 });
        r = 1.6;
        gold = 100;
        xp = 170;
        label = "Blauer Wächter";
        break;
      case "red":
        Object.assign(base, { maxHp: 1900 * s, ad: 78 * s, as: 0.5, range: 2.6, ms: 5, armor: 20, mr: 10 });
        r = 1.6;
        gold = 100;
        xp = 170;
        label = "Roter Wächter";
        break;
      case "gromp":
        Object.assign(base, { maxHp: 1500 * s, ad: 62 * s, as: 0.6, range: 4, ms: 4.5, armor: 10 });
        r = 1.4;
        gold = 85;
        xp = 130;
        label = "Kröte";
        break;
      case "wolves":
        Object.assign(base, big ? { maxHp: 1200 * s, ad: 48 * s, as: 0.65, range: 2, ms: 5.5, armor: 10 } : { maxHp: 380 * s, ad: 18 * s, as: 0.7, range: 1.8, ms: 5.5 });
        r = big ? 1.1 : 0.7;
        gold = big ? 58 : 16;
        xp = big ? 95 : 25;
        label = "Wolf";
        break;
      case "raptors":
        Object.assign(base, big ? { maxHp: 1000 * s, ad: 30 * s, as: 0.8, range: 2, ms: 5.5, armor: 10 } : { maxHp: 260 * s, ad: 12 * s, as: 0.8, range: 1.8, ms: 5.5 });
        r = big ? 1.0 : 0.6;
        gold = big ? 50 : 10;
        xp = big ? 85 : 18;
        label = "Raptor";
        break;
      case "krugs":
        Object.assign(base, big ? { maxHp: 1400 * s, ad: 78 * s, as: 0.5, range: 2.2, ms: 4.5, armor: 30 } : { maxHp: 700 * s, ad: 38 * s, as: 0.55, range: 2, ms: 4.5, armor: 20 });
        r = big ? 1.4 : 0.9;
        gold = big ? 70 : 25;
        xp = big ? 110 : 40;
        label = "Golem";
        break;
      case "scuttle":
        Object.assign(base, { maxHp: 1000 * s, ad: 0, as: 0.1, range: 0, ms: 3, armor: 40, mr: 40 });
        r = 1.1;
        gold = 70;
        xp = 110;
        label = "Flusskrabbe";
        break;
      case "dragon":
        Object.assign(base, { maxHp: 4200 * s, ad: 120 * s, as: 0.5, range: 6, ms: 4, armor: 30, mr: 30 });
        r = 2.4;
        gold = 0;
        xp = 300;
        label = "Drache";
        break;
      case "baron":
        Object.assign(base, { maxHp: 8500 * s, ad: 210 * s, as: 0.5, range: 7, ms: 0, armor: 60, mr: 60 });
        r = 3.2;
        gold = 0;
        xp = 600;
        label = "Baron";
        break;
    }
    if (mkind !== "dragon" && mkind !== "baron") base.ad *= 0.6;
    super("monster", 2, pos.x, pos.z, r * MONSTER_RADIUS, base);
    this.camp = camp;
    this.mkind = mkind;
    this.big = big;
    this.home = { ...pos };
    this.gold = gold;
    this.xp = xp;
    this.label = label;
    this.height = (r * 2.2 + 0.6) * MONSTER_SIZE;
  }
}
