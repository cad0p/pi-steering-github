// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * The byte-pinned perl program that strips a leading YAML frontmatter
 * block (open `---` on line 1 after an optional BOM; close on the
 * next line that is exactly `---` or `...`; CRLF-tolerant) plus any
 * immediately following blank lines. Unterminated or absent
 * frontmatter → input passed through byte-identical. Everything else
 * (the H1, `##`, mid-document `---`, line endings) is untouched.
 *
 * Leaf module (no imports) so both `rules.ts` (static reason strings
 * interpolate it at module load) and the predicate module (tokenizer
 * byte-pin + keyword-check exec) can import it without a cycle.
 *
 * The rule's tokenizer requires the inner command to be EXACTLY
 * `perl -0777 -pe '<this program>' <path>` (quoting of the program
 * is free — the tokenizer strips it); anything else fails closed.
 * The program's behavior is pinned by `frontmatter-strip.test.ts`,
 * which runs it against the full fixture matrix on every CI platform.
 */
export const FRONTMATTER_STRIP =
  "s/^(?:\\xEF\\xBB\\xBF)?---\\r?\\n(?:.*?\\r?\\n)?(?:---|\\.\\.\\.)\\r?\\n(?:\\r?\\n)*//s";
