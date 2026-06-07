import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend lives in web/ and is bundled into public/, which the Runtime
// serves as static files. In dev, Vite serves with HMR on 5173 and proxies the
// Runtime's API (SSE feed + capture POST) through to the Node process on 4317.
const RUNTIME_PORT = process.env.VAULTER_PORT ?? "4317";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
      // Wire protocol shared with the Runtime (src/feed.ts). Imported type-only,
      // so nothing from src/ is bundled into the browser output.
      "@shared": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/events": { target: `http://localhost:${RUNTIME_PORT}`, changeOrigin: true },
      "/capture": { target: `http://localhost:${RUNTIME_PORT}`, changeOrigin: true },
      "/commit": { target: `http://localhost:${RUNTIME_PORT}`, changeOrigin: true },
      "/revert": { target: `http://localhost:${RUNTIME_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
