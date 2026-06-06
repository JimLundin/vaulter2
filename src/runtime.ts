import http from "node:http";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  startSession,
  MODEL,
  DISCOVERY_PRIMER,
  type AgentEvent,
  type Session,
} from "./agent.js";
import { commitAll, pushToRemote } from "./vault.js";

/** A feed event broadcast to every connected browser over SSE. */
type FeedEvent =
  | { type: "info"; model: string; ready: boolean }
  | { type: "ready" }
  | { type: "queued"; id: number; transcript: string }
  | { type: "start"; id: number }
  | { type: "text"; id: number; text: string }
  | { type: "tool"; id: number; tool: string; target: string }
  | {
      type: "done";
      id: number;
      summary: string;
      commit: string | null;
      sync: "synced" | "local" | "failed";
      syncDetail?: string;
    }
  | { type: "error"; id: number; message: string };

const INDEX_HTML = fileURLToPath(new URL("../public/index.html", import.meta.url));

export function createRuntime(vault: string) {
  const clients = new Set<http.ServerResponse>();

  function broadcast(event: FeedEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  // One long-lived Vaulter session for the whole server: the Vault is discovered
  // once (a warm-up turn primed at launch), then every Capture reuses that
  // context. Captures queue here and are fed to the agent ONE turn at a time;
  // the next turn is released only after the previous one is committed, so the
  // git commit never races the agent's edits.
  const pending: { id: number; transcript: string; newRecording: boolean }[] = [];
  let nextId = 1;
  let session: Session | null = null;
  let ready = false; // discovery warm-up finished
  let busy = false; // a turn is in flight
  let processingId: number | null = null; // chunk being filed; null = warm-up
  let lastRecordingId: string | null = null;

  function pump(): void {
    if (busy || !session) return;
    const head = pending.shift();
    if (!head) return;
    busy = true;
    processingId = head.id;
    broadcast({ type: "start", id: head.id });
    // A fresh recording may be an unrelated topic; tell the agent so it doesn't
    // blindly extend the previous recording's notes.
    const message = head.newRecording
      ? `(New recording — this may be a new, unrelated topic; judge from the content whether it continues earlier notes or starts something new.)\n\n${head.transcript}`
      : head.transcript;
    session.send(message);
  }

  function ensureSession(): void {
    if (session) return;
    ready = false;
    session = startSession(vault, {
      onEvent: (e: AgentEvent) => {
        if (processingId == null) return; // warm-up turn: nothing to show
        broadcast(
          e.kind === "text"
            ? { type: "text", id: processingId, text: e.text }
            : { type: "tool", id: processingId, tool: e.tool, target: e.target },
        );
      },
      onTurnComplete: async (summary: string) => {
        if (processingId == null) {
          // Warm-up finished: ready for real captures (don't commit orientation).
          ready = true;
          broadcast({ type: "ready" });
          busy = false;
          pump();
          return;
        }
        const id = processingId;
        const commit = await commitAll(
          vault,
          `vaulter: ${summary || "capture"}`.slice(0, 72),
        );
        // Transactional sync: push each commit so the remote mirrors local.
        let sync: "synced" | "local" | "failed" = "local";
        let syncDetail: string | undefined;
        if (commit) {
          const r = await pushToRemote(vault);
          if (r.status === "pushed") sync = "synced";
          else if (r.status === "failed") {
            sync = "failed";
            syncDetail = r.detail;
          }
        }
        broadcast({ type: "done", id, summary, commit, sync, syncDetail });
        busy = false;
        processingId = null;
        pump();
      },
      onTurnError: (message: string) => {
        if (processingId == null) {
          // Warm-up failed — proceed anyway; captures will discover as needed.
          ready = true;
          broadcast({ type: "ready" });
        } else {
          broadcast({ type: "error", id: processingId, message });
        }
        busy = false;
        processingId = null;
        pump();
      },
      onFatal: (message: string) => {
        if (processingId != null) broadcast({ type: "error", id: processingId, message });
        // Drop the dead session; the NEXT capture reopens it (lazy, so a
        // persistently failing warm-up can't spin-loop spawning processes).
        session = null;
        ready = false;
        busy = false;
        processingId = null;
      },
    });
    // Pay discovery up front, at launch, instead of on the first chunk.
    busy = true;
    processingId = null;
    session.send(DISCOVERY_PRIMER);
  }

  function capture(rid: string, transcript: string): void {
    ensureSession();
    if (transcript) {
      const newRecording = rid !== lastRecordingId;
      lastRecordingId = rid;
      const id = nextId++;
      pending.push({ id, transcript, newRecording });
      broadcast({ type: "queued", id, transcript });
    }
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
      res.write(`data: ${JSON.stringify({ type: "info", model: MODEL, ready })}\n\n`);
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
        try {
          const j = JSON.parse(body);
          rid = (j.recordingId ?? "").toString();
          transcript = (j.transcript ?? "").toString().trim();
        } catch {
          /* fall through to 400 */
        }
        if (!rid) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "need recordingId" }));
          return;
        }
        capture(rid, transcript);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ queued: pending.length }));
      });
      return;
    }

    res.writeHead(404).end("not found");
  });

  // Warm the session as soon as the runtime is created, so discovery is done
  // (or nearly) by the time the user records their first Capture.
  ensureSession();

  return server;
}
