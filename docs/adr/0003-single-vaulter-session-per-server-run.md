# Single Vaulter session per server run

The Runtime opens **one** Claude Agent SDK `query()` for the entire server run — shared by every recording and every chunk — rather than one session per recording. A read-only discovery turn is run once at launch so the Vault's structure is learned a single time; no later chunk ever pays the re-discovery cost. The Runtime only reopens the session on a fatal error.

## Why

Discovery (listing the tree, reading Home/index and a sampling of notes) is the expensive part of filing a Capture. With voice, captures arrive as a stream of short chunks on a speech pause, so re-discovering per chunk — or even per recording — would dominate latency and defeat the goal of filing in near-real-time while the speaker is still talking. A persistent session also lets a later chunk extend the notes an earlier one just created, which is the common case within a train of thought.

## Considered and rejected: session per recording

Starting a fresh `query()` each time the user presses Record would bound context growth and hard-isolate topics between recordings. We rejected it because it pays full re-discovery on every Record press — the dominant cost — to solve problems we don't have in practice (see Consequences). Cross-recording topic bleed is instead handled cheaply: when a new recording starts, its first chunk is prefixed with a one-line hint so Vaulter judges from content whether it continues earlier notes or starts something new.

## Consequences

- The session's context grows monotonically across a run (no compaction or reset in code). This is acceptable because **the Runtime is hosted locally and a server run is treated as a working session** — started, used, and stopped — not a long-lived daemon. Unbounded growth is therefore not a real-world failure mode; restart the process to start fresh.
- If a turn ever does exhaust the context mid-run it surfaces as an error and the *next* capture lazily reopens a cold session (paying discovery again). The lazy reopen is deliberate so a persistently failing warm-up can't spin-loop spawning processes — but it is currently silent in the feed and should be made visible.
