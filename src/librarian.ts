import { query } from "@anthropic-ai/claude-agent-sdk";

/** A live event from one Librarian run, streamed to the browser feed. */
export type LibrarianEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; target: string };

const SYSTEM_PROMPT = `You are the Librarian of a personal knowledge Vault: a directory of plain Markdown notes that the owner browses and edits in Obsidian. You are given one Capture — a short transcript of something the owner just said aloud — and your job is to file it into the Vault.

You have no preset organizing rulebook. Before you write anything, look at what is already there: list the directory, read a few existing notes, and learn the Vault's own structure, naming conventions, and linking style (e.g. wikilinks, frontmatter, folders, tags). Then act in a way that conforms to it.

File the Capture by doing whatever fits best: create a new note, append to or edit an existing note, move/rename, or split/merge notes so related material lives together. Prefer integrating into existing notes over dumping everything into the inbox; use the inbox only when nothing else fits. Use the owner's existing conventions for filenames and links. Keep the writing clean and faithful to what was said — fix obvious transcription noise, but do not invent facts.

Work autonomously and decisively; there is no human to ask. Do NOT run any git commands — the Runtime commits your changes automatically after you finish. When you are done, end with one short sentence (a feed line) describing what you did, e.g. "Added a note on the Q3 roadmap and linked it from Projects."`;

export interface RunResult {
  summary: string;
}

/**
 * Run the Librarian over one Capture. Streams text + tool-use events via
 * `onEvent`; resolves with the agent's final summary line once it finishes.
 */
export async function runLibrarian(
  vault: string,
  transcript: string,
  onEvent: (e: LibrarianEvent) => void,
  abort?: AbortController,
): Promise<RunResult> {
  // Force the subscription credentials: the on-disk OAuth login from `claude`
  // is used only when no metered API key is present (see ADR-0001).
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  let summary = "";

  for await (const message of query({
    prompt: `A new Capture just came in. File it into the Vault.\n\n---\n${transcript}\n---`,
    options: {
      cwd: vault,
      env,
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: "acceptEdits",
      includePartialMessages: true,
      ...(abort ? { abortController: abort } : {}),
    },
  })) {
    if (message.type === "stream_event") {
      const event = message.event;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        onEvent({ kind: "text", text: event.delta.text });
      }
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          onEvent({
            kind: "tool",
            tool: block.name,
            target: describeToolTarget(block.input),
          });
        } else if (block.type === "text" && block.text.trim()) {
          summary = block.text.trim();
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success" && message.result.trim()) {
        summary = message.result.trim();
      } else if (message.subtype !== "success") {
        throw new Error(`Librarian run failed: ${message.subtype}`);
      }
    }
  }

  return { summary };
}

/** Pull a human-readable target (file path / pattern / command) out of a tool input. */
function describeToolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const val =
    i.file_path ?? i.path ?? i.pattern ?? i.command ?? i.notebook_path ?? "";
  return typeof val === "string" ? val : "";
}
