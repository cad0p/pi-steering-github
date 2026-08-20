// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `pr-merge-needs-closing-keywords` pins (normalized form).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PR_MERGE_ANCHOR, prMergeNeedsClosingKeywords } from "./index.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — pr-merge-needs-closing-keywords (normalized form)", () => {
  // The rule now anchors PR_MERGE_ANCHOR only; the help carve-out
  // and the subject check live in `when.condition` on the
  // walker-parsed argv (token-level, quote-aware) — exercised
  // end-to-end in `../integration.test.ts`. This describe pins the
  // ANCHOR surface (which commands route to the rule at all).
  it("anchors pr merge only (all forms route to the rule)", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge 123 -s -t x"), true);
    // The anchor itself does NOT decide help — the condition does.
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --help"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
  });

  it("the rule gates via when.condition only (no string-level unless)", () => {
    const rule = prMergeNeedsClosingKeywords as unknown as {
      unless?: unknown;
      when?: { condition?: unknown };
    };
    assert.equal(
      rule.unless,
      undefined,
      "no unless — the help carve-out must be token-level, not string-level",
    );
    assert.equal(
      typeof rule.when?.condition,
      "function",
      "help carve-out + subject keyword check must live in when.condition",
    );
  });
});
