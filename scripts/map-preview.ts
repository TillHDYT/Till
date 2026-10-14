// Zeichnet das Begehbarkeitsgitter als PNG, um das Layout zu prüfen.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { NavGrid } from "../src/game/navgrid";
import { BRUSHES, CAMPS, STRUCTURES } from "../src/game/mapdata";

const S = 4;
const grid = new NavGrid();
const n = grid.n;
const W = n * S;
const px = new Uint8Array(W * W * 3);
const put = (x: number, z: number, c: [number, number, number]) => {
  if (x < 0 || z < 0 || x >= W || z >= W) return;
  const i = (z * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
};
for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
  const i = z * n + x;
  let c: [number, number, number];
  if (!grid.walk[i]) c = [25, 50, 25];
  else if (grid.brush[i] >= 0) c = [40, 140, 40];
  else if (grid.base[i] >= 0) c = grid.base[i] === 0 ? [90, 110, 150] : [150, 100, 100];
  else if (grid.river[i] > 0.4) c = [40, 90, 160];
  else if (grid.lane[i] > 0.5) c = [170, 140, 90];
  else c = [90, 120, 60];
  for (let dz = 0; dz < S; dz++) for (let dx = 0; dx < S; dx++) put(x * S + dx, z * S + dz, c);
}
const dot = (x: number, z: number, r: number, c: [number, number, number]) => {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r) put(Math.round(x * S) + dx, Math.round(z * S) + dz, c);
};
for (const s of STRUCTURES) {
  const col: [number, number, number] = s.team === 0 ? [60, 160, 255] : [255, 70, 60];
  dot(s.pos.x, s.pos.z, s.kind === "nexus" ? 14 : s.kind === "inhib" ? 9 : 6, s.kind === "inhib" ? [255, 255, 255] : col);
}
for (const c of CAMPS) dot(c.pos.x, c.pos.z, c.kind === "baron" || c.kind === "dragon" ? 10 : 6, [230, 200, 40]);
void BRUSHES;
// PNG
const raw = Buffer.alloc((W * 3 + 1) * W);
for (let z = 0; z < W; z++) { raw[z * (W * 3 + 1)] = 0; Buffer.from(px.buffer, z * W * 3, W * 3).copy(raw, z * (W * 3 + 1) + 1); }
const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
const out = process.argv[2] ?? "map.png";
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log("wrote", out);
