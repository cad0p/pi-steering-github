// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the `missingVaultBodyFile` predicate and its arg
 * helpers. The predicate is a pure FORM check (no filesystem
 * walking, no path validation), so these tests are pure command-
 * string tests with hand-built ctx objects; `bodyHasClosingKeyword`
 * execs the pinned perl one-liner through a stubbed exec.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import {
  BODY_STRIP,
  bodyHasClosingKeyword,
  findBodyFileValue,
  findFlagValue,
  missingVaultBodyFile,
  parseBodyFileArg,
  resolveAgainstCwd,
  unquote,
} from "./missing-vault-body-file.ts";

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
 * form (the shape `argText` reads); `exec` defaults to a stub that
 * answers `perl -0777 -pe <BODY_STRIP> <file>` by reading the
 * file and stripping its frontmatter with the SAME pinned program
 * semantics (a JS mirror used only to keep these tests hermetic —
 * the real behavior is pinned by `body-strip.test.ts`, which
 * spawns actual perl).
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

// ---------------------------------------------------------------------------
// bodyHasClosingKeyword
// ---------------------------------------------------------------------------

describe("bodyHasClosingKeyword", () => {
  /** Exec stub that answers the pinned perl call with stripped content. */
  function perlExec(bodyAfterFrontmatter: string): ExecStub {
    return async (cmd, args) => {
      if (cmd === "perl" && args[0] === "-0777" && args[1] === "-pe") {
        assert.equal(args[2], BODY_STRIP, "pinned program must be used");
        return {
          stdout: bodyAfterFrontmatter,
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
  }

  it("is true when the STRIPPED body (perl output) has the keyword", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution("/vault/note.md") }],
      "/work/repo",
      perlExec("Closes #12\n\nBody.\n"),
    );
    assert.equal(await bodyHasClosingKeyword(ctx), true);
  });

  it("is false when the keyword ONLY appears in frontmatter (stripped input is canonical)", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution("/vault/note.md") }],
      "/work/repo",
      perlExec("No keyword here.\n"),
    );
    assert.equal(await bodyHasClosingKeyword(ctx), false);
  });

  it("is false when perl fails (fail-closed)", async () => {
    const failing: ExecStub = async () => ({
      stdout: "",
      stderr: "perl error",
      exitCode: 2,
    });
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution("/vault/note.md") }],
      "/work/repo",
      failing,
    );
    assert.equal(await bodyHasClosingKeyword(ctx), false);
  });

  it("is false for an unparsable --body-file value (fail-closed)", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: "<(cat /vault/note.md)" }],
      "/work/repo",
      perlExec("Closes #12\n"),
    );
    assert.equal(await bodyHasClosingKeyword(ctx), false);
  });

  it("falls back to the inline --body text", async () => {
    const ctx = makeCtx(
      [{ text: "--body" }, { text: "Fixes #7" }],
      "/work/repo",
    );
    assert.equal(await bodyHasClosingKeyword(ctx), true);
  });

  it("is false for a missing body (fail-closed)", async () => {
    const ctx = makeCtx([{ text: "--title" }, { text: "x" }], "/work/repo");
    assert.equal(await bodyHasClosingKeyword(ctx), false);
  });
});

// ---------------------------------------------------------------------------
// missingVaultBodyFile — form matrix
// ---------------------------------------------------------------------------

describe("missingVaultBodyFile", () => {
  it("fires without --body-file (no body file at all)", async () => {
    const ctx = makeCtx(
      [{ text: "pr" }, { text: "create" }, { text: "--title" }, { text: "x" }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("does NOT fire for the pinned perl substitution", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution("/vault/note.md") }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for the glued --body-file=<(…) form (walker-split into two words)", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file=" }, { text: stripSubstitution("/vault/note.md") }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for the short -F <(…) form", async () => {
    const ctx = makeCtx(
      [{ text: "-F" }, { text: stripSubstitution("/vault/note.md") }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire with a quoted path inside the substitution", async () => {
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        {
          text: `<(perl -0777 -pe '${BODY_STRIP}' "/vault/a b/note.md")`,
        },
      ],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire when the path is bogus (form-only — runtime verifies)", async () => {
    // The predicate is a FORM check: a nonexistent path passes the
    // gate by design; perl fails at runtime and the agent corrects.
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("/nonexistent/note.md") },
      ],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("fires for a DIRECT path (verbatim upload — only the substitution is accepted)", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: "/vault/prs/note.md" }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for an unparsable substitution (<(cat …) — not the pinned perl form)", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: "<(cat /vault/note.md)" }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a different perl program (byte-pinned)", async () => {
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        {
          text: "<(perl -0777 -pe 's/^---\\n.*?\\n---\\n//s' /vault/note.md)",
        },
      ],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires when `--body-file=` is the last word (fail-closed)", async () => {
    const ctx = makeCtx([{ text: "--body-file=" }], "/work/repo");
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a bare --body-file with no value (fail-closed)", async () => {
    const ctx = makeCtx([{ text: "--body-file" }], "/work/repo");
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });
});
