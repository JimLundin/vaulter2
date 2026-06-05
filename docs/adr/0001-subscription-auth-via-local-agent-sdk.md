# Subscription auth via a local Agent SDK runtime

We drive the model with the owner's **Claude Pro/Max subscription** (via the normal `claude` login + the **Claude Agent SDK**, TypeScript), running in a **local runtime process** — not a metered Anthropic API key, not the Vercel AI SDK, and not from the browser directly. As of 2026-06-15 this usage is paid by the plan's monthly **Agent SDK credit**, which Anthropic's docs explicitly extend to "third-party apps built on the Agent SDK."

## Why not a pure-browser app on the subscription

This was the strongly preferred option and was investigated exhaustively. It is **impossible**, on four independent grounds — any one is fatal:

1. **Browser same-origin model.** A web app on its own origin cannot read or attach claude.ai's `HttpOnly`, origin-scoped session cookies, so it cannot ride a logged-in subscription session. This is browser-level, not policy.
2. **No third-party OAuth client registration.** Claude Code's login uses a fixed first-party `client_id` and an Anthropic-controlled redirect (`console.anthropic.com/oauth/code/callback`). There is no public/dynamic registration letting a third-party web app use its own `client_id` + redirect.
3. **No CORS-enabled, subscription-token API.** The only browser-direct Anthropic endpoint (`anthropic-dangerous-direct-browser-access`) accepts an **API key**, not a subscription OAuth bearer. Subscription tokens only reach claude.ai/Console backends, which send no CORS headers to third-party origins.
4. **ToS ban, server-side enforced.** On 2026-02-19 Anthropic prohibited subscription OAuth tokens in third-party apps/SDKs and (from 2026-01-09) blocks non-first-party clients server-side, with account suspensions.

## Why not an API key (Vercel AI SDK or browser-direct)

An Anthropic API key would work in the browser and with the Vercel AI SDK, but the subscription **cannot pay for it**: the Claude subscription and the Console API are separate billing systems — *"A paid Claude subscription … doesn't include access to the Claude API or Console."* The June-15 plan credit is reachable **only** through the Agent SDK / `claude -p` runtime; *"Claude Platform accounts using an API key don't receive a credit."* Using an API key would mean paying per-token on top of the subscription — contrary to the project's core goal.

## Consequence

The subscription's only programmatic surface is a **local process** (Agent SDK / `claude -p`). That forces the browser-UI + local-runtime architecture (see ADR-0002). The runtime also gets the Agent SDK's file/bash/git tools for free, which the Librarian relies on. Reversing this (e.g. moving to an API key) is a billing-model change, not just a code change.
