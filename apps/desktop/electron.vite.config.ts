import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: { build: { rollupOptions: { input: "src/main/index.ts" } } },
  preload: { build: { rollupOptions: { input: "src/preload/index.ts", output: { format: "cjs", entryFileNames: "[name].cjs" } } } },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: path.resolve(import.meta.dirname, "src/renderer/index.html") } },
  },
});
