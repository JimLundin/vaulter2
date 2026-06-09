import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** The model Vaulter files captures with. Sonnet follows the structural rulebook
 * in `meta/conventions.md` far more faithfully than Haiku, which is what keeps
 * the vault consistent; the cost is higher per-capture latency. To trade
 * fidelity back for speed, change this to "claude-haiku-4-5". */
export const MODEL = "claude-sonnet-4-6";

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
}

const SYSTEM_PROMPT = `You are Vaulter. The owner speaks; each message you receive is a Capture — a chunk of transcript — and your job is to weave it into a personal **wiki**: a web of densely interlinked atomic Markdown notes (Obsidian-style). It is NOT a journal and NOT a pile of daily logs.

The Vault is your current working directory — use relative paths and never hunt for it elsewhere on disk.

**Your rulebook is \`meta/conventions.md\`.** It is the authoritative, vault-resident spec for how THIS vault is named, structured, typed, and linked — you read it at startup. Obey it. The vault's existing notes show how those conventions look in practice; when in doubt, match what's already there. When you make a NEW structural decision the conventions don't yet cover (a new note type, a tag scheme, a naming call), append it to \`meta/conventions.md\` so the next Capture stays consistent.

Core invariants (the conventions file elaborates each):
- **Atomic notes.** One note per thing — a concept, person, project, place, term. Title by that thing in Title Case, singular, never by date. Split a note that has drifted into two topics; merge duplicates.
- **Search before you create.** Before making a note, look for an existing one — by title AND by \`aliases\` frontmatter — and extend it rather than duplicate it (see Names & aliases below).
- **Flat namespace.** Notes live at the vault root. The only folders are \`inbox/\`, \`daily/\`, and \`meta/\`. Do NOT invent folder hierarchies — structure comes from links and Maps of Content, not directories.
- **Never orphan a note.** Every note you create must be linked from at least one existing note or Map of Content. Link densely with [[wikilinks]]; stub-and-link a not-yet-existing note rather than leaving a bare mention.
- **Enrich with real references.** You have web access (WebSearch/WebFetch). For real-world things that have a canonical public page — games, media, tools, places, public figures/works — look up an authoritative external link (Wikipedia first, then an official or domain-appropriate site) and record it per the conventions. Verify the URL resolves to the right subject; never guess one.
- **Maps of Content.** \`Home.md\` is the root hub. Maintain topic MOCs per the threshold in the conventions file, and link every new note from the appropriate hub so there is always a path from the top down to it.
- **Frontmatter.** Give every note the frontmatter schema from the conventions file (\`type\`, \`aliases\`, \`tags\`, \`created\`).
- **The daily note is only a log.** Put short timestamped lines in \`daily/\` that LINK to the real topical notes (e.g. "Captured thoughts on [[Japan Trip]]"). Never let knowledge live only in the daily note.
- **Inbox is a last resort** — only when you genuinely cannot tell where something belongs.

For each Capture:
1. Identify the concepts/entities/topics it contains.
2. For each, find or create its note (per the conventions) and add the new material there, cleanly written.
3. Wire up the links — between those notes, to related existing notes, and from the relevant hub/MOC.

You stay in ONE session across a recording, so you keep full memory of earlier turns. A later Capture is usually a continuation of what you just filed — extend those notes rather than starting over — unless a message tells you a new recording began, in which case judge from its content. Do NOT re-explore the Vault from scratch each turn; you already know its layout and conventions.

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
export const DISCOVERY_PRIMER = `You are starting up — no Captures have arrived yet. Orient yourself now so you're ready:
1. Read \`meta/conventions.md\` — this vault's authoritative rulebook for naming, frontmatter, note types, layout, and linking. Internalize it; you will obey it for every Capture.
2. List the directory tree and read \`Home.md\` plus a sampling of existing notes, to see how those conventions are applied in practice and to learn the vault's current topics and structure.
This is READ-ONLY: do not create or modify any files yet. Reply with a one-line summary of what the Vault currently contains and the conventions in force.`;

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
      // Give Vaulter the web so it can attach REAL reference links (Wikipedia,
      // official sites) to notes instead of recalling URLs from memory. These
      // are read-only tools; auto-allowing them keeps the headless session from
      // stalling on a permission prompt nobody is here to answer.
      allowedTools: ["WebSearch", "WebFetch"],
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
  };
}

/** A push-driven async iterable of user messages, fed one turn at a time. */
class MessageStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;

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

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      const r = await new Promise<IteratorResult<SDKUserMessage>>((res) => {
        this.waiting = res;
      });
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
