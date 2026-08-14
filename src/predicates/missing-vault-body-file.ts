// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `when.missingVaultBodyFile` — fail-closed vault body-file check
 * backing the two body-file rules (`pr-body-from-vault-file` /
 * `issue-body-from-vault-file`).
 *
 * True when the command's `--body-file` value is missing, unreadable,
 * outside a napkin vault (`.napkin/` walk-up, via
 * `@cad0p/pi-napkin/steering`), or not under a `<repo>/<section>/`
 * directory inside the vault (`<repo>` = origin URL basename, falling
 * back to the cwd folder name when the remote is unresolvable).
 * Fail-closed: anything unverifiable counts as missing.
 *
 * Args:
 *
 *   - `section: "prs" | "issues"` — the vault-relative directory the
 *     body file must live under.
 *
 * This module also exports the arg helpers (`findFlagValue`,
 * `resolveAgainstCwd`, `bodyHasClosingKeyword`, `repoName`, plus the
 * low-level `argText` / `unquote`) for unit tests and
 * `when.condition` escape-hatch use.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { isNapkinVaultDir } from "@cad0p/pi-napkin/steering";
import type { PredicateContext, PredicateHandler } from "@cad0p/pi-steering";
import { ISSUE_REF } from "../rules.ts";

// ---------------------------------------------------------------------------
// Arg helpers (run against the walker-parsed argv, not the raw string)
// ---------------------------------------------------------------------------

type ArgWord = { text: string };

/** The walker-parsed argument words of the evaluated command. */
export function argText(ctx: PredicateContext): readonly ArgWord[] {
  return ctx.input.args as readonly ArgWord[];
}

/**
 * Strip one level of wrapping quotes from a walker word's raw source
 * text (`Word.text` preserves the original quoting — `"file.md"` and
 * `'file.md'` both come through with their quotes).
 */
export function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/**
 * Value of the first occurrence of one of `flags` (space or `=`
 * form), unquoted. `null` when none of the flags appears.
 */
export function findFlagValue(
  ctx: PredicateContext,
  flags: readonly string[],
): string | null {
  const words = argText(ctx);
  for (let i = 0; i < words.length; i++) {
    const t = words[i]?.text ?? "";
    for (const f of flags) {
      if (t === f) return unquote(words[i + 1]?.text ?? "");
      if (t.startsWith(`${f}=`)) return unquote(t.slice(f.length + 1));
    }
  }
  return null;
}

/**
 * Resolve a possibly-relative path against the command's effective
 * cwd. `null` when the cwd is the walker's `"unknown"` sentinel
 * (fail-closed — the caller treats it as missing).
 */
export function resolveAgainstCwd(
  ctx: PredicateContext,
  path: string,
): string | null {
  const cwd = ctx.cwd;
  if (typeof cwd !== "string" || cwd === "unknown") return null;
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * Does the command's body carry a closing-keyword reference? Reads
 * the `--body-file` content when present; falls back to the inline
 * `--body` text. Anything unreadable/missing = false (fail-closed).
 */
export function bodyHasClosingKeyword(ctx: PredicateContext): boolean {
  const refRe = new RegExp(ISSUE_REF, "i");
  const file = findFlagValue(ctx, ["--body-file", "-F"]);
  if (file !== null) {
    const abs = resolveAgainstCwd(ctx, file);
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

/**
 * Repository name: origin URL basename (`git config --get
 * remote.origin.url`, `.git` suffix stripped); falls back to the cwd
 * folder name when the remote is unresolvable (user decision
 * 2026-08-14). `null` only when both fail — caller treats as missing.
 */
export async function repoName(
  ctx: PredicateContext,
  cwd: string,
): Promise<string | null> {
  try {
    const res = await ctx.exec(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd },
    );
    const url = res.stdout?.trim() ?? "";
    if (res.exitCode === 0 && url !== "") {
      const name = basename(url).replace(/\.git$/, "");
      if (name !== "") return name;
    }
  } catch {
    // fall through to the cwd-basename fallback
  }
  const name = basename(cwd);
  return name !== "" ? name : null;
}

/**
 * `missingVaultBodyFile` — fail-closed vault body-file check. True
 * when the command's `--body-file` value is missing, unreadable,
 * outside a napkin vault, or not under a `<repo>/<section>/`
 * directory inside the vault.
 */
export const missingVaultBodyFile: PredicateHandler<{
  section: "prs" | "issues";
}> = async (args, ctx) => {
  const file = findFlagValue(ctx, ["--body-file", "-F"]);
  if (file === null) return true; // no body file at all → missing
  const abs = resolveAgainstCwd(ctx, file);
  if (abs === null) return true; // walker-unknown cwd → fail-closed
  if (!existsSync(abs) || !statSync(abs).isFile()) return true;
  const vaultRoot = isNapkinVaultDir(dirname(abs));
  if (vaultRoot === null) return true; // outside any vault → missing
  // Repo = the origin of the git repo the COMMAND runs in (ctx.cwd), not
  // the body file's dir: the file lives in the shared vault (Goldmine),
  // whose own origin is the vault repo — dirname(abs) would always
  // resolve to the vault's name and no body file could ever match.
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
