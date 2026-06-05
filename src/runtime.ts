import http from "node:http";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAgent, type AgentEvent } from "./agent.js";
import { commitAll } from "./vault.js";

/** A feed event broadcast to every connected browser over SSE. */
type FeedEvent =
  | { type: "capture"; id: number; transcript: string }
  | { type: "text"; id: number; text: string }
  | { type: "tool"; id: number; tool: string; target: string }
  | { type: "done"; id: number; summary: string; commit: string | null }
  | { type: "error"; id: number; message: string };

const INDEX_HTML = fileURLToPath(new URL("../public/index.html", import.meta.url));

export function createRuntime(vault: string) {
  const clients = new Set<http.ServerResponse>();

  function broadcast(event: FeedEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  // --- Serialized capture queue: one Vaulter run at a time. ---
  const queue: { id: number; transcript: string }[] = [];
  let nextId = 1;
  let running = false;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      let job;
      while ((job = queue.shift())) {
        broadcast({ type: "capture", id: job.id, transcript: job.transcript });
        try {
          const onEvent = (e: AgentEvent) =>
            broadcast(
              e.kind === "text"
                ? { type: "text", id: job!.id, text: e.text }
                : { type: "tool", id: job!.id, tool: e.tool, target: e.target },
            );
          const { summary } = await runAgent(vault, job.transcript, onEvent);
          const commit = await commitAll(
            vault,
            `vaulter: ${summary || "capture"}`.slice(0, 72),
          );
          broadcast({ type: "done", id: job.id, summary, commit });
        } catch (err) {
          broadcast({
            type: "error",
            id: job.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      running = false;
    }
  }

  function enqueue(transcript: string): number {
    const id = nextId++;
    queue.push({ id, transcript });
    void drain();
    return id;
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

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

    if (req.method === "GET" && url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && url === "/capture") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 1_000_000) req.destroy(); // guard
      });
      req.on("end", () => {
        let transcript = "";
        try {
          transcript = (JSON.parse(body).transcript ?? "").toString().trim();
        } catch {
          /* fall through to 400 */
        }
        if (!transcript) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "empty transcript" }));
          return;
        }
        const id = enqueue(transcript);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, queued: queue.length }));
      });
      return;
    }

    res.writeHead(404).end("not found");
  });

  return server;
}
