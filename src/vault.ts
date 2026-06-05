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

  if (seeding) {
    await seedSkeleton(vault);
    await commitAll(vault, "vaulter: seed vault");
  }

  return seeding;
}

/** Lay down a minimal starting structure: an inbox, a daily note, a README. */
async function seedSkeleton(vault: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await fs.mkdir(path.join(vault, "inbox"), { recursive: true });
  await fs.mkdir(path.join(vault, "daily"), { recursive: true });

  await fs.writeFile(
    path.join(vault, "README.md"),
    [
      "# Vault",
      "",
      "A knowledge vault of plain Markdown notes, filed by Vaulter.",
      "Open this folder in Obsidian to browse and edit. Every Capture is committed",
      "to git, so any change is diffable and revertible.",
      "",
      "- `inbox/` — notes that haven't found a permanent home yet",
      "- `daily/` — one note per day, `YYYY-MM-DD.md`",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(vault, "inbox", ".gitkeep"),
    "",
  );

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
