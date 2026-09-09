// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * GitHub plugin-owned CLI descriptor (closes #61; exemplar:
 * pi-steering's `src/plugins/git/descriptors.ts`).
 *
 * Per-binary argv knowledge for the `gh` basename, declared via this
 * plugin's own `cliDescriptors` slot and referenced by name (never
 * inlined) in the plugin literal so hover rides on the const. Core
 * seeds nothing (`CORE_CLI_DESCRIPTORS` is empty); without this entry
 * every `command: "gh"` rule throws `MissingDescriptorError` (loud
 * block naming the missing facts).
 *
 * source: @withfig/autocomplete@2.692.3 src/gh.ts, retrieved 2026-09-07
 * (via the pi-steering#110 draft, owned here per owner decision —
 * pi-steering#110 removed its draft instead of shipping it);
 * reviewed vs real CLI output (gh version 2.96.0):
 * `gh --help` FLAGS names only `--help` / `--version` (both boolean).
 * Per-entry takesValue reviewed against `--help` arity text; Fig
 * `args` presence was the draft signal, `--help` was the verdict.
 *
 * Review trace (Fig draft → --help verdict):
 * - `-R/--repo [HOST/]OWNER/REPO`: Fig args + `gh pr --help` arity
 *   agree → takesValue:true. The global repo selector — the row the
 *   foreign-target gate and every flag-first subcommand extraction
 *   rest on.
 * - `--hostname`: NOT in `gh --help` (legacy/compat spelling) — kept
 *   from the deleted core minimum (`valueConsumingFlags: ["-R",
 *   "--repo", "--hostname"]`, see #61) so the long-standing
 *   `gh --hostname h pr …` forms keep extracting instead of reading
 *   `h` as the subcommand. A command literally carrying it errors at
 *   runtime under real gh; the row only affects such invalid lines.
 * - `--help`/`--version`: Fig no-args + `gh --help` FLAGS agree →
 *   takesValue:false. `-h` rides on the help entry (gh/github
 *   convention; the rules' `infoOnly` carve-out names the same `-h`).
 * - Rule-scoped entries (the flags table is per-binary, flat — the
 *   RULES scope them with `subcommand:`, same split as the git
 *   plugin's push/reset/commit entries):
 *   - body-file: `-F` / `--body-file FILE` — the vault-substitution
 *     channel (`gh pr create --help`).
 *   - body: `-b` / `--body STRING` — inline fallback the keyword
 *     rule reads when the body-file rules are disabled.
 *   - title: `-t` / `--title STRING` (`gh pr create`, `gh issue
 *     create`); subject: `--subject` + the same `-t` (`gh pr merge`
 *     reads `-t` as the commit subject — gh overloads the letter per
 *     subcommand, so both entries claim it; the consuming set
 *     dedupes and both facade views resolve).
 *   - seed: `--add-readme` (bool) + `--gitignore`/`-g`,
 *     `--license`/`-l`, `--template`/`-p` (each `<value>` —
 *     `gh repo create --help`) — the `not.flag` exemption set.
 * - Per-command flags the rules never read (e.g. `-e/--env`,
 *   `-o/--org`, `--source`, `--push`, `--clone`, `--description`)
 *   stay unlisted BY DESIGN (unlisted-flag strict-always: bool flags
 *   stay present-but-valueless, attached `--flag=x` still applies
 *   per-token; only a value-taking spelling needs a row). An
 *   incomplete tail under-extracts flag-first forms the way the
 *   pre-#41 anchors under-blocked them; an over-long tail
 *   over-consumes and shifts extraction the other way (#61).
 *
 * Glue derives from this table (single-char-short aliases of
 * takesValue:true entries): `R F b t g l p`. Faithful to gh/cobra
 * shorthand parsing — including its sharp edges: `-local` glues `l`
 * (license) and `-public` glues `p` (template), so those contrived
 * lines now EXEMPT the seed rule where the old token-boundary guard
 * blocked them. gh would reject both lines at runtime (junk seed
 * values), so nothing real executes; accepted and pinned in
 * `rules/gh-repo-create-needs-seed.test.ts`.
 */

import type { CLIDescriptor, CLIFlag } from "@cad0p/pi-steering";

/** `-R` / `--repo` — the global repo selector (takesValue:true). */
export const GH_REPO_FLAG = {
  aliases: ["-R", "--repo"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `--hostname` — legacy/compat spelling (see header). */
export const GH_HOSTNAME_FLAG = {
  aliases: ["--hostname"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `-F` / `--body-file` — the vault-substitution channel. */
export const GH_BODY_FILE_FLAG = {
  aliases: ["--body-file", "-F"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `-b` / `--body` — inline body (disabled-rules fallback). */
export const GH_BODY_FLAG = {
  aliases: ["--body", "-b"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `-t` / `--title` — `pr create` / `issue create` title. */
export const GH_TITLE_FLAG = {
  aliases: ["--title", "-t"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `--subject` (+ `-t`) — `pr merge` squash-commit subject. */
export const GH_SUBJECT_FLAG = {
  aliases: ["--subject", "-t"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `--add-readme` — seed flag (bool). */
export const GH_ADD_README_FLAG = {
  aliases: ["--add-readme"],
  takesValue: false,
} as const satisfies CLIFlag;

/** `--gitignore` / `-g` — seed flag (`<lang>`). */
export const GH_GITIGNORE_FLAG = {
  aliases: ["--gitignore", "-g"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `--license` / `-l` — seed flag (`<keyword>`). */
export const GH_LICENSE_FLAG = {
  aliases: ["--license", "-l"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `--template` / `-p` — seed flag (`<repo>`). */
export const GH_TEMPLATE_FLAG = {
  aliases: ["--template", "-p"],
  takesValue: true,
} as const satisfies CLIFlag;

/** `-h` / `--help` — bool (rides the infoOnly carve-out). */
export const GH_HELP_FLAG = {
  aliases: ["-h", "--help"],
  takesValue: false,
} as const satisfies CLIFlag;

/** `--version` — bool. */
export const GH_VERSION_FLAG = {
  aliases: ["--version"],
  takesValue: false,
} as const satisfies CLIFlag;

/**
 * gh descriptor: `globals-anywhere` (the walker's own documented gh
 * example — `gh -R x/y pr merge` ≡ `gh pr merge -R x/y`) + the flag
 * table above.
 *
 * Referenced by name (never inlined) in the plugin literal so hover
 * rides on this const.
 */
export const GH_CLI_DESCRIPTOR = {
  positionPolicy: "globals-anywhere",
  flags: {
    repo: GH_REPO_FLAG,
    hostname: GH_HOSTNAME_FLAG,
    bodyFile: GH_BODY_FILE_FLAG,
    body: GH_BODY_FLAG,
    title: GH_TITLE_FLAG,
    subject: GH_SUBJECT_FLAG,
    addReadme: GH_ADD_README_FLAG,
    gitignore: GH_GITIGNORE_FLAG,
    license: GH_LICENSE_FLAG,
    template: GH_TEMPLATE_FLAG,
    help: GH_HELP_FLAG,
    version: GH_VERSION_FLAG,
  },
} as const satisfies CLIDescriptor;
