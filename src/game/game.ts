import * as THREE from "three";
import { BotBrain, resetAi } from "./ai";
import { Sfx } from "./audio";
import { Hud } from "./hud";
import { Input } from "./input";
import { MAP } from "./mapdata";
import { setGuardianEnvironment } from "./models";
import { NavGrid } from "./navgrid";
import { camCut } from "./camcut";
import type { Quality } from "./terrain";
import { View } from "./view";
import { World, type MatchSetup } from "./world";

/** Nahansicht: so viele Champion-Höhen bleibt die Kamera mindestens entfernt (die Figur füllt dann gut 2/3 des Bildes). */
const CLOSE_DIST = 1.8;
/** Blickwinkel von oben bei voller Nähe; weiter weg bleibt die bisherige Perspektive. */
const CLOSE_PITCH = (32 * Math.PI) / 180;
/** Unterhalb dieses Zooms beginnt der Übergang in die Nahansicht (darüber alles wie bisher). */
const NEAR_ZOOM = 0.75;
/** Nie steiler als die bisherige Ansicht, wenn die Kamera einem Hindernis ausweicht. */
const MAX_PITCH = (54.5 * Math.PI) / 180;
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
  /** geglätteter Zoom, Bodenhöhe unter dem Champion und Ausweichen der Kamera vor Hindernissen */
  private zoomS = 1;
  private groundS = 0;
  private dodgePitch = 0;
  private dodgeDist = 0;
  private shadowSize = 38;
  debugTop = false;

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts;
    resetAi();
    const grid = navGrid();
    this.world = new World(grid, opts, () => new BotBrain(opts.difficulty));

    const high = opts.quality === "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: "high-performance", stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0e1a10);
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 1, Math.max(400, MAP * 1.5));

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

    setGuardianEnvironment(this.renderer);
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

  /** Kleinster Zoom, bei dem die Kamera noch CLOSE_DIST Champion-Höhen entfernt ist. */
  private minZoom(height: number, pf: number) {
    // Abstand zum Blickpunkt bei Zoom z (siehe updateCamera): R² = 1.0192·a² + 1.68·a + 2.25 mit a = 38·z·pf
    const r = CLOSE_DIST * height;
    const a = (-1.68 + Math.sqrt(1.68 * 1.68 - 4 * 1.0192 * (2.25 - r * r))) / (2 * 1.0192);
    return a / (38 * pf);
  }

  /**
   * Steckt die Kamera im Gelände oder verdeckt eine Felskante den Champion (Blickpunkt l -> Kamera c)?
   * Bäume und Gebäude blendet camcut.ts aus, die müssen hier nicht geprüft werden.
   */
  private camBlocked(lx: number, ly: number, lz: number, cx: number, cy: number, cz: number) {
    const g = this.world.grid;
    const m = 0.5;
    if (cy < g.heightAt(cx, cz) + m || cy < g.heightAt(cx + m, cz) + m || cy < g.heightAt(cx - m, cz) + m || cy < g.heightAt(cx, cz + m) + m || cy < g.heightAt(cx, cz - m) + m) return true;
    for (let i = 2; i < 10; i++) {
      const f = i / 10;
      const x = lx + (cx - lx) * f;
      const z = lz + (cz - lz) * f;
      if (ly + (cy - ly) * f < g.heightAt(x, z) + 0.15) return true;
    }
    return false;
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
      // am Spielende auf den Nexus schauen, nicht aus nächster Nähe in ihn hinein
      this.input.zoom = Math.max(this.input.zoom, 1);
    }
    const aspect = window.innerWidth / window.innerHeight;
    // Mindestens ~30 Einheiten Breite auch im Hochformat
    const portrait = aspect < 1 ? 1 / Math.max(0.45, aspect) : 1;
    // Handy: Kamera näher, damit Champions und Geschehen gut erkennbar sind (kurze Bildschirmseite unter 700 px)
    const short = Math.min(window.innerWidth, window.innerHeight);
    const mobile = short < 700 || matchMedia("(pointer: coarse)").matches;
    const pf = Math.min(1.9, portrait) * (mobile ? 0.66 : 1);
    // Zoom stufenlos nachführen (im Logarithmus, damit jeder Mausrad-Schritt gleich wirkt)
    this.input.zoom = Math.max(this.minZoom(p.height, pf), this.input.zoom);
    this.zoomS = Math.exp(Math.log(this.zoomS) + (Math.log(this.input.zoom) - Math.log(this.zoomS)) * (1 - Math.exp(-dt / 0.1)));
    const zoom = this.zoomS;
    // 0 = bisherige Ansicht, 1 = ganz nah am Champion
    const near = smooth01((NEAR_ZOOM - zoom) / (NEAR_ZOOM - 0.12));
    if (near > 0 && w.winner === null && Math.hypot(tx - this.camTarget.x, tz - this.camTarget.z) > 15) {
      // Sprung (Rückruf, Wiederbelebung): in der Nahansicht nicht quer über die Karte gleiten
      this.camTarget.x = tx;
      this.camTarget.z = tz;
    }
    const k = w.winner !== null ? Math.min(1, dt * 2) : Math.min(1, dt * (10 + 15 * near));
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    const dist = 38 * zoom * pf;
    let nearPlane = 1;
    if (this.debugTop) {
      this.camera.position.set(MAP / 2, MAP * 1.3, MAP / 2 + 0.01);
      this.camera.lookAt(MAP / 2, 0, MAP / 2);
    } else {
      const sh = this.shake > 0 ? this.shake * 0.4 * Math.min(1, zoom / NEAR_ZOOM) : 0;
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const jx = (Math.random() - 0.5) * sh;
      const jz = (Math.random() - 0.5) * sh;
      if (near <= 0) {
        this.dodgePitch = this.dodgeDist = 0;
        this.camera.position.set(this.camTarget.x + jx, dist * 0.84, this.camTarget.z + dist * 0.56 + jz);
        this.camera.lookAt(this.camTarget.x + jx, 0, this.camTarget.z - 1.5 + jz);
      } else {
        // gleiche Kamera wie bisher, nur mit wachsender Nähe: Blick auf Brusthöhe statt auf den Boden, flacherer Winkel
        const g = w.grid;
        this.groundS += (g.groundAt(this.camTarget.x, this.camTarget.z) - this.groundS) * Math.min(1, dt * 8);
        const up = 0.84 * dist;
        const back = 0.56 * dist + 1.5;
        const R = Math.hypot(up, back);
        const pitch0 = Math.atan2(up, back);
        const pitch = pitch0 + (CLOSE_PITCH - pitch0) * near;
        const lx = this.camTarget.x + jx;
        const ly = near * (this.groundS + 0.5 * p.height);
        const lz = this.camTarget.z - 1.5 * (1 - near) + jz;
        // Gelände zwischen Kamera und Champion: erst steiler schauen (höchstens wie bisher), dann etwas zurückweichen
        const top = Math.max(pitch0, MAX_PITCH);
        let wantPitch = 0;
        let wantDist = 0;
        const blockedAt = (a: number, r: number) => this.camBlocked(lx, ly, lz, lx, ly + r * Math.sin(a), lz + r * Math.cos(a));
        if (blockedAt(pitch, R)) {
          let a = pitch;
          while (a < top && blockedAt(a, R)) a = Math.min(top, a + (2 * Math.PI) / 180);
          wantPitch = a - pitch;
          if (blockedAt(a, R)) {
            for (wantDist = 0.5; wantDist < 6 && blockedAt(a, R + wantDist); wantDist += 0.5);
          }
        }
        // ausweichen schnell, zurückkehren langsam (kein Springen bei kurzen Hindernissen)
        const ease = (cur: number, want: number) => cur + (want - cur) * (1 - Math.exp(-dt / (want > cur ? 0.04 : 0.35)));
        this.dodgePitch = ease(this.dodgePitch, wantPitch);
        this.dodgeDist = ease(this.dodgeDist, wantDist);
        const a = Math.min(top, pitch + this.dodgePitch);
        const r = R + this.dodgeDist;
        this.camera.position.set(lx, ly + r * Math.sin(a), lz + r * Math.cos(a));
        this.camera.lookAt(lx, ly, lz);
        nearPlane = Math.max(0.3, Math.min(1, 0.06 * r));
      }
    }
    if (this.camera.near !== nearPlane) {
      this.camera.near = nearPlane;
      this.camera.updateProjectionMatrix();
    }
    // Bäume und Gebäude zwischen Kamera und Champion in der Nahansicht ausblenden
    camCut.uCutOn.value = this.debugTop ? 0 : Math.min(1, near * 2);
    camCut.uCutB.value.set(this.camTarget.x, this.groundS + 0.5 * p.height, this.camTarget.z);
    // Schatten: in der Nahansicht kleinerer Bereich, damit die Schattenkanten nicht grob werden
    const size = near < 0.25 ? 38 : near < 0.5 ? 30 : near < 0.75 ? 24 : 20;
    const sc = this.sun.shadow.camera;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      sc.left = sc.bottom = -size;
      sc.right = sc.top = size;
      sc.updateProjectionMatrix();
    }
    // Sonne folgt der Kamera, Schatten in Texel-Schritten, damit nichts flimmert
    const step = (2 * size) / this.sun.shadow.mapSize.x;
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

function smooth01(x: number) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
