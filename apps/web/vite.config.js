import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      "@basturds/engine-core": path.resolve(
        __dirname,
        "../../packages/engine-core/src/index.js"
      ),
      "@basturds/engine-browser": path.resolve(
        __dirname,
        "../../packages/engine-browser/src/index.js"
      ),
    },
  },
  optimizeDeps: {
    include: ["@basturds/engine-core", "@basturds/engine-browser", "sha1"],
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
  },
});
