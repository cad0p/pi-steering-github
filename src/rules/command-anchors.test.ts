// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Command-anchor pins for the non-foreign rules (normalized form):
 * which commands route to each rule at all. The rules' `pattern`
 * fields ARE the exported constants, so these tests pin the exact
 * behavior the rules ship.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ISSUE_BODY_ANCHOR,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  REPO_CREATE_PATTERN,
  REPO_FLAG_ANCHOR,
} from "./index.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — gh-repo-flag-before-subcommand (normalized form)", () => {
  it("does not route read-only forms, excluded subcommands, or -R after the subcommand", () => {
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
      blocked(REPO_FLAG_ANCHOR, "gh pr create -R cad0p/x --title t"),
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
  });

  it("the anchor is a pure router: --help/-h and non-repo flags still route, the UNLESS decides", () => {
    // The anchor does NOT decide help — the token-level `unless`
    // carve-out does (so a `--help` inside a quoted value never
    // falsely exempts). These route to the rule and are allowed by
    // the `unless` fn.
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
