import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { buildModel } from "./agent.js";
import { commitAll, pushToRemote, summarizeChanges } from "./vault.js";

/** A single chat filing turn may not run longer than this before it's aborted, so
 * a hung turn (a wedged web fetch, a runaway loop) can't hold a request open
 * forever (issue #1). */
const CHAT_TURN_TIMEOUT_MS = 180_000;

// The browser UI is a Vite bundle built into public/ (index.html + hashed
// assets under public/assets/). The Runtime serves it as static files.
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const INDEX_HTML = path.join(PUBLIC_DIR, "index.html");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * The Runtime: a tiny local HTTP server that serves the UI and exposes one
 * endpoint, `POST /api/chat`. The browser's `useChat` posts the running capture
 * conversation; we run ONE agent filing turn over it and stream the result back
 * as an AI-SDK UI-message stream. Captures are serialized by the browser's queue
 * (one turn in flight at a time), so turns never race over the Vault — and we
 * commit the Vault after each turn, which is the git-as-undo history.
 */
export function createRuntime(vault: string) {
  // The model the chat endpoint files with. Built once and reused across requests.
  const chatModel = buildModel(vault);

  /** Commit whatever the just-finished turn wrote, and push if a remote is set.
   * The subject is derived from the changed note files (deterministic), not the
   * agent's prose. Best-effort: a failure just leaves the change for the next
   * commit to sweep up. Safe to run per-turn — the browser sends one at a time. */
  async function commitVault(): Promise<void> {
    const changes = await summarizeChanges(vault).catch(() => "");
    if (!changes) return; // nothing was written
    const commit = await commitAll(vault, `vaulter: ${changes}`.slice(0, 72)).catch(() => null);
    if (commit) await pushToRemote(vault).catch(() => {});
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    // The Runtime binds to 127.0.0.1, but a malicious page can still try DNS
    // rebinding — resolving its own hostname to 127.0.0.1 so the browser POSTs
    // here under an attacker `Host`. Accept only loopback hosts; this process
    // holds the owner's vault and `claude` credentials, so the guard is cheap.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
      res.writeHead(403).end("forbidden host");
      return;
    }

    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      try {
        const html = await fs.readFile(INDEX_HTML);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500).end("index.html not found");
      }
      return;
    }

    // The AI-SDK chat surface. Run one filing turn over the posted conversation,
    // stream it back, and commit the Vault when it finishes.
    if (req.method === "POST" && url === "/api/chat") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 5_000_000) req.destroy();
      });
      req.on("end", async () => {
        let messages: UIMessage[];
        try {
          messages = JSON.parse(body).messages;
          if (!Array.isArray(messages)) throw new Error("not an array");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "need messages" }));
          return;
        }
        const ac = new AbortController();
        const watchdog = setTimeout(() => ac.abort(), CHAT_TURN_TIMEOUT_MS);
        const result = streamText({
          model: chatModel,
          messages: await convertToModelMessages(messages),
          abortSignal: ac.signal,
          onFinish: async () => {
            clearTimeout(watchdog);
            await commitVault();
          },
          onError: () => clearTimeout(watchdog),
        });
        result.pipeUIMessageStreamToResponse(res);
      });
      return;
    }

    // Static assets for the bundled UI (public/assets/*, favicon, etc.). Scoped
    // to PUBLIC_DIR with a traversal guard so only built files are reachable.
    if (req.method === "GET") {
      const rel = decodeURIComponent((url.split("?")[0] || "").replace(/^\/+/, ""));
      const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
      if (filePath.startsWith(PUBLIC_DIR + path.sep)) {
        try {
          const data = await fs.readFile(filePath);
          const type = CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream";
          const headers: http.OutgoingHttpHeaders = { "Content-Type": type };
          // Vite stamps a content hash into asset filenames, so they're immutable.
          if (rel.startsWith("assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
          res.writeHead(200, headers);
          res.end(data);
          return;
        } catch {
          /* not a file — fall through to 404 */
        }
      }
    }

    res.writeHead(404).end("not found");
  });

  return server;
}
