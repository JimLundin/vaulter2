import { useEffect, useRef, useState } from "react";
import type { Capture, FeedEvent } from "@/lib/types";

export type Feed = {
  captures: Capture[];
  model: string | null;
  /** Discovery warm-up finished — Vaulter is oriented and ready to file. */
  ready: boolean;
  /** SSE connection is live. */
  connected: boolean;
};

/** Subscribe to the Runtime's /events stream and fold the per-Capture events
 * into a chronological list the feed renders. One Capture is built up across
 * many events (queued → start → text/tool… → done), keyed by its id. */
export function useFeed(): Feed {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);

  // Fold one event into the capture with this id, creating it if needed.
  const patch = useRef((id: number, fn: (c: Capture) => Capture) => {
    setCaptures((prev) => {
      const i = prev.findIndex((c) => c.id === id);
      if (i === -1) {
        const blank: Capture = { id, transcript: "", state: "queued", agentText: "", tools: [], attempts: 0 };
        return [...prev, fn(blank)];
      }
      const next = prev.slice();
      next[i] = fn(prev[i]);
      return next;
    });
  });

  useEffect(() => {
    const es = new EventSource("/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const ev: FeedEvent = JSON.parse(e.data);
      switch (ev.type) {
        case "info":
          setModel(ev.model);
          setReady(ev.ready);
          break;
        case "ready":
          setReady(true);
          break;
        case "queued":
          patch.current(ev.id, (c) => ({ ...c, transcript: ev.transcript, state: "queued" }));
          break;
        case "start":
          patch.current(ev.id, (c) => ({ ...c, state: "filing" }));
          break;
        case "text":
          patch.current(ev.id, (c) => ({ ...c, agentText: c.agentText + ev.text }));
          break;
        case "tool":
          patch.current(ev.id, (c) => ({ ...c, tools: [...c.tools, { tool: ev.tool, target: ev.target }] }));
          break;
        case "retry":
          // Filing failed but the Capture is preserved and re-queued — reset to a
          // pending state; it fills in again when its turn comes up.
          patch.current(ev.id, (c) => ({
            ...c,
            state: "queued",
            agentText: "",
            tools: [],
            attempts: ev.attempts,
          }));
          break;
        case "done":
          patch.current(ev.id, (c) => ({
            ...c,
            state: "done",
            summary: ev.summary || "Filed.",
            commit: ev.commit,
            sync: ev.sync,
            syncDetail: ev.syncDetail,
          }));
          break;
        case "error":
          patch.current(ev.id, (c) => ({ ...c, state: "error", error: ev.message }));
          break;
      }
    };
    return () => es.close();
  }, []);

  return { captures, model, ready, connected };
}
