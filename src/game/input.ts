import * as THREE from "three";
import type { Hud } from "./hud";
import type { V2 } from "./mapdata";
import { WATER_Y } from "./terrain";
import type { Champion, Unit } from "./units";
import type { View } from "./view";
import type { World } from "./world";

type AimSlot = 0 | 1 | 2 | 3 | "flash";
type Aim = { slot: AimSlot; id: number; cx: number; cy: number; x: number; y: number; moved: boolean; el: HTMLElement };

const MAX_DRAG = 80;
/** Zoomgrenzen fürs Mausrad (1 = Standard). Wie nah es höchstens geht, legt Game je nach Champion-Größe fest. */
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 1.35;

export class Input {
  private hud: Hud;
  private world: World;
  private view: View;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private aim: Aim | null = null;
  attackMode: "auto" | "minion" | "turret" | null = null;
  /** Ziel angeklickt: nach dessen Tod automatisch das nächste Ziel in der Nähe angreifen, bis ein anderer Befehl kommt */
  private autoFight = false;
  private attackId = -1;
  private mouse = { x: 0, y: 0, inside: false };
  /** Rechte Maustaste gehalten: Champion folgt laufend dem Mauszeiger (PC). */
  private rmb = { held: false, x: 0, y: 0, attack: false, ringT: 0, ringX: 0, ringZ: 0 };
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
      // Gegner, Minion, Monster oder Turm antippen: anvisieren und angreifen
      const tapped = this.p.alive ? this.unitAt(e.clientX, e.clientY) : null;
      if (tapped) {
        this.selectTarget(tapped);
        e.preventDefault();
        return;
      }
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
        // Loslassen verpasst (z. B. außerhalb des Fensters): Folgen beenden
        if (this.rmb.held && !(e.buttons & 3)) this.rmb.held = false;
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

    // Mittlere Taste und Seitentasten der Maus (Zurück/Vorwärts) sollen die Seite nicht verlassen oder Tabs öffnen
    const noNav = (e: MouseEvent) => {
      if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
    };
    this.on(window, "mousedown", noNav);
    this.on(window, "mouseup", noNav);
    this.on(window, "auxclick", noNav);
    // Neu laden oder Tab schließen (z. B. Strg+W/Strg+R aus Versehen) während der Partie erst nachfragen
    this.on(window, "beforeunload", (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    });

    // Maus auf dem Spielfeld
    this.on(this.canvas, "contextmenu", (e: MouseEvent) => e.preventDefault());
    this.on(root, "contextmenu", (e: MouseEvent) => e.preventDefault());
    this.on(root, "mousedown", (e: MouseEvent) => {
      if (this.paused()) return;
      const t = e.target as HTMLElement;
      // Knöpfe, Fenster und die Minimap reagieren nicht als Bewegungsbefehl
      if (t.closest("button") || t.closest(".modal") || t.closest(".tl")) return;
      // Rechts- und Linksklick laufen/greifen an; links, weil Browser-Mausgesten (Opera, Edge) beim Ziehen mit der
      // rechten Taste Tabs öffnen oder die Seite verlassen und eine Webseite das nicht abschalten kann
      if (e.button !== 2 && e.button !== 0) return;
      this.rightClick(e.clientX, e.clientY);
      const r = this.rmb;
      r.held = true;
      r.x = e.clientX;
      r.y = e.clientY;
      r.attack = this.p.order.type === "attack";
      r.ringT = 0.25;
      r.ringX = this.p.order.type === "move" ? this.p.order.x : this.p.x;
      r.ringZ = this.p.order.type === "move" ? this.p.order.z : this.p.z;
    });
    // Loslassen überall erkennen, auch außerhalb des Spielfelds; bei Fokusverlust nichts hängen lassen
    this.on(window, "mouseup", (e: MouseEvent) => {
      if (e.button === 2 || e.button === 0) this.rmb.held = false;
    });
    const release = () => {
      this.rmb.held = false;
      this.keysMove = { up: false, down: false, left: false, right: false };
      if (this.attackId === -2) {
        this.attackMode = null;
        this.attackId = -1;
      }
    };
    this.on(window, "blur", release);
    this.on(document as unknown as HTMLElement, "visibilitychange", () => {
      if (document.hidden) release();
    });
    this.on(document as unknown as HTMLElement, "mouseleave", () => (this.mouse.inside = false));
    this.on(
      root,
      "wheel",
      (e: WheelEvent) => {
        // stufenlos: Mausrad-Raster und Touchpad-Bewegung wirken gleichmäßig (ein Raster ≈ 20 %)
        const px = Math.max(-240, Math.min(240, e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1)));
        this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * Math.exp(px * (e.ctrlKey ? 0.01 : 0.0018))));
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
        // Verbessern mit Alt oder Umschalt; Strg+W schließt im Browser den Tab und lässt sich nicht abfangen
        if (e.altKey || e.shiftKey || e.ctrlKey) {
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
        this.autoFight = false;
        this.rmb.held = false;
        this.p.lockTarget = null;
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
    this.autoFight = false;
    if (this.p.recallUntil > 0) return;
    this.rmb.held = false;
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

  /**
   * Gehaltene rechte Maustaste: das Bewegungsziel folgt jedes Bild dem Mauszeiger (die Kamera bewegt sich mit,
   * darum wird der Punkt jedes Mal neu bestimmt). Wege plant World.followTo; bei freier Sicht ohne Pfadsuche.
   */
  private followMouse(dt: number) {
    const p = this.p;
    const r = this.rmb;
    if (!p.alive) return;
    // auf einen Gegner gedrückt: angreifen, bis die Maus mit gehaltener Taste weggezogen wird
    if (r.attack) {
      if (p.order.type === "attack" && Math.hypot(this.mouse.x - r.x, this.mouse.y - r.y) < 12 * this.scale()) return;
      r.attack = false;
    }
    const m = this.mouseWorld();
    const pt = this.world.freeGoal(p, m.x, m.z);
    if (Math.hypot(pt.x - p.x, pt.z - p.z) < 0.6) {
      if (p.order.type === "move") p.order = { type: "none" };
      return;
    }
    this.world.cancelRecall(p);
    this.autoFight = false;
    p.order = { type: "move", x: pt.x, z: pt.z };
    // kleine Zielmarkierung, sparsam
    r.ringT -= dt;
    if (r.ringT <= 0 && Math.hypot(pt.x - r.ringX, pt.z - r.ringZ) > 1) {
      r.ringT = 0.25;
      r.ringX = pt.x;
      r.ringZ = pt.z;
      this.view.ground.ring(pt.x, this.world.grid.groundAt(pt.x, pt.z), pt.z, 0.9, 0.2, 0x7dff6a, 0.3, 0.5);
    }
  }

  /** Punkt auf dem Gelände unter dem Mauszeiger (echte Bodenhöhe, Wasser im Fluss). */
  mouseWorld(): V2 {
    const nx = Math.max(-1, Math.min(1, (this.mouse.x / window.innerWidth) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, -(this.mouse.y / window.innerHeight) * 2 + 1));
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const g = this.world.grid;
    const below = (t: number) => o.y + d.y * t <= Math.max(g.heightAt(o.x + d.x * t, o.z + d.z * t), WATER_Y);
    if (d.y < -1e-3) {
      // vom höchsten Gelände abwärts in kleinen Schritten, dann den Schnittpunkt halbierend eingrenzen
      let prev = Math.max(0, (o.y - 6) / -d.y);
      const end = (o.y - WATER_Y) / -d.y + 0.5;
      for (let t = prev; t <= end; t += 0.5) {
        if (below(t)) {
          let lo = prev;
          let hi = t;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            if (below(mid)) hi = mid;
            else lo = mid;
          }
          return { x: o.x + d.x * hi, z: o.z + d.z * hi };
        }
        prev = t;
      }
    }
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, hit)) return { x: hit.x, z: hit.z };
    return { x: this.p.x, z: this.p.z };
  }

  /** Gegner anvisieren: hinlaufen und angreifen, Fähigkeiten zielen auf ihn. */
  private selectTarget(u: Unit) {
    const p = this.p;
    this.autoFight = true;
    this.world.cancelRecall(p);
    p.lockTarget = u;
    p.order = { type: "attack", target: u };
  }

  /** Angreifbarer Gegner unter dem Mauszeiger: Abstand zur Linie Füße–Kopf, in der Nahansicht entsprechend breiter. */
  unitAt(sx: number, sy: number): Unit | null {
    const w = this.world;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const base = 40 * this.scale();
    let best: Unit | null = null;
    let bestScore = 0;
    for (const u of w.all) {
      if (!w.attackable(u, this.p.team) || !this.view.isUnitShown(u)) continue;
      const gy = w.grid.groundAt(u.x, u.z);
      const foot = this.view.project(this.camera, u.x, gy, u.z, W, H);
      const head = this.view.project(this.camera, u.x, gy + u.height, u.z, W, H);
      // nur Einheiten, die wirklich im Bild sind (Fuß und Kopf vor der Kamera und auf dem Bildschirm)
      if (!foot.on || !head.on) continue;
      const mid = this.view.project(this.camera, u.x, gy + u.height * 0.5, u.z, W, H);
      const side = this.view.project(this.camera, u.x + u.radius, gy + u.height * 0.5, u.z, W, H);
      const reach = Math.max(base, Math.hypot(side.x - mid.x, side.z - mid.z));
      const bonus = u.kind === "turret" || u.kind === "nexus" || u.kind === "inhib" ? 30 : 0;
      const score = segDist(sx, sy, foot.x, foot.z, head.x, head.z) - bonus - reach;
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  private rightClick(sx: number, sy: number) {
    const w = this.world;
    const p = this.p;
    if (!p.alive) return;
    this.mouse.x = sx;
    this.mouse.y = sy;
    // Gegner unter dem Mauszeiger?
    const best = this.unitAt(sx, sy);
    if (best) {
      this.selectTarget(best);
      return;
    }
    // Klick auf den Boden hebt die Markierung auf und beendet das Weiterkämpfen
    this.autoFight = false;
    w.cancelRecall(p);
    p.lockTarget = null;
    const m = this.mouseWorld();
    const pt = w.freeGoal(p, m.x, m.z);
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
      this.autoFight = false;
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

    // Ziel getötet (oder verloren): nächstes Ziel in der Nähe anvisieren und weiterkämpfen
    if (this.autoFight && !mv && (p.order.type !== "attack" || !this.world.attackable(p.order.target, p.team))) {
      const next = this.world.pickTarget(p, "auto", Math.max(8, p.stats.range + 4));
      if (next) this.selectTarget(next);
    }
    if (mv) this.autoFight = false;
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
    if (!mv && this.rmb.held) this.followMouse(dt);
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

/** Abstand eines Punkts zur Strecke a–b (Bildschirmpixel). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(1e-6, dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
