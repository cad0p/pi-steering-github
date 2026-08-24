// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `gh-repo-flag-before-subcommand` pins: the normalized-form anchor
 * surface (routes flag-first gated commands; pure router), the
 * declarative when-shape (no unless closure — the basename gate
 * lives in the registered `foreignRepoTarget` predicate, whose own
 * unit tests live in `../predicates/foreign-repo-target.test.ts`),
 * the COMPOSED help carve-out through the real evaluator (the
 * carve-out left the handler for the `not.infoOnly` leaf, so its
 * pins must assert the composed rule — a predicate-level assertion
 * would flip sign and test nothing), and the dynamic ReasonFn
 * output (byte-pinned).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { defineConfig } from "@cad0p/pi-steering";
import {
  createRecordingHost,
  loadHarness,
  mockExtensionContext,
} from "@cad0p/pi-steering/testing";
import { flagsPlugin } from "@cad0p/pi-steering-flags";
import { REPO_FLAG_ANCHOR } from "../helpers/patterns.ts";
// The composed-gate describe needs the whole plugin object (the
// rule alone can't evaluate: the not.infoOnly leaf resolves through
// the flags plugin's registered predicate at evaluation time).
import { githubPlugin } from "../index.ts";
import {
  foreignRepoReason,
  ghRepoFlagBeforeSubcommand,
} from "./gh-repo-flag-before-subcommand.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — gh-repo-flag-before-subcommand (normalized form)", () => {
  it("routes flag-first gated commands (pure router: any flag token)", () => {
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr create --title t"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr new x"), true);
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr edit 46 x"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --repo cad0p/x pr create --title t"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --repo=cad0p/x issue create --title t"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -Rcad0p/x issue edit 3"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R ghe.example.com/org/repo pr edit 46"),
      true,
    );
    // MUST-BLOCK repro pin: the EXACT issue #19 under-block repro
    // (keyword in --subject). A roster reorder can't silently
    // re-open the hole: this line pins that the new rule fires
    // regardless of keywords.
    assert.equal(
      blocked(
        REPO_FLAG_ANCHOR,
        "gh -R cad0p/x pr merge --squash --subject fix: x (closes #12)",
      ),
      true,
    );
  });

  it("pure router also routes non-repo flags and slashless -R (the predicate releases them)", () => {
    // The router deliberately does NOT decide flag identity or the
    // `/` requirement — those live in the `foreignRepoTarget`
    // predicate (arg layer). Non-repo flags and slashless remote-
    // name forms route but are released by the predicate (pinned in
    // ../predicates/foreign-repo-target.test.ts).
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -v pr create --title t"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --hostname x pr create --title t"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R upstream pr create --title t"),
      true,
    );
  });
});

describe("github plugin — gh-repo-flag-before-subcommand (declarative shape)", () => {
  it("gates declaratively: not.infoOnly + foreignRepoTarget, zero condition code", () => {
    const rule = ghRepoFlagBeforeSubcommand as unknown as {
      unless?: unknown;
      when?: {
        condition?: unknown;
        not?: { infoOnly?: unknown };
        foreignRepoTarget?: unknown;
      };
    };
    assert.equal(
      rule.unless,
      undefined,
      "no unless — the gate must be declarative when-only",
    );
    assert.equal(
      rule.when?.condition,
      undefined,
      "zero condition code — the predicates fully replace when.condition",
    );
    // Carve-out leaf: read-only introspection never blocks (--help/
    // --version defaults + GitHub's additive -h; accepted exposure:
    // bare/attached --version also exempts — invalid invocations).
    assert.deepEqual(
      rule.when?.not?.infoOnly,
      { extraFlags: ["-h"] },
      "the info-only carve-out must be negated via not:",
    );
    assert.equal(
      rule.when?.foreignRepoTarget,
      true,
      "the foreign-target gate must be the package's registered predicate, enabled bare",
    );
  });
});

describe("github plugin — gh-repo-flag-before-subcommand composed gate (engine eval)", () => {
  // The help carve-out left the handler (it lives in the rule's
  // `not.infoOnly` leaf now), so its pins assert the COMPOSED rule
  // through the REAL evaluator pipeline (defineConfig + loadHarness
  // + recording host — same fixture pattern as
  // ../integration.test.ts). flagsPlugin supplies the `infoOnly`
  // registry entry; without it the leaf hits UnknownPredicateError.
  const config = defineConfig({ plugins: [flagsPlugin, githubPlugin] });

  const fixtures: string[] = [];

  function makeFixtureDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "steering--r-rule-fixture-"));
    fixtures.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of fixtures.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function hostWithRemote(remoteUrl: string) {
    return createRecordingHost({
      exec: (cmd, args) => {
        if (
          cmd === "git" &&
          args[0] === "config" &&
          args[1] === "--get" &&
          args[2] === "remote.origin.url"
        ) {
          return Promise.resolve({
            stdout: remoteUrl,
            stderr: "",
            code: 0,
            killed: false,
          });
        }
        return Promise.resolve({
          stdout: "",
          stderr: "",
          code: 0,
          killed: false,
        });
      },
    });
  }

  async function evaluateBash(
    cwd: string,
    command: string,
  ): Promise<{ block: boolean; rule: string | null | undefined }> {
    const host = hostWithRemote(
      "https://github.com/cad0p/pi-steering-github.git",
    );
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

  it("bare --help / -h allow (composed read-only introspection)", async () => {
    for (const cmd of [
      "gh -R cad0p/other pr merge --help",
      "gh -R cad0p/other pr merge -h",
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd);
      assert.equal(
        block,
        false,
        `expected allow for: ${cmd} (block by ${rule})`,
      );
    }
  });

  it("a --help inside a QUOTED VALUE must NOT exempt (token-level leaf)", async () => {
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      'gh -R cad0p/other pr merge --subject "see --help"',
    );
    assert.equal(block, true, "expected block");
    assert.equal(rule, "gh-repo-flag-before-subcommand");
  });

  it("glued lookalikes (--helper, -hx) do NOT exempt", async () => {
    for (const cmd of [
      "gh -R cad0p/other pr merge --squash --helper",
      "gh -R cad0p/other pr merge --squash -hx",
    ]) {
      const { block, rule } = await evaluateBash(makeFixtureDir(), cmd);
      assert.equal(block, true, `expected block for: ${cmd}`);
      assert.equal(rule, "gh-repo-flag-before-subcommand", `for: ${cmd}`);
    }
  });

  it("BEHAVIOR DELTA: --help= EXEMPTS (infoOnly attached-value prefix match)", async () => {
    // `not.infoOnly` treats `--help=` as the attached-value form of
    // `--help` (startsWith `--help=`) → carve-out fires. The old
    // token-boundary regex blocked `--help=`. `--help=` is an
    // invalid gh invocation (errors, never mutates) — harmless; pin
    // the flip so it can't change silently.
    const { block, rule } = await evaluateBash(
      makeFixtureDir(),
      "gh -R cad0p/other pr merge --squash --help=",
    );
    assert.equal(block, false, `expected allow, got block by ${rule}`);
  });

  it("glue-aware: own-repo -Rcad0p/x releases, foreign blocks (e2e)", async () => {
    // Upstream cad0p/pi-steering-flags#11 adoption (`{ gluedShorts:
    // ["R"] }`): the walker keeps `-Rcad0p/…` as ONE word and target
    // resolution now sees it — own repo basename-matches → allow
    // (the pre-adoption fail-closed over-block is gone); foreign
    // owner/repo → block.
    const own = await evaluateBash(
      makeFixtureDir(),
      "gh -Rcad0p/pi-steering-github pr merge --squash",
    );
    assert.equal(own.block, false, `expected allow, got block by ${own.rule}`);
    const foreign = await evaluateBash(
      makeFixtureDir(),
      "gh -Rcad0p/other pr merge --squash",
    );
    assert.equal(foreign.block, true, "expected block");
    assert.equal(
      foreign.rule,
      "gh-repo-flag-before-subcommand",
      `for: foreign glued`,
    );
  });
});

describe("github plugin — gh-repo-flag-before-subcommand ReasonFn (dynamic)", () => {
  function ctxWith(command: string): Parameters<typeof foreignRepoReason>[0] {
    const args = command.split(/\s+/).map((text) => ({ text }));
    return { input: { args } } as unknown as Parameters<
      typeof foreignRepoReason
    >[0];
  }

  it("PR form: echoes the -R flag+target AS TYPED + the redirect requirement", () => {
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/x pr create --title t"),
    );
    assert.equal(
      reason,
      "The PR you're targeting via -R cad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("issue form: 'The issue …'", () => {
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/x issue create --title t"),
    );
    assert.equal(
      reason,
      "The issue you're targeting via -R cad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("--repo=x/y glued form echoes the flag as typed", () => {
    // The walker keeps `--repo=x/y` glued as ONE word.
    const reason = foreignRepoReason(
      ctxWith("gh --repo=cad0p/x issue create --title t"),
    );
    assert.equal(
      reason,
      "The issue you're targeting via --repo=cad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("-Rx/y glued form echoes the flag as typed", () => {
    // The walker keeps `-Rx/y` glued as ONE word.
    const reason = foreignRepoReason(ctxWith("gh -Rcad0p/x issue edit 3"));
    assert.equal(
      reason,
      "The issue you're targeting via -Rcad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("cross-alias command echoes the EFFECTIVE (last) flag+target", () => {
    // Right→left scan mirrors getFlagValue's LAST-flag-wins: the
    // overridden early `-R cad0p/a` is NOT echoed — the redirect names
    // what gh will actually target (`--repo cad0p/b`).
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/a pr create --repo cad0p/b"),
    );
    assert.equal(
      reason,
      "The PR you're targeting via --repo cad0p/b belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("trailing glued empty value echoes the glued word verbatim", () => {
    // First match from the right wins REGARDLESS of form: the glued
    // `--repo=` at the line's end beats the earlier valued `-R` —
    // consistent with the fail-closed block verdict for this command.
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/a pr create --repo="),
    );
    assert.equal(
      reason,
      "The PR you're targeting via --repo= belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("a value word starting with -R does NOT hijack the echo (spaced-value guard)", () => {
    // Glue-aware resolution now decomposes `-R<rest>` words at any
    // position, but a quoted VALUE like "-Rebased onto main" resolves
    // to a SLASHLESS target → step-4 release — this command is never
    // blocked at rule level anymore, so the pin below asserts display
    // robustness only: the glued-short echo branch still demands a
    // slashful no-space remainder (`-R…/…`), so spaced lookalike
    // values never hijack the redirect text. Accepted display-only
    // divergence from resolution (fail-closed direction).
    const reason = foreignRepoReason(
      ctxWith('gh --repo cad0p/other pr create --body "-Rebased onto main"'),
    );
    assert.equal(
      reason,
      "The PR you're targeting via --repo cad0p/other belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });
});
