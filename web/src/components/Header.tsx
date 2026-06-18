import { Loader2, Vault } from "lucide-react";
import type { ChatStatus } from "ai";

/** Slim top bar: identity plus the current filing status, derived from useChat.
 * The waiting queue is shown in the feed itself, so this just reflects idle /
 * filing / error. */
export function Header({ status, error }: { status: ChatStatus; error?: Error }) {
  const filing = status === "submitted" || status === "streaming";
  const note = error
    ? { text: "· filing error", cls: "text-record" }
    : filing
      ? { text: "· filing…", cls: "text-primary animate-pulse-soft" }
      : null;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
      <Vault className="size-[18px] text-primary" />
      <h1 className="text-[15px] font-semibold tracking-tight">Vaulter</h1>
      <span className="hidden text-[13px] text-muted-foreground sm:inline">
        speak — Vaulter files it as you go
      </span>
      {note && (
        <span className={`inline-flex items-center gap-1 text-[13px] ${note.cls}`}>
          {filing && <Loader2 className="size-3 animate-spin" />}
          {note.text}
        </span>
      )}
    </header>
  );
}
