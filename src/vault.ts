import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const exec = promisify(execFile);

/** Run a git command inside the vault. Returns trimmed stdout. */
async function git(vault: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: vault });
  return stdout.trim();
}

/**
 * Ensure the vault directory exists and is a git repo. On a cold start (the
 * directory is missing or empty) we seed a tiny skeleton so Vaulter has a
 * structure to conform to instead of an empty void, then make the first
 * commit. Returns true if we seeded.
 */
export async function ensureVault(vault: string): Promise<boolean> {
  await fs.mkdir(vault, { recursive: true });

  const isRepo = await fs
    .stat(path.join(vault, ".git"))
    .then(() => true)
    .catch(() => false);

  const entries = (await fs.readdir(vault)).filter((e) => e !== ".git");
  const seeding = !isRepo && entries.length === 0;

  if (!isRepo) {
    await git(vault, "init", "-q");
    // Local identity so commits work even if the user has no global git config.
    await git(vault, "config", "user.name", "Vaulter");
    await git(vault, "config", "user.email", "vaulter@vaulter.local");
  }

  // If VAULTER_REMOTE is set and there's no `origin` yet, wire it up so commits
  // can be pushed for off-machine backup / sync.
  const remoteUrl = process.env.VAULTER_REMOTE;
  if (remoteUrl && !(await hasRemote(vault))) {
    await git(vault, "remote", "add", "origin", remoteUrl);
  }

  if (seeding) {
    await seedSkeleton(vault);
    await commitAll(vault, "vaulter: seed vault");
  }

  return seeding;
}

/** True if the vault repo has an `origin` remote to push to. */
export async function hasRemote(vault: string): Promise<boolean> {
  const remotes = await git(vault, "remote").catch(() => "");
  return remotes.split("\n").includes("origin");
}

export type PushResult =
  | { status: "pushed" }
  | { status: "no-remote" }
  | { status: "failed"; detail: string };

/**
 * Push the current branch to `origin`. Best-effort and bounded by a timeout so
 * an offline/hung remote can't freeze the capture queue. A single `git push`
 * carries every unpushed commit, so a later success transparently catches up
 * anything an earlier failure left behind.
 */
export async function pushToRemote(vault: string): Promise<PushResult> {
  if (!(await hasRemote(vault))) return { status: "no-remote" };
  try {
    await exec("git", ["push", "origin", "HEAD"], { cwd: vault, timeout: 20_000 });
    return { status: "pushed" };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const lines = (e.stderr || e.message || "")
      .toString()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // Prefer git's root-cause line (the first fatal:/error:) over its trailing advice.
    const detail =
      lines.find((l) => /^(fatal|error):/i.test(l)) || lines[0] || "push failed";
    return { status: "failed", detail };
  }
}

/** Lay down a minimal starting structure: an inbox, a daily note, a README. */
async function seedSkeleton(vault: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await fs.mkdir(path.join(vault, "inbox"), { recursive: true });
  await fs.mkdir(path.join(vault, "daily"), { recursive: true });

  // Home is the Map of Content — the entry point Vaulter links every topic from.
  // Seeding it (rather than a bare daily note) steers Vaulter toward a wiki.
  await fs.writeFile(
    path.join(vault, "Home.md"),
    [
      "# Home",
      "",
      "Map of content for this Vault — the entry point that links out to every topic.",
      "As the Vault grows, topical notes are linked from here (or from a more",
      "specific hub note).",
      "",
      "## Topics",
      "",
      "_(none yet — start capturing)_",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(vault, "README.md"),
    [
      "# Vault",
      "",
      "A personal wiki of plain Markdown notes, filed by Vaulter. Knowledge lives",
      "in atomic, densely interlinked topical notes — not in the daily log.",
      "Open this folder in Obsidian to browse and edit. Every Capture is committed",
      "to git, so any change is diffable and revertible.",
      "",
      "- `Home.md` — the map of content; the entry point into the wiki",
      "- `inbox/` — captures that haven't found a permanent home yet",
      "- `daily/` — a dated log; short lines that link out to the topical notes",
      "",
    ].join("\n"),
  );

  await fs.writeFile(path.join(vault, "inbox", ".gitkeep"), "");

  await fs.writeFile(
    path.join(vault, "daily", `${today}.md`),
    [`# ${today}`, "", ""].join("\n"),
  );
}

/** Stage everything and commit. Returns the new commit hash, or null if
 * Vaulter changed nothing. */
export async function commitAll(
  vault: string,
  message: string,
): Promise<string | null> {
  await git(vault, "add", "-A");
  const status = await git(vault, "status", "--porcelain");
  if (!status) return null; // nothing changed
  await git(vault, "commit", "-q", "-m", message);
  return git(vault, "rev-parse", "--short", "HEAD");
}
