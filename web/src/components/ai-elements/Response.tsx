import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { Streamdown, defaultUrlTransform, type Components, type UrlTransform } from "streamdown";

/** Obsidian wikilinks (`[[Note]]` or `[[Note|label]]`) aren't markdown, so they'd
 * render as literal brackets. Rewrite them to links with a `wikilink:` scheme,
 * which we then render as a chip (and keep out of the link sanitizer). */
function toMarkdown(text: string): string {
  return text.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
    const [target, label] = inner.split("|");
    return `[${(label ?? target).trim()}](wikilink:${encodeURIComponent(target.trim())})`;
  });
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href?.startsWith("wikilink:")) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 align-baseline text-[0.85em] font-medium text-primary">
        <FileText className="size-3 shrink-0" />
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  );
}

const components = { a: MarkdownLink } as Components;
// Let the `wikilink:` scheme through; defer everything else to the safe default.
const urlTransform: UrlTransform = (...args) =>
  args[0].startsWith("wikilink:") ? args[0] : (defaultUrlTransform as UrlTransform)(...args);

/** Streamed-markdown renderer — the renderer AI Elements' <Response> wraps —
 * extended to render Vaulter's wikilinks as note chips. Tolerates half-finished
 * markdown while tokens are still arriving. */
export function Response({ children }: { children: string }) {
  return (
    <Streamdown
      className="space-y-2 text-sm leading-relaxed"
      components={components}
      urlTransform={urlTransform}
    >
      {toMarkdown(children)}
    </Streamdown>
  );
}
