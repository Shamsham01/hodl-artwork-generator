import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// MultiversX SDK pulls in protobufjs/minimal; must be bundled (not left as bare import).
const protobufMinimal = require.resolve("protobufjs/minimal.js");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    {
      name: "bundle-protobufjs-minimal",
      resolveId(source) {
        if (
          source === "protobufjs/minimal" ||
          source === "\0protobufjs/minimal?commonjs-external"
        ) {
          return protobufMinimal;
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      "protobufjs/minimal": protobufMinimal,
    },
    dedupe: ["protobufjs"],
  },
  optimizeDeps: {
    include: [
      "@basturds/engine-core",
      "@basturds/engine-browser",
      "sha1",
      "protobufjs",
      "protobufjs/minimal",
    ],
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/protobufjs/, /node_modules/],
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
  },
});
