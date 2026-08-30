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
 *
 * Since #43 the `reason` is a dynamic `ReasonFn` (schema:
 * `reason: (ctx) => string | Promise<string>`, errors replaced by
 * the evaluator's fail-safe fallback): a `--body-file` substitution
 * whose inner command deviates from the pinned one-liner now carries
 * a byte-exact diagnostic (the divergent core spans with the byte
 * offset, or the two full command lines) before the canonical static
 * recipe — the predicate and this reason consume the SAME
 * `explainBodyFileArg` tag, so verdict and message never drift.
 */

import type { Rule } from "@cad0p/pi-steering";
import { BODY_STRIP } from "../helpers/body-strip.ts";
import {
  explainBodyFileArg,
  findBodyFileValue,
  renderBodyFileDiff,
} from "../helpers/pattern-args.ts";
import { PR_BODY_ANCHOR } from "../helpers/patterns.ts";

/** The canonical static recipe (byte-identity pinned in `index.test.ts`). */
const STATIC =
  `PR bodies must come from a body file in the napkin vault:\n` +
  `  gh pr create --title "..." --body-file ` +
  `<(perl -0777 -pe '${BODY_STRIP}' ` +
  `<vault>/**/<repo>/prs/YYYY-MM-DD-pr<N>-<slug>.md)\n`;

export const prBodyFromVaultFile = {
  name: "pr-body-from-vault-file",
  tool: "bash",
  field: "command",
  pattern: PR_BODY_ANCHOR,
  when: { missingVaultBodyFile: { section: "prs" } },
  reason: (ctx) => {
    const v = findBodyFileValue(ctx);
    return explainBodyFileArg(v) === "diff"
      ? `${renderBodyFileDiff(v)}\n\n${STATIC}`
      : STATIC;
  },
} as const satisfies Rule;
