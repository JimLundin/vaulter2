# Drive the agent through the Vercel AI SDK, with a client-side capture queue

Vaulter originally used the Claude Agent SDK directly: a long-lived streaming
session (ADR-0003), a server-side serialized queue with sidecar retry (ADR-0004),
and a bespoke SSE wire protocol feeding hand-written React capture cards. That
worked, but the UI was entirely custom and the agent plumbing was ours to
maintain. We wanted the polished, well-trodden AI SDK frontend surface (`useChat`,
streamed-markdown rendering) instead of growing our own.

## Decision

Move the agent interaction onto the **Vercel AI SDK**, keeping the Claude Agent
SDK as the engine *underneath* via the community provider
[`ai-sdk-provider-claude-code`](https://github.com/ben-vargas/ai-sdk-provider-claude-code).

- **Auth (ADR-0001 preserved).** The provider wraps `@anthropic-ai/claude-agent-sdk`,
  so the owner's Claude Pro/Max subscription still authenticates with no API key.
  We validated the alternative — bridging the raw OAuth token into the AI SDK's
  `authToken` — and confirmed it works but requires re-implementing token refresh
  and spoofing the Claude Code system-prompt identity block; wrapping the Agent
  SDK avoids all of that.
- **Engine.** `buildModel()` configures the provider with `cwd` = the vault,
  `permissionMode: "acceptEdits"`, an explicit `allowedTools` allowlist, and
  `settingSources: []` / `mcpServers: {}` for isolation. One `streamText` call
  files one Capture end to end — the agentic tool loop runs inside the Agent SDK.
- **Backend.** The Runtime collapses to one endpoint, `POST /api/chat`, which runs
  a turn and returns the AI SDK UI-message stream (`pipeUIMessageStreamToResponse`),
  committing the vault on finish. A per-turn `AbortSignal` watchdog bounds a hung
  turn.
- **Serialization on the client (supersedes ADR-0003/0004).** Captures queue in
  the browser and feed `useChat` one at a time — the next is sent only when the
  previous turn returns to `ready`. Because exactly one turn is ever in flight,
  turns never race over the vault, so the server needs no pump, no lock, and no
  sidecar machinery. Conversation continuity is the message history `useChat`
  holds and re-sends each turn.
- **Frontend.** `useChat` + `streamdown` (the renderer AI Elements' `<Response>`
  wraps) replace the SSE folding and hand-written cards. Assistant turns render
  their `parts` in order, so actions and prose interleave as the agent produced
  them; wikilinks render as chips; the queue is shown in the feed.

## Considered and rejected

- **Full OAuth-token bridge (drop the Agent SDK).** Viable — we proved a custom
  `fetch` setting `authToken` + the Claude Code identity system block returns 200
  — but it means owning token refresh and the identity spoof, and re-building the
  filesystem tool loop. Wrapping the Agent SDK gives the same subscription auth
  for free.
- **Keep the bespoke SSE feed, adopt AI Elements only for rendering.** Smaller
  change, but leaves two streaming models in the tree; going to `useChat`
  end-to-end is simpler once the client owns serialization.
- **Server-side queue with a custom `ChatTransport`.** Bridging the global SSE
  feed back into `useChat`'s per-request model is more glue than the client queue,
  for no benefit.

## Consequences

- **Smaller, more standard surface.** The server is ~one endpoint; the client uses
  a maintained hook and renderer instead of custom SSE/card code. `feed.ts`,
  `pending.ts`, the streaming `Session`, and the old cards/`useFeed` are gone.
- **Durability tradeoff.** Sidecar retry (ADR-0004) is dropped: a failed turn is
  surfaced by `useChat`'s error state and the capture stays in the conversation,
  but it is no longer persisted to disk across a crash. Acceptable for a
  single-user local tool; revisit if it bites.
- **No more per-capture revert/diff UI.** Git-as-undo still holds (every turn is a
  commit), but the in-app revert/diff buttons and their endpoints were removed;
  use git/Obsidian for now.
- **New dependencies** (`ai`, `@ai-sdk/react`, `ai-sdk-provider-claude-code`,
  `streamdown`) and a larger JS bundle from the markdown renderer; a candidate for
  lazy-loading later.
- **Commit subjects are now derived from the changed files** (`summarizeChanges`),
  not the agent's prose.
