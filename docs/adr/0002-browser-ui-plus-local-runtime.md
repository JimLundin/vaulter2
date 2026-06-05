# Browser UI plus a local runtime

The app is a **browser UI** (voice capture via the Web Speech API + a results feed) served by and talking to a **small local Node process** (one `npx vaulter <vault>` command). The local process holds the Claude credentials, runs the Agent SDK against the Vault folder, owns the git history, and serves the static UI on `localhost`. The browser tab alone is **not** the whole app.

## Why a local process at all, for a "browser app"

Two requirements each independently rule out a pure-browser (no-process) design:

- **Subscription auth** lives in on-disk OAuth credentials and is only spendable through the Agent SDK / `claude -p` runtime (see ADR-0001). A sandboxed browser tab cannot reach it.
- **Real Markdown files** (so Obsidian opens the Vault live, and so git can be the undo system) require filesystem access the browser sandbox does not grant on its own origin.

A pure-browser variant was seriously considered (File System Access API for files + a user-pasted API key for the model). It was rejected because it would drop the subscription, drop the Agent SDK's built-in tools, expose a key in the page, and — via the File System Access API — be Chromium-only.

## Consequence

The user runs one local command (or an autostart/login-item); the cost is "launch a process," close to double-clicking a shortcut. In exchange the UI stays cross-browser, the Vault is real files, undo is git, and the model is the subscription. Anyone tempted to "simplify" this into a single browser tab should read ADR-0001 first — the constraints that put the process there are external and enforced, not incidental.
