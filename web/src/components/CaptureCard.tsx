import { useState } from "react";
import {
  ArrowRightLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  GitCommitHorizontal,
  Loader2,
  Mic,
  PencilLine,
  PenLine,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { humanizeActions, type Action, type ActionKind } from "@/lib/actions";
import type { Capture } from "@/lib/types";

const ACTION_ICON: Record<ActionKind, typeof BookOpen> = {
  read: BookOpen,
  create: FilePlus2,
  update: PencilLine,
  rename: PenLine,
  move: ArrowRightLeft,
  delete: Trash2,
  copy: Copy,
  search: Search,
};
// Mutations get accent/colour; deletes read as destructive; passive steps
// (read/search) stay muted.
const VERB_CLASS: Record<ActionKind, string> = {
  read: "text-muted-foreground",
  create: "text-success",
  update: "text-primary",
  rename: "text-primary",
  move: "text-primary",
  delete: "text-record",
  copy: "text-primary",
  search: "text-muted-foreground",
};

function ActionRow({ action }: { action: Action }) {
  const Icon = ACTION_ICON[action.kind];
  return (
    <div className="flex items-center gap-1.5 text-[13px]">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={VERB_CLASS[action.kind]}>{action.verb}</span>
      <span className="truncate text-foreground/90">{action.label}</span>
    </div>
  );
}

/** One Capture in the log, read top-to-bottom like a conversation turn: the
 * spoken text, then the list of actions Vaulter took (not raw commands), then
 * its one-line summary with Note links rendered as chips. */
export function CaptureCard({ capture: c }: { capture: Capture }) {
  const queued = c.state === "queued";
  const actions = humanizeActions(c.tools);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

  // Fetch the commit's diff on first open (per-capture "show diff").
  async function toggleDiff() {
    if (diffOpen) return setDiffOpen(false);
    setDiffOpen(true);
    if (diff == null && c.commit) {
      try {
        const r = await fetch(`/commit/${c.commit}/diff`);
        const j = await r.json();
        setDiff(j.diff ?? j.error ?? "no diff");
      } catch {
        setDiff("Couldn't load the diff.");
      }
    }
  }

  // Ask the Runtime to revert this commit. The outcome arrives as its own feed
  // row (a `reverted` event), so we just fire and re-enable the button.
  async function revert() {
    if (!c.commit || reverting) return;
    setReverting(true);
    try {
      await fetch("/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: c.commit }),
      });
    } catch {
      /* a failure also comes back as a reverted event */
    }
    setReverting(false);
  }

  return (
    <Card
      className={cn(
        "animate-card-in p-4 transition-opacity",
        queued && "opacity-60",
        c.state === "error" && "border-record/60",
      )}
    >
      {/* Headline: spoken text for a live capture, or a one-line summary for a
          status-marker row (e.g. a revert outcome — no transcript to show). */}
      {c.marker ? (
        <div className="flex gap-2.5">
          <RotateCcw className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
          <p className="leading-relaxed text-foreground/90">{c.summary ?? c.error ?? "—"}</p>
        </div>
      ) : (
        <div className="flex gap-2.5">
          <Mic className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
          <p className="font-medium leading-relaxed">{c.transcript}</p>
        </div>
      )}

      {queued && (
        <p className="mt-2 pl-6 text-[13px] text-muted-foreground">
          {c.attempts > 0 ? `· filing failed — re-queued (attempt ${c.attempts})` : "· queued"}
        </p>
      )}

      {/* What Vaulter did — the action list (persists after the turn finishes). */}
      {(actions.length > 0 || c.state === "filing") && (
        <div className="mt-3 ml-1.5 flex gap-2.5 border-l-2 border-primary/30 pl-3">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {actions.map((a, i) => (
              <ActionRow key={i} action={a} />
            ))}
            {c.state === "filing" && (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Vaulter is filing…
              </p>
            )}
          </div>
        </div>
      )}

      {/* Footer: filed marker + commit + sync. No prose summary — the action
          list above is the record of what happened. */}
      {c.state === "done" && (
        <div className="mt-2.5 ml-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-success">
            <Check className="size-3.5" /> Filed
          </span>
          {c.commit && (
            <span className="inline-flex items-center gap-1 font-mono">
              <GitCommitHorizontal className="size-3.5" />
              {c.commit}
            </span>
          )}
          {c.sync === "synced" && (
            <Badge variant="success" className="font-mono">
              <ArrowUp className="size-3" /> synced
            </Badge>
          )}
          {c.sync === "failed" && (
            <Badge variant="record" className="font-mono" title={c.syncDetail}>
              <TriangleAlert className="size-3" /> not pushed
            </Badge>
          )}
          {/* Git is the undo system — surface it: inspect or revert this commit. */}
          {c.commit && (
            <>
              <button
                type="button"
                onClick={toggleDiff}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", diffOpen && "rotate-90")} />
                diff
              </button>
              <button
                type="button"
                onClick={revert}
                disabled={reverting}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-record focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
                {reverting ? "reverting…" : "revert"}
              </button>
            </>
          )}
        </div>
      )}

      {/* The diff this commit introduced, lazy-loaded on first expand. */}
      {c.state === "done" && diffOpen && (
        <pre className="mt-2 ml-1.5 max-h-72 overflow-auto rounded border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
          {diff ?? "Loading…"}
        </pre>
      )}

      {c.state === "error" && <p className="mt-2 pl-6 text-sm text-record">Failed: {c.error}</p>}
    </Card>
  );
}
