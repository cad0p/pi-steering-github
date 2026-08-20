// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * The rules roster plus the re-export bundle for the rule objects,
 * the pattern constants, and `foreignRepoReason`.
 */

import type { Rule } from "@cad0p/pi-steering";
import { ghRepoCreateNeedsSeed } from "./gh-repo-create-needs-seed.ts";
import { ghRepoFlagBeforeSubcommand } from "./gh-repo-flag-before-subcommand.ts";
import { issueBodyFromVaultFile } from "./issue-body-from-vault-file.ts";
import { prBodyFromVaultFile } from "./pr-body-from-vault-file.ts";
import { prCreateNeedsIssueLink } from "./pr-create-needs-issue-link.ts";
import { prMergeNeedsClosingKeywords } from "./pr-merge-needs-closing-keywords.ts";

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
 * when several match; pinned via `src/rules/index.test.ts` (roster
 * order) and asserted end-to-end in `src/integration.test.ts`.
 */
export const rules = [
  ghRepoFlagBeforeSubcommand,
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  issueBodyFromVaultFile,
  ghRepoCreateNeedsSeed,
] as const satisfies readonly Rule[];

export { ghRepoCreateNeedsSeed } from "./gh-repo-create-needs-seed.ts";
export {
  foreignRepoReason,
  ghRepoFlagBeforeSubcommand,
} from "./gh-repo-flag-before-subcommand.ts";
export { issueBodyFromVaultFile } from "./issue-body-from-vault-file.ts";
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
} from "./patterns.ts";
export { prBodyFromVaultFile } from "./pr-body-from-vault-file.ts";
export { prCreateNeedsIssueLink } from "./pr-create-needs-issue-link.ts";
export { prMergeNeedsClosingKeywords } from "./pr-merge-needs-closing-keywords.ts";
