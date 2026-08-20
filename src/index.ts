// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * pi-steering-github — GitHub workflow rules for pi-steering.
 *
 * The "every PR must have at least one attached issue" policy for gh
 * CLI workflows, plus the napkin-vault body-file policy for PR and
 * issue bodies. Ported from the live prototype that ran in the global
 * pi-steering config (first live validation 2026-08-14, pi-steering
 * PR #46 session: create gate fired, agent complied in 7s) and shaped
 * after the pi-steering-flags precedent — the first official external
 * plugin:
 *
 *   - Package name: `pi-steering-<domain>` mirroring
 *     `@cad0p/pi-steering` core.
 *   - PeerDep on `@cad0p/pi-steering`; runtime dep on
 *     `@cad0p/pi-napkin` (the `./steering` subpath ships compiled JS
 *     since 0.7.0-20260814.0, so plain-node tests work).
 *   - One predicate exported as a `Plugin`; the rules, the pattern
 *     constants, and the arg helpers re-exported for unit tests and
 *     `when.condition` escape-hatch use.
 *
 * The plugin ships six rules, all STRICT (no `noOverride: false` —
 * the schema defaults fail-closed, so the policy is unconditional):
 *
 *   - `pr-body-from-vault-file`      — PR bodies come from vault
 *                                      body files under `<repo>/prs/`.
 *   - `pr-create-needs-issue-link`   — closing keyword + `#N` in
 *                                      BOTH title and body.
 *   - `pr-merge-needs-closing-keywords` — closing keyword + `#N` in
 *                                      the `--subject` value (`--help`/
 *                                      `--version`/GitHub `-h` read-only
 *                                      introspection never blocks).
 *   - `issue-body-from-vault-file`   — issue bodies come from vault
 *                                      body files under `<repo>/issues/`.
 *   - `gh-repo-create-needs-seed`    — `gh repo create|new` must
 *                                      carry a seed flag; a bare
 *                                      create births an EMPTY repo.
 *
 *   - `gh-repo-flag-before-subcommand` — flag-first `gh -R x/y
 *                                      pr|issue …` targets a FOREIGN
 *                                      repo — redirect (foreign
 *                                      subagent maintainer loop).
 *
 * See this package's README for usage examples and the per-rule
 * rationale, and the pi-steering README "Writing plugins" section for
 * the design rationale.
 *
 * `declare global` lives here (alongside the plugin definition) so
 * `import "@cad0p/pi-steering-github"` pulls the registry
 * augmentation in transitively — `when: { missingVaultBodyFile: … }`
 * typechecks in user configs without a separate type-only import.
 */

import type { Plugin, PredicateShape } from "@cad0p/pi-steering";
import { missingVaultBodyFile } from "./predicates/index.ts";
import { rules } from "./rules/index.ts";

declare global {
  interface PiSteeringPredicates {
    /**
     * True when the command's `--body-file` is NOT a valid vault
     * body file for `args.section` (`"prs"` | `"issues"`):
     * absent, unreadable, outside a napkin vault (`.napkin/`
     * walk-up), or not under a `<repo>/<section>/` directory
     * (`<repo>` = origin URL basename, falling back to the cwd
     * folder name when the remote is unresolvable). Fail-closed:
     * anything unverifiable counts as missing.
     */
    missingVaultBodyFile: PredicateShape<{ section: "prs" | "issues" }>;
  }
}

/**
 * The github plugin. Default export so `import githubPlugin from
 * "@cad0p/pi-steering-github"` gives you the whole thing.
 *
 * `as const satisfies Plugin` (rather than `: Plugin`) preserves the
 * literal `name: "github"` in the inferred type — the input to
 * `defineConfig`'s plugin-name / predicate-name inference (typo
 * checking on `disabledRules` / `disabledPlugins`).
 *
 * Rule order comes from `rules` (first-match-wins): the vault
 * body-file rule runs FIRST so the agent writes the body file before
 * fiddling with keywords, then the issue-link rule, then merge, then
 * the issue body-file rule, then `gh-repo-create-needs-seed` (no
 * anchor overlap — `gh repo …` shares no prefix with the
 * `gh pr|issue …` anchors). See `./rules/index.ts` for the
 * rationale.
 */
export const githubPlugin = {
  name: "github",
  predicates: { missingVaultBodyFile },
  rules,
} as const satisfies Plugin;

export default githubPlugin;

export {
  argText,
  BODY_STRIP,
  bodyHasClosingKeyword,
  findBodyFileValue,
  findFlagValue,
  missingVaultBodyFile,
  parseBodyFileArg,
  resolveAgainstCwd,
  unquote,
} from "./predicates/index.ts";
// Named re-exports for consumers that want to pick pieces: the
// shipped rules (or the `rules` roster itself), the pattern constants
// (pinned by the unit tests), the predicate handler, and the arg
// helpers (`findBodyFileValue` / `parseBodyFileArg` parse the
// pinned perl substitution form) for `when.condition` escape-hatch
// use.
export {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ghRepoCreateNeedsSeed,
  ghRepoFlagBeforeSubcommand,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  issueBodyFromVaultFile,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  REPO_CREATE_ANCHOR,
  REPO_CREATE_PATTERN,
  REPO_CREATE_SEED_FLAG,
  REPO_FLAG_ANCHOR,
  rules,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./rules/index.ts";
