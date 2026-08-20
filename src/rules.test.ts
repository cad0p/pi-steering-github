// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the github plugin's pattern constants (pattern
 * contract). Import the constants from `./rules.ts` directly: the
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
import { INFO_ONLY } from "@cad0p/pi-steering-flags";
import {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ghRepoCreateNeedsSeed,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  issueBodyFromVaultFile,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  REPO_CREATE_PATTERN,
  rules,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./rules.ts";

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

  it("rules array ships in roster order (first-match-wins routing)", () => {
    assert.deepEqual(
      rules.map((r) => r.name),
      [
        "pr-body-from-vault-file",
        "pr-create-needs-issue-link",
        "pr-merge-needs-closing-keywords",
        "issue-body-from-vault-file",
        "gh-repo-create-needs-seed",
      ],
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
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge"), true);
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

describe("github plugin — pr-merge-needs-closing-keywords (normalized form)", () => {
  // The rule now anchors PR_MERGE_ANCHOR only; the help carve-out
  // lives in `unless: INFO_ONLY` (pi-steering-flags) and the subject
  // check in `when.condition` — both are exercised end-to-end in
  // `../integration.test.ts`. This describe pins the ANCHOR surface
  // (which commands route to the rule at all).
  it("anchors pr merge only (all forms route to the rule)", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge 123 -s -t x"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --help"), true); // anchor only — unless/condition decide
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
  });

  it("the rule carries the INFO_ONLY unless + a subject condition", () => {
    assert.equal(
      prMergeNeedsClosingKeywords.unless,
      INFO_ONLY,
      "unless must be the pi-steering-flags INFO_ONLY carve-out",
    );
    assert.equal(
      typeof prMergeNeedsClosingKeywords.when?.condition,
      "function",
      "subject keyword check must live in when.condition",
    );
  });
});
