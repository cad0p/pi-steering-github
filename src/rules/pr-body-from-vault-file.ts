// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

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
 * The anchor matches ANY leading-flag position (#41, shared
 * `LEADING_FLAG_PAIRS` unit): pre-widening, a flag-first form released
 * by the foreign gate bypassed this policy entirely; now it lands here.
 *
 * Strict — no override (schema default).
 */

import type { Rule } from "@cad0p/pi-steering";
import { BODY_STRIP } from "../helpers/body-strip.ts";
import { PR_BODY_ANCHOR } from "../helpers/patterns.ts";

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
