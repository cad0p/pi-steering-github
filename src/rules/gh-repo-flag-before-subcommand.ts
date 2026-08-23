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
 * target is the positional argument; read-only forms stay allowed:
 * `pr view`, `issue list`, `--help`/`-h`). The anchor is a pure
 * router: it also routes non-repo flags (`-v`, `--hostname`) and
 * slashless `-R upstream` — the `unless` releases those (not
 * repo-targeting / fork remote-name form).
 *
 * `unless` — allow when the `-R` target's basename equals the cwd
 * repo's basename (`repoName(ctx, ctx.cwd)` — origin URL basename,
 * cwd-folder fallback): the fork→upstream contribution flow
 * (`gh -R upstream/foo pr create` from the `me/foo` clone) is the
 * most common LEGIT `-R` use and must stay allowed. Cost accepted:
 * `-R <own-repo> pr merge` from inside the repo is indistinguishable
 * and slips through — heuristic discipline, not security. Fail-
 * closed: unknown cwd / unresolvable repo / unparsable target →
 * block.
 *
 * Reason is a `ReasonFn` — the plugin's first dynamic reason: the
 * redirect text echoes the target and subcommand AS TYPED.
 *
 * Strict — no override (schema default).
 */

import type { PredicateContext, Rule } from "@cad0p/pi-steering";
import { getFlagValue, hasFlag } from "@cad0p/pi-steering-flags";
import { REPO_FLAG_ANCHOR } from "../helpers/patterns.ts";
import { repoName } from "../helpers/repo-name.ts";

export const ghRepoFlagBeforeSubcommand = {
  name: "gh-repo-flag-before-subcommand",
  tool: "bash",
  field: "command",
  pattern: REPO_FLAG_ANCHOR,
  unless: async (ctx: PredicateContext) => {
    const args = ctx.input.args ?? [];
    // Help is read-only introspection — never a foreign redirect.
    // Keep this independent -R rule on hasFlag with the exact
    // {--help, -h} set (same token-level semantics as isInfoOnly,
    // but deliberately NOT its extra --version default: gh pr/issue
    // subcommands treat --version as an unknown-flag error, never
    // read-only introspection — see the adopt-flags plan's D2). A
    // `--help` inside a QUOTED VALUE (`--subject "see --help"`)
    // does NOT exempt a real gated command.
    if (hasFlag(args, "--help") || hasFlag(args, "-h")) return true;
    // The anchor routes ANY first flag token (pure router). Release
    // commands whose FIRST flag token is NOT the repo-flag family
    // (`-v`, `--hostname`, …) — they are not repo-targeting. (Scan
    // for the first `-`-prefixed token; the walker's `input.args`
    // excludes the basename `gh`, but the unit-test helper includes
    // it — scanning is position-robust either way.)
    let firstFlag: string | null = null;
    for (const w of args) {
      const t = w?.text ?? "";
      if (t.startsWith("-") && t !== "-") {
        firstFlag = t;
        break;
      }
    }
    const isRepoFlag =
      firstFlag === "-R" ||
      firstFlag === "--repo" ||
      (firstFlag !== null &&
        (firstFlag.startsWith("-R") || firstFlag.startsWith("--repo=")));
    if (!isRepoFlag) return true; // not a repo-targeting command
    // The `-R`/`--repo` target, via `@cad0p/pi-steering-flags`
    // (arg layer, quote-aware, `--flag=value` + `--flag value` forms).
    // The alias SET makes the resolution LAST-wins across `-R`/`--repo`
    // (gh/cobra collapse repeated spellings of one logical flag to the
    // final value) — the old `??` composition let the FIRST-seen alias
    // win and miss a cross-alias override (issue #34). A trailing
    // valueless alias or an empty attached value as the last occurrence
    // wins and fail-closes (null / "" → block below). Glued short form
    // `-Rcad0p/x` is INVISIBLE to the helpers (the walker keeps it as
    // one word) — `getFlagValue` returns null → fail-closed block
    // (accepted over-block; upstream gap filed as
    // cad0p/pi-steering-flags#11).
    const target = getFlagValue(args, ["-R", "--repo"]);
    if (target === null || target === "") return false; // fail-closed
    // Slashless remote-name forms (`-R upstream`) are the fork→
    // upstream flow — release (the anchor now routes them; the old
    // anchor never did). A `/`-containing target is required to be a
    // foreign-owner/repo redirect.
    if (!target.includes("/")) return true;
    const cwd = ctx.cwd;
    if (typeof cwd !== "string" || cwd === "unknown") return false;
    const repo = await repoName(ctx, cwd);
    // `repoName` falls back to the cwd folder name, which for the
    // walker-unknown sentinel is the literal string "unknown" (NOT
    // null) — treat it as no-match (block), like an unresolvable
    // repo.
    if (repo === null || repo === "unknown") return false;
    const targetBase = target.slice(target.lastIndexOf("/") + 1);
    return targetBase === repo;
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
 * remainder looks like a slashful target (the helper exact-matches
 * the bare `-R` token, so a value word merely starting with `-R`
 * must not hijack the echo). First match from the right wins.
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
      // Glued SHORT form (`-Rcad0p/x`): require a SLASHFUL remainder —
      // repo targets always contain `/`. getFlagValue only exact-
      // matches the `-R` token, so an arbitrary value word starting
      // with `-R` (e.g. a body value "-Rebased onto main") is
      // invisible to the RESOLUTION; the echo must stay equally blind
      // or it would hijack the redirect text with garbage. Slashless
      // `-R…` words fall through to earlier positions.
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
