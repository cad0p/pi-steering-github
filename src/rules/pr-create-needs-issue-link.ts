// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `pr-create-needs-issue-link` — a PR may not be opened without at
 * least one attached issue: a closing keyword + `#N` in BOTH the
 * inline `--title` value and the body (stripped vault body-file
 * content, with inline `--body` as a fallback). Fires when EITHER is missing
 * (`when.condition` is an OR — the pattern only anchors the command).
 *
 * Does NOT fire on other gh subcommands. Fires on draft PRs without
 * keywords too (a tracking issue is the allowed pattern while a draft
 * is open). Strict — no override (schema default).
 */

import type { Rule } from "@cad0p/pi-steering";
import {
  bodyHasClosingKeyword,
  findFlagValue,
} from "../predicates/missing-vault-body-file.ts";
import { ISSUE_REF, PR_CREATE_ANCHOR } from "./patterns.ts";

export const prCreateNeedsIssueLink = {
  name: "pr-create-needs-issue-link",
  tool: "bash",
  field: "command",
  pattern: PR_CREATE_ANCHOR,
  when: {
    condition: async (ctx) => {
      const title = findFlagValue(ctx, ["--title", "-t"]);
      const titleOk = title !== null && new RegExp(ISSUE_REF, "i").test(title);
      return !titleOk || !(await bodyHasClosingKeyword(ctx));
    },
  },
  reason:
    `A PR must close at least one issue — put the closing keyword in BOTH the ` +
    `title and body:\n` +
    `  e.g: title: "feat: x (closes #12)"; body: contains "Closes #12"\n` +
    `- Title keyword: makes the issue(s) auto-close.\n` +
    `- Body keyword: only links the issue(s) to the PR on a Title-Only squash merge.\n` +
    `- Multiple issues: repeat the keyword per issue — "Closes #A, closes #B" — ` +
    `"Closes #A #B" honors only the first number.`,
} as const satisfies Rule;
