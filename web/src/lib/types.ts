/** One tool call the agent made, normalized to {tool, target} so it can be
 * humanized into a Vault action (see actions.ts). */
export type ToolCall = { tool: string; target: string };
