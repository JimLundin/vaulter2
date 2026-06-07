import {
  ArrowRightLeft,
  ArrowUp,
  BookOpen,
  Check,
  FilePlus2,
  GitCommitHorizontal,
  Loader2,
  Mic,
  PencilLine,
  Search,
  Sparkles,
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
  edit: PencilLine,
  move: ArrowRightLeft,
  search: Search,
};
// Mutations get accent/colour; passive steps (read/search) stay muted.
const VERB_CLASS: Record<ActionKind, string> = {
  read: "text-muted-foreground",
  create: "text-success",
  edit: "text-primary",
  move: "text-primary",
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

  return (
    <Card
      className={cn(
        "animate-card-in p-4 transition-opacity",
        queued && "opacity-60",
        c.state === "error" && "border-record/60",
      )}
    >
      {/* Spoken text */}
      <div className="flex gap-2.5">
        <Mic className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        <p className="font-medium leading-relaxed">{c.transcript}</p>
      </div>

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
        </div>
      )}

      {c.state === "error" && <p className="mt-2 pl-6 text-sm text-record">Failed: {c.error}</p>}
    </Card>
  );
}
