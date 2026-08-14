// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the `missingVaultBodyFile` predicate and its arg
 * helpers. The predicate walks the REAL filesystem (napkin-vault
 * detection via `.napkin/` / `.obsidian/.napkin/` markers, body-file
 * reads, repo-name via the exec stub), so these tests use real
 * fixture dirs (mkdtemp) like the integration suite; ctx objects are
 * hand-built with exec stubs.
 *
 * The ONLY accepted `--body-file` form is the strip-helper process
 * substitution `<(pi-steering-github strip <vault-file>)`; the walker
 * keeps its full inner text as one arg word (inner quotes included),
 * so ctx words are built with that exact shape.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import {
  bodyHasClosingKeyword,
  findBodyFileValue,
  findFlagValue,
  missingVaultBodyFile,
  parseBodyFileArg,
  repoName,
  resolveAgainstCwd,
} from "./missing-vault-body-file.ts";

// ---------------------------------------------------------------------------
// Test scaffolding: fixture dirs + hand-built ctx
// ---------------------------------------------------------------------------

type ExecStub = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const fixtures: string[] = [];

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "github-plugin-test-"));
  fixtures.push(dir);
  return dir;
}

function makeVaultDir(): string {
  const dir = makeFixtureDir();
  mkdirSync(join(dir, ".napkin"));
  return dir;
}

/** `.obsidian/.napkin/` nested marker layout (vault-at-repo-root style). */
function makeNestedVaultDir(): string {
  const dir = makeFixtureDir();
  mkdirSync(join(dir, ".obsidian", ".napkin"), { recursive: true });
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

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Hand-built predicate ctx. `args` are walker words in `{ text }`
 * form (the shape `argText` reads); `exec` defaults to a stub that
 * answers `git config --get remote.origin.url` with the given
 * `remoteUrl` when provided.
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
    exec: exec ?? (async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    appendEntry: () => {},
    findEntries: () => [],
    walkerState: {},
  };
  return ctx as unknown as PredicateContext;
}

function originExec(remoteUrl: string): ExecStub {
  return async (cmd, args) => {
    if (
      cmd === "git" &&
      args[0] === "config" &&
      args[1] === "--get" &&
      args[2] === "remote.origin.url"
    ) {
      return { stdout: remoteUrl, stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

/**
 * The walker word for `--body-file <(pi-steering-github strip
 * <file>)` — full inner text preserved, path quoted (as the walker
 * keeps it).
 */
function stripSubstitution(file: string): string {
  return `<(pi-steering-github strip "${file}")`;
}

// ---------------------------------------------------------------------------
// findFlagValue
// ---------------------------------------------------------------------------

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

  it("unquotes a double-quoted value", () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: '"body.md"' }],
      "/work/repo",
    );
    assert.equal(findFlagValue(ctx, ["--body-file", "-F"]), "body.md");
  });

  it("unquotes a single-quoted value", () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: "'body.md'" }],
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
        { text: "<(pi-steering-github strip /vault/prs/body.md)" },
      ],
      "/work/repo",
    );
    assert.equal(
      findBodyFileValue(ctx),
      "<(pi-steering-github strip /vault/prs/body.md)",
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
  it("parses the strip-helper substitution", () => {
    assert.deepEqual(
      parseBodyFileArg('<(pi-steering-github strip "/vault/prs/note.md")'),
      { kind: "substitution", vaultPath: "/vault/prs/note.md" },
    );
  });

  it("parses a single-quoted path inside the substitution", () => {
    assert.deepEqual(
      parseBodyFileArg("<(pi-steering-github strip '/vault/prs/note.md')"),
      { kind: "substitution", vaultPath: "/vault/prs/note.md" },
    );
  });

  it("rejects a cat substitution (not the strip helper)", () => {
    assert.equal(parseBodyFileArg("<(cat /vault/prs/note.md)"), null);
  });

  it("rejects a bare strip substitution (GNU binutils collision)", () => {
    assert.equal(parseBodyFileArg("<(strip /vault/prs/note.md)"), null);
  });

  it("rejects a pi-steering-github edit substitution (wrong inner command)", () => {
    assert.equal(
      parseBodyFileArg("<(pi-steering-github edit /vault/prs/note.md)"),
      null,
    );
  });

  it("rejects an unterminated substitution word", () => {
    assert.equal(
      parseBodyFileArg("<(pi-steering-github strip /vault/prs/note.md"),
      null,
    );
  });

  it("classifies any other path word as direct", () => {
    assert.deepEqual(parseBodyFileArg("/vault/prs/note.md"), {
      kind: "direct",
      path: "/vault/prs/note.md",
    });
  });

  it("returns null for an empty word", () => {
    assert.equal(parseBodyFileArg(""), null);
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
  it("reads the STRIPPED --body-file content for the keyword (substitution form)", () => {
    const vault = makeVaultDir();
    const bodyFile = join(vault, "body.md");
    writeFileSync(bodyFile, "---\ncloses: #12\n---\n# Title\n\nCloses #12\n");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(bodyFile) }],
      vault,
    );
    assert.equal(bodyHasClosingKeyword(ctx), true);
  });

  it("is false when the keyword ONLY appears in frontmatter (stripped input is canonical)", () => {
    const vault = makeVaultDir();
    const bodyFile = join(vault, "body.md");
    writeFileSync(
      bodyFile,
      "---\ncloses: #12\n---\n# Title\n\nNo keyword here.\n",
    );
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(bodyFile) }],
      vault,
    );
    assert.equal(bodyHasClosingKeyword(ctx), false);
  });

  it("reads a direct --body-file path (fallback kept, also stripped)", () => {
    const vault = makeVaultDir();
    const bodyFile = join(vault, "body.md");
    writeFileSync(bodyFile, "---\n---\nCloses #12\n");
    const ctx = makeCtx([{ text: "--body-file" }, { text: bodyFile }], vault);
    assert.equal(bodyHasClosingKeyword(ctx), true);
  });

  it("falls back to the inline --body text", () => {
    const ctx = makeCtx(
      [{ text: "--body" }, { text: "Fixes #7" }],
      "/work/repo",
    );
    assert.equal(bodyHasClosingKeyword(ctx), true);
  });

  it("is false for an unreadable/missing body file (fail-closed)", () => {
    const vault = makeVaultDir();
    const missing = join(vault, "missing.md");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(missing) }],
      vault,
    );
    assert.equal(bodyHasClosingKeyword(ctx), false);
  });
});

// ---------------------------------------------------------------------------
// repoName
// ---------------------------------------------------------------------------

describe("repoName", () => {
  it("returns the origin URL basename", async () => {
    const ctx = makeCtx(
      [],
      "/work/repo",
      originExec("https://github.com/cad0p/Goldmine.git"),
    );
    assert.equal(await repoName(ctx, ctx.cwd), "Goldmine");
  });

  it("strips the .git suffix", async () => {
    const ctx = makeCtx(
      [],
      "/work/repo",
      originExec("git@github.com:cad0p/pi-steering.git"),
    );
    assert.equal(await repoName(ctx, ctx.cwd), "pi-steering");
  });

  it("falls back to the cwd basename when exec fails", async () => {
    const ctx = makeCtx([], "/work/fallback-repo", async () => {
      throw new Error("not a git repo");
    });
    assert.equal(await repoName(ctx, ctx.cwd), "fallback-repo");
  });
});

// ---------------------------------------------------------------------------
// missingVaultBodyFile — predicate matrix
// ---------------------------------------------------------------------------

describe("missingVaultBodyFile", () => {
  it("fires without --body-file (no body file at all)", async () => {
    const ctx = makeCtx(
      [{ text: "pr" }, { text: "create" }, { text: "--title" }, { text: "x" }],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a substitution wrapping a nonexistent path", async () => {
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("/nonexistent/body.md") },
      ],
      "/work/repo",
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a DIRECT vault path (only the strip-helper substitution is accepted)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: fx.prBodyFile }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for an unparsable substitution (<(cat …) — not the strip helper)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: `<(cat ${fx.prBodyFile})` }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a bare strip substitution (<(strip …) — GNU binutils collision)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: `<(strip ${fx.prBodyFile})` }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a pi-steering-github edit substitution (wrong inner command)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: `<(pi-steering-github edit ${fx.prBodyFile})` },
      ],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires when `--body-file=` is the last word (fail-closed)", async () => {
    const ctx = makeCtx([{ text: "--body-file=" }], "/work/repo");
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires for a substitution wrapping a file outside any napkin vault", async () => {
    const outside = makeFixtureDir();
    const bodyFile = join(outside, "body.md");
    writeFileSync(bodyFile, "Closes #12\n");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(bodyFile) }],
      outside,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("fires when the substitution path lacks the requested section (prs file for issues)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(fx.prBodyFile) }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "issues" }, ctx), true);
  });

  it("fires when the substitution vault repo doesn't match the origin remote", async () => {
    const fx = makeVaultRepoFixture("other-repo");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(fx.prBodyFile) }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
  });

  it("does NOT fire for a correct substitution path + matching remote", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(fx.prBodyFile) }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire with a quoted path inside the substitution", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const spaced = join(dirname(fx.prBodyFile), "2026-08-14-pr9 spaced.md");
    writeFileSync(spaced, "Closes #12\n");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(spaced) }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for the glued --body-file=<(…) form (walker-split into two words)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "--body-file=" }, { text: stripSubstitution(fx.prBodyFile) }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for the short -F <(…) form", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [{ text: "-F" }, { text: stripSubstitution(fx.prBodyFile) }],
      fx.vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });

  it("does NOT fire for a body file in a nested-layout vault (.obsidian/.napkin/)", async () => {
    const vault = makeNestedVaultDir();
    const prsDir = join(vault, "open-source", "github", "fixture-repo", "prs");
    mkdirSync(prsDir, { recursive: true });
    const bodyFile = join(prsDir, "2026-08-14-pr1-nested.md");
    writeFileSync(bodyFile, "Closes #12\n");
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(bodyFile) }],
      vault,
      originExec("https://github.com/cad0p/fixture-repo.git"),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), false);
  });
});
