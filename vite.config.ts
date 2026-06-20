import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend lives in web/ and is bundled into public/, which the Runtime
// serves as static files. In dev, Vite serves with HMR on 5173 and proxies the
// Runtime's API through to the Node process on 4317.
const RUNTIME_PORT = process.env.VAULTER_PORT ?? "4317";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // ADR-0006 collapsed the Runtime to a single endpoint, POST /api/chat, so
      // proxy the whole /api prefix. (The old /events SSE feed and
      // /capture|/commit|/revert routes went away with the bespoke protocol.)
      "/api": { target: `http://localhost:${RUNTIME_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
