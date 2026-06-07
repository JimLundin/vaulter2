import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Shared handles the mocked agent SDK writes into, created before vi.mock hoists.
const h = vi.hoisted(() => ({
  send: vi.fn() as ReturnType<typeof vi.fn>,
  end: vi.fn() as ReturnType<typeof vi.fn>,
  cb: { current: null as any },
}));

// Mock the agent SDK: capture the session callbacks so the test can play the
// agent (emit events, complete/fail turns) deterministically, with no real model.
vi.mock("./agent.js", () => ({
  MODEL: "test-model",
  DISCOVERY_PRIMER: "PRIMER",
  startSession: (_vault: string, cb: any) => {
    h.cb.current = cb;
    return { send: h.send, end: h.end };
  },
}));

// Mock git so commits/pushes/reverts are instant and don't touch a real repo.
vi.mock("./vault.js", () => ({
  commitAll: vi.fn(async () => "abc1234"),
  pushToRemote: vi.fn(async () => ({ status: "no-remote" as const })),
  recentCaptures: vi.fn(async () => []),
  showCommit: vi.fn(async (_v: string, hash: string) => `diff for ${hash}`),
  revertCommit: vi.fn(async (_v: string, hash: string) => ({ status: "reverted" as const, commit: `rev-${hash}` })),
  isValidHash: (hash: string) => /^[0-9a-f]{4,40}$/.test(hash),
}));

import { createRuntime } from "./runtime.js";

type Ev = Record<string, any>;

/** Open the SSE feed and accumulate parsed events into a live array. */
async function connect(port: number): Promise<{ events: Ev[]; close: () => void }> {
  const res = await fetch(`http://127.0.0.1:${port}/events`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Ev[] = [];
  let buf = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split("\n").find((l) => l.startsWith("data:"));
          if (data) {
            try {
              events.push(JSON.parse(data.slice(5).trim()));
            } catch {
              /* heartbeat / comment */
            }
          }
        }
      }
    } catch {
      /* cancelled */
    }
  })();
  return { events, close: () => void reader.cancel().catch(() => {}) };
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for condition");
}

const post = (port: number, p: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const startCount = (evs: Ev[]) => evs.filter((e) => e.type === "start").length;

describe("runtime queue state machine", () => {
  let server: Server;
  let port: number;
  let vault: string;
  let feed: { events: Ev[]; close: () => void };

  beforeEach(async () => {
    vi.clearAllMocks();
    h.cb.current = null;
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaulter-rt-"));
    server = createRuntime(vault); // ensureSession() runs here → warm-up send
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    feed = await connect(port);
  });

  afterEach(async () => {
    feed.close();
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(vault, { recursive: true, force: true });
  });

  /** Drive the discovery warm-up to completion so the runtime accepts captures. */
  async function finishWarmup() {
    await waitFor(() => h.cb.current !== null);
    expect(h.send).toHaveBeenCalledWith("PRIMER"); // discovery primed up front
    h.cb.current.onTurnComplete("oriented"); // processing===null → warm-up path
    await waitFor(() => feed.events.some((e) => e.type === "ready"));
  }

  it("primes discovery, then signals ready", async () => {
    await finishWarmup();
    expect(feed.events.some((e) => e.type === "ready")).toBe(true);
  });

  it("files a capture end to end: queued → start → text/tool → done", async () => {
    await finishWarmup();
    await post(port, "/capture", { recordingId: "r1", transcript: "a thought worth filing" });

    await waitFor(() => startCount(feed.events) >= 1);
    const cb = h.cb.current;
    cb.onEvent({ kind: "text", text: "thinking" });
    cb.onEvent({ kind: "tool", tool: "Write", target: "Thought.md" });
    cb.onTurnComplete("Created [[Thought]]");

    await waitFor(() => feed.events.some((e) => e.type === "done"));
    const done = feed.events.find((e) => e.type === "done")!;
    expect(done.summary).toBe("Created [[Thought]]");
    expect(done.commit).toBe("abc1234");
    expect(done.sync).toBe("local"); // no remote configured in the mock
    expect(feed.events.some((e) => e.type === "tool" && e.target === "Thought.md")).toBe(true);
  });

  it("retries a failing turn, then escalates to inbox after MAX_RETRIES", async () => {
    await finishWarmup();
    await post(port, "/capture", { recordingId: "r1", transcript: "unfilable thought" });

    await waitFor(() => startCount(feed.events) >= 1);
    h.cb.current.onTurnError("boom-1");
    await waitFor(() => feed.events.some((e) => e.type === "retry" && e.attempts === 1));
    await waitFor(() => startCount(feed.events) >= 2); // re-queued & re-pumped

    h.cb.current.onTurnError("boom-2");
    await waitFor(() => feed.events.some((e) => e.type === "retry" && e.attempts === 2));
    await waitFor(() => startCount(feed.events) >= 3);

    h.cb.current.onTurnError("boom-3"); // attempts > MAX_RETRIES → escalate
    await waitFor(() => feed.events.some((e) => e.type === "done"));

    const done = feed.events.find((e) => e.type === "done")!;
    expect(done.summary).toMatch(/Couldn't file after 3 attempts/);
    // The terminal fallback wrote a real, committed inbox note.
    const inbox = await fs.readdir(path.join(vault, "inbox"));
    expect(inbox.some((f) => f.startsWith("unfiled-") && f.endsWith(".md"))).toBe(true);
  });

  it("reverts a commit on the serialized lane", async () => {
    await finishWarmup();
    const res = await post(port, "/revert", { commit: "abc1234" });
    expect(res.status).toBe(202);

    await waitFor(() => feed.events.some((e) => e.type === "reverted"));
    const reverted = feed.events.find((e) => e.type === "reverted")!;
    expect(reverted.of).toBe("abc1234");
    expect(reverted.commit).toBe("rev-abc1234");
  });

  it("rejects a revert with an invalid commit hash", async () => {
    await finishWarmup();
    const res = await post(port, "/revert", { commit: "--not-a-hash" });
    expect(res.status).toBe(400);
    expect(feed.events.some((e) => e.type === "reverted")).toBe(false);
  });

  it("400s a capture with no recordingId", async () => {
    await finishWarmup();
    const res = await post(port, "/capture", { transcript: "orphan" });
    expect(res.status).toBe(400);
  });
});
