import type { Champion, Unit } from "./units";
import type { World } from "./world";
import type { V2 } from "./mapdata";

export type Role = "top" | "jungle" | "mid" | "bot" | "support";
export type Targeting = "self" | "dir" | "point" | "unit";
export type AiUse = "poke" | "fight" | "farm" | "escape" | "engage" | "self";

export type AbilityDef = {
  name: string;
  desc: string;
  icon: string;
  targeting: Targeting;
  range: number;
  radius?: number;
  width?: number;
  cd: number[];
  mana: number[];
  ai: AiUse;
  cast: (w: World, c: Champion, aim: V2, rank: number, target: Unit | null) => void;
};

export type Look = {
  body: number;
  accent: number;
  skin: number;
  hair: number;
  weapon: "sword" | "bow" | "staff" | "daggers" | "hammer";
  bulk: number;
  cape?: number;
};

export type ChampDef = {
  id: string;
  name: string;
  title: string;
  role: Role;
  roleName: string;
  ranged: boolean;
  projectile?: "arrow" | "bolt";
  base: { hp: number; mana: number; ad: number; armor: number; mr: number; as: number; range: number; ms: number; hpReg: number; manaReg: number };
  growth: { hp: number; mana: number; ad: number; armor: number; mr: number; as: number };
  abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef];
  levelOrder: number[];
  build: string[];
  look: Look;
  color: string;
  /**
   * Nahkampf mit eigener Schlaganimation: Länge des Clips und Trefferzeitpunkt darin (Sekunden bei
   * Originaltempo). Der Schaden kommt erst am Trefferzeitpunkt, nicht beim Start des Angriffs; bei höherem
   * Angriffstempo laufen Animation und Trefferzeit gemeinsam schneller (siehe World.basicAttack).
   */
  swing?: { clip: number; hit: number };
};

const r4 = (a: number[], rank: number) => a[Math.max(0, Math.min(a.length - 1, rank - 1))];

function dirFrom(c: Champion, aim: V2) {
  let dx = aim.x - c.x;
  let dz = aim.z - c.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) {
    dx = Math.sin(c.facing);
    dz = Math.cos(c.facing);
    return { dx, dz, len: 0 };
  }
  return { dx: dx / len, dz: dz / len, len };
}

function clampAim(c: Champion, aim: V2, range: number): V2 {
  const d = dirFrom(c, aim);
  const len = Math.min(range, d.len);
  return { x: c.x + d.dx * len, z: c.z + d.dz * len };
}

export const CHAMPIONS: ChampDef[] = [
  {
    id: "varok",
    name: "Varok",
    title: "die Klinge des Nordens",
    role: "top",
    roleName: "Kämpfer",
    ranged: false,
    color: "#e0663c",
    base: { hp: 650, mana: 300, ad: 64, armor: 34, mr: 32, as: 0.68, range: 2.4, ms: 7.0, hpReg: 1.8, manaReg: 1.6 },
    growth: { hp: 98, mana: 40, ad: 3.6, armor: 4, mr: 1.6, as: 2.5 },
    levelOrder: [3, 0, 2, 1],
    build: ["boots", "cleaver", "sunfire", "bloodthirster", "spiritcloak", "thornmail"],
    look: { body: 0x8a3b24, accent: 0xd8a24a, skin: 0xe2b48c, hair: 0x3a2618, weapon: "sword", bulk: 1.15, cape: 0x6a1f18 },
    abilities: [
      {
        name: "Wirbelklinge",
        desc: "Dreht sich mit der Klinge und trifft alle Gegner im Umkreis.",
        icon: "🌀",
        targeting: "self",
        range: 4.3,
        radius: 4.3,
        cd: [7, 6.5, 6, 5.5],
        mana: [30, 30, 30, 30],
        ai: "fight",
        cast: (w, c, _aim, rank) => {
          const dmg = r4([70, 110, 150, 190], rank) + c.stats.ad * 0.8;
          w.fx({ type: "spin", x: c.x, z: c.z, r: 4.3, color: 0xffb070, owner: c });
          c.anim.cast = 0.4;
          for (const u of w.enemiesInRadius(c.team, c.x, c.z, 4.3)) w.damage(c, u, dmg, "phys", { ability: true });
        },
      },
      {
        name: "Kampfschrei",
        desc: "Gewinnt kurz Lauftempo und einen Schild.",
        icon: "📯",
        targeting: "self",
        range: 0,
        cd: [14, 13, 12, 11],
        mana: [40, 40, 40, 40],
        ai: "self",
        cast: (w, c, _aim, rank) => {
          w.addBuff(c, { id: "varokW", until: w.t + 2.2, mods: { ms: 40 } });
          w.shieldUnit(c, 40 + rank * 40 + c.stats.maxHp * 0.08, 3);
          w.fx({ type: "shout", x: c.x, z: c.z, r: 3, color: 0xffd27a, owner: c });
        },
      },
      {
        name: "Ansturm",
        desc: "Stürmt nach vorn, verletzt und verlangsamt Gegner auf dem Weg.",
        icon: "💨",
        targeting: "dir",
        range: 7,
        width: 2,
        cd: [11, 10, 9, 8],
        mana: [35, 35, 35, 35],
        ai: "engage",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const dmg = r4([50, 80, 110, 140], rank) + c.stats.ad * 0.6;
          w.dash(c, c.x + d.dx * 7, c.z + d.dz * 7, 26, {
            hitRadius: 1.8,
            onHit: (u) => {
              w.damage(c, u, dmg, "phys", { ability: true });
              w.slow(u, 0.3, 1.5);
            },
          });
        },
      },
      {
        name: "Richtspruch",
        desc: "Springt zum Zielort, schmettert die Klinge nieder und schleudert Gegner hoch.",
        icon: "⚔️",
        targeting: "point",
        range: 9,
        radius: 4.5,
        cd: [70, 60, 50],
        mana: [100, 100, 100],
        ai: "engage",
        cast: (w, c, aim, rank) => {
          const p = clampAim(c, aim, 9);
          const dmg = r4([150, 275, 400], rank) + c.stats.ad * 1.0;
          w.dash(c, p.x, p.z, 20, {
            leap: true,
            onArrive: () => {
              w.fx({ type: "slam", x: c.x, z: c.z, r: 4.5, color: 0xffa040, owner: c });
              for (const u of w.enemiesInRadius(c.team, c.x, c.z, 4.5)) {
                w.damage(c, u, dmg, "phys", { ability: true });
                w.knockup(u, 0.75);
              }
            },
          });
        },
      },
    ],
  },
  {
    id: "lyra",
    name: "Lyra",
    title: "die Frostschützin",
    role: "bot",
    roleName: "Schützin",
    ranged: true,
    projectile: "arrow",
    color: "#5fb8ff",
    base: { hp: 570, mana: 320, ad: 61, armor: 26, mr: 30, as: 0.66, range: 8.5, ms: 6.8, hpReg: 1.4, manaReg: 1.6 },
    growth: { hp: 90, mana: 40, ad: 3.2, armor: 3.6, mr: 1.1, as: 3.4 },
    levelOrder: [3, 0, 1, 2],
    build: ["boots", "stormblade", "infinity", "bloodthirster", "swiftboots", "spiritcloak"],
    look: { body: 0x2f4f8f, accent: 0xdfe8ff, skin: 0xf0d0b8, hair: 0xeeeeff, weapon: "bow", bulk: 0.92, cape: 0x5e86d8 },
    abilities: [
      {
        name: "Pfeilhagel",
        desc: "Feuert einen Fächer aus Frostpfeilen, die Gegner verlangsamen.",
        icon: "🏹",
        targeting: "dir",
        range: 10,
        width: 4,
        cd: [8, 7.5, 7, 6.5],
        mana: [45, 45, 45, 45],
        ai: "poke",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const base = Math.atan2(d.dx, d.dz);
          const dmg = r4([45, 70, 95, 120], rank) + c.stats.ad * 0.9;
          const hit = new Set<number>();
          c.anim.atk = 1;
          for (let i = -3; i <= 3; i++) {
            const a = base + i * 0.13;
            w.skillshot(c, {
              dx: Math.sin(a),
              dz: Math.cos(a),
              speed: 26,
              range: 10,
              width: 0.6,
              visual: "arrow",
              color: 0xbfe6ff,
              sharedHits: hit,
              onHit: (u) => {
                w.damage(c, u, dmg, "phys", { ability: true });
                w.slow(u, 0.3, 1.5);
                return true;
              },
            });
          }
        },
      },
      {
        name: "Fokus",
        desc: "Stark erhöhtes Angriffstempo für einige Sekunden.",
        icon: "🎯",
        targeting: "self",
        range: 0,
        cd: [12, 11, 10, 9],
        mana: [30, 30, 30, 30],
        ai: "fight",
        cast: (w, c, _aim, rank) => {
          w.addBuff(c, { id: "lyraW", until: w.t + 4, mods: { as: r4([45, 60, 75, 90], rank) } });
          w.fx({ type: "aura", x: c.x, z: c.z, r: 1.6, color: 0x9fdcff, owner: c, dur: 4 });
        },
      },
      {
        name: "Hechtrolle",
        desc: "Rollt ein Stück weit. Der nächste Angriff trifft härter.",
        icon: "🌬️",
        targeting: "dir",
        range: 5,
        cd: [10, 9, 8, 7],
        mana: [30, 30, 30, 30],
        ai: "escape",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          w.dash(c, c.x + d.dx * 5, c.z + d.dz * 5, 24, {});
          c.empower = { until: w.t + 3.5, dmg: r4([40, 60, 80, 100], rank) + c.stats.ad * 0.5, type: "phys" };
          c.atkCd = Math.min(c.atkCd, 0.1);
        },
      },
      {
        name: "Kristallpfeil",
        desc: "Ein riesiger Pfeil über die ganze Karte. Betäubt den ersten Champion.",
        icon: "❄️",
        targeting: "dir",
        range: 60,
        width: 1.8,
        cd: [75, 65, 55],
        mana: [100, 100, 100],
        ai: "engage",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const dmg = r4([200, 350, 500], rank) + c.stats.ad * 1.0 + c.stats.ap;
          c.anim.atk = 1;
          w.skillshot(c, {
            dx: d.dx,
            dz: d.dz,
            speed: 24,
            range: 60,
            width: 1.6,
            visual: "bigarrow",
            color: 0x9fe8ff,
            champsOnly: true,
            onHit: (u, p) => {
              w.damage(c, u, dmg, "magic", { ability: true });
              w.stun(u, 1.2 + Math.min(1.3, p.traveled / 25));
              w.fx({ type: "burst", x: u.x, z: u.z, r: 3, color: 0xbff4ff, owner: c });
              for (const o of w.enemiesInRadius(c.team, u.x, u.z, 3)) if (o !== u) w.damage(c, o, dmg * 0.5, "magic", { ability: true });
              return true;
            },
          });
        },
      },
    ],
  },
  {
    id: "ignis",
    name: "Ignis",
    title: "der Flammenweber",
    role: "mid",
    roleName: "Magier",
    ranged: true,
    projectile: "bolt",
    color: "#ff8a3c",
    base: { hp: 545, mana: 420, ad: 52, armor: 22, mr: 30, as: 0.63, range: 8, ms: 6.8, hpReg: 1.3, manaReg: 2.2 },
    growth: { hp: 86, mana: 50, ad: 3, armor: 4, mr: 1.3, as: 2 },
    levelOrder: [3, 0, 1, 2],
    build: ["boots", "timestaff", "deathcap", "voidstaff", "spiritcloak", "swiftboots"],
    look: { body: 0x6a2c8a, accent: 0xffa040, skin: 0xd9a27c, hair: 0xff6020, weapon: "staff", bulk: 0.95, cape: 0x3f1a5a },
    abilities: [
      {
        name: "Feuerball",
        desc: "Schleudert einen Feuerball, der beim ersten Treffer explodiert.",
        icon: "🔥",
        targeting: "dir",
        range: 11,
        width: 1.2,
        cd: [4.5, 4, 3.5, 3],
        mana: [40, 45, 50, 55],
        ai: "poke",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const dmg = r4([80, 125, 170, 215], rank) + c.stats.ap * 0.75;
          c.anim.cast = 0.35;
          w.skillshot(c, {
            dx: d.dx,
            dz: d.dz,
            speed: 22,
            range: 11,
            width: 1.0,
            visual: "fireball",
            color: 0xff7a20,
            onHit: (u) => {
              w.damage(c, u, dmg, "magic", { ability: true });
              w.fx({ type: "burst", x: u.x, z: u.z, r: 2.2, color: 0xff8a30, owner: c });
              for (const o of w.enemiesInRadius(c.team, u.x, u.z, 2.2)) if (o !== u) w.damage(c, o, dmg * 0.5, "magic", { ability: true });
              return true;
            },
          });
        },
      },
      {
        name: "Flammensäule",
        desc: "Nach kurzer Verzögerung bricht eine Feuersäule aus und betäubt.",
        icon: "🌋",
        targeting: "point",
        range: 10,
        radius: 3.2,
        cd: [11, 10, 9, 8],
        mana: [70, 75, 80, 85],
        ai: "poke",
        cast: (w, c, aim, rank) => {
          const p = clampAim(c, aim, 10);
          const dmg = r4([75, 120, 165, 210], rank) + c.stats.ap * 0.65;
          c.anim.cast = 0.35;
          w.area(c, {
            x: p.x,
            z: p.z,
            radius: 3.2,
            delay: 0.7,
            visual: "pillar",
            color: 0xff6a1a,
            onTrigger: (a) => {
              for (const u of w.enemiesInRadius(c.team, a.x, a.z, a.radius)) {
                w.damage(c, u, dmg, "magic", { ability: true });
                w.stun(u, 1.0);
              }
            },
          });
        },
      },
      {
        name: "Glutsprung",
        desc: "Teleportiert sich ein Stück und läuft kurz schneller.",
        icon: "✨",
        targeting: "dir",
        range: 6,
        cd: [16, 14.5, 13, 11.5],
        mana: [60, 60, 60, 60],
        ai: "escape",
        cast: (w, c, aim) => {
          const d = dirFrom(c, aim);
          w.blink(c, c.x + d.dx * 6, c.z + d.dz * 6, 0xff8a30);
          w.addBuff(c, { id: "ignisE", until: w.t + 1.5, mods: { ms: 25 } });
        },
      },
      {
        name: "Meteor",
        desc: "Ruft einen Meteor herab. Riesiger Schaden und brennender Boden.",
        icon: "☄️",
        targeting: "point",
        range: 16,
        radius: 5,
        cd: [80, 70, 60],
        mana: [100, 100, 100],
        ai: "engage",
        cast: (w, c, aim, rank) => {
          const p = clampAim(c, aim, 16);
          const dmg = r4([220, 340, 460], rank) + c.stats.ap * 0.9;
          c.anim.cast = 0.6;
          w.area(c, {
            x: p.x,
            z: p.z,
            radius: 5,
            delay: 1.1,
            visual: "meteor",
            color: 0xff4a10,
            onTrigger: (a) => {
              for (const u of w.enemiesInRadius(c.team, a.x, a.z, a.radius)) {
                w.damage(c, u, dmg, "magic", { ability: true });
                w.slow(u, 0.35, 2);
              }
            },
          });
        },
      },
    ],
  },
  {
    id: "kira",
    name: "Kira",
    title: "die Schattenklinge",
    role: "jungle",
    roleName: "Assassinin",
    ranged: false,
    color: "#b061ff",
    base: { hp: 610, mana: 280, ad: 66, armor: 30, mr: 32, as: 0.7, range: 2.3, ms: 7.2, hpReg: 1.7, manaReg: 1.5 },
    growth: { hp: 92, mana: 40, ad: 3.5, armor: 4, mr: 1.6, as: 3 },
    levelOrder: [3, 0, 2, 1],
    build: ["boots", "cleaver", "bloodthirster", "infinity", "sunfire", "spiritcloak"],
    look: { body: 0x2a1c3c, accent: 0xb061ff, skin: 0xe0bfa0, hair: 0x15101e, weapon: "daggers", bulk: 1.08, cape: 0x45206e },
    // Boxing.fbx: 50 Bilder bei 30 fps; die rechte Faust ist bei Bild 16,5 am weitesten vorne (gemessen mit
    // assets-src/champion_anim.py --treffer). Hier anpassen, falls der Treffer früher oder später sitzen soll.
    swing: { clip: 50 / 30, hit: 15.5 / 30 },
    abilities: [
      {
        name: "Dolchwurf",
        desc: "Wirft einen Dolch, der verletzt und verlangsamt.",
        icon: "🗡️",
        targeting: "dir",
        range: 9,
        width: 0.9,
        cd: [6, 5.5, 5, 4.5],
        mana: [30, 30, 30, 30],
        ai: "poke",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const dmg = r4([65, 100, 135, 170], rank) + c.stats.ad * 0.85;
          c.anim.atk = 1;
          w.skillshot(c, {
            dx: d.dx,
            dz: d.dz,
            speed: 30,
            range: 9,
            width: 0.8,
            visual: "dagger",
            color: 0xd9a8ff,
            onHit: (u) => {
              w.damage(c, u, u.kind === "monster" ? dmg * 1.4 : dmg, "phys", { ability: true });
              w.slow(u, 0.25, 1.5);
              return true;
            },
          });
        },
      },
      {
        name: "Blutrausch",
        desc: "Mehr Angriffstempo, Lebensraub und Lauftempo.",
        icon: "🩸",
        targeting: "self",
        range: 0,
        cd: [13, 12, 11, 10],
        mana: [40, 40, 40, 40],
        ai: "fight",
        cast: (w, c, _aim, rank) => {
          w.addBuff(c, { id: "kiraW", until: w.t + 4, mods: { as: r4([35, 45, 55, 65], rank), ls: 18, ms: 15 } });
          w.fx({ type: "aura", x: c.x, z: c.z, r: 1.6, color: 0xff3060, owner: c, dur: 4 });
        },
      },
      {
        name: "Schattenschritt",
        desc: "Gleitet durch die Schatten und schneidet alle auf dem Weg.",
        icon: "🌑",
        targeting: "dir",
        range: 7,
        width: 2,
        cd: [12, 11, 10, 9],
        mana: [40, 40, 40, 40],
        ai: "engage",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const dmg = r4([55, 85, 115, 145], rank) + c.stats.ad * 0.6;
          w.dash(c, c.x + d.dx * 7, c.z + d.dz * 7, 30, {
            hitRadius: 1.8,
            untargetable: true,
            onHit: (u) => w.damage(c, u, dmg, "phys", { ability: true }),
          });
        },
      },
      {
        name: "Todesmal",
        desc: "Springt auf einen gegnerischen Champion. Mehr Schaden, je weniger Leben er hat.",
        icon: "💀",
        targeting: "unit",
        range: 8.5,
        cd: [60, 50, 40],
        mana: [100, 100, 100],
        ai: "engage",
        cast: (w, c, _aim, rank, target) => {
          if (!target) return;
          const base = r4([160, 260, 360], rank) + c.stats.ad * 1.1;
          w.blink(c, target.x - Math.sin(c.facing) * 1.2, target.z - Math.cos(c.facing) * 1.2, 0xb061ff);
          const missing = 1 - target.hp / target.stats.maxHp;
          w.damage(c, target, base * (1 + missing), "phys", { ability: true });
          w.fx({ type: "burst", x: target.x, z: target.z, r: 2.5, color: 0xc070ff, owner: c });
        },
      },
    ],
  },
  {
    id: "thorne",
    name: "Thorne",
    title: "der Felsenhüter",
    role: "support",
    roleName: "Tank",
    ranged: false,
    color: "#7fd27a",
    base: { hp: 690, mana: 320, ad: 56, armor: 38, mr: 32, as: 0.62, range: 2.6, ms: 6.9, hpReg: 2.2, manaReg: 1.6 },
    growth: { hp: 110, mana: 45, ad: 3, armor: 4.6, mr: 2, as: 2 },
    levelOrder: [3, 0, 2, 1],
    build: ["boots", "sunfire", "spiritcloak", "warmog", "thornmail", "timestaff"],
    look: { body: 0x5c6670, accent: 0x7fd27a, skin: 0x9a8a78, hair: 0x2c3a2a, weapon: "hammer", bulk: 1.3, cape: 0x2f4a2c },
    // Tank Schlag Animation.fbx: 73 Bilder bei 60 fps; die linke Faust ist im Haken bei Bild 21,85 am weitesten vorne
    // (gemessen mit assets-src/champion_anim.py --treffer). Hier anpassen, falls der Treffer früher oder später sitzen soll.
    swing: { clip: 73 / 60, hit: 20.85 / 60 },
    abilities: [
      {
        name: "Kettenhaken",
        desc: "Wirft einen Haken und zieht den ersten Gegner heran.",
        icon: "⛓️",
        targeting: "dir",
        range: 11,
        width: 1.3,
        cd: [14, 13, 12, 11],
        mana: [60, 60, 60, 60],
        ai: "engage",
        cast: (w, c, aim, rank) => {
          const d = dirFrom(c, aim);
          const dmg = r4([70, 120, 170, 220], rank) + c.stats.ap * 1.0;
          c.anim.atk = 1;
          w.skillshot(c, {
            dx: d.dx,
            dz: d.dz,
            speed: 24,
            range: 11,
            width: 1.2,
            visual: "hook",
            color: 0xa0ff90,
            noStructures: true,
            onHit: (u) => {
              w.damage(c, u, dmg, "magic", { ability: true });
              if (u.kind !== "monster" || u.radius < 1.5) {
                const dx = c.x - u.x;
                const dz = c.z - u.z;
                const len = Math.hypot(dx, dz) || 1;
                w.dash(u, c.x - (dx / len) * 1.8, c.z - (dz / len) * 1.8, 26, { forced: true });
              }
              w.stun(u, 0.6);
              return true;
            },
          });
        },
      },
      {
        name: "Steinhaut",
        desc: "Schützt sich und Verbündete in der Nähe mit einem Schild.",
        icon: "🪨",
        targeting: "self",
        range: 7,
        cd: [14, 13, 12, 11],
        mana: [50, 50, 50, 50],
        ai: "self",
        cast: (w, c, _aim, rank) => {
          const amt = r4([60, 95, 130, 165], rank) + c.stats.maxHp * 0.1;
          for (const a of w.alliesInRadius(c.team, c.x, c.z, 7)) {
            if (a.kind !== "champion") continue;
            w.shieldUnit(a, amt, 3);
          }
          w.fx({ type: "shout", x: c.x, z: c.z, r: 7, color: 0x9fff8a, owner: c });
        },
      },
      {
        name: "Erdstoß",
        desc: "Stampft auf. Verletzt und verlangsamt Gegner im Umkreis.",
        icon: "🦶",
        targeting: "self",
        range: 4.6,
        radius: 4.6,
        cd: [9, 8.5, 8, 7.5],
        mana: [40, 40, 40, 40],
        ai: "fight",
        cast: (w, c, _aim, rank) => {
          const dmg = r4([60, 95, 130, 165], rank) + c.stats.maxHp * 0.04;
          c.anim.cast = 0.35;
          w.fx({ type: "slam", x: c.x, z: c.z, r: 4.6, color: 0xb8e090, owner: c });
          for (const u of w.enemiesInRadius(c.team, c.x, c.z, 4.6)) {
            w.damage(c, u, dmg, "magic", { ability: true });
            w.slow(u, 0.4, 2);
          }
        },
      },
      {
        name: "Beben",
        desc: "Lässt die Erde beben und betäubt alle Gegner im großen Umkreis.",
        icon: "🌍",
        targeting: "self",
        range: 6.5,
        radius: 6.5,
        cd: [80, 70, 60],
        mana: [100, 100, 100],
        ai: "engage",
        cast: (w, c, _aim, rank) => {
          const dmg = r4([150, 250, 350], rank) + c.stats.maxHp * 0.06 + c.stats.ap * 0.5;
          c.anim.cast = 0.6;
          w.area(c, {
            x: c.x,
            z: c.z,
            radius: 6.5,
            delay: 0.35,
            visual: "quake",
            color: 0x9fd070,
            follow: c,
            onTrigger: (a) => {
              for (const u of w.enemiesInRadius(c.team, a.x, a.z, a.radius)) {
                w.damage(c, u, dmg, "magic", { ability: true });
                w.stun(u, 1.25);
              }
            },
          });
        },
      },
    ],
  },
];

export const CHAMP_BY_ID: Record<string, ChampDef> = Object.fromEntries(CHAMPIONS.map((c) => [c.id, c]));

export const ROLE_NAMES: Record<Role, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  bot: "Bot (Schütze)",
  support: "Support",
};
