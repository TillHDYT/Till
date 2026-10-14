import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    // Auch ältere iPhones (Safari 14+) sollen das Spiel laden können
    target: ["es2020", "safari14"],
    // Texturen direkt in das Bundle packen, damit eine einzelne HTML-Datei reicht
    assetsInlineLimit: 400000,
    chunkSizeWarningLimit: 1200,
  },
});
