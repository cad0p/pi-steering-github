// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for `bodyHasClosingKeyword`. It execs the pinned perl
 * one-liner through a stubbed exec.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import { bodyHasClosingKeyword } from "./body-keyword.ts";
import { BODY_STRIP } from "./body-strip.ts";

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
 * spawns actual perl). `env` seeds the walker's tracked env at the
 * command ref (tilde expansion reads it first, falling back to
 * `process.env` when absent).
 */
function makeCtx(
  args: readonly { text: string }[],
  cwd: string,
  exec?: ExecStub,
  env?: ReadonlyMap<string, string>,
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
    walkerState: env !== undefined ? { cwd, env } : {},
  };
  return ctx as unknown as PredicateContext;
}

/** The pinned substitution form the rules require. */
function stripSubstitution(file: string): string {
  return `<(perl -0777 -pe '${BODY_STRIP}' ${file})`;
}

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

  it("hands perl the expanded path for a bare ~/… file", async () => {
    // `ctx.exec` bypasses the shell, so the helper replicates the
    // shell handoff: the pinned perl receives what bash would hand
    // it. The stub asserts the file arg is the expanded path.
    const seen: string[] = [];
    const exec: ExecStub = async (cmd, args) => {
      if (cmd === "perl") seen.push(args[3] ?? "");
      return { stdout: "Closes #12\n", stderr: "", exitCode: 0 };
    };
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("~/Goldmine/note.md") },
      ],
      "/work/repo",
      exec,
      new Map([["HOME", "/home/u"]]),
    );
    assert.equal(await bodyHasClosingKeyword(ctx), true);
    assert.deepEqual(seen, ["/home/u/Goldmine/note.md"]);
  });

  it('hands perl the literal path for a quoted "~/…" file', async () => {
    // Bash-exact: the quoted tilde stays literal — perl receives
    // `~/…` verbatim (and would fail to open it, fail-closed).
    const seen: string[] = [];
    const exec: ExecStub = async (cmd, args) => {
      if (cmd === "perl") seen.push(args[3] ?? "");
      return { stdout: "Closes #12\n", stderr: "", exitCode: 0 };
    };
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution('"~/Goldmine/note.md"') },
      ],
      "/work/repo",
      exec,
      new Map([["HOME", "/home/u"]]),
    );
    assert.equal(await bodyHasClosingKeyword(ctx), true);
    assert.deepEqual(seen, ["~/Goldmine/note.md"]);
  });

  it("is false for ~/… when HOME is unknown (fail-closed)", async () => {
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("~/Goldmine/note.md") },
      ],
      "/work/repo",
      perlExec("Closes #12\n"),
      new Map(),
    );
    assert.equal(await bodyHasClosingKeyword(ctx), false);
  });
});
