import { useEffect, useState } from "react";
import { Mic, Square, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Waveform } from "@/components/Waveform";
import type { SpeechCapture } from "@/hooks/useSpeechCapture";

/** The composer bar pinned at the bottom — a compact recorder so the action log
 * above gets the room. While recording it shows the live waveform; the spoken
 * words themselves stream into the feed as a pending entry (see CaptureFeed). */
export function Composer({ capture }: { capture: SpeechCapture }) {
  const { supported, recording, error, analyser, toggle, submitTyped } = capture;

  // Space toggles recording on/off (not push-to-hold) — a hands-on-keyboard
  // alternative to the mic button. Ignored while typing or when a control is
  // focused (so Space still works normally there), and only when speech capture
  // is available.
  useEffect(() => {
    if (!supported) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || el?.isContentEditable) return;
      e.preventDefault(); // don't scroll the page
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supported, toggle]);

  if (!supported) return <TypedComposer onSubmit={submitTyped} />;

  return (
    <footer className="border-t border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-5 py-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className={cn(
            "relative grid size-12 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            recording
              ? "bg-record animate-record-ring"
              : "bg-primary shadow-[0_6px_20px_-6px] shadow-primary/60 hover:brightness-110",
          )}
        >
          {recording ? <Square className="size-5 fill-current" /> : <Mic className="size-5" />}
        </button>

        <div className="min-w-0 flex-1">
          {recording ? (
            <Waveform analyser={analyser} className="h-9 w-full" />
          ) : error ? (
            <p className="text-sm text-record">{error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Press to record (or tap <kbd className="rounded border border-border px-1 text-xs">Space</kbd>). Vaulter files each thought as you pause.
            </p>
          )}
        </div>

        {recording && (
          <span className="shrink-0 text-xs font-medium text-record">● Listening</span>
        )}
      </div>
    </footer>
  );
}

function TypedComposer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text);
    setText("");
  };
  return (
    <footer className="border-t border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-end gap-2 px-5 py-3.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder="Type a thought to file…  (⌘/Ctrl+Enter)"
          className="min-h-11 flex-1 resize-y rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={submit} size="lg" className="h-11">
          <Send /> File
        </Button>
      </div>
    </footer>
  );
}
