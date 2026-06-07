/**
 * The Runtime → browser wire protocol, defined ONCE here and imported by both
 * sides: `src/runtime.ts` broadcasts these over SSE, and the web app folds them
 * into its feed (via the `@shared/feed` alias). Keeping the union in one module
 * means a change to the protocol is a type error on whichever side lags, instead
 * of a silent drift between two hand-synced copies.
 */

/** How a capture's commit fared against the `origin` remote (if any). */
export type SyncState = "synced" | "local" | "failed";

/** A feed event broadcast to every connected browser over SSE. One capture is
 * built up across many of these, keyed by `id` (queued → start → text/tool… →
 * done). `info` and `ready` are session-level, not tied to a capture. */
export type FeedEvent =
  | { type: "info"; model: string; ready: boolean }
  | { type: "ready" }
  | { type: "history"; captures: HistoryCapture[] }
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
  | { type: "error"; id: number; message: string }
  | {
      // A capture's commit was reverted from the UI. `of` is the reverted hash;
      // `commit` is the new revert commit (null if the revert failed, with the
      // reason in `error`).
      type: "reverted";
      of: string;
      commit: string | null;
      sync: SyncState;
      syncDetail?: string;
      error?: string;
    };

/** A past capture reconstructed from git history on (re)load, so a browser
 * refresh doesn't lose the log. Coarser than a live capture — only what a commit
 * preserves (its summary line and hash), no per-action breakdown. */
export type HistoryCapture = {
  commit: string;
  summary: string;
  /** Unix epoch seconds of the commit, for display. */
  at: number;
};
