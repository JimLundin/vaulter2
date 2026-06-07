import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Where failed-capture sidecars live: an ephemeral, git-ignored directory that
 * sits OUTSIDE the Vault's note space (`.vaulter/pending/`). When a filing turn
 * fails, the raw transcript is dropped here so it survives a crash and can be
 * re-queued — voice input is unrepeatable, so it must never just evaporate.
 * One `.txt` per pending transcript, named by a sortable stamp. See ADR-0004.
 */
export const PENDING_DIR = path.join(".vaulter", "pending");

let seq = 0;
/** A sortable, collision-free stamp ("<ms>-<seq>"). `Date.now()` alone collides
 * when several captures fail within the same millisecond; the suffix keeps each
 * sidecar (and its eventual `inbox/unfiled-` note) distinct and ordered. */
export function nextStamp(): string {
  return `${Date.now()}-${(seq++).toString().padStart(4, "0")}`;
}

/** Pull the stamp back out of a sidecar path, to correlate its inbox note. */
export function stampOf(sidecar: string): string {
  return path.basename(sidecar, ".txt");
}

/** Persist a failed transcript to its sidecar; returns the absolute path. */
export async function persistSidecar(
  vault: string,
  transcript: string,
  stamp: string = nextStamp(),
): Promise<string> {
  const dir = path.join(vault, PENDING_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${stamp}.txt`);
  await fs.writeFile(file, transcript, "utf8");
  return file;
}

/** Delete a sidecar once its capture is filed (or escalated to the inbox).
 * Tolerates a missing file so a double-removal is harmless. */
export async function removeSidecar(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}

/** Load any sidecars a crashed run left behind, oldest first (the filename sorts
 * by the stamp it was written with). Empty/garbage files are dropped. */
export async function loadSidecars(
  vault: string,
): Promise<{ sidecar: string; transcript: string }[]> {
  const dir = path.join(vault, PENDING_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // no pending dir yet — nothing to recover
  }
  const out: { sidecar: string; transcript: string }[] = [];
  for (const name of names.filter((n) => n.endsWith(".txt")).sort()) {
    const file = path.join(dir, name);
    const transcript = (await fs.readFile(file, "utf8")).trim();
    if (transcript) out.push({ sidecar: file, transcript });
    else await removeSidecar(file);
  }
  return out;
}
