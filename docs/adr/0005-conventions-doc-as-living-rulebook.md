# Structure the vault via a living conventions doc, not an emergent free-for-all

Vaulter builds a wiki, but the early design gave it **no written rulebook**: the system prompt described the *spirit* (atomic notes, link densely, MOCs) and the discovery turn re-inferred the vault's actual conventions — naming, layout, frontmatter — from a sampling of existing notes, fresh on every launch. Re-inferring slightly differently each session, with a freeform prior, produced compounding structural drift: the same kind of thing filed under different titles, casings, folders, and frontmatter from one run to the next.

## Decision

Externalize the rulebook **into the vault itself** as `meta/conventions.md` — a living constitution that is the single authoritative source for how *this* vault is named, structured, typed, and linked. Concretely it fixes:

- a **flat namespace** — notes at the vault root; the only folders are `inbox/`, `daily/`, `meta/` (structure comes from links + Maps of Content, not directories);
- **naming** — Title Case, singular, never date-titled; search-before-create against titles and `aliases`;
- a **frontmatter schema** on every note (`type`, `aliases`, `tags`, `created`);
- a **closed note-type taxonomy** (concept / person / project / place / term / moc), each with a fixed section template;
- a **no-orphans** linking invariant and a numeric **MOC-promotion threshold**.

It is seeded on first run. The `DISCOVERY_PRIMER` reads it before sampling the vault; the `SYSTEM_PROMPT` orders Vaulter to obey it and to **append to it** whenever it makes a new structural decision the file doesn't yet cover. The owner can edit it in Obsidian to change the house style.

We also moved the model from `claude-haiku-4-5` to `claude-sonnet-4-6`: following a detailed structural rulebook faithfully is exactly where Haiku trailed, and structural consistency is the goal here. The tradeoff is higher per-capture latency; the model is a one-line change in `src/agent.ts` for anyone who wants speed back.

## Considered and rejected

- **Keep it purely emergent (observe-and-conform only).** This is what drifted. Without a stable, written anchor the conventions are re-derived every launch and can't be edited by the owner.
- **Encode the rulebook only in the system prompt.** Better than nothing, but the conventions then aren't vault-resident (not user-editable, not visible in Obsidian), don't accumulate the agent's own decisions, and changing them means a code change rather than a vault edit. A frozen system prompt is also cache-friendly precisely because it stays small and stable — pushing the specifics into a file the agent reads keeps it that way.
- **Enforce structure with a deterministic post-turn lint** (reject orphans / bad frontmatter in the Runtime). Strongest guarantee, but materially more code and it fights the "intelligence lives in the model" principle. Left as a possible later phase; the conventions doc carries most of the benefit at a fraction of the cost.

## Consequences

- **Self-reinforcing consistency.** The agent conforms to what's already written, and its own new rules are persisted for the next Capture — drift is damped instead of compounded.
- **The conventions file is part of the vault** (committed, pushed, diffable like any note), so changes to the house style are versioned alongside the notes they govern.
- **Two sources of truth to keep aligned** — the invariants summarized in the system prompt and the full spec in `meta/conventions.md`. The prompt deliberately defers to the file ("the conventions file elaborates"), so the file is canonical where they overlap.
- **Higher cost/latency per capture** from the Sonnet move; acceptable for a single-user, fire-and-forget tool, and reversible in one line.
