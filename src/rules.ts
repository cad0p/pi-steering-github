// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Plugin-shipped rules for the github plugin.
 *
 * Enforces the "every PR must have at least one attached issue"
 * policy for gh CLI workflows, layered on top of the napkin vault
 * convention:
 *
 *   1. `pr-body-from-vault-file` (FIRST — write the body first)
 *      `gh pr create|new|edit` must take the body from
 *      `--body-file <(perl -0777 -pe '<BODY_STRIP>' <vault-file>)`
 *      — a process substitution running the pinned perl one-liner
 *      (removes the note's YAML frontmatter and the leading H1 — the
 *      note title, redundant under the gh PR title — before `gh`
 *      uploads it). Direct paths upload verbatim and are blocked,
 *      like inline `--body`. The path argument is additionally
 *      validated: it must resolve to a real file inside a napkin
 *      vault under `<repo>/prs/` (see `missingVaultBodyFile`).
 *
 *   2. `pr-create-needs-issue-link`
 *      `gh pr create|new` must carry a closing keyword
 *      (close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved)
 *      + `#N` in BOTH the inline `--title` value and the body — the
 *      body comes from the vault body file, so the check reads the
 *      file content (or falls back to inline `--body` text).
 *        - Title keyword → the squash merge subject inherits the PR
 *          title, so even a web-UI merge with a Title-Only commit
 *          policy auto-closes the issue from the commit subject (the
 *          merge box pre-fills the commit title — humans can't
 *          accidentally merge without the keyword).
 *        - Body keyword → the GitHub "linked issues" sidebar link +
 *          the description-channel auto-close on merge.
 *
 *   3. `pr-merge-needs-closing-keywords`
 *      `gh pr merge` must carry a closing keyword + `#N` in the
 *      `--subject` value (commit subject). GitHub scans the whole
 *      squash commit message for closing keywords, so the commit
 *      subject alone closes the issues — the commit body channel is
 *      optional at merge (relaxed from BOTH channels on 2026-08-16,
 *      user decision: the body requirement was redundant friction;
 *      the reason text now matches enforcement).
 *      `--help`/`-h` (read-only introspection) never blocks — no
 *      merge is requested.
 *
 *   4. `issue-body-from-vault-file`
 *      `gh issue create|edit` must take the body from the same
 *      pinned perl substitution as step 1 (under a `<repo>/issues/`
 *      directory in the vault).
 *
 *   5. `gh-repo-create-needs-seed`
 *      `gh repo create|new` must carry a seed flag (`--add-readme`,
 *      `--gitignore|-g`, `--license|-l`, `--template|-p`) — a bare
 *      create births an EMPTY repo (no branches, no commits),
 *      forcing the no-main-commit override dance and UNREVIEWED
 *      first content; the seeded flow sends the whole bootstrap
 *      through PRs.
 *
 * Ported from the live prototype that ran in the global pi-steering
 * config; the prototype phase ended with the first live validation
 * (2026-08-14, pi-steering PR #46 session: create gate fired, agent
 * complied in 7s). Reason strings are byte-identical to the
 * prototype — agents in the wild rely on them.
 *
 * Deliberately strict corners:
 *   - `--body-file` content can't be validated from the command
 *     string → inline bodies are blocked entirely (vault file is the
 *     source of truth: reviewable, persistent, kb-discoverable).
 *   - Keyword-per-issue for multiple issues; a bare `#N` mention
 *     never counts; colons and case variants are accepted.
 *   - Draft PRs are gated like any other PR (tracking issue allowed).
 *   - All rules are STRICT (no `noOverride: false` field — the
 *     schema defaults fail-closed): no agent-side override escape
 *     hatch; the policy is unconditional.
 *
 * Rule order matters — first-match-wins: see the `rules` export at
 * the bottom of this file.
 */

import type { Rule } from "@cad0p/pi-steering";
import { BODY_STRIP } from "./body-strip.ts";
import {
  bodyHasClosingKeyword,
  findFlagValue,
} from "./predicates/missing-vault-body-file.ts";

// ---------------------------------------------------------------------------
// Pattern constants (public export — pinned by the unit tests)
// ---------------------------------------------------------------------------
//
// These live with the rules that reference them so the matching
// behavior the tests pin is the matching behavior the rules ship —
// the rule `pattern` fields ARE these constants, so a change to a
// constant cannot drift from a rule (see `rules.test.ts`).

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
 * `gh` help flag as its own TOKEN (token-boundary guarded): `--help`
 * or `-h` preceded by start/space and followed by space/end. A
 * read-only introspection request — never a merge. The guard kills
 * glued lookalikes (`--helper`, `-hx`) that a bare `(?:--help|-h)`
 * alternative would falsely match inside a word (verified: with the
 * `i` flag, `--helper` contains `-h`).
 */
export const HELP_FLAG = `(?:^|\\s)(?:--help|-h)(?=\\s|$)`;

/**
 * `pr-merge-needs-closing-keywords` pattern: fires unless the command
 * carries a closing-keyword ref in the `--subject` value (short
 * `-t` form, `--flag=value` forms) or is a read-only `--help`/`-h`
 * introspection (never a merge — exempted). The commit subject is
 * part of the squash commit message — GitHub scans the whole message
 * for closing keywords, so the subject channel alone closes the
 * issues (the commit body is optional at merge).
 */
export const PR_MERGE_PATTERN = new RegExp(
  `^gh\\s+pr\\s+merge\\b(?!` +
    `(?:[\\s\\S]*${HELP_FLAG}` + // --help/-h token anywhere → exempt (read-only)
    `|[\\s\\S]*${SUBJECT_WITH_REF}))`, // …or a --subject closing ref
  "i",
);

/** `issue-body-from-vault-file` anchor: issue create/edit. */
export const ISSUE_BODY_ANCHOR = /^gh\s+issue\s+(?:create|edit)\b/i;

/** `gh-repo-create-needs-seed` anchor: repo create/new (new is the gh alias). */
export const REPO_CREATE_ANCHOR = /^gh\s+repo\s+(?:create|new)\b/i;

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

/**
 * `pr-body-from-vault-file` — PR bodies must come from a vault note,
 * uploaded through the pinned perl substitution (create, new, and
 * edit): `--body-file <(perl -0777 -pe '<BODY_STRIP>' <vault-file>)`
 * — the one-liner strips the YAML frontmatter and the leading H1
 * (the note title, redundant under the gh PR title) before `gh`
 * uploads the content. Direct paths (verbatim upload) and
 * inline `--body` are blocked. The path argument is additionally
 * validated (see `missingVaultBodyFile`): it must resolve to a real
 * file inside a napkin vault under `<repo>/prs/`. The
 * closing-keyword content check belongs to `pr-create-needs-issue-link`.
 *
 * Strict — no override (schema default).
 */
export const prBodyFromVaultFile = {
  name: "pr-body-from-vault-file",
  tool: "bash",
  field: "command",
  pattern: PR_BODY_ANCHOR,
  when: { missingVaultBodyFile: { section: "prs" } },
  reason:
    `PR bodies must come from a body file in the napkin vault:\n` +
    `  gh pr create --title "..." --body-file ` +
    `<(perl -0777 -pe '${BODY_STRIP}' ` +
    `<vault>/**/<repo>/prs/YYYY-MM-DD-pr<N>-<slug>.md)\n`,
} as const satisfies Rule;

/**
 * `pr-create-needs-issue-link` — a PR may not be opened without at
 * least one attached issue: a closing keyword + `#N` in BOTH the
 * inline `--title` value and the body (stripped vault body-file
 * content, with inline `--body` as a fallback). Fires when EITHER is missing
 * (`when.condition` is an OR — the pattern only anchors the command).
 *
 * Does NOT fire on other gh subcommands. Fires on draft PRs without
 * keywords too (a tracking issue is the allowed pattern while a draft
 * is open). Strict — no override (schema default).
 */
export const prCreateNeedsIssueLink = {
  name: "pr-create-needs-issue-link",
  tool: "bash",
  field: "command",
  pattern: PR_CREATE_ANCHOR,
  when: {
    condition: async (ctx) => {
      const title = findFlagValue(ctx, ["--title", "-t"]);
      const titleOk = title !== null && new RegExp(ISSUE_REF, "i").test(title);
      return !titleOk || !(await bodyHasClosingKeyword(ctx));
    },
  },
  reason:
    `A PR must close at least one issue — put the closing keyword in BOTH the ` +
    `title and body:\n` +
    `  e.g: title: "feat: x (closes #12)"; body: contains "Closes #12"\n` +
    `- Title keyword: makes the issue(s) auto-close.\n` +
    `- Body keyword: only links the issue(s) to the PR on a Title-Only squash merge.\n` +
    `- Multiple issues: repeat the keyword per issue — "Closes #A, closes #B" — ` +
    `"Closes #A #B" honors only the first number.`,
} as const satisfies Rule;

/**
 * `pr-merge-needs-closing-keywords` — a PR may not be merged without
 * a closing keyword + `#N` in the `--subject` value (commit subject;
 * short `-t` form, `--flag=value` forms). Fires unless the subject
 * carries one. GitHub scans the whole squash commit message for
 * closing keywords, so the commit subject alone closes the issues
 * — the commit body is optional at merge (relaxed from BOTH channels
 * on 2026-08-16, user decision).
 *
 * Strict — no override (schema default).
 */
export const prMergeNeedsClosingKeywords = {
  name: "pr-merge-needs-closing-keywords",
  tool: "bash",
  field: "command",
  pattern: PR_MERGE_PATTERN,
  reason:
    `Merging requires a closing keyword in the squash commit subject ` +
    `— every PR must close at least one issue:\n` +
    `  gh pr merge --squash --subject "feat: x (closes #12)"\n` +
    `- Repeat the keyword per issue — "Closes #A #B" honors only the first number.\n`,
} as const satisfies Rule;

/**
 * `issue-body-from-vault-file` — issue bodies must come from a vault
 * note, uploaded through the same pinned perl substitution (create
 * and edit): `--body-file
 * <(perl -0777 -pe '<BODY_STRIP>' <vault-file>)`. Direct
 * paths (verbatim upload) and inline `--body` are blocked. The path
 * argument is additionally validated (see `missingVaultBodyFile`):
 * it must resolve to a real file inside a napkin vault under
 * `<repo>/issues/`. No keyword requirement (issues close nothing).
 *
 * Strict — no override (schema default).
 */
export const issueBodyFromVaultFile = {
  name: "issue-body-from-vault-file",
  tool: "bash",
  field: "command",
  pattern: ISSUE_BODY_ANCHOR,
  when: { missingVaultBodyFile: { section: "issues" } },
  reason:
    `Issue bodies must come from a body file in the napkin vault:\n` +
    `  gh issue create --title "..." --body-file ` +
    `<(perl -0777 -pe '${BODY_STRIP}' ` +
    `<vault>/**/<repo>/issues/YYYY-MM-DD-issue<N>-<slug>.md)\n` +
    `- If foreign issue: cd to the repo you want to file the issue; ` +
    `REQUIREMENT: have a foreign subagent maintainer loop before filing`,
} as const satisfies Rule;

/**
 * `gh-repo-create-needs-seed` — `gh repo create|new` must carry a
 * seed flag (`--add-readme`, `--gitignore|-g`, `--license|-l`,
 * `--template|-p`, long or short form, ` ` or `=` value form). A
 * bare create births an EMPTY repo (zero branches, zero commits):
 * `main` can only be born by pushing past the `no-main-commit`
 * gates — the steering-override dance and UNREVIEWED first content.
 * The seeded flow sends the whole bootstrap through the normal
 * pipeline (fetch → feature branch → commit → push → PR → squash
 * merge); the seed commit is the PR's base, so the PR diff replaces
 * it and the first content is reviewed.
 *
 * Known limitation (deliberate): a seed-looking token inside a
 * QUOTED flag value (e.g. `--description "see --license mit"`)
 * falsely exempts — the `(?:^|\s)` guard kills only GLUED
 * lookalikes; same value-region class as the PR_* patterns, and the
 * walker contract is the plugin's foundation.
 *
 * Strict — no override (schema default).
 */
export const ghRepoCreateNeedsSeed = {
  name: "gh-repo-create-needs-seed",
  tool: "bash",
  field: "command",
  pattern: REPO_CREATE_PATTERN,
  reason:
    "gh repo create must seed the repo — a bare create births an EMPTY repo (no branches, no commits), " +
    "forcing UNREVIEWED first content. Use seed flags and seek explicit user approval for PR merge.\n" +
    "  gh repo create cad0p/<name> --add-readme\n" +
    "- Seed flags: --add-readme (recommended), --license <x>, --gitignore <x>, --template <repo>.\n" +
    "- The seed commit is the PR's base — the PR diff replaces the README.",
} as const satisfies Rule;

/**
 * Suggested rules for the github plugin.
 *
 * **Order matters — first-match-wins** (the engine routes on the
 * first matching rule): `pr-body-from-vault-file` FIRST so the agent
 * writes the vault body file before fiddling with keywords, then the
 * issue-link rule, then merge, then the issue body-file rule, then
 * `gh-repo-create-needs-seed` LAST — appended, never reordered: its
 * `^gh\s+repo\s` anchor cannot overlap the four `^gh\s+(?:pr|issue)\s`
 * anchors, so first-match routing is unaffected.
 * Reordering for stylistic reasons changes which rule an agent sees
 * when several match; pinned via `src/rules.test.ts` (pattern
 * contracts) and asserted end-to-end in `src/integration.test.ts`.
 */
export const rules = [
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  issueBodyFromVaultFile,
  ghRepoCreateNeedsSeed,
] as const satisfies readonly Rule[];
