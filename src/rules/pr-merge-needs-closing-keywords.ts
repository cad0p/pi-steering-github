// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `pr-merge-needs-closing-keywords` — a PR may not be merged without
 * a closing keyword + `#N` in the `--subject` value (commit subject;
 * short `-t` form, `--flag=value` forms). Fires unless the subject
 * carries one. GitHub scans the whole squash commit message for
 * closing keywords, so the commit subject alone closes the issues
 * — the commit body is optional at merge (relaxed from BOTH channels
 * on 2026-08-16, user decision).
 *
 * Fully declarative gate — zero condition code (issue #23). The two
 * leaves compose as an AND of independent predicates shipped by
 * `@cad0p/pi-steering-flags`:
 *
 * - `not.infoOnly(["-h"])` exempts read-only introspection
 *   (--help/--version defaults plus GitHub's additive -h;
 *   token-level, so quoted values can't falsely exempt).
 * - `requiresFlagValue({ flags, matches })` enforces gh/cobra
 *   LAST-flag-wins semantics on the subject value across the
 *   `--subject`/`-t` aliases; absent, valueless, or non-matching →
 *   fires (fail-closed).
 *
 * See those predicates' docs for the full semantics and the accepted
 * exact-quoted-info-token limitation.
 *
 * Strict — no override (schema default).
 */

import type { Rule } from "@cad0p/pi-steering";
import { ISSUE_REF, PR_MERGE_ANCHOR } from "../helpers/patterns.ts";

export const prMergeNeedsClosingKeywords = {
  name: "pr-merge-needs-closing-keywords",
  tool: "bash",
  field: "command",
  pattern: PR_MERGE_ANCHOR,
  when: {
    not: { infoOnly: { extraFlags: ["-h"] } },
    requiresFlagValue: {
      flags: ["--subject", "-t"],
      matches: new RegExp(ISSUE_REF, "i"),
    },
  },
  reason:
    `Merging requires a closing keyword in the squash commit subject ` +
    `— every PR must close at least one issue:\n` +
    `  gh pr merge --squash --subject "feat: x (closes #12)"\n` +
    `- Repeat the keyword per issue — "Closes #A #B" honors only the first number.\n`,
} as const satisfies Rule;
