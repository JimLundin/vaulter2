# Reprocess failed captures by re-queue, not a concurrent agent

A Capture's transcript lives only in memory and is streamed straight to the agent. If the filing turn fails (`onTurnError`/`onFatal`) the transcript was simply dropped — no commit, no retry. Because voice input is unrepeatable, dropping it is the worst failure the app can have, and it was asymmetric with the lengths the design goes to to make *edits* durable (git, push, transactional sync).

## Decision

On a failed turn, persist the raw transcript to an **ephemeral, git-ignored sidecar** (`.vaulter/pending/<timestamp>.txt`, outside the Vault's note space) and **re-queue it through the same single serialized session** that handles live captures. Each pending item carries an attempt counter; after **2 failed retries** it is written into `inbox/` as a real Note (`inbox/unfiled-<timestamp>.md`), committed, pushed, and removed from the sidecar. On launch, after the discovery turn, any sidecar files left by a crashed run are loaded back into the queue.

## Considered and rejected: a concurrent secondary agent

The first instinct was a second agent that files failed notes in the background *while the main agent keeps ingesting*, resolving any conflicts the two produce. Rejected: it directly violates the binding invariant that **concurrent runs over the Vault/git are disallowed** (the whole serialization design exists so a git commit never races an agent's edits). Two writers over the same files and git index produce partial commits and corrupt diffs, and "have an agent resolve the conflict afterwards" is a far harder, less reliable problem than not creating the conflict. It also contradicts the project's basic-agent scope. Re-queuing into the existing lane delivers the same goal — input is never lost and is eventually filed — with none of that cost.

## Consequences

- **No priority lane.** Re-queued items share one FIFO with live captures (deliberately not prioritized — for a single user it isn't worth the complexity). A retried chunk can therefore be filed **out of order** relative to later live chunks; for rare failures this is acceptable — the agent files it into whatever the notes look like by then.
- **The sidecar is local-only** (git-ignored, not pushed). The off-machine-durability gap that creates is narrow and closes exactly where it would matter: the terminal `inbox/` fallback is a committed, pushed Note.
- **Bounded retries** prevent a poisoned capture from tight-looping the queue and starving live captures. Context-overflow failures retry against the fresh session that `onFatal` lazily reopens, rather than the exhausted context that failed.
