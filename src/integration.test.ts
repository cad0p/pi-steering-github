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
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import { BODY_STRIP } from "./body-strip.ts";
import { githubPlugin } from "./index.ts";

const config = defineConfig({ plugins: [githubPlugin] });

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
): Promise<{
  block: boolean;
  rule: string | null | undefined;
  reason: string;
}> {
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
    return { block: false, rule: null, reason: "" };
  }
  const raw = result.reason ?? "";
  const reason = typeof raw === "string" ? raw : String(raw);
  const match = reason.match(/^\[steering:([^@\]]+)(?:@[^\]]+)?\]/);
  return { block: true, rule: match ? match[1] : null, reason };
}

describe("github plugin — shape", () => {
  it("registers strict rules in roster order with the vault predicate", () => {
    const plugin = config.plugins?.find((p) => p.name === "github");
    assert.ok(plugin, "github plugin should be registered");
    // Entry gate first — the `-R` attempt is the first rule an
    // agent can meet; first-match-wins routing.
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

  it("allows pr merge --help / -h (read-only introspection, issue #17 repro)", async () => {
    for (const cmd of [
      `gh pr merge --help`,
      `gh pr merge -h`,
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

  it("blocks pr merge with a bare mention only", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "feat: x (see #12)" --body "see #12"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
  });

  it("blocks a --help token INSIDE a quoted subject value (not a help invocation)", async () => {
    // Review finding: `unless: INFO_ONLY` matched the normalized string
    // (quotes stripped) and wrongly exempted `--subject "see --help"`.
    // The help carve-out is token-level on the walker argv — a help
    // token inside a VALUE is still a real merge subject and must block.
    for (const cmd of [
      `gh pr merge --squash --subject "see --help"`,
      `gh pr merge --squash --subject="see --help"`,
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(block, true, `expected block for: ${cmd}`);
      assert.equal(rule, "pr-merge-needs-closing-keywords", `for: ${cmd}`);
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

describe("github plugin — gh-repo-flag-before-subcommand (foreign -R redirect)", () => {
  const repo = "fixture-repo";
  const remote = `https://github.com/cad0p/${repo}.git`;
  const host = hostWithRemote(remote);

  it("blocks foreign gh -R pr merge (rule name in the reason tag)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other pr merge --squash",
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("MUST-BLOCK repro pin: keyword-carrying foreign merge (the exact #19 under-block)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh -R cad0p/other pr merge --squash --subject "fix: x (closes #12)"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("blocks the glued --repo= form for issue create", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh --repo=cad0p/other issue create --title t",
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("reason text e2e: tagged rule name + the foreign-repo redirect", async () => {
    // The plugin's FIRST dynamic reason deserves a full-pipeline
    // pin: the prefixed tag AND the redirect text must reach the
    // agent verbatim.
    const { block, rule, reason } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other pr merge --squash",
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
    assert.match(reason, /^\[steering:gh-repo-flag-before-subcommand@/);
    assert.match(
      reason,
      /The PR you're targeting via -R cad0p\/other belongs to a foreign repo\./,
    );
    assert.match(
      reason,
      /REQUIREMENT: run a foreign subagent maintainer loop until good,/,
    );
    assert.match(
      reason,
      /then cd into the foreign repo and target it from there\./,
    );
  });

  it("allows the fork→upstream flow (target basename == cwd repo basename)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R upstream/fixture-repo pr create --title t",
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it('blocks on walker-unknown cwd (cd "$X") — fail-closed', async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `cd "$X" && gh -R cad0p/other pr merge --squash`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("allows read-only / excluded forms (pr view, issue list, repo create, --help)", async () => {
    const cases: Array<[string, boolean]> = [
      ["gh -R cad0p/other pr view 12", false],
      ["gh -R cad0p/other issue list", false],
      ["gh -R cad0p/other repo create foo", false],
      ["gh -R cad0p/other pr merge --help", false],
      ["gh -R cad0p/other pr merge -h", false],
    ];
    for (const [cmd, expectedBlock] of cases) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd, host);
      assert.equal(
        block,
        expectedBlock,
        `command \`${cmd}\`: expected ${expectedBlock ? "block" : "allow"}, got block by ${rule}`,
      );
    }
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
