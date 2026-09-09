// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `when.requiresFlagValue` — fires (rule BLOCKS) when the LAST-wins
 * value of any listed flag alias is absent, valueless, or does not
 * satisfy `matches`.
 *
 * VENDORED from `@cad0p/pi-steering-flags` (interim — see
 * `./info-only.ts`: no flags publish works with core
 * 0.2.0-20260908.x yet). Behavior-identical to flags'
 * `requiresFlagValue` for table-listed spellings (same spread-only
 * args, same malformed-fail-open, same absent/valueless/non-match
 * fail-closed, same `/g`-regex `lastIndex` reset), with two
 * command-first deltas, both in the gh-faithful direction:
 *
 * - Value resolution reads through the bound `ctx.command`
 *   facade: consumption + glue come from this plugin's OWNED gh
 *   descriptor, never the call. `--subject`/`-t` are table rows, so
 *   the merge rule's gate is unchanged (space, attached, AND glued
 *   `-t<value>` forms — the flags-era scan missed the glued form).
 *   Spellings with NO table row never consume (registry-only arity):
 *   a separated value after an unlisted spelling does NOT satisfy —
 *   fail-closed. Declare the row (the remedy is a table row).
 * - The separated form does NOT inspect whether the next token looks
 *   like a flag (unchanged from flags): `--subject --squash` reads
 *   `--squash` as the value → non-match → block.
 *
 * Last-wins rationale: gh / cobra / pflag CLIs keep only the LAST
 * occurrence of a repeated flag
 * (`gh pr merge -t "see #13" --subject "closes #12"` merges with the
 * subject "closes #12"), so gating must evaluate the winning value —
 * not the first one. The alias set (`["--subject", "-t"]`) names ONE
 * logical flag; aliases are OR'd at every scanned position and
 * whichever occurrence comes last wins.
 *
 * Malformed args are the deliberate exception — fail-open (an author
 * config bug shouldn't block every matching command). Runtime state
 * is fail-closed: ABSENT counts as unmet, as do a trailing valueless
 * flag (`cmd --subject`), a non-matching value, and non-bash tools.
 *
 * Carve-out composition idiom — pair with the info-only negation so
 * help invocations still pass:
 *
 *   when: {
 *     not: { infoOnly: { extraFlags: ["-h"] } },
 *     requiresFlagValue: {
 *       flags: ["--subject", "-t"],
 *       matches: /…/,
 *     },
 *   }
 */

import { definePredicate } from "@cad0p/pi-steering";

/** Spread args for `when.requiresFlagValue` (spread-only, no bare). */
export interface RequiresFlagValueArgs {
  /** Aliases of ONE logical flag; OR'd at every scanned position. */
  flags: readonly string[];
  /** Pattern the effective value must satisfy. */
  matches: RegExp;
}

export const requiresFlagValue = definePredicate<RequiresFlagValueArgs>(
  (args, ctx) => {
    // Malformed arg — fail-open (author bug shouldn't block
    // everything).
    if (
      args === null ||
      typeof args !== "object" ||
      !Array.isArray(args.flags) ||
      args.flags.length === 0 ||
      !args.flags.every((f) => typeof f === "string") ||
      !(args.matches instanceof RegExp)
    ) {
      return false;
    }
    // A config regex carrying /g or /y is stateful across evaluations
    // and would intermittently flip verdicts — reset first.
    args.matches.lastIndex = 0;
    // Non-bash tools carry no argv — unmet (fail-closed).
    if (ctx.input?.tool !== "bash") return true;
    // Entries select SPELLINGS only; consumption/glue come from the
    // owned descriptor table (see header — unlisted spellings never
    // consume).
    const value = ctx.command.getFlagValue({
      aliases: args.flags,
      takesValue: false,
    });
    return value === null || !args.matches.test(value);
  },
);
