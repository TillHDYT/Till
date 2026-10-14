import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Look } from "./champions";
import type { CampKind } from "./mapdata";
import { colored, mat4 } from "./terrain";
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

function crystalMat(team: 0 | 1) {
  return new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team] });
}

/** Facettierter, leuchtender Edelstein. */
function gemMat(team: 0 | 1, opacity = 1) {
  return new THREE.MeshPhongMaterial({
    color: team === 0 ? 0x7fd4ff : 0xff3020,
    emissive: team === 0 ? 0x1a78e0 : 0xc80c0c,
    emissiveIntensity: 1,
    specular: 0xffffff,
    shininess: 90,
    flatShading: true,
    transparent: opacity < 1,
    opacity,
  });
}

const statueMat = () => new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 34, specular: 0x3c3c3c });
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

export function buildTurret(team: 0 | 1): StructModel {
  const root = new THREE.Group();
  const C = {
    stoneD: 0x343a3e,
    stone: 0x535b61,
    stoneL: 0x6c747a,
    armor: 0x8f989f,
    armorD: 0x59626a,
    gold: 0xcaa14c,
    goldD: 0x8a6a2e,
    dark: 0x14171b,
    pole: 0x3a3530,
    cape: team === 0 ? 0x22407e : 0x701c1c,
    inlay: team === 0 ? 0x46b4ff : 0xff3a26,
  };
  const mat = statueMat();

  // Sockel aus Mauerwerk
  const baseParts: THREE.BufferGeometry[] = [
    colored(Cyl(2.6, 2.85, 0.5, 20), C.stoneD, mat4(0, 0.25, 0)),
    colored(Cyl(2.35, 2.5, 0.5, 20), C.stone, mat4(0, 0.75, 0)),
    colored(Cyl(1.95, 2.0, 0.16, 20), C.stoneD, mat4(0, 1.06, 0)),
  ];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    baseParts.push(colored(Box(1.28, 0.34, 0.5), i % 2 ? C.stone : C.stoneL, trs(Math.sin(a) * 2.2, 1.13, Math.cos(a) * 2.2, a)));
  }
  const baseGeo = merge(baseParts);
  const base = new THREE.Mesh(baseGeo, mat);
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const top = new THREE.Group();
  root.add(top);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.82, 0.07, 6, 40), crystalMat(team));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.16;
  top.add(ring);

  // Statue
  const body: THREE.BufferGeometry[] = [];
  body.push(colored(Cyl(1.3, 1.6, 2.5, 14), C.armorD, mat4(0, 2.35, 0)));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    body.push(colored(Box(0.72, 2.25, 0.16), C.armor, trs(Math.sin(a) * 1.5, 2.3, Math.cos(a) * 1.5, a, -0.06)));
    body.push(colored(Box(0.74, 0.14, 0.2), C.gold, trs(Math.sin(a) * 1.55, 1.22, Math.cos(a) * 1.55, a)));
  }
  body.push(colored(new THREE.TorusGeometry(1.36, 0.13, 6, 24), C.gold, mat4(0, 3.55, 0, 1, 1, 1, Math.PI / 2)));
  body.push(colored(Cyl(1.62, 1.36, 1.9, 14), C.armor, mat4(0, 4.5, 0)));
  body.push(colored(Box(1.15, 1.25, 0.3), C.armorD, mat4(0, 4.55, 1.32)));
  body.push(colored(new THREE.OctahedronGeometry(0.42, 0), C.gold, mat4(0, 4.75, 1.5, 1, 1.25, 0.45)));
  body.push(colored(new THREE.TorusGeometry(1.6, 0.1, 6, 24), C.gold, mat4(0, 5.42, 0, 1, 1, 1, Math.PI / 2)));
  for (const sd of [-1, 1]) {
    body.push(colored(new THREE.SphereGeometry(1.0, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), C.armor, mat4(1.55 * sd, 5.15, 0, 1.15, 0.95, 1.08)));
    body.push(colored(new THREE.TorusGeometry(0.98, 0.09, 6, 22), C.gold, mat4(1.55 * sd, 5.12, 0, 1.15, 1, 1.08, Math.PI / 2)));
    body.push(colored(new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), C.gold, mat4(1.68 * sd, 5.72, 0, 1, 0.8, 1)));
    body.push(colored(new THREE.ConeGeometry(0.16, 0.7, 5), C.goldD, mat4(2.15 * sd, 5.85, -0.1, 1, 1, 1, 0, 0, -0.9 * sd)));
  }
  // Kopf mit Kapuze und goldenem Gesichtsring
  body.push(colored(new THREE.SphereGeometry(0.95, 14, 10), C.armorD, mat4(0, 6.4, -0.12, 1, 1.12, 1.08)));
  body.push(colored(new THREE.ConeGeometry(0.62, 0.95, 10), C.armorD, mat4(0, 7.2, -0.42, 1, 1, 1, -0.55)));
  body.push(colored(new THREE.SphereGeometry(0.62, 12, 8), C.dark, mat4(0, 6.22, 0.42, 0.85, 1.05, 0.7)));
  body.push(colored(Box(1.0, 0.2, 0.3), C.gold, trs(0, 6.78, 0.68, 0, 0.35)));
  body.push(colored(Box(0.22, 0.62, 0.22), C.gold, trs(0, 6.25, 0.86, 0, 0.2)));
  body.push(colored(Box(0.18, 0.75, 0.24), C.gold, trs(-0.46, 6.15, 0.62, -0.5, 0, 1, 1, 1, 0.25)));
  body.push(colored(Box(0.18, 0.75, 0.24), C.gold, trs(0.46, 6.15, 0.62, 0.5, 0, 1, 1, 1, -0.25)));
  body.push(colored(new THREE.ConeGeometry(0.17, 0.6, 5), C.gold, mat4(0, 7.0, 0.62, 1, 1, 1, 0.35)));
  // Umhang
  body.push(colored(Box(2.6, 4.8, 0.14), C.cape, trs(0, 3.4, -1.38, 0, -0.1)));
  // linker Arm hinter dem Schild
  body.push(colored(Cyl(0.36, 0.32, 1.6, 8), C.armor, trs(1.82, 4.3, 0.45, 0, 0.55)));

  // Schild mit Kristall-Einlagen
  const SH = trs(0.9, 3.0, 1.82, -0.32, 0.1);
  const sh = (m: THREE.Matrix4) => SH.clone().multiply(m);
  body.push(colored(Box(1.95, 2.5, 0.32), C.armor, sh(trs(0, 0.35, 0))));
  body.push(colored(Box(1.38, 1.38, 0.32), C.armor, sh(trs(0, -0.9, 0, 0, 0, 1, 1, 1, Math.PI / 4))));
  body.push(colored(Box(2.08, 0.18, 0.38), C.gold, sh(trs(0, 1.62, 0))));
  for (const sd of [-1, 1]) {
    body.push(colored(Box(0.18, 2.5, 0.38), C.gold, sh(trs(1.0 * sd, 0.35, 0))));
    body.push(colored(Box(1.42, 0.17, 0.38), C.gold, sh(trs(0.5 * sd, -1.42, 0, 0, 0, 1, 1, 1, Math.PI / 4 * sd))));
  }
  body.push(colored(new THREE.OctahedronGeometry(0.5, 0), C.gold, sh(trs(0, 0.0, 0.17, 0, 0, 0.92, 1.35, 0.25))));
  const bodyGeo = merge(body);
  const bodyMesh = new THREE.Mesh(bodyGeo, mat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  top.add(bodyMesh);

  const inlay = new THREE.Mesh(
    merge([
      colored(new THREE.OctahedronGeometry(0.5, 0), C.inlay, sh(trs(0, 0.0, 0.22, 0, 0, 0.7, 1.05, 0.25))),
      colored(Box(1.05, 0.24, 0.1), C.inlay, sh(trs(-0.42, 1.05, 0.19, 0, 0, 1, 1, 1, -0.55))),
      colored(Box(1.05, 0.24, 0.1), C.inlay, sh(trs(0.42, 1.05, 0.19, 0, 0, 1, 1, 1, 0.55))),
      colored(Box(0.6, 0.16, 0.1), C.inlay, sh(trs(0, -1.05, 0.19))),
      colored(new THREE.OctahedronGeometry(0.16, 0), C.inlay, mat4(0, 4.75, 1.66, 1, 1.3, 0.5)),
    ]),
    inlayMat,
  );
  top.add(inlay);

  // Stab mit Kristall (rechte Hand), eigene Gruppe für den Rückstoß
  const staff = new THREE.Group();
  staff.position.set(-1.6, 5.2, 0);
  top.add(staff);
  const staffMesh = new THREE.Mesh(
    merge([
      colored(Cyl(0.36, 0.3, 1.6, 8), C.armor, trs(-0.08, -0.65, 0.28, 0, 0.45)),
      colored(new THREE.SphereGeometry(0.33, 8, 6), C.armorD, mat4(-0.15, -1.3, 0.55)),
      colored(Cyl(0.11, 0.11, 6.7, 6), C.pole, mat4(-0.15, -0.25, 0.55)),
      colored(new THREE.TorusGeometry(0.22, 0.08, 6, 14), C.gold, mat4(-0.15, 2.85, 0.55, 1, 1, 1, Math.PI / 2)),
      colored(Cyl(0.16, 0.1, 0.5, 6), C.gold, mat4(-0.15, 3.1, 0.55)),
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return colored(new THREE.ConeGeometry(0.08, 1.0, 4), C.gold, trs(-0.15 + Math.sin(a) * 0.28, 3.55, 0.55 + Math.cos(a) * 0.28, a, 0.4));
      }),
    ]),
    mat,
  );
  staffMesh.castShadow = true;
  staff.add(staffMesh);
  const crystalY = 3.85;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), gemMat(team));
  crystal.scale.set(0.85, 1.75, 0.85);
  crystal.position.set(-0.15, crystalY, 0.55);
  staff.add(crystal);
  const glow = glowSprite(TEAM_GLOW[team], 3.6, 0.8);
  glow.position.copy(crystal.position);
  staff.add(glow);

  // Trümmer nach der Zerstörung
  const rubble = new THREE.Mesh(
    merge([
      colored(Cyl(1.35, 1.6, 1.2, 12), C.armorD, mat4(0, 1.7, 0)),
      colored(new THREE.DodecahedronGeometry(0.75, 0), C.armor, mat4(1.4, 1.5, 0.9, 1, 0.7, 1, 0.4, 0.2)),
      colored(new THREE.DodecahedronGeometry(0.55, 0), C.stoneL, mat4(-1.3, 1.4, -0.8, 1, 0.8, 1, 0.1, 1.1)),
      colored(Box(1.6, 0.3, 1.9), C.armor, trs(1.6, 1.25, -1.4, 0.6, 0.15)),
      colored(new THREE.OctahedronGeometry(0.4, 0), 0x3a3238, mat4(-1.7, 1.3, 1.1, 0.8, 1.6, 0.8, 1.2, 0, 0.4)),
    ]),
    mat,
  );
  rubble.visible = false;
  rubble.castShadow = true;
  root.add(rubble);

  const outline = outlineMesh(merge([baseGeo.clone(), bodyGeo.clone()]), 0xff2a1a, 0.09);
  root.add(outline);

  return { root, crystal, glow, top, rubble, crystalY, staff, outline };
}

export function buildInhibitor(team: 0 | 1): StructModel {
  const root = new THREE.Group();
  const C = { stoneD: 0x343a3e, stone: 0x535b61, stoneL: 0x6c747a, gold: 0xcaa14c, goldD: 0x8a6a2e };
  const mat = statueMat();
  const parts: THREE.BufferGeometry[] = [
    colored(Cyl(2.95, 3.2, 0.45, 22), C.stoneD, mat4(0, 0.22, 0)),
    colored(Cyl(2.6, 2.8, 0.5, 22), C.stone, mat4(0, 0.68, 0)),
    colored(Cyl(1.95, 2.0, 0.12, 22), C.stoneD, mat4(0, 0.98, 0)),
    colored(new THREE.TorusGeometry(2.05, 0.12, 6, 30), C.gold, mat4(0, 1.0, 0, 1, 1, 1, Math.PI / 2)),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(colored(Box(1.15, 0.3, 0.45), i % 2 ? C.stone : C.stoneL, trs(Math.sin(a) * 2.5, 1.0, Math.cos(a) * 2.5, a)));
  }
  // Vier goldene Klauen, die den Kristall halten
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(colored(Box(0.62, 0.9, 0.62), C.stoneL, trs(Math.sin(a) * 2.25, 1.55, Math.cos(a) * 2.25, a)));
    parts.push(colored(Box(0.34, 2.1, 0.34), C.gold, trs(Math.sin(a) * 2.05, 2.75, Math.cos(a) * 2.05, a, -0.38)));
    parts.push(colored(new THREE.ConeGeometry(0.22, 1.5, 5), C.goldD, trs(Math.sin(a) * 1.45, 4.25, Math.cos(a) * 1.45, a, -0.95)));
    parts.push(colored(new THREE.SphereGeometry(0.26, 8, 6), C.gold, mat4(Math.sin(a) * 1.68, 3.75, Math.cos(a) * 1.68)));
  }
  const baseMesh = new THREE.Mesh(merge(parts), mat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  const top = new THREE.Group();
  root.add(top);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.05, 28), new THREE.MeshBasicMaterial({ color: TEAM_GLOW[team], transparent: true, opacity: 0.55 }));
  pool.position.y = 1.07;
  top.add(pool);
  const crystalY = 3.5;
  const crystal = new THREE.Group();
  crystal.position.y = crystalY;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), gemMat(team, 0.92));
  gem.scale.set(0.95, 1.9, 0.95);
  crystal.add(gem);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  core.scale.set(1, 2, 1);
  crystal.add(core);
  top.add(crystal);
  const shards = new THREE.Group();
  shards.position.y = crystalY;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const sMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), gemMat(team));
    sMesh.scale.set(1, 1.8, 1);
    sMesh.position.set(Math.cos(a) * 1.75, Math.sin(a * 2) * 0.4, Math.sin(a) * 1.75);
    shards.add(sMesh);
  }
  top.add(shards);
  const glow = glowSprite(TEAM_GLOW[team], 7, 0.75);
  glow.position.y = crystalY;
  top.add(glow);

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
  return { root, crystal, glow, top, rubble, crystalY, shards, outline };
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
  const stone = 0x8a8c94;
  const dark = 0x5c5e66;
  const metal = team === 0 ? 0x4a78c0 : 0xb85a3a;
  root.add(
    mesh([
      colored(new THREE.CylinderGeometry(4.2, 4.8, 0.8, 16), dark, mat4(0, 0.4, 0)),
      colored(new THREE.CylinderGeometry(3.4, 3.8, 0.8, 16), stone, mat4(0, 1.1, 0)),
      colored(new THREE.TorusGeometry(3.6, 0.2, 6, 28), metal, mat4(0, 1.5, 0, 1, 1, 1, Math.PI / 2)),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return colored(new THREE.BoxGeometry(0.45, 2.6, 0.45), stone, mat4(Math.cos(a) * 3.6, 2.4, Math.sin(a) * 3.6, 1, 1, 1, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3));
      }),
    ]),
  );
  const top = new THREE.Group();
  root.add(top);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), crystalMat(team));
  crystal.scale.set(1, 2.0, 1);
  crystal.position.y = 5.2;
  top.add(crystal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 6, 32), crystalMat(team));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 5.2;
  crystal.add(ring);
  ring.scale.set(1, 1 / 2.0, 1);
  const glow = glowSprite(TEAM_GLOW[team], 11, 0.75);
  glow.position.y = 5.2;
  top.add(glow);
  const rubble = mesh([colored(new THREE.DodecahedronGeometry(1.2, 0), 0x3a3c44, mat4(0.6, 2.0, 0.2)), colored(new THREE.DodecahedronGeometry(1.0, 0), 0x2c2e36, mat4(-0.8, 1.9, -0.5))]);
  rubble.visible = false;
  root.add(rubble);
  return { root, crystal, glow, top, rubble, crystalY: 5.2 };
}

export function buildFountain(team: 0 | 1) {
  const root = new THREE.Group();
  const col = TEAM_GLOW[team];
  root.add(
    mesh([
      colored(new THREE.CylinderGeometry(6.5, 7, 0.4, 24), 0x6a6c74, mat4(0, 0.2, 0)),
      colored(new THREE.CylinderGeometry(2.0, 2.4, 1.4, 12), 0x8a8c94, mat4(0, 0.9, 0)),
      ...[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return colored(new THREE.CylinderGeometry(0.3, 0.4, 3.2, 6), 0x8a8c94, mat4(Math.cos(a) * 5.6, 1.6, Math.sin(a) * 5.6));
      }),
    ]),
  );
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.5, 10, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 6;
  root.add(beam);
  const g = glowSprite(col, 6, 0.35);
  g.position.y = 2.2;
  root.add(g);
  return root;
}
