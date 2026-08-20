// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Bundle re-export for the rules roster, the rule objects, the
 * pattern constants, and `foreignRepoReason`. Interim form —
 * points at `../rules.ts` until the per-rule split lands.
 */
export {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  foreignRepoReason,
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
} from "../rules.ts";
