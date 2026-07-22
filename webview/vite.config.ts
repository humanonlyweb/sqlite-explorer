import { resolve } from "node:path";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  base: "./",
  resolve: {
    alias: { "@shared": resolve(import.meta.dirname, "../src") },
  },
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    // Avoid the inline module-preload polyfill so no inline <script> needs a nonce.
    modulePreload: { polyfill: false },
  },
});
