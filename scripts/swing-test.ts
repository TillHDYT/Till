// Prüft Kiras Schlag in der Spiellogik ohne Grafik: Schaden erst am Trefferzeitpunkt der Schlaganimation,
// genau einmal pro Schlag, nur bei gültigem Ziel in Reichweite. Aufruf: npx tsx scripts/swing-test.ts [kira|thorne]
import { CHAMPIONS } from "../src/game/champions";
import { NavGrid } from "../src/game/navgrid";
import type { Champion, Unit } from "../src/game/units";
import { World, swingRate } from "../src/game/world";

const grid = new NavGrid();
const KIRA = CHAMPIONS.find((c) => c.id === (process.argv[2] ?? "kira"))!;
const SW = KIRA.swing!;
const DT = 1 / 60;
let failed = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FEHLER"} ${name}${info ? `  (${info})` : ""}`);
};

/** Neue Welt: Kira (Spielerin, ohne Bot) und ein reglos stehender Gegner in der Kartenmitte. */
function setup(edge = 1.5) {
  const w = new World(grid, { playerChamp: KIRA.id, playerRole: KIRA.role, difficulty: "normal" }, () => ({ think() {} }));
  const k = w.player;
  const foe = w.champs.find((c) => c.team === 1 && c.role === "top")!;
  k.x = 100;
  k.z = 100;
  k.facing = Math.PI / 2;
  foe.x = 100 + k.radius + foe.radius + edge;
  foe.z = 100;
  return { w, k, foe };
}

type Log = { t: number; amount: number; attack: boolean; swing: number }[];
/** Läuft n Sekunden; sammelt Kiras Schaden am Ziel und die Startzeiten der Schläge. */
function run(w: World, k: Champion, target: Unit, secs: number, each?: (t: number) => void) {
  const hits: Log = [];
  const starts: number[] = [];
  let last: unknown = null;
  const end = w.t + secs;
  while (w.t < end - 1e-9) {
    each?.(w.t);
    w.update(DT);
    if (k.swing && k.swing !== last) starts.push(k.swing.start);
    last = k.swing;
    for (const e of w.events) if (e.type === "dmg" && e.unit === target && e.src === k) hits.push({ t: w.t, amount: e.amount, attack: true, swing: k.anim.swing });
  }
  return { hits, starts };
}

console.log(`Schlaganimation: ${SW.clip.toFixed(3)} s, Treffer bei ${SW.hit.toFixed(3)} s (${((SW.hit / SW.clip) * 100).toFixed(1)} %)`);

// 1 + 9: steht still, kein Schlag -> Idle
{
  const { w, k } = setup();
  run(w, k, k, 0.5);
  check("1  steht still ohne Angriff: nicht laufend, kein Schlag (Idle)", !k.anim.moving && k.anim.swing === -1 && k.swing === null);
}

// 2, 4, 5, 8, 9: ein Angriffsbefehl
{
  const { w, k, foe } = setup();
  const hp0 = foe.hp;
  k.order = { type: "attack", target: foe };
  const rate = swingRate(SW, k.stats.as);
  const { hits, starts } = run(w, k, foe, 1 / k.stats.as - 0.05);
  const start = starts[0];
  check("2  ein Befehl startet genau einen Schlag", starts.length === 1, `${starts.length} Schlag/Schläge`);
  const early = hits.filter((h) => h.t < start + SW.hit / rate - 1e-9);
  check("4  kein Schaden während des Ausholens", early.length === 0);
  const dt = hits.length ? hits[0].t - start : NaN;
  check("5  Schaden am Trefferzeitpunkt", hits.length >= 1 && Math.abs(dt - SW.hit / rate) <= DT + 1e-9, `nach ${dt.toFixed(3)} s, erwartet ${(SW.hit / rate).toFixed(3)} s`);
  check("8  genau ein Treffer pro Schlag", hits.length === 1, `${hits.length} Treffer`);
  const expect = k.stats.ad * (100 / (100 + foe.stats.armor));
  check("   Schadenswert unverändert (AD nach Rüstung)", hits.length === 1 && Math.abs(hits[0].amount - expect) < 0.01 && foe.hp < hp0, `${hits[0]?.amount.toFixed(2)}, erwartet ${expect.toFixed(2)}`);
  k.order = { type: "none" };
  run(w, k, foe, 1.5);
  check("9  danach zurück in den Ruhezustand (Idle)", k.swing === null && k.anim.swing === -1 && !k.anim.moving);
}

// 3: Blickrichtung bleibt während des Schlags gleich
{
  const { w, k, foe } = setup();
  k.order = { type: "attack", target: foe };
  const yaws: number[] = [];
  run(w, k, foe, 1.2, () => {
    if (k.swing) yaws.push(k.facing);
  });
  const spread = Math.max(...yaws) - Math.min(...yaws);
  check("3  keine Drehung während des Schlags (Spiellogik)", yaws.length > 10 && spread < 1e-6, `Blickrichtung schwankt um ${spread.toFixed(6)} rad`);
}

// 6: Ziel läuft während des Ausholens aus der Reichweite
{
  const { w, k, foe } = setup();
  k.order = { type: "attack", target: foe };
  const { hits } = run(w, k, foe, 0.8, () => {
    if (k.swing && !k.swing.hit) foe.x = k.x + k.radius + foe.radius + k.stats.range + 1.5;
  });
  check("6  Ziel außer Reichweite am Treffer: kein Schaden", hits.length === 0 && w.t > 0.6, `${hits.length} Treffer`);
}

// 7: Schlag ins Leere (Ziel stirbt bzw. steht hinter Kira, wenn der Treffer kommt)
{
  const { w, k, foe } = setup();
  const other = w.champs.find((c) => c.team === 1 && c !== foe)!;
  k.order = { type: "attack", target: foe };
  const { hits } = run(w, k, foe, 0.8, () => {
    if (k.swing && !k.swing.hit && foe.alive) {
      foe.alive = false;
      foe.hp = 0;
    }
  });
  const anyDmg = w.champs.some((c) => c.team === 1 && c !== foe && c.hp < c.stats.maxHp);
  check("7a Ziel tot vor dem Treffer: kein Schaden (auch kein anderer)", hits.length === 0 && !anyDmg && other.alive);
  const s2 = setup();
  s2.k.order = { type: "attack", target: s2.foe };
  const r2 = run(s2.w, s2.k, s2.foe, 0.8, () => {
    if (s2.k.swing && !s2.k.swing.hit) {
      s2.foe.x = 100 - 2.5; // hinter Kira (sie schaut nach +x)
      s2.k.facing = Math.PI / 2;
    }
  });
  check("7b Ziel hinter Kira am Treffer: kein Schaden", r2.hits.length === 0);
}

// Laufen während des Ausholens ist gesperrt, Laufen in der Erholung bricht nur die Animation ab
{
  const { w, k, foe } = setup();
  k.order = { type: "attack", target: foe };
  let movedEarly = false;
  const x0 = k.x;
  const { hits } = run(w, k, foe, 1.0, (t) => {
    if (k.swing && !k.swing.hit) {
      k.moveVec = { x: -1, z: 0 };
      if (Math.abs(k.x - x0) > 1e-6) movedEarly = true;
    } else if (k.swing?.hit) {
      k.order = { type: "none" };
    }
    void t;
  });
  check("   Laufen während des Ausholens gesperrt, Treffer kommt trotzdem", !movedEarly && hits.length === 1);
  check("   Laufen nach dem Treffer beendet den Schlag (zurück zu Laufen)", k.swing === null && k.anim.swing === -1 && k.anim.moving);
}

// 10: schnell wiederholte Eingaben (Befehl jeden Tick neu / abwechselnd an und aus)
{
  const { w, k, foe } = setup();
  foe.hp = foe.stats.maxHp = 1e6;
  let n = 0;
  const { hits, starts } = run(w, k, foe, 6, () => {
    k.order = n++ % 2 ? { type: "attack", target: foe } : { type: "none" };
  });
  const gaps = hits.slice(1).map((h, i) => h.t - hits[i].t);
  const minGap = Math.min(...gaps);
  const done = starts.filter((s) => s + SW.hit / swingRate(SW, k.stats.as) <= w.t).length;
  check("10 Dauerfeuer: ein Treffer pro Schlag, nie schneller als das Angriffstempo", hits.length === done && minGap >= 1 / k.stats.as - DT - 1e-9, `${starts.length} Schläge, ${hits.length} Treffer, kürzester Abstand ${minGap.toFixed(3)} s (Angriffstempo ${(1 / k.stats.as).toFixed(3)} s)`);
}

// 11: höheres Angriffstempo -> Animation und Treffer laufen gemeinsam schneller
for (const bonus of [0, 45, 65, 150]) {
  const { w, k, foe } = setup();
  if (bonus) w.addBuff(k, { id: "test", until: 99, mods: { as: bonus } });
  k.order = { type: "attack", target: foe };
  const rate = swingRate(SW, k.stats.as);
  const { hits, starts } = run(w, k, foe, 1 / k.stats.as - 0.02);
  const dt = hits[0].t - starts[0];
  // Fortschritt der Animation im Tick des Schadens = Trefferzeitpunkt im Clip
  const clipT = hits[0].swing * SW.clip;
  check(
    `11 Angriffstempo ${k.stats.as.toFixed(2)}/s (Animation x${rate.toFixed(2)}): Treffer im Clip bei ${clipT.toFixed(3)} s`,
    Math.abs(clipT - SW.hit) <= DT * rate + 1e-6 && Math.abs(dt - SW.hit / rate) <= DT + 1e-9,
    `Schaden ${dt.toFixed(3)} s nach Schlagbeginn`,
  );
}

// Sprung (Kiras E) während des Ausholens: Schlag fällt aus
if (KIRA.id === "kira") {
  const { w, k, foe } = setup();
  k.ranks[2] = 1;
  k.order = { type: "attack", target: foe };
  let cast = false;
  const { hits } = run(w, k, foe, 1.0, () => {
    if (k.swing && !k.swing.hit && !cast) {
      cast = w.cast(k, 2, { x: 100, z: 108 });
      k.order = { type: "none" };
    }
  });
  const attackHits = hits.filter((h) => Math.abs(h.amount - k.stats.ad * (100 / (100 + foe.stats.armor))) < 0.01);
  check("   Sprung (E) während des Ausholens: kein Schlagschaden", cast && attackHits.length === 0 && k.swing === null);
}

// Rückruf (B) während des Ausholens: Schlag fällt aus
{
  const { w, k, foe } = setup();
  k.order = { type: "attack", target: foe };
  let started = false;
  const { hits } = run(w, k, foe, 1.0, () => {
    if (k.swing && !k.swing.hit && !started) {
      w.startRecall(k);
      started = true;
    }
  });
  check("   Rückruf während des Ausholens: kein Schlagschaden", started && hits.length === 0 && k.swing === null);
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nalle Prüfungen bestanden");
process.exit(failed ? 1 : 0);
