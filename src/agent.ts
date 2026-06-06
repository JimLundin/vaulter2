import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** The model Vaulter files captures with. Sonnet keeps latency low while still
 * organizing/linking well; change here (or via setModel) to trade speed vs depth. */
export const MODEL = "claude-sonnet-4-6";

/** A live event from the current turn, streamed to the browser feed. */
export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; target: string };

export interface SessionCallbacks {
  /** Text/tool activity during the turn currently being filed. */
  onEvent: (e: AgentEvent) => void;
  /** A turn finished; `summary` is its feed line. Awaited before the next turn
   * is released, so the Runtime can commit without racing the agent. */
  onTurnComplete: (summary: string) => Promise<void> | void;
  /** The turn failed. */
  onError: (message: string) => void;
}

/** A live Vaulter session spanning one recording: many captures, one context. */
export interface Session {
  /** Feed one capture in as a turn. Call only when the previous turn is done. */
  send(transcript: string): void;
  /** Close the input; the underlying query ends once the last turn drains. */
  end(): void;
}

const SYSTEM_PROMPT = `You are Vaulter, the agent that tends a personal knowledge Vault: a directory of plain Markdown notes that the owner browses and edits in Obsidian. The owner speaks; each message you receive is a Capture — a chunk of transcript — and your job is to file it into the Vault.

The Vault is your current working directory — it IS the folder you're already in, so use relative paths (or ".") and never go hunting for it elsewhere on disk.

You stay in ONE session for the whole recording, so the Captures arrive as a sequence and you keep full memory of earlier turns. On the FIRST turn, look at what's already there: list the current directory, read a few existing notes, and learn the Vault's structure, naming, and linking style (wikilinks, frontmatter, folders, tags). On LATER turns do NOT re-explore from scratch — you already know the layout and what you just wrote. A later Capture is usually a continuation of the thought you just filed, so extend the same note rather than starting a new one; only read a note again when you need its current contents to edit it.

File each Capture wherever fits best: create a new note, append to or edit an existing one, move/rename, or split/merge so related material lives together. Prefer integrating into existing notes over dumping into the inbox; use the inbox only when nothing else fits. Use the owner's conventions for filenames and links. Keep the writing clean and faithful — fix obvious transcription noise, but do not invent facts.

Work autonomously and decisively; there is no human to ask. Do NOT run any git commands — the Runtime commits after each turn. End each turn with one short sentence (a feed line) describing what you did, e.g. "Extended [[Japan trip]] with a draft itinerary."`;

/**
 * Open a Vaulter session over the Vault. Built-in tools (Read/Write/Edit/Bash/
 * Glob/Grep) operate in `cwd`. Subscription auth is forced by stripping any
 * metered API key from the child env (see ADR-0001).
 */
export function startSession(vault: string, cb: SessionCallbacks): Session {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const stream = new MessageStream();

  const q = query({
    prompt: stream,
    options: {
      cwd: vault,
      env,
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: "acceptEdits",
      includePartialMessages: true,
    },
  });

  // Consume the agent's output in the background, mapping it onto turns.
  (async () => {
    let summary = "";
    try {
      for await (const message of q) {
        if (message.type === "stream_event") {
          const event = message.event;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            cb.onEvent({ kind: "text", text: event.delta.text });
          }
        } else if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              cb.onEvent({
                kind: "tool",
                tool: block.name,
                target: describeToolTarget(block.input),
              });
            } else if (block.type === "text" && block.text.trim()) {
              summary = block.text.trim();
            }
          }
        } else if (message.type === "result") {
          if (message.subtype === "success") {
            await cb.onTurnComplete((message.result || summary).trim());
          } else {
            cb.onError(message.subtype);
          }
          summary = "";
        }
      }
    } catch (err) {
      cb.onError(err instanceof Error ? err.message : String(err));
    }
  })();

  return {
    send: (transcript: string) => stream.push(transcript),
    end: () => stream.end(),
  };
}

/** A push-driven async iterable of user messages, fed one turn at a time. */
class MessageStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private done = false;

  push(text: string): void {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    if (this.waiting) {
      this.waiting({ value: msg, done: false });
      this.waiting = null;
    } else {
      this.queue.push(msg);
    }
  }

  end(): void {
    this.done = true;
    if (this.waiting) {
      this.waiting({ value: undefined as never, done: true });
      this.waiting = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.done) return;
      const r = await new Promise<IteratorResult<SDKUserMessage>>((res) => {
        this.waiting = res;
      });
      if (r.done) return;
      yield r.value;
    }
  }
}

/** Pull a human-readable target (file path / pattern / command) out of a tool input. */
function describeToolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const val =
    i.file_path ?? i.path ?? i.pattern ?? i.command ?? i.notebook_path ?? "";
  return typeof val === "string" ? val : "";
}
