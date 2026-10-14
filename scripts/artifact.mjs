// Packt dist/ in eine einzelne HTML-Datei (CSS und JS eingebettet).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? "dist/kluft-der-legenden.html";
const files = readdirSync("dist/assets");
const css = readFileSync(`dist/assets/${files.find((f) => f.endsWith(".css"))}`, "utf8");
let js = readFileSync(`dist/assets/${files.find((f) => f.endsWith(".js"))}`, "utf8");
js = js.replace(/<\/script/gi, "<\\/script");
const html = `<title>Kluft der Legenden</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#0a1428">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@500;700;800&display=swap">
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
writeFileSync(out, html);
console.log("wrote", out, (html.length / 1024).toFixed(0), "KB");
