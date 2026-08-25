// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `issue-body-from-vault-file` — issue bodies must come from a vault
 * note, uploaded through the same pinned perl substitution (create
 * and edit): `--body-file
 * <(perl -0777 -pe '<BODY_STRIP>' <vault-file>)`. Direct
 * paths (verbatim upload) and inline `--body` are blocked. The path
 * argument is additionally validated (see `missingVaultBodyFile`):
 * it must resolve to a real file inside a napkin vault under
 * `<repo>/issues/`. No keyword requirement (issues close nothing).
 * The anchor matches ANY leading-flag position (#41, shared
 * `LEADING_FLAG_PAIRS` unit) — a gate-released flag-first form lands
 * here instead of bypassing the policy.
 *
 * Strict — no override (schema default).
 */

import type { Rule } from "@cad0p/pi-steering";
import { BODY_STRIP } from "../helpers/body-strip.ts";
import { ISSUE_BODY_ANCHOR } from "../helpers/patterns.ts";

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
