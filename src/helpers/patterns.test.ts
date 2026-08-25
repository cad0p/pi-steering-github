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
import { performance } from "node:perf_hooks";
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
  it("routes gated subcommands with ANY number of leading flag(+value) pairs", () => {
    // Classic flag-first position: one leading flag(+value), then a
    // gated subcommand. Case-insensitive (`/i`): gh flags/subcommands are
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
    // Multi-pair shapes (#41): the star lifts the one-pair cap — the
    // two-leading-flag under-block (`gh --hostname h -R cad0p/x pr
    // merge` escaped the foreign gate entirely) is closed.
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --hostname h -R cad0p/x pr merge"),
      true,
    );
    assert.equal(
      blocked(
        REPO_FLAG_ANCHOR,
        "gh --verbose --repo=cad0p/x pr merge --squash",
      ),
      true,
    );
    // Cross-alias pairs: routing stays shape-only — WHICH target wins
    // (`-R x` vs `--repo y/z`, last-wins) is predicate-level business.
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R x --repo=y/z pr merge"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -a -b v -c w -R cad0p/x issue edit 3"),
      true,
    );
  });

  it("backtracking: greedy value consumption never masks a routable tail", () => {
    // The value arm tries greedily and backtracks until the tail
    // matches — extra leading flags can't swallow the subcommand.
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -t pr merge"), true);
  });

  it("linear time on non-matches: the [^\\s-] value-guard bars catastrophic backtracking (#41)", () => {
    // An UNGUARDED star (`[^\s]+` value arm) doubles its branch count
    // per dash-token on NON-matches — measured seconds at ~40 tokens;
    // the guard keeps classification deterministic (~0.02ms at 200).
    // The wall-clock bound pins that: a regression back to the bare
    // star fails this long before any human notices sluggishness.
    const cmd = `gh ${"-a ".repeat(200)}pr view`;
    const t0 = performance.now();
    const routed = blocked(REPO_FLAG_ANCHOR, cmd);
    const elapsed = performance.now() - t0;
    assert.equal(routed, false);
    assert.ok(
      elapsed < 50,
      `non-match took ${elapsed.toFixed(1)}ms — anti-ReDoS value-guard regressed`,
    );
  });

  it("bare-dash VALUE tokens stay unrouted under the guarded star (accepted #41 trade-off)", () => {
    // A lone `-` starts neither arm: not the flag arm (needs a char
    // after the dash) and not the guarded value arm (must not start
    // with `-`). Same unroutability class as today's anchor for every
    // shape carrying more pairs; pinned so it can't change silently.
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -F - pr create"), false);
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh --opt - pr merge"), false);
    // Dash-LED values are fine — they classify as another flag token:
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --cooldown -5 -R x/y pr create"),
      true,
    );
  });

  it("does not route read-only forms, excluded subcommands, or echo prefixes (even with multiple leading flags)", () => {
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
    // #41 exclusions hold under multiple leading flags too.
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "echo gh -R a/b -v pr create --title t"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -v -R cad0p/x pr view 12"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -v -R cad0p/x issue list"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -v -R cad0p/x repo create foo"),
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
    // #41 widening: leading flag(+value) pairs route too — a form
    // RELEASED by the foreign gate must LAND on this policy, not
    // bypass it (the one-pair class had escaped since #39).
    assert.equal(
      blocked(PR_BODY_ANCHOR, "gh -R x/y pr create --title x"),
      true,
    );
    assert.equal(
      blocked(PR_BODY_ANCHOR, "gh --hostname h pr edit 46 --body x"),
      true,
    );
    assert.equal(blocked(PR_BODY_ANCHOR, "gh -v -R x/y pr new x"), true);
  });

  it("pr-create-needs-issue-link anchors pr create/new only", () => {
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr create --title x"), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr new --title x"), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr edit 46 --title x"), false);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr merge --squash"), false);
    // #41 widening (flag-first lands on the policy):
    assert.equal(
      blocked(PR_CREATE_ANCHOR, "gh -R x/y pr create --title t"),
      true,
    );
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh -v pr new x"), true);
    // \b boundary survives the widening (subcommand spellings that
    // merely PREFIX a gated verb never match).
    assert.equal(
      blocked(PR_CREATE_ANCHOR, "gh -R x/y pr created --title t"),
      false,
    );
  });

  it("pr-merge-needs-closing-keywords anchors pr merge only", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
    // #41 widening (flag-first lands on the policy) + boundaries:
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh -R x/y pr merge --squash"), true);
    assert.equal(
      blocked(PR_MERGE_ANCHOR, "gh --hostname h pr merge --squash"),
      true,
    );
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh -v -R x/y pr merged"), false);
    assert.equal(
      blocked(PR_MERGE_ANCHOR, "echo gh -R x/y pr merge --squash"),
      false,
    );
  });

  it("issue-body-from-vault-file anchors issue create/edit only", () => {
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue create --title x"), true);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue edit 29 --body x"), true);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue close 29"), false);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue view 29"), false);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh pr create --title x"), false);
    // #41 widening (flag-first lands on the policy):
    assert.equal(
      blocked(ISSUE_BODY_ANCHOR, "gh -R x/y issue create --title x"),
      true,
    );
    assert.equal(
      blocked(ISSUE_BODY_ANCHOR, "gh --hostname h issue edit 29 --body x"),
      true,
    );
  });

  it("gh-repo-create-needs-seed anchors repo create/new only (new is the alias)", () => {
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo create x"), true);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo new x"), true);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo view x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo clone x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh pr create --title x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "echo gh repo create x"), false);
    // #41 widening: the seed gate covers flag-first creates too — a
    // bare one (no seed anywhere) blocks regardless of leading pairs…
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh -R x/y repo create foo"),
      true,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh --hostname h repo create foo"),
      true,
    );
    // …and a seeded flag-first create passes: seed flags AFTER the
    // subcommand are seen by the whole-command exemption scan.
    assert.equal(
      blocked(
        REPO_CREATE_PATTERN,
        "gh -v --hostname h repo create foo --add-readme",
      ),
      false,
    );
    // Seed flags BEFORE the subcommand count too — the widened anchor
    // consumes them, which is why REPO_CREATE_PATTERN's lookahead
    // scans from the START (a trailing scan would over-block these).
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh -g repo create foo"), false);
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh --template p/repo repo create x"),
      false,
    );
    // Quoted-value false-exemption quirk unchanged (accepted): the
    // seed token inside a QUOTED value still exempts at the string
    // level — token guard kills only GLUED lookalikes.
    assert.equal(
      blocked(
        REPO_CREATE_PATTERN,
        'gh repo create x --description "see --license mit"',
      ),
      false,
    );
  });

  it("#41 overlap sanity: a two-pair foreign-target merge matches BOTH the router and the merge anchor", () => {
    // Deliberate, documented overlap: correctness rests on roster
    // order (the redirect rule fires FIRST for foreign targets) plus
    // release fall-through (own/no-target commands land on THIS
    // anchor's policy), not on anchor disjointness.
    const cmd = "gh --hostname h -R x/y pr merge --squash";
    assert.equal(blocked(REPO_FLAG_ANCHOR, cmd), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, cmd), true);
    const cmdCreate = "gh -v -R x/y pr create --title t";
    assert.equal(blocked(REPO_FLAG_ANCHOR, cmdCreate), true);
    assert.equal(blocked(PR_BODY_ANCHOR, cmdCreate), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, cmdCreate), true);
  });

  it("does not fire on non-gh basenames (echo …)", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "echo gh pr merge --squash"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "echo gh pr create --title x"), false);
  });
});
