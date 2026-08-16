// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the `missingVaultBodyFile` predicate and its arg
 * helpers. The predicate is a FORM check PLUS a vault-path
 * validation (restored in #12): it walks the REAL filesystem
 * (napkin-vault detection via `.napkin/` / `.obsidian/.napkin/`
 * markers, repo-name via the exec stub), so the substitution-form
 * tests use real fixture dirs (mkdtemp) like the integration suite;
 * `bodyHasClosingKeyword` execs the pinned perl one-liner through a
 * stubbed exec.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
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

// ---------------------------------------------------------------------------
// Real vault fixtures (the restored validation walks the filesystem)
// ---------------------------------------------------------------------------

const fixtures: string[] = [];

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "github-plugin-pred-test-"));
  fixtures.push(dir);
  return dir;
}

function makeVaultDir(): string {
  const dir = makeFixtureDir();
  mkdirSync(join(dir, ".napkin"));
  return dir;
}

/**
 * A napkin-vault fixture laid out like the real Goldmine convention:
 * `<vault>/open-source/github/<repo>/prs|issues/<date>-pr|issue<N>-<slug>.md`.
 */
interface VaultRepoFixture {
  vault: string;
  repo: string;
  prBodyFile: string;
  issueBodyFile: string;
}

function makeVaultRepoFixture(repo: string): VaultRepoFixture {
  const vault = makeVaultDir();
  const prsDir = join(vault, "open-source", "github", repo, "prs");
  const issuesDir = join(vault, "open-source", "github", repo, "issues");
  mkdirSync(prsDir, { recursive: true });
  mkdirSync(issuesDir, { recursive: true });
  const prBodyFile = join(prsDir, `2026-08-14-pr1-${repo}-test.md`);
  writeFileSync(prBodyFile, "Closes #12\n\n## What\n\nBody text.\n");
  const issueBodyFile = join(issuesDir, `2026-08-14-issue1-${repo}-test.md`);
  writeFileSync(issueBodyFile, "## What\n\nIssue body text.\n");
  return { vault, repo, prBodyFile, issueBodyFile };
}

/** Exec stub answering `git config --get remote.origin.url`. */
function gitRemoteExec(remoteUrl: string): ExecStub {
  return async (cmd, args) => {
    if (
      cmd === "git" &&
      args[0] === "config" &&
      args[1] === "--get" &&
      args[2] === "remote.origin.url"
    ) {
      return { stdout: remoteUrl, stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 1 };
  };
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

  it("does NOT fire for the pinned perl substitution (valid vault prs/ file)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution(`"${fx.prBodyFile}"`) },
      ],
      fx.vault,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for the glued --body-file=<(…) form (walker-split into two words)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [
        { text: "--body-file=" },
        { text: stripSubstitution(`"${fx.prBodyFile}"`) },
      ],
      fx.vault,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for the short -F <(…) form", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "-F" }, { text: stripSubstitution(`"${fx.prBodyFile}"`) }],
      fx.vault,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire with a quoted path inside the substitution", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const spacedFile = join(dirname(fx.prBodyFile), "2026-08-14-pr2-a b.md");
    writeFileSync(spacedFile, "Closes #12\n");
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: `<(perl -0777 -pe '${BODY_STRIP}' "${spacedFile}")` },
      ],
      fx.vault,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("fires when the path is bogus (nonexistent — fail-closed)", async () => {
    // Form OK but the path must resolve to a real file inside a
    // napkin vault under <repo>/<section>/ (restored validation,
    // #12 — the strip work briefly allowed bogus paths).
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("/nonexistent/note.md") },
      ],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
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
