// The Runtime → browser wire protocol lives in src/feed.ts and is imported here
// (via the @shared alias) so the two sides can't drift. Re-exported so existing
// imports of FeedEvent / SyncState from "@/lib/types" keep working.
export type { FeedEvent, SyncState } from "@shared/feed";

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
  sync?: import("@shared/feed").SyncState;
  syncDetail?: string;
  error?: string;
  /** A status-marker row (e.g. the result of a revert) rather than a spoken
   * capture — rendered slim from `summary`/`error`, with no transcript or
   * action list. */
  marker?: boolean;
};
