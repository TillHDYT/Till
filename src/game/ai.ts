import { ITEM_BY_ID } from "./items";
import { CAMPS, FOUNTAIN, lanePath, type LaneId, type V2 } from "./mapdata";
import { Champion, Minion, Monster, Structure, type Unit } from "./units";
import { dist, type Brain, type Difficulty, type World } from "./world";

type TeamObjective = { camp: string; until: number };
const objectives: [TeamObjective | null, TeamObjective | null] = [null, null];

export function resetAi() {
  objectives[0] = null;
  objectives[1] = null;
}

const SKILL = {
  easy: { think: 0.45, aim: 0.45, aggro: -0.18, useAbil: 0.45 },
  normal: { think: 0.25, aim: 0.8, aggro: 0, useAbil: 0.8 },
  hard: { think: 0.14, aim: 1, aggro: 0.08, useAbil: 1 },
};

export class BotBrain implements Brain {
  private wait = Math.random() * 0.3;
  private state: "play" | "retreat" = "play";
  private lastPos = new Map<number, { x: number; z: number; t: number; vx: number; vz: number }>();
  private jitter = { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 };
  private cfg: (typeof SKILL)["normal"];

  constructor(difficulty: Difficulty) {
    this.cfg = SKILL[difficulty];
  }

  think(w: World, c: Champion, dt: number) {
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.cfg.think * (0.8 + Math.random() * 0.4);
    if (!c.alive) {
      this.state = "play";
      this.shop(w, c);
      return;
    }
    this.track(w);

    // Fähigkeiten steigern
    for (let guard = 0; guard < 4 && c.points > 0; guard++) {
      const slot = c.def.levelOrder.find((s) => c.canRank(s));
      if (slot === undefined) break;
      w.levelUp(c, slot);
    }

    if (w.canShop(c)) this.shop(w, c);
    if (c.recallUntil > 0) {
      c.moveVec = null;
      return;
    }

    const hpF = c.hp / c.stats.maxHp;
    const enemy = this.bestEnemy(w, c, 12);
    const inDanger = enemy && dist(enemy, c) < 9;

    if (this.state === "play" && (hpF < (c.role === "jungle" ? 0.3 : 0.27) || (c.mana < c.stats.maxMana * 0.1 && hpF < 0.5 && !inDanger))) {
      this.state = "retreat";
    }
    // Zum Einkaufen heimkehren, wenn genug Gold für das nächste Item da ist
    const next = w.nextBuild(c);
    const cost = next ? (ITEM_BY_ID[next]?.cost ?? 9999) : 9999;
    if (this.state === "play" && !inDanger && c.gold >= cost + 150 && w.t - c.lastDamagedAt > 4 && dist(c, FOUNTAIN[c.team as 0 | 1]) > 45) {
      this.state = "retreat";
    }
    if (this.state === "retreat") {
      this.retreat(w, c, enemy);
      return;
    }

    if (enemy && this.shouldFight(w, c, enemy)) {
      this.fight(w, c, enemy);
      return;
    }

    if (this.defendBase(w, c)) return;
    if (this.objective(w, c)) return;

    if (c.role === "jungle" && w.t > 30) this.jungle(w, c);
    else this.lane(w, c, c.role === "jungle" ? "mid" : c.lane);
  }

  // ----- Hilfen -----

  private track(w: World) {
    for (const e of w.champs) {
      const prev = this.lastPos.get(e.id);
      if (prev && w.t - prev.t > 0.05) {
        const k = 1 / (w.t - prev.t);
        prev.vx = (e.x - prev.x) * k;
        prev.vz = (e.z - prev.z) * k;
        prev.x = e.x;
        prev.z = e.z;
        prev.t = w.t;
      } else if (!prev) this.lastPos.set(e.id, { x: e.x, z: e.z, t: w.t, vx: 0, vz: 0 });
    }
  }

  private predict(u: Unit, time: number): V2 {
    const p = this.lastPos.get(u.id);
    const acc = this.cfg.aim;
    if (!p) return { x: u.x, z: u.z };
    const err = (1 - acc) * 2.5;
    return {
      x: u.x + p.vx * time * acc + (Math.random() - 0.5) * err,
      z: u.z + p.vz * time * acc + (Math.random() - 0.5) * err,
    };
  }

  private shop(w: World, c: Champion) {
    for (let i = 0; i < 3; i++) {
      const next = w.nextBuild(c);
      if (!next) break;
      if (!w.buy(c, next)) {
        // Zwischenkauf, wenn das große Item noch zu teuer ist
        if (c.gold >= 900 && c.items.length < 5) {
          const filler = c.def.ranged ? (c.def.id === "ignis" ? "tome" : "longsword") : c.role === "support" ? "ruby" : "longsword";
          if (!c.items.includes(filler)) w.buy(c, filler);
        }
        break;
      }
    }
  }

  private bestEnemy(w: World, c: Champion, r: number): Champion | null {
    let best: Champion | null = null;
    let score = Infinity;
    for (const e of w.champs) {
      if (!w.attackable(e, c.team)) continue;
      const d = dist(e, c);
      if (d > r) continue;
      const s = d * 0.6 + (e.hp / e.stats.maxHp) * 10;
      if (s < score) {
        score = s;
        best = e;
      }
    }
    return best;
  }

  private count(w: World, team: number, x: number, z: number, r: number) {
    let n = 0;
    for (const c of w.champs) if (c.alive && c.team === team && Math.hypot(c.x - x, c.z - z) < r) n++;
    return n;
  }

  private enemyTurretAt(w: World, c: Champion, p: V2, pad = 1.5): Structure | null {
    for (const s of w.structures) {
      if (!s.alive || s.kind !== "turret" || s.team === c.team) continue;
      if (dist(s, p) < s.stats.range + pad) return s;
    }
    return null;
  }

  private turretSafe(w: World, c: Champion, s: Structure) {
    if (s.target === c) return false;
    let n = 0;
    for (const m of w.minions) if (m.alive && m.team === c.team && dist(m, s) < s.stats.range + 0.5) n++;
    return n >= 2;
  }

  private shouldFight(w: World, c: Champion, e: Champion) {
    const myF = c.hp / c.stats.maxHp;
    const thF = e.hp / e.stats.maxHp;
    const allies = this.count(w, c.team, c.x, c.z, 13);
    const foes = this.count(w, e.team, e.x, e.z, 13);
    let adv = myF - thF + (allies - foes) * 0.22 + (c.level - e.level) * 0.07 + this.cfg.aggro;
    if (c.hasBuff("baron")) adv += 0.15;
    const tur = this.enemyTurretAt(w, c, e, 0.5);
    if (tur && !this.turretSafe(w, c, tur)) {
      if (!(thF < 0.2 && myF > 0.55)) return false;
    }
    if (dist(e, FOUNTAIN[e.team as 0 | 1]) < 30) return false;
    if (thF < 0.22 && myF > 0.3) return true;
    return adv > 0.02 && myF > 0.38;
  }

  private castAt(w: World, c: Champion, slot: number, tg: Unit) {
    const ab = c.def.abilities[slot];
    if (c.ranks[slot] <= 0 || c.cds[slot] > 0 || c.mana < c.manaFor(slot)) return false;
    if (Math.random() > this.cfg.useAbil) return false;
    const d = dist(c, tg);
    if (ab.targeting === "self") {
      if (ab.radius && d > ab.radius + tg.radius * 0.5) return false;
      if (!ab.radius && d > 7) return false;
      return w.cast(c, slot, null);
    }
    if (ab.targeting === "unit") {
      if (d > ab.range + tg.radius) return false;
      return w.cast(c, slot, { x: tg.x, z: tg.z }, tg);
    }
    if (d > ab.range + tg.radius * 0.5) return false;
    const speed = ab.targeting === "dir" ? 24 : 999;
    const aim = this.predict(tg, ab.targeting === "dir" ? d / speed : 0.4);
    if (ab.ai === "escape") return false;
    return w.cast(c, slot, aim, tg);
  }

  private fight(w: World, c: Champion, e: Champion) {
    const hpF = c.hp / c.stats.maxHp;
    const thF = e.hp / e.stats.maxHp;
    // Ultimate zuerst, wenn es lohnt
    if (thF < 0.65 || this.count(w, e.team, e.x, e.z, 8) >= 2) this.castAt(w, c, 3, e);
    for (const slot of [0, 2, 1]) {
      const ab = c.def.abilities[slot];
      if (ab.ai === "escape") continue;
      if (ab.ai === "engage" && dist(c, e) < c.stats.range && slot !== 0) continue;
      this.castAt(w, c, slot, e);
    }
    if (c.spell2 === "heal" && hpF < 0.22) w.spell2(c);
    if (thF < 0.12 && dist(c, e) > c.stats.range + 2 && dist(c, e) < 8 && this.cfg.aim >= 1 && c.flashCd <= 0) {
      w.flash(c, { x: e.x, z: e.z });
    }
    c.order = { type: "attack", target: e };
  }

  private retreat(w: World, c: Champion, enemy: Champion | null) {
    const hpF = c.hp / c.stats.maxHp;
    if (w.inFountain(c)) {
      c.order = { type: "none" };
      if (hpF > 0.92 && c.mana > c.stats.maxMana * 0.75) this.state = "play";
      return;
    }
    const f = FOUNTAIN[c.team as 0 | 1];
    const close = enemy && dist(enemy, c) < 8;
    if (close) {
      // Flucht: Bewegungsfähigkeiten weg vom Gegner, Heilen, Blitz
      const away = { x: c.x + (c.x - enemy.x), z: c.z + (c.z - enemy.z) };
      for (const slot of [0, 1, 2, 3]) {
        const ab = c.def.abilities[slot];
        if (ab.ai === "escape" && c.ranks[slot] > 0 && c.cds[slot] <= 0) w.cast(c, slot, away);
      }
      if (c.spell2 === "heal" && hpF < 0.2) w.spell2(c);
      if (hpF < 0.12 && c.flashCd <= 0 && this.cfg.aim >= 0.8) w.flash(c, f);
      // Zur Not zurückschlagen, wenn der Gegner fast tot ist
      if (enemy.hp / enemy.stats.maxHp < 0.15) {
        c.order = { type: "attack", target: enemy };
        return;
      }
    }
    const safe = !enemy && w.t - c.lastDamagedAt > 2.5;
    if (safe && dist(c, f) > 28) {
      c.order = { type: "none" };
      w.startRecall(c);
      return;
    }
    c.order = { type: "move", x: f.x + 2, z: f.z - 2 * (c.team === 0 ? 1 : -1) };
  }

  private defendBase(w: World, c: Champion) {
    if (w.t < 300) return false;
    for (const s of w.structures) {
      if (!s.alive || s.team !== c.team) continue;
      if (s.kind === "turret" && s.tier !== "nexus" && s.tier !== "inhib") continue;
      let threat: Unit | null = null;
      for (const e of w.champs) if (w.attackable(e, c.team) && dist(e, s) < 16) threat = e;
      if (!threat) {
        let n = 0;
        for (const m of w.minions) if (m.alive && m.team !== c.team && dist(m, s) < 14) n++;
        if (n >= 3) threat = s;
      }
      if (threat && dist(c, s) < 90) {
        if (threat === s) this.farmAround(w, c, s, 14);
        else if (threat instanceof Champion && this.shouldFight(w, c, threat)) this.fight(w, c, threat);
        else c.order = { type: "move", x: s.x + this.jitter.x, z: s.z + this.jitter.z };
        return true;
      }
    }
    return false;
  }

  private objective(w: World, c: Champion) {
    const team = c.team as 0 | 1;
    let obj = objectives[team];
    if (obj && (w.t > obj.until || !w.campAlive.get(obj.camp))) obj = objectives[team] = null;
    if (!obj && c.role === "jungle" && c.hp / c.stats.maxHp > 0.7) {
      const mates = w.champs.filter((x) => x.team === team && x.alive).length;
      const foes = w.champs.filter((x) => x.team !== team && x.alive).length;
      if (w.campAlive.get("dragon") && c.level >= 6 && mates >= foes) objectives[team] = obj = { camp: "dragon", until: w.t + 40 };
      else if (w.campAlive.get("baron") && c.level >= 11 && mates >= 4 && mates > foes) objectives[team] = obj = { camp: "baron", until: w.t + 45 };
    }
    if (!obj) return false;
    const camp = CAMPS.find((k) => k.id === obj.camp)!;
    const d = dist(c, camp.pos);
    const joins = c.role === "jungle" || d < (obj.camp === "dragon" ? 55 : 70) || obj.camp === "baron";
    if (!joins) return false;
    const mon = w.monsters.find((m) => m.alive && m.camp === obj.camp);
    if (!mon) return false;
    const team2 = this.count(w, team, camp.pos.x, camp.pos.z, 14);
    if (c.role === "jungle" && team2 < (obj.camp === "baron" ? 3 : 1) && d < 14) {
      c.order = { type: "move", x: camp.pos.x + (team === 0 ? -9 : 9), z: camp.pos.z + (team === 0 ? 4 : -4) };
      return true;
    }
    if (d > 12) {
      c.order = { type: "move", x: camp.pos.x + this.jitter.x, z: camp.pos.z + this.jitter.z };
      return true;
    }
    this.hitMonster(w, c, mon);
    return true;
  }

  private hitMonster(w: World, c: Champion, mon: Monster) {
    const smite = 450 + c.level * 30;
    if (c.spell2 === "smite" && c.spell2Cd <= 0 && mon.big && mon.hp < smite && dist(c, mon) < 6 + mon.radius) w.spell2(c);
    for (const slot of [0, 1, 2]) {
      const ab = c.def.abilities[slot];
      if (ab.ai === "escape" || ab.ai === "engage") continue;
      if (c.mana < c.stats.maxMana * 0.3) break;
      this.castAt(w, c, slot, mon);
    }
    c.order = { type: "attack", target: mon };
  }

  private jungle(w: World, c: Champion) {
    const team = c.team as 0 | 1;
    // Gank, wenn ein Gegner in der Nähe angeschlagen ist
    if (c.level >= 3) {
      for (const e of w.champs) {
        if (!w.attackable(e, c.team)) continue;
        if (e.hp / e.stats.maxHp > 0.55) continue;
        const d = dist(e, c);
        if (d > 45) continue;
        if (this.enemyTurretAt(w, c, e, 0)) continue;
        if (this.count(w, c.team, e.x, e.z, 18) >= 1 || d < 15) {
          c.order = { type: "move", x: e.x, z: e.z };
          return;
        }
      }
    }
    let best: Monster | null = null;
    let bd = Infinity;
    let bestDist = Infinity;
    for (const m of w.monsters) {
      if (!m.alive || m.resetting) continue;
      const camp = CAMPS.find((k) => k.id === m.camp);
      if (!camp || camp.kind === "dragon" || camp.kind === "baron") continue;
      if (camp.side !== team && !(camp.kind === "scuttle")) {
        // gegnerischer Jungle nur, wenn stark genug
        if (c.level < 8 || this.count(w, 1 - team, m.x, m.z, 25) > 0) continue;
      }
      // eigene Camps bevorzugen: fremde (auch das Flussmonster) zählen 30 weiter weg. Nur für die Auswahl, nicht für
      // die Frage, ob er schon nah genug zum Angreifen ist (sonst läuft er ewig hin und her)
      const real = dist(m, c);
      const d = camp.side !== team ? real + 30 : real;
      if (d < bd) {
        bd = d;
        bestDist = real;
        best = m;
      }
    }
    if (best) {
      if (bestDist > 6) {
        c.order = { type: "move", x: best.x, z: best.z };
        return;
      }
      // Lebenspunkte schwächster zuerst, außer der Große ist fast tot
      const campMates = w.monsters.filter((m) => m.alive && m.camp === best!.camp);
      campMates.sort((a, b) => a.hp - b.hp);
      this.hitMonster(w, c, campMates[0]);
      return;
    }
    // Nichts zu tun: auf der Lane helfen, die am nächsten ist
    const lanes: LaneId[] = ["top", "mid", "bot"];
    let nearest: LaneId = "mid";
    let nd = Infinity;
    for (const l of lanes) {
      const path = lanePath(team, l);
      const mid = path[Math.floor(path.length / 2)];
      const d = dist(mid, c);
      if (d < nd) {
        nd = d;
        nearest = l;
      }
    }
    this.lane(w, c, nearest);
  }

  /** Vorderster eigener Minion bzw. Rückfallposition auf der Lane. */
  private front(w: World, c: Champion, lane: LaneId): { p: V2; back: V2; hasMinions: boolean } {
    const path = lanePath(c.team as 0 | 1, lane);
    let best: Minion | null = null;
    let bestProg = -1;
    for (const m of w.minions) {
      if (!m.alive || m.team !== c.team || m.lane !== lane) continue;
      const nxt = m.path[Math.min(m.wp, m.path.length - 1)];
      const prog = m.wp * 1000 - Math.hypot(nxt.x - m.x, nxt.z - m.z);
      if (prog > bestProg) {
        bestProg = prog;
        best = m;
      }
    }
    let p: V2;
    let wp: number;
    if (best) {
      p = { x: best.x, z: best.z };
      wp = best.wp;
    } else {
      // äußerster eigener Turm dieser Lane
      const own = w.structures.filter((s) => s.alive && s.team === c.team && s.kind === "turret" && s.lane === lane);
      const order = ["outer", "inner", "inhib"];
      own.sort((a, b) => order.indexOf(a.tier ?? "") - order.indexOf(b.tier ?? ""));
      const t = own[0] ?? w.structures.find((s) => s.kind === "nexus" && s.team === c.team)!;
      p = { x: t.x, z: t.z };
      let bi = 1;
      let bdd = Infinity;
      path.forEach((q, i) => {
        const d = dist(q, p);
        if (d < bdd) {
          bdd = d;
          bi = i;
        }
      });
      wp = Math.max(1, bi);
    }
    const prev = path[Math.max(0, wp - 1)];
    const dx = prev.x - p.x;
    const dz = prev.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { p, back: { x: dx / len, z: dz / len }, hasMinions: !!best };
  }

  private lane(w: World, c: Champion, lane: LaneId) {
    // Support begleitet den Schützen
    if (c.role === "support") {
      const adc = w.champs.find((x) => x.team === c.team && x.role === "bot" && x.alive && !x.isPlayer) ?? w.champs.find((x) => x.team === c.team && x.role === "bot" && x.alive);
      if (adc && dist(adc, FOUNTAIN[c.team as 0 | 1]) > 40) {
        const fr = this.front(w, c, "bot");
        const tx = adc.x + fr.back.x * 2.5 + this.jitter.x * 0.5;
        const tz = adc.z + fr.back.z * 2.5 + this.jitter.z * 0.5;
        const e = this.bestEnemy(w, c, 9);
        if (e && this.shouldFight(w, c, e)) return this.fight(w, c, e);
        if (dist(c, { x: tx, z: tz }) > 2.5) c.order = { type: "move", x: tx, z: tz };
        else if (c.order.type === "move") c.order = { type: "none" };
        return;
      }
    }

    const fr = this.front(w, c, lane);
    const ranged = c.def.ranged;
    const back = ranged ? 5.5 : 3;
    let stand = { x: fr.p.x + fr.back.x * back + this.jitter.x * 0.6, z: fr.p.z + fr.back.z * back + this.jitter.z * 0.6 };
    if (!fr.hasMinions) stand = { x: fr.p.x + fr.back.x * 3, z: fr.p.z + fr.back.z * 3 };

    // Farmen
    if (fr.hasMinions || dist(c, fr.p) < 14) {
      if (this.farmAround(w, c, fr.p, 12)) return;
    }

    // Gegnerischen Turm angreifen, wenn Minions ihn tanken
    const tur = this.enemyTurretAt(w, c, fr.p, 3);
    if (tur && this.turretSafe(w, c, tur)) {
      const enemiesNear = w.minions.some((m) => m.alive && m.team !== c.team && dist(m, tur) < 13);
      if (!enemiesNear && !tur.invulnerable) {
        c.order = { type: "attack", target: tur };
        return;
      }
    }
    // Andere Gebäude (Inhibitor, Nexus) angreifen, wenn frei
    for (const s of w.structures) {
      if (!w.attackable(s, c.team) || s.kind === "turret") continue;
      if (dist(s, c) < 16 && !this.enemyTurretAt(w, c, c, 0.5)) {
        c.order = { type: "attack", target: s };
        return;
      }
    }

    // Nicht in Turmreichweite stehen
    const dangerTurret = this.enemyTurretAt(w, c, stand, 1);
    if (dangerTurret && !this.turretSafe(w, c, dangerTurret)) {
      const dx = stand.x - dangerTurret.x;
      const dz = stand.z - dangerTurret.z;
      const len = Math.hypot(dx, dz) || 1;
      const r = dangerTurret.stats.range + 2.5;
      stand = { x: dangerTurret.x + (dx / len) * r + fr.back.x * 2, z: dangerTurret.z + (dz / len) * r + fr.back.z * 2 };
    }
    // Gegner pieksen, wenn sicher
    const e = this.bestEnemy(w, c, 10);
    if (e && !this.enemyTurretAt(w, c, c, 0.5)) {
      for (const slot of [0, 1, 2]) if (c.def.abilities[slot].ai === "poke" && c.mana > c.stats.maxMana * 0.45) this.castAt(w, c, slot, e);
    }
    if (dist(c, stand) > 1.8) c.order = { type: "move", x: stand.x, z: stand.z };
    else if (c.order.type !== "attack") c.order = { type: "none" };
  }

  /** Minions in der Nähe eines Punktes farmen. */
  private farmAround(w: World, c: Champion, p: V2, r: number): boolean {
    let lastHit: Minion | null = null;
    let weakest: Minion | null = null;
    let enemyCount = 0;
    const myDmg = c.stats.ad;
    for (const m of w.minions) {
      if (!w.attackable(m, c.team)) continue;
      if (dist(m, p) > r) continue;
      enemyCount++;
      const tur = this.enemyTurretAt(w, c, m, 0.5);
      if (tur && !this.turretSafe(w, c, tur)) continue;
      const eff = myDmg * (100 / (100 + m.stats.armor));
      if (m.hp <= eff * 1.05 && (!lastHit || m.hp < lastHit.hp)) lastHit = m;
      if (!weakest || m.hp < weakest.hp) weakest = m;
    }
    if (lastHit) {
      c.order = { type: "attack", target: lastHit };
      return true;
    }
    if (enemyCount === 0) return false;
    // Welle schieben, wenn kein Gegner-Champion in der Nähe
    const foes = this.count(w, 1 - (c.team as number), c.x, c.z, 14);
    if (weakest && (foes === 0 || w.t > 600)) {
      if (enemyCount >= 4 && c.mana > c.stats.maxMana * 0.5) {
        for (const slot of [0, 1, 2]) if (c.def.abilities[slot].ai === "fight" || c.def.abilities[slot].ai === "poke") this.castAt(w, c, slot, weakest);
      }
      c.order = { type: "attack", target: weakest };
      return true;
    }
    if (weakest && weakest.hp < myDmg * 2.2 && dist(c, weakest) < c.stats.range + 3) {
      c.order = { type: "none" };
      return false;
    }
    return false;
  }
}
