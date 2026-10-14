import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // Texturen direkt in das Bundle packen, damit eine einzelne HTML-Datei reicht
    assetsInlineLimit: 400000,
    chunkSizeWarningLimit: 1200,
  },
});
