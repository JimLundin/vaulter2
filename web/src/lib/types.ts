/** One tool call the agent made, normalized so it can be humanized into a Vault
 * action (see actions.ts). `target` drives the label; the optional edit fields
 * (carried straight from the tool input) drive the expandable diff. */
export type ToolCall = {
  tool: string;
  target: string;
  /** Edit/MultiEdit: the text being replaced. */
  oldString?: string;
  /** Edit/MultiEdit: the replacement text. */
  newString?: string;
  /** Write: the full new file body (rendered as an all-additions diff). */
  content?: string;
};
