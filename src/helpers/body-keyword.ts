// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `bodyHasClosingKeyword` — does the command's body carry a
 * closing-keyword reference? Backs `pr-create-needs-issue-link`.
 *
 * - substitution form: runs the pinned perl one-liner via `ctx.exec`
 *   and tests its OUTPUT — the canonical input is exactly what gh
 *   uploads (frontmatter and the leading H1 stripped, so a keyword
 *   that only appears in the frontmatter or the H1 does not count).
 * - direct path / inline `--body`: raw content fallbacks for
 *   configs that disable the body-file rules (documented README
 *   combo).
 *
 * Anything unreadable / exec failure / non-zero exit = false
 * (fail-closed).
 */

import { readFileSync } from "node:fs";
import type { PredicateContext } from "@cad0p/pi-steering";
import { BODY_STRIP } from "./body-strip.ts";
import {
  findBodyFileValue,
  findFlagValue,
  parseBodyFileArg,
  resolveAgainstCwd,
} from "./pattern-args.ts";
import { ISSUE_REF } from "./patterns.ts";

export async function bodyHasClosingKeyword(
  ctx: PredicateContext,
): Promise<boolean> {
  const refRe = new RegExp(ISSUE_REF, "i");
  const value = findBodyFileValue(ctx);
  if (value !== "") {
    const parsed = parseBodyFileArg(value);
    if (parsed === null) return false; // unparsable value → fail-closed
    if (parsed.kind === "substitution") {
      // The pinned one-liner IS the definition of the canonical body.
      try {
        const res = await ctx.exec("perl", [
          "-0777",
          "-pe",
          BODY_STRIP,
          parsed.path,
        ]);
        if (res.exitCode !== 0) return false;
        return refRe.test(res.stdout ?? "");
      } catch {
        return false;
      }
    }
    // Direct-path fallback (disabled body-file rules): raw content.
    const abs = resolveAgainstCwd(ctx, parsed.path);
    if (abs === null) return false;
    try {
      return refRe.test(readFileSync(abs, "utf8"));
    } catch {
      return false;
    }
  }
  const inline = findFlagValue(ctx, ["--body", "-b"]);
  if (inline !== null) return refRe.test(inline);
  return false;
}
