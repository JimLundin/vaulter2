import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startSession,
  MODEL,
  DISCOVERY_PRIMER,
  type AgentEvent,
  type Session,
} from "./agent.js";
import {
  commitAll,
  pushToRemote,
  recentCaptures,
  showCommit,
  revertCommit,
  isValidHash,
} from "./vault.js";
import {
  persistSidecar,
  removeSidecar,
  loadSidecars,
  stampOf,
  nextStamp,
} from "./pending.js";
import type { FeedEvent, SyncState } from "./feed.js";

/** A capture waiting (or re-queued) for the serialized session. `attempts` is
 * the number of times its filing turn has already FAILED; `sidecar` is the path
 * to its on-disk transcript once persisted (null while it's only in memory). */
type QueueItem = {
  id: number;
  transcript: string;
  newRecording: boolean;
  attempts: number;
  sidecar: string | null;
};

/** A failed capture is re-queued up to this many times; the third failure
 * escalates it to a real `inbox/` Note instead of looping forever (ADR-0004). */
const MAX_RETRIES = 2;

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
  // git commit never races the agent's edits. A turn that FAILS is not dropped:
  // its transcript is persisted to a sidecar and re-queued onto this same lane
  // (see `fail`), so no Capture is ever lost.
  const pending: QueueItem[] = [];
  // Commit hashes the UI asked to revert. They ride the SAME serialized lane as
  // captures (drained by pump while `busy` is held) so a git revert never races
  // an agent turn's edits — the core no-concurrent-writers invariant.
  const reverts: string[] = [];
  let nextId = 1;
  let session: Session | null = null;
  let ready = false; // discovery warm-up finished
  let busy = false; // a turn (or its failure handling) is in flight
  let processing: QueueItem | null = null; // item being filed; null = warm-up
  let recovered = false; // leftover sidecars loaded back in (once, post-warm-up)
  let lastRecordingId: string | null = null;

  function pump(): void {
    if (busy) return;
    // Reverts take the lane first and don't need the agent session (pure git), so
    // they can run even while a dead session waits to be reopened.
    if (reverts.length) {
      const hash = reverts.shift()!;
      busy = true;
      void doRevert(hash).finally(() => {
        busy = false;
        pump();
      });
      return;
    }
    if (!session) return;
    const head = pending.shift();
    if (!head) return;
    busy = true;
    processing = head;
    broadcast({ type: "start", id: head.id });
    // A fresh recording may be an unrelated topic; tell the agent so it doesn't
    // blindly extend the previous recording's notes.
    const message = head.newRecording
      ? `(New recording — this may be a new, unrelated topic; judge from the content whether it continues earlier notes or starts something new.)\n\n${head.transcript}`
      : head.transcript;
    session.send(message);
  }

  /** Revert one capture's commit on the serialized lane, then push, broadcasting
   * the outcome. Held under `busy` by pump, so no agent turn or other git op runs
   * meanwhile. */
  async function doRevert(hash: string): Promise<void> {
    const r = await revertCommit(vault, hash);
    if (r.status === "failed") {
      broadcast({ type: "reverted", of: hash, commit: null, sync: "local", error: r.detail });
      return;
    }
    let sync: SyncState = "local";
    let syncDetail: string | undefined;
    const push = await pushToRemote(vault);
    if (push.status === "pushed") sync = "synced";
    else if (push.status === "failed") {
      sync = "failed";
      syncDetail = push.detail;
    }
    broadcast({ type: "reverted", of: hash, commit: r.commit, sync, syncDetail });
  }

  /** Commit the Vault and (if a remote is set) push it, surfacing the result as
   * the `done` event's commit/sync fields. Shared by the success and the
   * terminal-fallback paths so both commit identically. */
  async function commitAndPush(
    message: string,
  ): Promise<{ commit: string | null; sync: SyncState; syncDetail?: string }> {
    const commit = await commitAll(vault, message.slice(0, 72));
    let sync: SyncState = "local";
    let syncDetail: string | undefined;
    if (commit) {
      const r = await pushToRemote(vault);
      if (r.status === "pushed") sync = "synced";
      else if (r.status === "failed") {
        sync = "failed";
        syncDetail = r.detail;
      }
    }
    return { commit, sync, syncDetail };
  }

  /** Handle a failed filing turn: persist the transcript (so a crash can't lose
   * it), then either re-queue it for another attempt or — once retries are
   * exhausted — escalate it to the inbox. Runs while `busy` is still held, so no
   * other turn or git commit races this one. */
  async function fail(item: QueueItem, message: string): Promise<void> {
    if (!item.sidecar) {
      try {
        item.sidecar = await persistSidecar(vault, item.transcript);
      } catch {
        /* couldn't persist (e.g. disk error) — still retry/escalate in memory */
      }
    }
    item.attempts += 1;
    if (item.attempts > MAX_RETRIES) {
      await escalate(item, message);
    } else {
      broadcast({ type: "retry", id: item.id, attempts: item.attempts, message });
      pending.push(item); // back onto the same FIFO; retried against a live session
    }
  }

  /** Terminal fallback: a capture the agent could not file even after retries is
   * written into the Vault as a plain Note, committed, and pushed — the only
   * off-machine-durable copy — then its sidecar is removed. */
  async function escalate(item: QueueItem, message: string): Promise<void> {
    const stamp = item.sidecar ? stampOf(item.sidecar) : nextStamp();
    const rel = path.posix.join("inbox", `unfiled-${stamp}.md`);
    try {
      await fs.mkdir(path.join(vault, "inbox"), { recursive: true });
      await fs.writeFile(path.join(vault, rel), unfiledNote(item, message, stamp), "utf8");
    } catch (err) {
      broadcast({
        type: "error",
        id: item.id,
        message: `couldn't save unfiled capture: ${err instanceof Error ? err.message : err}`,
      });
      return;
    }
    const { commit, sync, syncDetail } = await commitAndPush(`vaulter: unfiled capture ${stamp}`);
    if (item.sidecar) await removeSidecar(item.sidecar);
    broadcast({
      type: "done",
      id: item.id,
      summary: `Couldn't file after ${item.attempts} attempts — saved raw capture to ${rel}`,
      commit,
      sync,
      syncDetail,
    });
  }

  /** Load any sidecars a crashed run left behind back onto the queue. Runs once,
   * after the discovery warm-up, so recovered captures are filed against an
   * oriented session (and never duplicated on a later re-open). */
  async function recover(): Promise<void> {
    if (recovered) return;
    recovered = true;
    let items: { sidecar: string; transcript: string }[] = [];
    try {
      items = await loadSidecars(vault);
    } catch {
      return;
    }
    for (const it of items) {
      const id = nextId++;
      // A recovered capture stands alone — treat it as a new recording, and give
      // it a fresh retry budget.
      pending.push({ id, transcript: it.transcript, newRecording: true, attempts: 0, sidecar: it.sidecar });
      broadcast({ type: "queued", id, transcript: it.transcript });
    }
  }

  /** The discovery warm-up has finished (success or not): open for captures,
   * recover any leftover sidecars, then start draining. */
  async function afterWarmup(): Promise<void> {
    ready = true;
    broadcast({ type: "ready" });
    busy = false;
    processing = null;
    await recover();
    pump();
  }

  function ensureSession(): void {
    if (session) return;
    ready = false;
    session = startSession(vault, {
      onEvent: (e: AgentEvent) => {
        if (!processing) return; // warm-up turn: nothing to show
        broadcast(
          e.kind === "text"
            ? { type: "text", id: processing.id, text: e.text }
            : { type: "tool", id: processing.id, tool: e.tool, target: e.target },
        );
      },
      onTurnComplete: async (summary: string) => {
        if (!processing) {
          // Warm-up finished: ready for real captures (don't commit orientation).
          await afterWarmup();
          return;
        }
        const item = processing;
        const { commit, sync, syncDetail } = await commitAndPush(
          `vaulter: ${summary || "capture"}`,
        );
        // Filed successfully — a re-queued/recovered item no longer needs its sidecar.
        if (item.sidecar) await removeSidecar(item.sidecar);
        broadcast({ type: "done", id: item.id, summary, commit, sync, syncDetail });
        busy = false;
        processing = null;
        pump();
      },
      onTurnError: (message: string) => {
        if (!processing) {
          // Warm-up failed — proceed anyway; captures will discover as needed.
          void afterWarmup();
          return;
        }
        const item = processing;
        // Hold `busy` through failure handling (it may commit) so nothing else
        // touches the Vault/git meanwhile; release and pump once it settles.
        void fail(item, message).finally(() => {
          busy = false;
          processing = null;
          pump();
        });
      },
      onFatal: (message: string) => {
        const item = processing;
        if (!item) {
          // Warm-up (or an idle session) died — e.g. no `claude` login. Drop the
          // dead session; the NEXT capture reopens it (lazy, so a persistently
          // failing warm-up can't spin-loop spawning processes). Mark ready so the
          // UI stops showing "learning your vault…" and accepts captures, which
          // surface the real error per-capture if the SDK still can't run.
          session = null;
          busy = false;
          processing = null;
          if (!ready) {
            ready = true;
            broadcast({ type: "ready" });
          }
          return;
        }
        // Re-queue/escalate the in-flight item (which emits its own retry/done),
        // holding the session (busy) until it settles so no reopened session
        // commits over this work. A context overflow retries against the fresh
        // session the next capture opens.
        void fail(item, message).finally(() => {
          session = null;
          ready = false;
          busy = false;
          processing = null;
          // No pump: the session is dead; the next capture lazily reopens it.
        });
      },
    });
    // Pay discovery up front, at launch, instead of on the first chunk.
    busy = true;
    processing = null;
    session.send(DISCOVERY_PRIMER);
  }

  function capture(rid: string, transcript: string): void {
    ensureSession();
    if (transcript) {
      const newRecording = rid !== lastRecordingId;
      lastRecordingId = rid;
      const id = nextId++;
      pending.push({ id, transcript, newRecording, attempts: 0, sidecar: null });
      broadcast({ type: "queued", id, transcript });
    }
    pump();
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

    if (req.method === "GET" && url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      res.write(`data: ${JSON.stringify({ type: "info", model: MODEL, ready })}\n\n`);
      clients.add(res);
      // Heartbeat: a comment frame keeps the connection alive through any
      // intermediary idle timeout and surfaces a half-open socket so it gets
      // cleaned up. EventSource ignores comment frames.
      const ping = setInterval(() => {
        if (!res.writableEnded) res.write(": ping\n\n");
      }, 25_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      // Replay recent history to THIS client (best-effort) so a browser reload
      // restores the feed instead of starting blank. Live events still flow via
      // the clients set; the UI keys history separately so ordering is fine.
      void recentCaptures(vault)
        .then((captures) => {
          if (captures.length && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: "history", captures })}\n\n`);
          }
        })
        .catch(() => {});
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

    // The diff a capture's commit introduced (per-capture "show diff").
    if (req.method === "GET" && url.startsWith("/commit/")) {
      const m = url.match(/^\/commit\/([0-9a-f]{4,40})\/diff$/);
      if (m) {
        const diff = await showCommit(vault, m[1]);
        res.writeHead(diff == null ? 404 : 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(diff == null ? { error: "unknown commit" } : { diff }));
        return;
      }
    }

    // Revert a capture's commit. Queued onto the serialized lane (see `reverts`),
    // so the git revert never races an in-flight agent turn.
    if (req.method === "POST" && url === "/revert") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 10_000) req.destroy();
      });
      req.on("end", () => {
        let commit = "";
        try {
          commit = (JSON.parse(body).commit ?? "").toString();
        } catch {
          /* fall through to 400 */
        }
        if (!isValidHash(commit)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "need a valid commit" }));
          return;
        }
        reverts.push(commit);
        pump();
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ queued: reverts.length }));
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

  // Warm the session as soon as the runtime is created, so discovery is done
  // (or nearly) by the time the user records their first Capture.
  ensureSession();

  return server;
}

/** The body of a terminal `inbox/unfiled-*.md` Note: a real, committed Note that
 * preserves a capture Vaulter could not file, so even unfilable input lands in
 * the Vault. */
function unfiledNote(item: QueueItem, message: string, stamp: string): string {
  return [
    `# Unfiled capture ${stamp}`,
    "",
    `> Vaulter could not file this capture automatically after ${item.attempts} attempts`,
    `> (last error: ${message}). The raw transcript is preserved below so nothing is`,
    "> lost — file it into the wiki by hand, or a later capture may pick it up.",
    "",
    item.transcript,
    "",
  ].join("\n");
}
