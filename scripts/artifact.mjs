// Packt dist/ in eine einzelne HTML-Datei (CSS und JS eingebettet).
// Erzeugt zwei Varianten:
//  - dist/kluft-der-legenden.html: Seiteninhalt für die Veröffentlichung als Artifact
//  - dist/Kluft_der_Legenden.html: eigenständiges, vollständiges HTML-Dokument
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const files = readdirSync("dist/assets");
const css = readFileSync(`dist/assets/${files.find((f) => f.endsWith(".css"))}`, "utf8");
let js = readFileSync(`dist/assets/${files.find((f) => f.endsWith(".js"))}`, "utf8");
js = js.replace(/<\/script/gi, "<\\/script");

// Zeigt Ladefehler sichtbar an, statt nur einen leeren Bildschirm.
const guard = `<script>
(function () {
  function show(msg) {
    if (document.getElementById("boot-error")) return;
    var d = document.createElement("div");
    d.id = "boot-error";
    d.style.cssText = "position:fixed;inset:0;z-index:99;display:grid;place-items:center;padding:24px;background:#0a1428;color:#f0e6d2;font:15px/1.5 -apple-system,system-ui,sans-serif;text-align:center";
    d.innerHTML = "<div><b style='font-size:20px;color:#f0d79a'>Das Spiel konnte nicht starten</b><p style='max-width:30em'>" + msg + "</p></div>";
    (document.body || document.documentElement).appendChild(d);
  }
  window.__bootError = show;
  window.addEventListener("error", function (e) {
    if (window.__gameBooted) return;
    show("Fehler: " + (e && e.message ? e.message : "unbekannt") + "<br><br>Bitte Safari/iOS aktualisieren oder die Datei in Safari statt in der Vorschau öffnen.");
  });
  setTimeout(function () {
    if (!window.__gameBooted) show("Das Spielskript wurde nicht ausgeführt. Öffne die Datei bitte direkt in Safari (nicht in der Dateien-Vorschau) oder nutze den Link.");
  }, 8000);
})();
</script>`;

const body = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@500;700;800&display=swap">
<style>${css}</style>
<div id="app"></div>
${guard}
<script type="module">${js}</script>
`;
writeFileSync(
  "dist/kluft-der-legenden.html",
  `<title>Kluft der Legenden</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#0a1428">
${body}`,
);
writeFileSync(
  "dist/Kluft_der_Legenden.html",
  `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a1428">
<title>Kluft der Legenden</title>
</head>
<body>
${body}</body>
</html>
`,
);
console.log("wrote dist/kluft-der-legenden.html and dist/Kluft_der_Legenden.html", (body.length / 1024).toFixed(0), "KB");
