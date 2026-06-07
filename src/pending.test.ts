import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  nextStamp,
  stampOf,
  persistSidecar,
  removeSidecar,
  loadSidecars,
  PENDING_DIR,
} from "./pending.js";

describe("nextStamp / stampOf", () => {
  it("formats as <ms>-<4-digit seq> and stays sortable across rapid calls", () => {
    const stamps = Array.from({ length: 5 }, () => nextStamp());
    for (const s of stamps) expect(s).toMatch(/^\d+-\d{4}$/);
    // Lexicographic order matches creation order — the property loadSidecars
    // relies on to replay oldest-first.
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("recovers the stamp from a sidecar path", () => {
    expect(stampOf("/vault/.vaulter/pending/1717-0003.txt")).toBe("1717-0003");
  });
});

describe("sidecar persistence", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaulter-pending-"));
  });
  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("persists under .vaulter/pending and round-trips through loadSidecars", async () => {
    const a = await persistSidecar(vault, "first thought");
    const b = await persistSidecar(vault, "second thought");
    expect(a).toContain(path.join(PENDING_DIR));

    const loaded = await loadSidecars(vault);
    expect(loaded.map((l) => l.transcript)).toEqual(["first thought", "second thought"]);

    await removeSidecar(a);
    const afterRemove = await loadSidecars(vault);
    expect(afterRemove.map((l) => l.transcript)).toEqual(["second thought"]);
    expect(afterRemove.map((l) => l.sidecar)).toEqual([b]);
  });

  it("drops empty/whitespace sidecars on load", async () => {
    await persistSidecar(vault, "real");
    await persistSidecar(vault, "   "); // trims to empty → should be dropped
    const loaded = await loadSidecars(vault);
    expect(loaded.map((l) => l.transcript)).toEqual(["real"]);
  });

  it("returns [] when no pending dir exists", async () => {
    expect(await loadSidecars(vault)).toEqual([]);
  });

  it("removeSidecar tolerates a missing file", async () => {
    await expect(removeSidecar(path.join(vault, "nope.txt"))).resolves.toBeUndefined();
  });
});
