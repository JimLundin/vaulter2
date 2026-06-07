import type { ToolCall } from "@/lib/types";

/** A tool call humanized into a meaningful action on the Vault — "Created
 * Shinkansen", "Renamed Yana → Janne", "Deleted Old Note" — instead of the raw
 * command/path the agent ran. Non-meaningful tool calls (mkdir, ls, plain Bash)
 * collapse to null. */
export type ActionKind =
  | "read"
  | "create"
  | "update"
  | "rename"
  | "move"
  | "delete"
  | "copy"
  | "search";

export type Action = { kind: ActionKind; verb: string; label: string };

/** A vault path → the Note's display name (basename, no folders, no .md). */
function noteName(p: string): string {
  const base = (p.split("/").pop() || p).trim();
  return base.replace(/\.md$/i, "") || p.trim();
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Split a shell command into tokens, honoring quotes — Note names have spaces
 * ("Coast Weekend.md"), so a naive split on whitespace mangles them. */
function tokenize(cmd: string): string[] {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** Map one shell subcommand to a Vault action (rename/move/delete/copy). */
function fromSubcommand(sub: string): Action | null {
  const toks = tokenize(sub.trim());
  if (!toks.length) return null;
  const cmd = (toks[0].split("/").pop() || toks[0]).toLowerCase();
  const args = toks.slice(1).filter((t) => !t.startsWith("-")); // drop flags

  switch (cmd) {
    case "rm":
    case "unlink": {
      if (!args.length) return null;
      const label =
        args.length > 1 ? `${noteName(args[0])} (+${args.length - 1} more)` : noteName(args[0]);
      return { kind: "delete", verb: "Deleted", label };
    }
    case "mv": {
      if (args.length < 2) return null;
      const src = args[0];
      const dst = args[args.length - 1];
      // Same folder → a rename; different folder → a move.
      if (dirOf(src) === dirOf(dst)) {
        return { kind: "rename", verb: "Renamed", label: `${noteName(src)} → ${noteName(dst)}` };
      }
      const destDir = dirOf(dst).split("/").pop() || "root";
      return { kind: "move", verb: "Moved", label: `${noteName(src)} → ${destDir}` };
    }
    case "cp": {
      if (args.length < 2) return null;
      return { kind: "copy", verb: "Copied", label: noteName(args[args.length - 1]) };
    }
    default:
      return null; // mkdir, touch, ls, cat, echo… aren't meaningful Note actions
  }
}

/** A Bash call may chain commands (`mkdir -p X && mv a X/`); surface the first
 * meaningful Note action among them. */
function fromBash(cmd: string): Action | null {
  for (const sub of cmd.split(/&&|\|\||;/)) {
    const a = fromSubcommand(sub);
    if (a) return a;
  }
  return null;
}

function humanize(t: ToolCall): Action | null {
  switch (t.tool) {
    case "Write":
      return { kind: "create", verb: "Created", label: noteName(t.target) };
    case "Edit":
    case "MultiEdit":
      return { kind: "update", verb: "Updated", label: noteName(t.target) };
    case "Read":
      return { kind: "read", verb: "Read", label: noteName(t.target) };
    case "Glob":
    case "Grep":
      return { kind: "search", verb: "Searched", label: "the vault" };
    case "Bash":
      return fromBash(t.target);
    default:
      return null;
  }
}

/** Turn a turn's tool calls into a deduped list of actions, preserving order of
 * first occurrence (so repeated edits to the same Note show once). */
export function humanizeActions(tools: ToolCall[]): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    const a = humanize(t);
    if (!a) continue;
    const key = `${a.kind}:${a.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}
