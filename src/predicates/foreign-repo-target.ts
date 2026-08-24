// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `when.foreignRepoTarget` — the `-R`/`--repo` foreign-target gate
 * backing `gh-repo-flag-before-subcommand`. True (rule fires →
 * BLOCK) when a flag-first `gh -R/--repo …` invocation targets a
 * FOREIGN repository; false releases the command.
 *
 * Extracted from the rule's former inline `unless` closure (issue
 * #36) and return-INVERTED: the closure returned true to RELEASE
 * (allow); a registered predicate returns true to FIRE (block).
 * The five jobs keep their order:
 *
 *   1. Router-release: the anchor routes ANY first `-`-prefixed
 *      token; commands whose FIRST flag token is NOT the repo-flag
 *      family (`-R`, `--repo`, glued `-R…`, `--repo=…`) are not
 *      repo-targeting (`-v`, `--hostname`, …) → release.
 *   2. Target resolution via `getFlagValue` with
 *      `{ gluedShorts: ["R"] }` (`@cad0p/pi-steering-flags`, arg
 *      layer, quote-aware): LAST-wins across the `-R`/`--repo` alias
 *      set (gh/cobra collapse repeated spellings of one logical flag
 *      to the final value — issue #34), resolving bare `-R`, attached
 *      `--repo=`/`-R=`, AND glued short forms like `-Rcad0p/x`
 *      (upstream cad0p/pi-steering-flags#11 shipped the opt-in;
 *      per-position precedence exact > attached > glued). A trailing
 *      valueless alias or an empty attached value as the last
 *      occurrence wins and fail-closes in step 3.
 *   3. Unparsable target (`null` / `""`) → BLOCK. Only trailing-
 *      valueless aliases and empty attached values remain unparsable
 *      now that glued forms resolve.
 *   4. Slashless target (`-R upstream`, remote-name form) → release:
 *      no `/` means it cannot be a foreign-owner/repo redirect; the
 *      fork→upstream flow passes through unchanged.
 *   5. Basename compare against the cwd repo (`repoName` — origin
 *      URL basename, cwd-folder fallback): basename EQUALITY is
 *      allowed (fork→upstream tolerance, issue #19 — hardcoded THE
 *      policy, no config knob), anything else BLOCKS. Fail-closed:
 *      walker-unknown cwd / unresolvable repo ("unknown" sentinel or
 *      null) → BLOCK.
 *
 * Step 0 comes before all of that: bare `false` NEVER fires.
 *
 * The help/version carve-out does NOT live here: composition with
 * `not: { infoOnly: { extraFlags: ["-h"] } }` in the rule handles
 * read-only introspection declaratively via the flags plugin's
 * registered predicate, so this handler stays single-concern (the
 * closure was extracted precisely because it mixed parsing + policy
 * + carve-outs).
 */

import type { PredicateContext, PredicateHandler } from "@cad0p/pi-steering";
import { getFlagValue } from "@cad0p/pi-steering-flags";
import { repoName } from "../helpers/repo-name.ts";

/**
 * Intentionally parameterless args — the basename policy IS the
 * semantics (#19), so there is deliberately no `matchBy` / `flags`
 * knob. Declared as `Record<string, never>` rather than an empty
 * interface (biome `noEmptyInterface`). Registry-wise this is the
 * boolean-bare shape (`PredicateShape<boolean,
 * ForeignRepoTargetArgs>`, the `infoOnly` precedent): bare `true` ≡
 * spread `{}` — both enable the gate and run the argv logic.
 */
export type ForeignRepoTargetArgs = Record<string, never>;

/**
 * `foreignRepoTarget` — true (BLOCK) when the effective `-R`/`--repo`
 * target is a foreign repository; false releases router-released,
 * slashless, and fork→upstream commands. Fail-closed: unparsable
 * target, walker-unknown cwd, unresolvable repo → true.
 */
export const foreignRepoTarget: PredicateHandler<
  boolean | ForeignRepoTargetArgs
> = async (args, ctx: PredicateContext) => {
  // Step 0 — bare-false guard FIRST: handlers receive the leaf value
  // verbatim (`handler(value, ctx)`); without this guard a
  // `foreignRepoTarget: false` config would run the argv logic
  // instead of disabling the gate (mirrors the `infoOnly` handler).
  if (args === false) return false;

  const words = ctx.input.args ?? [];
  // Step 1 — router-release. The anchor routes ANY first flag token
  // (pure router). Release commands whose FIRST flag token is NOT
  // the repo-flag family (`-v`, `--hostname`, …) — they are not
  // repo-targeting. (Scan for the first `-`-prefixed token; the
  // walker's `input.args` excludes the basename `gh`, but unit-test
  // helpers include it — scanning is position-robust either way.)
  let firstFlag: string | null = null;
  for (const w of words) {
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
  if (!isRepoFlag) return false; // not a repo-targeting command

  // Step 2 — the `-R`/`--repo` target, via `@cad0p/pi-steering-flags`
  // (arg layer, quote-aware, `--flag=value` + `--flag value` + glued
  // short forms). The alias SET makes the resolution LAST-wins across
  // `-R`/`--repo` (gh/cobra collapse repeated spellings of one
  // logical flag to the final value) — the old `??` composition let
  // the FIRST-seen alias win and miss a cross-alias override (issue
  // #34). A trailing valueless alias or an empty attached value as
  // the last occurrence wins and fail-closes (null / "" → block
  // below). `gluedShorts: ["R"]` opts into decomposing words shaped
  // `-R<rest>` at any position (upstream flags#11): slashless rest
  // releases via step 4, so quoted body values like "-Rebased onto
  // main" can never cause a false block; a SLASHFUL lookalike body
  // value (`-m "-Rfoo/bar ref"`) hijacks resolution → possible
  // over-BLOCK — fail-closed direction, accepted (ShellCheck-norm
  // opt-in contract).
  const target = getFlagValue(words, ["-R", "--repo"], {
    gluedShorts: ["R"],
  });
  // Step 3 — fail-closed on an unparsable target.
  if (target === null || target === "") return true;
  // Step 4 — slashless remote-name forms (`-R upstream`) are the
  // fork→upstream flow — release (the anchor routes them; the old
  // anchor never did). A `/`-containing target is required to be a
  // foreign-owner/repo redirect.
  if (!target.includes("/")) return false;
  // Step 5 — basename compare vs the cwd repo. Fail-closed rails:
  const cwd = ctx.cwd;
  if (typeof cwd !== "string" || cwd === "unknown") return true;
  const repo = await repoName(ctx, cwd);
  // `repoName` falls back to the cwd folder name, which for the
  // walker-unknown sentinel is the literal string "unknown" (NOT
  // null) — treat it as no-match (block), like an unresolvable
  // repo.
  if (repo === null || repo === "unknown") return true;
  // Fork→upstream tolerance (#19), HARDCODED — the basename equality
  // allowance is the policy, not a knob: `gh -R upstream/foo pr
  // create` from inside the `me/foo` clone is the most common LEGIT
  // `-R` use. Cost accepted: `-R <own-repo> pr merge` from inside
  // the repo is indistinguishable and slips through — heuristic
  // discipline, not security.
  const targetBase = target.slice(target.lastIndexOf("/") + 1);
  return targetBase !== repo;
};
