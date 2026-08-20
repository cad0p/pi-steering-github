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

/** `pr-body-from-vault-file` anchor: pr create/new/edit. */
export const PR_BODY_ANCHOR = /^gh\s+pr\s+(?:create|new|edit)\b/i;

/** `pr-create-needs-issue-link` anchor: pr create/new. */
export const PR_CREATE_ANCHOR = /^gh\s+pr\s+(?:create|new)\b/i;

/**
 * `pr-merge-needs-closing-keywords` anchor: pr merge only. Fires
 * unless the command carries a closing-keyword ref in the `--subject`
 * value (short `-t` form, `--flag=value` forms) — the info-only
 * carve-out and subject check both live in `when.condition` against
 * the walker-parsed argv. `isInfoOnly` recognizes its safe default
 * `--help`/`--version` tokens plus GitHub's additive `-h`; attached
 * forms are included, while quoted values such as `--subject "see
 * --help"` remain real merge subjects. An exact quoted info token is
 * indistinguishable from a bare flag after quote removal and is an
 * accepted limitation. The commit subject is part of the squash
 * commit message — GitHub scans the whole message for closing
 * keywords, so the subject channel alone closes the issues (the
 * commit body is optional at merge).
 */
export const PR_MERGE_ANCHOR = /^gh\s+pr\s+merge\b/i;

/** `issue-body-from-vault-file` anchor: issue create/edit. */
export const ISSUE_BODY_ANCHOR = /^gh\s+issue\s+(?:create|edit)\b/i;

/** `gh-repo-create-needs-seed` anchor: repo create/new (new is the gh alias). */
export const REPO_CREATE_ANCHOR = /^gh\s+repo\s+(?:create|new)\b/i;

/**
 * `gh-repo-flag-before-subcommand` pattern: a PURE ROUTER — `gh`
 * with a global flag BEFORE the subcommand, then a gated
 * `pr create|new|edit|merge` or `issue create|edit`. It only decides
 * "is this a flag-first gated command?" — all VALUE parsing (flag
 * identity, target extraction, help carve-out) happens on the walker
 * argv via `@cad0p/pi-steering-flags`' `hasFlag`/`getFlagValue` in
 * the rule's `unless` fn (arg layer, quote-aware). The router is
 * deliberately loose: it also routes non-repo flags (`-v`,
 * `--hostname`) and slashless `-R upstream` — the `unless` releases
 * those (they are not repo-targeting / are fork remote-name forms).
 * Anchored `^gh\s` (no `echo gh …`). `repo create|new` is excluded
 * by design; read-only `pr view`/`issue list` never route. See the
 * rule doc comment.
 */
export const REPO_FLAG_ANCHOR =
  /^gh\s+-[^\s]+(?:\s+[^\s]+)?\s+(?:pr\s+(?:create|new|edit|merge)|issue\s+(?:create|edit))\b/i;

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
