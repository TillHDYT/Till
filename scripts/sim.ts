// Simuliert ein komplettes Bot-gegen-Bot-Match ohne Grafik.
import { BotBrain } from "../src/game/ai";
import { NavGrid } from "../src/game/navgrid";
import { World } from "../src/game/world";

const grid = new NavGrid();
const w = new World(grid, { playerChamp: process.argv[2] ?? "lyra", playerRole: (process.argv[3] as never) ?? "bot", difficulty: "normal", autoplay: true }, () => new BotBrain("normal"));
const dt = 1 / 30;
let next = 60;
const t0 = Date.now();
while (w.winner === null && w.t < 45 * 60) {
  w.update(dt);
  if (w.t >= next) {
    next += 120;
    const tur = [0, 1].map((t) => w.structures.filter((s) => s.team === t && s.kind === "turret" && s.alive).length);
    const lv = w.champs.map((c) => `${c.def.name[0]}${c.level}`).join(" ");
    console.log(`${(w.t / 60).toFixed(1)}min score ${w.score.join(":")} turrets ${tur.join("/")} minions ${w.minions.filter((m) => m.alive).length} monsters ${w.monsters.filter((m) => m.alive).length} drag ${w.dragons.join("/")} | ${lv}`);
  }
}
console.log("winner", w.winner, "at", (w.t / 60).toFixed(1), "min; real", (Date.now() - t0) / 1000, "s");
for (const c of w.champs) console.log(c.team, c.role.padEnd(8), c.def.name.padEnd(7), `L${c.level}`, `${c.kills}/${c.deaths}/${c.assists}`, `cs ${c.cs}`, `gold ${Math.round(c.gold)}`, c.items.join(","));
