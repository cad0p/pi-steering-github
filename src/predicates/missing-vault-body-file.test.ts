// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the `missingVaultBodyFile` predicate. The predicate
 * is a FORM check PLUS a vault-path validation (restored in #12): it
 * walks the REAL filesystem (napkin-vault detection via `.napkin/` /
 * `.obsidian/.napkin/` markers, repo-name via the exec stub), so the
 * substitution-form tests use real fixture dirs (mkdtemp) like the
 * integration suite.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import { BODY_STRIP } from "../helpers/pattern-args.ts";
import { diagnose, missingVaultBodyFile } from "./missing-vault-body-file.ts";

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
 * form (the shape `argText` reads). `env` seeds the walker's
 * tracked env at the command ref (tilde expansion reads it first,
 * falling back to `process.env` when absent).
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

/**
 * A vault fixture rooted at `root` (for tilde pins the root stands
 * in as HOME via the tracked env — the vault resolves through the
 * expanded `~/…` path exactly like the real Goldmine layout).
 */
function makeVaultRepoFixtureAt(root: string, repo: string): VaultRepoFixture {
  const vault = join(root, "Goldmine");
  const prsDir = join(vault, "open-source", "github", repo, "prs");
  const issuesDir = join(vault, "open-source", "github", repo, "issues");
  mkdirSync(prsDir, { recursive: true });
  mkdirSync(issuesDir, { recursive: true });
  mkdirSync(join(vault, ".napkin"), { recursive: true });
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

  it("does NOT fire for a bare ~/… vault path (tracked HOME expands it)", async () => {
    // The shell would expand the leading `~` before perl ever sees
    // the word — blocking it was the over-block: the typed command
    // works, so the rule allows it.
    const home = makeFixtureDir();
    const fx = makeVaultRepoFixtureAt(home, "fixture-repo");
    const tildePath = `~${fx.issueBodyFile.slice(home.length)}`;
    assert.ok(tildePath.startsWith("~/"), tildePath);
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(tildePath) }],
      "/work/fixture-repo",
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
      new Map([["HOME", home]]),
    );
    assert.equal(await missingVaultBodyFile({ section: "issues" }, ctx), false);
    const d = await diagnose(ctx, "issues");
    assert.equal(d.abs, fx.issueBodyFile);
    assert.equal(d.exists, true);
    assert.equal(d.blocked, false);
  });

  it('fires for a quoted "~/…" vault path (quotes suppress expansion)', async () => {
    // Bash-exact: the quoted tilde stays literal, joins onto the
    // cwd, and fails exists — fail-closed with the literal path in
    // the trace.
    const home = makeFixtureDir();
    const fx = makeVaultRepoFixtureAt(home, "fixture-repo");
    const tildePath = `~${fx.issueBodyFile.slice(home.length)}`;
    const cwd = makeFixtureDir();
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: stripSubstitution(`"${tildePath}"`) }],
      cwd,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
      new Map([["HOME", home]]),
    );
    assert.equal(await missingVaultBodyFile({ section: "issues" }, ctx), true);
    const d = await diagnose(ctx, "issues");
    assert.equal(d.path, tildePath);
    assert.ok(d.abs?.endsWith(tildePath), d.abs ?? "null abs");
    assert.equal(d.exists, false);
    assert.equal(d.blocked, true);
  });

  it('fires for a tilde-quote-split path (~"/…" stays literal)', async () => {
    // The slash is quoted, so the shell leaves the word alone: the
    // literal `~/…` joins onto the cwd and fails exists.
    const home = makeFixtureDir();
    const fx = makeVaultRepoFixtureAt(home, "fixture-repo");
    const tildePath = `~${fx.issueBodyFile.slice(home.length)}`;
    const cwd = makeFixtureDir();
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution(`~"${tildePath.slice(1)}"`) },
      ],
      cwd,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
      new Map([["HOME", home]]),
    );
    assert.equal(await missingVaultBodyFile({ section: "issues" }, ctx), true);
    const d = await diagnose(ctx, "issues");
    assert.equal(d.path, tildePath);
    assert.ok(d.abs?.endsWith(tildePath), d.abs ?? "null abs");
    assert.equal(d.exists, false);
    assert.equal(d.blocked, true);
  });

  it('fires for an empty-quotes-prefixed path (""~/… stays literal)', async () => {
    // The word opens with quotes, so the leading `~` is quoted: no
    // expansion, the literal path joins onto the cwd.
    const home = makeFixtureDir();
    const fx = makeVaultRepoFixtureAt(home, "fixture-repo");
    const tildePath = `~${fx.issueBodyFile.slice(home.length)}`;
    const cwd = makeFixtureDir();
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution(`""${tildePath}`) },
      ],
      cwd,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
      new Map([["HOME", home]]),
    );
    assert.equal(await missingVaultBodyFile({ section: "issues" }, ctx), true);
    const d = await diagnose(ctx, "issues");
    assert.equal(d.path, tildePath);
    assert.ok(d.abs?.endsWith(tildePath), d.abs ?? "null abs");
    assert.equal(d.exists, false);
    assert.equal(d.blocked, true);
  });

  it("fires for a `<`-plus-tilde typo (the mirror indicts the `<`)", async () => {
    // `<` is not a tilde — no expansion applies; the opaque token
    // joins onto the cwd and fails exists, with the `<` mirrored.
    const cwd = makeFixtureDir();
    const typoPath = "<~/Goldmine/personal/github/pcad.it-infra/issues/note.md";
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        {
          text: `<(perl -0777 -pe '${BODY_STRIP}' ${typoPath})`,
        },
      ],
      cwd,
    );
    assert.equal(await missingVaultBodyFile({ section: "issues" }, ctx), true);
    const d = await diagnose(ctx, "issues");
    assert.equal(d.path, typoPath);
    assert.equal(d.exists, false);
    assert.equal(d.blocked, true);
  });

  it("fires for ~/… when HOME is unknown (fail-closed, explicit trace)", async () => {
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("~/Goldmine/note.md") },
      ],
      "/work/repo",
      undefined,
      new Map(),
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
    const d = await diagnose(ctx, "prs");
    assert.equal(d.path, "~/Goldmine/note.md");
    assert.equal(d.cwd, "/work/repo");
    assert.equal(d.abs, null);
    assert.equal(d.blocked, true);
  });

  it("fires for ~user/… (passes through, resolves literally — unchanged)", async () => {
    // Documented upstream limit: no new behavior — the token joins
    // onto the cwd and fails exists.
    const cwd = makeFixtureDir();
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution("~other/Goldmine/note.md") },
      ],
      cwd,
    );
    assert.equal(await missingVaultBodyFile({ section: "prs" }, ctx), true);
    const d = await diagnose(ctx, "prs");
    assert.equal(d.abs, join(cwd, "~other/Goldmine/note.md"));
    assert.equal(d.exists, false);
    assert.equal(d.blocked, true);
  });
});

// ---------------------------------------------------------------------------
// diagnose — the shared struct (verdict + message source, #50)
// ---------------------------------------------------------------------------

describe("diagnose", () => {
  it("predicate verdict IS diagnose().blocked (no-drift pin)", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const cmds: { text: string }[][] = [
      [{ text: "--title" }, { text: "x" }],
      [{ text: "--body-file" }, { text: "/vault/prs/note.md" }],
      [{ text: "--body-file" }, { text: "<(cat /vault/note.md)" }],
      [
        { text: "--body-file" },
        { text: stripSubstitution(`"${fx.prBodyFile}"`) },
      ],
    ];
    for (const args of cmds) {
      for (const section of ["prs", "issues"] as const) {
        const ctx = makeCtx(
          args,
          fx.vault,
          gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
        );
        assert.equal(
          await missingVaultBodyFile({ section }, ctx),
          (await diagnose(ctx, section)).blocked,
        );
      }
    }
  });

  it("missing stage: empty received, everything else null, blocked", async () => {
    const ctx = makeCtx(
      [{ text: "pr" }, { text: "create" }, { text: "--title" }, { text: "x" }],
      "/work/repo",
    );
    assert.deepEqual(await diagnose(ctx, "prs"), {
      tag: "missing",
      received: "",
      path: null,
      cwd: null,
      abs: null,
      exists: null,
      vaultRoot: null,
      repo: null,
      blocked: true,
    });
  });

  it("direct stage: path mirrored, trace fields null, blocked", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: "/vault/prs/note.md" }],
      "/work/repo",
    );
    const d = await diagnose(ctx, "prs");
    assert.equal(d.tag, "direct");
    assert.equal(d.received, "/vault/prs/note.md");
    assert.equal(d.path, "/vault/prs/note.md");
    assert.equal(d.blocked, true);
  });

  it("`<`-prefixed path: tag ok, opaque path kept, exists false (#48/#49)", async () => {
    const cwd = makeFixtureDir();
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        {
          text: `<(perl -0777 -pe '${BODY_STRIP}' <../Goldmine/personal/github/pcad.it-infra/issues/2026-09-01-issue188-test.md)`,
        },
      ],
      cwd,
    );
    const d = await diagnose(ctx, "issues");
    assert.equal(d.tag, "ok");
    assert.equal(
      d.path,
      "<../Goldmine/personal/github/pcad.it-infra/issues/2026-09-01-issue188-test.md",
    );
    assert.equal(d.cwd, cwd);
    assert.ok(
      d.abs !== null &&
        d.abs.endsWith(
          "<../Goldmine/personal/github/pcad.it-infra/issues/2026-09-01-issue188-test.md",
        ),
    );
    assert.equal(d.exists, false);
    assert.equal(d.vaultRoot, null);
    assert.equal(d.repo, null);
    assert.equal(d.blocked, true);
  });

  it("valid substitution: every field filled, not blocked", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution(`"${fx.prBodyFile}"`) },
      ],
      fx.vault,
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
    );
    const d = await diagnose(ctx, "prs");
    assert.equal(d.tag, "ok");
    assert.equal(d.received, stripSubstitution(`"${fx.prBodyFile}"`));
    assert.equal(d.path, fx.prBodyFile);
    assert.equal(d.cwd, fx.vault);
    assert.equal(d.abs, fx.prBodyFile);
    assert.equal(d.exists, true);
    assert.equal(d.vaultRoot, fx.vault);
    assert.equal(d.repo, "fixture-repo");
    assert.equal(d.blocked, false);
  });

  it("walker-unknown cwd: cwd/abs null, blocked", async () => {
    const fx = makeVaultRepoFixture("fixture-repo");
    const ctx = makeCtx(
      [
        { text: "--body-file" },
        { text: stripSubstitution(`"${fx.prBodyFile}"`) },
      ],
      "unknown",
      gitRemoteExec("https://github.com/cad0p/fixture-repo.git"),
    );
    const d = await diagnose(ctx, "prs");
    assert.equal(d.tag, "ok");
    assert.equal(d.cwd, null);
    assert.equal(d.abs, null);
    assert.equal(d.blocked, true);
  });

  it("pathless shape: tag diff, no path, blocked (generic token-count fallback renders it)", async () => {
    const ctx = makeCtx(
      [{ text: "--body-file" }, { text: `<(perl -0777 -pe '${BODY_STRIP}')` }],
      "/work/repo",
    );
    const d = await diagnose(ctx, "prs");
    assert.equal(d.tag, "diff");
    assert.equal(d.path, null);
    assert.equal(d.blocked, true);
  });
});
