#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { exec } from "node:child_process";
import { ensureVault, hasRemote, pushToRemote } from "./vault.js";
import { createRuntime } from "./runtime.js";

async function main() {
  // The vault folder comes from the first CLI argument, or VAULTER_VAULT as a
  // fallback (used by `npm run dev`, and handy for a fixed personal vault).
  const flag = process.argv[2];
  if (flag === "-h" || flag === "--help") {
    printUsage();
    process.exit(0);
  }
  const arg = flag ?? process.env.VAULTER_VAULT;
  if (!arg) {
    printUsage();
    console.log("\n  No vault given. Pass a folder, or set VAULTER_VAULT.");
    process.exit(1);
  }

  // Resolve through symlinks so the logged path (and git) point at the real
  // vault, not a convenience link like .dev-vault → ~/my-vault. realpath throws
  // for a not-yet-created vault; fall back to the plain resolved path then.
  let vault = path.resolve(arg);
  try {
    vault = realpathSync(vault);
  } catch {
    /* vault doesn't exist yet — ensureVault creates it below */
  }
  const seeded = await ensureVault(vault);
  console.log(`Vault: ${vault}${seeded ? " (seeded a starting skeleton)" : ""}`);

  // Remote sync: report status and bring the remote up to date on launch.
  if (await hasRemote(vault)) {
    const r = await pushToRemote(vault);
    if (r.status === "pushed") console.log("Remote: origin (synced — every capture is pushed)");
    else if (r.status === "failed") console.log(`Remote: origin (push failed: ${r.detail})`);
  } else {
    console.log(
      "Remote: none — commits stay local. Add one to sync:\n" +
        `  git -C "${vault}" remote add origin <url>   (or set VAULTER_REMOTE)`,
    );
  }

  const port = Number(process.env.VAULTER_PORT ?? 4317);
  const server = createRuntime(vault);

  server.listen(port, "127.0.0.1", () => {
    const urlStr = `http://localhost:${port}`;
    // In `npm run dev`, Vite serves the live UI (with HMR) and proxies the API
    // here — so the Runtime's own port serves only the last-built bundle. The
    // dev script passes Vite's URL so we point the developer there, not at the
    // stale bundle. (No VAULTER_DEV_URL in production: the Runtime serves the UI.)
    const devUrl = process.env.VAULTER_DEV_URL;
    if (devUrl) {
      console.log(`Runtime (API) on ${urlStr} — open ${devUrl} for the dev UI (HMR).`);
    } else {
      console.log(`Vaulter is running at ${urlStr}`);
    }
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
    // Destroy keep-alive SSE sockets so close() can finish; hard-exit as backstop.
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function printUsage(): void {
  console.log("Usage: vaulter <vault-folder>   (or set VAULTER_VAULT)\n");
  console.log("  Speak a thought; a local Vaulter agent files it into your");
  console.log("  Markdown vault. The vault is created (and seeded) if missing.");
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
