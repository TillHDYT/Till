import * as THREE from "three";
import { FogOfWar } from "./fog";
import { GroundFx, Indicators, Particles } from "./fx";
import { FOUNTAIN, type V2 } from "./mapdata";
import {
  TEAM_COLOR,
  TEAM_GLOW,
  buildBrazier,
  buildChampion,
  updateRig,
  buildFountain,
  buildInhibitor,
  buildMonster,
  buildNexus,
  buildTurret,
  glowSprite,
  minionGeometry,
  type ChampModel,
  type StructModel,
} from "./models";
import { buildTerrain, type Quality, type Terrain } from "./terrain";
import { Champion, Minion, Monster, Structure, type MinionType, type Unit } from "./units";
import type { Area, Projectile, World } from "./world";

const MINION_TYPES: MinionType[] = ["melee", "caster", "siege", "super"];
const MINION_CAP: Record<MinionType, number> = { melee: 90, caster: 90, siege: 24, super: 30 };

function angleLerp(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

type ChampView = { model: ChampModel; unit: Champion; facing: number; deathT: number; beam: THREE.Mesh | null; shield: THREE.Mesh };
type MonView = { root: THREE.Group; glow: THREE.Object3D | null; unit: Monster; facing: number };
type StructView = {
  model: StructModel;
  unit: Structure;
  lastAtk: number;
  beam: THREE.Mesh | null;
  halo: THREE.Mesh | null;
};

export class View {
  readonly scene: THREE.Scene;
  readonly fog: FogOfWar;
  readonly particles: Particles;
  readonly ground: GroundFx;
  readonly indicators: Indicators;
  readonly terrain: Terrain;
  private world: World;
  private champs = new Map<number, ChampView>();
  private mons = new Map<number, MonView>();
  private structs = new Map<number, StructView>();
  private minionMesh: Record<string, THREE.InstancedMesh> = {};
  private projs = new Map<number, THREE.Object3D>();
  private areas = new Map<number, { ring: THREE.Mesh; disc: THREE.Mesh; meteor: THREE.Object3D | null }>();
  private auras: { owner: Unit; until: number; color: THREE.Color }[] = [];
  private time = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private projGeo = {
    sphere: new THREE.SphereGeometry(1, 10, 8),
    arrow: new THREE.BoxGeometry(0.09, 0.09, 1.1),
    big: new THREE.OctahedronGeometry(1, 0),
    cone: new THREE.ConeGeometry(0.12, 0.6, 4),
    chain: new THREE.CylinderGeometry(0.05, 0.05, 1, 4),
  };
  private hookChains = new Map<number, THREE.Mesh>();
  private fogT = 0;
  private playerTeam: 0 | 1;
  private braziers: { x: number; z: number; y: number; glow: THREE.Sprite; flame: THREE.Object3D; phase: number }[] = [];
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private fireCol = [new THREE.Color(0xffb040), new THREE.Color(0xff6a10), new THREE.Color(0xffe080)];

  constructor(scene: THREE.Scene, world: World, quality: Quality) {
    this.scene = scene;
    this.world = world;
    this.playerTeam = world.player.team as 0 | 1;
    this.fog = new FogOfWar();
    this.terrain = buildTerrain(world.grid, quality, this.fog);
    scene.add(this.terrain.group);
    this.particles = new Particles(quality === "high" ? 4000 : 2500);
    scene.add(this.particles.points);
    this.ground = new GroundFx();
    scene.add(this.ground.group);
    this.indicators = new Indicators();
    scene.add(this.indicators.group);

    // Brunnen
    FOUNTAIN.forEach((f, i) => {
      const fo = buildFountain(i as 0 | 1);
      fo.position.set(f.x, 0.12, f.z);
      fo.rotation.y = Math.atan2(100 - f.x, 100 - f.z);
      scene.add(fo);
    });

    for (const s of world.structures) {
      const team = s.team as 0 | 1;
      const model = s.kind === "turret" ? buildTurret(team) : s.kind === "inhib" ? buildInhibitor(team) : buildNexus(team);
      model.root.position.set(s.x, world.grid.groundAt(s.x, s.z), s.z);
      model.root.rotation.y = s.facing;
      model.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      scene.add(model.root);
      this.structs.set(s.id, { model, unit: s, lastAtk: 0, beam: null, halo: null });
      // Feuerschalen links und rechts der Inhibitoren
      if (s.kind === "inhib") {
        const c = Math.cos(s.facing);
        const sn = Math.sin(s.facing);
        for (const side of [-1, 1]) {
          const bx = s.x + c * 4.4 * side - sn * 1.2;
          const bz = s.z - sn * 4.4 * side - c * 1.2;
          const b = buildBrazier();
          b.root.position.set(bx, world.grid.groundAt(bx, bz), bz);
          scene.add(b.root);
          this.braziers.push({ x: bx, z: bz, y: b.root.position.y + b.fireY, glow: b.glow, flame: b.flame, phase: Math.random() * 6 });
        }
      }
    }

    for (const c of world.champs) {
      const ringColor = c.isPlayer ? 0x6dff5a : c.team === this.playerTeam ? 0x3fa0ff : 0xff3a30;
      const model = buildChampion(c.def.look, ringColor, c.def.id);
      scene.add(model.root);
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(1.3, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      shield.position.y = 1.3;
      shield.visible = false;
      model.root.add(shield);
      this.champs.set(c.id, { model, unit: c, facing: c.facing, deathT: 0, beam: null, shield });
    }

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const team of [0, 1] as const) {
      for (const type of MINION_TYPES) {
        const im = new THREE.InstancedMesh(minionGeometry(type, team), mat, MINION_CAP[type]);
        im.count = 0;
        im.castShadow = true;
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(im);
        this.minionMesh[`${team}${type}`] = im;
      }
    }
  }

  private seen(u: Unit) {
    return u.team === this.playerTeam || u.vis[this.playerTeam];
  }

  sync(dt: number, camera: THREE.Camera) {
    this.time += dt;
    const w = this.world;
    const g = w.grid;
    this.terrain.update(this.time);

    // Nebel
    this.fogT -= dt;
    if (this.fogT <= 0) {
      this.fogT = 0.1;
      this.fog.setObservers(w.observers[this.playerTeam]);
    }
    this.fog.update(dt);

    this.handleFx();

    // Champions
    for (const v of this.champs.values()) {
      const c = v.unit;
      const m = v.model;
      const visible = this.seen(c) || (!c.alive && w.t - c.diedAt < 0.2 && c.team === this.playerTeam);
      m.root.visible = c.alive ? visible : w.t - c.diedAt < 3.5 && (this.seen(c) || c.team === this.playerTeam);
      if (!m.root.visible) continue;
      let y = g.groundAt(c.x, c.z);
      if (c.dash?.leap) {
        const total = c.dash.total || 1;
        const done = Math.hypot(c.x - c.dash.sx, c.z - c.dash.sz) / total;
        y += Math.sin(Math.min(1, done) * Math.PI) * 3.2;
      }
      if (w.t < c.knockUntil) y += Math.sin(((c.knockUntil - w.t) / 0.75) * Math.PI) * 1.4;
      m.root.position.set(c.x, y, c.z);
      v.facing = angleLerp(v.facing, c.facing, Math.min(1, dt * 14));
      m.body.rotation.y = v.facing;
      m.ring.visible = c.alive;
      if (!c.alive) {
        v.deathT += dt;
        m.body.rotation.x = Math.max(-Math.PI / 2, -v.deathT * 5);
        m.body.position.y = Math.max(-0.8, -Math.max(0, v.deathT - 1.5) * 0.6) + 0.3 * Math.min(1, v.deathT * 5);
        v.shield.visible = false;
        if (v.beam) v.beam.visible = false;
        continue;
      }
      v.deathT = 0;
      m.body.rotation.x = 0;
      m.body.position.y = 0;

      // Laufen (Modelle mit Skelett: Laufanimation, sonst schwingende Glieder)
      if (m.rig) updateRig(m.rig, c.anim.moving, c.anim.speed, dt);
      if (c.anim.moving) c.anim.walk += dt * (c.anim.speed || 6) * 1.5;
      else c.anim.walk *= 0.85;
      const sw = c.anim.moving ? Math.sin(c.anim.walk) : 0;
      m.legL.rotation.x = sw * 0.75;
      m.legR.rotation.x = -sw * 0.75;
      // Modelle mit Skelett federn schon in der Laufanimation, darum dort kein zusätzliches Wippen
      m.body.position.y = c.anim.moving ? (m.rig ? 0 : Math.abs(Math.cos(c.anim.walk)) * 0.08) : Math.sin(this.time * 2 + c.id) * 0.02;
      let aL = -sw * 0.5;
      let aR = sw * 0.5;
      // Angriff
      const atk = c.anim.atk;
      if (atk > 0) {
        if (c.def.look.weapon === "bow") {
          aL = -1.5;
          aR = -1.2 + atk * 0.6;
        } else if (c.def.look.weapon === "staff") {
          aR = -1.9 * Math.sin(atk * Math.PI);
        } else {
          aR = -2.6 * Math.sin(atk * Math.PI);
          if (c.def.look.weapon === "daggers") aL = -2.0 * Math.sin((1 - atk) * Math.PI);
        }
      }
      if (c.anim.cast > 0) {
        const k = Math.min(1, c.anim.cast * 3);
        aL = -2.5 * k;
        aR = -2.5 * k;
      }
      m.armL.rotation.x = aL;
      m.armR.rotation.x = aR;
      m.armL.rotation.z = -0.12;
      m.armR.rotation.z = 0.12;
      if (m.glow) {
        const s = 0.9 + Math.sin(this.time * 6 + c.id) * 0.15;
        m.glow.scale.setScalar(s * (c.def.look.weapon === "staff" ? 1.4 : 0.9));
      }
      v.shield.visible = c.shield > 1;
      // Rückruf-Lichtsäule
      if (c.recallUntil > 0) {
        if (!v.beam) {
          v.beam = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1.2, 8, 20, 1, true),
            new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
          );
          v.beam.position.y = 4;
          m.root.add(v.beam);
        }
        v.beam.visible = true;
        const k = (w.t - c.recallStart) / Math.max(0.1, c.recallUntil - c.recallStart);
        (v.beam.material as THREE.MeshBasicMaterial).opacity = 0.15 + k * 0.35;
        if (Math.random() < 0.5) this.particles.emit(c.x + (Math.random() - 0.5) * 2, y + 0.2, c.z + (Math.random() - 0.5) * 2, 0, 3 + Math.random() * 2, 0, new THREE.Color(0x9fe0ff), 0.5, 1.2);
      } else if (v.beam) v.beam.visible = false;
      // Betäubt: Sterne
      if (c.stunned(w.t) && Math.random() < 0.3) {
        const a = this.time * 6;
        this.particles.emit(c.x + Math.cos(a) * 0.6, y + c.height + 0.2, c.z + Math.sin(a) * 0.6, 0, 0.3, 0, new THREE.Color(0xffe060), 0.35, 0.4, 0);
      }
    }

    this.syncMinions(dt);
    this.syncMonsters(dt);
    this.syncStructures(dt);
    this.syncProjectiles(dt);
    this.syncAreas();

    // Auren
    for (const a of this.auras) {
      if (!a.owner.alive) continue;
      if (Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2;
        this.particles.emit(a.owner.x + Math.cos(ang) * 0.9, g.groundAt(a.owner.x, a.owner.z) + 0.3 + Math.random(), a.owner.z + Math.sin(ang) * 0.9, 0, 1.5, 0, a.color, 0.4, 0.6, 0);
      }
    }
    this.auras = this.auras.filter((a) => a.until > w.t);

    // Turmreichweite für den Spieler
    const p = w.player;
    this.indicators.turretRange.visible = false;
    if (p.alive) {
      for (const s of w.structures) {
        if (!s.alive || s.kind !== "turret" || s.team === p.team) continue;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < s.stats.range + 5) {
          const tr = this.indicators.turretRange;
          tr.visible = true;
          tr.position.set(s.x, g.groundAt(s.x, s.z) + 0.2, s.z);
          tr.scale.setScalar(s.stats.range + 0.5);
          (tr.material as THREE.MeshBasicMaterial).opacity = s.target === p ? 0.95 : 0.45;
          break;
        }
      }
    }

    this.ground.update(dt);
    this.particles.update(dt);
    void camera;
  }

  private syncMinions(dt: number) {
    const w = this.world;
    const g = w.grid;
    const counts: Record<string, number> = {};
    for (const k of Object.keys(this.minionMesh)) counts[k] = 0;
    for (const m of w.minions) {
      const dead = !m.alive;
      if (dead && w.t - m.diedAt > 0.6) continue;
      if (!dead && !this.seen(m)) continue;
      if (dead && !m.vis[this.playerTeam] && m.team !== this.playerTeam) continue;
      const key = `${m.team}${m.mtype}`;
      const im = this.minionMesh[key];
      const i = counts[key];
      if (i >= MINION_CAP[m.mtype]) continue;
      counts[key] = i + 1;
      if (m.anim.moving) m.anim.walk += dt * 9;
      let y = g.groundAt(m.x, m.z) + (m.anim.moving ? Math.abs(Math.sin(m.anim.walk)) * 0.12 : 0);
      let s = 1;
      if (dead) {
        const k = (w.t - m.diedAt) / 0.6;
        s = 1 - k * 0.7;
        y -= k * 0.6;
      }
      if (w.t < m.knockUntil) y += Math.sin(((m.knockUntil - w.t) / 0.75) * Math.PI) * 1.2;
      const lunge = m.anim.atk > 0 ? Math.sin(m.anim.atk * Math.PI) * 0.25 : 0;
      const baron = w.t < m.baronUntil ? 1.15 : 1;
      this.tmpP.set(m.x + Math.sin(m.facing) * lunge, y, m.z + Math.cos(m.facing) * lunge);
      this.tmpQ.setFromAxisAngle(this.up, m.facing);
      this.tmpS.set(s * baron, s * baron, s * baron);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      im.setMatrixAt(i, this.tmpM);
    }
    for (const [k, im] of Object.entries(this.minionMesh)) {
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }

  private syncMonsters(dt: number) {
    const w = this.world;
    const g = w.grid;
    const alive = new Set<number>();
    for (const m of w.monsters) {
      if (!m.alive && w.t - m.diedAt > 1) continue;
      alive.add(m.id);
      let v = this.mons.get(m.id);
      if (!v) {
        const built = buildMonster(m.mkind, m.big);
        v = { root: built.root, glow: built.glow, unit: m, facing: m.facing };
        this.scene.add(v.root);
        this.mons.set(m.id, v);
      }
      v.root.visible = this.seen(m);
      if (!v.root.visible) continue;
      v.facing = angleLerp(v.facing, m.facing, Math.min(1, dt * 6));
      v.root.rotation.y = v.facing;
      let y = g.groundAt(m.x, m.z);
      if (!m.alive) {
        const k = (w.t - m.diedAt) / 1;
        y -= k * 1.5;
        v.root.rotation.z = k * 0.6;
      } else {
        y += Math.sin(this.time * 2.2 + m.id) * 0.05;
        if (m.mkind === "dragon") y += 0.6 + Math.sin(this.time * 2) * 0.3;
        if (m.anim.atk > 0) y += Math.sin(m.anim.atk * Math.PI) * 0.25;
      }
      v.root.position.set(m.x, y, m.z);
    }
    for (const [id, v] of this.mons) {
      if (!alive.has(id)) {
        this.scene.remove(v.root);
        this.mons.delete(id);
      }
    }
  }

  private syncStructures(dt: number) {
    const w = this.world;
    const g = w.grid;
    const p = w.player;
    for (const v of this.structs.values()) {
      const s = v.unit;
      const m = v.model;
      const alive = s.alive;
      const team = s.team === 1 ? 1 : 0;
      m.top.visible = alive;
      m.rubble.visible = !alive;
      if (!alive) {
        if (v.beam) v.beam.visible = false;
        if (v.halo) v.halo.visible = false;
        if (m.outline) m.outline.visible = false;
        continue;
      }
      const atk = s.anim.atk;
      const bob = Math.sin(this.time * 1.6 + s.id) * (s.kind === "turret" ? 0.1 : 0.2);
      m.crystal.position.y = m.crystalY + bob;
      m.crystal.rotation.y += dt * (s.kind === "nexus" ? 0.5 : s.kind === "inhib" ? 0.6 : 1.4);
      if (m.shards) m.shards.rotation.y -= dt * 0.9;

      if (s.kind === "turret") {
        // Aufleuchten beim Schuss, Rückstoß des Stabs
        const flash = atk;
        const cs = (m.crystal.userData.base ??= m.crystal.scale.clone()) as THREE.Vector3;
        m.crystal.scale.set(cs.x * (1 + flash * 0.45), cs.y * (1 + flash * 0.3), cs.z * (1 + flash * 0.45));
        m.glow.scale.setScalar(3.6 * (1 + flash * 1.3) * (s.target ? 1 + Math.sin(this.time * 9) * 0.08 : 1));
        (m.glow.material as THREE.SpriteMaterial).opacity = s.invulnerable ? 0.55 : 0.85;
        if (m.staff) m.staff.rotation.x = -0.14 * Math.sin(flash * Math.PI);
        m.crystal.getWorldPosition(this.tmpA);
        if (atk > v.lastAtk + 0.3) {
          this.particles.burst(this.tmpA.x, this.tmpA.y, this.tmpA.z, TEAM_GLOW[team], 14, 4, 0.7, 0.35, 0);
        }
        // kleine Funken am Kristall
        if (Math.random() < 0.06 && this.seenAt(s.x, s.z)) {
          this.particles.emit(this.tmpA.x + (Math.random() - 0.5) * 0.8, this.tmpA.y - 0.3, this.tmpA.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4, new THREE.Color(team === 0 ? 0xa0e8ff : 0xffb070), 0.35, 1.2, 0);
        }
        // Zielstrahl vom Kristall zum Ziel
        const tg = s.target;
        const showBeam = !!tg && tg.alive && (tg.team === this.playerTeam || tg.vis[this.playerTeam]);
        if (showBeam) {
          if (!v.beam) {
            const mk = (opacity: number) => {
              const b = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team], transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
              b.renderOrder = 5;
              this.scene.add(b);
              return b;
            };
            v.beam = mk(0.6);
            v.halo = mk(0.2);
          }
          this.tmpB.set(tg.x, g.groundAt(tg.x, tg.z) + Math.min(1.4, tg.height * 0.55), tg.z);
          const champ = tg instanceof Champion;
          const core = (champ ? 0.07 : 0.045) * (1 + atk * 1.5);
          this.placeBeam(v.beam, this.tmpA, this.tmpB, core);
          this.placeBeam(v.halo!, this.tmpA, this.tmpB, core * 4);
          const pulse = 0.75 + Math.sin(this.time * 12) * 0.25;
          (v.beam.material as THREE.MeshBasicMaterial).opacity = (champ ? 0.75 : 0.5) * pulse + atk * 0.25;
          (v.halo!.material as THREE.MeshBasicMaterial).opacity = (champ ? 0.22 : 0.12) + atk * 0.2;
          v.beam.visible = true;
          v.halo!.visible = true;
        } else if (v.beam) {
          v.beam.visible = false;
          v.halo!.visible = false;
        }
      } else {
        const pulse = 1 + Math.sin(this.time * 2.2 + s.id) * 0.08;
        const base = s.kind === "inhib" ? 7 : 11;
        m.glow.scale.setScalar(base * pulse * (s.invulnerable ? 0.85 : 1));
        if (s.kind === "inhib" && Math.random() < 0.12 && this.seenAt(s.x, s.z)) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.6 + Math.random() * 1.2;
          const y = g.groundAt(s.x, s.z) + 1.2;
          this.particles.emit(s.x + Math.cos(a) * r, y, s.z + Math.sin(a) * r, 0, 1.6 + Math.random(), 0, new THREE.Color(TEAM_GLOW[team]), 0.4, 1.4, 0);
        }
      }
      v.lastAtk = atk;

      // Roter Umriss: wenn du das Gebäude angreifst oder der Turm dich anvisiert
      if (m.outline) {
        const enemy = s.team !== this.playerTeam;
        const targeted = p.alive && ((p.order.type === "attack" && p.order.target === s) || s.target === p);
        m.outline.visible = enemy && targeted;
      }
    }

    // Feuer in den Schalen
    for (const b of this.braziers) {
      const flicker = 1 + Math.sin(this.time * 13 + b.phase) * 0.08 + Math.sin(this.time * 7.3 + b.phase) * 0.06;
      b.glow.scale.setScalar(4 * flicker);
      b.flame.scale.set(1 + Math.sin(this.time * 9 + b.phase) * 0.08, flicker * (1 + Math.sin(this.time * 17 + b.phase) * 0.12), 1 + Math.cos(this.time * 11 + b.phase) * 0.08);
      b.flame.rotation.y += dt * 2;
      if (!this.seenAt(b.x, b.z)) continue;
      if (Math.random() < 0.8) {
        const c = this.fireCol[(Math.random() * 3) | 0];
        this.particles.emit(b.x + (Math.random() - 0.5) * 0.8, b.y + 0.4, b.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.4, 2.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.4, c, 1.0, 0.6, 0.5);
      }
    }
  }

  /** Spielerteam sieht diese Stelle gerade (für Effekte). */
  private seenAt(x: number, z: number) {
    return this.fogVisibleAt(x, z);
  }

  private placeBeam(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.scale.set(radius, len, radius);
    mesh.quaternion.setFromUnitVectors(this.up, this.tmpP.set(dx / len, dy / len, dz / len));
  }

  private makeProj(p: Projectile): THREE.Object3D {
    const team = p.team === 0 || p.team === 1 ? p.team : 0;
    const G = this.projGeo;
    const basic = (c: number) => new THREE.MeshBasicMaterial({ color: c });
    let o: THREE.Object3D;
    switch (p.visual) {
      case "arrow": {
        o = new THREE.Mesh(G.arrow, basic(p.color));
        break;
      }
      case "bigarrow": {
        const grp = new THREE.Group();
        const m = new THREE.Mesh(G.big, basic(0xcff6ff));
        m.scale.set(0.35, 0.35, 2.2);
        grp.add(m);
        grp.add(glowSprite(0x7fe0ff, 4, 0.9));
        o = grp;
        break;
      }
      case "fireball": {
        const grp = new THREE.Group();
        const m = new THREE.Mesh(G.sphere, basic(0xffc060));
        m.scale.setScalar(0.38);
        grp.add(m);
        grp.add(glowSprite(0xff6a10, 2.6, 0.95));
        o = grp;
        break;
      }
      case "dagger": {
        const m = new THREE.Mesh(G.cone, basic(0xe8d8ff));
        m.rotation.x = Math.PI / 2;
        const grp = new THREE.Group();
        grp.add(m);
        grp.add(glowSprite(0xb061ff, 1.2, 0.7));
        o = grp;
        break;
      }
      case "hook": {
        const grp = new THREE.Group();
        const m = new THREE.Mesh(G.sphere, basic(0xb0ff90));
        m.scale.setScalar(0.3);
        grp.add(m);
        grp.add(glowSprite(0x9fff70, 1.6, 0.8));
        o = grp;
        const chain = new THREE.Mesh(G.chain, basic(0x8a9a8a));
        this.scene.add(chain);
        this.hookChains.set(p.id, chain);
        break;
      }
      case "turret": {
        const grp = new THREE.Group();
        const outer = new THREE.Mesh(G.big, new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team], transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        outer.scale.set(0.42, 0.42, 1.5);
        grp.add(outer);
        const core = new THREE.Mesh(G.big, basic(team === 0 ? 0xe8f8ff : 0xfff0d0));
        core.scale.set(0.2, 0.2, 0.95);
        grp.add(core);
        grp.add(glowSprite(TEAM_GLOW[team], 3.2, 1));
        o = grp;
        break;
      }
      case "bolt": {
        const grp = new THREE.Group();
        const m = new THREE.Mesh(G.sphere, basic(0xffd080));
        m.scale.setScalar(0.18);
        grp.add(m);
        grp.add(glowSprite(p.color, 1.2, 0.9));
        o = grp;
        break;
      }
      case "caster": {
        const m = new THREE.Mesh(G.sphere, basic(p.color));
        m.scale.setScalar(0.14);
        o = m;
        break;
      }
      case "siege": {
        const m = new THREE.Mesh(G.sphere, basic(0x403a36));
        m.scale.setScalar(0.25);
        o = m;
        break;
      }
      default: {
        const grp = new THREE.Group();
        const m = new THREE.Mesh(G.sphere, basic(p.color));
        m.scale.setScalar(p.visual === "monster" ? 0.25 : 0.45);
        grp.add(m);
        grp.add(glowSprite(p.color, 2, 0.8));
        o = grp;
      }
    }
    o.userData.visual = p.visual;
    o.userData.team = team;
    this.scene.add(o);
    return o;
  }

  private syncProjectiles(_dt: number) {
    const w = this.world;
    const g = w.grid;
    const live = new Set<number>();
    for (const p of w.projectiles) {
      live.add(p.id);
      let o = this.projs.get(p.id);
      if (!o) {
        o = this.makeProj(p);
        this.projs.set(p.id, o);
      }
      const owner = p.owner;
      const visible = p.team === this.playerTeam || p.team === 2 || owner.vis[this.playerTeam] || this.fogVisibleAt(p.x, p.z);
      o.visible = visible;
      const y = g.groundAt(p.x, p.z) + p.y;
      if (p.visual === "turret") {
        const prev = o.userData.prev as THREE.Vector3 | undefined;
        o.position.set(p.x, y, p.z);
        if (prev && prev.distanceToSquared(o.position) > 1e-4) o.lookAt(o.position.clone().multiplyScalar(2).sub(prev));
        o.userData.prev = o.position.clone();
      } else {
        o.position.set(p.x, y, p.z);
        o.rotation.y = Math.atan2(p.dx, p.dz);
      }
      if (visible) {
        if (p.visual === "fireball" && Math.random() < 0.9) this.particles.emit(p.x, y, p.z, (Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1.5, new THREE.Color(0xff7a20), 0.7, 0.35, 0);
        if (p.visual === "turret") {
          const tc = new THREE.Color(TEAM_GLOW[p.team === 1 ? 1 : 0]);
          for (let k = 0; k < 2; k++) this.particles.emit(p.x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, p.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, tc, 0.75, 0.32, 0);
        }
        if (p.visual === "bigarrow") this.particles.emit(p.x, y, p.z, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2, new THREE.Color(0xbff0ff), 0.8, 0.5, 0);
        if (p.visual === "dragon" || p.visual === "baron") this.particles.emit(p.x, y, p.z, 0, 0.3, 0, new THREE.Color(p.color), 0.8, 0.3, 0);
      }
      const chain = this.hookChains.get(p.id);
      if (chain) {
        const ax = owner.x;
        const az = owner.z;
        const ay = g.groundAt(ax, az) + 1.4;
        const dx = p.x - ax;
        const dz = p.z - az;
        const dy = y - ay;
        const len = Math.hypot(dx, dy, dz);
        chain.position.set((p.x + ax) / 2, (y + ay) / 2, (p.z + az) / 2);
        chain.scale.set(1, len, 1);
        chain.quaternion.setFromUnitVectors(this.up, new THREE.Vector3(dx, dy, dz).normalize());
        chain.visible = visible;
      }
    }
    for (const [id, o] of this.projs) {
      if (live.has(id)) continue;
      this.scene.remove(o);
      this.projs.delete(id);
      const chain = this.hookChains.get(id);
      if (chain) {
        this.scene.remove(chain);
        this.hookChains.delete(id);
      }
      // Einschlag
      if (o.visible) {
        if (o.userData.visual === "turret") {
          const tcol = TEAM_GLOW[o.userData.team === 1 ? 1 : 0];
          this.particles.burst(o.position.x, o.position.y, o.position.z, tcol, 18, 6, 0.8, 0.35);
          this.particles.burst(o.position.x, o.position.y, o.position.z, 0xffffff, 6, 3, 0.6, 0.2);
          this.ground.ring(o.position.x, this.world.grid.groundAt(o.position.x, o.position.z), o.position.z, 0.2, 1.6, tcol, 0.3, 0.9);
        } else this.particles.burst(o.position.x, o.position.y, o.position.z, 0xffe8c0, 4, 3, 0.4, 0.25);
      }
    }
  }

  fogVisibleAt(x: number, z: number) {
    const d = this.fog.data;
    const i = Math.min(127, Math.max(0, Math.floor((z / 200) * 128))) * 128 + Math.min(127, Math.max(0, Math.floor((x / 200) * 128)));
    return d[i] > 120;
  }

  private syncAreas() {
    const w = this.world;
    const g = w.grid;
    const live = new Set<number>();
    for (const a of w.areas) {
      live.add(a.id);
      let v = this.areas.get(a.id);
      if (!v) v = this.makeArea(a);
      const k = Math.min(1, (w.t - a.t0) / Math.max(0.01, a.delay));
      const y = g.groundAt(a.x, a.z) + 0.15;
      v.ring.position.set(a.x, y, a.z);
      v.ring.scale.setScalar(a.radius);
      v.disc.position.set(a.x, y, a.z);
      v.disc.scale.setScalar(a.radius * k);
      const show = a.team === this.playerTeam || this.fogVisibleAt(a.x, a.z);
      v.ring.visible = show;
      v.disc.visible = show;
      if (v.meteor) {
        v.meteor.visible = show;
        v.meteor.position.set(a.x - 6 * (1 - k), y + 18 * (1 - k), a.z + 4 * (1 - k));
        if (show && Math.random() < 0.9) this.particles.emit(v.meteor.position.x, v.meteor.position.y, v.meteor.position.z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, new THREE.Color(0xff6a10), 1.5, 0.5, 0);
      }
      if (a.visual === "pillar" && show && Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * a.radius;
        this.particles.emit(a.x + Math.cos(ang) * r, y, a.z + Math.sin(ang) * r, 0, 2 + Math.random() * 2, 0, new THREE.Color(0xff8a30), 0.5, 0.4, 0);
      }
    }
    for (const [id, v] of this.areas) {
      if (live.has(id)) continue;
      this.scene.remove(v.ring, v.disc);
      if (v.meteor) this.scene.remove(v.meteor);
      this.areas.delete(id);
    }
  }

  private makeArea(a: Area) {
    const mk = (geo: THREE.BufferGeometry, opacity: number) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 4;
      this.scene.add(m);
      return m;
    };
    const ring = mk(new THREE.RingGeometry(0.93, 1, 48), 0.9);
    const disc = mk(new THREE.CircleGeometry(1, 40), 0.3);
    let meteor: THREE.Object3D | null = null;
    if (a.visual === "meteor") {
      const grp = new THREE.Group();
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      grp.add(m);
      grp.add(glowSprite(0xff5010, 7, 1));
      this.scene.add(grp);
      meteor = grp;
    }
    const v = { ring, disc, meteor };
    this.areas.set(a.id, v);
    return v;
  }

  private handleFx() {
    const w = this.world;
    const g = w.grid;
    const P = this.particles;
    for (const f of w.fxQueue) {
      const y = g.groundAt(f.x, f.z);
      if (f.owner && f.owner.team !== this.playerTeam && !f.owner.vis[this.playerTeam] && f.type !== "death") continue;
      if (!f.owner && !this.fogVisibleAt(f.x, f.z) && f.type !== "explode") continue;
      const col = f.color ?? 0xffffff;
      switch (f.type) {
        case "spin":
          this.ground.ring(f.x, y, f.z, 0.5, f.r ?? 4, col, 0.35, 0.9);
          P.ring(f.x, y + 1, f.z, (f.r ?? 4) * 0.8, col, 26, 0.6, 0.4, 6);
          break;
        case "shout":
          this.ground.ring(f.x, y, f.z, 0.5, f.r ?? 3, col, 0.5, 0.8);
          P.burst(f.x, y + 1.2, f.z, col, 14, 3, 0.5, 0.6, 0);
          break;
        case "slam":
          this.ground.ring(f.x, y, f.z, 0.3, f.r ?? 4, col, 0.45, 1);
          this.ground.ring(f.x, y, f.z, 0.3, (f.r ?? 4) * 0.8, col, 0.35, 0.4, true);
          P.ring(f.x, y + 0.3, f.z, (f.r ?? 4) * 0.5, 0xd8c8a0, 30, 0.9, 0.6, 6);
          break;
        case "burst":
          P.burst(f.x, y + 1.2, f.z, col, 24, 6, 0.7, 0.5);
          this.ground.ring(f.x, y, f.z, 0.3, f.r ?? 2, col, 0.3, 0.7);
          break;
        case "aura":
          if (f.owner) this.auras.push({ owner: f.owner, until: w.t + (f.dur ?? 3), color: new THREE.Color(col) });
          break;
        case "blink":
          P.burst(f.x, y + 1.2, f.z, col, 20, 4, 0.6, 0.45, 0);
          break;
        case "heal":
          for (let i = 0; i < 20; i++) P.emit(f.x + (Math.random() - 0.5) * 1.6, y + Math.random(), f.z + (Math.random() - 0.5) * 1.6, 0, 2 + Math.random() * 2, 0, new THREE.Color(0x7dff8a), 0.6, 0.8, 0);
          this.ground.ring(f.x, y, f.z, 0.5, 2, 0x7dff8a, 0.6, 0.8);
          break;
        case "levelup":
          for (let i = 0; i < 30; i++) {
            const a = (i / 30) * Math.PI * 4;
            P.emit(f.x + Math.cos(a) * 1.1, y + (i / 30) * 2.5, f.z + Math.sin(a) * 1.1, 0, 1.5, 0, new THREE.Color(0xffd860), 0.55, 0.9, 0);
          }
          this.ground.ring(f.x, y, f.z, 0.4, 2.2, 0xffd860, 0.7, 0.9);
          break;
        case "recall":
          this.ground.ring(f.x, y, f.z, 1.5, 1.6, 0x6fc8ff, f.dur ?? 6, 0.6);
          break;
        case "respawn":
          this.ground.ring(f.x, y, f.z, 0.3, 3, 0x9fe0ff, 0.8, 0.9);
          P.burst(f.x, y + 1, f.z, 0x9fe0ff, 30, 5, 0.6, 0.7, 0);
          break;
        case "smite":
          for (let i = 0; i < 18; i++) P.emit(f.x, y + i * 0.6, f.z, (Math.random() - 0.5) * 0.4, -2, (Math.random() - 0.5) * 0.4, new THREE.Color(0xffe060), 1.2, 0.35, 0);
          P.burst(f.x, y + 1, f.z, 0xffe060, 24, 7, 0.8, 0.5);
          break;
        case "explode":
          this.ground.ring(f.x, y, f.z, 0.3, f.r ?? 3, col, f.big ? 0.7 : 0.45, 1);
          this.ground.ring(f.x, y, f.z, 0.3, (f.r ?? 3) * 0.9, col, f.big ? 0.6 : 0.35, 0.5, true);
          P.burst(f.x, y + 0.8, f.z, col, f.big ? 70 : 32, f.big ? 12 : 7, f.big ? 1.4 : 0.8, f.big ? 0.9 : 0.55);
          if (f.big) P.burst(f.x, y + 0.5, f.z, 0x4a3a30, 40, 6, 1.6, 1.2, -2);
          break;
        case "hit":
          P.burst(f.x, y + 1, f.z, col, 5, 3, 0.35, 0.22);
          break;
        case "death":
          if (f.big) {
            P.burst(f.x, y + 3, f.z, 0xffc080, 90, 14, 1.6, 1.2);
            P.burst(f.x, y + 2, f.z, 0x555555, 60, 6, 2.2, 1.8, -1);
            this.ground.ring(f.x, y, f.z, 1, 10, 0xffa060, 0.8, 1);
          } else if (f.owner instanceof Champion) {
            P.burst(f.x, y + 1, f.z, 0xffffff, 18, 4, 0.5, 0.6);
          } else if (f.owner instanceof Monster && f.owner.big) {
            P.burst(f.x, y + 1.5, f.z, 0xffe0a0, 30, 6, 0.8, 0.7);
          }
          break;
        case "shield":
          break;
        case "gold":
          break;
      }
    }
    w.fxQueue.length = 0;
  }

  /** Bildschirmposition (Pixel) eines Weltpunkts. */
  project(camera: THREE.Camera, x: number, y: number, z: number, w: number, h: number): V2 & { on: boolean } {
    this.tmpP.set(x, y, z).project(camera);
    return { x: (this.tmpP.x * 0.5 + 0.5) * w, z: (-this.tmpP.y * 0.5 + 0.5) * h, on: this.tmpP.z < 1 };
  }

  isUnitShown(u: Unit) {
    if (u instanceof Champion) return this.champs.get(u.id)?.model.root.visible ?? false;
    if (u instanceof Minion) return u.alive && this.seen(u);
    if (u instanceof Monster) return u.alive && this.seen(u);
    if (u instanceof Structure) return true;
    return false;
  }

  champColor(c: Champion) {
    return c.isPlayer ? 0x6dff5a : TEAM_COLOR[c.team === this.playerTeam ? 0 : 1];
  }
}
