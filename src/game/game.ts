import * as THREE from "three";
import { BotBrain, resetAi } from "./ai";
import { Sfx } from "./audio";
import { Hud } from "./hud";
import { Input } from "./input";
import { MAP } from "./mapdata";
import { NavGrid } from "./navgrid";
import type { Quality } from "./terrain";
import { View } from "./view";
import { World, type MatchSetup } from "./world";

let sharedGrid: NavGrid | null = null;
export function navGrid() {
  if (!sharedGrid) sharedGrid = new NavGrid();
  return sharedGrid;
}

export type GameOptions = MatchSetup & { quality: Quality; onExit: (again: boolean) => void; sfx: Sfx };

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly view: View;
  readonly hud: Hud;
  readonly input: Input;
  private sun: THREE.DirectionalLight;
  private raf = 0;
  private last = 0;
  private paused = false;
  private camTarget = new THREE.Vector3();
  private ended = false;
  private endShown = false;
  private opts: GameOptions;
  private onResize = () => this.resize();
  private shake = 0;
  debugTop = false;

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts;
    resetAi();
    const grid = navGrid();
    this.world = new World(grid, opts, () => new BotBrain(opts.difficulty));

    const high = opts.quality === "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0e1a10);
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 1, 400);

    const hemi = new THREE.HemisphereLight(0xd6ecff, 0x3a4a2a, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 38;
    sc.bottom = -38;
    sc.near = 1;
    sc.far = 140;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.view = new View(this.scene, this.world, opts.quality);
    this.hud = new Hud(container, this.world, this.view, {
      onPause: () => this.setPaused(true),
      onResume: () => this.setPaused(false),
      onSurrender: () => this.exit(false),
      onRestart: () => this.exit(true),
      onMenu: () => this.exit(false),
      onSound: (on) => (opts.sfx.enabled = on),
      onLevelUp: (slot) => this.world.levelUp(this.world.player, slot),
      onBuy: (id) => this.world.buy(this.world.player, id),
    });
    this.input = new Input(this.hud, this.world, this.view, this.camera, this.renderer.domElement);
    this.input.onShop = () => this.hud.toggleShop();
    this.input.onPauseKey = () => {
      if (this.hud.shopVisible) this.hud.toggleShop(false);
      else this.setPaused(!this.paused);
    };
    this.input.onSfx = (n) => opts.sfx.play(n);
    this.input.paused = () => this.paused || this.ended;

    const p = this.world.player;
    this.camTarget.set(p.x, 0, p.z);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    this.resize();
    this.debugTop = new URLSearchParams(location.search).has("top");
  }

  start() {
    // Testhilfe: ?warp=Sekunden spult die Simulation vor
    const warp = Number(new URLSearchParams(location.search).get("warp") ?? 0);
    for (let i = 0; i < warp * 30; i++) {
      this.world.update(1 / 30);
      this.world.fxQueue.length = 0;
    }
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
    this.hud.announce("Willkommen in der Kluft der Legenden", "Zerstöre den gegnerischen Nexus", "neutral");
  }

  private setPaused(on: boolean) {
    if (this.ended) return;
    this.paused = on;
    this.hud.showPause(on);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
    this.view.particles.setScale(h * this.renderer.getPixelRatio() * 0.9);
  }

  private frame(dt: number) {
    const w = this.world;
    if (!this.paused) {
      this.input.apply(dt);
      // Feste Teilschritte für stabile Simulation
      const steps = dt > 0.034 ? 2 : 1;
      for (let i = 0; i < steps; i++) {
        w.update(dt / steps);
        this.handleEvents();
      }
    }
    this.updateCamera(dt);
    this.view.sync(this.paused ? 0 : dt, this.camera);
    this.hud.update(this.paused ? 0 : dt, this.camera, { x: this.camTarget.x, z: this.camTarget.z });
    this.renderer.render(this.scene, this.camera);

    if (w.winner !== null && !this.endShown && w.t - w.endAt > 2.5) {
      this.endShown = true;
      this.hud.showEnd(w.winner === w.player.team);
      this.opts.sfx.play(w.winner === w.player.team ? "victory" : "defeat");
    }
  }

  private handleEvents() {
    const w = this.world;
    const p = w.player;
    const sfx = this.opts.sfx;
    const play = (name: string, x: number, z: number) => {
      const d = Math.hypot(x - this.camTarget.x, z - this.camTarget.z);
      sfx.play(name, Math.max(0, 1 - d / 34));
    };
    for (const e of w.events) {
      if (e.type === "sound") play(e.name, e.x, e.z);
      if (e.type === "dmg" && e.unit === p && e.amount > p.stats.maxHp * 0.08) this.shake = Math.max(this.shake, 0.25);
      if (e.type === "structure") {
        const d = Math.hypot(e.unit.x - this.camTarget.x, e.unit.z - this.camTarget.z);
        if (d < 40) this.shake = 0.6;
      }
      if (e.type === "end") {
        this.ended = true;
        this.hud.toggleShop(false);
      }
    }
    this.hud.onEvents(play);
  }

  private updateCamera(dt: number) {
    const w = this.world;
    const p = w.player;
    let tx = p.x;
    let tz = p.z;
    if (w.winner !== null) {
      const nexus = w.structures.find((s) => s.kind === "nexus" && s.team !== w.winner)!;
      tx = nexus.x;
      tz = nexus.z;
    }
    const k = w.winner !== null ? Math.min(1, dt * 2) : Math.min(1, dt * 10);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    const aspect = window.innerWidth / window.innerHeight;
    // Mindestens ~30 Einheiten Breite auch im Hochformat
    const portrait = aspect < 1 ? 1 / Math.max(0.45, aspect) : 1;
    const dist = 38 * this.input.zoom * Math.min(1.9, portrait);
    if (this.debugTop) {
      this.camera.position.set(MAP / 2, 260, MAP / 2 + 0.01);
      this.camera.lookAt(MAP / 2, 0, MAP / 2);
    } else {
      const sh = this.shake > 0 ? this.shake * 0.4 : 0;
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const jx = (Math.random() - 0.5) * sh;
      const jz = (Math.random() - 0.5) * sh;
      this.camera.position.set(this.camTarget.x + jx, dist * 0.84, this.camTarget.z + dist * 0.56 + jz);
      this.camera.lookAt(this.camTarget.x + jx, 0, this.camTarget.z - 1.5 + jz);
    }
    // Sonne folgt der Kamera, Schatten in Texel-Schritten, damit nichts flimmert
    const step = 76 / this.sun.shadow.mapSize.x;
    const sx = Math.round(this.camTarget.x / step) * step;
    const sz = Math.round(this.camTarget.z / step) * step;
    this.sun.position.set(sx - 30, 70, sz + 35);
    this.sun.target.position.set(sx, 0, sz);
  }

  private exit(again: boolean) {
    this.destroy();
    this.opts.onExit(again);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    this.input.destroy();
    this.hud.destroy();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
