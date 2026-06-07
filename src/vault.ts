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

  // Keep the ephemeral failed-capture sidecar (`.vaulter/`) out of git so a
  // raw transcript never lands in the Vault's note space (see ADR-0004). Done
  // before any commit so the seed commit already carries the ignore.
  await ensureGitignore(vault);

  if (seeding) {
    await seedSkeleton(vault);
    await commitAll(vault, "vaulter: seed vault");
  }

  return seeding;
}

/** Ensure the Vault's `.gitignore` excludes Vaulter's ephemeral sidecar dir, so
 * a failed capture's raw transcript (held in `.vaulter/pending/`) is never
 * committed into the note space. Idempotent: appends only if not already there. */
async function ensureGitignore(vault: string): Promise<void> {
  const file = path.join(vault, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(file, "utf8");
  } catch {
    /* no .gitignore yet — we'll create one */
  }
  if (current.split("\n").some((l) => l.trim() === ".vaulter/")) return;
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
  await fs.writeFile(file, `${prefix}.vaulter/\n`);
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

/** The seed contents of `meta/conventions.md` — the vault's living constitution.
 * Written FOR the model: Vaulter reads it at startup and obeys it, and appends to
 * it when it makes a new structural decision. The owner can edit it in Obsidian
 * to change the house style. Built as a line array to avoid escaping the Markdown
 * code fences inside a template literal. */
const CONVENTIONS = [
  "# Vault Conventions",
  "",
  "This file is the authoritative rulebook for how this vault is organized.",
  "Vaulter reads it at startup and conforms to it on every Capture. When Vaulter",
  "makes a new structural decision not covered here, it appends the rule below so",
  "the vault stays consistent over time. You (the owner) may edit this file to",
  "change the house style — Vaulter will follow your edits on its next launch.",
  "",
  "## Layout — flat namespace",
  "",
  "All notes live at the **vault root**. The only folders are:",
  "- `inbox/` — captures with no clear home yet (a last resort)",
  "- `daily/` — a dated log of short lines that LINK to topical notes",
  "- `meta/` — this file and any future vault-meta notes",
  "",
  "Do **not** create folder hierarchies for topics. Structure comes from links",
  "and Maps of Content, not directories.",
  "",
  "## Naming",
  "",
  "- **Title Case**, **singular** noun: `Mitochondria.md`, `Japan Trip.md`.",
  "- Never title a note by date (dates belong only in `daily/`).",
  "- One note = one thing. Split a note that drifts into two topics; merge dupes.",
  "- **Search before creating**: match against existing note titles AND their",
  "  `aliases` frontmatter before minting a new note.",
  "",
  "## Frontmatter (every note)",
  "",
  "```",
  "---",
  "type: concept        # concept | person | project | place | term | moc",
  "aliases: []          # alternate / commonly-misheard spellings",
  "tags: []             # lowercase, kebab-case topical tags",
  "created: YYYY-MM-DD",
  "---",
  "```",
  "",
  "## Note types & templates",
  "",
  "Pick the `type` that fits and follow its shape. The first line after the",
  "frontmatter is a one-sentence definition/summary; bodies use `## ` sections.",
  "",
  "- **concept / term** — definition first, then explanation, then `## See also`.",
  "- **person** — keep every alternate spelling in `aliases`. Sections:",
  "  `## About`, `## Relationships`, `## Notes`.",
  "- **project** — sections: `## Status`, `## Next`, `## Log` (dated lines).",
  "- **place** — sections: `## About`, `## Notes`.",
  "- **moc** — a hub note: mostly `[[links]]` out to the notes beneath it.",
  "",
  "## Linking — never orphan a note",
  "",
  "- Every new note must be linked from at least one existing note or MOC.",
  "- Link densely with `[[wikilinks]]`. If a mentioned thing deserves its own",
  "  note, create a one-line stub and link it rather than leaving a bare mention.",
  "- Add `## See also` cross-links so the graph stays connected.",
  "",
  "## Maps of Content",
  "",
  "- `Home.md` is the root MOC; every topic is reachable from it.",
  "- When **5 or more** notes share a topic, promote it to its own MOC note",
  "  (`type: moc`) and link that MOC from `Home`. Until then, link the notes",
  "  directly from `Home`.",
  "",
  "## Conventions added by Vaulter",
  "",
  "_(none yet — Vaulter appends new structural decisions here)_",
  "",
].join("\n");

/** Lay down a minimal starting structure: an inbox, a daily note, a README, and
 * — most importantly — `meta/conventions.md`, the vault's living rulebook that
 * Vaulter reads at startup and conforms to (so structure stays consistent across
 * sessions instead of being re-guessed each launch). See ADR-0005. */
async function seedSkeleton(vault: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await fs.mkdir(path.join(vault, "inbox"), { recursive: true });
  await fs.mkdir(path.join(vault, "daily"), { recursive: true });
  await fs.mkdir(path.join(vault, "meta"), { recursive: true });

  await fs.writeFile(path.join(vault, "meta", "conventions.md"), CONVENTIONS);

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
      "- `meta/conventions.md` — how this vault is named, structured, and linked",
      "  (Vaulter reads it and conforms; edit it to change the house style)",
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

/** A short hash is valid only if it's lowercase hex — guards every helper that
 * passes a client-supplied hash to git, so a value like `--upstream` or a path
 * can never be smuggled in as a flag. (execFile already prevents shell injection;
 * this prevents arg/flag injection.) */
export function isValidHash(hash: string): boolean {
  return /^[0-9a-f]{4,40}$/.test(hash);
}

/** The diff a commit introduced (`git show`), for the UI's per-capture "show
 * diff" view. Returns null for an invalid/unknown hash. */
export async function showCommit(vault: string, hash: string): Promise<string | null> {
  if (!isValidHash(hash)) return null;
  return git(vault, "show", "--stat", "--patch", hash).catch(() => null);
}

export type RevertResult =
  | { status: "reverted"; commit: string }
  | { status: "failed"; detail: string };

/** Revert a capture's commit, creating a new `vaulter: revert …` commit. On a
 * conflict (a later capture touched the same lines) the revert is aborted so the
 * working tree is left clean — the caller surfaces the failure. MUST be called on
 * the serialized lane so it never races an agent turn's edits. */
export async function revertCommit(vault: string, hash: string): Promise<RevertResult> {
  if (!isValidHash(hash)) return { status: "failed", detail: "invalid commit" };
  const subject = await git(vault, "log", "-1", "--pretty=format:%s", hash).catch(() => "");
  const label = subject.replace(/^vaulter:\s*/, "").slice(0, 50) || hash;
  try {
    await git(vault, "revert", "--no-edit", hash);
  } catch (err) {
    // Leave no half-applied revert behind.
    await git(vault, "revert", "--abort").catch(() => {});
    const detail = err instanceof Error ? err.message.split("\n")[0] : "revert failed";
    return { status: "failed", detail };
  }
  // git revert already committed; relabel it with our convention so it shows up
  // in the feed and history like any other Vaulter commit.
  await git(vault, "commit", "--amend", "-q", "-m", `vaulter: revert ${label}`).catch(() => {});
  const commit = await git(vault, "rev-parse", "--short", "HEAD");
  return { status: "reverted", commit };
}
