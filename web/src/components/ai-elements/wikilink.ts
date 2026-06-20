/** Carrier href for an Obsidian note reference rendered as an inline chip. It is a
 * `#` fragment, NOT a custom `wikilink:` scheme, on purpose: Streamdown ships
 * rehype-harden, which appends a literal " [blocked]" to any link whose protocol
 * isn't http(s)/safe but lets fragment-only (`#…`) URLs through untouched. The chip
 * renders as a <span>, so this href never navigates — it just carries the target
 * past the sanitizer and marks the link as a note reference. See Response.tsx. */
export const WIKILINK_HREF = "#wikilink:";

/** Rewrite Obsidian wikilinks (`[[Note]]` / `[[Note|label]]`) into markdown links
 * whose href is a `#wikilink:<target>` fragment. `[[a|b]]` links target `a` but
 * shows label `b`; a bare `[[a]]` shows and targets `a`. */
export function wikilinksToMarkdown(text: string): string {
  return text.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
    const [target, label] = inner.split("|");
    return `[${(label ?? target).trim()}](${WIKILINK_HREF}${encodeURIComponent(target.trim())})`;
  });
}
