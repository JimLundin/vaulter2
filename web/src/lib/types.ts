/** SSE events broadcast by the Runtime over /events. Mirrors the `FeedEvent`
 * union in src/runtime.ts — keep the two in sync. */
export type FeedEvent =
  | { type: "info"; model: string; ready: boolean }
  | { type: "ready" }
  | { type: "queued"; id: number; transcript: string }
  | { type: "start"; id: number }
  | { type: "text"; id: number; text: string }
  | { type: "tool"; id: number; tool: string; target: string }
  | { type: "retry"; id: number; attempts: number; message: string }
  | {
      type: "done";
      id: number;
      summary: string;
      commit: string | null;
      sync: SyncState;
      syncDetail?: string;
    }
  | { type: "error"; id: number; message: string };

export type SyncState = "synced" | "local" | "failed";

export type CaptureState = "queued" | "filing" | "done" | "error";

export type ToolCall = { tool: string; target: string };

/** The UI's view of one Capture as it moves queued → filing → done. Built by
 * folding the Runtime's per-id events together (see useFeed). */
export type Capture = {
  id: number;
  transcript: string;
  state: CaptureState;
  agentText: string;
  tools: ToolCall[];
  attempts: number;
  summary?: string;
  commit?: string | null;
  sync?: SyncState;
  syncDetail?: string;
  error?: string;
};
