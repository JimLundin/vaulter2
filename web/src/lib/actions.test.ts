import { describe, it, expect } from "vitest";
import { humanizeActions } from "./actions";
import type { ToolCall } from "./types";

/** Build the tool-call shape humanizeActions consumes. */
const tc = (tool: string, target: string): ToolCall => ({ tool, target });

describe("humanizeActions — file tools", () => {
  it("maps Write/Edit/Read/Glob to their actions and strips folders + .md", () => {
    const actions = humanizeActions([
      tc("Write", "Japan Trip.md"),
      tc("Edit", "notes/Shinkansen.md"),
      tc("Read", "Home.md"),
      tc("Glob", "**/*.md"),
    ]);
    expect(actions).toEqual([
      { kind: "create", verb: "Created", label: "Japan Trip" },
      { kind: "update", verb: "Updated", label: "Shinkansen" },
      { kind: "read", verb: "Read", label: "Home" },
      { kind: "search", verb: "Searched", label: "the vault" },
    ]);
  });

  it("treats MultiEdit as an update", () => {
    expect(humanizeActions([tc("MultiEdit", "A.md")])).toEqual([
      { kind: "update", verb: "Updated", label: "A" },
    ]);
  });
});

describe("humanizeActions — bash subcommands", () => {
  it("mv within a folder is a rename", () => {
    expect(humanizeActions([tc("Bash", "mv Old.md New.md")])).toEqual([
      { kind: "rename", verb: "Renamed", label: "Old → New" },
    ]);
  });

  it("mv across folders is a move, labeled by destination dir", () => {
    expect(humanizeActions([tc("Bash", "mv Note.md archive/Note.md")])).toEqual([
      { kind: "move", verb: "Moved", label: "Note → archive" },
    ]);
  });

  it("honors quotes so note names with spaces survive", () => {
    expect(humanizeActions([tc("Bash", 'mv "Coast Weekend.md" "Coast Trip.md"')])).toEqual([
      { kind: "rename", verb: "Renamed", label: "Coast Weekend → Coast Trip" },
    ]);
  });

  it("rm summarizes extra targets", () => {
    expect(humanizeActions([tc("Bash", "rm A.md B.md C.md")])).toEqual([
      { kind: "delete", verb: "Deleted", label: "A (+2 more)" },
    ]);
  });

  it("cp labels by the destination", () => {
    expect(humanizeActions([tc("Bash", "cp A.md B.md")])).toEqual([
      { kind: "copy", verb: "Copied", label: "B" },
    ]);
  });

  it("drops flags before counting args", () => {
    expect(humanizeActions([tc("Bash", "rm -f A.md")])).toEqual([
      { kind: "delete", verb: "Deleted", label: "A" },
    ]);
  });

  it("surfaces the first meaningful command in a chain", () => {
    expect(humanizeActions([tc("Bash", 'mkdir -p archive && mv "A B.md" archive/')])).toEqual([
      { kind: "move", verb: "Moved", label: "A B → archive" },
    ]);
  });

  it("collapses non-meaningful bash to nothing", () => {
    expect(humanizeActions([tc("Bash", "ls -la"), tc("Bash", "mkdir foo")])).toEqual([]);
  });
});

describe("humanizeActions — dedup & order", () => {
  it("dedupes repeated actions on the same note, keeping first-occurrence order", () => {
    const actions = humanizeActions([
      tc("Edit", "A.md"),
      tc("Read", "B.md"),
      tc("Edit", "A.md"), // duplicate of the first
    ]);
    expect(actions).toEqual([
      { kind: "update", verb: "Updated", label: "A" },
      { kind: "read", verb: "Read", label: "B" },
    ]);
  });

  it("keeps same-label actions of different kinds distinct", () => {
    const actions = humanizeActions([tc("Read", "A.md"), tc("Edit", "A.md")]);
    expect(actions.map((a) => a.kind)).toEqual(["read", "update"]);
  });
});
