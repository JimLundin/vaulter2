import { describe, it, expect } from "vitest";
import { WIKILINK_HREF, wikilinksToMarkdown } from "./wikilink";

describe("wikilinksToMarkdown", () => {
  it("rewrites [[Note]] to a fragment-href markdown link", () => {
    expect(wikilinksToMarkdown("see [[Japan Trip]] now")).toBe(
      "see [Japan Trip](#wikilink:Japan%20Trip) now",
    );
  });

  it("uses the label for [[target|label]] but encodes the target in the href", () => {
    expect(wikilinksToMarkdown("[[Janne|Yana]]")).toBe("[Yana](#wikilink:Janne)");
  });

  it("rewrites every reference on a line", () => {
    expect(wikilinksToMarkdown("[[A]] and [[B]]")).toBe(
      "[A](#wikilink:A) and [B](#wikilink:B)",
    );
  });

  it("leaves text with no references untouched", () => {
    expect(wikilinksToMarkdown("no refs here")).toBe("no refs here");
  });

  // The regression guard: the href MUST be a `#` fragment. Streamdown's
  // rehype-harden appends a literal " [blocked]" to any link whose protocol isn't
  // http(s)/safe, so a custom `wikilink:`/other scheme would reintroduce the bug.
  it("never emits a non-fragment scheme that rehype-harden would block", () => {
    const out = wikilinksToMarkdown("[[Note With Spaces]] and [[Other|Label]]");
    for (const href of [...out.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])) {
      expect(href.startsWith(WIKILINK_HREF)).toBe(true);
      expect(href).not.toMatch(/^[a-z]+:/i); // no `scheme:` prefix
    }
  });
});
