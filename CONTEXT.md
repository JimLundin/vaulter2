# Vaulter

A minimal, local-first application: you speak, it transcribes, and an agent files the result into a knowledge vault of plain Markdown files that you own.

## Language

**Vault**:
The user's knowledge base — a directory of plain Markdown files on local disk, readable and editable by Obsidian. The single source of truth; the app owns no separate database of note content.
_Avoid_: database, store, notebook

**Note**:
A single Markdown file inside the Vault.
_Avoid_: document, entry, page

**Capture**:
A segment of speech and the transcript it produces — the unit of input Vaulter acts on. While recording, the transcript is flushed to the Runtime on a **speech pause** (and once more when recording stops), with sub-thought fragments coalesced into the next chunk — so a Capture is a thought-sized chunk of a longer train of thought rather than a whole utterance or every sentence. Transcription happens **in the browser** via the Web Speech API, so the Runtime receives text, never audio.
_Avoid_: recording, memo, input

**Vaulter**:
The agent that reads the Vault and reorganizes it in response to a Capture — creating, editing, moving, merging, and splitting Notes. It builds a **wiki**: atomic, densely interlinked notes (one topic each) with Maps of Content, not a journal. The intelligence lives in the model, not in app code. (The app is named after it.)
_Avoid_: Librarian, assistant, bot, AI

**Runtime**:
A tiny local process (Node) that runs the agent — the Vercel AI SDK over a provider that wraps the Claude Agent SDK — owns the Vault folder and its git history, and serves the browser UI. Holds the model credentials and is the only thing that touches the filesystem.
_Avoid_: server, backend, daemon

**Constraints (not glossary, but binding):**
- _Local-first_ means **data sovereignty**: Notes are plain files on the user's disk; cloud APIs (transcription, model) are permitted.
- Vaulter acts **autonomously** — it writes immediately, with no approval step.
- Every Capture's changes are **auto-committed to git**, so any bad edit is diffable and revertible. Git is the undo system. If an `origin` remote is configured, each commit is also **pushed** (best-effort, bounded by a timeout) so the remote mirrors local capture-by-capture — git doubles as off-machine sync. The local commit always succeeds first; a failed push is surfaced, never fatal, and the next successful push carries the backlog.
- Captures are **serialized on the client**: the browser queues them and feeds the agent one turn at a time, sending the next only after the previous turn finishes. A turn that fails is surfaced in the UI and the capture stays in the conversation (re-sendable), but is **no longer persisted to a disk sidecar** across a crash — the sidecar/requeue durability of ADR-0004 was dropped in the AI-SDK move (ADR-0006); revisit if it bites.
- Vaulter runs on the **Claude Agent SDK** (TypeScript) underneath, authenticated with the owner's **Claude Pro/Max subscription** via the normal `claude` login (on-disk OAuth credentials) — **no metered API key**. As of **2026-06-15** this usage draws from the plan's monthly **Agent SDK credit**, which the docs explicitly extend to "third-party apps built on the Agent SDK." Personal/local single-user use.
- The model layer is the **Vercel AI SDK** driving a provider that wraps the Agent SDK (`ai-sdk-provider-claude-code`); subscription credit is still spent through the Agent SDK runtime underneath. A **raw API key** path is ruled out (only the Agent SDK / `claude -p` runtime can spend the subscription credit); a direct OAuth-token bridge into the AI SDK was validated but rejected as more fragile than wrapping the Agent SDK (see ADR-0006).
- A **pure-browser, subscription-paid** app was investigated exhaustively and is **impossible**, on four independent grounds: the browser same-origin model (a page cannot ride claude.ai's session from another origin), no public OAuth client registration for third-party web apps, no CORS-enabled subscription-token API endpoint, and the Feb-2026 ToS ban (server-side enforced) on subscription OAuth in third-party apps. The subscription's only programmatic surface is the local Agent SDK / `claude -p` runtime.
- Architecture is therefore: a **browser UI** (capture + feed) served by, and talking to, a **local Runtime** that holds the credentials, runs the Agent SDK, and owns the Vault + git.
- Each Capture is **fire-and-forget**: autonomous, no clarifying conversation. The UI is a scrolling feed of results, not a back-and-forth chat. The browser's `useChat` holds the running conversation and re-sends it each turn, so the Vault stays **discovered across captures via message history** — a later chunk extends what earlier ones filed. There is no separate persistent server session or launch-time discovery turn (this supersedes the single-session design of ADR-0003).
- Vaulter conforms to a **living, vault-resident rulebook** — `meta/conventions.md`: a constitution of naming, frontmatter schema, a closed note-type taxonomy, a **flat-namespace** layout (notes at root; only `inbox/`, `daily/`, `meta/` as folders), a no-orphans linking invariant, and Map-of-Content thresholds. Vaulter **reads it at launch and maintains it**, appending any new structural decision it makes so structure stays consistent across sessions instead of being re-inferred each time. It also observes the existing notes to see how those conventions are applied in practice. On first run it seeds a starting skeleton — including `meta/conventions.md` — so the cold-start Vault has both structure and rules to conform to (see ADR-0005). The owner can edit the conventions file in Obsidian to change the house style.
- A Capture's transcript is **streamed to Vaulter on a speech pause while recording** (and flushed once more when recording stops) — no review/edit step. Filing begins as soon as you pause, so for ordinary (pausing) speech Vaulter starts filing before you've finished the recording.
- Captures are **serialized on the client** (one turn in flight at a time); the Runtime commits the Vault after each turn, with a deterministic subject derived from the changed Notes. Because only one turn ever runs, the per-chunk **git commit** never races the agent's edits — no server-side lock or pump is needed.
