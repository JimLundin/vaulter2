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
npm run build                   # bundles the UI (Vite) and compiles the Runtime
node dist/cli.js ~/my-vault     # or: npx vaulter ~/my-vault
```

This boots a local Runtime on `http://localhost:4317` and opens your browser.
Press **Record** and speak. The transcript is produced in the browser and
streamed to Vaulter in chunks on a speech pause (and once more when you
press **Stop**), with short fragments coalesced into the next chunk — so it
starts filing while you're still talking. Each chunk is
queued and handled one at a time: Vaulter reads your vault, conforms to its
structure, files the note, and commits to git. The feed shows what it did.

The vault folder is created and seeded on first run with a tiny skeleton and a
`meta/conventions.md` rulebook (naming, frontmatter, note types, flat layout,
linking) that Vaulter conforms to — edit it to change the house style.

### Remote sync (optional)

If the vault repo has an `origin` remote, Vaulter pushes after every commit, so
the remote mirrors your vault capture-by-capture (git as transactional backup).
The local commit always lands first; if a push fails (offline, etc.) the feed
shows `⚠ not pushed` and the next successful push carries the backlog. Set it up
either way:

```bash
git -C ~/my-vault remote add origin <url>     # existing vault
VAULTER_REMOTE=<url> npx vaulter ~/new-vault   # wire it up on first run
```

The remote must accept non-interactive pushes (SSH key or a cached credential
helper); Vaulter runs `git push` with your normal git credentials.

### Options

- `VAULTER_VAULT` — vault folder to use when no path is given on the command line
- `VAULTER_PORT` — port (default `4317`)
- `VAULTER_NO_OPEN` — set to skip auto-opening the browser
- `VAULTER_REMOTE` — git URL to use as `origin` if the vault has no remote yet

## How it fits together

- **`src/cli.ts`** — entry: resolves the vault, ensures/seeds it, starts the Runtime.
- **`src/runtime.ts`** — local HTTP server: serves the SPA, an SSE feed, and a
  `/capture` endpoint; serializes captures one at a time.
- **`src/agent.ts`** — one Claude Agent SDK `query()` for the whole server, fed
  every chunk as a streaming input so the model keeps the vault in context (the
  vault is discovered once at launch, never re-discovered per chunk or per
  recording). The conform-to-vault system prompt, the model (`claude-sonnet-4-6`),
  and event streaming live here. The prompt points Vaulter at the vault's own
  `meta/conventions.md` rulebook rather than hard-coding the structure.
- **`src/vault.ts`** — first-run seeding (including `meta/conventions.md`, the
  living rulebook Vaulter conforms to) and the one-commit-per-capture git logic.
- **`web/`** — the browser UI (React + Vite + Tailwind): a scrolling log of your
  spoken text and what Vaulter does with it, with a compact recorder (mic + live
  waveform) docked at the bottom. Vite bundles it into `public/`, which the
  Runtime serves as static files.

### Developing the UI

```bash
npm run dev        # Vite (HMR) on :5173 proxying the API to the Runtime on :4317
```

Open `http://localhost:5173` for hot-reloading; `npm run build` regenerates the
bundle the Runtime serves in production.
