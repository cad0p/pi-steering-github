// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the arg helpers (`unquote`, `findFlagValue`,
 * `findBodyFileValue`, `parseBodyFileArg`, `explainBodyFileArg`,
 * `renderBodyFileExplain`, `resolveAgainstCwd`) and their
 * scaffolding.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import { BODY_STRIP } from "./body-strip.ts";
import {
  explainBodyFileArg,
  findBodyFileValue,
  findFlagValue,
  parseBodyFileArg,
  renderBodyFileExplain,
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
// explainBodyFileArg
// ---------------------------------------------------------------------------

describe("explainBodyFileArg", () => {
  it("classifies the pinned substitution as ok with the path", () => {
    assert.deepEqual(
      explainBodyFileArg(
        `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/note.md)`,
      ),
      {
        stage: "ok",
        detail: { kind: "substitution", path: "/vault/prs/note.md" },
      },
    );
  });

  it("incident byte-swap (`*)?` vs `?)*`) → diff stage with the got tokens", () => {
    // The pi#8845 incident: a 2-char swap at byte 129 of 135 that
    // the agent could not see with the static reason.
    const mutatedProgram = `${BODY_STRIP.slice(0, 129)}?)*${BODY_STRIP.slice(132)}`;
    assert.equal(mutatedProgram.length, BODY_STRIP.length);
    assert.deepEqual(
      explainBodyFileArg(
        `<(perl -0777 -pe '${mutatedProgram}' /vault/prs/note.md)`,
      ),
      {
        stage: "diff",
        detail: {
          gotTokens: [
            "perl",
            "-0777",
            "-pe",
            mutatedProgram,
            "/vault/prs/note.md",
          ],
        },
      },
    );
  });

  it("cat substitution (2 tokens) → diff stage", () => {
    assert.deepEqual(explainBodyFileArg("<(cat /vault/prs/note.md)"), {
      stage: "diff",
      detail: { gotTokens: ["cat", "/vault/prs/note.md"] },
    });
  });

  it("missing path (4 tokens) → diff stage", () => {
    assert.deepEqual(explainBodyFileArg(`<(perl -0777 -pe '${BODY_STRIP}')`), {
      stage: "diff",
      detail: { gotTokens: ["perl", "-0777", "-pe", BODY_STRIP] },
    });
  });

  it("extra trailing token (6 tokens) → diff stage", () => {
    assert.deepEqual(
      explainBodyFileArg(
        `<(perl -0777 -pe '${BODY_STRIP}' /vault/prs/note.md extra)`,
      ),
      {
        stage: "diff",
        detail: {
          gotTokens: [
            "perl",
            "-0777",
            "-pe",
            BODY_STRIP,
            "/vault/prs/note.md",
            "extra",
          ],
        },
      },
    );
  });

  it("unclosed <( form → form", () => {
    assert.deepEqual(explainBodyFileArg(`<(perl -0777 -pe '${BODY_STRIP}'`), {
      stage: "form",
    });
  });

  it("plain path → direct stage (wrapper round-trips it)", () => {
    assert.deepEqual(explainBodyFileArg("/vault/prs/note.md"), {
      stage: "direct",
      detail: { kind: "direct", path: "/vault/prs/note.md" },
    });
    // The wrapper must map BOTH ok and direct stages to their
    // parsed result (body-keyword.ts raw-reads direct paths).
    assert.deepEqual(parseBodyFileArg("/vault/prs/note.md"), {
      kind: "direct",
      path: "/vault/prs/note.md",
    });
  });

  it("empty value → missing", () => {
    assert.deepEqual(explainBodyFileArg(""), { stage: "missing" });
  });
});

// ---------------------------------------------------------------------------
// renderBodyFileExplain
// ---------------------------------------------------------------------------

describe("renderBodyFileExplain", () => {
  const staticReason = "STATIC REASON\n";

  it("missing / direct / form / ok stages return the static reason byte-for-byte", () => {
    const staged = [
      { stage: "missing" },
      {
        stage: "direct",
        detail: { kind: "direct", path: "/vault/prs/note.md" },
      },
      { stage: "form" },
      {
        stage: "ok",
        detail: { kind: "substitution", path: "/vault/prs/note.md" },
      },
    ] as const;
    for (const explained of staged) {
      assert.equal(
        renderBodyFileExplain(explained, staticReason),
        staticReason,
      );
    }
  });

  it("diff (cat) → the full-line pair + static", () => {
    assert.equal(
      renderBodyFileExplain(
        {
          stage: "diff",
          detail: { gotTokens: ["cat", "/vault/prs/note.md"] },
        },
        staticReason,
      ),
      "substitution inner command deviates from the pinned strip:\n" +
        `  - expected: perl -0777 -pe '${BODY_STRIP}' <path>\n` +
        "  + got:      cat /vault/prs/note.md\n" +
        "\n" +
        staticReason,
    );
  });

  it("diff (incident) → the byte pair + static", () => {
    const mutatedProgram = `${BODY_STRIP.slice(0, 129)}?)*${BODY_STRIP.slice(132)}`;
    const rendered = renderBodyFileExplain(
      explainBodyFileArg(
        `<(perl -0777 -pe '${mutatedProgram}' /vault/prs/note.md)`,
      ),
      staticReason,
    );
    assert.equal(
      rendered,
      "substitution program diverges from the pinned strip at byte 129:\n" +
        "  - expected: *)?\n" +
        "  + got:      ?)*\n" +
        "\n" +
        staticReason,
    );
  });

  it("diff (exactly-60% span) stays a byte pair (strict >)", () => {
    // Differing span = exactly 0.6 * 135 = 81 chars (prefix 27,
    // suffix 27) — 81 > 81 is false on both sides, so no fallback.
    const gotProgram =
      BODY_STRIP.slice(0, 27) + "x".repeat(81) + BODY_STRIP.slice(108);
    assert.equal(gotProgram.length, BODY_STRIP.length);
    const rendered = renderBodyFileExplain(
      explainBodyFileArg(
        `<(perl -0777 -pe '${gotProgram}' /vault/prs/note.md)`,
      ),
      staticReason,
    );
    assert.equal(
      rendered,
      `substitution program diverges from the pinned strip at byte 27:\n` +
        `  - expected: ${BODY_STRIP.slice(27, 108)}\n` +
        `  + got:      ${"x".repeat(81)}\n` +
        "\n" +
        staticReason,
    );
  });

  it("diff (82/135 span, just over the ratio) → the full-line pair", () => {
    const gotProgram =
      BODY_STRIP.slice(0, 26) + "x".repeat(82) + BODY_STRIP.slice(108);
    assert.equal(gotProgram.length, BODY_STRIP.length);
    const rendered = renderBodyFileExplain(
      explainBodyFileArg(
        `<(perl -0777 -pe '${gotProgram}' /vault/prs/note.md)`,
      ),
      staticReason,
    );
    assert.equal(
      rendered,
      "substitution inner command deviates from the pinned strip:\n" +
        `  - expected: perl -0777 -pe '${BODY_STRIP}' <path>\n` +
        `  + got:      perl -0777 -pe '${gotProgram}' /vault/prs/note.md\n` +
        "\n" +
        staticReason,
    );
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
