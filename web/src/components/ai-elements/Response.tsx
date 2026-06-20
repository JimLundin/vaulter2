import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { Streamdown, type Components } from "streamdown";
import { WIKILINK_HREF, wikilinksToMarkdown } from "./wikilink";

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href?.startsWith(WIKILINK_HREF)) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 align-baseline text-[0.85em] font-medium text-primary"
        title={decodeURIComponent(href.slice(WIKILINK_HREF.length))}
      >
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

/** Streamed-markdown renderer — the renderer AI Elements' <Response> wraps —
 * extended to render Vaulter's wikilinks as note chips. Tolerates half-finished
 * markdown while tokens are still arriving. */
export function Response({ children }: { children: string }) {
  return (
    <Streamdown className="space-y-2 text-sm leading-relaxed" components={components}>
      {wikilinksToMarkdown(children)}
    </Streamdown>
  );
}
