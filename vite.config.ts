import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.glb"],
  build: {
    // Auch ältere iPhones (Safari 14+) sollen das Spiel laden können
    target: ["es2020", "safari14"],
    // Texturen direkt in das Bundle packen, damit eine einzelne HTML-Datei reicht
    assetsInlineLimit: 4_000_000,
    chunkSizeWarningLimit: 1200,
  },
});
