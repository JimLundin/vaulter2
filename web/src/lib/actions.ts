import type { ToolCall } from "@/lib/types";

/** A tool call humanized into a meaningful action on the Vault — "Created
 * Shinkansen", "Edited Japan Trip" — instead of the raw command/path the agent
 * ran. Non-meaningful tool calls (mkdir, ls, plain Bash) collapse to null. */
export type ActionKind = "read" | "create" | "edit" | "move" | "search";
export type Action = { kind: ActionKind; verb: string; label: string };

/** A vault path → the Note's display name (basename, no folders, no .md). */
function noteName(p: string): string {
  const base = (p.split("/").pop() || p).trim();
  return base.replace(/\.md$/i, "") || p;
}

function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, "");
}

/** Only a couple of Bash commands map to a real Vault action (renames/merges via
 * `mv`); everything else (mkdir, ls, cat…) isn't a meaningful action to show. */
function fromBash(cmd: string): Action | null {
  const mv = cmd.trim().match(/^mv\s+(?:-\S+\s+)*(.+?)\s+(\S+)\s*$/);
  if (mv) return { kind: "move", verb: "Moved", label: `${noteName(unquote(mv[1]))} → ${noteName(unquote(mv[2]))}` };
  return null;
}

function humanize(t: ToolCall): Action | null {
  switch (t.tool) {
    case "Write":
      return { kind: "create", verb: "Created", label: noteName(t.target) };
    case "Edit":
    case "MultiEdit":
      return { kind: "edit", verb: "Edited", label: noteName(t.target) };
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
