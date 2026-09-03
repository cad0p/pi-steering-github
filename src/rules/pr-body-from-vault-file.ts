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
 * recipe. Since #50 every other blocked stage renders mirror + trace
 * + slotted recipe from the shared `diagnose()` struct — the
 * predicate and this reason consume the SAME struct, so verdict and
 * message never drift.
 */

import type { Rule } from "@cad0p/pi-steering";
import {
  renderDegradedReason,
  renderDiagnosedReason,
  renderStaticRecipe,
} from "../helpers/body-file-reason.ts";
import {
  explainBodyFileArg,
  findBodyFileValue,
  renderBodyFileDiff,
} from "../helpers/pattern-args.ts";
import { PR_BODY_ANCHOR } from "../helpers/patterns.ts";
import { diagnose } from "../predicates/missing-vault-body-file.ts";

/** The canonical static recipe (byte-identity pinned in `index.test.ts`). */
const STATIC = renderStaticRecipe("prs");

export const prBodyFromVaultFile = {
  name: "pr-body-from-vault-file",
  tool: "bash",
  field: "command",
  pattern: PR_BODY_ANCHOR,
  when: { missingVaultBodyFile: { section: "prs" } },
  reason: async (ctx) => {
    const v = findBodyFileValue(ctx);
    if (explainBodyFileArg(v) === "diff") {
      return `${renderBodyFileDiff(v)}\n\n${STATIC}`;
    }
    // Same struct the predicate verdict came from — mirror + trace +
    // slotted recipe (#50). A throwing reason is replaced wholesale
    // by the evaluator's fail-safe fallback, so the diagnose call is
    // wrapped with a degraded mirror+recipe fallback that never throws.
    try {
      return renderDiagnosedReason(await diagnose(ctx, "prs"), "prs");
    } catch {
      return renderDegradedReason(v, "prs");
    }
  },
} as const satisfies Rule;
