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
 * Strict — no override (schema default).
 */

import type { Rule } from "@cad0p/pi-steering";
import { isInfoOnly } from "@cad0p/pi-steering-flags";
import { unquote } from "../predicates/missing-vault-body-file.ts";
import { ISSUE_REF, PR_MERGE_ANCHOR } from "./patterns.ts";

export const prMergeNeedsClosingKeywords = {
  name: "pr-merge-needs-closing-keywords",
  tool: "bash",
  field: "command",
  pattern: PR_MERGE_ANCHOR,
  when: {
    condition: async (ctx) => {
      const args = ctx.input.args ?? [];
      // Help/version are read-only introspection — never a merge.
      // isInfoOnly supplies the safe --help/--version defaults and
      // GitHub's additive -h. Its token-level argv check keeps
      // `--subject "see --help"` / `"see --version"` gated; attached
      // forms such as `--help=value` are harmless and allowed. An
      // exact quoted info token is indistinguishable from a bare flag
      // after quote removal (an accepted helper limitation).
      if (isInfoOnly(args, ["-h"])) return false;
      // gh/cobra semantics: the LAST flag occurrence wins. Scan from
      // the end so `-t 'see #13' --subject 'closes #12'` uses the
      // `--subject` value (a bare `-t` earlier in the line is
      // overridden, not blocking).
      let subject: string | null = null;
      for (let i = args.length - 1; i >= 0; i--) {
        const t = args[i]?.text ?? "";
        if (t === "--subject" || t === "-t") {
          subject = unquote(args[i + 1]?.text ?? "");
          break;
        }
        if (t.startsWith("--subject=")) {
          subject = unquote(t.slice("--subject=".length));
          break;
        }
      }
      const subjectOk =
        subject !== null && new RegExp(ISSUE_REF, "i").test(subject);
      return !subjectOk;
    },
  },
  reason:
    `Merging requires a closing keyword in the squash commit subject ` +
    `— every PR must close at least one issue:\n` +
    `  gh pr merge --squash --subject "feat: x (closes #12)"\n` +
    `- Repeat the keyword per issue — "Closes #A #B" honors only the first number.\n`,
} as const satisfies Rule;
