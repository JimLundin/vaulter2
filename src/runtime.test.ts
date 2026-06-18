import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Capture what the mocked streamText was called with, and a handle to trigger its
// onFinish, so the test can drive the endpoint deterministically with no model.
const h = vi.hoisted(() => ({
  lastCall: null as any,
  onFinish: null as null | ((e: { text: string }) => unknown),
}));

vi.mock("./agent.js", () => ({
  MODEL: "test-model",
  buildModel: () => ({ id: "mock-model" }),
}));

vi.mock("./vault.js", () => ({
  commitAll: vi.fn(async () => "abc1234"),
  pushToRemote: vi.fn(async () => ({ status: "no-remote" as const })),
  summarizeChanges: vi.fn(async () => "Thing"),
}));

// Mock the AI SDK so the endpoint streams instantly without a real model.
vi.mock("ai", () => ({
  convertToModelMessages: async (m: unknown) => m,
  streamText: (opts: any) => {
    h.lastCall = opts;
    h.onFinish = opts.onFinish;
    return {
      pipeUIMessageStreamToResponse: (res: any) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "text-delta", delta: "ok" })}\n\n`);
        res.end(`data: ${JSON.stringify({ type: "finish" })}\n\n`);
        // Simulate the turn finishing so onFinish (the commit) runs.
        void opts.onFinish?.({ text: "Created [[Thing]]" });
      },
    };
  },
}));

import { createRuntime } from "./runtime.js";
import { commitAll } from "./vault.js";

const post = (port: number, p: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Raw POST so we can set the `Host` header (fetch forbids overriding it). */
function rawPost(port: number, p: string, host: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: p,
        method: "POST",
        headers: { "Content-Type": "application/json", Host: host, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for condition");
}

describe("runtime /api/chat", () => {
  let server: Server;
  let port: number;
  let vault: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    h.lastCall = null;
    h.onFinish = null;
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaulter-rt-"));
    server = createRuntime(vault);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("runs a filing turn over the posted messages and commits on finish", async () => {
    const res = await post(port, "/api/chat", {
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "a thought" }] }],
    });
    expect(res.status).toBe(200);
    await res.text(); // drain the stream

    // The endpoint handed the conversation to the model...
    expect(h.lastCall).toBeTruthy();
    expect(h.lastCall.messages).toEqual([
      { id: "m1", role: "user", parts: [{ type: "text", text: "a thought" }] },
    ]);
    // ...and committed the Vault when the turn finished, using a subject derived
    // from the changed files (summarizeChanges → "Thing").
    await waitFor(() => (commitAll as any).mock.calls.length > 0);
    expect((commitAll as any).mock.calls[0][1]).toBe("vaulter: Thing");
  });

  it("400s a chat request with no messages array", async () => {
    const res = await post(port, "/api/chat", { not: "messages" });
    expect(res.status).toBe(400);
  });

  it("400s a malformed body", async () => {
    const res = await post(port, "/api/chat", "{ not json");
    expect(res.status).toBe(400);
  });

  it("rejects a non-loopback Host (DNS-rebinding guard)", async () => {
    const status = await rawPost(port, "/api/chat", "evil.example.com", JSON.stringify({ messages: [] }));
    expect(status).toBe(403);
  });
});
