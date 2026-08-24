// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `pr-merge-needs-closing-keywords` pins (normalized form).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ISSUE_REF, PR_MERGE_ANCHOR } from "../helpers/patterns.ts";
import { prMergeNeedsClosingKeywords } from "./pr-merge-needs-closing-keywords.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — pr-merge-needs-closing-keywords (normalized form)", () => {
  // The rule now anchors PR_MERGE_ANCHOR only; the help carve-out
  // and the subject check live in the declarative `when` leaves
  // (`not.infoOnly` + `requiresFlagValue`, walker-parsed argv,
  // token-level, quote-aware) — exercised end-to-end in
  // `../integration.test.ts`. This describe pins the ANCHOR surface
  // (which commands route to the rule at all).
  it("anchors pr merge only (all forms route to the rule)", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge 123 -s -t x"), true);
    // The anchor itself does NOT decide help — the when leaves do.
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --help"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
  });

  it("gates fully declaratively: not.infoOnly + requiresFlagValue, zero condition code", () => {
    const rule = prMergeNeedsClosingKeywords as unknown as {
      unless?: unknown;
      when?: {
        condition?: unknown;
        not?: { infoOnly?: unknown };
        requiresFlagValue?: { flags?: readonly string[]; matches?: RegExp };
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
    // --version defaults + GitHub's additive -h).
    assert.deepEqual(
      rule.when?.not?.infoOnly,
      { extraFlags: ["-h"] },
      "the info-only carve-out must be negated via not:",
    );
    // Subject leaf: LAST-flag-wins across the --subject/-t aliases;
    // the pattern is compared by source/flags (deepEqual compares
    // RegExps exactly that way), not by identity.
    assert.deepEqual(
      rule.when?.requiresFlagValue,
      {
        flags: ["--subject", "-t"],
        matches: new RegExp(ISSUE_REF, "i"),
      },
      "requiresFlagValue must pin the alias set and the ISSUE_REF match",
    );
  });
});
