import type * as THREE from "three";
import { ITEMS, ITEM_BY_ID } from "./items";
import { CAMPS, MAP } from "./mapdata";
import type { NavGrid } from "./navgrid";
import { Champion, Minion, Monster, Structure, type Unit } from "./units";
import type { View } from "./view";
import type { World } from "./world";

type Floater = { x: number; y: number; z: number; text: string; color: string; t: number; size: number; vx: number };

const fmtTime = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export type HudCallbacks = {
  onPause: () => void;
  onResume: () => void;
  onSurrender: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSound: (on: boolean) => void;
  onLevelUp: (slot: number) => void;
  onBuy: (id: string) => void;
};

export class Hud {
  readonly root: HTMLElement;
  readonly overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private mini: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private miniBase: HTMLCanvasElement;
  private floaters: Floater[] = [];
  private world: World;
  private view: View;
  private cb: HudCallbacks;
  private els: Record<string, HTMLElement> = {};
  readonly skillBtns: HTMLButtonElement[] = [];
  readonly plusBtns: HTMLButtonElement[] = [];
  private miniT = 0;
  private announceT = 0;
  private dpr = 1;
  private shopOpen = false;
  private lastShopKey = "";
  private soundOn = true;

  constructor(parent: HTMLElement, world: World, view: View, cb: HudCallbacks) {
    this.world = world;
    this.view = view;
    this.cb = cb;
    const root = document.createElement("div");
    root.className = "hud";
    const p = world.player;
    const ab = p.def.abilities;
    const keys = ["Q", "W", "E", "R"];
    root.innerHTML = `
      <canvas class="overlay"></canvas>
      <div class="tl"><canvas class="minimap" width="260" height="260"></canvas></div>
      <div class="tc">
        <button class="score" data-el="score"><span class="k blue" data-el="kb">0</span><span class="sw">⚔</span><span class="clock" data-el="clock">00:00</span><span class="sw">⚔</span><span class="k red" data-el="kr">0</span></button>
        <div class="kda" data-el="kda">0/0/0 · 0 CS</div>
      </div>
      <div class="tr">
        <button class="round-btn" data-el="pause" aria-label="Pause">❚❚</button>
      </div>
      <div class="lp">
        <button class="shop-btn" data-el="shopbtn"><span class="coin"></span><span data-el="gold">500</span></button>
        <button class="qbuy" data-el="qbuy"><span class="qb-ico" data-el="qbico"></span><span class="qb-cost" data-el="qbcost"></span></button>
        <div class="inv" data-el="inv"></div>
      </div>
      <div class="me">
        <div class="me-port" style="--c:${p.def.color}"><span>${p.def.name[0]}</span><b data-el="lvl">1</b></div>
        <div class="me-bars">
          <div class="bar hp"><i data-el="hpfill"></i><span data-el="hptext"></span></div>
          <div class="bar mp"><i data-el="mpfill"></i></div>
          <div class="bar xp"><i data-el="xpfill"></i></div>
        </div>
      </div>
      <div class="joy" data-el="joy"><div class="joy-knob" data-el="knob"></div></div>
      <div class="skills" data-el="skills">
        <button class="atk" data-el="atk" aria-label="Angriff"><span>⚔</span></button>
        <button class="atk-s minion" data-el="atkm" aria-label="Minion angreifen">◆</button>
        <button class="atk-s turret" data-el="atkt" aria-label="Turm angreifen">♜</button>
        ${[0, 1, 2, 3]
          .map(
            (i) => `
          <button class="skill s${i}" data-slot="${i}" style="--c:${p.def.color}" aria-label="${ab[i].name}">
            <span class="ico">${ab[i].icon}</span>
            <span class="cd"></span><span class="cdt"></span>
            <span class="key">${keys[i]}</span>
            <span class="pips">${(i === 3 ? [0, 1, 2] : [0, 1, 2, 3]).map(() => "<i></i>").join("")}</span>
          </button>
          <button class="plus p${i}" data-plus="${i}" aria-label="${ab[i].name} verbessern">+</button>`,
          )
          .join("")}
        <button class="spell sf" data-el="flash" aria-label="Blitz"><span class="ico">⚡</span><span class="cd"></span><span class="cdt"></span><span class="key">D</span></button>
        <button class="spell sh" data-el="spell2" aria-label="${p.spell2 === "heal" ? "Heilen" : "Zerschmettern"}"><span class="ico">${p.spell2 === "heal" ? "✚" : "✦"}</span><span class="cd"></span><span class="cdt"></span><span class="key">F</span></button>
      </div>
      <button class="recall" data-el="recall" aria-label="Rückruf"><span>⌂</span><b>B</b></button>
      <div class="cancel" data-el="cancel">✕</div>
      <div class="announce" data-el="announce"><b></b><small></small></div>
      <div class="death" data-el="death"><small>Wiederbelebung in</small><b data-el="deatht">0</b></div>
      <div class="modal hidden" data-el="shop">
        <div class="panel shop">
          <header><h2>Laden</h2><span class="gold-big"><span class="coin"></span><b data-el="shopgold">0</b></span><button class="round-btn" data-el="shopclose">✕</button></header>
          <p class="shop-note" data-el="shopnote"></p>
          <div class="shop-inv" data-el="shopinv"></div>
          <div class="shop-grid" data-el="shopgrid"></div>
        </div>
      </div>
      <div class="modal hidden" data-el="pausem">
        <div class="panel small">
          <h2>Pause</h2>
          <button class="mbtn gold" data-el="resume">Weiter</button>
          <button class="mbtn" data-el="sound">Ton: An</button>
          <button class="mbtn" data-el="board">Punktetafel</button>
          <button class="mbtn danger" data-el="surrender">Aufgeben</button>
          <p class="help">Handy: links ziehen zum Laufen, rechts angreifen. Fähigkeit antippen = automatisch zielen, ziehen = selbst zielen.<br>PC: Rechtsklick laufen/angreifen, Q W E R zum Zaubern (zur Maus), D Blitz, F Heilen, B Rückruf, P Laden, Strg+Q/W/E/R verbessern.</p>
        </div>
      </div>
      <div class="modal hidden" data-el="boardm">
        <div class="panel wide"><h2>Punktetafel</h2><div data-el="boardtbl"></div><button class="mbtn gold" data-el="boardclose">Schließen</button></div>
      </div>
      <div class="modal hidden" data-el="endm">
        <div class="panel wide end">
          <h1 data-el="endtitle">SIEG</h1>
          <p data-el="endsub"></p>
          <div class="row"><button class="mbtn gold" data-el="again">Nochmal spielen</button><button class="mbtn" data-el="menu">Hauptmenü</button></div>
          <div data-el="endtbl"></div>
        </div>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    root.querySelectorAll<HTMLElement>("[data-el]").forEach((el) => (this.els[el.dataset.el!] = el));
    root.querySelectorAll<HTMLButtonElement>("button.skill").forEach((b) => this.skillBtns.push(b));
    root.querySelectorAll<HTMLButtonElement>("button.plus").forEach((b) => this.plusBtns.push(b));
    this.overlay = root.querySelector("canvas.overlay")!;
    this.octx = this.overlay.getContext("2d")!;
    this.mini = root.querySelector("canvas.minimap")!;
    this.mctx = this.mini.getContext("2d")!;
    this.miniBase = this.renderMiniBase(world.grid);

    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "slot";
      this.els.inv.appendChild(s);
    }

    const tap = (el: HTMLElement, fn: () => void) =>
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        fn();
      });
    tap(this.els.pause, () => cb.onPause());
    tap(this.els.resume, () => cb.onResume());
    tap(this.els.surrender, () => cb.onSurrender());
    tap(this.els.again, () => cb.onRestart());
    tap(this.els.menu, () => cb.onMenu());
    tap(this.els.sound, () => {
      this.soundOn = !this.soundOn;
      this.els.sound.textContent = `Ton: ${this.soundOn ? "An" : "Aus"}`;
      cb.onSound(this.soundOn);
    });
    tap(this.els.board, () => {
      this.renderBoard(this.els.boardtbl);
      this.els.boardm.classList.remove("hidden");
    });
    tap(this.els.score, () => {
      this.renderBoard(this.els.boardtbl);
      this.els.boardm.classList.remove("hidden");
    });
    tap(this.els.boardclose, () => this.els.boardm.classList.add("hidden"));
    tap(this.els.shopbtn, () => this.toggleShop(true));
    tap(this.els.shopclose, () => this.toggleShop(false));
    tap(this.els.qbuy, () => {
      const next = world.nextBuild(p);
      if (next) cb.onBuy(next);
    });
    this.plusBtns.forEach((b) => tap(b, () => cb.onLevelUp(Number(b.dataset.plus))));
    this.resize();
  }

  get shopVisible() {
    return this.shopOpen;
  }

  toggleShop(open?: boolean) {
    this.shopOpen = open ?? !this.shopOpen;
    this.els.shop.classList.toggle("hidden", !this.shopOpen);
    this.lastShopKey = "";
    if (this.shopOpen) this.renderShop();
  }

  showPause(on: boolean) {
    this.els.pausem.classList.toggle("hidden", !on);
    if (!on) this.els.boardm.classList.add("hidden");
  }

  get el() {
    return this.els;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.overlay.width = Math.round(w * this.dpr);
    this.overlay.height = Math.round(h * this.dpr);
    this.overlay.style.width = `${w}px`;
    this.overlay.style.height = `${h}px`;
    const s = Math.max(0.62, Math.min(1.25, Math.min(h / 430, w / 760)));
    this.root.style.setProperty("--s", s.toFixed(3));
  }

  private renderMiniBase(grid: NavGrid) {
    const c = document.createElement("canvas");
    c.width = c.height = grid.n;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(grid.n, grid.n);
    for (let i = 0; i < grid.n * grid.n; i++) {
      let r = 26;
      let g = 46;
      let b = 30;
      if (grid.walk[i]) {
        [r, g, b] = [58, 86, 52];
        if (grid.lane[i] > 0.5) [r, g, b] = [120, 104, 78];
        if (grid.river[i] > 0.4) [r, g, b] = [44, 96, 120];
        if (grid.base[i] === 0) [r, g, b] = [60, 84, 120];
        if (grid.base[i] === 1) [r, g, b] = [118, 66, 62];
        if (grid.brush[i] >= 0) [r, g, b] = [40, 110, 60];
      }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private drawMinimap(camera: THREE.PerspectiveCamera, camTarget: { x: number; z: number }, viewW: number, viewH: number) {
    const ctx = this.mctx;
    const W = this.mini.width;
    const k = W / MAP;
    const w = this.world;
    const team = w.player.team;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.miniBase, 0, 0, W, W);
    // Nebel
    const fog = this.view.fog.data;
    ctx.fillStyle = "rgba(5,10,20,0.45)";
    const cell = W / 128;
    for (let z = 0; z < 128; z += 2) {
      for (let x = 0; x < 128; x += 2) {
        if (fog[z * 128 + x] < 90) ctx.fillRect(x * cell, z * cell, cell * 2, cell * 2);
      }
    }
    // Camps
    for (const camp of CAMPS) {
      if (!w.campAlive.get(camp.id)) continue;
      const big = camp.kind === "baron" || camp.kind === "dragon";
      ctx.fillStyle = camp.kind === "baron" ? "#c070ff" : camp.kind === "dragon" ? "#ff8a3a" : "#e8c860";
      ctx.beginPath();
      ctx.arc(camp.pos.x * k, camp.pos.z * k, big ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Gebäude
    for (const s of w.structures) {
      const col = s.team === team ? "#4fb0ff" : "#ff5a48";
      const x = s.x * k;
      const z = s.z * k;
      ctx.fillStyle = s.alive ? col : "#444";
      ctx.strokeStyle = "#0b0f18";
      ctx.lineWidth = 2;
      const r = s.kind === "nexus" ? 9 : s.kind === "inhib" ? 6 : 5;
      ctx.beginPath();
      if (s.kind === "turret") ctx.rect(x - r, z - r, r * 2, r * 2);
      else ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Minions
    for (const m of w.minions) {
      if (!m.alive || !this.seen(m)) continue;
      ctx.fillStyle = m.team === team ? "#7fc8ff" : "#ff8070";
      ctx.fillRect(m.x * k - 2, m.z * k - 2, 4, 4);
    }
    // Champions
    for (const c of w.champs) {
      if (!c.alive || !this.seen(c)) continue;
      const x = c.x * k;
      const z = c.z * k;
      ctx.fillStyle = c.def.color;
      ctx.strokeStyle = c.isPlayer ? "#ffe060" : c.team === team ? "#4fb0ff" : "#ff4030";
      ctx.lineWidth = c.isPlayer ? 4 : 3;
      ctx.beginPath();
      ctx.arc(x, z, c.isPlayer ? 10 : 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.def.name[0], x, z + 0.5);
    }
    // Kamera-Ausschnitt
    const corners = [
      [0, 0],
      [viewW, 0],
      [viewW, viewH],
      [0, viewH],
    ];
    const pts = corners.map(([sx, sy]) => this.screenToGround(camera, sx, sy, viewW, viewH) ?? camTarget);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x * k, q.z * k) : ctx.moveTo(q.x * k, q.z * k)));
    ctx.closePath();
    ctx.stroke();
  }

  screenToGround(camera: THREE.PerspectiveCamera, sx: number, sy: number, w: number, h: number) {
    const nx = (sx / w) * 2 - 1;
    const ny = -(sy / h) * 2 + 1;
    const near = { x: nx, y: ny, z: -1 };
    const far = { x: nx, y: ny, z: 1 };
    const a = (camera as THREE.PerspectiveCamera).position.clone().set(near.x, near.y, near.z).unproject(camera);
    const b = a.clone().set(far.x, far.y, far.z).unproject(camera);
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-6) return null;
    const t = (0 - a.y) / dy;
    if (t < 0) return null;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  private seen(u: Unit) {
    const team = this.world.player.team as 0 | 1;
    return u.team === team || u.vis[team];
  }

  addFloater(u: Unit, text: string, color: string, size = 1) {
    this.floaters.push({ x: u.x, y: u.height + 0.6, z: u.z, text, color, t: 0, size, vx: (Math.random() - 0.5) * 40 });
    if (this.floaters.length > 60) this.floaters.shift();
  }

  announce(text: string, sub = "", tone: "good" | "bad" | "neutral" = "neutral") {
    const el = this.els.announce;
    (el.querySelector("b") as HTMLElement).textContent = text;
    (el.querySelector("small") as HTMLElement).textContent = sub;
    el.className = `announce show ${tone}`;
    this.announceT = 3.2;
  }

  showEnd(win: boolean) {
    this.els.endtitle.textContent = win ? "SIEG" : "NIEDERLAGE";
    this.els.endtitle.className = win ? "win" : "lose";
    const w = this.world;
    this.els.endsub.textContent = `Spielzeit ${fmtTime(w.t)} · Kills ${w.score[0]} : ${w.score[1]}`;
    this.renderBoard(this.els.endtbl);
    this.els.endm.classList.remove("hidden");
    this.toggleShop(false);
  }

  private renderBoard(el: HTMLElement) {
    const w = this.world;
    const row = (c: Champion) => `<tr class="${c.isPlayer ? "mine" : ""}">
      <td><span class="dot" style="background:${c.def.color}"></span>${c.def.name}<small>${c.name}</small></td>
      <td>${c.level}</td><td>${c.kills}/${c.deaths}/${c.assists}</td><td>${c.cs}</td>
      <td class="its">${c.items.map((i) => ITEM_BY_ID[i]?.icon ?? "").join("")}</td></tr>`;
    const team = (t: number, name: string, cls: string) => `<table class="board ${cls}"><thead><tr><th>${name}</th><th>Lv</th><th>K/D/A</th><th>CS</th><th>Items</th></tr></thead><tbody>${w.champs
      .filter((c) => c.team === t)
      .map(row)
      .join("")}</tbody></table>`;
    el.innerHTML = team(0, "Blaues Team", "blue") + team(1, "Rotes Team", "red");
  }

  private renderShop() {
    const w = this.world;
    const p = w.player;
    const can = w.canShop(p);
    const key = `${Math.floor(p.gold)}|${p.items.join(",")}|${can}`;
    if (key === this.lastShopKey) return;
    this.lastShopKey = key;
    this.els.shopgold.textContent = String(Math.floor(p.gold));
    this.els.shopnote.textContent = can ? "Tippe auf ein Item zum Kaufen. Empfohlene Items sind golden markiert." : "Einkaufen geht nur in der eigenen Basis oder während du tot bist.";
    this.els.shopinv.innerHTML = Array.from({ length: 6 }, (_, i) => {
      const it = p.items[i] ? ITEM_BY_ID[p.items[i]] : null;
      return `<div class="slot">${it ? it.icon : ""}</div>`;
    }).join("");
    const rec = new Set(p.def.build);
    const groups: [string, (i: (typeof ITEMS)[number]) => boolean][] = [
      ["Stiefel", (i) => !!i.boots],
      ["Grundlagen", (i) => i.tier === 1 && !i.boots],
      ["Legendär", (i) => i.tier === 3],
    ];
    this.els.shopgrid.innerHTML = groups
      .map(
        ([title, f]) =>
          `<h3>${title}</h3><div class="items">${ITEMS.filter(f)
            .map((it) => {
              let cost = it.cost;
              if (it.id === "swiftboots" && p.items.includes("boots")) cost -= 300;
              const owned = p.items.includes(it.id);
              const ok = can && !owned && p.gold >= cost && (p.items.length < 6 || (it.id === "swiftboots" && p.items.includes("boots")));
              return `<button class="item ${rec.has(it.id) ? "rec" : ""} ${ok ? "" : "no"} ${owned ? "own" : ""}" data-buy="${it.id}">
                <span class="i-ico">${it.icon}</span><span class="i-name">${it.name}</span><span class="i-desc">${it.desc}</span><span class="i-cost">${owned ? "Besitz" : cost}</span></button>`;
            })
            .join("")}</div>`,
      )
      .join("");
    this.els.shopgrid.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((b) =>
      b.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.cb.onBuy(b.dataset.buy!);
        this.lastShopKey = "";
        this.renderShop();
      }),
    );
  }

  update(dt: number, camera: THREE.PerspectiveCamera, camTarget: { x: number; z: number }) {
    const w = this.world;
    const p = w.player;
    const E = this.els;
    E.kb.textContent = String(w.score[p.team as 0 | 1]);
    E.kr.textContent = String(w.score[1 - (p.team as number)]);
    E.clock.textContent = fmtTime(w.t);
    E.kda.textContent = `${p.kills}/${p.deaths}/${p.assists} · ${p.cs} CS`;
    E.gold.textContent = String(Math.floor(p.gold));
    E.lvl.textContent = String(p.level);
    (E.hpfill as HTMLElement).style.width = `${(p.hp / p.stats.maxHp) * 100}%`;
    E.hptext.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.stats.maxHp)}`;
    (E.mpfill as HTMLElement).style.width = `${(p.mana / Math.max(1, p.stats.maxMana)) * 100}%`;
    (E.xpfill as HTMLElement).style.width = p.level >= 15 ? "100%" : `${(p.xp / p.xpToNext()) * 100}%`;

    // Items
    const slots = E.inv.children;
    for (let i = 0; i < 6; i++) {
      const it = p.items[i];
      const s = slots[i] as HTMLElement;
      const ico = it ? ITEM_BY_ID[it].icon : "";
      if (s.textContent !== ico) s.textContent = ico;
    }
    // Schnellkauf
    const next = w.nextBuild(p);
    if (next) {
      const it = ITEM_BY_ID[next];
      let cost = it.cost;
      if (next === "swiftboots" && p.items.includes("boots")) cost -= 300;
      E.qbico.textContent = it.icon;
      E.qbcost.textContent = String(cost);
      E.qbuy.classList.toggle("ready", w.canShop(p) && p.gold >= cost);
      E.qbuy.style.display = "";
    } else E.qbuy.style.display = "none";

    // Fähigkeiten
    for (let i = 0; i < 4; i++) {
      const b = this.skillBtns[i];
      const rank = p.ranks[i];
      const cd = p.cds[i];
      const full = p.cdFor(i);
      b.classList.toggle("locked", rank === 0);
      b.classList.toggle("nomana", rank > 0 && p.mana < p.manaFor(i));
      const cdEl = b.children[1] as HTMLElement;
      const cdt = b.children[2] as HTMLElement;
      if (cd > 0 && rank > 0) {
        cdEl.style.background = `conic-gradient(rgba(0,0,0,0.72) ${(cd / full) * 360}deg, transparent 0)`;
        cdt.textContent = cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1);
      } else {
        cdEl.style.background = "transparent";
        cdt.textContent = "";
      }
      const pips = b.querySelectorAll(".pips i");
      pips.forEach((pp, j) => pp.classList.toggle("on", j < rank));
      this.plusBtns[i].classList.toggle("show", p.canRank(i) && p.alive !== undefined);
    }
    const spellCd = (el: HTMLElement, cd: number, full: number) => {
      const cdEl = el.children[1] as HTMLElement;
      const cdt = el.children[2] as HTMLElement;
      if (cd > 0) {
        cdEl.style.background = `conic-gradient(rgba(0,0,0,0.72) ${(cd / full) * 360}deg, transparent 0)`;
        cdt.textContent = String(Math.ceil(cd));
      } else {
        cdEl.style.background = "transparent";
        cdt.textContent = "";
      }
    };
    spellCd(E.flash, p.flashCd, 150);
    spellCd(E.spell2, p.spell2Cd, p.spell2 === "heal" ? 110 : 35);
    E.recall.classList.toggle("active", p.recallUntil > 0);

    // Tod
    E.death.classList.toggle("show", !p.alive && w.winner === null);
    if (!p.alive) E.deatht.textContent = String(Math.max(0, Math.ceil(p.respawnAt - w.t)));

    // Ansage
    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0) E.announce.classList.remove("show");
    }

    if (this.shopOpen) this.renderShop();

    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 0.15;
      this.drawMinimap(camera, camTarget, window.innerWidth, window.innerHeight);
    }
    this.drawOverlay(dt, camera);
  }

  private drawOverlay(dt: number, camera: THREE.PerspectiveCamera) {
    const ctx = this.octx;
    const dpr = this.dpr;
    const W = window.innerWidth;
    const H = window.innerHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const w = this.world;
    const g = w.grid;
    const team = w.player.team;
    const scale = Number(this.root.style.getPropertyValue("--s")) || 1;

    const bar = (u: Unit, bw: number, bh: number, color: string, extra?: (x: number, y: number) => void) => {
      const gy = g.groundAt(u.x, u.z);
      const pos = this.view.project(camera, u.x, gy + u.height + 0.4, u.z, W, H);
      // in der Nahansicht nicht weit über dem Kopf schweben lassen
      const head = this.view.project(camera, u.x, gy + u.height, u.z, W, H);
      if (head.on) pos.z = Math.max(pos.z, head.z - 16 * scale);
      if (!pos.on || pos.x < -80 || pos.x > W + 80 || pos.z < -40 || pos.z > H + 40) return;
      const x = pos.x - bw / 2;
      const y = pos.z - bh;
      ctx.fillStyle = "rgba(8,10,16,0.85)";
      ctx.fillRect(x - 1.5, y - 1.5, bw + 3, bh + 3);
      const f = Math.max(0, u.hp / u.stats.maxHp);
      const sh = u.shield > 0 ? Math.min(1 - f, u.shield / u.stats.maxHp) : 0;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, bw * f, bh);
      if (sh > 0) {
        ctx.fillStyle = "#e8eef8";
        ctx.fillRect(x + bw * f, y, bw * sh, bh);
      }
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x, y, bw * f, bh * 0.35);
      extra?.(x, y);
    };

    // Minions
    for (const m of w.minions) {
      if (!m.alive || !this.seen(m)) continue;
      bar(m, 30 * scale, 4 * scale, m.team === team ? "#3f9bff" : "#e84a3a");
    }
    // Monster
    for (const m of w.monsters) {
      if (!m.alive || !this.seen(m) || m.hp >= m.stats.maxHp) continue;
      bar(m, (m.big ? 60 : 36) * scale, 5 * scale, "#e8b040");
    }
    // Gebäude: breite Leiste mit Goldrahmen und Segmenten, immer sichtbar
    for (const st of w.structures) {
      if (!st.alive) continue;
      const pos = this.view.project(camera, st.x, g.groundAt(st.x, st.z) + st.height + 0.5, st.z, W, H);
      if (!pos.on || pos.x < -120 || pos.x > W + 120 || pos.z < -40 || pos.z > H + 40) continue;
      const bw = (st.kind === "nexus" ? 120 : st.kind === "inhib" ? 92 : 104) * scale;
      const bh = 9 * scale;
      const x = pos.x - bw / 2;
      const y = pos.z - bh;
      const ally = st.team === team;
      ctx.fillStyle = "rgba(6,8,12,0.92)";
      ctx.fillRect(x - 3, y - 3, bw + 6, bh + 6);
      ctx.strokeStyle = st.invulnerable ? "#7a6a48" : "#c8aa6e";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 3, y - 3, bw + 6, bh + 6);
      const f = Math.max(0, st.hp / st.stats.maxHp);
      const grad = ctx.createLinearGradient(0, y, 0, y + bh);
      if (ally) {
        grad.addColorStop(0, "#6cc0ff");
        grad.addColorStop(1, "#1f6ad0");
      } else {
        grad.addColorStop(0, "#ff6a58");
        grad.addColorStop(1, "#a8221a");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, bw * f, bh);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(x, y, bw * f, bh * 0.35);
      // Segmente
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 5; i++) {
        const sx = x + (bw * i) / 5;
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.lineTo(sx, y + bh);
        ctx.stroke();
      }
      // goldene Spitze unten in der Mitte
      ctx.fillStyle = "#c8aa6e";
      ctx.beginPath();
      ctx.moveTo(pos.x - 5 * scale, y + bh + 3);
      ctx.lineTo(pos.x + 5 * scale, y + bh + 3);
      ctx.lineTo(pos.x, y + bh + 8 * scale);
      ctx.closePath();
      ctx.fill();
      if (st.invulnerable) {
        ctx.font = `${11 * scale}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🛡", x - 12 * scale, y + bh / 2);
      }
    }
    // Champions
    for (const c of w.champs) {
      if (!c.alive || !this.view.isUnitShown(c)) continue;
      const col = c.isPlayer ? "#5ee04a" : c.team === team ? "#3f9bff" : "#e84a3a";
      const bw = 78 * scale;
      const bh = 9 * scale;
      bar(c, bw, bh, col, (x, y) => {
        // Unterteilungen pro 200 Leben
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 1;
        const step = (200 / c.stats.maxHp) * bw;
        for (let sx = step; sx < bw; sx += step) {
          ctx.beginPath();
          ctx.moveTo(x + sx, y);
          ctx.lineTo(x + sx, y + bh * 0.6);
          ctx.stroke();
        }
        // Mana
        ctx.fillStyle = "rgba(8,10,16,0.85)";
        ctx.fillRect(x - 1.5, y + bh + 1, bw + 3, 4 * scale);
        ctx.fillStyle = "#4a8cff";
        ctx.fillRect(x, y + bh + 1.5, bw * (c.mana / Math.max(1, c.stats.maxMana)), 3 * scale);
        // Stufe
        const lx = x - 17 * scale;
        ctx.fillStyle = "#0b0f18";
        ctx.fillRect(lx, y - 3 * scale, 15 * scale, 16 * scale);
        ctx.strokeStyle = "#c8aa6e";
        ctx.strokeRect(lx, y - 3 * scale, 15 * scale, 16 * scale);
        ctx.fillStyle = "#f0e6d2";
        ctx.font = `bold ${10 * scale}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(c.level), lx + 7.5 * scale, y + 5 * scale);
        // Name
        ctx.font = `600 ${10.5 * scale}px sans-serif`;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(c.isPlayer ? c.def.name : `${c.name} · ${c.def.name}`, x + bw / 2 + 1, y - 7 * scale + 1);
        ctx.fillStyle = c.isPlayer ? "#d8ffb0" : "#f0e6d2";
        ctx.fillText(c.isPlayer ? c.def.name : `${c.name} · ${c.def.name}`, x + bw / 2, y - 7 * scale);
        // Rückruf-Fortschritt
        if (c.recallUntil > 0) {
          const k = (w.t - c.recallStart) / Math.max(0.1, c.recallUntil - c.recallStart);
          ctx.fillStyle = "rgba(8,10,16,0.85)";
          ctx.fillRect(x, y + bh + 7 * scale, bw, 4 * scale);
          ctx.fillStyle = "#7fd8ff";
          ctx.fillRect(x, y + bh + 7 * scale, bw * k, 4 * scale);
        }
      });
    }

    // Schwebende Zahlen
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floaters) {
      f.t += dt;
      const pos = this.view.project(camera, f.x, g.groundAt(f.x, f.z) + f.y, f.z, W, H);
      if (!pos.on) continue;
      const a = Math.max(0, 1 - f.t / 0.9);
      const rise = f.t * 55;
      const pop = f.t < 0.12 ? 1 + (0.12 - f.t) * 4 : 1;
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round(15 * f.size * scale * pop)}px sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(f.text, pos.x + f.vx * f.t, pos.z - rise);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, pos.x + f.vx * f.t, pos.z - rise);
    }
    ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.t < 0.9);
  }

  /** Verarbeitet Spielereignisse für Zahlen und Ansagen. */
  onEvents(sfx: (name: string, x: number, z: number) => void) {
    const w = this.world;
    const p = w.player;
    for (const e of w.events) {
      switch (e.type) {
        case "dmg": {
          const amt = Math.round(e.amount);
          if (amt < 1) break;
          if (e.src === p && e.unit !== p) {
            const color = e.crit ? "#ffd23a" : e.dtype === "magic" ? "#c890ff" : e.dtype === "true" ? "#ffffff" : "#ffb070";
            this.addFloater(e.unit, e.crit ? `${amt}!` : String(amt), color, e.crit ? 1.35 : 1);
          } else if (e.unit === p && amt >= 5) {
            this.addFloater(p, `-${amt}`, "#ff5a5a", 0.85);
          }
          break;
        }
        case "heal":
          if (e.unit === p && e.amount > 15) this.addFloater(p, `+${Math.round(e.amount)}`, "#7dff8a", 0.95);
          break;
        case "gold":
          if (e.unit === p && e.amount >= 10) {
            this.addFloater(p, `+${Math.round(e.amount)}`, "#ffd23a", 0.9);
            sfx("gold", p.x, p.z);
          }
          break;
        case "levelup":
          if (e.unit === p) {
            this.announce(`Stufe ${p.level}`, p.points > 0 ? "Verbessere eine Fähigkeit (+)" : "", "good");
            sfx("levelup", p.x, p.z);
          }
          break;
        case "kill": {
          const v = e.victim;
          const k = e.killer;
          const kName = k instanceof Champion ? (k.isPlayer ? "Du" : `${k.name} (${k.def.name})`) : k instanceof Structure ? "Ein Turm" : k instanceof Minion ? "Minions" : k instanceof Monster ? k.label : "Der Brunnen";
          const vName = v.isPlayer ? "dich" : `${v.name} (${v.def.name})`;
          const good = v.team !== p.team;
          if (v.isPlayer) this.announce("Du wurdest getötet", `${kName} hat dich erwischt`, "bad");
          else if (k === p) this.announce("Gegner getötet!", `${v.def.name} ist gefallen`, "good");
          else this.announce(good ? "Ein Gegner wurde getötet" : "Ein Verbündeter ist gefallen", `${kName} → ${vName}`, good ? "good" : "bad");
          sfx("announce", p.x, p.z);
          break;
        }
        case "announce": {
          const tone = e.team === -1 ? "neutral" : e.team === p.team ? "good" : "bad";
          this.announce(e.text, e.sub ?? "", tone);
          sfx("announce", p.x, p.z);
          break;
        }
        default:
          break;
      }
    }
  }

  destroy() {
    this.root.remove();
  }
}
