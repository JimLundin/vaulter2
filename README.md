# Vaulter

Speak a thought; a local **Vaulter** agent files it into your Markdown vault.

Vaulter is local-first: your notes are plain Markdown files you own (open them in
Obsidian), git is the undo system, and the model runs on your own Claude
Pro/Max **subscription** — no API key. See [`CONTEXT.md`](CONTEXT.md) for the full
design and [`docs/adr/`](docs/adr) for why it's built this way.

## Prerequisites

- Node 20+
- A logged-in Claude CLI (`claude` — Pro/Max subscription). Vaulter uses those
  on-disk credentials; it ignores any `ANTHROPIC_API_KEY`.
- A Chromium-based browser (Chrome/Edge) for voice capture. Other browsers fall
  back to typed input.

## Run

```bash
npm install
npm run build
node dist/cli.js ~/my-vault     # or: npx vaulter ~/my-vault
```

This boots a local Runtime on `http://localhost:4317` and opens your browser.
Press **Record** and speak. The transcript is produced in the browser and
streamed to Vaulter in chunks at a regular interval (and once more when you
press **Stop**) — so it starts filing while you're still talking. Each chunk is
queued and handled one at a time: Vaulter reads your vault, conforms to its
structure, files the note, and commits to git. The feed shows what it did.

The vault folder is created and seeded with a tiny skeleton on first run.

### Options

- `VAULTER_PORT` — port (default `4317`)
- `VAULTER_NO_OPEN` — set to skip auto-opening the browser

## How it fits together

- **`src/cli.ts`** — entry: resolves the vault, ensures/seeds it, starts the Runtime.
- **`src/runtime.ts`** — local HTTP server: serves the SPA, an SSE feed, and a
  `/capture` endpoint; serializes captures one at a time.
- **`src/agent.ts`** — one Claude Agent SDK `query()` per recording, fed the
  chunks as a streaming input so the model keeps the vault in context (no
  re-discovery per chunk). The conform-to-vault system prompt, the model
  (`claude-sonnet-4-6`), and event streaming live here.
- **`src/vault.ts`** — first-run seeding and the one-commit-per-capture git logic.
- **`public/index.html`** — the SPA (voice capture + scrolling feed), no build step.
