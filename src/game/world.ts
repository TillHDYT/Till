import { CHAMPIONS, type ChampDef, type Role } from "./champions";
import { ITEM_BY_ID } from "./items";
import {
  CAMPS,
  FOUNTAIN,
  FOUNTAIN_RADIUS,
  MAP,
  SPAWN,
  STRUCTURES,
  distToSegment,
  lanePath,
  type CampKind,
  type CampSpec,
  type LaneId,
  type V2,
} from "./mapdata";
import { NavGrid } from "./navgrid";
import {
  Champion,
  Minion,
  Monster,
  Structure,
  TURRET_MUZZLE,
  Unit,
  type Buff,
  type DashOpts,
  type DmgType,
  type MinionType,
  type Side,
} from "./units";

export type FxKind =
  | "spin"
  | "shout"
  | "slam"
  | "burst"
  | "aura"
  | "blink"
  | "heal"
  | "levelup"
  | "recall"
  | "smite"
  | "explode"
  | "hit"
  | "death"
  | "respawn"
  | "shield"
  | "gold";

export type Fx = { type: FxKind; x: number; z: number; r?: number; color?: number; owner?: Unit; dur?: number; big?: boolean };

export type GameEvent =
  | { type: "dmg"; unit: Unit; amount: number; dtype: DmgType; crit: boolean; src: Unit | null }
  | { type: "heal"; unit: Unit; amount: number }
  | { type: "gold"; unit: Champion; amount: number }
  | { type: "announce"; text: string; team: Side | -1; sub?: string }
  | { type: "kill"; killer: Unit | null; victim: Champion; assists: Champion[] }
  | { type: "levelup"; unit: Champion }
  | { type: "cast"; unit: Champion; slot: number }
  | { type: "attack"; unit: Unit; target: Unit }
  | { type: "structure"; unit: Structure }
  | { type: "end"; winner: 0 | 1 }
  | { type: "sound"; name: string; x: number; z: number };

export type ProjVisual = "arrow" | "bolt" | "fireball" | "dagger" | "hook" | "bigarrow" | "turret" | "caster" | "siege" | "monster" | "dragon" | "baron";

export type Projectile = {
  id: number;
  owner: Unit;
  team: Side;
  x: number;
  z: number;
  y: number;
  y0: number;
  dx: number;
  dz: number;
  speed: number;
  traveled: number;
  range: number;
  width: number;
  homing: Unit | null;
  visual: ProjVisual;
  color: number;
  hit: Set<number>;
  sharedHits?: Set<number>;
  champsOnly?: boolean;
  noStructures?: boolean;
  onHit: (u: Unit, p: Projectile) => boolean | void;
  done: boolean;
};

export type Area = {
  id: number;
  owner: Unit;
  team: Side;
  x: number;
  z: number;
  radius: number;
  delay: number;
  t0: number;
  visual: string;
  color: number;
  follow?: Unit;
  onTrigger: (a: Area) => void;
  done: boolean;
};

type Dot = { target: Unit; src: Unit; dps: number; until: number };

export type SkillshotOpts = {
  dx: number;
  dz: number;
  speed: number;
  range: number;
  width: number;
  visual: ProjVisual;
  color: number;
  sharedHits?: Set<number>;
  champsOnly?: boolean;
  noStructures?: boolean;
  onHit: (u: Unit, p: Projectile) => boolean | void;
};

export type AreaOpts = {
  x: number;
  z: number;
  radius: number;
  delay: number;
  visual: string;
  color: number;
  follow?: Unit;
  onTrigger: (a: Area) => void;
};

export type Difficulty = "easy" | "normal" | "hard";

export type MatchSetup = {
  playerChamp: string;
  playerRole: Role;
  difficulty: Difficulty;
  autoplay?: boolean;
};

const ROLES: Role[] = ["top", "jungle", "mid", "bot", "support"];

/** Schlag mit Schlaganimation: so weit darf sich das Ziel bis zum Treffer entfernen (Ausfallschritt im Clip). */
const SWING_REACH = 0.75;
/** ... und so weit seitlich der Blickrichtung stehen (Bogen des Hakens), in Bogenmaß. */
const SWING_ARC = 1.2;

/** Abspieltempo der Schlaganimation: schneller, sobald der ganze Clip nicht mehr in einen Angriff passt. */
export function swingRate(sw: { clip: number }, as: number) {
  return Math.max(1, sw.clip * as);
}

const BOT_NAMES = [
  ["Aster", "Brann", "Corvin", "Dalia", "Elko"],
  ["Fenra", "Gorm", "Hexa", "Isko", "Jorun"],
];

const CAMP_MEMBERS: Record<CampKind, number> = {
  blue: 1,
  red: 1,
  gromp: 1,
  wolves: 3,
  raptors: 4,
  krugs: 2,
  scuttle: 1,
  dragon: 1,
  baron: 1,
};

export function dist(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export type Brain = { think: (w: World, c: Champion, dt: number) => void };

export class World {
  readonly grid: NavGrid;
  t = 0;
  champs: Champion[] = [];
  minions: Minion[] = [];
  structures: Structure[] = [];
  monsters: Monster[] = [];
  projectiles: Projectile[] = [];
  areas: Area[] = [];
  dots: Dot[] = [];
  events: GameEvent[] = [];
  fxQueue: Fx[] = [];
  brains = new Map<number, Brain>();
  player!: Champion;
  score: [number, number] = [0, 0];
  dragons: [number, number] = [0, 0];
  winner: 0 | 1 | null = null;
  endAt = 0;
  difficulty: Difficulty;
  firstBlood = false;
  campRespawn = new Map<string, number>();
  campAlive = new Map<string, boolean>();
  private nextWave = 20;
  private waveN = 0;
  private spawnQueue: { at: number; team: 0 | 1; lane: LaneId; type: MinionType }[] = [];
  private nextId = 1;
  private visT = 0;
  private multi = new Map<number, { n: number; at: number }>();

  constructor(grid: NavGrid, setup: MatchSetup, makeBrain: (c: Champion) => Brain) {
    this.grid = grid;
    this.difficulty = setup.difficulty;

    for (const s of STRUCTURES) {
      const st =
        s.kind === "turret"
          ? new Structure("turret", s.team, s.pos, s.lane, s.tier)
          : s.kind === "inhib"
            ? new Structure("inhib", s.team, s.pos, s.lane, null)
            : new Structure("nexus", s.team, s.pos, "base", null);
      this.structures.push(st);
    }
    // Türme schauen die Lane entlang zum Gegner, Basisgebäude zur Kartenmitte
    for (const st of this.structures) {
      let dx = 100 - st.x;
      let dz = 100 - st.z;
      if (st.kind === "turret" && st.lane !== "base") {
        const path = lanePath(st.team as 0 | 1, st.lane);
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < path.length - 1; i++) {
          const d = distToSegment(st, path[i], path[i + 1]);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        dx = path[bi + 1].x - path[bi].x;
        dz = path[bi + 1].z - path[bi].z;
      }
      st.facing = Math.atan2(dx, dz);
    }

    const pick = (avoid: Set<string>, role: Role): ChampDef => {
      const pref = CHAMPIONS.find((c) => c.role === role && !avoid.has(c.id));
      return pref ?? CHAMPIONS.find((c) => !avoid.has(c.id)) ?? CHAMPIONS[0];
    };

    for (const team of [0, 1] as const) {
      const used = new Set<string>();
      if (team === 0) used.add(setup.playerChamp);
      ROLES.forEach((role, i) => {
        let def: ChampDef;
        let isPlayer = false;
        if (team === 0 && role === setup.playerRole) {
          def = CHAMPIONS.find((c) => c.id === setup.playerChamp) ?? CHAMPIONS[0];
          isPlayer = true;
        } else {
          def = pick(used, role);
          used.add(def.id);
        }
        const sp = SPAWN[team];
        // Startreihe von der Plattform zur Kartenmitte, für Rot gespiegelt (vorher quer, ein Bot stand dann in den Ruinen)
        const side = team === 0 ? 1 : -1;
        const c = new Champion(def, team, sp.x + (i - 2) * 1.6 * side, sp.z - (i - 2) * 1.6 * side, role, isPlayer ? "Du" : BOT_NAMES[team][i]);
        c.isPlayer = isPlayer;
        c.facing = team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25;
        this.champs.push(c);
        if (isPlayer) this.player = c;
        if (!isPlayer || setup.autoplay) this.brains.set(c.id, makeBrain(c));
      });
    }

    for (const camp of CAMPS) {
      const first = camp.kind === "dragon" ? 180 : camp.kind === "baron" ? 600 : camp.kind === "scuttle" ? 75 : 35;
      this.campRespawn.set(camp.id, first);
      this.campAlive.set(camp.id, false);
    }
  }

  // ---------- Abfragen ----------

  get all(): Unit[] {
    const out: Unit[] = [];
    for (const c of this.champs) if (c.alive) out.push(c);
    for (const m of this.minions) if (m.alive) out.push(m);
    for (const m of this.monsters) if (m.alive) out.push(m);
    for (const s of this.structures) if (s.alive) out.push(s);
    return out;
  }

  isEnemy(team: Side, u: Unit) {
    return u.team !== team;
  }

  /** Gegner für Flächenschaden (keine Gebäude). */
  enemiesInRadius(team: Side, x: number, z: number, r: number): Unit[] {
    const out: Unit[] = [];
    const test = (u: Unit) => {
      if (!u.alive || u.team === team || u.untargetable) return;
      if (Math.hypot(u.x - x, u.z - z) <= r + u.radius * 0.6) out.push(u);
    };
    this.champs.forEach(test);
    this.minions.forEach(test);
    this.monsters.forEach(test);
    return out;
  }

  alliesInRadius(team: Side, x: number, z: number, r: number): Unit[] {
    const out: Unit[] = [];
    for (const c of this.champs) if (c.alive && c.team === team && Math.hypot(c.x - x, c.z - z) <= r) out.push(c);
    return out;
  }

  canSee(team: Side, u: Unit) {
    if (team === 2) return true;
    return u.vis[team];
  }

  attackable(u: Unit, byTeam: Side) {
    if (!u.alive || u.untargetable || u.team === byTeam) return false;
    if (u.invulnerable && (u.kind === "turret" || u.kind === "inhib" || u.kind === "nexus")) return false;
    if (byTeam !== 2 && !u.vis[byTeam]) return false;
    return true;
  }

  nearestEnemyChamp(team: Side, x: number, z: number, r: number): Champion | null {
    let best: Champion | null = null;
    let bd = r;
    for (const c of this.champs) {
      if (!this.attackable(c, team)) continue;
      const d = Math.hypot(c.x - x, c.z - z) - c.radius;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Zielwahl für Angriffe (Spieler-Buttons und Bots). */
  pickTarget(c: Unit, mode: "auto" | "minion" | "turret" | "champ", radius: number): Unit | null {
    const team = c.team;
    let best: Unit | null = null;
    let bestScore = Infinity;
    const consider = (u: Unit, prio: number) => {
      if (!this.attackable(u, team)) return;
      const d = Math.hypot(u.x - c.x, u.z - c.z) - u.radius;
      if (d > radius) return;
      const score = prio * 1000 + d + (mode === "minion" ? u.hp * 0.02 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    };
    if (mode === "auto" || mode === "champ") for (const u of this.champs) consider(u, 0);
    if (mode !== "turret" && mode !== "champ") {
      for (const u of this.minions) consider(u, mode === "minion" ? 0 : 1);
      for (const u of this.monsters) consider(u, mode === "minion" ? 0 : 1);
    }
    if (mode === "auto" || mode === "turret") for (const u of this.structures) consider(u, mode === "turret" ? 0 : 2);
    return best;
  }

  inFountain(c: Unit) {
    if (c.team === 2) return false;
    return dist(c, FOUNTAIN[c.team]) < FOUNTAIN_RADIUS + 2;
  }

  canShop(c: Champion) {
    return !c.alive || dist(c, FOUNTAIN[c.team as 0 | 1]) < FOUNTAIN_RADIUS + 6;
  }

  // ---------- Effekte ----------

  addFx(f: Fx) {
    this.fxQueue.push(f);
  }

  /** Kurzform für Fähigkeiten. */
  fx(f: Fx) {
    this.fxQueue.push(f);
  }

  skillshot(owner: Unit, o: SkillshotOpts) {
    this.projectiles.push({
      id: this.nextId++,
      owner,
      team: owner.team,
      x: owner.x + o.dx * 0.6,
      z: owner.z + o.dz * 0.6,
      y: 1.3,
      y0: 1.3,
      dx: o.dx,
      dz: o.dz,
      speed: o.speed,
      traveled: 0,
      range: o.range,
      width: o.width,
      homing: this.lockedFor(owner, o.range, o.champsOnly),
      visual: o.visual,
      color: o.color,
      hit: new Set(),
      sharedHits: o.sharedHits,
      champsOnly: o.champsOnly,
      noStructures: true,
      onHit: o.onHit,
      done: false,
    });
    this.events.push({ type: "sound", name: o.visual === "fireball" ? "fire" : o.visual === "hook" ? "hook" : "shoot", x: owner.x, z: owner.z });
  }

  homing(owner: Unit, target: Unit, speed: number, visual: ProjVisual, color: number, onHit: (u: Unit) => void, y = 1.4, from?: V2) {
    const sx = from ? from.x : owner.x;
    const sz = from ? from.z : owner.z;
    this.projectiles.push({
      id: this.nextId++,
      owner,
      team: owner.team,
      x: sx,
      z: sz,
      y,
      y0: y,
      dx: 0,
      dz: 0,
      speed,
      traveled: 0,
      // bei zielsuchenden Geschossen: Startabstand, für die Flugkurve
      range: Math.max(0.5, Math.hypot(target.x - sx, target.z - sz)),
      width: 0.3,
      homing: target,
      visual,
      color,
      hit: new Set(),
      onHit: (u) => {
        onHit(u);
        return true;
      },
      done: false,
    });
  }

  /** Gegner, auf den ein Geschoss der gerade ausgelösten Fähigkeit zufliegen soll (anvisiert und in Reichweite). */
  private lockedFor(owner: Unit, range: number, champsOnly?: boolean): Unit | null {
    const l = this.castLock;
    if (!l || l.kind === "turret" || l.kind === "inhib" || l.kind === "nexus" || (champsOnly && l.kind !== "champion")) return null;
    return dist(owner, l) <= range + l.radius + 1 ? l : null;
  }

  area(owner: Unit, o: AreaOpts) {
    // Fläche auf den anvisierten Gegner: sie wandert mit ihm, bis sie auslöst
    const l = this.lockedFor(owner, 99);
    if (l && !o.follow && Math.hypot(o.x - l.x, o.z - l.z) < 2) o = { ...o, follow: l };
    this.areas.push({ id: this.nextId++, owner, team: owner.team, t0: this.t, done: false, ...o });
  }

  /** Bewegt einen Punkt entlang der Linie zurück, bis er begehbar ist. */
  private landing(fromX: number, fromZ: number, x: number, z: number, passWalls: boolean): V2 {
    const g = this.grid;
    const dx = x - fromX;
    const dz = z - fromZ;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.4));
    if (!passWalls) {
      let last = { x: fromX, z: fromZ };
      for (let s = 1; s <= steps; s++) {
        const px = fromX + (dx * s) / steps;
        const pz = fromZ + (dz * s) / steps;
        if (!g.isOpen(px, pz)) break;
        last = { x: px, z: pz };
      }
      return last;
    }
    for (let s = steps; s >= 0; s--) {
      const px = fromX + (dx * s) / steps;
      const pz = fromZ + (dz * s) / steps;
      if (g.isOpen(px, pz)) return { x: px, z: pz };
    }
    return { x: fromX, z: fromZ };
  }

  dash(u: Unit, x: number, z: number, speed: number, opts: DashOpts) {
    if (u.kind === "turret" || u.kind === "inhib" || u.kind === "nexus") return;
    if (u.kind === "monster" && (u as Monster).big && ((u as Monster).mkind === "baron" || (u as Monster).mkind === "dragon")) return;
    const end = this.landing(u.x, u.z, x, z, !!opts.leap);
    const total = Math.hypot(end.x - u.x, end.z - u.z);
    u.dash = { ...opts, tx: end.x, tz: end.z, sx: u.x, sz: u.z, speed, hit: new Set(), total };
    if (end.x !== u.x || end.z !== u.z) u.facing = Math.atan2(end.x - u.x, end.z - u.z);
    if (u instanceof Champion) {
      u.path = [];
      this.cancelRecall(u);
    }
  }

  blink(u: Unit, x: number, z: number, color: number) {
    const end = this.landing(u.x, u.z, x, z, true);
    this.addFx({ type: "blink", x: u.x, z: u.z, color });
    if (end.x !== u.x || end.z !== u.z) u.facing = Math.atan2(end.x - u.x, end.z - u.z);
    u.x = end.x;
    u.z = end.z;
    u.dash = null;
    this.addFx({ type: "blink", x: u.x, z: u.z, color });
    if (u instanceof Champion) {
      u.path = [];
      this.cancelRecall(u);
    }
    this.events.push({ type: "sound", name: "blink", x: u.x, z: u.z });
  }

  ccImmune(u: Unit) {
    return u.kind === "turret" || u.kind === "inhib" || u.kind === "nexus" || (u instanceof Monster && (u.mkind === "baron" || u.mkind === "dragon"));
  }

  slow(u: Unit, pct: number, dur: number) {
    if (this.ccImmune(u)) return;
    if (this.t < u.slowUntil && u.slowPct > pct) {
      u.slowUntil = Math.max(u.slowUntil, this.t + dur * 0.5);
      return;
    }
    u.slowPct = pct;
    u.slowUntil = this.t + dur;
  }

  stun(u: Unit, dur: number) {
    if (this.ccImmune(u)) return;
    u.stunUntil = Math.max(u.stunUntil, this.t + dur);
    if (u instanceof Champion) this.cancelRecall(u);
  }

  knockup(u: Unit, dur: number) {
    if (this.ccImmune(u)) return;
    u.knockUntil = Math.max(u.knockUntil, this.t + dur);
    if (u instanceof Champion) this.cancelRecall(u);
  }

  shieldUnit(u: Unit, amount: number, dur: number) {
    u.shield = Math.max(u.shield, amount);
    u.shieldUntil = this.t + dur;
    this.addFx({ type: "shield", x: u.x, z: u.z, owner: u, dur });
  }

  addBuff(u: Unit, b: Buff) {
    u.buffs = u.buffs.filter((x) => x.id !== b.id);
    u.buffs.push(b);
    u.recalc();
  }

  heal(u: Unit, amount: number) {
    if (!u.alive) return;
    const before = u.hp;
    u.hp = Math.min(u.stats.maxHp, u.hp + amount);
    if (u.hp - before > 1) this.events.push({ type: "heal", unit: u, amount: u.hp - before });
  }

  // ---------- Schaden ----------

  damage(src: Unit | null, dst: Unit, raw: number, type: DmgType, opts: { attack?: boolean; ability?: boolean; crit?: boolean } = {}) {
    if (!dst.alive || this.winner !== null) return 0;
    if (dst.invulnerable) return 0;
    let amt = raw;
    if (src) {
      if (src.team === 0 || src.team === 1) amt *= 1 + this.dragons[src.team] * 0.06;
      if (src instanceof Minion && this.t < src.baronUntil) amt *= 1.5;
    }
    if (dst instanceof Minion && this.t < dst.baronUntil) amt *= 0.6;
    // Jungler (mit Zerschmettern) sind gegen Monster stärker
    if (dst instanceof Monster && src instanceof Champion && src.spell2 === "smite") amt *= 1.5;
    if (src instanceof Monster && dst instanceof Champion && dst.spell2 === "smite") amt *= 0.65;
    if (type !== "true") {
      const res = type === "phys" ? dst.stats.armor : dst.stats.mr;
      amt *= res >= 0 ? 100 / (100 + res) : 2 - 100 / (100 - res);
    }
    if (dst instanceof Monster && dst.resetting) amt *= 0.2;
    if (dst.shield > 0) {
      const absorbed = Math.min(dst.shield, amt);
      dst.shield -= absorbed;
      amt -= absorbed;
    }
    dst.hp -= amt;
    dst.lastDamagedAt = this.t;
    this.events.push({ type: "dmg", unit: dst, amount: amt + 0, dtype: type, crit: !!opts.crit, src });

    if (src instanceof Champion) {
      dst.damagedBy.set(src, this.t);
      dst.lastDamagedByChampAt = this.t;
      if (src.ranks && opts.attack && src.stats.ls > 0) this.heal(src, amt * (src.stats.ls / 100));
      if (dst instanceof Champion) {
        src.lastAttackChampAt = this.t;
        this.callForHelp(src, dst);
        this.cancelRecall(dst);
      }
      if (dst instanceof Monster) this.aggroCamp(dst, src);
      src.revealUntil = Math.max(src.revealUntil, this.t + 1.2);
    }
    if (dst instanceof Champion && src && !(src instanceof Champion)) this.cancelRecall(dst);

    if (dst.hp <= 0) this.kill(dst, src);
    return amt;
  }

  private callForHelp(attacker: Champion, victim: Champion) {
    for (const s of this.structures) {
      if (!s.alive || s.kind !== "turret" || s.team !== victim.team) continue;
      if (dist(s, attacker) <= s.stats.range + attacker.radius + 0.5) {
        if (s.target !== attacker) s.heat = 0;
        s.target = attacker;
        s.heatTarget = attacker;
      }
    }
    for (const m of this.minions) {
      if (!m.alive || m.team !== victim.team) continue;
      if (dist(m, attacker) < 10) {
        m.target = attacker;
        m.forcedUntil = this.t + 2.5;
      }
    }
  }

  private aggroCamp(mon: Monster, src: Champion) {
    for (const m of this.monsters) {
      if (!m.alive || m.camp !== mon.camp) continue;
      if (!m.target || !m.target.alive || m.resetting) {
        m.target = src;
        m.resetting = false;
      }
    }
  }

  basicAttack(u: Unit, target: Unit) {
    u.facing = Math.atan2(target.x - u.x, target.z - u.z);
    u.atkCd = 1 / Math.max(0.1, u.stats.as);
    u.lockT = Math.min(0.28, 0.22 / u.stats.as);
    u.anim.atk = 1;
    this.events.push({ type: "attack", unit: u, target });

    if (u instanceof Champion) {
      this.cancelRecall(u);
      const sw = u.def.swing;
      if (sw && !u.def.ranged) {
        // Schlaganimation startet; Schaden erst am Trefferzeitpunkt (updateSwing). Bis dahin bleibt der Champion stehen.
        const rate = swingRate(sw, u.stats.as);
        u.swing = { target, start: this.t, hitAt: this.t + sw.hit / rate, end: this.t + sw.clip / rate, hit: false };
        u.lockT = Math.max(u.lockT, sw.hit / rate);
        u.anim.swing = 0;
        return;
      }
      this.championHit(u, target);
      return;
    }

    if (u instanceof Structure) {
      const t = target;
      const muzzle = this.turretMuzzle(u);
      let dmg = u.stats.ad + this.t * 0.06;
      if (t instanceof Minion) {
        const pct = t.mtype === "melee" ? 0.45 : t.mtype === "caster" ? 0.7 : t.mtype === "siege" ? 0.14 : 0.08;
        dmg = t.stats.maxHp * pct;
        this.homing(u, t, 30, "turret", u.team === 0 ? 0x66ccff : 0xff7050, (x) => this.damage(u, x, dmg, "true"), TURRET_MUZZLE.y, muzzle);
      } else {
        if (u.heatTarget === t) u.heat = Math.min(3, u.heat + 1);
        else {
          u.heat = 0;
          u.heatTarget = t;
        }
        dmg *= 1 + u.heat * 0.4;
        this.homing(u, t, 30, "turret", u.team === 0 ? 0x66ccff : 0xff7050, (x) => this.damage(u, x, dmg, "phys"), TURRET_MUZZLE.y, muzzle);
      }
      this.events.push({ type: "sound", name: "turret", x: u.x, z: u.z });
      return;
    }

    if (u instanceof Minion) {
      const dmg = u.stats.ad * (target instanceof Champion ? 0.6 : 1);
      if (u.ranged) {
        this.homing(u, target, 18, u.mtype === "siege" ? "siege" : "caster", u.team === 0 ? 0x80c8ff : 0xff8070, (x) => this.damage(u, x, dmg, "phys"), 1.2);
      } else {
        this.damage(u, target, dmg, "phys", { attack: true });
      }
      return;
    }

    if (u instanceof Monster) {
      const dmg = u.stats.ad;
      if (u.mkind === "dragon" || u.mkind === "baron" || u.mkind === "gromp") {
        const vis = u.mkind === "dragon" ? "dragon" : u.mkind === "baron" ? "baron" : "monster";
        const col = u.mkind === "dragon" ? 0xff7a20 : u.mkind === "baron" ? 0xb050ff : 0x8fdc60;
        this.homing(u, target, 20, vis, col, (x) => {
          this.damage(u, x, dmg, "magic");
          if (u.mkind !== "gromp") for (const o of this.enemiesInRadius(2, x.x, x.z, 2.5)) if (o !== x && o.kind === "champion") this.damage(u, o, dmg * 0.5, "magic");
        }, 2);
      } else {
        this.damage(u, target, dmg, "phys");
        this.addFx({ type: "hit", x: target.x, z: target.z, color: 0xffd0a0 });
      }
    }
  }

  /** Treffer eines Champion-Angriffs: Schaden, Krit, Verstärkung, rotes Buff (Fernkämpfer: per Geschoss). */
  private championHit(u: Champion, target: Unit) {
    let dmg = u.stats.ad;
    const crit = Math.random() * 100 < u.stats.crit;
    if (crit) dmg *= 1.75;
    const emp = u.empower && this.t < u.empower.until ? u.empower : null;
    u.empower = null;
    const apply = (t: Unit) => {
      this.damage(u, t, dmg, "phys", { attack: true, crit });
      if (emp) this.damage(u, t, emp.dmg, emp.type, { ability: true });
      if (u.redBuff && t.alive) {
        this.dots.push({ target: t, src: u, dps: 8 + u.level * 2, until: this.t + 3 });
        this.slow(t, 0.1, 1.5);
      }
    };
    if (u.def.ranged) {
      this.homing(u, target, 30, u.def.projectile ?? "arrow", u.def.id === "ignis" ? 0xff9a40 : 0xd8f0ff, apply, 1.5);
    } else {
      apply(target);
      this.addFx({ type: "hit", x: target.x, z: target.z, color: crit ? 0xffe060 : 0xffffff });
      this.events.push({ type: "sound", name: crit ? "crit" : "slash", x: target.x, z: target.z });
    }
  }

  /**
   * Schlag mit Schlaganimation, pro Tick: Ausholen (kein Schaden) -> Trefferzeitpunkt (genau einmal prüfen, Schaden
   * über championHit) -> Erholung bis zum Ende des Clips. Tod, Sprung oder Betäubung brechen ihn ab, Laufen die Erholung.
   */
  private updateSwing(c: Champion) {
    const s = c.swing;
    if (!s) return;
    if (!c.alive || c.dash || c.stunned(this.t) || (s.hit && c.anim.moving)) return this.cancelSwing(c);
    if (!s.hit && this.t >= s.hitAt) {
      s.hit = true;
      if (this.swingConnects(c, s.target)) this.championHit(c, s.target);
    }
    if (this.t >= s.end) return this.cancelSwing(c);
    c.anim.swing = (this.t - s.start) / (s.end - s.start);
  }

  /** Schlag beenden; vor dem Treffer abgebrochen zählt er nicht als Angriff. */
  cancelSwing(c: Champion) {
    const s = c.swing;
    if (!s) return;
    if (!s.hit) {
      c.atkCd = 0;
      c.lockT = 0;
    }
    c.swing = null;
    c.anim.swing = -1;
  }

  /** Trifft der Schlag am Trefferzeitpunkt? Ziel noch angreifbar, in Reichweite und vor dem Champion. */
  private swingConnects(c: Champion, t: Unit) {
    if (!this.attackable(t, c.team)) return false;
    if (dist(c, t) - c.radius - t.radius > c.stats.range + SWING_REACH) return false;
    return Math.cos(Math.atan2(t.x - c.x, t.z - c.z) - c.facing) >= Math.cos(SWING_ARC);
  }

  /** Weltposition des Turmkristalls. */
  turretMuzzle(s: Unit): V2 {
    const c = Math.cos(s.facing);
    const sn = Math.sin(s.facing);
    return { x: s.x + TURRET_MUZZLE.x * c + TURRET_MUZZLE.z * sn, z: s.z - TURRET_MUZZLE.x * sn + TURRET_MUZZLE.z * c };
  }

  private kill(u: Unit, src: Unit | null) {
    u.alive = false;
    u.hp = 0;
    u.diedAt = this.t;
    u.dash = null;
    u.shield = 0;
    this.addFx({ type: "death", x: u.x, z: u.z, owner: u, big: u.kind === "nexus" || u.kind === "inhib" || u.kind === "turret" });

    if (u instanceof Champion) return this.killChampion(u, src);

    if (u instanceof Minion) {
      if (src instanceof Champion) {
        this.giveGold(src, u.gold);
        src.cs++;
      }
      const near = this.champs.filter((c) => c.alive && c.team !== u.team && dist(c, u) < 16);
      if (near.length) {
        const each = (u.xp * (1 + 0.25 * (near.length - 1))) / near.length;
        for (const c of near) this.giveXp(c, each);
      }
      return;
    }

    if (u instanceof Monster) return this.killMonster(u, src);

    if (u instanceof Structure) {
      const team = u.team as 0 | 1;
      const enemy = (1 - team) as 0 | 1;
      if (u.kind === "turret") {
        for (const c of this.champs) if (c.team === enemy) this.giveGold(c, 125);
        if (src instanceof Champion) this.giveGold(src, 100);
        this.announce(team === 0 ? "Ein Turm deines Teams wurde zerstört" : "Gegnerischer Turm zerstört", enemy);
      } else if (u.kind === "inhib") {
        u.respawnAt = this.t + 180;
        for (const c of this.champs) if (c.team === enemy) this.giveGold(c, 50);
        this.announce(team === 0 ? "Dein Inhibitor wurde zerstört" : "Gegnerischer Inhibitor zerstört", enemy, "Super-Minions erscheinen auf dieser Lane");
      } else if (u.kind === "nexus") {
        this.winner = enemy;
        this.endAt = this.t;
        this.events.push({ type: "end", winner: enemy });
      }
      this.events.push({ type: "structure", unit: u });
      this.events.push({ type: "sound", name: "explode", x: u.x, z: u.z });
    }
  }

  private killChampion(v: Champion, src: Unit | null) {
    v.deaths++;
    v.recallUntil = 0;
    v.path = [];
    v.order = { type: "none" };
    v.respawnAt = this.t + 5 + v.level * 2.2 + (this.t > 900 ? 6 : 0);
    v.buffs = v.buffs.filter((b) => b.id !== "baron");
    if (v.redBuff || v.blueBuff) {
      v.redBuff = false;
      v.blueBuff = false;
      v.buffs = v.buffs.filter((b) => b.id !== "blue" && b.id !== "red");
    }
    v.recalc();
    let killer: Champion | null = src instanceof Champion ? src : null;
    const recent = [...v.damagedBy.entries()].filter(([c, at]) => this.t - at < 10 && c.team !== v.team);
    if (!killer && recent.length) {
      recent.sort((a, b) => b[1] - a[1]);
      killer = recent[0][0];
    }
    const assists = recent.map(([c]) => c).filter((c) => c !== killer);
    v.damagedBy.clear();
    const enemy = (1 - (v.team as number)) as 0 | 1;
    this.score[enemy]++;
    if (killer) {
      killer.kills++;
      let gold = 300 + Math.min(6, v.streak) * 60;
      if (!this.firstBlood) {
        this.firstBlood = true;
        gold += 100;
        this.announce("Erstes Blut!", killer.team);
      }
      killer.streak++;
      this.giveGold(killer, gold);
      for (const a of assists) {
        a.assists++;
        this.giveGold(a, Math.round(gold * 0.5 / Math.max(1, assists.length)) + 40);
      }
      const xpTotal = 140 + v.level * 35;
      const share = [killer, ...assists].filter((c) => c.alive && dist(c, v) < 18);
      for (const c of share) this.giveXp(c, xpTotal / Math.max(1, share.length) * 1.15);
      const m = this.multi.get(killer.id);
      const n = m && this.t - m.at < 10 ? m.n + 1 : 1;
      this.multi.set(killer.id, { n, at: this.t });
      const names = ["", "", "Doppeltötung!", "Dreifachtötung!", "Vierfachtötung!", "PENTAKILL!"];
      if (n >= 2) this.announce(names[Math.min(5, n)], killer.team, `${killer.name} (${killer.def.name})`);
    }
    v.streak = 0;
    this.events.push({ type: "kill", killer: killer ?? src, victim: v, assists });
    this.events.push({ type: "sound", name: "death", x: v.x, z: v.z });
  }

  private killMonster(m: Monster, src: Unit | null) {
    const killer = src instanceof Champion ? src : null;
    if (killer) {
      if (m.gold > 0) this.giveGold(killer, m.gold);
      if (m.mkind !== "dragon" && m.mkind !== "baron") {
        this.giveXp(killer, m.xp);
        killer.cs++;
      }
      if (m.mkind === "blue") {
        killer.blueBuff = true;
        this.addBuff(killer, { id: "blue", until: this.t + 90, mods: { haste: 20, manaReg: 4 } });
      }
      if (m.mkind === "red") {
        killer.redBuff = true;
        this.addBuff(killer, { id: "red", until: this.t + 90, mods: { hpReg: 3 } });
      }
      const team = killer.team as 0 | 1;
      if (m.mkind === "dragon") {
        this.dragons[team] = Math.min(4, this.dragons[team] + 1);
        for (const c of this.champs) if (c.team === team) {
          this.giveGold(c, 60);
          if (c.alive && dist(c, m) < 25) this.giveXp(c, m.xp);
        }
        this.announce(team === 0 ? "Dein Team hat den Drachen getötet" : "Der Gegner hat den Drachen getötet", team, `Drachenstärke ${this.dragons[team]}: +${this.dragons[team] * 6}% Schaden`);
      }
      if (m.mkind === "baron") {
        for (const c of this.champs) {
          if (c.team !== team) continue;
          this.giveGold(c, 300);
          if (c.alive) {
            this.addBuff(c, { id: "baron", until: this.t + 150, mods: { ad: 35, ap: 55 } });
            if (dist(c, m) < 25) this.giveXp(c, m.xp);
          }
        }
        this.announce(team === 0 ? "Dein Team hat den Baron getötet" : "Der Gegner hat den Baron getötet", team, "Hand des Barons: stärkere Minions");
      }
    }
    const left = this.monsters.some((x) => x.alive && x.camp === m.camp);
    if (!left) {
      const delay = m.mkind === "dragon" ? 240 : m.mkind === "baron" ? 300 : m.mkind === "scuttle" ? 120 : 80;
      this.campRespawn.set(m.camp, this.t + delay);
      this.campAlive.set(m.camp, false);
    }
  }

  giveGold(c: Champion, amount: number) {
    c.gold += amount;
    this.events.push({ type: "gold", unit: c, amount });
  }

  giveXp(c: Champion, amount: number) {
    if (c.level >= 15) return;
    c.xp += amount;
    while (c.level < 15 && c.xp >= c.xpToNext()) {
      c.xp -= c.xpToNext();
      const oldMax = c.stats.maxHp;
      c.level++;
      c.points++;
      c.applyLevel();
      if (c.alive) {
        c.hp = Math.min(c.stats.maxHp, c.hp + (c.stats.maxHp - oldMax));
        c.mana = Math.min(c.stats.maxMana, c.mana + c.def.growth.mana);
      }
      this.events.push({ type: "levelup", unit: c });
      this.addFx({ type: "levelup", x: c.x, z: c.z, owner: c });
    }
    if (c.level >= 15) c.xp = 0;
  }

  announce(text: string, team: Side | -1, sub?: string) {
    this.events.push({ type: "announce", text, team, sub });
  }

  // ---------- Befehle ----------

  levelUp(c: Champion, slot: number) {
    if (!c.canRank(slot)) return false;
    c.ranks[slot]++;
    c.points--;
    return true;
  }

  /** Anvisierter Gegner, solange er noch angreifbar ist (sonst wird die Markierung gelöscht). */
  lockOf(c: Champion): Unit | null {
    if (c.lockTarget && !this.attackable(c.lockTarget, c.team)) c.lockTarget = null;
    return c.lockTarget;
  }

  /** Während eine Fähigkeit ausgelöst wird: der anvisierte Gegner, auf den Geschosse und Flächen gelenkt werden. */
  private castLock: Unit | null = null;

  cast(c: Champion, slot: number, aim: V2 | null, target: Unit | null = null): boolean {
    if (!c.alive || c.stunned(this.t) || c.dash || this.winner !== null) return false;
    const rank = c.ranks[slot];
    if (rank <= 0 || c.cds[slot] > 0) return false;
    const cost = c.manaFor(slot);
    if (c.mana < cost) return false;
    const ab = c.def.abilities[slot];
    // anvisierter Gegner: Fähigkeit automatisch auf ihn richten (Geschosse und Flächen treffen ihn dann sicher)
    const lock = this.lockOf(c);
    if (lock && ab.targeting !== "self") {
      aim = { x: lock.x, z: lock.z };
      if (ab.targeting === "unit" && lock.kind === "champion") target = lock;
    }
    let p = aim ?? { x: c.x + Math.sin(c.facing) * Math.max(3, ab.range), z: c.z + Math.cos(c.facing) * Math.max(3, ab.range) };
    if (ab.targeting === "unit") {
      const t = target && this.attackable(target, c.team) && target.kind === "champion" ? target : this.nearestEnemyChamp(c.team, p.x, p.z, 6);
      if (!t || dist(t, c) > ab.range + t.radius + 0.5) return false;
      target = t;
      p = { x: t.x, z: t.z };
    }
    c.mana -= cost;
    c.cds[slot] = c.cdFor(slot);
    // gezielte Fähigkeit während des Ausholens: der Schlag fällt aus (er träfe sonst in die neue Richtung)
    if (ab.targeting !== "self" && c.swing && !c.swing.hit) this.cancelSwing(c);
    if (ab.targeting !== "self" && (p.x !== c.x || p.z !== c.z)) c.facing = Math.atan2(p.x - c.x, p.z - c.z);
    this.cancelRecall(c);
    c.lockT = Math.max(c.lockT, 0.15);
    c.anim.cast = Math.max(c.anim.cast, 0.3);
    this.castLock = ab.targeting !== "self" ? lock : null;
    try {
      ab.cast(this, c, p, rank, target);
    } finally {
      this.castLock = null;
    }
    this.events.push({ type: "cast", unit: c, slot });
    return true;
  }

  flash(c: Champion, aim: V2 | null) {
    if (!c.alive || c.flashCd > 0 || c.stunned(this.t)) return false;
    const dx = aim ? aim.x - c.x : Math.sin(c.facing);
    const dz = aim ? aim.z - c.z : Math.cos(c.facing);
    const len = Math.hypot(dx, dz) || 1;
    c.dash = null;
    this.blink(c, c.x + (dx / len) * 6.5, c.z + (dz / len) * 6.5, 0xfff080);
    c.flashCd = 150;
    return true;
  }

  spell2(c: Champion) {
    if (!c.alive || c.spell2Cd > 0) return false;
    if (c.spell2 === "heal") {
      const amt = 90 + c.level * 18;
      this.heal(c, amt);
      this.addFx({ type: "heal", x: c.x, z: c.z, owner: c });
      let ally: Champion | null = null;
      for (const a of this.champs) {
        if (a === c || !a.alive || a.team !== c.team || dist(a, c) > 8) continue;
        if (!ally || a.hp / a.stats.maxHp < ally.hp / ally.stats.maxHp) ally = a;
      }
      if (ally) {
        this.heal(ally, amt);
        this.addFx({ type: "heal", x: ally.x, z: ally.z, owner: ally });
      }
      this.addBuff(c, { id: "healms", until: this.t + 1, mods: { ms: 30 } });
      c.spell2Cd = 110;
      this.events.push({ type: "sound", name: "heal", x: c.x, z: c.z });
      return true;
    }
    // Zerschmettern: Monster oder Minion in der Nähe
    let best: Unit | null = null;
    let bd = 6;
    for (const m of [...this.monsters, ...this.minions]) {
      if (!m.alive || m.team === c.team || !this.canSee(c.team, m)) continue;
      const d = dist(m, c) - m.radius;
      if (d < bd || (best && m instanceof Monster && m.big && d < 6)) {
        bd = d;
        best = m;
      }
    }
    if (!best) return false;
    this.damage(c, best, 450 + c.level * 30, "true");
    this.addFx({ type: "smite", x: best.x, z: best.z });
    this.events.push({ type: "sound", name: "smite", x: best.x, z: best.z });
    c.spell2Cd = 35;
    return true;
  }

  startRecall(c: Champion) {
    if (!c.alive || c.recallUntil > 0 || this.inFountain(c)) return;
    c.path = [];
    c.order = { type: "none" };
    if (c.swing && !c.swing.hit) this.cancelSwing(c);
    c.recallStart = this.t;
    c.recallUntil = this.t + (c.hasBuff("baron") ? 3 : 6);
    this.addFx({ type: "recall", x: c.x, z: c.z, owner: c, dur: c.recallUntil - this.t });
  }

  cancelRecall(c: Champion) {
    if (c.recallUntil > 0) c.recallUntil = 0;
  }

  buy(c: Champion, id: string) {
    const item = ITEM_BY_ID[id];
    if (!item || !this.canShop(c)) return false;
    let cost = item.cost;
    let replace = -1;
    if (item.boots) {
      if (c.items.includes(id)) return false;
      if (id === "swiftboots") {
        replace = c.items.indexOf("boots");
        if (replace >= 0) cost -= 300;
      } else if (c.items.includes("swiftboots")) return false;
    }
    if (c.gold < cost) return false;
    if (replace < 0 && c.items.length >= 6) return false;
    c.gold -= cost;
    if (replace >= 0) c.items[replace] = id;
    else c.items.push(id);
    c.recalc();
    this.events.push({ type: "sound", name: "buy", x: c.x, z: c.z });
    return true;
  }

  /** Nächstes Item aus der Empfehlung, das noch fehlt. */
  nextBuild(c: Champion): string | null {
    for (const id of c.def.build) {
      if (c.items.includes(id)) continue;
      if (id === "boots" && c.items.includes("swiftboots")) continue;
      return id;
    }
    return null;
  }

  // ---------- Simulation ----------

  update(dt: number) {
    this.events.length = 0;
    if (this.winner !== null) {
      this.t += dt;
      this.updateFxOnly(dt);
      return;
    }
    this.t += dt;
    const t = this.t;

    this.updateStructuresState();
    this.spawnWaves();
    this.spawnCamps();

    for (const c of this.champs) {
      const b = this.brains.get(c.id);
      if (b) b.think(this, c, dt);
    }
    for (const c of this.champs) this.updateChampion(c, dt);
    for (const m of this.minions) if (m.alive) this.updateMinion(m, dt);
    for (const m of this.monsters) if (m.alive) this.updateMonster(m, dt);
    for (const s of this.structures) this.updateStructure(s, dt);

    this.updateProjectiles(dt);
    this.updateAreas();
    this.updateDots(dt);
    this.separate();

    if (t - this.visT > 0.12) {
      this.visT = t;
      this.updateVision();
    }

    if (this.minions.length > 260 || (this.minions.length > 40 && Math.random() < 0.02)) {
      this.minions = this.minions.filter((m) => m.alive || t - m.diedAt < 1.2);
    }
    if (Math.random() < 0.02) this.monsters = this.monsters.filter((m) => m.alive || t - m.diedAt < 1.5);
  }

  private updateFxOnly(dt: number) {
    this.updateProjectiles(dt);
  }

  private updateStructuresState() {
    const s = this.structures;
    const byKey = (team: number, lane: string, tier: string) => s.find((x) => x.kind === "turret" && x.team === team && x.lane === lane && x.tier === tier);
    for (const st of s) {
      const team = st.team;
      if (st.kind === "turret") {
        if (st.tier === "outer") st.invulnerable = false;
        else if (st.tier === "inner") st.invulnerable = !!byKey(team, st.lane, "outer")?.alive;
        else if (st.tier === "inhib") st.invulnerable = !!byKey(team, st.lane, "inner")?.alive;
        else st.invulnerable = !s.some((x) => x.kind === "inhib" && x.team === team && !x.alive);
      } else if (st.kind === "inhib") {
        st.invulnerable = !!byKey(team, st.lane, "inhib")?.alive;
      } else {
        st.invulnerable = s.some((x) => x.kind === "turret" && x.team === team && x.tier === "nexus" && x.alive);
      }
    }
  }

  private spawnWaves() {
    const t = this.t;
    if (t >= this.nextWave) {
      this.waveN++;
      this.nextWave += 26;
      if (this.waveN === 1) this.announce("Minions sind erschienen!", -1);
      const siege = this.waveN >= 3 && (this.waveN % 3 === 0 || (t > 900 && this.waveN % 2 === 0));
      for (const team of [0, 1] as const) {
        for (const lane of ["top", "mid", "bot"] as LaneId[]) {
          const inhibDown = this.structures.some((x) => x.kind === "inhib" && x.team !== team && x.lane === lane && !x.alive);
          const order: MinionType[] = ["melee", "melee", "melee"];
          if (inhibDown) order.unshift("super");
          if (siege) order.push("siege");
          order.push("caster", "caster", "caster");
          order.forEach((type, i) => this.spawnQueue.push({ at: t + i * 0.75, team, lane, type }));
        }
      }
    }
    if (this.spawnQueue.length) {
      const scale = 1 + Math.min(1.6, t / 900);
      const keep: typeof this.spawnQueue = [];
      for (const q of this.spawnQueue) {
        if (q.at > t) {
          keep.push(q);
          continue;
        }
        const path = lanePath(q.team, q.lane);
        const m = new Minion(q.team, q.type, q.lane, path, scale);
        // am Rand der eigenen Nexus entlang der Lane erscheinen, nicht in ihrer Mitte (sonst ruckartiges Herausschieben)
        const nx = path[1].x - path[0].x;
        const nz = path[1].z - path[0].z;
        const nl = Math.hypot(nx, nz) || 1;
        m.x += (nx / nl) * (3.6 + m.radius + 0.3) + (Math.random() - 0.5) * 0.6;
        m.z += (nz / nl) * (3.6 + m.radius + 0.3) + (Math.random() - 0.5) * 0.6;
        this.minions.push(m);
      }
      this.spawnQueue = keep;
    }
  }

  private spawnCamps() {
    const t = this.t;
    for (const camp of CAMPS) {
      if (this.campAlive.get(camp.id)) continue;
      const at = this.campRespawn.get(camp.id) ?? Infinity;
      if (t < at) continue;
      this.campAlive.set(camp.id, true);
      this.spawnCamp(camp);
      if (camp.kind === "dragon") this.announce("Der Drache ist erschienen", -1);
      if (camp.kind === "baron") this.announce("Der Baron ist erschienen", -1);
    }
  }

  private spawnCamp(camp: CampSpec) {
    const n = CAMP_MEMBERS[camp.kind];
    const scale = 1 + Math.min(1.2, this.t / 1000);
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n - 1)) * Math.PI * 1.2 + (camp.side === 1 ? Math.PI : 0);
      const off = i === 0 ? 0 : 2.4;
      const pos = { x: camp.pos.x + Math.cos(a) * off, z: camp.pos.z + Math.sin(a) * off };
      const m = new Monster(camp.id, camp.kind, i === 0, pos, scale);
      m.facing = Math.random() * Math.PI * 2;
      this.monsters.push(m);
    }
  }

  private regen(u: Unit, dt: number) {
    if (u.hp < u.stats.maxHp) u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.hpReg * dt);
    if (u.mana < u.stats.maxMana) u.mana = Math.min(u.stats.maxMana, u.mana + u.stats.manaReg * dt);
  }

  private updateBuffs(u: Unit) {
    if (u.buffs.length) {
      const before = u.buffs.length;
      u.buffs = u.buffs.filter((b) => b.until > this.t);
      if (u.buffs.length !== before) {
        if (u instanceof Champion) {
          u.redBuff = u.hasBuff("red");
          u.blueBuff = u.hasBuff("blue");
        }
        u.recalc();
      }
    }
    if (u.shield > 0 && this.t > u.shieldUntil) u.shield = 0;
  }

  private updateChampion(c: Champion, dt: number) {
    const t = this.t;
    for (let i = 0; i < 4; i++) c.cds[i] = Math.max(0, c.cds[i] - dt);
    c.flashCd = Math.max(0, c.flashCd - dt);
    c.spell2Cd = Math.max(0, c.spell2Cd - dt);
    c.atkCd -= dt;
    c.lockT -= dt;
    c.anim.atk = Math.max(0, c.anim.atk - dt * 4);
    c.anim.cast = Math.max(0, c.anim.cast - dt);

    if (t > 20) this.giveGoldQuiet(c, 3.2 * dt);
    this.updateSwing(c);

    if (!c.alive) {
      if (t >= c.respawnAt) this.respawn(c);
      return;
    }
    this.updateBuffs(c);
    this.regen(c, dt);

    if (this.inFountain(c)) {
      c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.maxHp * 0.12 * dt);
      c.mana = Math.min(c.stats.maxMana, c.mana + c.stats.maxMana * 0.15 * dt);
    }
    // Brunnenlaser gegen Eindringlinge
    const enemyFountain = FOUNTAIN[(1 - (c.team as number)) as 0 | 1];
    if (dist(c, enemyFountain) < FOUNTAIN_RADIUS + 5) this.damage(null, c, c.stats.maxHp * 0.3 * dt, "true");
    if (!c.alive) return;

    if (c.recallUntil > 0) {
      if (c.moveVec || c.path.length || c.order.type !== "none") this.cancelRecall(c);
      else if (t >= c.recallUntil) {
        c.recallUntil = 0;
        const sp = SPAWN[c.team as 0 | 1];
        c.x = sp.x;
        c.z = sp.z;
        this.addFx({ type: "respawn", x: c.x, z: c.z, owner: c });
        this.events.push({ type: "sound", name: "recall", x: c.x, z: c.z });
        return;
      }
    }

    if (c.dash) {
      this.updateDash(c, dt);
      return;
    }
    if (c.stunned(t)) {
      c.anim.moving = false;
      return;
    }

    // Bewegung per Joystick
    if (c.moveVec) {
      const len = Math.hypot(c.moveVec.x, c.moveVec.z);
      if (len > 0.05) {
        c.path = [];
        if (c.lockT <= 0) {
          const sp = c.moveSpeed(t) * Math.min(1, len);
          const dir = this.steerAround(c, c.moveVec.x / len, c.moveVec.z / len, 8);
          this.moveUnit(c, dir.x, dir.z, sp * dt);
          c.facing = Math.atan2(c.moveVec.x, c.moveVec.z);
          c.anim.moving = true;
          c.anim.speed = sp;
        }
        return;
      }
    }

    const o = c.order;
    if (o.type === "attack") {
      const tg = o.target;
      if (!this.attackable(tg, c.team)) {
        c.order = { type: "none" };
      } else {
        const d = dist(c, tg) - c.radius - tg.radius;
        if (d <= c.stats.range) {
          c.path = [];
          c.anim.moving = false;
          c.facing = Math.atan2(tg.x - c.x, tg.z - c.z);
          if (c.atkCd <= 0 && c.lockT <= 0) this.basicAttack(c, tg);
          return;
        }
        this.followTo(c, tg.x, tg.z, dt);
        return;
      }
    }
    if (o.type === "move") {
      const reached = this.followTo(c, o.x, o.z, dt);
      if (reached) c.order = { type: "none" };
      return;
    }
    c.anim.moving = false;
  }

  private giveGoldQuiet(c: Champion, amount: number) {
    c.gold += amount;
  }

  private pathGoal = new Map<number, { x: number; z: number; at: number }>();

  /** Läuft per Pfadsuche zum Ziel. Gibt true zurück, wenn angekommen. */
  followTo(c: Champion, x: number, z: number, dt: number): boolean {
    if (c.lockT > 0) return false;
    // Ziel auf der Karte und außerhalb von Gebäuden (sonst läuft der Champion endlos auf der Stelle)
    ({ x, z } = this.freeGoal(c, x, z));
    const goal = this.pathGoal.get(c.id);
    const t = this.t;
    if (this.isStuck(c, t)) {
      // kaum vorangekommen: Ausweichseite wechseln und neu planen statt immer gleich gegenzulaufen
      c.steer.side = -c.steer.side;
      this.pathGoal.delete(c.id);
    }
    if (goal && Math.hypot(goal.x - x, goal.z - z) > 0.3 && this.grid.los(c, { x, z }, 0.8)) {
      // freie Sicht zum (z. B. mit gehaltener Maustaste verschobenen) Ziel: direkt hin, ohne teure Pfadsuche
      c.path = [{ x, z }];
      goal.x = x;
      goal.z = z;
    } else if (!goal || (Math.hypot(goal.x - x, goal.z - z) > 1.5 && t - goal.at > 0.15) || (c.path.length === 0 && Math.hypot(c.x - x, c.z - z) > 0.6) || t - goal.at > 1.5) {
      // volle Pfadsuche höchstens alle 0,15 s, auch wenn das Ziel (gehaltene Maustaste) laufend wandert
      c.path = this.grid.findPath({ x: c.x, z: c.z }, { x, z });
      this.pathGoal.set(c.id, { x, z, at: t });
    }
    if (c.path.length === 0) {
      c.anim.moving = false;
      return true;
    }
    let step = c.moveSpeed(t) * dt;
    c.anim.moving = true;
    c.anim.speed = c.moveSpeed(t);
    while (step > 0 && c.path.length) {
      const p = c.path[0];
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d <= step) {
        if (this.grid.isOpen(p.x, p.z)) {
          c.x = p.x;
          c.z = p.z;
        }
        c.path.shift();
        step -= d;
        if (d > 0.01) c.facing = Math.atan2(dx, dz);
      } else {
        const dir = this.steerAround(c, dx / d, dz / d, d);
        this.moveUnit(c, dir.x, dir.z, step);
        c.facing = Math.atan2(dir.x, dir.z);
        step = 0;
      }
    }
    if (c.path.length === 0) {
      c.anim.moving = false;
      return true;
    }
    return false;
  }

  /** Lebende Gebäude (und Inhibitor-Trümmer) blockieren die Bewegung, wie in separate(). */
  private blocksMove(s: Structure) {
    return s.alive || s.kind !== "turret";
  }

  /** Ziel in die Karte holen und aus Gebäuden herausschieben. */
  freeGoal(u: Unit, x: number, z: number): V2 {
    x = Math.max(0.5, Math.min(MAP - 0.5, x));
    z = Math.max(0.5, Math.min(MAP - 0.5, z));
    for (const s of this.structures) {
      if (!this.blocksMove(s)) continue;
      const r = s.radius + u.radius + 0.1;
      const dx = x - s.x;
      const dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      // auf die Seite, von der die Einheit kommt
      const ax = d > 0.01 ? dx / d : (u.x - s.x) / (Math.hypot(u.x - s.x, u.z - s.z) || 1);
      const az = d > 0.01 ? dz / d : (u.z - s.z) / (Math.hypot(u.x - s.x, u.z - s.z) || 1);
      x = s.x + ax * r;
      z = s.z + az * r;
    }
    return { x, z };
  }

  /**
   * Lokales Ausweichen um Gebäude (Türme, Inhibitoren, Nexus): liegt ein Gebäude auf dem Weg, an ihm entlang
   * vorbeigehen statt frontal dagegen. Die gewählte Seite bleibt, bis das Gebäude passiert ist (kein Zickzack).
   */
  steerAround(u: Unit, dx: number, dz: number, dist: number): V2 {
    const look = Math.min(dist, 6);
    let best: Structure | null = null;
    let bestAlong = Infinity;
    for (const s of this.structures) {
      if (!this.blocksMove(s)) continue;
      // am Gebäude, um das gerade herumgegangen wird, etwas länger festhalten (kein Hin und Her)
      const r = s.radius + u.radius + (s.id === u.steer.id ? 0.7 : 0.2);
      const ox = s.x - u.x;
      const oz = s.z - u.z;
      const along = ox * dx + oz * dz;
      if (along <= 0 || along > look + r) continue;
      const side = ox * dz - oz * dx;
      if (Math.abs(side) >= r) continue;
      // Ziel liegt vor dem Gebäude: kein Umweg nötig
      if (Math.hypot(ox, oz) > dist + r * 0.2 && along > dist) continue;
      if (along < bestAlong) {
        bestAlong = along;
        best = s;
      }
    }
    if (!best) {
      u.steer.id = -1;
      return { x: dx, z: dz };
    }
    const s = best;
    const ox = s.x - u.x;
    const oz = s.z - u.z;
    const d = Math.hypot(ox, oz) || 0.001;
    const r = s.radius + u.radius + 0.2;
    if (u.steer.id !== s.id || u.steer.side === 0) {
      // Seite wählen, auf der der Weg kürzer ist (Gebäudemitte rechts vom Weg -> links vorbei)
      const cross = ox * dz - oz * dx;
      u.steer = { id: s.id, side: cross > 0 ? -1 : 1 };
    }
    const sd = u.steer.side;
    // Tangente am (um die eigene Größe vergrößerten) Gebäudekreis
    const a = Math.asin(Math.min(1, r / d));
    const base = Math.atan2(ox, oz) + sd * a;
    let tx = Math.sin(base);
    let tz = Math.cos(base);
    if (d < r + 0.05) {
      // schon am Gebäude: genau seitlich daran entlang
      tx = (-oz / d) * -sd;
      tz = (ox / d) * -sd;
      if (tx * dx + tz * dz < 0) {
        tx = -tx;
        tz = -tz;
      }
    }
    return { x: tx, z: tz };
  }

  /** Kommt die Einheit seit einer Sekunde kaum voran, obwohl sie laufen will? Prüft nur einmal pro Sekunde. */
  private isStuck(u: Unit, t: number) {
    const n = u.nav;
    if (t - n.pt < 1) return false;
    const moved = Math.hypot(u.x - n.px, u.z - n.pz);
    const wanted = u.anim.moving && t - n.pt < 1.5;
    const stuck = wanted && moved < 0.3 * u.stats.ms * (t - n.pt);
    n.px = u.x;
    n.pz = u.z;
    n.pt = t;
    n.stuck = stuck ? n.stuck + 1 : 0;
    return stuck;
  }

  /**
   * Minion läuft zu einem Punkt: bei freier Sicht geradeaus (um Gebäude herum), sonst über die Pfadsuche
   * (z. B. wenn ihn ein Champion von der Lane in den Wald gelockt hat). Pfade werden höchstens alle 2 s neu berechnet.
   */
  private minionMoveTo(m: Minion, x: number, z: number, dt: number) {
    const t = this.t;
    const n = m.nav;
    if (this.isStuck(m, t)) {
      m.steer.side = -m.steer.side;
      n.at = -99;
    }
    let tx = x;
    let tz = z;
    if (n.stuck > 0 || !this.grid.los(m, { x, z }, 0.5)) {
      if (t - n.at > 2 || Math.hypot(n.gx - x, n.gz - z) > 3 || n.path.length === 0) {
        n.path = this.grid.findPath({ x: m.x, z: m.z }, { x, z });
        n.gx = x;
        n.gz = z;
        n.at = t;
      }
      while (n.path.length > 1 && Math.hypot(n.path[0].x - m.x, n.path[0].z - m.z) < 0.8) n.path.shift();
      if (n.path.length) {
        tx = n.path[0].x;
        tz = n.path[0].z;
      }
    } else n.path = [];
    const dx = tx - m.x;
    const dz = tz - m.z;
    const len = Math.hypot(dx, dz) || 1;
    const dir = this.steerAround(m, dx / len, dz / len, len);
    this.moveUnit(m, dir.x, dir.z, m.moveSpeed(t) * dt);
    m.facing = Math.atan2(dir.x, dir.z);
    m.anim.moving = true;
    m.anim.speed = m.moveSpeed(t);
  }

  moveUnit(u: Unit, dx: number, dz: number, step: number) {
    const g = this.grid;
    const nx = u.x + dx * step;
    const nz = u.z + dz * step;
    const lx = nx + dx * 0.35;
    const lz = nz + dz * 0.35;
    if (g.isOpen(nx, nz) && g.isOpen(lx, lz)) {
      u.x = nx;
      u.z = nz;
      return;
    }
    if (g.isOpen(nx, u.z) && g.isOpen(u.x + dx * (step + 0.35), u.z)) {
      u.x = nx;
      return;
    }
    if (g.isOpen(u.x, nz) && g.isOpen(u.x, u.z + dz * (step + 0.35))) {
      u.z = nz;
    }
  }

  private updateDash(u: Unit, dt: number) {
    const d = u.dash!;
    const dx = d.tx - u.x;
    const dz = d.tz - u.z;
    const len = Math.hypot(dx, dz);
    const step = d.speed * dt;
    u.anim.moving = true;
    u.anim.speed = 12;
    if (len <= step) {
      u.x = d.tx;
      u.z = d.tz;
    } else {
      u.x += (dx / len) * step;
      u.z += (dz / len) * step;
    }
    if (d.onHit && d.hitRadius) {
      for (const e of this.enemiesInRadius(u.team, u.x, u.z, d.hitRadius)) {
        if (d.hit.has(e.id)) continue;
        d.hit.add(e.id);
        d.onHit(e);
      }
    }
    if (len <= step) {
      u.dash = null;
      d.onArrive?.();
    }
  }

  private respawn(c: Champion) {
    const sp = SPAWN[c.team as 0 | 1];
    c.alive = true;
    c.x = sp.x + (Math.random() - 0.5) * 2;
    c.z = sp.z + (Math.random() - 0.5) * 2;
    c.hp = c.stats.maxHp;
    c.mana = c.stats.maxMana;
    c.path = [];
    c.order = { type: "none" };
    c.stunUntil = 0;
    c.knockUntil = 0;
    c.slowUntil = 0;
    this.addFx({ type: "respawn", x: c.x, z: c.z, owner: c });
  }

  private minionProgress(m: Minion) {
    return m.wp;
  }

  private updateMinion(m: Minion, dt: number) {
    const t = this.t;
    m.atkCd -= dt;
    m.lockT -= dt;
    m.anim.atk = Math.max(0, m.anim.atk - dt * 4);
    this.updateBuffs(m);
    if (m.dash) {
      this.updateDash(m, dt);
      return;
    }
    if (m.stunned(t)) return;

    // Baron-Verstärkung durch Champions in der Nähe
    for (const c of this.champs) {
      if (c.alive && c.team === m.team && c.hasBuff("baron") && dist(c, m) < 12) {
        m.baronUntil = t + 1;
        break;
      }
    }

    // Ziel suchen (gestaffelt)
    const retarget = (m.id + Math.floor(t * 4)) % 2 === 0;
    let tg = m.target;
    // nicht beliebig weit von der Lane weglocken lassen
    const home = m.path[Math.min(m.wp, m.path.length - 1)];
    const prev = m.path[Math.max(0, Math.min(m.wp, m.path.length - 1) - 1)];
    if (tg && (!this.attackable(tg, m.team) || dist(tg, m) > 13 || distToSegment(m, prev, home) > 14)) tg = null;
    if (tg && t > m.forcedUntil && tg.kind === "champion" && retarget) {
      // nach Ablauf des Hilferufs lieber Minions angreifen
      const alt = this.minionTarget(m, true);
      if (alt) tg = alt;
    }
    if (!tg && retarget) tg = this.minionTarget(m, false);
    m.target = tg;

    if (tg) {
      const d = dist(m, tg) - m.radius - tg.radius;
      if (d <= m.stats.range) {
        m.anim.moving = false;
        m.facing = Math.atan2(tg.x - m.x, tg.z - m.z);
        if (m.atkCd <= 0) this.basicAttack(m, tg);
        return;
      }
      if (m.lockT > 0) return;
      this.minionMoveTo(m, tg.x, tg.z, dt);
      return;
    }

    if (m.lockT > 0) return;
    // Lane folgen
    const p = m.path[Math.min(m.wp, m.path.length - 1)];
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const len = Math.hypot(dx, dz);
    // Wegpunkt erreicht (auch wenn ein Gebäude direkt darauf steht und man nur um es herumkommt)
    if (m.wp < m.path.length - 1 && (len < 2.2 || this.structures.some((st) => this.blocksMove(st) && Math.hypot(st.x - p.x, st.z - p.z) < st.radius + 1 && len < st.radius + m.radius + 2))) m.wp++;
    if (len > 0.5) this.minionMoveTo(m, p.x, p.z, dt);
    else m.anim.moving = false;
  }

  private minionTarget(m: Minion, minionsOnly: boolean): Unit | null {
    let best: Unit | null = null;
    let bd = 9;
    for (const o of this.minions) {
      if (o.team === m.team || !o.alive) continue;
      const d = dist(o, m);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best || minionsOnly) return best;
    bd = 10;
    for (const s of this.structures) {
      if (!this.attackable(s, m.team)) continue;
      const d = dist(s, m) - s.radius;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) return best;
    bd = 7;
    for (const c of this.champs) {
      if (!this.attackable(c, m.team)) continue;
      const d = dist(c, m);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private updateMonster(m: Monster, dt: number) {
    const t = this.t;
    m.atkCd -= dt;
    m.lockT -= dt;
    m.anim.atk = Math.max(0, m.anim.atk - dt * 3);
    this.updateBuffs(m);
    if (m.dash) {
      this.updateDash(m, dt);
      return;
    }
    if (m.stunned(t)) return;
    const leash = m.mkind === "baron" || m.mkind === "dragon" ? 14 : 11;
    if (m.resetting) {
      m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.maxHp * 0.25 * dt);
      const dx = m.home.x - m.x;
      const dz = m.home.z - m.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.6) {
        m.resetting = false;
        m.anim.moving = false;
        return;
      }
      this.moveUnit(m, dx / len, dz / len, Math.max(5, m.stats.ms) * 1.4 * dt);
      m.facing = Math.atan2(dx, dz);
      m.anim.moving = true;
      return;
    }
    const tg = m.target;
    if (!tg || !tg.alive || dist(m.home, tg) > leash + 4 || dist(m, m.home) > leash || (tg.team !== 2 && !tg.vis[0] && !tg.vis[1])) {
      if (m.target || dist(m, m.home) > 0.8) {
        m.target = null;
        m.resetting = true;
      } else if (m.hp < m.stats.maxHp && t - m.lastDamagedAt > 4) {
        m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.maxHp * 0.1 * dt);
      }
      m.anim.moving = false;
      return;
    }
    if (m.mkind === "scuttle") {
      m.anim.moving = false;
      return;
    }
    const d = dist(m, tg) - m.radius - tg.radius;
    if (d <= m.stats.range) {
      m.anim.moving = false;
      m.facing = Math.atan2(tg.x - m.x, tg.z - m.z);
      if (m.atkCd <= 0) this.basicAttack(m, tg);
      return;
    }
    if (m.stats.ms <= 0 || m.lockT > 0) return;
    const dx = tg.x - m.x;
    const dz = tg.z - m.z;
    const len = Math.hypot(dx, dz) || 1;
    this.moveUnit(m, dx / len, dz / len, m.moveSpeed(t) * dt);
    m.facing = Math.atan2(dx, dz);
    m.anim.moving = true;
  }

  private updateStructure(s: Structure, dt: number) {
    const t = this.t;
    if (!s.alive) {
      if (s.kind === "inhib" && s.respawnAt > 0 && t >= s.respawnAt) {
        s.alive = true;
        s.hp = s.stats.maxHp;
        s.respawnAt = 0;
        this.announce(s.team === 0 ? "Dein Inhibitor ist wieder aufgebaut" : "Gegnerischer Inhibitor ist wieder aufgebaut", s.team);
      }
      return;
    }
    if (s.kind === "nexus" || s.kind === "inhib") {
      if (t - s.lastDamagedAt > 8) s.hp = Math.min(s.stats.maxHp, s.hp + 6 * dt);
      return;
    }
    s.atkCd -= dt;
    s.anim.atk = Math.max(0, s.anim.atk - dt * 3);
    const range = s.stats.range;
    let tg = s.target;
    if (tg && (!this.attackable(tg, s.team) || dist(tg, s) > range + tg.radius)) tg = null;
    if (!tg) {
      s.heat = 0;
      let best: Unit | null = null;
      let bd = Infinity;
      for (const m of this.minions) {
        if (!m.alive || m.team === s.team) continue;
        const d = dist(m, s);
        if (d <= range + m.radius && d < bd) {
          bd = d;
          best = m;
        }
      }
      if (!best) {
        for (const c of this.champs) {
          if (!this.attackable(c, s.team)) continue;
          const d = dist(c, s);
          if (d <= range + c.radius && d < bd) {
            bd = d;
            best = c;
          }
        }
      }
      tg = best;
    }
    s.target = tg;
    if (tg && s.atkCd <= 0) this.basicAttack(s, tg);
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (p.done) continue;
      if (p.homing) {
        const tg = p.homing;
        if (!tg.alive) {
          p.done = true;
          continue;
        }
        const dx = tg.x - p.x;
        const dz = tg.z - p.z;
        const d = Math.hypot(dx, dz);
        const step = p.speed * dt;
        if (d <= step + tg.radius * 0.5) {
          p.done = true;
          p.x = tg.x;
          p.z = tg.z;
          p.onHit(tg, p);
          continue;
        }
        p.dx = dx / d;
        p.dz = dz / d;
        p.x += p.dx * step;
        p.z += p.dz * step;
        const k = Math.min(1, (d - step) / p.range);
        p.y = 1.2 + (p.y0 - 1.2) * k;
        continue;
      }
      const step = p.speed * dt;
      p.x += p.dx * step;
      p.z += p.dz * step;
      p.traveled += step;
      const test = (u: Unit) => {
        if (p.done || !u.alive || u.team === p.team || u.untargetable) return;
        if (p.hit.has(u.id) || p.sharedHits?.has(u.id)) return;
        if (Math.hypot(u.x - p.x, u.z - p.z) > p.width / 2 + u.radius) return;
        p.hit.add(u.id);
        p.sharedHits?.add(u.id);
        if (p.onHit(u, p)) p.done = true;
      };
      for (const c of this.champs) test(c);
      if (!p.champsOnly) {
        for (const m of this.minions) test(m);
        for (const m of this.monsters) test(m);
      }
      if (p.traveled >= p.range) p.done = true;
    }
    if (this.projectiles.some((p) => p.done)) this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  private updateAreas() {
    for (const a of this.areas) {
      if (a.done) continue;
      if (a.follow && a.follow.alive) {
        a.x = a.follow.x;
        a.z = a.follow.z;
      }
      if (this.t >= a.t0 + a.delay) {
        a.done = true;
        a.onTrigger(a);
        this.addFx({ type: "explode", x: a.x, z: a.z, r: a.radius, color: a.color, big: a.visual === "meteor" });
        this.events.push({ type: "sound", name: a.visual === "meteor" ? "meteor" : "boom", x: a.x, z: a.z });
      }
    }
    if (this.areas.some((a) => a.done)) this.areas = this.areas.filter((a) => !a.done);
  }

  private updateDots(dt: number) {
    if (!this.dots.length) return;
    for (const d of this.dots) {
      if (d.until > this.t && d.target.alive) this.damage(d.src, d.target, d.dps * dt, "true");
    }
    this.dots = this.dots.filter((d) => d.until > this.t && d.target.alive);
  }

  private separate() {
    const movers: Unit[] = [];
    for (const c of this.champs) if (c.alive && !c.dash) movers.push(c);
    for (const m of this.minions) if (m.alive && !m.dash) movers.push(m);
    for (const m of this.monsters) if (m.alive && !m.dash) movers.push(m);
    const g = this.grid;
    const n = movers.length;
    for (let i = 0; i < n; i++) {
      const a = movers[i];
      for (let j = i + 1; j < n; j++) {
        const b = movers[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = (a.radius + b.radius) * 0.85;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const push = (min - d) * 0.5;
        const nx = d > 0.001 ? dx / d : Math.random() - 0.5;
        const nz = d > 0.001 ? dz / d : Math.random() - 0.5;
        // Champions schieben Minions stärker als umgekehrt
        const wa = a.kind === "champion" && b.kind !== "champion" ? 0.25 : b.kind === "champion" && a.kind !== "champion" ? 1.75 : 1;
        const wb = 2 - wa;
        const ax = a.x - nx * push * wa;
        const az = a.z - nz * push * wa;
        const bx = b.x + nx * push * wb;
        const bz = b.z + nz * push * wb;
        if (g.isOpen(ax, az)) {
          a.x = ax;
          a.z = az;
        }
        if (g.isOpen(bx, bz)) {
          b.x = bx;
          b.z = bz;
        }
      }
      for (const s of this.structures) {
        if (!s.alive && s.kind === "turret") continue;
        const dx = a.x - s.x;
        const dz = a.z - s.z;
        const min = s.radius + a.radius;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 0.001) {
          a.x = s.x + (dx / d) * min;
          a.z = s.z + (dz / d) * min;
        }
      }
    }
  }

  private updateVision() {
    const t = this.t;
    const obs: [{ x: number; z: number; r: number; b: number }[], { x: number; z: number; r: number; b: number }[]] = [[], []];
    const g = this.grid;
    const add = (u: Unit, r: number) => {
      if (u.team === 0 || u.team === 1) obs[u.team].push({ x: u.x, z: u.z, r, b: g.brushAt(u.x, u.z) });
    };
    for (const c of this.champs) if (c.alive) add(c, 14);
    for (const m of this.minions) if (m.alive) add(m, 9);
    for (const s of this.structures) if (s.alive) add(s, s.kind === "turret" ? 13 : 10);
    for (const team of [0, 1] as const) obs[team].push({ x: FOUNTAIN[team].x, z: FOUNTAIN[team].z, r: 22, b: -1 });

    const check = (u: Unit) => {
      if (!u.alive) return;
      if (u instanceof Structure) {
        u.vis = [true, true];
        return;
      }
      const brush = g.brushAt(u.x, u.z);
      for (const team of [0, 1] as const) {
        if (u.team === team) {
          u.vis[team] = true;
          continue;
        }
        let seen = t < u.revealUntil && brush >= 0 ? this.anyObserverNear(obs[team], u, 16) : false;
        if (!seen) {
          for (const o of obs[team]) {
            const dx = o.x - u.x;
            const dz = o.z - u.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > o.r * o.r) continue;
            if (brush >= 0 && o.b !== brush && d2 > 2.5 * 2.5 && !(t < u.revealUntil)) continue;
            seen = true;
            break;
          }
        }
        u.vis[team] = seen;
      }
    };
    this.champs.forEach(check);
    this.minions.forEach(check);
    this.monsters.forEach(check);
    this.structures.forEach(check);
    this.observers = obs;
  }

  observers: [{ x: number; z: number; r: number; b: number }[], { x: number; z: number; r: number; b: number }[]] = [[], []];

  private anyObserverNear(list: { x: number; z: number; r: number }[], u: Unit, r: number) {
    for (const o of list) if (Math.hypot(o.x - u.x, o.z - u.z) < Math.min(r, o.r)) return true;
    return false;
  }

  /** Wegfortschritt eines Minions (für Bots). */
  progressOf(m: Minion) {
    return this.minionProgress(m);
  }
}
