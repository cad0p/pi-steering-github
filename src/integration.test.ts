// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Full-pipeline integration tests for the github plugin.
 *
 * The plugin is exercised end-to-end through the REAL evaluator:
 * `defineConfig` + `loadHarness` with a recording host, exactly the
 * pipeline production uses.
 *
 * The `missingVaultBodyFile` predicate walks the real filesystem
 * (napkin-vault detection + repo-name check via the exec stub), so
 * these scenarios use REAL fixture dirs (mkdtemp) for vault /
 * non-vault paths. Vault body files carry frontmatter + H1 (like
 * real Goldmine notes) and must be uploaded through the strip-helper
 * substitution form `--body-file <(pi-steering-github strip
 * "<file>")` — the walker keeps the substitution's full inner text
 * as one arg word. Blocked commands surface the rule name through
 * the reason-tag convention (`[steering:<rule>@<plugin>]` — the
 * extraction regex accepts both tagged and untagged forms).
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { defineConfig } from "@cad0p/pi-steering";
import {
  createRecordingHost,
  loadHarness,
  mockExtensionContext,
} from "@cad0p/pi-steering/testing";
import { flagsPlugin } from "@cad0p/pi-steering-flags";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import { BODY_STRIP } from "./helpers/body-strip.ts";
import { githubPlugin } from "./index.ts";

// flagsPlugin supplies the declarative when leaves
// (`not.infoOnly`, `requiresFlagValue`) that pr-merge-needs-closing-
// keywords composes — without it those keys hit the evaluator's
// UnknownPredicateError at evaluation time.
const config = defineConfig({ plugins: [flagsPlugin, githubPlugin] });

/** Fixture dirs created per test, cleaned up after. */
const fixtures: string[] = [];

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "steering-fixture-"));
  fixtures.push(dir);
  return dir;
}

function makeVaultFixture(): string {
  const dir = makeFixtureDir();
  mkdirSync(join(dir, ".napkin"));
  return dir;
}

function makeNestedVaultFixture(): string {
  const dir = makeFixtureDir();
  mkdirSync(join(dir, ".obsidian", ".napkin"), { recursive: true });
  return dir;
}

/**
 * A napkin-vault fixture laid out like the real Goldmine convention:
 * `<vault>/open-source/github/<repo>/prs|issues/<date>-pr|issue<N>-<slug>.md`.
 * Body files carry frontmatter + H1 like real notes — the
 * strip-helper convention is what keeps GitHub bodies clean.
 */
interface VaultRepoFixture {
  vault: string;
  repo: string;
  prBodyFile: string;
  issueBodyFile: string;
}

function makeVaultRepoFixture(repo: string): VaultRepoFixture {
  const vault = makeVaultFixture();
  const prsDir = join(vault, "open-source", "github", repo, "prs");
  const issuesDir = join(vault, "open-source", "github", repo, "issues");
  mkdirSync(prsDir, { recursive: true });
  mkdirSync(issuesDir, { recursive: true });
  const prBodyFile = join(prsDir, `2026-08-14-pr1-${repo}-test.md`);
  writeFileSync(
    prBodyFile,
    "---\ntags: [test]\n---\n# Title\n\nCloses #12\n\nBody.\n",
  );
  const issueBodyFile = join(issuesDir, `2026-08-14-issue1-${repo}-test.md`);
  writeFileSync(
    issueBodyFile,
    "---\ntags: [test]\n---\n# Title\n\nIssue body text.\n",
  );
  return { vault, repo, prBodyFile, issueBodyFile };
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The pinned perl substitution form the vault body-file rules require. */
function stripSubstitution(file: string): string {
  return `<(perl -0777 -pe '${BODY_STRIP}' "${file}")`;
}

/**
 * JS mirror of the pinned perl program (test stub only — the real
 * behavior is pinned by body-strip.test.ts spawning perl).
 */
function stripFrontmatter(content: string): string {
  return content.replace(
    /^(?:\uFEFF)?---\r?\n(?:.*?\r?\n)?(?:---|\.\.\.)\r?\n(?:\r?\n)*(?:[ \t]*\r?\n)*(?:#(?![\S])[^\n]*(?:\r?\n)?(?:[ \t]*\r?\n)*)?/,
    "",
  );
}

/**
 * Build a host whose `exec` stub answers git queries as if the cwd is
 * a github clone on a feature branch, and answers the keyword
 * rule's pinned-perl call with the frontmatter-stripped file content
 * (exactly what gh would upload).
 */
function hostWithRemote(
  remoteUrl: string,
): ReturnType<typeof createRecordingHost> {
  return createRecordingHost({
    exec: (cmd, args) => {
      const sub = args[0];
      if (cmd === "git" && sub === "branch" && args[1] === "--show-current") {
        return Promise.resolve({
          stdout: "main",
          stderr: "",
          code: 0,
          killed: false,
        } satisfies ExecResult);
      }
      if (
        cmd === "git" &&
        sub === "config" &&
        args[1] === "--get" &&
        args[2] === "remote.origin.url"
      ) {
        return Promise.resolve({
          stdout: remoteUrl,
          stderr: "",
          code: 0,
          killed: false,
        } satisfies ExecResult);
      }
      if (cmd === "perl" && args[0] === "-0777" && args[1] === "-pe") {
        // The keyword check runs the pinned one-liner: answer with
        // the stripped file content (canonical = what gh uploads).
        const file = args[3];
        if (file === undefined) {
          return Promise.resolve({
            stdout: "",
            stderr: "perl: no file",
            code: 1,
            killed: false,
          } satisfies ExecResult);
        }
        let stripped = "";
        try {
          stripped = stripFrontmatter(readFileSync(file, "utf8"));
        } catch {
          return Promise.resolve({
            stdout: "",
            stderr: "no such file",
            code: 1,
            killed: false,
          } satisfies ExecResult);
        }
        return Promise.resolve({
          stdout: stripped,
          stderr: "",
          code: 0,
          killed: false,
        } satisfies ExecResult);
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        code: 0,
        killed: false,
      } satisfies ExecResult);
    },
  });
}

function hostOnMainGithub(): ReturnType<typeof createRecordingHost> {
  return hostWithRemote("https://github.com/cad0p/Goldmine.git");
}

/**
 * Evaluate a bash command at a given cwd. Uses a fresh host + ctx per
 * call so exec state doesn't leak across assertions. The cwd must be
 * a REAL directory — the vault predicate walks the filesystem.
 */
async function evaluateBash(
  cwd: string,
  command: string,
  host: ReturnType<typeof createRecordingHost> = hostOnMainGithub(),
): Promise<{ block: boolean; rule: string | null | undefined }> {
  const ctx = mockExtensionContext(cwd, host.entries);
  const harness = loadHarness({ config, host, includeDefaults: true });
  const event = {
    type: "tool_call",
    toolCallId: "tc1",
    toolName: "bash",
    input: { command },
  } as unknown as Parameters<typeof harness.evaluate>[0];
  const result = await harness.evaluate(event, ctx, 1);
  if (result === undefined || result === null || result.block !== true) {
    return { block: false, rule: null };
  }
  const raw = result.reason ?? "";
  const reason = typeof raw === "string" ? raw : String(raw);
  const match = reason.match(/^\[steering:([^@\]]+)(?:@[^\]]+)?\]/);
  return { block: true, rule: match ? match[1] : null };
}

describe("github plugin — shape", () => {
  it("registers strict rules in roster order with the vault predicate", () => {
    const plugin = config.plugins?.find((p) => p.name === "github");
    assert.ok(plugin, "github plugin should be registered");
    // Body-file rule first — first-match-wins routing.
    assert.deepEqual(
      plugin?.rules?.map((r) => r.name),
      [
        "gh-repo-flag-before-subcommand",
        "pr-body-from-vault-file",
        "pr-create-needs-issue-link",
        "pr-merge-needs-closing-keywords",
        "issue-body-from-vault-file",
        "gh-repo-create-needs-seed",
      ],
    );
    for (const r of plugin?.rules ?? []) {
      assert.equal(r.tool, "bash");
      assert.equal(r.field, "command");
      assert.ok(!("noOverride" in r), `${r.name} must be strict`);
    }
    assert.equal(typeof plugin?.predicates?.missingVaultBodyFile, "function");
  });
});

describe("github plugin — PR rules (issue-link + vault body-file policy)", () => {
  const repo = "fixture-repo";
  const remote = `https://github.com/cad0p/${repo}.git`;
  const host = hostWithRemote(remote);

  // ---- pr-body-from-vault-file (runs FIRST — first-match-wins) ----

  it("allows pr create with keyword title + stripped vault prs/ body file (frontmatter + H1)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows pr create with a stripped body file in a nested-layout vault (.obsidian/.napkin/)", async () => {
    const vault = makeNestedVaultFixture();
    const prsDir = join(vault, "open-source", "github", repo, "prs");
    mkdirSync(prsDir, { recursive: true });
    const bodyFile = join(prsDir, "2026-08-14-pr1-nested.md");
    writeFileSync(bodyFile, "Closes #12\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(bodyFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows pr edit with a stripped vault prs/ body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr edit 46 --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows issue create with a stripped vault issues/ body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue create --title "tracking" --body-file ${stripSubstitution(fx.issueBodyFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows issue edit with a stripped vault issues/ body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue edit 29 --body-file ${stripSubstitution(fx.issueBodyFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows the glued --body-file=<(…) form (walker-split into two words)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file=${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("blocks pr create with inline --body (vault body file required)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body "Closes #12"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks a DIRECT vault path (only the strip-helper substitution is accepted)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${fx.prBodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks issue create with a DIRECT vault path", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue create --title "tracking" --body-file "${fx.issueBodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "issue-body-from-vault-file");
  });

  it("blocks pr create with a non-strip inner command (<(cat …))", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file <(cat "${fx.prBodyFile}")`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks pr create with a substitution pointing OUTSIDE any vault", async () => {
    // Form OK, but the path must resolve inside a napkin vault — a
    // non-vault path is missing (restored validation, #12).
    const outside = makeFixtureDir();
    const bodyFile = join(outside, "body.md");
    writeFileSync(bodyFile, "Closes #12\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(bodyFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks pr create with a substitution pointing at a wrong-section file", async () => {
    // issues/ file carrying a keyword: the vault-relative path must
    // contain <repo>/<section>/ (restored validation, #12).
    const fx = makeVaultRepoFixture(repo);
    const kwFile = join(dirname(fx.issueBodyFile), "2026-08-14-issue2-kw.md");
    writeFileSync(kwFile, "Closes #12\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(kwFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks pr create with a substitution pointing at another repo's file", async () => {
    // File lives under open-source/github/other-repo/prs/ — the
    // vault-relative path must contain the COMMAND repo's name
    // (origin basename, cwd-folder fallback) (restored, #12).
    const fx = makeVaultRepoFixture("other-repo");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it('blocks a substitution under a dynamic cwd (cd "$X") — fail-closed', async () => {
    // The path resolves against the command's cwd; a walker-unknown
    // cwd is unverifiable → missing (restored validation, #12).
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `cd "$X" && gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks pr edit with inline --body", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr edit 46 --body "Closes #12"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks issue create with inline --body", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue create --title "tracking" --body "notes"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "issue-body-from-vault-file");
  });

  it("blocks issue create with a prs/ file via substitution (wrong section)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue create --title "tracking" --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "issue-body-from-vault-file");
  });

  // ---- pr-create-needs-issue-link ----

  it("blocks pr create when the stripped vault body lacks the closing keyword", async () => {
    const fx = makeVaultRepoFixture(repo);
    const badFile = join(dirname(fx.prBodyFile), "2026-08-14-pr2-nokw.md");
    writeFileSync(badFile, "## What\n\nNo keywords here.\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(badFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-create-needs-issue-link");
  });

  it("blocks pr create when the closing keyword ONLY appears in frontmatter", async () => {
    const fx = makeVaultRepoFixture(repo);
    const kwFile = join(dirname(fx.prBodyFile), "2026-08-14-pr2-fmkw.md");
    writeFileSync(
      kwFile,
      "---\ncloses: #12\n---\n# Title\n\nNo keyword here.\n",
    );
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file ${stripSubstitution(kwFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-create-needs-issue-link");
  });

  it("blocks pr create when the title lacks the keyword (body file has it)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x" --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-create-needs-issue-link");
  });

  it("blocks pr create with a bare (#12) title mention (mention != close)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (#12)" --body-file ${stripSubstitution(fx.prBodyFile)}`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-create-needs-issue-link");
  });

  it("allows multi-issue keyword-per-issue in the vault body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const multiFile = join(dirname(fx.prBodyFile), "2026-08-14-pr3-multi.md");
    writeFileSync(multiFile, "Closes #12, closes #15\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "fix: multi (closes #12)" --body-file ${stripSubstitution(multiFile)}`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  // ---- pr-merge-needs-closing-keywords ----

  it("allows the isInfoOnly default flags and GitHub's additive -h", async () => {
    for (const cmd of [
      `gh pr merge --help`,
      `gh pr merge -h`,
      `gh pr merge --version`,
      `gh pr merge --squash --help`,
      `gh pr merge --help --squash`,
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(
        block,
        false,
        `expected allow for: ${cmd} (got block by ${rule})`,
      );
    }
  });

  it("allows attached info flags and keeps -v gated", async () => {
    for (const cmd of [
      `gh pr merge --help=value`,
      `gh pr merge --version=1`,
      `gh pr merge --squash -h=value`,
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(
        block,
        false,
        `expected allow for: ${cmd} (got block by ${rule})`,
      );
    }
    for (const cmd of [`gh pr merge -v`, `gh pr merge -v=value`]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(block, true, `expected block for: ${cmd}`);
      assert.equal(rule, "pr-merge-needs-closing-keywords", `for: ${cmd}`);
    }
  });

  it("allows pr merge --help with a positional PR number / after --subject value", async () => {
    for (const cmd of [
      `gh pr merge 123 --help`,
      `gh pr merge 123 -h`,
      `gh pr merge --squash --subject "feat: x (closes #12)" -h`,
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(
        block,
        false,
        `expected allow for: ${cmd} (got block by ${rule})`,
      );
    }
  });

  it("blocks bare pr merge (no args — real merge of current-branch PR)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
  });

  it("blocks pr merge --squash (no --subject, no closing keyword)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
  });

  it("allows pr merge with keyword in BOTH --subject and --body", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "feat: x (closes #12)" --body "Closes #12"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("blocks pr merge without --subject (commit-subject channel required)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --body "Closes #12"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
  });

  it("allows pr merge with --subject only (commit subject closes; body optional)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "feat: x (closes #12)"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows -t/-b short flags with a PR number argument", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge 123 -s -t "fix: y (closes #7)" -b "Closes #7"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows --subject= glued forms, colons and case variants", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --auto --squash --subject="feat: x (RESOLVES #4)"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows multiple issues with keyword per issue in the merge subject", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "fix: x (closes #12, closes #15)"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("BEHAVIOR DELTA (#23-a): attached short form -t=<ref> now allowed", async () => {
    // pflag-correct flip: `-t=<value>` is valid attached-value syntax.
    // The old hand-rolled scan only knew bare `-t` and the `--subject=`
    // prefix, so `-t=` was invisible → subject null → BLOCK. The
    // requiresFlagValue predicate matches the `${flag}=` prefix per
    // alias → value found → ALLOW.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash -t="feat: x (closes #12)"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("blocks pr merge with a bare mention only", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "feat: x (see #12)" --body "see #12"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
  });

  it("blocks help/version tokens INSIDE quoted subject values", async () => {
    // The helper is token-level on walker argv: a help/version token
    // inside a VALUE is still a real merge subject and must block.
    for (const cmd of [
      `gh pr merge --squash --subject "see --help"`,
      `gh pr merge --squash --subject="see --help"`,
      `gh pr merge --squash --subject "see --version"`,
      `gh pr merge --squash --subject="see --version"`,
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(block, true, `expected block for: ${cmd}`);
      assert.equal(rule, "pr-merge-needs-closing-keywords", `for: ${cmd}`);
    }
  });

  it("pins exact quoted info tokens as an accepted quote-removal limitation", async () => {
    // After the walker removes quotes, an exact quoted value is
    // indistinguishable from a bare info flag, so the helper allows it.
    for (const cmd of [
      `gh pr merge --squash --subject "--help"`,
      `gh pr merge --squash --subject "--version"`,
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(block, false, `expected accepted limitation for: ${cmd}`);
      assert.notEqual(rule, "pr-merge-needs-closing-keywords", `for: ${cmd}`);
    }
  });

  it("honors gh's last-flag-wins precedence for repeated --subject/-t", async () => {
    // Cobra semantics: the LAST flag occurrence wins. A valid later
    // `--subject` overrides an earlier bare `-t`…
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash -t "see #13" --subject "closes #12"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
    // …and a bare `-t` as the LAST flag with no ref still blocks.
    const { block: blockLast } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "closes #12" -t "see #13"`,
      host,
    );
    assert.equal(blockLast, true, "expected block");
  });

  it("does not gate other gh subcommands (view / branch / close)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr view 12 --json body,title`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
    const { block: blockClose } = await evaluateBash(
      makeFixtureDir(),
      `gh issue close 12`,
      host,
    );
    assert.equal(blockClose, false, `expected allow, got block by ${rule}`);
  });
});

describe("github plugin — gh-repo-create-needs-seed (repo create must seed)", () => {
  it("blocks bare gh repo create with the rule name in the reason tag", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh repo create cad0p/pi-config",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-create-needs-seed");
  });

  it("blocks gh repo create with only non-seed flags (--source . --push)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh repo create cad0p/pi-config --source . --push",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-create-needs-seed");
  });

  it("blocks the gh repo new alias (new = create)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh repo new cad0p/pi-config",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-create-needs-seed");
  });

  it("allows gh repo create with --add-readme", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh repo create cad0p/pi-config --add-readme",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows gh repo create with --license mit", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh repo create cad0p/pi-config --license mit",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });
});

describe("github plugin — gh-repo-flag-before-subcommand (-R foreign-target gate)", () => {
  // The gate is declarative over two leaves: `not.infoOnly({
  // extraFlags: ["-h"] })` + this package's `foreignRepoTarget`
  // predicate. The default evaluateBash host answers the cwd repo as
  // `cad0p/Goldmine` (origin URL), so `Goldmine`-basenamed targets
  // are the fork→upstream flow and anything else is FOREIGN.

  it("blocks a foreign -R target with the redirect reason tag", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other-repo pr create --title t",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("blocks a foreign --repo=x/y glued long form too", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh --repo=cad0p/other-repo issue create --title t",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("glue-aware: own-repo -Rcad0p/x short form releases (flags#11 adoption)", async () => {
    // The walker keeps `-Rcad0p/Goldmine` as ONE word; glue-aware
    // target resolution (`{ gluedShorts: ["R"] }`, upstream
    // cad0p/pi-steering-flags#11) now sees it → basename equality →
    // allow. Pre-adoption this fail-closed on the unresolvable target
    // (accepted over-block, pinned as a BEHAVIOR DELTA then).
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -Rcad0p/Goldmine pr create --title t",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("glue-aware: foreign -Rcad0p/x short form blocks", async () => {
    // Glue awareness cuts both ways: a FOREIGN owner/repo in glued
    // short form resolves instead of fail-closing on null → basename
    // mismatch → block.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -Rcad0p/other-repo issue create --title t",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("allows the fork→upstream flow (target basename == cwd repo basename)", async () => {
    // `gh -R upstream/Goldmine pr create` from inside the
    // `cad0p/Goldmine` clone — the most common legit `-R` use.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R upstream/Goldmine pr create --title t",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("releases slashless -R upstream (remote-name form)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R upstream pr create --title t",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("BEHAVIOR DELTA (#36): bare --version exempts (infoOnly default set)", async () => {
    // A gated invocation carrying --version flips block→allow:
    // the not.infoOnly leaf allows before the foreign-target
    // predicate is consulted. gh errors on --version for pr/issue
    // subcommands anyway — invalid invocation, nothing real can
    // happen.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other-repo pr create --version",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("BEHAVIOR DELTA (#36): attached --version=1 exempts too", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other-repo pr create --version=1",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("keeps -v gated (deliberately absent from the infoOnly set)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other-repo pr create -v",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("BEHAVIOR DELTA (#39): subcommand-first foreign merge now blocks (was released)", async () => {
    // The #39 class: `--repo=` after the subcommand used to escape
    // the gate entirely (flag-first-only anchor). Now routed and
    // blocked with the redirect.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh pr merge --repo=cad0p/other-repo --squash",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("#41: TWO leading flag pairs route — a foreign target blocks BY this rule", async () => {
    // Pre-#41 this shape escaped the router entirely (one-pair cap):
    // `--hostname h -R …` is two flag(+value) pairs. The redirect
    // masks the closing-keywords allowance as usual (first-fires-wins).
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      'gh --hostname h -R cad0p/other-repo pr merge --subject "feat: x (closes #12)"',
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("#41: two leading flag pairs with an OWN-repo target RELEASE", async () => {
    // Fixture cwd repo basename is cad0p/Goldmine (default host
    // remote). Same shape as the foreign twin below — routed by the
    // widened anchor, then released by the predicate on the basename
    // match. The foreign twin proves the shape genuinely routes (a
    // clean allow alone couldn't distinguish release from exemption).
    const own = await evaluateBash(
      makeFixtureDir(),
      "gh --hostname h -R cad0p/Goldmine pr merge --squash",
    );
    assert.equal(own.block, false, `expected allow, got block by ${own.rule}`);
    const foreign = await evaluateBash(
      makeFixtureDir(),
      "gh --hostname h -R cad0p/other-repo pr merge --squash",
    );
    assert.equal(foreign.block, true, "expected block");
    assert.equal(foreign.rule, "gh-repo-flag-before-subcommand");
  });

  it("#41: multi-flag command without -R anywhere routes but releases untouched", async () => {
    // Routed by the unbounded anchor; absent repo flag → predicate
    // releases. The per-subcommand anchors are ^gh\s+(pr|issue), so a
    // flag-first form falls PAST them — release surfaces as a clean
    // byte-for-byte allow rather than a downstream block.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -v --hostname h pr merge --squash",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("fall-through: no-flag mutations reach the per-subcommand rules", async () => {
    // `gh pr merge --squash` ROUTES the foreign gate first since #39
    // (zero leading flags) but carries NO repo flag → predicate
    // releases → the closing-keywords rule fires. Asserting the OTHER
    // rule's name proves release-fall-through end-to-end.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh pr merge --squash",
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
  });

  it("masking: a foreign target masks the closing-keywords allowance until cd", async () => {
    // The --subject carries a VALID closing keyword — the merge rule
    // alone would allow this command — but the foreign redirect fires
    // first (first-fires-wins) and masks it. Per-subcommand policies
    // apply naturally after cd into the foreign repo.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      'gh pr merge --repo=cad0p/other-repo --squash --subject "feat: x (closes #12)"',
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });
});
