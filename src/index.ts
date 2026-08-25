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
 *   - `gh-repo-flag-before-subcommand` — an invocation carrying
 *                                      `-R x/y` into a gated
 *                                      `pr|issue …` mutation targets
 *                                      a FOREIGN repo — redirect
 *                                      (foreign subagent maintainer
 *                                      loop).
 *
 * See this package's README for usage examples and the per-rule
 * rationale, and the pi-steering README "Writing plugins" section for
 * the design rationale.
 *
 * `declare global` lives here (alongside the plugin definition) so
 * `import "@cad0p/pi-steering-github"` pulls the registry
 * augmentation in transitively — `when: { missingVaultBodyFile: … }`
 * typechecks in user configs without a separate type-only import.
 *
 * Layout mirrors the canonical `examples/work-item-plugin` shape
 * (ADR §15): the per-item rule / predicate / helper files live in
 * `./rules/`, `./predicates/`, `./helpers/`, and THIS module is the
 * single assembly point — it deep-imports the per-item files, builds
 * the `rules` roster (order = first-match-wins, see below) and the
 * plugin object, and re-exports the public surface.
 */

import type { Plugin, PredicateShape, Rule } from "@cad0p/pi-steering";
import type { ForeignRepoTargetArgs } from "./predicates/foreign-repo-target.ts";
import { foreignRepoTarget } from "./predicates/foreign-repo-target.ts";
import { missingVaultBodyFile } from "./predicates/missing-vault-body-file.ts";
import { ghRepoCreateNeedsSeed } from "./rules/gh-repo-create-needs-seed.ts";
import { ghRepoFlagBeforeSubcommand } from "./rules/gh-repo-flag-before-subcommand.ts";
import { issueBodyFromVaultFile } from "./rules/issue-body-from-vault-file.ts";
import { prBodyFromVaultFile } from "./rules/pr-body-from-vault-file.ts";
import { prCreateNeedsIssueLink } from "./rules/pr-create-needs-issue-link.ts";
import { prMergeNeedsClosingKeywords } from "./rules/pr-merge-needs-closing-keywords.ts";

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
    /**
     * `when.foreignRepoTarget` — true (rule BLOCKS) when the
     * invocation carries an effective `-R/--repo` targeting a
     * FOREIGN repository (#39: PRESENCE of the flag, not its
     * position): the effective `-R`/`--repo` target's basename
     * differs from the cwd repo's basename. Backs
     * `gh-repo-flag-before-subcommand`.
     *
     * Fail-closed doctrine: an unparsable target (now only a
     * valueless or empty-valued LAST alias occurrence — glued short
     * forms resolve via `{ gluedShorts: ["R"] }`, upstream
     * cad0p/pi-steering-flags#11), a walker-unknown cwd, or an
     * unresolvable repo all BLOCK.
     * Released without consulting any knob: invocations carrying NO
     * `-R`/`--repo` token anywhere (they fall through to the
     * per-subcommand rules), and slashless remote-name forms (`-R
     * upstream`).
     *
     * Basename policy = fork→upstream tolerance (#19), hardcoded —
     * basename EQUALITY allows `gh -R upstream/foo pr create` from
     * inside the `me/foo` clone; there is deliberately no `matchBy`
     * / `flags` arg, the policy is documented, not configurable.
     *
     * Boolean-bare shape (the `infoOnly` precedent): bare `true` ≡
     * spread `{}` — both enable the gate and run the argv logic
     * (both verified typechecking); bare `false` NEVER fires
     * (handlers receive the leaf value verbatim, so the handler's
     * step-0 `args === false` guard makes a disabled config inert).
     */
    foreignRepoTarget: PredicateShape<boolean, ForeignRepoTargetArgs>;
  }
}

/**
 * The rules roster, in first-match-wins order (the engine routes on
 * the first matching rule): `pr-body-from-vault-file` FIRST so the
 * agent writes the vault body file before fiddling with keywords,
 * then the issue-link rule, then merge, then the issue body-file
 * rule, then `gh-repo-create-needs-seed` LAST — appended, never
 * reordered: its `^gh\s+repo\s` anchor cannot overlap the four
 * widened `pr|issue` anchors (#41 — their shared leading unit only
 * consumes DASH-led flag tokens, so `repo` is never matchable by
 * them), so first-match routing is unaffected.
 * Reordering for stylistic reasons changes which rule an agent sees
 * when several match; pinned via `src/index.test.ts` (roster order)
 * and asserted end-to-end in `src/integration.test.ts`.
 */
export const rules = [
  ghRepoFlagBeforeSubcommand,
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  issueBodyFromVaultFile,
  ghRepoCreateNeedsSeed,
] as const satisfies readonly Rule[];

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
 * `gh pr|issue …` anchors). See the `rules` doc comment above for
 * the rationale.
 */
export const githubPlugin = {
  name: "github",
  predicates: { missingVaultBodyFile, foreignRepoTarget },
  rules,
} as const satisfies Plugin;

export default githubPlugin;

export { bodyHasClosingKeyword } from "./helpers/body-keyword.ts";
export {
  argText,
  findBodyFileValue,
  findFlagValue,
  parseBodyFileArg,
  resolveAgainstCwd,
  unquote,
} from "./helpers/pattern-args.ts";
// Named re-exports for consumers that want to pick pieces: the
// shipped rules (or the `rules` roster itself), the pattern constants
// (pinned by the unit tests), the predicate handler, and the arg
// helpers (`findBodyFileValue` / `parseBodyFileArg` parse the
// pinned perl substitution form) for `when.condition` escape-hatch
// use.
export {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  REPO_CREATE_ANCHOR,
  REPO_CREATE_PATTERN,
  REPO_CREATE_SEED_FLAG,
  REPO_FLAG_ANCHOR,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./helpers/patterns.ts";
export type { ForeignRepoTargetArgs } from "./predicates/foreign-repo-target.ts";
export { foreignRepoTarget } from "./predicates/foreign-repo-target.ts";
export {
  BODY_STRIP,
  missingVaultBodyFile,
} from "./predicates/missing-vault-body-file.ts";
export { ghRepoCreateNeedsSeed } from "./rules/gh-repo-create-needs-seed.ts";
export { ghRepoFlagBeforeSubcommand } from "./rules/gh-repo-flag-before-subcommand.ts";
export { issueBodyFromVaultFile } from "./rules/issue-body-from-vault-file.ts";
export { prBodyFromVaultFile } from "./rules/pr-body-from-vault-file.ts";
export { prCreateNeedsIssueLink } from "./rules/pr-create-needs-issue-link.ts";
export { prMergeNeedsClosingKeywords } from "./rules/pr-merge-needs-closing-keywords.ts";
