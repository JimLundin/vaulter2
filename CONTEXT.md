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
A segment of speech and the transcript it produces — the unit of input Vaulter acts on. While recording, the transcript is flushed to the Runtime in chunks at a regular interval (and once more when recording stops), so a Capture is typically a chunk of a longer thought rather than a whole utterance. Transcription happens **in the browser** via the Web Speech API, so the Runtime receives text, never audio.
_Avoid_: recording, memo, input

**Vaulter**:
The agent that reads the Vault and reorganizes it in response to a Capture — creating, editing, moving, merging, and splitting Notes. The intelligence lives in the model, not in app code. (The app is named after it.)
_Avoid_: Librarian, assistant, bot, AI

**Runtime**:
A tiny local process (Node) that runs the Claude Agent SDK, owns the Vault folder and its git history, and serves the browser UI. Holds the model credentials and is the only thing that touches the filesystem.
_Avoid_: server, backend, daemon

**Constraints (not glossary, but binding):**
- _Local-first_ means **data sovereignty**: Notes are plain files on the user's disk; cloud APIs (transcription, model) are permitted.
- Vaulter acts **autonomously** — it writes immediately, with no approval step.
- Every Capture's changes are **auto-committed to git**, so any bad edit is diffable and revertible. Git is the undo system.
- Vaulter is the **Claude Agent SDK** (TypeScript), authenticated with the owner's **Claude Pro/Max subscription** via the normal `claude` login (on-disk OAuth credentials) — **no metered API key**. As of **2026-06-15** this usage draws from the plan's monthly **Agent SDK credit**, which the docs explicitly extend to "third-party apps built on the Agent SDK." Personal/local single-user use.
- The model layer is the Agent SDK, **not** the Vercel AI SDK and **not** a raw API key (both ruled out: only the Agent SDK / `claude -p` runtime can spend the subscription credit).
- A **pure-browser, subscription-paid** app was investigated exhaustively and is **impossible**, on four independent grounds: the browser same-origin model (a page cannot ride claude.ai's session from another origin), no public OAuth client registration for third-party web apps, no CORS-enabled subscription-token API endpoint, and the Feb-2026 ToS ban (server-side enforced) on subscription OAuth in third-party apps. The subscription's only programmatic surface is the local Agent SDK / `claude -p` runtime.
- Architecture is therefore: a **browser UI** (capture + feed) served by, and talking to, a **local Runtime** that holds the credentials, runs the Agent SDK, and owns the Vault + git.
- Each Capture is **fire-and-forget**: one-shot, autonomous, no clarifying conversation. The UI is a scrolling feed of results, not a chat. The Runtime is stateless across Captures; continuity across chunks comes only from Vaulter re-reading the Vault (e.g. the notes it just touched).
- Vaulter has **no preset organizing rulebook**; it **observes the existing Vault and conforms** to its structure, naming, and linking before acting. On first run it seeds a tiny starting skeleton so the cold-start Vault isn't empty.
- A Capture's transcript is **streamed to Vaulter at a regular interval while recording** (and flushed once more when recording stops) — no review/edit step. Vaulter starts filing before the speaker is finished.
- Captures are **serialized**: one Vaulter run at a time, via a queue. Concurrent runs over the Vault/git are disallowed.
