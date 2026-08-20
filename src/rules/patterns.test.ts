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
import { ghRepoCreateNeedsSeed } from "./gh-repo-create-needs-seed.ts";
import { issueBodyFromVaultFile } from "./issue-body-from-vault-file.ts";
import {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  REPO_CREATE_PATTERN,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./patterns.ts";
import { prBodyFromVaultFile } from "./pr-body-from-vault-file.ts";
import { prCreateNeedsIssueLink } from "./pr-create-needs-issue-link.ts";
import { prMergeNeedsClosingKeywords } from "./pr-merge-needs-closing-keywords.ts";

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
