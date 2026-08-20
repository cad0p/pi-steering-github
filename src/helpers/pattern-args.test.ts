// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the arg helpers (`unquote`, `findFlagValue`,
 * `findBodyFileValue`, `parseBodyFileArg`, `resolveAgainstCwd`) and
 * their scaffolding.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import { BODY_STRIP } from "../body-strip.ts";
import {
  findBodyFileValue,
  findFlagValue,
  parseBodyFileArg,
  resolveAgainstCwd,
  unquote,
} from "./pattern-args.ts";

// ---------------------------------------------------------------------------
// Test scaffolding: hand-built ctx
// ---------------------------------------------------------------------------

type ExecStub = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Hand-built predicate ctx. `args` are walker words in `{ text }`
 * form (the shape `argText` reads).
 */
function makeCtx(
  args: readonly { text: string }[],
  cwd: string,
  exec?: ExecStub,
): PredicateContext {
  const ctx = {
    cwd,
    tool: "bash",
    input: { tool: "bash", command: "gh pr create", basename: "gh", args },
    agentLoopIndex: 0,
    exec:
      exec ??
      (async (_cmd, _args) => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })),
    appendEntry: () => {},
    findEntries: () => [],
    walkerState: {},
  };
  return ctx as unknown as PredicateContext;
}

/** The pinned substitution form the rules require. */
function stripSubstitution(file: string): string {
  return `<(perl -0777 -pe '${BODY_STRIP}' ${file})`;
}

// ---------------------------------------------------------------------------
// unquote / findFlagValue (unchanged helpers)
// ---------------------------------------------------------------------------

describe("unquote", () => {
  it("strips one level of wrapping quotes", () => {
    assert.equal(unquote('"body.md"'), "body.md");
    assert.equal(unquote("'body.md'"), "body.md");
    assert.equal(unquote("body.md"), "body.md");
  });
});

describe("findFlagValue", () => {
  it("reads the value after the flag (space form)", () => {
    const ctx = makeCtx(
      [
        { text: "pr" },
        { text: "create" },
        { text: "--body-file" },
        { text: "body.md" },
      ],
      "/work/repo",
    );
    assert.equal(findFlagValue(ctx, ["--body-file", "-F"]), "body.md");
  });

  it("reads the value from the --flag=value form", () => {
    const ctx = makeCtx(
      [{ text: "pr" }, { text: "create" }, { text: "--body-file=body.md" }],
      "/work/repo",
    );
    assert.equal(findFlagValue(ctx, ["--body-file", "-F"]), "body.md");
  });

  it("returns null when the flag is absent", () => {
    const ctx = makeCtx(
      [{ text: "pr" }, { text: "create" }, { text: "--title" }, { text: "x" }],
      "/work/repo",
    );
    assert.equal(findFlagValue(ctx, ["--body-file", "-F"]), null);
  });
});

// ---------------------------------------------------------------------------
// findBodyFileValue
// ---------------------------------------------------------------------------

describe("findBodyFileValue", () => {
  it("reads the value after the flag (space form)", () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: "body.md" }],
      "/work/repo",
    );
    assert.equal(findBodyFileValue(ctx), "body.md");
  });

  it("reads the value from the unsplit --flag=value form", () => {
    const ctx = makeCtx([{ text: "--body-file=body.md" }], "/work/repo");
    assert.equal(findBodyFileValue(ctx), "body.md");
  });

  it("handles the walker-split glued form (--body-file= + next word)", () => {
    const ctx = makeCtx(
      [
        { text: "--body-file=" },
        { text: `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/body.md)` },
      ],
      "/work/repo",
    );
    assert.equal(
      findBodyFileValue(ctx),
      `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/body.md)`,
    );
  });

  it("handles the walker-split glued short form (-F= + next word)", () => {
    const ctx = makeCtx(
      [
        { text: "-F=" },
        { text: `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/body.md)` },
      ],
      "/work/repo",
    );
    assert.equal(
      findBodyFileValue(ctx),
      `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/body.md)`,
    );
  });

  it("returns '' for a trailing --body-file= (fail-closed)", () => {
    const ctx = makeCtx([{ text: "--body-file=" }], "/work/repo");
    assert.equal(findBodyFileValue(ctx), "");
  });

  it("returns '' for a trailing --body-file with no value", () => {
    const ctx = makeCtx([{ text: "--body-file" }], "/work/repo");
    assert.equal(findBodyFileValue(ctx), "");
  });

  it("supports the short -F form", () => {
    const ctx = makeCtx([{ text: "-F" }, { text: "body.md" }], "/work/repo");
    assert.equal(findBodyFileValue(ctx), "body.md");
  });

  it("returns '' when the flag is absent", () => {
    const ctx = makeCtx([{ text: "--title" }, { text: "x" }], "/work/repo");
    assert.equal(findBodyFileValue(ctx), "");
  });
});

// ---------------------------------------------------------------------------
// parseBodyFileArg
// ---------------------------------------------------------------------------

describe("parseBodyFileArg", () => {
  it("parses the pinned perl substitution", () => {
    assert.deepEqual(
      parseBodyFileArg(`<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/note.md)`),
      { kind: "substitution", path: "/vault/prs/note.md" },
    );
  });

  it("parses a double-quoted program (quote-agnostic pin)", () => {
    assert.deepEqual(
      parseBodyFileArg(`<(perl -0777 -pe "${BODY_STRIP}" /vault/prs/note.md)`),
      { kind: "substitution", path: "/vault/prs/note.md" },
    );
  });

  it("parses a quoted path with spaces inside the substitution", () => {
    assert.deepEqual(
      parseBodyFileArg(
        `<(perl -0777 -pe '${BODY_STRIP}' "/vault/a b/note.md")`,
      ),
      { kind: "substitution", path: "/vault/a b/note.md" },
    );
  });

  it("rejects a DIFFERENT program (byte-pinned)", () => {
    assert.equal(
      parseBodyFileArg(
        "<(perl -0777 -pe 's/^---\\n.*?\\n---\\n//s' /vault/prs/note.md)",
      ),
      null,
    );
  });

  it("rejects a different tool (sed)", () => {
    assert.equal(
      parseBodyFileArg("<(sed -e '1,/^---$/d' /vault/prs/note.md)"),
      null,
    );
  });

  it("rejects missing perl flags", () => {
    assert.equal(
      parseBodyFileArg(`<(perl -pe '${BODY_STRIP}' /vault/prs/note.md)`),
      null,
    );
  });

  it("rejects extra tokens after the path", () => {
    assert.equal(
      parseBodyFileArg(
        `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/note.md extra)`,
      ),
      null,
    );
  });

  it("rejects a missing path", () => {
    assert.equal(parseBodyFileArg(`<(perl -0777 -pe '${BODY_STRIP}')`), null);
  });

  it("rejects an unclosed substitution", () => {
    assert.equal(
      parseBodyFileArg(`<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/note.md`),
      null,
    );
  });

  it("classifies a plain path as direct", () => {
    assert.deepEqual(parseBodyFileArg("/vault/prs/note.md"), {
      kind: "direct",
      path: "/vault/prs/note.md",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAgainstCwd
// ---------------------------------------------------------------------------

describe("resolveAgainstCwd", () => {
  it("resolves a relative path against the cwd", () => {
    const ctx = makeCtx([], "/work/repo");
    assert.equal(
      resolveAgainstCwd(ctx, "notes/body.md"),
      "/work/repo/notes/body.md",
    );
  });

  it("passes absolute paths through unchanged", () => {
    const ctx = makeCtx([], "/work/repo");
    assert.equal(
      resolveAgainstCwd(ctx, "/vault/prs/body.md"),
      "/vault/prs/body.md",
    );
  });

  it("returns null for a walker-unknown cwd (fail-closed)", () => {
    const ctx = makeCtx([], "unknown");
    assert.equal(resolveAgainstCwd(ctx, "notes/body.md"), null);
  });
});
