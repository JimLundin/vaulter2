#!/usr/bin/env node
import path from "node:path";
import { exec } from "node:child_process";
import { ensureVault } from "./vault.js";
import { createRuntime } from "./runtime.js";

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "-h" || arg === "--help") {
    console.log("Usage: vaulter <vault-folder>\n");
    console.log("  Speak a thought; a local Librarian agent files it into your");
    console.log("  Markdown vault. The vault is created (and seeded) if missing.");
    process.exit(arg ? 0 : 1);
  }

  const vault = path.resolve(arg);
  const seeded = await ensureVault(vault);
  console.log(`Vault: ${vault}${seeded ? " (seeded a starting skeleton)" : ""}`);

  const port = Number(process.env.VAULTER_PORT ?? 4317);
  const server = createRuntime(vault);

  server.listen(port, "127.0.0.1", () => {
    const urlStr = `http://localhost:${port}`;
    console.log(`Vaulter is running at ${urlStr}`);
    console.log("Using your on-disk `claude` subscription login (no API key).");
    console.log("Press Ctrl+C to stop.");
    if (!process.env.VAULTER_NO_OPEN) openBrowser(urlStr);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is in use. Set VAULTER_PORT to choose another.`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Best-effort open the default browser; silent on failure (e.g. headless). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
