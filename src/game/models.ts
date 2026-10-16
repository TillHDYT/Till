import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Look } from "./champions";
import { CHAMP_SIZE, MONSTER_SIZE, type CampKind } from "./mapdata";
import { colored, mat4 } from "./terrain";
import detailUrl from "../assets/detail.jpg";
import bannerRedUrl from "../assets/banner_red.png";
import bannerBlueUrl from "../assets/banner_blue.png";
import emblemUrl from "../assets/emblem.jpg";
import guardianUrl from "../assets/guardian.glb";
import guardianBlueUrl from "../assets/guardian_blue.jpg";
import nexusUrl from "../assets/nexus.glb";
import startBaseUrl from "../assets/startbase.glb";
import assassinUrl from "../assets/models/Assassine.glb";
import assassinDeathUrl from "../assets/models/Assassine_Death.glb";
import assassinIdleUrl from "../assets/models/Assassine_Idle.glb";
import assassinAttackUrl from "../assets/models/Assassine_Attack.glb";
import tankUrl from "../assets/models/Tank.glb";
import tankIdleUrl from "../assets/models/Tank_Idle.glb";
import tankAttackUrl from "../assets/models/Tank_Attack.glb";
import tankDeathUrl from "../assets/models/Tank_Death.glb";
import warrokUrl from "../assets/models/Warrok.glb";
import warrokIdleUrl from "../assets/models/Warrok_Idle.glb";
import warrokAttack1Url from "../assets/models/Warrok_Attack1.glb";
import warrokAttack2Url from "../assets/models/Warrok_Attack2.glb";
import warrokDeathUrl from "../assets/models/Warrok_Death.glb";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const texCache = new Map<string, THREE.Texture>();
function tex(url: string, repeat = 1, srgb = true) {
  const key = url + repeat;
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

/** Fahnenbanner (rot oder blau) mit goldenem Emblem. */
export function bannerMesh(team: 0 | 1, w: number, h: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ map: tex(team === 0 ? bannerBlueUrl : bannerRedUrl), side: THREE.DoubleSide }),
  );
  m.castShadow = true;
  return m;
}
import type { MinionType } from "./units";

export const TEAM_COLOR = [0x3f9bff, 0xff4a3a];
export const TEAM_GLOW = [0x5cc8ff, 0xff3a2a];

const vc = new THREE.MeshLambertMaterial({ vertexColors: true });

function merge(parts: THREE.BufferGeometry[]) {
  return mergeGeometries(parts)!;
}

function mesh(parts: THREE.BufferGeometry[], material: THREE.Material = vc) {
  const m = new THREE.Mesh(merge(parts), material);
  m.castShadow = true;
  return m;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color: number, size: number, opacity = 0.8) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  s.scale.set(size, size, size);
  return s;
}

// ---------------- Runde Grundformen für Figuren (keine Klötze) ----------------

const rbox = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.34);
const cyl = (rt: number, rb: number, h: number) => new THREE.CylinderGeometry(rt, rb, h, 16);
const ball = (r: number) => new THREE.SphereGeometry(r, 20, 14);
const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 14);

/** Unregelmäßiger, glatter Steinklumpen. */
function lump(r: number) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 3);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.13 * Math.sin(v.x * 4.1 / r + v.y * 2.3 / r) * Math.cos(v.z * 3.7 / r - v.y * 1.9 / r) + 0.06 * Math.sin(v.y * 9 / r + v.x * 5 / r);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------- Champions ----------------

export type ChampModel = {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  ring: THREE.Mesh;
  glow: THREE.Object3D | null;
  /** nur bei Champions aus einem 3D-Modell mit Skelett */
  rig?: ChampRig;
};

// ---------------- Champions aus 3D-Modellen (Mixamo, mit Skelett und Laufanimation) ----------------

/** Champions mit eigenem 3D-Modell; alle anderen bleiben gebaute Figuren. */
const CHAMP_MODELS: Record<string, string> = { kira: assassinUrl, thorne: tankUrl };
/** Zusätzliche Animationen (eigene GLBs mit gleichem Skelett, siehe assets-src/champion_anim.py). */
type AnimSrc = { url: string; file: string };
const CHAMP_ANIMS: Record<string, { idle?: AnimSrc; attack?: AnimSrc; attack2?: AnimSrc; death?: AnimSrc }> = {
  kira: {
    idle: { url: assassinIdleUrl, file: "src/assets/models/Assassine_Idle.glb (aus Standing Idle.fbx)" },
    attack: { url: assassinAttackUrl, file: "src/assets/models/Assassine_Attack.glb (aus Boxing.fbx)" },
    death: { url: assassinDeathUrl, file: "src/assets/models/Assassine_Death.glb (aus Standing React Death Right.fbx)" },
  },
  thorne: {
    idle: { url: tankIdleUrl, file: "src/assets/models/Tank_Idle.glb (aus Tank Stehend Animation.fbx)" },
    attack: { url: tankAttackUrl, file: "src/assets/models/Tank_Attack.glb (aus Tank Schlag Animation.fbx)" },
    death: { url: tankDeathUrl, file: "src/assets/models/Tank_Death.glb (aus Tank Todes Animation.fbx)" },
  },
};
/** Dschungelmonster mit eigenem 3D-Modell (Schlüssel "monster:<Art>", nur das große Monster des Camps). */
const MONSTER_MODELS: Record<string, string> = { "monster:blue": warrokUrl };
CHAMP_ANIMS["monster:blue"] = {
  idle: { url: warrokIdleUrl, file: "src/assets/models/Warrok_Idle.glb (aus Jungle Monster Animation stehend.fbx)" },
  attack: { url: warrokAttack1Url, file: "src/assets/models/Warrok_Attack1.glb (aus Jungle Monster 1.SchlagAnimation.fbx)" },
  attack2: { url: warrokAttack2Url, file: "src/assets/models/Warrok_Attack2.glb (aus Jungle Monster 2.SchlagAnimation.fbx)" },
  death: { url: warrokDeathUrl, file: "src/assets/models/Warrok_Death.glb (aus Jungle Monster Sterbe Animation.fbx)" },
};
/** Höhe der Monster-Modelle im Spiel. */
// Warrok steht gebückt, daher größer als die Höhe in der Grundhaltung
const MONSTER_HEIGHT: Record<string, number> = { "monster:blue": 4.6 };
/** Laufgeschwindigkeit, bei der die Laufanimation in Originalgeschwindigkeit läuft (Grundtempo des Champions). */
const RUN_REF_SPEED: Record<string, number> = { kira: 7.2, thorne: 6.9, "monster:blue": 5 };

type RigAsset = {
  scene: THREE.Object3D;
  runRef: number;
  clip: THREE.AnimationClip;
  idle: THREE.AnimationClip | null;
  attack: THREE.AnimationClip | null;
  /** weitere Schlaganimationen (abwechselnd mit attack) */
  attack2: THREE.AnimationClip | null;
  death: THREE.AnimationClip | null;
  height: number;
  minY: number;
  rest: number[];
  noUv: boolean;
};

/** Exporte beginnen oft bei Bild 1 statt bei 0: Zyklus auf 0 schieben, sonst stockt die Schleife kurz. */
function clipFromZero(clip: THREE.AnimationClip) {
  const start = Math.min(...clip.tracks.map((t) => t.times[0]));
  if (start > 0) {
    // neue Arrays: der Loader teilt die Zeit-Arrays zwischen Spuren, shift() würde sie mehrfach verschieben
    for (const t of clip.tracks) t.times = Float32Array.from(t.times, (v) => v - start);
    clip.resetDuration();
  }
  return clip;
}

/** Lädt eine Zusatzanimation; fehlt sie, wird genau die Datei gemeldet und nichts ersetzt. */
async function loadExtraClip(src: AnimSrc | undefined, id: string, what: string) {
  if (!src) return null;
  try {
    const gltf = await loadGlbOffline(src.url);
    const clip = gltf.animations[0];
    if (!clip) throw new Error("keine Animation in der Datei");
    return clipFromZero(clip);
  } catch (err) {
    console.error(`${what}-Animation für Champion ${id} konnte nicht geladen werden: ${src.file}`, err);
    return null;
  }
}
const rigAssets = new Map<string, RigAsset>();

export type ChampRig = {
  mixer: THREE.AnimationMixer;
  /** Laufanimation, Zeit darin und Tempo (runRef: Laufgeschwindigkeit bei Originaltempo des Clips) */
  action: THREE.AnimationAction;
  runRef: number;
  t: number;
  speed: number;
  rest: number[];
  dur: number;
  model: THREE.Object3D;
  /** Stehanimation (Schleife), Zeit darin und Anteil des Laufens (0 = steht, 1 = läuft) */
  idle: THREE.AnimationAction | null;
  idleT: number;
  runW: number;
  /** Schlaganimation: Gewicht (blendet ein und aus) und Zeit im Clip */
  attack: THREE.AnimationAction | null;
  atkW: number;
  atkTime: number;
  /** alle Schlaganimationen; beim Wechsel blendet der vorige Schlag weich aus (prev) */
  attacks: THREE.AnimationAction[];
  prev: { action: THREE.AnimationAction; time: number; w: number } | null;
  /** Monster: selbst geführter Schlag (Spiellogik meldet nur den Angriff), Zeit und Dauer in Sekunden */
  selfT: number;
  selfDur: number;
  lastAtk: number;
  atkRepeat: number;
  /** Sterbeanimation (falls vorhanden) und Zeit seit dem Tod */
  death: THREE.AnimationAction | null;
  deathT: number;
};

/** Lädt die 3D-Modelle der Champions; schlägt eines fehl, bleibt für ihn die gebaute Figur. */
export async function loadChampionModels() {
  await Promise.all(
    Object.entries({ ...CHAMP_MODELS, ...MONSTER_MODELS }).map(async ([id, url]) => {
      if (rigAssets.has(id)) return;
      try {
        const gltf = await loadGlbOffline(url);
        const found = gltf.animations.find((a) => a.name === "Run") ?? gltf.animations[0];
        if (!found) throw new Error("keine Animation im Modell");
        const clip = clipFromZero(found);
        const anims = CHAMP_ANIMS[id] ?? {};
        const [idle, attack, attack2, death] = await Promise.all([
          loadExtraClip(anims.idle, id, "Steh"),
          loadExtraClip(anims.attack, id, "Schlag"),
          loadExtraClip(anims.attack2, id, "Zweite Schlag"),
          loadExtraClip(anims.death, id, "Sterbe"),
        ]);
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        let noUv = false;
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && !(o as THREE.Mesh).geometry.getAttribute("uv")) noUv = true;
        });
        if (noUv) console.warn(`Modell für Champion ${id} hat keine UV-Koordinaten; die Texturen können nicht aufgelegt werden, nutze Teamfarben.`);
        // Ruhehaltungen an einer Kopie suchen, damit das geladene Modell unverändert bleibt
        rigAssets.set(id, { scene: gltf.scene, runRef: RUN_REF_SPEED[id] ?? 7, clip, idle, attack, attack2, death, height: box.max.y - box.min.y, minY: box.min.y, rest: restTimes(cloneSkinned(gltf.scene), clip), noUv });
      } catch (err) {
        console.error(`Modell für Champion ${id} konnte nicht geladen werden, nutze gebaute Figur:`, err);
      }
    }),
  );
}

/** Zeitpunkte im Laufzyklus, an denen die Füße am dichtesten beieinander sind: dort wirkt das Stehenbleiben ruhig. */
function restTimes(scene: THREE.Object3D, clip: THREE.AnimationClip) {
  const footL = scene.getObjectByName("mixamorigLeftFoot") ?? scene.getObjectByName("mixamorig:LeftFoot");
  const footR = scene.getObjectByName("mixamorigRightFoot") ?? scene.getObjectByName("mixamorig:RightFoot");
  if (!footL || !footR) return [0];
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const N = 48;
  const gaps: number[] = [];
  for (let i = 0; i < N; i++) {
    action.time = (i / N) * clip.duration;
    mixer.update(0);
    scene.updateMatrixWorld(true);
    footL.getWorldPosition(a);
    footR.getWorldPosition(b);
    gaps.push(Math.hypot(a.x - b.x, a.z - b.z));
  }
  action.stop();
  mixer.uncacheRoot(scene);
  const minima: number[] = [];
  for (let i = 0; i < N; i++) {
    if (gaps[i] <= gaps[(i + N - 1) % N] && gaps[i] <= gaps[(i + 1) % N]) minima.push((i / N) * clip.duration);
  }
  return minima.length ? minima : [0];
}

/**
 * Mischt die Animationen eines Champions mit Skelett:
 * - Stehen: Idle-Schleife; Laufen: Laufzyklus (Tempo folgt der Laufgeschwindigkeit), weich überblendet.
 * - Schlag: `swing` ist der Fortschritt 0..1 des Schlags aus der Spiellogik (World.updateSwing). Die Zeit im Clip
 *   folgt direkt diesem Fortschritt, darum sitzt der sichtbare Treffer genau auf dem Schaden, auch bei höherem
 *   Angriffstempo. Solange der Schlag läuft, liegt er über Stehen und Laufen; danach blendet er aus.
 * - Tod: Sterbeanimation einmal abspielen und in der letzten Haltung liegen bleiben.
 */
export function updateRig(rig: ChampRig, moving: boolean, speed: number, dt: number, swing = -1, dead = false) {
  if (dead && rig.death) {
    rig.deathT += dt;
    rig.death.time = Math.min(rig.deathT, rig.death.getClip().duration);
    rig.atkW = 0;
    setRigWeights(rig, 0, 0, 0, 1);
    rig.mixer.update(0);
    return;
  }
  rig.deathT = 0;
  const target = moving ? Math.max(0.75, Math.min(1.4, (speed || rig.runRef) / rig.runRef)) : 0;
  rig.speed += (target - rig.speed) * Math.min(1, dt * (moving ? 10 : 7));
  if (rig.idle) {
    rig.runW += ((moving ? 1 : 0) - rig.runW) * Math.min(1, dt * 10);
    rig.t = (rig.t + dt * rig.speed) % rig.dur;
    rig.idleT = (rig.idleT + dt) % rig.idle.getClip().duration;
  } else if (moving || rig.speed > 0.2) {
    rig.t = (rig.t + dt * rig.speed) % rig.dur;
  } else {
    // ohne Stehanimation: nächste ruhige Haltung im Laufzyklus, nie rückwärts
    let ahead = rig.dur;
    for (const r of rig.rest) ahead = Math.min(ahead, (r - rig.t + rig.dur) % rig.dur);
    rig.t = (rig.t + Math.min(ahead, Math.max(dt * 0.12, ahead * Math.min(1, dt * 5)))) % rig.dur;
  }
  if (rig.attack) {
    if (swing >= 0) rig.atkTime = Math.min(1, swing) * rig.attack.getClip().duration;
    rig.atkW += ((swing >= 0 ? 1 : 0) - rig.atkW) * Math.min(1, dt * 14);
    if (rig.atkW < 0.001) rig.atkW = 0;
  }
  if (rig.prev) {
    // voriger Schlag (andere Animation) blendet in ~0,15 s aus, der neue übernimmt
    rig.prev.w = Math.max(0, rig.prev.w - dt * 7);
    if (rig.prev.w <= 0) rig.prev = null;
  }
  const prevW = rig.prev ? Math.min(rig.prev.w, 1 - rig.atkW) : 0;
  const base = Math.max(0, 1 - rig.atkW - prevW);
  const run = rig.idle ? rig.runW : 1;
  setRigWeights(rig, base * run, base * (1 - run), rig.atkW, 0);
  rig.mixer.update(0);
}

function setRigWeights(rig: ChampRig, run: number, idle: number, attack: number, death: number) {
  rig.action.time = rig.t;
  rig.action.setEffectiveWeight(run);
  if (rig.idle) {
    rig.idle.time = rig.idleT;
    rig.idle.setEffectiveWeight(idle);
  }
  for (const a of rig.attacks) {
    if (a === rig.attack) {
      a.time = rig.atkTime;
      a.setEffectiveWeight(attack);
    } else if (rig.prev && a === rig.prev.action && attack + death < 1) {
      a.time = rig.prev.time;
      a.setEffectiveWeight(Math.min(rig.prev.w, 1 - attack));
    } else a.setEffectiveWeight(0);
  }
  rig.death?.setEffectiveWeight(death);
}

/**
 * Schlag eines Monsters mit Modell: Die Spiellogik meldet nur, dass angegriffen wurde (anim.atk springt auf 1).
 * Dann spielt eine der Schlaganimationen, meist im Wechsel und nie lange dieselbe, mit weichem Übergang.
 * Gibt den Fortschritt 0..1 des laufenden Schlags zurück (für updateRig), -1 = keiner.
 */
export function monsterSwing(rig: ChampRig, atk: number, as: number, dt: number) {
  if (atk > rig.lastAtk + 0.3 && rig.attacks.length) {
    const cur = rig.attacks.indexOf(rig.attack!);
    // meist die andere Animation, gelegentlich dieselbe noch einmal, aber nie dreimal hintereinander
    const again = cur >= 0 && rig.atkRepeat < 1 && Math.random() < 0.25;
    const next = rig.attacks.length > 1 && !again ? (cur + 1) % rig.attacks.length : Math.max(0, cur);
    rig.atkRepeat = next === cur ? rig.atkRepeat + 1 : 0;
    if (rig.attack && rig.atkW > 0.05 && next !== cur) rig.prev = { action: rig.attack, time: rig.atkTime, w: rig.atkW };
    rig.attack = rig.attacks[next];
    rig.atkTime = 0;
    const d = rig.attack.getClip().duration;
    rig.selfDur = d / Math.max(1, d * as);
    rig.selfT = 0;
  }
  rig.lastAtk = atk;
  if (rig.selfT < 0) return -1;
  rig.selfT += dt;
  if (rig.selfT >= rig.selfDur) {
    rig.selfT = -1;
    return -1;
  }
  return rig.selfT / rig.selfDur;
}

/**
 * Ersatz-Materialien für Modelle ohne UV-Koordinaten (Texturen lassen sich dann nicht auflegen):
 * Körper in einem aufgehellten Ton der Champion-Farbe, Stoffstreifen in der Akzentfarbe.
 */
const lookMats = new Map<string, THREE.Material[]>();
function applyLookMaterials(model: THREE.Object3D, look: Look) {
  const key = `${look.body}-${look.accent}`;
  let mats = lookMats.get(key);
  if (!mats) {
    const body = new THREE.Color(look.body).lerp(new THREE.Color(0x8a8f9a), 0.45);
    const accent = new THREE.Color(look.accent).multiplyScalar(0.8);
    mats = [
      new THREE.MeshStandardMaterial({ color: body, roughness: 0.75, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    ];
    lookMats.set(key, mats);
  }
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    // der kleine, doppelseitige Teil (Stoffstreifen) bekommt die Akzentfarbe
    m.material = src.side === THREE.DoubleSide || src.alphaTest > 0 ? mats![1] : mats![0];
  });
}

function champRing(ringColor: number) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.12, 32),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 3;
  return ring;
}

function buildRigChampion(asset: RigAsset, look: Look, ringColor: number): ChampModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // gleiche Höhe wie die gebaute Figur (Lebensleiste, Treffer), Füße auf dem Boden
  const { model, rig } = buildRig(asset, 2.6 * look.bulk * CHAMP_SIZE);
  if (asset.noUv) applyLookMaterials(model, look);
  body.add(model);
  // leere Gliedmaßen-Gruppen: der bisherige Animationscode darf sie weiter drehen, ohne etwas zu verändern
  const limbs = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];
  body.add(...limbs);
  const ring = champRing(ringColor);
  root.add(ring);
  return { root, body, armL: limbs[0], armR: limbs[1], legL: limbs[2], legR: limbs[3], ring, glow: null, rig };
}

/** Modell mit Skelett auf die gewünschte Höhe bringen und alle Animationen anlegen. */
function buildRig(asset: RigAsset, height: number) {
  const model = cloneSkinned(asset.scene);
  const k = height / asset.height;
  model.scale.multiplyScalar(k);
  model.position.y = -asset.minY * k;
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const mixer = new THREE.AnimationMixer(model);
  const play = (clip: THREE.AnimationClip | null, weight: number) => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(weight);
    return a;
  };
  const action = play(asset.clip, 1)!;
  const idle = play(asset.idle, 0);
  const attack = play(asset.attack, 0);
  const attacks = [attack, play(asset.attack2, 0)].filter((a): a is THREE.AnimationAction => !!a);
  const death = play(asset.death, 0);
  const rig: ChampRig = {
    mixer, action, runRef: asset.runRef, t: asset.rest[0], speed: 0, rest: asset.rest, dur: asset.clip.duration, model,
    idle, idleT: 0, runW: 0, attack, atkW: 0, atkTime: 0, attacks, prev: null, selfT: -1, selfDur: 1, lastAtk: 0, atkRepeat: 0, death, deathT: 0,
  };
  updateRig(rig, false, 0, 0);
  return { model, rig };
}

/** Dschungelmonster aus einem 3D-Modell mit Skelett (falls vorhanden), sonst null. */
export function buildRigMonster(kind: CampKind, big: boolean): { root: THREE.Group; glow: null; rig: ChampRig } | null {
  const id = `monster:${kind}`;
  const asset = big ? rigAssets.get(id) : undefined;
  if (!asset) return null;
  const root = new THREE.Group();
  const { model, rig } = buildRig(asset, (MONSTER_HEIGHT[id] ?? 3) * MONSTER_SIZE);
  root.add(model);
  return { root, glow: null, rig };
}

export function buildChampion(look: Look, ringColor: number, id?: string): ChampModel {
  const asset = id ? rigAssets.get(id) : undefined;
  if (asset) return buildRigChampion(asset, look, ringColor);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const b = look.bulk;
  const robe = look.weapon === "staff";

  // Beine
  const mkLeg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.2 * side, 0.95, 0);
    g.add(
      mesh([
        colored(cyl(0.15, 0.12, 0.85), look.body, mat4(0, -0.45, 0)),
        colored(rbox(0.26, 0.16, 0.42), 0x3a2a1e, mat4(0, -0.88, 0.08)),
      ]),
    );
    body.add(g);
    return g;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // Rumpf
  const torso: THREE.BufferGeometry[] = [
    colored(cyl(0.42, 0.34, 0.9), look.body, mat4(0, 1.42, 0)),
    colored(cyl(0.37, 0.37, 0.14), look.accent, mat4(0, 1.02, 0)),
    colored(ball(0.22), look.accent, mat4(-0.46, 1.82, 0)),
    colored(ball(0.22), look.accent, mat4(0.46, 1.82, 0)),
    // Kopf
    colored(ball(0.3), look.skin, mat4(0, 2.15, 0.02)),
    colored(new THREE.SphereGeometry(0.32, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), look.hair, mat4(0, 2.2, -0.03)),
    colored(rbox(0.08, 0.05, 0.04), 0x1a1a1a, mat4(-0.1, 2.18, 0.28)),
    colored(rbox(0.08, 0.05, 0.04), 0x1a1a1a, mat4(0.1, 2.18, 0.28)),
  ];
  if (robe) torso.push(colored(new THREE.ConeGeometry(0.62, 1.25, 20, 1, true), look.cape ?? look.body, mat4(0, 0.62, 0)));
  if (look.cape !== undefined && !robe) torso.push(colored(rbox(0.75, 1.3, 0.06), look.cape, mat4(0, 1.2, -0.36, 1, 1, 1, 0.18)));
  if (look.weapon === "daggers") torso.push(colored(cone(0.36, 0.5), look.cape ?? look.body, mat4(0, 2.38, -0.05)));
  if (look.weapon === "hammer") torso.push(colored(rbox(0.9, 0.3, 0.55), look.accent, mat4(0, 1.75, 0)));
  if (look.weapon === "bow") torso.push(colored(cone(0.34, 0.3), look.cape ?? look.accent, mat4(0, 2.42, -0.02)));
  body.add(mesh(torso));

  // Arme
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.55 * side, 1.8, 0);
    g.add(
      mesh([
        colored(cyl(0.11, 0.1, 0.75), look.body, mat4(0, -0.38, 0)),
        colored(ball(0.12), look.skin, mat4(0, -0.8, 0)),
      ]),
    );
    body.add(g);
    return g;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  let glow: THREE.Object3D | null = null;
  const hand = new THREE.Group();
  hand.position.set(0, -0.82, 0.05);
  armR.add(hand);
  const handL = new THREE.Group();
  handL.position.set(0, -0.82, 0.05);
  armL.add(handL);
  switch (look.weapon) {
    case "sword":
      hand.add(
        mesh([
          colored(rbox(0.14, 1.5, 0.05), 0xd8dde6, mat4(0, 0.15, 0.75, 1, 1, 1, Math.PI / 2)),
          colored(rbox(0.5, 0.08, 0.1), look.accent, mat4(0, 0, 0.05)),
          colored(cyl(0.05, 0.05, 0.3), 0x4a2e1c, mat4(0, 0, -0.12, 1, 1, 1, Math.PI / 2)),
        ]),
      );
      break;
    case "bow": {
      const arc = new THREE.TorusGeometry(0.75, 0.05, 8, 28, Math.PI);
      handL.add(mesh([colored(arc, 0x8fd0ff, mat4(0, 0, 0.1, 1, 1, 1, 0, Math.PI / 2, Math.PI / 2)), colored(cyl(0.01, 0.01, 1.5), 0xffffff, mat4(0, 0, -0.05, 1, 1, 1, Math.PI / 2))]));
      const g = glowSprite(0x9fe0ff, 0.9, 0.6);
      g.position.set(0, 0, 0.1);
      handL.add(g);
      glow = g;
      break;
    }
    case "staff": {
      hand.add(mesh([colored(cyl(0.05, 0.06, 2.0), 0x5a3a24, mat4(0, 0.5, 0))]));
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 3), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      orb.position.set(0, 1.55, 0);
      hand.add(orb);
      const g = glowSprite(0xff8030, 1.4, 0.9);
      g.position.copy(orb.position);
      hand.add(g);
      glow = g;
      break;
    }
    case "daggers":
      for (const h of [hand, handL]) {
        h.add(mesh([colored(cone(0.07, 0.75), 0xd8c8ff, mat4(0, 0, 0.35, 1, 1, 1, Math.PI / 2))]));
      }
      {
        const g = glowSprite(0xb061ff, 0.8, 0.5);
        hand.add(g);
        glow = g;
      }
      break;
    case "hammer":
      hand.add(
        mesh([
          colored(cyl(0.06, 0.06, 1.6), 0x4a3424, mat4(0, 0.3, 0)),
          colored(rbox(0.55, 0.45, 0.75), 0x8a8f96, mat4(0, 1.1, 0)),
          colored(rbox(0.58, 0.12, 0.78), look.accent, mat4(0, 1.1, 0)),
        ]),
      );
      handL.add(mesh([colored(cyl(0.55, 0.55, 0.12), 0x6f7880, mat4(0, 0.1, 0.12, 1, 1, 1, Math.PI / 2)), colored(cyl(0.2, 0.2, 0.14), look.accent, mat4(0, 0.1, 0.2, 1, 1, 1, Math.PI / 2))]));
      break;
  }

  body.scale.setScalar(b * CHAMP_SIZE);

  const ring = champRing(ringColor);
  root.add(ring);

  return { root, body, armL, armR, legL, legR, ring, glow };
}

// ---------------- Minions (instanziert) ----------------

export function minionGeometry(type: MinionType, team: 0 | 1) {
  const main = team === 0 ? 0x3d6fd6 : 0xc8402e;
  const dark = team === 0 ? 0x22407a : 0x7a2418;
  const trim = team === 0 ? 0x9fd8ff : 0xffb070;
  const skin = 0x8a8a96;
  const parts: THREE.BufferGeometry[] = [];
  if (type === "melee") {
    parts.push(colored(cyl(0.34, 0.3, 0.7), main, mat4(0, 0.75, 0)));
    parts.push(colored(ball(0.26), skin, mat4(0, 1.3, 0)));
    parts.push(colored(new THREE.SphereGeometry(0.29, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), dark, mat4(0, 1.35, 0)));
    parts.push(colored(cone(0.07, 0.3), trim, mat4(0, 1.7, 0)));
    parts.push(colored(rbox(0.1, 0.55, 0.45), dark, mat4(-0.38, 0.85, 0.1)));
    parts.push(colored(rbox(0.06, 0.75, 0.1), 0xd0d4dc, mat4(0.38, 0.95, 0.25, 1, 1, 1, 0.5)));
    parts.push(colored(cyl(0.1, 0.1, 0.4), dark, mat4(-0.13, 0.22, 0)));
    parts.push(colored(cyl(0.1, 0.1, 0.4), dark, mat4(0.13, 0.22, 0)));
  } else if (type === "caster") {
    parts.push(colored(cone(0.42, 1.0), main, mat4(0, 0.5, 0)));
    parts.push(colored(ball(0.24), skin, mat4(0, 1.12, 0)));
    parts.push(colored(cone(0.3, 0.55), dark, mat4(0, 1.42, 0)));
    parts.push(colored(cyl(0.035, 0.035, 1.3), 0x5a3a24, mat4(0.35, 0.8, 0.15)));
    parts.push(colored(new THREE.OctahedronGeometry(0.13, 0), trim, mat4(0.35, 1.5, 0.15)));
  } else if (type === "siege") {
    parts.push(colored(rbox(1.2, 0.55, 1.4), dark, mat4(0, 0.6, 0)));
    for (const sx of [-0.65, 0.65]) for (const sz of [-0.45, 0.45]) parts.push(colored(cyl(0.3, 0.3, 0.14), 0x4a3424, mat4(sx, 0.3, sz, 1, 1, 1, 0, 0, Math.PI / 2)));
    parts.push(colored(cyl(0.2, 0.26, 1.2), 0x444a52, mat4(0, 1.05, 0.35, 1, 1, 1, Math.PI / 2 - 0.35)));
    parts.push(colored(rbox(0.9, 0.12, 1.2), main, mat4(0, 0.92, -0.05)));
    parts.push(colored(ball(0.22), trim, mat4(0, 1.15, -0.4)));
  } else {
    parts.push(colored(rbox(1.1, 1.1, 0.8), main, mat4(0, 1.5, 0)));
    parts.push(colored(ball(0.35), dark, mat4(0, 2.25, 0.1)));
    parts.push(colored(rbox(0.4, 1.2, 0.4), dark, mat4(-0.8, 1.35, 0.1, 1, 1, 1, 0.2)));
    parts.push(colored(rbox(0.45, 1.25, 0.45), dark, mat4(0.82, 1.35, 0.1, 1, 1, 1, 0.3)));
    parts.push(colored(cyl(0.22, 0.2, 0.9), dark, mat4(-0.3, 0.45, 0)));
    parts.push(colored(cyl(0.22, 0.2, 0.9), dark, mat4(0.3, 0.45, 0)));
    parts.push(colored(new THREE.OctahedronGeometry(0.25, 0), trim, mat4(0, 1.6, 0.42)));
  }
  return merge(parts);
}

// ---------------- Monster ----------------

export function buildMonster(kind: CampKind, big: boolean): { root: THREE.Group; glow: THREE.Object3D | null } {
  const root = new THREE.Group();
  let glow: THREE.Object3D | null = null;
  const P: THREE.BufferGeometry[] = [];
  switch (kind) {
    case "blue":
    case "red": {
      const stone = kind === "blue" ? 0x4c5f7a : 0x6a4a3a;
      const crystal = kind === "blue" ? 0x5fd0ff : 0xff5a2a;
      P.push(colored(lump(1.1), stone, mat4(0, 1.6, 0, 1.1, 1, 0.9)));
      P.push(colored(lump(0.55), stone, mat4(0, 2.75, 0.3)));
      P.push(colored(rbox(0.5, 1.4, 0.5), stone, mat4(-1.25, 1.4, 0.2, 1, 1, 1, 0.3, 0, 0.3)));
      P.push(colored(rbox(0.5, 1.4, 0.5), stone, mat4(1.25, 1.4, 0.2, 1, 1, 1, 0.3, 0, -0.3)));
      P.push(colored(cyl(0.3, 0.35, 0.9), stone, mat4(-0.5, 0.45, 0)));
      P.push(colored(cyl(0.3, 0.35, 0.9), stone, mat4(0.5, 0.45, 0)));
      root.add(mesh(P));
      const cr = new THREE.Mesh(
        merge([
          colored(new THREE.OctahedronGeometry(0.4, 0), crystal, mat4(0, 2.3, -0.6, 1, 1.8, 1)),
          colored(new THREE.OctahedronGeometry(0.3, 0), crystal, mat4(-0.6, 2.2, -0.5, 1, 1.6, 1, 0, 0, 0.4)),
          colored(new THREE.OctahedronGeometry(0.3, 0), crystal, mat4(0.6, 2.2, -0.5, 1, 1.6, 1, 0, 0, -0.4)),
          colored(ball(0.1), 0xffffff, mat4(-0.18, 2.85, 0.75)),
          colored(ball(0.1), 0xffffff, mat4(0.18, 2.85, 0.75)),
        ]),
        new THREE.MeshBasicMaterial({ vertexColors: true }),
      );
      root.add(cr);
      glow = glowSprite(crystal, 3.5, 0.6);
      glow.position.y = 2.2;
      root.add(glow);
      break;
    }
    case "gromp":
      P.push(colored(ball(1.1), 0x5f8a3a, mat4(0, 1.0, 0, 1, 0.8, 1.1)));
      P.push(colored(ball(0.75), 0xc0c070, mat4(0, 0.85, 0.45, 1, 0.7, 1)));
      P.push(colored(ball(0.28), 0xffe060, mat4(-0.45, 1.7, 0.55)));
      P.push(colored(ball(0.28), 0xffe060, mat4(0.45, 1.7, 0.55)));
      P.push(colored(ball(0.12), 0x111111, mat4(-0.45, 1.72, 0.8)));
      P.push(colored(ball(0.12), 0x111111, mat4(0.45, 1.72, 0.8)));
      for (const s of [-1, 1]) P.push(colored(ball(0.4), 0x4f7a2e, mat4(0.9 * s, 0.35, 0.4, 1, 0.5, 1.4)));
      root.add(mesh(P));
      break;
    case "wolves": {
      const c = big ? 0x4a4f5a : 0x5c6270;
      const fur = big ? 0x80868f : 0x929aa6;
      P.push(colored(ball(0.5), c, mat4(0, 1.0, 0.25, 0.85, 0.85, 1.25)));
      P.push(colored(ball(0.45), c, mat4(0, 0.95, -0.42, 0.8, 0.78, 1.2)));
      P.push(colored(ball(0.42), fur, mat4(0, 1.12, 0.6, 0.95, 0.9, 0.7)));
      P.push(colored(ball(0.3), c, mat4(0, 1.36, 0.95, 0.9, 0.85, 1.1)));
      P.push(colored(cone(0.17, 0.5), c, mat4(0, 1.28, 1.32, 1, 1, 1, Math.PI / 2)));
      P.push(colored(ball(0.06), 0x15161a, mat4(0, 1.28, 1.57)));
      for (const s of [-1, 1]) {
        P.push(colored(cone(0.1, 0.34), c, mat4(0.15 * s, 1.64, 0.88, 1, 1, 0.6, -0.2, 0, -0.25 * s)));
        P.push(colored(ball(0.055), 0x80e0ff, mat4(0.13 * s, 1.43, 1.2)));
      }
      for (const sx of [-0.22, 0.22]) for (const sz of [-0.48, 0.45]) P.push(colored(new THREE.CapsuleGeometry(0.1, 0.55, 4, 10), c, mat4(sx, 0.4, sz)));
      P.push(colored(cone(0.14, 0.85), c, mat4(0, 1.02, -1.02, 1, 1, 1, -2.0)));
      root.add(mesh(P));
      root.scale.setScalar(big ? 1.25 : 0.85);
      break;
    }
    case "raptors": {
      const c = big ? 0xd0582a : 0xe07a3a;
      P.push(colored(ball(0.6), c, mat4(0, 1.0, 0, 0.9, 0.9, 1.3)));
      P.push(colored(cyl(0.15, 0.2, 0.8), c, mat4(0, 1.5, 0.55, 1, 1, 1, 0.7)));
      P.push(colored(ball(0.28), c, mat4(0, 1.9, 0.85)));
      P.push(colored(cone(0.12, 0.45), 0xf0d090, mat4(0, 1.85, 1.2, 1, 1, 1, Math.PI / 2)));
      P.push(colored(cone(0.3, 0.6), 0xa03a20, mat4(0, 1.3, -0.4, 1, 1, 1, -0.6)));
      for (const s of [-1, 1]) P.push(colored(cyl(0.07, 0.05, 0.8), 0xf0d090, mat4(0.25 * s, 0.4, 0)));
      root.add(mesh(P));
      root.scale.setScalar(big ? 1.1 : 0.7);
      break;
    }
    case "krugs": {
      const c = 0x7a6a58;
      P.push(colored(lump(0.9), c, mat4(0, 1.1, 0, 1.1, 1, 1)));
      P.push(colored(lump(0.4), 0x6a5a48, mat4(-0.9, 0.9, 0.3)));
      P.push(colored(lump(0.4), 0x6a5a48, mat4(0.9, 0.9, 0.3)));
      P.push(colored(ball(0.1), 0xffb040, mat4(-0.25, 1.4, 0.85)));
      P.push(colored(ball(0.1), 0xffb040, mat4(0.25, 1.4, 0.85)));
      root.add(mesh(P));
      root.scale.setScalar(big ? 1.3 : 0.85);
      break;
    }
    case "scuttle":
      P.push(colored(ball(0.9), 0x3aa0a0, mat4(0, 0.6, 0, 1.2, 0.5, 1)));
      P.push(colored(new THREE.SphereGeometry(0.75, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), 0x6ad0c0, mat4(0, 0.75, 0, 1.1, 0.8, 0.9)));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        P.push(colored(cyl(0.06, 0.04, 0.8), 0x2a7070, mat4(Math.cos(a) * 0.9, 0.3, Math.sin(a) * 0.7, 1, 1, 1, Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8)));
      }
      P.push(colored(ball(0.1), 0x111111, mat4(-0.2, 0.9, 0.75)));
      P.push(colored(ball(0.1), 0x111111, mat4(0.2, 0.9, 0.75)));
      root.add(mesh(P));
      break;
    case "dragon": {
      const c = 0xc8501e;
      const w = 0x8a2a14;
      P.push(colored(ball(1.4), c, mat4(0, 2.0, 0, 1, 0.9, 1.5)));
      P.push(colored(cyl(0.4, 0.6, 1.6), c, mat4(0, 3.0, 1.4, 1, 1, 1, 0.8)));
      P.push(colored(rbox(0.8, 0.6, 1.3), c, mat4(0, 3.7, 2.1)));
      P.push(colored(cone(0.15, 0.7), 0xf0e0c0, mat4(-0.3, 4.2, 1.8, 1, 1, 1, -0.6)));
      P.push(colored(cone(0.15, 0.7), 0xf0e0c0, mat4(0.3, 4.2, 1.8, 1, 1, 1, -0.6)));
      P.push(colored(ball(0.1), 0xffee60, mat4(-0.3, 3.85, 2.75)));
      P.push(colored(ball(0.1), 0xffee60, mat4(0.3, 3.85, 2.75)));
      P.push(colored(cone(0.5, 3), c, mat4(0, 1.6, -2.4, 1, 1, 1, -1.7)));
      for (const s of [-1, 1]) {
        P.push(colored(new THREE.ConeGeometry(1.6, 0.1, 3), w, mat4(2.0 * s, 3.2, -0.2, 1.6, 1, 1, 0, 0, s * 0.4)));
        P.push(colored(cyl(0.25, 0.2, 1.4), c, mat4(0.8 * s, 0.7, 0.6)));
        P.push(colored(cyl(0.25, 0.2, 1.4), c, mat4(0.8 * s, 0.7, -0.6)));
      }
      root.add(mesh(P));
      glow = glowSprite(0xff7a20, 5, 0.35);
      glow.position.y = 2.5;
      root.add(glow);
      break;
    }
    case "baron": {
      const c = 0x5a2a7a;
      const l = 0x9a5ac8;
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        P.push(colored(ball(1.5 - t * 0.6), i % 2 ? c : l, mat4(Math.sin(t * 2) * 0.6, 0.8 + t * 4.5, -1.2 + t * 1.8)));
      }
      P.push(colored(rbox(1.6, 1.0, 1.8), c, mat4(0.5, 6.0, 1.4)));
      P.push(colored(cone(0.25, 1.4), 0xe8d8ff, mat4(-0.2, 6.9, 0.9, 1, 1, 1, -0.4, 0, 0.3)));
      P.push(colored(cone(0.25, 1.4), 0xe8d8ff, mat4(1.2, 6.9, 0.9, 1, 1, 1, -0.4, 0, -0.3)));
      P.push(colored(ball(0.16), 0xff70ff, mat4(0.1, 6.2, 2.3)));
      P.push(colored(ball(0.16), 0xff70ff, mat4(0.9, 6.2, 2.3)));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        P.push(colored(cone(0.3, 2.2), l, mat4(Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2, 1, 1, 1, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)));
      }
      root.add(mesh(P));
      glow = glowSprite(0xb050ff, 7, 0.35);
      glow.position.y = 4;
      root.add(glow);
      break;
    }
  }
  root.scale.multiplyScalar(MONSTER_SIZE);
  return { root, glow };
}

// ---------------- Gebäude ----------------

export type StructModel = {
  root: THREE.Group;
  crystal: THREE.Object3D;
  glow: THREE.Sprite;
  top: THREE.Object3D;
  rubble: THREE.Object3D;
  crystalY: number;
  staff?: THREE.Object3D;
  outline?: THREE.Mesh;
  shards?: THREE.Object3D;
};

/** Facettierter, leuchtender Edelstein. */
function gemMat(team: 0 | 1, opacity = 1) {
  return new THREE.MeshPhongMaterial({
    color: team === 0 ? 0x48b4ff : 0xff3020,
    emissive: team === 0 ? 0x0c5cd8 : 0xc80c0c,
    emissiveIntensity: 1,
    specular: 0xffffff,
    shininess: 90,
    flatShading: true,
    transparent: opacity < 1,
    opacity,
  });
}

const statueMat = () => new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: 0x3a3a3a, map: tex(detailUrl, 1, false) });
const inlayMat = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Transformation: Position, dann Drehung um Y, dann Kippen um X, dann Skalierung. */
function trs(x: number, y: number, z: number, ry = 0, rx = 0, sx = 1, sy = 1, sz = 1, rz = 0) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  m.multiply(new THREE.Matrix4().makeRotationY(ry));
  m.multiply(new THREE.Matrix4().makeRotationX(rx));
  m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
  return m;
}

/** Roter Umriss (aufgeblähte Rückseite), wie beim Anvisieren in LoL. */
function outlineMesh(geo: THREE.BufferGeometry, color: number, width: number) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = vec3(position) + normal * ${width.toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => `outline${width}`;
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  return m;
}

/** Markiert ein Material im Stencil-Puffer, damit der Umriss nur außerhalb der Figur erscheint. */
function markSilhouette<T extends THREE.Material>(m: T, ref = 1) {
  m.stencilWrite = true;
  m.stencilRef = ref;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
  return m;
}

/** Normalen über alle Kopien eines Punktes gemittelt (UV-Nähte), damit der aufgeblähte Umriss keine Risse bekommt. */
function smoothOutlineGeometry(src: THREE.BufferGeometry) {
  const pos = src.getAttribute("position");
  const nor = src.getAttribute("normal");
  const sum = new Map<string, number[]>();
  const keyOf = (i: number) => `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const v = sum.get(k) ?? [0, 0, 0];
    v[0] += nor.getX(i);
    v[1] += nor.getY(i);
    v[2] += nor.getZ(i);
    sum.set(k, v);
  }
  const sm = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = sum.get(keyOf(i))!;
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    sm[i * 3] = v[0] / l;
    sm[i * 3 + 1] = v[1] / l;
    sm[i * 3 + 2] = v[2] / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", pos);
  g.setAttribute("smoothNormal", new THREE.BufferAttribute(sm, 3));
  g.setIndex(src.getIndex());
  g.boundingSphere = src.boundingSphere;
  return g;
}

/** Roter Umriss wie in LoL: nur die Außenkante der Figur, keine roten Ränder auf der Figur selbst. */
function silhouetteOutline(geo: THREE.BufferGeometry, color: number, width: number, ref = 1) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.stencilWrite = true;
  mat.stencilRef = ref;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFail = THREE.KeepStencilOp;
  mat.stencilZFail = THREE.KeepStencilOp;
  mat.stencilZPass = THREE.KeepStencilOp;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 smoothNormal;")
      .replace("#include <begin_vertex>", `vec3 transformed = vec3(position) + smoothNormal * ${width.toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => `silhouette${width}`;
  // eigener Stencil-Wert je Gebäudeart: Nexus (2) und Türme (1) schneiden sich gegenseitig keine Lücken in den Umriss
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  m.visible = false;
  return m;
}

const Cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, Math.max(seg, 24));
const Box = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.14);

/** Größe der Wächterstatue relativ zum Sockel. */
export const TURRET_STATUE_SCALE = 1.35;

/** Turm: humanoide Wächterstatue auf rundem Sockel (Entwurf aus der überarbeiteten Version). */
/** Alter, aus Grundformen gebauter Turm. Nur noch Rückfall, falls das 3D-Modell nicht lädt. */
function buildTurretProcedural(team: 0 | 1): StructModel {
  const root = new THREE.Group();
  const C = {
    stoneD: 0x2c2f33,
    stone: 0x44484e,
    stoneL: 0x5c6168,
    armor: 0x4a4e55,
    armorD: 0x34373c,
    gold: 0xd2a24a,
    goldD: 0x9a7030,
    dark: 0x111316,
    pole: 0x2a2624,
    inlay: team === 0 ? 0x46b4ff : 0xff2a1e,
  };
  const mat = statueMat();

  // Sockel mit Goldkante
  const baseParts: THREE.BufferGeometry[] = [colored(Cyl(2.65, 2.9, 0.42, 24), C.stoneD, mat4(0, 0.22, 0))];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    baseParts.push(colored(Box(1.05, 0.34, 0.62), k % 2 ? C.stone : C.stoneL, trs(Math.sin(a) * 2.35, 0.52, Math.cos(a) * 2.35, a, 0, 1, 1, 1, ((k % 3) - 1) * 0.035)));
    baseParts.push(colored(Box(0.82, 0.13, 0.54), C.goldD, trs(Math.sin(a) * 2.34, 0.73, Math.cos(a) * 2.34, a)));
  }
  baseParts.push(colored(Cyl(1.72, 1.95, 0.22, 18), C.stoneD, mat4(0, 1.22, 0)));
  const baseGeo = merge(baseParts);
  const baseMesh = new THREE.Mesh(baseGeo, mat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  const top = new THREE.Group();
  top.scale.setScalar(TURRET_STATUE_SCALE);
  root.add(top);
  const parts: THREE.BufferGeometry[] = [];
  // Stiefel und Beinschienen: getrennte Füße und Schienbeine machen die Figur aus Spielentfernung lesbar
  for (const side of [-1, 1]) {
    parts.push(colored(Box(0.62, 0.42, 0.82), C.armorD, trs(0.43 * side, 0.98, 0.34, 0, 0, 1, 1, 1, 0.08 * side)));
    parts.push(colored(Box(0.48, 0.86, 0.52), C.armor, trs(0.43 * side, 1.55, 0.23, 0, 0, 1, 1, 1, 0.06 * side)));
    parts.push(colored(Box(0.5, 0.12, 0.57), C.goldD, trs(0.43 * side, 1.22, 0.52, 0, 0, 1, 1, 1, 0.06 * side)));
    parts.push(colored(Box(0.16, 0.58, 0.09), C.gold, trs(0.43 * side, 1.62, 0.51, 0, 0, 1, 1, 1, 0.06 * side)));
    parts.push(colored(Box(0.54, 0.2, 0.72), C.stoneL, trs(0.43 * side, 0.76, 0.31, 0, 0, 1, 1, 1, 0.05 * side)));
  }
  // Hüfte, Rumpf und mehrlagiger Brustpanzer
  parts.push(colored(Cyl(0.72, 0.92, 1.05, 8), C.armorD, mat4(0, 2.25, 0)));
  parts.push(colored(Box(1.26, 0.5, 0.76), C.armorD, mat4(0, 2.58, 0.03)));
  parts.push(colored(Box(1.36, 1.18, 0.38), C.armor, mat4(0, 3.22, 0.39)));
  parts.push(colored(Box(1.08, 0.82, 0.16), C.armorD, mat4(0, 3.28, 0.61)));
  parts.push(colored(Box(0.86, 0.57, 0.13), C.stoneL, mat4(0, 3.36, 0.72)));
  parts.push(colored(Box(0.18, 0.72, 0.1), C.gold, trs(0, 3.28, 0.82, 0, 0, 1, 1, 1, -0.16)));
  parts.push(colored(Box(0.18, 0.72, 0.1), C.gold, trs(0, 3.28, 0.82, 0, 0, 1, 1, 1, 0.16)));
  parts.push(colored(new THREE.ConeGeometry(0.19, 0.38, 5), C.gold, mat4(0, 3.65, 0.83)));
  parts.push(colored(Box(0.76, 0.12, 0.14), C.goldD, mat4(0, 2.88, 0.72)));
  // Kantige Schulterpanzer und gegliederte Arme
  for (const side of [-1, 1]) {
    parts.push(colored(Box(0.9, 0.55, 0.72), C.armorD, trs(0.98 * side, 3.72, 0.03, 0, 0, 1, 1, 1, 0.16 * side)));
    parts.push(colored(Box(0.76, 0.38, 0.65), C.stoneL, trs(0.99 * side, 3.82, 0.13, 0, 0, 1, 1, 1, 0.16 * side)));
    parts.push(colored(Box(0.64, 0.12, 0.69), C.goldD, trs(0.99 * side, 4.04, 0.14, 0, 0, 1, 1, 1, 0.16 * side)));
    parts.push(colored(Box(0.19, 0.72, 0.2), C.gold, trs(1.03 * side, 3.75, 0.51, 0, 0, 1, 1, 1, 0.2 * side)));
    parts.push(colored(Cyl(0.22, 0.28, 1.02, 7), C.armorD, trs(1.18 * side, 3.15, 0.12, 0, 0, 1, 1, 1, 0.12 * side)));
    parts.push(colored(Box(0.42, 0.34, 0.42), C.armor, trs(1.23 * side, 2.66, 0.25, 0, 0, 1, 1, 1, 0.08 * side)));
    parts.push(colored(Box(0.32, 0.18, 0.35), C.goldD, trs(1.23 * side, 2.47, 0.28, 0, 0, 1, 1, 1, 0.08 * side)));
  }
  // Hals, Helm mit Sehschlitz und Kronenkamm
  parts.push(colored(Cyl(0.32, 0.38, 0.38, 8), C.goldD, mat4(0, 4.02, 0.02)));
  parts.push(colored(new THREE.ConeGeometry(0.56, 0.84, 6), C.armorD, mat4(0, 4.58, 0.02)));
  parts.push(colored(Box(0.65, 0.43, 0.47), C.armor, mat4(0, 4.43, 0.27)));
  parts.push(colored(Box(0.43, 0.24, 0.08), C.dark, mat4(0, 4.55, 0.515)));
  parts.push(colored(Box(0.37, 0.055, 0.045), C.goldD, mat4(0, 4.65, 0.565)));
  parts.push(colored(new THREE.ConeGeometry(0.27, 0.48, 5), C.gold, mat4(0, 4.95, 0.05)));
  parts.push(colored(Box(0.12, 0.48, 0.12), C.goldD, mat4(0, 4.87, 0.34)));
  // Breiter Umhang hinter dem Körper (Teamfarbe)
  parts.push(colored(Box(1.48, 2.62, 0.14), C.dark, mat4(0, 2.86, -0.48, 1, 1, 1, 0.08)));
  parts.push(colored(Box(1.25, 2.28, 0.1), team === 0 ? 0x18304b : 0x541c2c, mat4(0, 2.92, -0.575, 1, 1, 1, 0.08)));
  parts.push(colored(Box(1.12, 0.22, 0.12), C.goldD, mat4(0, 4.12, -0.55)));
  for (const side of [-1, 1]) parts.push(colored(Box(0.18, 1.95, 0.08), C.goldD, trs(0.48 * side, 2.8, -0.64, 0, 0, 1, 1, 1, 0.1 * side)));
  const bodyGeo = merge(parts);
  const bodyMesh = new THREE.Mesh(bodyGeo, mat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  top.add(bodyMesh);

  // Stab und Kristall als eigene Gruppe (Rückstoß-Animation)
  const staff = new THREE.Group();
  staff.position.set(-1.62, 3.95, 0.15);
  staff.rotation.z = -0.08;
  top.add(staff);
  const staffParts = [
    colored(Cyl(0.09, 0.12, 2.75, 8), C.pole, mat4(0, 1.12, 0)),
    colored(Cyl(0.18, 0.2, 0.22, 8), C.gold, mat4(0, 0.16, 0)),
    colored(new THREE.TorusGeometry(0.29, 0.07, 6, 16), C.gold, mat4(0, 2.32, 0, 1, 1, 1, Math.PI / 2)),
    colored(Cyl(0.3, 0.14, 0.36, 8), C.goldD, mat4(0, 2.48, 0)),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    staffParts.push(colored(new THREE.ConeGeometry(0.055, 0.6, 4), C.gold, trs(Math.sin(a) * 0.26, 2.83, Math.cos(a) * 0.26, a, 0.18)));
  }
  const staffMesh = new THREE.Mesh(merge(staffParts), mat);
  staffMesh.castShadow = true;
  staff.add(staffMesh);
  const crystalY = 2.98;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), gemMat(team));
  crystal.scale.set(0.82, 1.55, 0.82);
  crystal.position.set(0, crystalY, 0.02);
  staff.add(crystal);
  const glow = glowSprite(TEAM_GLOW[team], 3.5, 0.85);
  glow.position.copy(crystal.position);
  staff.add(glow);

  // Kristall-Einlagen in Brust und Schultern
  const inlay = new THREE.Mesh(
    merge([
      colored(new THREE.OctahedronGeometry(0.16, 0), C.inlay, mat4(0, 3.37, 0.84, 0.8, 1.5, 0.35)),
      colored(new THREE.OctahedronGeometry(0.12, 0), C.inlay, mat4(-1.04, 3.82, 0.52, 0.7, 1.2, 0.35)),
      colored(new THREE.OctahedronGeometry(0.12, 0), C.inlay, mat4(1.04, 3.82, 0.52, 0.7, 1.2, 0.35)),
    ]),
    inlayMat,
  );
  top.add(inlay);

  const rubbleParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    rubbleParts.push(colored(Box(0.5, 0.25, 0.42), C.stone, trs(Math.sin(a) * 2.1, 0.28, Math.cos(a) * 2.1, a)));
  }
  const rubble = new THREE.Mesh(merge(rubbleParts), mat);
  rubble.visible = false;
  root.add(rubble);

  const scaledBody = bodyGeo.clone().applyMatrix4(new THREE.Matrix4().makeScale(TURRET_STATUE_SCALE, TURRET_STATUE_SCALE, TURRET_STATUE_SCALE));
  const outline = outlineMesh(merge([baseGeo.clone(), scaledBody]), 0xff2a1a, 0.09);
  root.add(outline);
  return { root, crystal, glow, top, rubble, crystalY, staff, outline };
}

/** Kristallprisma mit Spitze oben und unten. */
function prism(r: number, h: number, seg = 6, top = 0.42, bottom = 0.22) {
  return mergeGeometries([
    new THREE.CylinderGeometry(r, r * 0.9, h, seg),
    new THREE.ConeGeometry(r, h * top, seg).translate(0, h / 2 + (h * top) / 2, 0),
    new THREE.ConeGeometry(r * 0.9, h * bottom, seg).rotateX(Math.PI).translate(0, -h / 2 - (h * bottom) / 2, 0),
  ])!;
}

/** Strecke als Quader von a nach b. */
function segBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, d: number, color: number) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
  return colored(Box(w, len, d), color, m);
}

const STONE = { d: 0x343a3e, m: 0x535b61, l: 0x6c747a, gold: 0xcaa14c, goldD: 0x8a6a2e, steel: 0x8a9096 };

/** Runder Steinsockel mit Goldring und Mauerwerk. */
function roundBase(r: number, parts: THREE.BufferGeometry[]) {
  parts.push(colored(Cyl(r + 0.35, r + 0.6, 0.45, 26), STONE.d, mat4(0, 0.22, 0)));
  parts.push(colored(Cyl(r, r + 0.2, 0.5, 26), STONE.m, mat4(0, 0.68, 0)));
  parts.push(colored(Cyl(r - 0.6, r - 0.55, 0.12, 26), STONE.d, mat4(0, 0.98, 0)));
  parts.push(colored(new THREE.TorusGeometry(r - 0.5, 0.12, 6, 32), STONE.gold, mat4(0, 1.0, 0, 1, 1, 1, Math.PI / 2)));
  const n = Math.round(r * 4.5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(colored(Box((r * 5.4) / n, 0.3, 0.45), i % 2 ? STONE.m : STONE.l, trs(Math.sin(a) * (r - 0.1), 1.0, Math.cos(a) * (r - 0.1), a)));
  }
}

export function buildInhibitor(team: 0 | 1): StructModel {
  const root = new THREE.Group();
  const mat = statueMat();
  const gem = gemMat(team, 0.94);
  const parts: THREE.BufferGeometry[] = [];
  roundBase(2.6, parts);
  const top = new THREE.Group();
  root.add(top);
  const crystal = new THREE.Group();
  let crystalY: number;
  if (team === 0) {
    // Blau: Kristallsäule in einem Steinrahmen, an Ketten aufgehängt
    for (const sd of [-1, 1]) {
      parts.push(colored(Box(0.62, 4.3, 0.62), STONE.m, mat4(1.8 * sd, 3.1, 0)));
      parts.push(colored(Box(0.82, 0.32, 0.82), STONE.gold, mat4(1.8 * sd, 1.15, 0)));
      parts.push(colored(Box(0.74, 0.18, 0.74), STONE.gold, mat4(1.8 * sd, 3.2, 0)));
      parts.push(colored(Box(0.4, 0.9, 0.3), STONE.goldD, mat4(1.8 * sd, 4.6, 0.36)));
    }
    parts.push(colored(Box(4.3, 0.5, 0.72), STONE.l, mat4(0, 5.45, 0)));
    parts.push(colored(Box(4.5, 0.14, 0.82), STONE.gold, mat4(0, 5.18, 0)));
    parts.push(colored(new THREE.OctahedronGeometry(0.35, 0), STONE.gold, mat4(0, 5.45, 0.42, 1, 1, 0.4)));
    // Ketten
    const chain = (ax: number, ay: number, bx: number, by: number) => {
      const links = 6;
      for (let i = 0; i < links; i++) {
        const t = (i + 0.5) / links;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t - Math.sin(t * Math.PI) * 0.18;
        const ang = Math.atan2(by - ay, bx - ax);
        parts.push(colored(new THREE.TorusGeometry(0.13, 0.035, 4, 8), STONE.steel, trs(x, y, 0, i % 2 ? Math.PI / 2 : 0, 0, 1.4, 1, 1, ang + Math.PI / 2)));
      }
    };
    for (const sd of [-1, 1]) {
      chain(1.5 * sd, 4.4, 0.5 * sd, 3.9);
      chain(1.5 * sd, 2.0, 0.5 * sd, 2.4);
    }
    crystalY = 3.15;
    const c = new THREE.Mesh(prism(0.62, 2.3, 6), gem);
    crystal.add(c);
  } else {
    // Rot: einzelner Kristall auf einem Sockel mit goldenen Ornamenten
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(colored(new THREE.TorusGeometry(0.42, 0.1, 5, 10, Math.PI), STONE.gold, trs(Math.sin(a) * 2.45, 1.25, Math.cos(a) * 2.45, a)));
    }
    parts.push(colored(Cyl(0.95, 1.2, 0.6, 10), STONE.l, mat4(0, 1.35, 0)));
    parts.push(colored(new THREE.TorusGeometry(1.0, 0.1, 6, 18), STONE.gold, mat4(0, 1.62, 0, 1, 1, 1, Math.PI / 2)));
    crystalY = 3.35;
    const c = new THREE.Mesh(prism(0.72, 2.5, 5), gem);
    c.rotation.z = 0.07;
    crystal.add(c);
  }
  crystal.position.y = crystalY;
  top.add(crystal);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.05, 28), new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team], transparent: true, opacity: 0.45 }));
  pool.position.y = 1.07;
  top.add(pool);
  const glow = glowSprite(TEAM_GLOW[team], 6.5, 0.75);
  glow.position.y = crystalY;
  top.add(glow);
  const baseMesh = new THREE.Mesh(merge(parts), mat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);
  const rubble = new THREE.Mesh(
    merge([
      colored(new THREE.OctahedronGeometry(0.5, 0), 0x3a3238, mat4(0.5, 1.35, 0.3, 0.8, 1.5, 0.8, 1.1, 0, 0.5)),
      colored(new THREE.OctahedronGeometry(0.4, 0), 0x2c262c, mat4(-0.6, 1.25, -0.4, 0.8, 1.5, 0.8, 0.3, 0, 1.3)),
      colored(new THREE.OctahedronGeometry(0.3, 0), 0x3a3238, mat4(0.1, 1.2, -0.9, 0.8, 1.5, 0.8, 1.4, 0, 0.2)),
    ]),
    mat,
  );
  rubble.visible = false;
  root.add(rubble);
  const outline = outlineMesh(merge(parts.map((g) => g.clone())), 0xff2a1a, 0.08);
  root.add(outline);
  return { root, crystal, glow, top, rubble, crystalY, outline };
}

/** Feuerschale auf Steinsäule (Dekoration in den Basen). */
export function buildBrazier() {
  const root = new THREE.Group();
  const m = new THREE.Mesh(
    merge([
      colored(Cyl(0.55, 0.75, 0.4, 10), 0x343a3e, mat4(0, 0.2, 0)),
      colored(Cyl(0.42, 0.52, 1.5, 10), 0x5c646a, mat4(0, 1.15, 0)),
      colored(new THREE.TorusGeometry(0.47, 0.07, 6, 16), 0xcaa14c, mat4(0, 1.5, 0, 1, 1, 1, Math.PI / 2)),
      colored(Cyl(0.85, 0.45, 0.55, 12), 0x3a3530, mat4(0, 2.15, 0)),
      colored(new THREE.TorusGeometry(0.85, 0.08, 6, 18), 0xcaa14c, mat4(0, 2.42, 0, 1, 1, 1, Math.PI / 2)),
      colored(Cyl(0.7, 0.7, 0.1, 12), 0xff8a2a, mat4(0, 2.38, 0)),
    ]),
    statueMat(),
  );
  m.castShadow = true;
  root.add(m);
  const fire = brazierFire(1);
  fire.root.position.y = 2.42;
  root.add(fire.root);
  return { root, fireY: 2.5, glow: fire.glow, flame: fire.flame };
}

/** Feuer für eine Feuerschale: Leuchten und zwei flackernde, additive Flammenkegel (Animation in View). */
export function brazierFire(size: number) {
  const root = new THREE.Group();
  const glow = glowSprite(0xff8a30, 3.2 * size, 0.7);
  glow.position.y = 0.38 * size;
  root.add(glow);
  const flame = new THREE.Group();
  const fm = (color: number, r: number, h: number, o: number) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    c.position.y = h / 2;
    flame.add(c);
  };
  fm(0xff5a10, 0.62 * size, 1.6 * size, 0.55);
  fm(0xffc040, 0.36 * size, 1.05 * size, 0.75);
  root.add(flame);
  return { root, glow, flame };
}

/** Goldene Feuerschalen im Startbasis-Modell (Modellkoordinaten, vorne = +z; Höhe = Schalenboden). */
const START_BASE_BOWLS: [number, number, number][] = [
  [-3.4, 3.3, -3.36],
  [5.04, 3.4, 0.63],
  [-6.72, 2.62, 2.1],
];

/** Feuer in die Schalen der Startbasis setzen (nur beim echten 3D-Modell); gibt die Feuer für die Animation zurück. */
export function addStartBaseFires(fountain: THREE.Object3D) {
  if (!startBase) return [];
  return START_BASE_BOWLS.map(([x, y, z]) => {
    const fire = brazierFire(0.62);
    fire.root.position.set(x, y - START_BASE_SINK, z);
    fountain.add(fire.root);
    return fire;
  });
}

// ---------------- Nexus aus dem 3D-Modell (assets-src/nexus.py -> nexus.glb) ----------------

type NexusAsset = { base: THREE.Mesh; crystal: THREE.Mesh; outlineGeo: THREE.BufferGeometry };
const NEXUS_STENCIL = 2;
let nexusAsset: NexusAsset | null = null;

/** Lädt das Nexus-Modell einmalig; bei einem Fehler bleibt der gebaute Ersatz-Nexus. */
export async function loadNexus(): Promise<boolean> {
  if (nexusAsset) return true;
  try {
    const gltf = await loadGlbOffline(nexusUrl);
    const base = gltf.scene.getObjectByName("Nexus") as THREE.Mesh | undefined;
    const crystal = gltf.scene.getObjectByName("Crystal") as THREE.Mesh | undefined;
    if (!base?.isMesh || !crystal?.isMesh) throw new Error("GLB benötigt die Meshes Nexus und Crystal");
    const mat = (Array.isArray(base.material) ? base.material[0] : base.material) as THREE.MeshStandardMaterial;
    if (mat.map) mat.map.anisotropy = 4;
    markSilhouette(mat, NEXUS_STENCIL);
    nexusAsset = { base, crystal, outlineGeo: smoothOutlineGeometry(base.geometry) };
    return true;
  } catch (err) {
    console.error("Nexus-GLB konnte nicht geladen werden, nutze Ersatzmodell:", err);
    return false;
  }
}

/** Nexus aus dem Modell: Sockel mit Krallen, Kristall in Teamfarbe dreht sich und leuchtet. */
function buildNexusModel(team: 0 | 1, asset: NexusAsset): StructModel {
  const root = new THREE.Group();
  const base = new THREE.Mesh(asset.base.geometry, asset.base.material);
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);
  const top = new THREE.Group();
  root.add(top);
  const crystal = new THREE.Group();
  crystal.position.copy(asset.crystal.position);
  const gemM = gemMat(team);
  // etwas weniger Eigenleuchten, damit die Facetten des großen Kristalls sichtbar bleiben
  gemM.emissiveIntensity = 0.6;
  const gem = new THREE.Mesh(asset.crystal.geometry, markSilhouette(gemM, NEXUS_STENCIL));
  gem.castShadow = true;
  crystal.add(gem);
  top.add(crystal);
  const glow = glowSprite(TEAM_GLOW[team], 11, 0.6);
  glow.position.copy(asset.crystal.position);
  top.add(glow);
  // Trümmer: abgebrochener, erloschener Kristall und umgestürzte Splitter über dem Rand der Schale
  const cg = asset.crystal.geometry;
  const cy = asset.crystal.position.y;
  const dead = team === 0 ? 0x34405a : 0x5a3434;
  const rubble = new THREE.Mesh(
    merge([
      colored(cg, dead, mat4(0, cy * 0.55, 0, 0.62, 0.42, 0.62, 0.08, 0.4, 0.05)),
      colored(cg, 0x3d3842, mat4(1.25, 3.4, 0.6, 0.34, 0.34, 0.34, 0.2, 0.6, 1.25)),
      colored(cg, dead, mat4(-1.2, 3.3, 0.5, 0.3, 0.3, 0.3, -0.3, 2.1, -1.1)),
      colored(cg, 0x3d3842, mat4(0.2, 3.5, -1.3, 0.28, 0.28, 0.28, 1.2, 4.0, 0.2)),
      colored(new THREE.DodecahedronGeometry(0.55, 0), 0x3a3238, mat4(-0.6, 3.0, 1.35)),
    ]),
    statueMat(),
  );
  rubble.castShadow = true;
  rubble.visible = false;
  root.add(rubble);
  const outline = silhouetteOutline(asset.outlineGeo, 0xff2a1a, 0.09, NEXUS_STENCIL);
  root.add(outline);
  return { root, crystal, glow, top, rubble, crystalY: crystal.position.y, outline };
}

export function buildNexus(team: 0 | 1): StructModel {
  if (nexusAsset) return buildNexusModel(team, nexusAsset);
  const root = new THREE.Group();
  const mat = statueMat();
  const gem = gemMat(team, 0.95);
  const parts: THREE.BufferGeometry[] = [];
  roundBase(4.6, parts);
  // verzierte Randblöcke mit Goldplatten
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    parts.push(colored(Box(1.5, 0.9, 0.85), STONE.l, trs(Math.sin(a) * 4.35, 1.45, Math.cos(a) * 4.35, a)));
    parts.push(colored(Box(0.95, 0.42, 0.12), STONE.gold, trs(Math.sin(a) * 4.8, 1.45, Math.cos(a) * 4.8, a)));
    parts.push(colored(Box(1.6, 0.12, 0.95), STONE.gold, trs(Math.sin(a) * 4.35, 1.95, Math.cos(a) * 4.35, a)));
  }
  const top = new THREE.Group();
  root.add(top);
  const crystal = new THREE.Group();
  const crystalY = 0;
  const shards = new THREE.Group();
  if (team === 0) {
    // Blau: Säulen umfassen eine Kristallgruppe
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(colored(Box(0.8, 3.6, 0.8), STONE.m, trs(Math.sin(a) * 2.75, 3.0, Math.cos(a) * 2.75, a, -0.12)));
      parts.push(colored(Box(0.95, 0.2, 0.95), STONE.gold, trs(Math.sin(a) * 2.7, 2.1, Math.cos(a) * 2.7, a, -0.12)));
      parts.push(colored(Box(0.6, 0.85, 0.5), STONE.gold, trs(Math.sin(a) * 2.55, 4.55, Math.cos(a) * 2.55, a, -0.35)));
    }
    const main = new THREE.Mesh(prism(1.25, 4.2, 6), gem);
    main.position.y = 3.9;
    crystal.add(main);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const c = new THREE.Mesh(prism(0.55, 2.2 + (i % 3) * 0.5, 6), gem);
      c.position.set(Math.sin(a) * 1.35, 3.0, Math.cos(a) * 1.35);
      c.rotation.set(Math.cos(a) * 0.28, 0, -Math.sin(a) * 0.28);
      crystal.add(c);
    }
  } else {
    // Rot: große Krallen aus dunklem Stein mit Gold um einen Kristallhaufen
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const P = (r: number, y: number) => [Math.sin(a) * r, y, Math.cos(a) * r] as const;
      const [x0, y0, z0] = P(3.4, 1.3);
      const [x1, y1, z1] = P(3.3, 4.4);
      const [x2, y2, z2] = P(2.4, 6.6);
      const [x3, y3, z3] = P(1.5, 7.4);
      parts.push(segBox(x0, y0, z0, x1, y1, z1, 1.0, 1.0, STONE.d));
      parts.push(segBox(x1, y1, z1, x2, y2, z2, 0.8, 0.8, STONE.d));
      parts.push(segBox(x0 * 1.04, y0 + 0.4, z0 * 1.04, x1 * 1.04, y1, z1 * 1.04, 0.35, 1.05, STONE.gold));
      parts.push(segBox(x1 * 1.03, y1, z1 * 1.03, x2 * 1.05, y2, z2 * 1.05, 0.3, 0.85, STONE.gold));
      parts.push(segBox(x2, y2, z2, x3, y3, z3, 0.45, 0.45, STONE.goldD));
    }
    const main = new THREE.Mesh(prism(1.45, 4.8, 5), gem);
    main.position.y = 4.0;
    main.rotation.z = 0.1;
    crystal.add(main);
    for (const [ang, h, tilt] of [
      [0.6, 3.2, 0.42],
      [2.8, 2.8, 0.38],
      [4.6, 2.4, 0.45],
    ] as const) {
      const c = new THREE.Mesh(prism(0.75, h, 5), gem);
      c.position.set(Math.sin(ang) * 1.5, 2.9, Math.cos(ang) * 1.5);
      c.rotation.set(Math.cos(ang) * tilt, 0, -Math.sin(ang) * tilt);
      crystal.add(c);
    }
    for (let i = 0; i < 3; i++) {
      const sh = new THREE.Mesh(prism(0.25, 0.6, 5), gem);
      sh.position.set(Math.sin(i * 2.1) * 0.9, 8.4 + i * 0.5, Math.cos(i * 2.1) * 0.9);
      sh.rotation.z = 0.5 * (i - 1);
      shards.add(sh);
    }
  }
  crystal.position.y = crystalY;
  top.add(crystal);
  top.add(shards);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.05, 32), new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team], transparent: true, opacity: 0.4 }));
  pool.position.y = 1.07;
  top.add(pool);
  const glow = glowSprite(TEAM_GLOW[team], 12, 0.6);
  glow.position.y = 4.4;
  top.add(glow);
  const baseMesh = new THREE.Mesh(merge(parts), mat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);
  const rubble = new THREE.Mesh(
    merge([
      colored(new THREE.DodecahedronGeometry(1.2, 0), 0x3a3238, mat4(0.6, 1.8, 0.2)),
      colored(new THREE.OctahedronGeometry(0.8, 0), 0x2c2630, mat4(-0.8, 1.6, -0.5, 0.8, 1.6, 0.8, 0.9, 0, 0.4)),
      colored(new THREE.OctahedronGeometry(0.6, 0), 0x2c2630, mat4(0.9, 1.5, -1.0, 0.8, 1.6, 0.8, 1.4, 0, 1.0)),
    ]),
    mat,
  );
  rubble.visible = false;
  root.add(rubble);
  const outline = outlineMesh(merge(parts.map((g) => g.clone())), 0xff2a1a, 0.09);
  root.add(outline);
  return { root, crystal, glow, top, rubble, crystalY, shards, outline };
}

/** Bodenplatte des Brunnens mit Emblem und Moos. */
function emblemTexture(team: 0 | 1) {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const cx = S / 2;
  const R = S / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, R);
  grad.addColorStop(0, "#b8c4c2");
  grad.addColorStop(1, "#7e8b8d");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = "rgba(40,48,52,0.75)";
  // Ringe und Fugen
  for (const k of [0.97, 0.8, 0.6, 0.34]) {
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cx, R * k, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r0 = i % 2 ? 0.6 : 0.8;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R * r0, cx + Math.sin(a) * R * r0);
    g.lineTo(cx + Math.cos(a) * R * 0.97, cx + Math.sin(a) * R * 0.97);
    g.stroke();
  }
  // Emblem: achtblättrige Blüte
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.save();
    g.translate(cx, cx);
    g.rotate(a);
    g.fillStyle = "#d8e0dc";
    g.strokeStyle = "rgba(40,48,52,0.8)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(R * 0.13, R * 0.25, 0, R * 0.56);
    g.quadraticCurveTo(-R * 0.13, R * 0.25, 0, 0);
    g.fill();
    g.stroke();
    g.restore();
  }
  g.fillStyle = "#e8eeea";
  g.beginPath();
  g.arc(cx, cx, R * 0.1, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // Teamfarbene Rinne
  g.strokeStyle = team === 0 ? "rgba(90,200,255,0.9)" : "rgba(255,80,60,0.9)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(cx, cx, R * 0.7, 0, Math.PI * 2);
  g.stroke();
  // Moos
  const rnd = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 420; i++) {
    const a = rnd(i) * Math.PI * 2;
    const r = Math.pow(rnd(i + 99), 0.6) * R;
    const sz = 6 + rnd(i + 7) * 22;
    g.fillStyle = `rgba(${70 + rnd(i + 3) * 40},${115 + rnd(i + 5) * 45},${30 + rnd(i + 9) * 30},${0.18 + rnd(i + 11) * 0.28})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, sz * (r / R), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------- Startbasis aus dem 3D-Modell (assets-src/startbase.md -> startbase.glb) ----------------

type StartBaseAsset = { model: THREE.Object3D; materials: [THREE.Material, THREE.Material] };
let startBase: StartBaseAsset | null = null;
/**
 * Die runde Plattform liegt im Modell im Mittel bei y = 1.38 (gemessen über r < 4.75, die Rille um den Stern bei 1.34);
 * so weit absenken, dass sie wie früher bei 0.42 über dem Wurzelpunkt liegt. Dann bleibt sie überall knapp über dem
 * Boden (0.42 + 0.12 Wurzel), der unter der Basis liegt, und Champions stehen wie früher auf ihr.
 */
const START_BASE_SINK = 0.96;
/** Heilring auf dem Plattformboden direkt außerhalb der untersten Stufe (Boden 0.42, Wurzel 0.12). */
const START_BASE_RING = { r: 5.35, y: 0.33 };

/** Lädt die Startbasis einmalig. Bei einem Fehler bleibt die gebaute Ersatz-Basis. */
export async function loadStartBase(): Promise<boolean> {
  if (startBase) return true;
  let model: THREE.Object3D;
  let blue: THREE.MeshStandardMaterial;
  try {
    const gltf = await loadGlbOffline(startBaseUrl);
    model = gltf.scene;
    const mesh = model.getObjectByName("Base")?.getObjectByProperty("isMesh", true) as THREE.Mesh | undefined;
    if (!mesh) throw new Error("Startbasis-GLB benötigt das Mesh Base");
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat) throw new Error("Startbasis-Modell besitzt kein Material");
    blue = mat as THREE.MeshStandardMaterial;
  } catch (err) {
    console.error("Startbasis-GLB konnte nicht geladen werden, nutze Ersatzmodell:", err);
    return false;
  }
  if (blue.map) blue.map.anisotropy = 4;
  // Das Modell ist blau (Banner, Runen). Für das rote Team die blauen Flächen rot färben.
  const red = blue.clone();
  try {
    if (blue.map) red.map = withImage(blue.map, recolorBlueToRed(blue.map.image as CanvasImageSource & { width: number; height: number }));
  } catch (err) {
    console.warn("Umfärben der Startbasis nicht möglich, rote Basis bleibt blau:", err);
  }
  startBase = { model, materials: [blue, red] };
  return true;
}

/** Startbasis aus dem Modell. Vorne (offene Seite mit Treppe) = +z, wie beim gebauten Ersatz. */
function buildFountainModel(team: 0 | 1, asset: StartBaseAsset) {
  const root = new THREE.Group();
  const model = asset.model.clone(true);
  model.position.y = -START_BASE_SINK;
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = asset.materials[team];
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  root.add(model);
  // Heilring um die Plattform (lag vorher bei y = 0.06 unter der Plattform und war unsichtbar)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(START_BASE_RING.r, 0.07, 6, 64), new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team] }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = START_BASE_RING.y;
  root.add(ring);
  return root;
}

/** Färbt blaue und türkise Stoff- und Leuchtflächen (Banner, Runen, Kristalle, Stern) rot; Stein, Moos und Gold bleiben. */
function recolorBlueToRed(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("Kein 2D-Kontext");
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i];
    const gr = p[i + 1];
    const b = p[i + 2];
    // Anteil "Blau/Türkis" gegenüber Rot, weich ausgeblendet: graublauer Stein bleibt, Moos (Grün > Blau) auch
    const mx = Math.max(gr, b);
    const blue = Math.min(1, Math.max(0, ((mx - r) / (mx + 1) - 0.18) / 0.22));
    const notGreen = Math.min(1, Math.max(0, (b - gr * 0.82) / (b * 0.25 + 1)));
    const k = blue * notGreen;
    if (k <= 0) continue;
    p[i] = r + (Math.min(255, mx * 1.02) - r) * k;
    p[i + 1] = gr + (Math.min(r, gr) * 0.45 + r * 0.15 - gr) * k;
    p[i + 2] = b + (r * 0.55 + Math.min(r, b) * 0.2 - b) * k;
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** Startbasis: runde Plattform mit Stufen, Ruinenbögen mit Efeu, Wächterstatue. Vorne = +z. */
export function buildFountain(team: 0 | 1) {
  if (startBase) return buildFountainModel(team, startBase);
  const root = new THREE.Group();
  const col = TEAM_GLOW[team];
  const stone = 0x6e8a84;
  const stoneL = 0x8eaaa2;
  const stoneD = 0x4a5458;
  const wall = 0x2a3646;
  const ivy = [0x3d6e2a, 0x2f5a26, 0x4f8a30];
  const mat = statueMat();

  // Plattform mit Stufen und Emblem
  const steps: THREE.BufferGeometry[] = [colored(Cyl(9.0, 9.25, 0.16, 44), stoneD, mat4(0, 0.08, 0)), colored(Cyl(8.3, 8.45, 0.26, 44), stone, mat4(0, 0.13, 0))];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    steps.push(colored(Box(1.7, 0.27, 0.66), i % 2 ? stone : stoneL, trs(Math.sin(a) * 8.0, 0.14, Math.cos(a) * 8.0, a)));
  }
  const stepMesh = new THREE.Mesh(merge(steps), mat);
  stepMesh.receiveShadow = true;
  root.add(stepMesh);
  const sideMat = new THREE.MeshLambertMaterial({ color: stoneL });
  const topMat = new THREE.MeshLambertMaterial({ map: tex(emblemUrl) });
  void emblemTexture;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 0.42, 56), [sideMat, topMat, sideMat]);
  disc.position.y = 0.21;
  disc.receiveShadow = true;
  root.add(disc);

  // Ruinenbögen im Halbkreis hinten
  const P: THREE.BufferGeometry[] = [];
  const V: THREE.BufferGeometry[] = [];
  const R = 9.4;
  const n = 6;
  const angs: number[] = [];
  for (let i = 0; i < n; i++) angs.push(Math.PI + ((i / (n - 1)) * 2 - 1) * 1.75);
  const at = (a: number, r: number) => [Math.sin(a) * r, Math.cos(a) * r] as const;
  angs.forEach((a, i) => {
    const [x, z] = at(a, R);
    const broken = i === 0 || i === n - 1;
    const h = broken ? 3.2 : 5.6;
    P.push(colored(Box(1.3, 0.45, 1.3), stoneD, trs(x, 0.22, z, a)));
    const blocks = broken ? 3 : 5;
    for (let b = 0; b < blocks; b++) {
      P.push(colored(Box(0.95, h / blocks - 0.04, 0.95), b % 2 ? stone : stoneL, trs(x, 0.45 + (h / blocks) * (b + 0.5), z, a)));
    }
    if (broken) P.push(colored(new THREE.DodecahedronGeometry(0.55, 0), stoneL, mat4(x, h + 0.55, z, 1, 0.8, 1, 0.6, a, 0.3)));
    else P.push(colored(Box(1.3, 0.38, 1.3), stoneL, trs(x, h + 0.62, z, a)));
    // Efeu an den Säulen
    for (let k = 0; k < 5; k++) {
      const yy = 0.8 + ((k * 1.3) % h);
      V.push(colored(new THREE.IcosahedronGeometry(0.42 + (k % 3) * 0.12, 0), ivy[k % 3], mat4(x + Math.sin(a + k) * 0.45, yy, z + Math.cos(a + k) * 0.45)));
    }
  });
  for (let i = 1; i < n - 2; i++) {
    const a0 = angs[i];
    const a1 = angs[i + 1];
    const [x0, z0] = at(a0, R);
    const [x1, z1] = at(a1, R);
    const top = 6.3;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const apex = 8.9;
    const k1 = [x0 + (mx - x0) * 0.45, top + 1.75, z0 + (mz - z0) * 0.45] as const;
    const k2 = [x1 + (mx - x1) * 0.45, top + 1.75, z1 + (mz - z1) * 0.45] as const;
    P.push(segBox(x0, top, z0, k1[0], k1[1], k1[2], 0.8, 0.85, stone));
    P.push(segBox(k1[0], k1[1], k1[2], mx, apex, mz, 0.8, 0.85, stoneL));
    P.push(segBox(x1, top, z1, k2[0], k2[1], k2[2], 0.8, 0.85, stone));
    P.push(segBox(k2[0], k2[1], k2[2], mx, apex, mz, 0.8, 0.85, stoneL));
    P.push(colored(Box(0.9, 1.0, 0.95), stoneL, trs(mx, apex, mz, (a0 + a1) / 2)));
    // dunkle Rückwand
    const [wx, wz] = at((a0 + a1) / 2, R + 0.7);
    const chord = Math.hypot(x1 - x0, z1 - z0);
    P.push(colored(Box(chord, 7.6, 0.5), wall, trs(wx, 3.8, wz, (a0 + a1) / 2)));
    // Banner an der Rückwand (außen an der Mitte, innen an den Seiten)
    const ban = bannerMesh(team, 1.5, 3.4);
    const mid = (a0 + a1) / 2;
    const inner = i !== 2;
    const [bx, bz] = at(mid, R + (inner ? 0.42 : 1.0));
    ban.position.set(bx, 4.4, bz);
    ban.rotation.y = mid + (inner ? Math.PI : 0);
    root.add(ban);
    // hängende Ranken
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4;
      const vx = x0 + (x1 - x0) * t;
      const vz = z0 + (z1 - z0) * t;
      const len = 1.2 + ((k * 7 + i * 3) % 5) * 0.45;
      V.push(colored(Box(0.12, len, 0.12), ivy[(k + i) % 3], mat4(vx, top + 1.2 - len / 2 + Math.sin(t * Math.PI) * 1.3, vz)));
      V.push(colored(new THREE.IcosahedronGeometry(0.5, 0), ivy[(k + 1) % 3], mat4(vx, top + 1.5 + Math.sin(t * Math.PI) * 1.4, vz)));
    }
  }
  const ruins = new THREE.Mesh(merge(P), mat);
  ruins.castShadow = true;
  ruins.receiveShadow = true;
  root.add(ruins);
  const vines = new THREE.Mesh(merge(V), new THREE.MeshLambertMaterial({ vertexColors: true }));
  vines.castShadow = true;
  root.add(vines);

  // Wächterstatue hinten in der Mitte
  const S: THREE.BufferGeometry[] = [];
  const armor = 0x87919a;
  const armorD = 0x535d66;
  const gold = 0xcaa14c;
  const cape = team === 0 ? 0x2a3f7e : 0x7a2020;
  const sz = -5.9;
  S.push(colored(Cyl(1.5, 1.75, 0.7, 14), stoneD, mat4(0, 0.35, sz)));
  S.push(colored(Cyl(0.95, 1.35, 2.6, 12), armorD, mat4(0, 2.0, sz)));
  S.push(colored(Cyl(1.25, 1.0, 1.7, 12), armor, mat4(0, 3.95, sz)));
  S.push(colored(new THREE.TorusGeometry(1.05, 0.11, 6, 20), gold, mat4(0, 3.1, sz, 1, 1, 1, Math.PI / 2)));
  for (const sd of [-1, 1]) {
    S.push(colored(new THREE.DodecahedronGeometry(0.85, 0), armor, mat4(1.3 * sd, 4.55, sz, 1.15, 0.8, 1.05, 0.2, 0.3 * sd, 0)));
    S.push(colored(new THREE.TorusGeometry(0.82, 0.08, 6, 18), gold, mat4(1.25 * sd, 4.5, sz, 1.1, 1, 1, Math.PI / 2)));
    // Arme nach vorn ausgebreitet
    S.push(segBox(1.35 * sd, 4.3, sz, 1.95 * sd, 3.4, sz + 1.1, 0.42, 0.42, armor));
    S.push(colored(new THREE.SphereGeometry(0.3, 8, 6), armorD, mat4(2.05 * sd, 3.3, sz + 1.25)));
  }
  S.push(colored(new THREE.SphereGeometry(0.6, 12, 8), armorD, mat4(0, 5.25, sz)));
  S.push(colored(new THREE.ConeGeometry(0.55, 1.6, 8), gold, mat4(0, 6.2, sz - 0.05)));
  S.push(colored(Box(0.75, 0.5, 0.2), 0x15181c, mat4(0, 5.2, sz + 0.52)));
  S.push(colored(Box(2.4, 4.4, 0.14), cape, trs(0, 3.0, sz - 1.0, 0, -0.08)));
  const statue = new THREE.Mesh(merge(S), mat);
  statue.castShadow = true;
  root.add(statue);
  for (const sd of [-1, 1]) {
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), new THREE.MeshBasicMaterial({ color: col }));
    orb.position.set(2.05 * sd, 3.75, sz + 1.3);
    root.add(orb);
    const g = glowSprite(col, 2.2, 0.8);
    g.position.copy(orb.position);
    root.add(g);
  }
  // Heilring am Plattformrand
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.25, 0.07, 6, 64), new THREE.MeshBasicMaterial({ color: col }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.44;
  root.add(ring);
  return root;
}

// ---------------- Turm aus dem 3D-Modell (assets-src/guardian.py -> guardian.glb) ----------------

type GuardianAsset = {
  statue: THREE.Mesh;
  staff: THREE.Object3D;
  materials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  /** Statue mit geglätteten Normalen für den Umriss */
  outlineGeo: THREE.BufferGeometry;
};
let guardian: GuardianAsset | null = null;

/**
 * Lädt die Wächterstatue einmalig. Muss vor dem Aufbau der Szene fertig sein.
 * Nur ein Fehler am GLB selbst führt zum Ersatzmodell; die blaue Textur ist optional.
 */
export async function loadGuardian(): Promise<boolean> {
  if (guardian) return true;
  let statue: THREE.Mesh;
  let staff: THREE.Object3D;
  let red: THREE.MeshStandardMaterial;
  try {
    const gltf = await loadGlbOffline(guardianUrl);
    const s = gltf.scene.getObjectByName("Statue") as THREE.Mesh | undefined;
    const st = gltf.scene.getObjectByName("Staff");
    if (!s?.isMesh || !st || !st.getObjectByName("Crystal")) throw new Error("GLB benötigt die Meshes Statue, Staff und Crystal");
    const mat = Array.isArray(s.material) ? s.material[0] : s.material;
    if (!mat) throw new Error("Wächtermodell besitzt kein Material");
    statue = s;
    staff = st;
    red = mat as THREE.MeshStandardMaterial;
  } catch (err) {
    console.error("Wächter-GLB konnte nicht geladen werden, nutze Ersatzmodell:", err);
    return false;
  }
  // Ab hier ist das Modell da und bleibt es, egal ob die blaue Textur klappt
  const blue = red.clone();
  blue.map = await blueGuardianMap(red.map);
  for (const m of [red, blue]) {
    if (m.map) m.map.anisotropy = 4;
    markSilhouette(m);
  }
  guardian = { statue, staff, materials: [blue, red], outlineGeo: smoothOutlineGeometry(statue.geometry) };
  return true;
}

/**
 * GLB laden, ohne das Netzwerk zu benutzen. In abgeschotteten Umgebungen (z. B. der Vorschau in der
 * Claude-App) sind fetch() und blob:-Bilder gesperrt, data:-Bilder aber erlaubt. Deshalb: eingebettete
 * Datei selbst dekodieren, Texturen als data:-Bilder einsetzen und über <img> laden lassen.
 */
async function loadGlbOffline(url: string) {
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: "kluft_img_textures" };
  });
  if (!url.startsWith("data:")) return loader.loadAsync(url);
  const glb = base64ToBytes(url.slice(url.indexOf(",") + 1));
  return loader.parseAsync(inlineGlbImages(glb).buffer as ArrayBuffer, "");
}

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Schreibt die Bilder eines GLB als data:-URI in dessen JSON-Teil und baut das GLB neu zusammen. */
function inlineGlbImages(glb: Uint8Array) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Keine GLB-Datei");
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const binStart = 20 + jsonLen;
  const binLen = view.getUint32(binStart, true);
  const bin = glb.subarray(binStart + 8, binStart + 8 + binLen);
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined) continue;
    const bv = json.bufferViews[img.bufferView];
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    img.uri = `data:${img.mimeType ?? "image/jpeg"};base64,${bytesToBase64(bytes)}`;
    delete img.bufferView;
  }
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) {
    const t = new Uint8Array(text.length + pad).fill(0x20);
    t.set(text);
    text = t;
  }
  const total = 12 + 8 + text.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, 0x46546c67, true);
  ov.setUint32(4, 2, true);
  ov.setUint32(8, total, true);
  ov.setUint32(12, text.length, true);
  ov.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  ov.setUint32(20 + text.length, bin.length, true);
  ov.setUint32(24 + text.length, 0x004e4942, true);
  out.set(bin, 28 + text.length);
  return out;
}

/** Blaue Team-Textur: erst die mitgelieferte Datei, sonst die rote GLB-Textur umfärben, sonst die rote behalten. */
async function blueGuardianMap(redMap: THREE.Texture | null): Promise<THREE.Texture | null> {
  try {
    const img = await new THREE.ImageLoader().loadAsync(guardianBlueUrl);
    return withImage(redMap, img);
  } catch (err) {
    console.warn("Blaue Wächtertextur nicht verfügbar, färbe die GLB-Textur um:", err);
  }
  if (!redMap) return null;
  try {
    return withImage(redMap, recolorRedToBlue(redMap.image as CanvasImageSource & { width: number; height: number }));
  } catch (err) {
    console.warn("Umfärben nicht möglich, blaue Türme behalten die GLB-Textur:", err);
    return redMap;
  }
}

/** Neue Textur mit eigenem Bild, aber denselben Einstellungen (UV-Kanal, Wrap, flipY) wie die GLB-Textur. */
function withImage(like: THREE.Texture | null, img: TexImageSource): THREE.Texture {
  const t = like ? like.clone() : new THREE.Texture();
  t.source = new THREE.TextureSource(img);
  if (!like) {
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  t.needsUpdate = true;
  return t;
}

/** Färbt die roten Stoffflächen blau, Stahl, Gold und Stein bleiben wie sie sind. */
function recolorRedToBlue(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("Kein 2D-Kontext");
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i];
    const gr = p[i + 1];
    const b = p[i + 2];
    // Anteil "Rot", weich ausgeblendet, damit Gold (r > g > b) unberührt bleibt
    const k = Math.min(1, (r - Math.max(gr, b) * 1.3) / (r * 0.3 + 1));
    if (k <= 0) continue;
    p[i] = r + (b - r) * k;
    p[i + 1] = gr + (Math.min(255, gr * 1.9) - gr) * k;
    p[i + 2] = b + (r * 0.93 - b) * k;
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** Metall braucht eine Umgebung zum Spiegeln, sonst wirkt es schwarz. Einmal pro Renderer aufrufen. */
export function setGuardianEnvironment(renderer: THREE.WebGLRenderer) {
  if (!guardian) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  for (const m of guardian.materials) {
    m.envMap = env;
    m.envMapIntensity = 0.55;
    m.needsUpdate = true;
  }
}

export function guardianLoaded() {
  return guardian !== null;
}

export function buildTurret(team: 0 | 1): StructModel {
  if (!guardian) return buildTurretProcedural(team);
  const root = new THREE.Group();
  const top = new THREE.Group();
  root.add(top);

  const statue = new THREE.Mesh(guardian.statue.geometry, guardian.materials[team]);
  statue.castShadow = true;
  statue.receiveShadow = true;
  top.add(statue);

  const staff = guardian.staff.clone(true);
  staff.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      if (m.name !== "Crystal") m.material = guardian!.materials[team];
    }
  });
  top.add(staff);
  const crystal = staff.getObjectByName("Crystal") as THREE.Mesh;
  crystal.material = markSilhouette(gemMat(team));
  const crystalY = crystal.position.y;
  const glow = glowSprite(TEAM_GLOW[team], 3.8, 0.85);
  glow.position.copy(crystal.position);
  staff.add(glow);

  // leuchtender Ring in Teamfarbe am Fuß der Figur
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.05, 6, 48), new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team] }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.57;
  top.add(ring);

  const C = { stone: 0x44484e, stoneL: 0x5c6168, armorD: 0x34373c, armor: 0x4a4e55 };
  const mat = statueMat();
  const rubble = new THREE.Mesh(
    merge([
      colored(Cyl(2.75, 2.95, 0.45, 24), C.stone, mat4(0, 0.22, 0)),
      colored(Cyl(1.9, 2.3, 0.9, 16), C.stoneL, mat4(0, 0.85, 0)),
      colored(Cyl(0.9, 1.2, 1.1, 10), C.armorD, mat4(0, 1.8, 0)),
      colored(new THREE.DodecahedronGeometry(0.8, 0), C.armor, mat4(1.6, 1.0, 0.9, 1, 0.7, 1, 0.4, 0.2)),
      colored(new THREE.DodecahedronGeometry(0.6, 0), C.stoneL, mat4(-1.4, 0.9, -0.8, 1, 0.8, 1, 0.1, 1.1)),
      colored(new THREE.DodecahedronGeometry(0.5, 0), C.armorD, mat4(-0.6, 0.8, 1.9, 1, 0.6, 1, 0.9, 0.3)),
    ]),
    mat,
  );
  rubble.visible = false;
  rubble.castShadow = true;
  root.add(rubble);

  const outline = silhouetteOutline(guardian.outlineGeo, 0xff2a1a, 0.07);
  top.add(outline);
  return { root, crystal, glow, top, rubble, crystalY, staff, outline };
}
