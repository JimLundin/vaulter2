import http from "node:http";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { startSession, MODEL, type AgentEvent, type Session } from "./agent.js";
import { commitAll } from "./vault.js";

/** A feed event broadcast to every connected browser over SSE. */
type FeedEvent =
  | { type: "info"; model: string }
  | { type: "queued"; id: number; transcript: string }
  | { type: "start"; id: number }
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

  // --- One recording = one Vaulter Session (shared context across chunks). ---
  // Captures queue here and are fed to the agent ONE turn at a time: we only
  // release the next turn after the previous one is committed, so the Runtime's
  // git commit never races the agent's edits.
  const pending: { id: number; transcript: string }[] = [];
  let nextId = 1;
  let session: Session | null = null;
  let recordingId: string | null = null;
  let processingId: number | null = null; // chunk currently being filed
  let busy = false; // a turn is in flight (sent, not yet committed)
  let ending = false; // recording stopped; end the session once drained

  function pump(): void {
    if (busy) return;
    const head = pending.shift();
    if (!head) {
      if (ending && session) {
        session.end();
        session = null;
        recordingId = null;
        ending = false;
      }
      return;
    }
    busy = true;
    processingId = head.id;
    broadcast({ type: "start", id: head.id });
    session!.send(head.transcript);
  }

  function openSession(): void {
    session = startSession(vault, {
      onEvent: (e: AgentEvent) => {
        if (processingId == null) return;
        broadcast(
          e.kind === "text"
            ? { type: "text", id: processingId, text: e.text }
            : { type: "tool", id: processingId, tool: e.tool, target: e.target },
        );
      },
      onTurnComplete: async (summary: string) => {
        const id = processingId!;
        const commit = await commitAll(
          vault,
          `vaulter: ${summary || "capture"}`.slice(0, 72),
        );
        broadcast({ type: "done", id, summary, commit });
        busy = false;
        processingId = null;
        pump();
      },
      onError: (message: string) => {
        if (processingId != null) broadcast({ type: "error", id: processingId, message });
        busy = false;
        processingId = null;
        pump();
      },
    });
  }

  function capture(rid: string, transcript: string, final: boolean): void {
    // A new recording id means a fresh thought: end the old session, start one.
    if (!session || rid !== recordingId) {
      if (session) session.end();
      pending.length = 0;
      busy = false;
      ending = false;
      processingId = null;
      recordingId = rid;
      openSession();
    }
    if (transcript) {
      const id = nextId++;
      pending.push({ id, transcript });
      broadcast({ type: "queued", id, transcript });
    }
    if (final) ending = true;
    pump();
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
      res.write(`data: ${JSON.stringify({ type: "info", model: MODEL })}\n\n`);
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
        let rid = "";
        let transcript = "";
        let final = false;
        try {
          const j = JSON.parse(body);
          rid = (j.recordingId ?? "").toString();
          transcript = (j.transcript ?? "").toString().trim();
          final = !!j.final;
        } catch {
          /* fall through to 400 */
        }
        if (!rid || (!transcript && !final)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "need recordingId and transcript or final" }));
          return;
        }
        capture(rid, transcript, final);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ queued: pending.length }));
      });
      return;
    }

    res.writeHead(404).end("not found");
  });

  return server;
}
