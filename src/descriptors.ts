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

import type { CLIDescriptor } from "@cad0p/pi-steering";

/**
 * gh descriptor: `globals-anywhere` (the walker's own documented gh
 * example — `gh -R x/y pr merge` ≡ `gh pr merge -R x/y`) + the flag
 * table below, which OWNS every flag entry (core git-descriptor
 * shape): entries live INLINE here and every consumer reads them via
 * `GH_CLI_DESCRIPTOR.flags.<key>` (or a destructured `ghFlags` alias
 * at use sites) — there are no standalone exported `GH_*_FLAG`
 * consts, so the table and its readers cannot drift.
 *
 * Referenced by name (never inlined) in the plugin literal so hover
 * rides on this const.
 */
export const GH_CLI_DESCRIPTOR = {
  positionPolicy: "globals-anywhere",
  flags: {
    /** `-R` / `--repo` — the global repo selector (takesValue:true). */
    repo: {
      aliases: ["-R", "--repo"],
      takesValue: true,
    },
    /** `--hostname` — legacy/compat spelling (see header). */
    hostname: {
      aliases: ["--hostname"],
      takesValue: true,
    },
    /** `-F` / `--body-file` — the vault-substitution channel. */
    bodyFile: {
      aliases: ["--body-file", "-F"],
      takesValue: true,
    },
    /** `-b` / `--body` — inline body (disabled-rules fallback). */
    body: {
      aliases: ["--body", "-b"],
      takesValue: true,
    },
    /** `-t` / `--title` — `pr create` / `issue create` title. */
    title: {
      aliases: ["--title", "-t"],
      takesValue: true,
    },
    /** `--subject` (+ `-t`) — `pr merge` squash-commit subject. */
    subject: {
      aliases: ["--subject", "-t"],
      takesValue: true,
    },
    /** `--add-readme` — seed flag (bool). */
    addReadme: {
      aliases: ["--add-readme"],
      takesValue: false,
    },
    /** `--gitignore` / `-g` — seed flag (`<lang>`). */
    gitignore: {
      aliases: ["--gitignore", "-g"],
      takesValue: true,
    },
    /** `--license` / `-l` — seed flag (`<keyword>`). */
    license: {
      aliases: ["--license", "-l"],
      takesValue: true,
    },
    /** `--template` / `-p` — seed flag (`<repo>`). */
    template: {
      aliases: ["--template", "-p"],
      takesValue: true,
    },
    /** `-h` / `--help` — bool (rides the infoOnly carve-out). */
    help: {
      aliases: ["-h", "--help"],
      takesValue: false,
    },
    /** `--version` — bool. */
    version: {
      aliases: ["--version"],
      takesValue: false,
    },
  },
} as const satisfies CLIDescriptor;
