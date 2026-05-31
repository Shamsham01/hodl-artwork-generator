import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Polyfill all Node builtins (util, stream, crypto, etc.) for the MVX SDK.
    // Do not pass `include` here: restricting it omits modules like `util`,
    // which breaks readable-stream / ripemd160 used by wallet crypto.
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
  server: {
    port: 5173,
  },
});
