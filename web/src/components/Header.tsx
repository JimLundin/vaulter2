import { Vault } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Slim top bar: identity, connection/warm-up state, and the active model.
 * Distinguishes "not connected to the Runtime" from "connected but still
 * learning the vault" so the UI never sits silently on the wrong status. */
export function Header({
  model,
  ready,
  connected,
}: {
  model: string | null;
  ready: boolean;
  connected: boolean;
}) {
  const status = !connected
    ? { text: "· connecting to runtime…", className: "text-muted-foreground" }
    : !ready
      ? { text: "· learning your vault…", className: "text-primary animate-pulse-soft" }
      : null;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
      <Vault className="size-[18px] text-primary" />
      <h1 className="text-[15px] font-semibold tracking-tight">Vaulter</h1>
      <span className="hidden text-[13px] text-muted-foreground sm:inline">
        speak — Vaulter files it as you go
      </span>
      {status && <span className={`text-[13px] ${status.className}`}>{status.text}</span>}
      {model && (
        <Badge variant="muted" className="ml-auto font-mono text-[11px]">
          {model}
        </Badge>
      )}
    </header>
  );
}
