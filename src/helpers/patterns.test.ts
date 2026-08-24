// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the github plugin's pattern constants (pattern
 * contract). Import the constants from `./patterns.ts` directly: the
 * module loads cleanly under plain node (`node --test
 * --experimental-strip-types`) — the `@cad0p/pi-napkin/steering`
 * subpath ships compiled JS (`dist/steering`) since 0.7.0-20260814.0,
 * so there is no raw `.ts` under node_modules to trip the type
 * stripper.
 *
 * The rule `pattern` fields ARE the exported constants (shared
 * reference), so these tests pin the exact behavior the rules ship:
 * a change to a constant is a change to the rule. Full-pipeline tests
 * (real defineConfig + loadHarness + vault fixtures) live in
 * `../integration.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ghRepoCreateNeedsSeed } from "../rules/gh-repo-create-needs-seed.ts";
import { issueBodyFromVaultFile } from "../rules/issue-body-from-vault-file.ts";
import { prBodyFromVaultFile } from "../rules/pr-body-from-vault-file.ts";
import { prCreateNeedsIssueLink } from "../rules/pr-create-needs-issue-link.ts";
import { prMergeNeedsClosingKeywords } from "../rules/pr-merge-needs-closing-keywords.ts";
import {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  REPO_CREATE_PATTERN,
  REPO_FLAG_ANCHOR,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./patterns.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — pattern constants", () => {
  it("closing-keyword family and issue-ref are exported for pinning", () => {
    assert.match(CLOSING_KEYWORD, /close/);
    assert.match(ISSUE_REF, /#\\d/);
    assert.match(TITLE_WITH_REF, /--title/);
    assert.match(SUBJECT_WITH_REF, /--subject/);
    assert.match(BODY_WITH_REF, /--body/);
  });

  it("rule pattern fields are the shared anchors (shared reference)", () => {
    // House pinning style (mirrors the git plugin): the rules
    // reference the exported constants, so a change to a constant is
    // a change to the rule — no drift between test surface and
    // shipped behavior.
    assert.equal(prBodyFromVaultFile.pattern, PR_BODY_ANCHOR);
    assert.equal(prCreateNeedsIssueLink.pattern, PR_CREATE_ANCHOR);
    assert.equal(prMergeNeedsClosingKeywords.pattern, PR_MERGE_ANCHOR);
    assert.equal(issueBodyFromVaultFile.pattern, ISSUE_BODY_ANCHOR);
    assert.equal(ghRepoCreateNeedsSeed.pattern, REPO_CREATE_PATTERN);
  });
});

describe("github plugin — gh-repo-flag-before-subcommand (normalized form)", () => {
  it("routes gated subcommands with zero or one leading flag (both -R positions)", () => {
    // Flag-first position: sole leading flag(+value), then a gated
    // subcommand. Case-insensitive (`/i`): gh flags/subcommands are
    // lowercase by convention, but the anchor must not silently
    // un-anchor uppercase spellings.
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr create --title t"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "GH -R X/Y PR MERGE"), true);
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
    // Subcommand-first position (#39): zero leading flags — the
    // optional flag group is skipped and the gated subcommand routes.
    // This IS the issue: `gh pr create -R x/y …` escaped the foreign
    // gate before the widening.
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh pr create -R cad0p/x --title t"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh issue edit 3 --repo=cad0p/x"),
      true,
    );
    // One leading flag WITHOUT a trailing value token still routes.
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -v pr merge --squash"), true);
  });

  it("does not route read-only forms, excluded subcommands, echo prefixes, or two-leading-flag shapes", () => {
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr view 12"), false);
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x issue list"), false);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x issue close 3"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x repo create foo"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x repo new foo"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "echo gh -R cad0p/x pr create --title t"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x repo clone x"),
      false,
    );
    // Documented boundary: TWO leading flags stay unrouted (the
    // optional group covers zero or exactly one flag+value pair).
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --hostname h -R cad0p/x pr merge"),
      false,
    );
  });

  it("the anchor is a shape router: help/-h and non-repo leading flags still route, the predicate decides repo-targeting", () => {
    // The anchor does NOT decide help or flag identity — the
    // token-level `not.infoOnly` carve-out and the `foreignRepoTarget`
    // presence check do (so a `--help` inside a quoted value never
    // falsely exempts). These route to the rule and are allowed by
    // the composed leaves.
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --help"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge -h"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash --help"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash -h"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash --helper"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash -hx"),
      true,
    );
    // --help=value is not a help flag token — routes to the rule;
    // the unless exempts it (hasFlag matches --help= via its
    // attached-value prefix — harmless invalid invocation; the
    // behavior delta vs the old regex is pinned in the unless tests).
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash --help="),
      true,
    );
  });
});

describe("github plugin — command anchors (normalized form)", () => {
  it("pr-body-from-vault-file anchors pr create/new/edit only", () => {
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr create --title x"), true);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr new --title x"), true);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr edit 46 --body x"), true);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr merge --squash"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr view 46"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh issue create --title x"), false);
  });

  it("pr-create-needs-issue-link anchors pr create/new only", () => {
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr create --title x"), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr new --title x"), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr edit 46 --title x"), false);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr merge --squash"), false);
  });

  it("pr-merge-needs-closing-keywords anchors pr merge only", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
  });

  it("issue-body-from-vault-file anchors issue create/edit only", () => {
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue create --title x"), true);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue edit 29 --body x"), true);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue close 29"), false);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue view 29"), false);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh pr create --title x"), false);
  });

  it("gh-repo-create-needs-seed anchors repo create/new only (new is the alias)", () => {
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo create x"), true);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo new x"), true);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo view x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo clone x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh pr create --title x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "echo gh repo create x"), false);
  });

  it("does not fire on non-gh basenames (echo …)", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "echo gh pr merge --squash"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "echo gh pr create --title x"), false);
  });
});
