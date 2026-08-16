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
 * This module also exports the arg helpers (`findFlagValue`,
 * `findBodyFileValue`, `parseBodyFileArg`, `resolveAgainstCwd`,
 * `bodyHasClosingKeyword`, plus the low-level `argText` / `unquote`)
 * for unit tests and `when.condition` escape-hatch use.
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
import { BODY_STRIP } from "../body-strip.ts";
import { ISSUE_REF } from "../rules.ts";

export { BODY_STRIP };

// ---------------------------------------------------------------------------
// The pinned strip one-liner — the only accepted inner command
// ---------------------------------------------------------------------------

/** The exact inner-command token sequence (before the path token). */
export const STRIP_COMMAND_TOKENS: readonly string[] = [
  "perl",
  "-0777",
  "-pe",
  BODY_STRIP,
] as const;

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
 *   - `substitution` — `<(perl -0777 -pe '<BODY_STRIP>' <path>)`,
 *     the ONLY accepted form. `path` is the (unquoted) file argument
 *     — resolved and validated by `missingVaultBodyFile` (exists,
 *     napkin vault, `<repo>/<section>/` placement).
 *   - `direct` — any other path-like word (blocked; kept only so
 *     `bodyHasClosingKeyword` can raw-read a direct path in the
 *     disabled-rules combos).
 */
export type BodyFileArg =
  | { kind: "substitution"; path: string }
  | { kind: "direct"; path: string };

/**
 * Classify a `--body-file` value word. `null` = unparsable (fail
 * closed by the callers).
 *
 * A `<( … )` word is accepted ONLY when the inner command is exactly
 * `perl -0777 -pe <BODY_STRIP> <path>` (shell word-split on
 * the inner text, quotes respected and stripped): the program token
 * is byte-compared against the pinned constant, the path is the
 * single remaining token. Any other inner command (`sed`, `awk`,
 * `cat`, a different perl invocation, extra flags, missing path, …)
 * is unparsable — either it would not strip at all or the pinned
 * behavior could not be guaranteed.
 */
export function parseBodyFileArg(word: string): BodyFileArg | null {
  if (word.startsWith("<(")) {
    if (!word.endsWith(")")) return null;
    const tokens = tokenizeInner(word.slice(2, -1).trim());
    if (tokens.length === STRIP_COMMAND_TOKENS.length + 1) {
      let pinned = true;
      for (let i = 0; i < STRIP_COMMAND_TOKENS.length; i++) {
        if (tokens[i] !== STRIP_COMMAND_TOKENS[i]) {
          pinned = false;
          break;
        }
      }
      if (pinned) {
        const path = tokens[STRIP_COMMAND_TOKENS.length];
        if (path !== undefined && path !== "") {
          return { kind: "substitution", path };
        }
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
 * token — the strict token-count + byte-pin downstream fails closed.
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
 * Does the command's body carry a closing-keyword reference?
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
}> = async (args, ctx) => {
  const value = findBodyFileValue(ctx);
  if (value === "") return true; // no body file at all → missing
  const parsed = parseBodyFileArg(value);
  if (parsed === null) return true; // unparsable value → fail-closed
  if (parsed.kind === "direct") {
    // Direct vault paths upload the file VERBATIM (frontmatter
    // renders on GitHub) — only the pinned substitution is accepted.
    return true;
  }
  // Substitution form OK — validate the vault path (restored from
  // v0.1.0 via #12; the strip work dropped this validation).
  const abs = resolveAgainstCwd(ctx, parsed.path);
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
