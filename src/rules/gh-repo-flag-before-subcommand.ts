// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `gh-repo-flag-before-subcommand` — `gh -R x/y pr|issue …` targets
 * a FOREIGN repo and must be redirected to the foreign repo's own
 * config: run a foreign subagent maintainer loop until good, then cd
 * into the foreign repo and target it from there. This is the ENTRY
 * step of the foreign flow — FIRST in the roster (pedagogical; the
 * `^gh\s+(?:-R|--repo)` anchor is disjoint from the other rules'
 * `^gh\s+(?:pr|issue|repo)` anchors, so first-match routing is
 * unaffected).
 *
 * Fires on `pr create|new|edit|merge` and `issue create|edit` only
 * (`repo create|new` is excluded by design — nothing to cd into, the
 * target is the positional argument; read-only forms stay allowed).
 * The anchor is a pure router: it also routes non-repo flags (`-v`,
 * `--hostname`) and slashless `-R upstream` — the
 * `foreignRepoTarget` predicate releases those (not repo-targeting /
 * fork remote-name form).
 *
 * Fully declarative gate — zero condition code (issue #36). Two
 * leaves compose as an AND of independent registered predicates:
 *
 * - `not.infoOnly({ extraFlags: ["-h"] })` exempts read-only
 *   introspection: the flags plugin's `--help`/`--version` defaults
 *   PLUS GitHub's additive `-h` (token-level, quote-aware — quoted
 *   values can't falsely exempt). Accepted exposure: a gated
 *   invocation carrying `--version` (bare or attached) is now
 *   ALLOWED — gh errors on it for pr/issue subcommands, so nothing
 *   real can happen; `-v` is NOT in the default set and stays
 *   gated.
 * - `foreignRepoTarget: true` — this package's registered
 *   predicate: blocks when the effective `-R`/`--repo` target is a
 *   FOREIGN repo. The basename compare is hardcoded policy (#19):
 *   basename equality allows the fork→upstream contribution flow
 *   (`gh -R upstream/foo pr create` from the `me/foo` clone); cost
 *   accepted: `-R <own-repo> pr merge` from inside the repo is
 *   indistinguishable and slips through — heuristic discipline, not
 *   security. Fail-closed: unknown cwd / unresolvable repo /
 *   unparsable target → block.
 *
 * AND-of-leaves order-independence (confirmed during #23):
 * help/version invocations short-circuit ALLOW via the not-leaf
 * without consulting the predicate — byte-equivalent to the old
 * early-return ordering. A `--help` inside a QUOTED VALUE
 * (`--subject "see --help"`) does NOT exempt a real gated command
 * (token-level walker argv underneath both leaves).
 *
 * Reason is a `ReasonFn` — the plugin's first dynamic reason: the
 * redirect text echoes the target and subcommand AS TYPED.
 *
 * Strict — no override (schema default).
 */

import type { PredicateContext, Rule } from "@cad0p/pi-steering";
import { REPO_FLAG_ANCHOR } from "../helpers/patterns.ts";

export const ghRepoFlagBeforeSubcommand = {
  name: "gh-repo-flag-before-subcommand",
  tool: "bash",
  field: "command",
  pattern: REPO_FLAG_ANCHOR,
  when: {
    not: { infoOnly: { extraFlags: ["-h"] } },
    foreignRepoTarget: true,
  },
  reason: (ctx: PredicateContext) => foreignRepoReason(ctx),
} as const satisfies Rule;

/**
 * The dynamic block reason for `gh-repo-flag-before-subcommand`:
 * echoes the subcommand (PR/issue) and the EFFECTIVE `-R`/`--repo`
 * target AS TYPED — mirroring `getFlagValue`'s LAST-flag-wins scan so
 * the redirect names what gh will actually target when both aliases
 * occur (echoing an overridden earlier alias would misdirect the cd).
 * Arg-layer word scan only (display, not flag parsing — no regex over
 * the raw string): RIGHT→LEFT, at each position bare `-R`/`--repo`
 * first (echo flag + next word), then glued forms — `--repo=…` via
 * the same `=` prefix the helper matches, `-R…` ONLY when the
 * remainder looks like a slashful no-space target — a stricter shape
 * guard than glue-aware resolution (flags#11), which is safe: spaced
 * slashless lookalikes resolve to non-targets and release before any
 * echo runs, and a value word merely starting with `-R` must not
 * hijack the redirect text. First match from the right wins.
 * Never throws — static fallback on unparsable args (the evaluator's
 * fail-safe would still land the block verdict, but keep it clean).
 */
export function foreignRepoReason(ctx: PredicateContext): string {
  const words = ctx.input.args ?? [];
  let flag = "-R";
  let target: string | null = null;
  for (let i = words.length - 1; i >= 0; i--) {
    const t = words[i]?.text ?? "";
    if (t === "-R" || t === "--repo") {
      flag = t;
      target = words[i + 1]?.text ?? "";
      break;
    }
    if (t.startsWith("--repo=")) {
      // Glued long form: the flag+value is ONE word — echo it
      // verbatim ("--repo=cad0p/x"). Mirrors getFlagValue's
      // `${flag}=` prefix match exactly, so a quoted VALUE that
      // happens to look like `--repo=x/y` wins BOTH the resolution
      // and the echo — consistent display.
      flag = t;
      break;
    }
    if (/^-R[^=\s]*\/\S*$/.test(t)) {
      // Glued SHORT form (`-Rcad0p/x`): require a SLASHFUL no-space
      // remainder — repo targets always contain `/`. Resolution is
      // glue-aware now (flags#11 `{ gluedShorts: ["R"] }`) but this
      // display scan keeps its stricter shape guard: spaced lookalike
      // values ("-Rebased onto main") resolve SLASHLESS upstream and
      // release via step 4 (never blocked → never echoed), while
      // slashful ones can only ever cause a fail-closed over-block,
      // where this branch echoes them verbatim. Slashless `-R…`
      // words fall through to earlier positions.
      flag = t;
      break;
    }
  }
  // The subcommand is the FIRST exact `pr`/`issue` TOKEN in the argv.
  // Exact tokens only: the walker keeps quoted values as single words,
  // so MULTI-WORD values like "fix pr bug" can never match. (Accepted
  // display-only limitation: a single-word root-flag value that is
  // exactly `pr`/`issue` and precedes the subcommand could still
  // mislabel the PR/issue noun — contrived, verdict unaffected.
  // Positional detection relative to the flag+value broke with the
  // right→left scan above: the winning alias may sit at the line's
  // end, past any subcommand.)
  const subWord = words.find(
    (w) => (w?.text ?? "") === "pr" || (w?.text ?? "") === "issue",
  );
  const sub = subWord?.text ?? "";
  const what = sub === "pr" ? "PR" : "issue";
  // Space form: `-R <target>` / `--repo <target>`. Glued form: the
  // word IS the flag+value (`--repo=x/y`, `-Rx/y`) — echo verbatim.
  const via = target !== null && target !== "" ? `${flag} ${target}` : flag;
  return (
    `The ${what} you're targeting via ${via} belongs to a foreign repo.\n` +
    `REQUIREMENT: run a foreign subagent maintainer loop until good,\n` +
    `then cd into the foreign repo and target it from there.`
  );
}
