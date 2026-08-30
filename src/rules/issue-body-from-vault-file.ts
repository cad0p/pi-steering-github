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
 *
 * Since #43 the `reason` is a dynamic `ReasonFn` (same shared
 * diagnostic as `pr-body-from-vault-file` — both rules consume the
 * SAME `explainBodyFileArg` + `renderBodyFileExplain` helpers, so
 * the byte-diff format can never drift between them).
 */

import type { Rule } from "@cad0p/pi-steering";
import { BODY_STRIP } from "../helpers/body-strip.ts";
import {
  explainBodyFileArg,
  findBodyFileValue,
  renderBodyFileExplain,
} from "../helpers/pattern-args.ts";
import { ISSUE_BODY_ANCHOR } from "../helpers/patterns.ts";

/** The canonical static recipe (byte-identity pinned in `index.test.ts`). */
const STATIC =
  `Issue bodies must come from a body file in the napkin vault:\n` +
  `  gh issue create --title "..." --body-file ` +
  `<(perl -0777 -pe '${BODY_STRIP}' ` +
  `<vault>/**/<repo>/issues/YYYY-MM-DD-issue<N>-<slug>.md)\n` +
  `- If foreign issue: cd to the repo you want to file the issue; ` +
  `REQUIREMENT: have a foreign subagent maintainer loop before filing`;

export const issueBodyFromVaultFile = {
  name: "issue-body-from-vault-file",
  tool: "bash",
  field: "command",
  pattern: ISSUE_BODY_ANCHOR,
  when: { missingVaultBodyFile: { section: "issues" } },
  reason: (ctx) =>
    renderBodyFileExplain(explainBodyFileArg(findBodyFileValue(ctx)), STATIC),
} as const satisfies Rule;
