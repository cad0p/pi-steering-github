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
import { repoName } from "../helpers/repo-name.ts";
import { REPO_FLAG_ANCHOR } from "./patterns.ts";

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
    // Glued short form `-Rcad0p/x` is INVISIBLE to the helpers (the
    // walker keeps it as one word) — `getFlagValue` returns null →
    // fail-closed block (accepted over-block; upstream gap filed as
    // cad0p/pi-steering-flags#11).
    const target = getFlagValue(args, "-R") ?? getFlagValue(args, "--repo");
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
 * echoes the subcommand (PR/issue) and the `-R`/`--repo` target AS
 * TYPED. Arg-layer word scan only (display, not flag parsing — no
 * regex over the raw string). Never throws — static fallback on
 * unparsable args (the evaluator's fail-safe would still land the
 * block verdict, but keep it clean).
 */
export function foreignRepoReason(ctx: PredicateContext): string {
  const words = ctx.input.args ?? [];
  let flag = "-R";
  let target: string | null = null;
  let subIndex = -1; // index of the subcommand word (pr/issue)
  for (let i = 0; i < words.length; i++) {
    const t = words[i]?.text ?? "";
    if (t === "-R" || t === "--repo") {
      flag = t;
      target = words[i + 1]?.text ?? "";
      subIndex = i + 2;
      break;
    }
    if (t.startsWith("--repo=") || t.startsWith("-R")) {
      // Glued form: the flag+value is ONE word — echo it verbatim
      // ("--repo=cad0p/x", "-Rcad0p/x").
      flag = t;
      subIndex = i + 1;
      break;
    }
  }
  // The subcommand is positionally determined (the word right after
  // the flag+value) — scanning the whole command for /\bpr\b/ could
  // mislabel an issue command whose title/subject mentions "pr"
  // (or a target like `cad0p/pr-mirror`).
  const sub = words[subIndex]?.text ?? "";
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
