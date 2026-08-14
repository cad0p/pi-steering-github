// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Vault body strip helper — the pure core behind the
 * `pi-steering-github strip` CLI and the predicate content checks.
 *
 * Napkin vault notes carry YAML frontmatter (tags, status, related
 * links) and a leading `# H1` title; uploaded verbatim to GitHub
 * they render as raw frontmatter + an oversized heading.
 * `stripVaultBody` removes exactly those two artifacts so the
 * remaining body can be handed to `gh` cleanly:
 *
 *   - Frontmatter: the file starts (after an optional BOM `\uFEFF`)
 *     with a line that is exactly `---`; everything through the NEXT
 *     line that is exactly `---` or `...` is stripped, plus any
 *     following blank lines. An unterminated opening `---` is NOT
 *     stripped (fail-safe: it could be a horizontal rule in
 *     content). CRLF input is tolerated (lines split on `/\r?\n/`,
 *     rejoined with `\n`).
 *   - Leading H1: after frontmatter removal, leading blank /
 *     whitespace-only lines are skipped; if the first remaining line
 *     is an ATX H1 (`^#(?:\s|$)`: `#`, `# `, `# text` — NOT `#foo`,
 *     NOT an indented `  #`), it is dropped, then leading blank
 *     lines are skipped again.
 *
 * Content with neither frontmatter nor an H1 is returned as-is
 * (byte-identical). This module never writes files — the vault is
 * only ever read, so vault notes are guaranteed byte-identical.
 */

import { readFileSync } from "node:fs";

/** The next line that closes a YAML frontmatter block. */
function isFrontmatterCloser(line: string): boolean {
  return line === "---" || line === "...";
}

/** An ATX H1: `#`, `# `, `# text` — but not `#foo`, not indented. */
const ATX_H1 = /^#(?:\s|$)/;

/**
 * Strip YAML frontmatter and the leading H1 from a vault note body.
 *
 * See the module docblock for the exact algorithm. Returns the input
 * text unchanged when neither artifact is present (byte-identical),
 * or when the frontmatter is unterminated.
 */
export function stripVaultBody(text: string): string {
  // The BOM only participates in the frontmatter check; when the
  // frontmatter (or the H1 right after it) is stripped, the BOM goes
  // with it. When nothing is stripped, the original text is returned
  // untouched, BOM included.
  const hasBom = text.charCodeAt(0) === 0xfeff;
  const body = hasBom ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);

  // 1. Frontmatter — must open on the very first line and close on
  //    the next `---` / `...`; strip through the closer plus any
  //    following blank lines.
  let start = 0;
  let strippedFrontmatter = false;
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && isFrontmatterCloser(line)) {
        start = i + 1;
        strippedFrontmatter = true;
        break;
      }
    }
  }
  if (strippedFrontmatter) {
    while (start < lines.length && lines[start]?.trim() === "") start++;
  }

  // 2. Leading H1 — skip leading blank lines, drop an ATX H1, then
  //    skip leading blank lines again.
  let h1 = start;
  while (h1 < lines.length && lines[h1]?.trim() === "") h1++;
  const first = lines[h1];
  const droppedH1 = first !== undefined && ATX_H1.test(first);
  if (droppedH1) {
    h1++;
    while (h1 < lines.length && lines[h1]?.trim() === "") h1++;
  }

  if (!strippedFrontmatter && !droppedH1) return text;
  return lines.slice(droppedH1 ? h1 : start).join("\n");
}

/**
 * Read a file (utf8) and strip frontmatter + leading H1 from it.
 *
 * Throws on unreadable paths — callers (the CLI, the predicate
 * content checks) decide how to surface the error.
 */
export function stripVaultBodyFile(path: string): string {
  return stripVaultBody(readFileSync(path, "utf8"));
}
