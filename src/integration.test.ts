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
 * non-vault paths. Blocked commands surface the rule name through
 * the reason-tag convention (`[steering:<rule>@<plugin>]` — the
 * extraction regex accepts both tagged and untagged forms).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * Build a host whose `exec` stub answers git queries as if the cwd is
 * a github clone on a feature branch. The github rules' repo check
 * shells out to `git config --get remote.origin.url` (via the
 * `missingVaultBodyFile` predicate).
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
        "pr-body-from-vault-file",
        "pr-create-needs-issue-link",
        "pr-merge-needs-closing-keywords",
        "issue-body-from-vault-file",
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

  it("allows pr create with keyword title + vault prs/ body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${fx.prBodyFile}"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows pr create with a body file in a nested-layout vault (.obsidian/.napkin/)", async () => {
    const vault = makeNestedVaultFixture();
    const prsDir = join(vault, "open-source", "github", repo, "prs");
    mkdirSync(prsDir, { recursive: true });
    const bodyFile = join(prsDir, "2026-08-14-pr1-nested.md");
    writeFileSync(bodyFile, "Closes #12\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${bodyFile}"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows pr edit with a vault prs/ body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr edit 46 --body-file "${fx.prBodyFile}"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("allows issue create with a vault issues/ body file", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue create --title "tracking" --body-file "${fx.issueBodyFile}"`,
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

  it("blocks pr create with --body-file outside any vault", async () => {
    const outside = makeFixtureDir();
    const bodyFile = join(outside, "body.md");
    writeFileSync(bodyFile, "Closes #12\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${bodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks pr create with a vault file under issues/ (wrong section)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${fx.issueBodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it("blocks pr create when the vault file's repo doesn't match the remote", async () => {
    // File lives under open-source/github/other-repo/prs/, but the
    // (stubbed) remote says fixture-repo.
    const fx = makeVaultRepoFixture("other-repo");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${fx.prBodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-body-from-vault-file");
  });

  it('fail-closed: dynamic cwd (cd "$X") with --body-file blocks', async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `cd "$X" && gh pr create --title "feat: x (closes #12)" --body-file "${fx.prBodyFile}"`,
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

  it("blocks issue create with a vault prs/ file (wrong section)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh issue create --title "tracking" --body-file "${fx.prBodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "issue-body-from-vault-file");
  });

  // ---- pr-create-needs-issue-link ----

  it("blocks pr create when the vault body file lacks the closing keyword", async () => {
    const fx = makeVaultRepoFixture(repo);
    const badFile = join(dirname(fx.prBodyFile), "2026-08-14-pr2-nokw.md");
    writeFileSync(badFile, "## What\n\nNo keywords here.\n");
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (closes #12)" --body-file "${badFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-create-needs-issue-link");
  });

  it("blocks pr create when the title lacks the keyword (body file has it)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x" --body-file "${fx.prBodyFile}"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-create-needs-issue-link");
  });

  it("blocks pr create with a bare (#12) title mention (mention != close)", async () => {
    const fx = makeVaultRepoFixture(repo);
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr create --title "feat: x (#12)" --body-file "${fx.prBodyFile}"`,
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
      `gh pr create --title "fix: multi (closes #12)" --body-file "${multiFile}"`,
      host,
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  // ---- pr-merge-needs-closing-keywords ----

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

  it("blocks pr merge without --body (commit-body channel required)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      `gh pr merge --squash --subject "feat: x (closes #12)"`,
      host,
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "pr-merge-needs-closing-keywords");
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
