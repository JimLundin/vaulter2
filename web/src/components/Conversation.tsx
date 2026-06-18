import { useEffect, useRef } from "react";
import type { UIMessage, ChatStatus } from "ai";
import {
  ArrowRightLeft,
  BookOpen,
  Brain,
  Copy,
  FilePlus2,
  Loader2,
  Mic,
  PencilLine,
  PenLine,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Response } from "@/components/ai-elements/Response";
import { humanizeTool, type Action, type ActionKind } from "@/lib/actions";
import type { ToolCall } from "@/lib/types";

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

type Part = UIMessage["parts"][number];

function isToolPart(p: Part): boolean {
  return p.type === "dynamic-tool" || p.type.startsWith("tool-");
}

function toolCallOf(p: Part): ToolCall {
  const any = p as { toolName?: string; type: string; input?: Record<string, unknown> };
  const tool = any.toolName ?? (any.type.startsWith("tool-") ? any.type.slice(5) : "tool");
  const input = any.input ?? {};
  const target =
    (input.file_path as string) ??
    (input.path as string) ??
    (input.pattern as string) ??
    (input.command as string) ??
    "";
  return { tool, target: typeof target === "string" ? target : "" };
}

function textOf(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
}

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

function ReasoningBlock({ text }: { text: string }) {
  return (
    <details className="text-[12px] text-muted-foreground">
      <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 opacity-70 hover:opacity-100">
        <Brain className="size-3" /> reasoning
      </summary>
      <div className="mt-1 whitespace-pre-wrap border-l border-border pl-2 opacity-80">{text}</div>
    </details>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <Card className="animate-card-in p-4">
      <div className="flex gap-2.5">
        <Mic className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        <p className="font-medium leading-relaxed">{text}</p>
      </div>
    </Card>
  );
}

/** An assistant turn rendered as the agent actually produced it: text and
 * actions interleaved in part order, so "Created X", a sentence, "Linked Y" read
 * top-to-bottom instead of being split into a block of actions and a block of prose. */
function AssistantTurn({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  return (
    <div className="ml-1.5 flex gap-2.5 border-l-2 border-primary/30 pl-3">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            const t = (part as { text: string }).text.trim();
            return t ? <Response key={i}>{t}</Response> : null;
          }
          if (part.type === "reasoning") {
            const t = (part as { text: string }).text.trim();
            return t ? <ReasoningBlock key={i} text={t} /> : null;
          }
          if (isToolPart(part)) {
            const action = humanizeTool(toolCallOf(part));
            return action ? <ActionRow key={i} action={action} /> : null;
          }
          return null;
        })}
        {streaming && (
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Vaulter is filing…
          </p>
        )}
      </div>
    </div>
  );
}

/** A capture waiting its turn behind the one being filed. */
function QueuedTurn({ text }: { text: string }) {
  return (
    <Card className="animate-card-in p-4 opacity-60">
      <div className="flex gap-2.5">
        <Mic className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        <p className="leading-relaxed">{text}</p>
      </div>
      <p className="mt-2 pl-6 text-[13px] text-muted-foreground">· queued</p>
    </Card>
  );
}

/** The scrolling log: filed/filing captures (from useChat), then the waiting
 * queue, then the live interim transcript — the spoken→queued→filing→filed
 * pipeline, visible end to end. Sticks to the bottom only when already near it. */
export function Conversation({
  messages,
  status,
  queued,
  interim,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  queued: string[];
  interim: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const tail = messages.map((m) => m.parts.length).join(",");

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [tail, messages.length, queued.length, interim]);

  const empty = messages.length === 0 && queued.length === 0 && !interim;
  const lastId = messages.at(-1)?.id;

  return (
    <main
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 overflow-y-auto px-5 py-6"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {empty ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((m) =>
              m.role === "user" ? (
                <UserTurn key={m.id} text={textOf(m.parts)} />
              ) : (
                <AssistantTurn
                  key={m.id}
                  message={m}
                  streaming={status === "streaming" && m.id === lastId}
                />
              ),
            )}
            {queued.map((t, i) => (
              <QueuedTurn key={`q${i}`} text={t} />
            ))}
            {interim && <PendingEntry text={interim} />}
          </>
        )}
      </div>
    </main>
  );
}

function PendingEntry({ text }: { text: string }) {
  return (
    <div className="animate-card-in rounded-lg border border-dashed border-border bg-card/40 p-4">
      <div className="flex gap-2.5">
        <Mic className="mt-1 size-3.5 shrink-0 animate-pulse-soft text-record" />
        <p className="italic leading-relaxed text-foreground/80">{text}</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-24 flex flex-col items-center gap-2 text-center">
      <Mic className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Nothing captured yet. Press record below and start talking —
        <br />
        your words and what Vaulter does with them show up here.
      </p>
    </div>
  );
}
