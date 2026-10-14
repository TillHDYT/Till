import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Look } from "./champions";
import type { CampKind } from "./mapdata";
import { colored, mat4 } from "./terrain";
import detailUrl from "../assets/detail.jpg";
import bannerRedUrl from "../assets/banner_red.png";
import bannerBlueUrl from "../assets/banner_blue.png";
import emblemUrl from "../assets/emblem.jpg";

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
};

export function buildChampion(look: Look, ringColor: number): ChampModel {
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
        colored(new THREE.CylinderGeometry(0.15, 0.12, 0.85, 6), look.body, mat4(0, -0.45, 0)),
        colored(new THREE.BoxGeometry(0.26, 0.16, 0.42), 0x3a2a1e, mat4(0, -0.88, 0.08)),
      ]),
    );
    body.add(g);
    return g;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // Rumpf
  const torso: THREE.BufferGeometry[] = [
    colored(new THREE.CylinderGeometry(0.42, 0.34, 0.9, 8), look.body, mat4(0, 1.42, 0)),
    colored(new THREE.CylinderGeometry(0.37, 0.37, 0.14, 8), look.accent, mat4(0, 1.02, 0)),
    colored(new THREE.SphereGeometry(0.22, 8, 6), look.accent, mat4(-0.46, 1.82, 0)),
    colored(new THREE.SphereGeometry(0.22, 8, 6), look.accent, mat4(0.46, 1.82, 0)),
    // Kopf
    colored(new THREE.SphereGeometry(0.3, 10, 8), look.skin, mat4(0, 2.15, 0.02)),
    colored(new THREE.SphereGeometry(0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), look.hair, mat4(0, 2.2, -0.03)),
    colored(new THREE.BoxGeometry(0.08, 0.05, 0.04), 0x1a1a1a, mat4(-0.1, 2.18, 0.28)),
    colored(new THREE.BoxGeometry(0.08, 0.05, 0.04), 0x1a1a1a, mat4(0.1, 2.18, 0.28)),
  ];
  if (robe) torso.push(colored(new THREE.ConeGeometry(0.62, 1.25, 10, 1, true), look.cape ?? look.body, mat4(0, 0.62, 0)));
  if (look.cape !== undefined && !robe) torso.push(colored(new THREE.BoxGeometry(0.75, 1.3, 0.06), look.cape, mat4(0, 1.2, -0.36, 1, 1, 1, 0.18)));
  if (look.weapon === "daggers") torso.push(colored(new THREE.ConeGeometry(0.36, 0.5, 8), look.cape ?? look.body, mat4(0, 2.38, -0.05)));
  if (look.weapon === "hammer") torso.push(colored(new THREE.BoxGeometry(0.9, 0.3, 0.55), look.accent, mat4(0, 1.75, 0)));
  if (look.weapon === "bow") torso.push(colored(new THREE.ConeGeometry(0.34, 0.3, 8), look.cape ?? look.accent, mat4(0, 2.42, -0.02)));
  body.add(mesh(torso));

  // Arme
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.55 * side, 1.8, 0);
    g.add(
      mesh([
        colored(new THREE.CylinderGeometry(0.11, 0.1, 0.75, 6), look.body, mat4(0, -0.38, 0)),
        colored(new THREE.SphereGeometry(0.12, 6, 5), look.skin, mat4(0, -0.8, 0)),
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
          colored(new THREE.BoxGeometry(0.14, 1.5, 0.05), 0xd8dde6, mat4(0, 0.15, 0.75, 1, 1, 1, Math.PI / 2)),
          colored(new THREE.BoxGeometry(0.5, 0.08, 0.1), look.accent, mat4(0, 0, 0.05)),
          colored(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 5), 0x4a2e1c, mat4(0, 0, -0.12, 1, 1, 1, Math.PI / 2)),
        ]),
      );
      break;
    case "bow": {
      const arc = new THREE.TorusGeometry(0.75, 0.05, 5, 14, Math.PI);
      handL.add(mesh([colored(arc, 0x8fd0ff, mat4(0, 0, 0.1, 1, 1, 1, 0, Math.PI / 2, Math.PI / 2)), colored(new THREE.CylinderGeometry(0.01, 0.01, 1.5, 3), 0xffffff, mat4(0, 0, -0.05, 1, 1, 1, Math.PI / 2))]));
      const g = glowSprite(0x9fe0ff, 0.9, 0.6);
      g.position.set(0, 0, 0.1);
      handL.add(g);
      glow = g;
      break;
    }
    case "staff": {
      hand.add(mesh([colored(new THREE.CylinderGeometry(0.05, 0.06, 2.0, 5), 0x5a3a24, mat4(0, 0.5, 0))]));
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
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
        h.add(mesh([colored(new THREE.ConeGeometry(0.07, 0.75, 4), 0xd8c8ff, mat4(0, 0, 0.35, 1, 1, 1, Math.PI / 2))]));
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
          colored(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5), 0x4a3424, mat4(0, 0.3, 0)),
          colored(new THREE.BoxGeometry(0.55, 0.45, 0.75), 0x8a8f96, mat4(0, 1.1, 0)),
          colored(new THREE.BoxGeometry(0.58, 0.12, 0.78), look.accent, mat4(0, 1.1, 0)),
        ]),
      );
      handL.add(mesh([colored(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10), 0x6f7880, mat4(0, 0.1, 0.12, 1, 1, 1, Math.PI / 2)), colored(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 8), look.accent, mat4(0, 0.1, 0.2, 1, 1, 1, Math.PI / 2))]));
      break;
  }

  body.scale.setScalar(b);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.12, 32),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 3;
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
    parts.push(colored(new THREE.CylinderGeometry(0.34, 0.3, 0.7, 7), main, mat4(0, 0.75, 0)));
    parts.push(colored(new THREE.SphereGeometry(0.26, 8, 6), skin, mat4(0, 1.3, 0)));
    parts.push(colored(new THREE.SphereGeometry(0.29, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), dark, mat4(0, 1.35, 0)));
    parts.push(colored(new THREE.ConeGeometry(0.07, 0.3, 4), trim, mat4(0, 1.7, 0)));
    parts.push(colored(new THREE.BoxGeometry(0.1, 0.55, 0.45), dark, mat4(-0.38, 0.85, 0.1)));
    parts.push(colored(new THREE.BoxGeometry(0.06, 0.75, 0.1), 0xd0d4dc, mat4(0.38, 0.95, 0.25, 1, 1, 1, 0.5)));
    parts.push(colored(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 5), dark, mat4(-0.13, 0.22, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 5), dark, mat4(0.13, 0.22, 0)));
  } else if (type === "caster") {
    parts.push(colored(new THREE.ConeGeometry(0.42, 1.0, 8), main, mat4(0, 0.5, 0)));
    parts.push(colored(new THREE.SphereGeometry(0.24, 8, 6), skin, mat4(0, 1.12, 0)));
    parts.push(colored(new THREE.ConeGeometry(0.3, 0.55, 8), dark, mat4(0, 1.42, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 4), 0x5a3a24, mat4(0.35, 0.8, 0.15)));
    parts.push(colored(new THREE.OctahedronGeometry(0.13, 0), trim, mat4(0.35, 1.5, 0.15)));
  } else if (type === "siege") {
    parts.push(colored(new THREE.BoxGeometry(1.2, 0.55, 1.4), dark, mat4(0, 0.6, 0)));
    for (const sx of [-0.65, 0.65]) for (const sz of [-0.45, 0.45]) parts.push(colored(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 10), 0x4a3424, mat4(sx, 0.3, sz, 1, 1, 1, 0, 0, Math.PI / 2)));
    parts.push(colored(new THREE.CylinderGeometry(0.2, 0.26, 1.2, 8), 0x444a52, mat4(0, 1.05, 0.35, 1, 1, 1, Math.PI / 2 - 0.35)));
    parts.push(colored(new THREE.BoxGeometry(0.9, 0.12, 1.2), main, mat4(0, 0.92, -0.05)));
    parts.push(colored(new THREE.SphereGeometry(0.22, 8, 6), trim, mat4(0, 1.15, -0.4)));
  } else {
    parts.push(colored(new THREE.BoxGeometry(1.1, 1.1, 0.8), main, mat4(0, 1.5, 0)));
    parts.push(colored(new THREE.SphereGeometry(0.35, 8, 6), dark, mat4(0, 2.25, 0.1)));
    parts.push(colored(new THREE.BoxGeometry(0.4, 1.2, 0.4), dark, mat4(-0.8, 1.35, 0.1, 1, 1, 1, 0.2)));
    parts.push(colored(new THREE.BoxGeometry(0.45, 1.25, 0.45), dark, mat4(0.82, 1.35, 0.1, 1, 1, 1, 0.3)));
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.2, 0.9, 6), dark, mat4(-0.3, 0.45, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.2, 0.9, 6), dark, mat4(0.3, 0.45, 0)));
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
      P.push(colored(new THREE.DodecahedronGeometry(1.1, 0), stone, mat4(0, 1.6, 0, 1.1, 1, 0.9)));
      P.push(colored(new THREE.DodecahedronGeometry(0.55, 0), stone, mat4(0, 2.75, 0.3)));
      P.push(colored(new THREE.BoxGeometry(0.5, 1.4, 0.5), stone, mat4(-1.25, 1.4, 0.2, 1, 1, 1, 0.3, 0, 0.3)));
      P.push(colored(new THREE.BoxGeometry(0.5, 1.4, 0.5), stone, mat4(1.25, 1.4, 0.2, 1, 1, 1, 0.3, 0, -0.3)));
      P.push(colored(new THREE.CylinderGeometry(0.3, 0.35, 0.9, 6), stone, mat4(-0.5, 0.45, 0)));
      P.push(colored(new THREE.CylinderGeometry(0.3, 0.35, 0.9, 6), stone, mat4(0.5, 0.45, 0)));
      root.add(mesh(P));
      const cr = new THREE.Mesh(
        merge([
          colored(new THREE.OctahedronGeometry(0.4, 0), crystal, mat4(0, 2.3, -0.6, 1, 1.8, 1)),
          colored(new THREE.OctahedronGeometry(0.3, 0), crystal, mat4(-0.6, 2.2, -0.5, 1, 1.6, 1, 0, 0, 0.4)),
          colored(new THREE.OctahedronGeometry(0.3, 0), crystal, mat4(0.6, 2.2, -0.5, 1, 1.6, 1, 0, 0, -0.4)),
          colored(new THREE.SphereGeometry(0.1, 6, 4), 0xffffff, mat4(-0.18, 2.85, 0.75)),
          colored(new THREE.SphereGeometry(0.1, 6, 4), 0xffffff, mat4(0.18, 2.85, 0.75)),
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
      P.push(colored(new THREE.SphereGeometry(1.1, 10, 8), 0x5f8a3a, mat4(0, 1.0, 0, 1, 0.8, 1.1)));
      P.push(colored(new THREE.SphereGeometry(0.75, 10, 8), 0xc0c070, mat4(0, 0.85, 0.45, 1, 0.7, 1)));
      P.push(colored(new THREE.SphereGeometry(0.28, 8, 6), 0xffe060, mat4(-0.45, 1.7, 0.55)));
      P.push(colored(new THREE.SphereGeometry(0.28, 8, 6), 0xffe060, mat4(0.45, 1.7, 0.55)));
      P.push(colored(new THREE.SphereGeometry(0.12, 6, 4), 0x111111, mat4(-0.45, 1.72, 0.8)));
      P.push(colored(new THREE.SphereGeometry(0.12, 6, 4), 0x111111, mat4(0.45, 1.72, 0.8)));
      for (const s of [-1, 1]) P.push(colored(new THREE.SphereGeometry(0.4, 8, 6), 0x4f7a2e, mat4(0.9 * s, 0.35, 0.4, 1, 0.5, 1.4)));
      root.add(mesh(P));
      break;
    case "wolves": {
      const c = big ? 0x4a4f5a : 0x5c6270;
      P.push(colored(new THREE.BoxGeometry(0.7, 0.65, 1.5), c, mat4(0, 0.95, 0)));
      P.push(colored(new THREE.BoxGeometry(0.55, 0.5, 0.7), c, mat4(0, 1.25, 0.95)));
      P.push(colored(new THREE.ConeGeometry(0.15, 0.35, 4), c, mat4(-0.18, 1.6, 0.85)));
      P.push(colored(new THREE.ConeGeometry(0.15, 0.35, 4), c, mat4(0.18, 1.6, 0.85)));
      P.push(colored(new THREE.SphereGeometry(0.07, 5, 4), 0x80e0ff, mat4(-0.15, 1.35, 1.3)));
      P.push(colored(new THREE.SphereGeometry(0.07, 5, 4), 0x80e0ff, mat4(0.15, 1.35, 1.3)));
      for (const sx of [-0.25, 0.25]) for (const sz of [-0.5, 0.5]) P.push(colored(new THREE.CylinderGeometry(0.1, 0.08, 0.7, 5), c, mat4(sx, 0.35, sz)));
      P.push(colored(new THREE.ConeGeometry(0.15, 0.8, 5), c, mat4(0, 1.05, -0.95, 1, 1, 1, -1.9)));
      root.add(mesh(P));
      root.scale.setScalar(big ? 1.25 : 0.85);
      break;
    }
    case "raptors": {
      const c = big ? 0xd0582a : 0xe07a3a;
      P.push(colored(new THREE.SphereGeometry(0.6, 8, 6), c, mat4(0, 1.0, 0, 0.9, 0.9, 1.3)));
      P.push(colored(new THREE.CylinderGeometry(0.15, 0.2, 0.8, 5), c, mat4(0, 1.5, 0.55, 1, 1, 1, 0.7)));
      P.push(colored(new THREE.SphereGeometry(0.28, 8, 6), c, mat4(0, 1.9, 0.85)));
      P.push(colored(new THREE.ConeGeometry(0.12, 0.45, 4), 0xf0d090, mat4(0, 1.85, 1.2, 1, 1, 1, Math.PI / 2)));
      P.push(colored(new THREE.ConeGeometry(0.3, 0.6, 5), 0xa03a20, mat4(0, 1.3, -0.4, 1, 1, 1, -0.6)));
      for (const s of [-1, 1]) P.push(colored(new THREE.CylinderGeometry(0.07, 0.05, 0.8, 4), 0xf0d090, mat4(0.25 * s, 0.4, 0)));
      root.add(mesh(P));
      root.scale.setScalar(big ? 1.1 : 0.7);
      break;
    }
    case "krugs": {
      const c = 0x7a6a58;
      P.push(colored(new THREE.DodecahedronGeometry(0.9, 0), c, mat4(0, 1.1, 0, 1.1, 1, 1)));
      P.push(colored(new THREE.DodecahedronGeometry(0.4, 0), 0x6a5a48, mat4(-0.9, 0.9, 0.3)));
      P.push(colored(new THREE.DodecahedronGeometry(0.4, 0), 0x6a5a48, mat4(0.9, 0.9, 0.3)));
      P.push(colored(new THREE.SphereGeometry(0.1, 5, 4), 0xffb040, mat4(-0.25, 1.4, 0.85)));
      P.push(colored(new THREE.SphereGeometry(0.1, 5, 4), 0xffb040, mat4(0.25, 1.4, 0.85)));
      root.add(mesh(P));
      root.scale.setScalar(big ? 1.3 : 0.85);
      break;
    }
    case "scuttle":
      P.push(colored(new THREE.SphereGeometry(0.9, 10, 6), 0x3aa0a0, mat4(0, 0.6, 0, 1.2, 0.5, 1)));
      P.push(colored(new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x6ad0c0, mat4(0, 0.75, 0, 1.1, 0.8, 0.9)));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        P.push(colored(new THREE.CylinderGeometry(0.06, 0.04, 0.8, 4), 0x2a7070, mat4(Math.cos(a) * 0.9, 0.3, Math.sin(a) * 0.7, 1, 1, 1, Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8)));
      }
      P.push(colored(new THREE.SphereGeometry(0.1, 5, 4), 0x111111, mat4(-0.2, 0.9, 0.75)));
      P.push(colored(new THREE.SphereGeometry(0.1, 5, 4), 0x111111, mat4(0.2, 0.9, 0.75)));
      root.add(mesh(P));
      break;
    case "dragon": {
      const c = 0xc8501e;
      const w = 0x8a2a14;
      P.push(colored(new THREE.SphereGeometry(1.4, 10, 8), c, mat4(0, 2.0, 0, 1, 0.9, 1.5)));
      P.push(colored(new THREE.CylinderGeometry(0.4, 0.6, 1.6, 7), c, mat4(0, 3.0, 1.4, 1, 1, 1, 0.8)));
      P.push(colored(new THREE.BoxGeometry(0.8, 0.6, 1.3), c, mat4(0, 3.7, 2.1)));
      P.push(colored(new THREE.ConeGeometry(0.15, 0.7, 4), 0xf0e0c0, mat4(-0.3, 4.2, 1.8, 1, 1, 1, -0.6)));
      P.push(colored(new THREE.ConeGeometry(0.15, 0.7, 4), 0xf0e0c0, mat4(0.3, 4.2, 1.8, 1, 1, 1, -0.6)));
      P.push(colored(new THREE.SphereGeometry(0.1, 5, 4), 0xffee60, mat4(-0.3, 3.85, 2.75)));
      P.push(colored(new THREE.SphereGeometry(0.1, 5, 4), 0xffee60, mat4(0.3, 3.85, 2.75)));
      P.push(colored(new THREE.ConeGeometry(0.5, 3, 7), c, mat4(0, 1.6, -2.4, 1, 1, 1, -1.7)));
      for (const s of [-1, 1]) {
        P.push(colored(new THREE.ConeGeometry(1.6, 0.1, 3), w, mat4(2.0 * s, 3.2, -0.2, 1.6, 1, 1, 0, 0, s * 0.4)));
        P.push(colored(new THREE.CylinderGeometry(0.25, 0.2, 1.4, 5), c, mat4(0.8 * s, 0.7, 0.6)));
        P.push(colored(new THREE.CylinderGeometry(0.25, 0.2, 1.4, 5), c, mat4(0.8 * s, 0.7, -0.6)));
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
        P.push(colored(new THREE.SphereGeometry(1.5 - t * 0.6, 10, 8), i % 2 ? c : l, mat4(Math.sin(t * 2) * 0.6, 0.8 + t * 4.5, -1.2 + t * 1.8)));
      }
      P.push(colored(new THREE.BoxGeometry(1.6, 1.0, 1.8), c, mat4(0.5, 6.0, 1.4)));
      P.push(colored(new THREE.ConeGeometry(0.25, 1.4, 5), 0xe8d8ff, mat4(-0.2, 6.9, 0.9, 1, 1, 1, -0.4, 0, 0.3)));
      P.push(colored(new THREE.ConeGeometry(0.25, 1.4, 5), 0xe8d8ff, mat4(1.2, 6.9, 0.9, 1, 1, 1, -0.4, 0, -0.3)));
      P.push(colored(new THREE.SphereGeometry(0.16, 6, 4), 0xff70ff, mat4(0.1, 6.2, 2.3)));
      P.push(colored(new THREE.SphereGeometry(0.16, 6, 4), 0xff70ff, mat4(0.9, 6.2, 2.3)));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        P.push(colored(new THREE.ConeGeometry(0.3, 2.2, 5), l, mat4(Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2, 1, 1, 1, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)));
      }
      root.add(mesh(P));
      glow = glowSprite(0xb050ff, 7, 0.35);
      glow.position.y = 4;
      root.add(glow);
      break;
    }
  }
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

const Cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const Box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Größe der Wächterstatue relativ zum Sockel. */
export const TURRET_STATUE_SCALE = 1.35;

/** Turm: humanoide Wächterstatue auf rundem Sockel (Entwurf aus der überarbeiteten Version). */
export function buildTurret(team: 0 | 1): StructModel {
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
  const g = glowSprite(0xff8a30, 3.2, 0.7);
  g.position.y = 2.8;
  root.add(g);
  // Flamme: zwei additive Kegel, die flackern
  const flame = new THREE.Group();
  flame.position.y = 2.42;
  const fm = (color: number, r: number, h: number, o: number) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    c.position.y = h / 2;
    flame.add(c);
  };
  fm(0xff5a10, 0.62, 1.6, 0.55);
  fm(0xffc040, 0.36, 1.05, 0.75);
  root.add(flame);
  return { root, fireY: 2.5, glow: g, flame };
}

export function buildNexus(team: 0 | 1): StructModel {
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

/** Startbasis: runde Plattform mit Stufen, Ruinenbögen mit Efeu, Wächterstatue. Vorne = +z. */
export function buildFountain(team: 0 | 1) {
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
