// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `when.infoOnly` — fires (rule BLOCKS) when the command IS an
 * info-only invocation (`--help` / `--version`, plus any additive
 * `extraFlags`).
 *
 * VENDORED from `@cad0p/pi-steering-flags` (interim): the flags
 * package's 0.1.1 line imports core root helpers deleted by the #117
 * command-first breakage (`isInfoOnly`, `hasFlag`, …), so no flags
 * publish works with core 0.2.0-20260908.x yet. This handler is
 * behavior-identical to flags' `infoOnly` (same bare/spread shapes,
 * same additive-only spread, same `false`-never-fires) but reads
 * through the bound `ctx.command.isInfoOnly` facade instead of the
 * removed root helper. Same `when` key name, so rule
 * `when`-clauses and user configs are untouched; when flags
 * republishes with #117 support this file deletes and the
 * `flagsPlugin` requirement returns (tracked in the migration PR).
 *
 * Token-level, quote-aware: a help token inside a quoted VALUE
 * (`gh pr merge --subject "see --help"`) does NOT count, so the
 * command is NOT classified info-only and guardrails still apply to
 * real operations that merely mention help text.
 *
 * Bare shorthand `infoOnly: true` checks the default set
 * (`--help` / `--version` only — `-h` / `-v` are deliberately
 * excluded; they are real operations in commands like
 * `docker run -v /data:/data` or `curl -v`). The spread form only
 * ADDS flags: `when: { infoOnly: { extraFlags: ["-h"] } }` checks the
 * default set PLUS the extra flags — nothing can remove the safe
 * core; a plugin author adding `-h` for their own CLI owns that
 * security tradeoff. `infoOnly: false` never fires.
 *
 * Carve-out idiom — combine with `when.not`:
 * `when: { not: { infoOnly: true } }` ALLOWS info-only invocations
 * while everything else still evaluates the clause.
 */

import { definePredicate } from "@cad0p/pi-steering";

/** Spread args for `when.infoOnly` (additive-only — see header). */
export interface InfoOnlyArgs {
  extraFlags?: readonly string[];
}

export const infoOnly = definePredicate<boolean | InfoOnlyArgs>((args, ctx) => {
  // Explicitly disabled — never fires.
  if (args === false) return false;
  const extraFlags =
    args !== null &&
    typeof args === "object" &&
    Array.isArray((args as InfoOnlyArgs).extraFlags)
      ? (args as InfoOnlyArgs).extraFlags
      : undefined;
  if (ctx.input?.tool !== "bash") return false;
  return ctx.command.isInfoOnly(extraFlags);
});
