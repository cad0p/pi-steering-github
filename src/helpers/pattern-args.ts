// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Arg-layer helpers for the body-file predicate and the
 * keyword rules: walker-argv access, quote stripping, flag
 * value lookup, `--body-file` value classification, and cwd
 * resolution.
 *
 * This module also re-exports `BODY_STRIP` (the rules and the
 * predicate interpolate it at module load and byte-pin it in the
 * tokenizer) so consumers can keep importing it from a single
 * helpers path.
 *
 * `--body-file` classification is centralized in ONE pure helper,
 * `explainBodyFileArg` — the `parseBodyFileArg` wrapper, the vault
 * predicate, and both rules' dynamic block-reason function consume
 * it, so the predicate verdict and the diagnostic can never
 * drift. The stages: `missing` | `direct` | `form` | `ok` |
 * `tokens` | `core` (see `BodyFileExplain`).
 */

import { isAbsolute, resolve } from "node:path";
import type { PredicateContext } from "@cad0p/pi-steering";
import { BODY_STRIP } from "./body-strip.ts";

export { BODY_STRIP };

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

// ---------------------------------------------------------------------------
// `--body-file` value classification + byte-diff diagnostics
// ---------------------------------------------------------------------------

/**
 * Stage payload of `explainBodyFileArg` — the single classification
 * behind `parseBodyFileArg`, the vault predicate, and both
 * body-file rules' dynamic block reason (one source of truth, no
 * drift between verdict and diagnostic):
 *
 *   - `missing` — empty value (no `--body-file` at all).
 *   - `direct` — a plain path word (not a `<( … )` substitution;
 *     feeds the `parseBodyFileArg` wrapper for the disabled-rules
 *     keyword fallback).
 *   - `form` — starts `<(` but has no closing `)` (unclosed form).
 *   - `ok` — exactly `perl -0777 -pe <BODY_STRIP> <path>`.
 *   - `diff` — any other inner command; `gotTokens` for display.
 */
export type BodyFileExplain =
  | { stage: "missing" }
  | { stage: "direct"; detail: { kind: "direct"; path: string } }
  | { stage: "form" }
  | { stage: "ok"; detail: { kind: "substitution"; path: string } }
  | { stage: "diff"; detail: { gotTokens: string[] } };

/**
 * Span-to-string fallback ratio for the `diff` stage: when either
 * remaining span exceeds this fraction of ITS OWN string's length
 * (strict `>`), the pair is useless and the renderer falls back to
 * the full-line command pair.
 */
export const FULL_LINE_FALLBACK_RATIO = 0.6;

/**
 * Classify a `--body-file` value word into an explainable stage
 * (pure — no ctx, no fs). `parseBodyFileArg` is a thin wrapper over
 * this; the vault predicate and both rules' `reason` fn consume it
 * with the SAME value, so the verdict and the diagnostic can never
 * drift.
 */
export function explainBodyFileArg(value: string): BodyFileExplain {
  if (value === "") return { stage: "missing" };
  if (value.startsWith("<(")) {
    if (!value.endsWith(")")) return { stage: "form" };
    const tokens = tokenizeInner(value.slice(2, -1).trim());
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
        // `tokenizeInner` never emits empty tokens — keep the guard
        // for parity with the wrapper's contract.
        if (path !== undefined && path !== "") {
          return { stage: "ok", detail: { kind: "substitution", path } };
        }
      }
    }
    return { stage: "diff", detail: { gotTokens: tokens } };
  }
  return { stage: "direct", detail: { kind: "direct", path: value } };
}

/**
 * Render a body-file rule's block reason from its explain stage:
 * `missing` / `direct` / `form` / `ok` return `staticReason`
 * byte-for-byte (the ok stage fires only via the vault-path check,
 * which is not the substitution-shape diagnostic's job); `diff`
 * prepends the diagnostic (raw bytes, `String.slice` + join only)
 * and appends the rule's canonical static reason after a blank
 * line so the message stays actionable.
 */
export function renderBodyFileExplain(
  explained: BodyFileExplain,
  staticReason: string,
): string {
  if (explained.stage !== "diff") return staticReason;
  return `${renderDiff(explained.detail)}
\n${staticReason}`;
}

/**
 * The `diff` diagnostic: when the inner command has the pinned
 * shape (5 tokens, first three pinned) but the program token
 * diverges, show the divergent core with the byte offset;
 * otherwise show the two full lines.
 */
function renderDiff(detail: { gotTokens: string[] }): string {
  const tokens = detail.gotTokens;
  const shape = tokens.length === STRIP_COMMAND_TOKENS.length + 1;
  const prefixPinned =
    shape && STRIP_COMMAND_TOKENS.slice(0, 3).every((t, i) => tokens[i] === t);
  const program = prefixPinned ? (tokens[3] ?? "") : null;
  if (program !== null) {
    // Byte-balance the program token against the pinned constant.
    // The common-prefix length is the byte offset in STRING indices
    // (the program is pure ASCII — the `\xEF\xBB\xBF` BOM is
    // literal escape TEXT, index == byte). The common-suffix trim
    // is BOUNDED by `min(len) - prefix` — an unbounded suffix loop
    // hangs on identical strings.
    let prefix = 0;
    const minLen = Math.min(program.length, BODY_STRIP.length);
    while (prefix < minLen && program[prefix] === BODY_STRIP[prefix]) {
      prefix++;
    }
    let suffix = 0;
    const bound = minLen - prefix;
    while (
      suffix < bound &&
      program[program.length - 1 - suffix] ===
        BODY_STRIP[BODY_STRIP.length - 1 - suffix]
    ) {
      suffix++;
    }
    const expectedSpan = BODY_STRIP.slice(prefix, BODY_STRIP.length - suffix);
    const gotSpan = program.slice(prefix, program.length - suffix);
    const fallback =
      (expectedSpan === "" && gotSpan === "") ||
      expectedSpan.length > FULL_LINE_FALLBACK_RATIO * BODY_STRIP.length ||
      gotSpan.length > FULL_LINE_FALLBACK_RATIO * program.length;
    if (!fallback) {
      return [
        `substitution program diverges from the pinned strip at byte ${prefix}:`,
        `  - expected: ${expectedSpan}`,
        `  + got:      ${gotSpan}`,
      ].join("\n");
    }
  }
  return [
    "substitution inner command deviates from the pinned strip:",
    `  - expected: perl -0777 -pe '${BODY_STRIP}' <path>`,
    `  + got:      ${tokens.map(quoteIfSpaced).join(" ")}`,
  ].join("\n");
}

/** Quote a display token when it contains whitespace (keeps the got line re-readable as a command). */
function quoteIfSpaced(token: string): string {
  return /\s/.test(token) ? `'${token.replace(/'/g, `"'"`)}'` : token;
}

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
 *
 * Thin wrapper over `explainBodyFileArg`: maps BOTH the `ok` and
 * the `direct` stage to their parsed result, `null` on every other
 * stage (`missing` / `form` / `tokens` / `core`).
 */
export function parseBodyFileArg(word: string): BodyFileArg | null {
  const explained = explainBodyFileArg(word);
  if (explained.stage === "ok" || explained.stage === "direct") {
    return explained.detail;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The pinned strip one-liner — the only accepted inner command
// ---------------------------------------------------------------------------

/** The exact inner-command token sequence (before the path token). */
const STRIP_COMMAND_TOKENS: readonly string[] = [
  "perl",
  "-0777",
  "-pe",
  BODY_STRIP,
] as const;

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
