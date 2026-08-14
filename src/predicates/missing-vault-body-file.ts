// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `when.missingVaultBodyFile` — fail-closed vault body-file check
 * backing the two body-file rules (`pr-body-from-vault-file` /
 * `issue-body-from-vault-file`).
 *
 * The ONLY accepted form for `--body-file` is a process substitution
 * wrapping the strip helper:
 *
 *   --body-file <(pi-steering-github strip <vault-file>)
 *
 * The helper removes the note's YAML frontmatter + leading H1 before
 * `gh` uploads it, so GitHub bodies render clean while vault files
 * stay byte-identical. Direct vault paths upload VERBATIM and are
 * blocked — the predicate is true (rule fires) when the `--body-file`
 * value is missing, unparsable (no substitution, non-`strip` inner
 * command), not wrapping a real file in a napkin vault
 * (`.napkin/` walk-up, via `@cad0p/pi-napkin/steering`), or not
 * under a `<repo>/<section>/` directory inside the vault (`<repo>` =
 * origin URL basename, falling back to the cwd folder name when the
 * remote is unresolvable). Fail-closed: anything unverifiable counts
 * as missing.
 *
 * Args:
 *
 *   - `section: "prs" | "issues"` — the vault-relative directory the
 *     body file must live under.
 *
 * This module also exports the arg helpers (`findFlagValue`,
 * `findBodyFileValue`, `parseBodyFileArg`, `resolveAgainstCwd`,
 * `bodyHasClosingKeyword`, `repoName`, plus the low-level `argText` /
 * `unquote`) for unit tests and `when.condition` escape-hatch use.
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
import { stripVaultBody } from "../strip.ts";

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
 * Value of the first `--body-file` / `-F` occurrence, unquoted.
 * `""` when absent or empty (fail-closed — the caller treats it as
 * missing).
 *
 * Unlike `findFlagValue`, this scanner ALSO handles the walker-split
 * glued form: the unbash walker splits `--body-file=<( … )` into TWO
 * words (`--body-file=` + `<( … )`), so a word that is exactly
 * `--body-file=` / `-F=` takes the NEXT word as its value (as the
 * last word there is no next token → `""` → fail-closed block).
 */
export function findBodyFileValue(ctx: PredicateContext): string {
  const words = argText(ctx);
  for (let i = 0; i < words.length; i++) {
    const t = words[i]?.text ?? "";
    if (t === "--body-file" || t === "-F") {
      return unquote(words[i + 1]?.text ?? "");
    }
    if (t === "--body-file=" || t === "-F=") {
      // Walker-split expansion artifact of `--body-file=<( … )`:
      // the value is the next word.
      return unquote(words[i + 1]?.text ?? "");
    }
    if (t.startsWith("--body-file=") || t.startsWith("-F=")) {
      return unquote(t.slice(t.indexOf("=") + 1));
    }
  }
  return "";
}

/**
 * A parsed `--body-file` value word:
 *
 *   - `substitution` — `<(pi-steering-github strip <vault-path>)`,
 *     the ONLY accepted form. `vaultPath` is the (unquoted) file
 *     argument of the strip helper.
 *   - `direct` — any other path-like word (blocked: uploads
 *     verbatim).
 */
export type BodyFileArg =
  | { kind: "substitution"; vaultPath: string }
  | { kind: "direct"; path: string };

/**
 * Classify a `--body-file` value word. `null` = unparsable (fail
 * closed by the callers).
 *
 * A `<( … )` word is accepted ONLY when the inner command is exactly
 * `pi-steering-github strip <path>` (shell word-split on the inner
 * text, quotes respected): any other inner command (`strip` bare —
 * GNU binutils collision — `cat`, `sed`, `pi-steering-github edit`,
 * …) is unparsable, because it would either upload garbage or not
 * strip at all.
 */
export function parseBodyFileArg(word: string): BodyFileArg | null {
  if (word.startsWith("<(")) {
    if (!word.endsWith(")")) return null;
    const tokens = tokenizeInner(word.slice(2, -1).trim());
    if (tokens.length === 3) {
      const [bin, cmd, vaultPath] = tokens;
      if (
        bin === "pi-steering-github" &&
        cmd === "strip" &&
        vaultPath !== undefined
      ) {
        return { kind: "substitution", vaultPath };
      }
    }
    return null;
  }
  if (word !== "") return { kind: "direct", path: word };
  return null;
}

/**
 * Shell-style word splitting on the inner text of a `<( … )` word:
 * whitespace separates tokens outside quotes; `"` and `'` quotes are
 * stripped when a token is extracted (equivalent to shell word
 * splitting on the inner text). An unmatched quote just ends the
 * token — the strict 3-token check downstream fails closed.
 */
function tokenizeInner(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
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
 * the STRIPPED `--body-file` content when present (frontmatter is
 * not body — a keyword that only appears in frontmatter must NOT
 * satisfy the check); falls back to the inline `--body` text.
 * Anything unreadable/missing = false (fail-closed).
 */
export function bodyHasClosingKeyword(ctx: PredicateContext): boolean {
  const refRe = new RegExp(ISSUE_REF, "i");
  const value = findBodyFileValue(ctx);
  if (value !== "") {
    const parsed = parseBodyFileArg(value);
    if (parsed === null) return false; // unparsable value → fail-closed
    const path =
      parsed.kind === "substitution" ? parsed.vaultPath : parsed.path;
    const abs = resolveAgainstCwd(ctx, path);
    if (abs === null) return false;
    try {
      return refRe.test(stripVaultBody(readFileSync(abs, "utf8")));
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
 * Is `abs` a valid vault body path for `section`? Exists + regular
 * file + inside a napkin vault (`.napkin/` walk-up) + under a
 * `<repo>/<section>/` directory inside the vault.
 */
async function isValidVaultBodyPath(
  abs: string,
  section: "prs" | "issues",
  ctx: PredicateContext,
): Promise<boolean> {
  if (!existsSync(abs) || !statSync(abs).isFile()) return false;
  const vaultRoot = isNapkinVaultDir(dirname(abs));
  if (vaultRoot === null) return false; // outside any vault → missing
  // Repo = the origin of the git repo the COMMAND runs in (ctx.cwd), not
  // the body file's dir: the file lives in the shared vault (Goldmine),
  // whose own origin is the vault repo — dirname(abs) would always
  // resolve to the vault's name and no body file could ever match.
  const repo = await repoName(ctx, ctx.cwd);
  if (repo === null) return false;
  // Vault-relative path must contain <repo>/<section>/ (any depth —
  // e.g. open-source/github/<repo>/prs/… or personal/github/<repo>/prs/…).
  const segments = relative(vaultRoot, abs)
    .split(sep)
    .filter((s) => s !== "");
  const repoIndex = segments.indexOf(repo);
  return repoIndex !== -1 && segments[repoIndex + 1] === section;
}

/**
 * `missingVaultBodyFile` — fail-closed vault body-file check. True
 * when the command's `--body-file` value is missing, unparsable
 * (anything but the `<(pi-steering-github strip <vault-file>)`
 * substitution form — direct paths upload verbatim and are blocked),
 * unreadable, outside a napkin vault, or not under a
 * `<repo>/<section>/` directory inside the vault.
 */
export const missingVaultBodyFile: PredicateHandler<{
  section: "prs" | "issues";
}> = async (args, ctx) => {
  const value = findBodyFileValue(ctx);
  if (value === "") return true; // no body file at all → missing
  const parsed = parseBodyFileArg(value);
  if (parsed === null) return true; // unparsable value → fail-closed
  if (parsed.kind === "direct") {
    // Direct vault paths upload the file VERBATIM (frontmatter + H1
    // render on GitHub) — only the strip-helper substitution is
    // accepted.
    return true;
  }
  const abs = resolveAgainstCwd(ctx, parsed.vaultPath);
  if (abs === null) return true; // walker-unknown cwd → fail-closed
  return !(await isValidVaultBodyPath(abs, args.section, ctx));
};
