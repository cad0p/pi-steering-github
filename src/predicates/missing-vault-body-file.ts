// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `when.missingVaultBodyFile` — fail-closed form + vault-path check
 * backing the two body-file rules (`pr-body-from-vault-file` /
 * `issue-body-from-vault-file`).
 *
 * The ONLY accepted form for `--body-file` is a process substitution
 * running the pinned perl body-strip one-liner:
 *
 *   --body-file <(perl -0777 -pe '<BODY_STRIP>' <vault-note>)
 *
 * The one-liner removes the note's YAML frontmatter block before
 * `gh` uploads it, so GitHub bodies render clean while vault files
 * stay byte-identical (nothing writes them). The predicate is a
 * FORM check PLUS a vault-path validation (restored in #12 — the
 * strip work 0.1.0-20260816.2 dropped the validation): the
 * `<vault-note>` argument must resolve to a real file inside a
 * napkin vault, under a `<repo>/<section>/` directory (`<repo>` =
 * origin URL basename, cwd-folder fallback).
 *
 * The predicate is true (rule fires) when the `--body-file` value is
 * missing, not the substitution form, the inner command deviates
 * from the pinned token sequence, OR the path fails the vault check
 * (nonexistent, outside a vault, wrong section, wrong repo,
 * walker-unknown cwd). Fail-closed: anything unverifiable counts as
 * missing.
 *
 * Args:
 *
 *   - `section: "prs" | "issues"` — the vault-relative directory the
 *     body file must live under.
 *
 * The arg helpers it uses (`findFlagValue`, `findBodyFileValue`,
 * `explainBodyFileArg`, `resolveAgainstCwd`, `bodyHasClosingKeyword`,
 * plus the low-level `argText` / `unquote`) live in
 * `../helpers/` and are re-exported through `./index.ts` for unit
 * tests and `when.condition` escape-hatch use.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { isNapkinVaultDir } from "@cad0p/pi-napkin/steering";
import type { PredicateContext, PredicateHandler } from "@cad0p/pi-steering";
import {
  explainBodyFileArg,
  findBodyFileValue,
  resolveAgainstCwd,
} from "../helpers/pattern-args.ts";
import { repoName } from "../helpers/repo-name.ts";

export { BODY_STRIP } from "../helpers/pattern-args.ts";

/**
 * `missingVaultBodyFile` — fail-closed form + vault-path check. True
 * when the command's `--body-file` value is missing, not the pinned
 * `<(perl -0777 -pe '<BODY_STRIP>' <path>)` substitution, or a
 * direct path (uploaded verbatim — frontmatter renders on GitHub);
 * and — for a valid substitution — when the path fails the vault
 * check (nonexistent, outside a napkin vault, or not under a
 * `<repo>/<section>/` directory). Fail-closed: anything unverifiable
 * counts as missing.
 */
export const missingVaultBodyFile: PredicateHandler<{
  section: "prs" | "issues";
}> = async (args, ctx: PredicateContext) => {
  const value = findBodyFileValue(ctx);
  if (value === "") return true; // no body file at all → missing
  // Same explain helper the rules' dynamic reason consumes, same
  // value — verdict and diagnostic can never drift. Any stage
  // other than `ok` fails closed (missing, direct path, unclosed
  // form, token deviation, core divergence).
  const explained = explainBodyFileArg(value);
  if (explained.stage !== "ok") return true;
  const path = explained.detail.path;
  // Substitution form OK — validate the vault path (restored from
  // v0.1.0 via #12; the strip work dropped this validation).
  const abs = resolveAgainstCwd(ctx, path);
  if (abs === null) return true; // walker-unknown cwd → fail-closed
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return true;
  } catch {
    return true; // unreadable / raced-away path → fail-closed
  }
  const vaultRoot = isNapkinVaultDir(dirname(abs));
  if (vaultRoot === null) return true; // outside any vault → missing
  // Repo = the origin of the git repo the COMMAND runs in (ctx.cwd),
  // not the body file's dir: the file lives in the shared vault
  // (Goldmine), whose own origin is the vault repo — dirname(abs)
  // would always resolve to the vault's name.
  const repo = await repoName(ctx, ctx.cwd);
  if (repo === null) return true;
  // Vault-relative path must contain <repo>/<section>/ (any depth —
  // e.g. open-source/github/<repo>/prs/… or personal/github/<repo>/prs/…).
  const segments = relative(vaultRoot, abs)
    .split(sep)
    .filter((s) => s !== "");
  const repoIndex = segments.indexOf(repo);
  return !(repoIndex !== -1 && segments[repoIndex + 1] === args.section);
};
