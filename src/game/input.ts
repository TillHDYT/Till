import * as THREE from "three";
import type { Hud } from "./hud";
import type { V2 } from "./mapdata";
import type { Champion, Unit } from "./units";
import type { View } from "./view";
import type { World } from "./world";

type AimSlot = 0 | 1 | 2 | 3 | "flash";
type Aim = { slot: AimSlot; id: number; cx: number; cy: number; x: number; y: number; moved: boolean; el: HTMLElement };

const MAX_DRAG = 80;

export class Input {
  private hud: Hud;
  private world: World;
  private view: View;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private aim: Aim | null = null;
  attackMode: "auto" | "minion" | "turret" | null = null;
  private attackId = -1;
  private mouse = { x: 0, y: 0, inside: false };
  private keysMove = { up: false, down: false, left: false, right: false };
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private disposers: (() => void)[] = [];
  zoom = 1;
  onShop: () => void = () => {};
  onPauseKey: () => void = () => {};
  onSfx: (name: string) => void = () => {};
  paused = () => false;

  constructor(hud: Hud, world: World, view: View, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.hud = hud;
    this.world = world;
    this.view = view;
    this.camera = camera;
    this.canvas = canvas;
    this.bind();
  }

  private get p(): Champion {
    return this.world.player;
  }

  private on<K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) {
    el.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private bind() {
    const E = this.hud.el;
    const root = this.hud.root;

    // Joystick: linke Bildschirmhälfte
    this.on(root, "pointerdown", (e: PointerEvent) => {
      if (this.paused()) return;
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest(".modal") || t.closest(".tl")) return;
      if (e.pointerType === "mouse") return;
      if (e.clientX < window.innerWidth * 0.5 && !this.joy) {
        this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        E.joy.style.left = `${e.clientX}px`;
        E.joy.style.top = `${e.clientY}px`;
        E.joy.classList.add("on");
        e.preventDefault();
      }
    });
    this.on(window, "pointermove", (e: PointerEvent) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy.x = e.clientX;
        this.joy.y = e.clientY;
        const s = this.scale();
        let dx = e.clientX - this.joy.ox;
        let dy = e.clientY - this.joy.oy;
        const len = Math.hypot(dx, dy);
        const max = 52 * s;
        if (len > max) {
          // Basis folgt dem Finger, wenn er weit wegzieht
          this.joy.ox += (dx / len) * (len - max);
          this.joy.oy += (dy / len) * (len - max);
          E.joy.style.left = `${this.joy.ox}px`;
          E.joy.style.top = `${this.joy.oy}px`;
          dx = e.clientX - this.joy.ox;
          dy = e.clientY - this.joy.oy;
        }
        E.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      if (this.aim && e.pointerId === this.aim.id) {
        this.aim.x = e.clientX;
        this.aim.y = e.clientY;
        if (Math.hypot(e.clientX - this.aim.cx, e.clientY - this.aim.cy) > 14 * this.scale()) this.aim.moved = true;
        const c = E.cancel.getBoundingClientRect();
        E.cancel.classList.toggle("hot", e.clientX > c.left && e.clientX < c.right && e.clientY > c.top && e.clientY < c.bottom);
      }
      if (e.pointerType === "mouse") {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.mouse.inside = true;
      }
    });
    const up = (e: PointerEvent) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        E.joy.classList.remove("on");
        E.knob.style.transform = "";
        this.p.moveVec = null;
      }
      if (this.aim && e.pointerId === this.aim.id) this.releaseAim();
      if (e.pointerId === this.attackId) {
        this.attackMode = null;
        this.attackId = -1;
        E.atk.classList.remove("held");
        E.atkm.classList.remove("held");
        E.atkt.classList.remove("held");
      }
    };
    this.on(window, "pointerup", up);
    this.on(window, "pointercancel", up);

    // Angriffsknöpfe
    const atk = (el: HTMLElement, mode: "auto" | "minion" | "turret") =>
      this.on(el, "pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.attackMode = mode;
        this.attackId = e.pointerId;
        el.classList.add("held");
        this.p.order = { type: "none" };
        this.acquire(true);
      });
    atk(E.atk, "auto");
    atk(E.atkm, "minion");
    atk(E.atkt, "turret");

    // Fähigkeiten
    this.hud.skillBtns.forEach((b, i) =>
      this.on(b, "pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.ctrlKey) {
          this.world.levelUp(this.p, i);
          return;
        }
        this.startAim(i as AimSlot, e, b);
      }),
    );
    this.on(E.flash, "pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.startAim("flash", e, E.flash);
    });
    this.on(E.spell2, "pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.world.spell2(this.p);
    });
    this.on(E.recall, "pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.recall();
    });

    // Maus auf dem Spielfeld
    this.on(this.canvas, "contextmenu", (e: MouseEvent) => e.preventDefault());
    this.on(root, "contextmenu", (e: MouseEvent) => e.preventDefault());
    this.on(root, "mousedown", (e: MouseEvent) => {
      if (this.paused()) return;
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest(".modal")) return;
      if (e.button === 2) this.rightClick(e.clientX, e.clientY);
    });
    this.on(window, "mouseleave", () => (this.mouse.inside = false));
    this.on(
      root,
      "wheel",
      (e: WheelEvent) => {
        this.zoom = Math.max(0.75, Math.min(1.35, this.zoom + Math.sign(e.deltaY) * 0.06));
        e.preventDefault();
      },
      { passive: false },
    );

    this.on(window, "keydown", (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "escape") return this.onPauseKey();
      if (this.paused()) return;
      const slot = { q: 0, w: 1, e: 2, r: 3 }[k];
      if (slot !== undefined) {
        if (e.ctrlKey || e.altKey) {
          this.world.levelUp(this.p, slot);
          e.preventDefault();
          return;
        }
        this.quickCast(slot, this.mouse.inside ? this.mouseWorld() : null);
        return;
      }
      if (k === "d") this.world.flash(this.p, this.mouse.inside ? this.mouseWorld() : null);
      if (k === "f") this.world.spell2(this.p);
      if (k === "b") this.recall();
      if (k === "p") this.onShop();
      if (k === "s") {
        this.p.order = { type: "none" };
        this.p.path = [];
      }
      if (k === "arrowup") this.keysMove.up = true;
      if (k === "arrowdown") this.keysMove.down = true;
      if (k === "arrowleft") this.keysMove.left = true;
      if (k === "arrowright") this.keysMove.right = true;
      if (k === "a") {
        this.attackMode = "auto";
        this.attackId = -2;
      }
    });
    this.on(window, "keyup", (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowup") this.keysMove.up = false;
      if (k === "arrowdown") this.keysMove.down = false;
      if (k === "arrowleft") this.keysMove.left = false;
      if (k === "arrowright") this.keysMove.right = false;
      if (k === "a" && this.attackId === -2) {
        this.attackMode = null;
        this.attackId = -1;
      }
    });
  }

  private scale() {
    return Number(this.hud.root.style.getPropertyValue("--s")) || 1;
  }

  private recall() {
    if (this.p.recallUntil > 0) return;
    this.p.order = { type: "none" };
    this.p.moveVec = null;
    this.world.startRecall(this.p);
  }

  private startAim(slot: AimSlot, e: PointerEvent, el: HTMLElement) {
    if (this.paused()) return;
    if (typeof slot === "number") {
      const ab = this.p.def.abilities[slot];
      if (this.p.ranks[slot] === 0) {
        this.onSfx("click");
        return;
      }
      // Fähigkeiten ohne Ziel sofort auslösen
      if (ab.targeting === "self") {
        this.world.cast(this.p, slot, null);
        return;
      }
    }
    const r = el.getBoundingClientRect();
    this.aim = { slot, id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: e.clientX, y: e.clientY, moved: false, el };
    el.classList.add("aiming");
    if (e.pointerType !== "mouse") this.hud.el.cancel.classList.add("show");
  }

  private aimPoint(a: Aim): V2 {
    const p = this.p;
    const range = a.slot === "flash" ? 6.5 : p.def.abilities[a.slot].range;
    const dx = a.x - a.cx;
    const dy = a.y - a.cy;
    const len = Math.hypot(dx, dy);
    const k = Math.min(1, len / (MAX_DRAG * this.scale()));
    if (len < 1) return { x: p.x, z: p.z };
    return { x: p.x + (dx / len) * range * Math.max(0.15, k), z: p.z + (dy / len) * range * Math.max(0.15, k) };
  }

  private releaseAim() {
    const a = this.aim!;
    this.aim = null;
    a.el.classList.remove("aiming");
    const cancel = this.hud.el.cancel;
    const hot = cancel.classList.contains("hot");
    cancel.classList.remove("show", "hot");
    this.view.indicators.hide();
    if (hot) return;
    if (a.slot === "flash") {
      this.world.flash(this.p, a.moved ? this.aimPoint(a) : this.p.moveVec ? { x: this.p.x + this.p.moveVec.x, z: this.p.z + this.p.moveVec.z } : null);
      return;
    }
    if (!a.moved) {
      this.quickCast(a.slot, null);
      return;
    }
    const pt = this.aimPoint(a);
    const ab = this.p.def.abilities[a.slot];
    if (ab.targeting === "unit") {
      const t = this.world.nearestEnemyChamp(this.p.team, pt.x, pt.z, 5);
      this.world.cast(this.p, a.slot, pt, t);
    } else this.world.cast(this.p, a.slot, pt);
  }

  /** Schnellzauber: Ziel automatisch wählen (oder zur Maus). */
  quickCast(slot: number, toward: V2 | null) {
    const p = this.p;
    const w = this.world;
    const ab = p.def.abilities[slot];
    if (ab.targeting === "self") {
      w.cast(p, slot, null);
      return;
    }
    if (toward) {
      if (ab.targeting === "unit") {
        const t = w.nearestEnemyChamp(p.team, toward.x, toward.z, 5) ?? w.nearestEnemyChamp(p.team, p.x, p.z, ab.range + 1);
        w.cast(p, slot, toward, t);
      } else w.cast(p, slot, toward);
      return;
    }
    let target: Unit | null = w.nearestEnemyChamp(p.team, p.x, p.z, ab.range + 1);
    if (!target && ab.targeting !== "unit") target = w.pickTarget(p, "minion", ab.range);
    if (target) {
      w.cast(p, slot, { x: target.x, z: target.z }, target);
      return;
    }
    if (ab.targeting === "unit") {
      this.onSfx("click");
      return;
    }
    const dir = p.moveVec ?? { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    const len = Math.hypot(dir.x, dir.z) || 1;
    const dist = ab.targeting === "point" ? Math.min(ab.range, 6) : ab.range;
    w.cast(p, slot, { x: p.x + (dir.x / len) * dist, z: p.z + (dir.z / len) * dist });
  }

  mouseWorld(): V2 {
    const nx = (this.mouse.x / window.innerWidth) * 2 - 1;
    const ny = -(this.mouse.y / window.innerHeight) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, hit)) return { x: hit.x, z: hit.z };
    return { x: this.p.x, z: this.p.z };
  }

  private rightClick(sx: number, sy: number) {
    const w = this.world;
    const p = this.p;
    if (!p.alive) return;
    this.mouse.x = sx;
    this.mouse.y = sy;
    // Gegner unter dem Mauszeiger?
    let best: Unit | null = null;
    let bd = 40 * this.scale();
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const u of w.all) {
      if (!w.attackable(u, p.team) || !this.view.isUnitShown(u)) continue;
      const s = this.view.project(this.camera, u.x, w.grid.groundAt(u.x, u.z) + u.height * 0.5, u.z, W, H);
      const d = Math.hypot(s.x - sx, s.z - sy) - (u.kind === "turret" || u.kind === "nexus" || u.kind === "inhib" ? 30 : 0);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    w.cancelRecall(p);
    if (best) {
      p.order = { type: "attack", target: best };
      return;
    }
    const pt = this.mouseWorld();
    p.order = { type: "move", x: pt.x, z: pt.z };
    this.view.ground.ring(pt.x, w.grid.groundAt(pt.x, pt.z), pt.z, 1.2, 0.2, 0x7dff6a, 0.35, 0.9);
  }

  /** Ziel für gehaltene Angriffstaste suchen. */
  private acquire(force: boolean) {
    const p = this.p;
    const w = this.world;
    if (!this.attackMode || !p.alive) return;
    const cur = p.order.type === "attack" ? p.order.target : null;
    if (!force && cur && w.attackable(cur, p.team)) {
      const d = Math.hypot(cur.x - p.x, cur.z - p.z) - cur.radius - p.radius;
      if (d < p.stats.range + 3) return;
    }
    const t = w.pickTarget(p, this.attackMode, p.stats.range + 5);
    if (t) {
      w.cancelRecall(p);
      p.order = { type: "attack", target: t };
    }
  }

  private acquireT = 0;

  /** Pro Frame: Eingaben in Befehle für den Spieler-Champion übersetzen. */
  apply(dt: number) {
    const p = this.p;
    if (!p.alive) {
      p.moveVec = null;
      this.view.indicators.hide();
      return;
    }
    // Bewegung
    let mv: V2 | null = null;
    if (this.joy) {
      const dx = this.joy.x - this.joy.ox;
      const dy = this.joy.y - this.joy.oy;
      const len = Math.hypot(dx, dy);
      const dead = 8 * this.scale();
      if (len > dead) mv = { x: dx / len, z: dy / len };
    }
    const km = this.keysMove;
    if (km.up || km.down || km.left || km.right) mv = { x: (km.right ? 1 : 0) - (km.left ? 1 : 0), z: (km.down ? 1 : 0) - (km.up ? 1 : 0) };

    this.acquireT -= dt;
    if (this.attackMode && this.acquireT <= 0) {
      this.acquireT = 0.15;
      this.acquire(false);
    }
    // Bei gehaltener Angriffstaste und Ziel in Reichweite: stehen bleiben und angreifen
    if (mv && this.attackMode && p.order.type === "attack") {
      const t = p.order.target;
      const d = Math.hypot(t.x - p.x, t.z - p.z) - t.radius - p.radius;
      if (d <= p.stats.range) mv = null;
    }
    if (mv) {
      p.order = this.attackMode ? p.order : { type: "none" };
      p.path = [];
      this.world.cancelRecall(p);
    } else if (!this.attackMode && this.joy && p.order.type === "attack") {
      p.order = { type: "none" };
    }
    p.moveVec = mv;

    // Zielanzeige
    const ind = this.view.indicators;
    const g = this.world.grid;
    if (this.aim) {
      const a = this.aim;
      const y = g.groundAt(p.x, p.z);
      ind.hide();
      if (a.slot === "flash") {
        const pt = this.aimPoint(a);
        ind.showRange(p.x, p.z, 6.5, y);
        ind.showArea(pt.x, pt.z, 0.9, y, 0xfff080);
        return;
      }
      const ab = p.def.abilities[a.slot];
      ind.showRange(p.x, p.z, ab.range, y);
      const pt = this.aimPoint(a);
      if (!a.moved) return;
      if (ab.targeting === "dir") {
        const dx = pt.x - p.x;
        const dz = pt.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        ind.showArrow(p.x, p.z, dx / len, dz / len, Math.min(ab.range, 30), Math.max(1, ab.width ?? 1.2), y);
      } else if (ab.targeting === "point") {
        ind.showArea(pt.x, pt.z, ab.radius ?? 2, g.groundAt(pt.x, pt.z));
      } else if (ab.targeting === "unit") {
        const t = this.world.nearestEnemyChamp(p.team, pt.x, pt.z, 5);
        if (t) ind.showArea(t.x, t.z, 1.4, g.groundAt(t.x, t.z), 0xff6060);
      }
    }
  }

  destroy() {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
