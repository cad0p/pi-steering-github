// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

// ---------------------------------------------------------------------------
// Pattern constants (public export — pinned by the unit tests)
// ---------------------------------------------------------------------------
//
// These live with the rules that reference them so the matching
// behavior the tests pin is the matching behavior the rules ship —
// the rule `pattern` fields ARE these constants, so a change to a
// constant cannot drift from a rule (see `rules/patterns.test.ts`).

/**
 * Closing-keyword family GitHub recognizes (docs: "Linking a pull
 * request to an issue"). Covers close/closes/closed, fix/fixes/fixed,
 * resolve/resolves/resolved.
 */
export const CLOSING_KEYWORD =
  "(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?)";

/**
 * A closing-keyword issue reference: `Closes #10`, `Closes: #10`,
 * `CLOSES #10` (colon optional, case-insensitive at use).
 */
export const ISSUE_REF = `${CLOSING_KEYWORD}\\s*:?\\s*#\\d+`;

/**
 * Matching runs against the WALKER-NORMALIZED command, not the raw
 * source: quoting is stripped, each parsed argument becomes one
 * space-joined token (quoted values keep their internal spaces), and
 * `--flag=value` stays glued. Verified against
 * `@cad0p/unbash-walker`'s `refToText` (`basename + args.join(" ")`).
 *
 * A flag's value region = the run of characters after the flag token
 * up to the next `\s-` pair (a space followed by `-` — the next
 * flag-looking token starts there). The reference must appear INSIDE
 * that region. Known limitation: a value containing a literal ` - `
 * (space-dash-space) truncates the region.
 */
const VALUE_REGION = `(?:(?!\\s-)[\\s\\S])*?`;

/** `--flag …closes #N…`, `-f …`, `--flag=…` — the VALUE must hold the ref. */
const flagValueWithRef = (long: string, short: string) =>
  `(?:${long}|${short})(?:\\s+|=)${VALUE_REGION}${ISSUE_REF}`;

/** `--title|-t` value must hold the ref (create). */
export const TITLE_WITH_REF = flagValueWithRef("--title", "-t");

/** `--subject|-t` value must hold the ref (merge — the commit subject). */
export const SUBJECT_WITH_REF = flagValueWithRef("--subject", "-t");

/** `--body|-b` value must hold the ref (create inline fallback). */
export const BODY_WITH_REF = flagValueWithRef("--body", "-b");

/**
 * The guarded leading-flag unit shared by ALL widened anchors (#41):
 * ANY number of leading flag(+value) pairs before a gated
 * subcommand. Reusing ONE constant keeps the anti-ReDoS value-guard
 * uniform — a pair's value arm (`[^\s-][^\s]*` — must not start
 * with `-`) makes every dash-led argv token classify as exactly one
 * flag, so non-match evaluation stays LINEAR-time; an unguarded
 * value arm (`[^\s]+`) lets every extra dash-token double the branch
 * count on non-matches (measured catastrophic backtracking, ~17s at
 * 40 tokens), and a per-anchor re-derivation would eventually ship
 * the bare star somewhere. Accepted cost: a BARE-dash value token
 * (`gh -F - pr create`) fits neither arm and stays unrouted. Zero
 * iterations = the classic subcommand-first match, so widening is
 * strictly additive.
 */
const LEADING_FLAG_PAIRS = "(?:-[^\\s]+(?:\\s+[^\\s-][^\\s]*)?\\s+)*";

/**
 * `pr-body-from-vault-file` anchor: pr create/new/edit, in ANY
 * leading-flag position (#41 widened with `LEADING_FLAG_PAIRS` —
 * pre-widening, a flag-first form RELEASED by the foreign gate
 * bypassed this policy entirely: no other anchor matched it; the
 * one-pair class had escaped since #39). The `missingVaultBodyFile`
 * leaf is argv-based (`findBodyFileValue` scans the whole walker
 * argv), so leading flags never affect the verdict.
 */
export const PR_BODY_ANCHOR = new RegExp(
  `^gh\\s+${LEADING_FLAG_PAIRS}pr\\s+(?:create|new|edit)\\b`,
  "i",
);

/**
 * `pr-create-needs-issue-link` anchor: pr create/new in ANY
 * leading-flag position (#41, same bypass-closure rationale as
 * `PR_BODY_ANCHOR`). The title/body checks are argv/value-based
 * (`findFlagValue`, `bodyHasClosingKeyword`) — position-independent.
 */
export const PR_CREATE_ANCHOR = new RegExp(
  `^gh\\s+${LEADING_FLAG_PAIRS}pr\\s+(?:create|new)\\b`,
  "i",
);

/**
 * `pr-merge-needs-closing-keywords` anchor: pr merge only, in ANY
 * leading-flag position (#41 — a released flag-first merge must LAND
 * on the subject policy, not bypass it). Fires unless the command
 * carries a closing-keyword ref in the `--subject`
 * value (short `-t` form, `--flag=value` forms) — the gate is fully
 * declarative on the walker-parsed argv (`not.infoOnly` +
 * `requiresFlagValue` predicates from `@cad0p/pi-steering-flags`;
 * zero condition code). `infoOnly` recognizes its safe default
 * `--help`/`--version` tokens plus GitHub's additive `-h`; attached
 * forms are included, while quoted values such as `--subject "see
 * --help"` remain real merge subjects. An exact quoted info token is
 * indistinguishable from a bare flag after quote removal and is an
 * accepted limitation. The commit subject is part of the squash
 * commit message — GitHub scans the whole message for closing
 * keywords, so the subject channel alone closes the issues (the
 * commit body is optional at merge).
 */
export const PR_MERGE_ANCHOR = new RegExp(
  `^gh\\s+${LEADING_FLAG_PAIRS}pr\\s+merge\\b`,
  "i",
);

/**
 * `issue-body-from-vault-file` anchor: issue create/edit in ANY
 * leading-flag position (#41, same bypass-closure rationale as
 * `PR_BODY_ANCHOR`); the `missingVaultBodyFile` leaf is argv-based.
 */
export const ISSUE_BODY_ANCHOR = new RegExp(
  `^gh\\s+${LEADING_FLAG_PAIRS}issue\\s+(?:create|edit)\\b`,
  "i",
);

/**
 * `gh-repo-create-needs-seed` anchor: repo create/new (new is the gh
 * alias). Deliberately NOT widened with `LEADING_FLAG_PAIRS` (#41
 * scope: no acceptance bullet covers flag-first repo-create shapes —
 * the target is the positional argument, so a leading `-R` there is
 * meaningless anyway); a flag-first `repo create` remains ungated by
 * the seed rule — candidate follow-up, noted under Known limitations.
 */
export const REPO_CREATE_ANCHOR = /^gh\s+repo\s+(?:create|new)\b/i;

/**
 * `gh-repo-flag-before-subcommand` pattern: a SHAPE ROUTER — a gated
 * `pr create|new|edit|merge` or `issue create|edit` preceded by ANY
 * number of leading flag(+value) pairs (built from
 * `LEADING_FLAG_PAIRS`, shared with the four per-subcommand anchors:
 * #41 lifted the one-pair cap — zero pairs = subcommand-first, one
 * pair = flag-first since #39, N pairs = newly routed; see there for
 * the anti-ReDoS value-guard and the bare-dash unrouted edge). It
 * only decides "is this a gated subcommand shape?" — whether the
 * command REPO-TARGETS is decided by the `foreignRepoTarget`
 * predicate's `-R/--repo` PRESENCE check on the walker argv (#39:
 * presence, not position — subcommand-first `-R x/y pr merge` routes
 * since the widening), via `@cad0p/pi-steering-flags`'
 * `hasFlag`/`getFlagValue` (arg layer, quote-aware). Commands
 * without any `-R/--repo` route but are RELEASED by the predicate
 * and fall through to the per-subcommand rules — which NOW match
 * flag-first forms too (same LEADING_FLAG_PAIRS widening), so a
 * released command LANDS on its policy instead of bypassing the
 * stack. The anchor deliberately OVERLAPS those anchors, and
 * correctness rests on the evaluator's first-firing-rule-wins
 * ordering plus that release fall-through, not on anchor
 * disjointness (pinned in patterns.test.ts). Slashless `-R upstream`
 * routes too (fork remote-name form → released by the predicate).
 * Greedy value consumption always backtracks until the tail matches,
 * so extra leading flags never mask a routable tail (`gh -t pr
 * merge` still routes — pinned). Anchored `^gh\s` (no `echo gh …`).
 * `repo create|new` is excluded by design; read-only `pr view`/
 * `issue list` never route. See the rule doc comment.
 */
export const REPO_FLAG_ANCHOR = new RegExp(
  `^gh\\s+${LEADING_FLAG_PAIRS}(?:pr\\s+(?:create|new|edit|merge)|issue\\s+(?:create|edit))\\b`,
  "i",
);

/**
 * A seed flag as its own token: long or short form, ` ` or `=`
 * value forms. Token-boundary guarded — glued lookalikes
 * (`foo--add-readme`, `-local`, `-public`) never match.
 */
export const REPO_CREATE_SEED_FLAG =
  "(?:^|\\s)(?:--add-readme|--gitignore|-g|--license|-l|--template|-p)(?=$|\\s|=)";

/**
 * Fires unless a seed flag token appears anywhere in the command.
 * Derived from `REPO_CREATE_ANCHOR` (its `source` + the `i` flag) so
 * the anchor constant can never drift from the shipped pattern.
 */
export const REPO_CREATE_PATTERN = new RegExp(
  `${REPO_CREATE_ANCHOR.source}(?![\\s\\S]*${REPO_CREATE_SEED_FLAG})`,
  "i",
);
