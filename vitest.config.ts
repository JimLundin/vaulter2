import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests live next to the code they cover (src/*.test.ts, web/src/**/*.test.ts).
// The Runtime is Node, the web helpers are pure TS — both run fine under the
// default node environment; jsdom isn't needed until we test React components.
// The aliases mirror vite.config.ts / web/tsconfig.json so web tests resolve the
// same `@/` and `@shared/` imports the app uses.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
  },
});
