import "./style.css";
import * as THREE from "three";
import { Sfx } from "./game/audio";
import { CHAMPIONS, ROLE_NAMES, type Role } from "./game/champions";
import { Game, navGrid } from "./game/game";
import { buildChampion, loadChampionModels, loadGuardian, loadInhibitor, loadNexus, loadStartBase, loadBaseGround, loadJungleCamp, loadTrees } from "./game/models";
import type { Quality } from "./game/terrain";
import type { Difficulty } from "./game/world";

type Settings = { champ: string; role: Role; difficulty: Difficulty; quality: Quality; sound: boolean };

const app = document.getElementById("app")!;
const sfx = new Sfx();

function load(): Settings {
  const isTouch = matchMedia("(pointer: coarse)").matches;
  const def: Settings = { champ: "lyra", role: "bot", difficulty: "normal", quality: isTouch ? "low" : "high", sound: true };
  try {
    const raw = localStorage.getItem("kluft-settings");
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* Speicher nicht verfügbar */
  }
  return def;
}
function save(s: Settings) {
  try {
    localStorage.setItem("kluft-settings", JSON.stringify(s));
  } catch {
    /* egal */
  }
}

const settings = load();
// 3D-Modelle (Türme, Inhibitoren, Nexus, Startbasis, Champions) gleich beim Start laden, damit Auswahlbilder und Spiel sie nutzen
const modelsReady = Promise.all([loadGuardian(), loadInhibitor(), loadNexus(), loadStartBase(), loadBaseGround(), loadJungleCamp(), loadTrees(settings.quality), loadChampionModels()]);
const params = new URLSearchParams(location.search);
let portraits: Record<string, string> | null = null;

function renderPortraits(): Record<string, string> {
  if (portraits) return portraits;
  const out: Record<string, string> = {};
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(256, 256);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(2.6, 2.6, 5.2);
    cam.lookAt(0, 1.4, 0);
    for (const c of CHAMPIONS) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x404050, 2.2));
      const d = new THREE.DirectionalLight(0xffffff, 2.2);
      d.position.set(3, 5, 4);
      scene.add(d);
      const m = buildChampion(c.look, 0xffffff, c.id);
      m.ring.visible = false;
      m.body.rotation.y = 0.5;
      m.armR.rotation.x = -0.6;
      m.armL.rotation.x = c.look.weapon === "bow" ? -1.4 : -0.2;
      scene.add(m.root);
      r.setClearColor(0x000000, 0);
      r.render(scene, cam);
      out[c.id] = r.domElement.toDataURL();
    }
    r.dispose();
  } catch {
    /* ohne WebGL keine Bilder */
  }
  portraits = out;
  return out;
}

function title() {
  app.innerHTML = `
    <div class="menu title-screen">
      <div class="title-bg"></div>
      <div class="title-box">
        <p class="eyebrow">5 gegen 5 · MOBA</p>
        <h1 class="logo">KLUFT DER<br>LEGENDEN</h1>
        <p class="tag">Drei Lanes. Ein Jungle. Zerstöre den gegnerischen Nexus.</p>
        <button class="mbtn gold big" id="play">Spielen</button>
        <div class="row">
          <button class="mbtn" id="quality">Grafik: ${settings.quality === "high" ? "Hoch" : "Schnell"}</button>
          <button class="mbtn" id="sound">Ton: ${settings.sound ? "An" : "Aus"}</button>
        </div>
        <p class="hint">Am Handy quer halten. Tipp: Über „Zum Home-Bildschirm“ läuft es im Vollbild.</p>
      </div>
    </div>`;
  app.querySelector("#play")!.addEventListener("click", () => {
    sfx.unlock();
    sfx.play("click");
    void modelsReady.then(() => select());
  });
  app.querySelector("#quality")!.addEventListener("click", (e) => {
    settings.quality = settings.quality === "high" ? "low" : "high";
    (e.target as HTMLElement).textContent = `Grafik: ${settings.quality === "high" ? "Hoch" : "Schnell"}`;
    save(settings);
  });
  app.querySelector("#sound")!.addEventListener("click", (e) => {
    settings.sound = !settings.sound;
    (e.target as HTMLElement).textContent = `Ton: ${settings.sound ? "An" : "Aus"}`;
    save(settings);
  });
}

function select() {
  const pics = renderPortraits();
  const roles: Role[] = ["top", "jungle", "mid", "bot", "support"];
  const diffs: [Difficulty, string][] = [
    ["easy", "Leicht"],
    ["normal", "Normal"],
    ["hard", "Schwer"],
  ];
  const draw = () => {
    const c = CHAMPIONS.find((x) => x.id === settings.champ) ?? CHAMPIONS[0];
    app.innerHTML = `
      <div class="menu select-screen">
        <header class="sel-head"><button class="round-btn" id="back">‹</button><h2>Wähle deinen Champion</h2></header>
        <div class="sel-body">
          <div class="champ-list">
            ${CHAMPIONS.map(
              (x) => `<button class="champ-card ${x.id === c.id ? "on" : ""}" data-champ="${x.id}" style="--c:${x.color}">
                ${pics[x.id] ? `<img src="${pics[x.id]}" alt="">` : `<span class="ph">${x.name[0]}</span>`}
                <b>${x.name}</b><small>${x.roleName}</small></button>`,
            ).join("")}
          </div>
          <div class="champ-info" style="--c:${c.color}">
            <div class="ci-head">
              ${pics[c.id] ? `<img src="${pics[c.id]}" alt="">` : ""}
              <div><h3>${c.name}</h3><p class="ci-title">${c.title}</p><p class="ci-role">${c.roleName} · ${c.ranged ? "Fernkampf" : "Nahkampf"}</p></div>
            </div>
            <ul class="abil">
              ${c.abilities.map((a, i) => `<li><span class="a-ico">${a.icon}</span><div><b>${"QWER"[i]} · ${a.name}</b><small>${a.desc}</small></div></li>`).join("")}
            </ul>
          </div>
          <div class="sel-opts">
            <p class="lbl">Position</p>
            <div class="seg">${roles.map((r) => `<button data-role="${r}" class="${settings.role === r ? "on" : ""}">${ROLE_NAMES[r]}</button>`).join("")}</div>
            <p class="lbl">Bots</p>
            <div class="seg">${diffs.map(([d, n]) => `<button data-diff="${d}" class="${settings.difficulty === d ? "on" : ""}">${n}</button>`).join("")}</div>
            <p class="note">${settings.role === "jungle" ? "Jungle: Du bekommst Zerschmettern (F) statt Heilen." : "Deine vier Mitspieler und das gegnerische Team werden von Bots gespielt."}</p>
            <button class="mbtn gold big" id="go">Bereit</button>
          </div>
        </div>
      </div>`;
    app.querySelector("#back")!.addEventListener("click", title);
    app.querySelectorAll<HTMLElement>("[data-champ]").forEach((b) =>
      b.addEventListener("click", () => {
        settings.champ = b.dataset.champ!;
        const def = CHAMPIONS.find((x) => x.id === settings.champ)!;
        settings.role = def.role;
        sfx.play("click");
        save(settings);
        draw();
      }),
    );
    app.querySelectorAll<HTMLElement>("[data-role]").forEach((b) =>
      b.addEventListener("click", () => {
        settings.role = b.dataset.role as Role;
        save(settings);
        draw();
      }),
    );
    app.querySelectorAll<HTMLElement>("[data-diff]").forEach((b) =>
      b.addEventListener("click", () => {
        settings.difficulty = b.dataset.diff as Difficulty;
        save(settings);
        draw();
      }),
    );
    app.querySelector("#go")!.addEventListener("click", () => {
      sfx.unlock();
      save(settings);
      start();
    });
  };
  draw();
}

let game: Game | null = null;

function start() {
  app.innerHTML = `<div class="menu loading"><div class="spinner"></div><p>Die Kluft wird erschaffen…</p></div>`;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (matchMedia("(pointer: coarse)").matches && document.fullscreenEnabled) {
    el.requestFullscreen?.().then(
      () => (screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined)?.lock?.("landscape").catch(() => {}),
      () => {},
    );
  }
  // Erst die 3D-Modelle (Türme, Nexus, Champions) laden, dann die Szene aufbauen
  const ready = modelsReady;
  setTimeout(async () => {
    await ready;
    // Wald in der gewählten Grafikstufe (PC: fein, Handy: schnell)
    await loadTrees(settings.quality);
    navGrid();
    app.innerHTML = `<div class="stage" id="stage"></div><div class="rotate"><div><b>⟲</b><p>Dreh dein Handy ins Querformat</p><button class="mbtn" id="rot-ok">Trotzdem spielen</button></div></div>`;
    const stage = document.getElementById("stage")!;
    app.querySelector("#rot-ok")!.addEventListener("click", () => document.body.classList.add("rot-ok"));
    sfx.enabled = settings.sound;
    try {
    game = new Game(stage, {
      playerChamp: settings.champ,
      playerRole: settings.role,
      difficulty: settings.difficulty,
      autoplay: params.has("autoplay"),
      quality: settings.quality,
      sfx,
      onExit: (again) => {
        game = null;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        if (again) start();
        else title();
      },
    });
    game.start();
    } catch (err) {
      const show = (window as unknown as { __bootError?: (m: string) => void }).__bootError;
      const msg = `Fehler beim Starten der 3D-Szene: ${(err as Error)?.message ?? err}`;
      if (show) show(msg);
      else app.textContent = msg;
      return;
    }
    (window as unknown as { __game: Game }).__game = game;
  }, 60);
}

(window as unknown as { __gameBooted: boolean }).__gameBooted = true;

/** WebGL 2 wird für die 3D-Grafik gebraucht. */
function hasWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  const show = (window as unknown as { __bootError?: (m: string) => void }).__bootError;
  const msg = "Dieses Gerät oder dieser Browser unterstützt kein WebGL 2. Bitte iOS/Safari aktualisieren.";
  if (show) show(msg);
  else app.textContent = msg;
} else if (params.has("autoplay") || params.has("quick")) {
  if (params.get("champ")) settings.champ = params.get("champ")!;
  if (params.get("role")) settings.role = params.get("role") as Role;
  if (params.get("q")) settings.quality = params.get("q") as Quality;
  start();
} else title();
