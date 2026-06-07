import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";
import { CaptureCard } from "@/components/CaptureCard";
import type { Capture } from "@/lib/types";

/** The scrolling log of Captures and Vaulter's actions — the main surface. New
 * entries arrive at the bottom; the live (not-yet-filed) interim transcript
 * shows as a pending ghost entry so your words appear as you speak. Sticks to
 * the bottom only while the user is already near it. */
export function CaptureFeed({ captures, interim }: { captures: Capture[]; interim: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  const last = captures.at(-1);
  // Re-run whenever the tail changes shape (new card, more text/tools) or the
  // live interim grows.
  const tail = last ? `${last.id}:${last.state}:${last.agentText.length}:${last.tools.length}` : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [tail, captures.length, interim]);

  const empty = captures.length === 0 && !interim;

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
            {captures.map((c) => (
              <CaptureCard key={c.id} capture={c} />
            ))}
            {interim && <PendingEntry text={interim} />}
          </>
        )}
      </div>
    </main>
  );
}

/** The live interim transcript, before it's flushed to a Capture. */
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
