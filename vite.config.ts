import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  assetsInclude: ["**/*.glb"],
  build: {
    // Auch ältere iPhones (Safari 14+) sollen das Spiel laden können
    target: ["es2020", "safari14"],
    // Nur für die Einzeldatei (npm run single) alles ins Bundle packen; die Website lädt Modelle und Texturen als eigene Dateien
    assetsInlineLimit: mode === "single" ? 4_000_000 : 4096,
    chunkSizeWarningLimit: 1200,
  },
}));
