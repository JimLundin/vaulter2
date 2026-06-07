import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** The model Vaulter files captures with. Haiku is the fastest tier, to keep
 * filing latency near real-time; change here (or via setModel) to trade speed
 * for depth (e.g. "claude-sonnet-4-6"). */
export const MODEL = "claude-haiku-4-5";

/** A live event from the current turn, streamed to the browser feed. */
export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; target: string };

export interface SessionCallbacks {
  /** Text/tool activity during the turn currently being filed. */
  onEvent: (e: AgentEvent) => void;
  /** A turn succeeded; `summary` is its feed line. Awaited before the next turn
   * is released, so the Runtime can commit without racing the agent. */
  onTurnComplete: (summary: string) => Promise<void> | void;
  /** A single turn failed, but the session is still usable for later turns. */
  onTurnError: (message: string) => void;
  /** The session ended/threw and is no longer usable; it must be reopened. */
  onFatal: (message: string) => void;
}

/** A long-lived Vaulter session: many captures, one shared context (so the Vault
 * is discovered once, not re-explored per chunk). */
export interface Session {
  /** Feed one message in as a turn. Call only when the previous turn is done. */
  send(message: string): void;
  /** Close the input; the underlying query ends once work drains. */
  end(): void;
}

const SYSTEM_PROMPT = `You are Vaulter. The owner speaks; each message you receive is a Capture — a chunk of transcript — and your job is to weave it into a personal **wiki**: a web of densely interlinked atomic Markdown notes (Obsidian-style). It is NOT a journal and NOT a pile of daily logs.

The Vault is your current working directory — use relative paths and never hunt for it elsewhere on disk.

How the wiki must be built:
- **Atomic notes.** Each note is about ONE thing — a concept, person, project, place, decision, term. Title it by that thing ("Mitochondria.md", "Japan Trip.md"), never by date. Keep notes focused: split a note that has drifted into two topics; merge duplicates.
- **Link densely.** Whenever a Capture mentions something that deserves its own note, link it with [[wikilinks]]. If that note doesn't exist yet, create it (even a one-line stub) and link to it — a good wiki is mostly links. Add "See also" / backlinks between related notes so the graph stays connected.
- **Maps of Content.** Maintain hub/index notes (a Home note, and topic MOCs) that link out to the notes beneath them, so there is always a navigable path from the top down to any note. When you add a note, link it from the appropriate hub.
- **The daily note is only a log.** If one exists, put just short timestamped lines there that LINK to the real topical notes (e.g. "Captured thoughts on [[Japan Trip]]"). Never let knowledge live only in the daily note.
- **Inbox is a last resort** — only when you genuinely cannot tell where something belongs.

For each Capture:
1. Identify the concepts/entities/topics it contains.
2. For each, find or create its note and add the new material there, cleanly written.
3. Wire up the links — between those notes, to related existing notes, and from the relevant hub/MOC.

You stay in ONE session across a recording, so you keep full memory of earlier turns. A later Capture is usually a continuation of what you just filed — extend those notes rather than starting over — unless a message tells you a new recording began, in which case judge from its content. Do NOT re-explore the Vault from scratch each turn; you already know its layout.

**Names & aliases.** Transcription mangles names and proper nouns, especially non-English ones (e.g. a person's name comes through as "Yana" / "Jana" for "Janne"). Resolve each Capture's names against the notes you already know, matching on a note's title AND its Obsidian \`aliases\` frontmatter. Keep every alternate or commonly-misheard spelling for an entity in that entity's OWN note, as frontmatter:
\`\`\`
---
aliases: [Yana, Jana]
---
\`\`\`
So when a Capture clearly refers to a known entity under a garbled spelling, file it under the correct existing note (never a duplicate), and if that mishearing is one you might see again, add it to that note's \`aliases\`. The aliases live in the entity's note — do not build a separate alias index. Never invent a person or place the vault and Capture don't support.

Write cleanly and faithfully — fix obvious transcription noise, never invent facts. Work autonomously; there is no human to ask. Do NOT run git — the Runtime commits after each turn. End each turn with one short feed-line summary, e.g. "Created [[Shinkansen]] and linked it from [[Japan Trip]] and [[Home]]."`;

/** Sent once when a session opens, before any Capture, so discovery is paid up
 * front (at server launch) instead of on the first real chunk. */
export const DISCOVERY_PRIMER = `You are starting up — no Captures have arrived yet. Orient yourself now so you're ready: list the directory tree, read the Home/index note and a sampling of existing notes, and build a mental model of the Vault's structure, naming, folders, tags, and how notes link. This is READ-ONLY: do not create or modify any files yet. Reply with a one-line summary of what the Vault currently contains.`;

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
            cb.onTurnError(message.subtype);
          }
          summary = "";
        }
      }
    } catch (err) {
      cb.onFatal(err instanceof Error ? err.message : String(err));
    }
  })();

  return {
    send: (message: string) => stream.push(message),
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
